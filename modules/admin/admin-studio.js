import { db, doc, setDoc, getDoc, collection, getDocs, query, where, orderBy, limit, deleteDoc } from "../../core/firebase-config.js";
import { loadDailyFeed } from "../feed/feed-ui.js";

function chunkIntoTens(arr) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += 10) {
    chunks.push(arr.slice(i, i + 10));
  }
  return chunks;
}

// Fisher-Yates Unbiased Random Shuffle
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeLevel(q) {
  const raw = String(q.difficulty || q.level || "").toLowerCase();
  if (raw.includes("high") || raw.includes("hard") || raw.includes("mains") || raw.includes("tier-2")) return "High";
  if (raw.includes("easy") || raw.includes("prelims") || raw.includes("mts") || raw.includes("gd") || raw.includes("clerk")) return "Easy";
  return "Moderate";
}

function matchesFilter(qObj, examGroup, levelFilter) {
  if (examGroup !== "ALL") {
    const tag = String(qObj.exam_tag || (qObj.exams || []).join(" ") || "ALL").toUpperCase();
    if (tag !== "ALL" && tag !== "ALL EXAMS") {
      if (examGroup === "UPSC/PCS") {
        if (!tag.includes("UPSC") && !tag.includes("PCS")) return false;
      } else if (!tag.includes(examGroup.toUpperCase())) {
        return false;
      }
    }
  }
  if (levelFilter !== "ALL" && normalizeLevel(qObj) !== levelFilter) return false;
  return true;
}

// Helper: Fetch & Shuffle Questions Across a Date Range from Firestore
async function collectQuestionsInDateRange(fromDate, toDate, examGroup, levelFilter) {
  const q = query(
    collection(db, "quizzes"),
    where("date", ">=", fromDate),
    where("date", "<=", toDate),
    orderBy("date", "desc")
  );
  const snap = await getDocs(q);

  const uniqueMap = new Map();
  snap.docs.forEach(d => {
    const data = d.data();
    if (data.is_specific_mock) return; // Pull from original daily question bank
    (data.questions || []).forEach(item => {
      if (matchesFilter(item, examGroup, levelFilter)) {
        uniqueMap.set(item.question_en, { ...item, _sourceDate: data.date });
      }
    });
  });

  return shuffleArray(Array.from(uniqueMap.values()));
}

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

// 2. Zero-JSON Date-Range Auto-Shuffled Exam Mock Compiler (Splits into 10-Q Sets)
export async function compileAutoExamMockByDateRange() {
  const fromDate = document.getElementById("mock-from-date").value;
  const toDate = document.getElementById("mock-to-date").value;
  const examGroup = document.getElementById("mock-group-select").value;
  const subExam = document.getElementById("mock-subexam-select").value;
  const examYear = document.getElementById("mock-year-select").value;
  const levelFilter = document.getElementById("mock-level-select").value;
  const requestedCount = parseInt(document.getElementById("mock-qcount-input").value, 10) || 20;
  const customTitle = document.getElementById("mock-title-input").value.trim();
  const durationPerSet = parseInt(document.getElementById("mock-duration-input").value, 10) || 8;
  const posMark = parseFloat(document.getElementById("mock-pos-input").value) || 1;
  const negMark = parseFloat(document.getElementById("mock-neg-input").value) ?? 0.25;
  const statusEl = document.getElementById("mock-publish-status");

  if (!fromDate || !toDate) return alert("Please select both From Date and To Date.");

  statusEl.innerText = "Collecting & shuffling questions from selected date range...";

  try {
    const shuffledPool = await collectQuestionsInDateRange(fromDate, toDate, examGroup, levelFilter);
    if (!shuffledPool.length) {
      statusEl.innerText = "No matching questions found in this date range. Try expanding dates or setting Level to 'All Levels'.";
      return;
    }

    const selectedQuestions = shuffledPool.slice(0, requestedCount);
    const tenQuestionSets = chunkIntoTens(selectedQuestions);
    const today = new Date().toISOString().slice(0, 10);
    const batchStamp = Date.now();
    const baseTitle = customTitle || `${subExam} ${examYear} Current Affairs Mock (${fromDate} to ${toDate})`;

    for (let i = 0; i < tenQuestionSets.length; i++) {
      const setQs = tenQuestionSets[i];
      const setNumber = i + 1;
      const setTitle = `${baseTitle} — Set ${setNumber}`;
      const slug = `${subExam.toLowerCase().replace(/[^a-z0-9]/g, "")}_${examYear.replace(/[^a-z0-9]/gi, "")}_set${setNumber}_${batchStamp}`;

      await setDoc(doc(db, "quizzes", slug), {
        id: slug,
        date: today,
        source_range: `${fromDate} to ${toDate}`,
        title: setTitle,
        category: `${subExam} ${examYear}`,
        exam_group: examGroup,
        sub_exam: subExam,
        exam_year: examYear,
        difficulty: levelFilter === "ALL" ? "Moderate" : levelFilter,
        set_number: setNumber,
        is_specific_mock: true,
        duration_mins: durationPerSet,
        positive_marking: posMark,
        negative_marking: negMark,
        questions: setQs
      });
    }

    statusEl.innerText = `Success! Compiled & published ${tenQuestionSets.length} Shuffled Set(s) (${selectedQuestions.length} Qs total) for ${subExam} ${examYear}!`;
    document.getElementById("mock-title-input").value = "";
    loadSpecificMocksAdminList();
  } catch (err) {
    statusEl.innerText = `Error: ${err.message}`;
  }
}

