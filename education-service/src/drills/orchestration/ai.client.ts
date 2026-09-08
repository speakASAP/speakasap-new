import { Injectable } from '@nestjs/common';
import {
  GenerateDrillRequest,
  GenerateDrillResponse,
  ValidateDrillRequest,
  ValidateDrillResponse,
} from '../contracts';
import { numericEnv, requestUpstream, requiredEnv } from './http';

const UPSTREAM = 'ai-microservice';

/**
 * Calls Track C's generator and validator agents.
 *
 * Auth: Auth-issued RS256 pair JWT (`EDUCATION_TO_AI_SERVICE_TOKEN`) as
 * Authorization Bearer. Local HS256 mint against AI_SERVICE_JWT_SECRET is
 * deleted — ai-microservice ServiceAuthGuard accepts Auth RS256 only
 * (`internal:ai-microservice:invoke`). See SERVICE_IDENTITY_CONSUMER_STANDARD.
 */
@Injectable()
export class AiClient {
  timeoutMs(): number {
    return numericEnv('DRILL_AI_CLIENT_TIMEOUT_MS', 180000);
  }

  async generate(req: GenerateDrillRequest, _token: string): Promise<GenerateDrillResponse> {
    return requestUpstream<GenerateDrillResponse>({
      url: `${this.baseUrl()}/api/teacher-assistant/generate-drill`,
      method: 'POST',
      token: this.serviceToken(),
      body: req,
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  async validate(req: ValidateDrillRequest, _token: string): Promise<ValidateDrillResponse> {
    return requestUpstream<ValidateDrillResponse>({
      url: `${this.baseUrl()}/api/teacher-assistant/validate-drill`,
      method: 'POST',
      token: this.serviceToken(),
      body: req,
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  private serviceToken(): string {
    return requiredEnv('EDUCATION_TO_AI_SERVICE_TOKEN', UPSTREAM);
  }

  private baseUrl(): string {
    return requiredEnv('AI_SERVICE_URL', UPSTREAM);
  }
}
