# SQLite Storage + Job Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move master CV storage from `cvs/*.json` files to SQLite, and add a job-application tracker: paste a posting + its link, AI fills in the fact fields, edit/filter/delete rows in a table per person.

**Architecture:** New `lib/db.js` (opens a `node:sqlite` `DatabaseSync`, creates the `people`/`jobs` schema). `lib/cvStore.js` rewritten to the same exported function names but backed by the `people` table instead of files. New `lib/jobsStore.js` for job CRUD. `server.js` gains `GET/POST /api/jobs` and `PUT/DELETE /api/jobs/:id`, backed by a new `prompts/EXTRACT_JOB.md`. New "Jobs" tab in the frontend.

**Tech Stack:** `node:sqlite` (Node 24 built-in, zero new dependency — verified working directly: file-based open, `exec` for DDL, `prepare().run()/.get()/.all()`, all confirmed before writing any code).

## Global Constraints

- `cvStore.js`'s exported function names stay the same (`slugify`, `listPeople`, `readCV`, `writeCV`, `deleteCV`) — only the first argument changes from a directory path to a `db` handle (from spec addendum, minimizes ripple).
- DB file: `data/resume-tailor.db`, gitignored; only `data/.gitkeep` tracked (from spec addendum).
- Job extraction follows the same no-fabrication rule as `SKILL.md`/`EXTRACT.md`: leave a field blank rather than guess — salary is frequently just absent from postings (from spec addendum).
- New job rows: `status` defaults to `"Submitted"`, `dateApplied` defaults to today, both server-set (from spec addendum).
- No auth/VPS-hardening in this pass — flagged separately, deferred (from spec addendum).
- This app is not yet deployed anywhere live — no running production data to preserve beyond the one real profile currently in `cvs/kinlie-venice-l-de-guzman.json` on disk, which the migration script must carry forward.

---

### Task 1: db module

**Files:**
- Create: `lib/db.js`
- Test: `lib/db.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `openDb(dbPath: string): DatabaseSync` — exported from `lib/db.js`. `lib/cvStore.js`, `lib/jobsStore.js` (via the `db` object they receive), and `server.js` (Task 5) all use the object this returns; nothing calls `openDb` except `server.js`'s entry point and tests.

- [ ] **Step 1: Write the failing tests**

Create `lib/db.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('./db');

test('openDb creates the people and jobs tables, ready to use', () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO people (id, name, cv_json) VALUES (?, ?, ?)').run('ada', 'Ada', '{}');
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get('ada');
  assert.equal(person.name, 'Ada');

  db.prepare(
    'INSERT INTO jobs (person_id, date_applied, status) VALUES (?, ?, ?)',
  ).run('ada', '2026-09-19', 'Submitted');
  const job = db.prepare('SELECT * FROM jobs WHERE person_id = ?').get('ada');
  assert.equal(job.status, 'Submitted');
  db.close();
});

