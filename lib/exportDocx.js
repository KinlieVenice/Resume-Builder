'use strict';
const { marked } = require('marked');
const HTMLtoDOCX = require('html-to-docx');

marked.setOptions({ breaks: true });

function buildResumeHtml(markdown) {
  return marked.parse(markdown);
}

async function renderDocxBuffer(html, htmlToDocxImpl = HTMLtoDOCX) {
  return htmlToDocxImpl(html, null, {});
}

module.exports = { buildResumeHtml, renderDocxBuffer };
