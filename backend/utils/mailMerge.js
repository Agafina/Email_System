function normalizeKey(key) {
    return String(key || '')
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ');
}

function applyTemplate(template, data) {
    if (typeof template !== 'string' || !template) return '';

    return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey) => {
        const placeholderKey = rawKey.trim();
        if (data && Object.prototype.hasOwnProperty.call(data, placeholderKey)) {
            return String(data[placeholderKey]);
        }

        const normalizedPlaceholder = normalizeKey(placeholderKey);
        const directMatch = Object.keys(data || {}).find((key) => normalizeKey(key) === normalizedPlaceholder);

        if (directMatch !== undefined) {
            return String(data[directMatch]);
        }

        return match;
    });
}

module.exports = { applyTemplate };