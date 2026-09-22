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
  el('tab-jobs').classList.toggle('active', tab === 'jobs');
  el('people-panel').classList.toggle('hidden', tab !== 'people');
  el('tailor-panel').classList.toggle('hidden', tab !== 'tailor');
  el('jobs-panel').classList.toggle('hidden', tab !== 'jobs');
}

el('tab-people').addEventListener('click', () => showTab('people'));
el('tab-tailor').addEventListener('click', () => showTab('tailor'));
el('tab-jobs').addEventListener('click', () => {
  showTab('jobs');
  loadJobsForSelectedPerson();
});

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
  for (const selectId of ['person-select', 'jobs-person-select']) {
    const select = el(selectId);
    const previous = select.value;
    select.innerHTML = '';
    for (const person of state.people) {
      const opt = document.createElement('option');
      opt.value = person.id;
      opt.textContent = person.name;
      select.appendChild(opt);
    }
    if (previous && state.people.some((p) => p.id === previous)) {
      select.value = previous;
    }
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
  if (state.selectedPersonId) {
    await fetch(`/api/cv/${state.selectedPersonId}`, { method: 'DELETE' });
    state.selectedPersonId = null;
    await loadPeople();
  }
  el('cv-json').value = '';
  el('cv-editor-title').textContent = 'New person';
  el('cv-error').textContent = '';
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

el('export-docx-btn').addEventListener('click', async () => {
  const resume = el('resume-markdown').value;
  el('export-error').textContent = '';
  el('export-docx-btn').disabled = true;
  el('export-docx-btn').textContent = 'Exporting…';

  try {
    const res = await fetch('/api/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume }),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error || 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resume.docx';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    el('export-error').textContent = err.message;
  } finally {
    el('export-docx-btn').disabled = false;
    el('export-docx-btn').textContent = 'Save as Word';
  }
});

el('save-job-btn').addEventListener('click', async () => {
  const personId = el('person-select').value;
  const jobDescription = el('job-description').value.trim();
  const link = el('job-link').value.trim();
  el('save-job-error').textContent = '';

  if (!personId || !jobDescription) {
    el('save-job-error').textContent = 'Pick a person and paste a job description first.';
    return;
  }

  el('save-job-btn').disabled = true;
  el('save-job-btn').textContent = 'Saving…';
  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId, jobDescription, link }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Saving the job failed');
    }
  } catch (err) {
    el('save-job-error').textContent = err.message;
  } finally {
    el('save-job-btn').disabled = false;
    el('save-job-btn').textContent = 'Save job';
  }
});

const STATUS_OPTIONS = ['Submitted', 'Called', 'Interviewed', 'Job Offer', 'Rejected'];

async function loadJobsForSelectedPerson() {
  const personId = el('jobs-person-select').value;
  if (!personId) {
    el('jobs-table-body').innerHTML = '';
    return;
  }
  const res = await fetch(`/api/jobs?personId=${encodeURIComponent(personId)}`);
  const jobs = await res.json();
  renderJobsTable(jobs);
}

function renderJobsTable(jobs) {
  const tbody = el('jobs-table-body');
  tbody.innerHTML = '';
  for (const job of jobs) {
    tbody.appendChild(buildJobRow(job));
  }
}

function buildJobRow(job) {
  const tr = document.createElement('tr');

  const textCell = (field, value) => {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.addEventListener('change', () => updateJobField(job.id, field, input.value));
    td.appendChild(input);
    return td;
  };

  tr.appendChild(textCell('dateApplied', job.dateApplied));
  tr.appendChild(textCell('jobTitle', job.jobTitle));
  tr.appendChild(textCell('briefDesc', job.briefDesc));
  tr.appendChild(textCell('company', job.company));
  tr.appendChild(textCell('salary', job.salary));

  const statusTd = document.createElement('td');
  const statusSelect = document.createElement('select');
  for (const opt of STATUS_OPTIONS) {
    const optionEl = document.createElement('option');
    optionEl.value = opt;
    optionEl.textContent = opt;
    if (opt === job.status) optionEl.selected = true;
    statusSelect.appendChild(optionEl);
  }
  statusSelect.addEventListener('change', () => updateJobField(job.id, 'status', statusSelect.value));
  statusTd.appendChild(statusSelect);
  tr.appendChild(statusTd);

  tr.appendChild(textCell('link', job.link));

  const deleteTd = document.createElement('td');
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '×';
  deleteBtn.className = 'danger';
  deleteBtn.addEventListener('click', async () => {
    await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
    tr.remove();
  });
  deleteTd.appendChild(deleteBtn);
  tr.appendChild(deleteTd);

  return tr;
}

async function updateJobField(id, field, value) {
  await fetch(`/api/jobs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [field]: value }),
  });
}

el('jobs-person-select').addEventListener('change', loadJobsForSelectedPerson);

loadPeople();
