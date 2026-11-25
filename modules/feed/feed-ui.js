import { db, collection, getDocs, query, orderBy, limit } from "../../core/firebase-config.js";

let allArticles = [];
let currentFilter = "ALL";
let currentLang = "EN";
let isSpeaking = false;

// Local Gamification & Bookmark State
const todayKey = new Date().toISOString().slice(0, 10);

function getSavedTitles() {
  try {
    return JSON.parse(localStorage.getItem("ep_saved_articles") || "[]");
  } catch {
    return [];
  }
}

function getReadToday() {
  try {
    const data = JSON.parse(localStorage.getItem("ep_daily_reads") || "{}");
    return data.date === todayKey ? (data.titles || []) : [];
  } catch {
    return [];
  }
}

function updateGamificationUI() {
  // 1. Streak Tracking
  const lastVisit = localStorage.getItem("ep_last_visit");
  let streak = parseInt(localStorage.getItem("ep_streak") || "1", 10);
  if (lastVisit && lastVisit !== todayKey) {
    const diffDays = Math.round((new Date(todayKey) - new Date(lastVisit)) / 86400000);
    streak = diffDays === 1 ? streak + 1 : 1;
  }
  localStorage.setItem("ep_last_visit", todayKey);
  localStorage.setItem("ep_streak", String(streak));

  // 2. XP & Daily Mission
  const xp = parseInt(localStorage.getItem("ep_xp") || "0", 10);
  const reads = getReadToday().length;
  const capped = Math.min(reads, 5);
  const pct = Math.round((capped / 5) * 100);

  const streakEl = document.getElementById("header-streak");
  const xpEl = document.getElementById("header-xp");
  const savedBadge = document.getElementById("saved-count-badge");
  const missionBadge = document.getElementById("mission-percent-badge");
  const missionBar = document.getElementById("mission-progress-bar");
  const missionText = document.getElementById("mission-status-text");

  if (streakEl) streakEl.innerText = streak;
  if (xpEl) xpEl.innerText = xp;
  if (savedBadge) savedBadge.innerText = getSavedTitles().length;
  if (missionBadge) missionBadge.innerText = `${capped}/5`;
  if (missionBar) missionBar.style.width = `${pct}%`;
  if (missionText) {
    missionText.innerText = capped >= 5
      ? "🎉 Daily Reading Mission Completed! (+50 XP)"
      : `Read ${5 - capped} more Current Affairs today (+50 XP)`;
  }
}

export async function loadDailyFeed() {
  updateGamificationUI();
  const container = document.getElementById("feed-container");
  container.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">Loading ExamPulse Feed...</div>`;

  try {
    const q = query(collection(db, "daily_feed"), orderBy("date", "desc"), limit(7));
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-6 text-center border border-slate-200 dark:border-slate-800 shadow-sm">
          <p class="text-slate-600 dark:text-slate-300 font-medium">No current affairs published yet.</p>
          <p class="text-xs text-slate-400 mt-1">Tap the admin key icon in the top-right corner to publish daily content.</p>
        </div>`;
      return;
    }

    allArticles = [];
    snap.docs.forEach(d => {
      const data = d.data();
      (data.articles || []).forEach(art => {
        allArticles.push({ ...art, _date: data.date });
      });
    });

    document.getElementById("feed-date-label").innerText = `Latest: ${snap.docs[0].data().date} (${allArticles.length} Posts)`;
    renderArticles();
  } catch (err) {
    container.innerHTML = `<div class="text-red-500 text-sm p-4">Error loading feed: ${err.message}</div>`;
  }
}

export function setExamFilter(exam) {
  currentFilter = exam;
  document.querySelectorAll(".exam-pill").forEach(btn => {
    if (btn.dataset.exam === exam) {
      btn.className = "exam-pill px-3.5 py-1.5 rounded-full text-xs font-semibold bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 whitespace-nowrap";
    } else {
      btn.className = "exam-pill px-3.5 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 whitespace-nowrap";
    }
  });
  renderArticles();
}

window.toggleBookmarkArticle = function(globalIdx) {
  const item = allArticles[globalIdx];
  if (!item) return;
  let saved = getSavedTitles();
  if (saved.includes(item.title_en)) {
    saved = saved.filter(t => t !== item.title_en);
  } else {
    saved.push(item.title_en);
  }
  localStorage.setItem("ep_saved_articles", JSON.stringify(saved));
  updateGamificationUI();
  renderArticles();
};

function renderArticles() {
  const container = document.getElementById("feed-container");
  const saved = getSavedTitles();
  const readToday = getReadToday();

  let filtered = allArticles;
  if (currentFilter === "SAVED") {
    filtered = allArticles.filter(a => saved.includes(a.title_en));
  } else if (currentFilter !== "ALL") {
    filtered = allArticles.filter(a => (a.exams || []).includes(currentFilter));
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="bg-white dark:bg-slate-900 rounded-2xl p-8 text-center border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs">
      ${currentFilter === "SAVED" ? "No bookmarked articles yet. Tap ☆ on any news card to save it for revision." : "No articles available for this exam category."}
    </div>`;
    return;
  }

  container.innerHTML = filtered.map((item) => {
    const globalIdx = allArticles.indexOf(item);
    const isSaved = saved.includes(item.title_en);
    const isRead = readToday.includes(item.title_en);

    return `
      <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border ${isRead ? "border-emerald-200/80 dark:border-emerald-800/60" : "border-slate-200/90 dark:border-slate-800"} shadow-sm mb-3 transition">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300">${item.category || "General"}</span>
            <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300">🔥 High Yield</span>
            <span class="text-[10px] font-medium text-slate-400">${item._date || ""}</span>
          </div>
          <button onclick="window.toggleBookmarkArticle(${globalIdx})" title="Save for Revision" class="w-7 h-7 rounded-full flex items-center justify-center text-sm ${isSaved ? "bg-amber-100 dark:bg-amber-500/20 text-amber-600" : "bg-slate-100 dark:bg-slate-800 text-slate-400"}">
            ${isSaved ? "★" : "☆"}
          </button>
        </div>

        <h3 class="font-bold text-slate-900 dark:text-white text-[15px] leading-snug mb-1">${item.title_en}</h3>
        <p class="text-slate-600 dark:text-slate-400 text-xs leading-relaxed mb-2.5">${item.title_hi || ""}</p>

        <div class="flex items-center justify-between text-[10px] text-slate-400 mb-3">
          <span>🎯 ${(item.exams || ["All Exams"]).join(" • ")}</span>
          <span>${isRead ? "✅ Read (+10 XP)" : "⏱ 1 min read"}</span>
        </div>

        <div class="flex gap-2">
          <button onclick="window.openAnalysisModal(${globalIdx})" class="flex-1 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-semibold py-2.5 rounded-xl active:scale-95 transition">
            Read 360° Analysis
          </button>
          <button onclick="window.switchTab('tests')" class="flex-1 bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 text-xs font-semibold py-2.5 rounded-xl active:scale-95 transition">
            Practice Quiz →
          </button>
        </div>
      </div>`;
  }).join("");
}

