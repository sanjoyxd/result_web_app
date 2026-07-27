const API_BASE = '';

const api = {

    async getSettings() {
        const res = await fetch(`${API_BASE}/api/teachers/settings`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json.data || json;
    },

    async getExams() {
        const res = await fetch(`${API_BASE}/v1/exams`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) throw new Error('Failed to load exams');
        const json = await res.json();
        const data = json.data || json;
        return Array.isArray(data) ? data : [];
    },

    async getResult(studentId, dob, examType) {
        const url = new URL(`${API_BASE}/v1/results`, window.location.origin);
        url.searchParams.set('studentId', studentId);
        url.searchParams.set('dob', dob);
        url.searchParams.set('examType', examType);

        const res = await fetch(url.toString(), {
            headers: { 'Accept': 'application/json' }
        });

        if (res.status === 404) {
            throw new Error('No result found for the given Student ID, Date of Birth, and Exam.');
        }
        if (!res.ok) {
            throw new Error(`Server error (status ${res.status}). Please try again later.`);
        }

        const json = await res.json();
        return json.data || json;
    },

    getPdfUrl(examId, studentId) {
        return `${API_BASE}/api/reports/static/${examId}/${encodeURIComponent(studentId)}`;
    },

    async verifyMarksheet(token) {
        const res = await fetch(`${API_BASE}/api/reports/verify/${encodeURIComponent(token)}`, {
            headers: { 'Accept': 'application/json' }
        });

        if (res.status === 404) {
            throw new Error('Invalid or expired verification code.');
        }
        if (!res.ok) {
            throw new Error(`Verification failed (status ${res.status}).`);
        }

        const json = await res.json();
        return json.data || json;
    }
};