// 3. YouTube Shorts & Video MCQ Slide Deck Generator (From Selected Date Range)
export async function generateMcqVideoSlides() {
  const fromDate = document.getElementById("mock-from-date").value;
  const toDate = document.getElementById("mock-to-date").value;
  const examGroup = document.getElementById("mock-group-select").value;
  const subExam = document.getElementById("mock-subexam-select").value;
  const levelFilter = document.getElementById("mock-level-select").value;
  const requestedCount = Math.min(parseInt(document.getElementById("mock-qcount-input").value, 10) || 15, 30);
  const statusEl = document.getElementById("mock-publish-status");

  if (!fromDate || !toDate) return alert("Please select From Date and To Date first.");
  statusEl.innerText = "Building YouTube MCQ Slides...";

  try {
    const pool = await collectQuestionsInDateRange(fromDate, toDate, examGroup, levelFilter);
    if (!pool.length) {
      statusEl.innerText = "No MCQs found in this date range for slides.";
      return;
    }

    const slidesData = pool.slice(0, requestedCount);
    statusEl.innerText = `Opened ${slidesData.length} YouTube MCQ Slides in new tab!`;

    const win = window.open("", "_blank");
    const slidesHtml = slidesData.map((q, idx) => `
      <section class="slide">
        <div class="top-bar">
          <span class="badge">ExamPulse • ${subExam}</span>
          <span class="qnum">Q.${idx + 1} / ${slidesData.length}</span>
        </div>

        <div class="q-box">
          <p class="q-en">${q.question_en}</p>
          ${q.question_hi ? `<p class="q-hi">${q.question_hi}</p>` : ""}
        </div>

        <div class="opts">
          ${(q.options || []).map((opt, i) => `
            <div class="opt ${i === q.correct_index ? "correct-opt" : ""}">
              <span class="opt-key">${String.fromCharCode(65 + i)}</span>
              <span>${opt}</span>
              ${i === q.correct_index ? `<span class="ans-tag">✓ CORRECT</span>` : ""}
            </div>
          `).join("")}
        </div>

        ${q.explanation_en ? `
          <div class="exp-box">
            <strong>💡 Key Point:</strong> ${q.explanation_en}
          </div>
        ` : ""}
      </section>
    `).join("");

    win.document.write(`
      <html>
      <head>
        <title>ExamPulse YouTube MCQ Slides (${subExam})</title>
        <style>
          body { font-family: 'Segoe UI', system-ui, sans-serif; background: #090d16; color: white; margin: 0; padding: 16px; display: flex; flex-direction: column; align-items: center; }
          .controls { position: sticky; top: 10px; z-index: 20; background: #1e293b; padding: 10px 16px; border-radius: 12px; display: flex; gap: 10px; margin-bottom: 20px; border: 1px solid #334155; }
          .controls button { padding: 8px 14px; border: none; border-radius: 8px; font-weight: 800; cursor: pointer; font-size: 12px; }
          .btn-short { background: #f59e0b; color: #0f172a; }
          .btn-wide { background: #38bdf8; color: #0f172a; }
          .btn-ans { background: #10b981; color: #0f172a; }
          .slide { width: 420px; min-height: 740px; background: linear-gradient(160deg, #0f172a 0%, #1e3a52 100%); border: 2px solid #334155; border-radius: 24px; padding: 26px; margin-bottom: 28px; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; page-break-after: always; }
          body.wide-mode .slide { width: 920px; min-height: 520px; }
          .top-bar { display: flex; justify-content: space-between; align-items: center; }
          .badge { background: #f59e0b; color: #0f172a; padding: 5px 12px; border-radius: 99px; font-weight: 900; font-size: 12px; text-transform: uppercase; }
          .qnum { font-weight: 800; font-size: 14px; color: #94a3b8; }
          .q-box { background: rgba(15, 23, 42, 0.75); border: 1px solid #334155; padding: 16px; border-radius: 16px; margin: 14px 0; }
          .q-en { font-size: 18px; font-weight: 700; margin: 0 0 8px; line-height: 1.4; color: #f8fafc; }
          .q-hi { font-size: 16px; font-weight: 600; margin: 0; line-height: 1.4; color: #fde68a; border-top: 1px solid #334155; padding-top: 8px; }
          .opts { display: flex; flex-direction: column; gap: 10px; }
          .opt { background: rgba(255,255,255,0.07); border: 1.5px solid #475569; padding: 12px 14px; border-radius: 12px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
          .opt-key { background: #334155; color: white; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; shrink: 0; }
          .ans-tag { display: none; margin-left: auto; background: #10b981; color: #052e16; font-size: 10px; font-weight: 900; padding: 3px 8px; border-radius: 6px; }
          body.reveal-ans .correct-opt { background: rgba(16, 185, 129, 0.22); border-color: #10b981; }
          body.reveal-ans .correct-opt .opt-key { background: #10b981; color: #052e16; }
          body.reveal-ans .ans-tag { display: inline-block; }
          .exp-box { display: none; background: #422006; border-left: 4px solid #f59e0b; padding: 10px 12px; border-radius: 8px; font-size: 12px; color: #fef3c7; margin-top: 12px; }
          body.reveal-ans .exp-box { display: block; }
        </style>
      </head>
      <body class="reveal-ans">
        <div class="controls">
          <button class="btn-short" onclick="document.body.classList.remove('wide-mode')">📱 9:16 Shorts Mode</button>
          <button class="btn-wide" onclick="document.body.classList.add('wide-mode')">🖥️ 16:9 Video Mode</button>
          <button class="btn-ans" onclick="document.body.classList.toggle('reveal-ans')">👁️ Toggle Answer Reveal</button>
        </div>
        ${slidesHtml}
      </body>
      </html>
    `);
    win.document.close();
  } catch (err) {
    statusEl.innerText = `Error: ${err.message}`;
  }
}

