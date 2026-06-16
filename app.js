let currentRotation = 0;
let isSystemOn = false;
let espIp = localStorage.getItem('donamestre_ip') || '';
let logCount = 0;
let isAiReady = false;
let faceDetectionInterval = null;

// SÉCURITÉ ANTI-REBOND POUR LE MOTEUR (Évite le crash de l'ESP32)
let lastRequestTime = 0;
const REQUEST_THROTTLE_MS = 250; 

// VARIABLES D'ENREGISTREMENT VIDÉO LOCAL
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

// BASE DE DONNÉES DES COMMANDES POUR LE PANNEAU LATÉRAL
const COMMANDS_DATABASE = [
    { syntax: "home", desc: "Exécute le recalage initial sur la butée physique." },
    { syntax: "left", desc: "Fait tourner l'axe horizontal vers la gauche." },
    { syntax: "right", desc: "Fait tourner l'axe horizontal vers la droite." },
    { syntax: "vision-noire", desc: "Active l'intensification lumineuse verte." },
    { syntax: "high-contrast", desc: "Bascule sur le filtre de surveillance haute-définition." },
    { syntax: "normal", desc: "Réinitialise tous les filtres graphiques." },
    { syntax: "quality=10", desc: "Configure la compression JPEG (Haute Qualité)." },
    { syntax: "quality=30", desc: "Configure la compression (Basse Qualité / Fluide)." },
    { syntax: "status", desc: "Interroge l'état matériel et logiciel de l'hôte local." },
    { syntax: "clear", desc: "Efface l'intégralité de l'historique de la console." }
];

window.addEventListener('DOMContentLoaded', async () => {
    if (espIp) document.getElementById('esp-ip').value = espIp;
    buildSidebarCommands();
    initAiEngine();
});

// SYSTÈME DE LOGS ET COPIE
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
        .catch(() => alert("Erreur lors de la copie."));
}

function clearConsole() {
    document.getElementById('console-output').innerHTML = '';
    logCount = 0;
    document.getElementById('log-count').innerText = "0";
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    event.currentTarget.classList.add('active');
}

// GESTION DU PANNEAU LATÉRAL (Recherche et Injection)
function buildSidebarCommands() {
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
    appendLog(`Exécution : ${syntax}`, 'cmd');
    if (syntax === 'clear') clearConsole();
    else if (['left', 'right', 'home'].includes(syntax)) moveH(syntax);
    else if (['normal', 'vision-noire', 'retro', 'high-contrast'].includes(syntax)) setPreset(syntax);
    else if (syntax.startsWith('quality=')) sendRawControl('quality', syntax.split('=')[1]);
    else if (syntax === 'status') appendLog(`Liaison=${isSystemOn} // IA=${isAiReady}`, 'sys');
    else appendLog(`Commande non reconnue`, 'err');
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

// LIAISON RÉSEAU ET GESTION DU FLUX VIDÉO
function connectSystem() {
    const input = document.getElementById('esp-ip').value.trim();
    if (!input) return alert("Veuillez spécifier une adresse IP.");
    
    espIp = input.replace(/^https?:\/\//, '').replace(/\/$/, '');
    localStorage.setItem('donamestre_ip', espIp);
    appendLog(`Vérification de l'hôte distant sur http://${espIp}...`, 'sys');
    
    fetch(`http://${espIp}/control?cmd=ping`, { mode: 'cors' })
        .then(r => r.text())
        .then(res => {
            if (res.includes("PONG")) {
                appendLog("Poignée de main matérielle réussie.", "success");
                if (!isSystemOn) toggleSystem();
            }
        })
        .catch(() => appendLog("Échec réseau : Vérifiez l'adresse IP saisie ou l'alimentation.", "err"));
}

function toggleSystem() {
    if (!espIp) return;
    const glyph = document.getElementById('power-main');
    const img = document.getElementById('video-stream');
    isSystemOn = !isSystemOn;
    
    if (isSystemOn) {
        glyph.classList.add('active');
        // Flux direct sans attribut crossorigin bloquant
        img.src = `http://${espIp}/stream`;
        appendLog("Liaison vidéo validée. Flux direct activé.", "success");
    } else {
        glyph.classList.remove('active');
        img.src = ''; 
        if (faceDetectionInterval) clearInterval(faceDetectionInterval);
        document.getElementById('toggle-face').checked = false;
        const c = document.getElementById('ai-overlay'); if (c) c.remove();
        appendLog("Déconnexion demandée. Flux coupé.", "sys");
    }
}

// IA - TÉLÉCHARGÉE DEPUIS LE DÉPÔT STATIQUE GITHUB
async function initAiEngine() {
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('https://vladmandic.github.io/face-api/model/');
        isAiReady = true;
        const badge = document.getElementById('ai-status');
        badge.innerText = "IA Locale Prête";
        badge.className = "status-badge ai-active";
        appendLog("Réseau de neurones TinyFace chargé depuis le dépôt GitHub public.", "success");
    } catch (err) {
        appendLog("Erreur de chargement des poids de neurones.", "err");
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

// ENREGISTREMENT VIDÉO LOCAL
function toggleRecording() {
    const btn = document.getElementById('rec-btn');
    const img = document.getElementById('video-stream');
    
    if (!isSystemOn || !img.naturalWidth) return alert("Aucun flux actif à filmer.");
    
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
        
        const stream = captureCanvas.captureStream(20);
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `DONAMESTRE_REC_${Date.now()}.webm`;
            a.click();
            appendLog("Fichier vidéo généré et enregistré localement.", "success");
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
        appendLog("Capture vidéo en cours...", "cmd");
    }
}

// CONTRÔLE MATÉRIEL PTZ ET FILTRES
function moveH(dir) {
    if (!isSystemOn || !espIp) return;
    
    const now = Date.now();
    if (now - lastRequestTime < REQUEST_THROTTLE_MS) {
        appendLog(`Commande rejetée : Temporisation de sécurité réseau active.`, "err");
        return;
    }
    lastRequestTime = now;

    fetch(`http://${espIp}/ptz?dir=${dir}`, { mode: 'cors' })
        .then(() => appendLog(`Axe PTZ -> ${dir}`, "success"))
        .catch(() => appendLog(`Échec de transmission PTZ.`, "err"));
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
