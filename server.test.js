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

function makeApp({ tailorFn, baseUrl } = {}) {
  const cvsDir = tmpDir();
  const skillPath = path.join(tmpDir(), 'SKILL.md');
  fs.writeFileSync(skillPath, 'TEST SKILL RULES');
  const app = createApp({
    cvsDir,
    skillPath,
    apiKey: 'test-key',
    model: 'anthropic/claude-sonnet-5',
    baseUrl,
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
