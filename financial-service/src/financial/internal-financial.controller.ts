import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from '../auth/internal-token.guard';
import { Roles } from '../auth/roles.decorator';
import { FinancialAggregationService } from './financial-aggregation.service';
import { RefreshWindowDto } from './dto/refresh-window.dto';

export const FINANCIAL_SERVICE_INTERNAL_ROLE = 'internal:financial-service:internal';

@Controller('internal/financial')
@UseGuards(InternalAuthGuard)
@Roles(FINANCIAL_SERVICE_INTERNAL_ROLE)
export class InternalFinancialController {
  constructor(private readonly aggregation: FinancialAggregationService) {}

  @Post('refresh-window')
  refreshWindow(@Body() body: RefreshWindowDto) {
    return this.aggregation.refreshWindow(body.monthFrom, body.monthTo);
  }
}
