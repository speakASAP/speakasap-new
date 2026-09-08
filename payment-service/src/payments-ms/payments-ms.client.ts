import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { paymentHttpException } from '../shared/payment-http.exception';

type CreatePaymentPayload = {
  orderId: string;
  applicationId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  callbackUrl: string;
  description?: string;
  customer: { email: string; name?: string; phone?: string };
  metadata?: Record<string, unknown>;
  userBalance?: number;
  invoiceNumber?: number;
};

@Injectable()
export class PaymentsMsClient {
  private readonly logger = new Logger(PaymentsMsClient.name);

  private base(): string {
    return (process.env.PAYMENTS_MICROSERVICE_URL || '').replace(/\/$/, '');
  }

  /** Auth RS256 pair JWT (svc-speakasap-payment--payments-microservice). */
  private serviceToken(): string {
    const token = process.env.SPEAKASAP_PAYMENT_TO_PAYMENTS_TOKEN;
    if (!token) {
      throw paymentHttpException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'PROVIDER_ERROR',
        'SPEAKASAP_PAYMENT_TO_PAYMENTS_TOKEN is required for payments-microservice calls',
      );
    }
    return token;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.serviceToken()}` };
  }

  async createPayment(payload: CreatePaymentPayload): Promise<{
    paymentId: string;
    status: string;
    redirectUrl: string | null;
  }> {
    const url = `${this.base()}/payments/create`;
    return this.postJson(url, payload, (data) => {
      const d = data as { success?: boolean; data?: Record<string, unknown> };
      if (!d?.data || typeof d.data.paymentId !== 'string') {
        throw paymentHttpException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'PROVIDER_ERROR',
          'Invalid payments-ms create response',
        );
      }
      return {
        paymentId: String(d.data.paymentId),
        status: String(d.data.status ?? ''),
        redirectUrl: (d.data.redirectUrl as string | null) ?? null,
      };
    });
  }

  async getPayment(paymentId: string): Promise<{
    paymentId: string;
    orderId: string;
    status: string;
    amount: number;
    currency: string;
    paymentMethod: string;
  }> {
    const url = `${this.base()}/payments/${encodeURIComponent(paymentId)}`;
    return this.getJson(url, (data) => {
      const d = data as { success?: boolean; data?: Record<string, unknown> };
      const row = d?.data;
      if (!row || typeof row.paymentId !== 'string') {
        throw paymentHttpException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Payment not found');
      }
      return {
        paymentId: String(row.paymentId),
        orderId: String(row.orderId ?? ''),
        status: String(row.status ?? ''),
        amount: Number(row.amount),
        currency: String(row.currency ?? ''),
        paymentMethod: String(row.paymentMethod ?? ''),
      };
    });
  }

  async refundPayment(
    paymentId: string,
    body: { amount?: number; reason?: string },
  ): Promise<{ paymentId: string; status: string }> {
    const url = `${this.base()}/payments/${encodeURIComponent(paymentId)}/refund`;
    return this.postJson(url, body, (data) => {
      const d = data as { success?: boolean; data?: Record<string, unknown> };
      if (!d?.data || typeof d.data.paymentId !== 'string') {
        throw paymentHttpException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'PROVIDER_ERROR',
          'Invalid payments-ms refund response',
        );
      }
      return {
        paymentId: String(d.data.paymentId),
        status: String(d.data.status ?? ''),
      };
    });
  }

  private async postJson<T>(
    url: string,
    body: unknown,
    mapOk: (data: unknown) => T,
  ): Promise<T> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const durationMs = Date.now() - started;
      this.logger.log(`${new Date().toISOString()} payments-ms POST ${url} status=${res.status} duration_ms=${durationMs}`);
      const text = await res.text();
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
      if (!res.ok) {
        this.mapProviderError(res.status, data);
      }
      return mapOk(data);
    } catch (e) {
      const durationMs = Date.now() - started;
      if ((e as Error).name === 'AbortError') {
        this.logger.error(`${new Date().toISOString()} payments-ms POST timeout duration_ms=${durationMs} url=${url}`);
        throw paymentHttpException(
          HttpStatus.BAD_GATEWAY,
          'PROVIDER_UNAVAILABLE',
          'payments-ms request timed out',
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private async getJson<T>(url: string, mapOk: (data: unknown) => T): Promise<T> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.authHeaders(),
        signal: controller.signal,
      });
      const durationMs = Date.now() - started;
      this.logger.log(`${new Date().toISOString()} payments-ms GET ${url} status=${res.status} duration_ms=${durationMs}`);
      const text = await res.text();
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
      if (!res.ok) {
        this.mapProviderError(res.status, data);
      }
      return mapOk(data);
    } catch (e) {
      const durationMs = Date.now() - started;
      if ((e as Error).name === 'AbortError') {
        this.logger.error(`${new Date().toISOString()} payments-ms GET timeout duration_ms=${durationMs} url=${url}`);
        throw paymentHttpException(
          HttpStatus.BAD_GATEWAY,
          'PROVIDER_UNAVAILABLE',
          'payments-ms request timed out',
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private mapProviderError(status: number, data: unknown): never {
    const msg =
      data && typeof data === 'object' && (data as { error?: { message?: string } }).error?.message
        ? String((data as { error: { message: string } }).error.message)
        : 'payments-ms error';
    if (status === 404) {
      throw paymentHttpException(HttpStatus.NOT_FOUND, 'NOT_FOUND', msg);
    }
    if (status >= 500 || status === 502 || status === 503) {
      throw paymentHttpException(HttpStatus.BAD_GATEWAY, 'PROVIDER_UNAVAILABLE', msg);
    }
    throw paymentHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'PROVIDER_ERROR', msg);
  }
}
