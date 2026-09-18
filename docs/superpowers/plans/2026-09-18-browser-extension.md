# Server-Side PDF + Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight a job description on any webpage, right-click → Resume Builder → pick a saved person, and get both `resume.pdf` and `resume.docx` auto-downloaded, with zero manual steps.

**Architecture:** New `lib/pdfTemplate.js` (markdown → self-contained print-styled HTML, reusing the existing print CSS rules) + `lib/exportPdf.js` (that HTML → real PDF `Buffer` via Puppeteer) + `POST /api/export-pdf` route mirroring `/api/export-docx`'s contract. New `extension/` directory: a Manifest V3 Chrome extension (context menu + background service worker + options page) that drives `/api/tailor`, `/api/export-docx`, and `/api/export-pdf` against the already-running local server.

**Tech Stack:** Adds `puppeteer` (bundles Chromium) to the server. The extension is vanilla JS, no build step, no framework.

## Global Constraints

- `page.pdf()` returns a `Uint8Array`, not a Node `Buffer` — always wrap with `Buffer.from()` before sending, to match the rest of the app's Buffer-based contract (verified directly; this was a real, easy-to-miss gotcha).
- The print HTML template must produce visual output matching the existing browser-print CSS: centered name/contact header, bold-uppercase bordered section headings, 9.5pt Arial body, `@page` letter size with 0.45in/0.6in margins (from spec addendum).
- `preferCSSPageSize: true` on `page.pdf()` — the template's own `@page` CSS rule is the single source of truth for page size/margins, not JS options (from spec addendum).
- Extension: no content script, no popup UI — context menu hands over `info.selectionText` directly; feedback only via `chrome.notifications` (from spec addendum).
- Extension: no review/edit step — this is an intentional fast lane; the web app's manual review flow is untouched (from spec addendum).
- Chrome-only for this pass, Manifest V3 (from spec addendum).
- `extension/icon128.png` already exists (a minimal generated solid-color PNG) — reuse it, don't regenerate.

---

### Task 1: pdfTemplate module

**Files:**
- Create: `lib/pdfTemplate.js`
- Test: `lib/pdfTemplate.test.js`

**Interfaces:**
- Consumes: nothing from other modules.
- Produces: `buildPdfHtml(markdown: string): string` — a full `<!DOCTYPE html>` document. Exported from `lib/pdfTemplate.js`. `lib/exportPdf.js` (Task 2) calls this.

- [ ] **Step 1: Write the failing tests**

Create `lib/pdfTemplate.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPdfHtml } = require('./pdfTemplate');

test('buildPdfHtml wraps content in a full HTML document with the @page rule', () => {
  const html = buildPdfHtml('# Ada Lovelace');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('@page'));
  assert.ok(html.includes('size: letter'));
  assert.ok(html.includes('margin: 0.45in 0.6in'));
});

test('buildPdfHtml renders markdown headings and bold text', () => {
  const html = buildPdfHtml('# Ada Lovelace\n\n**Mathematician**');
  assert.ok(html.includes('<h1>Ada Lovelace</h1>'));
  assert.ok(html.includes('<strong>Mathematician</strong>'));
});

test('buildPdfHtml turns single newlines into <br> (breaks: true, matches print view)', () => {
  const html = buildPdfHtml('Line one\nLine two');
  assert.ok(html.includes('Line one<br>Line two'));
});

test('buildPdfHtml renders bullet lines as a real list', () => {
  const html = buildPdfHtml('- First\n- Second');
  assert.ok(html.includes('<li>First</li>'));
  assert.ok(html.includes('<li>Second</li>'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/pdfTemplate.test.js`
Expected: FAIL — `Cannot find module './pdfTemplate'`

- [ ] **Step 3: Write `lib/pdfTemplate.js`**

