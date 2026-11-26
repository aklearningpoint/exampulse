import { db, collection, getDocs, query, orderBy, limit, doc, getDoc } from "../../core/firebase-config.js";

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
let isPaletteOpen = false;

function toggleExamFocusMode(isExamActive) {
  const header = document.querySelector("header");
  const nav = document.querySelector("nav");
  const main = document.querySelector("main");
  if (header) header.style.display = isExamActive ? "none" : "flex";
  if (nav) nav.style.display = isExamActive ? "none" : "flex";
  if (main) {
    if (isExamActive) {
      main.classList.remove("p-3.5");
      main.classList.add("p-0");
    } else {
      main.classList.remove("p-0");
      main.classList.add("p-3.5");
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
  container.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">Loading Mock Tests...</div>`;

  const mistakes = getMistakeVault();

  try {
    const q = query(collection(db, "quizzes"), orderBy("date", "desc"), limit(15));
    const snap = await getDocs(q);

    const mistakeBanner = mistakes.length > 0 ? `
      <div class="bg-gradient-to-r from-rose-950 to-slate-900 text-white rounded-2xl p-4 mb-4 border border-rose-800/60 shadow-sm flex items-center justify-between">
        <div>
          <span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-extrabold uppercase">🧠 Auto-Mistake Vault</span>
          <h3 class="font-bold text-sm mt-1">Revise Your Weak Areas (${mistakes.length} Qs)</h3>
          <p class="text-[11px] text-slate-300 mt-0.5">Re-attempt questions you got wrong in past mocks</p>
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
        <h2 class="font-extrabold text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wider">🎯 Live CBT Mock Tests</h2>
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
                <span class="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold uppercase">${quiz.category || "Daily CA"}</span>
                <span class="text-[10px] font-semibold text-slate-400">${quiz.date || ""}</span>
              </div>
              <h3 class="font-bold text-slate-900 dark:text-white text-sm mt-1 leading-snug">${quiz.title}</h3>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">📋 ${qCount} Qs • ⏱ ${quiz.duration_mins || 5}m • ⚖️ +1 / -${neg}</p>
            </div>
            <button onclick="window.startQuiz('${d.id}')" class="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 text-xs font-extrabold whitespace-nowrap active:scale-95 transition">
              Start CBT
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
  launchCBTEnvironment({
    title: "Mistake Vault Revision Test",
    category: "Weak Area Drill",
    duration_mins: Math.max(3, Math.ceil(mistakes.length * 0.6)),
    negative_marking: 0.25,
    questions: mistakes,
    isMistakeDrill: true
  });
};

window.startQuiz = async function(quizId) {
  const container = document.getElementById("quiz-container");
  container.innerHTML = `<div class="text-center py-16 text-slate-400 text-sm font-medium">Initializing TCS iON / NTA Exam Console...</div>`;

  const snap = await getDoc(doc(db, "quizzes", quizId));
  if (!snap.exists()) return alert("Quiz not found.");

  launchCBTEnvironment(snap.data());
};

function launchCBTEnvironment(quizData) {
  activeQuiz = quizData;
  currentQIndex = 0;
  userAnswers = {};
  visitedSet = new Set([0]);
  markedReviewSet = new Set();
  questionTimes = {};
  lastTickTime = Date.now();
  testLang = "BOTH";
  isPaletteOpen = false;

  totalDurationSecs = (activeQuiz.duration_mins || 5) * 60;
  secondsLeft = totalDurationSecs;

  toggleExamFocusMode(true);

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    secondsLeft--;
    const timerEl = document.getElementById("quiz-timer");
    const timerBox = document.getElementById("quiz-timer-box");
    if (timerEl) {
      const m = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
      const s = String(secondsLeft % 60).padStart(2, "0");
      timerEl.innerText = `${m}:${s}`;
      if (secondsLeft <= 60 && timerBox) {
        timerBox.classList.add("bg-red-600", "text-white", "animate-pulse");
      }
    }
    if (secondsLeft <= 0) {
      clearInterval(timerInterval);
      window.submitQuiz(true);
    }
  }, 1000);

  renderQuestion();
}

function recordTimeSpent() {
  const now = Date.now();
  const delta = Math.round((now - lastTickTime) / 1000);
  questionTimes[currentQIndex] = (questionTimes[currentQIndex] || 0) + delta;
  lastTickTime = now;
}

function getQuestionStatusColor(idx) {
  const isAnswered = userAnswers[idx] !== undefined;
  const isMarked = markedReviewSet.has(idx);
  const isVisited = visitedSet.has(idx);

  if (isMarked && isAnswered) return "bg-purple-600 text-white ring-2 ring-emerald-400";
  if (isMarked) return "bg-purple-600 text-white";
  if (isAnswered) return "bg-emerald-600 text-white";
  if (isVisited) return "bg-rose-500 text-white";
  return "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
}

function renderQuestion() {
  visitedSet.add(currentQIndex);
  const container = document.getElementById("quiz-container");
  const questions = activeQuiz.questions || [];
  const q = questions[currentQIndex];
  const selected = userAnswers[currentQIndex];
  const isMarked = markedReviewSet.has(currentQIndex);
  const neg = activeQuiz.negative_marking ?? 0.25;

  const m = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const s = String(secondsLeft % 60).padStart(2, "0");

  // Counts for Palette Legend
  let ansCount = 0, notAnsCount = 0, revCount = 0, notVisCount = 0;
  questions.forEach((_, idx) => {
    if (markedReviewSet.has(idx)) revCount++;
    else if (userAnswers[idx] !== undefined) ansCount++;
    else if (visitedSet.has(idx)) notAnsCount++;
    else notVisCount++;
  });

  container.innerHTML = `
    <div class="min-h-screen flex flex-col bg-slate-100 dark:bg-slate-950">
      <!-- Top CBT Exam Header -->
      <div class="sticky top-0 z-40 bg-slate-900 text-white px-3.5 py-2.5 flex items-center justify-between border-b border-slate-800 shadow">
        <div class="flex items-center gap-2">
          <button onclick="window.confirmExitTest()" class="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 text-xs font-bold flex items-center justify-center" title="Exit Test">✕</button>
          <div>
            <p class="text-[11px] font-bold text-slate-200 truncate max-w-[135px]">${activeQuiz.title}</p>
            <p class="text-[9px] text-emerald-400 font-semibold">+1.0 / -${neg} Marks</p>
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <!-- Countdown Timer -->
          <div id="quiz-timer-box" class="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-amber-400 font-mono text-xs font-extrabold">
            ⏱ <span id="quiz-timer">${m}:${s}</span>
          </div>
          <!-- Question Palette Toggle -->
          <button onclick="window.toggleQuestionPalette()" class="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs font-bold flex items-center gap-1">
            <span>▦</span> <span>${currentQIndex + 1}/${questions.length}</span>
          </button>
          <!-- Submit Button -->
          <button onclick="window.submitQuiz(false)" class="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-extrabold">
            Submit
          </button>
        </div>
      </div>

      <!-- Sub-Toolbar: Question Number, Language Switch & Mark for Review -->
      <div class="bg-white dark:bg-slate-900 px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs font-extrabold text-slate-900 dark:text-white">Q.${currentQIndex + 1}</span>
          <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300">${q.exam_tag || "CBT"}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button onclick="window.cycleTestLang()" class="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[10px] font-extrabold border border-slate-200 dark:border-slate-700">
            🌐 ${testLang === "BOTH" ? "EN + हिं" : testLang === "EN" ? "English" : "हिन्दी"}
          </button>
          <button onclick="window.toggleMarkReview()" class="px-2.5 py-1 rounded-md text-[10px] font-bold border ${
            isMarked
              ? "bg-purple-600 text-white border-purple-600"
              : "bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30"
          }">
            ${isMarked ? "★ Marked" : "☆ Review"}
          </button>
        </div>
      </div>

      <!-- Collapsible NTA Question Palette Drawer -->
      ${isPaletteOpen ? `
        <div class="bg-white dark:bg-slate-900 border-b-2 border-amber-400 p-4 shadow-lg">
          <div class="flex items-center justify-between mb-2.5">
            <span class="text-xs font-extrabold uppercase text-slate-700 dark:text-slate-200">Question Palette</span>
            <button onclick="window.toggleQuestionPalette()" class="text-xs font-bold text-slate-400">Close ✕</button>
          </div>
          <!-- Legend -->
          <div class="grid grid-cols-2 gap-1.5 text-[10px] font-semibold mb-3 text-slate-600 dark:text-slate-300">
            <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-emerald-600 inline-block"></span> Answered (${ansCount})</div>
            <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-rose-500 inline-block"></span> Not Answered (${notAnsCount})</div>
            <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-purple-600 inline-block"></span> Marked Review (${revCount})</div>
            <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-slate-300 dark:bg-slate-700 inline-block"></span> Not Visited (${notVisCount})</div>
          </div>
          <!-- Number Grid -->
          <div class="grid grid-cols-6 sm:grid-cols-8 gap-2 max-h-44 overflow-y-auto">
            ${questions.map((_, idx) => `
              <button onclick="window.jumpToQuestion(${idx})" class="h-9 rounded-lg text-xs font-extrabold ${getQuestionStatusColor(idx)} ${idx === currentQIndex ? "ring-2 ring-amber-400" : ""}">
                ${idx + 1}
              </button>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <!-- Question & Options Area -->
      <div class="flex-1 p-4 pb-24 max-w-xl w-full mx-auto">
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm mb-3">
          ${testLang !== "HI" ? `<p class="font-bold text-slate-900 dark:text-white text-[15px] leading-relaxed mb-1.5">${q.question_en}</p>` : ""}
          ${(testLang !== "EN" && q.question_hi) ? `<p class="text-slate-700 dark:text-slate-300 ${testLang === "HI" ? "font-bold text-[15px]" : "text-xs"} leading-relaxed">${q.question_hi}</p>` : ""}
        </div>

        <!-- Options -->
        <div class="space-y-2.5">
          ${(q.options || []).map((opt, i) => {
            const isSelected = selected === i;
            return `
              <button onclick="window.selectOption(${i})" class="w-full text-left p-3.5 rounded-2xl border text-xs font-medium transition flex items-center gap-3 ${
                isSelected
                  ? "bg-blue-50 dark:bg-blue-500/20 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-white font-bold shadow-xs"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200"
              }">
                <span class="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-extrabold ${
                  isSelected ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                }">${String.fromCharCode(65 + i)}</span>
                <span class="leading-snug">${opt}</span>
              </button>`;
          }).join("")}
        </div>
      </div>

      <!-- Fixed Bottom CBT Control Bar -->
      <div class="fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-3.5 py-2.5 flex items-center justify-between gap-2">
        <button onclick="window.prevQuestion()" ${currentQIndex === 0 ? "disabled" : ""} class="px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold disabled:opacity-40">
          ← Prev
        </button>
        <button onclick="window.clearResponse()" ${selected === undefined ? "disabled" : ""} class="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold disabled:opacity-40">
          Clear
        </button>
        ${currentQIndex < questions.length - 1
          ? `<button onclick="window.nextQuestion()" class="flex-1 py-2.5 rounded-xl bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 text-xs font-extrabold">Save & Next →</button>`
          : `<button onclick="window.submitQuiz(false)" class="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-extrabold">Finish & Submit ✓</button>`
        }
      </div>
    </div>
  `;
}

window.toggleQuestionPalette = function() {
  isPaletteOpen = !isPaletteOpen;
  renderQuestion();
};

window.jumpToQuestion = function(idx) {
  recordTimeSpent();
  currentQIndex = idx;
  isPaletteOpen = false;
  renderQuestion();
};

window.cycleTestLang = function() {
  testLang = testLang === "BOTH" ? "EN" : testLang === "EN" ? "HI" : "BOTH";
  renderQuestion();
};

window.toggleMarkReview = function() {
  if (markedReviewSet.has(currentQIndex)) {
    markedReviewSet.delete(currentQIndex);
  } else {
    markedReviewSet.add(currentQIndex);
  }
  renderQuestion();
};

window.selectOption = function(optIndex) {
  userAnswers[currentQIndex] = optIndex;
  renderQuestion();
};

window.clearResponse = function() {
  delete userAnswers[currentQIndex];
  renderQuestion();
};

window.nextQuestion = function() {
  if (currentQIndex < (activeQuiz.questions || []).length - 1) {
    recordTimeSpent();
    currentQIndex++;
    renderQuestion();
  }
};

window.prevQuestion = function() {
  if (currentQIndex > 0) {
    recordTimeSpent();
    currentQIndex--;
    renderQuestion();
  }
};

window.confirmExitTest = function() {
  if (confirm("Exit this mock test? Your current progress will not be submitted.")) {
    loadQuizList();
  }
};

window.submitQuiz = function(isAutoSubmit = false) {
  const questions = activeQuiz.questions || [];
  if (!isAutoSubmit) {
    const answeredCount = Object.keys(userAnswers).length;
    if (!confirm(`Submit Test?\nAnswered: ${answeredCount} / ${questions.length}\nUnanswered: ${questions.length - answeredCount}`)) {
      return;
    }
  }

  recordTimeSpent();
  if (timerInterval) clearInterval(timerInterval);
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

  // Save wrong questions to Mistake Vault & award XP
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
    <!-- Deep Performance Scorecard -->
    <div class="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-white rounded-3xl p-5 mb-4 shadow-lg border border-slate-800">
      <div class="flex items-center justify-between mb-2">
        <span class="text-[10px] uppercase tracking-wider text-amber-400 font-extrabold">📊 CBT Performance Report</span>
        <span class="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] font-bold">+${earnedXP} XP Earned</span>
      </div>

      <div class="text-center my-3">
        <h2 class="text-4xl font-black text-white">${finalScore} <span class="text-base font-normal text-slate-400">/ ${questions.length}</span></h2>
        <p class="text-xs text-slate-400 mt-1">${activeQuiz.title}</p>
      </div>

      <!-- 3-Column Result Breakdown -->
      <div class="grid grid-cols-3 gap-2 mt-4 text-center">
        <div class="bg-emerald-500/15 border border-emerald-500/30 rounded-2xl p-2.5">
          <p class="font-black text-emerald-400 text-lg">${correct}</p>
          <p class="text-[10px] text-slate-300 font-semibold">Correct (+1)</p>
        </div>
        <div class="bg-rose-500/15 border border-rose-500/30 rounded-2xl p-2.5">
          <p class="font-black text-rose-400 text-lg">${wrong}</p>
          <p class="text-[10px] text-slate-300 font-semibold">Wrong (-${negMark})</p>
        </div>
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-2.5">
          <p class="font-black text-slate-200 text-lg">${skipped}</p>
          <p class="text-[10px] text-slate-400 font-semibold">Skipped (0)</p>
        </div>
      </div>

      <!-- Speed & Accuracy Metrics -->
      <div class="grid grid-cols-2 gap-2 mt-2.5 text-center">
        <div class="bg-white/5 rounded-xl p-2.5 border border-white/10">
          <p class="text-xs font-extrabold text-amber-300">${accuracy}%</p>
          <p class="text-[10px] text-slate-400">Accuracy Rate</p>
        </div>
        <div class="bg-white/5 rounded-xl p-2.5 border border-white/10">
          <p class="text-xs font-extrabold text-sky-300">${avgSecPerQ}s / Q</p>
          <p class="text-[10px] text-slate-400">Avg. Speed</p>
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

    <!-- Detailed Solutions & Explanations -->
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