export async function loadSpecificMocksAdminList() {
  const listEl = document.getElementById("admin-specific-mocks-list");
  if (!listEl) return;
  const q = query(collection(db, "quizzes"), orderBy("date", "desc"), limit(25));
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
  if (!confirm("Delete this mock test set permanently?")) return;
  await deleteDoc(doc(db, "quizzes", quizId));
  loadSpecificMocksAdminList();
};

// 4. Weekly/Monthly Current Affairs News E-Book Publisher
export async function compileAndPreviewEbook(daysCount = 7) {
  const statusEl = document.getElementById("ebook-compile-status");
  const periodLabel = daysCount === 7 ? "Weekly" : "Monthly";
  statusEl.innerText = `Compiling & Publishing ${periodLabel} News E-Book...`;

  try {
    const feedSnap = await getDocs(query(collection(db, "daily_feed"), orderBy("date", "desc"), limit(daysCount)));
    const staticSnap = await getDocs(query(collection(db, "static_notes"), orderBy("createdAt", "desc"), limit(daysCount === 7 ? 10 : 25)));

    if (feedSnap.empty && staticSnap.empty) {
      statusEl.innerText = "No published articles or static notes found to compile.";
      return;
    }

    const datesList = feedSnap.docs.map(d => d.data().date).filter(Boolean);
    const dateRange = datesList.length ? `${datesList[datesList.length - 1]} to ${datesList[0]}` : new Date().toISOString().slice(0, 10);

    const chapters = { national: [], banking: [], ssc: [], railway: [], upsc: [], static_gk: [] };
    let totalArticles = 0;

    feedSnap.docs.forEach(d => {
      const data = d.data();
      (data.articles || []).forEach(art => {
        totalArticles++;
        const compactItem = {
          date: data.date || "",
          category: art.category || "General",
          title_en: art.title_en || "",
          title_hi: art.title_hi || "",
          facts_en: art.key_facts_en || [],
          static_en: art.static_gk_en || ""
        };
        const examsStr = (art.exams || []).join(" ").toUpperCase();
        const catStr = String(art.category || "").toUpperCase();

        if (examsStr.includes("BANK") || catStr.includes("BANK") || catStr.includes("ECONOMY") || catStr.includes("FINANC")) {
          chapters.banking.push(compactItem);
        } else if (examsStr.includes("RAILWAY")) {
          chapters.railway.push(compactItem);
        } else if (examsStr.includes("UPSC") || examsStr.includes("PCS") || catStr.includes("POLITY") || catStr.includes("INTERNATIONAL")) {
          chapters.upsc.push(compactItem);
        } else if (examsStr.includes("SSC")) {
          chapters.ssc.push(compactItem);
        } else {
          chapters.national.push(compactItem);
        }
      });
    });

    staticSnap.docs.forEach(d => {
      const s = d.data();
      chapters.static_gk.push({ subject: s.subject || "Static GK", title: s.title || "", content: s.content || "" });
    });

    const ebookId = `ebook_news_${periodLabel.toLowerCase()}_${Date.now()}`;
    const ebookTitle = `${periodLabel} Current Affairs & Static GK E-Book (${dateRange})`;
    const ebookDesc = `${totalArticles} Categorized News + ${chapters.static_gk.length} Static GK Capsules (National, Banking, SSC, Railway, UPSC/PCS)`;

    await setDoc(doc(db, "pdf_store", ebookId), {
      id: ebookId,
      type: "ebook",
      ebook_format: "news",
      period: periodLabel,
      date_range: dateRange,
      title: ebookTitle,
      description: ebookDesc,
      price: 0,
      validity_months: 6,
      buyers_count: 0,
      chapters,
      createdAt: new Date().toISOString()
    });

    statusEl.innerText = `Published "${ebookTitle}" to E-Book Store at ₹0 (6-Month Validity)!`;
    loadStoreAdminList();
  } catch (err) {
    statusEl.innerText = `Error publishing News E-Book: ${err.message}`;
  }
}

