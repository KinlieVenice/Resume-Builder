'use strict';

const DEFAULT_SERVER_URL = 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', async () => {
  const { serverUrl } = await chrome.storage.sync.get('serverUrl');
  document.getElementById('server-url').value = serverUrl || DEFAULT_SERVER_URL;
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const serverUrl = document.getElementById('server-url').value.trim() || DEFAULT_SERVER_URL;
  await chrome.storage.sync.set({ serverUrl });
  document.getElementById('status').textContent = 'Saved. Reload the extension for the menu to refresh.';
});
