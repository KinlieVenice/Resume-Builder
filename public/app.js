'use strict';

marked.setOptions({ breaks: true });

const state = {
  people: [],
  selectedPersonId: null,
};

const el = (id) => document.getElementById(id);

let pendingOperations = 0;

function withLoading(message, action) {
  return async (...args) => {
    const dialog = el('loading-dialog');
    if (pendingOperations++ === 0) {
      el('operation-error').textContent = '';
      el('loading-message').textContent = message;
      dialog.showModal();
      document.body.classList.add('is-loading');
    }
    try {
      return await action(...args);
    } catch (error) {
      el('operation-error').textContent = error.message || 'Something went wrong. Please try again.';
    } finally {
      if (--pendingOperations === 0) {
        dialog.close();
        document.body.classList.remove('is-loading');
      }
    }
  };
}

el('loading-dialog').addEventListener('cancel', (event) => event.preventDefault());

async function showAlert(options) {
  const dialog = el('loading-dialog');
  // Native modal dialogs sit above SweetAlert; suspend the loader for the prompt.
  if (dialog.open) dialog.close();
  try {
    return await Swal.fire({
      background: '#fffef9',
      color: '#252b25',
      confirmButtonColor: '#b74726',
      cancelButtonColor: '#536347',
      ...options,
    });
  } finally {
    if (pendingOperations > 0) dialog.showModal();
  }
}


function showTab(tab) {
  el('tab-people').classList.toggle('active', tab === 'people');
  el('tab-tailor').classList.toggle('active', tab === 'tailor');
  el('tab-jobs').classList.toggle('active', tab === 'jobs');
  for (const name of ['people', 'tailor', 'jobs']) {
    el(`tab-${name}`).setAttribute('aria-pressed', String(tab === name));
  }
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
  return withLoading('Loading profiles…', async () => {
  const res = await fetch('/api/people');
  state.people = await res.json();
  renderPeopleList();
  renderPersonSelect();
  })();
}

function renderPeopleList() {
  const ul = el('people-list');
  ul.innerHTML = '';
  for (const person of state.people) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'person-button';
    button.textContent = person.name;
    button.setAttribute('aria-pressed', String(person.id === state.selectedPersonId));
    button.addEventListener('click', () => selectPerson(person.id));
    li.appendChild(button);
    li.dataset.id = person.id;
    if (person.id === state.selectedPersonId) li.classList.add('selected');
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
  return withLoading('Loading your profile…', async () => {
  state.selectedPersonId = id;
  renderPeopleList();
  const res = await fetch(`/api/cv/${id}`);
  const cv = await res.json();
  el('cv-editor-title').textContent = cv.name;
  el('cv-json').value = JSON.stringify(cv, null, 2);
  el('cv-error').textContent = '';
  })();
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

el('upload-pdf-input').addEventListener('change', withLoading('Extracting your resume…', async () => {
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
}));

el('save-cv-btn').addEventListener('click', withLoading('Saving your profile…', async () => {
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
  const res = await fetch(state.selectedPersonId ? `/api/cv/${state.selectedPersonId}` : '/api/people', {
    method: state.selectedPersonId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cv),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Saving the profile failed');
  }
  state.selectedPersonId = null;
  el('cv-json').value = '';
  el('cv-editor-title').textContent = 'New person';
  renderPeopleList();
  await loadPeople();
  await showAlert({ icon: 'success', titleText: 'Successfully saved' });
}));

el('delete-cv-btn').addEventListener('click', withLoading('Deleting your profile…', async () => {
  if (state.selectedPersonId) {
    await fetch(`/api/cv/${state.selectedPersonId}`, { method: 'DELETE' });
    state.selectedPersonId = null;
    await loadPeople();
  }
  el('cv-json').value = '';
  el('cv-editor-title').textContent = 'New person';
  el('cv-error').textContent = '';
}));

el('tailor-btn').addEventListener('click', withLoading('Tailoring your resume…', async () => {
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
    el('tailor-btn').textContent = 'Tailor my resume ↗';
  }
}));

el('print-btn').addEventListener('click', () => {
  const markdown = el('resume-markdown').value;
  el('print-view').innerHTML = marked.parse(markdown);
  window.print();
});

el('export-docx-btn').addEventListener('click', withLoading('Preparing your Word document…', async () => {
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
}));

el('save-job-btn').addEventListener('click', withLoading('Saving your opportunity…', async () => {
  const personId = el('person-select').value;
  const jobDescription = el('job-description').value.trim();
  const link = el('job-link').value.trim();
  el('save-job-error').textContent = '';
  el('save-job-status').textContent = '';

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
    el('save-job-status').textContent = body.alreadySaved
      ? `Already saved — ${body.jobTitle || 'this job'} (${body.status})`
      : `✅ Saved — ${body.jobTitle || 'job'}${body.company ? ' at ' + body.company : ''}`;
  } catch (err) {
    el('save-job-error').textContent = err.message;
  } finally {
    el('save-job-btn').disabled = false;
    el('save-job-btn').textContent = 'Save job';
  }
}));

