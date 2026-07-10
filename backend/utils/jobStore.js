const jobs = new Map();

function createJob(total) {
    const id = require('crypto').randomUUID();
    jobs.set(id, { id, total, sent: 0, failed: 0, done: false, errors: [] });
    return id;
}

function updateJob(id, patch) {
    const job = jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
}

function getJob(id) {
    return jobs.get(id) || null;
}

// Clean up old jobs after 1 hour so memory doesn't grow forever
function scheduleCleanup(id) {
    setTimeout(() => jobs.delete(id), 60 * 60 * 1000);
}

module.exports = { createJob, updateJob, getJob, scheduleCleanup };