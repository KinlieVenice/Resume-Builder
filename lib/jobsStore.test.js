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

test("listJobs returns only the given person's jobs, newest first", () => {
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
  assert.deepEqual(parseJobFields('```json\n{"jobTitle": "Engineer"}\n```'), { jobTitle: 'Engineer' });
});

test('parseJobFields throws a clear error on invalid JSON', () => {
  assert.throws(() => parseJobFields('not json'), /not valid JSON/);
});
