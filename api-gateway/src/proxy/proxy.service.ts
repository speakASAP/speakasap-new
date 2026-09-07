import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'stream';
import { applyInternalHopToken } from './internal-hop';
import { resolveUpstreamBaseUrl } from './upstream-resolve';
import { logOperationalFailure } from '../shared/operational-log';

const HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  async forward(req: Request, res: Response): Promise<void> {
    const pathname = (req.originalUrl || '').split('?')[0];
    this.enforceListLimit(req);
    const base = resolveUpstreamBaseUrl(pathname);
    if (!base) {
      throw new HttpException(
        {
          code: 'NOT_FOUND',
          message: 'No upstream route for path',
          details: { path: pathname },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const targetUrl = `${base}${req.originalUrl}`;
    const timeoutMs = Number(process.env.GATEWAY_TIMEOUT) || 30_000;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = this.buildForwardHeaders(req);
      // GatewayAuthGuard already validated the caller (Auth RS256 + internal:*).
      // Stamp Authorization Bearer from GATEWAY_TO_<SERVICE>_TOKEN for upstream
      // InternalAuthGuard. See internal-hop.ts.
      applyInternalHopToken(headers, pathname);
      const body = await this.readRequestBody(req);

      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: body !== undefined && body.length > 0 ? new Uint8Array(body) : undefined,
        signal: controller.signal,
      });

      const durationMs = Date.now() - started;
      this.logger.log(
        `${new Date().toISOString()} upstream ${req.method} ${pathname} status=${upstream.status} duration_ms=${durationMs}`,
      );

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (HOP_HEADERS.has(key.toLowerCase())) {
          return;
        }
        res.setHeader(key, value);
      });

      if (!upstream.body) {
        res.end();
        return;
      }

      await new Promise<void>((resolve, reject) => {
        Readable.fromWeb(upstream.body as never)
          .on('error', reject)
          .on('end', resolve)
          .pipe(res);
      });
    } catch (err) {
      const durationMs = Date.now() - started;
      if ((err as Error).name === 'AbortError') {
        logOperationalFailure(this.logger, {
          component: 'upstream',
          operation: 'fetch',
          duration_ms: durationMs,
          path: pathname,
          targetUrl,
          errorCode: 'GATEWAY_TIMEOUT',
        });
        throw new HttpException(
          {
            code: 'GATEWAY_TIMEOUT',
            message: 'Upstream request timeout',
            details: { service: base },
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }
      logOperationalFailure(this.logger, {
        component: 'upstream',
        operation: 'fetch',
        duration_ms: durationMs,
        path: pathname,
        targetUrl,
        errorCode: 'UPSTREAM_UNAVAILABLE',
        message: (err as Error).message?.slice(0, 500),
      });
      throw new HttpException(
        {
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'Upstream service unavailable',
          details: { service: base },
        },
        HttpStatus.BAD_GATEWAY,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private buildForwardHeaders(req: Request): Headers {
    const out = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) {
        continue;
      }
      const lower = key.toLowerCase();
      if (lower === 'host' || HOP_HEADERS.has(lower)) {
        continue;
      }
      if (Array.isArray(value)) {
        out.set(key, value.join(','));
      } else {
        out.set(key, value);
      }
    }
    return out;
  }

  private async readRequestBody(req: Request): Promise<Buffer | undefined> {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return undefined;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  }

  private enforceListLimit(req: Request): void {
    const rawLimit = req.query?.limit;
    if (rawLimit === undefined) {
      return;
    }

    const value = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 30) {
      throw new HttpException(
        {
          code: 'INVALID_LIMIT',
          message: 'Query parameter "limit" must be between 1 and 30',
          details: { limit: value },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
