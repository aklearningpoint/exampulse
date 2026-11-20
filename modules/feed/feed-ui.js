import { db, doc, getDoc, collection, getDocs, query, orderBy, limit } from "../../core/firebase-config.js";

let currentArticles = [];
let currentFilter = "ALL";
let currentLang = "EN";

export async function loadDailyFeed(dateStr = null) {
  const container = document.getElementById("feed-container");
  container.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">Loading ExamPulse Feed...</div>`;

  try {
    let targetDoc = null;
    if (dateStr) {
      const snap = await getDoc(doc(db, "daily_feed", dateStr));
      if (snap.exists()) targetDoc = snap.data();
    } else {
      const q = query(collection(db, "daily_feed"), orderBy("date", "desc"), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) targetDoc = snap.docs[0].data();
    }

    if (!targetDoc || !targetDoc.articles) {
      container.innerHTML = `
        <div class="bg-white rounded-2xl p-6 text-center border border-slate-200 shadow-sm">
          <p class="text-slate-600 font-medium">No current affairs published yet.</p>
          <p class="text-xs text-slate-400 mt-1">Tap the admin key icon in the top-right corner to publish daily content.</p>
        </div>`;
      return;
    }

    document.getElementById("feed-date-label").innerText = `Date: ${targetDoc.date}`;
    currentArticles = targetDoc.articles;
    renderArticles();
  } catch (err) {
    container.innerHTML = `<div class="text-red-500 text-sm p-4">Error loading feed: ${err.message}</div>`;
  }
}

export function setExamFilter(exam) {
  currentFilter = exam;
  document.querySelectorAll(".exam-pill").forEach(btn => {
    if (btn.dataset.exam === exam) {
      btn.className = "exam-pill px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-900 text-white whitespace-nowrap";
    } else {
      btn.className = "exam-pill px-4 py-1.5 rounded-full text-xs font-medium bg-white text-slate-600 border border-slate-200 whitespace-nowrap";
    }
  });
  renderArticles();
}

function renderArticles() {
  const container = document.getElementById("feed-container");
  const filtered = currentFilter === "ALL"
    ? currentArticles
    : currentArticles.filter(a => (a.exams || []).includes(currentFilter));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-slate-500 text-sm">No articles available for this exam category today.</div>`;
    return;
  }

  container.innerHTML = filtered.map((item, idx) => `
    <div class="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm mb-3">
      <div class="flex items-center justify-between mb-2">
        <span class="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700">${item.category || "General"}</span>
        <span class="text-[11px] text-slate-400">${(item.exams || ["All Exams"]).join(" • ")}</span>
      </div>
      <h3 class="font-bold text-slate-900 text-[15px] leading-snug mb-1">${item.title_en}</h3>
      <p class="text-slate-600 text-xs leading-relaxed mb-3">${item.title_hi || ""}</p>
      <div class="flex gap-2">
        <button onclick="window.openAnalysisModal(${idx})" class="flex-1 bg-slate-900 text-white text-xs font-semibold py-2.5 rounded-xl active:scale-95 transition">
          Read Analysis
        </button>
        <button onclick="window.switchTab('tests')" class="flex-1 bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold py-2.5 rounded-xl active:scale-95 transition">
          Take Quiz
        </button>
      </div>
    </div>
  `).join("");
}

window.openAnalysisModal = function(idx) {
  const item = currentArticles[idx];
  if (!item) return;
  currentLang = "EN";
  renderAnalysisContent(item);
  document.getElementById("analysis-modal").classList.remove("hidden");
};

window.toggleAnalysisLang = function() {
  currentLang = currentLang === "EN" ? "HI" : "EN";
  const idx = parseInt(document.getElementById("analysis-modal").dataset.idx);
  renderAnalysisContent(currentArticles[idx]);
};

function renderAnalysisContent(item) {
  const modal = document.getElementById("analysis-modal");
  modal.dataset.idx = currentArticles.indexOf(item);
  const isEn = currentLang === "EN";

  document.getElementById("lang-toggle-btn").innerText = isEn ? "Switch to Hindi" : "Switch to English";
  document.getElementById("modal-category").innerText = item.category || "CURRENT AFFAIRS";
  document.getElementById("modal-title").innerText = isEn ? item.title_en : (item.title_hi || item.title_en);

  const facts = isEn ? (item.key_facts_en || []) : (item.key_facts_hi || item.key_facts_en || []);
  document.getElementById("modal-facts").innerHTML = facts.map(f => `<li class="mb-1.5">• ${f}</li>`).join("");

  const staticLink = isEn ? (item.static_gk_en || "") : (item.static_gk_hi || item.static_gk_en || "");
  document.getElementById("modal-static").innerText = staticLink;
}
