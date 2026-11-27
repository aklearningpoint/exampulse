import { auth, db, provider, signInWithPopup, collection, getDocs, query, orderBy, limit, doc, getDoc, setDoc, updateDoc } from "../../core/firebase-config.js";

let activeVaultTab = "ebooks";
let storeEbooksCache = [];
let userLibraryMap = {};

function formatExpiryDate(isoStr) {
  if (!isoStr) return "";
  return new Date(isoStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function isLicenseActive(entry) {
  if (!entry || !entry.expiresAt) return false;
  return new Date(entry.expiresAt).getTime() > Date.now();
}

async function fetchUserLibrary() {
  const user = auth.currentUser;
  if (!user) {
    userLibraryMap = {};
    return;
  }
  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    userLibraryMap = userSnap.exists() ? (userSnap.data().owned_ebooks || {}) : {};
  } catch (err) {
    console.warn("Library fetch skipped:", err.message);
    userLibraryMap = {};
  }
}

export async function loadVaultView() {
  const container = document.getElementById("vault-container");
  container.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">Loading E-Books & Static GK...</div>`;

  await fetchUserLibrary();

  const myOwnedCount = Object.values(userLibraryMap).filter(isLicenseActive).length;

  container.innerHTML = `
    <div class="grid grid-cols-3 gap-1.5 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 mb-4 shadow-xs">
      <button onclick="window.switchVaultSubTab('ebooks')" id="vtab-ebooks" class="py-2 rounded-xl bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 text-[11px] font-extrabold">
        🛒 E-Book Store
      </button>
      <button onclick="window.switchVaultSubTab('library')" id="vtab-library" class="py-2 rounded-xl text-slate-600 dark:text-slate-300 text-[11px] font-bold">
        📖 My Library (${myOwnedCount})
      </button>
      <button onclick="window.switchVaultSubTab('static')" id="vtab-static" class="py-2 rounded-xl text-slate-600 dark:text-slate-300 text-[11px] font-bold">
        🏛️ Static GK
      </button>
    </div>

    <div id="vault-body-area"></div>
  `;

  renderVaultSubContent();
}

window.switchVaultSubTab = function(tab) {
  activeVaultTab = tab;
  ["ebooks", "library", "static"].forEach(t => {
    const btn = document.getElementById(`vtab-${t}`);
    if (!btn) return;
    btn.className = t === tab
      ? "py-2 rounded-xl bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 text-[11px] font-extrabold"
      : "py-2 rounded-xl text-slate-600 dark:text-slate-300 text-[11px] font-bold";
  });
  renderVaultSubContent();
};

async function renderVaultSubContent() {
  const area = document.getElementById("vault-body-area");
  if (!area) return;

  if (activeVaultTab === "ebooks") {
    area.innerHTML = `<div class="text-center py-8 text-xs text-slate-400">Loading Categorized E-Books...</div>`;
    const snap = await getDocs(query(collection(db, "pdf_store"), orderBy("createdAt", "desc"), limit(20)));
    storeEbooksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!storeEbooksCache.length) {
      area.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-6 text-center border border-slate-200 dark:border-slate-800">
          <p class="font-bold text-slate-800 dark:text-white text-sm">No E-Books Published Yet</p>
          <p class="text-xs text-slate-500 mt-1">Weekly & Monthly ExamPulse E-Books will appear here.</p>
        </div>`;
      return;
    }

    area.innerHTML = storeEbooksCache.map(book => {
      const owned = isLicenseActive(userLibraryMap[book.id]);
      const priceLabel = book.price === 0 ? "₹0 (Free)" : `₹${book.price}`;
      const buyers = book.buyers_count || 0;
      const isMcqBook = book.ebook_format === "mcq";

      return `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm mb-3">
          <div class="flex items-center justify-between mb-1.5">
            <span class="px-2.5 py-0.5 rounded ${isMcqBook ? "bg-indigo-600" : "bg-[#285577]"} text-white text-[10px] font-extrabold uppercase">
              ${book.period ? `${book.period} E-Book` : "In-App Digest"}
            </span>
            <span class="text-[11px] font-bold text-slate-500 dark:text-slate-400">👥 ${buyers} Students</span>
          </div>

          <h3 class="font-extrabold text-slate-900 dark:text-white text-sm leading-snug">${book.title}</h3>
          <p class="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">${book.description || ""}</p>

          <div class="flex items-center gap-2 mt-2.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            <span>⏳ Validity: 6 Months</span>
            <span>•</span>
            <span>📱 In-App Reader</span>
          </div>

          <div class="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div>
              <span class="text-[10px] text-slate-400 block">Price</span>
              <span class="text-base font-black text-slate-900 dark:text-white">${priceLabel}</span>
            </div>

            ${owned ? `
              <button onclick="window.openInAppEbookReader('${book.id}')" class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold active:scale-95 transition">
                📖 Read Now →
              </button>
            ` : `
              <button onclick="window.openEbookCheckout('${book.id}')" class="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold active:scale-95 transition">
                Buy / Claim (₹${book.price || 0}) →
              </button>
            `}
          </div>
        </div>`;
    }).join("");
  }

  if (activeVaultTab === "library") {
    if (!auth.currentUser) {
      area.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-6 text-center border border-slate-200 dark:border-slate-800">
          <p class="font-bold text-slate-800 dark:text-white text-sm">Sign In to View Your E-Book Library</p>
          <p class="text-xs text-slate-500 mt-1 mb-3">All E-Books you claim are saved in your profile for 6 months.</p>
          <button onclick="window.signInForLibrary()" class="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 text-xs font-extrabold">Sign In with Google</button>
        </div>`;
      return;
    }

    const activeIds = Object.keys(userLibraryMap).filter(id => isLicenseActive(userLibraryMap[id]));
    if (!activeIds.length) {
      area.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-6 text-center border border-slate-200 dark:border-slate-800">
          <p class="font-bold text-slate-800 dark:text-white text-sm">Your E-Book Shelf is Empty</p>
          <p class="text-xs text-slate-500 mt-1 mb-3">Visit the E-Book Store to claim Weekly & Monthly editions for free.</p>
          <button onclick="window.switchVaultSubTab('ebooks')" class="px-4 py-2 rounded-xl bg-[#285577] text-white text-xs font-bold">Browse Store →</button>
        </div>`;
      return;
    }

    area.innerHTML = activeIds.map(id => {
      const meta = userLibraryMap[id];
      return `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-emerald-200 dark:border-emerald-800/70 shadow-sm mb-3 flex items-center justify-between gap-3">
          <div>
            <span class="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold">
              ✅ Active till ${formatExpiryDate(meta.expiresAt)}
            </span>
            <h3 class="font-bold text-slate-900 dark:text-white text-sm mt-1.5">${meta.title}</h3>
          </div>
          <button onclick="window.openInAppEbookReader('${id}')" class="px-3.5 py-2.5 rounded-xl bg-[#285577] text-white text-xs font-extrabold whitespace-nowrap">
            Open Reader
          </button>
        </div>`;
    }).join("");
  }

  if (activeVaultTab === "static") {
    area.innerHTML = `<div class="text-center py-8 text-xs text-slate-400">Loading Static GK Capsules...</div>`;
    const snap = await getDocs(query(collection(db, "static_notes"), orderBy("createdAt", "desc"), limit(25)));
    if (snap.empty) {
      area.innerHTML = `<div class="bg-white dark:bg-slate-900 rounded-2xl p-6 text-center text-xs text-slate-500">No Static GK notes published yet.</div>`;
      return;
    }
    area.innerHTML = snap.docs.map(d => {
      const s = d.data();
      return `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm mb-3">
          <span class="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300 text-[10px] font-bold uppercase">${s.subject || "Static GK"}</span>
          <h3 class="font-bold text-slate-900 dark:text-white text-sm mt-1.5">${s.title}</h3>
          <p class="text-xs text-slate-600 dark:text-slate-300 mt-1.5 whitespace-pre-line leading-relaxed">${s.content}</p>
        </div>`;
    }).join("");
  }
}

window.signInForLibrary = async function() {
  await signInWithPopup(auth, provider);
  loadVaultView();
};

window.openEbookCheckout = async function(ebookId) {
  if (!auth.currentUser) {
    try {
      await signInWithPopup(auth, provider);
      await fetchUserLibrary();
    } catch {
      return alert("Please sign in to add this E-Book to your profile.");
    }
  }

  const book = storeEbooksCache.find(b => b.id === ebookId);
  if (!book) return;

  const area = document.getElementById("vault-body-area");
  area.innerHTML = `
    <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-md">
      <div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-3">
        <span class="text-xs font-extrabold uppercase text-[#285577] dark:text-amber-400">🛍️ ExamPulse E-Book Checkout</span>
        <button onclick="window.switchVaultSubTab('ebooks')" class="text-xs font-bold text-slate-400">Cancel ✕</button>
      </div>

      <h3 class="font-extrabold text-base text-slate-900 dark:text-white">${book.title}</h3>
      <p class="text-xs text-slate-500 mt-1">${book.description || ""}</p>

      <div class="bg-slate-50 dark:bg-slate-800/70 rounded-2xl p-3.5 my-4 space-y-2 text-xs">
        <div class="flex justify-between">
          <span class="text-slate-500">Account:</span>
          <span class="font-bold text-slate-900 dark:text-white">${auth.currentUser.email}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-500">Access Validity:</span>
          <span class="font-bold text-emerald-600">6 Months (180 Days)</span>
        </div>
        <div class="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-700 text-sm">
          <span class="font-bold">Total Payable:</span>
          <span class="font-black text-emerald-600">₹${book.price || 0}</span>
        </div>
      </div>

      <button id="confirm-ebook-buy-btn" onclick="window.completeEbookPurchase('${book.id}')" class="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-sm">
        ✅ Confirm Order & Add to My Profile
      </button>
    </div>
  `;
};

window.completeEbookPurchase = async function(ebookId) {
  const user = auth.currentUser;
  if (!user) return;
  const btn = document.getElementById("confirm-ebook-buy-btn");
  if (btn) btn.innerText = "Activating 6-Month Access...";

  try {
    const bookRef = doc(db, "pdf_store", ebookId);
    const bookSnap = await getDoc(bookRef);
    if (!bookSnap.exists()) return alert("E-Book not found.");
    const book = bookSnap.data();

    const now = new Date();
    const expiry = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    const prevOwned = userSnap.exists() ? (userSnap.data().owned_ebooks || {}) : {};

    const isFirstTimeBuyer = !prevOwned[ebookId];

    prevOwned[ebookId] = {
      title: book.title,
      purchasedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
      pricePaid: book.price || 0
    };

    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      name: user.displayName || "Aspirant",
      owned_ebooks: prevOwned
    }, { merge: true });

    if (isFirstTimeBuyer) {
      await updateDoc(bookRef, {
        buyers_count: (book.buyers_count || 0) + 1
      });
    }

    userLibraryMap = prevOwned;
    window.openInAppEbookReader(ebookId);
  } catch (err) {
    alert("Could not complete order: " + err.message);
  }
};

window.toggleMcqBookAnswer = function(ansBoxId) {
  const el = document.getElementById(ansBoxId);
  if (el) el.classList.toggle("hidden");
};

// Full Categorized In-App Reader (Supports Both News E-Book & MCQ E-Book)
window.openInAppEbookReader = async function(ebookId, selectedChapter = "national") {
  const area = document.getElementById("vault-body-area");
  area.innerHTML = `<div class="text-center py-12 text-xs text-slate-400">Opening In-App Reader...</div>`;

  let book = storeEbooksCache.find(b => b.id === ebookId);
  if (!book || (!book.chapters && !book.mcq_chapters)) {
    const snap = await getDoc(doc(db, "pdf_store", ebookId));
    if (!snap.exists()) return alert("E-Book content not found.");
    book = { id: snap.id, ...snap.data() };
  }

  const isMcqMode = book.ebook_format === "mcq" || Boolean(book.mcq_chapters);
  const ch = isMcqMode ? (book.mcq_chapters || {}) : (book.chapters || {});

  const tabs = isMcqMode ? [
    { key: "national", label: `🇮🇳 National (${(ch.national || []).length})` },
    { key: "banking", label: `🏦 Banking (${(ch.banking || []).length})` },
    { key: "ssc", label: `📘 SSC (${(ch.ssc || []).length})` },
    { key: "railway", label: `🚆 Railway (${(ch.railway || []).length})` },
    { key: "upsc", label: `🏛️ UPSC/PCS (${(ch.upsc || []).length})` }
  ] : [
    { key: "national", label: `🇮🇳 National (${(ch.national || []).length})` },
    { key: "banking", label: `🏦 Banking (${(ch.banking || []).length})` },
    { key: "ssc", label: `📘 SSC (${(ch.ssc || []).length})` },
    { key: "railway", label: `🚆 Railway (${(ch.railway || []).length})` },
    { key: "upsc", label: `🏛️ UPSC/PCS (${(ch.upsc || []).length})` },
    { key: "static_gk", label: `🧠 Static GK (${(ch.static_gk || []).length})` }
  ];

  const license = userLibraryMap[ebookId];
  const validTill = license ? formatExpiryDate(license.expiresAt) : "6 Months";
  const items = ch[selectedChapter] || [];

  area.innerHTML = `
    <div class="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-md">
      <div class="bg-gradient-to-r from-[#285577] to-slate-900 text-white p-4">
        <div class="flex items-center justify-between mb-2">
          <button onclick="window.loadVaultView()" class="px-2.5 py-1 rounded-lg bg-white/15 text-[11px] font-bold">← My Library</button>
          <span class="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-bold">Valid till ${validTill}</span>
        </div>
        <h2 class="font-extrabold text-sm leading-snug">${book.title}</h2>
      </div>

      <div class="flex gap-1.5 overflow-x-auto p-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
        ${tabs.map(t => `
          <button onclick="window.openInAppEbookReader('${ebookId}', '${t.key}')" class="px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition ${
            selectedChapter === t.key
              ? "bg-[#285577] text-white"
              : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
          }">
            ${t.label}
          </button>
        `).join("")}
      </div>

      <div class="p-4 space-y-3">
        ${items.length === 0 ? `
          <p class="text-center text-xs text-slate-400 py-8">No items in this chapter for this edition. Switch chapters above.</p>
        ` : isMcqMode ? items.map((q, idx) => {
          const ansId = `mcq_ans_${selectedChapter}_${idx}`;
          return `
            <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
              <div class="flex items-center justify-between text-[10px] font-bold text-indigo-600 dark:text-amber-400 mb-1">
                <span>Q.${idx + 1}</span>
                <span class="text-slate-400">${q.date || ""}</span>
              </div>
              <p class="font-bold text-xs text-slate-900 dark:text-white leading-snug">${q.question_en}</p>
              ${q.question_hi ? `<p class="text-[11px] text-slate-600 dark:text-slate-300 mt-1">${q.question_hi}</p>` : ""}

              <div class="mt-2 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                ${(q.options || []).map((opt, i) => `
                  <div class="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700">
                    <strong>(${String.fromCharCode(65 + i)})</strong> ${opt}
                  </div>
                `).join("")}
              </div>

              <button onclick="window.toggleMcqBookAnswer('${ansId}')" class="mt-2.5 px-3 py-1.5 rounded-lg bg-[#285577] text-white text-[10px] font-bold">
                👁️ Show / Hide Answer
              </button>

              <div id="${ansId}" class="hidden mt-2 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px]">
                <p class="font-bold text-emerald-700 dark:text-emerald-400">✓ Correct: (${String.fromCharCode(65 + (q.correct_index || 0))}) ${(q.options || [])[q.correct_index] || ""}</p>
                ${q.explanation_en ? `<p class="text-slate-700 dark:text-slate-300 mt-1">${q.explanation_en}</p>` : ""}
              </div>
            </div>`;
        }).join("") : selectedChapter === "static_gk" ? items.map((s, idx) => `
          <div class="p-3.5 rounded-2xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200/70 dark:border-purple-800/50">
            <span class="text-[10px] font-extrabold uppercase text-purple-700 dark:text-purple-300">${s.subject}</span>
            <h4 class="font-bold text-sm text-slate-900 dark:text-white mt-0.5">${idx + 1}. ${s.title}</h4>
            <p class="text-xs text-slate-700 dark:text-slate-300 mt-1.5 whitespace-pre-line leading-relaxed">${s.content}</p>
          </div>
        `).join("") : items.map((a, idx) => `
          <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
            <div class="flex items-center justify-between text-[10px] font-bold text-[#285577] dark:text-amber-400 uppercase mb-1">
              <span>${a.category}</span>
              <span class="text-slate-400">${a.date}</span>
            </div>
            <h4 class="font-bold text-sm text-slate-900 dark:text-white leading-snug">${idx + 1}. ${a.title_en}</h4>
            ${a.title_hi ? `<p class="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-0.5">${a.title_hi}</p>` : ""}
            <ul class="list-disc pl-4 mt-2 space-y-1 text-xs text-slate-700 dark:text-slate-300">
              ${(a.facts_en || []).map(f => `<li>${f}</li>`).join("")}
            </ul>
            ${a.static_en ? `
              <div class="mt-2.5 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border-l-4 border-amber-500 text-[11px] text-amber-950 dark:text-amber-200">
                <strong>360° Static GK:</strong> ${a.static_en}
              </div>
            ` : ""}
          </div>
        `).join("")}
      </div>
    </div>
  `;
};

window.loadVaultView = loadVaultView;
