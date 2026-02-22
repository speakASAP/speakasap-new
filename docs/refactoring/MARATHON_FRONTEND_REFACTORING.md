# Marathon Frontend Refactoring

**Date:** 2026-02-21  
**Last updated:** 2026-02-22  
**Status:** In progress  
**Goal:** Serve full marathon UI at <https://marathon.alfares.cz>: landings (language-specific) and internal pages, so users see the frontend instead of JSON.

**Document structure:** § Step-by-step implementation plan (execute in order) → § Prerequisites → § Phases 1–2 detail → § Verification & rollback → § Reference (URL mapping, pages, functionality, reports/tests).

---

## Problem

- **speakasap.com/marathon** and **speakasap.com/marathon/{lang}/** (e.g. `/marathon/german/`, `/marathon/english/`) redirect to **marathon.alfares.cz**.
- **marathon.alfares.cz** must serve the full UI: language landings and internal pages (winners, reviews, profile, about, registration, step/task pages). Currently only a minimal home and API exist.

---

## Step-by-step implementation plan

Execute in order. Do not skip steps; each step’s “Done when” must be met before the next.

### Step 0: Prerequisites (already done)

- [x] **0.1** Marathon NestJS API running at marathon.alfares.cz; `GET /health`, `GET /api/v1/*` return 200. See `MARATHON_CURRENT_STATUS_AND_NEXT_STEPS.md`.
- [x] **0.2** Portal redirect: all `/marathon/*` → marathon.alfares.cz (speakasap_site marathon_redirect, marathon/urls.py).
- [x] **0.3** Static serving: NestJS serves `public/` at `/`; exclusions `/api`, `/health`, `/info`; root JSON at `GET /info`.
- [x] **0.4** Minimal home: `public/index.html` with winners + reviews; Dockerfile `COPY public ./public`.
- [x] **0.5** Shim enabled on portal: `MARATHON_SHIM_ENABLED=true`, `MARATHON_URL=https://marathon.alfares.cz` (prod speakasap-portal `.env`).

**Done when:** `https://marathon.alfares.cz/` shows UI; `https://marathon.alfares.cz/api/v1/winners` returns data; `https://speakasap.com/marathon` redirects to marathon.alfares.cz.

---

### Step 1: Frontend app setup (one-time)

- [x] **1.1** Create `marathon/frontend/` with Vite + React + TypeScript (or agreed stack). Client-side router (e.g. React Router); base path `/`.
- [x] **1.2** Configure build output → `marathon/public/` (so NestJS serves the SPA). Add npm script `build:frontend` (and optionally `dev:frontend`).
- [x] **1.3** Ensure all non-API routes serve `index.html` (SPA fallback). No change needed if static module already serves `public/` with fallback.

**Done when:** `npm run build:frontend` produces `public/index.html` and assets; opening `https://marathon.alfares.cz/` loads the SPA shell (even if empty). **Done 2026-02-21:** frontend created; routes `/`, `/winners`, `/:langSlug/`; root `npm run build:frontend` builds to `public/`.

---

### Step 2: Phase 1 — Landing refactoring ✅

- [x] **2.1** Add route `/:langSlug/` in the SPA. Resolve `langSlug` to language (e.g. fetch `GET /api/v1/marathons/languages`, match slug/code; or `GET /api/v1/marathons/by-language/:code`).
- [x] **2.2** Build landing page component: promo/hero, results, program, reviews (use `GET /api/v1/reviews`), video (marathon `landingVideoUrl`), certificates, FAQ, guarantee, motivation. Copy content from `speakasap-portal/marathon/templates/marathon/landing.html` and `landing/block*.html`.
- [x] **2.3** Add registration form on landing; submit to `POST /api/v1/registrations` with marathon/language context.
- [x] **2.4** Home (`/`): show links to each language landing (from `GET /api/v1/marathons/languages`) and existing winners/reviews block.
- [x] **2.5** SEO: per-landing meta title, description, canonical (e.g. `https://marathon.alfares.cz/german/`).

**Done when:** `https://marathon.alfares.cz/german/` and `/english/` (and other languages from API) show correct landing; registration form submits successfully; `https://speakasap.com/marathon/german/` redirects and shows same content. **Done 2026-02-22:** full landing at `/:langSlug/` (langSlug = language code, e.g. `/de/`, `/en/`); promo, results, program, reviews (API), video (if `landingVideoUrl`), certificates, FAQ, guarantee, motivation, registration form; Home links to `/${code}/`; SEO title/meta/canonical set in Landing.

---

### Step 3: Phase 2a — Public and static pages ✅

- [x] **3.1** `/winners` — list with pagination; `GET /api/v1/winners?page=&limit=`; use `items`, `nextPage`; “Load more” button.
- [x] **3.2** `/winners/:winnerId` — winner detail; `GET /api/v1/winners/:winnerId`; optional “random report” via `GET /api/v1/answers/random` (deferred).
- [x] **3.3** `/reviews` — page; `GET /api/v1/reviews`.
- [x] **3.4** `/about`, `/rules`, `/faq` — static content; copy from legacy templates `about.html`, `rules.html`, `faq.html`, `common_rules.html`.

**Done when:** All above routes load and show correct content; winners list and winner detail work with real API. **Done 2026-02-22:** Winner list uses API `name`, `gold`, `silver`, `bronze`; WinnerDetail page with medals and reviews; Reviews page; About, Rules, FAQ static pages; Home nav links to all.

---

### Step 4: Phase 2b — Auth and profile ✅

- [x] **4.1** Integrate auth: from marathon frontend, redirect unauthenticated users to portal login with return URL to marathon.alfares.cz (e.g. `/profile`). Portal issues JWT; frontend sends `Authorization: Bearer <token>` for protected calls.
- [x] **4.2** `/profile` — list user’s marathons; `GET /api/v1/me/marathons` (Bearer). Link to each marathon detail.
- [x] **4.3** `/profile/:marathonerId` or `/my/:id` — my marathon detail; `GET /api/v1/me/marathons/:id` (Bearer). Show current step, progress, “Открыть” link to step/task page.

**Done when:** Logged-in user can open `/profile`, see list of marathons, open one and see detail; unauthenticated user is redirected to login and returns to marathon after login. **Done 2026-02-22:** Auth: token in localStorage; capture from URL `?marathon_token=` or `#marathon_token=`; `authFetch()` for Bearer; redirect to `VITE_PORTAL_LOGIN_URL?next=...`. Profile list and detail pages; API `Answer` extended with `stepId` for step links. Placeholder `/steps/:stepId` (Step 5 will add full UI). **Note:** Portal must redirect back to marathon with token in URL (e.g. `?marathon_token=JWT`) for post-login flow.

---

### Step 5: Phase 2c — Step (task) page and other marathoners’ results ✅

- [x] **5.1** Add route `/steps/:stepId/` (or `/step/:stepId/`). Page shows: task (assignment) and report in two tabs (Задание / Отчет). Data: step content from API (if step API exists) or static; report from `GET /api/v1/answers/random?stepId=&excludeMarathonerId=` when viewing report.
- [x] **5.2** After user submits own report, show block «Результаты других марафонцев»: call `GET /api/v1/answers/random?stepId=&excludeMarathonerId=<current>`; display HTML report safely; button «Показать ещё» to load another random report.
- [x] **5.3** Step form submit / “open early”: implement via API if marathon service exposes step update endpoints; otherwise document as follow-up. Ensure emails (notifications) that link to “current task” use new URL (e.g. `https://marathon.alfares.cz/steps/:stepId/`).
- [x] **5.4** `/support/step/:stepId/` — support view of one step (content from API or static); linked from `/support` (list of marathons and steps).

**Done when:** User can open a step page, switch between task and report tabs, and after submitting own report see other marathoners’ results; support step page loads. **Done 2026-02-22:** Backend: StepsModule with GET /api/v1/steps/:stepId (step title/sequence) and GET /api/v1/steps?marathonId= (list). Frontend: Step page with tabs Задание/Отчет; Report tab shows «Результаты других марафонцев» via answers/random, «Показать ещё»; task tab placeholder. Support page lists marathons and steps (links to /support/step/:stepId); SupportStep page shows step title. Step form submit / open early: deferred (no API yet).

---

### Step 6: Phase 2d — Remaining pages and flows ✅

- [x] **6.1** `/register` (standalone) if needed; `/awards` or `/gift`; `/leave-confirm`; `/support` (list marathons + step links).
- [x] **6.2** Questionnaires (if in scope): define scope (e.g. post-step feedback); add API if needed; add UI component.
- [x] **6.3** Certificates/awards: ensure certificate image or URL available (API or static); award view page or modal.

**Done when:** All routes listed in Reference § “List of all pages needed” either implemented or explicitly deferred with a short note. **Done 2026-02-22:** `/register`, `/awards`, `/gift`, `/leave-confirm` (static); Home nav: Регистрация, Награды, Поддержка. Deferred: Questionnaires; certificate API.

---

### Step 7: Verification and rollout

- [ ] **7.1** Smoke test: open each main URL (/, /german/, /winners, /winners/:id, /about, /profile, /steps/:id) and confirm correct content and no console errors.
- [ ] **7.2** Verify redirect chain: speakasap.com/marathon, speakasap.com/marathon/german/ → marathon.alfares.cz with correct path.
- [ ] **7.3** Deploy: build frontend, build Docker image (includes `public/`), deploy to dev/prod per runbook; no nginx changes in prod (config regenerated by deploy script).
- [ ] **7.4** Monitor logs (marathon service, portal shim) for errors; fix critical issues and document known limitations.

**Done when:** Production marathon.alfares.cz serves full UI; all critical user flows work; doc updated with any deferred items.

---

### Step 8: Rollback (if needed)

- **8.1** Frontend only: redeploy previous Docker image (previous `public/`). No API or portal change.
- **8.2** If portal redirect must be reverted: change marathon URLs in portal to point back to legacy (if any legacy UI still exists) or to a maintenance page; redeploy portal.
- **8.3** Document incident and reason for rollback; plan fix before next attempt.

**Success criteria for full refactoring:** (1) All legacy marathon URLs that redirect to marathon.alfares.cz resolve to the correct new page. (2) Landings, winners, reviews, profile (auth), step/task page, and “other marathoners’ results” flow work. (3) No nginx or portal code changes required on prod beyond existing redirect and shim; config only in marathon codebase.

---

## Prerequisites (checklist)

| Item | Status | Notes |
|------|--------|------|
| Marathon API live at marathon.alfares.cz | ✅ | Health, /api/v1/* |
| Portal redirect /marathon/* → marathon.alfares.cz | ✅ | speakasap_site + marathon/urls |
| NestJS serves static from `public/`, root at /info | ✅ | ServeStaticModule, AppController |
| Minimal home in public/index.html | ✅ | Winners + reviews |
| Docker image includes `COPY public ./public` | ✅ | Dockerfile |
| Portal shim: MARATHON_SHIM_ENABLED, MARATHON_URL | ✅ | Prod .env |
| MARATHON_PORTAL_JWT_SECRET aligned (portal + marathon) | Verify | For auth in Phase 2b |

---

## Verification and rollback (summary)

- **Verification:** After each phase, run smoke tests (Step 7.1–7.2). After full rollout, run Step 7.4. See § Step 7 above.
- **Rollback:** Revert to previous Docker image (Step 8.1); if needed, revert portal redirect (Step 8.2). See § Step 8 above.

---

## Reference: Legacy URL mapping

All these legacy URLs redirect to marathon.alfares.cz; the new frontend must support equivalent paths.

| Legacy URL (speakasap.com) | New URL (marathon.alfares.cz) | Purpose |
|---------------------------|------------------------------|--------|
| `/marathon/` | `/` | Home (marathon hub / winners + reviews) |
| `/marathon/german/` | `/german/` | German marathon landing |
| `/marathon/english/` | `/english/` | English marathon landing |
| `/marathon/french/`, etc. | `/{slug}/` | Other language landings (slug = language slug/code from API) |
| `/marathon/profile/` | `/profile/` | User marathon profile (auth) |
| `/marathon/steps/:id/` | `/steps/:stepId/` or `/step/:stepId/` | **Step (task) page** — страница с заданием, которое человек выполняет сейчас |
| `/marathon/steps/:id/update/...` | `/steps/:stepId/update/...` or API | Form submit / update for step |
| `/marathon/steps/:id/open/update/...` | `/steps/:stepId/open/update/...` or API | Open step early + update |
| `/marathon/support/step/:id/` | `/support/step/:stepId/` | Support view of step (from `marathon:support_step`) |
| `/marathon/*` (catch‑all) | `/*` | Internal pages: about, rules, faq, registration, winners list, etc. |

Landing URLs use the **language slug** (e.g. `german`, `english`) from `GET /api/v1/marathons/languages` (e.g. `slug` or `url` field). Frontend must support `/:langSlug/` for landings.

**Step / assignment URLs (этапы и задания):** В legacy использовались пути `/marathon/steps/` и `/marathon/step/` — это страница с заданием (этапом), которое участник выполняет сейчас. На новой платформе нужно поддержать эквиваленты, например `/steps/:stepId/` или `/step/:stepId/` (или `/my/:marathonerId/steps/:stepId/` в контексте «мой марафон»). Ссылки на эту страницу в legacy: `answer.form_url`, `answer.report_url`, `latest_answer.report_or_task_link`, письма (notifications) с `latest_answer.form_url`. См. раздел «References to step/assignment URLs» ниже.

---

## Phase 1–2 detail (for Steps 2–6)

The following sections describe scope and deliverables for **Phase 1** (landings) and **Phase 2** (internal pages). Execute in the order given in **Step-by-step implementation plan** above.

---

### Phase 1: Landing refactoring (priority)

**Objective:** Refactor language-specific landings so URLs like `http://speakasap.com/marathon/german/` (and thus `https://marathon.alfares.cz/german/`) show the correct marathon landing page.

**Scope:**

1. **Routes**
   - Support `GET /` (home) and `GET /:langSlug/` (e.g. `/german/`, `/english/`) in the SPA. All non-API paths serve the SPA; client-side router resolves `/:langSlug/` to the landing view.

2. **Data**
   - Use existing API:
     - `GET /api/v1/marathons/languages` — list of languages (code, name, slug/url, etc.).
     - `GET /api/v1/marathons/by-language/:languageCode` — marathon summary for a language (title, slug, coverImageUrl, landingVideoUrl, etc.).
   - Map URL segment to language: e.g. `/german/` → `languageCode` or slug `german` → fetch marathon by language.

3. **Landing content (from legacy)**
   - Replicate the structure of the legacy landing (one long page per language):
     - Promo/hero (title, CTA, nav).
     - Results block.
     - Program (steps).
     - Reviews block (use `GET /api/v1/reviews`).
     - Video block (use marathon `landingVideoUrl` if present).
     - Certificates block.
     - FAQ block.
     - Guarantee block.
     - Motivation block.
     - Registration form (use `POST /api/v1/registrations`).
   - Copy and adapt content/copy from `speakasap-portal/marathon/templates/marathon/landing*.html` and blocks in `marathon/templates/marathon/landing/`. No server-side rendering; use new stack (e.g. React/Vite) and API data.

4. **SEO / canonical**
   - Per-landing meta title, description, canonical URL (e.g. `https://marathon.alfares.cz/german/`). Use marathon title and language from API.

**Deliverables (Phase 1):**

- [ ] SPA supports route `/:langSlug/` and resolves language (from API languages list or by-language).
- [ ] Landing page component(s) for each language, with blocks above (content from legacy templates).
- [ ] Registration form on landing calling `POST /api/v1/registrations`.
- [ ] Links from home to each language landing (e.g. from `GET /api/v1/marathons/languages`).
- [ ] Verify: `https://marathon.alfares.cz/german/`, `/english/`, etc. show correct landing; `speakasap.com/marathon/german/` redirects and shows same content.

---

### Phase 2: Internal pages refactoring

**Objective:** Refactor all remaining marathon pages (winners, about, profile, rules, faq, registration flow, etc.) on the new frontend so all legacy URLs work via marathon.alfares.cz.

**Scope:**

1. **Routes to support (examples)**
   - `/` — home (already minimal; can be enhanced with links to landings + winners/reviews).
   - `/winners` — winners list (use `GET /api/v1/winners`; pagination with `items`, `nextPage`).
   - `/winners/:winnerId` — winner detail (use `GET /api/v1/winners/:winnerId`).
   - `/reviews` — reviews (use `GET /api/v1/reviews`) or keep as block on home/landing.
   - `/about` — about marathon / company (static or from API if added).
   - `/profile` — user’s marathons (auth; `GET /api/v1/me/marathons`).
   - `/profile/:marathonId` (or similar) — my marathon detail (`GET /api/v1/me/marathons/:id`).
   - `/rules`, `/faq` — rules and FAQ (content from legacy templates).
   - **`/steps/:stepId/` or `/step/:stepId/`** — step (task) page — страница с заданием, которое человек выполняет сейчас (tabs: Задание / Отчет). Legacy: `/marathon/steps/:id/`, `form_url`, `report_url`; middleware: `.../update/`, `.../open/update/`.
   - **`/support/step/:stepId/`** — support view of step (from `marathon:support_step`).
   - Registration can be modal/block on landing (Phase 1) and/or dedicated page; ensure `POST /api/v1/registrations` and auth flow (portal JWT) where needed.

2. **Auth**
   - Profile and “my marathons” require portal-issued JWT (Bearer). Frontend must work with portal login and pass token (e.g. cookie or redirect to portal login with return URL to marathon.alfares.cz).

3. **Content sources**
   - Legacy templates: `marathon/templates/marathon/about.html`, `rules.html`, `faq.html`, `common_rules.html`, `winners.html`, `profile.html`, etc. Copy structure and copy into new components; no Django.

**Deliverables (Phase 2):**

- [ ] Winners list and winner detail pages.
- [ ] About, rules, FAQ pages.
- [ ] Profile (my marathons) and my-marathon detail with auth.
- [ ] **Other marathoners' results (reports):** after user submits own step report, block «Результаты других марафонцев» with view of other participants' reports (random via `GET /api/v1/answers/random`; «Показать ещё» to load another); this flow moved to new platform.
- [ ] **Questionnaires:** if in scope — pre-step or post-step questionnaire UI and API (e.g. post-step feedback); define scope and API.
- [ ] Any remaining registration or post-registration flows.
- [ ] Verify: all legacy marathon URLs that redirect to marathon.alfares.cz resolve to the correct new page.

---

## Current State (baseline)

- **Legacy frontend:** Django templates + Angular in `speakasap-portal/marathon/templates/` and `marathon/static/`. Not served; all `/marathon/*` redirect to marathon.alfares.cz.
- **New marathon service:** NestJS API at marathon.alfares.cz; static frontend from `public/`; root `GET /` serves minimal home (winners + reviews); `GET /info` for service info; `GET /api/v1/*` for API.

## Target State (after both phases)

- **marathon.alfares.cz** serves:
  - `GET /` — home (links to landings + winners/reviews).
  - `GET /:langSlug/` — language landing (e.g. `/german/`, `/english/`).
  - `GET /winners`, `/winners/:id`, `/about`, `/profile`, `/rules`, `/faq`, etc. — internal pages.
  - All via SPA (one `index.html`; client-side routing). Static assets from `public/`.
  - `GET /health`, `GET /info`, `GET /api/v1/*` — unchanged.

## Implementation (foundation already in place)

1. **Static serving**
   - NestJS serves `public/` at `/`; exclusions for `/api`, `/health`, `/info`. SPA fallback: non-API paths serve `index.html`.

2. **Frontend app**
   - Prefer a single app in `marathon/frontend/` (e.g. Vite + React + TypeScript) with client-side router:
     - Routes: `/`, `/:langSlug/`, `/winners`, `/winners/:id`, `/about`, `/profile`, etc.
     - Phase 1: implement landing route and landing page; Phase 2: add the rest.
   - Build output → `marathon/public/`.

3. **Docker**
   - Image already includes `COPY public ./public`. Build frontend before `docker build` (or in CI) so `public/` contains the SPA.

## Master checklist (map to steps)

| Done | Item | Step |
|------|------|------|
| [x] | Document plan (this file) | — |
| [x] | Static serving; root JSON → /info | 0.3 |
| [x] | Minimal home in public/index.html | 0.4 |
| [x] | Dockerfile COPY public | 0.4 |
| [x] | Frontend app setup (Vite+React, build → public) | 1 |
| [ ] | Phase 1: Landings (routes, content, registration, SEO) | 2 |
| [ ] | Phase 2a: Winners, reviews, about, rules, faq | 3 |
| [ ] | Phase 2b: Auth, profile, my marathon detail | 4 |
| [ ] | Phase 2c: Step page, other marathoners' results, support step | 5 |
| [x] | Phase 2d: Register, awards, leave, questionnaires, certificates | 6 |
| [ ] | Verification and rollout | 7 |

---

## Reference 1: List of all pages needed

Frontend must implement the following routes (SPA). Legacy template names are given for content reference.

| # | Route | Purpose | Legacy template / note |
|---|--------|---------|-------------------------|
| 1 | `/` | Home — hub, links to landings + winners + reviews | — |
| 2 | `/:langSlug/` | Language landing (e.g. `/german/`, `/english/`) | `landing.html`, `landing/block*.html` |
| 3 | `/winners` | Winners list (paginated) | `winners.html` |
| 4 | `/winners/:winnerId` | Winner detail (card + optional random report) | Angular winner dialog / winner detail |
| 5 | `/reviews` | Reviews list (or keep as block on home/landing only) | Block in `landing/block4_reviews.html` |
| 6 | `/about` | About marathon / company | `about.html` |
| 7 | `/rules` | Marathon rules | `rules.html` |
| 8 | `/common-rules` or merge | Common rules | `common_rules.html` |
| 9 | `/faq` | FAQ | `faq.html` |
| 10 | `/profile` | User’s marathons (auth required) | `profile.html` |
| 11 | `/profile/:marathonerId` or `/my/:id` | My marathon detail (auth) | Profile detail / marathon dashboard |
| 12 | `/register` | Standalone registration (optional; main flow = modal on landing) | `registration.html`, `landing/form_registration*.html` |
| 13 | `/report` or `/winners/:winnerId/report` | Random step report (HTML from API) | `report.html`, `report_other.html`; API `GET /api/v1/answers/random` |
| 14 | `/awards` or `/gift` | Awards / certificates / gifts page | `awards_view.html`, `gift.html` |
| 15 | `/support` | Support — list of marathons + step links (internal/support) | `support/marathons.html`, `support/step.html` |
| 16 | `/leave-confirm` | Leave marathon confirmation | `leave_confirm.html` |
| 17 | `/marathon` or `/:langSlug/dashboard` | Marathon dashboard (post-login, current step, progress) | `marathon.html`, `step.html`, `widgets/current.html` |
| 17a | **`/steps/:stepId/` or `/step/:stepId/`** | **Step (task) page** — страница с заданием, которое человек выполняет сейчас (form + report tabs) | `step.html`, `report.html`; `answer.form_url` / `answer.report_url`; middleware: `/marathon/steps/{id}/update/`, `.../open/update/` |
| 17b | **`/support/step/:stepId/`** | Support view of one step (from links in support marathons list) | `support/step.html`; `marathon:support_step` in `support/marathons.html` |
| 18 | **Other marathoners' results (reports)** | After submitting own report, view other participants' reports for the same step | Block in step/report flow; API `GET /api/v1/answers/random`; see § below |
| 19 | **Questionnaires** | Pre-step or post-step questionnaire / feedback (if in scope) | Optional; API TBD or extend step submission |

**Step forms (many per language):** Legacy has per-language step forms (e.g. `steps/german/Step3Form1.html`). If the new product keeps “step-by-step” flow in-app, these become dynamic step views (data from API); otherwise steps can be external or simplified. List as separate sub-project if in scope.

**References to step/assignment URLs (ссылки на этапы и задания):**

| Where | What | Legacy URL pattern / note |
|-------|------|---------------------------|
| **portal/middleware.py** | Log-minimize exclude patterns | `r'/marathon/steps/\d+/update/\w+/'`, `r'/marathon/steps/\d+/open/update/\w+/'` — step form submit and "open early" update |
| **marathon/templates/marathon/step.html** | Tabs: Задание (task) / Отчет (report) | `answer.form_url` (task), `answer.report_url` (report) |
| **marathon/templates/marathon/report.html** | Same tabs | `answer.form_url`, `answer.report_url` |
| **marathon/templates/marathon/widgets/current.html** | "Текущий этап" — link "Открыть" | `latest_answer.report_or_task_link` |
| **marathon/templates/marathon/marathon_steps.html** | Step list in sidebar | `{% step_link s step %}` → `marathon/tags/step_link.html` (uses `url` for step) |
| **marathon/templates/marathon/support/marathons.html** | List of steps per marathon | `{% url 'marathon:support_step' step.pk %}` → support step page |
| **marathon/templates/marathon/support/step.html** | Support view of one step | Step content + `marathon-steps.js` |
| **notifications/emails/student/** | Marathon delay/reminder emails | `latest_answer.form_url` in links (marathon_delay_1, marathon_delay_2, marathon_delay_7, marathon_delay_30, marathon_after_second_step, marathon_day_missed) |
| **marathon/api_urls.py** | Random report (step in path) | `random_report/(?P<step>[\w-]+).json` → stepId for API |

New platform must support: **`/steps/:stepId/`** or **`/step/:stepId/`** (task page), and **`/support/step/:stepId/`** (support). Emails that link to "current task" should point to the new base URL (e.g. `https://marathon.alfares.cz/steps/:stepId/` or `/my/:id/steps/:stepId/`).

**Results/reports from other marathoners (перенос на новую платформу):** После создания своего отчёта участник должен иметь возможность видеть результаты (отчёты) других марафонцев. Этот функционал нужно перенести на новую платформу: на странице после отправки своего отчёта по шагу — блок «Результаты других марафонцев» с возможностью просмотра одного или нескольких случайных отчётов других участников по этому же шагу (API: `GET /api/v1/answers/random?stepId=&excludeMarathonerId=`). При необходимости — API для списка отчётов по шагу с пагинацией.

---

## Reference 2: List of all functionality to be implemented

| # | Functionality | Description | API / backend |
|---|---------------|-------------|----------------|
| 1 | Language list | Show all marathon languages; links to landings | `GET /api/v1/marathons/languages` |
| 2 | Marathon by language | Get marathon summary for a language (title, slug, video, etc.) | `GET /api/v1/marathons/by-language/:languageCode` |
| 3 | Landing blocks | Promo, results, program, reviews, video, certificates, FAQ, guarantee, motivation | `GET /api/v1/reviews`; marathon payload for rest |
| 4 | Registration | Anonymous registration for a marathon | `POST /api/v1/registrations` |
| 5 | Winners list | Paginated list with “Load more” | `GET /api/v1/winners?page=&limit=` (use `items`, `nextPage`) |
| 6 | Winner detail | Single winner card + medals; optional “random report” | `GET /api/v1/winners/:winnerId` |
| 7 | Random report | Show one participant’s step report (HTML) | `GET /api/v1/answers/random?stepId=&excludeMarathonerId=` |
| 8 | Reviews list | Display reviews (on landing and/or /reviews page) | `GET /api/v1/reviews` |
| 9 | My marathons (auth) | List of user’s marathons | `GET /api/v1/me/marathons` (Bearer) |
| 10 | My marathon detail (auth) | One marathon progress / dashboard | `GET /api/v1/me/marathons/:id` (Bearer) |
| 11 | Auth with portal | Login via portal; return to marathon with JWT/cookie for /profile and /my/* | Portal login URL + return URL; send Bearer from frontend |
| 12 | SEO / meta | Per-page title, description, canonical | Client-side or static per route |
| 13 | Static content | About, rules, FAQ, common rules (copy from legacy) | No API; static or CMS later |
| 14 | Certificates / awards | View certificate or award for a participant | Legacy used `certificate_image`; API may expose URL or reuse winner payload |
| 15 | Leave marathon | Confirm and leave marathon (if supported by API) | API TBD or N/A |
| 16 | Support / step links | List marathons and steps for support (optional) | `GET /api/v1/marathons`, steps from marathon detail if API exists |
| 17 | **View other marathoners' reports (results)** | After participant creates own report, show other participants' reports for the same step («результаты других марафонцев»). Must be on new platform. | `GET /api/v1/answers/random?stepId=&excludeMarathonerId=` (optionally add API for list of reports by step) |
| 18 | **Questionnaires** | Pre-step or post-step questionnaire / feedback (e.g. short survey after step completion) | Define scope; API TBD (e.g. `POST /api/v1/steps/:stepId/questionnaire` or extend step submission payload) |

---

## Reference 3: Reports, tasks, tests

### 3.1 Reports (data / views)

| Report | Purpose | Source | Frontend action |
|--------|---------|--------|-----------------|
| Random step report | Public view of one participant’s step report (HTML) | `GET /api/v1/answers/random` (returns `report` HTML) | Page or modal at `/report` or `/winners/:id/report`; render HTML safely |
| Winner detail “report” | Some winner views show a sample report | Same API or winner-specific endpoint | Embed or link from winner detail page |
| **Other marathoners' results** | After own report is submitted, participant sees other marathoners' reports for the same step (результаты/отчёты других марафонцев). **Must be moved to new platform.** | `GET /api/v1/answers/random?stepId=&excludeMarathonerId=` | In step/report flow: block «Результаты других марафонцев» with «Показать ещё»; safe render of HTML report |
| Award / certificate | Certificate or award view for a marathoner | Legacy: image URL from context | Dedicated page or modal; ensure API or static URL for certificate image |

### 3.2 Backend / scheduled tasks (marathon service or portal)

Legacy portal had Celery tasks (no-ops after removal):

- `marathon.notify_after_second_step`
- `marathon.notify_after_free_part`
- `marathon.check_activity`

If the new marathon service or notifications must replicate this behaviour, implement equivalent jobs in the marathon service or via notifications-microservice; document in marathon runbook. Not part of frontend refactoring.

### 3.3 Management commands (portal)

Used for data and ops (not frontend):

- `export_marathon_data` — export legacy data
- `load_marathon_id_mapping` — load ID mapping for shim
- `init_marathon`, `update_marathon`, `update_winners`, `update_winners_finish_date` — legacy/no-op or one-time

No frontend work; keep in portal runbook.

### 3.4 Tests

| Scope | What to test | Where |
|-------|--------------|--------|
| **E2E / smoke** | Home loads; landing `/german/` loads; winners list and winner detail load; API returns 200 for `/api/v1/winners`, `/api/v1/reviews`, `/api/v1/marathons/languages` | Manual or E2E (e.g. Playwright) against marathon.alfares.cz |
| **Frontend unit** | Components (landing, winners list, winner card, registration form) if using React/Vite | `marathon/frontend/` (e.g. Vitest + React Testing Library) |
| **API contract** | Response shape of winners, reviews, languages, registrations | Optional: contract tests or smoke in marathon service repo |
| **Portal** | Placeholder test only (`test_legacy_removed`); no marathon UI tests in portal | `speakasap-portal/marathon/tests.py` |

Add to plan: after Phase 1, run smoke (landing + API); after Phase 2, run smoke for all main pages. Optional: add E2E suite and frontend unit tests as per project rules.

---

## References (docs and APIs)

- `MARATHON_CURRENT_STATUS_AND_NEXT_STEPS.md` — Frontend integration, API.
- `MARATHON_LEGACY_SHIM_PLAN.md` — Legacy API mapping.
- Legacy landings: `speakasap-portal/marathon/templates/marathon/landing.html` and `marathon/landing/block*.html`.
- API: `GET /api/v1/marathons/languages`, `GET /api/v1/marathons/by-language/:languageCode`, `GET /api/v1/reviews`, `POST /api/v1/registrations`, `GET /api/v1/answers/random`, `GET /api/v1/winners`, `GET /api/v1/me/marathons`.
- User rule: reconfiguration only in marathon codebase; prod nginx regenerated by deploy script.
