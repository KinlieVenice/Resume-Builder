'use strict';

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function listPeople(db) {
  return db.prepare('SELECT id, name FROM people ORDER BY name').all().map((row) => ({ ...row }));
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
