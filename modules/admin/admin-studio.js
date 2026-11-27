import { db, doc, setDoc, getDoc, collection, getDocs, query, orderBy, limit, deleteDoc } from "../../core/firebase-config.js";
import { loadDailyFeed } from "../feed/feed-ui.js";

// 1. Publish Daily CA & Quiz
export async function publishFromJSON() {
  const raw = document.getElementById("admin-json-input").value.trim();
  const statusEl = document.getElementById("admin-status");
  if (!raw) return alert("Please paste the AI-generated JSON first.");

  try {
    const data = JSON.parse(raw);
    if (!data.date || !data.articles) {
      throw new Error("JSON must include 'date' (YYYY-MM-DD) and an 'articles' array.");
    }

    statusEl.innerText = "Merging & Publishing to Firebase...";

    const feedRef = doc(db, "daily_feed", data.date);
    const existingFeed = await getDoc(feedRef);
    const prevArticles = existingFeed.exists() ? (existingFeed.data().articles || []) : [];
    const mergedArticles = [...prevArticles, ...data.articles];

    await setDoc(feedRef, {
      date: data.date,
      articles: mergedArticles,
      updatedAt: new Date().toISOString()
    });

    if (data.questions && data.questions.length > 0) {
      const quizRef = doc(db, "quizzes", `quiz_${data.date}`);
      const existingQuiz = await getDoc(quizRef);
      const prevQuestions = existingQuiz.exists() ? (existingQuiz.data().questions || []) : [];
      const mergedQuestions = [...prevQuestions, ...data.questions];

      await setDoc(quizRef, {
        id: `quiz_${data.date}`,
        date: data.date,
        title: `Daily CA Quiz (${data.date})`,
        category: "Daily CA",
        exam_group: "ALL",
        sub_exam: "Daily Current Affairs",
        exam_year: data.date.slice(0, 4),
        duration_mins: Math.max(5, Math.ceil(mergedQuestions.length * 0.6)),
        negative_marking: 0.25,
        questions: mergedQuestions
      });
    }

    statusEl.innerText = `Published! Total ${mergedArticles.length} articles active for ${data.date}.`;
    document.getElementById("admin-json-input").value = "";
    loadDailyFeed();
    loadRecentAdminDocs();
  } catch (err) {
    statusEl.innerText = `Error: ${err.message}`;
  }
}

// 2. Publish Dedicated Exam & Year-Wise Mock Test (e.g., SBI PO 2026, SSC CGL 2026)
export async function publishSpecificMockTest() {
  const examGroup = document.getElementById("mock-group-select").value;
  const subExam = document.getElementById("mock-subexam-select").value;
  const examYear = document.getElementById("mock-year-select").value;
  const difficulty = document.getElementById("mock-level-select").value;
  const title = document.getElementById("mock-title-input").value.trim();
  const duration = parseInt(document.getElementById("mock-duration-input").value, 10) || 15;
  const posMark = parseFloat(document.getElementById("mock-pos-input").value) || 1;
  const negMark = parseFloat(document.getElementById("mock-neg-input").value) ?? 0.25;
  const rawQuestions = document.getElementById("mock-questions-json").value.trim();
  const statusEl = document.getElementById("mock-publish-status");

  if (!title || !rawQuestions) {
    return alert("Please enter Test Title and paste the Questions JSON array.");
  }

  try {
    const parsed = JSON.parse(rawQuestions);
    const questionsArr = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    if (!questionsArr.length) {
      throw new Error("Questions array cannot be empty.");
    }

    const taggedQuestions = questionsArr.map(q => ({
      ...q,
      exam_tag: examGroup,
      sub_exam: subExam,
      difficulty: q.difficulty || difficulty
    }));

    const today = new Date().toISOString().slice(0, 10);
    const slug = `${subExam.toLowerCase().replace(/[^a-z0-9]/g, "")}_${examYear.replace(/[^a-z0-9]/gi, "")}_${Date.now()}`;

    await setDoc(doc(db, "quizzes", slug), {
      id: slug,
      date: today,
      title,
      category: `${subExam} ${examYear}`,
      exam_group: examGroup,
      sub_exam: subExam,
      exam_year: examYear,
      difficulty,
      is_specific_mock: true,
      duration_mins: duration,
      positive_marking: posMark,
      negative_marking: negMark,
      questions: taggedQuestions
    });

    statusEl.innerText = `Published "${title}" (${taggedQuestions.length} Qs) live!`;
    document.getElementById("mock-title-input").value = "";
    document.getElementById("mock-questions-json").value = "";
    loadSpecificMocksAdminList();
  } catch (err) {
    statusEl.innerText = `Error: ${err.message}`;
  }
}

