require('dotenv').config();
const nodemailer = require('nodemailer');

let activeTransporter = null;
let mailerStatus = {
    mode: 'uninitialized', // 'configured', 'ethereal', or 'failed'
    user: '',
    error: null
};

function getTransporter() {
    if (!activeTransporter) {
        activeTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
        mailerStatus.mode = 'configured';
        mailerStatus.user = process.env.SMTP_USER || '';
    }
    return activeTransporter;
}

async function useEtherealFallback(err) {
    try {
        console.warn('Initializing Ethereal test account fallback due to SMTP error:', err ? err.message : 'Unknown');
        const testAccount = await nodemailer.createTestAccount();
        activeTransporter = nodemailer.createTransport({
            host: testAccount.smtp.host,
            port: testAccount.smtp.port,
            secure: testAccount.smtp.secure,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass
            }
        });
        mailerStatus.mode = 'ethereal';
        mailerStatus.user = testAccount.user;
        mailerStatus.error = err ? err.message : null;
        console.log('----------------------------------------------------');
        console.log('Ethereal fallback initialized successfully!');
        console.log(`Ethereal User: ${testAccount.user}`);
        console.log(`Ethereal Pass: ${testAccount.pass}`);
        console.log('----------------------------------------------------');
        return true;
    } catch (e) {
        console.error('Failed to create Ethereal test account:', e.message);
        mailerStatus.mode = 'failed';
        mailerStatus.error = e.message;
        return false;
    }
}

module.exports = {
    getTransporter,
    useEtherealFallback,
    getStatus: () => ({ ...mailerStatus }),
    verify: (cb) => {
        const t = getTransporter();
        t.verify((err) => {
            if (err) {
                cb(err);
            } else {
                mailerStatus.mode = 'configured';
                cb(null);
            }
        });
    },
    sendMail: (options) => {
        const t = getTransporter();
        return t.sendMail(options);
    }
};
