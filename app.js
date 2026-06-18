// ==========================================
// S3-PRO PTZ — APP.JS
// Miroirs écran (pas image), zoom/pan, tout sauvegardé
// ==========================================

// Charger état sauvegardé
var saved = JSON.parse(localStorage.getItem('ptz_state') || '{}');

var espIp = window.location.hostname;
if (!espIp || espIp === "localhost" || espIp.includes("github.io")) {
    espIp = saved.espIp || '';
}

var isConnected = false;
var isRecording = false;
var ptzInterval = null;
var mediaRecorder = null;

// État complet avec valeurs par défaut
var state = {
    brightness: saved.brightness !== undefined ? saved.brightness : 100,
    saturation: saved.saturation !== undefined ? saved.saturation : 100,
    contrast: saved.contrast !== undefined ? saved.contrast : 100,
    rotation: saved.rotation !== undefined ? saved.rotation : 0,      // Rotation image
    screenRotation: saved.screenRotation !== undefined ? saved.screenRotation : 0,  // Rotation écran
    zoom: saved.zoom !== undefined ? saved.zoom : 100,
    panX: saved.panX !== undefined ? saved.panX : 0,
    panY: saved.panY !== undefined ? saved.panY : 0,
    mirrorH: saved.mirrorH || false,    // Miroir écran H
    mirrorV: saved.mirrorV || false,    // Miroir écran V
    mode: saved.mode || 'normal'
};

function saveState() {
    state.espIp = espIp;
    localStorage.setItem('ptz_state', JSON.stringify(state));
}

