import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CalculationRunStatus, Prisma, SalaryExpenseKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EducationClientService, PeriodAggregateResult } from '../deps/education-client.service';
import {
  decodeCursor,
  encodeCursor,
  ListEnvelope,
  parseListLimit,
} from '../shared/list-response';
import { idempotencyReplayException, salaryHttpException } from '../shared/salary-http.exception';
import { IdempotencyService, requestBodyHash } from '../idempotency/idempotency.service';

const PERIOD_RE = /^\d{4}-\d{2}$/;
const CALCULATION_RUNS_ENABLED_ENV = 'SALARY_CALCULATION_RUNS_ENABLED';

type ImportedLessonSalaryTotal = {
  legacyPortalUserId: number;
  lessonExpenseCount: number;
  qtyHours: number;
  lessonUuids: Set<string>;
};

function mergeCursor(
  base: Prisma.CalculationRunWhereInput,
  cur: { t: string; id: string } | null,
): Prisma.CalculationRunWhereInput {
  if (!cur) {
    return base;
  }
  const c: Prisma.CalculationRunWhereInput = {
    OR: [
      { createdAt: { lt: new Date(cur.t) } },
      { AND: [{ createdAt: { equals: new Date(cur.t) } }, { id: { lt: cur.id } }] },
    ],
  };
  return Object.keys(base).length ? { AND: [base, c] } : c;
}

@Injectable()
export class CalculationRunsService {
  private readonly logger = new Logger(CalculationRunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly education: EducationClientService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(
    body: { period: string; profileIds?: number[]; rulesVersion: string },
    idempotencyKey?: string,
  ) {
    if (process.env[CALCULATION_RUNS_ENABLED_ENV] !== 'true') {
      throw salaryHttpException(
        HttpStatus.PRECONDITION_FAILED,
        'SALARY_CALCULATION_RUNS_DISABLED',
        `${CALCULATION_RUNS_ENABLED_ENV}=true is required after salary parity blockers are isolated`,
      );
    }
    if (!PERIOD_RE.test(body.period)) {
      throw salaryHttpException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'period must be YYYY-MM');
    }
    const route = 'POST /api/v1/calculation-runs';
    const hash = requestBodyHash(body);
    if (idempotencyKey) {
      const replay = await this.idempotency.lookupReplay(idempotencyKey, route, hash);
      if (replay && !replay.match) {
        throw salaryHttpException(HttpStatus.CONFLICT, 'CONFLICT', 'Idempotency-Key reuse with different body');
      }
      if (replay?.match) {
        throw idempotencyReplayException(replay.body);
      }
    }

    const whereProfile: Prisma.SalaryProfileWhereInput =
      body.profileIds && body.profileIds.length
        ? { legacyPortalUserId: { in: body.profileIds } }
        : {};

    const profiles = await this.prisma.salaryProfile.findMany({ where: whereProfile });
    if (!profiles.length) {
      throw salaryHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CALCULATION_INVALID',
        'No salary profiles match the request',
      );
    }