export async function loadSpecificMocksAdminList() {
  const listEl = document.getElementById("admin-specific-mocks-list");
  if (!listEl) return;
  const q = query(collection(db, "quizzes"), orderBy("date", "desc"), limit(20));
  const snap = await getDocs(q);

  const specificDocs = snap.docs.filter(d => d.data().is_specific_mock);
  listEl.innerHTML = specificDocs.length ? specificDocs.map(d => {
    const m = d.data();
    return `
      <div class="flex items-center justify-between bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 mb-2">
        <div>
          <span class="px-2 py-0.5 rounded bg-[#285577] text-white text-[9px] font-bold uppercase">${m.sub_exam} • ${m.exam_year}</span>
          <p class="text-xs font-bold text-slate-800 dark:text-white mt-1">${m.title}</p>
          <p class="text-[10px] text-slate-500">${(m.questions || []).length} Qs • ${m.difficulty}</p>
        </div>
        <button onclick="window.deleteSpecificMock('${d.id}')" class="px-2.5 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-semibold">Delete</button>
      </div>`;
  }).join("") : `<p class="text-xs text-slate-400">No specific exam mocks published yet.</p>`;
}

window.deleteSpecificMock = async function(quizId) {
  if (!confirm("Delete this mock test permanently?")) return;
  await deleteDoc(doc(db, "quizzes", quizId));
  loadSpecificMocksAdminList();
};

// 3. Publish Static GK Topic Note
export async function publishStaticNote() {
  const subject = document.getElementById("static-subject-select").value;
  const title = document.getElementById("static-title-input").value.trim();
  const content = document.getElementById("static-content-input").value.trim();
  const statusEl = document.getElementById("static-status");

  if (!title || !content) return alert("Please enter both Topic Title and Notes content.");

  try {
    const noteId = `${subject}_${Date.now()}`;
    await setDoc(doc(db, "static_notes", noteId), {
      id: noteId,
      subject,
      title,
      content,
      createdAt: new Date().toISOString()
    });
    statusEl.innerText = "Static GK note published successfully.";
    document.getElementById("static-title-input").value = "";
    document.getElementById("static-content-input").value = "";
  } catch (err) {
    statusEl.innerText = `Error: ${err.message}`;
  }
}

// 4. Publish PDF or Course to Store
export async function publishStoreItem() {
  const type = document.getElementById("store-type-select").value;
  const title = document.getElementById("store-title-input").value.trim();
  const desc = document.getElementById("store-desc-input").value.trim();
  const price = parseFloat(document.getElementById("store-price-input").value) || 0;
  const url = document.getElementById("store-url-input").value.trim();
  const statusEl = document.getElementById("store-status");

  if (!title || !url) return alert("Please provide Title and Resource/Access Link.");

  try {
    const itemId = `${type}_${Date.now()}`;
    await setDoc(doc(db, "pdf_store", itemId), {
      id: itemId,
      type,
      title,
      description: desc,
      price,
      file_url: url,
      createdAt: new Date().toISOString()
    });
    statusEl.innerText = `${type.toUpperCase()} added to Store successfully.`;
    document.getElementById("store-title-input").value = "";
    document.getElementById("store-desc-input").value = "";
    document.getElementById("store-price-input").value = "";
    document.getElementById("store-url-input").value = "";
    loadStoreAdminList();
  } catch (err) {
    statusEl.innerText = `Error: ${err.message}`;
  }
}

export async function loadRecentAdminDocs() {
  const listEl = document.getElementById("admin-recent-list");
  if (!listEl) return;
  const q = query(collection(db, "daily_feed"), orderBy("date", "desc"), limit(10));
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

export async function loadStoreAdminList() {
  const listEl = document.getElementById("admin-store-list");
  if (!listEl) return;
  const q = query(collection(db, "pdf_store"), orderBy("createdAt", "desc"), limit(10));
  const snap = await getDocs(q);

  listEl.innerHTML = snap.docs.map(d => {
    const item = d.data();
    return `
      <div class="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200 mb-2">
        <div>
          <p class="text-xs font-bold text-slate-800">${item.title} (${item.price === 0 ? "Free" : "₹" + item.price})</p>
          <p class="text-[10px] uppercase text-slate-500">${item.type || "PDF"}</p>
        </div>
        <button onclick="window.deleteStoreItem('${d.id}')" class="px-2.5 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-semibold">Delete</button>
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

window.deleteStoreItem = async function(itemId) {
  if (!confirm("Delete this item from the Store?")) return;
  await deleteDoc(doc(db, "pdf_store", itemId));
  loadStoreAdminList();
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
    <html><head><title>ExamPulse Slides - ${data.date}</title>
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
