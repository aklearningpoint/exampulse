import { auth, db, provider, signInWithPopup, collection, getDocs, query, orderBy, limit, doc, getDoc, addDoc, where, serverTimestamp } from "../../core/firebase-config.js";

let activeQuiz = null;
let activeQuizId = null;
let currentQIndex = 0;
let userAnswers = {};
let visitedSet = new Set();
let markedReviewSet = new Set();
let questionTimes = {};
let lastTickTime = Date.now();
let timerInterval = null;
let secondsLeft = 0;
let totalDurationSecs = 0;
let testLang = "BOTH";
let isPaletteCollapsed = false;
let isPaperViewOpen = false;
let lastResultPayload = null;

// Exam-Specific Filter State
let selectedTestExam = "ALL";
let cachedQuizDocs = [];
let examSpecificPools = { SSC: [], Railway: [], Banking: [], "UPSC/PCS": [] };

function toggleExamFocusMode(isExamActive) {
  const header = document.querySelector("header");
  const nav = document.querySelector("nav");
  const main = document.querySelector("main");
  if (header) header.style.display = isExamActive ? "none" : "flex";
  if (nav) nav.style.display = isExamActive ? "none" : "flex";
  if (main) {
    if (isExamActive) {
      main.classList.remove("p-3.5", "max-w-xl");
      main.classList.add("p-0", "max-w-full");
    } else {
      main.classList.remove("p-0", "max-w-full");
      main.classList.add("p-3.5", "max-w-xl");
    }
  }
}

function getMistakeVault() {
  try {
    return JSON.parse(localStorage.getItem("ep_mistake_vault") || "[]");
  } catch {
    return [];
  }
}

function saveToMistakeVault(wrongQuestions) {
  if (!wrongQuestions.length) return;
  const existing = getMistakeVault();
  const map = new Map(existing.map(q => [q.question_en, q]));
  wrongQuestions.forEach(q => map.set(q.question_en, q));
  localStorage.setItem("ep_mistake_vault", JSON.stringify(Array.from(map.values()).slice(-50)));
}

function awardQuizXP(points) {
  if (points <= 0) return;
  const currentXp = parseInt(localStorage.getItem("ep_xp") || "0", 10);
  const updated = currentXp + points;
  localStorage.setItem("ep_xp", String(updated));
  const xpEl = document.getElementById("header-xp");
  if (xpEl) xpEl.innerText = updated;
}

function matchesExamTag(questionObj, targetExam) {
  if (targetExam === "ALL") return true;
  const tagStr = String(questionObj.exam_tag || (questionObj.exams || []).join(" ") || "ALL").toUpperCase();
  if (tagStr === "ALL" || tagStr === "ALL EXAMS") return true;
  if (targetExam === "UPSC/PCS") {
    return tagStr.includes("UPSC") || tagStr.includes("PCS");
  }
  return tagStr.includes(targetExam.toUpperCase());
}

export async function loadQuizList() {
  toggleExamFocusMode(false);
  if (timerInterval) clearInterval(timerInterval);

  const container = document.getElementById("quiz-container");
  container.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">Loading ExamPulse Mock Tests...</div>`;

  try {
    const q = query(collection(db, "quizzes"), orderBy("date", "desc"), limit(15));
    const snap = await getDocs(q);

    cachedQuizDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Build Exam-Specific Question Pools from recent 7 quizzes
    examSpecificPools = { SSC: [], Railway: [], Banking: [], "UPSC/PCS": [] };
    cachedQuizDocs.slice(0, 7).forEach(quiz => {
      (quiz.questions || []).forEach(question => {
        ["SSC", "Railway", "Banking", "UPSC/PCS"].forEach(exam => {
          if (matchesExamTag(question, exam)) {
            examSpecificPools[exam].push({ ...question, _sourceDate: quiz.date });
          }
        });
      });
    });

    renderQuizHub();
  } catch (err) {
    container.innerHTML = `<div class="text-red-500 text-xs p-4">Error loading quizzes: ${err.message}</div>`;
  }
}

window.setTestExamFilter = function(exam) {
  selectedTestExam = exam;
  renderQuizHub();
};

