const fs = require('fs');
const path = require('path');
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const upload = require('multer')({
    dest: path.join(__dirname, '../uploads/'),
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
const nodemailer = require('nodemailer');

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

// Get SMTP status and limits
router.get('/config/status', requireApiKey, (req, res) => {
    const mailStatus = transporter.getStatus();
    res.json({
        success: true,
        smtp: {
            mode: mailStatus.mode,
            user: mailStatus.user,
            error: mailStatus.error
        },
        limits: {
            maxRecipients: MAX_RECIPIENTS
        }
    });
});

// Kick off a batch job, return immediately with a job ID
router.post('/send-emails', requireApiKey, sendLimiter, upload.single('csvFile'), async (req, res) => {
    const { subject, message } = req.body;

    let parsedRecipients;
    try {
        parsedRecipients = JSON.parse(req.body.recipients || '[]');
    } catch (e) {
        if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ success: false, error: 'Recipients must be valid JSON (an array of emails).' });
    }
    if (!Array.isArray(parsedRecipients)) {
        if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ success: false, error: 'Recipients must be a JSON array of emails.' });
    }

    let manualRecipients = parsedRecipients.map(item => {
        if (typeof item === 'string') {
            return { email: item };
        } else if (item && typeof item === 'object' && item.email) {
            return item;
        }
        return null;
    }).filter(Boolean);
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

    const mailStatus = transporter.getStatus();
    if (mailStatus.mode === 'failed') {
        return res.status(500).json({
            success: false,
            error: mailStatus.error || 'SMTP is not configured correctly. Fix your SMTP credentials before sending emails.'
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
    const logs = [];

    for (const recipient of recipients) {
        const to = recipient.email;
        let previewUrl = null;
        try {
            const mailStatus = transporter.getStatus();
            const fromAddress = mailStatus.mode === 'ethereal' ? mailStatus.user : (process.env.SMTP_USER || 'no-reply@example.com');
            
            const info = await transporter.sendMail({
                from: fromAddress,
                to,
                subject: applyTemplate(subject, recipient),
                text: applyTemplate(message, recipient)
            });
            sent++;
            if (mailStatus.mode === 'ethereal') {
                previewUrl = nodemailer.getTestMessageUrl(info) || null;
            }
            logs.push({ to, status: 'success', previewUrl, messageId: info.messageId });
        } catch (error) {
            failed++;
            errors.push({ to, error: error.message });
            logs.push({ to, status: 'failed', error: error.message });
            console.error(`Failed to send email to ${to}:`, error.message);
        }
        updateJob(jobId, { sent, failed, errors, logs });
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

// Simple test endpoint to verify SMTP/send behavior
router.post('/send-emails/test', requireApiKey, async (req, res) => {
    const to = (req.body && req.body.to) || req.query.to;
    if (!to) return res.status(400).json({ success: false, error: 'Missing `to` address.' });

    try {
        let usedTestAccount = false;
        let sendTransport = transporter;

        if (process.env.SKIP_SMTP_VERIFY === 'true') {
            // Use Ethereal test account for preview when skipping SMTP verification
            const testAccount = await nodemailer.createTestAccount();
            sendTransport = nodemailer.createTransport({
                host: testAccount.smtp.host,
                port: testAccount.smtp.port,
                secure: testAccount.smtp.secure,
                auth: { user: testAccount.user, pass: testAccount.pass }
            });
            usedTestAccount = true;
        }

        const mailStatus = transporter.getStatus();
        if (mailStatus.mode === 'failed' && process.env.ALLOW_ETHEREAL_FALLBACK !== 'true' && process.env.SKIP_SMTP_VERIFY !== 'true') {
            return res.status(500).json({
                success: false,
                error: mailStatus.error || 'SMTP is not configured correctly. Fix your SMTP credentials before sending emails.'
            });
        }
        const fromAddress = (usedTestAccount || mailStatus.mode === 'ethereal') ? (usedTestAccount ? sendTransport.options.auth.user : mailStatus.user) : (process.env.SMTP_USER || 'no-reply@example.com');

        const info = await sendTransport.sendMail({
            from: fromAddress,
            to,
            subject: 'Test email from Email System',
            text: 'This is a test email to verify sending works.'
        });

        const result = { success: true, messageId: info.messageId };
        if (usedTestAccount || mailStatus.mode === 'ethereal') {
            result.previewUrl = nodemailer.getTestMessageUrl(info) || null;
        }
        res.json(result);
    } catch (err) {
        console.error('Test send failed:', err && err.message ? err.message : err);
        res.status(500).json({ success: false, error: err.message || 'Failed to send test email.' });
    }
});

module.exports = router;