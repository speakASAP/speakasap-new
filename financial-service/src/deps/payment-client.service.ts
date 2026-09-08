import { Injectable, Logger } from '@nestjs/common';
import { getOutboundPaymentServiceToken } from './internal-api-token';
import { fetchJsonWithRetry } from './http-fetch';

export type PaidOrderRow = {
  legacyOrderId: number;
  userId: string;
  priceMinor: number;
  currency: string;
  paidAt: string;
  legacyProductId: number | null;
  status: string;
  paymentMethodKey?: string | null;
};

export type TransactionsRow = {
  legacyTransactionId?: number;
  id?: number;
  amountMinor: number;
  isIncome: boolean;
  legacyUserId: number;
  legacyOrderId?: number | null;
  createdAt: string;
  external?: boolean;
  currency?: string;
};

export type SliceEnvelope<T> = {
  data: T[];
  meta: { nextCursor: string | null; limit: number };
};

@Injectable()
export class PaymentClientService {
  private readonly logger = new Logger(PaymentClientService.name);

  private baseUrl(): string {
    const u = process.env.PAYMENT_SERVICE_URL?.replace(/\/$/, '');
    if (!u) {
      throw new Error('PAYMENT_SERVICE_URL is not set');
    }
    return u;
  }

  private timeoutMs(): number {
    return Number(process.env.FINANCIAL_HTTP_TIMEOUT_MS || 8000);
  }

  async fetchOrdersPaidSlice(params: {
    paidAfter?: string;
    paidBefore?: string;
    cursor?: string;
    limit: number;
  }): Promise<SliceEnvelope<PaidOrderRow>> {
    const token = getOutboundPaymentServiceToken();
    const q = new URLSearchParams();
    if (params.paidAfter) {
      q.set('paidAfter', params.paidAfter);
    }
    if (params.paidBefore) {
      q.set('paidBefore', params.paidBefore);
    }
    if (params.cursor) {
      q.set('cursor', params.cursor);
    }
    q.set('limit', String(params.limit));
    const url = `${this.baseUrl()}/api/v1/internal/financial/orders-paid-slice?${q.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await fetchJsonWithRetry<SliceEnvelope<PaidOrderRow>>(
        'payment.orders-paid-slice',
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

  async fetchTransactionsSlice(params: {
    cursor?: string;
    limit: number;
    createdAfter?: string;
    createdBefore?: string;
  }): Promise<SliceEnvelope<TransactionsRow>> {
    const token = getOutboundPaymentServiceToken();
    const q = new URLSearchParams();
    if (params.cursor) {
      q.set('cursor', params.cursor);
    }
    q.set('limit', String(params.limit));
    if (params.createdAfter) {
      q.set('createdAfter', params.createdAfter);
    }
    if (params.createdBefore) {
      q.set('createdBefore', params.createdBefore);
    }
    const url = `${this.baseUrl()}/api/v1/internal/financial/transactions-slice?${q.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await fetchJsonWithRetry<SliceEnvelope<TransactionsRow>>(
        'payment.transactions-slice',
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