function renderQuizHub() {
  const container = document.getElementById("quiz-container");
  const mistakes = getMistakeVault();
  const exams = ["ALL", "SSC", "Railway", "Banking", "UPSC/PCS"];

  const filterBarHtml = `
    <div class="flex gap-1.5 overflow-x-auto pb-2.5 mb-3 border-b border-slate-200 dark:border-slate-800">
      ${exams.map(ex => {
        const active = selectedTestExam === ex;
        const label = ex === "ALL" ? "All Exams" : ex;
        return `
          <button onclick="window.setTestExamFilter('${ex}')" class="px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
            active
              ? "bg-[#285577] text-white shadow-xs"
              : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
          }">
            ${label}
          </button>`;
      }).join("")}
    </div>
  `;

  const mistakeBanner = mistakes.length > 0 ? `
    <div class="bg-gradient-to-r from-rose-950 to-slate-900 text-white rounded-2xl p-3.5 mb-3.5 border border-rose-800/60 shadow-sm flex items-center justify-between">
      <div>
        <span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-extrabold uppercase">🧠 Auto-Mistake Vault</span>
        <h3 class="font-bold text-sm mt-1">Revise Weak Questions (${mistakes.length} Qs)</h3>
      </div>
      <button onclick="window.startMistakeVaultTest()" class="px-3 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-extrabold whitespace-nowrap">
        Fix Now →
      </button>
    </div>` : "";

  // Dedicated Exam-Specific Special Mock Section
  const examsToShow = selectedTestExam === "ALL" ? ["SSC", "Railway", "Banking", "UPSC/PCS"] : [selectedTestExam];
  const specialMocksHtml = examsToShow.map(ex => {
    const pool = examSpecificPools[ex] || [];
    if (pool.length === 0) return "";
    const qCount = Math.min(pool.length, 25);
    const neg = ex === "Railway" ? 0.33 : ex === "UPSC/PCS" ? 0.33 : 0.25;
    return `
      <div class="bg-gradient-to-br from-slate-900 to-[#1e3a52] text-white rounded-2xl p-4 mb-3 border border-slate-700 shadow-sm">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-1.5">
              <span class="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-extrabold uppercase">🎯 ${ex} Special</span>
              <span class="text-[10px] text-slate-300 font-semibold">Exam-Focused Mock</span>
            </div>
            <h3 class="font-extrabold text-sm mt-1.5">${ex} Targeted Current Affairs & GK Test</h3>
            <p class="text-[11px] text-slate-300 mt-0.5">📋 ${qCount} ${ex} Qs • ⏱ ${Math.max(5, Math.ceil(qCount * 0.6))} Mins • ⚖️ +1 / -${neg}</p>
          </div>
          <button onclick="window.startExamSpecificPoolTest('${ex}')" class="px-3.5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold whitespace-nowrap active:scale-95 transition">
            Start ${ex} →
          </button>
        </div>
      </div>`;
  }).join("");

  if (cachedQuizDocs.length === 0) {
    container.innerHTML = filterBarHtml + mistakeBanner + `
      <div class="bg-white dark:bg-slate-900 rounded-2xl p-6 text-center border border-slate-200 dark:border-slate-800">
        <p class="font-bold text-slate-800 dark:text-slate-200">No Quizzes Available Yet</p>
        <p class="text-xs text-slate-500 mt-1">Published daily tests will appear here automatically.</p>
      </div>`;
    return;
  }

  // Filter Daily Quizzes according to selected exam
  const filteredDailyQuizzes = cachedQuizDocs.map(quiz => {
    const filteredQs = (quiz.questions || []).filter(q => matchesExamTag(q, selectedTestExam));
    return { ...quiz, _filteredQuestions: filteredQs };
  }).filter(quiz => quiz._filteredQuestions.length > 0);

  container.innerHTML = `
    ${filterBarHtml}
    ${mistakeBanner}
    ${specialMocksHtml}

    <div class="mt-4 mb-2.5 flex items-center justify-between">
      <h2 class="font-extrabold text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wider">
        📅 ${selectedTestExam === "ALL" ? "Daily Practice Tests" : `${selectedTestExam} Daily Sectional Tests`}
      </h2>
      <span class="text-[11px] font-semibold text-slate-400">${filteredDailyQuizzes.length} Tests</span>
    </div>

    ${filteredDailyQuizzes.length === 0 ? `
      <div class="bg-white dark:bg-slate-900 rounded-2xl p-6 text-center border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
        No daily questions tagged specifically for <strong>${selectedTestExam}</strong> yet.
      </div>
    ` : filteredDailyQuizzes.map(quiz => {
      const qCount = quiz._filteredQuestions.length;
      const neg = selectedTestExam === "Railway" || selectedTestExam === "UPSC/PCS" ? 0.33 : (quiz.negative_marking ?? 0.25);
      const displayTitle = selectedTestExam === "ALL" ? quiz.title : `${selectedTestExam} — ${quiz.title}`;
      const safeTitle = displayTitle.replace(/'/g, "\\'");
      const scopedQuizId = selectedTestExam === "ALL" ? quiz.id : `${quiz.id}_${selectedTestExam.replace("/", "_")}`;

      return `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm mb-3">
          <div class="flex items-center gap-1.5">
            <span class="px-2 py-0.5 rounded bg-[#285577] text-white text-[10px] font-bold uppercase">${selectedTestExam === "ALL" ? "All Exams" : selectedTestExam}</span>
            <span class="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold uppercase">${quiz.category || "Daily CA"}</span>
            <span class="text-[10px] font-semibold text-slate-400">${quiz.date || ""}</span>
          </div>
          <h3 class="font-bold text-slate-900 dark:text-white text-sm mt-1.5 leading-snug">${displayTitle}</h3>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">📋 ${qCount} Qs • ⏱ ${Math.max(3, Math.ceil(qCount * 0.6))} Mins • ⚖️ +1 / -${neg}</p>

          <div class="grid grid-cols-2 gap-2 mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800">
            <button onclick="window.openStandaloneLeaderboard('${scopedQuizId}', '${safeTitle}')" class="py-2 rounded-xl bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 text-xs font-bold active:scale-95 transition">
              🏆 Top Ranks
            </button>
            <button onclick="window.startFilteredDailyQuiz('${quiz.id}', '${selectedTestExam}')" class="py-2 rounded-xl bg-[#285577] hover:bg-[#1e425e] text-white text-xs font-extrabold active:scale-95 transition">
              Start Exam →
            </button>
          </div>
        </div>`;
    }).join("")}
  `;
}

