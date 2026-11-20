import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence, doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, limit, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const ADMIN_EMAIL = "APNA_ADMIN_GMAIL_YAHAN_LIKHEIN";

const firebaseConfig = {
  apiKey: "AIzaSyCbLDab5Az_16wnWN2nq0UhBYn1VcKEOMw",
  authDomain: "exampulse-15bb4.firebaseapp.com",
  projectId: "exampulse-15bb4",
  storageBucket: "exampulse-15bb4.firebasestorage.app",
  messagingSenderId: "209160588875",
  appId: "1:209160588875:web:21f1c2802c30d8089d87ce",
  measurementId: "G-6PKJ9F0N8N"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();

// Offline Persistence (Low data & instant reload ke liye)
enableIndexedDbPersistence(db).catch((err) => {
  console.warn("Persistence skipped:", err.code);
});

export {
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, limit, deleteDoc
};
