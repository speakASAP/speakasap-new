/**
 * Salary parity check: new portal-sourced aggregate vs imported legacy LessonSalaryExpense.
 *
 * WHY THIS EXISTS
 * ---------------
 * `internal-salary.service.ts` used to aggregate education-service's own `lesson` table —
 * an ETL copy frozen at 2026-06-26. It now reads the portal, which is the owner of lesson
 * facts. That changes what feeds teacher payouts, so the two sources must be compared on a
 * month whose legacy figures are already trusted BEFORE any calculation run is enabled.
 *
 * The baseline is `salary_expenses` rows of kind `lesson` that carry `legacy_expense_id`
 * (imported from the legacy portal), NOT rows this platform computed.
 *
 * STRICTLY READ-ONLY. It opens no write transaction and calls no calculation endpoint.
 * Run it, read the table, and only then decide whether to enable a run.
 *
 *   npx ts-node scripts/salary-parity-2026-05.ts [--period 2026-05] [--json out.json]
 */

import { writeFileSync } from 'fs';

type Aggregate = {
  legacyPortalUserId: number;
  teacherId: number;
  finishedLessonCount: number;
  paidLessonCount: number;
  demoLessonCount: number;
  scheduledMinutes: number;
  payableMinutes: number;
  missingDurationCount: number;
  shortRecordCount: number;
  missingRecordCount: number;
  recordUnavailableCount: number;
  warnings: string[];
};

type AggregateResponse = {
  period: string;
  items: Aggregate[];
  meta: {
    readiness: {
      salaryCalculationReady: boolean;
      missingDurationCount: number;
      shortRecordCount: number;
      teacherMappingMissingCount: number;
      missingTeacherMappingLegacyUserIds: number[];
    };
    warnings: string[];
  };
};

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PERIOD = arg('period', '2026-05') as string;
const JSON_OUT = arg('json');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    // Fail loudly: a parity report built from a half-configured environment is worse
    // than none, because it looks authoritative.
    throw new Error(`${name} is required and unset`);
  }
  return value.trim();
}

