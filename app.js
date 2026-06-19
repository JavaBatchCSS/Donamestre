// ==========================================
// S3-PRO PTZ — APP.JS v3.0
// Pas adaptatif | Filtres pro | Capture HD native | Logs UART dans console
// ==========================================

var espIp = window.location.hostname;
if (!espIp || espIp === "localhost" || espIp.includes("github.io") || espIp === "") {
    espIp = localStorage.getItem('ptz_ip') || '';
}

var isConnected = false;
var isRecording = false;
var ptzInterval = null;
var ptzHoldTimer = null;
var isHolding = false;
var mediaRecorder = null;
var recordCanvas = null;
var recordCtx = null;
var uartLogs = []; // Buffer logs UART

var filterState = {
    brightness: 100,
    saturation: 100,
    contrast: 100,
    rotation: 0,
    mirrorH: false,
    mirrorV: false,
    mode: 'normal'
};

window.addEventListener('DOMContentLoaded', function() {
    const root = document.getElementById('app-root');
    if (!root) return;

    root.innerHTML = `
    <div class="app-container">
        <header class="pro-header">
            <div class="brand-zone">
                <h1 class="pro-logo">S3-PRO <span style="color:#6366f1">PTZ</span></h1>
                <div class="sub-brand">PAN/TILT DUAL-AXIS MONITORING</div>
            </div>
            <div class="connection-zone">
                <input type="text" id="esp-ip" class="pro-input" placeholder="IP ESP32" value="${espIp}">
                <button onclick="connectSystem()" class="pro-btn btn-primary">Connecter</button>
                <span id="conn-status" class="status-dot offline">●</span>
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
                        <img id="video-stream" src="" alt="En attente..." style="display:none">
                        <div id="stream-placeholder" class="stream-placeholder">Entrez l'IP et cliquez Connecter</div>
                    </div>
                    <div class="action-bar">
                        <button onclick="rotateStream()" class="pro-btn">↻ Rotation</button>
                        <button onclick="captureHD()" class="pro-btn btn-primary">📸 Capture HD Native</button>
                        <button id="btn-record" onclick="toggleRecord()" class="pro-btn btn-danger">🔴 Enregistrer</button>
                        <button onclick="sendCmd('HOME')" class="pro-btn">🏠 HOME</button>
                    </div>
                </div>

                <div class="side-panel">
                    <!-- PTZ -->
                    <div class="pro-card">
                        <div class="section-title">🎮 Contrôle Pan / Tilt</div>
                        <div class="ptz-grid">
                            <div></div>
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="ptzPress('V', 32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('V', 32)" ontouchend="ptzRelease()">▲ Haut</button>
                            <div></div>
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="ptzPress('H', 32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('H', 32)" ontouchend="ptzRelease()">◀ Gauche</button>
                            <button class="ptz-btn ptz-home" onclick="sendCmd('CENTER')">⌂ CENTRE</button>
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="ptzPress('H', -32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('H', -32)" ontouchend="ptzRelease()">Droite ▶</button>
                            <div></div>
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="ptzPress('V', -32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('V', -32)" ontouchend="ptzRelease()">▼ Bas</button>
                            <div></div>
                        </div>
                        <div class="ptz-hint">Clic rapide = pas large | Maintenir = pas fin & continu</div>
                    </div>

                    <!-- RÉSOLUTION STREAM -->
                    <div class="pro-card">
                        <div class="section-title">📐 Résolution Stream</div>
                        <select id="res-select" class="pro-input res-select" onchange="setResolution(this.value)">
                            <option value="QVGA">QVGA (320×240) — Ultra rapide</option>
                            <option value="VGA">VGA (640×480) — Rapide</option>
                            <option value="SVGA">SVGA (800×600) — Standard</option>
                            <option value="XGA">XGA (1024×768) — Qualité</option>
                            <option value="HD">HD (1280×720) — Haute qualité</option>
                            <option value="FHD">FHD (1600×1200) — Max</option>
                        </select>
                    </div>

                    <!-- QUALITÉ JPEG -->
                    <div class="pro-card">
                        <div class="section-title">🎯 Qualité JPEG Stream</div>
                        <div class="range-group">
                            <div class="range-labels">
                                <span>Qualité (4=meilleur, 63=pire)</span>
                                <span id="val-quality" class="value-display">12</span>
                            </div>
                            <input type="range" id="ctrl-quality" class="pro-slider" min="4" max="40" value="12" 
                                oninput="updateQuality(this.value)" onchange="setQuality(this.value)">
                        </div>
                    </div>

                    <!-- MIROIRS -->
                    <div class="pro-card">
                        <div class="section-title">🔃 Miroirs</div>
                        <div class="toggle-row">
                            <span class="label-text">Miroir Horizontal</span>
                            <label class="pro-switch">
                                <input type="checkbox" id="mirror-h" onchange="toggleMirror('h', this.checked)">
                                <span class="switch-slider"></span>
                            </label>
                        </div>
                        <div class="toggle-row">
                            <span class="label-text">Miroir Vertical</span>
                            <label class="pro-switch">
                                <input type="checkbox" id="mirror-v" onchange="toggleMirror('v', this.checked)">
                                <span class="switch-slider"></span>
                            </label>
                        </div>
                    </div>

                    <!-- IMAGE -->
                    <div class="pro-card">
                        <div class="section-title">🎨 Traitement d'image</div>
                        <div class="range-group">
                            <div class="range-labels">
                                <span>Luminosité</span>
                                <span id="val-brightness" class="value-display">100%</span>
                            </div>
                            <input type="range" id="ctrl-brightness" class="pro-slider" min="0" max="300" value="100" oninput="updateFilter('brightness', this.value)">
                        </div>
                        <div class="range-group">
                            <div class="range-labels">
                                <span>Saturation</span>
                                <span id="val-saturation" class="value-display">100%</span>
                            </div>
                            <input type="range" id="ctrl-saturation" class="pro-slider" min="0" max="300" value="100" oninput="updateFilter('saturation', this.value)">
                        </div>
                        <div class="range-group">
                            <div class="range-labels">
                                <span>Contraste</span>
                                <span id="val-contrast" class="value-display">100%</span>
                            </div>
                            <input type="range" id="ctrl-contrast" class="pro-slider" min="0" max="300" value="100" oninput="updateFilter('contrast', this.value)">
                        </div>
                        <div class="mode-group">
                            <button id="mode-normal" class="mode-btn active" onclick="setMode('normal')">Normal</button>
                            <button id="mode-night" class="mode-btn" onclick="setMode('night')">🌙 Vision Nocturne</button>
                            <button id="mode-thermal" class="mode-btn" onclick="setMode('thermal')">🔥 Thermique</button>
                            <button id="mode-surveillance" class="mode-btn" onclick="setMode('surveillance')">👁 Surveillance</button>
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
                            <button onclick="fetchUartLogs()" class="pro-btn btn-small">🔄 Sync UART</button>
                        </div>
                    </div>
                    <div id="console-output" class="console-box">
                        <div class="log-row sys">[SYS] Console PTZ v3.0 initialisée</div>
                        <div class="log-row sys">[SYS] Les logs UART apparaissent ici automatiquement</div>
                    </div>
                    <div class="console-input-bar">
                        <span class="prompt">&gt;</span>
                        <input type="text" id="console-input" placeholder="Commande..." onkeydown="if(event.key==='Enter')executeCommand(this.value)">
                    </div>
                </div>
                <div class="commands-zone">
                    <div class="panel-header">
                        <span class="panel-title">📖 Commandes Rapides</span>
                    </div>
                    <div class="command-list">
                        <div class="cmd-item" onclick="executeCommand('home')"><span class="cmd-syntax">home</span><span class="cmd-desc">Recalage complet</span></div>
                        <div class="cmd-item" onclick="executeCommand('center')"><span class="cmd-syntax">center</span><span class="cmd-desc">Position 3/4 (vue)</span></div>
                        <div class="cmd-item" onclick="executeCommand('left')"><span class="cmd-syntax">left</span><span class="cmd-desc">Pan gauche</span></div>
                        <div class="cmd-item" onclick="executeCommand('right')"><span class="cmd-syntax">right</span><span class="cmd-desc">Pan droite</span></div>
                        <div class="cmd-item" onclick="executeCommand('up')"><span class="cmd-syntax">up</span><span class="cmd-desc">Tilt haut</span></div>
                        <div class="cmd-item" onclick="executeCommand('down')"><span class="cmd-syntax">down</span><span class="cmd-desc">Tilt bas</span></div>
                        <div class="cmd-item" onclick="executeCommand('status')"><span class="cmd-syntax">status</span><span class="cmd-desc">État complet</span></div>
                        <div class="cmd-item" onclick="executeCommand('clear')"><span class="cmd-syntax">clear</span><span class="cmd-desc">Effacer console</span></div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    filterState.mirrorH = localStorage.getItem('ptz_mirror_h') === 'true';
    filterState.mirrorV = localStorage.getItem('ptz_mirror_v') === 'true';
    document.getElementById('mirror-h').checked = filterState.mirrorH;
    document.getElementById('mirror-v').checked = filterState.mirrorV;
    if (espIp) connectSystem();
});

// ==========================================
// CONNEXION & LOGS UART
// ==========================================
function connectSystem() {
    const input = document.getElementById('esp-ip');
    espIp = input.value.trim();
    if (!espIp) { logConsole("Entrez une IP", "err"); return; }
    localStorage.setItem('ptz_ip', espIp);

    const img = document.getElementById('video-stream');
    const placeholder = document.getElementById('stream-placeholder');
    img.src = `http://${espIp}/stream?t=${Date.now()}`;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    
    img.onerror = function() {
        updateStatus(false);
        logConsole("Stream erreur - reconnexion...", "err");
        setTimeout(connectSystem, 3000);
    };
    img.onload = function() {
        updateStatus(true);
        logConsole("Stream actif", "success");
    };

    fetch(`http://${espIp}/status`, {mode: 'cors', cache: 'no-cache'})
        .then(r => r.json())
        .then(d => {
            isConnected = true;
            updateStatus(true);
            logConsole(`Connecté: ${espIp} | RSSI:${d.rssi}dBm`, "success");
        })
        .catch(e => {
            updateStatus(false);
            logConsole("Connexion API: " + e.message, "err");
        });
}

function updateStatus(ok) {
    document.getElementById('conn-status').className = ok ? 'status-dot online' : 'status-dot offline';
}

// ==========================================
// PTZ ADAPTATIF: clic = gros pas, maintien = petits pas rapides
// ==========================================
function ptzPress(axis, steps) {
    if (!isConnected) { logConsole("Non connecté", "err"); return; }
    isHolding = false;
    
    // Premier pas: gros (32)
    sendCmd(axis + ":" + steps);
    
    // Après 300ms, si on maintient, on passe en mode fin
    ptzHoldTimer = setTimeout(() => {
        isHolding = true;
        // Pas fin de 8, toutes les 150ms
        ptzInterval = setInterval(() => {
            let fineSteps = steps > 0 ? 8 : -8;
            sendCmd(axis + ":" + fineSteps);
        }, 150);
    }, 300);
}

function ptzRelease() {
    clearTimeout(ptzHoldTimer);
    clearInterval(ptzInterval);
    isHolding = false;
}

function sendCmd(cmd) {
    if (!espIp) return;
    fetch(`http://${espIp}/cmd`, {
        method: 'POST',
        mode: 'cors',
        headers: {'Content-Type': 'text/plain'},
        body: cmd,
        cache: 'no-cache'
    })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); logConsole("> " + cmd, "cmd"); })
    .catch(e => {
        logConsole("Erreur cmd: " + e.message, "err");
        isConnected = false; updateStatus(false);
    });
}

