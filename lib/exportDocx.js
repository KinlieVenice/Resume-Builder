'use strict';
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
} = require('docx');

// Verified against real generated OOXML (unlike html-to-docx, which only understands a
// narrow CSS subset and can't combine nested formatting tags): docx.js gives real
// paragraph borders, spacing, and bullet numbering, so this builds the resume directly
// from paragraph/run objects instead of going through HTML.
const FONT = 'Arial';
const BODY_SIZE = 19; // half-points -> 9.5pt, matches the print CSS
const NAME_SIZE = 32; // 16pt
const CONTACT_SIZE = 18; // 9pt
const HEADING_SIZE = 22; // 11pt
const PAGE_SIZE = { width: 12240, height: 15840 }; // US Letter, twips
const MARGIN = { top: 648, right: 864, bottom: 648, left: 864 }; // twips -> 0.45in/0.6in, matches @page

function parseInlineSegments(line) {
  const segments = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) {
      segments.push({ text: m[1], bold: true });
    } else {
      segments.push({ text: m[2], italic: true });
    }
    last = re.lastIndex;
  }
  if (last < line.length) segments.push({ text: line.slice(last) });
  if (segments.length === 0) segments.push({ text: line });
  return segments;
}

function segmentsToRuns(segments, extra = {}) {
  return segments.map(
    (s) => new TextRun({ text: s.text, bold: s.bold, italics: s.italic, ...extra }),
  );
}

function buildDocument(markdown) {
  const lines = markdown.split('\n');
  const children = [];
  let i = 0;

  const nameLine = (lines[i] || '').replace(/^#\s*/, '');
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: nameLine, bold: true, size: NAME_SIZE })],
  }));
  i += 1;

  const headerLines = [];
  while (i < lines.length && lines[i].trim() !== '') {
    headerLines.push(lines[i]);
    i += 1;
  }
  headerLines.forEach((line, idx) => {
    const isLast = idx === headerLines.length - 1;
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: isLast ? 160 : 20 },
      children: segmentsToRuns(parseInlineSegments(line), { size: CONTACT_SIZE }),
    }));
  });

  while (i < lines.length && lines[i].trim() === '') i += 1;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim().toUpperCase();
      children.push(new Paragraph({
        spacing: { before: 160, after: 60 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' } },
        children: [new TextRun({ text: heading, bold: true, size: HEADING_SIZE })],
      }));
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (line.startsWith('- ')) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: segmentsToRuns(parseInlineSegments(line.slice(2))),
      }));
      i += 1;
      continue;
    }

    children.push(new Paragraph({ children: segmentsToRuns(parseInlineSegments(line)) }));
    i += 1;
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE },
        },
      },
    },
    sections: [{
      properties: {
        page: { size: PAGE_SIZE, margin: MARGIN },
      },
      children,
    }],
  });
}

async function renderDocxBuffer(markdown) {
  return Packer.toBuffer(buildDocument(markdown));
}

module.exports = { parseInlineSegments, renderDocxBuffer };