// Launch Exam-Specific Pool Mock (e.g., SSC Special Mock)
window.startExamSpecificPoolTest = function(examName) {
  const pool = examSpecificPools[examName] || [];
  if (!pool.length) return alert(`No questions available for ${examName} yet.`);
  const selectedQs = pool.slice(0, 25);
  const neg = examName === "Railway" || examName === "UPSC/PCS" ? 0.33 : 0.25;
  const cleanId = `special_${examName.replace("/", "_")}`;

  launchExamEnvironment({
    title: `${examName} Special Mock Test`,
    category: `${examName} Exam`,
    duration_mins: Math.max(5, Math.ceil(selectedQs.length * 0.6)),
    negative_marking: neg,
    questions: selectedQs
  }, cleanId);
};

// Launch Daily Quiz Filtered by Selected Exam
window.startFilteredDailyQuiz = async function(quizId, examFilter) {
  const container = document.getElementById("quiz-container");
  container.innerHTML = `<div class="text-center py-16 text-slate-500 text-sm font-semibold">Initializing ExamPulse Exam Console...</div>`;

  let quizData = cachedQuizDocs.find(q => q.id === quizId);
  if (!quizData) {
    const snap = await getDoc(doc(db, "quizzes", quizId));
    if (!snap.exists()) return alert("Quiz not found.");
    quizData = { id: snap.id, ...snap.data() };
  }

  const filteredQs = (quizData.questions || []).filter(q => matchesExamTag(q, examFilter));
  if (!filteredQs.length) return alert("No questions found for this exam category.");

  const neg = examFilter === "Railway" || examFilter === "UPSC/PCS" ? 0.33 : (quizData.negative_marking ?? 0.25);
  const title = examFilter === "ALL" ? quizData.title : `${examFilter} — ${quizData.title}`;
  const scopedId = examFilter === "ALL" ? quizId : `${quizId}_${examFilter.replace("/", "_")}`;

  launchExamEnvironment({
    ...quizData,
    title,
    category: examFilter === "ALL" ? (quizData.category || "Daily CA") : examFilter,
    duration_mins: Math.max(3, Math.ceil(filteredQs.length * 0.6)),
    negative_marking: neg,
    questions: filteredQs
  }, scopedId);
};

window.startMistakeVaultTest = function() {
  const mistakes = getMistakeVault();
  if (!mistakes.length) return;
  launchExamEnvironment({
    title: "Mistake Vault Revision Test",
    category: "Weak Area Drill",
    duration_mins: Math.max(3, Math.ceil(mistakes.length * 0.6)),
    negative_marking: 0.25,
    questions: mistakes,
    isMistakeDrill: true
  }, "mistake_vault");
};

window.startQuiz = function(quizId) {
  window.startFilteredDailyQuiz(quizId, "ALL");
};

function launchExamEnvironment(quizData, quizId) {
  activeQuiz = quizData;
  activeQuizId = quizId;
  currentQIndex = 0;
  userAnswers = {};
  visitedSet = new Set([0]);
  markedReviewSet = new Set();
  questionTimes = {};
  lastTickTime = Date.now();
  testLang = "BOTH";
  isPaletteCollapsed = false;
  isPaperViewOpen = false;
  lastResultPayload = null;

  totalDurationSecs = (activeQuiz.duration_mins || 5) * 60;
  secondsLeft = totalDurationSecs;

  toggleExamFocusMode(true);

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    secondsLeft--;
    const timerEl = document.getElementById("ep-exam-timer");
    if (timerEl) {
      const m = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
      const s = String(secondsLeft % 60).padStart(2, "0");
      timerEl.innerText = `${m}:${s}`;
      if (secondsLeft <= 60) {
        timerEl.classList.add("text-red-400", "animate-pulse");
      }
    }
    if (secondsLeft <= 0) {
      clearInterval(timerInterval);
      window.submitQuiz(true);
    }
  }, 1000);

  renderExamScreen();
}