// ==========================================
// RÉSOLUTION & QUALITÉ
// ==========================================
function setResolution(res) {
    if (!espIp) { logConsole("IP non définie", "err"); return; }
    fetch(`http://${espIp}/setres`, {
        method: 'POST', mode: 'cors',
        headers: {'Content-Type': 'text/plain'},
        body: res, cache: 'no-cache'
    })
    .then(r => r.text())
    .then(t => logConsole("Résolution: " + res + " | " + t, "success"))
    .catch(e => logConsole("Erreur résolution: " + e.message, "err"));
}

function updateQuality(val) {
    document.getElementById('val-quality').textContent = val;
}

function setQuality(val) {
    if (!espIp) return;
    fetch(`http://${espIp}/setquality`, {
        method: 'POST', mode: 'cors',
        headers: {'Content-Type': 'text/plain'},
        body: val, cache: 'no-cache'
    })
    .then(r => r.text())
    .then(t => logConsole("Qualité JPEG: " + val, "success"))
    .catch(e => logConsole("Erreur qualité: " + e.message, "err"));
}

// ==========================================
// CAPTURE HD NATIVE (pas de rognage)
// ==========================================
function captureHD() {
    if (!espIp) { logConsole("IP non définie", "err"); return; }
    logConsole("Capture HD native en cours...", "sys");
    
    fetch(`http://${espIp}/capturehd`, {
        method: 'GET', mode: 'cors', cache: 'no-cache'
    })
    .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
    })
    .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `S3PTZ_HD_${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
        logConsole("Photo HD native sauvegardée!", "success");
    })
    .catch(e => logConsole("Erreur capture HD: " + e.message, "err"));
}

// ==========================================
// MIROIRS & FILTRES PRO
// ==========================================
function toggleMirror(axis, checked) {
    if (axis === 'h') filterState.mirrorH = checked;
    else filterState.mirrorV = checked;
    localStorage.setItem('ptz_mirror_' + axis, checked);
    applyTransform();
}

function applyTransform() {
    const img = document.getElementById('video-stream');
    if (!img) return;
    let transform = `rotate(${filterState.rotation}deg)`;
    if (filterState.mirrorH) transform += ' scaleX(-1)';
    if (filterState.mirrorV) transform += ' scaleY(-1)';
    img.style.transform = transform;
}

function updateFilter(type, value) {
    filterState[type] = parseInt(value);
    document.getElementById('val-' + type).textContent = value + '%';
    applyFilters();
}

function applyFilters() {
    const img = document.getElementById('video-stream');
    if (!img) return;
    let filter = `brightness(${filterState.brightness}%) saturate(${filterState.saturation}%) contrast(${filterState.contrast}%)`;
    switch(filterState.mode) {
        case 'night': 
            filter += ' grayscale(100%) brightness(180%) contrast(150%)'; 
            break;
        case 'thermal': 
            filter += ' grayscale(100%) sepia(100%) hue-rotate(-50deg) saturate(300%) contrast(180%) brightness(120%)'; 
            break;
        case 'surveillance': 
            filter += ' grayscale(100%) contrast(300%) brightness(80%)'; 
            break;
    }
    img.style.filter = filter;
}

function setMode(mode) {
    filterState.mode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('mode-' + mode).classList.add('active');
    switch(mode) {
        case 'night': 
            setSlider('brightness', 180); setSlider('saturation', 0); setSlider('contrast', 150); 
            break;
        case 'thermal': 
            setSlider('brightness', 120); setSlider('saturation', 300); setSlider('contrast', 180); 
            break;
        case 'surveillance': 
            setSlider('brightness', 80); setSlider('saturation', 0); setSlider('contrast', 300); 
            break;
        default: 
            setSlider('brightness', 100); setSlider('saturation', 100); setSlider('contrast', 100); 
            break;
    }
    applyFilters();
}

function setSlider(type, value) {
    filterState[type] = value;
    const slider = document.getElementById('ctrl-' + type);
    const display = document.getElementById('val-' + type);
    if (slider) slider.value = value;
    if (display) display.textContent = value + '%';
}

function rotateStream() {
    filterState.rotation = (filterState.rotation + 90) % 360;
    applyTransform();
}

// ==========================================
// ENREGISTREMENT VIDÉO
// ==========================================
function toggleRecord() {
    const btn = document.getElementById('btn-record');
    if (!isRecording) { startRecording(); btn.innerHTML = "⏹️ Arrêter"; btn.classList.add('recording'); }
    else { stopRecording(); btn.innerHTML = "🔴 Enregistrer"; btn.classList.remove('recording'); }
}

function startRecording() {
    const img = document.getElementById('video-stream');
    if (!img.src || img.style.display === 'none') { logConsole("Flux non actif", "err"); return; }
    recordCanvas = document.createElement('canvas');
    recordCanvas.width = img.naturalWidth || 640;
    recordCanvas.height = img.naturalHeight || 480;
    recordCtx = recordCanvas.getContext('2d');
    const stream = recordCanvas.captureStream(30);
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `S3PTZ_RECORD_${Date.now()}.webm`;
        a.click();
        logConsole("Vidéo sauvegardée", "success");
    };
    mediaRecorder.start(100);
    isRecording = true;
    logConsole("Enregistrement démarré", "sys");
    renderFrame();
}

function renderFrame() {
    if (!isRecording || !recordCtx) return;
    const img = document.getElementById('video-stream');
    if (!img.complete) { requestAnimationFrame(renderFrame); return; }
    recordCtx.filter = img.style.filter || 'none';
    recordCtx.save();
    recordCtx.translate(recordCanvas.width/2, recordCanvas.height/2);
    recordCtx.rotate(filterState.rotation * Math.PI / 180);
    if (filterState.mirrorH) recordCtx.scale(-1, 1);
    if (filterState.mirrorV) recordCtx.scale(1, -1);
    recordCtx.drawImage(img, -recordCanvas.width/2, -recordCanvas.height/2);
    recordCtx.restore();
    requestAnimationFrame(renderFrame);
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    isRecording = false; recordCanvas = null; recordCtx = null;
    logConsole("Enregistrement arrêté", "sys");
}

// ==========================================
// CONSOLE & LOGS UART
// ==========================================
function logConsole(msg, type) {
    const out = document.getElementById('console-output');
    if (!out) return;
    const row = document.createElement('div');
    row.className = 'log-row ' + (type || '');
    const time = new Date().toLocaleTimeString('fr-FR', {hour12:false});
    const line = `[${time}] ${msg}`;
    row.textContent = line;
    out.appendChild(row);
    out.scrollTop = out.scrollHeight;
    
    // Mirror dans console navigateur
    console.log(`[PTZ-${type||'info'}] ${msg}`);
}

function clearLogs() {
    const out = document.getElementById('console-output');
    if (out) out.innerHTML = '<div class="log-row sys">[SYS] Console effacée</div>';
}

function copyLogs() {
    const out = document.getElementById('console-output');
    if (!out) return;
    const text = Array.from(out.querySelectorAll('.log-row')).map(r => r.textContent).join('\n');
    navigator.clipboard.writeText(text).then(() => logConsole("Logs copiés", "success"));
}

// Récupère les logs UART depuis le maître (si on implémente un endpoint /logs)
function fetchUartLogs() {
    logConsole("Sync UART demandée (via status)", "sys");
    executeCommand('status');
}

function executeCommand(val) {
    const input = document.getElementById('console-input');
    const cmd = val.trim().toLowerCase();
    input.value = '';
    if (!cmd) return;

    switch(cmd) {
        case 'clear': clearLogs(); return;
        case 'home': sendCmd('HOME'); logConsole("HOME envoyé", "cmd"); return;
        case 'center': sendCmd('CENTER'); logConsole("CENTER envoyé (position 3/4)", "cmd"); return;
        case 'left': sendCmd('H:64'); logConsole("Pan gauche rapide", "cmd"); return;
        case 'right': sendCmd('H:-64'); logConsole("Pan droite rapide", "cmd"); return;
        case 'up': sendCmd('V:64'); logConsole("Tilt haut rapide", "cmd"); return;
        case 'down': sendCmd('V:-64'); logConsole("Tilt bas rapide", "cmd"); return;
        case 'status':
            fetch(`http://${espIp}/status`, {mode:'cors'}).then(r=>r.json()).then(d=>{
                logConsole(`IP:${d.ip} RSSI:${d.rssi}dBm Uptime:${d.uptime}s Stream:${d.stream_active?'ON':'OFF'}`, "sys");
            }).catch(e=>logConsole("Erreur status: "+e.message, "err"));
            return;
        default: logConsole("Inconnu: " + cmd, "err");
    }
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
