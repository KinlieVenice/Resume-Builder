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
- Server loads `prompts/SKILL.md` (tailoring rules — no fabrication, quantify from source only, SWE/DevOps-oriented architecture and skills framing, JD-mirroring) + the person's master CV JSON + the job description, sends as a single chat request to OpenRouter (model: a Claude model, e.g. `anthropic/claude-sonnet-5`) using `OPENROUTER_API_KEY` from `.env`.
- Model returns a Markdown resume (see SKILL.md for exact section format).
- Server returns that markdown text as-is to the frontend. No JSON-schema parsing.

### Frontend flow

1. **People tab** — list of saved people, add/edit/delete a master CV via a form (or raw JSON textarea — simplest: textarea of the structured JSON, since content is already structured data entered once and rarely changed).
2. **Tailor tab** — pick person from dropdown, paste job description, click "Tailor" → calls `/api/tailor` → response fills an editable `<textarea>` with the markdown resume.
3. User edits/double-checks the markdown freely in the textarea.
4. "Preview & Print PDF" button → renders current textarea content through `marked` into styled HTML in a print-friendly view → `window.print()` (save as PDF via browser dialog).

### Error handling

- Missing/invalid `OPENROUTER_API_KEY` → server refuses to start tailoring calls, clear message.
- OpenRouter request failure (network/4xx/5xx) → error shown inline in the Tailor tab, textarea untouched.
- Empty job description or no person selected → disable "Tailor" button client-side.

## SKILL.md (tailoring rules)

Already drafted and approved (SWE/DevOps-tuned): absolute no-fabrication rule (only select/reorder/reword content already in the master CV; numbers only if stated or directly countable from stated facts), quantify-impact guidance, architecture-first framing for projects with DevOps-specific stat categories (CI/CD, cloud/infra, reliability, IaC, observability), SWE/DevOps skills grouping, JD-mirroring for selection/ordering, fixed Markdown output structure (Name/contact, Summary, Skills, Experience, Projects, Education).

File lives at `prompts/SKILL.md`, loaded fresh on each `/api/tailor` call (so editing the file changes behavior without restarting the server).

## Testing

- `prompts/SKILL.md` content isn't code — no test needed.
- Prompt-building function (combining SKILL.md + master CV + JD into the request body) is the one piece of non-trivial logic — gets a small self-check (`node server.js --selftest` or a `test_prompt.js` with plain `assert`) verifying the built prompt contains the JD text, the person's data, and the skill rules, without actually calling OpenRouter.
- Manual end-to-end check: add a real master CV, paste a real JD, confirm output only contains facts present in the source, confirm PDF print preview looks right.

## Open items resolved during brainstorming

- Not fixed to "me" and "friend" — arbitrary people, added/edited in the UI.
- Local git repo's commit email for this project set to `kinlievenicedeguzman@gmail.com` (local override, global config untouched).
