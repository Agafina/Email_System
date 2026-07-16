// State management
let currentApiBase = localStorage.getItem('apiBaseUrl') || 'http://localhost:4000';
let currentApiKey = localStorage.getItem('apiKey') || 'my-secret-api-key';
let parsedCsvData = null; // Stores parsed headers and rows from client-side CSV preview

// Element Selectors
const connectionStatusEl = document.getElementById('connectionStatus');
const smtpStatusEl = document.getElementById('smtpStatus');
const toggleSettingsBtn = document.getElementById('toggleSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsDrawer = document.getElementById('settingsDrawer');
const settingsApiBaseInput = document.getElementById('settingsApiBase');
const settingsApiKeyInput = document.getElementById('settingsApiKey');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const diagnosticLogsEl = document.getElementById('diagnosticLogs');

const previewToggleBtn = document.getElementById('previewToggleBtn');
const previewModal = document.getElementById('previewModal');
const closePreviewBtn = document.getElementById('closePreviewBtn');
const previewFromEl = document.getElementById('previewFrom');
const previewToEl = document.getElementById('previewTo');
const previewSubjectEl = document.getElementById('previewSubject');
const previewBodyEl = document.getElementById('previewBody');

const emailForm = document.getElementById('emailForm');
const subjectInput = document.getElementById('subject');
const messageTextarea = document.getElementById('message');
const tagsCloudEl = document.getElementById('tagsCloud');
const sendBtn = document.getElementById('sendBtn');

const dropzone = document.getElementById('dropzone');
const csvFileInput = document.getElementById('csvFile');
const fileDetailsEl = document.getElementById('fileDetails');
const fileNameEl = document.getElementById('fileName');
const fileSizeEl = document.getElementById('fileSize');
const fileRowsEl = document.getElementById('fileRows');
const removeFileBtn = document.getElementById('removeFileBtn');
const manualRecipientsTextarea = document.getElementById('recipients');

const batchStateBadge = document.getElementById('batchStateBadge');
const statTotalEl = document.getElementById('statTotal');
const statSentEl = document.getElementById('statSent');
const statFailedEl = document.getElementById('statFailed');
const statRateEl = document.getElementById('statRate');
const progressBarFill = document.getElementById('progressBarFill');
const consoleLogsEl = document.getElementById('consoleLogs');
const clearLogsBtn = document.getElementById('clearLogsBtn');

// Initialize settings inputs
settingsApiBaseInput.value = currentApiBase;
settingsApiKeyInput.value = currentApiKey;

// ----------------------------------------------------
// Drawer and Modal Management
// ----------------------------------------------------
toggleSettingsBtn.addEventListener('click', () => settingsDrawer.classList.add('active'));
closeSettingsBtn.addEventListener('click', () => settingsDrawer.classList.remove('active'));

previewToggleBtn.addEventListener('click', () => {
    updatePreview();
    previewModal.classList.add('active');
});
closePreviewBtn.addEventListener('click', () => previewModal.classList.remove('active'));

// Close overlays if clicking background
document.querySelectorAll('.drawer-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
    });
});

