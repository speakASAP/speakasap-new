import { Injectable, Logger } from '@nestjs/common';
import {
  LessonNotFoundError,
  LessonServiceUnavailableError,
  PortalLesson,
  PortalLessonRecord,
  PortalRoster,
  PortalTeacherLesson,
  PortalTeacherLessonsPage,
} from './lesson-client.types';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * A month of lessons is far larger than a single roster, so the range endpoint gets its
 * own budget rather than inheriting the per-lesson one.
 */
const DEFAULT_RANGE_TIMEOUT_MS = 30000;

/** Matches the portal's own cap; a larger request is clamped there anyway. */
const RANGE_PAGE_SIZE = 500;

/**
 * Refuses to page forever. At 500 rows a page this allows 100,000 lessons in one range —
 * orders of magnitude above any real month — so hitting it means something is wrong
 * (a stuck offset, a portal ignoring pagination) and must raise rather than spin.
 */
const MAX_RANGE_PAGES = 200;

/**
 * Client for the portal's lesson API.
 *
 * The portal is the single source of truth for lessons. This service holds no lesson
 * tables; every lesson read and the two permitted lesson writes go through here.
 *
 * Deliberately NOT fail-soft. `cabinet/drills_client.py` on the portal side IS fail-soft,
 * because a drilling outage must not break an unrelated dashboard. Here the lesson IS the
 * request: a roster or a recording with no lesson behind it is meaningless, and returning
 * an empty one is what hid a frozen lesson table for six weeks. Every failure raises.
 *
 * LESSON-API: transitional — delete or repoint at legacy sunset.
 */
