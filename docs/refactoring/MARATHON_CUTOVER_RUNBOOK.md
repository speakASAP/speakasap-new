# Marathon Cutover Runbook (One-Page)

**Purpose:** Enable the marathon shim and switch traffic to the new service. Roll back if issues appear.

**Current Status:** ✅ **READY** — All fixes applied. Shim transformation added for pagination format compatibility.

---

## Prerequisites (all must be GO)

| Gate | Status | Reference |
| ---- | ------ | --------- |
| **Parity audit (AGENT07)** | ✅ **GO** | `AGENT07_MARATHON_PARITY_AUDIT_REPORT.md` — pagination format: shim transformation added |
| **Shim audit (AGENT08)** | ✅ **GO** | `AGENT08_LEGACY_SHIM_AUDIT_REPORT.md` — routing bug fixed, 404 handling standardized |
| **Phase 0 validation** | ✅ GO | `MARATHON_PHASE0_VALIDATION.md` — contract, data mapping, infra validated |
| **Pagination transformation** | ✅ **COMPLETE** | Shim transforms new format to DRF format in `winners.py` |
| **Marathon service healthy** | ⚠️ Verify | `GET /health` returns 200; DB and logging OK |

### Required Fixes Before Cutover

1. **✅ Fix routing bug** (COMPLETED)
   - **File:** `speakasap-portal/marathon/api_urls.py:13`
   - **Status:** ✅ Fixed - Uses `MyMarathon.as_view()` (RetrieveAPIView)
   - **Additional fix:** Updated permissions to `IsAuthenticated` (was `AllowAny`)
   - **Reference:** `AGENT08_LEGACY_SHIM_AUDIT_REPORT.md` section 2

2. **✅ Resolve pagination format** (COMPLETED)
   - **Issue:** Winners list returns `{items[], page, limit, total, nextPage, prevPage}` but legacy expects DRF format `{count, next, previous, results[]}`
   - **Decision:** ✅ **Option B - Transformation in shim layer**
   - **Implementation:** Added transformation in `speakasap-portal/marathon/api_views/winners.py:56-70`
   - **Status:** ✅ Complete - Shim transforms new format to DRF format for legacy frontend compatibility
   - **Reference:** `AGENT07_MARATHON_PARITY_AUDIT_REPORT.md` section 3

3. **✅ Standardize 404 handling** (COMPLETED)
   - **Status:** ✅ Fixed - Controllers throw `NotFoundException` instead of returning `null`
   - **Files:**
     - `marathon/src/winners/winners.controller.ts:27-29` - Throws `NotFoundException` when winner not found
     - `marathon/src/me/me.controller.ts:24-26` - Throws `NotFoundException` when marathon not found
   - **Note:** `answers.controller.ts` already had proper 404 handling

4. **Optional improvements** (Non-blocking)
   - Verify random report HTML generation matches legacy output
   - Add anonymous-only guard to registration if legacy behavior required

---

## Environment

**speakasap-portal:** Keys are in `.env.example`. Values are in `.env` (not in the repo; do not edit `.env` or any files on the prod server). Deploy via **git pull** and your deploy script only.

- `MARATHON_URL` — base URL of new marathon service (e.g. `https://marathon.alfares.cz`)
- `MARATHON_SHIM_ENABLED` — `false` (default) or `true` to enable shim
- `MARATHON_API_KEY` — optional

---

## Pre-Cutover Verification

1. **Verify fixes applied**
   - ✅ Routing bug fixed: `grep "MyMarathon.as_view()" speakasap-portal/marathon/api_urls.py`
   - ✅ 404 handling standardized: Controllers throw `NotFoundException` (verify in code)
   - ✅ Pagination transformation: Verify shim transforms format in `speakasap-portal/marathon/api_views/winners.py:56-70`
   - ✅ Re-run audits: Both AGENT07 and AGENT08 should show GO

2. **Marathon service health check**

   ```bash
   curl -f $MARATHON_URL/health
   # Expected: 200 OK
   ```

3. **Environment variables**  
   Keys are in `speakasap-portal/.env.example`. Verify `MARATHON_URL` and `MARATHON_SHIM_ENABLED` are set via your config (do not edit files on the prod server). Deploy only via git pull and your deploy script.

---

## Cutover Steps

1. **Pre-check**  
   - `curl -f $MARATHON_URL/health` → 200 (e.g. `https://marathon.alfares.cz/health`)
   - Confirm shim is disabled before enabling (no direct edits on prod server).
   - Verify all prerequisites are GO

