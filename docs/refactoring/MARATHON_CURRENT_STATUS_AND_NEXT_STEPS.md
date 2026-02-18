# Marathon Refactoring - Current Status and Next Steps

**Date:** 2026-02-18  
**Status:** Deployed. Marathon API at **marathon.alfares.cz**. Portal uses new API when MARATHON_URL points to marathon.alfares.cz; legacy + shim available. **statex is in sunset** — use **speakasap** for portal and **dev** for marathon.  
**Issue:** ~~404~~ Resolved. Nginx uses backend block (path-preserving `location /api/` + `location /health`). Registry: `services.backend`, `api_routes` empty; `marathon/nginx/nginx-api-routes.conf` has no route lines.  
**Note:** The domain (marathon.alfares.cz) is **API-only** — no HTML/UI is served there. The winners/reviews UI is in the portal (speakasap.com or wherever the portal runs). **marathon.alfares.cz runs on the dev server** — `ssh dev`, then `cd ~/Documents/Github/` (or repo root). **Portal/legacy run on the speakasap server** — `ssh speakasap`, then `cd speakasap-portal`.

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
   - ✅ Nginx config files exist: `marathon.alfares.cz.blue.conf` and `marathon.alfares.cz.green.conf`
   - ✅ SSL certificates configured
   - ✅ `/api/` route configured to proxy to marathon service

### ✅ Nginx / API Routing (Resolved)

**Fix applied:**

- Nginx generator only emits path-preserving `location /api/` when the registry has a service key **`backend`**. Marathon registry on prod was updated to use `services.backend` (same `container_name_base: marathon`) and `api_routes: []`.
- `marathon/nginx/nginx-api-routes.conf` is intentionally **empty** (comments only). Listing `/api/` or `/health` there would either strip the path or create duplicate locations. Deploy leaves `api_routes` unchanged when the file has no route lines.
- After regenerating config and reloading nginx: `https://marathon.alfares.cz/health`, `/api/v1/reviews`, `/api/v1/winners` return **200**.

**Do not:** add `/api/` or `/health` to `marathon/nginx/nginx-api-routes.conf`, or change prod registry back to `services.marathon` only (would remove the backend block and break `/api/v1/*`).

---

## What Needs to Be Done Right Now

### 1. Nginx Routing

**Status:** ✅ Fixed and verified

**Smoke test (all 200):** `/health`, `/api/v1/reviews`, `/api/v1/winners`.

### 2. Verify Standalone Status

**Current Status:** ✅ Marathon is already standalone

**Verification:**

- ✅ Separate repository: `/Users/sergiystashok/Documents/GitHub/marathon`
- ✅ Separate Docker containers: `marathon-blue`, `marathon-green`
- ✅ Separate nginx configuration: `marathon.alfares.cz.*.conf`
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

1. **Smoke test marathon.alfares.cz:**
   - Open <https://marathon.alfares.cz> (winners, about, etc.).
   - Call API: `curl https://marathon.alfares.cz/health`, `curl https://marathon.alfares.cz/api/v1/reviews`, `curl https://marathon.alfares.cz/api/v1/winners`.
   - Tick the Verification Checklist below when done.

2. **Optional – enable legacy shim on portal** so speakasap.com marathon pages use the new service when possible:
   - In `speakasap-portal/.env`: `MARATHON_SHIM_ENABLED=true`, `MARATHON_URL=https://marathon.alfares.cz` (or internal URL).
   - Restart portal; check logs for `marathon shim` to confirm forwarding.

### Short-term (Next Phase)

