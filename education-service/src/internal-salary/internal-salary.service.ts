import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LessonClientService } from '../lesson-client/lesson-client.service';
import { PortalTeacherLesson } from '../lesson-client/lesson-client.types';

type TeacherMapItem = { teacherId: number; legacyPortalUserId: number };
type Aggregate = {
  legacyPortalUserId: number;
  teacherId: number;
  finishedLessonCount: number;
  paidLessonCount: number;
  demoLessonCount: number;
  demoUnpaidLessonCount: number;
  demoPayableLessonCount: number;
  scheduledMinutes: number;
  payableMinutes: number;
  totalMinutes: number;
  recordedMinutes: number;
  recordUnavailableCount: number;
  missingRecordCount: number;
  missingDurationCount: number;
  implausibleRecordCount: number;
  fallbackPaidLessonCount: number;
  currency: string | null;
  warnings: string[];
};

type BlockerSample = {
  lessonUuid: string;
  teacherId: number | null;
  legacyPortalUserId: number | null;
  reason: string;
  lessonStart: string | null;
  scheduledMinutes?: number;
  durationSeconds?: number | null;
  isDemo?: boolean;
};

const BLOCKER_SAMPLE_LIMIT = 200;

@Injectable()
export class InternalSalaryService {
  private readonly logger = new Logger(InternalSalaryService.name);

  private readonly serviceName = process.env.SERVICE_NAME || 'speakasap-education';

  constructor(
    private readonly prisma: PrismaService,
    private readonly lessonClient: LessonClientService,
  ) {}

