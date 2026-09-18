'use strict';
const { Marked } = require('marked');

// Mirrors public/style.css's @media print rules for #print-view, adapted for a
// standalone document (no #print-view scoping needed — this whole page IS the resume).
// Keep in sync with public/style.css's print block if that visual design changes.
const STYLE = `
  @page { size: letter; margin: 0.45in 0.6in; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.28; color: #000; margin: 0; }
  h1 { font-size: 14pt; text-align: center; margin: 0 0 2pt; }
  h1 + p { text-align: center; margin: 1pt 0 4pt; font-size: 9pt; line-height: 1.4; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.02em; border-bottom: 1pt solid #000; margin: 8pt 0 3pt; padding-bottom: 1pt; }
  h2:first-of-type { margin-top: 0; }
  p { margin: 2pt 0; }
  ul { margin: 1pt 0 4pt; padding-left: 14pt; }
  li { margin: 0 0 1.5pt; }
  strong { font-weight: bold; }
  em { font-style: italic; }
  a { color: #000; text-decoration: none; }
`;

function buildPdfHtml(markdown) {
  const m = new Marked({ breaks: true });
  const body = m.parse(markdown);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${STYLE}</style>
</head>
<body>${body}</body>
</html>`;
}

module.exports = { buildPdfHtml };
