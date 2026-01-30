# Marathon Errors Action Plan

**Date:** 2026-01-29  
**Status:** Draft  
**Scope:** Fix Marathon refactor issues after API cutover from speakasap-portal to marathon service

---

## 1. Context

- Part of the Marathon API was transferred from **speakasap-portal** (Django) to the standalone **marathon** service (NestJS).
- **Legacy shim** in `speakasap-portal/marathon/api_views/` forwards requests to marathon when `MARATHON_SHIM_ENABLED=true` and `MARATHON_URL` is set.
- See `marathon/README.md`, `MARATHON_IMPLEMENTATION_STATUS.md`, and `MARATHON_ID_FORMAT_VALIDATION.md` for implementation details.

---

## 2. Log Sources and How to Check Them

### 2.1 Centralized logging (LOGGING_SERVICE_URL)

- **Ingest:** `POST /api/logs`  
- **Query:** `GET /api/logs/query?service=<name>&level=error&limit=100`  
- **URLs:** Internal `http://logging-microservice:3367`; external `https://logging.statex.cz` (if exposed).  
- **Note:** Ensure the query endpoint is routed correctly; the root domain may serve a landing page instead of the API.

**Useful queries:**

```bash
# Speakasap-portal shim errors
curl -s "https://logging.statex.cz/api/logs/query?service=speakasap-portal&level=error&limit=100"

# Marathon service errors
curl -s "https://logging.statex.cz/api/logs/query?service=marathon&level=error&limit=100"

# Shim-related messages (filter client-side)
curl -s "https://logging.statex.cz/api/logs/query?service=speakasap-portal&limit=200" | jq '.data[] | select(.message | test("marathon shim"))'
```

### 2.2 Speakasap-portal logs

- **Local logger:** `CentralizedLogger` in `utils/logger.py`; logs to console and optionally `logs/speakasap-portal.log`.
- **Django LOGGING:** `portal/settings.py` — e.g. `logs/app.log`, `logs/app_errors.log`.

**On production (e.g. statex):**

```bash
ssh statex
cd /home/portal_db/speakasap-portal   # or actual deploy path)
grep -E "marathon shim|marathon.*failed" logs/*.log 2>/dev/null | tail -100
# or wherever gunicorn/supervisor write logs
```

### 2.3 Marathon service logs

- **Docker:** `docker compose logs marathon --tail 200` (from marathon repo root).
- **Blue/green:** Use the active stack (e.g. `docker-compose.blue.yml` or `docker-compose.green.yml`) and the corresponding container name (e.g. `marathon-blue`, `marathon-green`).

**On production:**

```bash
ssh statex
cd /path/to/marathon   # deploy path)
docker compose -f docker-compose.green.yml logs marathon-green --tail 200
# or blue, depending on active deployment
```

### 2.4 Log patterns to look for

| Pattern | Meaning |
| ------- | ------- |
| `marathon shim ... - entry` | Shim received request |
| `marathon shim ... - using legacy` | Shim disabled or no MARATHON_URL; using Django |
| `marathon shim ... - forwarding request` | Request sent to marathon |
| `marathon shim ... - response received` | Marathon responded (check `status`, `latency_ms`) |
| `marathon shim ... failed` | Shim error; often triggers fallback to legacy |
| `marathon shim ... - falling back to legacy` | Fallback due to 5xx, timeout, or exception |
| `marathon shim ... - server error, falling back` | Marathon returned ≥500 |
| `marathon shim ... - possible ID format mismatch` | 404 with numeric ID; marathon expects UUID |
| `My marathon detail failed` / `My marathons list failed` (marathon) | Auth or server-side error in marathon |

---

## 3. Known Issues and Root Causes

### 3.1 Auth mismatch for “my marathons” (High)

**Symptom:**  
`GET /marathon/api/my.json` or `GET /marathon/api/my/<id>.json` return **401** when shim is enabled and traffic goes to marathon.

**Root cause:**

- **Legacy:** Django REST Framework + **session auth** (cookies). Browser sends cookies; no `Authorization` header.
- **Marathon:** `GET /api/v1/me/marathons` and `GET /api/v1/me/marathons/:marathonerId` use `AuthGuard` → **Bearer JWT** only (validated via `AUTH_SERVICE_URL`).
- **Shim:** Forwards `Authorization` only if `request.META.get('HTTP_AUTHORIZATION')` is set. Browser requests usually don’t send it → requests to marathon have **no auth** → 401.

