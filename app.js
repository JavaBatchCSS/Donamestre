// ==========================================
// 1. DÉCLARATION SÉCURISÉE DES VARIABLES GLOBALES
// ==========================================
var logCount = 0; // Doit impérativement être tout en haut !
var currentRotation = parseInt(localStorage.getItem('donamestre_rotation')) || 0;
var isSystemOn = false;

// Détection automatique de l'IP de la carte
var espIp = window.location.hostname;
if (!espIp || espIp === "localhost" || espIp.includes("github.io")) {
    espIp = localStorage.getItem('donamestre_ip') || '';
}

var isAiReady = false;
var faceDetectionInterval = null;
var lastRequestTime = 0;
const REQUEST_THROTTLE_MS = 250; 

var mediaRecorder;
var recordedChunks = [];
var isRecording = false;
var useUpscaling = localStorage.getItem('donamestre_upscale') === 'true';

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
    { syntax: "upscale=on", desc: "Active la repixelisation logicielle par convolution." },
    { syntax: "upscale=off", desc: "Désactive la repixelisation logicielle." },
    { syntax: "clear", desc: "Efface l'intégralité de l'historique de la console." }
];

// ==========================================
// 2. ÉVÉNEMENT PRINCIPAL DE GÉNÉRATION D'INTERFACE
// ==========================================
window.addEventListener('DOMContentLoaded', function() {
    const root = document.getElementById('app-root');
    if (!root) return;

    // Réinitialisation forcée du compteur de logs à l'affichage initial
    logCount = 0;

    root.innerHTML = `
        <body>
    <div class="app-container">
        <header class="pro-header">
            <div class="brand-zone">
                <h1 class="pro-logo">D<span class="power-glyph" id="power-main" onclick="toggleSystem()">⏻</span>NAMESTRE</h1>
                <div class="sub-brand">AXIS-H MONITORING INTERFACE</div>
            </div>
            <div class="connection-zone">
                <input type="text" id="esp-ip" class="pro-input" placeholder="Adresse IP (ex: 192.168.1.20)">
                <button onclick="connectSystem()" class="pro-btn btn-primary">Lier l'appareil</button>
            </div>
        </header>

        <div class="tabs-nav">
            <button class="tab-btn active" onclick="switchTab('studio')">🎬 Studio Live</button>
            <button class="tab-btn" onclick="switchTab('terminal')">📟 Console & Commandes <span id="log-count" class="badge">0</span></button>
        </div>

        <main class="main-content">
            <div id="tab-studio" class="tab-content active">
                <div class="studio-grid">
                    <div class="pro-card video-card">
                        <div class="video-viewport">
                            <div class="status-badge secure">Réseau Local Sécurisé</div>
                            <div id="ai-status" class="status-badge ai-inactive">IA Inactive</div>
                            <div class="canvas-container" id="canvas-wrapper">
                                <img id="video-stream" src="" alt="Aucun flux vidéo actif. Connectez l'ESP32.">
                            </div>
                        </div>
                        <div class="action-bar">
                            <button class="pro-btn" onclick="rotateVideo()">🔄 Rotation 90°</button>
                            <button class="pro-btn btn-secondary" onclick="takeSnapshot()">📸 Capture HD</button>
                            <button class="pro-btn btn-danger" id="rec-btn" onclick="toggleRecording()">🔴 Enregistrer</button>
                        </div>
                    </div>

                    <div class="pro-card settings-card">
                        <div class="section-title">Traitement d'image (Local)</div>
                        
                        <div class="toggle-row">
                            <span class="label-text">Détection faciale active</span>
                            <label class="pro-switch">
                                <input type="checkbox" id="toggle-face" onchange="toggleFaceDetection()">
                                <span class="switch-slider"></span>
                            </label>
                        </div>

                        <div class="range-group">
                            <div class="range-labels"><span>Luminosité</span><span id="val-bright" class="value-display">100%</span></div>
                            <input type="range" min="30" max="250" value="100" class="pro-slider" id="slider-bright" oninput="applyFilters()">
                        </div>
                        
                        <div class="range-group">
                            <div class="range-labels"><span>Saturation</span><span id="val-saturate" class="value-display">100%</span></div>
                            <input type="range" min="0" max="250" value="100" class="pro-slider" id="slider-saturate" oninput="applyFilters()">
                        </div>

                        <div class="range-group">
                            <div class="range-labels"><span>Contraste</span><span id="val-contrast" class="value-display">100%</span></div>
                            <input type="range" min="50" max="200" value="100" class="pro-slider" id="slider-contrast" oninput="applyFilters()">
                        </div>

                        <div class="preset-grid">
                            <button class="pro-btn btn-small" onclick="setPreset('normal')">Normal</button>
                            <button class="pro-btn btn-small" onclick="setPreset('vision-noire')">Vision Nuit</button>
                            <button class="pro-btn btn-small" onclick="setPreset('retro')">Contraste YUV</button>
                            <button class="pro-btn btn-small" onclick="setPreset('high-contrast')">Surveillance</button>
                        </div>

                        <div class="ptz-section">
                            <div class="section-title">Contrôle de l'axe</div>
                            <div class="ptz-row">
                                <button class="pro-btn" onclick="moveH('left')">◀ Gauche</button>
                                <button class="pro-btn btn-center" onclick="moveH('home')">⌂ Homing</button>
                                <button class="pro-btn" onclick="moveH('right')">Droite ▶</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="tab-terminal" class="tab-content">
                <div class="terminal-layout">
                    <div class="pro-card console-main">
                        <div class="panel-header">
                            <span class="panel-title">Stdout System Log</span>
                            <div class="header-actions">
                                <button onclick="copyLogs()" class="pro-btn btn-small">📋 Copier les logs</button>
                                <button onclick="clearConsole()" class="pro-btn btn-small">Effacer</button>
                            </div>
                        </div>
                        <div class="terminal-box" id="console-output">
                            <div class="log-row sys">[SYS] Initialisation de la console de contrôle.</div>
                        </div>
                        <div class="terminal-input-bar">
                            <span class="prompt">></span>
                            <input type="text" id="cmd-field" placeholder="Entrer une commande (ex: home, left, normal)..." onkeydown="handleConsoleInput(event)">
                        </div>
                    </div>

                    <div class="pro-card console-sidebar">
                        <div class="sidebar-header">
                            <div class="section-title" style="margin-bottom: 10px;">Dictionnaire de commandes</div>
                            <input type="text" id="sidebar-search" class="pro-input search-input" placeholder="🔍 Rechercher une commande..." oninput="filterCommands()">
                        </div>
                        <div class="command-list" id="commands-container">
                            </div>
                    </div>
                </div>
            </div>
        </main>
    </div>
    <script src="app.js"></script>
</body>
    `;

    const ipField = document.getElementById('esp-ip');
    if (ipField && espIp) ipField.value = espIp;
    
    if (espIp) connectSystem();
    restoreSavedConfig();
    buildSidebarCommands();
    initAiEngine();
    startProcessingLoop();
});