@Injectable()
export class LessonClientService {
  private readonly logger = new Logger(LessonClientService.name);
  private readonly baseUrl = (process.env.PORTAL_API_URL || '').replace(/\/+$/, '');
  private readonly token = process.env.EDUCATION_TO_PORTAL_SERVICE_TOKEN || '';
  private readonly timeoutMs =
    Number(process.env.PORTAL_CLIENT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  private readonly rangeTimeoutMs =
    Number(process.env.PORTAL_RANGE_TIMEOUT_MS) || DEFAULT_RANGE_TIMEOUT_MS;
  /** Indirection so tests can inject a fake without a network or a DI container. */
  private readonly fetchFn: typeof fetch = (...args) => fetch(...args);

  async getLesson(lessonUuid: string): Promise<PortalLesson> {
    const body = await this.request(
      lessonUuid,
      `/lessons/${encodeURIComponent(lessonUuid)}/`,
    );
    return this.toLesson(body);
  }

  /**
   * Where a student is in their course, for the drilling lesson ceiling.
   *
   * `studentId` is the legacy portal USER id — what `resolveStudentId` returns and what
   * the roster emits. Never a `students.Student` pk: the two spaces overlap numerically
   * and name different people.
   *
   * Used by the paths that hold no lesson (self-drilling, remedial drills). The teacher
   * wizard takes its ceiling from the lesson it is assigning from instead, which is both
   * cheaper and closer to what the teacher chose.
   *
   * Null `courseKey`/`lessonOrder` is a real answer — the student has no active course,
   * or has finished nothing on it — and the caller drills without a ceiling. A failure
   * to ASK raises, like every other read here, because a silently null ceiling would
   * widen the bank to material the student has not reached.
   */
  async getStudentProgress(
    studentId: number,
  ): Promise<{ courseKey: string | null; lessonOrder: number | null }> {
    const body = await this.request(
      // The request helper labels errors with a lesson uuid; these calls carry no
      // lesson, so the student is named instead and the log still says who it was for.
      `student:${studentId}`,
      `/students/${encodeURIComponent(String(studentId))}/progress/`,
    );

    const order = body.lesson_order;
    return {
      courseKey: typeof body.course_key === 'string' && body.course_key ? body.course_key : null,
      // Zero is a real lesson order. `?? null` rather than `|| null` keeps it.
      lessonOrder: typeof order === 'number' ? order : null,
    };
  }

  async getRoster(lessonUuid: string): Promise<PortalRoster> {
    const body = await this.request(
      lessonUuid,
      `/lessons/${encodeURIComponent(lessonUuid)}/roster/`,
    );

    return {
      lessonUuid: String(body.lesson_uuid ?? lessonUuid),
      teacherId: this.toNullableInt(body.teacher_id),
      groups: this.toArray(body.groups).map((raw) => {
        const group = raw as Record<string, unknown>;
        return {
          uuid: String(group.uuid),
          name: String(group.name ?? ''),
          studentIds: this.toArray(group.student_ids).map(Number),
        };
      }),
      studentIds: this.toArray(body.student_ids).map(Number),
      // Absent means NO paid students. Never fall back to student_ids: that would grant
      // drilling and playback to everyone attending, paid or not.
      paidStudentIds: this.toArray(body.paid_student_ids).map(Number),
      // Absent means no names on offer — an older portal has no `students` key. The
      // caller then falls back to its own "Student <id>" rendering rather than crashing.
      names: this.toNames(body.students),
    };
  }

  /**
   * `[{id, name}]` from the portal to a Map, dropping rows that carry no usable name.
   *
   * A blank name is not stored: the caller distinguishes "auth has no name" from "the
   * portal offered one", and an empty string would satisfy the second test while
   * displaying as the first.
   */
  private toNames(raw: unknown): Map<number, string> {
    const names = new Map<number, string>();
    for (const entry of this.toArray(raw)) {
      const row = entry as Record<string, unknown>;
      const id = Number(row.id);
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (Number.isInteger(id) && id > 0 && name) {
        names.set(id, name);
      }
    }
    return names;
  }

  /**
   * Every finished lesson for these teachers in [from, to), following pagination.
   *
   * The salary aggregate this feeds must be COMPLETE — a partial month underpays a real
   * person — so this pages to exhaustion and raises on any failure rather than returning
   * the rows it managed to collect. A short read here is indistinguishable, downstream,
   * from a teacher having taught fewer lessons.
   *
   * `teacherIds` are legacy Teacher profile pks, not auth user ids.
   */
  async listLessonsByTeachers(
    teacherIds: number[],
    from: Date,
    to: Date,
  ): Promise<PortalTeacherLesson[]> {
    if (!teacherIds.length) {
      // Not an error, and deliberately not a request: the portal rejects an empty
      // teacher list precisely so it can never be read as "every teacher".
      return [];
    }
    if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
      throw new LessonServiceUnavailableError('by-teacher', 'invalid "from" date');
    }
    if (!(to instanceof Date) || Number.isNaN(to.getTime())) {
      throw new LessonServiceUnavailableError('by-teacher', 'invalid "to" date');
    }
    if (to.getTime() <= from.getTime()) {
      throw new LessonServiceUnavailableError('by-teacher', '"to" must be after "from"');
    }

    const lessons: PortalTeacherLesson[] = [];
    let offset = 0;

    for (let page = 0; page < MAX_RANGE_PAGES; page += 1) {
      const params = new URLSearchParams({
        teacher_ids: teacherIds.join(','),
        from: from.toISOString(),
        to: to.toISOString(),
        limit: String(RANGE_PAGE_SIZE),
        offset: String(offset),
      });

      const body = await this.request(
        'by-teacher',
        `/lessons/by-teacher/?${params.toString()}`,
        'GET',
        undefined,
        this.rangeTimeoutMs,
      );

      const batch = this.toArray(body.lessons).map((raw) =>
        this.toTeacherLesson(raw as Record<string, unknown>),
      );
      lessons.push(...batch);

      if (!body.has_more) {
        const expected = Number(body.count);
        // The portal reported a total; if we did not collect it, something dropped rows
        // silently. Raising is the whole point of this seam.
        if (Number.isInteger(expected) && lessons.length !== expected) {
          this.logger.error(
            `Portal teacher-lesson pagination incomplete: collected=${lessons.length} ` +
              `expected=${expected} teachers=${teacherIds.length}`,
          );
          throw new LessonServiceUnavailableError(
            'by-teacher',
            `incomplete pagination: got ${lessons.length} of ${expected}`,
          );
        }
        return lessons;
      }

      if (!batch.length) {
        // has_more with an empty page would loop forever.
        this.logger.error(
          'Portal reported has_more with an empty page; refusing to loop',
        );
        throw new LessonServiceUnavailableError(
          'by-teacher',
          'has_more=true with an empty page',
        );
      }

      offset += batch.length;
    }

    this.logger.error(
      `Portal teacher-lesson pagination exceeded ${MAX_RANGE_PAGES} pages`,
    );
    throw new LessonServiceUnavailableError(
      'by-teacher',
      `pagination exceeded ${MAX_RANGE_PAGES} pages`,
    );
  }

