// VARIABLES GLOBALES ET INITIALISATION DES PARAMÈTRES
let currentRotation = parseInt(localStorage.getItem('donamestre_rotation')) || 0;
let isSystemOn = false;
let logCount = 0;

// Détection automatique de l'IP de la carte
let espIp = window.location.hostname;
if (!espIp || espIp === "localhost" || espIp.includes("github.io")) {
    espIp = localStorage.getItem('donamestre_ip') || '';
}

let isAiReady = false;
let faceDetectionInterval = null;

// SÉCURITÉ RESEAU : ANTI-REBOND (DEBOUNCE)
let lastRequestTime = 0;
const REQUEST_THROTTLE_MS = 250; 

// MODULE D'ENREGISTREMENT LOCAL VIDEO
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

// ALGORITHME DE REPIXELISATION
let useUpscaling = localStorage.getItem('donamestre_upscale') === 'true';

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
    { syntax: "upscale=on", desc: "Active la repixelisation logicielle par convolution." },
    { syntax: "upscale=off", desc: "Désactive la repixelisation logicielle." },
    { syntax: "clear", desc: "Efface l'intégralité de l'historique de la console." }
];

// GENERATION DYNAMIQUE ABSOLUTE AU CHARGEMENT (Soulage l'ESP32)
window.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('app-root');
    if (!root) return;

    // Injection de toute la structure HTML d'origine
    root.innerHTML = `
        <div class='app-container'>
            <header class='main-header'>
                <div class='logo-area'>
                    <h1>D<span>O</span>NAMESTRE</h1>
                    <p class='subtitle'>AXIS-H MONITORING INTERFACE</p>
                </div>
                <div class='connection-panel'>
                    <input type='text' id='esp-ip' class='ip-input' placeholder='Ex: 192.168.1.20' />
                    <button id='power-main' class='connect-btn' onclick='connectSystem()'>Lier l'appareil</button>
                </div>
            </header>

            <nav class='tab-navigation'>
                <button id='btn-tab-live' class='tab-btn active' onclick="switchTab('live')">🎬 Studio Live</button>
                <button id='btn-tab-console' class='tab-btn' onclick="switchTab('console')">📟 Console & Commandes <span id='log-count' class='badge'>0</span></button>
            </nav>

            <main class='interface-body'>
                <div id='tab-live' class='tab-content active'>
                    <div class='studio-grid'>
                        <div class='video-card'>
                            <div class='card-header'>
                                <span class='status-indicator'>Réseau Local Sécurisé</span>
                                <span id='ai-status' class='status-badge'>IA Inactive</span>
                            </div>
                            <div class='video-view' id='canvas-wrapper'>
                                <img id='video-stream' src='' alt='Aucun flux vidéo actif. Connectez l\`ESP32.' />
                            </div>
                            <div class='video-actions'>
                                <button class='pro-btn' onclick='rotateVideo()'>🔄 Rotation 90°</button>
                                <button class='pro-btn' onclick='takeSnapshot()'>📸 Capture HD</button>
                                <button id='rec-btn' class='pro-btn btn-danger' onclick='toggleRecording()'>🔴 Enregistrer</button>
                            </div>
                        </div>

                        <div class='control-card'>
                            <section class='control-section'>
                                <h3>TRAITEMENT D'IMAGE (LOCAL)</h3>
                                <div class='toggle-row'>
                                    <label for='toggle-face'>Détection faciale active</label>
                                    <input type='checkbox' id='toggle-face' onchange='toggleFaceDetection()' class='switch-input' />
                                </div>
                                <div class='slider-group'>
                                    <div class='slider-header'><span>Luminosité</span><span id='val-bright'>100%</span></div>
                                    <input type='range' id='slider-bright' min='0' max='200' value='100' oninput='applyFilters()' />
                                </div>
                                <div class='slider-group'>
                                    <div class='slider-header'><span>Saturation</span><span id='val-saturate'>100%</span></div>
                                    <input type='range' id='slider-saturate' min='0' max='200' value='100' oninput='applyFilters()' />
                                </div>
                                <div class='slider-group'>
                                    <div class='slider-header'><span>Contraste</span><span id='val-contrast'>100%</span></div>
                                    <input type='range' id='slider-contrast' min='0' max='200' value='100' oninput='applyFilters()' />
                                </div>
                                <div class='preset-grid'>
                                    <button onclick="setPreset('normal')">Normal</button>
                                    <button onclick="setPreset('vision-noire')">Vision Nuit</button>
                                    <button onclick="setPreset('high-contrast')">Surveillance</button>
                                    <button onclick="executeDirectCommand('status')">État Matériel</button>
                                </div>
                            </section>

                            <section class='control-section'>
                                <h3>CONTRÔLE DE L'AXE</h3>
                                <div class='axis-grid'>
                                    <button class='axis-btn' onclick="moveH('left')">◀ Gauche</button>
                                    <button class='axis-btn homing' onclick="moveH('home')">🏠 Homing</button>
                                    <button class='axis-btn' onclick="moveH('right')">Droite ▶</button>
                                </div>
                            </section>
                        </div>
                    </div>
                </div>

                <div id='tab-console' class='tab-content'>
                    <div class='console-grid'>
                        <div class='console-card'>
                            <div class='console-header'>
                                <h3>CONSOLE LOGS</h3>
                                <div class='console-actions'>
                                    <button onclick='copyLogs()'>📋 Copier</button>
                                    <button onclick='clearConsole()'>🗑️ Effacer</button>
                                </div>
                            </div>
                            <div id='console-output' class='console-terminal'></div>
                            <div class='console-input-wrapper'>
                                <input type='text' id='cmd-field' placeholder='Saisir une syntaxe commande...' onkeydown='handleConsoleInput(event)' />
                            </div>
                        </div>

                        <div class='dictionary-card'>
                            <div class='dictionary-header'>
                                <h3>DICTIONNAIRE LOCAL</h3>
                                <input type='text' id='sidebar-search' placeholder='Filtrer les commandes...' oninput='filterCommands()' />
                            </div>
                            <div id='commands-container' class='dictionary-list'></div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    `;

    // Configuration du champ IP
    const ipField = document.getElementById('esp-ip');
    if (ipField && espIp) ipField.value = espIp;
    
    // Lancement des fonctions d'initialisation applicatives
    if (espIp) connectSystem();
    restoreSavedConfig();
    buildSidebarCommands();
    initAiEngine();
    startProcessingLoop();
});

