const fs = require('fs');
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const upload = require('multer')({
    dest: 'uploads/',
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB cap
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
            return cb(new Error('Only CSV files are allowed.'));
        }
        cb(null, true);
    }
});
const transporter = require('../mailer');
const parseCsv = require('../utils/parseCsv');
const requireApiKey = require('../middleware/auth');
const { createJob, updateJob, getJob, scheduleCleanup } = require('../utils/jobStore');
const { applyTemplate } = require('../utils/mailMerge');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const sendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // 5 batch requests per 15 min per IP
    message: { success: false, error: 'Too many batch requests, try again later.' }
});

const MAX_RECIPIENTS = Number(process.env.MAX_RECIPIENTS) || 500;

// Kick off a batch job, return immediately with a job ID
router.post('/send-emails', requireApiKey, sendLimiter, upload.single('csvFile'), async (req, res) => {
    const { subject, message } = req.body;
    let manualRecipients = JSON.parse(req.body.recipients || '[]').map(email => ({ email }));
    let rows = manualRecipients;

    try {
        if (req.file) {
            const parsedRows = await parseCsv(req.file.path);
            rows = rows.concat(parsedRows);
        }
    } finally {
        if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
    }

    // Dedupe by email, validate
    const seen = new Set();
    const recipients = rows.filter(r => {
        const email = (r.email || '').trim();
        if (!isValidEmail(email) || seen.has(email)) return false;
        seen.add(email);
        return true;
    });

    if (!subject || !message) {
        return res.status(400).json({ success: false, error: 'Subject and message are required.' });
    }
    if (recipients.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid recipients were provided.' });
    }
    if (recipients.length > MAX_RECIPIENTS) {
        return res.status(400).json({
            success: false,
            error: `Too many recipients (${recipients.length}). Max is ${MAX_RECIPIENTS} per batch.`
        });
    }

    const jobId = createJob(recipients.length);
    res.json({ success: true, jobId, total: recipients.length });

    // Fire-and-forget: process in the background, client polls /send-emails/status/:jobId
    processQueue(jobId, recipients, subject, message);
});

async function processQueue(jobId, recipients, subject, message) {
    let sent = 0, failed = 0;
    const errors = [];

    for (const recipient of recipients) {
        const to = recipient.email;
        try {
            await transporter.sendMail({
                from: process.env.SMTP_USER,
                to,
                subject: applyTemplate(subject, recipient),
                text: applyTemplate(message, recipient)
            });
            sent++;
        } catch (error) {
            failed++;
            errors.push({ to, error: error.message });
            console.error(`Failed to send email to ${to}:`, error.message);
        }
        updateJob(jobId, { sent, failed, errors });
        await delay(1000); // stay under most SMTP rate limits
    }

    updateJob(jobId, { done: true });
    scheduleCleanup(jobId);
}

// Poll this for progress
router.get('/send-emails/status/:jobId', requireApiKey, (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });
    res.json({ success: true, ...job });
});

module.exports = router;