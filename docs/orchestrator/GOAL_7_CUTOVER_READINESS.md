# Goal 7 Cutover Readiness - Lesson Recording Workflow

Date: 2026-06-13

Status: readiness evidence captured; cutover is **not approved** by this document.

## Scope

This document covers operational readiness for the migrated lesson-recording workflow on `https://speakasap.alfares.cz`:

- Next.js frontend routes:
  - `/learner/lessons/:lessonUuid/record`
  - `/teacher/lessons/:lessonUuid/record`
- API gateway routes under `/api/v1/lessons/:lessonUuid/record`
- `speakasap-education` lesson-recording runtime
- Private recording media access through scoped gateway download tokens and short-lived SigV4 PUT presign URLs

No legacy retirement, DNS change, object mutation, merge/delete execution, rollback execution, database write, or deployment was performed during this readiness pass.

## Ownership Boundaries

| Boundary | Owner | Readiness result |
| --- | --- | --- |
| Public frontend | `speakasap-frontend` | Root, learner, and teacher pages return `200` through ingress. |
| Gateway/auth contract | `speakasap-api-gateway` + `auth-microservice` | Protected record API without bearer token returns `401`; authorized parity evidence exists from Goal 6.3. |
| Recording metadata and domain checks | `speakasap-education` | Goal 5 and Goal 6 smoke/parity reports verify selected migrated workflows. |
| Private object storage | `minio-microservice`; accessed by education runtime only | Private media is exposed only through scoped tokenized download or short-lived SigV4 PUT presign. |
| Secrets | Vault -> ESO -> K8s Secret | ExternalSecrets are `SecretSynced=True`; required key names are present without printing values. |
| Logging | `logging-microservice` config plus pod logs | Runtime config points at logging service; sampled pod logs show zero warning/error/fatal matches. |

## Evidence Files

- Operational report: `/tmp/speakasap-goal7-operational-readiness.json`
- Authorized frontend parity report: `/tmp/speakasap-goal63-frontend-parity-browser-report.json`
- Backend gateway smoke: `/tmp/speakasap-goal55-gateway-smoke-20260613-v5.json`
- Redacted frontend screenshots:
  - `/tmp/speakasap-goal63-learner-paid-state.png`
  - `/tmp/speakasap-goal63-learner-unpaid-denied.png`
  - `/tmp/speakasap-goal63-teacher-unassigned-denied.png`

## Live Kubernetes Evidence

Affected deployments are rolled out and ready in namespace `statex-apps`:

| Deployment | Ready | Restarts | Image digest |
| --- | --- | --- | --- |
| `speakasap-frontend` | `1/1` | `0` | `sha256:d1c0c00fb01cf82a1355b72dc8ddedc5c2aec0c1d1cd910fadf68937e09ef402` |
| `speakasap-api-gateway` | `1/1` | `0` | `sha256:d5568fd64226473d7474089030104bb3161b8d2803993ded799e530db3ac9763` |
| `speakasap-education` | `1/1` | `0` | `sha256:776f5086ccf2d578f4de84ac34b7bde7a051890ac0c26287471e78842d6371f1` |

Live service endpoints exist:

- `speakasap-frontend`: `4211`
- `speakasap-api-gateway`: `4210`
- `speakasap-education`: `4206`

Ingress `speakasap` routes:

- `/health` -> `speakasap-api-gateway:4210`
- `/api` -> `speakasap-api-gateway:4210`
- `/` -> `speakasap-frontend:4211`

## Public Smoke URLs

| URL | Expected | Observed |
| --- | --- | --- |
| `https://speakasap.alfares.cz/` | frontend HTML `200` | `200 text/html; charset=utf-8` |
| `https://speakasap.alfares.cz/health` | gateway health `200` | `200 application/json; charset=utf-8` |
| `https://speakasap.alfares.cz/api/v1/lessons/7d870263-bdcb-4bba-b25e-1f6b40402411/record` without bearer | protected API rejection | `401 application/json; charset=utf-8` |
| `https://speakasap.alfares.cz/learner/lessons/7d870263-bdcb-4bba-b25e-1f6b40402411/record` | frontend route `200` | `200 text/html; charset=utf-8` |
| `https://speakasap.alfares.cz/teacher/lessons/7d870263-bdcb-4bba-b25e-1f6b40402411/record` | frontend route `200` | `200 text/html; charset=utf-8` |

## Secret And Runtime Checks

ExternalSecrets:

- `speakasap-education-secret`: `SecretSynced=True`
- `speakasap-secret`: `SecretSynced=True`

Required education secret key names are present:

- `DATABASE_URL`
- `DB_PASSWORD`
- Machine identity follows the [Service Identity Consumer Standard](../../../auth-microservice/docs/SERVICE_IDENTITY_CONSUMER_STANDARD.md) (pair RS256 bearer env key for each caller→target; not a shared opaque `JWT_TOKEN`)
- `RECORDS_S3_ACCESS_KEY`
- `RECORDS_S3_BUCKET`
- `RECORDS_S3_ENDPOINT_URL`
- `RECORDS_S3_HELPER_URL`
- `RECORDS_S3_REGION_NAME`
- `RECORDS_S3_SECRET_KEY`
- `RECORDS_S3_VERIFY_SSL`

Root SpeakASAP secret key names include:

- `DATABASE_URL`
- `DB_PASSWORD`
- `JWT_SECRET` (human/user lane material only — not machine S2S)
- Pair service JWTs for outbound callers per [Service Identity Consumer Standard](../../../auth-microservice/docs/SERVICE_IDENTITY_CONSUMER_STANDARD.md)
- `PAYMENT_APPLICATION_ID`
- `PAYMENT_WEBHOOK_API_KEY` (provider webhook verification — not Alfares S2S)

Do **not** treat opaque `JWT_TOKEN` or `PAYMENT_API_KEY` as the service-to-service protocol.

OpenSSL runtime versions:

- `speakasap-frontend`: `3.5.5`
- `speakasap-api-gateway`: `3.5.5`
- `speakasap-education`: `3.5.4`

`education-service/Dockerfile` sets `PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x`; the deployed education pod has already passed Prisma-backed runtime and lesson-record smoke checks.

## Logging And Events

Sampled logs from the affected deployments showed zero `warn`, `error`, `exception`, or `fatal` matches:

- `speakasap-frontend`: `0`
- `speakasap-api-gateway`: `0`
- `speakasap-education`: `0`

SpeakASAP-specific events showed normal frontend rollout activity. One transient readiness probe failure occurred on an old frontend pod during replacement; the current frontend pod is `1/1 Running` with `0` restarts.

## Cutover Checklist

Cutover remains blocked until the owner explicitly approves it after reviewing this checklist.

Before cutover:

- Confirm this document and `/tmp/speakasap-goal7-operational-readiness.json` are current.
- Re-run authorized frontend parity with fresh learner/teacher/staff JWTs if more than one cutover window has elapsed.
- Re-run public smoke URLs and confirm the same expected statuses.
- Confirm no `warn`, `error`, `exception`, or `fatal` log matches in affected deployments.
- Confirm ExternalSecrets are still `SecretSynced=True`.
- Confirm `speakasap-frontend`, `speakasap-api-gateway`, and `speakasap-education` are rolled out with zero restarts.
- Confirm the owner has approved any production traffic routing or legacy retirement step.
- Confirm rollback owner, rollback window, and monitoring contact before changing traffic.

During cutover:

- Do not run destructive merge/delete, object deletion, migration rerun, or rollback unless separately approved.
- Keep the legacy portal available until post-cutover smoke and monitoring pass.
- Monitor frontend, gateway, education, auth, MinIO, and logging service health.
- Check protected route behavior before and after any routing change.

Post-cutover smoke:

- Frontend root returns `200`.
- Learner recording route returns `200`.
- Teacher recording route returns `200`.
- Protected record API without token returns `401`.
- Paid learner playback returns tokenized gateway download and range `206`.
- Unpaid learner playback returns `403`.
- Assigned teacher/staff presign returns `201` with `900s` expiry.
- Unassigned teacher presign returns `403`.
- No response exposes a permanent public recording URL.

## Rollback Plan

Rollback must be owner-approved if users have interacted with migrated data or if traffic has been switched.

Non-destructive deployment rollback commands:

```bash
/home/ssf/Documents/Github/shared/scripts/with-deploy-lock.sh bash -lc \
  'kubectl rollout undo deployment/speakasap-frontend -n statex-apps &&
   kubectl rollout undo deployment/speakasap-api-gateway -n statex-apps &&
   kubectl rollout undo deployment/speakasap-education -n statex-apps &&
   /home/ssf/Documents/Github/shared/scripts/wait-for-rollout.sh -n statex-apps -t 180 speakasap-frontend speakasap-api-gateway speakasap-education'
```

Ingress rollback options:

- Re-apply the last owner-approved ingress manifest from git history.
- If frontend routing is the incident source, route `/` back to the prior approved service while preserving `/api` and `/health` gateway routing.
- Do not remove or expose private recording object keys as part of ingress rollback.

Data/object rollback:

- Lesson-record metadata rollback remains tied to the prior Goal 5 rollback SQL artifacts.
- Object-storage mutation rollback is not covered by this document and requires separate owner approval and object-level evidence.

## Gate Decision

Goal 7.1 operational readiness evidence is sufficient to prepare an owner cutover decision packet.

Cutover itself remains blocked until explicit owner approval records:

- exact traffic or legacy-route change;
- rollback window and owner;
- monitoring commands;
- acceptance smoke list;
- approval date and approver.