// S'assurer que appendLog utilise correctement la variable globale globale
function appendLog(message, type) {
    if(!type) type = 'sys';
    const consoleBody = document.getElementById('console-output');
    if (!consoleBody) return;
    const row = document.createElement('div');
    row.className = `log-row \${type}`;
    row.innerText = `[\${new Date().toLocaleTimeString()}] \${message}`;
    consoleBody.appendChild(row);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    
    logCount++;
    const countBadge = document.getElementById('log-count');
    if (countBadge) countBadge.innerText = logCount;
}

// ... CONSERVER LE RESTE DES FONCTIONS (connectSystem, switchTab, moveH, etc.) SANS TOUCHER À LEUR LOGIQUE INTERNE ...

function copyLogs() {
    const consoleBody = document.getElementById('console-output');
    if (!consoleBody) return;
    navigator.clipboard.writeText(consoleBody.innerText)
        .then(() => appendLog("Succès : Les logs ont été copiés dans le presse-papier.", "success"))
        .catch(() => alert("Erreur lors de l'accès au presse-papier."));
}

function clearConsole() {
    const consoleBody = document.getElementById('console-output');
    if (consoleBody) consoleBody.innerHTML = '';
    logCount = 0;
    const countBadge = document.getElementById('log-count');
    if (countBadge) countBadge.innerText = "0";
}

