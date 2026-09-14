# Business: SpeakASAP Platform

> SpeakASAP is the modern platform for the language-learning business. It is part of the Alfares ecosystem.

```yaml
id: BUSINESS-speakasap
status: approved
owner: project owner
created: 2026-08-30
last_updated: 2026-09-14
completeness_level: validated
business: SpeakASAP
alfares_ecosystem: false
migration_status: partial
production_status: active_partial
upstream:
  - docs/01_vision/VISION.md
  - docs/00_constitution/CONSTITUTION.md
downstream:
  - SYSTEM.md
  - docs/orchestrator/*
  - docs/22_goal_impact/GOAL-IMPACT-TASK-001.md
  - repository architecture and deployment documentation
```

## Problem

The original SpeakASAP language-learning business needs a modern, maintainable microservice platform for online language-learning education, replacing the legacy Django 1.11 portal, while preserving existing student, course, assessment, certification, and payment behavior without silently changing product intent.


The challenge is to modernize without interrupting the remaining students or losing proven business behavior. The migration must also remain economically rational: the business previously generated approximately €50,000 per month, but the current student base and revenue are much lower, so a full migration is not currently justified by technology alone.

## Target Users and Stakeholders

- Language-learning students enrolled in courses
- Teachers assigning and grading drills, recording lessons, and receiving payroll
- Platform operators maintaining the legacy portal and the new `speakasap` services.
- Business owners deciding whether and how to restart growth.
- Future corporate customers, language schools, and partners using the platform.
- The legacy `speakasap-portal`, which remains the behavior and data reference during migration.

## Value Proposition

SpeakASAP turns the legacy monolithic portal into an interconnected, independently deployable microservice platform, preserving course continuity, assessment/certification integrity, and payment correctness while enabling new features (e.g. drilling assignments) without destabilizing the live student base.

Its value is controlled modernization: new features can be developed on supported technologies, migration can happen in small validated increments, and the live legacy business does not need to be replaced in one risky cutover.

## Current Operating Position

The `speakasap` platform is in partial production use. Data and functionality are being transferred from the legacy portal, some new functions already run on the new platform, and remaining functions continue to run on the legacy portal. The migration is intentionally paused or slowed where the expected business return does not justify further engineering effort.

The platform belongs to the Alfares infrastructure service.

The canonical project name is **SpeakASAP**. The legacy repository is `speakasap-portal`, and the new platform repository/service is `speakasap`.

## Goals

- Deliver online language education: courses, lessons, assessments, certifications, and payments
- Migrate legacy portal behavior deliberately, with intent preservation and rollback evidence for every migration chunk
- Support teacher-assigned and self-serve grammar drills across content, education, notification, and AI services
- Keep student data private and GDPR-compliant
- Process payments exclusively through `payments-microservice`
- Preserve uninterrupted access to existing student and teacher workflows.
- Move selected capabilities from the legacy portal to modern services incrementally.
- Preserve data integrity, identity continuity, payment correctness, privacy, and behavioral compatibility for every migration chunk.
- Enable new learning features without expanding the legacy codebase unnecessarily.
- Keep migration reversible until the replacement capability is proven in production.
- Create a platform that can support a renewed SpeakASAP growth strategy if demand and unit economics recover.
- Provide a foundation for direct-to-consumer, corporate, partner, and potential white-label education offerings.

## Non-Goals

- Rebuilding the legacy Django portal itself (it remains SSH read-only, never migrating as an app server)
- Shutting down the legacy portal before its capabilities, data, and operational behavior have been replaced and validated.
- Treating the new platform as a generic product unrelated to SpeakASAP’s education business.
- Expanding infrastructure or service count without a student, revenue, reliability, or migration benefit.
- Processing payments outside `payments-microservice`.
- Returning drill answers or alternatives to the browser.

## Success Metrics

### Platform and Migration

- Each migrated capability has recorded intent-preservation evidence, compatibility checks, data-integrity validation, and rollback evidence.
- No loss of student, course, payment, assessment, certification, or recording data.
- New capabilities can be deployed independently without destabilizing the legacy portal.
- Students can use a consistent identity and access path across legacy and new functionality.

### Business Recovery