**Affected:**  
My marathons list, my marathon detail.

### 3.2 ID format mismatch – numeric vs UUID (High)

**Symptom:**  
404 when calling detail endpoints or random report with **numeric** IDs (e.g. from legacy frontend).

**Root cause:**

- **Legacy:** Numeric IDs (`\d+`) for marathoners, winners, steps (Django integer PKs).
- **Marathon:** UUIDs for `MarathonParticipant`, `MarathonWinner`, `MarathonStep`.
- Shim forwards IDs as-is. Legacy sends e.g. `my/123.json`, `winners/456.json`, `random_report/1.json?marathoner=789` → marathon looks up UUIDs → **404**.

**Affected:**

- `GET /marathon/api/my/<id>.json` → `GET /api/v1/me/marathons/:marathonerId`
- `GET /marathon/api/winners/<id>.json` → `GET /api/v1/winners/:winnerId`
- `GET /marathon/api/random_report/<step>.json?marathoner=` → `stepId`, `excludeMarathonerId`

**Ref:** `MARATHON_ID_FORMAT_VALIDATION.md`.

### 3.3 Empty or missing data (Expected until migration)

**Symptom:**  
Winners list empty, languages empty, random report 404.

**Root cause:**  
Marathon DB has no (or little) migrated data yet. Behavior is expected until:

- Data migration from legacy DB, and/or  
- New registrations and activity.

**Ref:** `MARATHON_IMPLEMENTATION_STATUS.md` § “Data population”.

### 3.4 Shim / configuration

- **MARATHON_SHIM_ENABLED=false** → all marathon API traffic stays on legacy; no forwarding.
- **MARATHON_URL** unset or wrong → shim falls back to legacy.
- **MARATHON_API_KEY** optional; used as `X-Api-Key` when set. Misconfig can cause marathon to reject requests if it requires the key.

### 3.5 Timeouts

- Shim uses `timeout=5` for `requests.get`/`requests.post` to marathon.  
- Per project rules: **do not increase timeouts**; instead **inspect logs** to find what hangs (marathon, DB, auth service, etc.).

### 3.6 Logger API (Fixed)

- **Issue:** Shim used `logger.warn(...)` but `CentralizedLogger` only defines `logger.warning(...)` → `AttributeError` when those paths ran.  
- **Fix:** Replaced all `logger.warn(` with `logger.warning(` in `marathon/api_views/winners.py`, `common.py`, `auth.py`, and `marathon/reviews/api_views.py`.

---

## 4. Action Plan (Prioritized)

### Phase A: Verify environment and logs

| # | Action | Owner | Notes |
|---|--------|-------|--------|
| A1 | Confirm `MARATHON_URL`, `MARATHON_SHIM_ENABLED`, `MARATHON_API_KEY` in `speakasap-portal/.env` on dev/prod | DevOps | Ensure values match deployment (e.g. blue/green URL). |
| A2 | Run log checks (§2) for speakasap-portal and marathon on target env | Dev | Grep “marathon shim”, “marathon … failed”, “ID format mismatch”, auth errors. |
| A3 | Confirm marathon health: `curl -s $MARATHON_URL/health` | Dev | Expect `{"status":"ok"}`. |
| A4 | Smoke-test shim-off: `MARATHON_SHIM_ENABLED=false` → legacy endpoints work | Dev | Baseline before enabling shim. |

### Phase B: Auth fix for “my marathons”

| # | Action | Owner | Notes |
|---|--------|-------|--------|
| B1 | **Option (1) – Session → JWT in shim:** When forwarding to `/api/v1/me/marathons`, if user is authenticated via session but `Authorization` is missing, obtain a JWT (e.g. from auth-microservice or internal token endpoint) and add `Authorization: Bearer <token>`. | Backend | Requires auth-microservice support for “token for session user” or similar. |
| B2 | **Option (2) – Frontend sends Bearer:** For “my marathons” (and optionally other authenticated marathon API calls), frontend uses JWT and sends `Authorization: Bearer <token>`. Shim keeps forwarding `Authorization` as today. | Frontend | Depends on auth flow (login, token storage, and attaching header to marathon API requests). |
| B3 | **Option (3) – Backend proxy token:** Portal backend exposes an endpoint that returns a short-lived JWT for the current session user; frontend fetches it and uses it for marathon API calls. | Backend + Frontend | Reduces changes in marathon; keeps auth logic in portal/auth service. |
| B4 | Implement chosen option, add logging (shim + marathon), and verify `my.json` and `my/<id>.json` return 200 when shim enabled. | Backend | Log success/failure and latency. |