window.addEventListener('DOMContentLoaded', function() {
    const root = document.getElementById('app-root');
    if (!root) return;

    root.innerHTML = `
    <div class="app-container">
        <header class="pro-header">
            <div class="brand-zone">
                <h1 class="pro-logo">S3-PRO <span style="color:#6366f1">PTZ</span></h1>
                <div class="sub-brand">PAN/TILT DUAL-AXIS</div>
            </div>
            <div class="connection-zone">
                <input type="text" id="esp-ip" class="pro-input" placeholder="IP ESP32" value="${espIp}">
                <button onclick="connectSystem()" class="pro-btn btn-primary">Connecter</button>
                <span id="conn-status" class="status-dot offline">●</span>
            </div>
        </header>

        <div class="tabs-nav">
            <button id="nav-studio" class="tab-btn active" onclick="switchTab('studio')">🎬 Studio</button>
            <button id="nav-terminal" class="tab-btn" onclick="switchTab('terminal')">📟 Terminal</button>
        </div>

        <div id="tab-studio" class="tab-content active">
            <div class="studio-grid">
                <div class="video-zone">
                    <div class="video-viewport" id="video-viewport">
                        <img id="video-stream" src="" alt="En attente..." style="display:none">
                        <div id="stream-placeholder" class="stream-placeholder">Entrez l'IP et cliquez Connecter</div>
                    </div>
                    <div class="action-bar">
                        <button onclick="rotateImage()" class="pro-btn">↻ Rotation image</button>
                        <button onclick="rotateScreen()" class="pro-btn">↺ Rotation écran</button>
                        <button onclick="capturePhoto()" class="pro-btn">📸 Capture</button>
                        <button id="btn-record" onclick="toggleRecord()" class="pro-btn btn-danger">🔴 Film</button>
                    </div>
                </div>

                <div class="side-panel">
                    <!-- PTZ -->
                    <div class="pro-card">
                        <div class="section-title">🎮 Pan / Tilt</div>
                        <div class="ptz-grid">
                            <div></div>
                            <button class="ptz-btn ptz-arrow" onmousedown="ptzStart('V',-32)" onmouseup="ptzStop()" onmouseleave="ptzStop()" ontouchstart="ptzStart('V',-32)" ontouchend="ptzStop()">▲</button>
                            <div></div>
                            <button class="ptz-btn ptz-arrow" onmousedown="ptzStart('H',-32)" onmouseup="ptzStop()" onmouseleave="ptzStop()" ontouchstart="ptzStart('H',-32)" ontouchend="ptzStop()">◀ G</button>
                            <button class="ptz-btn ptz-home" onclick="sendCmd('HOME')">⌂ HOME</button>
                            <button class="ptz-btn ptz-arrow" onmousedown="ptzStart('H',32)" onmouseup="ptzStop()" onmouseleave="ptzStop()" ontouchstart="ptzStart('H',32)" ontouchend="ptzStop()">D ▶</button>
                            <div></div>
                            <button class="ptz-btn ptz-arrow" onmousedown="ptzStart('V',32)" onmouseup="ptzStop()" onmouseleave="ptzStop()" ontouchstart="ptzStart('V',32)" ontouchend="ptzStop()">▼</button>
                            <div></div>
                        </div>
                    </div>

                    <!-- ZOOM / PAN -->
                    <div class="pro-card">
                        <div class="section-title">🔍 Zoom & Position</div>
                        <div class="range-group">
                            <div class="range-labels"><span>Zoom</span><span id="val-zoom" class="value-display">100%</span></div>
                            <input type="range" id="ctrl-zoom" class="pro-slider" min="50" max="300" value="${state.zoom}" oninput="updateZoom(this.value)">
                        </div>
                        <div class="range-group">
                            <div class="range-labels"><span>Pan X</span><span id="val-panX" class="value-display">0%</span></div>
                            <input type="range" id="ctrl-panX" class="pro-slider" min="-50" max="50" value="${state.panX}" oninput="updatePan('x', this.value)">
                        </div>
                        <div class="range-group">
                            <div class="range-labels"><span>Pan Y</span><span id="val-panY" class="value-display">0%</span></div>
                            <input type="range" id="ctrl-panY" class="pro-slider" min="-50" max="50" value="${state.panY}" oninput="updatePan('y', this.value)">
                        </div>
                    </div>

                    <!-- MIROIRS ÉCRAN -->
                    <div class="pro-card">
                        <div class="section-title">🔃 Miroirs écran</div>
                        <div class="toggle-row">
                            <span class="label-text">Miroir Horizontal</span>
                            <label class="pro-switch">
                                <input type="checkbox" id="mirror-h" ${state.mirrorH ? 'checked' : ''} onchange="toggleMirror('h', this.checked)">
                                <span class="switch-slider"></span>
                            </label>
                        </div>
                        <div class="toggle-row">
                            <span class="label-text">Miroir Vertical</span>
                            <label class="pro-switch">
                                <input type="checkbox" id="mirror-v" ${state.mirrorV ? 'checked' : ''} onchange="toggleMirror('v', this.checked)">
                                <span class="switch-slider"></span>
                            </label>
                        </div>
                    </div>

                    <!-- FILTRES -->
                    <div class="pro-card">
                        <div class="section-title">🎨 Filtres</div>
                        <div class="range-group">
                            <div class="range-labels"><span>Luminosité</span><span id="val-brightness" class="value-display">${state.brightness}%</span></div>
                            <input type="range" id="ctrl-brightness" class="pro-slider" min="0" max="200" value="${state.brightness}" oninput="updateFilter('brightness', this.value)">
                        </div>
                        <div class="range-group">
                            <div class="range-labels"><span>Saturation</span><span id="val-saturation" class="value-display">${state.saturation}%</span></div>
                            <input type="range" id="ctrl-saturation" class="pro-slider" min="0" max="200" value="${state.saturation}" oninput="updateFilter('saturation', this.value)">
                        </div>
                        <div class="range-group">
                            <div class="range-labels"><span>Contraste</span><span id="val-contrast" class="value-display">${state.contrast}%</span></div>
                            <input type="range" id="ctrl-contrast" class="pro-slider" min="0" max="200" value="${state.contrast}" oninput="updateFilter('contrast', this.value)">
                        </div>
                        <div class="mode-group">
                            <button id="mode-normal" class="mode-btn ${state.mode=='normal'?'active':''}" onclick="setMode('normal')">Normal</button>
                            <button id="mode-night" class="mode-btn ${state.mode=='night'?'active':''}" onclick="setMode('night')">Nuit</button>
                            <button id="mode-yuv" class="mode-btn ${state.mode=='yuv'?'active':''}" onclick="setMode('yuv')">YUV</button>
                            <button id="mode-surveillance" class="mode-btn ${state.mode=='surveillance'?'active':''}" onclick="setMode('surveillance')">Surv.</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="tab-terminal" class="tab-content">
            <div class="terminal-layout">
                <div class="terminal-zone">
                    <div class="panel-header">
                        <span class="panel-title">📟 Console</span>
                        <div class="header-actions">
                            <button onclick="copyLogs()" class="pro-btn btn-small">📋 Copier</button>
                            <button onclick="clearLogs()" class="pro-btn btn-small">🗑 Effacer</button>
                        </div>
                    </div>
                    <div id="console-output" class="console-box">
                        <div class="log-row sys">[SYS] Console initialisée</div>
                    </div>
                    <div class="console-input-bar">
                        <span class="prompt">&gt;</span>
                        <input type="text" id="console-input" placeholder="Commande..." onkeydown="if(event.key==='Enter')executeCommand(this.value)">
                    </div>
                </div>
                <div class="commands-zone">
                    <div class="panel-header"><span class="panel-title">📖 Commandes</span></div>
                    <div class="command-list">
                        <div class="cmd-item" onclick="executeCommand('home')"><span class="cmd-syntax">home</span><span class="cmd-desc">Recalage complet</span></div>
                        <div class="cmd-item" onclick="executeCommand('left')"><span class="cmd-syntax">left</span><span class="cmd-desc">Pan gauche</span></div>
                        <div class="cmd-item" onclick="executeCommand('right')"><span class="cmd-syntax">right</span><span class="cmd-desc">Pan droite</span></div>
                        <div class="cmd-item" onclick="executeCommand('up')"><span class="cmd-syntax">up</span><span class="cmd-desc">Tilt haut</span></div>
                        <div class="cmd-item" onclick="executeCommand('down')"><span class="cmd-syntax">down</span><span class="cmd-desc">Tilt bas</span></div>
                        <div class="cmd-item" onclick="executeCommand('test')"><span class="cmd-syntax">test</span><span class="cmd-desc">Test moteurs brut</span></div>
                        <div class="cmd-item" onclick="executeCommand('status')"><span class="cmd-syntax">status</span><span class="cmd-desc">État système</span></div>
                        <div class="cmd-item" onclick="executeCommand('clear')"><span class="cmd-syntax">clear</span><span class="cmd-desc">Effacer</span></div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    applyAllTransforms();
    if (espIp) connectSystem();
});

// ==========================================
// CONNEXION
// ==========================================
function connectSystem() {
    const input = document.getElementById('esp-ip');
    espIp = input.value.trim();
    if (!espIp) { logConsole("Entrez IP", "err"); return; }
    saveState();

    const img = document.getElementById('video-stream');
    const placeholder = document.getElementById('stream-placeholder');
    img.src = `http://${espIp}/stream?t=${Date.now()}`;
    img.style.display = 'block';
    placeholder.style.display = 'none';

    fetch(`http://${espIp}/status`, {mode: 'cors'})
        .then(r => r.json())
        .then(d => {
            isConnected = true;
            document.getElementById('conn-status').className = 'status-dot online';
            logConsole(`Connecté: ${espIp} RSSI:${d.rssi}dBm`, "success");
        })
        .catch(e => {
            document.getElementById('conn-status').className = 'status-dot offline';
            logConsole("Connexion impossible", "err");
        });
}

// ==========================================
// PTZ
// ==========================================
function ptzStart(axis, steps) {
    if (!isConnected) { logConsole("Non connecté", "err"); return; }
    sendCmd(axis + ":" + steps);
    ptzInterval = setInterval(() => sendCmd(axis + ":" + steps), 400);
}

function ptzStop() {
    if (ptzInterval) { clearInterval(ptzInterval); ptzInterval = null; }
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
// ZOOM / PAN
// ==========================================
function updateZoom(value) {
    state.zoom = parseInt(value);
    document.getElementById('val-zoom').textContent = value + '%';
    saveState();
    applyAllTransforms();
}

function updatePan(axis, value) {
    state['pan' + axis.toUpperCase()] = parseInt(value);
    document.getElementById('val-pan' + axis.toUpperCase()).textContent = value + '%';
    saveState();
    applyAllTransforms();
}

// ==========================================
// ROTATIONS
// ==========================================
function rotateImage() {
    state.rotation = (state.rotation + 90) % 360;
    saveState();
    applyAllTransforms();
}

function rotateScreen() {
    state.screenRotation = (state.screenRotation + 90) % 360;
    saveState();
    applyAllTransforms();
}

// ==========================================
// MIROIRS ÉCRAN — Indépendants de la rotation image
// ==========================================
function toggleMirror(axis, checked) {
    if (axis === 'h') state.mirrorH = checked;
    else state.mirrorV = checked;
    saveState();
    applyAllTransforms();
}

// ==========================================
// APPLICATION TRANSFORMATIONS
// Ordre: zoom → pan → rotation écran → miroirs écran
// ==========================================
function applyAllTransforms() {
    const img = document.getElementById('video-stream');
    if (!img) return;

    // 1. Zoom et pan (sur l'image)
    const scale = state.zoom / 100;
    const panX = state.panX;
    const panY = state.panY;
    
    // 2. Rotation écran (appliquée au conteneur)
    const viewport = document.getElementById('video-viewport');
    if (viewport) {
        viewport.style.transform = `rotate(${state.screenRotation}deg)`;
    }
    
    // 3. Transform image: zoom + pan + rotation image
    let transform = `scale(${scale}) translate(${panX}%, ${panY}%) rotate(${state.rotation}deg)`;
    
    // 4. Miroirs écran — appliqués APRÈS tout le reste
    // Ce sont des flip CSS sur l'élément, indépendants de la rotation
    if (state.mirrorH) transform += ' scaleX(-1)';
    if (state.mirrorV) transform += ' scaleY(-1)';
    
    img.style.transform = transform;
}

// ==========================================
// FILTRES
// ==========================================
function updateFilter(type, value) {
    state[type] = parseInt(value);
    document.getElementById('val-' + type).textContent = value + '%';
    saveState();
    applyFilters();
}

function applyFilters() {
    const img = document.getElementById('video-stream');
    if (!img) return;
    let filter = `brightness(${state.brightness}%) saturate(${state.saturation}%) contrast(${state.contrast}%)`;
    switch(state.mode) {
        case 'night': filter += ' invert(1) hue-rotate(180deg) brightness(1.5)'; break;
        case 'yuv': filter += ' grayscale(100%) contrast(180%) brightness(1.2)'; break;
        case 'surveillance': filter += ' grayscale(100%) contrast(250%) brightness(0.9)'; break;
    }
    img.style.filter = filter;
}

function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('mode-' + mode).classList.add('active');
    
    switch(mode) {
        case 'night': setSlider('brightness', 150); setSlider('saturation', 80); setSlider('contrast', 120); break;
        case 'yuv': setSlider('brightness', 120); setSlider('saturation', 0); setSlider('contrast', 180); break;
        case 'surveillance': setSlider('brightness', 90); setSlider('saturation', 0); setSlider('contrast', 250); break;
        default: setSlider('brightness', 100); setSlider('saturation', 100); setSlider('contrast', 100); break;
    }
    applyFilters();
    saveState();
}

function setSlider(type, value) {
    state[type] = value;
    const slider = document
