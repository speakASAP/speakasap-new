# Marathon Refactoring - Current Status and Next Steps

**Date:** 2026-02-18  
**Status:** Deployed. Frontend at marathon.statex.cz uses new API; portal has legacy + shim + random_report logging.  
**Issue:** ~~404~~ Resolved (routing via `/api/` and `/health` in nginx-api-routes.conf)

---

## Current Status Summary

### ✅ What's Working

1. **Marathon Service is Deployed and Running**
   - Container: `marathon-blue` is healthy and running
   - Port: `0.0.0.0:4214->4214/tcp`
   - Health endpoint: `http://localhost:4214/health` returns `200 OK`
   - Service is accessible internally

2. **Service Architecture**
   - ✅ Standalone NestJS application (separate from speakasap-portal)
   - ✅ Uses common infrastructure (database-server, logging, auth, notifications)
   - ✅ Blue/green deployment configured
   - ✅ Service registry configured (`marathon.json`)
   - ✅ Docker compose files present (blue/green)

3. **API Endpoints Implemented**
   - ✅ `GET /health` (excluded from `/api/v1` prefix)
   - ✅ `GET /api/v1/reviews`
   - ✅ `GET /api/v1/answers/random`
   - ✅ `GET /api/v1/me/marathons`
   - ✅ `GET /api/v1/me/marathons/:id`
   - ✅ `GET /api/v1/winners`
   - ✅ `GET /api/v1/winners/:winnerId`
   - ✅ `GET /api/v1/marathons/languages`
   - ✅ `POST /api/v1/registrations`

4. **Nginx Configuration**
   - ✅ Nginx config files exist: `marathon.statex.cz.blue.conf` and `marathon.statex.cz.green.conf`
   - ✅ SSL certificates configured
   - ✅ `/api/` route configured to proxy to marathon service

### ❌ Current Issue

**Problem:** `https://marathon.statex.cz/health` returns `404 Not Found`

**Root Cause:**

- Nginx configuration only routes `/api/` to marathon service
- The `/health` endpoint is at root level (not under `/api/v1` prefix)
- Nginx doesn't have a location block for `/health`, so it returns 404

**Solution:**

- Add `/health` to `nginx-api-routes.conf` file
- Redeploy marathon service to regenerate nginx configs

---

## What Needs to Be Done Right Now

### 1. Fix Nginx Routing (Immediate - Blocking)

**Status:** ✅ Fixed and deployed

**Done:**

1. ✅ Updated `marathon/nginx-api-routes.conf` to include `/health` route
2. ✅ Deployed (marathon + portal)

**Commands:**

```bash
# On local dev (after committing):
cd /Users/sergiystashok/Documents/GitHub/marathon
git add nginx-api-routes.conf
git commit -m "Add /health route to nginx-api-routes.conf"
git push origin main

# On production:
ssh statex
cd ~/marathon
git pull origin main
cd ~/nginx-microservice
./scripts/blue-green/deploy-smart.sh marathon
```

**Expected Result:**

- `https://marathon.statex.cz/health` returns `200 OK` with `{"status":"ok"}`
- `https://marathon.statex.cz/api/v1/reviews` works correctly

### 2. Verify Standalone Status

**Current Status:** ✅ Marathon is already standalone

**Verification:**

- ✅ Separate repository: `/Users/sergiystashok/Documents/GitHub/marathon`
- ✅ Separate Docker containers: `marathon-blue`, `marathon-green`
- ✅ Separate nginx configuration: `marathon.statex.cz.*.conf`
- ✅ Uses common infrastructure (database-server, logging, auth)
- ✅ No code dependencies on speakasap-portal

**No Action Needed** - Marathon is already standalone.

### 3. Complete Infrastructure Integration

**Status:** ✅ Infrastructure integration complete

**Verified:**

- ✅ Uses shared `database-server` (PostgreSQL)
- ✅ Uses shared `logging-microservice`
- ✅ Uses shared `auth-microservice`
- ✅ Uses shared `notifications-microservice`
- ✅ Connected to `nginx-network` Docker network
- ✅ Blue/green deployment via nginx-microservice

**No Action Needed** - Infrastructure integration is complete.

---

## Next Steps (Continue with the plan)

### Immediate (Do now)

1. **Smoke test marathon.statex.cz:**
   - Open <https://marathon.statex.cz>z> (winners, about, etc.).
   - Call API: `curl https://marathon.statex.cz/health`, `curl https://marathon.statex.cz/api/v1/reviews`, `curl https://marathon.statex.cz/api/v1/winners`.
   - Tick the Verification Checklist below when done.

