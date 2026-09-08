import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { isTeacherUser } from '../shared/staff-access';
import { RunnerService } from './runner/runner.service';
import { SelfDrillService } from './runner/self-drill.service';
import { DrillAssignmentsService } from './runner/assignments.service';
import { TeacherAssignmentsService } from './teacher/teacher-assignments.service';
import { TeacherRosterService } from './teacher/roster.service';
import { ContentClient } from './orchestration/content.client';
import { AnalysisRepository } from './analysis/analysis.repository';
import { AnalysisJobRunner } from './analysis/analysis.job-runner';
import { RemedialService } from './analysis/remedial.service';
import {
  AssignFromSetRequest,
  AssignFromSetResponse,
  CheckBlankRequest,
  CheckBlankResponse,
  DrillAssignmentDTO,
  DrillSetDetailDTO,
  DrillTeacherRosterResponse,
  GenerateAssignmentsRequest,
  GenerateAssignmentsResponse,
  InternalTeacherAssignmentsResponse,
  RunnerResponse,
  ValidationState,
} from './contracts';

/**
 * Resolves the authenticated principal to the numeric legacy student id that
 * `DrillAssignment.studentId` is keyed on.
 *
 * The JWT carries a UUID (`AuthContextUser.id`) while the drill tables carry the
 * legacy Django integer. Bridging the two is Track H/I's job
 * (`POST /internal/users/resolve-or-provision-legacy`), not this controller's, so
 * it is taken as an injected boundary rather than reimplemented here.
 */
export interface DrillIdentityResolver {
  resolveStudentId(authUserId: string): Promise<number>;
}

export const DRILL_IDENTITY_RESOLVER = 'DRILL_IDENTITY_RESOLVER';

@Controller('drill-assignments')
@UseGuards(JwtAuthGuard)
export class DrillsController {
  private readonly logger = new Logger(DrillsController.name);

  constructor(
    private readonly runner: RunnerService,
    private readonly selfDrill: SelfDrillService,
    private readonly assignments: DrillAssignmentsService,
    // Track D: DrillIdentityResolver is a TypeScript interface, which erases at
    // runtime and therefore carries no DI token of its own. This is the one line
    // Track D added to a Track B2 file — without it the container cannot bind the
    // resolver and the service does not start.
    @Inject(DRILL_IDENTITY_RESOLVER) private readonly identity: DrillIdentityResolver,
    private readonly teacherAssignments: TeacherAssignmentsService,
    private readonly roster: TeacherRosterService,
    private readonly sets: ContentClient,
    private readonly analysis: AnalysisRepository,
    private readonly analysisJobs: AnalysisJobRunner,
    private readonly remedial: RemedialService,
  ) {}

  /** The student's own assignment list. */
  @Get()
  async listMine(@Req() req: Request) {
    const studentId = await this.studentId(req);
    return this.assignments.listForStudent(studentId);
  }

  /**
   * Teacher-only. Queues generation and returns immediately with the assignment uuids.
   *
   * Declared before `:uuid/...` routes below: Nest matches in declaration order, so a
   * parameterised route registered first would swallow `generate` as a uuid.
   */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(
    @Body() body: GenerateAssignmentsRequest,
    @Req() req: Request,
  ): Promise<GenerateAssignmentsResponse> {
    this.assertTeacher(req);
    const lessonUuid = this.assertLesson(body?.lessonUuid);
    const teacherId = await this.resolveTeacherId(req, lessonUuid);
    return this.teacherAssignments.generate(teacherId, body, this.bearer(req));
  }

  /** Teacher-only. Assigns an already-approved set, no generation. */
  @Post('assign')
  @HttpCode(HttpStatus.CREATED)
  async assign(
    @Body() body: AssignFromSetRequest,
    @Req() req: Request,
  ): Promise<AssignFromSetResponse> {
    this.assertTeacher(req);
    const lessonUuid = this.assertLesson(body?.lessonUuid);
    const teacherId = await this.resolveTeacherId(req, lessonUuid);
    return this.teacherAssignments.assignFromSet(teacherId, body, this.bearer(req));
  }

