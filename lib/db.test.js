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
