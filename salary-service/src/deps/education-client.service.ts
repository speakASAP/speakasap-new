import { Injectable, Logger } from '@nestjs/common';

/** Optional aggregates — education-service may expose this path in a later wave; salary stays HTTP-only. */
export type PeriodAggregateItem = {
  legacyPortalUserId: number;
  finishedLessonCount: number;
  paidLessonCount?: number;
  demoLessonCount?: number;
  demoUnpaidLessonCount?: number;
  demoPayableLessonCount?: number;
  scheduledMinutes?: number;
  payableMinutes?: number;
  totalMinutes: number;
  recordedMinutes?: number;
  recordUnavailableCount?: number;
  missingRecordCount?: number;
  missingDurationCount?: number;
  shortRecordCount?: number;
  implausibleRecordCount?: number;
  fallbackPaidLessonCount?: number;
  warnings?: string[];
};

export type SalaryAggregateReadiness = {
  salaryCalculationReady?: boolean;
  missingDurationCount?: number;
  shortRecordCount?: number;
  implausibleRecordCount?: number;
  teacherMappingMissingCount?: number;
  missingTeacherMappingLegacyUserIds?: number[];
};

export type SalaryAggregateBlockerSample = {
  lessonUuid?: string;
  teacherId?: number | null;
  legacyPortalUserId?: number | null;
  reason: string;
  lessonStart?: string | null;
  scheduledMinutes?: number;
  durationSeconds?: number | null;
  isDemo?: boolean;
};

export type PeriodAggregateResult = {
  items: Map<number, PeriodAggregateItem>;
  readiness: SalaryAggregateReadiness;
  blockerSamples: SalaryAggregateBlockerSample[];
  warnings: string[];
};

@Injectable()
export class EducationClientService {
  private readonly logger = new Logger(EducationClientService.name);

  async fetchPeriodAggregates(
    period: string,
    legacyPortalUserIds: number[],
    internalToken: string,
  ): Promise<PeriodAggregateResult> {
    const base = process.env.EDUCATION_SERVICE_URL?.replace(/\/$/, '');
    if (!base) {
      this.logger.warn('EDUCATION_SERVICE_URL unset; period aggregates empty');
      return emptyResult('EDUCATION_SERVICE_URL unset');
    }
    const url = new URL(`${base}/api/v1/internal/salary/period-aggregates`);
    url.searchParams.set('period', period);
    if (legacyPortalUserIds.length) {
      url.searchParams.set('legacyPortalUserIds', legacyPortalUserIds.join(','));
    }
    const timeoutMs = Number(process.env.HTTP_CLIENT_TIMEOUT_MS || '8000');
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${internalToken}` },
        signal: controller.signal,
      });
      const durationMs = Date.now() - started;
      if (res.status === 404 || res.status === 501) {
        this.logger.warn(
          `education period-aggregates not implemented status=${res.status} duration_ms=${durationMs}`,
        );
        return emptyResult(`education_http_${res.status}`);
      }
      if (!res.ok) {
        this.logger.error(
          `education period-aggregates failed status=${res.status} duration_ms=${durationMs}`,
        );
        throw new Error(`education_http_${res.status}`);
      }
      const body = (await res.json()) as {
        items?: PeriodAggregateItem[];
        meta?: {
          readiness?: SalaryAggregateReadiness;
          blockerSamples?: SalaryAggregateBlockerSample[];
          warnings?: string[];
        };
      };
      const map = new Map<number, PeriodAggregateItem>();
      for (const it of body.items ?? []) {
        map.set(it.legacyPortalUserId, it);
      }
      this.logger.log(`education period-aggregates ok duration_ms=${durationMs} count=${map.size}`);
      return {
        items: map,
        readiness: body.meta?.readiness ?? {},
        blockerSamples: body.meta?.blockerSamples ?? [],
        warnings: body.meta?.warnings ?? [],
      };
    } catch (e) {
      const durationMs = Date.now() - started;
      this.logger.error(
        `education period-aggregates error duration_ms=${durationMs} ${(e as Error).message}`,
      );
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

function emptyResult(warning: string): PeriodAggregateResult {
  return {
    items: new Map(),
    readiness: { salaryCalculationReady: false },
    blockerSamples: [],
    warnings: [warning],
  };
}
