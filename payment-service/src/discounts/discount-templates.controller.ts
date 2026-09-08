import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateDiscountTemplateDto } from './dto/create-discount-template.dto';
import { DiscountsService } from './discounts.service';

@Controller('discounts')
@UseGuards(JwtAuthGuard)
export class DiscountTemplatesController {
  constructor(private readonly discounts: DiscountsService) {}

  @Get('templates')
  async list(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<unknown> {
    return this.discounts.listTemplates(req.authUser!, limit, cursor);
  }

  @Post('templates')
  async create(@Req() req: Request, @Body() dto: CreateDiscountTemplateDto): Promise<unknown> {
    return this.discounts.createTemplate(req.authUser!, dto);
  }

  @Get('templates/:code')
  async getOne(@Req() req: Request, @Param('code') code: string): Promise<unknown> {
    return this.discounts.getTemplate(req.authUser!, code);
  }
}
