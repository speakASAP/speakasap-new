#!/usr/bin/env node
/**
 * Rebuild `education_lessonrecord` rows from the portal's internal API.
 *
 * WHY THIS EXISTS
 * ---------------
 * That table is a copy filled by `migrate-lesson-records-from-legacy.py`, a one-shot
 * MANUAL ETL. Nothing ever scheduled it — there is no CronJob in `statex-apps` and
 * nothing references the script — so it went stale the day its last run finished
 * (2026-06-13). The salary aggregate joins `lesson_record.duration_seconds` by lesson
 * uuid, so from that date every lesson had no duration and quietly fell back to a flat
 * full-hour payment instead of its recorded length: 2026-07 aggregated 128 lessons with
 * 126 missing durations, and 165 of 168 July/August lessons have a recording the copy
 * knows nothing about.
 *
 * Unlike the original ETL this does NOT need a direct connection to the portal database
 * (it lives on another host reachable only through a read-only ssh). It reads
 * `GET /lesson-records/` on the internal API, which serves fields the portal already had.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not set `durationSeconds`. Creating the row is this script's job; filling the
 * length is `backfill-lesson-record-durations.js`, which probes the object with ffprobe.
 * Run this first, that second.
 *
 * THIS DOES NOT CURE THE FREEZE. It is a backfill. Until something runs on a schedule —
 * or the portal notifies this service on upload — the copy starts drifting again the day
 * after it runs.
 *
 *   node scripts/ingest-lesson-records-from-portal.js --dry-run --from 2026-06-01 --to 2026-09-01
 *   node scripts/ingest-lesson-records-from-portal.js --apply --from 2026-06-01 --to 2026-09-01 \
 *     --confirm-write --approval-note "owner approved" --rollback-plan "DELETE created uuids"
 */
const { PrismaClient } = require('@prisma/client');
const { writeFileSync } = require('fs');

const PAGE_SIZE = 500;
const MAX_PAGES = 200;

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: false,
    confirmWrite: false,
    approvalNote: '',
    rollbackPlan: '',
    jsonReport: '',
    from: '',
    to: '',
    limit: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[i];
    };
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--confirm-write') args.confirmWrite = true;
    else if (arg === '--approval-note') args.approvalNote = next();
    else if (arg === '--rollback-plan') args.rollbackPlan = next();
    else if (arg === '--json-report') args.jsonReport = next();
    else if (arg === '--from') args.from = next();
    else if (arg === '--to') args.to = next();
    else if (arg === '--limit') args.limit = Number(next());
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required and unset`);
  }
  return value.trim();
}

async function fetchPage(base, token, from, to, offset) {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  const res = await fetch(`${base.replace(/\/$/, '')}/lesson-records/?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });
  const text = await res.text();
  const looksHtml = text.trimStart().startsWith('<');
  if (!res.ok) {
    if (res.status === 404) {
      // The endpoint ships in speakasap-portal, which is deny-listed from auto-deploy.
      throw new Error(
        'portal /lesson-records/ returned 404 — the endpoint is committed to portal main ' +
          'but not deployed on the portal host yet. Deploy speakasap-portal, then re-run.',
      );
    }
    // Never dump an HTML error page into the operator's terminal; say what it was.
    throw new Error(
      `portal lesson-records HTTP ${res.status}` +
        (looksHtml ? ' (HTML error page)' : `: ${text.slice(0, 300)}`),
    );
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    void looksHtml;
    // The portal serves the login page with HTTP 200 when a token is not accepted, so a
    // non-JSON body is an auth failure, not a parse quirk. Recorded in LESSON_API_OPERATIONS.
    throw new Error(
      'portal returned a non-JSON body (HTTP 200 login page = token rejected); check EDUCATION_TO_PORTAL_SERVICE_TOKEN',
    );
  }
  return body;
}

async function fetchAll(base, token, from, to) {
  const records = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await fetchPage(base, token, from, to, offset);
    const batch = Array.isArray(body.records) ? body.records : [];
    records.push(...batch);
    if (!body.has_more) {
      const expected = Number(body.count);
      // A short read looks downstream like "these lessons had no recording" — the exact
      // confusion that hid this freeze for two months. Refuse rather than under-report.
      if (Number.isInteger(expected) && records.length !== expected) {
        throw new Error(`incomplete pagination: got ${records.length} of ${expected}`);
      }
      return records;
    }
    if (!batch.length) {
      throw new Error('portal reported has_more with an empty page; refusing to loop');
    }
    offset += batch.length;
  }
  throw new Error(`pagination exceeded ${MAX_PAGES} pages`);
}

