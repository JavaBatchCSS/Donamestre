// ==========================================
// S3-PRO PTZ — APP.JS
// Interface Donamestre adaptée pour 2 axes Pan/Tilt
// Génère dynamiquement tout le HTML
// ==========================================

var logCount = 0;
var currentRotation = parseInt(localStorage.getItem('ptz_rotation')) || 0;
var isSystemOn = false;
var useMirrorH = localStorage.getItem('ptz_mirror_h') === 'true';
var useMirrorV = localStorage.getItem('ptz_mirror_v') === 'true';
var espIp = window.location.hostname;

if (!espIp || espIp === "localhost" || espIp.includes("github.io")) {
    espIp = localStorage.getItem('ptz_ip') || '';
}

var isAiReady = false;
var faceDetectionInterval = null;
var lastRequestTime = 0;
const REQUEST_THROTTLE_MS = 300;

var mediaRecorder;
var recordedChunks = [];
var isRecording = false;
var useUpscaling = localStorage.getItem('ptz_upscale') === 'true';

const COMMANDS_DATABASE = [
    { syntax: "home", desc: "Recalage physique + centrage sur les deux axes" },
    { syntax: "left", desc: "Pan 32 pas vers la gauche" },
    { syntax: "right", desc: "Pan 32 pas vers la droite" },
    { syntax: "up", desc: "Tilt 32 pas vers le haut" },
    { syntax: "down", desc: "Tilt 32 pas vers le bas" },
    { syntax: "hleft", desc: "Pan continu vers la gauche (maintenir)" },
    { syntax: "hright", desc: "Pan continu vers la droite (maintenir)" },
    { syntax: "vup", desc: "Tilt continu vers le haut (maintenir)" },
    { syntax: "vdown", desc: "Tilt continu vers le bas (maintenir)" },
    { syntax: "vision-noire", desc: "Active l'intensification lumineuse verte" },
    { syntax: "high-contrast", desc: "Filtre surveillance haute définition" },
    { syntax: "normal", desc: "Réinitialise tous les filtres" },
    { syntax: "status", desc: "Interroge l'état matériel et réseau" },
    { syntax: "clear", desc: "Efface la console" }
];

