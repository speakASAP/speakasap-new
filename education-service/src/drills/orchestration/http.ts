import { Logger, ServiceUnavailableException } from '@nestjs/common';

export interface UpstreamRequest {
  /** Absolute URL, already query-encoded. */
  url: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Auth RS256 pair JWT sent as Authorization Bearer. */
  token: string;
  /** Sent as `idempotency-key`. Upstreams that honour it replay rather than repeat. */
  idempotencyKey?: string;
  body?: unknown;
  timeoutMs: number;
  /** Used verbatim in every thrown message so the failing upstream is unambiguous. */
  upstream: string;
}

/**
 * One fetch, one timeout, one failure mode.
 *
 * Every non-2xx response and every transport failure throws
 * ServiceUnavailableException naming the upstream service. Returning a benign
 * empty value on failure is what turns a content-service outage into "the bank
 * has no items", after which the orchestrator generates a full set of AI items
 * nobody asked for and bills the owner for it.
 */
/**
 * Every cross-service call in the generation pipeline goes through here, so this is the
 * only place a hang or a slow upstream can be seen. Without it a stuck run showed nothing
 * at all in the logs — which is exactly what happened to the first two drill jobs.
 */
const upstreamLogger = new Logger('UpstreamRequest');

export async function requestUpstream<T>(req: UpstreamRequest): Promise<T> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${req.token}`,
    Accept: 'application/json',
  };
  if (req.idempotencyKey) {
    headers['idempotency-key'] = req.idempotencyKey;
  }
  if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let res: any;
  try {
    res = await fetch(req.url, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: controller.signal,
    } as any);
  } catch (error) {
    const reason = controller.signal.aborted
      ? `timed out after ${req.timeoutMs}ms`
      : (error as Error).message;
    upstreamLogger.error(
      `${req.method} ${req.upstream} FAILED after ${Date.now() - startedAt}ms — ${reason} (${req.url})`,
    );
    throw new ServiceUnavailableException(`${req.upstream} request failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await safeText(res);
    upstreamLogger.error(
      `${req.method} ${req.upstream} responded ${res.status} after ${Date.now() - startedAt}ms (${req.url})${detail ? ` — ${detail}` : ''}`,
    );
    throw new ServiceUnavailableException(
      `${req.upstream} responded ${res.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  upstreamLogger.log(
    `${req.method} ${req.upstream} ${res.status} in ${Date.now() - startedAt}ms (${req.url})`,
  );
  return (await res.json()) as T;
}

async function safeText(res: any): Promise<string> {
  try {
    const text = await res.text();
    return typeof text === 'string' ? text.slice(0, 200) : '';
  } catch {
    return '';
  }
}

export function requiredEnv(key: string, upstream: string): string {
  const value = (process.env[key] || '').replace(/\/$/, '');
  if (!value) {
    throw new ServiceUnavailableException(`${upstream} is not configured: ${key} is unset`);
  }
  return value;
}

export function numericEnv(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
