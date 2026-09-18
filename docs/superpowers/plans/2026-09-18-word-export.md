# Word (.docx) Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person download the tailored resume (current textarea content, including their edits) as a real `.docx` file, alongside the existing browser-print-to-PDF path.

**Architecture:** New `lib/exportDocx.js` module (markdown→HTML via `marked`, HTML→docx buffer via `html-to-docx`, both wired the same injectable way as the rest of `lib/`). New `POST /api/export-docx` route on the existing Express app. New "Export Word" button next to "Preview & Print PDF" in the Tailor tab.

**Tech Stack:** Adds `html-to-docx` (HTML → real OOXML `.docx` Buffer). Confirmed working: `require('html-to-docx')` is directly callable — `await HTMLtoDOCX(htmlString, headerHtml, options, footerHtml)` resolves to a `Buffer` starting with the zip signature `50 4b 03 04`.

## Global Constraints

- Not a PDF→Word conversion — generated straight from the resume markdown (from spec addendum).
- `html-to-docx` pulls in a vulnerable `image-size` transitive dep (DoS on malformed ICNS/JXL/HEIF images). Accepted risk — this app never feeds it images or untrusted input, only the user's own resume text. Do not add image handling to this feature without revisiting that.
- Markdown → HTML must use `breaks: true` (matches the print-view rendering already in `public/app.js`, so Word output matches the PDF preview's line breaks).

---

### Task 1: exportDocx module

**Files:**
- Create: `lib/exportDocx.js`
- Test: `lib/exportDocx.test.js`

**Interfaces:**
- Consumes: nothing from other modules.
- Produces: `buildResumeHtml(markdown: string): string`, `renderDocxBuffer(html: string, htmlToDocxImpl?: Function): Promise<Buffer>` — exported from `lib/exportDocx.js`. `server.js` (Task 2) calls both.

- [ ] **Step 1: Install `html-to-docx`**

Run: `cd /home/kinlie/builder && npm install html-to-docx`
Expected: added to `package.json` dependencies, no errors (an `npm audit` warning about a transitive `image-size` DoS advisory is expected and accepted per Global Constraints above).

- [ ] **Step 2: Write the failing tests**

Create `lib/exportDocx.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResumeHtml, renderDocxBuffer } = require('./exportDocx');

test('buildResumeHtml renders markdown headings and bold text', () => {
  const html = buildResumeHtml('# Ada Lovelace\n\n**Mathematician**');
  assert.ok(html.includes('<h1>Ada Lovelace</h1>'));
  assert.ok(html.includes('<strong>Mathematician</strong>'));
});

test('buildResumeHtml turns single newlines into <br> (breaks: true)', () => {
  const html = buildResumeHtml('Line one\nLine two');
  assert.ok(html.includes('Line one<br>Line two'));
});

test('renderDocxBuffer passes the html through to the injected implementation', async () => {
  const calls = [];
  const fakeHtmlToDocx = async (html, header, options) => {
    calls.push({ html, header, options });
    return Buffer.from('fake docx bytes');
  };
  const buf = await renderDocxBuffer('<h1>Ada</h1>', fakeHtmlToDocx);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.toString(), 'fake docx bytes');
  assert.equal(calls[0].html, '<h1>Ada</h1>');
});

test('renderDocxBuffer with the real html-to-docx produces a valid docx buffer', async () => {
  const buf = await renderDocxBuffer('<h1>Ada Lovelace</h1><p>Mathematician</p>');
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.slice(0, 4).toString('hex'), '504b0304');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test lib/exportDocx.test.js`
Expected: FAIL — `Cannot find module './exportDocx'`

- [ ] **Step 4: Write `lib/exportDocx.js`**

```js
'use strict';
const { marked } = require('marked');
const HTMLtoDOCX = require('html-to-docx');

marked.setOptions({ breaks: true });

function buildResumeHtml(markdown) {
  return marked.parse(markdown);
}

async function renderDocxBuffer(html, htmlToDocxImpl = HTMLtoDOCX) {
  return htmlToDocxImpl(html, null, {});
}

module.exports = { buildResumeHtml, renderDocxBuffer };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test lib/exportDocx.test.js`
Expected: PASS — 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/exportDocx.js lib/exportDocx.test.js
git commit -m "feat: add exportDocx module for Word export"
```

---

### Task 2: `/api/export-docx` route

**Files:**
- Modify: `server.js`
- Modify: `server.test.js`

**Interfaces:**
- Consumes: `buildResumeHtml`, `renderDocxBuffer` from `./lib/exportDocx`.
- Produces: new route `POST /api/export-docx`, JSON body `{ resume: string }`, binary `.docx` response — consumed by the frontend in Task 3.

- [ ] **Step 1: Write the failing test**

Add to `server.test.js`, after the existing `/api/extract-cv` tests:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server.test.js`
Expected: FAIL — 404 instead of 200/400 (route doesn't exist yet).

- [ ] **Step 3: Update `server.js`**

Add the import near the other `lib/` imports:

```js
const { buildResumeHtml, renderDocxBuffer } = require('./lib/exportDocx');
```

Add this route inside `createApp`, after the `/api/extract-cv` route and before `return app;`:

```js
  app.post('/api/export-docx', async (req, res) => {
    const { resume } = req.body || {};
    if (!resume) {
      return res.status(400).json({ error: 'resume is required' });
    }

    try {
      const html = buildResumeHtml(resume);
      const buffer = await renderDocxBuffer(html);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="resume.docx"',
      });
      res.send(buffer);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server.test.js`
Expected: PASS — all tests in the file passing.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all tests across all files passing.

- [ ] **Step 6: Commit**

```bash
git add server.js server.test.js
git commit -m "feat: add POST /api/export-docx route"
```

---

### Task 3: "Export Word" button

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `POST /api/export-docx` (Task 2).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Update `public/index.html`**

Change:

```html
        <button id="print-btn">Preview &amp; Print PDF</button>
```

to:

```html
        <button id="print-btn">Preview &amp; Print PDF</button>
        <button id="export-docx-btn">Export Word</button>
        <p id="export-error" class="error"></p>
```

- [ ] **Step 2: Wire it up in `public/app.js`**

Add this after the existing `el('print-btn')` click handler:

```js
el('export-docx-btn').addEventListener('click', async () => {
  const resume = el('resume-markdown').value;
  el('export-error').textContent = '';
  el('export-docx-btn').disabled = true;
  el('export-docx-btn').textContent = 'Exporting…';

  try {
    const res = await fetch('/api/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume }),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error || 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resume.docx';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    el('export-error').textContent = err.message;
  } finally {
    el('export-docx-btn').disabled = false;
    el('export-docx-btn').textContent = 'Export Word';
  }
});
```

- [ ] **Step 3: Manual verification**

Run: `npm start` (restart if already running, since `server.js` changed), open the app, go to Tailor tab, run a real tailor call (or reuse a resume already in the textarea).
1. Click "Export Word" — confirm a `resume.docx` file downloads.
2. Open it in Word/LibreOffice/Google Docs — confirm headings, bold text, and bullet lists render correctly and match the print preview's content.
3. Edit the resume textarea, click "Export Word" again — confirm the downloaded file reflects the edit (not the original tailor response).

Expected: all three checks pass. No automated test for this task — DOM wiring over an already-tested route (Task 2).

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: add Export Word button to Tailor tab"
```
