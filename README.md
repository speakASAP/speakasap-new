# SpeakASAP Platform

SpeakASAP is the new platform for the language-learning business. It is being refactored from the legacy `speakasap-portal` into modern services. The migration is partial: new functionality is already being introduced on `speakasap`, while capabilities that have not yet been migrated remain on the legacy portal.

SpeakASAP is part of the Alfares ecosystem.

## status

SpeakASAP is an active production education platform on Kubernetes. This repository is the new NestJS/Next.js microservice monorepo replacing the legacy `speakasap-portal` Django app; migration is in progress under the intent-preservation orchestrator pack in `docs/orchestrator/`.

The migration is currently economically selective. SpeakASAP’s student base is much smaller than before, so further migration should be funded by clear reliability, security, operational, or revenue value rather than by a blanket rewrite objective.

## documentation authority

- `BUSINESS.md` for approved product intent, migration boundaries, business ownership, and recovery strategy
- `SYSTEM.md` for current architecture, services, ports, integrations, and deployment facts
- `docs/orchestrator/*` for the migration orchestrator pack (MASTER_PROMPT, GOALS, PLAN, STATE.json)
- `AGENTS.md` for repository agent instructions
- The legacy `speakasap-portal` documentation for behavior and data reference until each capability is replaced

## capabilities

- Language-learning course delivery, lessons and content management (content-service)
- Assessments and certifications (assessment-service, certification-service)
- Course/education workflows including teacher-assigned and self-serve grammar drills (course-service, education-service)
- Student/user account management (user-service)
- Course payments (payment-service, via payments-microservice)
- Salary and recording-duration payroll for teachers (salary-service, financial-service)
- Student notifications via email/Telegram/WhatsApp (notification-service)
- Unified API entry point (api-gateway) and web frontend (frontend)

The exact list of migrated capabilities changes over time. Do not assume that a new service has replaced the corresponding legacy workflow until the migration evidence and production state say so.

## migration model

1. Select a capability with a clear business, reliability, security, or operational reason to move.
2. Document the legacy behavior, data contract, dependencies, and invariants.
3. Implement the capability on `speakasap` using the approved service boundary.
4. Reconcile migrated data and compare behavior against the legacy reference.
5. Run validation, rollback, and production-readiness checks.
6. Release the new capability while keeping the legacy path available until cutover is approved.
7. Record the migration state and only then consider decommissioning the replaced path.

## interfaces

- `api-gateway` unified HTTP entry point on port 4210
- Next.js frontend on port 4211
- Per-service REST APIs on ports 4201-4213 (see Services & Ports table)
- Per-service PostgreSQL databases (speakasap_*_db) via `database-server`
- Shared Redis cache via `database-server`
- Payment integration via `payments-microservice`
- Secret delivery via Vault and External Secrets Operator
- Structured logging via `logging-microservice:3367`

Use `SYSTEM.md` and the current architecture records for the authoritative service and port table. Do not treat this README as a substitute for the live deployment configuration.

## development

- Stack: NestJS microservices (42xx port range), Next.js frontend, PostgreSQL, and Redis
- Local secrets: `./shared/scripts/vault-env-gen.sh speakasap prod` generates `.env`
- Local run: `docker compose up` after `.env` generation
- Per-service tests run with each service's own Jest config; see `jest.config.base.js`
- Keep migration changes small, traceable, reversible, and independently deployable
- Do not change legacy behavior or data contracts without updating the migration evidence and validation chain

## configuration

- Runtime namespace: `statex-apps`
- Secrets: Vault `secret/prod/speakasap` -> External Secrets Operator -> Kubernetes Secrets -> pod `envFrom`
- Kubernetes manifests: `k8s/services/*.yaml`
- Deploy config: `deploy.config.sh`
- Never commit secret values, customer data, recordings, payment credentials, or production exports
- Keep legacy and new-platform configuration boundaries explicit during the migration

## deployment

- Deploy command: `./scripts/deploy.sh` (or repo-standard `shared/scripts/deploy.sh` from the ecosystem root)
- Target: Kubernetes `statex-apps` namespace on the single-node `alfares` k3s cluster
- Rollout restart per-service: `kubectl rollout restart deployment/<svc> -n statex-apps`
- Deployment is serialized via the shared ecosystem deploy lock
- The legacy portal remains deployed separately until the owner approves its replacement or retirement

## health and observability

- Health endpoint: `GET /health` on each service and on api-gateway
- Structured logging via `logging-microservice:3367`
- Notifications/escalation via `notifications-microservice:3368`
- Database backups via `backups-microservice` (`backup-db.sh <db-name>` per service database)
- Monitor login, course access, payment flow, assessment/certification behavior, notifications, recording access, migration reconciliation, and service health

## business recovery direction

The technology migration is not itself the recovery strategy. SpeakASAP previously generated approximately €50,000 per month, while the current student base and revenue are substantially lower. The recommended approach is to validate demand and unit economics before financing a full migration.

Priority experiments are former-student reactivation, outcome-based language programs, focused high-demand language segments, corporate language learning, teacher/partner distribution, and—only after the platform is sufficiently mature—white-label or managed language-school operation.

For each experiment measure paid conversion, activation, retention, completion, CAC, LTV, and payback period. Use the results to decide which migration chunks deserve further investment.

## commercial positioning

SpeakASAP can eventually be offered as the platform behind a proven multilingual education operation, not simply as unfinished legacy replacement code. Potential offers include direct-to-consumer courses, corporate per-seat learning, white-label portals, managed language-school infrastructure, and implementation/content migration services.

Before white-label or licensing sales, define tenant isolation, data ownership, content licensing, support levels, service-level expectations, and the modernization roadmap.

## future development

- Complete only migration chunks justified by measurable value
- Stable APIs and identity continuity across legacy and new services
- Learner progress, placement, retention, and cohort analytics
- AI-assisted practice, pronunciation, writing, and conversation assessment
- Corporate organisations, learner groups, reporting, and invoicing
- Teacher and partner self-service
- Mobile and partner channels where demand validates the investment
- Multi-tenant branding and stronger B2B data isolation
- Marketing attribution and conversion experimentation
- Reconciliation, replay, rollback, and decommissioning tooling for every migration stage
