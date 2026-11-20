import { db, collection, getDocs, query, orderBy } from "../../core/firebase-config.js";

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
          <div onclick="window.filterStaticBySubject('${sub.id}', '${sub.name}')" class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm active:scale-95 transition cursor-pointer">
            <div class="text-xl mb-1.5">${sub.icon}</div>
            <h3 class="font-bold text-slate-900 text-xs">${sub.name}</h3>
            <p class="text-[10px] text-slate-500 mt-0.5">${sub.desc}</p>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- PDF Store Section -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-extrabold text-sm text-slate-800 uppercase tracking-wide">PDF Study Material & Digests</h2>
      </div>
      <div id="pdf-list-container" class="text-center py-6 text-slate-400 text-xs">Loading PDFs...</div>
    </div>
  `;

  loadPdfStore();
}

async function loadPdfStore() {
  const pdfEl = document.getElementById("pdf-list-container");
  try {
    const q = query(collection(db, "pdf_store"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      pdfEl.innerHTML = `
        <div class="bg-white rounded-2xl p-5 border border-slate-200 text-center">
          <p class="font-semibold text-slate-700 text-xs">No PDFs uploaded yet.</p>
          <p class="text-[11px] text-slate-400 mt-1">Daily free digests and monthly compilations will appear here.</p>
        </div>`;
      return;
    }

    pdfEl.innerHTML = snap.docs.map(d => {
      const pdf = d.data();
      const isFree = !pdf.price || pdf.price === 0;
      return `
        <div class="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm mb-2.5 flex items-center justify-between text-left">
          <div>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isFree ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-900"}">
              ${isFree ? "Free PDF" : `Premium • ₹${pdf.price}`}
            </span>
            <h4 class="font-bold text-slate-900 text-xs mt-1">${pdf.title}</h4>
            <p class="text-[11px] text-slate-500 mt-0.5">${pdf.description || "Exam-oriented revision notes"}</p>
          </div>
          <a href="${pdf.file_url || "#"}" target="_blank" class="px-3.5 py-2 rounded-xl ${isFree ? "bg-slate-900 text-white" : "bg-amber-500 text-slate-950"} text-xs font-bold whitespace-nowrap">
            ${isFree ? "Download" : `Buy ₹${pdf.price}`}
          </a>
        </div>`;
    }).join("");
  } catch (err) {
    pdfEl.innerHTML = `<div class="text-red-500 text-xs">Error loading PDFs: ${err.message}</div>`;
  }
}

window.filterStaticBySubject = function(subjectId, subjectName) {
  alert(`${subjectName} notes and chapter quizzes will load here once published from Creator Studio.`);
};