1. **Frontend Integration** (frontend live at <https://marathon.alfares.cz>)
   - Ensure frontend uses same-origin API: `https://marathon.alfares.cz/api/v1/` (or relative `/api/v1/`).
   - Backend already allows origin via `CORS_ORIGIN` and `FRONTEND_URL` in marathon `.env`.
   - Pagination: new API returns `{ items, page, limit, total, nextPage, prevPage }`; frontend must use `response.items` (and optional `response.total`, `response.nextPage`) instead of a plain array or DRF `results`/`next`.
   - Test: reviews, winners, languages, registration, my marathons (auth), random report.

2. **Enable Legacy Shim** (if needed)
   - Set `MARATHON_SHIM_ENABLED=true` in `speakasap-portal/.env`
   - Monitor shim logs for successful forwarding
   - Gradually migrate traffic from legacy to new service

3. **Data Migration** — see “Data export” section below.

### Long-term (Future)

1. **Remove Legacy Code**
   - After full cutover, remove marathon code from speakasap-portal
   - Clean up legacy shim code
   - Archive legacy marathon database

---

## Files Changed

### In Repo

- `marathon/nginx/nginx-api-routes.conf` - No route lines (backend block provides `/api/` and `/health`). Deploy does not overwrite `api_routes` when file is comment-only.

### Production

- **Marathon API (marathon.alfares.cz):** on **dev** server — `ssh dev`, `cd ~/Documents/Github/` (marathon and nginx-microservice there).
- **Portal:** on **speakasap** server — `ssh speakasap`, `cd speakasap-portal`. Set `MARATHON_URL=https://marathon.alfares.cz` and `MARATHON_SHIM_ENABLED=true` in `speakasap-portal/.env`; restart portal.

---

## Data export: legacy DB → new DB

**Goal:** Export marathon data from the legacy portal DB (on **speakasap**) and load it into the new marathon service DB (on **dev**, where marathon.alfares.cz runs).

**Legacy (Django/portal, speakasap):** `marathon_marathon`, `marathon_marathoner`, `marathon_step`, `marathon_answer`, `marathon_winner` (+ `auth_user`, `language_language` for FKs).  
**New (Prisma/marathon service, dev):** `Marathon`, `MarathonStep`, `MarathonParticipant`, `StepSubmission`, `MarathonWinner` (UUIDs; optional `MarathonProduct`, `MarathonGift`, `PenaltyReport` if needed).

**Entity mapping (high level):**

| Legacy | New |
|--------|-----|
| Marathon (id, language_id, title, folder, …) | Marathon (id=uuid, languageCode, title, slug, …) |
| Step (marathon_id, order, title, …) | MarathonStep (marathonId, sequence, title, …) |
| Marathoner (user_id, marathon_id, is_free, report_hour, …) | MarathonParticipant (userId optional, marathonId, email/name/phone from user, isFree, reportHour, …) |
| Answer (marathoner_id, step_id, start, stop, completed, checked, rating) | StepSubmission (participantId, stepId, startAt, endAt, isCompleted, isChecked, rating) |
| Winner (user_id, gold, silver, bronze) | MarathonWinner (userId, goldCount, silverCount, bronzeCount) |

**Steps:**

1. **Export from legacy DB** on **speakasap** (`ssh speakasap && cd speakasap-portal`): script that reads `marathon_marathon`, `marathon_step`, `marathon_marathoner`, `marathon_answer`, `marathon_winner` and joins with `auth_user` / `language_language`. Output: JSON or CSV per entity.
2. **Transform:** Map legacy IDs to new UUIDs; build slug from language/marathon; set languageCode from language.machine_name; normalize dates and booleans.
3. **Load into new DB** on **dev** (`ssh dev`): marathon service DB (DATABASE_URL there). Insert in order: Marathon → MarathonStep → MarathonParticipant → StepSubmission; MarathonWinner last. Use Prisma client or raw SQL respecting FK order.
4. **Verify:** Counts and spot-checks; call marathon.alfares.cz API (e.g. `/api/v1/winners`, `/api/v1/me/marathons`) after mapping portal users to new `userId` if needed.

**Note:** Legacy uses integer PKs and FKs; new uses UUIDs. Keep a mapping table (e.g. legacy_marathon_id → new Marathon.id) if the portal shim or MarathonIdMapping must resolve legacy IDs to new UUIDs.

**Data migration runbook (implemented):**

- **Export (on speakasap):**  
  `cd speakasap-portal && python manage.py export_marathon_data --output marathon_export.json`  
  Writes `marathon_export.json` (marathons, steps, marathoners, answers, winners).

- **Transfer:** Copy `marathon_export.json` to dev (e.g. `scp marathon_export.json dev:~/Documents/Github/marathon/`).

- **Load (on dev):**  
  `cd marathon && node scripts/load-marathon-export.js marathon_export.json`  
  Requires `DATABASE_URL` in marathon `.env`. Inserts in order; writes `marathon_id_mapping.json` beside the export for optional MarathonIdMapping population in the portal.

---

## Frontend integration (implementation)

Frontend is at **<https://marathon.alfares.cz>**. Use the following so it talks to the new API correctly.

- **API base:** Same origin is enough: use **`/api/v1`** (e.g. `GET /api/v1/reviews`, `GET /api/v1/winners`). No need to hardcode `https://marathon.alfares.cz` if the frontend is served from that domain.
- **Pagination (winners, etc.):** New API returns:

  ```json
  { "items": [...], "page": 1, "limit": 24, "total": 0, "nextPage": null, "prevPage": null }
  ```

  Use `response.items` for the list; use `response.total`, `response.nextPage`, `response.prevPage` if the UI needs them. Do not expect a top-level array or DRF-style `results`/`next`.
- **Auth (my marathons):** Send `Authorization: Bearer <token>` (portal-issued JWT when logged in via portal). Backend validates via auth-microservice / portal JWT.

- [x] Winners (and any other paginated lists) use `response.items` and optional pagination fields (winners.js/ts, marathons.js, reports.js).
- [ ] Authenticated “my marathons” requests send Bearer token.
- [x] Smoke test: reviews, winners, languages (200); random report (404 when no data); me/marathons (401 without auth). Registration and my marathons (with auth) – manual when needed.

---

## Verification Checklist

After deploying (tick as you verify):

- [x] `https://marathon.alfares.cz/health` returns `200 OK`
- [x] `https://marathon.alfares.cz/api/v1/reviews` returns reviews list
- [x] `https://marathon.alfares.cz/api/v1/winners` returns winners list
- [x] All API endpoints accessible via HTTPS (health, reviews, winners, languages, random 404 when no data, me/marathons 401 when unauthenticated)
- [x] Nginx config for marathon.alfares.cz (backend block; symlink green)
- [ ] Service health checks passing (confirm on server if needed)
- [ ] Frontend (portal) loads and uses API correctly when MARATHON_URL=marathon.alfares.cz (winners, reviews) – manual check

---

## Summary

**Current State:**

- ✅ Marathon service is standalone and deployed
- ✅ Uses common infrastructure correctly
- ✅ All API endpoints (<https://marathon.alfares.cz>)
- ✅ Nginx routing fixed: registry uses `services.backend` and empty `api_routes`; `marathon/nginx/nginx-api-routes.conf` has no route lines so backend block provides `/api/` (path preserved) and `/health`
- ✅ Frontend live at <https://marathon.alfares.cz>

**Next actions:**

1. ✅ Smoke test done (health, reviews, winners, languages, random, me/marathons).
2. Optionally enable legacy shim in portal: `MARATHON_SHIM_ENABLED=true`, `MARATHON_URL=https://marathon.alfares.cz` in speakasap-portal `.env`; restart portal.
3. Data export: run export from legacy DB on speakasap (`ssh speakasap && cd speakasap-portal`), transform, then load into marathon service DB on dev (see "Data export" section).

**Report Generated:** 2026-02-18  
**Last Updated:** 2026-02-18 (post-deploy verification)
