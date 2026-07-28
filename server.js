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

// Debug: check config (remove after debugging)
app.get('/debug', (_, res) => {
    res.json({
        apiBase: API_BASE,
        hasJwtSecret: !!process.env.JWT_SECRET,
        secretLength: JWT_SECRET.length,
        serviceUserId: SERVICE_USER_ID,
        serviceRole: SERVICE_ROLE,
        testToken: generateServiceToken().substring(0, 20) + '...'
    });
});

// Debug: check student DOB format
app.get('/debug/student/:id', async (req, res) => {
    try {
        const headers = authHeaders();
        const stuR = await fetch(`${API_BASE}/api/students/?search=${encodeURIComponent(req.params.id)}`, { headers });
        const raw = await stuR.json();
        const students = raw.data || [];
        const student = students.find(s => s.student_id === req.params.id);
        if (!student) return res.json({ found: false, apiStatus: stuR.status, apiResponse: raw });
        res.json({
            found: true,
            student_id: student.student_id,
            dob_raw: student.dob,
            dob_type: typeof student.dob,
            dob_string: String(student.dob),
            name: student.name,
            allKeys: Object.keys(student)
        });
    } catch (err) { res.json({ error: err.message, stack: err.stack }); }
});

// ---- Published exams ----
app.get('/api/exams', async (_, res) => {
    try {
        const r = await fetch(`${API_BASE}/api/exams/`, { headers: authHeaders() });
        const data = await r.json();
        if (!r.ok || data.success === false) {
            console.error('[API] /api/exams upstream error:', r.status, JSON.stringify(data));
            return res.status(502).json({ success: false, message: data.message || `Upstream API returned ${r.status}` });
        }
        const exams = (data.data || []).filter(e => e.is_published).map(e => ({ id: e.id, name: e.name }));
        console.log(`[API] /api/exams: found ${exams.length} published exams`);
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

        // 1. Find student (list endpoint lacks DOB, so fetch detail too)
        const stuR = await fetch(`${API_BASE}/api/students/?search=${encodeURIComponent(studentId)}`, { headers });
        const stuD = await stuR.json();
        const stub = (stuD.data || []).find(s => s.student_id === studentId);
        if (!stub) return res.status(404).json({ success: false, message: 'Student not found.' });

        const detR = await fetch(`${API_BASE}/api/students/${stub.id}`, { headers });
        const detD = await detR.json();
        const detail = detD.data || detD;
        const student = detail.student || detail;
        const className = detail.current_class || null;

        // 2. Verify DOB
        const apiDob = String(student.dob || '').slice(0, 10);
        const reqDob = String(dob || '').slice(0, 10);
        if (apiDob !== reqDob) {
            console.error(`[API] DOB mismatch: API="${apiDob}" Request="${reqDob}" raw="${student.dob}"`);
            return res.status(404).json({ success: false, message: 'Date of birth does not match.' });
        }

        // 3. Active session
        const sessR = await fetch(`${API_BASE}/api/academics/sessions`, { headers });
        const sessD = await sessR.json();
        const activeSession = (sessD.data || []).find(s => s.is_active);
        if (!activeSession) return res.status(404).json({ success: false, message: 'No active session.' });

        if (!className) return res.status(404).json({ success: false, message: 'No class assignment found.' });

        // 4. Exam details
        const exR = await fetch(`${API_BASE}/api/exams/${examId}`, { headers });
        const exD = await exR.json();
        const exam = exD.data || exD;
        if (!exam || !exam.is_published) return res.status(404).json({ success: false, message: 'Exam not found or not published.' });

        // 5. Consolidated marks
        const consR = await fetch(`${API_BASE}/api/marks/consolidated/${encodeURIComponent(className)}/${examId}`, { headers });
        const consD = await consR.json();
        if (!consD.success) return res.status(404).json({ success: false, message: 'Marks data not available.' });

        const consolidated = consD.data;
        const subjects = consolidated.subjects || [];
        const matrix = consolidated.matrix || {};
        const configMap = consolidated.config_map || {};
        const rules = consolidated.rules || [];
        const isAggregated = rules.length > 0;

        // 6. Find enrollment ID from consolidated students list
        const consStudents = consolidated.students || [];
        const match = consStudents.find(s => s.student_id === studentId);
        if (!match) return res.status(404).json({ success: false, message: 'Enrollment not found in this exam.' });
        const enrollmentId = match.id;

        const studentMarks = matrix[String(enrollmentId)] || {};
        const marksList = [];
        let grandTotalObt = 0, grandTotalMax = 0;

        let hasPractical = false;

        for (const sub of subjects) {
            const sm = studentMarks[String(sub.id)] || {};
            const cfg = configMap[String(sub.id)] || {};
            const tMax = cfg.theory_max != null ? Number(cfg.theory_max) : 0;
            const pMax = cfg.prac_max != null ? Number(cfg.prac_max) : 0;
            const subMax = tMax + pMax;

            if (!isAggregated && pMax > 0) hasPractical = true;
            if (sm.is_enrolled === false) continue;

            let total = 0;
            if (isAggregated) {
                total = sm.total || 0;
            } else if (sm.th !== undefined || sm.pr !== undefined) {
                total = sm.total || ((sm.th || 0) + (sm.pr || 0));
            } else {
                total = sm.total || 0;
            }

            const pct = subMax > 0 ? (total / subMax * 100) : 0;
            let grade = 'F';
            if (pct >= 90) grade = 'A+'; else if (pct >= 80) grade = 'A'; else if (pct >= 70) grade = 'B+';
            else if (pct >= 60) grade = 'B'; else if (pct >= 50) grade = 'C'; else if (pct >= 30) grade = 'D';

            if (isAggregated) {
                marksList.push({ subject: sub.name, total: Math.round(total * 10) / 10, maxTotal: subMax, grade });
            } else {
                const tObt = sm.th || 0;
                const pObt = sm.pr || 0;
                marksList.push({ subject: sub.name, theory: tObt, theoryMax: tMax, practical: pObt, practicalMax: pMax, total: Math.round(total * 10) / 10, maxTotal: subMax, grade });
            }
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
            const promo = (pD.data || []).find(p => String(p.enrollment_id) === String(enrollmentId));
            if (promo) { promoStatus = promo.status || 'PENDING'; promoRemarks = promo.remarks || ''; }
        } catch {}

        const photoUrl = student.photo ? `/static/uploads/students/${student.photo}` : '';

        res.json({
            studentName: student.name, studentId: student.student_id, className,
            sessionName: activeSession.session_name, examName: exam.name,
            marks: marksList,
            hasPractical,
            isAggregated,
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
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 15000);
        const r = await fetch(`${API_BASE}/api/reports/verify/${req.params.token}`, { signal: ac.signal, headers: { 'Accept': 'application/json' } });
        clearTimeout(to);
        res.status(r.status).json(await r.json());
    } catch (e) {
        if (e.name === 'AbortError') return res.status(504).json({ success: false, message: 'Verification upstream timed out' });
        res.status(502).json({ success: false, message: 'Verification service unavailable' });
    }
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

// ---- PDF serving: pre-generated first, on-the-fly fallback ----
app.get('/api/pdf/:examId/:studentId', async (req, res) => {
    const { examId, studentId } = req.params;
    const headers = authHeaders();

    // 1. Try pre-generated static PDF (fast, served from disk)
    try {
        const staticR = await fetch(`${API_BASE}/api/reports/static/${examId}/${encodeURIComponent(studentId)}`);
        if (staticR.ok) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.setHeader('Content-Disposition', `inline; filename=ABA_${studentId}.pdf`);
            return staticR.body.pipe(res);
        }
    } catch {}

    // 2. Fallback: generate on-the-fly (slow)
    try {
        const stuR = await fetch(`${API_BASE}/api/students/?search=${encodeURIComponent(studentId)}`, { headers });
        const stuD = await stuR.json();
        const stub = (stuD.data || []).find(s => s.student_id === studentId);
        if (!stub) return res.status(404).json({ success: false, message: 'Student not found.' });

        const detR = await fetch(`${API_BASE}/api/students/${stub.id}`, { headers });
        const detD = await detR.json();
        const detail = detD.data || detD;
        const currentClass = detail.current_class || '';

        const sessR = await fetch(`${API_BASE}/api/academics/sessions`, { headers });
        const sessD = await sessR.json();
        const activeSession = (sessD.data || []).find(s => s.is_active);
        if (!activeSession) return res.status(404).json({ success: false, message: 'No active session.' });

        const consR = await fetch(`${API_BASE}/api/marks/consolidated/${encodeURIComponent(currentClass)}/${examId}`, { headers });
        const consD = await consR.json();
        const consStudents = (consD.data || {}).students || [];
        const match = consStudents.find(s => s.student_id === studentId);
        if (!match) return res.status(404).json({ success: false, message: 'Enrollment not found.' });

        const pdfR = await fetch(`${API_BASE}/api/reports/single/${match.id}/${examId}`, { headers });
        if (!pdfR.ok) {
            const err = await pdfR.json().catch(() => ({}));
            return res.status(pdfR.status).json(err);
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ABA_${studentId}.pdf`);
        pdfR.body.pipe(res);
    } catch (e) {
        console.error('[PDF]', e.message);
        res.status(502).json({ success: false, message: 'PDF service unavailable' });
    }
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