test('openDb is idempotent — reopening an existing file does not error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
  const dbPath = path.join(dir, 'test.db');

  const db1 = openDb(dbPath);
  db1.prepare('INSERT INTO people (id, name, cv_json) VALUES (?, ?, ?)').run('ada', 'Ada', '{}');
  db1.close();

  const db2 = openDb(dbPath);
  const person = db2.prepare('SELECT * FROM people WHERE id = ?').get('ada');
  assert.equal(person.name, 'Ada');
  db2.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/db.test.js`
Expected: FAIL — `Cannot find module './db'`

- [ ] **Step 3: Write `lib/db.js`**

```js
'use strict';
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
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
`;

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/db.test.js`
Expected: PASS — 2 tests passing (a `SQLite is an experimental feature` warning is expected and harmless).

- [ ] **Step 5: Commit**

```bash
git add lib/db.js lib/db.test.js
git commit -m "feat: add db module using node:sqlite"
```

---

### Task 2: cvStore rewrite (SQLite-backed)

**Files:**
- Modify: `lib/cvStore.js`
- Modify: `lib/cvStore.test.js`

**Interfaces:**
- Consumes: a `db` object shaped like `openDb`'s return value (Task 1) — tests construct their own via `openDb(':memory:')`.
- Produces: same as before — `slugify(name: string): string`, `listPeople(db): {id, name}[]`, `readCV(db, id): object`, `writeCV(db, id, data): void`, `deleteCV(db, id): void`. `server.js` (Task 5) calls all of these with a real `db` instead of a directory path.

- [ ] **Step 1: Replace `lib/cvStore.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('./db');
const { slugify, listPeople, readCV, writeCV, deleteCV } = require('./cvStore');

function testDb() {
  return openDb(':memory:');
}

test('slugify lowercases and dashes non-alphanumerics', () => {
  assert.equal(slugify('Jhorizrodel Aquino'), 'jhorizrodel-aquino');
  assert.equal(slugify('  Weird!!  Name__2  '), 'weird-name-2');
});

test('writeCV then readCV round-trips data', () => {
  const db = testDb();
  const cv = { name: 'Ada Lovelace', skills: ['math'] };
  writeCV(db, 'ada-lovelace', cv);
  assert.deepEqual(readCV(db, 'ada-lovelace'), cv);
});

test('writeCV on an existing id overwrites rather than duplicating', () => {
  const db = testDb();
  writeCV(db, 'ada-lovelace', { name: 'Ada Lovelace', skills: ['math'] });
  writeCV(db, 'ada-lovelace', { name: 'Ada Lovelace', skills: ['math', 'logic'] });
  assert.deepEqual(readCV(db, 'ada-lovelace').skills, ['math', 'logic']);
  assert.equal(listPeople(db).length, 1);
});

test('readCV throws for missing person', () => {
  const db = testDb();
  assert.throws(() => readCV(db, 'nobody'), /No CV found/);
});

test('listPeople returns id+name for every stored CV, sorted by name', () => {
  const db = testDb();
  writeCV(db, 'alan-turing', { name: 'Alan Turing' });
  writeCV(db, 'ada-lovelace', { name: 'Ada Lovelace' });
  assert.deepEqual(listPeople(db), [
    { id: 'ada-lovelace', name: 'Ada Lovelace' },
    { id: 'alan-turing', name: 'Alan Turing' },
  ]);
});

test('deleteCV removes the row, readCV then throws', () => {
  const db = testDb();
  writeCV(db, 'ada-lovelace', { name: 'Ada Lovelace' });
  deleteCV(db, 'ada-lovelace');
  assert.throws(() => readCV(db, 'ada-lovelace'), /No CV found/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/cvStore.test.js`
Expected: FAIL — old `cvStore.js` still expects a directory path, not a `db` object.

- [ ] **Step 3: Replace `lib/cvStore.js`**

```js
'use strict';

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function listPeople(db) {
  return db.prepare('SELECT id, name FROM people ORDER BY name').all();
}

function readCV(db, id) {
  const row = db.prepare('SELECT cv_json FROM people WHERE id = ?').get(id);
  if (!row) {
    throw new Error(`No CV found for "${id}"`);
  }
  return JSON.parse(row.cv_json);
}

function writeCV(db, id, data) {
  db.prepare(
    `INSERT INTO people (id, name, cv_json) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, cv_json = excluded.cv_json`,
  ).run(id, data.name || id, JSON.stringify(data));
}

function deleteCV(db, id) {
  db.prepare('DELETE FROM people WHERE id = ?').run(id);
}

module.exports = { slugify, listPeople, readCV, writeCV, deleteCV };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/cvStore.test.js`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/cvStore.js lib/cvStore.test.js
git commit -m "feat: rewrite cvStore on SQLite instead of JSON files"
```

---

### Task 3: jobsStore module

**Files:**
- Create: `lib/jobsStore.js`
- Test: `lib/jobsStore.test.js`

**Interfaces:**
- Consumes: a `db` object (Task 1).
- Produces: `listJobs(db, personId): job[]`, `getJob(db, id): job|null`, `createJob(db, {personId, dateApplied, jobTitle, briefDesc, company, salary, status, link}): job`, `updateJob(db, id, fields): job` (throws if `id` doesn't exist), `deleteJob(db, id): void`, `parseJobFields(text: string): object` (strips a ```json fence if present, throws on invalid JSON). A `job` object shape: `{id, personId, dateApplied, jobTitle, briefDesc, company, salary, status, link}`. `server.js` (Task 5) calls all of these.

- [ ] **Step 1: Write the failing tests**

