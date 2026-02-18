# Marathon Legacy Shim Audit Report

**Date:** 2026-01-26  
**Agent:** AGENT08 (Legacy Shim Audit)  
**Scope:** `speakasap-portal` marathon shim routing, env, fallback, logging.

---

## 1. Mapping: Legacy → New Endpoints

| Legacy route | New service | View / handler | Status |
| ------------ | ----------- | -------------- | ------ |
| `GET /marathon/api/winners.json` | `GET /api/v1/winners` | `WinnerListView` | ✅ Mapped |
| `GET /marathon/api/winners/{id}.json` | `GET /api/v1/winners/{winnerId}` | `WinnerView` | ✅ Mapped |
| `GET /marathon/api/random_report/{step}.json?marathoner=` | `GET /api/v1/answers/random?stepId=&excludeMarathonerId=` | `RandomReportView` | ✅ Mapped |
| `GET /marathon/api/my.json` | `GET /api/v1/me/marathons` | `MyMarathonsList` | ✅ Mapped |
| `GET /marathon/api/my/{id}.json` | `GET /api/v1/me/marathons/{marathonerId}` | `MyMarathonsList` | ❌ **Wrong** |
| `GET /marathon/api/languages.json` | `GET /api/v1/marathons/languages` | `MarathonLanguageList` | ✅ Mapped |
| `GET /marathon/api/reviews.json` | `GET /api/v1/reviews` | `ReviewListView` | ✅ Mapped |
| `POST /marathon/api/register.json` | `POST /api/v1/registrations` | `register` | ✅ Mapped |

---

## 2. Missing Routes / Issues

### 2.1 `GET /marathon/api/my/{id}.json` → `GET /api/v1/me/marathons/{id}` (wrong mapping)

- **Issue:** `api_urls.py` uses `MyMarathonsList` (ListAPIView) for **both** `my.json` and `my/(?P<pk>\d+)\.json`. The list view always calls `GET /api/v1/me/marathons` and never passes `pk`. The detail endpoint `GET /api/v1/me/marathons/{marathonerId}` is **never** used.
- **Existing but unused:** `MyMarathon` (RetrieveAPIView) in `api_views/common.py` implements the correct shim logic for `me/marathons/{pk}` but is **not** referenced in `api_urls.py`.
- **Required change:** Use `MyMarathon` for `my/(?P<pk>\d+)\.json` instead of `MyMarathonsList` so the detail route is correctly proxied to the new service. (Audit does not modify code; this is documented for follow-up.)

### 2.2 ID format mismatch (validation only)

- Legacy `winners/{id}` and `my/{id}` use numeric `pk` (`\d+`). The new service uses UUIDs for `winnerId` / `marathonerId`. If the new DB uses UUIDs only, legacy frontends sending integer IDs may receive 404s. Recommend validating with real usage or migration state.
- `random_report/{step}` uses legacy step pk (integer); new service uses `stepId`. Same consideration if steps are UUIDs in the new DB.

---

## 3. Env Keys

| Key | Used | Notes |
| --- | ---- | ------ |
| `MARATHON_URL` | ✅ All shim paths | Required when shim enabled. Present in `.env` (e.g. `https://marathon.alfares.cz`). |
| `MARATHON_SHIM_ENABLED` | ✅ All shim paths | Default `'false'`; must be `'true'` to enable. |
| `MARATHON_API_KEY` | ✅ All shim paths | Optional; sent as `X-Api-Key` when set. |

---

## 4. Fallback Behavior

| Condition | Behavior | Verified |
| --------- | -------- | -------- |
| `MARATHON_SHIM_ENABLED` false or unset | Legacy behavior | ✅ |
| `MARATHON_URL` missing | Legacy behavior | ✅ |
| New service returns **5xx** | Fall back to legacy | ✅ |
| Request to new service **times out** or **throws** | Fall back to legacy | ✅ |
| New service returns **4xx** | Return new service response as-is | ✅ |

---

## 5. Logging

- All outbound shim calls log: **path**, **status**, **latency_ms**.
- **user_id** logged for `my` list and `my` detail (when available).
- On exception: **error**, **path**, **latency_ms** (and **user_id** for `my`).
- Fallback is implied by “shim … failed” logs; no separate “fallback activation reason” field. Acceptable for audit.

---

## 6. Unrelated Legacy Code

- Changes are limited to `marathon` API views and `marathon.reviews` API views. No unrelated legacy code modified.

---

## 7. GO / NO-GO for `MARATHON_SHIM_ENABLED`

**NO-GO**

**Reason:** `GET /marathon/api/my/{id}.json` is not correctly mapped to `GET /api/v1/me/marathons/{marathonerId}`. The detail route always hits the list endpoint. Fix by wiring `my/(?P<pk>\d+)\.json` to `MyMarathon` (and ensuring ID handling is consistent) before enabling the shim.

---

## 8. References

- Shim plan: `speakasap/docs/refactoring/MARATHON_LEGACY_SHIM_PLAN.md`
- Parity checklist: `speakasap/docs/refactoring/MARATHON_PARITY_CHECKLIST.md`
- Legacy API: `speakasap-portal/marathon/api_urls.py`, `api_views/`, `reviews/api_views.py`
