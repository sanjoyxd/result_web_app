const express = require('express');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE_URL || 'https://api.abasss.org';
const JWT_SECRET = process.env.JWT_SECRET || 'aba_super_secret_session_key_2026';
const SERVICE_USER_ID = process.env.SERVICE_USER_ID || '1';
const SERVICE_ROLE = process.env.SERVICE_ROLE || 'Admin';
const SERVICE_EMAIL = process.env.SERVICE_EMAIL || 'service@abasss.org';

app.use(compression());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json());

function generateServiceToken() {
    return jwt.sign(
        { sub: SERVICE_USER_ID, role: SERVICE_ROLE, email: SERVICE_EMAIL, type: 'access', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3500 },
        JWT_SECRET,
        { algorithm: 'HS256' }
    );
}

function authHeaders() {
    return { 'Authorization': `Bearer ${generateServiceToken()}`, 'Accept': 'application/json' };
}

app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ---- Published exams ----
app.get('/api/exams', async (_, res) => {
    try {
        const r = await fetch(`${API_BASE}/api/exams/`, { headers: authHeaders() });
        const data = await r.json();
        const exams = (data.data || []).filter(e => e.is_published).map(e => ({ id: e.id, name: e.name }));
        res.json(exams);
    } catch (err) {
        console.error('[API] /api/exams:', err.message);
        res.status(502).json({ success: false, message: 'Cannot reach exam server' });
    }
});

// ---- Student result lookup ----
app.get('/api/results', async (req, res) => {
    const { studentId, dob, examType } = req.query;
    if (!studentId || !dob || !examType) return res.status(400).json({ success: false, message: 'studentId, dob, examType required' });

    try {
        const headers = authHeaders();
        const examId = parseInt(examType);

        // 1. Find student
        const stuR = await fetch(`${API_BASE}/api/students/?search=${encodeURIComponent(studentId)}`, { headers });
        const stuD = await stuR.json();
        const student = (stuD.data || []).find(s => s.student_id === studentId);
        if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

        // 2. Verify DOB
        if (student.dob !== dob) return res.status(404).json({ success: false, message: 'Date of birth does not match.' });

        // 3. Active session
        const sessR = await fetch(`${API_BASE}/api/academics/sessions`, { headers });
        const sessD = await sessR.json();
        const activeSession = (sessD.data || []).find(s => s.is_active);
        if (!activeSession) return res.status(404).json({ success: false, message: 'No active session.' });

        // 4. Get student detail for enrollments
        const detR = await fetch(`${API_BASE}/api/students/${student.id}`, { headers });
        const detD = await detR.json();
        const enrollments = detD.data?.enrollments || detD.enrollments || [];

        let enrollment = null;
        let className = null;
        for (const en of enrollments) {
            if (en.session_id === activeSession.id) { enrollment = en; className = en.class_name; break; }
        }
        if (!enrollment) return res.status(404).json({ success: false, message: 'No enrollment found for the active session.' });

        // 5. Exam details
        const exR = await fetch(`${API_BASE}/api/exams/${examId}`, { headers });
        const exD = await exR.json();
        const exam = exD.data || exD;
        if (!exam || !exam.is_published) return res.status(404).json({ success: false, message: 'Exam not found or not published.' });

        // 6. Consolidated marks
        const consR = await fetch(`${API_BASE}/api/marks/consolidated/${encodeURIComponent(className)}/${examId}`, { headers });
        const consD = await consR.json();
        if (!consD.success) return res.status(404).json({ success: false, message: 'Marks data not available.' });

        const consolidated = consD.data;
        const subjects = consolidated.subjects || [];
        const matrix = consolidated.matrix || {};
        const configMap = consolidated.config_map || {};
        const isCalculated = exam.is_calculated || false;

        const studentMarks = matrix[String(enrollment.id)] || {};
        const marksList = [];
        let grandTotalObt = 0, grandTotalMax = 0;

        for (const sub of subjects) {
            const sm = studentMarks[String(sub.id)] || {};
            const cfg = configMap[String(sub.id)] || {};
            const tMax = cfg.theory_max || 80;
            const pMax = cfg.prac_max || 20;
            const subMax = tMax + pMax;

            if (sm.is_enrolled === false) continue;

            let tObt = 0, pObt = 0, total = 0;
            if (isCalculated && sm.tgt_has_mark !== undefined) {
                tObt = sm.tgt_th || 0; pObt = sm.tgt_pr || 0; total = sm.total || (tObt + pObt);
            } else if (sm.th !== undefined || sm.pr !== undefined) {
                tObt = sm.th || 0; pObt = sm.pr || 0; total = sm.total || (tObt + pObt);
            } else {
                total = sm.total || 0;
            }

            const pct = subMax > 0 ? (total / subMax * 100) : 0;
            let grade = 'F';
            if (pct >= 90) grade = 'A+'; else if (pct >= 80) grade = 'A'; else if (pct >= 70) grade = 'B+';
            else if (pct >= 60) grade = 'B'; else if (pct >= 50) grade = 'C'; else if (pct >= 30) grade = 'D';

            marksList.push({ subject: sub.name, theory: tObt, theoryMax: tMax, practical: pObt, practicalMax: pMax, total: Math.round(total * 10) / 10, maxTotal: subMax, grade });
            grandTotalObt += total; grandTotalMax += subMax;
        }

        const percentage = grandTotalMax > 0 ? Math.round((grandTotalObt / grandTotalMax) * 10000) / 100 : 0;
        let division = 'Fail';
        if (percentage >= 60) division = '1st Division'; else if (percentage >= 45) division = '2nd Division'; else if (percentage >= 30) division = '3rd Division';
        const status = percentage >= 30 ? 'Pass' : 'Fail';

        // 7. Promotion
        let promoStatus = 'PENDING', promoRemarks = '';
        try {
            const pR = await fetch(`${API_BASE}/api/academics/promotions/${encodeURIComponent(className)}`, { headers });
            const pD = await pR.json();
            const promo = (pD.data || []).find(p => String(p.enrollment_id) === String(enrollment.id));
            if (promo) { promoStatus = promo.status || 'PENDING'; promoRemarks = promo.remarks || ''; }
        } catch {}

        const photoUrl = student.photo ? `/static/uploads/students/${student.photo}` : '';

        res.json({
            studentName: student.name, studentId: student.student_id, className,
            sessionName: activeSession.session_name, examName: exam.name,
            marks: marksList,
            grandTotal: Math.round(grandTotalObt * 10) / 10,
            grandTotalMax: Math.round(grandTotalMax * 10) / 10,
            percentage, division, status, photo: photoUrl, promoStatus, promoRemarks
        });
    } catch (err) {
        console.error('[API] /api/results:', err.message);
        res.status(502).json({ success: false, message: 'Server error while fetching result.' });
    }
});