function classify(row, existingByLesson, existingByUuid) {
  if (!row.lesson_uuid) return 'skipped_no_lesson';
  // Neither a merged file nor parts nor an explicit unavailable reason means there is
  // nothing to point at. Reported, never invented.
  if (!row.record_key && !(row.part_keys || []).length && !row.record_unavailable) {
    return 'skipped_no_object';
  }
  if (existingByLesson.has(row.lesson_uuid)) return 'already_present';
  // Same uuid against a DIFFERENT lesson is a conflict, not a duplicate: writing it
  // would move an existing record onto another lesson.
  if (existingByUuid.has(row.uuid)) return 'conflict_uuid_other_lesson';
  return 'to_create';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.apply && !args.dryRun) {
    throw new Error('one of --dry-run or --apply is required');
  }
  if (args.apply && args.dryRun) {
    throw new Error('--apply and --dry-run are mutually exclusive');
  }
  if (args.apply && (!args.confirmWrite || !args.approvalNote || !args.rollbackPlan)) {
    throw new Error('--apply requires --confirm-write, --approval-note, and --rollback-plan');
  }
  if (!args.from || !args.to) {
    throw new Error('--from and --to are required (YYYY-MM-DD)');
  }
  const from = new Date(`${args.from}T00:00:00Z`);
  const to = new Date(`${args.to}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('--from/--to must parse as dates');
  }
  if (to <= from) {
    throw new Error('--to must be after --from');
  }

  const base = requireEnv('PORTAL_API_URL');
  const token = requireEnv('EDUCATION_TO_PORTAL_SERVICE_TOKEN');
  const prisma = new PrismaClient();
  const report = {
    domain: 'education_lesson_record_ingest',
    generatedAt: new Date().toISOString(),
    writes: args.apply,
    range: { from: from.toISOString(), to: to.toISOString() },
    counts: {},
    samples: { toCreate: [], skippedNoObject: [], conflicts: [] },
    created: 0,
    createdUuids: [],
    approval: {
      requiredForApply: true,
      approvalNote: args.approvalNote || null,
      rollbackPlan: args.rollbackPlan || null,
    },
  };

  try {
    const portalRows = await fetchAll(base, token, from, to);
    report.counts.portalRows = portalRows.length;

    const lessonUuids = portalRows.map((r) => r.lesson_uuid).filter(Boolean);
    const existing = await prisma.lessonRecord.findMany({
      where: { OR: [{ lessonUuid: { in: lessonUuids } }, { uuid: { in: portalRows.map((r) => r.uuid) } }] },
      select: { uuid: true, lessonUuid: true },
    });
    const existingByLesson = new Set(existing.map((e) => e.lessonUuid));
    const existingByUuid = new Map(existing.map((e) => [e.uuid, e.lessonUuid]));

    const buckets = {
      to_create: [],
      already_present: [],
      skipped_no_lesson: [],
      skipped_no_object: [],
      conflict_uuid_other_lesson: [],
    };
    for (const row of portalRows) {
      buckets[classify(row, existingByLesson, existingByUuid)].push(row);
    }
    for (const [key, rows] of Object.entries(buckets)) {
      report.counts[key] = rows.length;
    }
    report.samples.toCreate = buckets.to_create.slice(0, 10).map((r) => ({
      uuid: r.uuid, lessonUuid: r.lesson_uuid, recordKey: r.record_key, partKeys: r.part_keys,
    }));
    report.samples.skippedNoObject = buckets.skipped_no_object.slice(0, 10).map((r) => r.lesson_uuid);
    report.samples.conflicts = buckets.conflict_uuid_other_lesson.slice(0, 10).map((r) => ({
      uuid: r.uuid, portalLessonUuid: r.lesson_uuid, localLessonUuid: existingByUuid.get(r.uuid),
    }));

    if (buckets.conflict_uuid_other_lesson.length) {
      throw new Error(
        `${buckets.conflict_uuid_other_lesson.length} portal record uuid(s) already exist against a ` +
          'DIFFERENT lesson locally; refusing to write. Reconcile these by hand.',
      );
    }

    let toCreate = buckets.to_create;
    if (args.limit > 0) toCreate = toCreate.slice(0, args.limit);
    report.counts.selected = toCreate.length;

    if (args.apply) {
      for (const row of toCreate) {
        await prisma.lessonRecord.create({
          data: {
            uuid: row.uuid,
            lessonUuid: row.lesson_uuid,
            recordKey: row.record_key || null,
            processed: Boolean(row.processed),
            recordUnavailable: row.record_unavailable || '',
            // Deliberately left null — backfill-lesson-record-durations.js probes the
            // object and fills it. Guessing a length here would be inventing payroll data.
            durationSeconds: null,
            parts: row.part_keys || [],
            ...(row.created ? { createdAt: new Date(row.created) } : {}),
          },
        });
        report.created += 1;
        report.createdUuids.push(row.uuid);
      }
    }

    console.log(JSON.stringify(report, null, 2));
    if (args.jsonReport) {
      writeFileSync(args.jsonReport, JSON.stringify(report, null, 2));
      console.error(`report written to ${args.jsonReport}`);
    }
    if (!args.apply) {
      console.error(`\nDRY RUN — would create ${report.counts.selected} row(s). No writes performed.`);
      console.error('After applying, run backfill-lesson-record-durations.js to fill durations.');
    } else {
      console.error(`\nCreated ${report.created} row(s). Rollback: DELETE FROM education_lessonrecord WHERE uuid IN (report.createdUuids).`);
      console.error('Durations are still NULL — run backfill-lesson-record-durations.js next.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`\nINGEST FAILED: ${error.message}\n`);
  process.exit(1);
});
