# Marathon Refactoring - Current Status and Next Steps

**Date:** 2026-02-18  
**Status:** Service deployed but nginx routing incomplete  
**Issue:** `https://marathon.statex.cz` returns 404

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

**Status:** ✅ Fixed locally, needs deployment

**Action Required:**

1. ✅ Updated `marathon/nginx-api-routes.conf` to include `/health` route
2. ⏳ **Commit and push** the change to repository
3. ⏳ **Pull changes** on production server (`ssh statex`)
4. ⏳ **Redeploy marathon** service using deployment script

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

## Next Steps After Fixing 404

### Immediate (After nginx fix)

1. **Verify all endpoints work via HTTPS:**

   ```bash
   curl https://marathon.statex.cz/health
   curl https://marathon.statex.cz/api/v1/reviews
   curl https://marathon.statex.cz/api/v1/winners
   ```

2. **Check nginx logs** if any issues:

   ```bash
   ssh statex
   docker logs nginx-microservice --tail 100
   ```

### Short-term (Next Phase)

1. **Frontend Integration**
   - Update frontend to use `https://marathon.statex.cz/api/v1/` endpoints
   - Handle pagination format differences (already documented)
   - Test all marathon features

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

## Verification Checklist

After deploying the fix:

- [ ] `https://marathon.statex.cz/health` returns `200 OK`
- [ ] `https://marathon.statex.cz/api/v1/reviews` returns reviews list
- [ ] `https://marathon.statex.cz/api/v1/winners` returns winners list
- [ ] All API endpoints accessible via HTTPS
- [ ] Nginx configs regenerated correctly
- [ ] Service health checks passing

---

## Summary

**Current State:**

- ✅ Marathon service is standalone and deployed
- ✅ Uses common infrastructure correctly
- ✅ All API endpoints implemented
- ❌ Nginx routing incomplete (missing `/health` route)

**Immediate Action:**

1. Commit and push `nginx-api-routes.conf` change
2. Pull on production
3. Redeploy marathon service

**After Fix:**

- Marathon will be fully accessible at `https://marathon.statex.cz`
- All endpoints will work correctly
- Ready for frontend integration and data migration

---

**Report Generated:** 2026-02-18  
**Next Review:** After nginx fix deployment
