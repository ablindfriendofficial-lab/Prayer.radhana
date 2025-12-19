import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, signInWithCustomToken, signInAnonymously, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, collection, doc, getDocs, setDoc, deleteDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

// --- CONFIGURATION ---
const HARDCODED_CONFIG = {
  apiKey: "AIzaSyCF4sjV8ee5rsiGTRkmyEOvbylzKPBu9Xc",
  authDomain: "project-html-3634c.firebaseapp.com",
  projectId: "project-html-3634c",
  storageBucket: "project-html-3634c.appspot.com",
  messagingSenderId: "106742296896", 
  appId: "1:106742296896:web:314a77f5143fd0afdb4aa5"
};

let auth, db, currentUser;

const get = id => document.getElementById(id);
const views = ['view-loading', 'view-auth', 'view-upload', 'view-projects', 'view-workspace', 'view-fullscreen'];

function switchView(viewId) {
  views.forEach(v => {
    const el = get(v);
    if (el) el.classList.toggle('active', v === viewId);
  });
  console.log("Switched to view:", viewId);
}

// --- INITIALIZATION ---
async function initApp() {
  console.log("Initializing Firebase...");
  try {
    const app = initializeApp(HARDCODED_CONFIG);
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("Firebase initialized successfully.");

    onAuthStateChanged(auth, (user) => {
      if (user) {
        console.log("User is logged in:", user.uid);
        currentUser = user;
        get('user-display').textContent = user.email || `User-${user.uid.slice(0,4)}`;
        fetchProjects().then(() => switchView('view-upload'));
      } else {
        console.log("No user logged in.");
        currentUser = null;
        switchView('view-auth');
      }
    });
  } catch (e) {
    console.error("Firebase Initialization Error:", e);
    get('loading-status').innerText = "Connection Error: " + e.message;
  }
}

// --- FIRESTORE LOGIC ---
function getCollectionRef() {
  if (!currentUser) return null;
  // Simple path for your own Firebase project
  return collection(db, 'users', currentUser.uid, 'projects');
}

let projectsList = [];
async function fetchProjects() {
  if (!currentUser) return;
  console.log("Fetching projects...");
  try {
    const snap = await getDocs(getCollectionRef());
    projectsList = [];
    snap.forEach(d => projectsList.push({ id: d.id, ...d.data() }));
    projectsList.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    renderProjectsList();
    console.log("Projects fetched:", projectsList.length);
  } catch (e) { 
    console.error("Firestore Fetch Error:", e); 
    if(e.code === 'permission-denied') {
        alert("Firestore Permission Denied! Please check your Security Rules in Firebase Console.");
    }
  }
}

// --- UI HELPERS ---
function renderProjectsList() {
  const grid = get('projects-list-grid');
  grid.innerHTML = '';
  get('no-projects-msg').style.display = projectsList.length === 0 ? 'block' : 'none';
  projectsList.forEach(p => {
    const div = document.createElement('div');
    div.className = 'project-card';
    div.innerHTML = `
      <h3>${escapeHtml(p.name)}</h3>
      <p style="font-size:0.8rem; color:var(--text-dim);">
         ${p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : 'Just now'}
      </p>
      <div style="display:flex; gap:5px; margin-top:auto;">
        <button class="btn-base btn-primary action-launch">Run</button>
        <button class="btn-base btn-secondary action-edit">Code</button>
        <button class="btn-base btn-danger action-del">🗑</button>
      </div>
    `;
    div.querySelector('.action-launch').onclick = () => launchProjectData(p);
    div.querySelector('.action-edit').onclick = () => openEditor(p.id);
    div.querySelector('.action-del').onclick = () => deleteProject(p.id);
    grid.appendChild(div);
  });
}

function escapeHtml(text) { return text ? text.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) : ''; }

// --- AUTH UI ---
let authMode = 'login';
function toggleAuthMode() {
    authMode = authMode === 'login' ? 'signup' : 'login';
    const isLogin = authMode === 'login';
    get('auth-title').innerText = isLogin ? 'Welcome Back' : 'Create Account';
    get('login-btn').style.display = isLogin ? 'flex' : 'none';
    get('signup-btn').style.display = isLogin ? 'none' : 'flex';
    get('auth-confirm').style.display = isLogin ? 'none' : 'block';
    get('toggle-auth-mode').innerText = isLogin ? 'Need an account? Sign Up' : 'Have an account? Log In';
}

async function handleAuth() {
    const email = get('auth-email').value;
    const password = get('auth-password').value;
    const errBox = get('auth-error');
    errBox.style.display = 'none';

    if(!email || !password) {
        errBox.innerText = "Please fill all fields";
        errBox.style.display='block';
        return;
    }

    console.log(`Attempting ${authMode}...`);
    try {
        if (authMode === 'signup') {
            const confirm = get('auth-confirm').value;
            if(password !== confirm) throw new Error("Passwords do not match");
            await createUserWithEmailAndPassword(auth, email, password);
        } else {
            await signInWithEmailAndPassword(auth, email, password);
        }
    } catch (e) {
        console.error("Auth Error:", e);
        errBox.innerText = e.message;
        errBox.style.display='block';
    }
}

// --- FILE OPS ---
let uploadedFilesMap = new Map();
let currentProject = { id: null };

