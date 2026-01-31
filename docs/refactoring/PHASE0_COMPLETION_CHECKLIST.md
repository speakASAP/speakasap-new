# Phase 0 Completion Checklist

**Date:** 2026-01-26  
**Status:** 🟡 In Progress (95% Complete)  
**Phase:** Marathon Extraction  
**Lead Orchestrator:** Review Required

---

## Overview

Phase 0 focuses on extracting the `marathon` product as a standalone service with legacy integration shim. This checklist ensures all deliverables are complete before declaring Phase 0 complete and moving to Phase 1.

---

## Pre-Cutover Checklist (Current Status)

### ✅ TASK-01: Marathon Design and API Contract

- [x] **API Contract Documented**
  - [x] `docs/refactoring/MARATHON_API_CONTRACT.md` created
  - [x] All 8 endpoints defined with request/response shapes
  - [x] Pagination format documented
  - [x] Error response format documented
  - [x] Auth requirements documented

- [x] **Service Skeleton Implemented**
  - [x] NestJS application structure created
  - [x] All modules organized (winners, answers, reviews, me, marathons, registrations)
  - [x] Controllers implemented for all endpoints
  - [x] Services implemented with business logic
  - [x] Shared modules (auth, logging, Prisma) integrated

- [x] **Database Schema Defined**
  - [x] Prisma schema created (`prisma/schema.prisma`)
  - [x] Schema aligns with `MARATHON_DATA_MAPPING.md`
  - [x] Initial migration created (`20260126_init`)
  - [x] Migration applied to database
  - [x] Seed script created (no data, as per requirements)

**Status:** ✅ **COMPLETE**

---

### ✅ TASK-02: Legacy Integration Shim

- [x] **Shim Implementation**
  - [x] All 8 endpoints shimmed in `speakasap-portal`
  - [x] Winners list endpoint (`winners.py`)
  - [x] Winner detail endpoint (`winners.py`)
  - [x] Random report endpoint (`winners.py`)
  - [x] My marathons list endpoint (`common.py`)
  - [x] My marathon detail endpoint (`common.py`)
  - [x] Languages endpoint (`common.py`)
  - [x] Reviews endpoint (`reviews/api_views.py`)
  - [x] Registration endpoint (`auth.py`)

- [x] **Routing Fixed**
  - [x] `api_urls.py:13` uses `MyMarathon.as_view()` (RetrieveAPIView)
  - [x] Permissions updated to `IsAuthenticated` for detail endpoint
  - [x] All routes correctly mapped

- [x] **Pagination Transformation**
  - [x] Transformation logic implemented in `winners.py`
  - [x] Converts new format to DRF format for legacy frontend
  - [x] Tested and verified

- [x] **Fallback Behavior**
  - [x] Safe fallback on 5xx/timeout/exception
  - [x] Returns 4xx as-is (no fallback for client errors)
  - [x] All shims follow consistent pattern

- [x] **Logging**
  - [x] Extensive logging added to all shims
  - [x] Entry points logged
  - [x] Request forwarding logged
  - [x] Response received logged
  - [x] Transformations logged
  - [x] Errors logged with stack traces

- [x] **Environment Variables**
  - [x] `MARATHON_URL` documented in `.env.example`
  - [x] `MARATHON_SHIM_ENABLED` documented
  - [x] `MARATHON_API_KEY` documented (optional)
  - [x] All shims check env vars before forwarding

**Status:** ✅ **COMPLETE**

---

### ✅ TASK-03: Data Mapping and Migration Plan

- [x] **Data Mapping Documented**
  - [x] `docs/refactoring/MARATHON_DATA_MAPPING.md` created
  - [x] All core entities mapped (Marathon, Step, Marathoner, Answer, Winner)
  - [x] Field transforms documented
  - [x] Migration strategy documented

- [x] **Database Migrations**
  - [x] Prisma migrations created
  - [x] Initial migration applied
  - [x] Database schema matches mapping document

**Status:** ✅ **COMPLETE**

---

### ✅ TASK-04: Infra and Docker Setup

- [x] **Docker Configuration**
  - [x] `Dockerfile` created (multi-stage build)
  - [x] `docker-compose.yml` created
  - [x] `docker-compose.blue.yml` created (blue deployment)
  - [x] `docker-compose.green.yml` created (green deployment)
  - [x] Uses `node:22-alpine` base image
  - [x] OpenSSL compatibility configured

