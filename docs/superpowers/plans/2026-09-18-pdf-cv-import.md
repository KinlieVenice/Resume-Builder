# PDF → Master CV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person upload an existing resume PDF; the app extracts its text and has the model structure it into the master CV JSON shape, pre-filling the "New person" editor for review (never auto-saved).

**Architecture:** New `lib/extractCv.js` module (PDF-text extraction wrapper + message-building + response-parsing, all pure/injectable like the existing `lib/openrouterClient.js` and `lib/promptBuilder.js`). New `prompts/EXTRACT.md` system prompt, loaded fresh per request like `SKILL.md`. New `POST /api/extract-cv` route on the existing Express app, reusing `tailorWithOpenRouter` for the actual model call. New "Upload PDF" control on the People tab frontend.

**Tech Stack:** Adds `pdf-parse` (PDF → text, no OCR) and `multer` (multipart upload handling) to the existing Node/Express stack.

## Global Constraints

- Same no-fabrication principle as `SKILL.md`, pointed the other direction: capture every real fact from the resume text, invent nothing not present in it (from spec addendum).
- Extracted JSON is never auto-saved — it only pre-fills the New person textarea for manual review, same as the existing "+ Add person" flow (from spec addendum).
- `prompts/EXTRACT.md` is read from disk on every `/api/extract-cv` call, not cached (matches `SKILL.md`'s existing behavior).
- No change to `cvStore`, `/api/people`, `/api/cv/:id`, or the tailoring flow.

---

### Task 1: extractCv module

**Files:**
- Create: `lib/extractCv.js`
- Test: `lib/extractCv.test.js`

**Interfaces:**
- Consumes: nothing from other modules (pure functions; `extractTextFromPdf` takes an injectable `pdfParseImpl`, defaulting to the real `pdf-parse` package).
- Produces: `extractTextFromPdf(buffer: Buffer, pdfParseImpl?: Function): Promise<string>`, `buildExtractMessages({skillText: string, resumeText: string}): Array<{role: string, content: string}>`, `parseExtractResponse(text: string): object` — exported from `lib/extractCv.js`. `server.js` (Task 3) calls all three.

- [ ] **Step 1: Install `pdf-parse`**

Run: `cd /home/kinlie/builder && npm install pdf-parse`
Expected: added to `package.json` dependencies, no errors.

- [ ] **Step 2: Write the failing tests**

Create `lib/extractCv.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractTextFromPdf,
  buildExtractMessages,
  parseExtractResponse,
} = require('./extractCv');

test('extractTextFromPdf returns the text field from the injected parser', async () => {
  const fakePdfParse = async (buffer) => {
    assert.ok(Buffer.isBuffer(buffer));
    return { text: 'Ada Lovelace\nMathematician' };
  };
  const text = await extractTextFromPdf(Buffer.from('fake pdf bytes'), fakePdfParse);
  assert.equal(text, 'Ada Lovelace\nMathematician');
});

test('buildExtractMessages puts skill text as system message and resume text in user message', () => {
  const messages = buildExtractMessages({
    skillText: 'EXTRACT RULES',
    resumeText: 'Ada Lovelace, Mathematician',
  });
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, 'EXTRACT RULES');
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.includes('Ada Lovelace, Mathematician'));
});

test('parseExtractResponse parses plain JSON', () => {
  const cv = parseExtractResponse('{"name": "Ada Lovelace", "skills": ["math"]}');
  assert.deepEqual(cv, { name: 'Ada Lovelace', skills: ['math'] });
});

test('parseExtractResponse strips a ```json code fence', () => {
  const text = '```json\n{"name": "Ada Lovelace"}\n```';
  const cv = parseExtractResponse(text);
  assert.deepEqual(cv, { name: 'Ada Lovelace' });
});

test('parseExtractResponse strips a plain ``` code fence', () => {
  const text = '```\n{"name": "Ada Lovelace"}\n```';
  const cv = parseExtractResponse(text);
  assert.deepEqual(cv, { name: 'Ada Lovelace' });
});

