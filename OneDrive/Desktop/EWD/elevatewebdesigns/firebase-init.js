import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyBCXFn13dHeCQ1-SO7-rAXQ2VKy75Vxqjg",
  authDomain:        "elevatewebdesigns-1fc3d.firebaseapp.com",
  projectId:         "elevatewebdesigns-1fc3d",
  storageBucket:     "elevatewebdesigns-1fc3d.firebasestorage.app",
  messagingSenderId: "778173951248",
  appId:             "1:778173951248:web:5922c9dcd1623b9e658995"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

window.__db  = db;
window.__col = collection;
window.__add = addDoc;
window.__ts  = serverTimestamp;
