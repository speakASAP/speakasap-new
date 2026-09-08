import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationProgress, ResolveLegacyUserResponse } from '../contracts';
import { ContentClient } from './content.client';
import { GenerationJobRepository } from './job-runner.service';
import { buildAuthServiceHeaders } from '../../auth-client/auth-client.service';
import { numericEnv, requestUpstream, requiredEnv } from './http';

/**
 * Track D's implementations of the boundaries Track B2 left unbound.
 *
 * B2 declared them as interfaces and deliberately did not provide them, so the module
 * fails at startup rather than running against a stub (B2 handoff, "Will not boot yet").
 * These are those implementations.
 */

/**
 * `DrillSetsClient` for SelfDrillService.
 *
 * NOTE: `incrementSelfSelected` has no route in content-service — Track A2 shipped
 * `POST drill-sets/:uuid/ratings` but nothing that bumps `timesSelfSelected`. It is
 * logged and skipped rather than throwing: failing a student's drill start because a
 * popularity counter could not be bumped would be the wrong trade. The counter feeds
 * library ranking only.
 */
@Injectable()
export class DrillSetsClientAdapter {
  private readonly logger = new Logger(DrillSetsClientAdapter.name);

  constructor(private readonly content: ContentClient) {}

  async getSet(setUuid: string): Promise<any> {
    return this.content.getSet(setUuid, this.internalCallerToken());
  }

  async incrementSelfSelected(setUuid: string): Promise<void> {
    this.logger.warn(
      `timesSelfSelected not incremented for set ${setUuid}: content-service exposes no route for it (Track D handoff)`,
    );
  }

  /**
   * Service-to-service calls carry the service's own token, not a student's: a student
   * must never hold a credential that reaches an `internal/` route, because those
   * routes return answers.
   */
  private internalCallerToken(): string {
    return requiredEnv('EDUCATION_TO_CONTENT_SERVICE_TOKEN', 'content-service');
  }
}

/**
 * The portal read this adapter needs, narrowed from `LessonClientService`.
 *
 * An interface rather than the class so the adapter states its one dependency, and so
 * `drills.module.ts` remains the only place that knows which implementation it gets.
 */
export interface StudentProgressSource {
  getStudentProgress(
    studentId: number,
  ): Promise<{ courseKey: string | null; lessonOrder: number | null }>;
}

/**
 * `StudentProgressClient` — where the student currently is in their course.
 *
 * Reads the portal, which is the single source of truth for lessons and courses. This
 * used to query this service's OWN `StudentCourse` and `Lesson` tables — copies of the
 * portal's, frozen since 2026-06-26 — until 0853b09 dropped them. The reads were written
 * as `(this.prisma as any).studentCourse`, so the cast carried them past the type check
 * and they became `Cannot read properties of undefined (reading 'findFirst')` at runtime,
 * 500'ing every self-drill and remedial generation from 2026-08-22 onward.
 *
 * The join that used to live here (GroupStudent -> Group -> StudentCourse, then the
 * highest finished `Lesson.order`) now lives in the portal's own
 * `StudentProgressView`, expressed against the tables it actually owns.
 *
 * `studentId` is the legacy portal USER id, as everywhere else in the drills code.
 */
@Injectable()
export class StudentProgressClientAdapter {
  constructor(private readonly lessons: StudentProgressSource) {}

  async getStudentProgress(
    studentId: number,
  ): Promise<{ courseKey: string | null; lessonOrder: number | null }> {
    // Deliberately unguarded: a portal outage must fail the drill request, not resolve
    // to a null ceiling, which reads downstream as "this student has no limit" and
    // widens the bank to material they have not been taught.
    return this.lessons.getStudentProgress(studentId);
  }
}

/** The legacy system `DrillAssignment.studentId` values belong to. */
const LEGACY_SYSTEM = 'speakasap-portal';

/**
 * `DrillIdentityResolver` — the auth UUID to legacy integer bridge.
 *
 * Calls auth-microservice's `GET /internal/users/by-auth-user`. The JWT carries
 * `AuthContextUser.id` (a UUID) while `DrillAssignment.studentId` is the legacy Django
 * integer, so every student-facing drill call goes through here first.
 *
 * EVERY failure path fails CLOSED with 503 IDENTITY_UNRESOLVED (contract C7) — no
 * mapping, an unreachable service, an ambiguous mapping, a non-numeric id. There is no
 * safe fallback: defaulting, coercing or picking a row all hand one student another
 * student's assignments and the answers inside them. A 503 says only that identity
 * could not be established, which is the truth in all four cases.
 */
