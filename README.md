# Resume Tailor

Tailors a master CV (yours or a friend's) to a pasted job description using Claude via OpenRouter, without inventing content. Shows a compatibility checklist with a computed match %.

Data (people, master CVs, job applications) is stored in `data/resume-tailor.db` (SQLite, via Node's built-in `node:sqlite` — no separate database install needed).

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in `OPENROUTER_API_KEY` — either:
   - an OpenRouter key from https://openrouter.ai/keys, or
   - a key from a local gateway like [9router](https://github.com/decolua/9router), which connects to Claude, GPT, OpenCode, etc. Set `OPENROUTER_BASE_URL` in `.env` to that gateway's local URL (e.g. `http://localhost:20128/v1`) and `OPENROUTER_MODEL` to whatever model slug it exposes.
3. Set `APP_PASSWORD` in `.env` to the output of `openssl rand -hex 32`.
4. `npm start`
5. Open http://localhost:3000 and sign in with username `resume` and your `APP_PASSWORD`.

The server listens only on localhost. For remote access, use an HTTPS reverse proxy that forwards to `127.0.0.1:3000`, and forward only HTTPS traffic from your router to that proxy. Never forward port 3000 directly: HTTP Basic authentication requires HTTPS to protect the password. Keep 9router private. A public hostname, a valid TLS certificate, a reachable public IP, and router access are needed to configure this.

## Usage

1. **People tab** — add a person two ways:
   - **Upload PDF** — pick an existing resume PDF and it extracts into the JSON editor for you to review (never auto-saved).
   - **+ Add person** — paste their full master CV as JSON by hand (name, contact, summary, skills, experience, projects, education).

   Either way, review/edit the JSON then click Save. Add as many people as you want — not limited to any fixed number.
2. **Tailor tab** — pick a person, paste a job description, click Tailor.
3. Review/edit the generated resume in the textarea — it's built only from facts in that person's master CV (see `prompts/SKILL.md` for the exact rules the model follows).
4. Check the Compatibility panel for the match % and which requirements were and weren't found in the master CV.
5. Click "Preview & Print PDF" to save the final resume as a PDF via your browser's print dialog.
6. **Jobs tab** — pick a person, paste a job posting's full text plus its link, click "Save this job". AI fills in Job Title, Company, Brief Desc, and Salary (left blank if the posting doesn't state it) — Date Applied and Status ("Submitted") are set automatically. Every cell is directly editable, and rows can be deleted.

## Tests

`npm test`
