import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DrillsController } from './drills.controller';
import { InternalDrillsController } from './internal-drills.controller';

const student = (id: string) => ({ id, email: null, firstName: null, lastName: null, phone: null, userType: 'student' });
const staff = () => ({ id: 't-1', email: null, firstName: null, lastName: null, phone: null, userType: 'staff' });

const req = (user: any) => ({ authUser: user }) as any;

function harness() {
  const runner: any = { check: jest.fn(async () => ({ correct: true, acceptedText: 'auf', attemptNo: 1, blanksCorrect: 1, blanksTotal: 2, assignmentCompleted: false })) };
  const selfDrill: any = { startSelfDrill: jest.fn(async () => ({ uuid: 'a-new' })) };
  const assignments: any = {
    getRunner: jest.fn(async () => ({
      assignment: { uuid: 'a-1', studentId: 42 },
      items: [{ uuid: 'i-1', order: 0, segments: [], blanks: [{ index: 0, prompt: 'на', maxLength: 9, solved: false, solvedText: null }], hint: null }],
    })),
    listForStudent: jest.fn(async () => ({ outstanding: [], completedRecent: [], selfDrillingAllowed: true })),
    listForTeacher: jest.fn(async () => ({ awaitingReview: 0, assigned: 0, completedThisWeek: 0, reviewQueue: [] })),
    listForLesson: jest.fn(async () => ({ assignments: [] })),
  };
  const identity: any = { resolveStudentId: jest.fn(async () => 42) };
  const teacherAssignments: any = {
    generate: jest.fn(async () => ({ assignmentUuids: ['a-1'], setUuid: 's-1', batchUuid: 'b-1' })),
    assignFromSet: jest.fn(async () => ({ assignments: [] })),
    getForTeacher: jest.fn(async () => ({ uuid: 'a-1' })),
    lessonUuidFor: jest.fn(async () => null),
    assignApprovedSet: jest.fn(async () => 1),
    revokeAssignment: jest.fn(async () => undefined),
    assignmentUuidForItem: jest.fn(async () => 'a-1'),
    updateAssignmentItem: jest.fn(async () => undefined),
    deleteAssignmentItem: jest.fn(async () => undefined),
    addAssignmentItem: jest.fn(async () => undefined),
  };
  const roster: any = {
    listForTeacher: jest.fn(async () => ({ students: [], groups: [] })),
    listForLesson: jest.fn(async () => ({ students: [], groups: [], total: 0, hasMore: false, teacherId: 182 })),
  };
  const sets: any = {
    getSet: jest.fn(async () => ({ uuid: 's-1', title: 'Present perfect', items: [] })),
    approveSet: jest.fn(async () => ({ uuid: 's-1', reviewState: 'APPROVED' })),
    updateSetItem: jest.fn(async () => ({ uuid: 's-1', items: [] })),
    deleteSetItem: jest.fn(async () => ({ uuid: 's-1', items: [] })),
    addSetItem: jest.fn(async () => ({ uuid: 's-1', items: [] })),
  };

  return {
    controller: new DrillsController(
      runner,
      selfDrill,
      assignments,
      identity,
      teacherAssignments,
      roster,
      sets,
      {} as any,
      {} as any,
      {} as any,
    ),
    internal: new InternalDrillsController(assignments, teacherAssignments, sets),
    runner,
    selfDrill,
    assignments,
    identity,
    teacherAssignments,
    roster,
    sets,
  };
}

