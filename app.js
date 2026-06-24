// ==========================================
// S3-PRO PTZ — APP.JS v4.0
// Mobile-optimized | SD Card HD | Auto resolution
// Miroirs indépendants | Réglages -10/+10 | localStorage persistant
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
var recordInterval = null;

var filterState = {
    brightness: 0,
    saturation: 0,
    contrast: 0,
    rotation: 0,
    mirrorH: false,
    mirrorV: false
};

function loadFromStorage() {
    filterState.brightness = parseFloat(localStorage.getItem('ptz_brightness')) || 0;
    filterState.saturation = parseFloat(localStorage.getItem('ptz_saturation')) || 0;
    filterState.contrast = parseFloat(localStorage.getItem('ptz_contrast')) || 0;
    filterState.rotation = parseInt(localStorage.getItem('ptz_rotation')) || 0;
    filterState.mirrorH = localStorage.getItem('ptz_mirror_h') === 'true';
    filterState.mirrorV = localStorage.getItem('ptz_mirror_v') === 'true';
    return {
        savedRes: localStorage.getItem('ptz_resolution') || 'AUTO',
        savedQuality: localStorage.getItem('ptz_quality') || '12'
    };
}

function saveToStorage() {
    localStorage.setItem('ptz_brightness', filterState.brightness);
    localStorage.setItem('ptz_saturation', filterState.saturation);
    localStorage.setItem('ptz_contrast', filterState.contrast);
    localStorage.setItem('ptz_rotation', filterState.rotation);
    localStorage.setItem('ptz_mirror_h', filterState.mirrorH);
    localStorage.setItem('ptz_mirror_v', filterState.mirrorV);
}

