'use strict';
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const multer = require('multer');
const { slugify, listPeople, readCV, writeCV, deleteCV } = require('./lib/cvStore');
const { buildTailorMessages, parseTailorResponse } = require('./lib/promptBuilder');
const { tailorWithOpenRouter } = require('./lib/openrouterClient');
const { extractTextFromPdf, buildExtractMessages, parseExtractResponse } = require('./lib/extractCv');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function createApp({
  cvsDir,
  skillPath,
  extractSkillPath,
  apiKey,
  model,
  baseUrl,
  tailorFn = tailorWithOpenRouter,
  extractFn = tailorWithOpenRouter,
  pdfParseImpl,
}) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/people', (req, res) => {
    res.json(listPeople(cvsDir));
  });

  app.post('/api/people', (req, res) => {
    const cv = req.body;
    if (!cv || !cv.name) {
      return res.status(400).json({ error: 'name is required' });
    }
    let id = slugify(cv.name);
    let suffix = 2;
    while (fs.existsSync(path.join(cvsDir, `${id}.json`))) {
      id = `${slugify(cv.name)}-${suffix}`;
      suffix += 1;
    }
    writeCV(cvsDir, id, cv);
    res.status(201).json({ id, ...cv });
  });

  app.get('/api/cv/:id', (req, res) => {
    try {
      res.json(readCV(cvsDir, req.params.id));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.put('/api/cv/:id', (req, res) => {
    try {
      readCV(cvsDir, req.params.id);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }
    writeCV(cvsDir, req.params.id, req.body);
    res.json(req.body);
  });

  app.delete('/api/cv/:id', (req, res) => {
    deleteCV(cvsDir, req.params.id);
    res.status(204).end();
  });

  app.post('/api/tailor', async (req, res) => {
    const { personId, jobDescription } = req.body || {};
    if (!personId || !jobDescription) {
      return res.status(400).json({ error: 'personId and jobDescription are required' });
    }

    let cv;
    try {
      cv = readCV(cvsDir, personId);
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
  const app = createApp({
    cvsDir: path.join(__dirname, 'cvs'),
    skillPath: path.join(__dirname, 'prompts', 'SKILL.md'),
    extractSkillPath: path.join(__dirname, 'prompts', 'EXTRACT.md'),
    apiKey,
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5',
    baseUrl: process.env.OPENROUTER_BASE_URL,
  });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Resume Tailor running at http://localhost:${port}`));
}