    const internal = (process.env.SALARY_TO_EDUCATION_SERVICE_TOKEN || '').trim();
    if (!internal) {
      throw salaryHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DEPENDENCY_UNAVAILABLE',
        'SALARY_TO_EDUCATION_SERVICE_TOKEN is unset',
      );
    }
    let aggregateResult: PeriodAggregateResult;
    try {
      aggregateResult = await this.education.fetchPeriodAggregates(
        body.period,
        profiles.map((p) => p.legacyPortalUserId),
        internal,
      );
    } catch {
      throw salaryHttpException(
        HttpStatus.BAD_GATEWAY,
        'DEPENDENCY_UNAVAILABLE',
        'education-service unavailable',
      );
    }
    const importedLessonSalaryTotals = await this.loadImportedLessonSalaryTotals(
      body.period,
      profiles.map((p) => p.legacyPortalUserId),
    );
    assertSalaryAggregateReady(aggregateResult, importedLessonSalaryTotals);
    // Imported legacy hours win over the computed aggregate wherever they exist, so they
    // must not be older than it. See assertImportedLessonSalaryCoverage.
    assertImportedLessonSalaryCoverage(
      body.period,
      profiles.map((p) => ({
        legacyPortalUserId: p.legacyPortalUserId,
        imported: importedLessonSalaryTotals.get(p.legacyPortalUserId),
        aggregate: aggregateResult.items.get(p.legacyPortalUserId),
      })),
    );
    const agg = aggregateResult.items;

    const run = await this.prisma.calculationRun.create({
      data: {
        period: body.period,
        rulesVersion: body.rulesVersion,
        status: 'draft',
        profileIds: body.profileIds === undefined ? undefined : body.profileIds,
        lines: {
          create: profiles.map((p) => {
            const a = agg.get(p.legacyPortalUserId);
            const importedLessonSalary = importedLessonSalaryTotals.get(p.legacyPortalUserId);
            const aggregateHours = a ? a.totalMinutes / 60 : 0;
            const { hours, fromRate, fromSalary, amount } = calculationLineAmount({
              rate: p.rate.toString(),
              salary: p.salary.toString(),
              aggregateHours,
              importedQtyHours: importedLessonSalary?.qtyHours,
            });
            return {
              profileId: p.id,
              legacyPortalUserId: p.legacyPortalUserId,
              amount,
              currency: p.currency,
              breakdown: {
                period: body.period,
                finishedLessonCount: a?.finishedLessonCount ?? 0,
                paidLessonCount: a?.paidLessonCount ?? 0,
                demoLessonCount: a?.demoLessonCount ?? 0,
                demoUnpaidLessonCount: a?.demoUnpaidLessonCount ?? 0,
                demoPayableLessonCount: a?.demoPayableLessonCount ?? 0,
                scheduledMinutes: a?.scheduledMinutes ?? 0,
                payableMinutes: a?.payableMinutes ?? 0,
                totalMinutes: a?.totalMinutes ?? 0,
                recordedMinutes: a?.recordedMinutes ?? 0,
                recordUnavailableCount: a?.recordUnavailableCount ?? 0,
                missingRecordCount: a?.missingRecordCount ?? 0,
                missingDurationCount: a?.missingDurationCount ?? 0,
                implausibleRecordCount: a?.implausibleRecordCount ?? 0,
                fallbackPaidLessonCount: a?.fallbackPaidLessonCount ?? 0,
                aggregateWarnings: a?.warnings ?? [],
                lessonSalaryHoursSource: importedLessonSalary
                  ? 'imported_legacy_lesson_salary_expenses'
                  : 'education_recording_aggregate',
                importedLessonSalaryExpenseCount: importedLessonSalary?.lessonExpenseCount ?? 0,
                importedLessonSalaryQtyHours: importedLessonSalary?.qtyHours ?? null,
                aggregateLessonSalaryQtyHours: aggregateHours,
                monthlySalaryComponent: fromSalary,
                hourlyComponent: fromRate,
              },
            };
          }),
        },
      },
    });

    const created = await this.prisma.calculationRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { _count: { select: { lines: true } } },
    });
    const response = {
      calculationRunId: created.id,
      status: created.status,
      lineCount: created._count.lines,
    };
    if (idempotencyKey) {
      await this.idempotency.store(idempotencyKey, route, hash, 201, response);
    }
    return response;
  }

  async getOne(runId: string) {
    const run = await this.prisma.calculationRun.findUnique({
      where: { id: runId },
      include: { _count: { select: { lines: true } } },
    });
    if (!run) {
      throw new NotFoundException('Calculation run not found');
    }
    return {
      id: run.id,
      period: run.period,
      status: run.status,
      rulesVersion: run.rulesVersion,
      lineCount: run._count.lines,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  async list(params: { limit?: string; cursor?: string }): Promise<
    ListEnvelope<{
      id: string;
      period: string;
      status: string;
      rulesVersion: string;
      lineCount: number;
      createdAt: string;
    }>
  > {
    const limit = parseListLimit(params.limit);
    const cur = decodeCursor(params.cursor);
    const where = mergeCursor({}, cur);
    const rows = await this.prisma.calculationRun.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { _count: { select: { lines: true } } },
    });
    let nextCursor: string | null = null;
    let data = rows;
    if (rows.length > limit) {
      data = rows.slice(0, limit);
      const last = data[data.length - 1];
      nextCursor = encodeCursor({ t: last.createdAt.toISOString(), id: last.id });
    }
    return {
      data: data.map((r) => ({
        id: r.id,
        period: r.period,
        status: r.status,
        rulesVersion: r.rulesVersion,
        lineCount: r._count.lines,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: { nextCursor, limit },
    };
  }

  async finalize(runId: string) {
    const run = await this.prisma.calculationRun.findUnique({
      where: { id: runId },
      include: { lines: true },
    });
    if (!run) {
      throw new NotFoundException('Calculation run not found');
    }
    if (run.status !== 'draft') {
      throw salaryHttpException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'Run is not in draft state',
      );
    }
    if (!run.lines.length) {
      throw salaryHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CALCULATION_INVALID',
        'Cannot finalize run without lines',
      );
    }
    await this.prisma.calculationRun.update({
      where: { id: runId },
      data: { status: CalculationRunStatus.finalized },
    });
    return { calculationRunId: runId, status: 'finalized' as const };
  }

  /**
   * Return a finalized run to draft so a wrong one can be withdrawn instead of paid.
   *
   * Deliberately does NOT delete the run or its lines: the audit trail of what was once
   * finalized is the point. It only reopens it for correction.
   */
  async unfinalize(runId: string, reason: string) {
    if (!reason || !reason.trim()) {
      throw salaryHttpException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'reason is required: an un-finalized payroll run must say why on the record',
      );
    }
    const run = await this.prisma.calculationRun.findUnique({
      where: { id: runId },
      include: { _count: { select: { payoutRuns: true } } },
    });
    if (!run) {
      throw new NotFoundException('Calculation run not found');
    }
    assertRunCanBeUnfinalized({
      id: run.id,
      status: run.status,
      payoutRunCount: run._count.payoutRuns,
    });
    await this.prisma.calculationRun.update({
      where: { id: runId },
      data: { status: CalculationRunStatus.draft },
    });
    this.logger.warn(
      `Calculation run ${runId} (period ${run.period}, rules ${run.rulesVersion}) ` +
        `returned to draft. Reason: ${reason.trim()}`,
    );
    return { calculationRunId: runId, status: 'draft' as const, reason: reason.trim() };
  }

  private async loadImportedLessonSalaryTotals(
    period: string,
    legacyPortalUserIds: number[],
  ): Promise<Map<number, ImportedLessonSalaryTotal>> {
    if (!legacyPortalUserIds.length) {
      return new Map();
    }
    const { start, end } = periodBounds(period);
    const rows = await this.prisma.salaryExpense.findMany({
      where: {
        legacyPortalUserId: { in: legacyPortalUserIds },
        kind: SalaryExpenseKind.lesson,
        date: { gte: start, lt: end },
      },
      select: {
        legacyPortalUserId: true,
        lessonUuid: true,
        qty: true,
      },
    });
    const totals = new Map<number, ImportedLessonSalaryTotal>();
    for (const row of rows) {
      let total = totals.get(row.legacyPortalUserId);
      if (!total) {
        total = {
          legacyPortalUserId: row.legacyPortalUserId,
          lessonExpenseCount: 0,
          qtyHours: 0,
          lessonUuids: new Set<string>(),
        };
        totals.set(row.legacyPortalUserId, total);
      }
      total.lessonExpenseCount += 1;
      total.qtyHours += Number(row.qty.toString());
      if (row.lessonUuid) {
        total.lessonUuids.add(row.lessonUuid);
      }
    }
    return totals;
  }
}