// CHANGEMENT D'ONGLET
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    const targetTab = document.getElementById(`tab-${tabId}`);
    const targetBtn = document.getElementById(`btn-tab-${tabId}`);
    if (targetTab) targetTab.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');
}

// FILTRE ET RECHERCHE DU PANNEAU LATÉRAL
function buildSidebarCommands() {
    const container = document.getElementById('commands-container');
    if (!container) return; 
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
    const searchField = document.getElementById('sidebar-search');
    if (!searchField) return;
    const query = searchField.value.toLowerCase().trim();
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
    else if (syntax === 'upscale=on') { useUpscaling = true; saveConfigToLocalStorage(); appendLog("Repixelisation logicielle activée.", "success"); }
    else if (syntax === 'upscale=off') { useUpscaling = false; saveConfigToLocalStorage(); appendLog("Repixelisation désactivée.", "sys"); }
    else if (syntax === 'status') appendLog(`Liaison=${isSystemOn} // IA=${isAiReady} // Upscale=${useUpscaling}`, 'sys');
    else appendLog(`Syntaxe inconnue.`, 'err');
}

function handleConsoleInput(e) {
    if (e.key === 'Enter') {
        const input = document.getElementById('cmd-field');
        if (!input) return;
        const cmd = input.value.trim().toLowerCase();
        if (!cmd) return;
        executeDirectCommand(cmd);
        input.value = '';
    }
}

function connectSystem() {
    let input = espIp;
    const ipField = document.getElementById('esp-ip');
    if (ipField && ipField.value.trim()) {
        input = ipField.value.trim();
    }
    if (!input) return;
    
    espIp = input.replace(/^https?:\/\//, '').replace(/\/$/, '');
    localStorage.setItem('donamestre_ip', espIp);
    appendLog(`Liaison automatique : Vérification de l'hôte distant sur http://${espIp}...`, 'sys');
    
    fetch(`http://${espIp}/control?cmd=ping`, { mode: 'cors' })
        .then(r => r.text())
        .then(res => {
            if (res.includes("PONG")) {
                appendLog("Poignée de main matérielle réussie. Liaison OK.", "success");
                if(!isSystemOn) toggleSystem(); 
            }
        })
        .catch(() => appendLog("L'appareil n'est pas encore synchronisé (En attente du flux).", "err"));
}

function toggleSystem() {
    if (!espIp) return;
    const glyph = document.getElementById('power-main');
    const img = document.getElementById('video-stream');
    if (!img) return;
    isSystemOn = !isSystemOn;
    
    if (isSystemOn) {
        if(glyph) glyph.classList.add('active');
        img.setAttribute('crossorigin', 'anonymous');
        img.crossOrigin = "anonymous"; 
        img.src = `http://${espIp}/stream?cb=${Date.now()}`;
        img.style.display = "block";
        img.style.opacity = "1";
        appendLog("Flux direct sécurisé activé. Prêt pour capture.", "success");
    } else {
        if(glyph) glyph.classList.remove('active');
        img.src = ''; 
        img.style.display = "none";
        if (faceDetectionInterval) clearInterval(faceDetectionInterval);
        const faceCheck = document.getElementById('toggle-face');
        if (faceCheck) faceCheck.checked = false;
        const c = document.getElementById('ai-overlay'); if (c) c.remove();
        appendLog("Flux coupé.", "sys");
    }
}

// REPIXELISATION PAR CONVOLUTION
function startProcessingLoop() {
    const img = document.getElementById('video-stream');
    if (!img) return;
    const procCanvas = document.createElement('canvas');
    const procCtx = procCanvas.getContext('2d');
    
    function processFrame() {
        if (isSystemOn && useUpscaling && img.naturalWidth) {
            if (procCanvas.width !== img.naturalWidth) {
                procCanvas.width = img.naturalWidth;
                procCanvas.height = img.naturalHeight;
                procCanvas.style.width = "100%";
                procCanvas.style.height = "100%";
                procCanvas.id = "processed-canvas";
                img.style.display = "none"; 
                if(!document.getElementById('processed-canvas')) {
                    img.parentNode.insertBefore(procCanvas, img);
                }
            }
            
            procCtx.drawImage(img, 0, 0);
            const weights = [  0, -1,  0, 
                              -1,  5, -1, 
                               0, -1,  0 ]; 
            
            let src = procCtx.getImageData(0, 0, procCanvas.width, procCanvas.height);
            let dst = procCtx.createImageData(src.width, src.height);
            
            for (let y = 1; y < src.height - 1; y++) {
                for (let x = 1; x < src.width - 1; x++) {
                    for (let c = 0; c < 3; c++) { 
                        let i = (y * src.width + x) * 4 + c;
                        let sum = 0;
                        for (let ky = -1; ky <= 1; ky++) {
                            for (let kx = -1; kx <= 1; kx++) {
                                let pi = ((y + ky) * src.width + (x + kx)) * 4 + c;
                                let weight = weights[(ky + 1) * 3 + (kx + 1)];
                                sum += src.data[pi] * weight;
                            }
                        }
                        dst.data[i] = Math.min(Math.max(sum, 0), 255);
                    }
                    dst.data[(y * src.width + x) * 4 + 3] = 255; 
                }
            }
            procCtx.putImageData(dst, 0, 0);
        } else {
            const pc = document.getElementById('processed-canvas');
            if(pc) pc.remove();
            img.style.display = isSystemOn ? "block" : "none";
        }
        requestAnimationFrame(processFrame);
    }
    requestAnimationFrame(processFrame);
}

// RECONNAISSANCE FACIALE
async function initAiEngine() {
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('https://vladmandic.github.io/face-api/model/');
        isAiReady = true;
        const badge = document.getElementById('ai-status');
        if(badge) { badge.innerText = "IA Locale Prête"; badge.className = "status-badge ai-active"; }
        appendLog("Réseau de neurones TinyFace initialisé automatiquement.", "success");
    } catch (err) {
        appendLog("Échec de chargement des modèles de vision neuronale.", "err");
    }
}