- [x] **Deployment Script**
  - [x] `scripts/deploy.sh` created
  - [x] Integrates with nginx-microservice blue/green system
  - [x] Validates docker-compose files
  - [x] Handles rollback on failure

- [x] **Nginx Integration**
  - [x] `nginx-api-routes.conf` created
  - [x] Routes configured for marathon service
  - [x] Domain: `marathon.statex.cz`
  - [x] Port: 4214 (internal), 4215 (external)

- [x] **Environment Configuration**
  - [x] `.env.example` created with all required keys
  - [x] All configuration env-driven (no hardcoded values)
  - [x] Port in 42xx range (4214)
  - [x] Logging service URL configured

- [x] **Service Deployment**
  - [x] Service deployed to production server
  - [x] Health check endpoint working (`/health`)
  - [x] Container running and healthy
  - [x] Database migrations applied
  - [x] Seed script executed

**Status:** ✅ **COMPLETE**

---

### ✅ TASK-05: Validation and Audits

- [x] **Parity Audit (AGENT07)**
  - [x] `AGENT07_MARATHON_PARITY_AUDIT_REPORT.md` created
  - [x] All endpoints audited for parity
  - [x] Response shapes validated
  - [x] Business logic verified
  - [x] Status: ✅ **GO** (after pagination transformation)

- [x] **Shim Audit (AGENT08)**
  - [x] `AGENT08_LEGACY_SHIM_AUDIT_REPORT.md` created
  - [x] All endpoints mapped correctly
  - [x] Fallback behavior verified
  - [x] Logging verified
  - [x] Status: ✅ **GO** (after routing fix)

- [x] **Phase 0 Validation**
  - [x] `MARATHON_PHASE0_VALIDATION.md` checklist reviewed
  - [x] All validation criteria met
  - [x] Status: ✅ **GO**

**Status:** ✅ **COMPLETE**

---

## Cutover Readiness Checklist

### Pre-Cutover Verification

- [ ] **Marathon Service Health**
  - [ ] Health endpoint returns 200 OK: `curl http://marathon-green:4214/health`
  - [ ] Database connectivity verified
  - [ ] Logging service connectivity verified
  - [ ] Auth service connectivity verified (if used)
  - [ ] Container logs show no errors

- [ ] **Shim Code Deployed**
  - [ ] All shim files committed to `speakasap-portal` repository
  - [ ] Shim code deployed to production
  - [ ] `.env.example` synced with `.env` (local + prod)
  - [ ] Environment variables set in production `.env`:
    - [ ] `MARATHON_URL` set correctly
    - [ ] `MARATHON_SHIM_ENABLED=false` (initially)
    - [ ] `MARATHON_API_KEY` set (if required)
    - [ ] `MARATHON_PORTAL_JWT_SECRET` set (same value in speakasap-portal and marathon; required for Phase B auth)
  - [ ] Phase B (auth): Portal-issued JWT + marathon fallback implemented; Phase C (ID mapping): `MarathonIdMapping` + migration `0022_marathonidmapping`; optionally populate mapping table

- [ ] **Documentation Complete**
  - [ ] `MARATHON_CUTOVER_RUNBOOK.md` reviewed
  - [ ] `MARATHON_CUTOVER_VERIFICATION.md` reviewed
  - [ ] Team notified of cutover plan
  - [ ] Rollback plan documented and understood

- [ ] **Smoke Tests Prepared**
  - [ ] Test cases documented
  - [ ] Test data prepared (if needed)
  - [ ] Test endpoints identified

---

## Cutover Execution Checklist

### Step 1: Pre-Cutover Verification

- [ ] Verify marathon service health
- [ ] Verify shim code is deployed
- [ ] Verify environment variables are set
- [ ] Review logs for any errors
- [ ] Run smoke tests with shim disabled

### Step 2: Enable Shim (Gradual)

- [ ] Set `MARATHON_SHIM_ENABLED=true` in `.env`
- [ ] Restart Django service
- [ ] Verify shim is active (check logs)
- [ ] Monitor for 10-15 minutes

### Step 3: Monitor and Validate

- [ ] **Log Monitoring**
  - [ ] Check shim logs for successful requests
  - [ ] Verify latency < 500ms
  - [ ] Check fallback rate < 5%
  - [ ] Monitor error rates

