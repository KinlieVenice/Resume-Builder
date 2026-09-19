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
