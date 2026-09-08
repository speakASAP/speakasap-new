# Integration Contract: SpeakASAP Platform

```yaml
id: INTEGRATION-CONTRACT-speakasap
status: approved
owner: project owner
created: 2026-08-30
last_updated: 2026-08-30
completeness_level: validated
upstream:
  - SYSTEM.md
  - BUSINESS.md
downstream:
  - docs/11_tasks/TASK-001-bootstrap-service.md
  - docs/12_validation/VAL-TASK-001-bootstrap-service.md
```

## purpose

This contract records the ecosystem dependencies required for SpeakASAP's education platform to operate correctly across its 12+ microservices, and the fallback behavior when a dependency degrades.

## capability decisions

| Capability | Component | Decision | Reason |
|---|---|---|---|
| auth | auth-microservice | required | All services validate student/teacher/operator identity via JWTs issued by auth-microservice before granting access to protected course, assessment, and payment APIs. |
| postgres | database-server (db-server-postgres) | required | Each service (content, certification, assessment, course, education, user, payment, notification, salary, financial) persists its domain data in its own speakasap_*_db PostgreSQL database. |
| redis | database-server (db-server-redis) | required | Services share a Redis cache via database-server:6379 for session/cache data as documented in SYSTEM.md. |
| logging | logging-microservice | required | All services publish centralized structured logs to logging-microservice:3367. |
| notifications | notifications-microservice | required | notification-service dispatches student/teacher email, Telegram, and WhatsApp notifications via notifications-microservice:3368. |
| ai | ai-microservice | required | AI-orchestrated grammar drill generation and validation agents (part of the drilling-assignments feature) call ai-microservice:3380, per SYSTEM.md. |
| payments | payments-microservice | required | payment-service delegates all course payment processing to payments-microservice:3468; this is an explicit business constraint (no direct payment processing in speakasap). |
| catalog | catalog-microservice | not-applicable | SpeakASAP is an education platform with its own course/content data model; it does not use the e-commerce product catalog domain. |
| orders | orders-microservice | not-applicable | Course enrollment and payment are handled within speakasap and payments-microservice; there is no e-commerce order-processing integration. |
| warehouse | warehouse-microservice | not-applicable | SpeakASAP has no physical inventory or warehouse concern. |
| invoices | invoices-microservice | not-applicable | Course payments are financial transactions handled by payments-microservice; no proforma/tax invoice workflow exists in this repository. |
| object-storage | minio-microservice | required | education-service stores teacher lesson recordings via a MinIO-backed storage service (`education-service/src/lesson-records/storage.service.ts`), and k8s manifests reference the minio-microservice Vault secret. |
| event-bus | RabbitMQ | not-applicable | No RabbitMQ/AMQP client usage was found in the repository; services integrate via direct HTTP calls to other microservices rather than the shared event bus. |
| docs-rag | docs-rag-microservice | required | The repository must remain discoverable through the ecosystem documentation index for bounded-context discovery, as already referenced in AGENTS.md. |
| monitoring | monitoring-microservice | required | Runtime health and rollout readiness for all 12+ services must be observable through the shared monitoring stack. |
| backups | backups-microservice | required | Per-service PostgreSQL databases are backed up via backups-microservice scripts, as referenced in the drilling-assignments rollout docs (`backups-microservice/scripts/backup-db.sh <db-name>`). |

## data ownership

Each SpeakASAP service owns its own PostgreSQL database (speakasap_*_db). payments-microservice owns payment-transaction data; auth-microservice owns identity. SpeakASAP does not duplicate ownership of data it does not author.

## authentication and authorization

- JWT validation is required on all protected student/teacher/operator routes across services and api-gateway.
- Unauthenticated requests to protected routes are rejected.
- Machine service identity follows only
  [`SERVICE_IDENTITY_CONSUMER_STANDARD.md`](../../../auth-microservice/docs/SERVICE_IDENTITY_CONSUMER_STANDARD.md).
  Intra-SpeakASAP hops use Auth-issued RS256 Bearer tokens validated via
  `/auth/validate` with explicit `internal:<target>:<role>` (pair env keys such as
  `GATEWAY_TO_<SERVICE>_TOKEN`, `EDUCATION_TO_PORTAL_SERVICE_TOKEN`,
  `PORTAL_TO_EDUCATION_SERVICE_TOKEN`, `AUTH_SERVICE_TOKEN`). Do not invent a
  parallel S2S credential model in this repository.

## synchronous dependencies

- JWT validation calls to auth-microservice
- Per-service PostgreSQL reads/writes
- Payment delegation calls to payments-microservice
- AI inference calls to ai-microservice for drill generation/validation
- Object storage calls to minio-microservice for lesson recordings

## asynchronous dependencies

- Notification dispatch to notifications-microservice for student/teacher messages
- Structured log delivery to logging-microservice

## degraded operation

When a dependency is degraded, the affected service must fail visibly (e.g. reject payment or upload actions) rather than silently succeeding; course/assessment/certification data already persisted in PostgreSQL remains available for read.

## validation

- `GET /health` passes on every deployed service
- Payment delegation smoke tests confirm payments-microservice connectivity
- Drill runner contract tests confirm no answer/alternatives leakage