  /**
   * Teacher-only. The students this teacher may assign drilling to.
   *
   * Paged: a teacher with 656 students (production, teacher 10) is not a dropdown.
   * `search` matches the resolved name, falling back to the id for students auth has
   * no mapping for. Omitting all three returns the first page, so callers written
   * against the unpaged version keep working.
   */
  @Get('teacher/students')
  async teacherStudents(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('lessonUuid') lessonUuid?: string,
  ): Promise<DrillTeacherRosterResponse> {
    this.assertTeacher(req);

    // Scoped to a lesson when the caller names one. `Lesson.teacherId` is the legacy
    // Teacher profile pk (182) while `resolveStudentId` returns the user id (3), and this
    // service holds no mapping between them — so a teacher arriving from a lesson page
    // would otherwise be matched against the wrong id space and see someone else's
    // roster, or an empty one. The lesson names its own teacher and students.
    // The lesson is required, not merely preferred. The unscoped branch used to read
    // `prisma.lesson`, a copy of the portal's tables frozen since 2026-06-26, and
    // answered a teacher with only newer lessons with an empty roster — indistinguishable
    // from having no students. The portal serves rosters per lesson, so a lesson is what
    // makes a real answer possible at all.
    const scoped = await this.roster.listForLesson(this.assertLesson(lessonUuid), {
      search,
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
    });
    const { teacherId: _lessonTeacherId, ...response } = scoped;
    return response;
  }

  /**
   * The runner payload. Answer-free — `toRunnerResponse` builds it by explicit
   * field list, and a controller-level test re-asserts the absence of answers
   * because a projection test cannot prove this layer did not add them back.
   */
  @Get(':uuid/runner')
  async getRunner(@Param('uuid') uuid: string, @Req() req: Request): Promise<RunnerResponse> {
    const studentId = await this.studentId(req);
    return this.assignments.getRunner(uuid, studentId);
  }

  @Post(':uuid/check')
  @HttpCode(HttpStatus.OK)
  async check(
    @Param('uuid') uuid: string,
    @Body() body: CheckBlankRequest,
    @Req() req: Request,
  ): Promise<CheckBlankResponse> {
    if (!body?.itemUuid) {
      throw new BadRequestException('itemUuid is required');
    }
    if (typeof body?.blankIndex !== 'number') {
      throw new BadRequestException('numeric blankIndex is required');
    }
    const studentId = await this.studentId(req);
    return this.runner.check(uuid, studentId, body);
  }

  /**
   * Reveal one blank's answer — spec §9.6.
   *
   * The only student-facing route that deliberately returns an answer, and only for the
   * blank the student explicitly asked about. It costs them the blank: the position
   * resolves without ever counting as correct.
   */
  @Post(':uuid/reveal')
  @HttpCode(HttpStatus.OK)
  async reveal(
    @Param('uuid') uuid: string,
    @Body() body: { itemUuid?: string; blankIndex?: number },
    @Req() req: Request,
  ): Promise<CheckBlankResponse> {
    if (!body?.itemUuid) {
      throw new BadRequestException('itemUuid is required');
    }
    if (typeof body?.blankIndex !== 'number') {
      throw new BadRequestException('numeric blankIndex is required');
    }
    const studentId = await this.studentId(req);
    return this.runner.reveal(uuid, studentId, {
      itemUuid: body.itemUuid,
      blankIndex: body.blankIndex,
    });
  }

  /** Self-selected drilling. The gate lives in SelfDrillService, server-side. */
  @Post('self')
  @HttpCode(HttpStatus.CREATED)
  async startSelfDrill(
    @Body() body: { setUuid?: string; lessonUuid?: string | null },
    @Req() req: Request,
  ): Promise<DrillAssignmentDTO> {
    if (!body?.setUuid) {
      throw new BadRequestException('setUuid is required');
    }
    const studentId = await this.studentId(req);
    // Optional, unlike teacher-origin work: a student starting from a lesson's homework
    // names it so the drill appears there, while one starting from the drills menu has
    // no lesson to name.
    const lessonUuid = typeof body.lessonUuid === 'string' ? body.lessonUuid.trim() : '';
    return this.selfDrill.startSelfDrill(studentId, body.setUuid, lessonUuid || null);
  }

  /** Teacher-only. Staff role required — a student token is refused. */
  @Get('teacher/summary')
  async teacherSummary(@Req() req: Request): Promise<InternalTeacherAssignmentsResponse> {
    this.assertTeacher(req);
    const teacherId = await this.identity.resolveStudentId(req.authUser!.id);
    return this.assignments.listForTeacher(teacherId);
  }

