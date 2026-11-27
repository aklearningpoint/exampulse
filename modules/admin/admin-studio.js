import { db, doc, setDoc, getDoc, collection, getDocs, query, orderBy, limit, deleteDoc } from "../../core/firebase-config.js";
import { loadDailyFeed } from "../feed/feed-ui.js";

// Helper: Split any array into chunks of 10
function chunkIntoTens(arr) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += 10) {
    chunks.push(arr.slice(i, i + 10));
  }
  return chunks;
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

// 2. Publish Specific Exam Mock Automatically Split into 10-Question Sets
export async function publishSpecificMockTest() {
  const examGroup = document.getElementById("mock-group-select").value;
  const subExam = document.getElementById("mock-subexam-select").value;
  const examYear = document.getElementById("mock-year-select").value;
  const difficulty = document.getElementById("mock-level-select").value;
  const baseTitle = document.getElementById("mock-title-input").value.trim();
  const durationPerSet = parseInt(document.getElementById("mock-duration-input").value, 10) || 8;
  const posMark = parseFloat(document.getElementById("mock-pos-input").value) || 1;
  const negMark = parseFloat(document.getElementById("mock-neg-input").value) ?? 0.25;
  const rawQuestions = document.getElementById("mock-questions-json").value.trim();
  const statusEl = document.getElementById("mock-publish-status");

  if (!baseTitle || !rawQuestions) {
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

    const tenQuestionSets = chunkIntoTens(taggedQuestions);
    const today = new Date().toISOString().slice(0, 10);
    const batchStamp = Date.now();

    for (let i = 0; i < tenQuestionSets.length; i++) {
      const setQs = tenQuestionSets[i];
      const setNumber = i + 1;
      const setTitle = tenQuestionSets.length > 1 ? `${baseTitle} — Set ${setNumber}` : `${baseTitle} (Set 1)`;
      const slug = `${subExam.toLowerCase().replace(/[^a-z0-9]/g, "")}_${examYear.replace(/[^a-z0-9]/gi, "")}_set${setNumber}_${batchStamp}`;

      await setDoc(doc(db, "quizzes", slug), {
        id: slug,
        date: today,
        title: setTitle,
        category: `${subExam} ${examYear}`,
        exam_group: examGroup,
        sub_exam: subExam,
        exam_year: examYear,
        difficulty,
        set_number: setNumber,
        is_specific_mock: true,
        duration_mins: durationPerSet,
        positive_marking: posMark,
        negative_marking: negMark,
        questions: setQs
      });
    }

    statusEl.innerText = `Published ${tenQuestionSets.length} Set(s) of 10 Questions (${taggedQuestions.length} Total Qs)!`;
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

// 3. 1-Click Weekly (7 Days) & Monthly (30 Days) Categorized E-Book Compiler
export async function compileAndPreviewEbook(daysCount = 7) {
  const statusEl = document.getElementById("ebook-compile-status");
  const periodLabel = daysCount === 7 ? "Weekly" : "Monthly";
  statusEl.innerText = `Compiling ${periodLabel} E-Book from last ${daysCount} days of news & static GK...`;

  try {
    const feedSnap = await getDocs(query(collection(db, "daily_feed"), orderBy("date", "desc"), limit(daysCount)));
    const staticSnap = await getDocs(query(collection(db, "static_notes"), orderBy("createdAt", "desc"), limit(daysCount === 7 ? 10 : 25)));

    if (feedSnap.empty && staticSnap.empty) {
      statusEl.innerText = "No published articles or static notes found to compile.";
      return;
    }

    const datesList = feedSnap.docs.map(d => d.data().date).filter(Boolean);
    const dateRange = datesList.length ? `${datesList[datesList.length - 1]} to ${datesList[0]}` : new Date().toISOString().slice(0, 10);

    // Categorized Buckets
    const buckets = {
      national: [],
      banking: [],
      ssc: [],
      railway: [],
      upsc: []
    };

    let totalArticles = 0;
    feedSnap.docs.forEach(d => {
      const data = d.data();
      (data.articles || []).forEach(art => {
        totalArticles++;
        const item = { ...art, _date: data.date };
        const examsStr = (art.exams || []).join(" ").toUpperCase();
        const catStr = String(art.category || "").toUpperCase();

        if (examsStr.includes("BANK") || catStr.includes("BANK") || catStr.includes("ECONOMY") || catStr.includes("FINANC")) {
          buckets.banking.push(item);
        } else if (examsStr.includes("RAILWAY")) {
          buckets.railway.push(item);
        } else if (examsStr.includes("UPSC") || examsStr.includes("PCS") || catStr.includes("POLITY") || catStr.includes("INTERNATIONAL")) {
          buckets.upsc.push(item);
        } else if (examsStr.includes("SSC")) {
          buckets.ssc.push(item);
        } else {
          buckets.national.push(item);
        }
      });
    });

    const staticNotes = staticSnap.docs.map(d => d.data());

    // Pre-fill the PDF Store form below so admin can publish immediately after saving PDF
    const autoTitle = `ExamPulse ${periodLabel} Current Affairs & Static GK E-Book (${dateRange})`;
    const autoDesc = `${totalArticles} Categorized News + ${staticNotes.length} Static GK Capsules (National, Banking, SSC, Railway & UPSC/PCS)`;
    document.getElementById("store-type-select").value = "pdf";
    document.getElementById("store-title-input").value = autoTitle;
    document.getElementById("store-desc-input").value = autoDesc;

    statusEl.innerText = `Compiled ${totalArticles} articles & ${staticNotes.length} static notes! Print window opened — Save as PDF, upload to Drive, and click 'Publish E-Book to Store' below.`;

    // Open Print-Ready Categorized E-Book Magazine Window
    const renderSection = (secTitle, badgeColor, items) => {
      if (!items.length) return "";
      return `
        <div class="chapter">
          <div class="chapter-header" style="border-left: 6px solid ${badgeColor};">
            <h2>${secTitle} (${items.length})</h2>
          </div>
          ${items.map((a, idx) => `
            <div class="article-card">
              <div class="meta">${a.category || "General"} • ${a._date || ""} • Exams: ${(a.exams || ["All Exams"]).join(", ")}</div>
              <h3>${idx + 1}. ${a.title_en}</h3>
              ${a.title_hi ? `<h4 class="hi">${a.title_hi}</h4>` : ""}
              <ul>
                ${(a.key_facts_en || []).map(f => `<li>${f}</li>`).join("")}
              </ul>
              ${a.static_gk_en ? `<div class="static-pill"><strong>360° Static Link:</strong> ${a.static_gk_en}</div>` : ""}
            </div>
          `).join("")}
        </div>
      `;
    };

    const staticHtml = staticNotes.length ? `
      <div class="chapter">
        <div class="chapter-header" style="border-left: 6px solid #7c3aed;">
          <h2>Chapter 6: 360° Static GK Revision Notes (${staticNotes.length})</h2>
        </div>
        ${staticNotes.map((s, idx) => `
          <div class="article-card">
            <div class="meta">Subject: ${String(s.subject || "Static GK").toUpperCase()}</div>
            <h3>${idx + 1}. ${s.title}</h3>
            <p style="white-space: pre-line; font-size: 13px; color: #334155;">${s.content}</p>
          </div>
        `).join("")}
      </div>
    ` : "";

    const win = window.open("", "_blank");
    win.document.write(`
      <html>
      <head>
        <title>${autoTitle}</title>
        <style>
          body { font-family: 'Segoe UI', system-ui, sans-serif; color: #0f172a; margin: 0; padding: 24px; background: #f8fafc; line-height: 1.55; }
          .toolbar { position: sticky; top: 0; background: #0f172a; color: white; padding: 12px 20px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; z-index: 10; }
          .btn { background: #f59e0b; color: #0f172a; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 800; cursor: pointer; font-size: 13px; }
          .cover { background: linear-gradient(135deg, #0f172a, #285577); color: white; padding: 48px 36px; border-radius: 20px; text-align: center; margin-bottom: 32px; page-break-after: always; }
          .cover h1 { font-size: 32px; margin: 12px 0; }
          .cover p { color: #cbd5e1; font-size: 15px; }
          .toc { background: white; border: 1px solid #cbd5e1; border-radius: 14px; padding: 20px; margin-bottom: 28px; }
          .chapter { margin-bottom: 32px; page-break-before: always; }
          .chapter-header { background: #e2e8f0; padding: 10px 16px; border-radius: 8px; margin-bottom: 16px; }
          .chapter-header h2 { margin: 0; font-size: 18px; color: #0f172a; }
          .article-card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 14px; page-break-inside: avoid; }
          .meta { font-size: 11px; font-weight: 700; color: #285577; text-transform: uppercase; margin-bottom: 4px; }
          h3 { margin: 0 0 4px; font-size: 16px; color: #0f172a; }
          h4.hi { margin: 0 0 8px; font-size: 14px; color: #475569; font-weight: 600; }
          ul { margin: 8px 0; padding-left: 18px; font-size: 13px; color: #1e293b; }
          li { margin-bottom: 4px; }
          .static-pill { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 8px 12px; border-radius: 6px; font-size: 12px; color: #78350f; margin-top: 8px; }
          @media print {
            body { background: white; padding: 0; }
            .toolbar { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <span><strong>ExamPulse E-Book Studio</strong> • Ready to Export PDF</span>
          <button class="btn" onclick="window.print()">🖨️ Save as PDF E-Book</button>
        </div>

        <div class="cover">
          <div style="font-size:13px; letter-spacing:2px; color:#fbbf24; font-weight:800;">EXAMPULSE COMPETITIVE DIGEST</div>
          <h1>${periodLabel} Current Affairs & Static GK E-Book</h1>
          <p>Coverage Period: <strong>${dateRange}</strong></p>
          <p style="margin-top:20px; font-size:13px;">Categorized for Banking • SSC • Railway • UPSC & State PCS</p>
        </div>

        <div class="toc">
          <h3 style="margin-bottom:10px;">📑 E-Book Index</h3>
          <p style="font-size:13px; margin:4px 0;">1. National & General Current Affairs (${buckets.national.length} Topics)</p>
          <p style="font-size:13px; margin:4px 0;">2. Banking & Financial Awareness (${buckets.banking.length} Topics)</p>
          <p style="font-size:13px; margin:4px 0;">3. SSC Exam Special Digest (${buckets.ssc.length} Topics)</p>
          <p style="font-size:13px; margin:4px 0;">4. Railway Exam Special Digest (${buckets.railway.length} Topics)</p>
          <p style="font-size:13px; margin:4px 0;">5. UPSC & State PCS Analytical Digest (${buckets.upsc.length} Topics)</p>
          <p style="font-size:13px; margin:4px 0;">6. 360° Static GK Revision Notes (${staticNotes.length} Chapters)</p>
        </div>

        ${renderSection("Chapter 1: National & General Current Affairs", "#0284c7", buckets.national)}
        ${renderSection("Chapter 2: Banking & Financial Awareness", "#059669", buckets.banking)}
        ${renderSection("Chapter 3: SSC Exam Special Digest", "#d97706", buckets.ssc)}
        ${renderSection("Chapter 4: Railway Exam Special Digest", "#dc2626", buckets.railway)}
        ${renderSection("Chapter 5: UPSC & State PCS Analytical Digest", "#4f46e5", buckets.upsc)}
        ${staticHtml}
      </body>
      </html>
    `);
    win.document.close();
  } catch (err) {
    statusEl.innerText = `Error compiling E-Book: ${err.message}`;
  }
}

// 4. Publish Static GK Topic Note
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

// 5. Publish PDF or E-Book to Store
export async function publishStoreItem() {
  const type = document.getElementById("store-type-select").value;
  const title = document.getElementById("store-title-input").value.trim();
  const desc = document.getElementById("store-desc-input").value.trim();
  const price = parseFloat(document.getElementById("store-price-input").value) || 0;
  const url = document.getElementById("store-url-input").value.trim();
  const statusEl = document.getElementById("store-status");

  if (!title || !url) return alert("Please provide Title and Google Drive PDF Link.");

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
    statusEl.innerText = `${type.toUpperCase()} published to Store successfully!`;
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
