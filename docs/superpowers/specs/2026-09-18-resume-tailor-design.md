# Resume Tailor — Design

## Problem

Applying to software engineering / DevOps jobs requires hand-editing a resume per job description. There's already a master CV (or several — not limited to 2 people) containing the full true history of projects, skills, and experience. Want a local tool: pick a person's master CV, paste a job description, get a tailored resume back — reordered/reworded from real content only, never fabricated — that can be hand-edited before printing to PDF.

## Non-goals

- No multi-tenant/auth/hosting — local tool, runs on one machine.
- No fabrication-verification code (fuzzy matching source vs output) in v1 — enforced via prompt only. Revisit only if it actually hallucinates.
- No real server-side PDF rendering — PDF via browser print, not a PDF library.

## Architecture

Single local Node.js + Express server, vanilla HTML/CSS/JS frontend (no framework). Minimal deps: `express`, `dotenv`, `marked` (markdown → HTML for preview/print), Node's built-in `fetch` for OpenRouter calls.

```
builder/
  server.js
  .env                    # OPENROUTER_API_KEY
  cvs/                    # one JSON file per person, created via UI
    <person-id>.json
  prompts/
    SKILL.md              # tailoring rules, sent as system prompt content
  public/
    index.html
    app.js
    style.css
```

### Master CV storage

- Not limited to 2 fixed people. `cvs/` holds an arbitrary set of JSON files, one per person, named by a slug of the person's name.
- Each file: `{ name, contact, summary, skills: [...], experience: [{title, company, dates, bullets: [...]}], projects: [{name, desc, bullets: [...]}], education: [...] }`.
- Backend endpoints:
  - `GET /api/people` — list existing person ids/names
  - `GET /api/cv/:id` — read one master CV
  - `PUT /api/cv/:id` — create/update a master CV (used by "Add person" and the edit form)
  - `DELETE /api/cv/:id` — remove a person

### Tailoring

- `POST /api/tailor` `{ personId, jobDescription }`
- Server loads `prompts/SKILL.md` (tailoring rules — no fabrication, quantify from source only, SWE/DevOps/AI-ML-oriented architecture and skills framing depending on what the JD calls for, JD-mirroring) + the person's master CV JSON + the job description, sends as a single chat request to OpenRouter (model: a Claude model, e.g. `anthropic/claude-sonnet-5`) using `OPENROUTER_API_KEY` from `.env`.
- Model returns two sections in one response: `## RESUME` (markdown resume) and `## MATCH_REPORT` (flat checklist of JD requirements, each line `- ✅ <requirement> — <reason>` or `- ❌ <requirement> — not found in master CV`). Exact format in SKILL.md.
- Server splits the response on those two markers and regex-counts ✅ vs ❌ lines in the match report to compute `matchPercent = matched / (matched + unmatched) * 100` deterministically — the model is instructed not to state a percentage itself.
- Server returns `{ resume: "<markdown>", matchReport: "<markdown checklist>", matchPercent: N }`. No further JSON-schema parsing of the resume/report content itself.

### Frontend flow

1. **People tab** — list of saved people, add/edit/delete a master CV via a form (or raw JSON textarea — simplest: textarea of the structured JSON, since content is already structured data entered once and rarely changed).
2. **Tailor tab** — pick person from dropdown, paste job description, click "Tailor" → calls `/api/tailor` → response fills an editable `<textarea>` with the markdown resume, plus a read-only side panel showing "Compatibility: NN% (X/Y matched)" and the rendered match checklist.
3. User edits/double-checks the resume markdown freely in the textarea. Match report panel is informational only, not editable, no PDF export for it.
4. "Preview & Print PDF" button (resume only) → renders current textarea content through `marked` into styled HTML in a print-friendly view → `window.print()` (save as PDF via browser dialog).

### Error handling

- Missing/invalid `OPENROUTER_API_KEY` → server refuses to start tailoring calls, clear message.
- OpenRouter request failure (network/4xx/5xx) → error shown inline in the Tailor tab, textarea untouched.
- Empty job description or no person selected → disable "Tailor" button client-side.

## SKILL.md (tailoring rules)