  /**
   * One assignment, for the teacher who created it — this is what the wizard polls for
   * `generationProgress`.
   *
   * Declared last of the GETs: `:uuid` matches any single segment, so registering it
   * above `teacher/summary` or `teacher/students` would capture both as uuids.
   */
  @Get(':uuid')
  async getOne(
    @Param('uuid') uuid: string,
    @Req() req: Request,
  ): Promise<DrillAssignmentDTO> {
    this.assertTeacher(req);
    // Both id spaces: assignments created before the lesson-teacher fix carry the legacy
    // user id, newer ones carry the Teacher profile pk. Same person either way.
    const userId = await this.identity.resolveStudentId(req.authUser!.id);
    const lessonTeacherId = await this.teacherIdForAssignment(uuid);
    return this.teacherAssignments.getForTeacher(
      uuid,
      lessonTeacherId === null ? [userId] : [userId, lessonTeacherId],
    );
  }

  /**
   * One assignment's progress, for the teacher: every blank, its answer, whether the
   * student solved it, and the wrong answers they typed.
   *
   * Ownership accepts both id spaces, same as `getForTeacher`.
   */
  @Get('teacher/progress/:uuid')
  async teacherProgress(@Param('uuid') uuid: string, @Req() req: Request): Promise<unknown> {
    this.assertTeacher(req);
    const userId = await this.identity.resolveStudentId(req.authUser!.id);
    const lessonTeacherId = await this.teacherIdForAssignment(uuid);
    return this.teacherAssignments.progressForTeacher(
      uuid,
      lessonTeacherId === null ? [userId] : [userId, lessonTeacherId],
    );
  }

  /**
   * The error analysis for one completed assignment.
   *
   * Readable by the student who owns it and by the owning teacher (both id spaces, same
   * rule as `teacherProgress`). Returns `NOT_ANALYZED` rather than 404 when no run exists:
   * the drill may simply not be finished yet, and a 404 would make the student's page
   * render an error for a perfectly normal state.
   *
   * Every other status is passed through untouched. `NO_ERRORS` and `FAILED` must stay
   * distinguishable here — collapsing them is how a dead analyzer starts looking like a
   * flawless drill.
   */
  @Get(':uuid/analysis')
  async getAnalysis(@Param('uuid') uuid: string, @Req() req: Request): Promise<unknown> {
    const run = await this.analysis.getRunWithClusters(uuid);

    if (!run) {
      return {
        uuid: null,
        sourceAssignmentUuid: uuid,
        status: 'NOT_ANALYZED',
        errorMessage: null,
        attemptCount: 0,
        clusters: [],
      };
    }

    if (isTeacherUser(req.authUser)) {
      // Ownership is judged the same way `getOne`/`teacherProgress` judge it: the
      // assignment must be attributed to the caller's own legacy id, or to the lesson's
      // teacher. `getForTeacher` throws its own 404 when neither owns it — a 403 here
      // would confirm another teacher's assignment exists.
      const owners = await this.ownersOf(uuid, req);
      await this.teacherAssignments.getForTeacher(uuid, owners);
      return run;
    }

    const studentId = await this.identity.resolveStudentId(req.authUser!.id);
    if (run.studentId !== studentId) {
      // 404, not 403: a distinguishable error would confirm another student's
      // assignment exists.
      throw new NotFoundException('Drill assignment not found');
    }

    return run;
  }