window.addEventListener('DOMContentLoaded', function() {
    const saved = loadFromStorage();
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

        <div class="tabs-nav" id="tabs-nav">
            <button id="nav-studio" class="tab-btn active" onclick="switchTab('studio')">🎬 Live</button>
            <button id="nav-params" class="tab-btn" onclick="switchTab('params')">⚙️ Paramètres</button>
            <button id="nav-terminal" class="tab-btn" onclick="switchTab('terminal')">📟 Terminal</button>
        </div>

        <div id="tab-studio" class="tab-content active">
            <div class="studio-grid">
                <div class="video-zone">
                    <div class="video-viewport" id="video-viewport">
                        <div class="status-badge secure">● SÉCURISÉ</div>
                        <div id="stream-wrapper" class="stream-wrapper">
                            <img id="video-stream" src="" alt="En attente..." style="display:none">
                        </div>
                        <div id="stream-placeholder" class="stream-placeholder">Entrez l'IP et cliquez Connecter</div>
                    </div>
                    <div class="action-bar">
                        <button onclick="rotateStream()" class="pro-btn">↻ Rotation</button>
                        <button onclick="captureHD()" class="pro-btn btn-primary">📸 Capture HD</button>
                        <button onclick="capturePhoto()" class="pro-btn btn-primary">📷 Photo</button>
                        <button id="btn-record" onclick="toggleRecord()" class="pro-btn btn-danger">🔴 Enregistrer</button>
                        <button onclick="sendCmd('HOME')" class="pro-btn">🏠 HOME</button>
                    </div>
                </div>

                <div class="side-panel">
                    <div class="pro-card">
                        <div class="section-title">🎮 Contrôle Pan / Tilt</div>
                        <div class="ptz-grid">
                            <div></div>
                            <button class="ptz-btn ptz-arrow"
                                onmousedown="ptzPress('V', 32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('V', 32)" ontouchend="ptzRelease()"
                                ontouchcancel="ptzRelease()">▲ Haut</button>
                            <div></div>
                            <button class="ptz-btn ptz-arrow"
                                onmousedown="ptzPress('H', -32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('H', -32)" ontouchend="ptzRelease()"
                                ontouchcancel="ptzRelease()">◀ Gauche</button>
                            <button class="ptz-btn ptz-home" onclick="sendCmd('CENTER')">⌂ CENTRE</button>
                            <button class="ptz-btn ptz-arrow"
                                onmousedown="ptzPress('H', 32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('H', 32)" ontouchend="ptzRelease()"
                                ontouchcancel="ptzRelease()">Droite ▶</button>
                            <div></div>
                            <button class="ptz-btn ptz-arrow"
                                onmousedown="ptzPress('V', -32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('V', -32)" ontouchend="ptzRelease()"
                                ontouchcancel="ptzRelease()">▼ Bas</button>
                            <div></div>
                        </div>
                        <div class="ptz-hint">Clic rapide = pas large | Maintenir = pas fin & continu</div>
                    </div>

                    <div class="pro-card">
                        <div class="section-title">📐 Résolution Stream</div>
                        <select id="res-select" class="pro-input res-select" onchange="setResolution(this.value)">
                            <option value="AUTO" ${saved.savedRes === 'AUTO' ? 'selected' : ''}>AUTO (adaptatif)</option>
                            <option value="QVGA" ${saved.savedRes === 'QVGA' ? 'selected' : ''}>QVGA (320×240) — Ultra rapide</option>
                            <option value="VGA" ${saved.savedRes === 'VGA' ? 'selected' : ''}>VGA (640×480) — Rapide</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>

        <div id="tab-params" class="tab-content">
            <div class="params-grid">
                <div class="pro-card">
                    <div class="section-title">📷 Paramètres Capteur OV2640</div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Luminosité capteur (-2 à +2)</span>
                            <span id="val-cam-brightness" class="value-display">1</span>
                        </div>
                        <input type="range" id="cam-brightness" class="pro-slider" min="-2" max="2" value="1" step="1"
                            oninput="document.getElementById('val-cam-brightness').textContent=this.value">
                    </div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Contraste capteur (-2 à +2)</span>
                            <span id="val-cam-contrast" class="value-display">1</span>
                        </div>
                        <input type="range" id="cam-contrast" class="pro-slider" min="-2" max="2" value="1" step="1"
                            oninput="document.getElementById('val-cam-contrast').textContent=this.value">
                    </div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Saturation capteur (-2 à +2)</span>
                            <span id="val-cam-saturation" class="value-display">1</span>
                        </div>
                        <input type="range" id="cam-saturation" class="pro-slider" min="-2" max="2" value="1" step="1"
                            oninput="document.getElementById('val-cam-saturation').textContent=this.value">
                    </div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Netteté capteur (-2 à +2)</span>
                            <span id="val-cam-sharpness" class="value-display">2</span>
                        </div>
                        <input type="range" id="cam-sharpness" class="pro-slider" min="-2" max="2" value="2" step="1"
                            oninput="document.getElementById('val-cam-sharpness').textContent=this.value">
                    </div>
                    <button onclick="applyCameraParams()" class="pro-btn btn-primary" style="width:100%;margin-top:12px;">
                        ✓ Appliquer les paramètres capteur
                    </button>
                </div>

                <div class="pro-card">
                    <div class="section-title">🎨 Traitement d'image</div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Luminosité (-10 à +10)</span>
                            <span id="val-brightness" class="value-display">0</span>
                        </div>
                        <input type="range" id="ctrl-brightness" class="pro-slider" min="-10" max="10" value="0" step="0.5"
                            oninput="updateFilter('brightness', this.value)">
                    </div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Saturation (-10 à +10)</span>
                            <span id="val-saturation" class="value-display">0</span>
                        </div>
                        <input type="range" id="ctrl-saturation" class="pro-slider" min="-10" max="10" value="0" step="0.5"
                            oninput="updateFilter('saturation', this.value)">
                    </div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Contraste (-10 à +10)</span>
                            <span id="val-contrast" class="value-display">0</span>
                        </div>
                        <input type="range" id="ctrl-contrast" class="pro-slider" min="-10" max="10" value="0" step="0.5"
                            oninput="updateFilter('contrast', this.value)">
                    </div>
                </div>

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

                <div class="pro-card">
                    <div class="section-title">🎯 Qualité JPEG Stream</div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Qualité (4=meilleur, 30=minimum)</span>
                            <span id="val-quality" class="value-display">12</span>
                        </div>
                        <input type="range" id="ctrl-quality" class="pro-slider" min="4" max="30" value="12"
                            oninput="updateQuality(this.value)" onchange="setQuality(this.value)">
                    </div>
                </div>

                <div class="pro-card">
                    <div class="section-title">ℹ️ Informations</div>
                    <p style="color:var(--text-muted);font-size:13px;line-height:1.6;">
                        Les paramètres capteur sont envoyés directement à l'ESP32.<br><br>
                        Le traitement d'image est appliqué côté navigateur.<br>
                        Tous les réglages sont sauvegardés automatiquement.<br><br>
                        <strong>Qualité 4-30:</strong> Plus bas = meilleure qualité, plus haut = plus rapide.
                    </p>
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
                            <button onclick="executeCommand('status')" class="pro-btn btn-small">🔄 Status</button>
                        </div>
                    </div>
                    <div id="console-output" class="console-box">
                        <div class="log-row sys">[SYS] Console PTZ v4.0 initialisée</div>
                        <div class="log-row sys">[SYS] Mobile-optimized | SD Card | Auto resolution</div>
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
                        <div class="cmd-item" onclick="executeCommand('center')"><span class="cmd-syntax">center</span><span class="cmd-desc">Position 1/4 (vue)</span></div>
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

    document.getElementById('ctrl-brightness').value = filterState.brightness;
    document.getElementById('val-brightness').textContent = filterState.brightness;
    document.getElementById('ctrl-saturation').value = filterState.saturation;
    document.getElementById('val-saturation').textContent = filterState.saturation;
    document.getElementById('ctrl-contrast').value = filterState.contrast;
    document.getElementById('val-contrast').textContent = filterState.contrast;
    document.getElementById('mirror-h').checked = filterState.mirrorH;
    document.getElementById('mirror-v').checked = filterState.mirrorV;
    document.getElementById('ctrl-quality').value = saved.savedQuality;
    document.getElementById('val-quality').textContent = saved.savedQuality;
    applyTransform();
    applyFilters();
    initSwipeTabs();
    if (espIp) connectSystem();
});