describe('DrillsController', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  describe('GET runner', () => {
    it('is reachable by the owning student', async () => {
      const res = await h.controller.getRunner('a-1', req(student('u-42')));
      expect(res.items).toHaveLength(1);
    });

    it('is NOT reachable by another student', async () => {
      h.identity.resolveStudentId.mockResolvedValue(999);
      h.assignments.getRunner.mockRejectedValue(new NotFoundException('Drill assignment not found'));
      await expect(h.controller.getRunner('a-1', req(student('u-999')))).rejects.toThrow(NotFoundException);
    });

    // Repeated at the HTTP layer on purpose: the projection tests prove the
    // projection is clean, not that the controller did not add fields back.
    it('returns no answer anywhere in the response', async () => {
      const res = await h.controller.getRunner('a-1', req(student('u-42')));
      const json = JSON.stringify(res);
      expect(json).not.toContain('"answer"');
      expect(json).not.toContain('alternatives');
    });
  });

  describe('POST self', () => {
    it('surfaces the C7 409 body including blockingAssignmentUuid', async () => {
      const err: any = new Error('conflict');
      err.response = {
        statusCode: 409,
        code: 'ASSIGNMENT_OUTSTANDING',
        message: 'Finish the drilling your teacher assigned before starting your own',
        blockingAssignmentUuid: 'blocking-1',
      };
      h.selfDrill.startSelfDrill.mockRejectedValue(err);
      await expect(h.controller.startSelfDrill({ setUuid: 's-1' }, req(student('u-42')))).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ASSIGNMENT_OUTSTANDING',
          blockingAssignmentUuid: 'blocking-1',
        }),
      });
    });
  });

  describe('teacher-only routes', () => {
    it('reject a student-role token', async () => {
      await expect(h.controller.teacherSummary(req(student('u-42')))).rejects.toThrow(ForbiddenException);
    });

    it('allow a staff token', async () => {
      await expect(h.controller.teacherSummary(req(staff()))).resolves.toBeDefined();
    });
  });
});

describe('InternalDrillsController', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  it('is declared behind InternalAuthGuard', () => {
    const guards = Reflect.getMetadata('__guards__', InternalDrillsController) ?? [];
    const names = guards.map((g: any) => g.name ?? g.constructor?.name);
    expect(names).toContain('InternalAuthGuard');
  });

  // Track J renders the legacy dashboard from this flag. If it disagrees with
  // the gate, the portal offers a button that 409s.
  it('reports selfDrillingAllowed false when an assignment is outstanding', async () => {
    h.assignments.listForStudent.mockResolvedValue({
      outstanding: [{ uuid: 'a-1', status: 'ASSIGNED' }],
      completedRecent: [],
      selfDrillingAllowed: false,
    });
    const res = await h.internal.byStudent('42');
    expect(res.selfDrillingAllowed).toBe(false);
    expect(res.outstanding).toHaveLength(1);
  });

  it('reports selfDrillingAllowed true when nothing is outstanding', async () => {
    const res = await h.internal.byStudent('42');
    expect(res.selfDrillingAllowed).toBe(true);
  });

  it('rejects a non-numeric studentId', async () => {
    await expect(h.internal.byStudent('abc')).rejects.toThrow(/studentId/i);
  });
});

