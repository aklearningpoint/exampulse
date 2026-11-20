import { db, collection, getDocs, query, orderBy, limit, doc, getDoc } from "../../core/firebase-config.js";

let activeQuiz = null;
let currentQIndex = 0;
let userAnswers = {};
let timerInterval = null;
let secondsLeft = 0;

export async function loadQuizList() {
  const container = document.getElementById("quiz-container");
  container.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">Loading Mock Tests...</div>`;

  try {
    const q = query(collection(db, "quizzes"), orderBy("date", "desc"), limit(15));
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = `
        <div class="bg-white rounded-2xl p-6 text-center border border-slate-200">
          <p class="font-bold text-slate-800">No Quizzes Available Yet</p>
          <p class="text-xs text-slate-500 mt-1">Published daily tests will appear here automatically.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-extrabold text-sm text-slate-800 uppercase tracking-wide">Available Practice Tests</h2>
        <span class="text-[11px] text-slate-400">${snap.size} Tests</span>
      </div>
      ${snap.docs.map(d => {
        const quiz = d.data();
        const qCount = (quiz.questions || []).length;
        return `
          <div class="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm mb-3 flex items-center justify-between">
            <div>
              <span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase">${quiz.category || "Daily CA"}</span>
              <h3 class="font-bold text-slate-900 text-sm mt-1">${quiz.title}</h3>
              <p class="text-[11px] text-slate-500 mt-0.5">${qCount} Questions • ${quiz.duration_mins || 5} Mins • -${quiz.negative_marking || 0.25} Negative</p>
            </div>
            <button onclick="window.startQuiz('${d.id}')" class="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold active:scale-95 transition">
              Start Test
            </button>
          </div>`;
      }).join("")}
    `;
  } catch (err) {
    container.innerHTML = `<div class="text-red-500 text-xs p-4">Error loading quizzes: ${err.message}</div>`;
  }
}

window.startQuiz = async function(quizId) {
  const container = document.getElementById("quiz-container");
  container.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">Preparing Test Environment...</div>`;

  const snap = await getDoc(doc(db, "quizzes", quizId));
  if (!snap.exists()) return alert("Quiz not found.");

  activeQuiz = snap.data();
  currentQIndex = 0;
  userAnswers = {};
  secondsLeft = (activeQuiz.duration_mins || 5) * 60;

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    secondsLeft--;
    const timerEl = document.getElementById("quiz-timer");
    if (timerEl) {
      const m = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
      const s = String(secondsLeft % 60).padStart(2, "0");
      timerEl.innerText = `${m}:${s}`;
    }
    if (secondsLeft <= 0) {
      clearInterval(timerInterval);
      window.submitQuiz();
    }
  }, 1000);

  renderQuestion();
};

