let currentRotation = 0;
let isSystemOn = false;
let espIp = localStorage.getItem('donamestre_ip') || '';
let logCount = 0;
let isAiReady = false;
let faceDetectionInterval = null;

// SÉCURITÉ RESEAU : ANTI-REBOND (DEBOUNCE)
let lastRequestTime = 0;
const REQUEST_THROTTLE_MS = 250; 

// MODULE D'ENREGISTREMENT LOCAL VIDEO
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

// BASE DE DONNÉES DU DICTIONNAIRE LATÉRAL
const COMMANDS_DATABASE = [
    { syntax: "home", desc: "Exécute le recalage initial sur la butée physique." },
    { syntax: "left", desc: "Fait tourner l'axe horizontal vers la gauche." },
    { syntax: "right", desc: "Fait tourner l'axe horizontal vers la droite." },
    { syntax: "vision-noire", desc: "Active l'intensification lumineuse matricielle verte." },
    { syntax: "high-contrast", desc: "Bascule sur le filtre de surveillance haute-définition." },
    { syntax: "normal", desc: "Réinitialise tous les filtres graphiques par défaut." },
    { syntax: "quality=10", desc: "Configure la compression JPEG sur l'ESP (Haute Qualité)." },
    { syntax: "quality=30", desc: "Configure la compression sur l'ESP (Basse Qualité / Fluide)." },
    { syntax: "status", desc: "Interroge l'état matériel et logiciel de l'hôte local." },
    { syntax: "clear", desc: "Efface l'intégralité de l'historique de la console." }
];

window.addEventListener('DOMContentLoaded', async () => {
    if (espIp) document.getElementById('esp-ip').value = espIp;
    buildSidebarCommands();
    initAiEngine();
});

// LOGS SYSTEME ET COPIE PRESSE-PAPIER
function appendLog(message, type = 'sys') {
    const consoleBody = document.getElementById('console-output');
    if (!consoleBody) return;
    const row = document.createElement('div');
    row.className = `log-row ${type}`;
    row.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
    consoleBody.appendChild(row);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    logCount++;
    document.getElementById('log-count').innerText = logCount;
}

function copyLogs() {
    const consoleBody = document.getElementById('console-output');
    if (!consoleBody) return;
    navigator.clipboard.writeText(consoleBody.innerText)
        .then(() => appendLog("Succès : Les logs ont été copiés dans le presse-papier.", "success"))
        .catch(() => alert("Erreur lors de l'accès au presse-papier."));
}

function clearConsole() {
    document.getElementById('console-output').innerHTML = '';
    logCount = 0;
    document.getElementById('log-count').innerText = "0";
}

// CHANGEMENT D'ONGLET
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    event.currentTarget.classList.add('active');
}

// FILTRE ET RECHERCHE DU PANNEAU LATÉRAL
void function buildSidebarCommands() {
    const container = document.getElementById('commands-container');
    container.innerHTML = '';
    COMMANDS_DATABASE.forEach(cmd => {
        const item = document.createElement('button');
        item.className = 'cmd-item';
        item.onclick = () => executeDirectCommand(cmd.syntax);
        item.setAttribute('data-syntax', cmd.syntax);
        item.innerHTML = `<span class="cmd-syntax">${cmd.syntax}</span><span class="cmd-desc">${cmd.desc}</span>`;
        container.appendChild(item);
    });
}

function filterCommands() {
    const query = document.getElementById('sidebar-search').value.toLowerCase().trim();
    document.querySelectorAll('.cmd-item').forEach(item => {
        const syntax = item.getAttribute('data-syntax');
        item.style.display = syntax.includes(query) ? 'block' : 'none';
    });
}

function executeDirectCommand(syntax) {
    appendLog(`Commande reçue : ${syntax}`, 'cmd');
    if (syntax === 'clear') clearConsole();
    else if (['left', 'right', 'home'].includes(syntax)) moveH(syntax);
    else if (['normal', 'vision-noire', 'retro', 'high-contrast'].includes(syntax)) setPreset(syntax);
    else if (syntax.startsWith('quality=')) sendRawControl('quality', syntax.split('=')[1]);
    else if (syntax === 'status') appendLog(`Liaison=${isSystemOn} // IA=${isAiReady}`, 'sys');
    else appendLog(`Syntaxe inconnue.`, 'err');
}