  private toTeacherLesson(body: Record<string, unknown>): PortalTeacherLesson {
    const record = (body.record ?? {}) as Record<string, unknown>;
    return {
      uuid: String(body.uuid),
      teacherId: this.toNullableInt(body.teacher_id),
      start: (body.start as string | null) ?? null,
      isFinished: Boolean(body.is_finished),
      isDemo: Boolean(body.is_demo),
      isGroup: Boolean(body.is_group),
      scheduledMinutes: Number(body.scheduled_minutes ?? 0),
      hasPaidAccess: Boolean(body.has_paid_access),
      studentCourseUuid: String(body.student_course_uuid ?? ''),
      courseDisplayTitle: String(body.course_display_title ?? ''),
      moduleClass: String(body.module_class ?? ''),
      record: {
        hasRecord: Boolean(record.has_record),
        recordUnavailable: String(record.record_unavailable ?? ''),
        processed: Boolean(record.processed),
      },
    };
  }

  async updateLesson(
    lessonUuid: string,
    patch: { recommendation?: string; toManager?: string },
  ): Promise<PortalLesson> {
    const payload: Record<string, string> = {};
    if (patch.recommendation !== undefined) {
      payload.recommendation = patch.recommendation;
    }
    if (patch.toManager !== undefined) {
      payload.to_manager = patch.toManager;
    }

    const body = await this.request(
      lessonUuid,
      `/lessons/${encodeURIComponent(lessonUuid)}/`,
      'PATCH',
      payload,
    );
    return this.toLesson(body);
  }

  /**
   * Single exit point for every call, so no failure mode can skip the error handling.
   *
   * Every branch either returns a parsed body or throws. There is deliberately no path
   * that returns a default, an empty object, or null.
   */
  /**
   * Lesson recordings created in [from, to), following pagination.
   *
   * Rebuilds `lesson_record`, whose one-shot ETL last ran 2026-06-13 — nothing scheduled
   * it, so no row exists for any recording since. Salary joins duration by lesson uuid, so
   * a missing row silently became a flat full-hour payment instead of the real length.
   *
   * Pages to exhaustion and raises rather than returning what it managed to collect: a
   * short read is indistinguishable downstream from "these lessons had no recording",
   * which is the confusion that hid the freeze for two months.
   */
  async listLessonRecords(from: Date, to: Date): Promise<PortalLessonRecord[]> {
    if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
      throw new LessonServiceUnavailableError('lesson-records', 'invalid "from" date');
    }
    if (!(to instanceof Date) || Number.isNaN(to.getTime())) {
      throw new LessonServiceUnavailableError('lesson-records', 'invalid "to" date');
    }
    if (to.getTime() <= from.getTime()) {
      throw new LessonServiceUnavailableError('lesson-records', '"to" must be after "from"');
    }

    const records: PortalLessonRecord[] = [];
    let offset = 0;