### Phase C: ID format (numeric ↔ UUID)

| # | Action | Owner | Notes |
|---|--------|-------|--------|
| C1 | **Mapping layer:** Maintain a **numeric → UUID** map (e.g. legacy marathoner_id → marathon `MarathonParticipant.id`) and use it in shim when forwarding to marathon. | Backend | Requires migration or sync that stores this mapping (e.g. in portal DB or shared store). |
| C2 | **Or:** Extend marathon to accept **numeric** IDs for legacy compatibility (e.g. additional lookup table or constrained support for numeric identifiers). | Marathon | Larger change in marathon; prefer C1 if possible. |
| C3 | Apply same strategy for **winners** and **random report** (stepId, excludeMarathonerId) where legacy sends numeric IDs. | Backend | Reuse mapping or marathon-side support. |
| C4 | Add/keep logging for “ID format mismatch” (shim) and 404s (marathon) to validate fixes. | Backend | Already partially in place; ensure it stays. |

### Phase D: Operational and follow-up

| # | Action | Owner | Notes |
|---|--------|-------|--------|
| D1 | Document chosen auth and ID-format approaches in `MARATHON_IMPLEMENTATION_STATUS.md` or a dedicated “Marathon integration” doc. | Dev | Keep runbooks and troubleshooting (§2) up to date. |
| D2 | Re-run smoke tests from `MARATHON_CUTOVER_VERIFICATION.md` after B and C are done. | QA/Dev | Winners, my marathons, registration, etc. |
| D3 | Plan data migration (marathon DB) and frontend pagination/format handling as in `MARATHON_IMPLEMENTATION_STATUS.md`. | PM/Dev | Out of scope for this fix plan; track separately. |

---

## 5. Quick Reference

- **Shim:** `speakasap-portal/marathon/api_views/` (`winners.py`, `common.py`, `auth.py`, `reviews/api_views.py`).  
- **Marathon:** `marathon/` NestJS app; `me` endpoints use `AuthGuard` (Bearer only).  
- **Config:** `MARATHON_URL`, `MARATHON_SHIM_ENABLED`, `MARATHON_API_KEY` in `speakasap-portal/.env`.  
- **Logging:** Centralized logger + Django `LOGGING` (§2).  
- **Rules:** No changes to database-server, auth-microservice, nginx-microservice, logging-microservice; only use their scripts. No timeout increases; use logs to debug hangs.

---

## 6. Checklist Summary

- [ ] A1–A4: Env and log verification  
- [ ] B1–B4: Auth fix for my marathons  
- [ ] C1–C4: ID format (numeric vs UUID)  
- [ ] D1–D3: Docs, smoke tests, data migration planning  

---

**Next step:** Run Phase A (env + logs), then decide on **Phase B** (auth) and **Phase C** (ID format) based on actual log findings and product priorities.

---

## 7. Recommended First Actions

1. **Check logs** (Phase A):
   - On **statex** (prod): `ssh statex`, then grep speakasap-portal and marathon log paths for `marathon shim`, `marathon ... failed`, `ID format mismatch`, and auth-related errors.
   - Query centralized logging (`GET /api/logs/query`) for `service=speakasap-portal` and `service=marathon`, filter by `level=error` and by "marathon shim" messages.
2. **Confirm env:** `MARATHON_URL`, `MARATHON_SHIM_ENABLED`, `MARATHON_API_KEY` in `speakasap-portal/.env` on the environment you’re debugging.
3. **Health check:** `curl -s $MARATHON_URL/health` → `{"status":"ok"}`.
4. **Reproduce with shim off:** Set `MARATHON_SHIM_ENABLED=false`, restart portal, verify legacy marathon API works. Then enable shim and compare behavior and logs.