// ----------------------------------------------------
// Connection & Diagnostic Logic
// ----------------------------------------------------
async function verifyServerConnection() {
    updateStatusBadge(connectionStatusEl, 'checking', 'Connecting to API...');
    updateStatusBadge(smtpStatusEl, 'checking', 'Checking Mailer...');
    
    const logs = [`[Diagnostic started at ${new Date().toLocaleTimeString()}]`];
    logs.push(`Connecting to ${currentApiBase}/config/status...`);
    
    try {
        const response = await fetch(`${currentApiBase}/config/status`, {
            method: 'GET',
            headers: {
                'x-api-key': currentApiKey,
                'Accept': 'application/json'
            }
        });
        
        logs.push(`HTTP Response Status: ${response.status}`);
        
        if (response.status === 401) {
            logs.push(`Error: Unauthorized. Check if your API secret key matches the backend.`);
            updateStatusBadge(connectionStatusEl, 'disconnected', 'API Keys Mismatch');
            updateStatusBadge(smtpStatusEl, 'disconnected', 'Unauthorized access');
            diagnosticLogsEl.textContent = logs.join('\n');
            return false;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP Error ${response.status}`);
        }
        
        const data = await response.json();
        logs.push(`Response Data: ${JSON.stringify(data, null, 2)}`);
        
        updateStatusBadge(connectionStatusEl, 'connected', 'API Connected');
        
        // SMTP verification details
        const smtp = data.smtp || {};
        if (smtp.mode === 'configured') {
            updateStatusBadge(smtpStatusEl, 'connected', `SMTP: ${smtp.user}`);
            logs.push(`SMTP status verified: Production mode (User: ${smtp.user})`);
        } else if (smtp.mode === 'ethereal') {
            updateStatusBadge(smtpStatusEl, 'ethereal', 'Ethereal Test Mailer');
            logs.push(`SMTP status: Ethereal developer fallback active (User: ${smtp.user})`);
        } else {
            updateStatusBadge(smtpStatusEl, 'disconnected', 'Mailer Failed');
            logs.push(`SMTP state: verification failed! Error: ${smtp.error || 'Unknown error'}`);
        }
        
        diagnosticLogsEl.textContent = logs.join('\n');
        return true;
        
    } catch (error) {
        logs.push(`Network Error: ${error.message}`);
        logs.push(`Verify the backend server is running and CORS allows origins.`);
        updateStatusBadge(connectionStatusEl, 'disconnected', 'Server Offline');
        updateStatusBadge(smtpStatusEl, 'disconnected', 'Connection Error');
        diagnosticLogsEl.textContent = logs.join('\n');
        return false;
    }
}

function updateStatusBadge(badgeEl, state, label) {
    badgeEl.className = 'status-badge'; // reset
    if (state === 'checking') {
        badgeEl.classList.add('status-checking');
    } else if (state === 'connected') {
        badgeEl.classList.add('status-connected');
    } else if (state === 'ethereal') {
        badgeEl.classList.add('status-ethereal');
    } else {
        badgeEl.classList.add('status-disconnected');
    }
    badgeEl.querySelector('.status-label').textContent = label;
}

saveSettingsBtn.addEventListener('click', async () => {
    currentApiBase = settingsApiBaseInput.value.trim();
    currentApiKey = settingsApiKeyInput.value.trim();
    
    localStorage.setItem('apiBaseUrl', currentApiBase);
    localStorage.setItem('apiKey', currentApiKey);
    
    saveSettingsBtn.disabled = true;
    saveSettingsBtn.textContent = 'Verifying...';
    
    await verifyServerConnection();
    
    saveSettingsBtn.disabled = false;
    saveSettingsBtn.textContent = 'Save & Test Connection';
});

// Run connection diagnostic on load
verifyServerConnection();

// ----------------------------------------------------
// CSV Dropzone & Client-side Parsing
// ----------------------------------------------------
function parseCSVClientSide(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    
    // Parse header keys, cleaning quotes and BOM
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '').replace(/^\uFEFF/, ''));
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
        // Handle basic comma separation (without full escaped quotes support for simplicity)
        const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        if (values.length >= headers.length) {
            const row = {};
            headers.forEach((header, idx) => {
                row[header] = values[idx] || '';
            });
            rows.push(row);
        }
    }
    return { headers, rows };
}

function handleCsvFileSelect(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
        alert('File size exceeds the 2MB cap.');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const parsed = parseCSVClientSide(text);
        if (!parsed || parsed.rows.length === 0) {
            alert('Could not parse any recipient rows from CSV. Check structure.');
            return;
        }
        
        parsedCsvData = parsed;
        
        // Show file details UI
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB`;
        fileRowsEl.textContent = `${parsed.rows.length} recipients parsed`;
        fileDetailsEl.classList.add('active');
        dropzone.querySelector('.upload-prompt').style.display = 'none';
        
        // Update merge tags
        updateMergeTagsCloud(parsed.headers);
    };
    reader.readAsText(file);
}

function updateMergeTagsCloud(headers) {
    // Keep the email tag default
    tagsCloudEl.innerHTML = '';
    
    headers.forEach(header => {
        const tag = document.createElement('span');
        tag.className = 'merge-tag';
        tag.setAttribute('data-tag', header);
        tag.textContent = `{{${header}}}`;
        tagsCloudEl.appendChild(tag);
    });
}

function removeCSVFile() {
    parsedCsvData = null;
    csvFileInput.value = '';
    fileDetailsEl.classList.remove('active');
    dropzone.querySelector('.upload-prompt').style.display = 'block';
    
    // Reset tags cloud to default
    tagsCloudEl.innerHTML = '<span class="merge-tag default-tag" data-tag="email">{{email}}</span>';
}

// Dropzone Event Listeners
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
        csvFileInput.files = e.dataTransfer.files;
        handleCsvFileSelect(e.dataTransfer.files[0]);
    }
});

