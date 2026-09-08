import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsObject, IsString, Min } from 'class-validator';
import { InternalAuthGuard } from '../auth/internal-token.guard';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../shared/public.decorator';
import { SalaryDisburseService } from './salary-disburse.service';

export const PAYMENT_SERVICE_INTERNAL_ROLE = 'internal:payment-service:internal';

class SalaryDisburseDto {
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsInt()
  legacyPortalUserId!: number;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsObject()
  metadata!: { salaryPayoutLineId?: string; period?: string };
}

@Public()
@UseGuards(InternalAuthGuard)
@Roles(PAYMENT_SERVICE_INTERNAL_ROLE)
@Controller('internal/salary/disburse')
export class SalaryDisburseController {
  constructor(private readonly service: SalaryDisburseService) {}

  @Post()
  create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: SalaryDisburseDto,
  ) {
    return this.service.create(idempotencyKey, body);
  }

  @Get(':payoutRef')
  get(@Param('payoutRef') payoutRef: string) {
    return this.service.get(payoutRef);
  }
}