  /**
   * One gap cluster.
   *
   * Readable by the student it belongs to — this is the theory shown above their remedial
   * drill, the same row the source drill renders below itself. Staff may read it too, but
   * ONLY the staff account that owns the gap's source assignment — a gap carries a named
   * student's wrong answers and the teaching written for them, which is not staff-wide
   * material. Scoped with `assertOwnsGap`, the same helper `updateGap`/`createRemedial`
   * use, rather than a bespoke check: it already resolves the gap's sourceAssignmentUuid,
   * applies `ownersOf` + `getForTeacher`, and 404s (never 403s) on a mismatch or a missing
   * gap, so this route inherits that behaviour instead of re-deriving it.
   *
   * Costs a second `getCluster` read on the staff path (`assertOwnsGap` loads the gap
   * again to read its `sourceAssignmentUuid`) — accepted deliberately: reusing the first
   * `cluster` here would mean duplicating `assertOwnsGap`'s ownership logic inline, which
   * is exactly the kind of second copy that drifts from the original. `updateGap` and
   * `createRemedial` already pay this same extra read.
   *
   * Declared here, beside `getAnalysis` and before the trailing `:uuid` catch-all: `gaps`
   * is a static first segment, so it cannot collide with `:uuid/analysis` or `:uuid`
   * either way, but keeping it in this group (rather than down with the `teacher/gaps/...`
   * routes) reads truer — this one is student-readable (plus the owning teacher), those
   * are staff-only.
   */
  @Get('gaps/:gapUuid')
  async getGap(@Param('gapUuid') gapUuid: string, @Req() req: Request): Promise<unknown> {
    const cluster = await this.analysis.getCluster(gapUuid);
    if (!cluster) {
      throw new NotFoundException('Gap analysis not found');
    }

    if (isTeacherUser(req.authUser)) {
      await this.assertOwnsGap(gapUuid, req);
      return cluster;
    }

    const studentId = await this.identity.resolveStudentId(req.authUser!.id);
    if (cluster.studentId !== studentId) {
      // 404, not 403: the same reasoning as everywhere else in this file — a
      // distinguishable error would confirm another student's gap exists.
      throw new NotFoundException('Gap analysis not found');
    }

    return cluster;
  }

  /**
   * Re-run a failed or stalled analysis. Staff only — it costs a model call.
   *
   * Ownership-scoped the same way `getAnalysis` scopes its staff branch: the assignment
   * must be attributed to the caller's own legacy id or to the lesson's teacher.
   * `getForTeacher` throws its own 404 when neither owns it — without this any staff
   * account could re-run (and overwrite, via `replaceClusters`) another teacher's gap
   * clusters, spending a model call that isn't theirs to spend. This route takes an
   * assignment uuid, not a gap uuid, so it mirrors `getAnalysis` directly rather than
   * going through `assertOwnsGap`.
   */
  @Post(':uuid/analysis/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async retryAnalysis(
    @Param('uuid') uuid: string,
    @Req() req: Request,
  ): Promise<{ queued: boolean }> {
    this.assertTeacher(req);
    await this.teacherAssignments.getForTeacher(uuid, await this.ownersOf(uuid, req));
    this.analysisJobs.enqueue(uuid);
    this.logger.log(`Analysis retry queued for assignment ${uuid}`);
    return { queued: true };
  }

  /**
   * A teacher's edit to the theory a student will read.
   *
   * Ownership-scoped the same way `getAnalysis` scopes staff access: the gap's
   * `sourceAssignmentUuid` must be attributed to the caller's own legacy id or to the
   * lesson's teacher. Without this any staff account could rewrite the explanation a
   * DIFFERENT teacher's student is about to read — this route mutates content, so an
   * unrelated teacher pasting the wrong gapUuid would silently corrupt someone else's
   * theory. 404, not 403: the same reasoning as everywhere else in this file — a
   * distinguishable error would confirm another teacher's gap exists.
   */
  @Patch('teacher/gaps/:gapUuid')
  @HttpCode(HttpStatus.OK)
  async updateGap(
    @Param('gapUuid') gapUuid: string,
    @Body()
    body: {
      title?: string;
      explanation?: string;
      rules?: string[];
      examples?: Array<{ text: string; gloss: string }>;
    },
    @Req() req: Request,
  ): Promise<unknown> {
    this.assertTeacher(req);

    if (body.explanation !== undefined && body.explanation.trim().length === 0) {
      throw new BadRequestException('explanation cannot be empty');
    }
    if (body.title !== undefined && body.title.trim().length === 0) {
      throw new BadRequestException('title cannot be empty');
    }

    await this.assertOwnsGap(gapUuid, req);

    const teacherId = await this.identity.resolveStudentId(req.authUser!.id);
    return this.analysis.updateCluster(gapUuid, body, teacherId);
  }

  /**
   * Create the "работа над ошибками" drill for one gap.
   *
   * Teacher-initiated: the analysis is automatic, the second assignment is a judgement
   * call. Idempotent — a second call returns the drill the first one made.
   *
   * Ownership-scoped for the same reason as `updateGap`: this route spends a model
   * generation call and assigns real work to a student, attributed to whichever staff
   * account called it. Unscoped, any teacher could assign — and be credited for —
   * remedial drilling for a student they never taught.
   */
  @Post('teacher/gaps/:gapUuid/remedial')
  @HttpCode(HttpStatus.CREATED)
  async createRemedial(
    @Param('gapUuid') gapUuid: string,
    @Req() req: Request,
  ): Promise<unknown> {
    this.assertTeacher(req);

    await this.assertOwnsGap(gapUuid, req);

    const teacherId = await this.identity.resolveStudentId(req.authUser!.id);
    return this.remedial.createForGap(gapUuid, teacherId, this.bearer(req));
  }

