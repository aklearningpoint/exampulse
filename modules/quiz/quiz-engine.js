import { auth, db, collection, getDocs, query, orderBy, limit, doc, getDoc } from "../../core/firebase-config.js";

let activeQuiz = null;
let currentQIndex = 0;
let userAnswers = {};
let visitedSet = new Set();
let markedReviewSet = new Set();
let questionTimes = {};
let lastTickTime = Date.now();
let timerInterval = null;
let secondsLeft = 0;
let totalDurationSecs = 0;
let testLang = "BOTH"; // "BOTH", "EN", "HI"
let isPaletteCollapsed = false; // Right-side palette stays open live
let isPaperViewOpen = false;

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

export async function loadQuizList() {
  toggleExamFocusMode(false);
  if (timerInterval) clearInterval(timerInterval);

  const container = document.getElementById("quiz-container");
  container.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">Loading ExamPulse Mock Tests...</div>`;

  const mistakes = getMistakeVault();

  try {
    const q = query(collection(db, "quizzes"), orderBy("date", "desc"), limit(15));
    const snap = await getDocs(q);

    const mistakeBanner = mistakes.length > 0 ? `
      <div class="bg-gradient-to-r from-rose-950 to-slate-900 text-white rounded-2xl p-4 mb-4 border border-rose-800/60 shadow-sm flex items-center justify-between">
        <div>
          <span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-extrabold uppercase">🧠 Auto-Mistake Vault</span>
          <h3 class="font-bold text-sm mt-1">Revise Weak Questions (${mistakes.length} Qs)</h3>
          <p class="text-[11px] text-slate-300 mt-0.5">Practice questions you missed in previous mock tests</p>
        </div>
        <button onclick="window.startMistakeVaultTest()" class="px-3.5 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-extrabold whitespace-nowrap active:scale-95 transition">
          Fix Mistakes →
        </button>
      </div>` : "";

    if (snap.empty) {
      container.innerHTML = mistakeBanner + `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-6 text-center border border-slate-200 dark:border-slate-800">
          <p class="font-bold text-slate-800 dark:text-slate-200">No Quizzes Available Yet</p>
          <p class="text-xs text-slate-500 mt-1">Published daily tests will appear here automatically.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      ${mistakeBanner}
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-extrabold text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wider">🖥️ ExamPulse Live Mock Tests</h2>
        <span class="text-[11px] font-semibold text-slate-400">${snap.size} Tests</span>
      </div>
      ${snap.docs.map(d => {
        const quiz = d.data();
        const qCount = (quiz.questions || []).length;
        const neg = quiz.negative_marking ?? 0.25;
        return `
          <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm mb-3 flex items-center justify-between gap-3">
            <div>
              <div class="flex items-center gap-1.5">
                <span class="px-2 py-0.5 rounded bg-[#285577] text-white text-[10px] font-bold uppercase">Live CBT</span>
                <span class="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold uppercase">${quiz.category || "Daily CA"}</span>
                <span class="text-[10px] font-semibold text-slate-400">${quiz.date || ""}</span>
              </div>
              <h3 class="font-bold text-slate-900 dark:text-white text-sm mt-1 leading-snug">${quiz.title}</h3>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">📋 ${qCount} Qs • ⏱ ${quiz.duration_mins || 5} Mins • ⚖️ +1 / -${neg}</p>
            </div>
            <button onclick="window.startQuiz('${d.id}')" class="px-4 py-2.5 rounded-xl bg-[#285577] hover:bg-[#1e425e] text-white text-xs font-extrabold whitespace-nowrap active:scale-95 transition">
              Start Exam
            </button>
          </div>`;
      }).join("")}
    `;
  } catch (err) {
    container.innerHTML = `<div class="text-red-500 text-xs p-4">Error loading quizzes: ${err.message}</div>`;
  }
}

window.startMistakeVaultTest = function() {
  const mistakes = getMistakeVault();
  if (!mistakes.length) return;
  launchExamEnvironment({
    title: "Mistake Vault Revision Test",
    category: "Weak Area Drill",
    duration_mins: Math.max(3, Math.ceil(mistakes.length * 0.6)),
    negative_marking: 0.25,
    questions: mistakes
  });
};

window.startQuiz = async function(quizId) {
  const container = document.getElementById("quiz-container");
  container.innerHTML = `<div class="text-center py-16 text-slate-500 text-sm font-semibold">Initializing ExamPulse Exam Console...</div>`;

  const snap = await getDoc(doc(db, "quizzes", quizId));
  if (!snap.exists()) return alert("Quiz not found.");

  launchExamEnvironment(snap.data());
};

function launchExamEnvironment(quizData) {
  activeQuiz = quizData;
  currentQIndex = 0;
  userAnswers = {};
  visitedSet = new Set([0]);
  markedReviewSet = new Set();
  questionTimes = {};
  lastTickTime = Date.now();
  testLang = "BOTH";
  isPaletteCollapsed = false;
  isPaperViewOpen = false;

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

// 5-State Live Palette Button Styling
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

  // 5-Category Counts
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
      <!-- 1. ExamPulse Top Exam Header -->
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

      <!-- 2. Split Workspace: Left Question Panel + Right Always-Open Palette -->
      <div class="flex-1 flex min-h-0 relative">

        <!-- LEFT PANEL: Question & Bottom Action Controls -->
        <div class="flex-1 flex flex-col min-w-0 bg-white">
          <!-- Sub-Header: Q Number, Marks & Language -->
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

          <!-- Scrollable Question & Options -->
          <div class="flex-1 p-2.5 overflow-y-auto bg-white">
            <div class="border border-slate-300 rounded p-2.5 mb-2.5 bg-white">
              ${testLang !== "HI" ? `<p class="font-semibold text-slate-900 text-[13px] sm:text-[15px] leading-snug mb-1.5">${q.question_en}</p>` : ""}
              ${(testLang !== "EN" && q.question_hi) ? `<p class="text-slate-800 ${testLang === "HI" ? "font-semibold text-[13px] sm:text-[15px]" : "text-[11px] sm:text-xs border-t border-slate-200 pt-1.5"} leading-snug">${q.question_hi}</p>` : ""}
            </div>

            <!-- Options -->
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

          <!-- Left Panel Bottom Action Bar -->
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

        <!-- COLLAPSE / EXPAND HANDLE TAB -->
        <button onclick="window.toggleSidePalette()" title="Toggle Question Palette" class="w-4 bg-slate-800 text-white flex items-center justify-center text-[10px] font-bold shrink-0 border-l border-slate-400">
          ${isPaletteCollapsed ? "◀" : "▶"}
        </button>

        <!-- RIGHT PANEL: Permanent Live Question Palette -->
        ${!isPaletteCollapsed ? `
          <div class="w-[126px] sm:w-56 bg-[#e8f0f7] border-l border-slate-300 flex flex-col shrink-0">
            <!-- Candidate Mini Profile -->
            <div class="bg-[#f8fafc] p-1.5 border-b border-slate-300 flex items-center gap-1.5 shrink-0">
              <img src="${candidatePhoto}" alt="User" class="w-6 h-6 rounded border border-slate-400 object-cover bg-white shrink-0" />
              <div class="min-w-0 leading-tight">
                <p class="text-[10px] font-extrabold text-slate-900 truncate">${candidateName}</p>
                <p class="text-[8px] text-slate-500 truncate">${activeQuiz.category || "ExamPulse"}</p>
              </div>
            </div>

            <!-- Compact Live Status Legend -->
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

            <!-- Section Banner -->
            <div class="bg-[#337ab7] text-white px-2 py-1 text-[9px] font-bold uppercase tracking-wide shrink-0">
              Question Palette
            </div>

            <!-- Live Numbered Grid (Updates Instantly on Click!) -->
            <div class="flex-1 p-1.5 overflow-y-auto grid grid-cols-3 sm:grid-cols-4 gap-1.5 content-start">
              ${questions.map((_, idx) => `
                <button onclick="window.jumpToQuestion(${idx})" class="h-7 text-[11px] font-extrabold flex items-center justify-center transition ${getPaletteBtnStyle(idx)} ${idx === currentQIndex ? "ring-2 ring-slate-950" : ""}">
                  ${idx + 1}
                </button>
              `).join("")}
            </div>

            <!-- Always-Visible Submit Button -->
            <div class="p-1.5 bg-white border-t border-slate-300 shrink-0">
              <button onclick="window.submitQuiz(false)" class="w-full py-2 rounded bg-[#28a745] hover:bg-emerald-700 text-white text-[11px] font-extrabold uppercase tracking-wide shadow-xs">
                Submit
              </button>
            </div>
          </div>
        ` : ""}

      </div>

      <!-- Full Question Paper Modal -->
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

// Instantly turns the question GREEN in the right-side palette on tap
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
    loadQuizList();
  }
};

window.submitQuiz = function(isAutoSubmit = false) {
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

      <div class="grid ${wrong > 0 ? "grid-cols-2" : "grid-cols-1"} gap-2 mt-4">
        <button onclick="window.reloadQuizList()" class="py-3 rounded-xl bg-white text-slate-900 text-xs font-extrabold">
          ← All Tests
        </button>
        ${wrong > 0 ? `
          <button onclick="window.startMistakeVaultTest()" class="py-3 rounded-xl bg-rose-500 text-white text-xs font-extrabold">
            Retry ${wrong} Wrong Qs
          </button>` : ""}
      </div>
    </div>

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
};

window.reloadQuizList = loadQuizList;
