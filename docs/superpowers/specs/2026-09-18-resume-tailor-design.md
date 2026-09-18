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