// ==========================================
// INITIALISATION DOM
// ==========================================
window.addEventListener('DOMContentLoaded', function() {
    const root = document.getElementById('app-root');
    if (!root) return;

    logCount = 0;

    root.innerHTML = `
    <div class="app-container">
        <header class="pro-header">
            <div class="brand-zone">
                <h1 class="pro-logo">S3-PRO <span class="power-glyph" id="power-main" onclick="toggleSystem()">⏻</span> PTZ</h1>
                <div class="sub-brand">PAN/TILT DUAL-AXIS MONITORING</div>
            </div>
            <div class="connection-zone">
                <input type="text" id="esp-ip" class="pro-input" placeholder="Adresse IP (ex: 192.168.1.20)" value="${espIp}">
                <button onclick="connectSystem()" class="pro-btn btn-primary">Lier l'appareil</button>
            </div>
        </header>

        <div class="tabs-nav">
            <button id="nav-studio" class="tab-btn active" onclick="switchTab('studio')">🎬 Studio Live</button>
            <button id="nav-terminal" class="tab-btn" onclick="switchTab('terminal')">📟 Terminal</button>
        </div>

        <div id="tab-studio" class="tab-content active">
            <div class="studio-grid">
                <div class="video-zone">
                    <div class="video-viewport">
                        <div class="status-badge secure">● SÉCURISÉ</div>
                        <div id="ai-badge" class="status-badge ai-inactive">IA INACTIF</div>
                        <img id="video-stream" src="" alt="En attente de connexion...">
                    </div>
                    <div class="action-bar">
                        <button onclick="rotateStream()" class="pro-btn">↻ Rotation 90°</button>
                        <button onclick="capturePhoto()" class="pro-btn">📸 Capture HD</button>
                        <button id="btn-record" onclick="toggleRecord()" class="pro-btn btn-danger">🔴 Enregistrer</button>
                    </div>
                </div>

                <div class="side-panel">
                    <!-- PTZ PAN/TILT -->
                    <div class="pro-card">
                        <div class="section-title">🎮 Contrôle Pan / Tilt</div>
                        <div class="ptz-grid">
                            <div></div>
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="ptzStart('V', -32)" 
                                onmouseup="ptzStop()" 
                                onmouseleave="ptzStop()"
                                ontouchstart="ptzStart('V', -32)" 
                                ontouchend="ptzStop()">▲</button>
                            <div></div>
                            
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="ptzStart('H', -32)" 
                                onmouseup="ptzStop()" 
                                onmouseleave="ptzStop()"
                                ontouchstart="ptzStart('H', -32)" 
                                ontouchend="ptzStop()">◀ Gauche</button>
                            <button class="ptz-btn ptz-home" onclick="sendCmd('HOME')">⌂ HOME</button>
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="ptzStart('H', 32)" 
                                onmouseup="ptzStop()" 
                                onmouseleave="ptzStop()"
                                ontouchstart="ptzStart('H', 32)" 
                                ontouchend="ptzStop()">Droite ▶</button>
                            
                            <div></div>
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="ptzStart('V', 32)" 
                                onmouseup="ptzStop()" 
                                onmouseleave="ptzStop()"
                                ontouchstart="ptzStart('V', 32)" 
                                ontouchend="ptzStop()">▼</button>
                            <div></div>
                        </div>
                        <div class="ptz-info">
                            <span id="ptz-status">Position: Inconnue</span>
                        </div>
                    </div>

                    <!-- TRAITEMENT IMAGE -->
                    <div class="pro-card">
                        <div class="section-title">🎨 Traitement d'image (Local)</div>
                        <div class="range-group">
                            <div class="range-labels">
                                <span>Luminosité</span>
                                <span id="val-brightness" class="value-display">100%</span>
                            </div>
                            <input type="range" id="ctrl-brightness" class="pro-slider" min="0" max="200" value="100" oninput="updateImageFilter()">
                        </div>
                        <div class="range-group">
                            <div class="range-labels">
                                <span>Saturation</span>
                                <span id="val-saturation" class="value-display">100%</span>
                            </div>
                            <input type="range" id="ctrl-saturation" class="pro-slider" min="0" max="200" value="100" oninput="updateImageFilter()">
                        </div>
                        <div class="range-group">
                            <div class="range-labels">
                                <span>Contraste</span>
                                <span id="val-contrast" class="value-display">100%</span>
                            </div>
                            <input type="range" id="ctrl-contrast" class="pro-slider" min="0" max="200" value="100" oninput="updateImageFilter()">
                        </div>
                        <div class="mode-group">
                            <button class="mode-btn active" onclick="setMode('normal', this)">Normal</button>
                            <button class="mode-btn" onclick="setMode('night', this)">Vision Nuit</button>
                            <button class="mode-btn" onclick="setMode('yuv', this)">Contraste YUV</button>
                            <button class="mode-btn" onclick="setMode('surveillance', this)">Surveillance</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="tab-terminal" class="tab-content">
            <div class="terminal-layout">
                <div class="terminal-zone">
                    <div class="panel-header">
                        <span class="panel-title">📟 Console Système</span>
                        <div class="header-actions">
                            <button onclick="copyLogs()" class="pro-btn btn-small">📋 Copier</button>
                            <button onclick="clearLogs()" class="pro-btn btn-small">🗑 Effacer</button>
                        </div>
                    </div>
                    <div id="console-output" class="console-box">
                        <div class="log-row sys">[SYS] Console PTZ initialisée.</div>
                        <div class="log-row sys">[SYS] Commandes disponibles: home, left, right, up, down, status, clear</div>
                    </div>
                    <div class="console-input-bar">
                        <span class="prompt">&gt;</span>
                        <input type="text" id="console-input" class="terminal-input" placeholder="Entrer une commande..." onkeydown="if(event.key==='Enter')executeCommand(this.value)">
                    </div>
                </div>

                <div class="commands-zone">
                    <div class="panel-header">
                        <span class="panel-title">📖 Commandes Rapides</span>
                    </div>
                    <div class="command-list">
                        <div class="cmd-item" onclick="executeCommand('home')">
                            <span class="cmd-syntax">home</span>
                            <span class="cmd-desc">Recalage + centrage automatique</span>
                        </div>
                        <div class="cmd-item" onclick="executeCommand('left')">
                            <span class="cmd-syntax">left</span>
                            <span class="cmd-desc">Pan gauche 32 pas</span>
                        </div>
                        <div class="cmd-item" onclick="executeCommand('right')">
                            <span class="cmd-syntax">right</span>
                            <span class="cmd-desc">Pan droite 32 pas</span>
                        </div>
                        <div class="cmd-item" onclick="executeCommand('up')">
                            <span class="cmd-syntax">up</span>
                            <span class="cmd-desc">Tilt haut 32 pas</span>
                        </div>
                        <div class="cmd-item" onclick="executeCommand('down')">
                            <span class="cmd-syntax">down</span>
                            <span class="cmd-desc">Tilt bas 32 pas</span>
                        </div>
                        <div class="cmd-item" onclick="executeCommand('status')">
                            <span class="cmd-syntax">status</span>
                            <span class="cmd-desc">État réseau et système</span>
                        </div>
                        <div class="cmd-item" onclick="executeCommand('clear')">
                            <span class="cmd-syntax">clear</span>
                            <span class="cmd-desc">Effacer la console</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    if (espIp) connectSystem();
});

// ==========================================
// SYSTÈME
// ==========================================
function toggleSystem() {
    isSystemOn = !isSystemOn;
    const glyph = document.getElementById('power-main');
    if (glyph) glyph.classList.toggle('active', isSystemOn);
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    if (tab === 'studio') {
        document.getElementById('nav-studio').classList.add('active');
        document.getElementById('tab-studio').classList.add('active');
    } else {
        document.getElementById('nav-terminal').classList.add('active');
        document.getElementById('tab-terminal').classList.add('active');
    }
}

// ==========================================
// CONNEXION
// ==========================================
function connectSystem() {
    const input = document.getElementById('esp-ip');
    espIp = input.value.trim();
    if (!espIp) { logConsole("Entrez une IP valide", "err"); return; }
    localStorage.setItem('ptz_ip', espIp);

    const img = document.getElementById('video-stream');
    img.src = `http://${espIp}/stream`;
    img.style.display = 'block';

    fetch(`http://${espIp}/status`, {mode: 'cors'})
        .then(r => r.json())
        .then(d => {
            logConsole(`Connecté à ${espIp} | RSSI: ${d.rssi}dBm | Uptime: ${d.uptime}s`, "success");
        })
        .catch(e => {
            logConsole("Connexion impossible - vérifiez l'IP", "err");
        });
}

// ==========================================
// PTZ CONTROLS
// ==========================================
var ptzInterval = null;

function ptzStart(axis, steps) {
    sendCmd(axis + ":" + steps);
    ptzInterval = setInterval(() => sendCmd(axis + ":" + steps), 400);
}

function ptzStop() {
    if (ptzInterval) {
        clearInterval(ptzInterval);
        ptzInterval = null;
    }
}

function sendCmd(cmd) {
    if (!espIp) return;
    fetch(`http://${espIp}/cmd`, {
        method: 'POST',
        mode: 'cors',
        headers: {'Content-Type': 'text/plain'},
        body: cmd
    })
    .then(r => { if (r.ok) logConsole("> " + cmd, "cmd"); })
    .catch(e => logConsole("Erreur: " + e, "err"));
}

// ==========================================
// IMAGE & FILTRES
// ==========================================
function rotateStream() {
    currentRotation = (currentRotation + 90) % 360;
    localStorage.setItem('ptz_rotation', currentRotation);
    const img = document.getElementById('video-stream');
    img.style.transform = `rotate(${currentRotation}deg)`;
}

function capturePhoto() {
    const img = document.getElementById('video-stream');
    if (!img.src || img.style.display === 'none') return;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 640;
    canvas.height = img.naturalHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const a = document.createElement('a');
    a.download = `S3PTZ_${Date.now()}.jpg`;
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.click();
    logConsole("Photo capturée", "success");
}

function toggleRecord() {
    const btn = document.getElementById('btn-record');
    if (!isRecording) {
        isRecording = true;
        btn.innerHTML = "⏹️ Arrêter";
        btn.classList.add('recording');
        logConsole("Enregistrement démarré", "sys");
    } else {
        isRecording = false;
        btn.innerHTML = "🔴 Enregistrer";
        btn.classList.remove('recording');
        logConsole("Enregistrement arrêté", "sys");
    }
}

function updateImageFilter() {
    const b = document.getElementById('ctrl-brightness').value;
    const s = document.getElementById('ctrl-saturation').value;
    const c = document.getElementById('ctrl-contrast').value;
    document.getElementById('val-brightness').textContent = b + '%';
    document.getElementById('val-saturation').textContent = s + '%';
    document.getElementById('val-contrast').textContent = c + '%';
    
    const img = document.getElementById('video-stream');
    img.style.filter = `brightness(${b}%) saturate(${s}%) contrast(${c}%)`;
}

function setMode(mode, btn) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const img = document.getElementById('video-stream');
    let baseFilter = img.style.filter || '';
    baseFilter = baseFilter.replace(/(invert|grayscale|sepia|hue-rotate)\([^)]+\)\s*/g, '');
    
    if (mode === 'night') img.style.filter = baseFilter + ' invert(1) hue-rotate(180deg)';
    else if (mode === 'yuv') img.style.filter = baseFilter + ' grayscale(100%) contrast(150%)';
    else if (mode === 'surveillance') img.style.filter = baseFilter + ' grayscale(100%) contrast(200%)';
    else img.style.filter = baseFilter;
}

