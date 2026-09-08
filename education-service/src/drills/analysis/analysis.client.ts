import { Injectable } from '@nestjs/common';
import { numericEnv, requestUpstream, requiredEnv } from '../orchestration/http';
import { AnalyzeErrorsRequest, AnalyzeErrorsResponse } from './contracts';

const UPSTREAM = 'ai-microservice';

/**
 * Calls ai-microservice's error analyzer.
 *
 * Auth: Auth-issued RS256 pair JWT (`EDUCATION_TO_AI_SERVICE_TOKEN`) as
 * Authorization Bearer. Local HS256 mint against AI_SERVICE_JWT_SECRET is
 * deleted — ai-microservice ServiceAuthGuard accepts Auth RS256 only
 * (`internal:ai-microservice:invoke`).
 *
 * **Not fail-soft.** A failure here must reach `AnalysisService`, which records it as a
 * `FAILED` run the student and teacher can see and retry. Returning empty clusters would
 * render as "no mistakes to explain" on a drill full of mistakes.
 */
@Injectable()
export class AnalysisClient {
  timeoutMs(): number {
    return numericEnv('DRILL_ANALYSIS_CLIENT_TIMEOUT_MS', 120000);
  }

  async analyze(req: AnalyzeErrorsRequest): Promise<AnalyzeErrorsResponse> {
    return requestUpstream<AnalyzeErrorsResponse>({
      url: `${this.baseUrl()}/api/teacher-assistant/analyze-drill-errors`,
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
