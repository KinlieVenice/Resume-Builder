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
    pdfRenderFn,
    pdfParseImpl,
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
