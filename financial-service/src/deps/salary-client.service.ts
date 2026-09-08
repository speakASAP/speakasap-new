import { Injectable, Logger } from '@nestjs/common';
import { getOutboundSalaryServiceToken } from './internal-api-token';
import { fetchJsonWithRetry } from './http-fetch';

export type SalaryPeriodTotalsResponse = {
  currencyTotals: Record<string, string>;
  lineCount: number;
  periodStart: string;
  periodEnd: string;
};

@Injectable()
export class SalaryClientService {
  private readonly logger = new Logger(SalaryClientService.name);

  private baseUrl(): string {
    const u = process.env.SALARY_SERVICE_URL?.replace(/\/$/, '');
    if (!u) {
      throw new Error('SALARY_SERVICE_URL is not set');
    }
    return u;
  }

  private timeoutMs(): number {
    return Number(process.env.FINANCIAL_HTTP_TIMEOUT_MS || 8000);
  }

  async fetchPeriodSalaryTotals(month: string): Promise<SalaryPeriodTotalsResponse> {
    const token = getOutboundSalaryServiceToken();
    const q = new URLSearchParams({ month });
    const url = `${this.baseUrl()}/api/v1/internal/financial/period-salary-totals?${q.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await fetchJsonWithRetry<SalaryPeriodTotalsResponse>(
        'salary.period-salary-totals',
        url,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        },
        this.logger,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
