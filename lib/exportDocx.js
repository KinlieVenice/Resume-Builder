'use strict';
const { Marked } = require('marked');
const HTMLtoDOCX = require('html-to-docx');

// html-to-docx only understands a narrow set of inline CSS (text-align, font-size,
// color) plus a handful of semantic tags (<strong>, <em>, <u>) for run formatting —
// no margin/border/hr, and nesting two formatting tags keeps only the innermost one.
// This renderer sticks to what's actually verified to work, to match the PDF's
// centered header / bold-caps section look as closely as that allows.
function buildResumeHtml(markdown) {
  let justSawH1 = false;

  const renderer = {
    heading(text, level) {
      if (level === 1) {
        justSawH1 = true;
        return `<p style="text-align:center;font-size:16pt;"><strong>${text}</strong></p>`;
      }
      justSawH1 = false;
      return `<p style="font-size:12pt;"><strong>${text.toUpperCase()}</strong></p>`;
    },
    paragraph(text) {
      if (justSawH1) {
        justSawH1 = false;
        return `<p style="text-align:center;font-size:9pt;">${text}</p>`;
      }
      return `<p>${text}</p>`;
    },
  };

  const m = new Marked({ breaks: true });
  m.use({ renderer });
  return m.parse(markdown);
}

async function renderDocxBuffer(html, htmlToDocxImpl = HTMLtoDOCX) {
  return htmlToDocxImpl(html, null, {
    font: 'Arial',
    fontSize: 19, // half-points -> 9.5pt body, matches the print CSS
    margins: {
      top: 648,
      right: 864,
      bottom: 648,
      left: 864,
      header: 360,
      footer: 360,
      gutter: 0,
    }, // twip -> 0.45in/0.6in, matches @page
  });
}

module.exports = { buildResumeHtml, renderDocxBuffer };