    for (let page = 0; page < MAX_RANGE_PAGES; page += 1) {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        limit: String(RANGE_PAGE_SIZE),
        offset: String(offset),
      });

      const body = await this.request(
        'lesson-records',
        `/lesson-records/?${params.toString()}`,
        'GET',
        undefined,
        this.rangeTimeoutMs,
      );

      const batch = this.toArray(body.records).map((raw) =>
        this.toLessonRecord(raw as Record<string, unknown>),
      );
      records.push(...batch);

      if (!body.has_more) {
        const expected = Number(body.count);
        if (Number.isInteger(expected) && records.length !== expected) {
          this.logger.error(
            `Portal lesson-record pagination incomplete: collected=${records.length} ` +
              `expected=${expected}`,
          );
          throw new LessonServiceUnavailableError(
            'lesson-records',
            `incomplete pagination: got ${records.length} of ${expected}`,
          );
        }
        return records;
      }

      if (!batch.length) {
        this.logger.error('Portal reported has_more with an empty record page; refusing to loop');
        throw new LessonServiceUnavailableError('lesson-records', 'has_more=true with an empty page');
      }

      offset += batch.length;
    }

    this.logger.error(`Portal lesson-record pagination exceeded ${MAX_RANGE_PAGES} pages`);
    throw new LessonServiceUnavailableError(
      'lesson-records',
      `pagination exceeded ${MAX_RANGE_PAGES} pages`,
    );
  }

  private toLessonRecord(raw: Record<string, unknown>): PortalLessonRecord {
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    return {
      uuid: str(raw.uuid),
      lessonUuid: str(raw.lesson_uuid),
      recordKey: str(raw.record_key),
      partKeys: Array.isArray(raw.part_keys)
        ? raw.part_keys.filter((k): k is string => typeof k === 'string' && Boolean(k))
        : [],
      created: typeof raw.created === 'string' ? raw.created : null,
      processed: Boolean(raw.processed),
      recordUnavailable: str(raw.record_unavailable),
    };
  }

  private async request(
    lessonUuid: string,
    path: string,
    method: 'GET' | 'PATCH' = 'GET',
    payload?: Record<string, string>,
    timeoutMs: number = this.timeoutMs,
  ): Promise<Record<string, unknown>> {
    if (!this.baseUrl || !this.token) {
      // Misconfiguration is a failure, not a reason to degrade quietly.
      this.logger.error(
        'PORTAL_API_URL/EDUCATION_TO_PORTAL_SERVICE_TOKEN not configured; cannot reach the portal',
      );
      throw new LessonServiceUnavailableError(
        lessonUuid,
        'PORTAL_API_URL/EDUCATION_TO_PORTAL_SERVICE_TOKEN not configured',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(this.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Portal lesson request failed: ${method} ${path} lesson=${lessonUuid} reason=${reason}`,
      );
      throw new LessonServiceUnavailableError(lessonUuid, reason);
    } finally {
      clearTimeout(timer);
    }

    // 404 is the ONLY status that means "this lesson does not exist". Everything else
    // that is not ok — 401, 500, a proxy error page — is an outage, and must not be
    // mistaken for a definitive answer about the lesson.
    if (response.status === 404) {
      this.logger.warn(`Portal reports lesson ${lessonUuid} does not exist`);
      throw new LessonNotFoundError(lessonUuid);
    }

    if (!response.ok) {
      const text = await this.safeText(response);
      this.logger.error(
        `Portal lesson request non-ok: ${method} ${path} lesson=${lessonUuid} ` +
          `status=${response.status} body=${text.slice(0, 500)}`,
      );
      throw new LessonServiceUnavailableError(lessonUuid, `HTTP ${response.status}`);
    }

    try {
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Portal lesson response was not JSON: lesson=${lessonUuid} reason=${reason}`,
      );
      throw new LessonServiceUnavailableError(
        lessonUuid,
        `unparseable response: ${reason}`,
      );
    }
  }

  private toLesson(body: Record<string, unknown>): PortalLesson {
    return {
      uuid: String(body.uuid),
      order: Number(body.order ?? 0),
      teacherId: this.toNullableInt(body.teacher_id),
      start: (body.start as string | null) ?? null,
      isFinished: Boolean(body.is_finished),
      studentCourseUuid: String(body.student_course_uuid),
      moduleClass: String(body.module_class ?? ''),
      courseClass: String(body.course_class ?? ''),
      needsTeacher: Boolean(body.needs_teacher),
      recommendation: String(body.recommendation ?? ''),
      toManager: String(body.to_manager ?? ''),
    };
  }

  /** Null stays null — coercing an absent teacher to 0 would match teacher id 0. */
  private toNullableInt(value: unknown): number | null {
    return value === null || value === undefined ? null : Number(value);
  }

  private toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  /** Reading the body of an already-failed response must not mask the real error. */
  private async safeText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '<unreadable body>';
    }
  }
}