const STATUS_OPTIONS = ['Submitted', 'Called', 'Interviewed', 'Job Offer', 'Rejected'];

async function loadJobsForSelectedPerson() {
  return withLoading('Loading opportunities…', async () => {
  const personId = el('jobs-person-select').value;
  if (!personId) {
    renderJobsTable([]);
    return;
  }
  const res = await fetch(`/api/jobs?personId=${encodeURIComponent(personId)}`);
  const jobs = await res.json();
  renderJobsTable(jobs);
  })();
}

function renderJobsTable(jobs) {
  const tbody = el('jobs-table-body');
  tbody.innerHTML = '';
  if (!jobs.length) {
    const cell = tbody.insertRow().insertCell();
    cell.colSpan = 8;
    cell.textContent = 'Your next opportunity belongs here. Tailor a resume and save the job to start tracking.';
    cell.style.padding = '48px 24px';
  }
  for (const job of jobs) {
    tbody.appendChild(buildJobRow(job));
  }
}

function buildJobRow(job) {
  const tr = document.createElement('tr');
  renderJobRowView(tr, job);
  return tr;
}

function viewCell(value) {
  const td = document.createElement('td');
  td.textContent = value || '';
  td.title = value || '';
  return td;
}

function renderJobRowView(tr, job) {
  tr.innerHTML = '';

  tr.appendChild(viewCell(job.dateApplied));
  tr.appendChild(viewCell(job.jobTitle));
  tr.appendChild(viewCell(job.briefDesc));
  tr.appendChild(viewCell(job.company));
  tr.appendChild(viewCell(job.salary));
  tr.appendChild(viewCell(job.status));

  const linkTd = document.createElement('td');
  if (job.link) {
    const a = document.createElement('a');
    a.href = job.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = job.link;
    a.title = job.link;
    linkTd.appendChild(a);
  }
  tr.appendChild(linkTd);

  const actionsTd = document.createElement('td');
  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => renderJobRowEdit(tr, job));
  actionsTd.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '×';
  deleteBtn.setAttribute('aria-label', 'Delete job');
  deleteBtn.className = 'danger';
  deleteBtn.addEventListener('click', withLoading('Deleting the opportunity…', async () => {
    if (!(await showAlert({ icon: 'warning', titleText: 'Delete this job?', text: `${job.jobTitle || 'This job'} will be permanently deleted.`, showCancelButton: true, confirmButtonText: 'Delete job', focusCancel: true })).isConfirmed) {
      return;
    }
    await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
    tr.remove();
  }));
  actionsTd.appendChild(deleteBtn);
  tr.appendChild(actionsTd);
}

function renderJobRowEdit(tr, job) {
  tr.innerHTML = '';
  const draft = { ...job };

  const textCell = (field) => {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', field);
    input.value = draft[field] || '';
    input.addEventListener('input', () => { draft[field] = input.value; });
    td.appendChild(input);
    return td;
  };

  tr.appendChild(textCell('dateApplied'));
  tr.appendChild(textCell('jobTitle'));
  tr.appendChild(textCell('briefDesc'));
  tr.appendChild(textCell('company'));
  tr.appendChild(textCell('salary'));

  const statusTd = document.createElement('td');
  const statusSelect = document.createElement('select');
  statusSelect.setAttribute('aria-label', 'Application status');
  for (const opt of STATUS_OPTIONS) {
    const optionEl = document.createElement('option');
    optionEl.value = opt;
    optionEl.textContent = opt;
    if (opt === draft.status) optionEl.selected = true;
    statusSelect.appendChild(optionEl);
  }
  statusSelect.addEventListener('change', () => { draft.status = statusSelect.value; });
  statusTd.appendChild(statusSelect);
  tr.appendChild(statusTd);

  tr.appendChild(textCell('link'));

  const actionsTd = document.createElement('td');
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', withLoading('Saving your changes…', async () => {
    if (!(await showAlert({ icon: 'question', titleText: 'Save changes to this job?', showCancelButton: true, confirmButtonText: 'Save changes' })).isConfirmed) {
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const updated = await res.json();
    Object.assign(job, updated);
    renderJobRowView(tr, job);
  }));
  actionsTd.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', async () => {
    if (!(await showAlert({ icon: 'warning', titleText: 'Discard these changes?', text: 'Your unsaved edits will be lost.', showCancelButton: true, confirmButtonText: 'Discard changes', cancelButtonText: 'Keep editing', focusCancel: true })).isConfirmed) {
      return;
    }
    renderJobRowView(tr, job);
  });
  actionsTd.appendChild(cancelBtn);

  tr.appendChild(actionsTd);
}

el('jobs-person-select').addEventListener('change', loadJobsForSelectedPerson);

loadPeople();
