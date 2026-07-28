const api = {

    async getSettings() {
        try {
            const res = await fetch('/api/teachers/settings', {
                headers: { 'Accept': 'application/json' }
            });
            if (!res.ok) return null;
            const json = await res.json();
            return json.data || json;
        } catch {
            return null;
        }
    },

    async getExams() {
        const res = await fetch('/api/exams', {
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) throw new Error('Failed to load exams');
        const data = await res.json();
        return Array.isArray(data) ? data : (data.data || []);
    },

    async getResult(studentId, dob, examType) {
        const params = new URLSearchParams({ studentId, dob, examType });
        const res = await fetch(`/api/results?${params.toString()}`, {
            headers: { 'Accept': 'application/json' }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || `Server error (status ${res.status})`);
        return json;
    },

    getPdfUrl(examId, studentId) {
        return `/api/pdf/${examId}/${encodeURIComponent(studentId)}`;
    },

    async verifyMarksheet(token) {
        const res = await fetch(`/api/reports/verify/${encodeURIComponent(token)}`, {
            headers: { 'Accept': 'application/json' }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || 'Verification failed');
        return json.data || json;
    }
};