  /**
   * Confirms the caller owns the assignment a gap belongs to, using the exact rule
   * `getAnalysis` uses for its staff branch: `ownersOf` (the caller's own legacy id, plus
   * the lesson's teacher when there is one) checked through
   * `teacherAssignments.getForTeacher`, which already throws `NotFoundException` — never
   * `ForbiddenException` — on a mismatch or a missing assignment.
   *
   * A missing gap is 404 here directly: there is nothing to check ownership against, and
   * "gap not found" and "not yours" must look identical to the caller regardless.
   */
  private async assertOwnsGap(gapUuid: string, req: Request): Promise<void> {
    const gap = await this.analysis.getCluster(gapUuid);
    if (!gap) {
      throw new NotFoundException('Gap analysis not found');
    }
    const owners = await this.ownersOf(gap.sourceAssignmentUuid, req);
    await this.teacherAssignments.getForTeacher(gap.sourceAssignmentUuid, owners);
  }

  /**
   * A drill set with its answers, for the teacher review screen.
   *
   * Proxies content-service's `internal/drill-sets/:uuid`, which requires an
   * Auth RS256 service Bearer — a credential a browser cannot hold, so the review
   * screen 404'd against the public path.
   *
   * The route cannot simply be exposed on content-service: that service has no auth
   * guard, and the gateway validates a token without checking any role, so a public
   * prefix there would let any authenticated student read the answer bank. Here the
   * staff check happens first, and the service's own internal token is used for the
   * upstream hop.
   */
  @Get('teacher/sets/:setUuid')
  async teacherSet(
    @Param('setUuid') setUuid: string,
    @Req() req: Request,
  ): Promise<DrillSetDetailDTO> {
    this.assertTeacher(req);
    return this.sets.getSet(setUuid, this.bearer(req));
  }

  /**
   * Teacher edits to the sentences of a set awaiting review.
   *
   * Proxies content-service's internal item routes for the same reason as `teacherSet`:
   * those routes require an Auth RS256 service Bearer, which a browser cannot hold, and
   * content-service has no auth guard of its own — so the staff check must happen here,
   * before the internal hop.
   */
  @Patch('teacher/sets/:setUuid/items/:itemId')
  @HttpCode(HttpStatus.OK)
  async updateSetItem(
    @Param('setUuid') setUuid: string,
    @Param('itemId') itemId: string,
    @Body() body: { template?: string; hint?: string | null; validationState?: ValidationState },
    @Req() req: Request,
  ): Promise<DrillSetDetailDTO> {
    this.assertTeacher(req);
    return this.sets.updateSetItem(setUuid, this.assertItemId(itemId), body, this.bearer(req));
  }

  @Delete('teacher/sets/:setUuid/items/:itemId')
  @HttpCode(HttpStatus.OK)
  async deleteSetItem(
    @Param('setUuid') setUuid: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ): Promise<DrillSetDetailDTO> {
    this.assertTeacher(req);
    return this.sets.deleteSetItem(setUuid, this.assertItemId(itemId), this.bearer(req));
  }

  @Post('teacher/sets/:setUuid/items')
  @HttpCode(HttpStatus.CREATED)
  async addSetItem(
    @Param('setUuid') setUuid: string,
    @Body() body: { template?: string; hint?: string | null },
    @Req() req: Request,
  ): Promise<DrillSetDetailDTO> {
    this.assertTeacher(req);
    if (typeof body?.template !== 'string' || body.template.trim() === '') {
      throw new BadRequestException('template is required');
    }
    return this.sets.addSetItem(
      setUuid,
      { template: body.template, hint: body.hint ?? null },
      this.bearer(req),
    );
  }