// 5. Weekly/Monthly Categorized MCQ Question Bank E-Book Publisher
export async function compileAndPublishMcqEbook(daysCount = 7) {
  const statusEl = document.getElementById("ebook-compile-status");
  const periodLabel = daysCount === 7 ? "Weekly" : "Monthly";
  statusEl.innerText = `Compiling & Publishing ${periodLabel} Categorized MCQ E-Book...`;

  try {
    const qSnap = await getDocs(query(collection(db, "quizzes"), orderBy("date", "desc"), limit(daysCount)));
    const dailyDocs = qSnap.docs.filter(d => !d.data().is_specific_mock);

    if (!dailyDocs.length) {
      statusEl.innerText = "No published quizzes found to compile MCQ E-Book.";
      return;
    }

    const datesList = dailyDocs.map(d => d.data().date).filter(Boolean);
    const dateRange = datesList.length ? `${datesList[datesList.length - 1]} to ${datesList[0]}` : new Date().toISOString().slice(0, 10);

    const mcqChapters = { national: [], banking: [], ssc: [], railway: [], upsc: [] };
    let totalMcqs = 0;

    dailyDocs.forEach(d => {
      const data = d.data();
      (data.questions || []).forEach(q => {
        totalMcqs++;
        const compactQ = {
          date: data.date || "",
          question_en: q.question_en || "",
          question_hi: q.question_hi || "",
          options: q.options || [],
          correct_index: q.correct_index ?? 0,
          explanation_en: q.explanation_en || ""
        };
        const tag = String(q.exam_tag || (q.exams || []).join(" ") || "").toUpperCase();
        if (tag.includes("BANK")) mcqChapters.banking.push(compactQ);
        else if (tag.includes("RAILWAY")) mcqChapters.railway.push(compactQ);
        else if (tag.includes("UPSC") || tag.includes("PCS")) mcqChapters.upsc.push(compactQ);
        else if (tag.includes("SSC")) mcqChapters.ssc.push(compactQ);
        else mcqChapters.national.push(compactQ);
      });
    });

    const ebookId = `ebook_mcq_${periodLabel.toLowerCase()}_${Date.now()}`;
    const ebookTitle = `${periodLabel} 100% Exam-Oriented MCQ Bank E-Book (${dateRange})`;
    const ebookDesc = `${totalMcqs} Bilingual MCQs with Answer Key & Explanations (Categorized for Banking, SSC, Railway, UPSC/PCS & National)`;

    await setDoc(doc(db, "pdf_store", ebookId), {
      id: ebookId,
      type: "ebook",
      ebook_format: "mcq",
      period: `${periodLabel} MCQ`,
      date_range: dateRange,
      title: ebookTitle,
      description: ebookDesc,
      price: 0,
      validity_months: 6,
      buyers_count: 0,
      mcq_chapters: mcqChapters,
      createdAt: new Date().toISOString()
    });

    statusEl.innerText = `Published "${ebookTitle}" (${totalMcqs} MCQs) to E-Book Store at ₹0!`;
    loadStoreAdminList();
  } catch (err) {
    statusEl.innerText = `Error publishing MCQ E-Book: ${err.message}`;
  }
}

