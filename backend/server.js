const path = require('path');
const dotenv = require('dotenv');
// Load .env from project root first, then fall back to backend/.env (useful during local dev)
dotenv.config();
dotenv.config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const transporter = require('./mailer');

function validateEnv() {
    const required = ['API_KEY'];
    // SMTP vars are required unless SKIP_SMTP_VERIFY is set for local testing
    if (process.env.SKIP_SMTP_VERIFY !== 'true') {
        required.push('SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS');
    }
    const missing = required.filter(k => !process.env[k]);
    if (missing.length) {
        console.error('Missing required environment variables:', missing.join(', '));
        process.exit(1);
    }
}

const app = express();
app.use(helmet());

// CORS configuration
// - If ALLOWED_ORIGIN is set to a comma-separated list, only those origins are allowed.
// - If ALLOWED_ORIGIN is unset or set to '*', all origins are allowed (dev-friendly, reflects request origin
//   so it still works correctly even when credentials are involved).
const allowedOriginsEnv = process.env.ALLOWED_ORIGIN || '*';

let corsOptions;
if (allowedOriginsEnv === '*') {
    corsOptions = {
        origin: (origin, callback) => callback(null, true), // reflect any origin
        credentials: true
    };
} else {
    const allowedOrigins = allowedOriginsEnv.split(',').map(o => o.trim()).filter(Boolean);
    corsOptions = {
        origin: (origin, callback) => {
            // allow requests with no origin (curl, Postman, server-to-server)
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error(`Origin ${origin} not allowed by CORS`));
        },
        credentials: true
    };
}

app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/', require('./router/sendRoutes'));

// Generic JSON error handler (catches multer and other errors)
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err && err.stack ? err.stack : err);
    const status = err.statusCode || err.status || (err.name === 'MulterError' ? 400 : 500);
    const message = err.message || 'Internal Server Error';
    res.status(status).json({ success: false, error: message });
});

validateEnv();

const PORT = process.env.PORT || 4000;

// Start server; optionally verify SMTP transporter unless skipped for dev
if (process.env.SKIP_SMTP_VERIFY === 'true') {
    console.warn('SKIP_SMTP_VERIFY=true; skipping SMTP verification.');
    const isPlaceholder = !process.env.SMTP_USER ||
                        process.env.SMTP_USER === 'fowedlungatsafac@gmail.com' ||
                        process.env.SMTP_PASS === 'your_new_app_password';
    if (isPlaceholder) {
        transporter.useEtherealFallback(new Error('SMTP verification skipped & placeholders detected.')).then(() => {
            app.listen(PORT, () => console.log(`Server is running on port ${PORT} (Ethereal test mode active)`));
        });
    } else {
        app.listen(PORT, () => console.log(`Server is running on port ${PORT} (smtp verification skipped)`));
    }
} else {
    transporter.verify(async (err) => {
        if (err) {
            console.error('SMTP transporter verification failed:', err && err.message ? err.message : err);
            const success = await transporter.useEtherealFallback(err);
            if (!success) {
                console.error('Could not set up Ethereal fallback. Exiting.');
                process.exit(1);
            }
        } else {
            console.log('SMTP transporter verified successfully (Production mode).');
        }

        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    });
}