@Injectable()
export class DrillIdentityResolverAdapter {
  private readonly logger = new Logger(DrillIdentityResolverAdapter.name);

  async resolveStudentId(authUserId: string): Promise<number> {
    const base = requiredEnv('AUTH_SERVICE_URL', 'auth-microservice');
    const query = new URLSearchParams({ system: LEGACY_SYSTEM, authUserId });

    let response: { legacyUserId?: unknown };
    try {
      // Auth wants Authorization: Bearer (AUTH_SERVICE_TOKEN) only — not gateway hop headers.
      //
      // Sending the gateway's convention here 401'd every call, and because this resolver
      // fails closed, the teacher wizard rendered "Request failed with status 503" with an
      // empty student list. Same class of mix-up as the 2026-08-03 Finding 4.
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        numericEnv('AUTH_SERVICE_TIMEOUT', 10000),
      );
      try {
        const res = await fetch(`${base}/internal/users/by-auth-user?${query}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...buildAuthServiceHeaders(),
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`by-auth-user failed with status ${res.status}`);
        }
        response = (await res.json()) as { legacyUserId?: unknown };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      // Covers 404 (no mapping), 409 (ambiguous — a duplicate-account data defect) and
      // transport failures alike. They are distinguished in the log, never in the
      // response: the caller's only correct action is the same in every case.
      this.logger.error(
        `Identity resolution failed for auth user ${authUserId}: ${(error as Error).message}`,
      );
      throw unresolved();
    }

    const legacyId = Number(response.legacyUserId);
    if (!Number.isInteger(legacyId) || legacyId <= 0) {
      this.logger.error(`Identity resolution returned no usable legacy id for ${authUserId}`);
      throw unresolved();
    }
    return legacyId;
  }
}

function unresolved(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'IDENTITY_UNRESOLVED',
    message: 'Could not resolve the signed-in user to a student record',
  });
}

/**
 * `GenerationJobRepository` for JobRunner.
 *
 * AssignmentsRepository is Track B's file and carries none of these methods; Track D
 * does not edit it, so the three writes live here against the same Prisma client.
 */
@Injectable()
export class GenerationJobRepositoryAdapter implements GenerationJobRepository {
  private readonly logger = new Logger(GenerationJobRepositoryAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  async updateProgress(assignmentUuid: string, progress: GenerationProgress): Promise<void> {
    // A run that reached READY leaves GENERATING here, and nowhere else: `cancel` was the
    // only method that touched `status`, so a *successful* generation left the assignment
    // marked as generating forever. The teacher saw "Ready, 10 of 10" on a row still
    // flagged as in-flight, and it never reached the review queue, which counts
    // PENDING_REVIEW.
    //
    // Only READY promotes. FAILED is left alone so a failed run does not land in a
    // teacher's queue looking reviewable.
    const data: Record<string, unknown> = { generationProgress: progress as any };
    if (progress.phase === 'READY') {
      data.status = 'PENDING_REVIEW';
    } else if (progress.phase === 'FAILED') {
      // A failed run used to stay GENERATING forever, indistinguishable from one still
      // running. CANCELLED is a terminal state the state machine already allows from
      // every non-terminal one, and it keeps the row out of the review queue.
      data.status = 'CANCELLED';
    }

    await (this.prisma as any).drillAssignment.update({
      where: { uuid: assignmentUuid },
      data,
    });

    if (progress.phase === 'READY') {
      this.logger.log(
        `Assignment ${assignmentUuid} generated ${progress.generated}/${progress.total}; status -> PENDING_REVIEW`,
      );
    }
  }

  async cancel(assignmentUuid: string, reason: string): Promise<void> {
    await (this.prisma as any).drillAssignment.update({
      where: { uuid: assignmentUuid },
      data: {
        status: 'CANCELLED',
        generationProgress: {
          phase: 'FAILED',
          generated: 0,
          total: 0,
          etaSeconds: null,
          message: reason,
          stalled: false,
        } as any,
      },
    });
    this.logger.warn(`Assignment ${assignmentUuid} cancelled: ${reason}`);
  }

  async findStaleGenerating(olderThanSeconds: number): Promise<{ uuid: string }[]> {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
    return (this.prisma as any).drillAssignment.findMany({
      where: { status: 'GENERATING', createdAt: { lt: cutoff } },
      select: { uuid: true },
    });
  }
}
