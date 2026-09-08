# Seven Runtime Approval Sequence

Date: 2026-06-13
Status: CLOSED — all six gates executed. Verified serving in production on 2026-09-08.

> Closure note (2026-09-08): gates 1-6 have run and the seven slice is live
> (19 courses, 136 lessons, 429 exercises, media resolving). This runbook is
> retained as the historical record of the approved order. The gated operators
> it names were one-shot migration tooling and their work is complete; do not
> re-run them. Verification evidence is in
> `docs/orchestrator/SEVEN_DEPLOYMENT_APPROVAL.md`.

## Purpose

This runbook fixes the only approved order for moving the legacy seven-course frontend/content slice from no-write preparation to production readiness.

The order is intentionally linear:

1. schema
2. data
3. media
4. deploy
5. visual QA
6. runtime evidence

Do not skip ahead. A later approval does not imply any earlier approval, and an earlier approval does not imply later data, media, deployment, route-retirement, or rollback approval.

## Gate 1: Schema

Approval packet: `docs/orchestrator/CONTENT_BASE_SCHEMA_APPROVAL.md`.

Exact approval text:

```text
Approved to apply pending content-service Prisma migrations to the Kubernetes content database for base schema readiness and seven schema creation only, then run DB-backed no-write reconciliation. No seven data apply, deploy, object mutation, or legacy route retirement is approved.
```

Operator:

```bash
cd /home/ssf/Documents/Github/speakasap
SEVEN_SCHEMA_APPROVAL_TEXT='Approved to apply pending content-service Prisma migrations to the Kubernetes content database for base schema readiness and seven schema creation only, then run DB-backed no-write reconciliation. No seven data apply, deploy, object mutation, or legacy route retirement is approved.' \
  scripts/apply-seven-schema-approved.sh --execute
```

Required evidence:

- `/tmp/speakasap-seven-schema-apply-execution-v1.json`
- `/tmp/speakasap-seven-post-schema-reconciliation-v1.json`

Boundary: this gate must not import seven content rows, copy media, deploy services, mutate public routing, run rollback, or retire legacy routes.

## Gate 2: Data

Approval packet: `docs/orchestrator/SEVEN_DATA_MIGRATION_APPROVAL.md`.

Exact approval text:

```text
Approved to run the seven content data apply against the Kubernetes content database with `--include-languages`, importing only the 19 language rows, 19 seven courses, 136 seven lessons, and 429 seven exercises from the legacy portal evidence. No deployment, object mutation, media copy, final test migration, private progress migration, paid-product change, or legacy route retirement is approved.
```

Operator:

```bash
cd /home/ssf/Documents/Github/speakasap
SEVEN_DATA_APPROVAL_TEXT='Approved to run the seven content data apply against the Kubernetes content database with `--include-languages`, importing only the 19 language rows, 19 seven courses, 136 seven lessons, and 429 seven exercises from the legacy portal evidence. No deployment, object mutation, media copy, final test migration, private progress migration, paid-product change, or legacy route retirement is approved.' \
SCHEMA_RECONCILIATION_REPORT=/tmp/speakasap-seven-post-schema-reconciliation-v1.json \
ROLLBACK_PLAN=/tmp/speakasap-seven-content-rollback-v1.sql \
  scripts/apply-seven-data-approved.sh --execute
```

Required evidence:

- `/tmp/speakasap-seven-content-rollback-v1.sql`
- `/tmp/speakasap-seven-content-apply-execution-v1.json`
- `/tmp/speakasap-seven-content-post-apply-v1.json`

Boundary: this gate must not deploy services, copy media, mutate object storage, change public routing, run rollback, migrate final tests, migrate private progress, alter paid products, or retire legacy routes.

## Gate 3: Media

Approval packet: `docs/orchestrator/SEVEN_MEDIA_MIGRATION_APPROVAL.md`.

Exact approval text:

```text
Approved to copy and route only public seven-course `/media/audio/...` and `/media/pdf/...` assets identified by `/tmp/speakasap-seven-media-copy-manifest-v3.json` from `https://speakasap.com` to the asset host serving `https://assets.alfares.cz/media/...`. No private media, unrelated media, destructive cleanup, final test migration, paid-product change, or legacy route retirement is approved.
```

Operator:

```bash
cd /home/ssf/Documents/Github/speakasap
SEVEN_MEDIA_APPROVAL_TEXT='Approved to copy and route only public seven-course `/media/audio/...` and `/media/pdf/...` assets identified by `/tmp/speakasap-seven-media-copy-manifest-v3.json` from `https://speakasap.com` to the asset host serving `https://assets.alfares.cz/media/...`. No private media, unrelated media, destructive cleanup, final test migration, paid-product change, or legacy route retirement is approved.' \
MEDIA_COPY_MANIFEST=/tmp/speakasap-seven-media-copy-manifest-v3.json \
MEDIA_TARGET_ROOT=/absolute/path/served/by/assets-host \
  scripts/copy-seven-media-approved.sh --execute