  async periodAggregates(period: string, legacyPortalUserIds: number[]) {
    const teacherMap = await this.fetchTeacherMap(legacyPortalUserIds);
    const teacherById = new Map(teacherMap.map((item) => [item.teacherId, item.legacyPortalUserId]));
    const teacherIds = [...teacherById.keys()];
    const warnings: string[] = [];
    const missingTeacherMappingLegacyUserIds = legacyPortalUserIds.filter(
      (id) => !teacherMap.some((item) => item.legacyPortalUserId === id),
    );
    if (!teacherIds.length) {
      if (legacyPortalUserIds.length) {
        warnings.push('no_teacher_mapping_for_requested_legacy_users');
      }
      return this.response(period, [], warnings, {
        missingTeacherMappingLegacyUserIds,
        blockerSamples: missingTeacherMappingLegacyUserIds.slice(0, BLOCKER_SAMPLE_LIMIT).map((id) => ({
          lessonUuid: '',
          teacherId: null,
          legacyPortalUserId: id,
          reason: 'teacher_mapping_missing',
          lessonStart: null,
        })),
      });
    }

    const { start, end } = periodBounds(period);

    // LESSON-API: lessons come from the portal, which owns them. This service used to read
    // its own `lesson` table, but that was an ETL COPY frozen at 2026-06-26 — every lesson
    // finished after that date was silently missing from teacher payouts.
    //
    // A failure here must never look like "the teacher taught nothing this month", so the
    // client raises rather than returning a partial month, and we let that propagate.
    let portalLessons: PortalTeacherLesson[];
    try {
      portalLessons = await this.lessonClient.listLessonsByTeachers(teacherIds, start, end);
    } catch (error) {
      this.logger.error(
        `portal lesson lookup failed for period=${period} teachers=${teacherIds.length}: ` +
          `${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('portal lesson source unavailable for salary aggregate');
    }

    // Duration stays local by owner decision: the portal has no `duration_seconds` column,
    // and deriving it there means opening every MP3 out of object storage. We join our own
    // `lesson_record` by uuid instead.
    const durationByUuid = await this.recordDurations(portalLessons.map((lesson) => lesson.uuid));

    const byUser = new Map<number, Aggregate>();
    const blockerSamples: BlockerSample[] = missingTeacherMappingLegacyUserIds
      .slice(0, BLOCKER_SAMPLE_LIMIT)
      .map((id) => ({
        lessonUuid: '',
        teacherId: null,
        legacyPortalUserId: id,
        reason: 'teacher_mapping_missing',
        lessonStart: null,
      }));
    for (const lesson of portalLessons) {
      if (lesson.teacherId === null) {
        continue;
      }
      const legacyPortalUserId = teacherById.get(lesson.teacherId);
      if (!legacyPortalUserId) {
        continue;
      }
      const agg = getAggregate(byUser, legacyPortalUserId, lesson.teacherId);

      // The portal decides these; this service used to guess. `isDemo` was a regex over
      // Russian course titles (/demo|проб/i) and is now the course CODE decision, and
      // `scheduledMinutes` now follows the legacy `Lesson.duration` rule at the source.
      const isDemo = lesson.isDemo;
      const isGroup = lesson.isGroup;
      const scheduledMinutes = lesson.scheduledMinutes;
      const hasPaidAccess = lesson.hasPaidAccess;

      const hasRecord = lesson.record.hasRecord;
      const unavailable = Boolean(lesson.record.recordUnavailable.trim());
      const durationSeconds = durationByUuid.get(lesson.uuid) ?? null;
      const payable = salaryPayableMinutes({ isDemo, hasRecord, unavailable, scheduledMinutes, durationSeconds });
      const payableMinutes = payable.minutes;
      const missingDuration = hasRecord && !unavailable && durationSeconds === null;
      // A recording shorter than the slot is the 95% rule working as designed, not a
      // blocker: short recordings are normal, so flagging them all would gate every payout
      // run forever. Only an implausibly short one gets a human's attention.
      const implausibleRecord =
        hasRecord &&
        !unavailable &&
        durationSeconds !== null &&
        durationSeconds < scheduledMinutes * 60 * IMPLAUSIBLE_RECORD_RATIO;

      agg.finishedLessonCount += 1;
      agg.scheduledMinutes += scheduledMinutes;
      agg.payableMinutes += payableMinutes;
      agg.totalMinutes += payableMinutes;
      if (hasRecord && payable.source === 'record_duration') {
        agg.recordedMinutes += payableMinutes;
      }
      if (payable.source === 'missing_duration_fallback') {
        addWarning(agg, 'lesson_record_duration_seconds_missing; used legacy fallback salary minutes');
      }
      if (missingDuration) {
        agg.missingDurationCount += 1;
        pushBlockerSample(blockerSamples, {
          lessonUuid: lesson.uuid,
          teacherId: lesson.teacherId,
          legacyPortalUserId,
          reason: 'lesson_record_duration_seconds_missing',
          lessonStart: lesson.start,
          scheduledMinutes,
          durationSeconds: null,
          isDemo,
        });
      }
      if (implausibleRecord) {
        agg.implausibleRecordCount += 1;
        addWarning(agg, 'record_too_short_to_be_a_lesson_requires_review');
        pushBlockerSample(blockerSamples, {
          lessonUuid: lesson.uuid,
          teacherId: lesson.teacherId,
          legacyPortalUserId,
          reason: 'record_too_short_to_be_a_lesson',
          lessonStart: lesson.start,
          scheduledMinutes,
          durationSeconds,
          isDemo,
        });
      }
      if (hasPaidAccess) {
        agg.paidLessonCount += 1;
      }
      if (isDemo) {
        agg.demoLessonCount += 1;
        if (payableMinutes === 0) {
          agg.demoUnpaidLessonCount += 1;
        } else {
          agg.demoPayableLessonCount += 1;
        }
      }
      if (unavailable) {
        agg.recordUnavailableCount += 1;
      }
      if (!hasRecord) {
        agg.missingRecordCount += 1;
        if (payableMinutes > 0) {
          agg.fallbackPaidLessonCount += 1;
        }
      }
    }

    return this.response(period, [...byUser.values()], warnings, {
      missingTeacherMappingLegacyUserIds,
      blockerSamples,
    });
  }

  /**
   * Local recording lengths for these lessons, keyed by lesson uuid.
   *
   * Absent from the map and present-but-null are the same thing to the caller — both mean
   * "we do not know how long this lesson was" — and both are counted as missingDuration,
   * which pays the legacy fallback rather than silently paying zero.
   */
  private async recordDurations(lessonUuids: string[]): Promise<Map<string, number | null>> {
    const byUuid = new Map<string, number | null>();
    if (!lessonUuids.length) {
      return byUuid;
    }
    const records = await this.prisma.lessonRecord.findMany({
      where: { lessonUuid: { in: lessonUuids } },
      select: { lessonUuid: true, durationSeconds: true },
    });
    for (const record of records) {
      byUuid.set(
        record.lessonUuid,
        Number.isInteger(record.durationSeconds) ? record.durationSeconds : null,
      );
    }
    return byUuid;
  }

  private async fetchTeacherMap(legacyPortalUserIds: number[]): Promise<TeacherMapItem[]> {
    const base = process.env.USER_SERVICE_URL?.replace(/\/$/, '');
    const token = (process.env.EDUCATION_TO_USER_SERVICE_TOKEN || '').trim();
    if (!base || !token) {
      this.logger.warn('USER_SERVICE_URL or EDUCATION_TO_USER_SERVICE_TOKEN unset; salary aggregate teacher map is empty');
      return [];
    }
    const url = new URL(`${base}/api/v1/internal/teachers/legacy-user-map`);
    if (legacyPortalUserIds.length) {
      url.searchParams.set('legacyPortalUserIds', legacyPortalUserIds.join(','));
    }
    const timeoutMs = Number(process.env.HTTP_CLIENT_TIMEOUT_MS || '8000');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`user_service_http_${res.status}`);
      }
      const body = (await res.json()) as { items?: TeacherMapItem[] };
      return (body.items ?? []).filter(
        (item) => Number.isInteger(item.teacherId) && Number.isInteger(item.legacyPortalUserId),
      );
    } catch (error) {
      this.logger.error(`teacher map fetch failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('user-service teacher mapping unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  private response(
    period: string,
    items: Aggregate[],
    warnings: string[],
    extras?: {
      missingTeacherMappingLegacyUserIds?: number[];
      blockerSamples?: BlockerSample[];
    },
  ) {
    const missingDurationCount = items.reduce((sum, item) => sum + item.missingDurationCount, 0);
    const implausibleRecordCount = items.reduce((sum, item) => sum + item.implausibleRecordCount, 0);
    const teacherMappingMissingCount = extras?.missingTeacherMappingLegacyUserIds?.length ?? 0;
    return {
      period,
      items,
      meta: {
        source: 'education-service',
        rulesVersion: 'salary-duration-v4-legacy-95pct-full-lesson',
        generatedAt: new Date().toISOString(),
        readiness: {
          // `implausibleRecordCount` is deliberately NOT a gate. An implausibly short
          // recording has a KNOWN length that happens to be tiny — legacy pays the real
          // length and so do we, so the figure is already correct and there is nothing to
          // fix before paying. It is reported so a human can look, not to hold up payroll.
          // Owner decision 2026-08-19, after adjudicating a 12s and a 129s recording as
          // genuinely short lessons rather than defects.
          //
          // `missingDurationCount` still gates, and the distinction is the point: there we
          // cannot tell what to pay at all, so a run would be guessing.
          salaryCalculationReady:
            missingDurationCount === 0 && teacherMappingMissingCount === 0,
          missingDurationCount,
          implausibleRecordCount,
          teacherMappingMissingCount,
          missingTeacherMappingLegacyUserIds: extras?.missingTeacherMappingLegacyUserIds ?? [],
        },
        blockerSamples: extras?.blockerSamples ?? [],
        warnings,
      },
    };
  }
}

function getAggregate(map: Map<number, Aggregate>, legacyPortalUserId: number, teacherId: number): Aggregate {
  let agg = map.get(legacyPortalUserId);
  if (!agg) {
    agg = {
      legacyPortalUserId,
      teacherId,
      finishedLessonCount: 0,
      paidLessonCount: 0,
      demoLessonCount: 0,
      demoUnpaidLessonCount: 0,
      demoPayableLessonCount: 0,
      scheduledMinutes: 0,
      payableMinutes: 0,
      totalMinutes: 0,
      recordedMinutes: 0,
      recordUnavailableCount: 0,
      missingRecordCount: 0,
      missingDurationCount: 0,
      implausibleRecordCount: 0,
      fallbackPaidLessonCount: 0,
      currency: null,
      warnings: ['salary_duration_rule_v3: record duration capped at scheduled lesson length with five_minute_full_lesson_tolerance'],
    };
    map.set(legacyPortalUserId, agg);
  }
  return agg;
}

type PayableSource = 'record_duration' | 'missing_duration_fallback' | 'demo_without_record';

/**
 * Legacy full-lesson threshold, from `expenses/salary/utils.py`:
 *
 *   "Если запись длиннее, чем 95% длительности урока, то считаем урок полным."
 *
 * RELATIVE to the lesson, not a flat number of minutes. This service previously used an
 * absolute five-minute window, which is a different rule for every lesson length: it paid
 * a full 60-minute lesson from 55 minutes where legacy required 57, and gave a 30-minute
 * demo five minutes of slack where legacy allowed 1.5.
 */
const FULL_LESSON_RATIO = 0.95;

/**
 * Below this, a recording is not a short lesson — it is a broken upload, a mis-click, or a
 * call that never started. Legacy pays the real length either way and so do we; this only
 * decides whether a human is asked to look before payouts are run.
 */
const IMPLAUSIBLE_RECORD_RATIO = 0.1;

function salaryPayableMinutes(input: {
  isDemo: boolean;
  hasRecord: boolean;
  unavailable: boolean;
  scheduledMinutes: number;
  durationSeconds: number | null;
}): { minutes: number; source: PayableSource } {
  if (!input.hasRecord && input.isDemo) {
    return { minutes: 0, source: 'demo_without_record' };
  }
  if (!input.hasRecord || input.unavailable || input.durationSeconds === null) {
    return { minutes: input.isDemo ? 30 : 60, source: 'missing_duration_fallback' };
  }
  const scheduledSeconds = input.scheduledMinutes * 60;
  // Strictly greater, matching legacy's `duration_hours > duration_limit`.
  if (input.durationSeconds > scheduledSeconds * FULL_LESSON_RATIO) {
    return { minutes: input.scheduledMinutes, source: 'record_duration' };
  }
  // legacy: quantize(min(duration_hours, lesson.duration)) — never more than scheduled.
  return { minutes: Math.min(Math.round(input.durationSeconds / 60), input.scheduledMinutes), source: 'record_duration' };
}

function addWarning(agg: Aggregate, warning: string): void {
  if (!agg.warnings.includes(warning)) {
    agg.warnings.push(warning);
  }
}

function pushBlockerSample(samples: BlockerSample[], sample: BlockerSample): void {
  if (samples.length < BLOCKER_SAMPLE_LIMIT) {
    samples.push(sample);
  }
}

function periodBounds(period: string): { start: Date; end: Date } {
  const [yearRaw, monthRaw] = period.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)),
    end: new Date(Date.UTC(year, month, 1, 0, 0, 0)),
  };
}