Already drafted and approved (SWE/DevOps/AI-ML-tuned — infers which to emphasize from the JD): absolute no-fabrication rule (only select/reorder/reword content already in the master CV; numbers only if stated or directly countable from stated facts), quantify-impact guidance, architecture-first framing for projects with stat categories spanning CI/CD, cloud/infra, reliability, IaC, observability, and ML/AI (dataset size, model metrics, training cost/time), matching skills grouping, JD-mirroring for selection/ordering, and the two-section Markdown output (`## RESUME`, `## MATCH_REPORT` checklist — no self-stated percentage, backend computes it).

File lives at `prompts/SKILL.md`, loaded fresh on each `/api/tailor` call (so editing the file changes behavior without restarting the server).

## Testing

- `prompts/SKILL.md` content isn't code — no test needed.
- Prompt-building function (combining SKILL.md + master CV + JD into the request body) is the one piece of non-trivial logic — gets a small self-check (`node server.js --selftest` or a `test_prompt.js` with plain `assert`) verifying the built prompt contains the JD text, the person's data, and the skill rules, without actually calling OpenRouter.
- Manual end-to-end check: add a real master CV, paste a real JD, confirm output only contains facts present in the source, confirm PDF print preview looks right.

## Open items resolved during brainstorming

- Not fixed to "me" and "friend" — arbitrary people, added/edited in the UI.
- Local git repo's commit email for this project set to `kinlievenicedeguzman@gmail.com` (local override, global config untouched).

## Addendum: PDF → master CV import

Lets a person upload an existing resume PDF instead of hand-writing the master CV JSON.

**New deps:** `pdf-parse` (extract raw text from a PDF buffer, no OCR), `multer` (multipart file upload handling).

**New prompt file:** `prompts/EXTRACT.md` — system prompt instructing the model to convert raw resume text into JSON matching the master CV shape (`name, contact, summary, skills[], experience[], projects[], education[]`, plus optional `certifications[]`/`leadership[]` if present), faithfully — capture every real fact, invent nothing not in the source text. Loaded fresh per request, same pattern as `SKILL.md`.

**New route:** `POST /api/extract-cv`, multipart body with a single `pdf` file field.
- Extract text via `pdf-parse`.
- Build a chat request: `EXTRACT.md` as system prompt, extracted text as user content.
- Call the same LLM gateway function used for tailoring (reuse `tailorWithOpenRouter`, generic name already — it just sends messages and returns text).
- Parse the model's reply as JSON (strip ```json fences if present). On parse failure, return 502 with the raw text so the error is visible, same pattern as `/api/tailor`.
- Return the parsed JSON to the frontend.

**Frontend:** People tab gets an "Upload PDF" `<input type="file">` next to "+ Add person". On file selection: POST multipart to `/api/extract-cv`, on success populate the **New person** JSON textarea with the returned JSON (not auto-saved — same manual review-then-Save step as today), on failure show the error in the existing `#cv-error` element.

No change to `cvStore`, `/api/people`, `/api/cv/:id`, or the tailoring flow — this only adds a new way to pre-fill the JSON editor.

## Addendum: Export resume as Word (.docx)

Lets a person download the tailored resume as a real `.docx` file, alongside the existing browser-print-to-PDF path. Not a PDF→Word conversion (lossy/unreliable) — generated straight from the same resume markdown that already feeds the PDF preview.

**Dep:** `docx` (dolanmiu/docx) — builds the `.docx` directly from paragraph/run/border objects, no HTML/CSS translation layer and no vulnerable transitive deps (unlike the first pass, which used `html-to-docx`; that library's inline-CSS-to-OOXML translation only supports a narrow property set — no margin/border/hr, and nested formatting tags silently drop one another — verified against the real generated XML before ruling it out, then swapped to `docx` for true parity with the PDF's borders/spacing).

**New route:** `POST /api/export-docx`, JSON body `{ resume: "<markdown>" }`.
- Parse the resume markdown directly (own line-based parser in `lib/exportDocx.js`, not `marked`) into `docx.Paragraph`/`TextRun` objects: centered bold name, centered contact block, bold-uppercase-with-bottom-border section headings, real bullet-numbered list items, `**bold**`/`*italic*` inline runs — matching the print CSS's page size/margins/font/sizes.
- Pack via `docx`'s `Packer.toBuffer()`.
- Respond with the binary buffer, `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `Content-Disposition: attachment; filename="resume.docx"`.
- On any failure, respond 502 with `{ error }`, same pattern as the other model/render routes.

**Frontend:** new "Export Word" button next to "Preview & Print PDF" in the Tailor tab's resume column. On click: POST the current `#resume-markdown` textarea value (so edits made before export are included) to `/api/export-docx`, receive the binary response as a `Blob`, trigger a download via a temporary `<a download>` link.

