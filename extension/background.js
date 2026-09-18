'use strict';

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const MENU_PARENT_ID = 'resume-builder';
const MENU_REFRESH_ID = 'resume-builder-refresh';

let peopleNames = {}; // personId -> display name, populated by rebuildMenu

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.sync.get('serverUrl');
  return serverUrl || DEFAULT_SERVER_URL;
}

async function rebuildMenu() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_PARENT_ID,
    title: 'Resume Builder',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: MENU_REFRESH_ID,
    parentId: MENU_PARENT_ID,
    title: '↻ Refresh list',
    contexts: ['selection'],
  });

  const serverUrl = await getServerUrl();
  peopleNames = {};

  try {
    const res = await fetch(`${serverUrl}/api/people`);
    const people = await res.json();
    for (const person of people) {
      peopleNames[person.id] = person.name;
      chrome.contextMenus.create({
        id: `person-${person.id}`,
        parentId: MENU_PARENT_ID,
        title: person.name,
        contexts: ['selection'],
      });
    }
  } catch (err) {
    chrome.contextMenus.create({
      id: 'resume-builder-error',
      parentId: MENU_PARENT_ID,
      title: `Can't reach server (${serverUrl})`,
      enabled: false,
      contexts: ['selection'],
    });
  }
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icon128.png',
    title,
    message,
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function downloadBlob(blob, filename) {
  const dataUrl = await blobToDataUrl(blob);
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function runTailorFlow(personId, jobDescription) {
  const serverUrl = await getServerUrl();
  const personName = peopleNames[personId] || personId;
  const notifyId = `resume-builder-${Date.now()}`;

  notify(notifyId, 'Resume Builder', `Tailoring for ${personName}…`);

  try {
    const tailorRes = await fetch(`${serverUrl}/api/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId, jobDescription }),
    });
    const tailorBody = await tailorRes.json();
    if (!tailorRes.ok) throw new Error(tailorBody.error || 'Tailoring failed');

    const [docxRes, pdfRes] = await Promise.all([
      fetch(`${serverUrl}/api/export-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: tailorBody.resume }),
      }),
      fetch(`${serverUrl}/api/export-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: tailorBody.resume }),
      }),
    ]);
    if (!docxRes.ok) throw new Error('Word export failed');
    if (!pdfRes.ok) throw new Error('PDF export failed');

    const slug = slugify(personName);
    await downloadBlob(await docxRes.blob(), `${slug}-resume.docx`);
    await downloadBlob(await pdfRes.blob(), `${slug}-resume.pdf`);

    notify(notifyId, 'Resume Builder', `✅ Downloaded resume.pdf + resume.docx for ${personName}`);
  } catch (err) {
    notify(notifyId, 'Resume Builder', `❌ ${err.message}`);
  }
}

chrome.runtime.onInstalled.addListener(rebuildMenu);
chrome.runtime.onStartup.addListener(rebuildMenu);

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_REFRESH_ID) {
    rebuildMenu();
    return;
  }
  if (typeof info.menuItemId !== 'string' || !info.menuItemId.startsWith('person-')) {
    return;
  }
  const personId = info.menuItemId.slice('person-'.length);
  const jobDescription = info.selectionText;
  if (!jobDescription) {
    notify(`resume-builder-${Date.now()}`, 'Resume Builder', 'No text selected.');
    return;
  }
  runTailorFlow(personId, jobDescription);
});
