import { LessonClientService } from './lesson-client.service';
import { LessonNotFoundError, LessonServiceUnavailableError } from './lesson-client.types';

const LESSON = 'f249c6e4-e6ef-451d-a1b0-c4fb0a3b4477';

const LESSON_BODY = {
  uuid: LESSON,
  order: 3,
  teacher_id: 182,
  start: '2026-08-12T17:00:00+02:00',
  is_finished: false,
  student_course_uuid: '43c00027-cf75-4d60-8775-da38dea408a1',
  module_class: 'course_materials.data.ru.en._basic_s.Module3T',
  needs_teacher: false,
  recommendation: 'r',
  to_manager: 'm',
};

function serviceWith(
  fetchImpl: jest.Mock,
  overrides: { baseUrl?: string; token?: string } = {},
): LessonClientService {
  const service = new LessonClientService();
  const internals = service as unknown as {
    fetchFn: unknown;
    baseUrl: string;
    token: string;
  };
  internals.fetchFn = fetchImpl;
  internals.baseUrl = overrides.baseUrl === undefined ? 'http://portal.test' : overrides.baseUrl;
  internals.token = overrides.token === undefined ? 'secret-token' : overrides.token;
  return service;
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
}

describe('LessonClientService', () => {
  // The ceiling for self-drilling and remedial drills, which hold no lesson and so
  // cannot take it from one. education-service used to compute this from its own copies
  // of the portal's tables; 0853b09 dropped them and every such generation then threw
  // `Cannot read properties of undefined (reading 'findFirst')`.
  describe('getStudentProgress', () => {
    const PROGRESS_BODY = {
      student_id: 42,
      course_key: 'course_materials.data.ru.en._10r.Course',
      lesson_order: 7,
    };

    it('camelizes a progress payload', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse(PROGRESS_BODY));
      const progress = await serviceWith(fetchFn).getStudentProgress(42);

      expect(progress).toEqual({
        courseKey: 'course_materials.data.ru.en._10r.Course',
        lessonOrder: 7,
      });
    });

    it('asks the portal for that student', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse(PROGRESS_BODY));
      await serviceWith(fetchFn).getStudentProgress(42);

      expect(String(fetchFn.mock.calls[0][0])).toBe(
        'http://portal.test/students/42/progress/',
      );
      expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-token');
    });

    // "No active course" is a real answer, and the caller generates without a ceiling.
    // It must not be confused with a failed lookup, which raises.
    it('passes through nulls for a student with no active course', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        okResponse({ student_id: 42, course_key: null, lesson_order: null }),
      );
      const progress = await serviceWith(fetchFn).getStudentProgress(42);

      expect(progress).toEqual({ courseKey: null, lessonOrder: null });
    });

    // Zero is a real lesson order, not an absent one.
    it('keeps a zero lesson order', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        okResponse({ student_id: 42, course_key: 'c', lesson_order: 0 }),
      );
      const progress = await serviceWith(fetchFn).getStudentProgress(42);

      expect(progress.lessonOrder).toBe(0);
    });

    // Deliberately NOT fail-soft, like every other read here. A silent null ceiling
    // would widen the drill bank to material the student has not reached.
    it('raises LessonServiceUnavailableError when the portal is down', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' },
      );
      await expect(serviceWith(fetchFn).getStudentProgress(42))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });

    it('raises LessonServiceUnavailableError when the transport throws', async () => {
      const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(serviceWith(fetchFn).getStudentProgress(42))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });
  });

  describe('getLesson', () => {
    it('camelizes a lesson payload', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse(LESSON_BODY));
      const lesson = await serviceWith(fetchFn).getLesson(LESSON);

      expect(lesson.teacherId).toBe(182);
      expect(lesson.studentCourseUuid).toBe('43c00027-cf75-4d60-8775-da38dea408a1');
      expect(lesson.moduleClass).toBe('course_materials.data.ru.en._basic_s.Module3T');
      expect(lesson.isFinished).toBe(false);
      expect(lesson.toManager).toBe('m');
    });

    it('preserves a null teacher rather than coercing it to 0', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        okResponse({ ...LESSON_BODY, teacher_id: null }));
      const lesson = await serviceWith(fetchFn).getLesson(LESSON);
      expect(lesson.teacherId).toBeNull();
    });

    it('sends Authorization Bearer (Auth pair JWT)', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse(LESSON_BODY));
      await serviceWith(fetchFn).getLesson(LESSON);

      const headers = fetchFn.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer secret-token');
      expect(headers['x-internal-token']).toBeUndefined();
    });

    it('raises LessonNotFoundError on 404', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        { ok: false, status: 404, text: async () => '' });
      await expect(serviceWith(fetchFn).getLesson(LESSON))
        .rejects.toBeInstanceOf(LessonNotFoundError);
    });

    it('raises LessonServiceUnavailableError on 500', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        { ok: false, status: 500, text: async () => 'boom' });
      await expect(serviceWith(fetchFn).getLesson(LESSON))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });

    it('raises LessonServiceUnavailableError on 401, not LessonNotFoundError', async () => {
      // A bad token must not read as "this lesson does not exist".
      const fetchFn = jest.fn().mockResolvedValue(
        { ok: false, status: 401, text: async () => '' });
      await expect(serviceWith(fetchFn).getLesson(LESSON))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });

    it('raises LessonServiceUnavailableError when the transport throws', async () => {
      const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(serviceWith(fetchFn).getLesson(LESSON))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });

    it('raises when the response is not JSON', async () => {
      const fetchFn = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new Error('Unexpected token <'); },
      });
      await expect(serviceWith(fetchFn).getLesson(LESSON))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });

    it('raises when the base url is unconfigured', async () => {
      const fetchFn = jest.fn();
      await expect(serviceWith(fetchFn, { baseUrl: '' }).getLesson(LESSON))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('raises when the token is unconfigured', async () => {
      const fetchFn = jest.fn();
      await expect(serviceWith(fetchFn, { token: '' }).getLesson(LESSON))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe('getRoster', () => {
    it('camelizes a roster payload and keeps paid students separate', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse({
        lesson_uuid: LESSON,
        teacher_id: 182,
        groups: [{ uuid: 'g-1', name: 'Group A', student_ids: [3, 7] }],
        student_ids: [3, 7],
        paid_student_ids: [3],
      }));

      const roster = await serviceWith(fetchFn).getRoster(LESSON);

      expect(roster.teacherId).toBe(182);
      expect(roster.studentIds).toEqual([3, 7]);
      expect(roster.paidStudentIds).toEqual([3]);
      expect(roster.groups[0].studentIds).toEqual([3, 7]);
    });

    it('carries the portal-supplied names', async () => {
      // auth-microservice only knows users migrated up to legacy id 314012, so a student
      // who registered after that resolves to no name and renders as "Student <id>".
      // The portal knows every student, so its names are the fallback.
      const fetchFn = jest.fn().mockResolvedValue(okResponse({
        lesson_uuid: LESSON,
        teacher_id: 182,
        groups: [{ uuid: 'g-1', name: 'Group A', student_ids: [314082] }],
        student_ids: [314082],
        paid_student_ids: [314082],
        students: [{ id: 314082, name: 'Tetiana Kovach' }],
      }));

      const roster = await serviceWith(fetchFn).getRoster(LESSON);

      expect(roster.names.get(314082)).toBe('Tetiana Kovach');
    });

    it('yields an empty name map when the portal sends no names', async () => {
      // An older portal has no `students` key. That must mean "no names to offer",
      // never a crash and never a fabricated name.
      const fetchFn = jest.fn().mockResolvedValue(okResponse({
        lesson_uuid: LESSON,
        teacher_id: 182,
        groups: [],
        student_ids: [3],
        paid_student_ids: [],
      }));

      const roster = await serviceWith(fetchFn).getRoster(LESSON);

      expect(roster.names.size).toBe(0);
    });

    it('NEVER returns an empty roster in place of an error', async () => {
      const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(serviceWith(fetchFn).getRoster(LESSON)).rejects.toThrow();
    });

    it('propagates a 404 as LessonNotFoundError, not an empty roster', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        { ok: false, status: 404, text: async () => '' });
      await expect(serviceWith(fetchFn).getRoster(LESSON))
        .rejects.toBeInstanceOf(LessonNotFoundError);
    });

    it('does not invent paid access when the field is absent', async () => {
      // A portal that omits paid_student_ids must yield NO paid students, never all.
      const fetchFn = jest.fn().mockResolvedValue(okResponse({
        lesson_uuid: LESSON,
        teacher_id: 182,
        groups: [],
        student_ids: [3, 7],
      }));
      const roster = await serviceWith(fetchFn).getRoster(LESSON);
      expect(roster.paidStudentIds).toEqual([]);
    });
  });

  describe('updateLesson', () => {
    it('PATCHes only the fields provided', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse(LESSON_BODY));
      await serviceWith(fetchFn).updateLesson(LESSON, { recommendation: 'new' });

      const [, init] = fetchFn.mock.calls[0];
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body)).toEqual({ recommendation: 'new' });
    });

    it('maps toManager to the portal snake_case field', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse(LESSON_BODY));
      await serviceWith(fetchFn).updateLesson(LESSON, { toManager: 'note' });

      const [, init] = fetchFn.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ to_manager: 'note' });
    });

    it('raises rather than silently discarding a failed write', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        { ok: false, status: 500, text: async () => 'boom' });
      await expect(serviceWith(fetchFn).updateLesson(LESSON, { recommendation: 'x' }))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });
  });

  describe('listLessonRecords', () => {
    const FROM = new Date('2026-07-01T00:00:00Z');
    const TO = new Date('2026-08-01T00:00:00Z');

    function recordRow(overrides: Record<string, unknown> = {}) {
      return {
        uuid: 'b1e2c3d4-0000-0000-0000-00000000000a',
        lesson_uuid: LESSON,
        record_key: '2026/07/01/lesson_' + LESSON + '.mp3',
        part_keys: [],
        created: '2026-07-01T11:00:00Z',
        processed: true,
        record_unavailable: '',
        ...overrides,
      };
    }

    function recordPage(records: unknown[], extra: Record<string, unknown> = {}) {
      return {
        records,
        count: records.length,
        limit: 500,
        offset: 0,
        has_more: false,
        ...extra,
      };
    }

    it('camelizes a record row', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse(recordPage([recordRow()])));
      const rows = await serviceWith(fetchFn).listLessonRecords(FROM, TO);

      expect(rows).toHaveLength(1);
      expect(rows[0].lessonUuid).toBe(LESSON);
      expect(rows[0].recordKey).toBe('2026/07/01/lesson_' + LESSON + '.mp3');
      expect(rows[0].processed).toBe(true);
      expect(rows[0].partKeys).toEqual([]);
    });

    it('sends the half-open created range', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse(recordPage([])));
      await serviceWith(fetchFn).listLessonRecords(FROM, TO);

      const url = new URL(fetchFn.mock.calls[0][0]);
      expect(url.pathname).toBe('/lesson-records/');
      expect(url.searchParams.get('from')).toBe('2026-07-01T00:00:00.000Z');
      expect(url.searchParams.get('to')).toBe('2026-08-01T00:00:00.000Z');
    });

    it('carries part keys through for a parts-only recording', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        okResponse(recordPage([recordRow({ record_key: '', part_keys: ['p/a.mp3', 'p/b.mp3'] })])),
      );
      const rows = await serviceWith(fetchFn).listLessonRecords(FROM, TO);

      expect(rows[0].recordKey).toBe('');
      expect(rows[0].partKeys).toEqual(['p/a.mp3', 'p/b.mp3']);
    });

    it('follows pagination to exhaustion', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(okResponse(recordPage([recordRow()], { count: 2, has_more: true })))
        .mockResolvedValueOnce(
          okResponse(recordPage([recordRow({ uuid: 'second' })], { count: 2, offset: 1, has_more: false })),
        );
      const rows = await serviceWith(fetchFn).listLessonRecords(FROM, TO);

      expect(rows).toHaveLength(2);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('raises when the page count does not match what was collected', async () => {
      // A short read here would look downstream like "these lessons had no recording",
      // which is exactly the confusion that froze the copy in the first place.
      const fetchFn = jest
        .fn()
        .mockResolvedValue(okResponse(recordPage([recordRow()], { count: 9, has_more: false })));

      await expect(serviceWith(fetchFn).listLessonRecords(FROM, TO)).rejects.toBeInstanceOf(
        LessonServiceUnavailableError,
      );
    });

    it('rejects an inverted range without calling the portal', async () => {
      const fetchFn = jest.fn();
      await expect(serviceWith(fetchFn).listLessonRecords(TO, FROM)).rejects.toBeInstanceOf(
        LessonServiceUnavailableError,
      );
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe('listLessonsByTeachers', () => {
    const FROM = new Date('2026-05-01T00:00:00Z');
    const TO = new Date('2026-06-01T00:00:00Z');

    function teacherLesson(overrides: Record<string, unknown> = {}) {
      return {
        uuid: LESSON,
        teacher_id: 182,
        start: '2026-05-04T09:00:00Z',
        is_finished: true,
        is_demo: false,
        is_group: false,
        scheduled_minutes: 60,
        has_paid_access: true,
        student_course_uuid: '43c00027-cf75-4d60-8775-da38dea408a1',
        course_display_title: 'Basic',
        module_class: 'course_materials.data.ru.en._basic_s.Module3T',
        record: { has_record: true, record_unavailable: '', processed: true },
        ...overrides,
      };
    }

    function page(lessons: unknown[], extra: Record<string, unknown> = {}) {
      return {
        lessons,
        count: lessons.length,
        limit: 500,
        offset: 0,
        has_more: false,
        ...extra,
      };
    }

    it('camelizes a teacher lesson, including the record state', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse(page([teacherLesson()])));
      const lessons = await serviceWith(fetchFn).listLessonsByTeachers([182], FROM, TO);

      expect(lessons).toHaveLength(1);
      expect(lessons[0].teacherId).toBe(182);
      expect(lessons[0].scheduledMinutes).toBe(60);
      expect(lessons[0].hasPaidAccess).toBe(true);
      expect(lessons[0].isDemo).toBe(false);
      expect(lessons[0].record.hasRecord).toBe(true);
      expect(lessons[0].record.recordUnavailable).toBe('');
    });

    it('sends the teacher ids and the half-open range as query params', async () => {
      const fetchFn = jest.fn().mockResolvedValue(okResponse(page([])));
      await serviceWith(fetchFn).listLessonsByTeachers([182, 7], FROM, TO);

      const url = new URL(fetchFn.mock.calls[0][0]);
      expect(url.pathname).toBe('/lessons/by-teacher/');
      expect(url.searchParams.get('teacher_ids')).toBe('182,7');
      expect(url.searchParams.get('from')).toBe('2026-05-01T00:00:00.000Z');
      expect(url.searchParams.get('to')).toBe('2026-06-01T00:00:00.000Z');
    });

    it('does not call the portal at all for an empty teacher list', async () => {
      const fetchFn = jest.fn();
      const lessons = await serviceWith(fetchFn).listLessonsByTeachers([], FROM, TO);

      expect(lessons).toEqual([]);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('follows pagination until has_more is false', async () => {
      const first = page([teacherLesson({ uuid: 'a' })], { count: 2, has_more: true });
      const second = page([teacherLesson({ uuid: 'b' })], { count: 2, offset: 1 });
      const fetchFn = jest.fn()
        .mockResolvedValueOnce(okResponse(first))
        .mockResolvedValueOnce(okResponse(second));

      const lessons = await serviceWith(fetchFn).listLessonsByTeachers([182], FROM, TO);

      expect(lessons.map((l) => l.uuid)).toEqual(['a', 'b']);
      expect(new URL(fetchFn.mock.calls[1][0]).searchParams.get('offset')).toBe('1');
    });

    // The defect that motivates this endpoint: a short read is indistinguishable
    // downstream from a teacher having taught fewer lessons, and underpays them.
    it('raises when fewer rows arrive than the portal reported', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        okResponse(page([teacherLesson()], { count: 9 })));

      await expect(serviceWith(fetchFn).listLessonsByTeachers([182], FROM, TO))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });

    it('raises instead of looping when has_more comes with an empty page', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        okResponse(page([], { count: 5, has_more: true })));

      await expect(serviceWith(fetchFn).listLessonsByTeachers([182], FROM, TO))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });

    it('raises when the portal is unreachable rather than returning what it has', async () => {
      const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(serviceWith(fetchFn).listLessonsByTeachers([182], FROM, TO))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });

    it('raises on a non-ok status', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        { ok: false, status: 500, text: async () => 'boom' });

      await expect(serviceWith(fetchFn).listLessonsByTeachers([182], FROM, TO))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
    });

    it('rejects an inverted range before calling the portal', async () => {
      const fetchFn = jest.fn();

      await expect(serviceWith(fetchFn).listLessonsByTeachers([182], TO, FROM))
        .rejects.toBeInstanceOf(LessonServiceUnavailableError);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('raises when the portal is not configured', async () => {
      const fetchFn = jest.fn();

      await expect(
        serviceWith(fetchFn, { token: '' }).listLessonsByTeachers([182], FROM, TO),
      ).rejects.toBeInstanceOf(LessonServiceUnavailableError);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});