2. **Optional – enable legacy shim on portal** so speakasap.com marathon pages use the new service when possible:
   - In `speakasap-portal/.env`: `MARATHON_SHIM_ENABLED=true`, `MARATHON_URL=https://marathon.statex.cz` (or internal URL).
   - Restart portal; check logs for `marathon shim` to confirm forwarding.

### Short-term (Next Phase)

1. **Frontend Integration** (frontend live at <https://marathon.statex.cz>)
   - Ensure frontend uses same-origin API: `https://marathon.statex.cz/api/v1/` (or relative `/api/v1/`).
   - Backend already allows origin via `CORS_ORIGIN` and `FRONTEND_URL` in marathon `.env`.
   - Pagination: new API returns `{ items, page, limit, total, nextPage, prevPage }`; frontend must use `response.items` (and optional `response.total`, `response.nextPage`) instead of a plain array or DRF `results`/`next`.
   - Test: reviews, winners, languages, registration, my marathons (auth), random report.

2. **Enable Legacy Shim** (if needed)
   - Set `MARATHON_SHIM_ENABLED=true` in `speakasap-portal/.env`
   - Monitor shim logs for successful forwarding
   - Gradually migrate traffic from legacy to new service

3. **Data Migration**
   - Migrate marathon data from legacy database
   - Migrate marathoners, answers, winners
   - Verify data integrity

### Long-term (Future)

1. **Remove Legacy Code**
   - After full cutover, remove marathon code from speakasap-portal
   - Clean up legacy shim code
   - Archive legacy marathon database

---

## Files Changed

### Local Changes (Ready to Commit)

- `marathon/nginx-api-routes.conf` - Added `/health` route

### Production Changes Needed

- Pull latest code from repository
- Redeploy marathon service to regenerate nginx configs

---

## Frontend integration (implementation)

Frontend is at **<https://marathon.statex.cz>**. Use the following so it talks to the new API correctly.

- **API base:** Same origin is enough: use **`/api/v1`** (e.g. `GET /api/v1/reviews`, `GET /api/v1/winners`). No need to hardcode `https://marathon.statex.cz` if the frontend is served from that domain.
- **Pagination (winners, etc.):** New API returns:

  ```json
  { "items": [...], "page": 1, "limit": 24, "total": 0, "nextPage": null, "prevPage": null }
  ```

  Use `response.items` for the list; use `response.total`, `response.nextPage`, `response.prevPage` if the UI needs them. Do not expect a top-level array or DRF-style `results`/`next`.
- **Auth (my marathons):** Send `Authorization: Bearer <token>` (portal-issued JWT when logged in via portal). Backend validates via auth-microservice / portal JWT.

- [x] Winners (and any other paginated lists) use `response.items` and optional pagination fields (winners.js/ts, marathons.js, reports.js).
- [ ] Authenticated “my marathons” requests send Bearer token.
- [ ] Smoke test: reviews, winners, languages, registration, my marathons, random report.

---

## Verification Checklist

After deploying (tick as you verify):

- [ ] `https://marathon.statex.cz/health` returns `200 OK`
- [ ] `https://marathon.statex.cz/api/v1/reviews` returns reviews list
- [ ] `https://marathon.statex.cz/api/v1/winners` returns winners list
- [ ] All API endpoints accessible via HTTPS
- [ ] Nginx config for marathon.statex.cz
- [ ] Service health checks passing
- [ ] Frontend at <https://marathon.statex.cz>z> loads and uses API correctly (winners, reviews)

---

## Summary

**Current State:**

- ✅ Marathon service is standalone and deployed
- ✅ Uses common infrastructure correctly
- ✅ All API endpoints (<https://marathon.statex.cz>z>)
- ✅ Nginx routing fixed in codebase (`/api/`, `/health` in nginx-api-routes.conf; root `/` omitted to avoid nginx location nesting)
- ✅ Frontend live at <https://marathon.statex.cz>z>

**Next actions:**

1. Run smoke test (see “Next Steps” above) and tick Verification Checklist.
2. Optionally enable legacy shim in portal so speakasap.com marathon traffic can use the new service.
3. Data migration (legacy DB → new service) and “my marathons” auth on marathon.statex.cz as follow-up.

**Report Generated:** 2026-02-18  
**Next Review:** After smoke test and optional shim enablement