csvFileInput.addEventListener('change', () => {
    if (csvFileInput.files.length) {
        handleCsvFileSelect(csvFileInput.files[0]);
    }
});

removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeCSVFile();
});

// Click merge tag to insert into composer
tagsCloudEl.addEventListener('click', (e) => {
    const tagSpan = e.target.closest('.merge-tag');
    if (!tagSpan) return;
    
    const tagValue = `{{${tagSpan.getAttribute('data-tag')}}}`;
    
    // Insert into subject or body based on focus. Fallback to message textarea
    const activeEl = document.activeElement;
    const target = (activeEl === subjectInput || activeEl === messageTextarea) ? activeEl : messageTextarea;
    
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const text = target.value;
    
    target.value = text.slice(0, start) + tagValue + text.slice(end);
    target.focus();
    // Move cursor after the inserted tag
    target.selectionStart = target.selectionEnd = start + tagValue.length;
});

// ----------------------------------------------------
// Template Live Preview logic
// ----------------------------------------------------
function applyClientTemplate(template, data) {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
        return data[key] !== undefined ? data[key] : match;
    });
}

function updatePreview() {
    const subjectRaw = subjectInput.value.trim() || 'No Subject';
    const messageRaw = messageTextarea.value.trim() || 'No Message';
    
    // Pick the first recipient or a fallback mock
    const recipientData = (parsedCsvData && parsedCsvData.rows.length > 0) 
        ? parsedCsvData.rows[0] 
        : { email: 'sample-recipient@company.com', name: 'John Doe', company: 'Antigravity Inc' };
        
    const fromAddress = smtpStatusEl.querySelector('.status-label').textContent.includes('SMTP:') 
        ? smtpStatusEl.querySelector('.status-label').textContent.replace('SMTP: ', '') 
        : 'sender-verification-skipped@gmail.com';
        
    previewFromEl.textContent = fromAddress;
    previewToEl.textContent = recipientData.email || 'sample-recipient@company.com';
    previewSubjectEl.textContent = applyClientTemplate(subjectRaw, recipientData);
    previewBodyEl.textContent = applyClientTemplate(messageRaw, recipientData);
}

// ----------------------------------------------------
// Batch Campaign Trigger & Status Polling
// ----------------------------------------------------
function appendConsoleLog(message, type = 'line') {
    const line = document.createElement('div');
    line.className = `console-line ${type}-line`;
    const timestamp = new Date().toLocaleTimeString();
    line.innerHTML = `[${timestamp}] ${message}`;
    consoleLogsEl.appendChild(line);
    consoleLogsEl.scrollTop = consoleLogsEl.scrollHeight;
}

clearLogsBtn.addEventListener('click', () => {
    consoleLogsEl.innerHTML = '';
});

function parseManualRecipients(text) {
    return text.split(',').map(e => e.trim()).filter(Boolean);
}

// Polling interval state
let pollIntervalId = null;