- Monthly active learners, paid conversion, retention, average revenue per learner, and course completion trend upward.
- Customer-acquisition cost, payback period, and learner lifetime value are measured for every growth experiment.
- Reactivation of former students produces measurable paid conversions before large-scale platform investment.
- The business establishes a repeatable profitable segment before funding a complete migration.

The historical approximately €50,000 monthly revenue is a reference point for recovery ambition, not a current forecast or guaranteed target.

## Business Constraints

- Payment processing via `payments-microservice` only
- Student data is private and must remain GDPR compliant
- Drill runner responses must never include `answer` or `alternatives` keys
- Escalation contact: owner Telegram @sergej_partizan
- The legacy portal remains operational while migration is partial; both systems must be considered in release and support planning.
- Production migration requires explicit validation and rollback evidence.
- The new platform currently uses the Kubernetes `statex-apps` environment and shared infrastructure documented by `SYSTEM.md`; this does not change the business ownership boundary.
- Migration and infrastructure work must be justified against the current student base, revenue opportunity, and operational risk.
- Legacy behavior and data remain protected until the new implementation is demonstrably equivalent for the relevant capability.

## Business Recovery and Growth Opportunity

The main question is not whether the technology can be refactored; it is whether a focused education offer can regain demand profitably. The recommended sequence is to validate a narrow commercial segment first and then fund only the migration needed to serve it.

### Potential Recovery Directions

- **Reactivation:** contact former students with targeted continuation paths, level assessments, new cohorts, and time-limited re-entry offers.
- **Outcome-based programs:** package language marathons, exam preparation, relocation language, interview preparation, and measurable proficiency outcomes instead of selling an undifferentiated catalogue.
- **Corporate learning:** offer employer-sponsored language programs with cohorts, progress reporting, administration, and per-seat pricing.
- **Focused language verticals:** use demand and margin data to prioritize a small number of languages and customer segments rather than marketing all 18 languages equally.
- **Teacher and partner distribution:** allow selected teachers or schools to bring learners onto the platform with revenue sharing and controlled content administration.
- **White-label or managed platform:** after the new platform is stable, provide accounts, courses, materials, recordings, assessments, certificates, and payments for smaller language schools.

### Validation Model

Run small, measurable experiments before committing to a full rewrite: one segment, one offer, one acquisition channel, and a fixed budget. Track lead-to-paid conversion, activation, completion, retention, CAC, LTV, and payback. Stop or change an experiment when the economics do not support continued investment.

The existing `Growth` capability and the education platform can eventually support automated campaign testing, but marketing automation should follow validated offers and unit economics rather than replace them.

## Commercial Opportunity

SpeakASAP should be positioned primarily as the modernization and operating platform behind a proven multilingual education business. Secondary commercial opportunities are:

- direct-to-consumer subscriptions and courses;
- corporate language learning with per-seat or per-cohort pricing;
- white-label portals for language schools and teachers;
- managed digital infrastructure for education providers;
- implementation, content migration, branding, payment setup, and operational support.

The strongest differentiators are the historical operating experience, the existing education workflows, the 18-language scope, the migration path from a real production portal, and the ability to add modern services without a single disruptive cutover.

Selling the unfinished migration as a generic LMS would be premature. A customer-facing platform offer should wait until tenant isolation, data ownership, support levels, service-level expectations, content licensing, and migration tooling are explicitly defined.

## Future Development

- Complete only the migration chunks justified by active demand, revenue, reliability, or security value.
- Establish a stable API and identity contract across legacy and new services.
- Add learner progress, placement, retention, cohort, and business analytics.
- Add AI-assisted practice, pronunciation, writing, and conversation assessment with approved content and human escalation where needed.
- Support mobile-first and partner-facing experiences if validated by demand.
- Add corporate organisations, learner groups, reporting, invoicing, and administrator roles.
- Add teacher/partner self-service for courses, schedules, materials, and revenue sharing.
- Strengthen multi-tenant branding and data isolation before white-label sales.
- Connect marketing attribution and conversion experiments to the customer and payment lifecycle.
- Maintain data migration tooling, reconciliation, replay, rollback, and decommissioning evidence.

## Approval

Status: approved  
Approved by: project owner  
Approval evidence: `owner-confirmation: speakasap-platform-onboarding-approved`
