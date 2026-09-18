'use strict';
const puppeteer = require('puppeteer');
const { buildPdfHtml } = require('./pdfTemplate');

async function renderPdfBuffer(markdown, puppeteerImpl = puppeteer) {
  const browser = await puppeteerImpl.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(buildPdfHtml(markdown));
    const bytes = await page.pdf({ preferCSSPageSize: true });
    return Buffer.from(bytes);
  } finally {
    await browser.close();
  }
}

module.exports = { renderPdfBuffer };
