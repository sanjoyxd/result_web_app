(() => {
    'use strict';

    /* ============================================================
       DOM References
       ============================================================ */
    const $ = (id) => document.getElementById(id);

    const dom = {
        loadingOverlay: $('loadingOverlay'),
        app: $('app'),
        searchForm: $('searchForm'),
        resultArea: $('resultArea'),
        searchCard: $('searchCard'),
        errorDiv: $('errorMessage'),
        errorText: $('errorText'),
        submitBtn: $('submitBtn'),
        submitText: $('submitText'),
        resetBtn: $('resetBtn'),
        downloadBtn: $('downloadBtn'),
        studentId: $('studentId'),
        dobDay: $('dobDay'),
        dobMonth: $('dobMonth'),
        dobYear: $('dobYear'),
        examType: $('examType'),
        resultName: $('resultName'),
        resultMeta: $('resultMeta'),
        resultStatus: $('resultStatus'),
        resultPhoto: $('resultPhoto'),
        resultAvatar: $('resultAvatar'),
        marksBody: $('marksBody'),
        marksTable: $('marksTable'),
        thTheory: $('thTheory'),
        thPractical: $('thPractical'),
        resultObtained: $('resultObtained'),
        resultPercentage: $('resultPercentage'),
        resultDivision: $('resultDivision'),
        promoCard: $('promoCard'),
        promoStatus: $('promoStatus'),
        promoRemarks: $('promoRemarks'),
        promoAttendance: $('promoAttendance'),
        promoDays: $('promoDays'),
        pageResult: $('pageResult'),
        pageVerify: $('pageVerify'),
        navResult: $('navResult'),
        navVerify: $('navVerify'),
        verifyError: $('verifyError'),
        verifyErrorText: $('verifyErrorText'),
        verifyResult: $('verifyResult'),
        verifyStudentName: $('verifyStudentName'),
        verifyRoll: $('verifyRoll'),
        verifyClass: $('verifyClass'),
        verifyExam: $('verifyExam'),
        verifyStudentId: $('verifyStudentId'),
        verifyFormCard: $('verifyFormCard'),
        schoolLogo: $('schoolLogo'),
        logoPlaceholder: $('logoPlaceholder'),
        schoolName: $('schoolName'),
        footerSchool: $('footerSchool'),
        footerYear: $('footerYear'),
        scanQrBtn: $('scanQrBtn'),
        closeScannerBtn: $('closeScannerBtn'),
        qrScannerOverlay: $('qrScannerOverlay'),
        qrReader: $('qrReader')
    };

    let cachedExams = [];

    /* ============================================================
       Init
       ============================================================ */
    async function init() {
        dom.footerYear.textContent = new Date().getFullYear();
        
        // Populate DOB dropdowns
        let dayHtml = '<option value="" disabled selected>Day</option>';
        for(let i=1; i<=31; i++) {
            const val = i.toString().padStart(2, '0');
            dayHtml += `<option value="${val}">${val}</option>`;
        }
        if (dom.dobDay) dom.dobDay.innerHTML = dayHtml;

        let yearHtml = '<option value="" disabled selected>Year</option>';
        const currentYear = new Date().getFullYear();
        for(let i=currentYear - 30; i<=currentYear; i++) {
            yearHtml += `<option value="${i}">${i}</option>`;
        }
        if (dom.dobYear) dom.dobYear.innerHTML = yearHtml;

        loadSchoolSettings();
        loadExams();

        const verifyMatch = window.location.pathname.match(/^\/verify-marksheet\/(.+)$/);
        if (verifyMatch) {
            const token = decodeURIComponent(verifyMatch[1]);
            navigateTo('verify');
            setTimeout(() => verify(token), 600);
        }

        setTimeout(() => {
            dom.loadingOverlay.classList.add('opacity-0', 'pointer-events-none');
            dom.loadingOverlay.style.opacity = '0';
            dom.loadingOverlay.style.pointerEvents = 'none';
            dom.app.classList.remove('opacity-0');
            dom.app.style.opacity = '1';
        }, 400);
    }

    /* ============================================================
       School Settings
       ============================================================ */
    async function loadSchoolSettings() {
        try {
            const settings = await api.getSettings();
            if (!settings) return;

            const name = settings.school_name || settings.name;
            if (name) {
                dom.schoolName.textContent = name;
                dom.footerSchool.textContent = name;
            }

            const logo = settings.logo || settings.school_logo;
            if (logo) {
                const logoUrl = logo.startsWith('http') ? logo : `/static/uploads/settings/${logo}`;
                dom.schoolLogo.src = logoUrl;
                dom.schoolLogo.classList.remove('hidden');
                dom.logoPlaceholder.classList.add('hidden');
            }
        } catch {
            // Silently fail - use defaults
        }
    }

    /* ============================================================
       Exam Dropdown
       ============================================================ */
    async function loadExams() {
        try {
            const exams = await api.getExams();
            cachedExams = exams;
            const select = dom.examType;

            select.innerHTML = '<option value="" disabled selected>Choose an exam...</option>';

            exams.forEach(exam => {
                const opt = document.createElement('option');
                opt.value = exam.id;
                opt.textContent = exam.name;
                select.appendChild(opt);
            });
        } catch {
            dom.examType.innerHTML = '<option value="" disabled selected>Error loading exams</option>';
        }
    }

    /* ============================================================
       Navigation
       ============================================================ */
    window.navigateTo = function(page) {
        dom.pageResult.classList.add('hidden');
        dom.pageVerify.classList.add('hidden');
        dom.navResult.classList.remove('active');
        dom.navVerify.classList.remove('active');

        if (page === 'verify') {
            dom.pageVerify.classList.remove('hidden');
            dom.navVerify.classList.add('active');
        } else {
            dom.pageResult.classList.remove('hidden');
            dom.navResult.classList.add('active');
        }
    };

    /* ============================================================
       Search Form
       ============================================================ */
    dom.searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const studentId = dom.studentId.value.trim().toUpperCase();
        const dob = `${dom.dobYear.value}-${dom.dobMonth.value}-${dom.dobDay.value}`;
        const examType = dom.examType.value;

        if (!studentId || !dom.dobYear.value || !dom.dobMonth.value || !dom.dobDay.value || !examType) {
            showError('Please fill in all fields.');
            return;
        }

        setLoading(true);

        try {
            const data = await api.getResult(studentId, dob, examType);
            renderResult(data, studentId, examType, dob);
        } catch (err) {
            showError(err.message);
            shakeCard();
        } finally {
            setLoading(false);
        }
    });

    dom.resetBtn.addEventListener('click', () => {
        dom.searchForm.reset();
        dom.resultArea.classList.add('hidden');
        dom.searchCard.classList.remove('hidden');
        dom.errorDiv.classList.add('hidden');
        dom.promoCard.classList.add('hidden');
        dom.marksBody.innerHTML = '';
    });

    /* ============================================================
       Render Result View
       ============================================================ */
    function renderResult(data, studentId, examId, dob) {
        const name = data.studentName || data.student_name || data.name || 'Student';
        const cls = data.className || data.class_name || '';
        const session = data.sessionName || data.session_name || '';
        const status = data.status || 'Pass';
        const division = data.division || '';
        const percentage = data.percentage || '';
        const grandTotal = data.grandTotal || data.grand_total_obt || data.totalMarks || '';
        const grandMax = data.grandTotalMax || data.grand_total_max || data.totalMax || '';
        const photo = data.photo || data.photoUrl || data.student_photo || '';

        // Name and meta
        dom.resultName.textContent = name;
        dom.resultMeta.textContent = [studentId, cls, session].filter(Boolean).join(' \u00B7 ');

        // Photo
        if (photo) {
            const photoUrl = photo.startsWith('http') ? photo : photo;
            dom.resultPhoto.src = photoUrl;
            dom.resultPhoto.classList.remove('hidden');
            dom.resultAvatar.querySelector('i')?.classList.add('hidden');
        }

        // Status badge
        const isPass = status.toLowerCase() === 'pass' || status.toLowerCase() === 'promoted';
        dom.resultStatus.textContent = status;
        dom.resultStatus.className = 'px-3 py-1.5 rounded-lg text-xs font-bold status-badge ' +
            (isPass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700');

        // Marks table
        renderMarksTable(data);

        // Summary
        if (grandTotal !== '') {
            const maxText = grandMax ? ` / ${grandMax}` : '';
            dom.resultObtained.textContent = grandTotal + maxText;
        } else {
            dom.resultObtained.textContent = '-';
        }

        if (percentage !== '') {
            dom.resultPercentage.textContent = (typeof percentage === 'number' ? percentage.toFixed(1) : percentage) + '%';
        } else {
            dom.resultPercentage.textContent = '-';
        }

        dom.resultDivision.textContent = division || status;
        dom.resultDivision.className = 'text-lg font-extrabold mt-0.5 ' +
            (isPass ? 'text-school-700' : 'text-red-600');

        // PDF download
        const pdfUrl = data.pdfDownloadUrl || data.pdf_url ||
            api.getPdfUrl(examId, studentId, dob);
        dom.downloadBtn.href = pdfUrl;

        // Promotion info
        renderPromotion(data);

        // Transition
        dom.searchCard.classList.add('hidden');
        dom.errorDiv.classList.add('hidden');
        dom.resultArea.classList.remove('hidden');
    }

    function renderMarksTable(data) {
        dom.marksBody.innerHTML = '';
        let marks = data.marks || data.report_data || data.subjects || [];
        let coScholastic = data.coScholastic || data.co_scholastic_data || [];

        if (!Array.isArray(marks) || marks.length === 0) {
            dom.marksTable.classList.add('hidden');
            return;
        }

        dom.marksTable.classList.remove('hidden');
        const showPractical = !!data.hasPractical;
        dom.thTheory.classList.toggle('hidden', !showPractical);
        dom.thPractical.classList.toggle('hidden', !showPractical);

        marks.forEach((m, i) => {
            const subject = m.subject || m.subject_name || m.name || '';
            const total = m.is_absent ? 'AB' : (m.total ?? m.subject_total_obt ?? m.totalObtained ?? '');
            const maxTotal = m.maxTotal || m.subject_total_max || m.totalMax || '';
            const grade = m.grade || '';

            const tr = document.createElement('tr');
            tr.className = 'mark-row border-b border-slate-50 last:border-0';
            tr.style.animationDelay = `${i * 50}ms`;

            let cells = `<td class="px-6 py-3 font-medium text-slate-700">${subject}</td>`;
            if (showPractical) {
                const theory = m.is_absent ? 'AB' : (m.theory ?? m.th ?? m.theory_obtained ?? m.final_t_obt ?? '');
                const practical = m.is_absent ? 'AB' : (m.practical ?? m.pr ?? m.practical_obtained ?? m.final_p_obt ?? '');
                const tMax = m.theoryMax ?? m.t_max ?? m.final_t_max ?? '';
                const pMax = m.practicalMax ?? m.p_max ?? m.final_p_max ?? '';
                cells += `<td class="px-4 py-3 text-center text-slate-600">${formatMark(theory, tMax)}</td>`;
                cells += `<td class="px-4 py-3 text-center text-slate-600">${formatMark(practical, pMax)}</td>`;
            }
            cells += `<td class="px-4 py-3 text-center font-semibold text-slate-800">${formatMark(total, maxTotal)}</td>`;
            cells += `<td class="px-6 py-3 text-center"><span class="inline-block px-2 py-0.5 rounded text-xs font-bold ${gradeClass(grade)}">${grade}</span></td>`;
            tr.innerHTML = cells;

            dom.marksBody.appendChild(tr);
        });

        if (coScholastic && coScholastic.length > 0) {
            const trHeader = document.createElement('tr');
            trHeader.className = 'bg-slate-50';
            trHeader.innerHTML = `<td colspan="100%" class="px-6 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Co-Scholastic Area</td>`;
            dom.marksBody.appendChild(trHeader);

            coScholastic.forEach((m, i) => {
                const subject = m.subject || m.subject_name || m.name || '';
                const grade = m.is_absent ? 'AB' : (m.grade || '');
                const tr = document.createElement('tr');
                tr.className = 'mark-row border-b border-slate-50 last:border-0';
                tr.style.animationDelay = `${(marks.length + i) * 50}ms`;

                let cells = `<td class="px-6 py-3 font-medium text-slate-700">${subject}</td>`;
                if (showPractical) {
                    cells += `<td class="px-4 py-3 text-center text-slate-400">-</td>`;
                    cells += `<td class="px-4 py-3 text-center text-slate-400">-</td>`;
                }
                cells += `<td class="px-4 py-3 text-center text-slate-400">-</td>`;
                cells += `<td class="px-6 py-3 text-center"><span class="inline-block px-2 py-0.5 rounded text-xs font-bold ${gradeClass(grade)}">${grade}</span></td>`;
                tr.innerHTML = cells;
                dom.marksBody.appendChild(tr);
            });
        }
    }

    function formatMark(obt, max) {
        if (obt === '' || obt === null || obt === undefined) return '-';
        if (obt === 'AB') return '<span class="text-red-500 font-bold">AB</span>';
        const val = Number(obt);
        if (isNaN(val)) return '-';
        if (max) return `${val} <span class="text-slate-400 text-xs">/ ${max}</span>`;
        return val;
    }

    function gradeClass(grade) {
        if (!grade) return 'bg-slate-100 text-slate-600';
        const g = grade.toUpperCase().replace(/\s/g, '');
        if (g === 'A+') return 'grade-a-plus';
        if (g === 'A') return 'grade-a';
        if (g === 'B+') return 'grade-b-plus';
        if (g === 'B') return 'grade-b';
        if (g === 'C') return 'grade-c';
        if (g === 'D') return 'grade-d';
        if (g === 'F') return 'grade-f';
        return 'bg-slate-100 text-slate-600';
    }

    function renderPromotion(data) {
        const ps = data.promoStatus || data.promo_status || data.promotionStatus || '';
        if (!ps || ps === 'PENDING') {
            dom.promoCard.classList.add('hidden');
            return;
        }

        dom.promoCard.classList.remove('hidden');
        dom.promoStatus.textContent = ps;

        const isPromoted = ps.toUpperCase().includes('PROMOTED');
        dom.promoStatus.className = 'text-sm font-semibold mt-1 ' +
            (isPromoted ? 'text-emerald-700' : 'text-red-600');

        const remarks = data.promoRemarks || data.promo_remarks || data.promotionRemarks || '';
        dom.promoRemarks.textContent = remarks;

        const totalDays = data.total_working_days || data.totalWorkingDays || 0;
        const daysPresent = data.days_present || data.daysPresent || 0;
        if (totalDays > 0) {
            dom.promoAttendance.classList.remove('hidden');
            dom.promoDays.textContent = `${daysPresent} / ${totalDays} days`;
        } else {
            dom.promoAttendance.classList.add('hidden');
        }
    }

    /* ============================================================
       Verify
       ============================================================ */
    async function verify(token) {
        dom.verifyError.classList.add('hidden');
        try {
            const data = await withTimeout(api.verifyMarksheet(token), 20000);
            renderVerifyResult(data, token);
        } catch (err) {
            showVerifyError(err.message);
        }
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms))
        ]);
    }

    function renderVerifyResult(data, token) {
        dom.verifyStudentName.textContent = data.student_name || data.studentName || '';
        dom.verifyRoll.textContent = data.roll_number || data.rollNumber || '';
        dom.verifyClass.textContent = data.class_name || data.className || '';
        dom.verifyExam.textContent = data.exam_name || data.examName || '';
        dom.verifyStudentId.textContent = data.student_id || data.studentId || '';

        const verifyPdfBtn = $('verifyPdfBtn');
        if (verifyPdfBtn) {
            const examId = data.exam_id || data.examId;
            const studentId = data.student_id || data.studentId;
            if (examId && studentId && token) {
                verifyPdfBtn.href = `/api/pdf/verify/${encodeURIComponent(token)}`;
                verifyPdfBtn.classList.remove('hidden');
            } else {
                verifyPdfBtn.classList.add('hidden');
            }
        }

        dom.verifyError.classList.add('hidden');
        dom.verifyFormCard.classList.add('hidden');
        dom.verifyResult.classList.remove('hidden');
    }

    window.resetVerify = function() {
        dom.verifyForm.reset();
        dom.verifyError.classList.add('hidden');
        dom.verifyFormCard.classList.remove('hidden');
        dom.verifyResult.classList.add('hidden');
    };

    /* ============================================================
       QR Scanner
       ============================================================ */
    let html5QrCode = null;

    function extractTokenFromUrl(text) {
        const match = text.match(/\/(?:verify|verify-marksheet)\/([^/?#]+)/);
        return match ? decodeURIComponent(match[1]) : text.trim();
    }

    function startScanner() {
        dom.qrScannerOverlay.classList.remove('hidden');
        if (!html5QrCode) html5QrCode = new Html5Qrcode('qrReader');

        const config = { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1 };
        const onSuccess = (decodedText) => {
            stopScanner();
            showVerifyError('QR scanned! Redirecting...');
            const token = extractTokenFromUrl(decodedText);
            window.location.href = `/verify-marksheet/${token}`;
        };

        html5QrCode.start({ facingMode: 'environment' }, config, onSuccess, () => {})
            .catch(() => {
                // Fallback to user camera if environment camera is missing
                html5QrCode.start({ facingMode: 'user' }, config, onSuccess, () => {})
                    .catch((err) => {
                        console.error(err);
                        showVerifyError('Camera access denied, unavailable, or requires HTTPS.');
                        stopScanner();
                    });
            });
    }

    function stopScanner() {
        dom.qrScannerOverlay.classList.add('hidden');
        if (html5QrCode && html5QrCode.isScanning) html5QrCode.stop().catch(() => {});
    }

    dom.scanQrBtn.addEventListener('click', startScanner);
    dom.closeScannerBtn.addEventListener('click', stopScanner);

    /* ============================================================
       UI Helpers
       ============================================================ */
    function setLoading(loading) {
        dom.submitBtn.disabled = loading;
        dom.submitText.textContent = loading ? 'Fetching...' : 'Fetch Result';
        dom.submitBtn.querySelector('i').className = loading ? 'fas fa-spinner fa-spin' : 'fas fa-magnifying-glass';
        if (loading) dom.errorDiv.classList.add('hidden');
    }

    function showError(msg) {
        dom.errorText.textContent = msg;
        dom.errorDiv.classList.remove('hidden');
    }

    function showVerifyError(msg) {
        dom.verifyErrorText.textContent = msg;
        dom.verifyError.className = 'rounded-xl border p-4 text-sm font-medium ';
        const isError = msg !== 'Verifying...';
        dom.verifyError.classList.add(isError ? 'bg-red-50 border-red-100 text-red-700' : 'bg-emerald-50 border-emerald-100 text-emerald-700');
        dom.verifyError.classList.remove('hidden');
    }

    function shakeCard() {
        dom.searchCard.classList.add('shake');
        setTimeout(() => dom.searchCard.classList.remove('shake'), 500);
    }

    /* ============================================================
       Start
       ============================================================ */
    init();
})();
