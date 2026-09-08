# Agents: SpeakASAP Platform

## required reading

Before implementation, read:

- `README.md`
- `BUSINESS.md`
- `SYSTEM.md`
- `AGENTS.md`
- `AGENT_OPERATIONS.md`
- `TASKS.md`
- `STATE.json`
- `docs/17_governance/PROJECT_INVARIANTS.md`
- `docs/01_vision/VISION.md`

## authority

Operators and agent workers may act only within the approved project intent, scope boundaries, and validation gates in this repository. Human approval is required for scope changes or production deployment decisions.

## Service-to-service authentication
For machine service identity, follow the sole canonical [`SERVICE_IDENTITY_CONSUMER_STANDARD.md`](../auth-microservice/docs/SERVICE_IDENTITY_CONSUMER_STANDARD.md). It is not reproduced here.

## intent preservation system

The project preserves the chain:

`Vision -> Goal Impact -> System -> Feature -> Task -> Execution Plan -> Coding Prompt -> Code -> Validation`

This is the binding requirement for planning, coding, and validation work.

## safety and operations

- Never commit secrets, credentials, or raw production data
- Keep the system grounded in proven repository facts
- Use `[MISSING: ...]` or `[UNKNOWN: ...]` instead of inventing facts
- Keep validation debt separate from current-task failures
- Prefer the narrowest valid validation command before broad test suites

## project-specific rules

- Follow the SpeakASAP orchestrator pack (`docs/orchestrator/MASTER_PROMPT.md`, `IMPLEMENTATION_ORCHESTRATOR.md`, `INTENT.md`, `INTENT_PRESERVATION_SYSTEM.md`, `GOALS.md`, `PLAN.md`) before planning or implementing migration work
- Every migration chunk must preserve original portal behavior: record context, legacy evidence, ownership, dry-run/reconciliation evidence, verification, approval status, and rollback plan before committing
- Drill runner responses must never include `answer` or `alternatives` — this is a hard invariant
- Table renames in content-service/education-service require hand-written `ALTER TABLE RENAME` migrations; `prisma migrate diff` renders renames as destructive drop+create
- The owner permits AI/Codex sessions to commit directly only inside `/home/ssf/Documents/Github/speakasap`

## required final report

The final task report must include:

- files changed
- documents created or revised
- validation commands and results
- validation debt used or created
- active blockers as `[MISSING: ...]` or `[UNKNOWN: ...]`
- deviations from scope
- next concrete action