function recordTimeSpent() {
  const now = Date.now();
  const delta = Math.round((now - lastTickTime) / 1000);
  questionTimes[currentQIndex] = (questionTimes[currentQIndex] || 0) + delta;
  lastTickTime = now;
}

function getPaletteBtnStyle(idx) {
  const isAnswered = userAnswers[idx] !== undefined;
  const isMarked = markedReviewSet.has(idx);
  const isVisited = visitedSet.has(idx);

  if (isMarked && isAnswered) {
    return "bg-[#5b2c83] text-white rounded-full relative after:content-[''] after:w-2 after:h-2 after:bg-[#28a745] after:rounded-full after:absolute after:bottom-0 after:right-0 after:border after:border-white";
  }
  if (isMarked) {
    return "bg-[#5b2c83] text-white rounded-full";
  }
  if (isAnswered) {
    return "bg-[#28a745] text-white rounded-t-md rounded-b-none";
  }
  if (isVisited) {
    return "bg-[#dc3545] text-white rounded-b-md rounded-t-none";
  }
  return "bg-white text-slate-800 border border-slate-300 rounded";
}

function renderExamScreen() {
  visitedSet.add(currentQIndex);
  const container = document.getElementById("quiz-container");
  const questions = activeQuiz.questions || [];
  const q = questions[currentQIndex];
  const selected = userAnswers[currentQIndex];
  const neg = activeQuiz.negative_marking ?? 0.25;

  const user = auth.currentUser;
  const candidateName = user && user.displayName ? user.displayName.split(" ")[0] : "Aspirant";
  const candidatePhoto = user && user.photoURL ? user.photoURL : "./assets/icons/logo.png";

  const m = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const s = String(secondsLeft % 60).padStart(2, "0");

  let ansCount = 0, notAnsCount = 0, notVisCount = 0, revOnlyCount = 0, ansRevCount = 0;
  questions.forEach((_, idx) => {
    const ans = userAnswers[idx] !== undefined;
    const rev = markedReviewSet.has(idx);
    const vis = visitedSet.has(idx);
    if (rev && ans) ansRevCount++;
    else if (rev) revOnlyCount++;
    else if (ans) ansCount++;
    else if (vis) notAnsCount++;
    else notVisCount++;
  });

  container.innerHTML = `
    <div class="h-screen flex flex-col bg-white text-slate-900 font-sans overflow-hidden">
      <div class="bg-[#285577] text-white px-2.5 py-1.5 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <button onclick="window.confirmExitTest()" class="px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white text-[10px] font-bold">Exit</button>
          <span class="text-xs font-bold truncate">${activeQuiz.title}</span>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button onclick="window.toggleQuestionPaper()" class="px-2 py-0.5 rounded bg-[#1b3b54] border border-white/20 text-[10px] font-semibold">
            📄 Paper
          </button>
          <span class="text-[11px] bg-black/30 px-2 py-0.5 rounded font-mono">
            ⏱ <strong id="ep-exam-timer" class="text-amber-300">${m}:${s}</strong>
          </span>
        </div>
      </div>

      <div class="flex-1 flex min-h-0 relative">
        <div class="flex-1 flex flex-col min-w-0 bg-white">
          <div class="bg-[#e8f0f7] border-b border-slate-300 px-2.5 py-1.5 flex items-center justify-between text-[10px] shrink-0">
            <div class="font-bold text-slate-800">
              Q.<span class="text-[#285577] text-xs font-extrabold">${currentQIndex + 1}</span>/${questions.length}
              <span class="ml-1.5 text-slate-600">(+<span class="text-emerald-700 font-bold">1</span> / -<span class="text-red-600 font-bold">${neg}</span>)</span>
            </div>
            <select onchange="window.setExamLang(this.value)" class="bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-800">
              <option value="BOTH" ${testLang === "BOTH" ? "selected" : ""}>EN + हिं</option>
              <option value="EN" ${testLang === "EN" ? "selected" : ""}>English</option>
              <option value="HI" ${testLang === "HI" ? "selected" : ""}>हिन्दी</option>
            </select>
          </div>

          <div class="flex-1 p-2.5 overflow-y-auto bg-white">
            <div class="border border-slate-300 rounded p-2.5 mb-2.5 bg-white">
              ${testLang !== "HI" ? `<p class="font-semibold text-slate-900 text-[13px] sm:text-[15px] leading-snug mb-1.5">${q.question_en}</p>` : ""}
              ${(testLang !== "EN" && q.question_hi) ? `<p class="text-slate-800 ${testLang === "HI" ? "font-semibold text-[13px] sm:text-[15px]" : "text-[11px] sm:text-xs border-t border-slate-200 pt-1.5"} leading-snug">${q.question_hi}</p>` : ""}
            </div>

            <div class="space-y-1.5">
              ${(q.options || []).map((opt, i) => {
                const isSelected = selected === i;
                return `
                  <label onclick="window.selectOption(${i})" class="w-full p-2.5 rounded border cursor-pointer flex items-center gap-2 transition ${
                    isSelected
                      ? "bg-[#e7f3ff] border-[#337ab7] text-slate-950 font-bold"
                      : "bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
                  }">
                    <span class="w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                      isSelected ? "border-[#337ab7]" : "border-slate-400"
                    }">
                      ${isSelected ? `<span class="w-2 h-2 rounded-full bg-[#337ab7]"></span>` : ""}
                    </span>
                    <span class="text-[11px] font-bold text-slate-500">(${i + 1})</span>
                    <span class="text-xs leading-snug">${opt}</span>
                  </label>`;
              }).join("")}
            </div>
          </div>

          <div class="bg-[#f1f5f9] border-t border-slate-300 p-1.5 flex items-center justify-between gap-1 shrink-0">
            <button onclick="window.markReviewAndNext()" class="px-2 py-2 rounded bg-white border border-slate-400 text-slate-800 text-[10px] font-bold active:bg-slate-200">
              Review & Next
            </button>
            <button onclick="window.clearResponse()" class="px-2 py-2 rounded bg-white border border-slate-400 text-slate-800 text-[10px] font-bold active:bg-slate-200">
              Clear
            </button>
            <button onclick="window.saveAndNext()" class="flex-1 py-2 rounded bg-[#337ab7] hover:bg-[#285577] text-white text-[11px] font-extrabold">
              Save & Next
            </button>
          </div>
        </div>

        <button onclick="window.toggleSidePalette()" title="Toggle Question Palette" class="w-4 bg-slate-800 text-white flex items-center justify-center text-[10px] font-bold shrink-0 border-l border-slate-400">
          ${isPaletteCollapsed ? "◀" : "▶"}
        </button>

        ${!isPaletteCollapsed ? `
          <div class="w-[126px] sm:w-56 bg-[#e8f0f7] border-l border-slate-300 flex flex-col shrink-0">
            <div class="bg-[#f8fafc] p-1.5 border-b border-slate-300 flex items-center gap-1.5 shrink-0">
              <img src="${candidatePhoto}" alt="User" class="w-6 h-6 rounded border border-slate-400 object-cover bg-white shrink-0" />
              <div class="min-w-0 leading-tight">
                <p class="text-[10px] font-extrabold text-slate-900 truncate">${candidateName}</p>
                <p class="text-[8px] text-slate-500 truncate">${activeQuiz.category || "ExamPulse"}</p>
              </div>
            </div>

            <div class="bg-white p-1.5 border-b border-slate-300 grid grid-cols-2 gap-1 text-[9px] font-bold text-slate-700 shrink-0">
              <div class="flex items-center gap-1">
                <span class="w-4 h-4 bg-[#28a745] text-white rounded-t flex items-center justify-center text-[9px]">${ansCount}</span> Ans
              </div>
              <div class="flex items-center gap-1">
                <span class="w-4 h-4 bg-[#dc3545] text-white rounded-b flex items-center justify-center text-[9px]">${notAnsCount}</span> Skip
              </div>
              <div class="flex items-center gap-1">
                <span class="w-4 h-4 bg-white text-slate-800 border border-slate-300 rounded flex items-center justify-center text-[9px]">${notVisCount}</span> Left
              </div>
              <div class="flex items-center gap-1">
                <span class="w-4 h-4 bg-[#5b2c83] text-white rounded-full flex items-center justify-center text-[9px]">${revOnlyCount + ansRevCount}</span> Rev
              </div>
            </div>

            <div class="bg-[#337ab7] text-white px-2 py-1 text-[9px] font-bold uppercase tracking-wide shrink-0">
              Question Palette
            </div>

            <div class="flex-1 p-1.5 overflow-y-auto grid grid-cols-3 sm:grid-cols-4 gap-1.5 content-start">
              ${questions.map((_, idx) => `
                <button onclick="window.jumpToQuestion(${idx})" class="h-7 text-[11px] font-extrabold flex items-center justify-center transition ${getPaletteBtnStyle(idx)} ${idx === currentQIndex ? "ring-2 ring-slate-950" : ""}">
                  ${idx + 1}
                </button>
              `).join("")}
            </div>

            <div class="p-1.5 bg-white border-t border-slate-300 shrink-0">
              <button onclick="window.submitQuiz(false)" class="w-full py-2 rounded bg-[#28a745] hover:bg-emerald-700 text-white text-[11px] font-extrabold uppercase tracking-wide shadow-xs">
                Submit
              </button>
            </div>
          </div>
        ` : ""}
      </div>

      ${isPaperViewOpen ? `
        <div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div class="bg-white w-full max-w-xl max-h-[85vh] rounded-lg overflow-hidden flex flex-col border border-slate-400">
            <div class="bg-[#285577] text-white px-4 py-2.5 flex items-center justify-between">
              <span class="text-xs font-bold">ExamPulse — Full Question Paper</span>
              <button onclick="window.toggleQuestionPaper()" class="px-2 py-0.5 rounded bg-white/20 text-xs font-bold">Close ✕</button>
            </div>
            <div class="p-4 overflow-y-auto space-y-3 text-xs">
              ${questions.map((item, idx) => `
                <div class="border-b border-slate-200 pb-2.5">
                  <p class="font-bold text-slate-900">Q.${idx + 1}) ${item.question_en}</p>
                  ${item.question_hi ? `<p class="text-slate-600 mt-0.5">${item.question_hi}</p>` : ""}
                </div>
              `).join("")}
            </div>
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