  /**
   * Teacher edits to the sentences of a live assignment — work already in front of a
   * student, so these write education-service's own `DrillAssignmentItem` copies rather
   * than the set they were copied from.
   *
   * Ownership is the same rule as `teacherProgress`: the caller's own id, plus the
   * lesson's teacher when the assignment has a lesson.
   */
  @Patch('teacher/items/:itemUuid')
  @HttpCode(HttpStatus.OK)
  async updateAssignmentItem(
    @Param('itemUuid') itemUuid: string,
    @Body() body: { template?: string; hint?: string | null },
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    this.assertTeacher(req);
    if (body?.template === undefined && body?.hint === undefined) {
      // An empty patch would report success having changed nothing, which a teacher
      // reads as "my edit was saved".
      throw new BadRequestException('nothing to update: send template or hint');
    }
    await this.teacherAssignments.updateAssignmentItem(
      itemUuid,
      body,
      await this.ownersForItem(itemUuid, req),
    );
    return { ok: true };
  }

  @Delete('teacher/items/:itemUuid')
  @HttpCode(HttpStatus.OK)
  async deleteAssignmentItem(
    @Param('itemUuid') itemUuid: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    this.assertTeacher(req);
    await this.teacherAssignments.deleteAssignmentItem(
      itemUuid,
      await this.ownersForItem(itemUuid, req),
    );
    return { ok: true };
  }

  @Post('teacher/:uuid/items')
  @HttpCode(HttpStatus.CREATED)
  async addAssignmentItem(
    @Param('uuid') uuid: string,
    @Body() body: { template?: string; hint?: string | null },
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    this.assertTeacher(req);
    if (typeof body?.template !== 'string' || body.template.trim() === '') {
      throw new BadRequestException('template is required');
    }
    await this.teacherAssignments.addAssignmentItem(
      uuid,
      { template: body.template, hint: body.hint ?? null },
      await this.ownersOf(uuid, req),
    );
    return { ok: true };
  }

  private assertItemId(raw: string): number {
    const id = Number(raw);
    if (!Number.isInteger(id)) {
      throw new BadRequestException('numeric itemId is required');
    }
    return id;
  }

  /**
   * The teacher ids allowed to act on an assignment: the caller's own legacy id, plus
   * the lesson's teacher when there is one. Identical to `teacherProgress`'s rule — an
   * assignment attributed to the lesson teacher must stay editable by them.
   */
  private async ownersOf(assignmentUuid: string, req: Request): Promise<number[]> {
    const userId = await this.identity.resolveStudentId(req.authUser!.id);
    const lessonTeacherId = await this.teacherIdForAssignment(assignmentUuid);
    return lessonTeacherId === null ? [userId] : [userId, lessonTeacherId];
  }

  /** Same, for a route addressed by sentence rather than by assignment. */
  private async ownersForItem(itemUuid: string, req: Request): Promise<number[]> {
    const assignmentUuid = await this.teacherAssignments.assignmentUuidForItem(itemUuid);
    if (!assignmentUuid) {
      throw new NotFoundException('Drill sentence not found');
    }
    return this.ownersOf(assignmentUuid, req);
  }