Create `lib/jobsStore.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('./db');
const { listJobs, getJob, createJob, updateJob, deleteJob, parseJobFields } = require('./jobsStore');

function testDb() {
  return openDb(':memory:');
}

test('createJob inserts and returns the row with a camelCase shape', () => {
  const db = testDb();
  const job = createJob(db, {
    personId: 'ada-lovelace',
    dateApplied: '2026-09-19',
    jobTitle: 'Backend Engineer',
    briefDesc: 'Build APIs',
    company: 'Acme',
    salary: '',
    status: 'Submitted',
    link: 'https://example.com/job/1',
  });
  assert.equal(typeof job.id, 'number');
  assert.equal(job.personId, 'ada-lovelace');
  assert.equal(job.jobTitle, 'Backend Engineer');
  assert.equal(job.status, 'Submitted');
});

test('listJobs returns only the given person\\'s jobs, newest first', () => {
  const db = testDb();
  createJob(db, { personId: 'ada', dateApplied: '2026-09-01', status: 'Submitted' });
  createJob(db, { personId: 'ada', dateApplied: '2026-09-10', status: 'Submitted' });
  createJob(db, { personId: 'alan', dateApplied: '2026-09-15', status: 'Submitted' });

  const adaJobs = listJobs(db, 'ada');
  assert.equal(adaJobs.length, 2);
  assert.equal(adaJobs[0].dateApplied, '2026-09-10');
  assert.equal(adaJobs[1].dateApplied, '2026-09-01');
});

test('updateJob merges given fields and leaves others untouched', () => {
  const db = testDb();
  const job = createJob(db, { personId: 'ada', dateApplied: '2026-09-19', jobTitle: 'Engineer', status: 'Submitted' });
  const updated = updateJob(db, job.id, { status: 'Interviewed' });
  assert.equal(updated.status, 'Interviewed');
  assert.equal(updated.jobTitle, 'Engineer');
});

test('updateJob throws for an unknown id', () => {
  const db = testDb();
  assert.throws(() => updateJob(db, 999, { status: 'Rejected' }), /No job found/);
});

test('deleteJob removes the row', () => {
  const db = testDb();
  const job = createJob(db, { personId: 'ada', dateApplied: '2026-09-19', status: 'Submitted' });
  deleteJob(db, job.id);
  assert.equal(getJob(db, job.id), null);
});

test('parseJobFields parses plain JSON', () => {
  assert.deepEqual(parseJobFields('{"jobTitle": "Engineer"}'), { jobTitle: 'Engineer' });
});

test('parseJobFields strips a ```json code fence', () => {
  assert.deepEqual(parseJobFields('```json\\n{"jobTitle": "Engineer"}\\n```'), { jobTitle: 'Engineer' });
});

test('parseJobFields throws a clear error on invalid JSON', () => {
  assert.throws(() => parseJobFields('not json'), /not valid JSON/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/jobsStore.test.js`
Expected: FAIL — `Cannot find module './jobsStore'`

- [ ] **Step 3: Write `lib/jobsStore.js`**

```js
'use strict';

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    personId: row.person_id,
    dateApplied: row.date_applied,
    jobTitle: row.job_title,
    briefDesc: row.brief_desc,
    company: row.company,
    salary: row.salary,
    status: row.status,
    link: row.link,
  };
}

function listJobs(db, personId) {
  const rows = db
    .prepare('SELECT * FROM jobs WHERE person_id = ? ORDER BY date_applied DESC, id DESC')
    .all(personId);
  return rows.map(rowToJob);
}

function getJob(db, id) {
  return rowToJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
}

function createJob(db, { personId, dateApplied, jobTitle, briefDesc, company, salary, status, link }) {
  const info = db
    .prepare(
      `INSERT INTO jobs (person_id, date_applied, job_title, brief_desc, company, salary, status, link)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(personId, dateApplied, jobTitle || null, briefDesc || null, company || null, salary || null, status, link || null);
  return getJob(db, info.lastInsertRowid);
}

const FIELD_COLUMN = {
  dateApplied: 'date_applied',
  jobTitle: 'job_title',
  briefDesc: 'brief_desc',
  company: 'company',
  salary: 'salary',
  status: 'status',
  link: 'link',
};

function updateJob(db, id, fields) {
  const existing = getJob(db, id);
  if (!existing) {
    throw new Error(`No job found for id ${id}`);
  }

  const columns = Object.keys(fields).filter((k) => FIELD_COLUMN[k]);
  if (columns.length === 0) return existing;

  const setClause = columns.map((k) => `${FIELD_COLUMN[k]} = ?`).join(', ');
  const values = columns.map((k) => fields[k]);
  db.prepare(`UPDATE jobs SET ${setClause} WHERE id = ?`).run(...values, id);
  return getJob(db, id);
}

function deleteJob(db, id) {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

function parseJobFields(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonText = fenced ? fenced[1] : text;

  let fields;
  try {
    fields = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Model response was not valid JSON: ${err.message}`);
  }

  if (!fields || typeof fields !== 'object') {
    throw new Error('Extracted job fields response was not a JSON object');
  }

  return fields;
}

module.exports = { listJobs, getJob, createJob, updateJob, deleteJob, parseJobFields };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/jobsStore.test.js`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/jobsStore.js lib/jobsStore.test.js
git commit -m "feat: add jobsStore module for job application CRUD"
```

---

### Task 4: EXTRACT_JOB.md prompt

**Files:**
- Create: `prompts/EXTRACT_JOB.md`

**Interfaces:**
- Consumes: nothing.
- Produces: system-prompt text, loaded by `server.js` (Task 5) via `fs.readFileSync`.

- [ ] **Step 1: Write `prompts/EXTRACT_JOB.md`**

