import { db, doc, setDoc, getDoc, collection, getDocs, query, orderBy, limit, deleteDoc } from "../../core/firebase-config.js";
import { loadDailyFeed } from "../feed/feed-ui.js";

export async function publishFromJSON() {
  const raw = document.getElementById("admin-json-input").value.trim();
  const statusEl = document.getElementById("admin-status");
  if (!raw) return alert("Please paste the AI-generated JSON first.");

  try {
    const data = JSON.parse(raw);
    if (!data.date || !data.articles) {
      throw new Error("JSON must include 'date' (YYYY-MM-DD) and an 'articles' array.");
    }

    statusEl.innerText = "Publishing to Firebase...";
    await setDoc(doc(db, "daily_feed", data.date), {
      date: data.date,
      articles: data.articles,
      updatedAt: new Date().toISOString()
    });

    if (data.questions && data.questions.length > 0) {
      await setDoc(doc(db, "quizzes", `quiz_${data.date}`), {
        id: `quiz_${data.date}`,
        date: data.date,
        title: `Daily CA Quiz (${data.date})`,
        duration_mins: 5,
        negative_marking: 0.25,
        questions: data.questions
      });
    }

    statusEl.innerText = `Published successfully for ${data.date}.`;
    loadDailyFeed(data.date);
    loadRecentAdminDocs();
  } catch (err) {
    statusEl.innerText = `Error: ${err.message}`;
  }
}

export async function loadRecentAdminDocs() {
  const listEl = document.getElementById("admin-recent-list");
  if (!listEl) return;
  const q = query(collection(db, "daily_feed"), orderBy("date", "desc"), limit(5));
  const snap = await getDocs(q);

  listEl.innerHTML = snap.docs.map(d => {
    const item = d.data();
    return `
      <div class="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200 mb-2">
        <div>
          <p class="text-xs font-bold text-slate-800">${item.date}</p>
          <p class="text-[11px] text-slate-500">${(item.articles || []).length} Articles</p>
        </div>
        <div class="flex gap-2">
          <button onclick="window.loadDocToEditor('${item.date}')" class="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold">Edit JSON</button>
          <button onclick="window.deleteFeedDoc('${item.date}')" class="px-2.5 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-semibold">Delete</button>
        </div>
      </div>`;
  }).join("");
}

window.loadDocToEditor = async function(dateStr) {
  const feedSnap = await getDoc(doc(db, "daily_feed", dateStr));
  const quizSnap = await getDoc(doc(db, "quizzes", `quiz_${dateStr}`));
  const combined = {
    date: dateStr,
    articles: feedSnap.exists() ? feedSnap.data().articles : [],
    questions: quizSnap.exists() ? quizSnap.data().questions : []
  };
  document.getElementById("admin-json-input").value = JSON.stringify(combined, null, 2);
  document.getElementById("admin-status").innerText = `Loaded ${dateStr} into editor.`;
};

window.deleteFeedDoc = async function(dateStr) {
  if (!confirm(`Are you sure you want to delete all content for ${dateStr}?`)) return;
  await deleteDoc(doc(db, "daily_feed", dateStr));
  await deleteDoc(doc(db, "quizzes", `quiz_${dateStr}`));
  loadRecentAdminDocs();
  loadDailyFeed();
};

export function generateYouTubeSlides() {
  const raw = document.getElementById("admin-json-input").value.trim();
  if (!raw) return alert("Please paste JSON content or load an existing date using 'Edit JSON' first.");
  const data = JSON.parse(raw);

  const win = window.open("", "_blank");
  const slidesHtml = (data.articles || []).map((a, i) => `
    <section class="slide">
      <div class="tag">ExamPulse Daily GK • ${data.date} | Slide ${i + 1}</div>
      <h1>${a.title_en}</h1>
      <h2>${a.title_hi || ""}</h2>
      <div class="box">
        <strong>Key Exam Points:</strong>
        <ul>${(a.key_facts_en || []).map(f => `<li>${f}</li>`).join("")}</ul>
      </div>
      <div class="static-box">
        <strong>360° Static GK Link:</strong> ${a.static_gk_en || ""}
      </div>
    </section>
  `).join("");

  win.document.write(`
    <html><head><title>ExamPulse YouTube Slides - ${data.date}</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0f172a; color: white; margin: 0; padding: 20px; }
      .slide { background: #1e293b; border: 2px solid #334155; border-radius: 16px; padding: 40px; margin-bottom: 30px; min-height: 75vh; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
      .tag { color: #fbbf24; font-weight: bold; font-size: 14px; margin-bottom: 12px; text-transform: uppercase; }
      h1 { font-size: 32px; margin: 0 0 10px; color: #f8fafc; }
      h2 { font-size: 24px; margin: 0 0 24px; color: #94a3b8; font-weight: 500; }
      .box { background: #0f172a; padding: 20px; border-radius: 12px; font-size: 20px; line-height: 1.6; margin-bottom: 16px; }
      .static-box { background: #422006; border-left: 5px solid #f59e0b; padding: 18px; border-radius: 8px; font-size: 19px; color: #fef3c7; }
      @media print { body { background: white; } .slide { border: none; min-height: 95vh; } }
    </style></head><body>
    <div style="text-align:right; margin-bottom:15px;"><button onclick="window.print()" style="padding:10px 20px; font-size:16px; background:#f59e0b; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">Save as PDF / Fullscreen Slides</button></div>
    ${slidesHtml}
    </body></html>
  `);
  win.document.close();
}