/**
 * How far imported legacy hours may fall short of the computed aggregate before the month
 * is treated as stale rather than merely rounded. Legacy quantizes to 0.01h and the 95%
 * rule rounds to whole lessons, so small drift is expected; a frozen import is not small.
 */
const IMPORTED_HOURS_SHORTFALL_TOLERANCE = 1;

export type ImportedCoverageRow = {
  legacyPortalUserId: number;
  imported?: { qtyHours: number; lessonExpenseCount: number } | undefined;
  aggregate?: { totalMinutes: number; finishedLessonCount: number } | undefined;
};

/**
 * Refuse to pay from imported legacy hours that the live aggregate has outgrown.
 *
 * `hours = imported?.qtyHours ?? aggregateHours` lets imported rows win whenever ANY exist
 * for a teacher. The imports stop at the 2026-06-26 ETL freeze, so a teacher with partial
 * imports silently gets the stale number — measured on production, June 2026 would underpay
 * 10 teachers by 86.38 hours in total, one of them by 39.
 *
 * Only a SHORTFALL is a failure. Imports exceeding the aggregate mean legacy paid for
 * something this computation cannot see, which is not this gate's business.
 */
/**
 * Whether a finalized calculation run may be returned to draft.
 *
 * `finalized` is the state payout-runs requires, so finalizing on bad inputs was a one-way
 * door into the payout path. Reversing is safe only while no payout run references it;
 * after that the money may already have moved and the run is history, not a draft.
 */