async function processFiles(files) {
  for (const f of Array.from(files)) {
    const name = f.name.toLowerCase();
    let key = null;
    if (name.endsWith('.html') || name === 'index.html') key = 'html';
    else if (name.endsWith('.css') || name === 'style.css') key = 'css';
    else if (name.endsWith('.js') || name === 'script.js') key = 'js';
    if (key) uploadedFilesMap.set(key, await f.text());
  }
  updateUploadStatus();
}

function updateUploadStatus() {
  const list = get('file-list-preview');
  list.innerHTML = '';
  let hasHtml = false;
  ['html', 'css', 'js'].forEach(k => {
    if (uploadedFilesMap.has(k)) {
      if (k==='html') hasHtml=true;
      const d = document.createElement('div');
      d.textContent = `✓ ${k.toUpperCase()} Loaded`;
      d.style.color = "var(--success)";
      list.appendChild(d);
    }
  });
  get('upload-actions').style.display = hasHtml ? 'flex' : 'none';
  get('file-count-text').textContent = uploadedFilesMap.size > 0 ? `${uploadedFilesMap.size} files ready.` : "No files.";
}

// --- EDITOR & RUN ---
function openEditor(id) {
  switchView('view-workspace');
  get('save-changes-btn').style.display = id ? 'flex' : 'none';
  if (id) {
    const p = projectsList.find(x => x.id === id);
    currentProject = p;
    get('edit-html').value = p.html; get('edit-css').value = p.css; get('edit-js').value = p.js;
  } else {
    currentProject = { id: null };
    get('edit-html').value = uploadedFilesMap.get('html')||''; 
    get('edit-css').value = uploadedFilesMap.get('css')||''; 
    get('edit-js').value = uploadedFilesMap.get('js')||'';
  }
  setEditorTab('html');
}

function setEditorTab(t) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    ['html','css','js'].forEach(x => get(`edit-${x}`).style.display = x===t?'block':'none');
}

function launchProjectData(p) {
    switchView('view-fullscreen');
    get('fullscreen-frame').srcdoc = `<!DOCTYPE html><html><head><style>${p.css||''}</style></head><body>${p.html||''}<script>${p.js||''}<\/script></body></html>`;
}

async function saveNewProject(name) {
    console.log("Saving new project...");
    try {
        await setDoc(doc(getCollectionRef()), {
            name, html: uploadedFilesMap.get('html'), css: uploadedFilesMap.get('css')||'', js: uploadedFilesMap.get('js')||'',
            createdAt: serverTimestamp()
        });
        await fetchProjects();
    } catch (e) { console.error("Save Error", e); }
}

async function updateExistingProject(id, html, css, js) {
    try {
        await updateDoc(doc(getCollectionRef(), id), { html, css, js });
        await fetchProjects();
    } catch (e) { console.error("Update Error", e); }
}

async function deleteProject(id) {
    if(confirm("Delete?")) { await deleteDoc(doc(getCollectionRef(), id)); await fetchProjects(); }
}

// --- EVENT BINDING ---
window.onload = () => {
    initApp();

    get('toggle-auth-mode').onclick = toggleAuthMode;
    get('login-btn').onclick = handleAuth;
    get('signup-btn').onclick = handleAuth;
    get('logout-btn').onclick = () => signOut(auth);

    get('back-upload').onclick = () => switchView('view-upload');
    get('back-projects-from-edit').onclick = () => switchView('view-projects');
    get('my-projects-btn').onclick = () => { fetchProjects(); switchView('view-projects'); };
    
    get('exit-full').onclick = () => {
         if (currentProject && currentProject.id) switchView('view-workspace');
         else if (get('edit-html').value) switchView('view-workspace');
         else switchView('view-projects');
    };

    get('local-preview-btn').onclick = () => openEditor(null);
    get('save-cloud-btn').onclick = () => get('modal-save').style.display='flex';
    get('modal-cancel').onclick = () => get('modal-save').style.display='none';
    get('modal-save-confirm').onclick = async () => {
         const name = get('project-name-input').value;
         if(name) { 
             await saveNewProject(name); 
             get('modal-save').style.display='none'; 
             switchView('view-projects'); 
         }
    };

    get('save-changes-btn').onclick = async () => {
         if(currentProject.id) {
            get('save-changes-btn').innerText="Saving...";
            await updateExistingProject(currentProject.id, get('edit-html').value, get('edit-css').value, get('edit-js').value);
            get('save-changes-btn').innerText="💾 Save";
         }
    };
    
    get('run-code-btn').onclick = () => {
        launchProjectData({
            html: get('edit-html').value,
            css: get('edit-css').value,
            js: get('edit-js').value
        });
    };

    get('clear-btn').onclick = () => { uploadedFilesMap.clear(); updateUploadStatus(); };
    get('file-input').onchange = e => processFiles(e.target.files);
    get('folder-input').onchange = e => processFiles(e.target.files);
    
    const z = get('drop-zone');
    z.ondragover = e => { e.preventDefault(); z.style.border='2px solid var(--accent)'; };
    z.ondragleave = e => { z.style.border='1px solid var(--border)'; };
    z.ondrop = e => { e.preventDefault(); z.style.border='1px solid var(--border)'; processFiles(e.dataTransfer.files); };

    document.querySelectorAll('.tab-btn').forEach(btn => btn.onclick = () => setEditorTab(btn.dataset.tab));
};