```markdown
# Job Posting Extraction Skill

You are extracting a few structured fields from a pasted job posting, for a personal job-application tracker.

## Absolute rule — no fabrication

Every field must come from the posting text you were given.

- If a field isn't stated in the text, leave it as an empty string — never guess or estimate. Salary in particular is very often not listed; leave it blank rather than inferring a range from the role/seniority.
- `briefDesc` is a short, honest 1-2 sentence summary of the role as described — not marketing copy, not padded, just what the posting actually says the role does.

## Output format

Return ONLY a single JSON object, no prose before or after, no markdown fences unless your response format requires it:

```json
{
  "jobTitle": "string — the role's title as stated",
  "company": "string — the hiring company's name",
  "briefDesc": "string — 1-2 sentence honest summary of the role",
  "salary": "string — exactly as stated (e.g. a range or figure), or empty string if not mentioned"
}
```
```

- [ ] **Step 2: Commit**

```bash
git add prompts/EXTRACT_JOB.md
git commit -m "feat: add EXTRACT_JOB.md prompt for job posting extraction"
```

---

### Task 5: Wire SQLite + jobs routes into server.js

**Files:**
- Modify: `server.js`
- Modify: `server.test.js`

**Interfaces:**
- Consumes: `openDb` from `./lib/db`; `listJobs`, `createJob`, `updateJob`, `deleteJob`, `parseJobFields` from `./lib/jobsStore`; `slugify`, `listPeople`, `readCV`, `writeCV`, `deleteCV` from `./lib/cvStore` (now called with `db` instead of `cvsDir`).
- Produces: `createApp({db, skillPath, extractSkillPath, extractJobSkillPath, apiKey, model, baseUrl, tailorFn?, extractFn?, jobExtractFn?, pdfParseImpl?})` — `cvsDir` param is gone, replaced by `db`; new `extractJobSkillPath` and `jobExtractFn` (defaults to `tailorWithOpenRouter`, same injection pattern as the others). New routes `GET /api/jobs`, `POST /api/jobs`, `PUT /api/jobs/:id`, `DELETE /api/jobs/:id`, consumed by the frontend in Task 7.

- [ ] **Step 1: Replace `server.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('./lib/db');
const { createApp } = require('./server');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resume-tailor-test-'));
}

function makeApp({ tailorFn, baseUrl, extractFn, pdfParseImpl, jobExtractFn } = {}) {
  const db = openDb(':memory:');
  const skillPath = path.join(tmpDir(), 'SKILL.md');
  fs.writeFileSync(skillPath, 'TEST SKILL RULES');
  const extractSkillPath = path.join(tmpDir(), 'EXTRACT.md');
  fs.writeFileSync(extractSkillPath, 'TEST EXTRACT RULES');
  const extractJobSkillPath = path.join(tmpDir(), 'EXTRACT_JOB.md');
  fs.writeFileSync(extractJobSkillPath, 'TEST EXTRACT JOB RULES');
  const app = createApp({
    db,
    skillPath,
    extractSkillPath,
    extractJobSkillPath,
    apiKey: 'test-key',
    model: 'anthropic/claude-sonnet-5',
    baseUrl,
    tailorFn,
    extractFn,
    pdfParseImpl,
    jobExtractFn,
  });
  return { app, db };
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
  const fakeTailor = async ({ messages, baseUrl }) => {
    assert.equal(messages[0].content, 'TEST SKILL RULES');
    assert.equal(baseUrl, 'http://localhost:20128/v1');
    return [
      '## RESUME',
      '# Ada Lovelace',
      '',
      '## MATCH_REPORT',
      '- ✅ Math — has math background',
      '- ❌ Rust — not found in master CV',
    ].join('\n');
  };
  const { app } = makeApp({ tailorFn: fakeTailor, baseUrl: 'http://localhost:20128/v1' });
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

test('POST /api/export-docx returns a docx buffer for the given markdown', async () => {
  const { app } = makeApp();
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/export-docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: '# Ada Lovelace\n\nMathematician' }),
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.slice(0, 4).toString('hex'), '504b0304');
  } finally {
    server.close();
  }
});

test('POST /api/export-docx returns 400 when resume is missing', async () => {
  const { app } = makeApp();
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/export-docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('GET /api/jobs requires personId', async () => {
  const { app } = makeApp();
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/jobs`);
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /api/jobs extracts fields via jobExtractFn and saves with server-set date/status', async () => {
  const fakeJobExtractFn = async ({ messages }) => {
    assert.equal(messages[0].content, 'TEST EXTRACT JOB RULES');
    assert.ok(messages[1].content.includes('We need a Backend Engineer'));
    return '{"jobTitle": "Backend Engineer", "company": "Acme", "briefDesc": "Build APIs", "salary": ""}';
  };
  const { app } = makeApp({ jobExtractFn: fakeJobExtractFn });
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personId: 'ada-lovelace',
        jobDescription: 'We need a Backend Engineer at Acme.',
        link: 'https://example.com/job/1',
      }),
    });
    assert.equal(res.status, 201);
    const job = await res.json();
    assert.equal(job.jobTitle, 'Backend Engineer');
    assert.equal(job.company, 'Acme');
    assert.equal(job.status, 'Submitted');
    assert.equal(job.link, 'https://example.com/job/1');
    assert.match(job.dateApplied, /^\d{4}-\d{2}-\d{2}$/);

    const listRes = await fetch(`${base}/api/jobs?personId=ada-lovelace`);
    const jobs = await listRes.json();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, job.id);
  } finally {
    server.close();
  }
});

