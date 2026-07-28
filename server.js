require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE_URL || 'https://api.abasss.org';
const JWT_SECRET = process.env.JWT_SECRET || 'aba_super_secret_session_key_2026';
const SERVICE_USER_ID = process.env.SERVICE_USER_ID || '1';
const SERVICE_ROLE = process.env.SERVICE_ROLE || 'Admin';
const SERVICE_EMAIL = process.env.SERVICE_EMAIL || 'service@abasss.org';

app.use(compression());
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(express.json());

function generateServiceToken() {
    return jwt.sign(
        {
            sub: SERVICE_USER_ID,
            role: SERVICE_ROLE,
            email: SERVICE_EMAIL,
            type: 'access',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3500
        },
        JWT_SECRET,
        { algorithm: 'HS256' }
    );
}

function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}

app.options('*', (_, res) => {
    res.writeHead(204, getCorsHeaders());
    res.end();
});

// Health check
app.get('/health', (_, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---- API: Published exams (authenticated proxy) ----
app.get('/api/exams', async (req, res) => {
    try {
        const token = generateServiceToken();
        const apiRes = await fetch(`${API_BASE}/api/exams/`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });
        const data = await apiRes.json();
        const exams = (data.data || [])
            .filter(e => e.is_published)
            .map(e => ({ id: e.id, name: e.name }));
        res.writeHead(200, { 'Content-Type': 'application/json', ...getCorsHeaders() });
        res.json(exams);
    } catch (err) {
        console.error('[API] /api/exams error:', err.message);
        res.status(502).json({ success: false, message: 'Cannot reach exam server' });
    }
});

// ---- API: Student result lookup (authenticated proxy) ----
app.get('/api/results', async (req, res) => {
    const { studentId, dob, examType } = req.query;
    if (!studentId || !dob || !examType) {
        return res.status(400).json({ success: false, message: 'studentId, dob, examType required' });
    }

    try {
        const token = generateServiceToken();

        // 1. Find student
        const stuRes = await fetch(`${API_BASE}/api/students/?search=${encodeURIComponent(studentId)}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        const stuData = await stuRes.json();
        const students = stuData.data || [];
        const student = students.find(s => s.student_id === studentId);
        if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

        // 2. Verify DOB
        if (student.dob !== dob) {
            return res.status(404).json({ success: false, message: 'Date of birth does not match.' });
        }

        // 3. Get active session + enrollment
        const sessRes = await fetch(`${API_BASE}/api/academics/sessions`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        const sessData = await sessRes.json();
        const sessions = sessData.data || [];
        const activeSession = sessions.find(s => s.is_active);
        if (!activeSession) return res.status(404).json({ success: false, message: 'No active session.' });

        // 4. Get class subjects
        const csRes = await fetch(`${API_BASE}/api/academics/subjects/linked`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        const csData = await csRes.json();
        const allClassSubjects = csData.data || [];

        // 5. Get exam details
        const examId = parseInt(examType);
        const exRes = await fetch(`${API_BASE}/api/exams/${examId}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        const exData = await exRes.json();
        const exam = exData.data || exData;
        if (!exam || !exam.is_published) {
            return res.status(404).json({ success: false, message: 'Exam not found or not published.' });
        }

        // 6. Determine enrollment — try all classes for the student in active session
        let enrollment = null;
        let className = null;

        // Try each class to find where the student is enrolled
        const classListRes = await fetch(`${API_BASE}/api/students/${student.id}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        const classListData = await classListRes.json();
        const enrollments = classListData.data?.enrollments || classListData.enrollments || [];

        for (const en of enrollments) {
            if (en.session_id === activeSession.id) {
                enrollment = en;
                className = en.class_name;
                break;
            }
        }

        if (!enrollment) {
            return res.status(404).json({ success: false, message: 'No enrollment found for the active session.' });
        }

        // 7. Get consolidated marks for this class + exam
        const consRes = await fetch(`${API_BASE}/api/marks/consolidated/${encodeURIComponent(className)}/${examId}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        const consData = await consRes.json();

        if (!consData.success) {
            return res.status(404).json({ success: false, message: 'Marks data not available.' });
        }

        const consolidated = consData.data;
        const subjects = consolidated.subjects || [];
        const matrix = consolidated.matrix || {};
        const configMap = consolidated.config_map || {};
        const isCalculated = exam.is_calculated || false;
        const rules = consolidated.rules || [];

        const enrollmentId = enrollment.id;
        const studentMarks = matrix[String(enrollmentId)] || {};

        const marksList = [];
        let grandTotalObt = 0;
        let grandTotalMax = 0;

        for (const sub of subjects) {
            const subMark = studentMarks[String(sub.id)] || {};
            const cfg = configMap[String(sub.id)] || {};

            let tObt = 0, pObt = 0, total = 0;
            let tMax = cfg.theory_max || 80;
            let pMax = cfg.prac_max || 20;
            let subMax = tMax + pMax;

            if (isCalculated && subMark.tgt_has_mark !== undefined) {
                tObt = subMark.tgt_th || 0;
                pObt = subMark.tgt_pr || 0;
                total = subMark.total || (tObt + pObt);
                subMax = tMax + pMax;
            } else if (subMark.th !== undefined || subMark.pr !== undefined) {
                tObt = subMark.th || 0;
                pObt = subMark.pr || 0;
                total = subMark.total || (tObt + pObt);
                subMax = tMax + pMax;
            } else {
                total = subMark.total || 0;
            }

            if (subMark.is_enrolled === false) continue;

            const pct = subMax > 0 ? (total / subMax * 100) : 0;
            let grade = 'F';
            if (pct >= 90) grade = 'A+';
            else if (pct >= 80) grade = 'A';
            else if (pct >= 70) grade = 'B+';
            else if (pct >= 60) grade = 'B';
            else if (pct >= 50) grade = 'C';
            else if (pct >= 30) grade = 'D';

            marksList.push({
                subject: sub.name,
                theory: tObt,
                theoryMax: tMax,
                practical: pObt,
                practicalMax: pMax,
                total: Math.round(total * 10) / 10,
                maxTotal: subMax,
                grade
            });

            grandTotalObt += total;
            grandTotalMax += subMax;
        }

        const percentage = grandTotalMax > 0 ? Math.round((grandTotalObt / grandTotalMax) * 10000) / 100 : 0;
        let division = 'Fail';
        if (percentage >= 60) division = '1st Division';
        else if (percentage >= 45) division = '2nd Division';
        else if (percentage >= 30) division = '3rd Division';

        const status = percentage >= 30 ? 'Pass' : 'Fail';

        // 8. Get promotion record
        let promoStatus = 'PENDING', promoRemarks = '';
        try {
            const promoRes = await fetch(`${API_BASE}/api/academics/promotions/${encodeURIComponent(className)}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
            });
            const promoData = await promoRes.json();
            const promotions = promoData.data || [];
            const promo = promotions.find(p => String(p.student_id) === String(student.id) || String(p.enrollment_id) === String(enrollmentId));
            if (promo) {
                promoStatus = promo.status || 'PENDING';
                promoRemarks = promo.remarks || '';
            }
        } catch {
            // ignore
        }

        const photoUrl = student.photo ? `/static/uploads/students/${student.photo}` : '';

        res.writeHead(200, { 'Content-Type': 'application/json', ...getCorsHeaders() });
        res.json({
            studentName: student.name,
            studentId: student.student_id,
            className,
            sessionName: activeSession.session_name,
            examName: exam.name,
            marks: marksList,
            grandTotal: Math.round(grandTotalObt * 10) / 10,
            grandTotalMax: Math.round(grandTotalMax * 10) / 10,
            percentage,
            division,
            status,
            photo: photoUrl,
            promoStatus,
            promoRemarks
        });

    } catch (err) {
        console.error('[API] /api/results error:', err.message);
        res.status(502).json({ success: false, message: 'Server error while fetching result.' });
    }
});

// ---- API: Proxy /static/* to the backend ----
app.use('/static', async (req, res) => {
    try {
        const targetUrl = `${API_BASE}/static${req.url}`;
        const apiRes = await fetch(targetUrl);
        const contentType = apiRes.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        apiRes.body.pipe(res);
    } catch {
        res.status(404).end();
    }
});

// ---- API: Proxy /api/teachers/settings ----
app.get('/api/teachers/settings', async (_, res) => {
    try {
        const apiRes = await fetch(`${API_BASE}/api/teachers/settings`, {
            headers: { 'Accept': 'application/json' }
        });
        const data = await apiRes.json();
        res.writeHead(200, { 'Content-Type': 'application/json', ...getCorsHeaders() });
        res.json(data);
    } catch {
        res.json({ data: { school_name: 'Assam Brilliant Academy' } });
    }
});

// ---- API: Proxy marksheet verification ----
app.get('/api/reports/verify/:token', async (req, res) => {
    try {
        const apiRes = await fetch(`${API_BASE}/api/reports/verify/${req.params.token}`, {
            headers: { 'Accept': 'application/json' }
        });
        const data = await apiRes.json();
        res.writeHead(apiRes.status, { 'Content-Type': 'application/json', ...getCorsHeaders() });
        res.json(data);
    } catch {
        res.status(502).json({ success: false, message: 'Verification service unavailable' });
    }
});

// ---- Static files ----
const STATIC_DIR = __dirname;
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf'
};

const IGNORE_PATHS = ['/api', '/v1', '/static', '/health', '/node_modules'];

app.get('*', (req, res) => {
    if (IGNORE_PATHS.some(p => req.path.startsWith(p))) {
        return res.status(404).json({ message: 'Not found' });
    }
    let filePath = path.join(STATIC_DIR, req.path === '/' ? 'index.html' : req.path);
    const ext = path.extname(filePath);
    if (!ext) filePath = path.join(STATIC_DIR, 'index.html');
    res.sendFile(filePath, (err) => {
        if (err) res.sendFile(path.join(STATIC_DIR, 'index.html'));
    });
});

app.listen(PORT, () => {
    console.log(`\n  result.abasss.org`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  API -> ${API_BASE}\n`);
});