// ---- School settings ----
app.get('/api/teachers/settings', async (_, res) => {
    try {
        const r = await fetch(`${API_BASE}/api/teachers/settings`, { headers: { 'Accept': 'application/json' } });
        res.json(await r.json());
    } catch { res.json({ data: { school_name: 'Assam Brilliant Academy' } }); }
});

// ---- Marksheet verification ----
app.get('/api/reports/verify/:token', async (req, res) => {
    try {
        const r = await fetch(`${API_BASE}/api/reports/verify/${req.params.token}`, { headers: { 'Accept': 'application/json' } });
        res.status(r.status).json(await r.json());
    } catch { res.status(502).json({ success: false, message: 'Verification service unavailable' }); }
});

// ---- Static files proxy ----
app.use('/static', async (req, res) => {
    try {
        const r = await fetch(`${API_BASE}/static${req.url}`);
        res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        r.body.pipe(res);
    } catch { res.status(404).end(); }
});

// ---- SPA fallback ----
app.get('*', (req, res) => {
    if (['/api', '/static', '/health'].some(p => req.path.startsWith(p))) return res.status(404).json({ message: 'Not found' });
    let fp = path.join(__dirname, req.path === '/' ? 'index.html' : req.path);
    if (!path.extname(fp)) fp = path.join(__dirname, 'index.html');
    res.sendFile(fp, (err) => { if (err) res.sendFile(path.join(__dirname, 'index.html')); });
});

app.listen(PORT, () => {
    console.log(`\n  result.abasss.org`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  API -> ${API_BASE}\n`);
});
