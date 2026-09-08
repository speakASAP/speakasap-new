import {
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

export type TranslateRequest = {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
};

export type TranslateResponse = {
  translatedText: string;
  providerStatus: number;
  durationMs: number;
};

/**
 * Calls ai-microservice translation.
 *
 * Auth: Auth-issued RS256 pair JWT (`CONTENT_TO_AI_SERVICE_TOKEN`) as
 * Authorization Bearer. API-key / x-api-key substitute deleted — ai-microservice
 * ServiceAuthGuard accepts Auth RS256 only (`internal:ai-microservice:invoke`).
 * See SERVICE_IDENTITY_CONSUMER_STANDARD.
 */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly aiServiceUrl = process.env.AI_SERVICE_URL;
  private readonly translatePath = process.env.AI_SERVICE_TRANSLATE_PATH || '/api/v1/translate';
  private readonly timeoutMs = Number(process.env.AI_SERVICE_TIMEOUT || process.env.HTTP_TIMEOUT || 5000);
  private readonly retryAttempts = Number(process.env.RETRY_MAX_ATTEMPTS || 1);
  private readonly retryDelayMs = Number(process.env.RETRY_DELAY_MS || 0);

  async translate(payload: TranslateRequest): Promise<TranslateResponse> {
    if (!this.aiServiceUrl) {
      throw new ServiceUnavailableException('AI service is not configured');
    }
    this.serviceToken();

    const retries = Math.max(1, this.retryAttempts);
    const startedAt = Date.now();
    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const attemptStartedAt = Date.now();
      this.logger.log(
        `AI translate request started: attempt=${attempt}/${retries} targetLanguage=${payload.targetLanguage} textLength=${payload.text.length} sourceLanguage=${payload.sourceLanguage || 'auto'}`,
      );
      try {
        const result = await this.callTranslateEndpoint(payload);
        this.logger.log(
          `AI translate request succeeded: attempt=${attempt}/${retries} status=${result.providerStatus} durationMs=${Date.now() - attemptStartedAt} totalDurationMs=${Date.now() - startedAt}`,
        );
        return {
          ...result,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error;
        const errorMessage = error instanceof Error ? error.message : 'Unknown AI error';
        this.logger.error(
          `AI translate request failed: attempt=${attempt}/${retries} durationMs=${Date.now() - attemptStartedAt} message=${errorMessage}`,
          error instanceof Error ? error.stack : undefined,
        );
        if (attempt < retries) {
          await this.sleep(this.retryDelayMs);
        }
      }
    }

    if (lastError instanceof GatewayTimeoutException || this.isTimeoutError(lastError)) {
      throw new GatewayTimeoutException('AI translation request timed out');
    }
    if (lastError instanceof HttpException) {
      throw lastError;
    }
    throw new ServiceUnavailableException('AI translation service unavailable');
  }

  private serviceToken(): string {
    const token = (process.env.CONTENT_TO_AI_SERVICE_TOKEN || '').trim();
    if (!token) {
      throw new ServiceUnavailableException(
        'CONTENT_TO_AI_SERVICE_TOKEN (Auth-minted RS256) is required for ai-microservice calls',
      );
    }
    return token;
  }

  private async callTranslateEndpoint(payload: TranslateRequest): Promise<TranslateResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.aiServiceUrl}${this.translatePath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.serviceToken()}`,
        },
        body: JSON.stringify({
          text: payload.text,
          sourceLang: payload.sourceLanguage,
          targetLang: payload.targetLanguage,
        }),
        signal: controller.signal,
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.logger.error(
          `AI translate upstream error: status=${response.status} body=${this.truncate(JSON.stringify(body))}`,
        );
        throw this.mapUpstreamError(response.status);
      }

      const translatedText = this.pickTranslatedText(body);
      if (!translatedText) {
        throw new ServiceUnavailableException('AI response does not contain translated text');
      }

      return {
        translatedText,
        providerStatus: response.status,
        durationMs: 0,
      };
    } catch (error) {
      if (this.isTimeoutError(error)) {
        throw new GatewayTimeoutException('AI translation request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private pickTranslatedText(body: unknown): string | null {
    if (!body || typeof body !== 'object') {
      return null;
    }
    const candidate = body as Record<string, unknown>;
    const value = candidate.translatedText ?? candidate.translation ?? candidate.text;
    return typeof value === 'string' ? value : null;
  }

  private mapUpstreamError(status: number): HttpException {
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return new HttpException('AI translation rate limited', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (status === HttpStatus.REQUEST_TIMEOUT || status === HttpStatus.GATEWAY_TIMEOUT) {
      return new GatewayTimeoutException('AI translation request timed out');
    }
    if (status === HttpStatus.SERVICE_UNAVAILABLE || status >= 500) {
      return new ServiceUnavailableException('AI translation service unavailable');
    }
    return new HttpException('AI translation request failed', HttpStatus.BAD_GATEWAY);
  }

  private isTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  private truncate(value: string, maxLength = 300): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}...`;
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