2. **Enable shim (codebase + GitHub only; no prod server edits)**  

   Ensure `MARATHON_URL` and `MARATHON_SHIM_ENABLED=true` are set (keys in `.env.example`; use your own config process — do not edit files on the prod server). Then deploy via GitHub only:

   ```bash
   cd speakasap-portal
   git pull
   ./scripts/deploy.sh
   ```

   The app loads `.env` at startup via `portal/wsgi.py`. Do not run `sed`, `cp .env`, or any other commands that modify files on the prod server.

3. **Monitor logs (≈10 min)**  
   Centralized logger: look for `"marathon shim"` patterns:
   - ✅ Success: `marathon shim list winners`, `marathon shim get my marathon`, etc.
   - ⚠️ Errors: `marathon shim … failed` → fallback to legacy (expected on 5xx/timeout)
   - **Check:** All 8 endpoints should show shim activity

4. **Success criteria**  
   - ✅ Shim logs show 2xx for success; latency < 500 ms
   - ✅ No error-rate increase; fallback < 5%
   - ✅ Smoke tests (step 5) return valid data
   - ✅ No frontend errors related to response format

5. **Smoke tests**  

   ```bash
   # Winners (shim transforms to DRF format: {count, next, previous, results[]})
   curl -s https://<portal>/marathon/api/winners.json | jq '.results[0]'
   # Verify structure: should have count, next, previous, results[] (DRF format)
   
   # Reviews
   curl -s https://<portal>/marathon/api/reviews.json | jq '.[0]'
   
   # Languages
   curl -s https://<portal>/marathon/api/languages.json | jq '.[0]'
   
   # My marathons (requires auth token)
   curl -s -H "Authorization: Bearer $TOKEN" https://<portal>/marathon/api/my.json | jq '.[0]'
   
   # My marathon detail (verify routing fix)
   curl -s -H "Authorization: Bearer $TOKEN" https://<portal>/marathon/api/my/123.json | jq '.'
   
   # Random report
   curl -s https://<portal>/marathon/api/random_report/1.json?marathoner= | jq '.'
   ```

---

## Rollback

1. **Disable shim**  
   Set `MARATHON_SHIM_ENABLED=false` via your config process (do not edit files on the prod server). Then run your normal deployment: `git pull` (if needed) and your deploy script (e.g. `./scripts/deploy.sh`).

2. **Verify**  
   After redeploy, `curl -f https://<portal>/marathon/api/winners.json` → legacy response.

3. **Investigate**  
   Check logs, marathon service health, network. Document for next attempt.

---

## Notes

- **Fallback behavior:** Shim falls back to legacy on **5xx** or **timeout**; **4xx** from new service returned as-is.
- **Logging:** All shim calls logged: path, status, latency_ms; `user_id` for `my` endpoints.
- **Toggle:** `MARATHON_SHIM_ENABLED=false` routes traffic back to legacy (instant rollback).
- **Pagination format:** If transformation layer added in shim, verify it handles all pagination edge cases.

---

## Troubleshooting

### Issue: Frontend breaks after cutover

**Symptoms:** Frontend errors, missing data, pagination not working

**Check:**

1. Verify shim transformation is working: Check response format matches DRF `{count, next, previous, results[]}`
2. Check browser console for API errors
3. Verify shim logs show successful transformation
4. Test API directly: `curl https://<portal>/marathon/api/winners.json | jq '.'` should show DRF format

**Action:** If transformation not working:

- Check shim code in `speakasap-portal/marathon/api_views/winners.py:56-70`
- Verify new service returns expected format
- Roll back immediately (set `MARATHON_SHIM_ENABLED=false`) if needed

### Issue: Detail endpoint returns list instead of single item

**Symptoms:** `/marathon/api/my/{id}.json` returns array instead of object

**Check:**

1. Verify routing fix applied: `grep "MyMarathon" speakasap-portal/marathon/api_urls.py`
2. Check shim logs for `marathon shim get my marathon` (should show detail endpoint calls)

**Action:** If routing bug still present, apply fix from prerequisites section 1

### Issue: High fallback rate (>5%)

**Symptoms:** Many `marathon shim … failed` logs, frequent legacy fallbacks

**Check:**

1. Marathon service health: `curl $MARATHON_URL/health`
2. Network connectivity between portal and marathon service
3. Marathon service logs for errors
4. Timeout settings (default 5s)

**Action:** Investigate marathon service issues before continuing cutover
