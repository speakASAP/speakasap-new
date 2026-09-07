import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from '../auth/internal-token.guard';
import { Roles } from '../auth/roles.decorator';
import { ManagersService } from '../managers/managers.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { TeachersService } from '../teachers/teachers.service';

const MAX_BATCH = 30;

/** Least-privilege service role for user-service internal routes. */
export const USER_SERVICE_INTERNAL_ROLE = 'internal:user-service:internal';

function parseCsvInts(raw: string | undefined): number[] {
  if (!raw || !raw.trim()) {
    return [];
  }
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const value = Number(part.trim());
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException('legacyPortalUserIds must be positive integers');
    }
    out.push(value);
  }
  return [...new Set(out)];
}

@Controller('internal')
@UseGuards(InternalAuthGuard)
@Roles(USER_SERVICE_INTERNAL_ROLE)
export class InternalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsService,
    private readonly teachers: TeachersService,
    private readonly managers: ManagersService,
  ) {}

  /**
   * speakasap-notification-service: resolve mailbox + do-not-contact for an auth user id.
   */
  @Post('notification-target')
  async notificationTarget(
    @Body() body: { authUserId?: string },
  ): Promise<{ email: string | null; doNotContact: boolean }> {
    const authUserId = body.authUserId;
    if (!authUserId || typeof authUserId !== 'string') {
      throw new BadRequestException('authUserId is required');
    }
    const mirror = await this.prisma.userIdentityMirror.findUnique({
      where: { authUserId },
    });
    const student = await this.prisma.student.findUnique({
      where: { authUserId },
    });
    const raw = mirror?.email?.trim() ?? '';
    const email = raw.includes('@') ? raw : null;
    return {
      email,
      doNotContact: student?.doNotContact ?? false,
    };
  }

  @Post('students/upsert-by-auth-user')
  async upsertStudents(@Body() body: { items?: unknown[] }): Promise<{ upserted: number }> {
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('items must be a non-empty array');
    }
    if (items.length > MAX_BATCH) {
      throw new BadRequestException(`At most ${MAX_BATCH} items`);
    }
    return this.students.upsertBatchFromInternal(items);
  }



  @Get('teachers/legacy-user-map')
  async teacherLegacyUserMap(
    @Query('legacyPortalUserIds') legacyPortalUserIds?: string,
  ): Promise<{ items: { teacherId: number; legacyPortalUserId: number }[] }> {
    const ids = parseCsvInts(legacyPortalUserIds);
    if (ids.length > 1000) {
      throw new BadRequestException('At most 1000 legacyPortalUserIds');
    }
    const rows = await this.prisma.teacher.findMany({
      where: ids.length ? { legacyPortalUserId: { in: ids } } : { legacyPortalUserId: { not: null } },
      select: { id: true, legacyPortalUserId: true },
      orderBy: { id: 'asc' },
    });
    return {
      items: rows
        .filter((row): row is { id: number; legacyPortalUserId: number } => row.legacyPortalUserId !== null)
        .map((row) => ({ teacherId: row.id, legacyPortalUserId: row.legacyPortalUserId })),
    };
  }

  @Post('teachers/upsert-by-auth-user')
  async upsertTeachers(
    @Body() body: { items?: unknown[] },
  ): Promise<{ upserted: number; rolesGranted: number }> {
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('items must be a non-empty array');
    }
    if (items.length > MAX_BATCH) {
      throw new BadRequestException(`At most ${MAX_BATCH} items`);
    }
    return this.teachers.upsertBatchFromInternal(items);
  }

  @Post('managers/upsert-by-auth-user')
  async upsertManagers(@Body() body: { items?: unknown[] }): Promise<{ upserted: number }> {
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('items must be a non-empty array');
    }
    if (items.length > MAX_BATCH) {
      throw new BadRequestException(`At most ${MAX_BATCH} items`);
    }
    return this.managers.upsertBatchFromInternal(items);
  }
}