window.openAnalysisModal = function(idx) {
  const item = allArticles[idx];
  if (!item) return;

  // Award +10 XP & update daily mission on first read
  const reads = getReadToday();
  if (!reads.includes(item.title_en)) {
    reads.push(item.title_en);
    localStorage.setItem("ep_daily_reads", JSON.stringify({ date: todayKey, titles: reads }));
    const currentXp = parseInt(localStorage.getItem("ep_xp") || "0", 10);
    localStorage.setItem("ep_xp", String(currentXp + 10));
    updateGamificationUI();
    renderArticles();
  }

  currentLang = "EN";
  renderAnalysisContent(item);
  document.getElementById("analysis-modal").classList.remove("hidden");
};

window.toggleAnalysisLang = function() {
  currentLang = currentLang === "EN" ? "HI" : "EN";
  const idx = parseInt(document.getElementById("analysis-modal").dataset.idx);
  renderAnalysisContent(allArticles[idx]);
};

function renderAnalysisContent(item) {
  const modal = document.getElementById("analysis-modal");
  modal.dataset.idx = allArticles.indexOf(item);
  const isEn = currentLang === "EN";

  document.getElementById("lang-toggle-btn").innerText = isEn ? "Switch to Hindi" : "Switch to English";
  document.getElementById("modal-category").innerText = item.category || "CURRENT AFFAIRS";
  document.getElementById("modal-title").innerText = isEn ? item.title_en : (item.title_hi || item.title_en);

  const facts = isEn ? (item.key_facts_en || []) : (item.key_facts_hi || item.key_facts_en || []);
  document.getElementById("modal-facts").innerHTML = facts.map(f => `<li class="mb-1.5">• ${f}</li>`).join("");

  const staticLink = isEn ? (item.static_gk_en || "") : (item.static_gk_hi || item.static_gk_en || "");
  document.getElementById("modal-static").innerText = staticLink;
}

// 1-Tap Audio Headlines Briefing
window.toggleAudioBriefing = function() {
  if (!("speechSynthesis" in window)) {
    alert("Audio briefing is not supported on this device browser.");
    return;
  }
  const icon = document.getElementById("audio-brief-icon");
  const label = document.getElementById("audio-brief-label");

  if (isSpeaking) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
    icon.innerText = "🎧";
    label.innerText = "Listen Headlines";
    return;
  }

  const topHeadlines = allArticles.slice(0, 6).map((a, i) => `News ${i + 1}: ${a.title_en}.`).join(" ");
  if (!topHeadlines) return;

  const utter = new SpeechSynthesisUtterance(`Welcome to ExamPulse Daily Audio Briefing. ${topHeadlines}`);
  utter.lang = "en-IN";
  utter.rate = 0.95;
  utter.onend = () => {
    isSpeaking = false;
    icon.innerText = "🎧";
    label.innerText = "Listen Headlines";
  };

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
  isSpeaking = true;
  icon.innerText = "⏹️";
  label.innerText = "Stop Audio";
};
