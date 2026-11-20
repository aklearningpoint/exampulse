import { auth, db, provider, signInWithPopup, collection, getDocs, query, where, orderBy, doc, getDoc, setDoc } from "../../core/firebase-config.js";

const STATIC_SUBJECTS = [
  { id: "history", name: "Indian History", desc: "Ancient, Medieval & Modern", icon: "🏛️" },
  { id: "polity", name: "Indian Polity", desc: "Articles, Amendments & Acts", icon: "⚖️" },
  { id: "geography", name: "Geography", desc: "Rivers, Parks & Biosphere", icon: "🌍" },
  { id: "economy", name: "Indian Economy", desc: "Budget, Banking & Schemes", icon: "📈" },
  { id: "science", name: "General Science", desc: "Physics, Chemistry & Bio", icon: "🔬" },
  { id: "art", name: "Art & Culture", desc: "Dances, Festivals & UNESCO", icon: "🎭" }
];

export async function loadVaultView() {
  const container = document.getElementById("vault-container");
  container.innerHTML = `
    <!-- Static GK Grid -->
    <div class="mb-6">
      <h2 class="font-extrabold text-sm text-slate-800 uppercase tracking-wide mb-3">Static GK Vault</h2>
      <div class="grid grid-cols-2 gap-2.5">
        ${STATIC_SUBJECTS.map(sub => `
          <div onclick="window.openStaticSubject('${sub.id}', '${sub.name}')" class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm active:scale-95 transition cursor-pointer">
            <div class="text-xl mb-1.5">${sub.icon}</div>
            <h3 class="font-bold text-slate-900 text-xs">${sub.name}</h3>
            <p class="text-[10px] text-slate-500 mt-0.5">${sub.desc}</p>
          </div>
        `).join("")}
      </div>
      <div id="static-notes-reader" class="mt-3"></div>
    </div>

    <!-- PDFs & Courses Store -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-extrabold text-sm text-slate-800 uppercase tracking-wide">PDF Digests & Courses</h2>
      </div>
      <div id="pdf-list-container" class="text-center py-6 text-slate-400 text-xs">Loading Store Items...</div>
    </div>
  `;

  loadStoreItems();
}

window.openStaticSubject = async function(subjectId, subjectName) {
  const readerEl = document.getElementById("static-notes-reader");
  readerEl.innerHTML = `<div class="text-xs text-slate-400 py-3">Loading ${subjectName} notes...</div>`;

  const q = query(collection(db, "static_notes"), where("subject", "==", subjectId));
  const snap = await getDocs(q);

  if (snap.empty) {
    readerEl.innerHTML = `
      <div class="bg-white rounded-2xl p-4 border border-slate-200 text-xs text-slate-500">
        No notes published under <strong>${subjectName}</strong> yet.
      </div>`;
    return;
  }

  readerEl.innerHTML = snap.docs.map(d => {
    const n = d.data();
    return `
      <div class="bg-white rounded-2xl p-4 border border-blue-200 shadow-sm mb-2.5">
        <span class="text-[10px] font-bold uppercase text-blue-700">${subjectName}</span>
        <h4 class="font-bold text-slate-900 text-sm mt-0.5 mb-2">${n.title}</h4>
        <div class="text-xs text-slate-700 whitespace-pre-line leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200/70">${n.content}</div>
      </div>`;
  }).join("");
};

async function loadStoreItems() {
  const storeEl = document.getElementById("pdf-list-container");
  try {
    let unlockedIds = [];
    if (auth.currentUser) {
      const uSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
      if (uSnap.exists()) unlockedIds = uSnap.data().purchased_items || [];
    }

    const q = query(collection(db, "pdf_store"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      storeEl.innerHTML = `
        <div class="bg-white rounded-2xl p-5 border border-slate-200 text-center">
          <p class="font-semibold text-slate-700 text-xs">No PDFs or Courses listed yet.</p>
          <p class="text-[11px] text-slate-400 mt-1">Study digests and video courses will appear here.</p>
        </div>`;
      return;
    }

    storeEl.innerHTML = snap.docs.map(d => {
      const item = d.data();
      const isFree = !item.price || item.price === 0;
      const isUnlocked = isFree || unlockedIds.includes(d.id);
      const badgeLabel = item.type === "course" ? "Course" : "PDF Digest";

      return `
        <div class="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm mb-2.5 flex items-center justify-between text-left gap-3">
          <div>
            <div class="flex items-center gap-1.5">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700">${badgeLabel}</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isUnlocked ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-900"}">
                ${isFree ? "Free" : isUnlocked ? "Purchased" : `₹${item.price}`}
              </span>
            </div>
            <h4 class="font-bold text-slate-900 text-xs mt-1">${item.title}</h4>
            <p class="text-[11px] text-slate-500 mt-0.5">${item.description || "Exam-oriented study material"}</p>
          </div>
          ${isUnlocked
            ? `<a href="${item.file_url}" target="_blank" class="px-3.5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold whitespace-nowrap">Access Now</a>`
            : `<button onclick="window.initiatePurchase('${d.id}', '${item.title}', ${item.price})" class="px-3.5 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold whitespace-nowrap">Buy ₹${item.price}</button>`
          }
        </div>`;
    }).join("");
  } catch (err) {
    storeEl.innerHTML = `<div class="text-red-500 text-xs">Error loading store: ${err.message}</div>`;
  }
}

window.initiatePurchase = async function(itemId, title, price) {
  let user = auth.currentUser;
  if (!user) {
    const res = await signInWithPopup(auth, provider);
    user = res.user;
  }
  alert(
    `Selected: ${title} (₹${price})\nLogged in as: ${user.email}\n\nNext Step: Connect your Razorpay Key ID here so payment automatically unlocks this item in your account.`
  );
};