/**
 * What one teacher is paid for a period: a fixed monthly salary plus an hourly component.
 *
 * Extracted from the line builder so it can be tested. It was inline inside a
 * `prisma.calculationRun.create()` call, which meant the arithmetic that decides a real
 * person's pay had no way to be exercised without a database.
 *
 * `importedQtyHours` wins over the computed aggregate wherever it exists — see
 * assertImportedLessonSalaryCoverage, which refuses a run when those imports are staler
 * than the aggregate.
 */
export function calculationLineAmount(input: {
  rate: string;
  salary: string;
  aggregateHours: number;
  importedQtyHours?: number;
}): { hours: number; fromRate: number; fromSalary: number; amount: string } {
  const hours = input.importedQtyHours ?? input.aggregateHours;
  const rate = Number(input.rate);
  const salary = Number(input.salary);
  // A non-finite rate or salary would make `amount` the string "NaN", which is then stored
  // as a Decimal and later handed to payment-service. Raising keeps a broken profile from
  // becoming a broken payment.
  if (!Number.isFinite(rate) || !Number.isFinite(salary) || !Number.isFinite(hours)) {
    throw salaryHttpException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'SALARY_AMOUNT_INVALID',
      `cannot compute a line amount from rate=${input.rate} salary=${input.salary} hours=${hours}`,
    );
  }
  const fromRate = rate * hours;
  const fromSalary = salary;
  return { hours, fromRate, fromSalary, amount: (fromSalary + fromRate).toFixed(2) };
}

export function assertRunCanBeUnfinalized(run: {
  id: string;
  status: string;
  payoutRunCount: number;
}): void {
  if (run.status !== 'finalized') {
    throw salaryHttpException(
      HttpStatus.CONFLICT,
      'SALARY_RUN_NOT_FINALIZED',
      `Calculation run ${run.id} is ${run.status}, not finalized; there is nothing to reverse.`,
      { calculationRunId: run.id, status: run.status },
    );
  }
  if (run.payoutRunCount > 0) {
    throw salaryHttpException(
      HttpStatus.CONFLICT,
      'SALARY_RUN_HAS_PAYOUTS',
      `Calculation run ${run.id} is referenced by ${run.payoutRunCount} payout run(s); ` +
        `reversing it would detach payouts from the figures they were computed from. ` +
        `Reverse or void the payout runs first.`,
      { calculationRunId: run.id, payoutRunCount: run.payoutRunCount },
    );
  }
}

