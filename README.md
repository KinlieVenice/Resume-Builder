# Resume Tailor

Tailors a master CV (yours or a friend's) to a pasted job description using Claude via OpenRouter, without inventing content. Shows a compatibility checklist with a computed match %.

Data (people, master CVs, job applications) is stored in `data/resume-tailor.db` (SQLite, via Node's built-in `node:sqlite` — no separate database install needed).

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in `OPENROUTER_API_KEY` — either:
   - an OpenRouter key from https://openrouter.ai/keys, or
   - a key from a local gateway like [9router](https://github.com/decolua/9router), which connects to Claude, GPT, OpenCode, etc. Set `OPENROUTER_BASE_URL` in `.env` to that gateway's local URL (e.g. `http://localhost:20128/v1`) and `OPENROUTER_MODEL` to whatever model slug it exposes.
3. `npm start`
4. Open http://localhost:3000

## Usage

1. **People tab** — add a person two ways:
   - **Upload PDF** — pick an existing resume PDF and it extracts into the JSON editor for you to review (never auto-saved).
   - **+ Add person** — paste their full master CV as JSON by hand (name, contact, summary, skills, experience, projects, education).

   Either way, review/edit the JSON then click Save. Add as many people as you want — not limited to any fixed number.
2. **Tailor tab** — pick a person, paste a job description, click Tailor.
3. Review/edit the generated resume in the textarea — it's built only from facts in that person's master CV (see `prompts/SKILL.md` for the exact rules the model follows).
4. Check the Compatibility panel for the match % and which requirements were and weren't found in the master CV.
5. Click "Preview & Print PDF" to save the final resume as a PDF via your browser's print dialog, or "Export Word" to download a real `.docx` directly.
6. **Jobs tab** — pick a person, paste a job posting's full text plus its link, click "Save this job". AI fills in Job Title, Company, Brief Desc, and Salary (left blank if the posting doesn't state it) — Date Applied and Status ("Submitted") are set automatically. Every cell is directly editable, and rows can be deleted.

## Chrome extension

Highlight a job description on any webpage, right-click, pick a saved person, and get both `resume.pdf` and `resume.docx` downloaded automatically — no need to open the web app.

**Setup:**
1. Make sure the server is running (`npm start`).
2. In Chrome, go to `chrome://extensions`, enable Developer mode, click "Load unpacked", and select this project's `extension/` folder.
3. Click the extension's "Details" → "Extension options" and set the server URL if it's not the default `http://localhost:3000` (check `PORT` in your `.env`).

**Use:** select a job description's text on any page → right-click → **Resume Builder** → pick a person. A notification shows progress; both files land in your normal Downloads folder.

This is a fast lane with no manual review step — for reviewing/editing the resume before export, use the web app instead.

## Tests

`npm test`