async function startBatchPolling(jobId) {
    if (pollIntervalId) clearInterval(pollIntervalId);
    
    const knownLogCount = 0;
    const loggedIndexes = new Set();
    
    pollIntervalId = setInterval(async () => {
        try {
            const res = await fetch(`${currentApiBase}/send-emails/status/${jobId}`, {
                headers: { 'x-api-key': currentApiKey }
            });
            
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to poll job status.');
            }
            
            const job = await res.json();
            
            // Update Stats counters
            statTotalEl.textContent = job.total;
            statSentEl.textContent = job.sent;
            statFailedEl.textContent = job.failed;
            
            const rate = job.total > 0 ? Math.round(((job.sent + job.failed) / job.total) * 100) : 0;
            statRateEl.textContent = `${rate}%`;
            progressBarFill.style.width = `${rate}%`;
            
            // Print new logs
            const logsList = job.logs || [];
            logsList.forEach((logItem, index) => {
                if (loggedIndexes.has(index)) return;
                loggedIndexes.add(index);
                
                if (logItem.status === 'success') {
                    let logStr = `Successfully sent to <strong>${logItem.to}</strong>.`;
                    if (logItem.previewUrl) {
                        logStr += ` <a href="${logItem.previewUrl}" target="_blank">View Ethereal Preview</a>`;
                    }
                    appendConsoleLog(logStr, 'success');
                } else {
                    appendConsoleLog(`Failed for <strong>${logItem.to}</strong>: ${logItem.error || 'Unknown error'}`, 'error');
                }
            });
            
            if (job.done) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
                
                const finalSuccess = job.sent === job.total;
                batchStateBadge.textContent = 'Completed';
                batchStateBadge.className = 'badge done';
                
                appendConsoleLog(`Campaign Batch finished! ${job.sent} sent, ${job.failed} failed.`, finalSuccess ? 'success' : 'error');
                setFormDisabledState(false);
            }
            
        } catch (error) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
            appendConsoleLog(`Polling error: ${error.message}`, 'error');
            batchStateBadge.textContent = 'Error';
            batchStateBadge.className = 'badge error';
            setFormDisabledState(false);
        }
    }, 1500);
}

function setFormDisabledState(disabled) {
    sendBtn.disabled = disabled;
    sendBtn.querySelector('span').textContent = disabled ? 'Campaign Running...' : 'Launch Campaign';
    subjectInput.disabled = disabled;
    messageTextarea.disabled = disabled;
    csvFileInput.disabled = disabled;
    manualRecipientsTextarea.disabled = disabled;
    removeFileBtn.disabled = disabled;
}

emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Stop any existing poll
    if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
    }
    
    const subject = subjectInput.value.trim();
    const message = messageTextarea.value.trim();
    const manualText = manualRecipientsTextarea.value.trim();
    const manualRecips = parseManualRecipients(manualText);
    const csvFile = csvFileInput.files[0];
    
    if (!subject || !message) {
        alert('Subject and Message body are required.');
        return;
    }
    
    if (manualRecips.length === 0 && !csvFile) {
        alert('Please specify target recipients: upload a CSV file or enter manual addresses.');
        return;
    }
    
    // Prepare data upload
    const data = new FormData();
    data.append('subject', subject);
    data.append('message', message);
    if (manualRecips.length > 0) {
        data.append('recipients', JSON.stringify(manualRecips));
    }
    if (csvFile) {
        data.append('csvFile', csvFile);
    }
    
    // Initialize UI progress card
    progressBarFill.style.width = '0%';
    statTotalEl.textContent = '0';
    statSentEl.textContent = '0';
    statFailedEl.textContent = '0';
    statRateEl.textContent = '0%';
    batchStateBadge.textContent = 'Initializing';
    batchStateBadge.className = 'badge sending';
    
    appendConsoleLog('----------------------------------------------------', 'system');
    appendConsoleLog('Launching new batch email campaign...', 'system');
    
    setFormDisabledState(true);
    
    // Smooth scroll down to progress card
    document.getElementById('progressCard').scrollIntoView({ behavior: 'smooth' });
    
    try {
        const response = await fetch(`${currentApiBase}/send-emails`, {
            method: 'POST',
            headers: {
                'x-api-key': currentApiKey
            },
            body: data
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `Server returned code ${response.status}`);
        }
        
        const result = await response.json();
        appendConsoleLog(`Campaign accepted by backend. Job ID: <code>${result.jobId}</code>. Total recipients: ${result.total}.`, 'system');
        
        // Start polling status
        batchStateBadge.textContent = 'Sending';
        startBatchPolling(result.jobId);
        
    } catch (error) {
        appendConsoleLog(`Launch failed: ${error.message}`, 'error');
        batchStateBadge.textContent = 'Failed';
        batchStateBadge.className = 'badge error';
        setFormDisabledState(false);
    }
});