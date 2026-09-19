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