window.toggleSidePalette = function() {
  isPaletteCollapsed = !isPaletteCollapsed;
  renderExamScreen();
};

window.toggleQuestionPaper = function() {
  isPaperViewOpen = !isPaperViewOpen;
  renderExamScreen();
};

window.setExamLang = function(val) {
  testLang = val;
  renderExamScreen();
};

window.jumpToQuestion = function(idx) {
  recordTimeSpent();
  currentQIndex = idx;
  renderExamScreen();
};

window.selectOption = function(optIndex) {
  userAnswers[currentQIndex] = optIndex;
  renderExamScreen();
};

window.clearResponse = function() {
  delete userAnswers[currentQIndex];
  markedReviewSet.delete(currentQIndex);
  renderExamScreen();
};

window.saveAndNext = function() {
  recordTimeSpent();
  if (currentQIndex < (activeQuiz.questions || []).length - 1) {
    currentQIndex++;
  }
  renderExamScreen();
};

window.markReviewAndNext = function() {
  recordTimeSpent();
  markedReviewSet.add(currentQIndex);
  if (currentQIndex < (activeQuiz.questions || []).length - 1) {
    currentQIndex++;
  }
  renderExamScreen();
};

window.confirmExitTest = function() {
  if (confirm("Are you sure you want to exit the exam? Your responses will be lost.")) {
    renderQuizHub();
    toggleExamFocusMode(false);
    if (timerInterval) clearInterval(timerInterval);
  }
};

