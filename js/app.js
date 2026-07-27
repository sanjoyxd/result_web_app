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
        dob: $('dob'),
        examType: $('examType'),
        resultName: $('resultName'),
        resultMeta: $('resultMeta'),
        resultStatus: $('resultStatus'),
        resultPhoto: $('resultPhoto'),
        resultAvatar: $('resultAvatar'),
        marksBody: $('marksBody'),
        marksTable: $('marksTable'),
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
        verifyForm: $('verifyForm'),
        verifyToken: $('verifyToken'),
        verifyBtn: $('verifyBtn'),
        verifyBtnText: $('verifyBtnText'),
        verifyError: $('verifyError'),
        verifyErrorText: $('verifyErrorText'),
        verifyResult: $('verifyResult'),
        verifyStudentName: $('verifyStudentName'),
        verifyRoll: $('verifyRoll'),
        verifyClass: $('verifyClass'),
        verifyExam: $('verifyExam'),
        verifyStudentId: $('verifyStudentId'),
        schoolLogo: $('schoolLogo'),
        logoPlaceholder: $('logoPlaceholder'),
        schoolName: $('schoolName'),
        footerSchool: $('footerSchool'),
        footerYear: $('footerYear')
    };

    let cachedExams = [];

    /* ============================================================
       Init
       ============================================================ */
    async function init() {
        dom.footerYear.textContent = new Date().getFullYear();
        loadSchoolSettings();
        loadExams();
        setTimeout(() => {
            dom.loadingOverlay.classList.add('opacity-0', 'pointer-events-none');
            dom.app.classList.remove('opacity-0');
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
                const logoUrl = logo.startsWith('http') ? logo : logo;
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

        const studentId = dom.studentId.value.trim();
        const dob = dom.dob.value;
        const examType = dom.examType.value;

        if (!studentId || !dob || !examType) {
            showError('Please fill in all fields.');
            return;
        }

        setLoading(true);

        try {
            const data = await api.getResult(studentId, dob, examType);
            renderResult(data, studentId, examType);
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
       Render Result
       ============================================================ */
    function renderResult(data, studentId, examId) {
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
            api.getPdfUrl(examId, studentId);
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

        if (!Array.isArray(marks) || marks.length === 0) {
            dom.marksTable.classList.add('hidden');
            return;
        }

        dom.marksTable.classList.remove('hidden');

        marks.forEach((m, i) => {
            const subject = m.subject || m.subject_name || m.name || '';
            const theory = m.theory ?? m.th ?? m.theory_obtained ?? '';
            const practical = m.practical ?? m.pr ?? m.practical_obtained ?? '';
            const total = m.total ?? m.subject_total_obt ?? m.totalObtained ?? '';
            const maxTotal = m.maxTotal || m.subject_total_max || m.totalMax || '';
            const grade = m.grade || '';
            const tMax = m.theoryMax ?? m.t_max ?? '';
            const pMax = m.practicalMax ?? m.p_max ?? '';

            const tr = document.createElement('tr');
            tr.className = 'mark-row border-b border-slate-50 last:border-0';
            tr.style.animationDelay = `${i * 50}ms`;

            tr.innerHTML = `
                <td class="px-6 py-3 font-medium text-slate-700">${subject}</td>
                <td class="px-4 py-3 text-center text-slate-600">${formatMark(theory, tMax)}</td>
                <td class="px-4 py-3 text-center text-slate-600">${formatMark(practical, pMax)}</td>
                <td class="px-4 py-3 text-center font-semibold text-slate-800">${formatMark(total, maxTotal)}</td>
                <td class="px-6 py-3 text-center"><span class="inline-block px-2 py-0.5 rounded text-xs font-bold ${gradeClass(grade)}">${grade}</span></td>
            `;

            dom.marksBody.appendChild(tr);
        });
    }

    function formatMark(obt, max) {
        if (obt === '' || obt === null || obt === undefined) return '-';
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
        const promoStatus = data.promo_status || data.promotionStatus || data.promotion_status || '';
        if (!promoStatus) {
            dom.promoCard.classList.add('hidden');
            return;
        }

        dom.promoCard.classList.remove('hidden');
        dom.promoStatus.textContent = promoStatus;

        const isPromoted = promoStatus.toUpperCase().includes('PROMOTED');
        dom.promoStatus.className = 'text-sm font-semibold mt-1 ' +
            (isPromoted ? 'text-emerald-700' : 'text-red-600');

        const remarks = data.promo_remarks || data.promotionRemarks || data.promotion_remarks || '';
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
       Verify Page
       ============================================================ */
    dom.verifyForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const token = dom.verifyToken.value.trim();
        if (!token) {
            showVerifyError('Please enter a verification code.');
            return;
        }

        dom.verifyBtn.disabled = true;
        dom.verifyBtnText.textContent = 'Verifying...';
        dom.verifyError.classList.add('hidden');

        try {
            const data = await api.verifyMarksheet(token);
            renderVerifyResult(data);
        } catch (err) {
            showVerifyError(err.message);
        } finally {
            dom.verifyBtn.disabled = false;
            dom.verifyBtnText.textContent = 'Verify';
        }
    });

    function renderVerifyResult(data) {
        dom.verifyStudentName.textContent = data.student_name || data.studentName || '';
        dom.verifyRoll.textContent = data.roll_number || data.rollNumber || '';
        dom.verifyClass.textContent = data.class_name || data.className || '';
        dom.verifyExam.textContent = data.exam_name || data.examName || '';
        dom.verifyStudentId.textContent = data.student_id || data.studentId || '';

        dom.verifyForm.parentElement.classList.add('hidden');
        dom.verifyResult.classList.remove('hidden');
    }

    window.resetVerify = function() {
        dom.verifyForm.reset();
        dom.verifyError.classList.add('hidden');
        dom.verifyForm.parentElement.classList.remove('hidden');
        dom.verifyResult.classList.add('hidden');
    };

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
