function applyTemplate(template, data) {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
        return data[key] !== undefined ? data[key] : match;
    });
}
module.exports = { applyTemplate };