test('parseExtractResponse throws a clear error on invalid JSON', () => {
  assert.throws(() => parseExtractResponse('not json at all'), /not valid JSON/);
});

test('parseExtractResponse throws when the JSON has no name field', () => {
  assert.throws(() => parseExtractResponse('{"skills": ["math"]}'), /missing "name"/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test lib/extractCv.test.js`
Expected: FAIL — `Cannot find module './extractCv'`

- [ ] **Step 4: Write `lib/extractCv.js`**

```js
'use strict';
const pdfParse = require('pdf-parse');

async function extractTextFromPdf(buffer, pdfParseImpl = pdfParse) {
  const result = await pdfParseImpl(buffer);
  return result.text;
}

function buildExtractMessages({ skillText, resumeText }) {
  return [
    { role: 'system', content: skillText },
    {
      role: 'user',
      content: `RESUME TEXT (extracted from an uploaded PDF):\n\n${resumeText}`,
    },
  ];
}

function parseExtractResponse(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonText = fenced ? fenced[1] : text;

  let cv;
  try {
    cv = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Model response was not valid JSON: ${err.message}`);
  }

  if (!cv || typeof cv !== 'object' || !cv.name) {
    throw new Error('Extracted CV JSON is missing "name"');
  }

  return cv;
}

module.exports = { extractTextFromPdf, buildExtractMessages, parseExtractResponse };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test lib/extractCv.test.js`
Expected: PASS — 7 tests passing.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/extractCv.js lib/extractCv.test.js
git commit -m "feat: add extractCv module for PDF-to-JSON conversion"
```

---

### Task 2: EXTRACT.md prompt

**Files:**
- Create: `prompts/EXTRACT.md`

**Interfaces:**
- Consumes: nothing.
- Produces: system-prompt text, loaded by `server.js` (Task 3) via `fs.readFileSync`.

- [ ] **Step 1: Write `prompts/EXTRACT.md`**

```markdown
# Resume PDF Extraction Skill

You are converting the raw text extracted from someone's resume PDF into a structured JSON "master CV" — the complete, true record of their projects, skills, and experience that another tool will later tailor into job-specific resumes.

## Absolute rule — no fabrication

Every field in your JSON output must come from the resume text you were given. You may:
- reorganize scattered facts into the right field
- split a run-on bullet into separate list entries
- fix obvious OCR/extraction artifacts (broken words, stray line breaks) without changing meaning

You may NOT:
- invent a project, employer, title, skill, metric, or date not present in the text
- guess at a metric that's ambiguous or cut off — omit it rather than guess
- summarize away real detail — this JSON is the exhaustive master record, not a tailored resume, so keep everything, not just the highlights

If the resume text is garbled or a field is illegible, omit that field/item rather than guessing.

## Output format

Return ONLY a single JSON object, no prose before or after, no markdown fences unless your response format requires it. Shape:

```json
{
  "name": "string, required",
  "contact": "string — location / phone / email / links, whatever the resume header has",
  "summary": "string — the resume's own summary/objective text, if it has one",
  "skills": ["flat array of every individual skill/tool/technology mentioned anywhere in the resume"],
  "experience": [
    {
      "company": "string",
      "location": "string, if given",
      "title": "string",
      "dates": "string, exactly as it can be read from the resume",
      "bullets": ["one array entry per bullet/achievement under this role"]
    }
  ],
  "projects": [
    { "name": "string", "description": "string", "bullets": ["..."] }
  ],
  "education": [
    { "school": "string", "location": "string, if given", "degree": "string", "dates": "string", "bullets": ["honors/thesis/awards, if any"] }
  ],
  "certifications": ["only include this field if the resume has a certifications section"],
  "leadership": ["only include this field if the resume has hackathon/leadership/award content"]
}
```

Omit any field entirely (don't include it as an empty array/string) if the resume has nothing for it, except `name`, which is always required.
```

- [ ] **Step 2: Commit**

```bash
git add prompts/EXTRACT.md
git commit -m "feat: add EXTRACT.md prompt for PDF-to-JSON conversion"
```

---

### Task 3: `/api/extract-cv` route

**Files:**
- Modify: `server.js`
- Modify: `server.test.js`

**Interfaces:**
- Consumes: `extractTextFromPdf`, `buildExtractMessages`, `parseExtractResponse` from `./lib/extractCv`; `tailorWithOpenRouter` from `./lib/openrouterClient` (already imported).
- Produces: extends `createApp({..., extractSkillPath, extractFn?, pdfParseImpl?})` — `extractFn` defaults to `tailorWithOpenRouter` (same injection pattern as `tailorFn`), `pdfParseImpl` is passed straight through to `extractTextFromPdf` for test injection. New route `POST /api/extract-cv` (multipart, field name `pdf`) consumed by the frontend in Task 4.

- [ ] **Step 1: Install `multer`**

Run: `cd /home/kinlie/builder && npm install multer`
Expected: added to `package.json` dependencies, no errors.

- [ ] **Step 2: Write the failing tests**

Add to `server.test.js` (after the existing imports, add one more; then add these tests at the end of the file):

```js
const { extractTextFromPdf } = require('./lib/extractCv');
```

Update the `makeApp` helper to accept and pass through the new options:

```js
function makeApp({ tailorFn, baseUrl, extractFn, pdfParseImpl } = {}) {
  const cvsDir = tmpDir();
  const skillPath = path.join(tmpDir(), 'SKILL.md');
  fs.writeFileSync(skillPath, 'TEST SKILL RULES');
  const extractSkillPath = path.join(tmpDir(), 'EXTRACT.md');
  fs.writeFileSync(extractSkillPath, 'TEST EXTRACT RULES');
  const app = createApp({
    cvsDir,
    skillPath,
    extractSkillPath,
    apiKey: 'test-key',
    model: 'anthropic/claude-sonnet-5',
    baseUrl,
    tailorFn,
    extractFn,
    pdfParseImpl,
  });
  return { app, cvsDir };
}
```

Add these tests at the end of `server.test.js`:

```js
test('POST /api/extract-cv returns parsed CV JSON from injected extractFn/pdfParseImpl', async () => {
  const fakePdfParse = async () => ({ text: 'Ada Lovelace resume text' });
  const fakeExtractFn = async ({ messages }) => {
    assert.equal(messages[0].content, 'TEST EXTRACT RULES');
    assert.ok(messages[1].content.includes('Ada Lovelace resume text'));
    return '{"name": "Ada Lovelace", "skills": ["math"]}';
  };
  const { app } = makeApp({ extractFn: fakeExtractFn, pdfParseImpl: fakePdfParse });
  const { server, base } = await listen(app);
  try {
    const form = new FormData();
    form.append('pdf', new Blob([Buffer.from('fake pdf bytes')]), 'resume.pdf');
    const res = await fetch(`${base}/api/extract-cv`, { method: 'POST', body: form });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { name: 'Ada Lovelace', skills: ['math'] });
  } finally {
    server.close();
  }
});

test('POST /api/extract-cv returns 400 when no file is attached', async () => {
  const { app } = makeApp();
  const { server, base } = await listen(app);
  try {
    const form = new FormData();
    const res = await fetch(`${base}/api/extract-cv`, { method: 'POST', body: form });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /api/extract-cv returns 502 when the model reply is not valid JSON', async () => {
  const fakePdfParse = async () => ({ text: 'garbled text' });
  const fakeExtractFn = async () => 'not json';
  const { app } = makeApp({ extractFn: fakeExtractFn, pdfParseImpl: fakePdfParse });
  const { server, base } = await listen(app);
  try {
    const form = new FormData();
    form.append('pdf', new Blob([Buffer.from('fake pdf bytes')]), 'resume.pdf');
    const res = await fetch(`${base}/api/extract-cv`, { method: 'POST', body: form });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /not valid JSON/);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test server.test.js`
Expected: FAIL — `extractSkillPath`/route don't exist yet (500s or "Cannot find module './lib/extractCv'" depending on which fails first).

- [ ] **Step 4: Update `server.js`**

Add imports at the top, after the existing `openrouterClient` import:

```js
const multer = require('multer');
const { extractTextFromPdf, buildExtractMessages, parseExtractResponse } = require('./lib/extractCv');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
```

Change the `createApp` signature to:

```js
function createApp({
  cvsDir,
  skillPath,
  extractSkillPath,
  apiKey,
  model,
  baseUrl,
  tailorFn = tailorWithOpenRouter,
  extractFn = tailorWithOpenRouter,
  pdfParseImpl,
}) {
```

Add this route inside `createApp`, after the existing `/api/tailor` route and before `return app;`:

```js
  app.post('/api/extract-cv', upload.single('pdf'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'pdf file is required (field name "pdf")' });
    }

    try {
      const resumeText = await extractTextFromPdf(req.file.buffer, pdfParseImpl);
      const skillText = fs.readFileSync(extractSkillPath, 'utf8');
      const messages = buildExtractMessages({ skillText, resumeText });
      const raw = await extractFn({ apiKey, model, messages, baseUrl });
      const cv = parseExtractResponse(raw);
      res.json(cv);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
```

Update the `require.main === module` block's `createApp` call to add `extractSkillPath`:

```js
  const app = createApp({
    cvsDir: path.join(__dirname, 'cvs'),
    skillPath: path.join(__dirname, 'prompts', 'SKILL.md'),
    extractSkillPath: path.join(__dirname, 'prompts', 'EXTRACT.md'),
    apiKey,
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5',
    baseUrl: process.env.OPENROUTER_BASE_URL,
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server.test.js`
Expected: PASS — all tests in the file passing (existing 5 + 3 new = 8).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — all tests across all files passing.

- [ ] **Step 7: Commit**

```bash
git add server.js server.test.js
git commit -m "feat: add POST /api/extract-cv route"
```

---

### Task 4: Frontend upload control

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `POST /api/extract-cv` (Task 3).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Update `public/index.html`**

In the `.people-list` div, change:

```html
        <button id="new-person-btn">+ Add person</button>
```

to:

```html
        <button id="new-person-btn">+ Add person</button>
        <label for="upload-pdf-input" class="upload-label">Upload PDF</label>
        <input type="file" id="upload-pdf-input" accept="application/pdf" class="hidden" />
        <p id="upload-error" class="error"></p>
```

- [ ] **Step 2: Add a small style for the upload label in `public/style.css`**

Add this rule near `.cv-editor-actions`:

```css
.upload-label {
  display: inline-block;
  margin-top: 0.5rem;
  padding: 0.4rem 0.8rem;
  border: 1px solid #999;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
}
```

- [ ] **Step 3: Wire it up in `public/app.js`**

Add this after the existing `el('new-person-btn')` click handler:

```js
el('upload-pdf-input').addEventListener('change', async () => {
  const file = el('upload-pdf-input').files[0];
  if (!file) return;

  el('upload-error').textContent = '';
  const form = new FormData();
  form.append('pdf', file);

  try {
    const res = await fetch('/api/extract-cv', { method: 'POST', body: form });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'PDF extraction failed');
    }
    state.selectedPersonId = null;
    renderPeopleList();
    el('cv-editor-title').textContent = `${body.name} (from PDF — review before saving)`;
    el('cv-json').value = JSON.stringify(body, null, 2);
    el('cv-error').textContent = '';
  } catch (err) {
    el('upload-error').textContent = err.message;
  } finally {
    el('upload-pdf-input').value = '';
  }
});
```

- [ ] **Step 4: Manual verification**

Run: `npm start`, open `http://localhost:<PORT>`, go to the People tab.
1. Click "Upload PDF", pick a real resume PDF.
2. Confirm the New person JSON textarea fills with structured JSON built from that resume's real content (spot-check a couple of facts against the PDF).
3. Edit if anything looks off, click Save, confirm it appears in the people list and reopens correctly.
4. Try a non-PDF or empty selection edge case if convenient; confirm `#upload-error` shows a message instead of the app breaking.

Expected: all four checks pass. No automated test for this task — DOM wiring over an already-tested route (Task 3).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat: add PDF upload to People tab"
```