// SAUVEGARDE ET RESTAURATION AUTOMATIQUE DES CONFIGURATIONS
function restoreSavedConfig() {
    const b = localStorage.getItem('donamestre_bright') || '100';
    const s = localStorage.getItem('donamestre_saturate') || '100';
    const c = localStorage.getItem('donamestre_contrast') || '100';
    
    if(document.getElementById('slider-bright')) document.getElementById('slider-bright').value = b;
    if(document.getElementById('slider-saturate')) document.getElementById('slider-saturate').value = s;
    if(document.getElementById('slider-contrast')) document.getElementById('slider-contrast').value = c;
    
    const wrapper = document.getElementById('canvas-wrapper');
    if (wrapper) wrapper.style.transform = `rotate(${currentRotation}deg)`;
    applyFilters();
}

function saveConfigToLocalStorage() {
    const bSlider = document.getElementById('slider-bright');
    const sSlider = document.getElementById('slider-saturate');
    const cSlider = document.getElementById('slider-contrast');

    if (bSlider) localStorage.setItem('donamestre_bright', bSlider.value);
    if (sSlider) localStorage.setItem('donamestre_saturate', sSlider.value);
    if (cSlider) localStorage.setItem('donamestre_contrast', cSlider.value);
    
    localStorage.setItem('donamestre_rotation', currentRotation);
    localStorage.setItem('donamestre_upscale', useUpscaling);
}

// LOGS SYSTEME
function appendLog(message, type = 'sys') {
    const consoleBody = document.getElementById('console-output');
    if (!consoleBody) return;
    const row = document.createElement('div');
    row.className = `log-row ${type}`;
    row.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
    consoleBody.appendChild(row);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    
    logCount++;
    const countBadge = document.getElementById('log-count');
    if (countBadge) countBadge.innerText = logCount;
}

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