- [ ] **Functional Testing**
  - [ ] Test winners list endpoint
  - [ ] Test winner detail endpoint
  - [ ] Test random report endpoint
  - [ ] Test my marathons list endpoint
  - [ ] Test my marathon detail endpoint
  - [ ] Test languages endpoint
  - [ ] Test reviews endpoint
  - [ ] Test registration endpoint

- [ ] **Frontend Testing**
  - [ ] Verify winners page loads correctly
  - [ ] Verify pagination works
  - [ ] Check browser console for errors
  - [ ] Verify network requests show correct format

### Step 4: Success Criteria Validation

- [ ] All 8 endpoints work correctly through shim
- [ ] Shim logs show 2xx responses with latency < 500ms
- [ ] Fallback rate < 5%
- [ ] No frontend errors
- [ ] No increase in error rates
- [ ] All smoke tests pass
- [ ] Response times acceptable

---

## Post-Cutover Checklist

### Immediate (First 24 Hours)

- [ ] **Monitoring**
  - [ ] Monitor logs continuously
  - [ ] Track error rates
  - [ ] Monitor response times
  - [ ] Check fallback rates

- [ ] **Issue Tracking**
  - [ ] Document any issues encountered
  - [ ] Track resolution times
  - [ ] Update runbook with learnings

### Short-Term (First Week)

- [ ] **Performance Validation**
  - [ ] Verify response times remain acceptable
  - [ ] Check database query performance
  - [ ] Monitor external service call latency
  - [ ] Validate logging is comprehensive

- [ ] **Data Validation**
  - [ ] Verify data consistency (if data migration performed)
  - [ ] Check for any data discrepancies
  - [ ] Validate all endpoints return correct data

### Medium-Term (First Month)

- [ ] **Stability Assessment**
  - [ ] Review error logs for patterns
  - [ ] Assess fallback frequency
  - [ ] Evaluate performance trends
  - [ ] Document any needed improvements

- [ ] **Documentation Updates**
  - [ ] Update runbooks with actual experience
  - [ ] Document any issues and resolutions
  - [ ] Update monitoring dashboards (if applicable)

---

## Phase 0 Completion Criteria

Phase 0 is considered **COMPLETE** when:

1. ✅ All TASK-01 through TASK-05 deliverables complete
2. ✅ Marathon service deployed and healthy
3. ✅ Shim layer implemented and tested
4. ✅ All audits show GO status
5. ✅ Cutover executed successfully
6. ✅ Service stable for minimum 1 week
7. ✅ No critical issues reported
8. ✅ Documentation complete and up-to-date

**Current Status:** 🟡 **95% Complete** - Awaiting cutover execution

---

## Rollback Criteria

Phase 0 cutover should be rolled back if:

- Error rate increases > 10%
- Fallback rate > 20%
- Critical functionality broken
- Data integrity issues discovered
- Performance degradation > 50%
- User complaints increase significantly

**Rollback Procedure:**

1. Set `MARATHON_SHIM_ENABLED=false` in `.env`
2. Restart Django service
3. Verify legacy endpoints work
4. Investigate issues
5. Document findings
6. Plan next attempt

---

## Next Steps After Phase 0 Completion

Once Phase 0 is complete:

1. **Declare Phase 0 Complete**
   - Update `SPEAKASAP_REFACTORING_TASKS_INDEX.md`
   - Mark Phase 0 tasks as complete
   - Document lessons learned

2. **Begin Phase 1 Planning**
   - Review Phase 1 scope (Foundation & Infrastructure - Content Service)
   - Decompose Phase 1 into agent tasks
   - Create agent prompts for Phase 1
   - Set up Phase 1 sync points

3. **Knowledge Transfer**
   - Document Phase 0 patterns for reuse
   - Share learnings with Phase 1 agents
   - Update master prompt with Phase 0 insights

---

## Sign-Off

**Lead Orchestrator Review:**

- [ ] All pre-cutover items verified
- [ ] Cutover plan approved
- [ ] Team notified
- [ ] Rollback plan understood

**Cutover Execution:**

- [ ] Cutover executed
- [ ] Success criteria met
- [ ] Service stable

**Phase 0 Completion:**

- [ ] All completion criteria met
- [ ] Documentation updated
- [ ] Ready for Phase 1

---

**Last Updated:** 2026-01-26  
**Next Review:** After cutover execution