// 6. Publish Static GK Topic Note
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

export async function loadRecentAdminDocs() {
  const listEl = document.getElementById("admin-recent-list");
  if (!listEl) return;
  const q = query(collection(db, "daily_feed"), orderBy("date", "desc"), limit(10));
  const snap = await getDocs(q);

  listEl.innerHTML = snap.docs.map(d => {
    const item = d.data();
    return `
      <div class="flex items-center justify-between bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 mb-2">
        <div>
          <p class="text-xs font-bold text-slate-800 dark:text-white">${item.date}</p>
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
  const q = query(collection(db, "pdf_store"), orderBy("createdAt", "desc"), limit(15));
  const snap = await getDocs(q);

  listEl.innerHTML = snap.docs.map(d => {
    const item = d.data();
    const buyers = item.buyers_count || 0;
    return `
      <div class="flex items-center justify-between bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 mb-2">
        <div>
          <p class="text-xs font-bold text-slate-800 dark:text-white">${item.title}</p>
          <p class="text-[10px] font-semibold text-emerald-600 mt-0.5">
            ${item.price === 0 ? "₹0 (Free)" : "₹" + item.price} • 👥 ${buyers} Enrolled • ⏳ 6 Months
          </p>
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
  if (!confirm("Delete this E-Book from the Store?")) return;
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
