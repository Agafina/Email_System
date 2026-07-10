const fs = require('fs');
const csv = require('csv-parser');

function parseCsv(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                const emailKey = Object.keys(row).find(k => k.toLowerCase() === 'email') || Object.keys(row)[0];
                const email = row[emailKey];
                if (email) {
                    rows.push({ email: email.trim(), ...row }); // keeps name, company, etc.
                }
            })
            .on('end', () => resolve(rows))
            .on('error', (error) => reject(error));
    });
}
module.exports = parseCsv;