export function assertImportedLessonSalaryCoverage(
  period: string,
  rows: ImportedCoverageRow[],
): void {
  const stale = rows
    .map((row) => {
      if (!row.imported) {
        return null;
      }
      const aggregateHours = (row.aggregate?.totalMinutes ?? 0) / 60;
      const shortfallHours = aggregateHours - row.imported.qtyHours;
      if (shortfallHours <= IMPORTED_HOURS_SHORTFALL_TOLERANCE) {
        return null;
      }
      return {
        legacyPortalUserId: row.legacyPortalUserId,
        importedQtyHours: Number(row.imported.qtyHours.toFixed(2)),
        importedLessonExpenseCount: row.imported.lessonExpenseCount,
        aggregateHours: Number(aggregateHours.toFixed(2)),
        aggregateFinishedLessonCount: row.aggregate?.finishedLessonCount ?? 0,
        shortfallHours: Number(shortfallHours.toFixed(2)),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (!stale.length) {
    return;
  }

  const totalShortfall = stale.reduce((sum, row) => sum + row.shortfallHours, 0);
  throw salaryHttpException(
    HttpStatus.PRECONDITION_FAILED,
    'SALARY_IMPORTED_HOURS_STALE',
    `Imported legacy lesson hours for ${period} fall short of the computed aggregate for ` +
      `${stale.length} teacher(s) by ${totalShortfall.toFixed(2)}h in total. Paying from ` +
      `these imports would underpay real teachers; reconcile or clear the imported rows first.`,
    { period, staleImportedTeachers: stale, totalShortfallHours: Number(totalShortfall.toFixed(2)) },
  );
}

export function assertSalaryAggregateReady(
  result: PeriodAggregateResult,
  importedLessonSalaryTotals: Map<number, ImportedLessonSalaryTotal>,
): void {
  const readiness = result.readiness;
  const missingDurationCount = readiness.missingDurationCount ?? 0;
  // education-service renamed this in salary-duration-v4: a recording shorter than the
  // slot is the legacy 95% rule working, not a blocker, so only an IMPLAUSIBLY short one
  // is flagged. Defaulting a missing field to 0 here would silently open the payout gate,
  // so an aggregate that carries neither field is refused outright below.
  const implausibleRecordCount = readiness.implausibleRecordCount ?? 0;
  const teacherMappingMissingCount = readiness.teacherMappingMissingCount ?? 0;
  if (
    readiness.implausibleRecordCount === undefined &&
    readiness.shortRecordCount === undefined
  ) {
    throw salaryHttpException(
      HttpStatus.PRECONDITION_FAILED,
      'SALARY_AGGREGATE_CONTRACT_UNKNOWN',
      'education-service returned no short/implausible record count; refusing to run payroll against an aggregate whose contract is not understood',
      { readiness },
    );
  }
  const dependencyWarnings = result.warnings.length;
  const importedCoveredBlockers = result.blockerSamples.filter(
    (sample) =>
      (sample.reason === 'record_too_short_to_be_a_lesson' ||
      sample.reason === 'short_record_duration' ||
      sample.reason === 'lesson_record_duration_seconds_missing') &&
      sample.legacyPortalUserId !== null &&
      sample.legacyPortalUserId !== undefined &&
      Boolean(
        sample.lessonUuid &&
          importedLessonSalaryTotals
            .get(sample.legacyPortalUserId)
            ?.lessonUuids.has(sample.lessonUuid),
      ),
  ).length;
  const importedCoverableBlockers = result.blockerSamples.filter(
    (sample) =>
      sample.reason === 'record_too_short_to_be_a_lesson' ||
      sample.reason === 'short_record_duration' ||
      sample.reason === 'lesson_record_duration_seconds_missing',
  ).length;
  // `implausibleRecordCount` is reported, never gated on. An implausibly short recording
  // has a KNOWN length that happens to be tiny — legacy pays the real length and so does
  // education-service, so the amount is already correct and there is nothing to reconcile
  // before paying. Owner decision 2026-08-19, after adjudicating a 12s and a 129s
  // recording as genuine short lessons rather than defects.
  //
  // `missingDurationCount` still gates: an unknown length means a run would be guessing.
  const durationBlockersCoveredByImports =
    missingDurationCount > 0 &&
    teacherMappingMissingCount === 0 &&
    importedCoverableBlockers === missingDurationCount &&
    importedCoveredBlockers === importedCoverableBlockers;
  if (
    (readiness.salaryCalculationReady === false && !durationBlockersCoveredByImports) ||
    (missingDurationCount > 0 && !durationBlockersCoveredByImports) ||
    teacherMappingMissingCount > 0 ||
    dependencyWarnings > 0
  ) {
    throw salaryHttpException(
      HttpStatus.PRECONDITION_FAILED,
      'SALARY_PARITY_BLOCKERS_PRESENT',
      'Salary calculation runs are blocked until missing-duration, implausible-record, and teacher-mapping rows are isolated and reconciled',
      {
        readiness,
        blockerSamples: result.blockerSamples.slice(0, 50),
        importedLessonSalaryCoverage: {
          importedCoverableBlockers,
          importedCoveredBlockers,
          durationBlockersCoveredByImports,
        },
        warnings: result.warnings,
      },
    );
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
