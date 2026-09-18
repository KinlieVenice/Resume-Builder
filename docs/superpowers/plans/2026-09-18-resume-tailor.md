# Resume Tailor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local web app that tailors a person's master CV to a pasted job description via Claude (through OpenRouter), without fabricating content, and shows a compatibility checklist alongside the resume.

**Architecture:** Single Node.js + Express server (`server.js`) exposing a small JSON API, serving a vanilla HTML/CSS/JS frontend from `public/`. Master CVs are JSON files in `cvs/` (one per person, no fixed limit). Tailoring rules live in `prompts/SKILL.md`, read fresh on every request and sent as the system prompt to OpenRouter. PDF export is the browser's native print-to-PDF — no PDF library.

**Tech Stack:** Node.js (>=18, built-in `fetch` and `node:test`), Express, `dotenv`, `marked` (client-side markdown render only). No test framework dependency — uses Node's built-in test runner.

## Global Constraints

- No fabrication in generated resumes: model may only select/reorder/reword facts already in the master CV (from spec's SKILL.md — already written, do not modify its rules while implementing).
- `OPENROUTER_API_KEY` lives only in `.env` (gitignored), never sent to the browser.
- `cvs/*.json` (personal data) is gitignored; only `cvs/.gitkeep` is tracked.
- Compatibility % is computed by the backend by counting ✅/❌ lines — never trust a model-stated percentage.
- `prompts/SKILL.md` is read from disk on every `/api/tailor` call (not cached at startup), so editing it changes behavior without a restart.
- Model default: `anthropic/claude-sonnet-5`, overridable via `OPENROUTER_MODEL` env var.

---

### Task 1: Project scaffold + cvStore module

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `cvs/.gitkeep`
- Create: `lib/cvStore.js`
- Test: `lib/cvStore.test.js`

**Interfaces:**
- Produces: `slugify(name: string): string`, `listPeople(dir: string): {id: string, name: string}[]`, `readCV(dir: string, id: string): object`, `writeCV(dir: string, id: string, data: object): void`, `deleteCV(dir: string, id: string): void` — all exported from `lib/cvStore.js`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "resume-tailor",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "marked": "^12.0.2"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.env
cvs/*.json
```

- [ ] **Step 3: Create `.env.example`**

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-5
PORT=3000
```

- [ ] **Step 4: Create `cvs/.gitkeep`** (empty file, keeps the otherwise-ignored directory in git)

- [ ] **Step 5: Install dependencies**

Run: `cd /home/kinlie/builder && npm install`
Expected: `node_modules/` created, `package-lock.json` created, no errors.

- [ ] **Step 6: Write the failing test for `cvStore`**

Create `lib/cvStore.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { slugify, listPeople, readCV, writeCV, deleteCV } = require('./cvStore');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cvstore-test-'));
}

test('slugify lowercases and dashes non-alphanumerics', () => {
  assert.equal(slugify('Jhorizrodel Aquino'), 'jhorizrodel-aquino');
  assert.equal(slugify('  Weird!!  Name__2  '), 'weird-name-2');
});

test('writeCV then readCV round-trips data', () => {
  const dir = tmpDir();
  const cv = { name: 'Ada Lovelace', skills: ['math'] };
  writeCV(dir, 'ada-lovelace', cv);
  const readBack = readCV(dir, 'ada-lovelace');
  assert.deepEqual(readBack, cv);
});

test('readCV throws for missing person', () => {
  const dir = tmpDir();
  assert.throws(() => readCV(dir, 'nobody'), /No CV found/);
});

test('listPeople returns id+name for every stored CV', () => {
  const dir = tmpDir();
  writeCV(dir, 'ada-lovelace', { name: 'Ada Lovelace' });
  writeCV(dir, 'alan-turing', { name: 'Alan Turing' });
  const people = listPeople(dir).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(people, [
    { id: 'ada-lovelace', name: 'Ada Lovelace' },
    { id: 'alan-turing', name: 'Alan Turing' },
  ]);
});

test('deleteCV removes the file, readCV then throws', () => {
  const dir = tmpDir();
  writeCV(dir, 'ada-lovelace', { name: 'Ada Lovelace' });
  deleteCV(dir, 'ada-lovelace');
  assert.throws(() => readCV(dir, 'ada-lovelace'), /No CV found/);
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `node --test lib/cvStore.test.js`
Expected: FAIL — `Cannot find module './cvStore'`

- [ ] **Step 8: Write `lib/cvStore.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function listPeople(dir) {
  ensureDir(dir);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const id = f.slice(0, -'.json'.length);
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { id, name: data.name || id };
    });
}

function readCV(dir, id) {
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No CV found for "${id}"`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeCV(dir, id, data) {
  ensureDir(dir);
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function deleteCV(dir, id) {
  const file = path.join(dir, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = { slugify, listPeople, readCV, writeCV, deleteCV };
```

- [ ] **Step 9: Run test to verify it passes**

Run: `node --test lib/cvStore.test.js`
Expected: PASS — 5 tests passing.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example cvs/.gitkeep lib/cvStore.js lib/cvStore.test.js
git commit -m "feat: scaffold project and add cvStore module"
```

---

### Task 2: promptBuilder module

**Files:**
- Create: `lib/promptBuilder.js`
- Test: `lib/promptBuilder.test.js`

**Interfaces:**
- Consumes: nothing from other modules (pure functions, plain data in).
- Produces: `buildTailorMessages({skillText: string, cv: object, jobDescription: string}): Array<{role: string, content: string}>`, `parseTailorResponse(text: string): {resume: string, matchReport: string, matchPercent: number, matched: number, unmatched: number}` — exported from `lib/promptBuilder.js`. `server.js` (Task 4) calls both of these.

- [ ] **Step 1: Write the failing tests**

Create `lib/promptBuilder.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTailorMessages, parseTailorResponse } = require('./promptBuilder');

test('buildTailorMessages puts skill text as system message', () => {
  const messages = buildTailorMessages({
    skillText: 'RULES GO HERE',
    cv: { name: 'Ada' },
    jobDescription: 'Looking for a backend engineer',
  });
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, 'RULES GO HERE');
});

test('buildTailorMessages user message includes CV JSON and job description', () => {
  const messages = buildTailorMessages({
    skillText: 'RULES',
    cv: { name: 'Ada', skills: ['C++'] },
    jobDescription: 'Looking for a backend engineer',
  });
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.includes('"name": "Ada"'));
  assert.ok(messages[1].content.includes('"C++"'));
  assert.ok(messages[1].content.includes('Looking for a backend engineer'));
});

test('parseTailorResponse splits resume and match report, computes percent', () => {
  const text = [
    '## RESUME',
    '# Ada Lovelace',
    'Summary here.',
    '',
    '## MATCH_REPORT',
    '- ✅ Python — master CV lists 5 years Python',
    '- ✅ SQL — master CV lists Postgres experience',
    '- ❌ Kubernetes — not found in master CV',
  ].join('\n');

  const result = parseTailorResponse(text);
  assert.ok(result.resume.includes('# Ada Lovelace'));
  assert.ok(!result.resume.includes('MATCH_REPORT'));
  assert.ok(result.matchReport.includes('Kubernetes'));
  assert.equal(result.matched, 2);
  assert.equal(result.unmatched, 1);
  assert.equal(result.matchPercent, 67);
});

test('parseTailorResponse returns 0 percent when no checklist lines found', () => {
  const text = '## RESUME\nHello\n\n## MATCH_REPORT\n(no requirements identified)';
  const result = parseTailorResponse(text);
  assert.equal(result.matchPercent, 0);
});

test('parseTailorResponse throws when markers are missing', () => {
  assert.throws(
    () => parseTailorResponse('just some text with no markers'),
    /missing ## RESUME/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/promptBuilder.test.js`
Expected: FAIL — `Cannot find module './promptBuilder'`

- [ ] **Step 3: Write `lib/promptBuilder.js`**

```js
'use strict';

function buildTailorMessages({ skillText, cv, jobDescription }) {
  return [
    { role: 'system', content: skillText },
    {
      role: 'user',
      content: [
        'MASTER CV (JSON):',
        JSON.stringify(cv, null, 2),
        '',
        'JOB DESCRIPTION:',
        jobDescription,
      ].join('\n'),
    },
  ];
}

function parseTailorResponse(text) {
  const RESUME_MARKER = '## RESUME';
  const MATCH_MARKER = '## MATCH_REPORT';
  const resumeIdx = text.indexOf(RESUME_MARKER);
  const matchIdx = text.indexOf(MATCH_MARKER);

  if (resumeIdx === -1 || matchIdx === -1 || matchIdx < resumeIdx) {
    throw new Error('Model response missing ## RESUME / ## MATCH_REPORT sections');
  }

  const resume = text.slice(resumeIdx + RESUME_MARKER.length, matchIdx).trim();
  const matchReport = text.slice(matchIdx + MATCH_MARKER.length).trim();

  const matched = (matchReport.match(/^- ✅/gm) || []).length;
  const unmatched = (matchReport.match(/^- ❌/gm) || []).length;
  const total = matched + unmatched;
  const matchPercent = total === 0 ? 0 : Math.round((matched / total) * 100);

  return { resume, matchReport, matchPercent, matched, unmatched };
}

module.exports = { buildTailorMessages, parseTailorResponse };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/promptBuilder.test.js`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/promptBuilder.js lib/promptBuilder.test.js
git commit -m "feat: add promptBuilder module for tailoring requests"
```

---

### Task 3: OpenRouter client

**Files:**
- Create: `lib/openrouterClient.js`
- Test: `lib/openrouterClient.test.js`

**Interfaces:**
- Consumes: nothing (takes an injectable `fetchImpl`, defaults to global `fetch`).
- Produces: `tailorWithOpenRouter({apiKey: string, model: string, messages: Array, fetchImpl?: Function}): Promise<string>` — exported from `lib/openrouterClient.js`. `server.js` (Task 4) calls this and passes the result into `parseTailorResponse`.

- [ ] **Step 1: Write the failing tests**

Create `lib/openrouterClient.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tailorWithOpenRouter } = require('./openrouterClient');

function fakeFetch({ status = 200, body }) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  fn.calls = calls;
  return fn;
}

test('tailorWithOpenRouter sends model+messages and returns message content', async () => {
  const fetchImpl = fakeFetch({
    body: { choices: [{ message: { content: 'RESUME TEXT' } }] },
  });

  const result = await tailorWithOpenRouter({
    apiKey: 'test-key',
    model: 'anthropic/claude-sonnet-5',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl,
  });

  assert.equal(result, 'RESUME TEXT');
  assert.equal(fetchImpl.calls.length, 1);
  const [{ url, options }] = fetchImpl.calls;
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(options.headers.Authorization, 'Bearer test-key');
  const sentBody = JSON.parse(options.body);
  assert.equal(sentBody.model, 'anthropic/claude-sonnet-5');
  assert.deepEqual(sentBody.messages, [{ role: 'user', content: 'hi' }]);
});

test('tailorWithOpenRouter throws with status on non-ok response', async () => {
  const fetchImpl = fakeFetch({ status: 401, body: { error: 'bad key' } });
  await assert.rejects(
    () =>
      tailorWithOpenRouter({
        apiKey: 'bad',
        model: 'anthropic/claude-sonnet-5',
        messages: [],
        fetchImpl,
      }),
    /OpenRouter request failed \(401\)/,
  );
});

test('tailorWithOpenRouter throws when response has no message content', async () => {
  const fetchImpl = fakeFetch({ body: { choices: [] } });
  await assert.rejects(
    () =>
      tailorWithOpenRouter({
        apiKey: 'test-key',
        model: 'anthropic/claude-sonnet-5',
        messages: [],
        fetchImpl,
      }),
    /missing message content/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/openrouterClient.test.js`
Expected: FAIL — `Cannot find module './openrouterClient'`

- [ ] **Step 3: Write `lib/openrouterClient.js`**

```js
'use strict';

async function tailorWithOpenRouter({ apiKey, model, messages, fetchImpl = fetch }) {
  const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : undefined;

  if (!content) {
    throw new Error('OpenRouter response missing message content');
  }

  return content;
}

module.exports = { tailorWithOpenRouter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/openrouterClient.test.js`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/openrouterClient.js lib/openrouterClient.test.js
git commit -m "feat: add OpenRouter client"
```

---

### Task 4: Express server (API routes)

**Files:**
- Create: `server.js`
- Test: `server.test.js`

**Interfaces:**
- Consumes: `slugify`, `listPeople`, `readCV`, `writeCV`, `deleteCV` from `./lib/cvStore`; `buildTailorMessages`, `parseTailorResponse` from `./lib/promptBuilder`; `tailorWithOpenRouter` from `./lib/openrouterClient`.
- Produces: `createApp({cvsDir: string, skillPath: string, apiKey: string, model: string, tailorFn?: Function}): express.Express` exported from `server.js`. `tailorFn` defaults to `tailorWithOpenRouter` and is the injection point tests use to avoid real network calls. Task 5 (frontend) consumes the HTTP routes this task defines: `GET /api/people`, `POST /api/people`, `GET /api/cv/:id`, `PUT /api/cv/:id`, `DELETE /api/cv/:id`, `POST /api/tailor`.

- [ ] **Step 1: Write the failing tests**

Create `server.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('./server');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resume-tailor-test-'));
}

function makeApp({ tailorFn } = {}) {
  const cvsDir = tmpDir();
  const skillPath = path.join(tmpDir(), 'SKILL.md');
  fs.writeFileSync(skillPath, 'TEST SKILL RULES');
  const app = createApp({
    cvsDir,
    skillPath,
    apiKey: 'test-key',
    model: 'anthropic/claude-sonnet-5',
    tailorFn,
  });
  return { app, cvsDir };
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test('POST /api/people creates a person, GET /api/people lists it', async () => {
  const { app } = makeApp();
  const { server, base } = await listen(app);
  try {
    const createRes = await fetch(`${base}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ada Lovelace', skills: ['math'] }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.id, 'ada-lovelace');

    const listRes = await fetch(`${base}/api/people`);
    const people = await listRes.json();
    assert.deepEqual(people, [{ id: 'ada-lovelace', name: 'Ada Lovelace' }]);
  } finally {
    server.close();
  }
});

test('GET/PUT/DELETE /api/cv/:id round-trip a CV', async () => {
  const { app } = makeApp();
  const { server, base } = await listen(app);
  try {
    await fetch(`${base}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alan Turing' }),
    });

    const getRes = await fetch(`${base}/api/cv/alan-turing`);
    assert.equal(getRes.status, 200);
    assert.equal((await getRes.json()).name, 'Alan Turing');

    const putRes = await fetch(`${base}/api/cv/alan-turing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alan Turing', skills: ['cryptanalysis'] }),
    });
    assert.equal(putRes.status, 200);

    const getRes2 = await fetch(`${base}/api/cv/alan-turing`);
    assert.deepEqual((await getRes2.json()).skills, ['cryptanalysis']);

    const delRes = await fetch(`${base}/api/cv/alan-turing`, { method: 'DELETE' });
    assert.equal(delRes.status, 204);

    const getRes3 = await fetch(`${base}/api/cv/alan-turing`);
    assert.equal(getRes3.status, 404);
  } finally {
    server.close();
  }
});

test('POST /api/tailor returns resume, matchReport, matchPercent from injected tailorFn', async () => {
  const fakeTailor = async ({ messages }) => {
    assert.equal(messages[0].content, 'TEST SKILL RULES');
    return [
      '## RESUME',
      '# Ada Lovelace',
      '',
      '## MATCH_REPORT',
      '- ✅ Math — has math background',
      '- ❌ Rust — not found in master CV',
    ].join('\n');
  };
  const { app } = makeApp({ tailorFn: fakeTailor });
  const { server, base } = await listen(app);
  try {
    await fetch(`${base}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ada Lovelace' }),
    });

    const res = await fetch(`${base}/api/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: 'ada-lovelace', jobDescription: 'Math role' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.resume.includes('# Ada Lovelace'));
    assert.equal(body.matchPercent, 50);
    assert.equal(body.matched, 1);
    assert.equal(body.unmatched, 1);
  } finally {
    server.close();
  }
});

test('POST /api/tailor returns 502 when the model call fails', async () => {
  const failingTailor = async () => {
    throw new Error('OpenRouter request failed (500): boom');
  };
  const { app } = makeApp({ tailorFn: failingTailor });
  const { server, base } = await listen(app);
  try {
    await fetch(`${base}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ada Lovelace' }),
    });
    const res = await fetch(`${base}/api/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: 'ada-lovelace', jobDescription: 'Math role' }),
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /OpenRouter request failed/);
  } finally {
    server.close();
  }
});

test('POST /api/tailor 404s for an unknown person', async () => {
  const { app } = makeApp({ tailorFn: async () => 'unused' });
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: 'nobody', jobDescription: 'x' }),
    });
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server.test.js`
Expected: FAIL — `Cannot find module './server'`

- [ ] **Step 3: Write `server.js`**

```js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { slugify, listPeople, readCV, writeCV, deleteCV } = require('./lib/cvStore');
const { buildTailorMessages, parseTailorResponse } = require('./lib/promptBuilder');
const { tailorWithOpenRouter } = require('./lib/openrouterClient');

function createApp({ cvsDir, skillPath, apiKey, model, tailorFn = tailorWithOpenRouter }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/people', (req, res) => {
    res.json(listPeople(cvsDir));
  });

  app.post('/api/people', (req, res) => {
    const cv = req.body;
    if (!cv || !cv.name) {
      return res.status(400).json({ error: 'name is required' });
    }
    let id = slugify(cv.name);
    let suffix = 2;
    while (fs.existsSync(path.join(cvsDir, `${id}.json`))) {
      id = `${slugify(cv.name)}-${suffix}`;
      suffix += 1;
    }
    writeCV(cvsDir, id, cv);
    res.status(201).json({ id, ...cv });
  });

  app.get('/api/cv/:id', (req, res) => {
    try {
      res.json(readCV(cvsDir, req.params.id));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.put('/api/cv/:id', (req, res) => {
    try {
      readCV(cvsDir, req.params.id);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }
    writeCV(cvsDir, req.params.id, req.body);
    res.json(req.body);
  });

  app.delete('/api/cv/:id', (req, res) => {
    deleteCV(cvsDir, req.params.id);
    res.status(204).end();
  });

  app.post('/api/tailor', async (req, res) => {
    const { personId, jobDescription } = req.body || {};
    if (!personId || !jobDescription) {
      return res.status(400).json({ error: 'personId and jobDescription are required' });
    }

    let cv;
    try {
      cv = readCV(cvsDir, personId);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }

    const skillText = fs.readFileSync(skillPath, 'utf8');
    const messages = buildTailorMessages({ skillText, cv, jobDescription });

    try {
      const raw = await tailorFn({ apiKey, model, messages });
      const parsed = parseTailorResponse(raw);
      res.json(parsed);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  require('dotenv').config();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Missing OPENROUTER_API_KEY in .env — see .env.example');
    process.exit(1);
  }
  const app = createApp({
    cvsDir: path.join(__dirname, 'cvs'),
    skillPath: path.join(__dirname, 'prompts', 'SKILL.md'),
    apiKey,
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5',
  });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Resume Tailor running at http://localhost:${port}`));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server.test.js`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat: add Express server with people, cv, and tailor routes"
```

---

### Task 5: Frontend — People tab and Tailor tab

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/app.js`

**Interfaces:**
- Consumes: `GET/POST /api/people`, `GET/PUT/DELETE /api/cv/:id`, `POST /api/tailor` (Task 4). Uses the global `marked.parse(markdown): string` function from the `marked` UMD build.
- Produces: nothing consumed by other tasks (top of the stack).

- [ ] **Step 1: Create `public/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Resume Tailor</title>
  <link rel="stylesheet" href="style.css" />
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
  <header>
    <h1>Resume Tailor</h1>
    <nav>
      <button id="tab-people" class="tab-btn active">People</button>
      <button id="tab-tailor" class="tab-btn">Tailor</button>
    </nav>
  </header>

  <main id="people-panel" class="panel">
    <div class="people-layout">
      <div class="people-list">
        <h2>Saved people</h2>
        <ul id="people-list"></ul>
        <button id="new-person-btn">+ Add person</button>
      </div>
      <div class="cv-editor">
        <h2 id="cv-editor-title">New person</h2>
        <p class="hint">Master CV as JSON: name, contact, summary, skills[], experience[], projects[], education[].</p>
        <textarea id="cv-json" rows="20" spellcheck="false"></textarea>
        <div class="cv-editor-actions">
          <button id="save-cv-btn">Save</button>
          <button id="delete-cv-btn" class="danger">Delete</button>
        </div>
        <p id="cv-error" class="error"></p>
      </div>
    </div>
  </main>

  <main id="tailor-panel" class="panel hidden">
    <div class="tailor-controls">
      <label for="person-select">Person</label>
      <select id="person-select"></select>
      <label for="job-description">Job description</label>
      <textarea id="job-description" rows="10" placeholder="Paste the job description here"></textarea>
      <button id="tailor-btn">Tailor</button>
      <p id="tailor-error" class="error"></p>
    </div>

    <div class="tailor-results hidden" id="tailor-results">
      <div class="resume-column">
        <h2>Resume (editable)</h2>
        <textarea id="resume-markdown" rows="30" spellcheck="false"></textarea>
        <button id="print-btn">Preview &amp; Print PDF</button>
      </div>
      <div class="match-column">
        <h2>Compatibility</h2>
        <p id="match-percent" class="match-percent"></p>
        <div id="match-report" class="match-report"></div>
      </div>
    </div>
  </main>

  <div id="print-view" class="hidden"></div>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/style.css`**

```css
:root {
  color-scheme: light dark;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  padding: 0 1.5rem 2rem;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 0;
  border-bottom: 1px solid #ccc;
}

.tab-btn {
  padding: 0.5rem 1rem;
  margin-left: 0.5rem;
  cursor: pointer;
}

.tab-btn.active {
  font-weight: bold;
  border-bottom: 2px solid #333;
}

.hidden {
  display: none !important;
}

.people-layout {
  display: flex;
  gap: 2rem;
  margin-top: 1rem;
}

.people-list {
  width: 220px;
}

.people-list ul {
  list-style: none;
  padding: 0;
}

.people-list li {
  padding: 0.4rem 0.5rem;
  cursor: pointer;
  border-radius: 4px;
}

.people-list li.selected {
  background: #e0e8ff;
}

.cv-editor {
  flex: 1;
}

textarea {
  width: 100%;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  box-sizing: border-box;
}

.cv-editor-actions {
  margin-top: 0.5rem;
  display: flex;
  gap: 0.5rem;
}

button.danger {
  background: #c0392b;
  color: white;
  border: none;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  cursor: pointer;
}

.error {
  color: #c0392b;
  min-height: 1.2em;
}

.tailor-controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 700px;
  margin-top: 1rem;
}

.tailor-results {
  display: flex;
  gap: 2rem;
  margin-top: 1.5rem;
}

.resume-column,
.match-column {
  flex: 1;
}

.match-percent {
  font-size: 1.5rem;
  font-weight: bold;
}

.match-report ul {
  padding-left: 1.2rem;
}

@media print {
  header, #people-panel, .tailor-controls, .resume-column textarea, #print-btn, .match-column {
    display: none !important;
  }
  #print-view {
    display: block !important;
  }
}
```

- [ ] **Step 3: Create `public/app.js`**

```js
'use strict';

const state = {
  people: [],
  selectedPersonId: null,
};

const el = (id) => document.getElementById(id);

function showTab(tab) {
  el('tab-people').classList.toggle('active', tab === 'people');
  el('tab-tailor').classList.toggle('active', tab === 'tailor');
  el('people-panel').classList.toggle('hidden', tab !== 'people');
  el('tailor-panel').classList.toggle('hidden', tab !== 'tailor');
}

el('tab-people').addEventListener('click', () => showTab('people'));
el('tab-tailor').addEventListener('click', () => showTab('tailor'));

async function loadPeople() {
  const res = await fetch('/api/people');
  state.people = await res.json();
  renderPeopleList();
  renderPersonSelect();
}

function renderPeopleList() {
  const ul = el('people-list');
  ul.innerHTML = '';
  for (const person of state.people) {
    const li = document.createElement('li');
    li.textContent = person.name;
    li.dataset.id = person.id;
    if (person.id === state.selectedPersonId) li.classList.add('selected');
    li.addEventListener('click', () => selectPerson(person.id));
    ul.appendChild(li);
  }
}

function renderPersonSelect() {
  const select = el('person-select');
  select.innerHTML = '';
  for (const person of state.people) {
    const opt = document.createElement('option');
    opt.value = person.id;
    opt.textContent = person.name;
    select.appendChild(opt);
  }
}

async function selectPerson(id) {
  state.selectedPersonId = id;
  renderPeopleList();
  const res = await fetch(`/api/cv/${id}`);
  const cv = await res.json();
  el('cv-editor-title').textContent = cv.name;
  el('cv-json').value = JSON.stringify(cv, null, 2);
  el('cv-error').textContent = '';
}

el('new-person-btn').addEventListener('click', () => {
  state.selectedPersonId = null;
  renderPeopleList();
  el('cv-editor-title').textContent = 'New person';
  el('cv-json').value = JSON.stringify(
    { name: '', contact: '', summary: '', skills: [], experience: [], projects: [], education: [] },
    null,
    2,
  );
  el('cv-error').textContent = '';
});

el('save-cv-btn').addEventListener('click', async () => {
  let cv;
  try {
    cv = JSON.parse(el('cv-json').value);
  } catch (err) {
    el('cv-error').textContent = `Invalid JSON: ${err.message}`;
    return;
  }
  if (!cv.name) {
    el('cv-error').textContent = 'name is required';
    return;
  }

  el('cv-error').textContent = '';
  if (state.selectedPersonId) {
    await fetch(`/api/cv/${state.selectedPersonId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cv),
    });
  } else {
    const res = await fetch('/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cv),
    });
    const created = await res.json();
    state.selectedPersonId = created.id;
  }
  await loadPeople();
  selectPerson(state.selectedPersonId);
});

el('delete-cv-btn').addEventListener('click', async () => {
  if (!state.selectedPersonId) return;
  await fetch(`/api/cv/${state.selectedPersonId}`, { method: 'DELETE' });
  state.selectedPersonId = null;
  el('cv-json').value = '';
  el('cv-editor-title').textContent = 'New person';
  await loadPeople();
});

el('tailor-btn').addEventListener('click', async () => {
  const personId = el('person-select').value;
  const jobDescription = el('job-description').value.trim();
  el('tailor-error').textContent = '';

  if (!personId || !jobDescription) {
    el('tailor-error').textContent = 'Pick a person and paste a job description first.';
    return;
  }

  el('tailor-btn').disabled = true;
  try {
    const res = await fetch('/api/tailor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId, jobDescription }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Tailoring failed');
    }
    el('resume-markdown').value = body.resume;
    el('match-percent').textContent = `${body.matchPercent}% (${body.matched}/${body.matched + body.unmatched} matched)`;
    el('match-report').innerHTML = marked.parse(body.matchReport);
    el('tailor-results').classList.remove('hidden');
  } catch (err) {
    el('tailor-error').textContent = err.message;
  } finally {
    el('tailor-btn').disabled = false;
  }
});

el('print-btn').addEventListener('click', () => {
  const markdown = el('resume-markdown').value;
  el('print-view').innerHTML = marked.parse(markdown);
  window.print();
});

loadPeople();
```

- [ ] **Step 4: Manual verification**

Run: `npm start` (needs a real `.env` with `OPENROUTER_API_KEY` — copy from `.env.example`)
Then open `http://localhost:3000` in a browser and:
1. Click "+ Add person", paste a small real CV as JSON, Save — confirm it appears in the People list.
2. Switch to the Tailor tab, pick that person, paste a real job description, click Tailor.
3. Confirm the resume textarea fills with markdown built only from facts you entered, and the Compatibility panel shows a percentage with a ✅/❌ checklist.
4. Edit the resume textarea, click "Preview & Print PDF", confirm the browser print dialog shows the edited content styled (not the raw markdown, not the rest of the page).

Expected: all four checks pass. No automated test for this task — it's UI wiring over routes already covered by `server.test.js`.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat: add frontend for People and Tailor tabs"
```

---

### Task 6: README quickstart

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (documentation only).

- [ ] **Step 1: Create `README.md`**

```markdown
# Resume Tailor

Tailors a master CV (yours or a friend's) to a pasted job description using Claude via OpenRouter, without inventing content. Shows a compatibility checklist with a computed match %.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in `OPENROUTER_API_KEY` (from https://openrouter.ai/keys)
3. `npm start`
4. Open http://localhost:3000

## Usage

1. **People tab** — add a person, paste their full master CV as JSON (name, contact, summary, skills, experience, projects, education). Save. Add as many people as you want — not limited to any fixed number.
2. **Tailor tab** — pick a person, paste a job description, click Tailor.
3. Review/edit the generated resume in the textarea — it's built only from facts in that person's master CV (see `prompts/SKILL.md` for the exact rules the model follows).
4. Check the Compatibility panel for the match % and which requirements were and weren't found in the master CV.
5. Click "Preview & Print PDF" to save the final resume as a PDF via your browser's print dialog.

## Tests

`npm test`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```