function renderQuestion() {
  const container = document.getElementById("quiz-container");
  const questions = activeQuiz.questions || [];
  const q = questions[currentQIndex];
  const selected = userAnswers[currentQIndex];

  const m = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const s = String(secondsLeft % 60).padStart(2, "0");

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <!-- Quiz Header -->
      <div class="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <span class="text-xs font-bold text-amber-400">⏱ <span id="quiz-timer">${m}:${s}</span></span>
        <span class="text-xs font-semibold">Question ${currentQIndex + 1} / ${questions.length}</span>
        <button onclick="window.submitQuiz()" class="px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 text-xs font-extrabold">Submit</button>
      </div>

      <!-- Question Body -->
      <div class="p-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600">${q.exam_tag || "All Exams"}</span>
        </div>
        <p class="font-bold text-slate-900 text-sm leading-relaxed mb-1">${q.question_en}</p>
        ${q.question_hi ? `<p class="text-xs text-slate-600 leading-relaxed mb-4">${q.question_hi}</p>` : `<div class="mb-4"></div>`}

        <!-- Options -->
        <div class="space-y-2.5">
          ${(q.options || []).map((opt, i) => {
            const isSelected = selected === i;
            return `
              <button onclick="window.selectOption(${i})" class="w-full text-left p-3.5 rounded-xl border text-xs font-medium transition flex items-center gap-3 ${
                isSelected
                  ? "bg-blue-50 border-blue-600 text-blue-950 font-bold"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }">
                <span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  isSelected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                }">${String.fromCharCode(65 + i)}</span>
                <span>${opt}</span>
              </button>`;
          }).join("")}
        </div>
      </div>

      <!-- Footer Navigation -->
      <div class="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between">
        <button onclick="window.prevQuestion()" ${currentQIndex === 0 ? "disabled" : ""} class="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 disabled:opacity-40">
          ← Previous
        </button>
        ${currentQIndex < questions.length - 1
          ? `<button onclick="window.nextQuestion()" class="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">Next →</button>`
          : `<button onclick="window.submitQuiz()" class="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">Finish & Submit</button>`
        }
      </div>
    </div>
  `;
}

window.selectOption = function(optIndex) {
  userAnswers[currentQIndex] = optIndex;
  renderQuestion();
};

window.nextQuestion = function() {
  if (currentQIndex < (activeQuiz.questions || []).length - 1) {
    currentQIndex++;
    renderQuestion();
  }
};

window.prevQuestion = function() {
  if (currentQIndex > 0) {
    currentQIndex--;
    renderQuestion();
  }
};

window.submitQuiz = function() {
  if (timerInterval) clearInterval(timerInterval);
  const questions = activeQuiz.questions || [];
  const negMark = activeQuiz.negative_marking ?? 0.25;

  let correct = 0;
  let wrong = 0;
  let skipped = 0;

  questions.forEach((q, idx) => {
    if (userAnswers[idx] === undefined) {
      skipped++;
    } else if (userAnswers[idx] === q.correct_index) {
      correct++;
    } else {
      wrong++;
    }
  });

  const finalScore = Math.max(0, (correct * 1) - (wrong * negMark)).toFixed(2);
  const container = document.getElementById("quiz-container");

  container.innerHTML = `
    <!-- Result Summary Card -->
    <div class="bg-slate-900 text-white rounded-2xl p-5 mb-4 text-center">
      <p class="text-xs uppercase tracking-wider text-amber-400 font-bold">Test Result Summary</p>
      <h2 class="text-3xl font-black mt-1">${finalScore} <span class="text-sm font-normal text-slate-400">/ ${questions.length}</span></h2>
      <div class="grid grid-cols-3 gap-2 mt-4 text-xs">
        <div class="bg-emerald-950/80 border border-emerald-700/50 rounded-xl p-2">
          <p class="font-bold text-emerald-400 text-base">${correct}</p>
          <p class="text-[10px] text-slate-300">Correct</p>
        </div>
        <div class="bg-red-950/80 border border-red-700/50 rounded-xl p-2">
          <p class="font-bold text-red-400 text-base">${wrong}</p>
          <p class="text-[10px] text-slate-300">Wrong (-${negMark})</p>
        </div>
        <div class="bg-slate-800 rounded-xl p-2">
          <p class="font-bold text-slate-200 text-base">${skipped}</p>
          <p class="text-[10px] text-slate-400">Skipped</p>
        </div>
      </div>
      <button onclick="window.reloadQuizList()" class="mt-4 w-full py-2.5 rounded-xl bg-white text-slate-900 text-xs font-bold">Back to All Tests</button>
    </div>

    <!-- Detailed Solutions -->
    <h3 class="font-extrabold text-xs uppercase text-slate-500 mb-3">Detailed Solutions & Explanations</h3>
    ${questions.map((q, idx) => {
      const userAns = userAnswers[idx];
      const isRight = userAns === q.correct_index;
      return `
        <div class="bg-white rounded-2xl p-4 border ${isRight ? "border-emerald-200" : "border-slate-200"} mb-3">
          <p class="text-xs font-bold text-slate-900 mb-2">Q${idx + 1}. ${q.question_en}</p>
          <p class="text-[11px] mb-1">
            <span class="font-semibold text-slate-500">Your Answer:</span>
            <span class="${userAns === undefined ? "text-slate-400" : isRight ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}">
              ${userAns === undefined ? "Skipped" : q.options[userAns]}
            </span>
          </p>
          <p class="text-[11px] mb-2">
            <span class="font-semibold text-slate-500">Correct Answer:</span>
            <span class="text-emerald-700 font-bold">${q.options[q.correct_index]}</span>
          </p>
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-200/70 text-[11px] text-slate-700 leading-relaxed">
            <strong class="text-slate-900">Explanation:</strong> ${q.explanation_en || "No explanation provided."}
          </div>
        </div>`;
    }).join("")}
  `;
};

window.reloadQuizList = loadQuizList;
