import { Injectable, Logger } from '@nestjs/common';

export type DisburseBody = {
  idempotencyKey: string;
  legacyPortalUserId: number;
  amountMinor: number;
  currency: string;
  metadata: { salaryPayoutLineId: string; period: string };
};

export type DisburseResponse = {
  payoutRef: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
};

@Injectable()
export class PaymentClientService {
  private readonly logger = new Logger(PaymentClientService.name);

  async disburse(body: DisburseBody, idempotencyKey: string): Promise<DisburseResponse> {
    const base = process.env.PAYMENT_SERVICE_URL?.replace(/\/$/, '');
    if (!base) {
      throw new Error('PAYMENT_SERVICE_URL_missing');
    }
    const token = (process.env.SALARY_TO_PAYMENT_SERVICE_TOKEN || '').trim();
    if (!token) {
      throw new Error('SALARY_TO_PAYMENT_SERVICE_TOKEN_missing');
    }
    const url = `${base}/api/v1/internal/salary/disburse`;
    const timeoutMs = Number(process.env.HTTP_CLIENT_TIMEOUT_MS || '8000');
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const durationMs = Date.now() - started;
      if (!res.ok) {
        this.logger.error(`payment disburse failed status=${res.status} duration_ms=${durationMs}`);
        throw new Error(`payment_disburse_${res.status}`);
      }
      const json = await parseDisburseResponse(res, (message) =>
        this.logger.error(
          `payment disburse malformed response duration_ms=${durationMs} ${message}`,
        ),
      );
      this.logger.log(`payment disburse ok duration_ms=${durationMs} payoutRef=${json.payoutRef}`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  async pollDisburse(payoutRef: string): Promise<DisburseResponse> {
    const base = process.env.PAYMENT_SERVICE_URL?.replace(/\/$/, '');
    if (!base) {
      throw new Error('PAYMENT_SERVICE_URL_missing');
    }
    const token = (process.env.SALARY_TO_PAYMENT_SERVICE_TOKEN || '').trim();
    if (!token) {
      throw new Error('SALARY_TO_PAYMENT_SERVICE_TOKEN_missing');
    }
    const url = `${base}/api/v1/internal/salary/disburse/${encodeURIComponent(payoutRef)}`;
    const timeoutMs = Number(process.env.HTTP_CLIENT_TIMEOUT_MS || '8000');
    const maxAttempts = 5;
    const delayMs = 200;
    // Why this loop must not swallow failures: the money has already left via disburse().
    // Reporting `processing` after an attempt we could not read makes an outage
    // indistinguishable from a payment that is genuinely still in flight, and the caller
    // stores that as PayoutLineStatus.processing. Only an attempt we actually read may
    // conclude the payment is still queued.
    let lastFailure: string | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const durationMs = Date.now() - started;
        if (!res.ok) {
          lastFailure = String(res.status);
          this.logger.warn(
            `payment poll disburse attempt=${attempt} status=${res.status} duration_ms=${durationMs}`,
          );
        } else {
          const json = await parseDisburseResponse(res, (message) =>
            this.logger.warn(
              `payment poll disburse attempt=${attempt} malformed response duration_ms=${durationMs} ${message}`,
            ),
          ).catch((error: Error) => {
            lastFailure = 'malformed_response';
            void error;
            return null;
          });
          if (json) {
            lastFailure = null;
            this.logger.log(
              `payment poll disburse attempt=${attempt} duration_ms=${durationMs} status=${json.status}`,
            );
            if (json.status === 'completed' || json.status === 'failed') {
              return json;
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    if (lastFailure) {
      this.logger.error(
        `payment poll disburse unresolved payoutRef=${payoutRef} attempts=${maxAttempts} last_failure=${lastFailure}`,
      );
      throw new Error(`payment_poll_unresolved_${lastFailure}`);
    }
    return { payoutRef, status: 'processing' };
  }
}

/**
 * Reads a disburse response body, refusing anything that is not a usable payout.
 *
 * A body that will not parse, or that carries no payoutRef, is a failure — never a
 * payout. Returning it would store `undefined` as the line's payout reference and poll
 * `/disburse/undefined` afterwards.
 */
async function parseDisburseResponse(
  res: Response,
  logFailure: (message: string) => void,
): Promise<DisburseResponse> {
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    logFailure((e as Error).message);
    throw new Error('payment_disburse_malformed_response');
  }
  const payoutRef = (json as DisburseResponse | null)?.payoutRef;
  if (typeof payoutRef !== 'string' || !payoutRef) {
    logFailure('missing payoutRef');
    throw new Error('payment_disburse_malformed_response');
  }
  return json as DisburseResponse;
}