function toggleFaceDetection() {
    const faceCheck = document.getElementById('toggle-face');
    if (!faceCheck) return;
    const check = faceCheck.checked;
    if (!isSystemOn) { faceCheck.checked = false; return; }
    
    if (check && isAiReady) {
        const img = document.getElementById('video-stream');
        let canvas = document.getElementById('ai-overlay');
        if (!canvas && img) {
            canvas = faceapi.createCanvasFromMedia(img);
            canvas.id = 'ai-overlay';
            const wrapper = document.getElementById('canvas-wrapper');
            if (wrapper) wrapper.appendChild(canvas);
        }
        
        faceDetectionInterval = setInterval(async () => {
            if (!isSystemOn || !img) return;
            const size = { width: img.clientWidth, height: img.clientHeight };
            faceapi.matchDimensions(canvas, size);
            
            const detections = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 }));
            const resized = faceapi.resizeResults(detections, size);
            
            if (canvas) {
                canvas.getContext('2d').clearRect(0,0, canvas.width, canvas.height);
                resized.forEach(d => {
                    new faceapi.draw.DrawBox(d.box, { boxColor: '#3b82f6', lineWidth: 2 }).draw(canvas);
                    
                    const faceCenterX = d.box.x + (d.box.width / 2);
                    const frameCenterX = size.width / 2;
                    if (faceCenterX < frameCenterX - 40) moveH('left');
                    else if (faceCenterX > frameCenterX + 40) moveH('right');
                });
            }
        }, 150);
    } else {
        if (faceDetectionInterval) clearInterval(faceDetectionInterval);
        const c = document.getElementById('ai-overlay'); if (c) c.remove();
    }
}