function handleConsoleInput(e) {
    if (e.key === 'Enter') {
        const input = document.getElementById('cmd-field');
        const cmd = input.value.trim().toLowerCase();
        if (!cmd) return;
        executeDirectCommand(cmd);
        input.value = '';
    }
}

// CORRECTION : Connexion simplifiée sans interférence avec l'état du flux vidéo
function connectSystem() {
    const input = document.getElementById('esp-ip').value.trim();
    if (!input) return alert("Spécifiez une IP valide.");
    
    espIp = input.replace(/^https?:\/\//, '').replace(/\/$/, '');
    localStorage.setItem('donamestre_ip', espIp);
    appendLog(`Vérification de l'hôte distant sur http://${espIp}...`, 'sys');
    
    // On teste si la carte répond au ping
    fetch(`http://${espIp}/control?cmd=ping`, { mode: 'cors' })
        .then(r => r.text())
        .then(res => {
            if (res.includes("PONG")) {
                appendLog("Poignée de main matérielle réussie. Liaison OK.", "success");
            }
        })
        .catch(() => appendLog("Note : L'hôte n'a pas répondu au ping (Vérifiez l'IP ou l'alimentation).", "err"));
}

// CORRECTION : Allumage forcé et direct du flux vidéo (0 condition bloquante)
function toggleSystem() {
    if (!espIp) {
        alert("Veuillez d'abord saisir l'adresse IP de l'ESP32.");
        return;
    }
    const glyph = document.getElementById('power-main');
    const img = document.getElementById('video-stream');
    isSystemOn = !isSystemOn;
    
    if (isSystemOn) {
        glyph.classList.add('active');
        
        // Suppression radicale de tout verrou de sécurité navigateur
        img.removeAttribute('crossorigin'); 
        
        // Injection de l'adresse brute du flux vidéo
        img.src = `http://${espIp}/stream?cb=${Date.now()}`;
        
        // Forçage de l'affichage physique dans le DOM
        img.style.display = "block";
        img.style.opacity = "1";
        img.style.width = "100%";
        img.style.height = "100%";
        
        appendLog("Liaison vidéo validée. Flux direct activé.", "success");
    } else {
        glyph.classList.remove('active');
        img.src = ''; 
        img.style.display = "none";
        img.style.opacity = "0";
        if (faceDetectionInterval) clearInterval(faceDetectionInterval);
        document.getElementById('toggle-face').checked = false;
        const c = document.getElementById('ai-overlay'); if (c) c.remove();
        appendLog("Déconnexion demandée. Flux coupé.", "sys");
    }
}

// CHARGEMENT DE L'IA DEPUIS LE DEPÔT GITHUB PAGES STATIQUE ET TRANSPARENT
async function initAiEngine() {
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('https://vladmandic.github.io/face-api/model/');
        isAiReady = true;
        const badge = document.getElementById('ai-status');
        badge.innerText = "IA Locale Prête";
        badge.className = "status-badge ai-active";
        appendLog("Réseau de neurones TinyFace chargé depuis le dépôt GitHub Pages public.", "success");
    } catch (err) {
        appendLog("Erreur critique d'initialisation de l'IA.", "err");
    }
}

function toggleFaceDetection() {
    const check = document.getElementById('toggle-face').checked;
    if (!isSystemOn) { document.getElementById('toggle-face').checked = false; return; }
    
    if (check && isAiReady) {
        const img = document.getElementById('video-stream');
        let canvas = document.getElementById('ai-overlay');
        if (!canvas) {
            canvas = faceapi.createCanvasFromMedia(img);
            canvas.id = 'ai-overlay';
            document.getElementById('canvas-wrapper').appendChild(canvas);
        }
        
        faceDetectionInterval = setInterval(async () => {
            if (!isSystemOn) return;
            const size = { width: img.clientWidth, height: img.clientHeight };
            faceapi.matchDimensions(canvas, size);
            
            const detections = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 }));
            const resized = faceapi.resizeResults(detections, size);
            
            canvas.getContext('2d').clearRect(0,0, canvas.width, canvas.height);
            resized.forEach(d => {
                new faceapi.draw.DrawBox(d.box, { boxColor: '#3b82f6', lineWidth: 2 }).draw(canvas);
            });
        }, 120);
    } else {
        if (faceDetectionInterval) clearInterval(faceDetectionInterval);
        const c = document.getElementById('ai-overlay'); if (c) c.remove();
    }
}

