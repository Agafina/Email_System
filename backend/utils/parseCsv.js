const fs = require('fs');
const csv = require('csv-parser');

function parseCsv(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                    // Normalize keys (trim) and values
                    const normalized = {};
                    Object.keys(row).forEach(k => {
                        const key = k && String(k).trim().replace(/^\uFEFF/, '');
                        const val = row[k];
                        normalized[key] = typeof val === 'string' ? val.trim() : val;
                    });

                    const emailKey = Object.keys(normalized).find(k => k && k.toLowerCase() === 'email') || Object.keys(normalized)[0];
                    const email = emailKey ? normalized[emailKey] : undefined;
                    if (email && String(email).trim()) {
                        rows.push(Object.assign({ email: String(email).trim() }, normalized)); // keeps name, company, etc.
                    }
                })
            .on('end', () => resolve(rows))
            .on('error', (error) => reject(error));
    });
}
module.exports = parseCsv;