No change to the tailoring flow, PDF/print path, or any other route.

## Addendum: server-side PDF export + Chrome extension

Lets a person highlight a job description on any webpage, right-click, pick a saved person, and get both `resume.pdf` and `resume.docx` auto-downloaded — no need to open the web app. Built on branch `browser-extension`.

**Constraint that shapes this:** the existing "Preview & Print PDF" path uses the browser's native print dialog, which always requires a manual click ("Save as PDF") — no extension can automate that. True automatic PDF download requires real server-side PDF generation.

### New route: `POST /api/export-pdf`

- Same contract shape as `/api/export-docx`: JSON body `{ resume: "<markdown>" }` in, binary out.
- Renders the markdown to HTML via `marked` wrapped in a small self-contained print template (`lib/pdfTemplate.js` — the same visual rules as the existing print CSS: centered header, bold-uppercase bordered section headings, 9.5pt Arial body, `@page` letter size with 0.45in/0.6in margins), then uses **Puppeteer** (`page.setContent(html)` → `page.pdf({ preferCSSPageSize: true })`, letting the template's own `@page` CSS rule control size/margins as the single source of truth) to render a real PDF buffer.
- Responds with `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="resume.pdf"`.
- On failure, 502 with `{ error }`, same pattern as the other routes.
- New dep: `puppeteer` (bundles Chromium — heavy install, slower per-request; accepted trade-off for true silent auto-download).

Web app itself is unchanged — `/api/export-pdf` is used only by the extension for now (browser print stays the web app's PDF path).

### Chrome extension (`extension/`, Manifest V3, Chrome-only for now)

- `manifest.json` — permissions: `contextMenus`, `downloads`, `notifications`, `storage` (for the server-URL option); `host_permissions` covering the configured local server URL. Manifest V3 extensions with `host_permissions` bypass page-level CORS for their own fetches, so no server CORS changes needed.
- `options.html`/`options.js` — one text field for the server base URL (default `http://localhost:3000`, matching `.env.example`'s default `PORT`), saved via `chrome.storage.sync`.
- `background.js` (service worker):
  - On install/startup, builds a context menu: `context: "selection"` → parent item **Resume Builder** → submenu populated from `GET /api/people`, plus a leading "↻ Refresh list" item that rebuilds the submenu on demand (covers a person added after the menu was last built, without polling).
  - On a person's menu item click: reads `info.selectionText` (the highlighted job description — Chrome hands this to the context-menu callback directly, no content script/injection needed) and the person id from the menu item id.
  - Flow: `chrome.notifications.create` ("Tailoring for {person}…") → `POST {serverUrl}/api/tailor { personId, jobDescription: selectionText }` → on success, `POST /api/export-docx` and `POST /api/export-pdf` in parallel with the returned `resume` markdown → convert each response `Blob` to a data URI (service workers have no `URL.createObjectURL`) → `chrome.downloads.download()` each as `{person-slug}-resume.pdf` / `.docx` → success notification. Any failure at any step surfaces as an error notification with the message.
  - No popup UI, no content script, no review/edit step — this is an intentionally fast lane; the web app keeps the manual review step untouched for when that's wanted instead.

### Non-goals

- No Firefox/other-browser support in this pass.
- No web app UI changes.
- No change to the no-fabrication tailoring rules — this reuses `/api/tailor` and `SKILL.md` exactly as-is.

## Addendum: SQLite storage + job application tracker

Moves master CV storage from `cvs/*.json` files to SQLite, and adds a job-application tracker: paste a job posting's text + its link, AI fills in the fact fields, the row lands in a table you can edit/filter/delete.

**Context:** this app is now planned for deployment on a private VPS (previously local-machine-only). That deployment currently has no authentication — flagged as a known gap to revisit later, explicitly out of scope for this addendum.

### Storage

- New `lib/db.js` opens a single SQLite file via Node's built-in `node:sqlite` (`DatabaseSync` — no new npm dependency; available and verified working on the Node 24 this project runs). Confirmed working directly before committing to it.
- DB file lives at `data/resume-tailor.db`, gitignored (same treatment `cvs/*.json` had) — only `data/.gitkeep` is tracked.
- Creates two tables if missing, on open:
  ```sql
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cv_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL,
    date_applied TEXT NOT NULL,
    job_title TEXT,
    brief_desc TEXT,
    company TEXT,
    salary TEXT,
    status TEXT NOT NULL,
    link TEXT
  );
  ```
- `people.cv_json` stores the whole master CV as a JSON blob (same shape as today's files) — keeps the schema flexible for whatever fields a CV has, rather than forcing a rigid relational shape.

### `cvStore.js` rewrite

- Same exported function names/shapes as today (`slugify`, `listPeople`, `readCV`, `writeCV`, `deleteCV`), but the first argument becomes a `db` handle instead of a directory path — minimizes the ripple into `server.js`'s route bodies, which stay structurally the same.
- One-time migration: existing `cvs/*.json` files get imported into the new `people` table during this implementation, so the real profile already in `cvs/` isn't lost. A small one-off script (`scripts/import-cvs.js`) does this and stays in the repo in case anyone needs to re-run it after a fresh clone with old-style `cvs/*.json` files present.
- `cvs/` directory and its gitignore entry get removed once the migration script exists and has been run.

### `lib/jobsStore.js` (new)

- `listJobs(db, personId): job[]` — all jobs for a person, newest `date_applied` first.
- `createJob(db, { personId, dateApplied, jobTitle, briefDesc, company, salary, status, link }): job` — inserts, returns the row with its new `id`.
- `updateJob(db, id, fields): job` — merges the given fields into the row (used for inline cell edits).
- `deleteJob(db, id): void`.

### `prompts/EXTRACT_JOB.md` (new)

Same no-fabrication rule as `SKILL.md`/`EXTRACT.md`: extract `jobTitle`, `company`, `briefDesc` (a 1-2 sentence honest summary of the role, not padded), and `salary` (only if stated — leave blank rather than guess, salary ranges are frequently absent from postings) from the pasted job posting text. Output a small JSON object, same code-fence-stripping parse pattern as `EXTRACT.md`.

### New routes

- `GET /api/jobs?personId=<id>` — list a person's jobs.
- `POST /api/jobs` — body `{ personId, jobDescription, link }`. Server builds a request with `EXTRACT_JOB.md` + the pasted text, gets back `{jobTitle, company, briefDesc, salary}`, combines with server-set `dateApplied` (today's date) and `status` (defaults to `"Submitted"`), inserts via `jobsStore.createJob`, returns the full row. On model/parse failure, 502 with `{error}`.
- `PUT /api/jobs/:id` — body is any subset of the editable fields (including `status`, `link`, or a manual correction to any AI-filled field). Used by every inline table edit.
- `DELETE /api/jobs/:id` — removes a row (not explicitly requested, included for basic CRUD completeness alongside an editable table).

### Frontend: new "Jobs" tab

- Person filter dropdown at the top (same people list as the other tabs) — selects whose jobs are shown; nothing renders until a person is picked.
- A paste box for the job posting text + a separate "Link" text input (the pasted text doesn't reliably contain the URL, so this stays a manual field, not AI-extracted) + "Save this job" button. On click: `POST /api/jobs`, the new row appends to the table below (sorted newest-applied-first).
- Table columns, in this order: Date Applied | Job Title | Brief Desc | Company | Salary | Status | Link | (delete).
- Every cell is a live, always-editable input (text inputs for the free-text columns, a `<select>` for Status with options Submitted / Called / Interviewed / Job Offer / Rejected, a text input for Link). Editing a cell fires `PUT /api/jobs/:id` with just that field on change/blur — no separate edit-mode toggle, matches "whole row editable" directly.
- No preview/confirm step before a pasted job is saved — matches the fast-lane pattern already used for the browser extension: save immediately with AI-filled fields, fix any cell inline afterward if something's off.

### Non-goals (this addendum)

- No auth/VPS-hardening work — flagged separately, deferred.
- No CSV export, no job-board integration, no reminder/notification system for status changes.

## Addendum: merging server-side PDF/extension work with SQLite storage

Both addendums above were developed in parallel on separate branches (`browser-extension` for the PDF/extension work, `main` for SQLite/jobs) and merged together here. The merge combines them directly: `createApp` takes both `db` (SQLite handle, from the storage addendum) and `pdfRenderFn` (from the PDF addendum) as parameters, `cvStore`/job routes and the `/api/export-pdf` route coexist with no interaction between them. No design changes were needed to reconcile the two — they touch disjoint concerns (storage backend vs. PDF rendering) and only collided mechanically in `server.js`'s single `createApp` function signature.
