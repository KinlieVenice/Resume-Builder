# Resume Tailor

Tailors a master CV (yours or a friend's) to a pasted job description using Claude via OpenRouter, without inventing content. Shows a compatibility checklist with a computed match %.

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
5. Click "Preview & Print PDF" to save the final resume as a PDF via your browser's print dialog.

## Tests

`npm test`