describe('DrillsController — teacher write routes', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  const withToken = (user: any) =>
    ({ authUser: user, headers: { authorization: 'Bearer tok-123' } }) as any;

  // Teacher-origin work is created *within* a lesson: the roster is lesson-scoped, and
  // without a lesson `resolveTeacherId` falls back to the caller's legacy user id, which
  // writes a different numbering space into `teacher_id` than every other row holds.
  // `teacherIdForAssignment` then derives the teacher from the lesson and finds none, so
  // the ownership check has nothing to match. The UI disabling a button is not this gate:
  // the legacy portal and a hand-crafted POST both reach these methods.
  describe('the lesson requirement for teacher-origin work', () => {
    it('refuses generate with no lesson', async () => {
      await expect(h.controller.generate({ count: 50 } as any, withToken(staff()))).rejects.toMatchObject(
        { response: { code: 'LESSON_REQUIRED' } },
      );
      expect(h.teacherAssignments.generate).not.toHaveBeenCalled();
    });

    it('refuses generate with an explicitly null lesson', async () => {
      await expect(
        h.controller.generate({ count: 50, lessonUuid: null } as any, withToken(staff())),
      ).rejects.toMatchObject({ response: { code: 'LESSON_REQUIRED' } });
      expect(h.teacherAssignments.generate).not.toHaveBeenCalled();
    });

    it('refuses assign with no lesson', async () => {
      await expect(
        h.controller.assign({ setUuid: 's-1', studentIds: [7] } as any, withToken(staff())),
      ).rejects.toMatchObject({ response: { code: 'LESSON_REQUIRED' } });
      expect(h.teacherAssignments.assignFromSet).not.toHaveBeenCalled();
    });

    it('refuses a blank lesson uuid rather than treating it as present', async () => {
      await expect(
        h.controller.generate({ count: 50, lessonUuid: '   ' } as any, withToken(staff())),
      ).rejects.toMatchObject({ response: { code: 'LESSON_REQUIRED' } });
      expect(h.teacherAssignments.generate).not.toHaveBeenCalled();
    });

    it('allows generate once a lesson is given', async () => {
      const res = await h.controller.generate(
        { count: 50, lessonUuid: 'l-1' } as any,
        withToken(staff()),
      );
      expect(res.assignmentUuids).toEqual(['a-1']);
    });
  });

  describe('POST generate', () => {
    it('queues generation for a staff caller', async () => {
      const res = await h.controller.generate(
        { count: 50, lessonUuid: 'l-1' } as any,
        withToken(staff()),
      );
      expect(res.assignmentUuids).toEqual(['a-1']);
      // 182, not the caller's 42: with a lesson present the teacher comes from the
      // lesson's own record.
      expect(h.teacherAssignments.generate).toHaveBeenCalledWith(
        182,
        { count: 50, lessonUuid: 'l-1' },
        'tok-123',
      );
    });

    // A student token reaching this route creates teacher-origin homework for anyone.
    it('is refused for a student', async () => {
      await expect(
        h.controller.generate({ count: 50, lessonUuid: 'l-1' } as any, withToken(student('u-42'))),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.teacherAssignments.generate).not.toHaveBeenCalled();
    });

    it('forwards an empty token rather than the literal header when it is absent', async () => {
      await h.controller.generate(
        { count: 50, lessonUuid: 'l-1' } as any,
        { authUser: staff(), headers: {} } as any,
      );
      expect(h.teacherAssignments.generate.mock.calls[0][2]).toBe('');
    });

    it('does not treat a non-Bearer scheme as a token', async () => {
      await h.controller.generate(
        { count: 50, lessonUuid: 'l-1' } as any,
        { authUser: staff(), headers: { authorization: 'Basic abc' } } as any,
      );
      expect(h.teacherAssignments.generate.mock.calls[0][2]).toBe('');
    });
  });

  describe('POST assign', () => {
    it('assigns for a staff caller', async () => {
      await h.controller.assign(
        { setUuid: 's-1', studentIds: [7], lessonUuid: 'l-1' } as any,
        withToken(staff()),
      );
      // 182, not the caller's 42: with a lesson present the teacher comes from the
      // lesson's own record.
      expect(h.teacherAssignments.assignFromSet).toHaveBeenCalledWith(
        182,
        { setUuid: 's-1', studentIds: [7], lessonUuid: 'l-1' },
        'tok-123',
      );
    });

    it('is refused for a student', async () => {
      await expect(
        h.controller.assign({ setUuid: 's-1' } as any, withToken(student('u-42'))),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.teacherAssignments.assignFromSet).not.toHaveBeenCalled();
    });
  });

  describe('GET :uuid', () => {
    it('returns the assignment for its teacher', async () => {
      const res = await h.controller.getOne('a-1', withToken(staff()));
      expect(res).toMatchObject({ uuid: 'a-1' });
      // An array now: ownership accepts the legacy user id and the lesson's Teacher pk.
    expect(h.teacherAssignments.getForTeacher).toHaveBeenCalledWith('a-1', [42]);
    });

    it('is refused for a student', async () => {
      await expect(
        h.controller.getOne('a-1', withToken(student('u-42'))),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('GET teacher/students', () => {
    it('returns the roster for a staff caller who names a lesson', async () => {
      await expect(
        h.controller.teacherStudents(withToken(staff()), undefined, undefined, undefined, 'l-1'),
      ).resolves.toEqual({ students: [], groups: [], total: 0, hasMore: false });
    });

    /**
     * The unscoped roster was served from `prisma.lesson`, a COPY of the portal's tables
     * frozen since 2026-06-26. It answered "no lessons" for any teacher whose work is
     * newer with an empty roster and a warning-level log — a teacher reads that as
     * "I have no students". The lesson-scoped path is the only one with a real source,
     * so omitting the lesson is now refused rather than answered from stale data.
     */
    it('passes the course language through so the wizard can scope its topics', async () => {
      // The teacher's Lesson.teacherId stays internal, but the language must reach the
      // client: without it the wizard fell back to hardcoded German.
      h.roster.listForLesson.mockResolvedValue({
        students: [], groups: [], total: 0, hasMore: false,
        teacherId: 182, languageCode: 'en', materialLanguage: 'ru',
      });

      const res: any = await h.controller.teacherStudents(
        withToken(staff()), undefined, undefined, undefined, 'l-1');

      expect(res.languageCode).toBe('en');
      expect(res.materialLanguage).toBe('ru');
      expect(res.teacherId).toBeUndefined();
    });

    it('refuses an unscoped roster instead of serving one from frozen tables', async () => {
      await expect(h.controller.teacherStudents(withToken(staff()))).rejects.toMatchObject({
        response: { code: 'LESSON_REQUIRED' },
      });
    });

    it('is refused for a student', async () => {
      await expect(
        h.controller.teacherStudents(withToken(student('u-42'))),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // `:uuid` matches any single segment, so route declaration order is what keeps
  // `teacher/summary` and `teacher/students` from being read as assignment uuids.
  it('declares the static teacher routes before the :uuid catch-all', () => {
    const proto = Object.getPrototypeOf(h.controller);
    const names = Object.getOwnPropertyNames(proto);
    expect(names.indexOf('teacherStudents')).toBeLessThan(names.indexOf('getOne'));
    expect(names.indexOf('teacherSummary')).toBeLessThan(names.indexOf('getOne'));
    expect(names.indexOf('generate')).toBeLessThan(names.indexOf('getOne'));
  });

  /**
   * The review screen needs a set WITH answers — that is what reviewing is. Those live on
   * content-service behind `internal/drill-sets/:uuid`, which the gateway gates on
   * `x-internal-token`, a credential no browser may hold. So the teacher screen 404'd.
   *
   * It cannot simply be made public on content-service: that service has no auth guard
   * and the gateway validates a token without checking any role, so a public prefix there
   * would let any authenticated student harvest the answer bank. Proxying through this
   * controller adds the staff check the other path lacks.
   */
  describe('teacherSet', () => {
    it('returns the set with its answers for a staff caller', async () => {
      const h = harness();

      const result = await h.controller.teacherSet('s-1', req(staff()));

      expect(h.sets.getSet).toHaveBeenCalledWith('s-1', expect.anything());
      expect(result).toMatchObject({ uuid: 's-1' });
    });

    it('refuses a student, who must never read the answer bank', async () => {
      const h = harness();

      await expect(h.controller.teacherSet('s-1', req(student('u-42')))).rejects.toThrow(
        ForbiddenException,
      );
      expect(h.sets.getSet).not.toHaveBeenCalled();
    });
  });

  /**
   * `Lesson.teacherId` is the legacy **Teacher profile pk** (182); `resolveStudentId`
   * returns the **user id** (3). Storing the user id in `DrillAssignment.teacherId` made
   * that column mean something different from the identically-named one on Lesson — two
   * id spaces in one database, waiting to be joined by accident.
   *
   * When the request names a lesson, the teacher is taken from the lesson itself, which
   * is authoritative and needs no cross-database mapping.
   */
  describe('teacher id on the write path', () => {
    it('attributes a generated assignment to the lesson teacher, not the user id', async () => {
      const h = harness();

      await h.controller.generate(
        { studentIds: [3], lessonUuid: 'l-1', topics: [], instructions: '', count: 3 } as any,
        req(staff()),
      );

      expect(h.roster.listForLesson).toHaveBeenCalledWith('l-1');
      expect(h.teacherAssignments.generate).toHaveBeenCalledWith(
        182,
        expect.anything(),
        expect.anything(),
      );
    });

    // Replaces "falls back to the resolved user id when no lesson is named". That
    // fallback wrote the caller's legacy user id into `teacher_id`, a different
    // numbering space from the Teacher profile pk every other row holds. It is now
    // unreachable for teacher-origin work: the request is refused before it.
    it('refuses rather than falling back to the caller id when no lesson is named', async () => {
      const h = harness();

      await expect(
        h.controller.generate(
          { studentIds: [3], lessonUuid: null, topics: [], instructions: '', count: 3 } as any,
          req(staff()),
        ),
      ).rejects.toMatchObject({ response: { code: 'LESSON_REQUIRED' } });

      expect(h.roster.listForLesson).not.toHaveBeenCalled();
      expect(h.teacherAssignments.generate).not.toHaveBeenCalled();
    });

    it('falls back when the lesson has no teacher recorded', async () => {
      const h = harness();
      h.roster.listForLesson.mockResolvedValue({
        students: [], groups: [], total: 0, hasMore: false, teacherId: null,
      });

      await h.controller.generate(
        { studentIds: [3], lessonUuid: 'l-1', topics: [], instructions: '', count: 3 } as any,
        req(staff()),
      );

      expect(h.teacherAssignments.generate).toHaveBeenCalledWith(
        42,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  /**
   * Approve lived at content-service's `internal/drill-sets/:uuid/approve`, gated by the
   * gateway on a token no browser holds — clicking Approve produced a bare 404 in the
   * console and nothing on screen.
   *
   * It also trusts `teacherId` from the request body outright, so that value must come
   * from the server's own resolution of the caller, never from the browser.
   */
  describe('approveSet', () => {
    it('approves for a staff caller, attributing to the resolved teacher', async () => {
      const h = harness();

      await h.controller.approveSet('s-1', req(staff()));

      expect(h.sets.approveSet).toHaveBeenCalledWith('s-1', 42, expect.anything());
    });

    it('refuses a student', async () => {
      const h = harness();

      await expect(h.controller.approveSet('s-1', req(student('u-9')))).rejects.toThrow(
        ForbiddenException,
      );
      expect(h.sets.approveSet).not.toHaveBeenCalled();
    });

    // Approving used to stop at the set, leaving the assignments it came from in
    // PENDING_REVIEW with no items — the teacher saw success and the student got nothing.
    it('delivers the set to the students it was generated for', async () => {
      const h = harness();

      await h.controller.approveSet('s-1', req(staff()));

      expect(h.teacherAssignments.assignApprovedSet).toHaveBeenCalledWith(
        's-1', 42, expect.anything(),
      );
    });

    it('assigns only after the set is approved, never before', async () => {
      const h = harness();
      const order: string[] = [];
      h.sets.approveSet.mockImplementation(async () => { order.push('approve'); return {}; });
      h.teacherAssignments.assignApprovedSet.mockImplementation(async () => { order.push('assign'); return 1; });

      await h.controller.approveSet('s-1', req(staff()));

      expect(order).toEqual(['approve', 'assign']);
    });
  });

/**
 * The portal's write routes.
 *
 * `InternalTokenGuard` proves the *portal* is calling, not which teacher — the token is
 * one shared service credential. So these take the acting teacher explicitly and the
 * service verifies ownership: without that, anyone holding the internal token could
 * revoke any teacher's assignment.
 */
describe('InternalDrillsController write routes', () => {
  it('revokes an assignment for the teacher the portal names', async () => {
    const h = harness();

    await h.internal.revoke('a-1', { teacherId: 182 } as any);

    expect(h.teacherAssignments.revokeAssignment).toHaveBeenCalledWith('a-1', [182]);
  });

  it('rejects a missing teacherId rather than revoking unattributed', async () => {
    const h = harness();

    await expect(h.internal.revoke('a-1', {} as any)).rejects.toThrow(/teacherId/);
    expect(h.teacherAssignments.revokeAssignment).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric teacherId', async () => {
    const h = harness();

    await expect(h.internal.revoke('a-1', { teacherId: 'x' } as any)).rejects.toThrow(/teacherId/);
    expect(h.teacherAssignments.revokeAssignment).not.toHaveBeenCalled();
  });

  it('approves and assigns for the teacher the portal names', async () => {
    const h = harness();
    process.env.EDUCATION_TO_CONTENT_SERVICE_TOKEN = 'rs256-edu-to-content';

    await h.internal.approve('s-1', { teacherId: 182 } as any);

    expect(h.sets.approveSet).toHaveBeenCalledWith('s-1', 182, 'rs256-edu-to-content');
    expect(h.teacherAssignments.assignApprovedSet).toHaveBeenCalledWith(
      's-1',
      182,
      'rs256-edu-to-content',
    );
  });
});
});
