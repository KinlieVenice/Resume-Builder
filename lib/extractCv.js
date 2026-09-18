'use strict';
const { PDFParse } = require('pdf-parse');

async function defaultPdfParse(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    return await parser.getText();
  } finally {
    await parser.destroy();
  }
}

async function extractTextFromPdf(buffer, pdfParseImpl = defaultPdfParse) {
  const result = await pdfParseImpl(buffer);
  return result.text;
}

function buildExtractMessages({ skillText, resumeText }) {
  return [
    { role: 'system', content: skillText },
    {
      role: 'user',
      content: `RESUME TEXT (extracted from an uploaded PDF):\n\n${resumeText}`,
    },
  ];
}

function parseExtractResponse(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonText = fenced ? fenced[1] : text;

  let cv;
  try {
    cv = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Model response was not valid JSON: ${err.message}`);
  }

  if (!cv || typeof cv !== 'object' || !cv.name) {
    throw new Error('Extracted CV JSON is missing "name"');
  }

  return cv;
}

module.exports = { extractTextFromPdf, buildExtractMessages, parseExtractResponse };
