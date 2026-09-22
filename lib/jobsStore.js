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

function findJobByLink(db, personId, link) {
  if (!link) return null;
  return rowToJob(
    db.prepare('SELECT * FROM jobs WHERE person_id = ? AND link = ?').get(personId, link),
  );
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

module.exports = { listJobs, getJob, findJobByLink, createJob, updateJob, deleteJob, parseJobFields };
