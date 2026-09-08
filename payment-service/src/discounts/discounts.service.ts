import { HttpStatus, Injectable } from '@nestjs/common';
import { DiscountType, OrderStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { AuthContextUser } from '../shared/auth.types';
import { clampLimit, decodeCursor, encodeCursor } from '../shared/pagination';
import { paymentHttpException } from '../shared/payment-http.exception';
import { isAdmin } from '../shared/roles';
import { PrismaService } from '../prisma/prisma.service';
import { toOrderDto, type OrderWithRelations } from '../orders/order.mapper';
import type { ApplyDiscountDto } from './dto/apply-discount.dto';
import type { CreateDiscountTemplateDto } from './dto/create-discount-template.dto';

@Injectable()
export class DiscountsService {
  constructor(private readonly prisma: PrismaService) {}

  async listTemplates(
    user: AuthContextUser,
    limitRaw: string | undefined,
    cursor: string | undefined,
  ): Promise<{ data: unknown[]; meta: { nextCursor: string | null; limit: number } }> {
    if (!isAdmin(user)) {
      throw paymentHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Admin role required');
    }
    const limit = clampLimit(limitRaw);
    const where: Prisma.DiscountTemplateWhereInput = {};
    const cur = decodeCursor(cursor);
    if (cur) {
      const d = new Date(cur.c);
      where.AND = [
        {
          OR: [{ createdAt: { lt: d } }, { AND: [{ createdAt: d }, { code: { lt: cur.i } }] }],
        },
      ];
    }
    const rows = await this.prisma.discountTemplate.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { code: 'desc' }],
      take: limit + 1,
      include: { products: true },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.code) : null;
    return {
      data: page.map((t) => this.templateToDto(t)),
      meta: { nextCursor, limit },
    };
  }

  async createTemplate(
    user: AuthContextUser,
    dto: CreateDiscountTemplateDto,
  ): Promise<unknown> {
    if (!isAdmin(user)) {
      throw paymentHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Admin role required');
    }
    const code = dto.code.toUpperCase();
    const exists = await this.prisma.discountTemplate.findUnique({ where: { code } });
    if (exists) {
      throw paymentHttpException(HttpStatus.CONFLICT, 'CONFLICT', 'Template code already exists');
    }
    const created = await this.prisma.discountTemplate.create({
      data: {
        code,
        singleUser: dto.singleUser ?? false,
        enabled: dto.enabled ?? true,
        discount: new Decimal(dto.discount),
        discountType: dto.discountType,
        validTill: dto.validTill ?? null,
        comment: dto.comment ?? null,
        permanent: dto.permanent ?? false,
        courseDiscount: dto.courseDiscount ?? false,
        products: dto.productIds?.length
          ? {
              create: dto.productIds.map((productId) => ({ productId })),
            }
          : undefined,
      },
      include: { products: true },
    });
    return this.templateToDto(created);
  }

  async getTemplate(user: AuthContextUser, code: string): Promise<unknown> {
    const upper = code.toUpperCase();
    if (!isAdmin(user)) {
      throw paymentHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Admin required');
    }
    const t = await this.prisma.discountTemplate.findUnique({
      where: { code: upper },
      include: { products: true },
    });
    if (!t) {
      throw paymentHttpException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Discount template not found');
    }
    return this.templateToDto(t);
  }

  async applyToOrder(
    user: AuthContextUser,
    orderId: string,
    dto: ApplyDiscountDto,
  ): Promise<unknown> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { discountOrder: true },
    });
    if (!order || order.trashedAt) {
      throw paymentHttpException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order not found');
    }
    if (order.userId !== user.id) {
      throw paymentHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Not allowed');
    }
    if (!order.discountable) {
      throw paymentHttpException(HttpStatus.CONFLICT, 'CONFLICT', 'Order does not accept discounts');
    }
    const existing = order.discountOrder;
    const templateCode = dto.code.toUpperCase();
    if (existing && existing.discountTemplateCode === templateCode) {
      const full = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { discountOrder: true, paymentAttempts: true },
      });
      return toOrderDto(full as OrderWithRelations);
    }

    const template = await this.prisma.discountTemplate.findUnique({
      where: { code: templateCode },
    });
    if (!template || !template.enabled) {
      throw paymentHttpException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Invalid discount code');
    }
    if (template.validTill && new Date(template.validTill) < new Date()) {
      throw paymentHttpException(HttpStatus.CONFLICT, 'CONFLICT', 'Discount code is no longer valid');
    }

    const data = (order.data ?? {}) as Record<string, unknown>;
    const basePrice =
      typeof data.basePriceMinorBeforeDiscount === 'number'
        ? (data.basePriceMinorBeforeDiscount as number)
        : order.priceMinor;

    const nextPrice = this.computeDiscountedPrice(basePrice, template.discount, template.discountType);

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.discountOrder.delete({ where: { orderId: order.id } });
      }
      await tx.discountOrder.create({
        data: {
          orderId: order.id,
          discountTemplateCode: template.code,
        },
      });
      const nextData = { ...data, basePriceMinorBeforeDiscount: basePrice } as Prisma.InputJsonValue;
      await tx.order.update({
        where: { id: order.id },
        data: { priceMinor: nextPrice, data: nextData },
      });
    });

    const full = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { discountOrder: true, paymentAttempts: true },
    });
    return toOrderDto(full as OrderWithRelations);
  }

  async removeFromOrder(user: AuthContextUser, orderId: string): Promise<unknown> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { discountOrder: true },
    });
    if (!order || order.trashedAt) {
      throw paymentHttpException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order not found');
    }
    if (order.userId !== user.id) {
      throw paymentHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Not allowed');
    }
    if (order.status === OrderStatus.paid || order.paid) {
      throw paymentHttpException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'Discount cannot be removed from a paid order',
      );
    }
    if (!order.discountOrder) {
      const full = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { discountOrder: true, paymentAttempts: true },
      });
      return toOrderDto(full as OrderWithRelations);
    }
    const data = (order.data ?? {}) as Record<string, unknown>;
    const base =
      typeof data.basePriceMinorBeforeDiscount === 'number'
        ? (data.basePriceMinorBeforeDiscount as number)
        : order.priceMinor;
    const rest = { ...data };
    delete rest.basePriceMinorBeforeDiscount;

    await this.prisma.$transaction([
      this.prisma.discountOrder.delete({ where: { orderId: order.id } }),
      this.prisma.order.update({
        where: { id: order.id },
        data: { priceMinor: base, data: rest as Prisma.InputJsonValue },
      }),
    ]);

    const full = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { discountOrder: true, paymentAttempts: true },
    });
    return toOrderDto(full as OrderWithRelations);
  }

  private computeDiscountedPrice(
    priceMinor: number,
    discount: Decimal,
    discountType: DiscountType,
  ): number {
    const d = Number(discount);
    if (discountType === DiscountType.PERCENT) {
      return Math.max(0, Math.round(priceMinor * (1 - d / 100)));
    }
    const fixedMinor = Math.round(d * 100);
    return Math.max(0, priceMinor - fixedMinor);
  }

  private templateToDto(t: {
    code: string;
    singleUser: boolean;
    enabled: boolean;
    discount: Decimal;
    discountType: DiscountType;
    validTill: Date | null;
    comment: string | null;
    permanent: boolean;
    courseDiscount: boolean;
    createdAt: Date;
    updatedAt: Date;
    products?: { productId: string }[];
  }): Record<string, unknown> {
    return {
      code: t.code,
      singleUser: t.singleUser,
      enabled: t.enabled,
      discount: Number(t.discount),
      discountType: t.discountType,
      validTill: t.validTill,
      comment: t.comment,
      permanent: t.permanent,
      courseDiscount: t.courseDiscount,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      productIds: (t.products ?? []).map((p) => p.productId),
    };
  }
}