```js
'use strict';
const { Marked } = require('marked');

// Mirrors public/style.css's @media print rules for #print-view, adapted for a
// standalone document (no #print-view scoping needed — this whole page IS the resume).
// Keep in sync with public/style.css's print block if that visual design changes.
const STYLE = `
  @page { size: letter; margin: 0.45in 0.6in; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.28; color: #000; margin: 0; }
  h1 { font-size: 14pt; text-align: center; margin: 0 0 2pt; }
  h1 + p { text-align: center; margin: 1pt 0 4pt; font-size: 9pt; line-height: 1.4; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.02em; border-bottom: 1pt solid #000; margin: 8pt 0 3pt; padding-bottom: 1pt; }
  h2:first-of-type { margin-top: 0; }
  p { margin: 2pt 0; }
  ul { margin: 1pt 0 4pt; padding-left: 14pt; }
  li { margin: 0 0 1.5pt; }
  strong { font-weight: bold; }
  em { font-style: italic; }
  a { color: #000; text-decoration: none; }
`;

function buildPdfHtml(markdown) {
  const m = new Marked({ breaks: true });
  const body = m.parse(markdown);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${STYLE}</style>
</head>
<body>${body}</body>
</html>`;
}

module.exports = { buildPdfHtml };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/pdfTemplate.test.js`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/pdfTemplate.js lib/pdfTemplate.test.js
git commit -m "feat: add pdfTemplate module for server-side PDF rendering"
```

---

### Task 2: exportPdf module

**Files:**
- Create: `lib/exportPdf.js`
- Test: `lib/exportPdf.test.js`

**Interfaces:**
- Consumes: `buildPdfHtml` from `./lib/pdfTemplate`.
- Produces: `renderPdfBuffer(markdown: string, puppeteerImpl?: {launch: Function}): Promise<Buffer>` — exported from `lib/exportPdf.js`. `server.js` (Task 3) calls this.

- [ ] **Step 1: Install `puppeteer`**

Run: `cd /home/kinlie/builder && npm install puppeteer`
Expected: added to `package.json` dependencies (already installed and verified working during planning — `npm install` here should be a no-op confirming the lockfile, or install cleanly if not already present).

- [ ] **Step 2: Write the failing tests**

Create `lib/exportPdf.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPdfBuffer } = require('./exportPdf');

function fakePuppeteer(pdfBytes) {
  const calls = { setContent: [], pdf: [], closed: false };
  return {
    calls,
    launch: async () => ({
      newPage: async () => ({
        setContent: async (html) => { calls.setContent.push(html); },
        pdf: async (options) => { calls.pdf.push(options); return pdfBytes; },
      }),
      close: async () => { calls.closed = true; },
    }),
  };
}

test('renderPdfBuffer sets the built HTML and requests preferCSSPageSize', async () => {
  const fake = fakePuppeteer(new Uint8Array([1, 2, 3]));
  const buf = await renderPdfBuffer('# Ada Lovelace', fake);
  assert.ok(fake.calls.setContent[0].includes('Ada Lovelace'));
  assert.equal(fake.calls.pdf[0].preferCSSPageSize, true);
  assert.ok(fake.calls.closed);
});

test('renderPdfBuffer wraps the Uint8Array result in a real Buffer', async () => {
  const fake = fakePuppeteer(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  const buf = await renderPdfBuffer('# Ada Lovelace', fake);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.toString(), '%PDF');
});

test('renderPdfBuffer closes the browser even if pdf() throws', async () => {
  const calls = { closed: false };
  const failing = {
    launch: async () => ({
      newPage: async () => ({
        setContent: async () => {},
        pdf: async () => { throw new Error('boom'); },
      }),
      close: async () => { calls.closed = true; },
    }),
  };
  await assert.rejects(() => renderPdfBuffer('# Ada Lovelace', failing), /boom/);
  assert.ok(calls.closed);
});

test('renderPdfBuffer with the real puppeteer produces a valid PDF buffer', async () => {
  const buf = await renderPdfBuffer('# Ada Lovelace\n\n## SUMMARY\nWorked on the Analytical Engine.');
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.slice(0, 5).toString(), '%PDF-');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test lib/exportPdf.test.js`
Expected: FAIL — `Cannot find module './exportPdf'`

- [ ] **Step 4: Write `lib/exportPdf.js`**

```js
'use strict';
const puppeteer = require('puppeteer');
const { buildPdfHtml } = require('./pdfTemplate');

async function renderPdfBuffer(markdown, puppeteerImpl = puppeteer) {
  const browser = await puppeteerImpl.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(buildPdfHtml(markdown));
    const bytes = await page.pdf({ preferCSSPageSize: true });
    return Buffer.from(bytes);
  } finally {
    await browser.close();
  }
}

module.exports = { renderPdfBuffer };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test lib/exportPdf.test.js`
Expected: PASS — 4 tests passing (the real-Puppeteer test takes a second or two — that's expected, it launches a real headless Chromium).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/exportPdf.js lib/exportPdf.test.js
git commit -m "feat: add exportPdf module using Puppeteer"
```

---

### Task 3: `/api/export-pdf` route

**Files:**
- Modify: `server.js`
- Modify: `server.test.js`

**Interfaces:**
- Consumes: `renderPdfBuffer` from `./lib/exportPdf`.
- Produces: extends `createApp({..., pdfRenderFn?})` — `pdfRenderFn` defaults to `renderPdfBuffer`, same injection pattern as `tailorFn`/`extractFn`, so route-level tests don't launch a real browser. New route `POST /api/export-pdf`, consumed by the extension (Task 4).

- [ ] **Step 1: Write the failing tests**

Update the `makeApp` helper in `server.test.js` to accept and pass through `pdfRenderFn`:

```js
function makeApp({ tailorFn, baseUrl, extractFn, pdfParseImpl, pdfRenderFn } = {}) {
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
    pdfRenderFn,
  });
  return { app, cvsDir };
}
```

Add these tests at the end of `server.test.js`:

```js
test('POST /api/export-pdf returns a pdf buffer for the given markdown', async () => {
  const fakePdfRenderFn = async (markdown) => {
    assert.ok(markdown.includes('Ada Lovelace'));
    return Buffer.from('%PDF-fake');
  };
  const { app } = makeApp({ pdfRenderFn: fakePdfRenderFn });
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/export-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: '# Ada Lovelace\n\nMathematician' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.toString(), '%PDF-fake');
  } finally {
    server.close();
  }
});

