'use strict';

marked.setOptions({ breaks: true });

const state = {
  people: [],
  selectedPersonId: null,
};

const el = (id) => document.getElementById(id);

function showTab(tab) {
  el('tab-people').classList.toggle('active', tab === 'people');
  el('tab-tailor').classList.toggle('active', tab === 'tailor');
  el('people-panel').classList.toggle('hidden', tab !== 'people');
  el('tailor-panel').classList.toggle('hidden', tab !== 'tailor');
}

el('tab-people').addEventListener('click', () => showTab('people'));
el('tab-tailor').addEventListener('click', () => showTab('tailor'));

async function loadPeople() {
  const res = await fetch('/api/people');
  state.people = await res.json();
  renderPeopleList();
  renderPersonSelect();
}

function renderPeopleList() {
  const ul = el('people-list');
  ul.innerHTML = '';
  for (const person of state.people) {
    const li = document.createElement('li');
    li.textContent = person.name;
    li.dataset.id = person.id;
    if (person.id === state.selectedPersonId) li.classList.add('selected');
    li.addEventListener('click', () => selectPerson(person.id));
    ul.appendChild(li);
  }
}

function renderPersonSelect() {
  const select = el('person-select');
  select.innerHTML = '';
  for (const person of state.people) {
    const opt = document.createElement('option');
    opt.value = person.id;
    opt.textContent = person.name;
    select.appendChild(opt);
  }
}

async function selectPerson(id) {
  state.selectedPersonId = id;
  renderPeopleList();
  const res = await fetch(`/api/cv/${id}`);
  const cv = await res.json();
  el('cv-editor-title').textContent = cv.name;
  el('cv-json').value = JSON.stringify(cv, null, 2);
  el('cv-error').textContent = '';
}

el('new-person-btn').addEventListener('click', () => {
  state.selectedPersonId = null;
  renderPeopleList();
  el('cv-editor-title').textContent = 'New person';
  el('cv-json').value = JSON.stringify(
    { name: '', contact: '', summary: '', skills: [], experience: [], projects: [], education: [] },
    null,
    2,
  );
  el('cv-error').textContent = '';
});

el('upload-pdf-input').addEventListener('change', async () => {
  const file = el('upload-pdf-input').files[0];
  if (!file) return;

  el('upload-error').textContent = '';
  const form = new FormData();
  form.append('pdf', file);

  el('upload-status').classList.remove('hidden');
  el('upload-label').classList.add('disabled');
  el('upload-pdf-input').disabled = true;

  try {
    const res = await fetch('/api/extract-cv', { method: 'POST', body: form });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'PDF extraction failed');
    }
    state.selectedPersonId = null;
    renderPeopleList();
    el('cv-editor-title').textContent = `${body.name} (from PDF — review before saving)`;
    el('cv-json').value = JSON.stringify(body, null, 2);
    el('cv-error').textContent = '';
  } catch (err) {
    el('upload-error').textContent = err.message;
  } finally {
    el('upload-pdf-input').value = '';
    el('upload-status').classList.add('hidden');
    el('upload-label').classList.remove('disabled');
    el('upload-pdf-input').disabled = false;
  }
});

el('save-cv-btn').addEventListener('click', async () => {
  let cv;
  try {
    cv = JSON.parse(el('cv-json').value);
  } catch (err) {
    el('cv-error').textContent = `Invalid JSON: ${err.message}`;
    return;
  }
  if (!cv.name) {
    el('cv-error').textContent = 'name is required';
    return;
  }

  el('cv-error').textContent = '';
  if (state.selectedPersonId) {
    await fetch(`/api/cv/${state.selectedPersonId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cv),
    });
  } else {
    const res = await fetch('/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cv),
    });
    const created = await res.json();
    state.selectedPersonId = created.id;
  }
  await loadPeople();
  selectPerson(state.selectedPersonId);
});

el('delete-cv-btn').addEventListener('click', async () => {
  if (!state.selectedPersonId) return;
  await fetch(`/api/cv/${state.selectedPersonId}`, { method: 'DELETE' });
  state.selectedPersonId = null;
  el('cv-json').value = '';
  el('cv-editor-title').textContent = 'New person';
  await loadPeople();
});

el('tailor-btn').addEventListener('click', async () => {
  const personId = el('person-select').value;
  const jobDescription = el('job-description').value.trim();
  el('tailor-error').textContent = '';

  if (!personId || !jobDescription) {
    el('tailor-error').textContent = 'Pick a person and paste a job description first.';
    return;
  }

  el('tailor-btn').disabled = true;
  el('tailor-btn').textContent = 'Tailoring…';
  try {
    const res = await fetch('/api/tailor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId, jobDescription }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Tailoring failed');
    }
    el('resume-markdown').value = body.resume;
    el('match-percent').textContent = `${body.matchPercent}% (${body.matched}/${body.matched + body.unmatched} matched)`;
    el('match-report').innerHTML = marked.parse(body.matchReport);
    el('tailor-results').classList.remove('hidden');
  } catch (err) {
    el('tailor-error').textContent = err.message;
  } finally {
    el('tailor-btn').disabled = false;
    el('tailor-btn').textContent = 'Tailor';
  }
});

el('print-btn').addEventListener('click', () => {
  const markdown = el('resume-markdown').value;
  el('print-view').innerHTML = marked.parse(markdown);
  window.print();
});

loadPeople();