function initSwipeTabs() {
    let startX = 0;
    let startY = 0;
    const tabs = ['studio', 'params', 'terminal'];
    document.addEventListener('touchstart', function(e) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', function(e) {
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const diffX = startX - endX;
        const diffY = startY - endY;
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            const currentTab = document.querySelector('.tab-btn.active').id.replace('nav-', '');
            const idx = tabs.indexOf(currentTab);
            if (diffX > 0 && idx < tabs.length - 1) switchTab(tabs[idx + 1]);
            else if (diffX < 0 && idx > 0) switchTab(tabs[idx - 1]);
        }
    }, { passive: true });
}

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
            if (d.sd_available) logConsole("SD Card détectée", "success");
        })
        .catch(e => {
            updateStatus(false);
            logConsole("Connexion API: " + e.message, "err");
        });
}

function updateStatus(ok) {
    document.getElementById('conn-status').className = ok ? 'status-dot online' : 'status-dot offline';
}

function ptzPress(axis, steps) {
    if (!isConnected) { logConsole("Non connecté", "err"); return; }
    isHolding = false;
    sendCmd(axis + ":" + steps);
    ptzHoldTimer = setTimeout(() => {
        isHolding = true;
        ptzInterval = setInterval(() => {
            let fineSteps = steps > 0 ? 8 : -8;
            sendCmd(axis + ":" + fineSteps);
        }, 120);
    }, 250);
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

function setResolution(res) {
    if (!espIp) { logConsole("IP non définie", "err"); return; }
    localStorage.setItem('ptz_resolution', res);
    logConsole("Changement résolution: " + res + "...", "sys");
    fetch(`http://${espIp}/setres`, {
        method: 'POST', mode: 'cors',
        headers: {'Content-Type': 'text/plain'},
        body: res, cache: 'no-cache'
    })
    .then(r => r.text())
    .then(t => {
        logConsole("Résolution: " + res + " | " + t, "success");
        setTimeout(() => {
            const img = document.getElementById('video-stream');
            img.src = `http://${espIp}/stream?t=${Date.now()}`;
        }, 1000);
    })
    .catch(e => logConsole("Erreur résolution: " + e.message, "err"));
}

function updateQuality(val) {
    document.getElementById('val-quality').textContent = val;
}

function setQuality(val) {
    if (!espIp) return;
    localStorage.setItem('ptz_quality', val);
    fetch(`http://${espIp}/setquality`, {
        method: 'POST', mode: 'cors',
        headers: {'Content-Type': 'text/plain'},
        body: val, cache: 'no-cache'
    })
    .then(r => r.text())
    .then(t => {
        logConsole("Qualité JPEG: " + val, "success");
        setTimeout(() => {
            const img = document.getElementById('video-stream');
            img.src = `http://${espIp}/stream?t=${Date.now()}`;
        }, 1000);
    })
    .catch(e => logConsole("Erreur qualité: " + e.message, "err"));
}

function applyCameraParams() {
    if (!espIp) { logConsole("IP non définie", "err"); return; }
    const b = document.getElementById('cam-brightness').value;
    const c = document.getElementById('cam-contrast').value;
    const s = document.getElementById('cam-saturation').value;
    const sh = document.getElementById('cam-sharpness').value;
    const params = `brightness:${b}|contrast:${c}|saturation:${s}|sharpness:${sh}`;
    logConsole("Application paramètres capteur...", "sys");
    fetch(`http://${espIp}/setparams`, {
        method: 'POST', mode: 'cors',
        headers: {'Content-Type': 'text/plain'},
        body: params, cache: 'no-cache'
    })
    .then(r => r.text())
    .then(t => {
        logConsole("Paramètres appliqués: " + t, "success");
        setTimeout(() => {
            const img = document.getElementById('video-stream');
            img.src = `http://${espIp}/stream?t=${Date.now()}`;
        }, 1500);
    })
    .catch(e => logConsole("Erreur paramètres: " + e.message, "err"));
}

function capturePhoto() {
    if (!espIp) { logConsole("IP non définie", "err"); return; }
    logConsole("Capture photo en cours...", "sys");
    fetch(`http://${espIp}/capture`, {
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
        a.download = `S3PTZ_${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
        logConsole("Photo sauvegardée!", "success");
    })
    .catch(e => logConsole("Erreur photo: " + e.message, "err"));
}

function captureHD() {
    if (!espIp) { logConsole("IP non définie", "err"); return; }
    logConsole("Capture HD native + SD en cours...", "sys");
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
        logConsole("Photo HD native sauvegardée! (SD + navigateur)", "success");
    })
    .catch(e => logConsole("Erreur capture HD: " + e.message, "err"));
}

function toggleRecord() {
    const btn = document.getElementById('btn-record');
    if (!isRecording) { startRecording(); btn.innerHTML = "⏹️ Arrêter"; btn.classList.add('recording'); }
    else { stopRecording(); btn.innerHTML = "🔴 Enregistrer"; btn.classList.remove('recording'); }
}

function startRecording() {
    const img = document.getElementById('video-stream');
    if (!img.src || img.style.display === 'none') { logConsole("Flux non actif", "err"); return; }
    recordCanvas = document.createElement('canvas');
    recordCanvas.width = 640;
    recordCanvas.height = 480;
    recordCtx = recordCanvas.getContext('2d');
    const stream = recordCanvas.captureStream(15);
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
    mediaRecorder.start(200);
    isRecording = true;
    logConsole("Enregistrement démarré (15 FPS)", "sys");
    recordInterval = setInterval(() => {
        if (!recordCtx || !img.complete) return;
        recordCtx.filter = img.style.filter || 'none';
        recordCtx.save();
        recordCtx.translate(recordCanvas.width/2, recordCanvas.height/2);
        recordCtx.rotate(filterState.rotation * Math.PI / 180);
        if (filterState.mirrorH) recordCtx.scale(-1, 1);
        if (filterState.mirrorV) recordCtx.scale(1, -1);
        recordCtx.drawImage(img, -recordCanvas.width/2, -recordCanvas.height/2);
        recordCtx.restore();
    }, 66);
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (recordInterval) clearInterval(recordInterval);
    isRecording = false;
    recordCanvas = null;
    recordCtx = null;
    recordInterval = null;
    logConsole("Enregistrement arrêté", "sys");
}

function toggleMirror(axis, checked) {
    if (axis === 'h') filterState.mirrorH = checked;
    else filterState.mirrorV = checked;
    saveToStorage();
    applyTransform();
}

function applyTransform() {
    const wrapper = document.getElementById('stream-wrapper');
    if (!wrapper) return;
    let transform = `rotate(${filterState.rotation}deg)`;
    if (filterState.mirrorH) transform += ' scaleX(-1)';
    if (filterState.mirrorV) transform += ' scaleY(-1)';
    wrapper.style.transform = transform;
}

function updateFilter(type, value) {
    filterState[type] = parseFloat(value);
    document.getElementById('val-' + type).textContent = value;
    saveToStorage();
    applyFilters();
}

function applyFilters() {
    const img = document.getElementById('video-stream');
    if (!img) return;
    const b = 100 + (filterState.brightness * 10);
    const s = 100 + (filterState.saturation * 10);
    const c = 100 + (filterState.contrast * 10);
    img.style.filter = `brightness(${b}%) saturate(${s}%) contrast(${c}%)`;
}

function rotateStream() {
    filterState.rotation = (filterState.rotation + 90) % 360;
    saveToStorage();
    applyTransform();
}

function logConsole(msg, type) {
    const out = document.getElementById('console-output');
    if (!out) return;
    const row = document.createElement('div');
    row.className = 'log-row ' + (type || '');
    const time = new Date().toLocaleTimeString('fr-FR', {hour12:false});
    row.textContent = `[${time}] ${msg}`;
    out.appendChild(row);
    out.scrollTop = out.scrollHeight;
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

function executeCommand(val) {
    const input = document.getElementById('console-input');
    const cmd = val.trim().toLowerCase();
    input.value = '';
    if (!cmd) return;
    switch(cmd) {
        case 'clear': clearLogs(); return;
        case 'home': sendCmd('HOME'); logConsole("HOME envoyé", "cmd"); return;
        case 'center': sendCmd('CENTER'); logConsole("CENTER envoyé (position 1/4)", "cmd"); return;
        case 'left': sendCmd('H:64'); logConsole("Pan gauche rapide", "cmd"); return;
        case 'right': sendCmd('H:-64'); logConsole("Pan droite rapide", "cmd"); return;
        case 'up': sendCmd('V:64'); logConsole("Tilt haut rapide", "cmd"); return;
        case 'down': sendCmd('V:-64'); logConsole("Tilt bas rapide", "cmd"); return;
        case 'status':
            fetch(`http://${espIp}/status`, {mode:'cors'}).then(r=>r.json()).then(d=>{
                logConsole(`IP:${d.ip} RSSI:${d.rssi}dBm Uptime:${d.uptime}s Stream:${d.stream_active?'ON':'OFF'} SD:${d.sd_available?'OK':'N/A'}`, "sys");
            }).catch(e=>logConsole("Erreur status: "+e.message, "err"));
            return;
        default: logConsole("Inconnu: " + cmd, "err");
    }
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('nav-' + tab).classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
}