  /**
   * The id to attribute an assignment to.
   *
   * `Lesson.teacherId` is the legacy **Teacher profile pk** (182 for the user whose auth
   * id resolves to 3), so storing `resolveStudentId`'s answer made
   * `DrillAssignment.teacherId` mean something different from the identically-named
   * column on Lesson — two id spaces in one database.
   *
   * When a lesson is named it is authoritative and needs no cross-database mapping.
   * Without one there is nothing to read the profile pk from, so the previous behaviour
   * stands rather than guessing: `employees_teacher` lives in the portal's database,
   * which this service cannot reach.
   */
  /**
   * Teacher-origin work is created *within* a lesson, and this is where that is
   * enforced.
   *
   * A teacher assigns drilling from a lesson page: the student roster itself is
   * lesson-scoped (`roster.listForLesson`), so with no lesson there is no principled
   * set of students to assign to. Attribution is the sharper problem — without a
   * lesson, `resolveTeacherId` used to fall back to the caller's legacy user id, which
   * writes a different numbering space into `teacher_id` than the Teacher profile pk
   * every other row holds. `teacherIdForAssignment` then derives the teacher from the
   * lesson, finds none, and the ownership check that accepts "the lesson's teacher" has
   * nothing to match against.
   *
   * Hiding the wizard is not this gate. Track J's legacy portal and a hand-crafted POST
   * both reach these methods directly.
   *
   * SELF origin is deliberately out of scope: a student practising from the drills menu
   * has no lesson, and `startSelfDrill` has its own gates.
   */
  private assertLesson(lessonUuid: unknown): string {
    const value = typeof lessonUuid === 'string' ? lessonUuid.trim() : '';
    if (!value) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LESSON_REQUIRED',
        message: 'Choose a lesson before assigning drilling',
      });
    }
    return value;
  }

  private async resolveTeacherId(req: Request, lessonUuid: string | null): Promise<number> {
    if (lessonUuid) {
      const scoped = await this.roster.listForLesson(lessonUuid);
      if (scoped.teacherId) {
        return scoped.teacherId;
      }
      this.logger.warn(
        `Lesson ${lessonUuid} records no teacher; attributing to the caller's legacy user id`,
      );
    }
    return this.identity.resolveStudentId(req.authUser!.id);
  }

  /**
   * The Teacher profile pk recorded on the assignment's lesson, if it has one. Lets
   * ownership accept an assignment attributed to the lesson teacher as well as one
   * attributed to the caller's legacy user id.
   */
  private async teacherIdForAssignment(assignmentUuid: string): Promise<number | null> {
    const lessonUuid = await this.teacherAssignments.lessonUuidFor(assignmentUuid);
    if (!lessonUuid) {
      return null;
    }
    const scoped = await this.roster.listForLesson(lessonUuid);
    return scoped.teacherId ?? null;
  }

  /**
   * Approve a set, for the teacher review screen.
   *
   * Proxies content-service's `internal/drill-sets/:uuid/approve`, which requires an
   * Auth RS256 service Bearer — the browser called the public path and got a bare 404
   * with nothing on screen.
   *
   * That route trusts `teacherId` from its body outright, so the value comes from this
   * service's own resolution of the caller. Accepting it from the browser would let a
   * teacher approve a set in someone else's name.
   */
  @Post('teacher/sets/:setUuid/approve')
  @HttpCode(HttpStatus.OK)
  async approveSet(@Param('setUuid') setUuid: string, @Req() req: Request): Promise<unknown> {
    this.assertTeacher(req);
    const teacherId = await this.identity.resolveStudentId(req.authUser!.id);
    this.logger.log(`Approving set ${setUuid} for teacher ${teacherId}`);
    const approved = await this.sets.approveSet(setUuid, teacherId, this.bearer(req));

    // Approve also assigns. Generation creates the assignment rows and leaves the
    // sentences on the set, so without this the teacher approved, saw success, and the
    // student received an assignment with no items — or never saw it at all, because a
    // PENDING_REVIEW row is not in their list.
    //
    // Strictly after approval: delivering a drill from a set that failed to approve
    // would put unreviewed sentences in front of a student.
    const delivered = await this.teacherAssignments.assignApprovedSet(
      setUuid,
      teacherId,
      this.bearer(req),
    );
    this.logger.log(`Set ${setUuid} approved and delivered to ${delivered} assignment(s)`);

    return approved;
  }

  /**
   * Every teacher-facing drills route starts here.
   *
   * `isTeacherUser`, not `isStaffUser`: until 2026-08-24 these routes required staff,
   * and auth-microservice issued no teacher role at all, so every real teacher — all
   * 378 of them, holding `app:speakasap:user` exactly like a student — got a 403 from
   * `GET teacher/students` and the wizard showed "Request failed with status 403" over
   * an empty roster. The feature only ever worked for admins.
   *
   * This proves the caller is a teacher, not that the lesson or set is theirs. Routes
   * that can name an owner still check one (`getForTeacher`, `ownersOf`, `assertOwnsGap`);
   * `teacher/students` cannot, and is lesson-scoped only.
   */
  private assertTeacher(req: Request): void {
    if (!isTeacherUser(req.authUser)) {
      throw new ForbiddenException('Teacher access required');
    }
  }

  private async studentId(req: Request): Promise<number> {
    return this.identity.resolveStudentId(req.authUser!.id);
  }

  /**
   * The caller's bearer token, forwarded to content-service and ai-microservice.
   *
   * The generation pipeline calls both on the teacher's behalf, and `GenerationJob.token`
   * is that credential. Taken from the header the guard already validated rather than
   * substituting a service token: the upstream routes that carry answers additionally
   * require a service Bearer, which the clients add themselves, so forwarding the
   * teacher's token keeps the request attributable without widening what it can reach.
   */
  private bearer(req: Request): string {
    const header = req.headers?.authorization ?? '';
    return header.startsWith('Bearer ') ? header.slice(7) : '';
  }
}