test('POST /api/jobs returns 502 when extraction fails', async () => {
  const failingJobExtractFn = async () => { throw new Error('OpenRouter request failed (500): boom'); };
  const { app } = makeApp({ jobExtractFn: failingJobExtractFn });
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: 'ada-lovelace', jobDescription: 'x' }),
    });
    assert.equal(res.status, 502);
  } finally {
    server.close();
  }
});

test('PUT /api/jobs/:id updates a field, e.g. status', async () => {
  const fakeJobExtractFn = async () => '{"jobTitle": "Engineer", "company": "", "briefDesc": "", "salary": ""}';
  const { app } = makeApp({ jobExtractFn: fakeJobExtractFn });
  const { server, base } = await listen(app);
  try {
    const createRes = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: 'ada-lovelace', jobDescription: 'x' }),
    });
    const job = await createRes.json();

    const putRes = await fetch(`${base}/api/jobs/${job.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Interviewed' }),
    });
    assert.equal(putRes.status, 200);
    assert.equal((await putRes.json()).status, 'Interviewed');
  } finally {
    server.close();
  }
});

test('DELETE /api/jobs/:id removes the row', async () => {
  const fakeJobExtractFn = async () => '{"jobTitle": "Engineer", "company": "", "briefDesc": "", "salary": ""}';
  const { app } = makeApp({ jobExtractFn: fakeJobExtractFn });
  const { server, base } = await listen(app);
  try {
    const createRes = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: 'ada-lovelace', jobDescription: 'x' }),
    });
    const job = await createRes.json();

    const delRes = await fetch(`${base}/api/jobs/${job.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 204);

    const listRes = await fetch(`${base}/api/jobs?personId=ada-lovelace`);
    assert.deepEqual(await listRes.json(), []);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server.test.js`
Expected: FAIL — `server.js` still expects `cvsDir`, and the `/api/jobs` routes don't exist yet.

- [ ] **Step 3: Replace `server.js`**

```js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const multer = require('multer');
const { slugify, listPeople, readCV, writeCV, deleteCV } = require('./lib/cvStore');
const { buildTailorMessages, parseTailorResponse } = require('./lib/promptBuilder');
const { tailorWithOpenRouter } = require('./lib/openrouterClient');
const { extractTextFromPdf, buildExtractMessages, parseExtractResponse } = require('./lib/extractCv');
const { renderDocxBuffer } = require('./lib/exportDocx');
const { listJobs, createJob, updateJob, deleteJob, parseJobFields } = require('./lib/jobsStore');
const { openDb } = require('./lib/db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function createApp({
  db,
  skillPath,
  extractSkillPath,
  extractJobSkillPath,
  apiKey,
  model,
  baseUrl,
  tailorFn = tailorWithOpenRouter,
  extractFn = tailorWithOpenRouter,
  jobExtractFn = tailorWithOpenRouter,
  pdfParseImpl,
}) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/people', (req, res) => {
    res.json(listPeople(db));
  });

  app.post('/api/people', (req, res) => {
    const cv = req.body;
    if (!cv || !cv.name) {
      return res.status(400).json({ error: 'name is required' });
    }
    let id = slugify(cv.name);
    let suffix = 2;
    const idTaken = (candidate) => {
      try {
        readCV(db, candidate);
        return true;
      } catch {
        return false;
      }
    };
    while (idTaken(id)) {
      id = `${slugify(cv.name)}-${suffix}`;
      suffix += 1;
    }
    writeCV(db, id, cv);
    res.status(201).json({ id, ...cv });
  });

  app.get('/api/cv/:id', (req, res) => {
    try {
      res.json(readCV(db, req.params.id));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.put('/api/cv/:id', (req, res) => {
    try {
      readCV(db, req.params.id);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }
    writeCV(db, req.params.id, req.body);
    res.json(req.body);
  });

  app.delete('/api/cv/:id', (req, res) => {
    deleteCV(db, req.params.id);
    res.status(204).end();
  });

  app.post('/api/tailor', async (req, res) => {
    const { personId, jobDescription } = req.body || {};
    if (!personId || !jobDescription) {
      return res.status(400).json({ error: 'personId and jobDescription are required' });
    }

    let cv;
    try {
      cv = readCV(db, personId);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }

    const skillText = fs.readFileSync(skillPath, 'utf8');
    const messages = buildTailorMessages({ skillText, cv, jobDescription });

    try {
      const raw = await tailorFn({ apiKey, model, messages, baseUrl });
      const parsed = parseTailorResponse(raw);
      res.json(parsed);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

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

  app.post('/api/export-docx', async (req, res) => {
    const { resume } = req.body || {};
    if (!resume) {
      return res.status(400).json({ error: 'resume is required' });
    }

    try {
      const buffer = await renderDocxBuffer(resume);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="resume.docx"',
      });
      res.send(buffer);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get('/api/jobs', (req, res) => {
    const { personId } = req.query;
    if (!personId) {
      return res.status(400).json({ error: 'personId is required' });
    }
    res.json(listJobs(db, personId));
  });

  app.post('/api/jobs', async (req, res) => {
    const { personId, jobDescription, link } = req.body || {};
    if (!personId || !jobDescription) {
      return res.status(400).json({ error: 'personId and jobDescription are required' });
    }

    const extractJobSkillText = fs.readFileSync(extractJobSkillPath, 'utf8');
    const messages = [
      { role: 'system', content: extractJobSkillText },
      { role: 'user', content: `JOB POSTING TEXT:\n\n${jobDescription}` },
    ];

    try {
      const raw = await jobExtractFn({ apiKey, model, messages, baseUrl });
      const fields = parseJobFields(raw);
      const job = createJob(db, {
        personId,
        dateApplied: todayDate(),
        jobTitle: fields.jobTitle || '',
        briefDesc: fields.briefDesc || '',
        company: fields.company || '',
        salary: fields.salary || '',
        status: 'Submitted',
        link: link || '',
      });
      res.status(201).json(job);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.put('/api/jobs/:id', (req, res) => {
    try {
      const job = updateJob(db, Number(req.params.id), req.body || {});
      res.json(job);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.delete('/api/jobs/:id', (req, res) => {
    deleteJob(db, Number(req.params.id));
    res.status(204).end();
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
  const dataDir = path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'resume-tailor.db'));
  const app = createApp({
    db,
    skillPath: path.join(__dirname, 'prompts', 'SKILL.md'),
    extractSkillPath: path.join(__dirname, 'prompts', 'EXTRACT.md'),
    extractJobSkillPath: path.join(__dirname, 'prompts', 'EXTRACT_JOB.md'),
    apiKey,
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5',
    baseUrl: process.env.OPENROUTER_BASE_URL,
  });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Resume Tailor running at http://localhost:${port}`));
}
```

Note: `POST /api/people`'s id-collision check changed from `fs.existsSync` to a small `idTaken` helper using `readCV`'s throw — this is the one behavior-preserving adaptation needed since `cvStore` no longer exposes a filesystem-shaped existence check.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server.test.js`
Expected: PASS — all tests in the file passing.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all tests across all files passing.

- [ ] **Step 6: Commit**

```bash
git add server.js server.test.js
git commit -m "feat: wire SQLite storage and job routes into server.js"
```

---

### Task 6: Migrate existing CV data, retire `cvs/`

**Files:**
- Create: `scripts/import-cvs.js`
- Modify: `.gitignore`
- Delete: `cvs/` directory (after running the migration once)

**Interfaces:**
- Consumes: `openDb` from `../lib/db`, `writeCV` from `../lib/cvStore`.
- Produces: nothing consumed by other tasks — a one-off operational script.

- [ ] **Step 1: Write `scripts/import-cvs.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { writeCV } = require('../lib/cvStore');

const cvsDir = path.join(__dirname, '..', 'cvs');
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = openDb(path.join(dataDir, 'resume-tailor.db'));

if (!fs.existsSync(cvsDir)) {
  console.log('No cvs/ directory found — nothing to import.');
  process.exit(0);
}

const files = fs.readdirSync(cvsDir).filter((f) => f.endsWith('.json'));
for (const file of files) {
  const id = file.slice(0, -'.json'.length);
  const data = JSON.parse(fs.readFileSync(path.join(cvsDir, file), 'utf8'));
  writeCV(db, id, data);
  console.log(`Imported ${id} (${data.name})`);
}

console.log(`Done — imported ${files.length} CV(s) into data/resume-tailor.db.`);
```

- [ ] **Step 2: Run the migration**

Run: `cd /home/kinlie/builder && node scripts/import-cvs.js`
Expected: prints `Imported kinlie-venice-l-de-guzman (KINLIE VENICE L. DE GUZMAN)` (or whatever real profile is currently in `cvs/`) and a final "Done" line.

- [ ] **Step 3: Verify the import**

Run: `node -e "const {openDb}=require('./lib/db'); const {listPeople}=require('./lib/cvStore'); const db=openDb('./data/resume-tailor.db'); console.log(listPeople(db));"`
Expected: prints an array containing the migrated person(s).

- [ ] **Step 4: Update `.gitignore`**

Replace:

```
cvs/*.json
```

with:

```
data/*.db
```

(Keep the existing `node_modules/` and `.env` lines as-is.)

- [ ] **Step 5: Remove the old `cvs/` directory**

Run: `rm -rf /home/kinlie/builder/cvs`

- [ ] **Step 6: Add `data/.gitkeep`**

Create an empty file at `data/.gitkeep` so the otherwise-gitignored directory stays tracked.

- [ ] **Step 7: Run the full suite once more**

Run: `npm test`
Expected: PASS — removing `cvs/` doesn't affect any test (they all use `:memory:` or temp DB files).

- [ ] **Step 8: Commit**

```bash
git add scripts/import-cvs.js .gitignore data/.gitkeep
git rm -r --cached cvs 2>/dev/null || true
git commit -m "feat: migrate CV storage from cvs/*.json to SQLite, add import script"
```

---

### Task 7: "Jobs" tab

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `GET/POST /api/jobs`, `PUT/DELETE /api/jobs/:id` (Task 5), `GET /api/people` (existing).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Update `public/index.html`**

Add a third tab button next to the existing two:

```html
      <button id="tab-tailor" class="tab-btn">Tailor</button>
      <button id="tab-jobs" class="tab-btn">Jobs</button>
```

Add a new `<main>` panel after the `tailor-panel` closing tag, before `<div id="print-view">`:

```html
  <main id="jobs-panel" class="panel hidden">
    <div class="jobs-controls">
      <label for="jobs-person-select">Person</label>
      <select id="jobs-person-select"></select>
    </div>

    <div class="jobs-save-box">
      <label for="job-description-input">Job posting text</label>
      <textarea id="job-description-input" rows="8" placeholder="Paste the full job posting here"></textarea>
      <label for="job-link-input">Link</label>
      <input type="text" id="job-link-input" placeholder="https://..." />
      <button id="save-job-btn">Save this job</button>
      <p id="job-save-error" class="error"></p>
    </div>

    <table id="jobs-table">
      <thead>
        <tr>
          <th>Date Applied</th>
          <th>Job Title</th>
          <th>Brief Desc</th>
          <th>Company</th>
          <th>Salary</th>
          <th>Status</th>
          <th>Link</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="jobs-table-body"></tbody>
    </table>
  </main>
```

- [ ] **Step 2: Add styles in `public/style.css`**

Add near the end of the file (before the `@media print` block):

```css
.jobs-controls {
  margin-top: 1rem;
  max-width: 300px;
}

.jobs-save-box {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-width: 700px;
  margin-top: 1rem;
}

#jobs-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1.5rem;
  font-size: 0.9rem;
}

#jobs-table th,
#jobs-table td {
  border: 1px solid #ccc;
  padding: 0.3rem;
  text-align: left;
}

#jobs-table input,
#jobs-table select {
  width: 100%;
  box-sizing: border-box;
  border: none;
  font-size: 0.9rem;
  background: transparent;
}

#jobs-table input:focus,
#jobs-table select:focus {
  background: #fffbe0;
}
```

- [ ] **Step 3: Wire it up in `public/app.js`**

Add tab switching for the new tab — update the existing `showTab` function:

```js
function showTab(tab) {
  el('tab-people').classList.toggle('active', tab === 'people');
  el('tab-tailor').classList.toggle('active', tab === 'tailor');
  el('tab-jobs').classList.toggle('active', tab === 'jobs');
  el('people-panel').classList.toggle('hidden', tab !== 'people');
  el('tailor-panel').classList.toggle('hidden', tab !== 'tailor');
  el('jobs-panel').classList.toggle('hidden', tab !== 'jobs');
}
```

Add the new tab's click listener near the existing ones:

```js
el('tab-jobs').addEventListener('click', () => {
  showTab('jobs');
  loadJobsForSelectedPerson();
});
```

Update `renderPersonSelect` to also populate the jobs tab's person dropdown — replace it with:

```js
function renderPersonSelect() {
  for (const selectId of ['person-select', 'jobs-person-select']) {
    const select = el(selectId);
    const previous = select.value;
    select.innerHTML = '';
    for (const person of state.people) {
      const opt = document.createElement('option');
      opt.value = person.id;
      opt.textContent = person.name;
      select.appendChild(opt);
    }
    if (previous && state.people.some((p) => p.id === previous)) {
      select.value = previous;
    }
  }
}
```

Add the jobs logic at the end of the file, before `loadPeople();`:

```js
const STATUS_OPTIONS = ['Submitted', 'Called', 'Interviewed', 'Job Offer', 'Rejected'];

async function loadJobsForSelectedPerson() {
  const personId = el('jobs-person-select').value;
  if (!personId) {
    el('jobs-table-body').innerHTML = '';
    return;
  }
  const res = await fetch(`/api/jobs?personId=${encodeURIComponent(personId)}`);
  const jobs = await res.json();
  renderJobsTable(jobs);
}

function renderJobsTable(jobs) {
  const tbody = el('jobs-table-body');
  tbody.innerHTML = '';
  for (const job of jobs) {
    tbody.appendChild(buildJobRow(job));
  }
}

function buildJobRow(job) {
  const tr = document.createElement('tr');

  const textCell = (field, value) => {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.addEventListener('change', () => updateJobField(job.id, field, input.value));
    td.appendChild(input);
    return td;
  };

  tr.appendChild(textCell('dateApplied', job.dateApplied));
  tr.appendChild(textCell('jobTitle', job.jobTitle));
  tr.appendChild(textCell('briefDesc', job.briefDesc));
  tr.appendChild(textCell('company', job.company));
  tr.appendChild(textCell('salary', job.salary));

  const statusTd = document.createElement('td');
  const statusSelect = document.createElement('select');
  for (const opt of STATUS_OPTIONS) {
    const optionEl = document.createElement('option');
    optionEl.value = opt;
    optionEl.textContent = opt;
    if (opt === job.status) optionEl.selected = true;
    statusSelect.appendChild(optionEl);
  }
  statusSelect.addEventListener('change', () => updateJobField(job.id, 'status', statusSelect.value));
  statusTd.appendChild(statusSelect);
  tr.appendChild(statusTd);

  tr.appendChild(textCell('link', job.link));

  const deleteTd = document.createElement('td');
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '×';
  deleteBtn.className = 'danger';
  deleteBtn.addEventListener('click', async () => {
    await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
    tr.remove();
  });
  deleteTd.appendChild(deleteBtn);
  tr.appendChild(deleteTd);

  return tr;
}

async function updateJobField(id, field, value) {
  await fetch(`/api/jobs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [field]: value }),
  });
}

el('jobs-person-select').addEventListener('change', loadJobsForSelectedPerson);

el('save-job-btn').addEventListener('click', async () => {
  const personId = el('jobs-person-select').value;
  const jobDescription = el('job-description-input').value.trim();
  const link = el('job-link-input').value.trim();
  el('job-save-error').textContent = '';

  if (!personId || !jobDescription) {
    el('job-save-error').textContent = 'Pick a person and paste a job posting first.';
    return;
  }

  el('save-job-btn').disabled = true;
  el('save-job-btn').textContent = 'Saving…';
  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId, jobDescription, link }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Saving the job failed');
    }
    el('job-description-input').value = '';
    el('job-link-input').value = '';
    await loadJobsForSelectedPerson();
  } catch (err) {
    el('job-save-error').textContent = err.message;
  } finally {
    el('save-job-btn').disabled = false;
    el('save-job-btn').textContent = 'Save this job';
  }
});
```

- [ ] **Step 4: Manual verification**

Run: `npm start` (restart if already running), open the app.
1. Go to the Jobs tab, pick your person.
2. Paste a real job posting's text, add a link, click "Save this job". Confirm a new row appears with AI-filled Job Title/Company/Brief Desc/Salary (salary blank if the posting didn't list one) and Status defaulted to "Submitted", Date Applied to today.
3. Edit a cell directly (e.g. fix a wrong company name, or change Status via the dropdown) — confirm it persists after a page refresh.
4. Add a second job, confirm the table shows newest-applied-first.
5. Click the delete button on a row, confirm it's gone after refresh too.
6. Switch the person filter (if a second person exists) — confirm only that person's jobs show.

Expected: all six checks pass. No automated test for this task — DOM wiring over already-tested routes (Task 5).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: add Jobs tab with AI-assisted job application tracking"
```

---

### Task 8: README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (documentation only).

- [ ] **Step 1: Update `README.md`**

Add a new numbered item after the existing Usage list's item 5 (renumber as needed), and mention SQLite in Setup:

```markdown
6. **Jobs tab** — pick a person, paste a job posting's full text plus its link, click "Save this job". AI fills in Job Title, Company, Brief Desc, and Salary (left blank if the posting doesn't state it) — Date Applied and Status ("Submitted") are set automatically. Every cell is directly editable, and rows can be deleted.
```

Add a short note near the top of Setup:

```markdown
Data (people, master CVs, job applications) is stored in `data/resume-tailor.db` (SQLite, via Node's built-in `node:sqlite` — no separate database install needed).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document SQLite storage and the Jobs tab"
```