async function syncScoreToLeaderboard(payload) {
  const user = auth.currentUser;
  if (!user || !payload || payload.quizId === "mistake_vault") return false;

  try {
    await addDoc(collection(db, "test_results"), {
      uid: user.uid,
      name: user.displayName || "Aspirant",
      photo: user.photoURL || "",
      quizId: payload.quizId,
      quizTitle: payload.quizTitle,
      score: Number(payload.score),
      total: Number(payload.total),
      accuracy: Number(payload.accuracy),
      timeUsedSecs: Number(payload.timeUsedSecs),
      createdAt: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.warn("Leaderboard sync error:", err.message);
    return false;
  }
}

async function renderLeaderboardSection(quizId, targetElementId) {
  const box = document.getElementById(targetElementId);
  if (!box) return;
  box.innerHTML = `<p class="text-center text-xs text-slate-400 py-4">Loading All-India Rankings...</p>`;

  try {
    const q = query(
      collection(db, "test_results"),
      where("quizId", "==", quizId),
      limit(40)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      box.innerHTML = `<p class="text-center text-xs text-slate-500 dark:text-slate-400 py-4">No scores submitted yet. Be the first Rank #1!</p>`;
      return;
    }

    const bestByUser = new Map();
    snap.docs.forEach(d => {
      const r = d.data();
      const prev = bestByUser.get(r.uid);
      if (!prev || r.score > prev.score || (r.score === prev.score && r.timeUsedSecs < prev.timeUsedSecs)) {
        bestByUser.set(r.uid, r);
      }
    });

    const ranked = Array.from(bestByUser.values())
      .sort((a, b) => b.score - a.score || b.accuracy - a.accuracy || a.timeUsedSecs - b.timeUsedSecs)
      .slice(0, 10);

    const currentUid = auth.currentUser ? auth.currentUser.uid : null;

    box.innerHTML = ranked.map((r, idx) => {
      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`;
      const isMe = currentUid && r.uid === currentUid;
      return `
        <div class="flex items-center justify-between py-2 px-2.5 rounded-xl mb-1.5 ${
          isMe ? "bg-amber-50 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/40" : "bg-slate-50 dark:bg-slate-800/60"
        }">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-6 text-center font-extrabold text-xs ${idx < 3 ? "text-base" : "text-slate-500"}">${medal}</span>
            <img src="${r.photo || "./assets/icons/logo.png"}" alt="" class="w-6 h-6 rounded-full object-cover border border-slate-300 shrink-0" />
            <div class="min-w-0">
              <p class="text-xs font-bold text-slate-900 dark:text-white truncate">${r.name} ${isMe ? "(You)" : ""}</p>
              <p class="text-[10px] text-slate-500 dark:text-slate-400">${r.accuracy}% Acc • ${r.timeUsedSecs}s</p>
            </div>
          </div>
          <div class="text-right shrink-0">
            <span class="px-2 py-0.5 rounded-lg bg-[#285577] text-white text-xs font-extrabold">${Number(r.score).toFixed(2)}</span>
            <span class="text-[10px] text-slate-400">/${r.total}</span>
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    box.innerHTML = `<p class="text-center text-xs text-red-500 py-3">Could not load leaderboard: ${err.message}</p>`;
  }
}

window.openStandaloneLeaderboard = function(quizId, quizTitle) {
  const container = document.getElementById("quiz-container");
  container.innerHTML = `
    <div class="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
      <div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-3">
        <div>
          <span class="text-[10px] font-extrabold uppercase text-amber-600">🏆 All-India Leaderboard</span>
          <h3 class="font-bold text-sm text-slate-900 dark:text-white mt-0.5">${quizTitle}</h3>
        </div>
        <button onclick="window.reloadQuizList()" class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200">← Back</button>
      </div>
      <div id="standalone-lb-list"></div>
    </div>
  `;
  renderLeaderboardSection(quizId, "standalone-lb-list");
};

window.signInAndSyncScore = async function() {
  try {
    await signInWithPopup(auth, provider);
    if (lastResultPayload) {
      const saved = await syncScoreToLeaderboard(lastResultPayload);
      if (saved) {
        const banner = document.getElementById("guest-sync-banner");
        if (banner) banner.innerHTML = `<p class="text-xs font-bold text-emerald-400 text-center">✅ Score synced to All-India Leaderboard!</p>`;
        renderLeaderboardSection(lastResultPayload.quizId, "post-test-lb-list");
      }
    }
  } catch (err) {
    alert("Sign-in cancelled or failed: " + err.message);
  }
};

window.submitQuiz = async function(isAutoSubmit = false) {
  const questions = activeQuiz.questions || [];
  const answeredCount = Object.keys(userAnswers).length;
  if (!isAutoSubmit) {
    if (!confirm(`Exam Summary:\nTotal Questions: ${questions.length}\nAnswered: ${answeredCount}\nNot Answered: ${questions.length - answeredCount}\n\nClick OK to finally submit your exam.`)) {
      return;
    }
  }

  recordTimeSpent();
  if (timerInterval) clearInterval(timerInterval);
  isPaperViewOpen = false;
  toggleExamFocusMode(false);

  const negMark = activeQuiz.negative_marking ?? 0.25;
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  const wrongQuestionsList = [];

  questions.forEach((q, idx) => {
    if (userAnswers[idx] === undefined) {
      skipped++;
    } else if (userAnswers[idx] === q.correct_index) {
      correct++;
    } else {
      wrong++;
      wrongQuestionsList.push(q);
    }
  });

  saveToMistakeVault(wrongQuestionsList);
  const earnedXP = correct * 5;
  awardQuizXP(earnedXP);

  const rawScore = (correct * 1) - (wrong * negMark);
  const finalScore = Math.max(0, rawScore).toFixed(2);
  const attempted = correct + wrong;
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
  const timeUsedSecs = Math.max(1, totalDurationSecs - secondsLeft);
  const avgSecPerQ = attempted > 0 ? Math.round(timeUsedSecs / attempted) : 0;

  lastResultPayload = {
    quizId: activeQuizId,
    quizTitle: activeQuiz.title,
    score: finalScore,
    total: questions.length,
    accuracy,
    timeUsedSecs
  };

  let isSynced = false;
  if (auth.currentUser && activeQuizId !== "mistake_vault") {
    isSynced = await syncScoreToLeaderboard(lastResultPayload);
  }

  const container = document.getElementById("quiz-container");

  container.innerHTML = `
    <div class="bg-gradient-to-br from-[#285577] via-slate-900 to-slate-950 text-white rounded-3xl p-5 mb-4 shadow-lg border border-slate-800">
      <div class="flex items-center justify-between mb-2">
        <span class="text-[10px] uppercase tracking-wider text-amber-400 font-extrabold">📊 ExamPulse Scorecard</span>
        <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold">+${earnedXP} XP Earned</span>
      </div>

      <div class="text-center my-3">
        <h2 class="text-4xl font-black text-white">${finalScore} <span class="text-base font-normal text-slate-300">/ ${questions.length}</span></h2>
        <p class="text-xs text-slate-300 mt-1">${activeQuiz.title}</p>
      </div>

      <div class="grid grid-cols-3 gap-2 mt-4 text-center">
        <div class="bg-emerald-500/15 border border-emerald-500/30 rounded-2xl p-2.5">
          <p class="font-black text-emerald-400 text-lg">${correct}</p>
          <p class="text-[10px] text-slate-200 font-semibold">Correct (+1)</p>
        </div>
        <div class="bg-rose-500/15 border border-rose-500/30 rounded-2xl p-2.5">
          <p class="font-black text-rose-400 text-lg">${wrong}</p>
          <p class="text-[10px] text-slate-200 font-semibold">Wrong (-${negMark})</p>
        </div>
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-2.5">
          <p class="font-black text-slate-200 text-lg">${skipped}</p>
          <p class="text-[10px] text-slate-300 font-semibold">Skipped (0)</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 mt-2.5 text-center">
        <div class="bg-white/10 rounded-xl p-2.5">
          <p class="text-xs font-extrabold text-amber-300">${accuracy}%</p>
          <p class="text-[10px] text-slate-300">Accuracy Rate</p>
        </div>
        <div class="bg-white/10 rounded-xl p-2.5">
          <p class="text-xs font-extrabold text-sky-300">${avgSecPerQ}s / Q</p>
          <p class="text-[10px] text-slate-300">Avg. Speed</p>
        </div>
      </div>

      ${activeQuizId !== "mistake_vault" ? `
        <div id="guest-sync-banner" class="mt-3 p-2.5 rounded-xl bg-white/10 text-center">
          ${isSynced
            ? `<p class="text-xs font-bold text-emerald-300">✅ Rank Synced to All-India Leaderboard</p>`
            : `<button onclick="window.signInAndSyncScore()" class="w-full py-2 rounded-lg bg-amber-400 text-slate-950 text-xs font-extrabold">🔑 Sign In to Publish Your Rank</button>`
          }
        </div>
      ` : ""}

      <div class="grid ${wrong > 0 ? "grid-cols-2" : "grid-cols-1"} gap-2 mt-3">
        <button onclick="window.reloadQuizList()" class="py-3 rounded-xl bg-white text-slate-900 text-xs font-extrabold">
          ← All Tests
        </button>
        ${wrong > 0 ? `
          <button onclick="window.startMistakeVaultTest()" class="py-3 rounded-xl bg-rose-500 text-white text-xs font-extrabold">
            Retry ${wrong} Wrong Qs
          </button>` : ""}
      </div>
    </div>

    ${activeQuizId !== "mistake_vault" ? `
      <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm mb-4">
        <div class="flex items-center justify-between mb-2.5">
          <h3 class="font-extrabold text-xs uppercase text-amber-600 tracking-wider">🏆 Live All-India Top 10</h3>
          <span class="text-[10px] text-slate-400">Real-Time Rank</span>
        </div>
        <div id="post-test-lb-list"></div>
      </div>
    ` : ""}

    <h3 class="font-extrabold text-xs uppercase text-slate-500 dark:text-slate-400 mb-3 tracking-wider">Detailed Answer Key & Explanations</h3>
    ${questions.map((q, idx) => {
      const userAns = userAnswers[idx];
      const isRight = userAns === q.correct_index;
      const qTime = questionTimes[idx] || 0;
      return `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border ${isRight ? "border-emerald-200 dark:border-emerald-800" : userAns === undefined ? "border-slate-200 dark:border-slate-800" : "border-rose-200 dark:border-rose-800"} mb-3 shadow-xs">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
              isRight ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : userAns === undefined ? "bg-slate-100 dark:bg-slate-800 text-slate-500" : "bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300"
            }">
              Q${idx + 1} • ${isRight ? "Correct" : userAns === undefined ? "Skipped" : "Incorrect"}
            </span>
            <span class="text-[10px] text-slate-400">⏱ ${qTime}s</span>
          </div>
          <p class="text-xs font-bold text-slate-900 dark:text-white leading-relaxed mb-2">${q.question_en}</p>
          <p class="text-[11px] mb-1">
            <span class="font-semibold text-slate-500">Your Answer:</span>
            <span class="${userAns === undefined ? "text-slate-400" : isRight ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-rose-600 dark:text-rose-400 font-bold"}">
              ${userAns === undefined ? "Not Attempted" : q.options[userAns]}
            </span>
          </p>
          <p class="text-[11px] mb-2">
            <span class="font-semibold text-slate-500">Correct Answer:</span>
            <span class="text-emerald-700 dark:text-emerald-400 font-bold">${q.options[q.correct_index]}</span>
          </p>
          <div class="bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3 border border-slate-200/70 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
            <strong class="text-slate-900 dark:text-white">Explanation:</strong> ${q.explanation_en || "No explanation provided."}
          </div>
        </div>`;
    }).join("")}
  `;

  if (activeQuizId !== "mistake_vault") {
    renderLeaderboardSection(activeQuizId, "post-test-lb-list");
  }
};

window.reloadQuizList = loadQuizList;
