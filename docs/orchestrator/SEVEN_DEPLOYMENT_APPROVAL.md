# Seven Frontend/API Deployment Approval Packet

Date: 2026-06-13
Status: CLOSED — executed. Verified serving in production on 2026-09-08.

> Closure note (2026-09-08): the scoped deployment described below has run and
> the seven slice is live. This packet is retained as the historical record of
> the approval; it is no longer a pending request. See "Post-Execution
> Verification" below for the evidence.

## Request

After schema readiness, seven data apply, and media copy/routing gates are complete, approve a scoped deployment of only the services required for the seven-course public frontend/API:

- `speakasap-content` for `/api/v1/seven` public content reads.
- `speakasap-api-gateway` for `/api/v1/seven` upstream routing and anonymous `GET` access.
- `speakasap-frontend` for `/<languageCode>/seven` and `/<languageCode>/seven/<order>` pages.

This approval must not use the broad shared runner command
`/home/ssf/Documents/Github/shared/scripts/deploy.sh speakasap`, whose
`deploy.config.sh` contract builds and rolls out every SpeakASAP service.
The root `scripts/deploy.sh` is a retired refusal stub, not an alternative.

## Preconditions

Before deployment approval:

- `CONTENT_BASE_SCHEMA_APPROVAL.md` is completed and post-schema no-write reconciliation is clean.
- `SEVEN_DATA_MIGRATION_APPROVAL.md` is completed and post-apply no-write reconciliation shows planned rows exist.
- `SEVEN_MEDIA_MIGRATION_APPROVAL.md` is completed or every unresolved media ref has a documented fallback decision.
- `cd content-service && npm run prisma:validate && npm run build` passes.
- `cd api-gateway && npm run build` passes.
- `cd frontend && npm run build` passes.
- Current deployment images/digests are recorded for rollback.

## Current Baseline Smoke

Current deployed state is not yet ready for seven:

- `/tmp/speakasap-seven-deployment-smoke-current-v1.json` recorded `writes=false`, overall `ok=false`.
- Statuses: `health=200`, `courseApi=401`, `lessonsApi=401`, `lessonApi=401`, `coursePage=404`, `lessonPage=404`, `pdfHead=404`, `audioHead=404`.
- This is expected before deploying the seven gateway/frontend changes and before data/media are available.

## Post-Execution Verification (2026-09-08)

The pre-deployment baseline above is superseded. Read-only probes against
`https://speakasap.alfares.cz` and `https://assets.alfares.cz` recorded:

- `GET /api/v1/seven/courses` = `200`, returning 19 courses.
- `GET /en/seven` = `200`; `GET /en/seven/1` = `200` (previously `404`).
- Lesson totals across all 19 language codes: **136 lessons, 429 exercises** —
  matching the planned counts in `SEVEN_DATA_MIGRATION_APPROVAL.md` exactly.
- Rows carry `migrationBatch: "seven-content-legacy-20260613"` and
  `legacyTemplateBase` provenance from `speakasap-portal`.
- Media resolves: sampled `pdfHref` and audio `mediaRefs` for `de`, `en`, `ru`
  returned `200` (12/12 sampled URLs) under
  `https://assets.alfares.cz/media/{pdf,audio}/<lang>/`.
- `speakasap-content`, `speakasap-api-gateway`, and `speakasap-frontend` are
  running in `statex-apps`.

Note: bare `GET /api/v1/seven` returns `404`; only `/api/v1/seven/courses` and
`/api/v1/seven/courses/<lang>/lessons` serve. This appears intentional (no index
route) but is unconfirmed against the original intent.

Deployment image tags cannot be used as evidence of this operator's execution:
the three scoped services have been redeployed many times since by normal
auto-deploy on `main`, so their current tags reflect `HEAD`, not the migration.

## Proposed Scoped Deployment Shape

Use the gated deployment operator after explicit approval and after schema/data/media execution reports exist:

```bash
cd /home/ssf/Documents/Github/speakasap
SEVEN_DEPLOY_APPROVAL_TEXT='Approved to deploy only the seven-course content-service, api-gateway, and frontend changes to Kubernetes after schema/data/media gates are complete, then run the seven deployment smoke and browser typography QA. Do not restart unrelated SpeakASAP services and do not run data/media rollback or legacy route retirement.' \
SCHEMA_EXECUTION_REPORT=/tmp/speakasap-seven-schema-apply-execution-v1.json \
DATA_EXECUTION_REPORT=/tmp/speakasap-seven-content-apply-execution-v1.json \
MEDIA_EXECUTION_REPORT=/tmp/speakasap-seven-media-copy-execution-v1.json \
  scripts/deploy-seven-approved.sh --execute
```

The operator refuses to run without `--execute`, exact
`SEVEN_DEPLOY_APPROVAL_TEXT`, and `ok=true` schema/data/media execution reports.
It acquires the ecosystem deploy lock, captures predeploy Deployment JSON,
builds and pushes only the scoped images, applies only the scoped service
manifests plus ingress, restarts only the scoped Deployments, waits through
`shared/scripts/wait-for-rollout.sh` for `speakasap-content`,
`speakasap-api-gateway`, and `speakasap-frontend`, runs the deployment smoke,
and writes `/tmp/speakasap-seven-deploy-execution-v1.json`.

Do not reproduce the operator's build, push, apply or restart steps manually.
The operator is the single approved execution path for this scoped rollout.

## Required Post-Deploy Smoke

Run the no-write smoke checker:

```bash
cd /home/ssf/Documents/Github/speakasap
scripts/check-seven-deployment-smoke.py --base-url https://speakasap.alfares.cz --assets-base-url https://assets.alfares.cz --language-code en --lesson-order 1 --json-report /tmp/speakasap-seven-deploy-smoke-v1.json
```

Expected post-deploy result:

- `healthOk=true`.
- `courseApiOk=true`, `lessonsApiOk=true`, `lessonApiOk=true`.
- `coursePageOk=true`, `lessonPageOk=true`.
- `pdfOk=true` and `audioOk=true` for the selected smoke language/order, or an explicit documented media fallback decision.
- Browser/rendered QA is required after this script for typography and interaction parity on desktop/mobile. Run `node scripts/check-seven-postdeploy-visual-qa.js --base-url https://speakasap.alfares.cz --language-code en --lesson-order 1 --json-report /tmp/speakasap-seven-postdeploy-visual-qa-v1.json --screenshot-dir /tmp/speakasap-seven-visual-qa-v1` and attach the JSON plus screenshots to the completion evidence.

## Rollback Boundary

Rollback must use the pre-deploy image digests/manifests captured immediately before rollout:

- Set `speakasap-content`, `speakasap-api-gateway`, and/or `speakasap-frontend` back to previous image digests.
- Reapply previous ingress/media routing manifest if changed.
- Do not rollback database rows or media objects as part of deployment rollback unless separately approved with data/media rollback evidence.

## Required Approval Wording

Use explicit wording like:

> Approved to deploy only the seven-course content-service, api-gateway, and frontend changes to Kubernetes after schema/data/media gates are complete, then run the seven deployment smoke and browser typography QA. Do not restart unrelated SpeakASAP services and do not run data/media rollback or legacy route retirement.

Without that explicit approval, do not deploy or change routing.
