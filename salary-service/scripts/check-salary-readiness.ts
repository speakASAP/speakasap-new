import { writeFileSync } from 'node:fs';

type Readiness = {
  salaryCalculationReady?: boolean;
  missingDurationCount?: number;
  shortRecordCount?: number;
  teacherMappingMissingCount?: number;
  missingTeacherMappingLegacyUserIds?: number[];
};

type AggregateItem = {
  legacyPortalUserId: number;
  teacherId?: number;
  finishedLessonCount?: number;
  paidLessonCount?: number;
  demoLessonCount?: number;
  demoUnpaidLessonCount?: number;
  demoPayableLessonCount?: number;
  scheduledMinutes?: number;
  payableMinutes?: number;
  totalMinutes?: number;
  recordedMinutes?: number;
  missingRecordCount?: number;
  missingDurationCount?: number;
  shortRecordCount?: number;
  warnings?: string[];
};

type AggregateResponse = {
  period: string;
  items?: AggregateItem[];
  meta?: {
    readiness?: Readiness;
    blockerSamples?: unknown[];
    warnings?: string[];
    rulesVersion?: string;
    generatedAt?: string;
  };
};

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[idx + 1];
}

function requireArg(name: string): string {
  const value = arg(name);
  if (!value?.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

async function main() {
  const period = requireArg('--period');
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('--period must be YYYY-MM');
  }
  const reportPath = requireArg('--json-report');
  const legacyPortalUserIds = arg('--legacy-portal-user-ids');
  const base = (process.env.EDUCATION_SERVICE_URL || '').replace(/\/$/, '');
  const token = (process.env.SALARY_TO_EDUCATION_SERVICE_TOKEN || '').trim();
  if (!base || !token) {
    throw new Error('EDUCATION_SERVICE_URL and SALARY_TO_EDUCATION_SERVICE_TOKEN are required');
  }

  const url = new URL(`${base}/api/v1/internal/salary/period-aggregates`);
  url.searchParams.set('period', period);
  if (legacyPortalUserIds?.trim()) {
    url.searchParams.set('legacyPortalUserIds', legacyPortalUserIds.trim());
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`education aggregate request failed with HTTP ${res.status}`);
  }
  const aggregate = (await res.json()) as AggregateResponse;
  const readiness = aggregate.meta?.readiness ?? {};
  const items = aggregate.items ?? [];
  const report = {
    generatedAt: new Date().toISOString(),
    writes: false,
    period,
    rulesVersion: aggregate.meta?.rulesVersion ?? null,
    readiness: {
      salaryCalculationReady: readiness.salaryCalculationReady === true,
      missingDurationCount: readiness.missingDurationCount ?? 0,
      shortRecordCount: readiness.shortRecordCount ?? 0,
      teacherMappingMissingCount: readiness.teacherMappingMissingCount ?? 0,
      missingTeacherMappingLegacyUserIds: readiness.missingTeacherMappingLegacyUserIds ?? [],
    },
    totals: {
      aggregateItems: items.length,
      finishedLessonCount: sum(items, 'finishedLessonCount'),
      demoLessonCount: sum(items, 'demoLessonCount'),
      demoUnpaidLessonCount: sum(items, 'demoUnpaidLessonCount'),
      demoPayableLessonCount: sum(items, 'demoPayableLessonCount'),
      missingRecordCount: sum(items, 'missingRecordCount'),
      missingDurationCount: sum(items, 'missingDurationCount'),
      shortRecordCount: sum(items, 'shortRecordCount'),
      totalMinutes: sum(items, 'totalMinutes'),
    },
    blockerSamples: aggregate.meta?.blockerSamples ?? [],
    aggregateWarnings: aggregate.meta?.warnings ?? [],
    items,
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ writes: false, period, reportPath, readiness: report.readiness }));
  if (!report.readiness.salaryCalculationReady) {
    process.exitCode = 2;
  }
}

function sum(items: AggregateItem[], key: keyof AggregateItem): number {
  return items.reduce((total, item) => {
    const value = item[key];
    return total + (typeof value === 'number' ? value : 0);
  }, 0);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