// ENREGISTREMENT ET CAPTURES
function toggleRecording() {
    const btn = document.getElementById('rec-btn');
    const img = document.getElementById('video-stream');
    if (!isSystemOn || !img || !img.naturalWidth) return alert("Aucun flux actif.");
    
    if (isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        if (btn) {
            btn.innerText = "🔴 Enregistrer";
            btn.className = "pro-btn btn-danger";
        }
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
            a.href = url; a.download = `DONAMESTRE_CAPTURE_${Date.now()}.webm`;
            a.click();
        };

        mediaRecorder.start();
        isRecording = true;
        if (btn) btn.innerText = "⏹️ Arrêter";
        
        function drawFrame() {
            if (!isRecording) return;
            ctx.filter = img.style.filter;
            ctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
            const pc = document.getElementById('processed-canvas');
            if(pc) ctx.drawImage(pc, 0, 0); else ctx.drawImage(img, 0, 0);
            requestAnimationFrame(drawFrame);
        }
        drawFrame();
    }
}

function moveH(dir) {
    if (!isSystemOn || !espIp) return;
    const now = Date.now();
    if (now - lastRequestTime < REQUEST_THROTTLE_MS) return;
    lastRequestTime = now;

    fetch(`http://${espIp}/ptz?dir=${dir}`, { mode: 'cors' })
        .catch(() => appendLog(`Perte de liaison PTZ.`, "err"));
}

// CONTROLES FILTRES ET EFFETS
function sendRawControl(cmd, val) { 
    if (!espIp) return;
    fetch(`http://${espIp}/control?cmd=${cmd}&val=${val}`, { mode: 'cors' }); 
}

function applyFilters() {
    const bSlider = document.getElementById('slider-bright');
    const sSlider = document.getElementById('slider-saturate');
    const cSlider = document.getElementById('slider-contrast');
    if (!bSlider || !sSlider || !cSlider) return;
    
    const b = bSlider.value; const s = sSlider.value; const c = cSlider.value;
    
    const bVal = document.getElementById('val-bright');
    const sVal = document.getElementById('val-saturate');
    const cVal = document.getElementById('val-contrast');
    if (bVal) bVal.innerText = b + '%';
    if (sVal) sVal.innerText = s + '%';
    if (cVal) cVal.innerText = c + '%';
    
    const filterString = `brightness(${b}%) saturate(${s}%) contrast(${c}%)`;
    const img = document.getElementById('video-stream');
    if (img) img.style.filter = filterString;
    
    saveConfigToLocalStorage();
}

function setPreset(p) {
    const b = document.getElementById('slider-bright');
    const s = document.getElementById('slider-saturate');
    const c = document.getElementById('slider-contrast');
    const img = document.getElementById('video-stream');
    if (!b || !s || !c || !img) return;
    
    if(p==='normal'){ b.value=100; s.value=100; c.value=100; img.style.filter=''; }
    else if(p==='vision-noire'){ b.value=150; s.value=10; c.value=140; img.style.filter='brightness(150%) saturate(10%) contrast(140%) hue-rotate(90deg) sepia(100%) saturate(300%)'; }
    else if(p==='high-contrast'){ b.value=95; s.value=140; c.value=160; img.style.filter='brightness(95%) contrast(160%) saturate(140%)'; }
    applyFilters();
}

function rotateVideo() { 
    currentRotation = (currentRotation + 90) % 360; 
    const wrapper = document.getElementById('canvas-wrapper');
    if (wrapper) wrapper.style.transform = `rotate(${currentRotation}deg)`; 
    saveConfigToLocalStorage();
}

function takeSnapshot() { 
    const img = document.getElementById('video-stream'); 
    if(!isSystemOn || !img || !img.naturalWidth) return; 
    const cv=document.createElement('canvas'); 
    cv.width=img.naturalWidth; cv.height=img.naturalHeight; 
    const ctx = cv.getContext('2d');
    ctx.filter = img.style.filter;
    const pc = document.getElementById('processed-canvas');
    if(pc) ctx.drawImage(pc, 0, 0); else ctx.drawImage(img, 0, 0);
    const l=document.createElement('a'); 
    l.download=`DONAMESTRE_SNAP_${Date.now()}.jpg`; 
    l.href=cv.toDataURL('image/jpeg', 0.95); 
    l.click(); 
}
