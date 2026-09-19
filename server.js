'use strict';
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const multer = require('multer');
const { slugify, listPeople, readCV, writeCV, deleteCV } = require('./lib/cvStore');
const { buildTailorMessages, parseTailorResponse } = require('./lib/promptBuilder');
const { tailorWithOpenRouter } = require('./lib/openrouterClient');
const { extractTextFromPdf, buildExtractMessages, parseExtractResponse } = require('./lib/extractCv');
const { renderDocxBuffer } = require('./lib/exportDocx');
const { renderPdfBuffer } = require('./lib/exportPdf');
const { listJobs, createJob, updateJob, deleteJob, parseJobFields } = require('./lib/jobsStore');
const { openDb } = require('./lib/db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function createApp({
  db,
  skillPath,
  extractSkillPath,
  extractJobSkillPath,
  apiKey,
  model,
  baseUrl,
  tailorFn = tailorWithOpenRouter,
  extractFn = tailorWithOpenRouter,
  jobExtractFn = tailorWithOpenRouter,
  pdfParseImpl,
  pdfRenderFn = renderPdfBuffer,
}) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/people', (req, res) => {
    res.json(listPeople(db));
  });

  app.post('/api/people', (req, res) => {
    const cv = req.body;
    if (!cv || !cv.name) {
      return res.status(400).json({ error: 'name is required' });
    }
    let id = slugify(cv.name);
    let suffix = 2;
    const idTaken = (candidate) => {
      try {
        readCV(db, candidate);
        return true;
      } catch {
        return false;
      }
    };
    while (idTaken(id)) {
      id = `${slugify(cv.name)}-${suffix}`;
      suffix += 1;
    }
    writeCV(db, id, cv);
    res.status(201).json({ id, ...cv });
  });

  app.get('/api/cv/:id', (req, res) => {
    try {
      res.json(readCV(db, req.params.id));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.put('/api/cv/:id', (req, res) => {
    try {
      readCV(db, req.params.id);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }
    writeCV(db, req.params.id, req.body);
    res.json(req.body);
  });

  app.delete('/api/cv/:id', (req, res) => {
    deleteCV(db, req.params.id);
    res.status(204).end();
  });

  app.post('/api/tailor', async (req, res) => {
    const { personId, jobDescription } = req.body || {};
    if (!personId || !jobDescription) {
      return res.status(400).json({ error: 'personId and jobDescription are required' });
    }

    let cv;
    try {
      cv = readCV(db, personId);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }

    const skillText = fs.readFileSync(skillPath, 'utf8');
    const messages = buildTailorMessages({ skillText, cv, jobDescription });

    try {
      const raw = await tailorFn({ apiKey, model, messages, baseUrl });
      const parsed = parseTailorResponse(raw);
      res.json(parsed);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/extract-cv', upload.single('pdf'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'pdf file is required (field name "pdf")' });
    }

    try {
      const resumeText = await extractTextFromPdf(req.file.buffer, pdfParseImpl);
      const skillText = fs.readFileSync(extractSkillPath, 'utf8');
      const messages = buildExtractMessages({ skillText, resumeText });
      const raw = await extractFn({ apiKey, model, messages, baseUrl });
      const cv = parseExtractResponse(raw);
      res.json(cv);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/export-docx', async (req, res) => {
    const { resume } = req.body || {};
    if (!resume) {
      return res.status(400).json({ error: 'resume is required' });
    }

    try {
      const buffer = await renderDocxBuffer(resume);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="resume.docx"',
      });
      res.send(buffer);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

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

  app.get('/api/jobs', (req, res) => {
    const { personId } = req.query;
    if (!personId) {
      return res.status(400).json({ error: 'personId is required' });
    }
    res.json(listJobs(db, personId));
  });

  app.post('/api/jobs', async (req, res) => {
    const { personId, jobDescription, link } = req.body || {};
    if (!personId || !jobDescription) {
      return res.status(400).json({ error: 'personId and jobDescription are required' });
    }

    const extractJobSkillText = fs.readFileSync(extractJobSkillPath, 'utf8');
    const messages = [
      { role: 'system', content: extractJobSkillText },
      { role: 'user', content: `JOB POSTING TEXT:\n\n${jobDescription}` },
    ];

    try {
      const raw = await jobExtractFn({ apiKey, model, messages, baseUrl });
      const fields = parseJobFields(raw);
      const job = createJob(db, {
        personId,
        dateApplied: todayDate(),
        jobTitle: fields.jobTitle || '',
        briefDesc: fields.briefDesc || '',
        company: fields.company || '',
        salary: fields.salary || '',
        status: 'Submitted',
        link: link || '',
      });
      res.status(201).json(job);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.put('/api/jobs/:id', (req, res) => {
    try {
      const job = updateJob(db, Number(req.params.id), req.body || {});
      res.json(job);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.delete('/api/jobs/:id', (req, res) => {
    deleteJob(db, Number(req.params.id));
    res.status(204).end();
  });

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  require('dotenv').config();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Missing OPENROUTER_API_KEY in .env — see .env.example');
    process.exit(1);
  }
  const dataDir = path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'resume-tailor.db'));
  const app = createApp({
    db,
    skillPath: path.join(__dirname, 'prompts', 'SKILL.md'),
    extractSkillPath: path.join(__dirname, 'prompts', 'EXTRACT.md'),
    extractJobSkillPath: path.join(__dirname, 'prompts', 'EXTRACT_JOB.md'),
    apiKey,
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5',
    baseUrl: process.env.OPENROUTER_BASE_URL,
  });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Resume Tailor running at http://localhost:${port}`));
}