test('POST /api/export-pdf returns 400 when resume is missing', async () => {
  const { app } = makeApp();
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/export-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /api/export-pdf returns 502 when rendering fails', async () => {
  const failingPdfRenderFn = async () => { throw new Error('Puppeteer launch failed'); };
  const { app } = makeApp({ pdfRenderFn: failingPdfRenderFn });
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/export-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: '# Ada Lovelace' }),
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /Puppeteer launch failed/);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server.test.js`
Expected: FAIL — 404 instead of 200/400/502 (route doesn't exist yet).

- [ ] **Step 3: Update `server.js`**

Add the import near the other `lib/` imports:

```js
const { renderPdfBuffer } = require('./lib/exportPdf');
```

Add `pdfRenderFn = renderPdfBuffer` to `createApp`'s destructured parameters (alongside the existing `tailorFn`/`extractFn` defaults).

Add this route inside `createApp`, after the `/api/export-docx` route and before `return app;`:

```js
  app.post('/api/export-pdf', async (req, res) => {
    const { resume } = req.body || {};
    if (!resume) {
      return res.status(400).json({ error: 'resume is required' });
    }

    try {
      const buffer = await pdfRenderFn(resume);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="resume.pdf"',
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
Expected: PASS — all tests across all files passing (this run will take longer than before — the one real-Puppeteer test in `exportPdf.test.js` launches a real browser).

- [ ] **Step 6: Commit**

```bash
git add server.js server.test.js
git commit -m "feat: add POST /api/export-pdf route"
```

---

### Task 4: Chrome extension

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js`
- Create: `extension/options.html`
- Create: `extension/options.js`
- (already exists: `extension/icon128.png`)

**Interfaces:**
- Consumes: `GET /api/people`, `POST /api/tailor`, `POST /api/export-docx`, `POST /api/export-pdf` (all already implemented).
- Produces: nothing consumed by other tasks (top of the stack).

- [ ] **Step 1: Create `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Resume Builder",
  "version": "1.0.0",
  "description": "Highlight a job description, right-click, pick a saved person, and get a tailored resume.pdf + resume.docx auto-downloaded.",
  "icons": {
    "128": "icon128.png"
  },
  "permissions": ["contextMenus", "downloads", "notifications", "storage"],
  "host_permissions": ["http://localhost/*"],
  "background": {
    "service_worker": "background.js"
  },
  "options_page": "options.html"
}
```

- [ ] **Step 2: Create `extension/options.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Resume Builder Settings</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 1rem; width: 320px; }
    label { display: block; margin-bottom: 0.3rem; font-weight: bold; }
    input { width: 100%; box-sizing: border-box; padding: 0.4rem; }
    button { margin-top: 0.6rem; padding: 0.4rem 0.8rem; }
    p.status { color: #2563eb; min-height: 1.2em; }
  </style>
</head>
<body>
  <label for="server-url">Resume Tailor server URL</label>
  <input type="text" id="server-url" placeholder="http://localhost:3000" />
  <button id="save-btn">Save</button>
  <p id="status" class="status"></p>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `extension/options.js`**

```js
'use strict';

const DEFAULT_SERVER_URL = 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', async () => {
  const { serverUrl } = await chrome.storage.sync.get('serverUrl');
  document.getElementById('server-url').value = serverUrl || DEFAULT_SERVER_URL;
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const serverUrl = document.getElementById('server-url').value.trim() || DEFAULT_SERVER_URL;
  await chrome.storage.sync.set({ serverUrl });
  document.getElementById('status').textContent = 'Saved. Reload the extension for the menu to refresh.';
});
```

- [ ] **Step 4: Create `extension/background.js`**

```js
'use strict';

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const MENU_PARENT_ID = 'resume-builder';
const MENU_REFRESH_ID = 'resume-builder-refresh';

let peopleNames = {}; // personId -> display name, populated by rebuildMenu

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.sync.get('serverUrl');
  return serverUrl || DEFAULT_SERVER_URL;
}

async function rebuildMenu() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_PARENT_ID,
    title: 'Resume Builder',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: MENU_REFRESH_ID,
    parentId: MENU_PARENT_ID,
    title: '↻ Refresh list',
    contexts: ['selection'],
  });

  const serverUrl = await getServerUrl();
  peopleNames = {};

  try {
    const res = await fetch(`${serverUrl}/api/people`);
    const people = await res.json();
    for (const person of people) {
      peopleNames[person.id] = person.name;
      chrome.contextMenus.create({
        id: `person-${person.id}`,
        parentId: MENU_PARENT_ID,
        title: person.name,
        contexts: ['selection'],
      });
    }
  } catch (err) {
    chrome.contextMenus.create({
      id: 'resume-builder-error',
      parentId: MENU_PARENT_ID,
      title: `Can't reach server (${serverUrl})`,
      enabled: false,
      contexts: ['selection'],
    });
  }
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icon128.png',
    title,
    message,
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function downloadBlob(blob, filename) {
  const dataUrl = await blobToDataUrl(blob);
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function runTailorFlow(personId, jobDescription) {
  const serverUrl = await getServerUrl();
  const personName = peopleNames[personId] || personId;
  const notifyId = `resume-builder-${Date.now()}`;

  notify(notifyId, 'Resume Builder', `Tailoring for ${personName}…`);

  try {
    const tailorRes = await fetch(`${serverUrl}/api/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId, jobDescription }),
    });
    const tailorBody = await tailorRes.json();
    if (!tailorRes.ok) throw new Error(tailorBody.error || 'Tailoring failed');

    const [docxRes, pdfRes] = await Promise.all([
      fetch(`${serverUrl}/api/export-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: tailorBody.resume }),
      }),
      fetch(`${serverUrl}/api/export-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: tailorBody.resume }),
      }),
    ]);
    if (!docxRes.ok) throw new Error('Word export failed');
    if (!pdfRes.ok) throw new Error('PDF export failed');

    const slug = slugify(personName);
    await downloadBlob(await docxRes.blob(), `${slug}-resume.docx`);
    await downloadBlob(await pdfRes.blob(), `${slug}-resume.pdf`);

    notify(notifyId, 'Resume Builder', `✅ Downloaded resume.pdf + resume.docx for ${personName}`);
  } catch (err) {
    notify(notifyId, 'Resume Builder', `❌ ${err.message}`);
  }
}

chrome.runtime.onInstalled.addListener(rebuildMenu);
chrome.runtime.onStartup.addListener(rebuildMenu);

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_REFRESH_ID) {
    rebuildMenu();
    return;
  }
  if (typeof info.menuItemId !== 'string' || !info.menuItemId.startsWith('person-')) {
    return;
  }
  const personId = info.menuItemId.slice('person-'.length);
  const jobDescription = info.selectionText;
  if (!jobDescription) {
    notify(`resume-builder-${Date.now()}`, 'Resume Builder', 'No text selected.');
    return;
  }
  runTailorFlow(personId, jobDescription);
});
```

- [ ] **Step 5: Manual verification**

1. Ensure the local server is running: `npm start` (from `/home/kinlie/builder`).
2. In Chrome, go to `chrome://extensions`, enable Developer mode, click "Load unpacked", select the `extension/` directory.
3. Confirm the extension's options page shows a server URL field — leave it as `http://localhost:3000` if that's what `npm start` is using, or update to match the actual port (check `.env`'s `PORT`) and click Save.
4. Right-click on any selected text on any webpage (e.g. select a paragraph on a news site). Confirm a "Resume Builder" submenu appears listing your saved people plus "↻ Refresh list".
5. Click a person. Confirm a "Tailoring for X…" notification appears, then either a success notification with both files downloaded (check the Downloads folder for `{slug}-resume.pdf` and `.docx`), or a clear error notification if something fails.
6. Open the downloaded PDF and Word file — confirm they contain tailored content built from the selected text and that person's master CV, matching the same quality as using the web app directly.
7. Test the "↻ Refresh list" item after adding a new person in the web app, without reloading the extension — confirm the new person appears in the submenu.
8. Test an error path: stop the server (`Ctrl+C`), try the flow again — confirm a clear "Can't reach server" state (either the disabled menu item from `rebuildMenu`'s catch block, or a fetch-failure notification if the menu was already built before the server went down).

Expected: all eight checks pass. No automated test for this task — it's a browser-extension UI with no Node test runner access to Chrome's extension APIs.

- [ ] **Step 6: Commit**

```bash
git add extension/
git commit -m "feat: add Chrome extension for one-click resume generation"
```

---

### Task 5: README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (documentation only).

- [ ] **Step 1: Add an extension section to `README.md`**

Add this section after the existing "Usage" section, before "Tests":

```markdown
## Chrome extension

Highlight a job description on any webpage, right-click, pick a saved person, and get both `resume.pdf` and `resume.docx` downloaded automatically — no need to open the web app.

**Setup:**
1. Make sure the server is running (`npm start`).
2. In Chrome, go to `chrome://extensions`, enable Developer mode, click "Load unpacked", and select this project's `extension/` folder.
3. Click the extension's "Details" → "Extension options" and set the server URL if it's not the default `http://localhost:3000` (check `PORT` in your `.env`).

**Use:** select a job description's text on any page → right-click → **Resume Builder** → pick a person. A notification shows progress; both files land in your normal Downloads folder.

This is a fast lane with no manual review step — for reviewing/editing the resume before export, use the web app instead.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the Chrome extension"
```