async function fetchAggregates(legacyPortalUserIds: number[]): Promise<AggregateResponse> {
  const base = requireEnv('EDUCATION_SERVICE_URL').replace(/\/$/, '');
  const token = requireEnv('EDUCATION_SERVICE_BEARER_TOKEN');
  const url = new URL(`${base}/api/v1/internal/salary/period-aggregates`);
  url.searchParams.set('period', PERIOD);
  if (legacyPortalUserIds.length) {
    url.searchParams.set('legacyPortalUserIds', legacyPortalUserIds.join(','));
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`education-service period-aggregates HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as AggregateResponse;
}

async function main(): Promise<void> {
  // Imported from salary-service's own client so the baseline is read through the same
  // schema the payout uses.
  const { PrismaClient } = await import('../salary-service/node_modules/@prisma/client');
  const prisma = new PrismaClient();

  const [year, month] = PERIOD.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  try {
    // Baseline: legacy-imported lesson expenses only.
    const legacyRows = await prisma.salaryExpense.findMany({
      where: {
        kind: 'lesson',
        date: { gte: start, lt: end },
        legacyExpenseId: { not: null },
      },
      select: { legacyPortalUserId: true, qty: true, lessonUuid: true },
    });

    if (!legacyRows.length) {
      throw new Error(
        `No imported legacy lesson expenses found for ${PERIOD}. ` +
          `Without a baseline there is nothing to compare against — refusing to report parity.`,
      );
    }

    const legacyByUser = new Map<number, { qty: number; lessons: Set<string> }>();
    for (const row of legacyRows) {
      const entry = legacyByUser.get(row.legacyPortalUserId) ?? { qty: 0, lessons: new Set<string>() };
      entry.qty += Number(row.qty);
      if (row.lessonUuid) {
        entry.lessons.add(row.lessonUuid);
      }
      legacyByUser.set(row.legacyPortalUserId, entry);
    }

    const userIds = [...legacyByUser.keys()].sort((a, b) => a - b);
    const aggregates = await fetchAggregates(userIds);
    const newByUser = new Map(aggregates.items.map((item) => [item.legacyPortalUserId, item]));

    type Row = {
      legacyPortalUserId: number;
      legacyQty: number;
      newLessonCount: number;
      delta: number;
      newPayableMinutes: number;
      missingDuration: number;
      shortRecord: number;
      status: string;
    };

    const rows: Row[] = [];
    for (const userId of userIds) {
      const legacy = legacyByUser.get(userId)!;
      const next = newByUser.get(userId);
      const legacyQty = Number(legacy.qty.toFixed(4));
      const newCount = next?.finishedLessonCount ?? 0;
      const delta = Number((newCount - legacyQty).toFixed(4));

      let status: string;
      if (!next) {
        status = 'MISSING_IN_NEW';
      } else if (Math.abs(delta) < 0.0001) {
        status = 'MATCH';
      } else if (delta > 0) {
        status = 'NEW_HAS_MORE';
      } else {
        status = 'NEW_HAS_FEWER';
      }

      rows.push({
        legacyPortalUserId: userId,
        legacyQty,
        newLessonCount: newCount,
        delta,
        newPayableMinutes: next?.payableMinutes ?? 0,
        missingDuration: next?.missingDurationCount ?? 0,
        shortRecord: next?.shortRecordCount ?? 0,
        status,
      });
    }

    const matched = rows.filter((r) => r.status === 'MATCH');
    const more = rows.filter((r) => r.status === 'NEW_HAS_MORE');
    const fewer = rows.filter((r) => r.status === 'NEW_HAS_FEWER');
    const missing = rows.filter((r) => r.status === 'MISSING_IN_NEW');

    console.log(`\n=== SALARY PARITY ${PERIOD} (READ-ONLY) ===\n`);
    console.log(`Baseline: ${legacyRows.length} imported legacy lesson expenses, ${userIds.length} teachers.`);
    console.log(`New source: portal via education-service period-aggregates.\n`);

    console.table(
      rows
        .slice()
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 40),
    );

    console.log(`\nMATCH          ${matched.length}`);
    console.log(`NEW_HAS_MORE   ${more.length}   (lessons the frozen copy could not see)`);
    console.log(`NEW_HAS_FEWER  ${fewer.length}   <-- investigate before any run`);
    console.log(`MISSING_IN_NEW ${missing.length}   <-- investigate before any run`);

    const totalLegacy = rows.reduce((s, r) => s + r.legacyQty, 0);
    const totalNew = rows.reduce((s, r) => s + r.newLessonCount, 0);
    console.log(`\nTotal legacy qty: ${totalLegacy.toFixed(2)}`);
    console.log(`Total new count : ${totalNew.toFixed(2)}`);
    console.log(`Net delta       : ${(totalNew - totalLegacy).toFixed(2)}`);

    console.log(`\nReadiness from education-service:`);
    console.log(`  salaryCalculationReady = ${aggregates.meta.readiness.salaryCalculationReady}`);
    console.log(`  missingDurationCount   = ${aggregates.meta.readiness.missingDurationCount}`);
    console.log(`  shortRecordCount       = ${aggregates.meta.readiness.shortRecordCount}`);
    console.log(`  teacherMappingMissing  = ${aggregates.meta.readiness.teacherMappingMissingCount}`);

    const blocking = fewer.length + missing.length;
    console.log(
      `\nVERDICT: ${
        blocking === 0
          ? 'no teacher loses lessons under the new source. Deltas, if any, are additions.'
          : `${blocking} teacher(s) would be paid for FEWER lessons. DO NOT enable a calculation run.`
      }\n`,
    );

    if (JSON_OUT) {
      writeFileSync(JSON_OUT, JSON.stringify({ period: PERIOD, rows, meta: aggregates.meta }, null, 2));
      console.log(`JSON report written to ${JSON_OUT}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`\nPARITY CHECK FAILED: ${(error as Error).message}\n`);
  process.exit(1);
});