```

Required evidence:

- `/tmp/speakasap-seven-media-copy-execution-v1.json`
- `/tmp/speakasap-seven-media-postcopy-v1.json`

Boundary: this gate must not deploy services, copy private or unrelated media, delete legacy media, run destructive cleanup, migrate final tests, alter paid products, or retire legacy routes.

## Gate 4: Deploy

Approval packet: `docs/orchestrator/SEVEN_DEPLOYMENT_APPROVAL.md`.

Exact approval text:

```text
Approved to deploy only the seven-course content-service, api-gateway, and frontend changes to Kubernetes after schema/data/media gates are complete, then run the seven deployment smoke and browser typography QA. Do not restart unrelated SpeakASAP services and do not run data/media rollback or legacy route retirement.
```

Operator:

```bash
cd /home/ssf/Documents/Github/speakasap
SEVEN_DEPLOY_APPROVAL_TEXT='Approved to deploy only the seven-course content-service, api-gateway, and frontend changes to Kubernetes after schema/data/media gates are complete, then run the seven deployment smoke and browser typography QA. Do not restart unrelated SpeakASAP services and do not run data/media rollback or legacy route retirement.' \
SCHEMA_EXECUTION_REPORT=/tmp/speakasap-seven-schema-apply-execution-v1.json \
DATA_EXECUTION_REPORT=/tmp/speakasap-seven-content-apply-execution-v1.json \
MEDIA_EXECUTION_REPORT=/tmp/speakasap-seven-media-copy-execution-v1.json \
  scripts/deploy-seven-approved.sh --execute
```

Required evidence:

- `/tmp/speakasap-seven-deploy-execution-v1.json`
- `/tmp/speakasap-seven-deploy-smoke-v1.json`

Boundary: this gate must not use the broad shared runner command
`/home/ssf/Documents/Github/shared/scripts/deploy.sh speakasap`, restart
unrelated services, run rollback, import data, copy media, or retire legacy
routes. The root `scripts/deploy.sh` is retired and must remain a refusal stub.

## Gate 5: Visual QA

Run only after deploy smoke exists and is passing:

```bash
cd /home/ssf/Documents/Github/speakasap
node scripts/check-seven-postdeploy-visual-qa.js \
  --base-url https://speakasap.alfares.cz \
  --language-code en \
  --lesson-order 1 \
  --json-report /tmp/speakasap-seven-postdeploy-visual-qa-v1.json \
  --screenshot-dir /tmp/speakasap-seven-visual-qa-v1
```

Required evidence:

- `/tmp/speakasap-seven-postdeploy-visual-qa-v1.json`
- `/tmp/speakasap-seven-visual-qa-v1`

Boundary: visual QA is read-only browser verification. It must not approve deployment, data, media, rollback, or legacy route retirement.

## Gate 6: Runtime Evidence And Completion Audit

Run after all prior runtime evidence exists:

```bash
cd /home/ssf/Documents/Github/speakasap
python3 scripts/check-seven-runtime-evidence.py --json-report /tmp/speakasap-seven-runtime-evidence-v1.json
python3 scripts/check-seven-no-write-suite.py --json-report /tmp/speakasap-seven-no-write-suite-final.json
```

Expected completion evidence:

- `/tmp/speakasap-seven-runtime-evidence-v1.json` has `writes=false`, `ok=true`, and `complete=true`.
- The final completion audit has no missing requirements.
- `docs/orchestrator/SEVEN_INTENT_PRESERVATION_EVIDENCE.md`, `docs/orchestrator/STATUS.md`, `TASKS.md`, and `docs/orchestrator/IMPLEMENTATION_STATE.md` are updated with evidence.

## Explicit Non-Approval

This runbook does not approve:

- target database schema migration;
- seven content data apply;
- media download, media copy, object mutation, or media route change;
- image build, push, Kubernetes apply, rollout, or public cutover;
- data rollback, media rollback, deployment rollback, destructive cleanup;
- legacy route retirement.

Each action still requires the exact approval text from its own packet and a passing gated operator precondition.
