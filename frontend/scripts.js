const form = document.getElementById('emailForm');
const statusElement = document.getElementById('status');

// Set this to your deployed API URL, or read from a build-time env if you have a bundler
const API_BASE = window.API_BASE_URL || 'http://localhost:4000';
const API_KEY = window.API_KEY || ''; // inject this securely at build/deploy time — see note below

function parseRecipients(text) {
  return text.split(',').map(e => e.trim()).filter(Boolean);
}

function showStatus(message, status) {
  statusElement.textContent = message;
  statusElement.style.color = status === 'error' ? '#d00000' : status === 'success' ? '#008000' : '#333';
}

async function pollStatus(jobId) {
  while (true) {
    const res = await fetch(`${API_BASE}/send-emails/status/${jobId}`, {
      headers: { 'x-api-key': API_KEY }
    });
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || 'Failed to fetch status.');

    showStatus(`Sent ${job.sent}/${job.total} (${job.failed} failed)...`, 'info');

    if (job.done) {
      showStatus(`Done: ${job.sent}/${job.total} sent, ${job.failed} failed.`, job.failed ? 'error' : 'success');
      return;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const subject = document.getElementById('subject').value.trim();
  const message = document.getElementById('message').value.trim();
  const recipients = parseRecipients(document.getElementById('recipients').value);
  const csvFile = document.getElementById('csvFile').files[0];

  if (!subject || !message) return showStatus('Subject and message are required.', 'error');
  if (recipients.length === 0 && !csvFile) return showStatus('Add at least one recipient or a CSV file.', 'error');

  const data = new FormData();
  data.append('subject', subject);
  data.append('message', message);
  if (recipients.length > 0) data.append('recipients', JSON.stringify(recipients));
  if (csvFile) data.append('csvFile', csvFile);

  showStatus('Starting batch...', 'info');
  form.querySelector('button').disabled = true;

  try {
    const res = await fetch(`${API_BASE}/send-emails`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: data
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to start batch.');

    await pollStatus(result.jobId);
  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    form.querySelector('button').disabled = false;
  }
});