// ==========================================
// CONSOLE
// ==========================================
function logConsole(msg, type) {
    const out = document.getElementById('console-output');
    if (!out) return;
    logCount++;
    const row = document.createElement('div');
    row.className = 'log-row ' + (type || '');
    const time = new Date().toLocaleTimeString('fr-FR', {hour12:false});
    row.textContent = `[${time}] ${msg}`;
    out.appendChild(row);
    out.scrollTop = out.scrollHeight;
}

function clearLogs() {
    const out = document.getElementById('console-output');
    if (out) {
        out.innerHTML = '';
        logCount = 0;
    }
    logConsole("Console effacée", "sys");
}

function copyLogs() {
    const out = document.getElementById('console-output');
    if (!out) return;
    const text = Array.from(out.querySelectorAll('.log-row')).map(r => r.textContent).join('\n');
    navigator.clipboard.writeText(text).then(() => {
        logConsole("Logs copiés", "success");
    });
}

function executeCommand(val) {
    const input = document.getElementById('console-input');
    const cmd = val.trim().toLowerCase();
    input.value = '';
    if (!cmd) return;

    switch(cmd) {
        case 'clear': clearLogs(); return;
        case 'home': sendCmd('HOME'); logConsole("Recalage + centrage...", "cmd"); return;
        case 'left': sendCmd('H:-32'); logConsole("Pan gauche", "cmd"); return;
        case 'right': sendCmd('H:32'); logConsole("Pan droite", "cmd"); return;
        case 'up': sendCmd('V:-32'); logConsole("Tilt haut", "cmd"); return;
        case 'down': sendCmd('V:32'); logConsole("Tilt bas", "cmd"); return;
        case 'status':
            fetch(`http://${espIp}/status`).then(r=>r.json()).then(d=>{
                logConsole(`IP: ${d.ip} | RSSI: ${d.rssi}dBm | Uptime: ${d.uptime}s`, "sys");
            });
            return;
        case 'vision-noire':
        case 'high-contrast':
        case 'normal':
            logConsole("Filtre: " + cmd, "cmd");
            return;
        default:
            logConsole("Commande inconnue: " + cmd, "err");
    }
}