// ENREGISTREMENT DU FLUX LOCAL COMPATIBLE CANVAS LAYER
function toggleRecording() {
    const btn = document.getElementById('rec-btn');
    const img = document.getElementById('video-stream');
    if (!isSystemOn || !img.naturalWidth) return alert("Aucun flux vidéo actif détecté.");
    
    if (isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        btn.innerText = "🔴 Enregistrer";
        btn.className = "pro-btn btn-danger";
    } else {
        recordedChunks = [];
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = img.naturalWidth;
        captureCanvas.height = img.naturalHeight;
        const ctx = captureCanvas.getContext('2d');
        
        const stream = captureCanvas.captureStream(20); // 20 FPS nominal
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `DONAMESTRE_CAPTURE_${Date.now()}.webm`;
            a.click();
            appendLog("Fichier vidéo généré et sauvegardé localement.", "success");
        };

        mediaRecorder.start();
        isRecording = true;
        btn.innerText = "⏹️ Arrêter Enr.";
        btn.className = "pro-btn btn-secondary";
        
        function drawFrame() {
            if (!isRecording) return;
            ctx.filter = img.style.filter;
            ctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
            ctx.drawImage(img, 0, 0, captureCanvas.width, captureCanvas.height);
            requestAnimationFrame(drawFrame);
        }
        drawFrame();
        appendLog("Capture vidéo locale en cours...", "cmd");
    }
}

// ENVOI PTZ BRUTE PROTEGE CONTRE LES SURCHARGES MATERIELLES
function moveH(dir) {
    if (!isSystemOn || !espIp) return;
    
    const now = Date.now();
    if (now - lastRequestTime < REQUEST_THROTTLE_MS) {
        appendLog(`Commande transitoire bloquée (Sécurité anti-surcharge).`, "err");
        return;
    }
    lastRequestTime = now;

    fetch(`http://${espIp}/ptz?dir=${dir}`, { mode: 'cors' })
        .then(() => appendLog(`Axe PTZ -> Déplacement ${dir} exécuté.`, "success"))
        .catch(() => appendLog(`Échec de transmission vers l'axe mécanique.`, "err"));
}

function sendRawControl(cmd, val) { 
    fetch(`http://${espIp}/control?cmd=${cmd}&val=${val}`, { mode: 'cors' }); 
}

function applyFilters() {
    const b = document.getElementById('slider-bright').value;
    const s = document.getElementById('slider-saturate').value;
    const c = document.getElementById('slider-contrast').value;
    document.getElementById('val-bright').innerText = b + '%';
    document.getElementById('val-saturate').innerText = s + '%';
    document.getElementById('val-contrast').innerText = c + '%';
    document.getElementById('video-stream').style.filter = `brightness(${b}%) saturate(${s}%) contrast(${c}%)`;
}

function setPreset(p) {
    const b = document.getElementById('slider-bright');
    const s = document.getElementById('slider-saturate');
    const c = document.getElementById('slider-contrast');
    const img = document.getElementById('video-stream');
    if(p==='normal'){ b.value=100; s.value=100; c.value=100; img.style.filter=''; }
    else if(p==='vision-noire'){ b.value=150; s.value=10; c.value=140; img.style.filter='brightness(150%) saturate(10%) contrast(140%) hue-rotate(90deg) sepia(100%) saturate(300%)'; }
    else if(p==='high-contrast'){ b.value=95; s.value=140; c.value=160; img.style.filter='brightness(95%) contrast(160%) saturate(140%)'; }
    else if(p==='retro'){ b.value=100; s.value=30; c.value=110; img.style.filter='contrast(110%) saturate(30%) sepia(40%)'; }
    applyFilters();
}

function rotateVideo() { 
    currentRotation = (currentRotation + 90) % 360; 
    document.getElementById('canvas-wrapper').style.transform = `rotate(${currentRotation}deg)`; 
}

function takeSnapshot() { 
    const img = document.getElementById('video-stream'); 
    if(!isSystemOn||!img.naturalWidth) return; 
    const cv=document.createElement('canvas'); 
    cv.width=img.naturalWidth; cv.height=img.naturalHeight; 
    const ctx = cv.getContext('2d');
    ctx.filter = img.style.filter;
    ctx.drawImage(img,0,0); 
    const l=document.createElement('a'); 
    l.download=`DONAMESTRE_SNAP_${Date.now()}.jpg`; 
    l.href=cv.toDataURL('image/jpeg', 0.95); 
    l.click(); 
}
