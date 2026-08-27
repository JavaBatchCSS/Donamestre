// =============================================================================
// S3-PRO PTZ -- APP.JS v4.4-fix3
// Simplified: WiFi always ON, camera ON/OFF only
// Explicit camera power button before stream
// =============================================================================

var espIp = window.location.hostname;
if (!espIp || espIp === "localhost" || espIp.includes("github.io") || espIp === "") {
    espIp = localStorage.getItem("ptz_ip") || "";
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

window.cameraState = false;
window.tempC = 0;

function loadFromStorage() {
    filterState.brightness = parseFloat(localStorage.getItem("ptz_brightness")) || 0;
    filterState.saturation = parseFloat(localStorage.getItem("ptz_saturation")) || 0;
    filterState.contrast = parseFloat(localStorage.getItem("ptz_contrast")) || 0;
    filterState.rotation = parseInt(localStorage.getItem("ptz_rotation")) || 0;
    filterState.mirrorH = localStorage.getItem("ptz_mirror_h") === "true";
    filterState.mirrorV = localStorage.getItem("ptz_mirror_v") === "true";
    return {
        savedRes: localStorage.getItem("ptz_resolution") || "AUTO",
        savedQuality: localStorage.getItem("ptz_quality") || "12"
    };
}

function saveToStorage() {
    localStorage.setItem("ptz_brightness", filterState.brightness);
    localStorage.setItem("ptz_saturation", filterState.saturation);
    localStorage.setItem("ptz_contrast", filterState.contrast);
    localStorage.setItem("ptz_rotation", filterState.rotation);
    localStorage.setItem("ptz_mirror_h", filterState.mirrorH);
    localStorage.setItem("ptz_mirror_v", filterState.mirrorV);
}

window.addEventListener("DOMContentLoaded", function() {
    const saved = loadFromStorage();
    const root = document.getElementById("app-root");
    if (!root) return;
    root.innerHTML = buildHTML(saved);

    var el;
    if (el = document.getElementById("ctrl-brightness")) { el.value = filterState.brightness; document.getElementById("val-brightness").textContent = filterState.brightness; }
    if (el = document.getElementById("ctrl-saturation")) { el.value = filterState.saturation; document.getElementById("val-saturation").textContent = filterState.saturation; }
    if (el = document.getElementById("ctrl-contrast")) { el.value = filterState.contrast; document.getElementById("val-contrast").textContent = filterState.contrast; }
    if (el = document.getElementById("mirror-h")) el.checked = filterState.mirrorH;
    if (el = document.getElementById("mirror-v")) el.checked = filterState.mirrorV;
    if (el = document.getElementById("ctrl-quality")) { el.value = saved.savedQuality; document.getElementById("val-quality").textContent = saved.savedQuality; }

    applyTransform();
    applyFilters();
    initSwipeTabs();

    // Auto-connect API (not stream) to check status
    if (espIp) checkSystemStatus();
});

function buildHTML(saved) {
    var logoUrl = "https://javabatchcss.github.io/Donamestre/Donamestre.png";
    return `
    <div class="app-container">
        <header class="pro-header">
            <div class="brand-zone">
                <div class="logo-box">
                    <img src="${logoUrl}" alt="S3-PRO PTZ" class="logo-img" id="logo-img"
                        onerror="this.style.display='none';document.getElementById('logo-text').style.display='block'">
                    <div id="logo-text" class="logo-text" style="display:none">S3-PRO <span style="color:#6366f1">PTZ</span></div>
                </div>
                <div class="sub-brand">PAN/TILT DUAL-AXIS MONITORING</div>
            </div>
            <div class="connection-zone">
                <input type="text" id="esp-ip" class="pro-input" placeholder="IP ESP32" value="${espIp}">
                <button onclick="checkSystemStatus()" class="pro-btn btn-primary">Connecter</button>
                <span id="conn-status" class="status-dot offline">&#9679;</span>
            </div>
            <div class="power-zone" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;width:100%;">
                <button id="cam-toggle" onclick="toggleCamera()" class="pro-btn btn-danger" style="font-size:13px;padding:8px 14px;min-height:44px;flex:1;">
                    &#9679; Allumer Caméra
                </button>
                <span id="temp-badge" class="temp-badge" style="font-size:12px;color:#64748b;background:rgba(255,255,255,0.05);padding:6px 10px;border-radius:6px;border:1px solid transparent;white-space:nowrap;">--°C</span>
            </div>
        </header>

        <div class="tabs-nav" id="tabs-nav">
            <button id="nav-studio" class="tab-btn active" onclick="switchTab('studio')">Live</button>
            <button id="nav-params" class="tab-btn" onclick="switchTab('params')">Parametres</button>
            <button id="nav-gallery" class="tab-btn" onclick="switchTab('gallery')">Galerie</button>
            <button id="nav-terminal" class="tab-btn" onclick="switchTab('terminal')">Terminal</button>
        </div>

        <!-- STUDIO -->
        <div id="tab-studio" class="tab-content active">
            <div class="studio-grid">
                <div class="video-zone">
                    <div class="video-viewport" id="video-viewport">
                        <div class="status-badge" id="cam-badge" style="left:10px;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.2);">&#9679; CAMERA OFF</div>
                        <div id="stream-wrapper" class="stream-wrapper">
                            <img id="video-stream" src="" alt="En attente..." style="display:none">
                        </div>
                        <div id="stream-placeholder" class="stream-placeholder">
                            <div style="text-align:center;">
                                <div style="font-size:48px;margin-bottom:12px;">&#128247;</div>
                                <div style="font-size:15px;font-weight:600;margin-bottom:6px;">Caméra en veille</div>
                                <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">Cliquez "Allumer Caméra" pour activer le flux</div>
                                <button onclick="toggleCamera()" class="pro-btn btn-primary" style="padding:12px 24px;font-size:14px;">Allumer la Caméra</button>
                            </div>
                        </div>
                    </div>
                    <div class="action-bar">
                        <button onclick="rotateStream()" class="pro-btn">Rotation</button>
                        <button onclick="captureHD()" class="pro-btn btn-primary">Capture HD</button>
                        <button onclick="capturePhoto()" class="pro-btn btn-primary">Photo</button>
                        <button id="btn-record" onclick="toggleRecord()" class="pro-btn btn-danger">Enregistrer</button>
                        <button onclick="sendCmd('HOME')" class="pro-btn">HOME</button>
                    </div>
                </div>

                <div class="side-panel">
                    <div class="pro-card">
                        <div class="section-title">Controle Pan / Tilt</div>
                        <div class="ptz-grid">
                            <div></div>
                            <button class="ptz-btn ptz-arrow"
                                onmousedown="ptzPress('V', 32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('V', 32)" ontouchend="ptzRelease()"
                                ontouchcancel="ptzRelease()">&#9650; Haut</button>
                            <div></div>
                            <button class="ptz-btn ptz-arrow"
                                onmousedown="ptzPress('H', -32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('H', -32)" ontouchend="ptzRelease()"
                                ontouchcancel="ptzRelease()">&#9664; Gauche</button>
                            <button class="ptz-btn ptz-home" onclick="sendCmd('CENTER')">CENTRE</button>
                            <button class="ptz-btn ptz-arrow"
                                onmousedown="ptzPress('H', 32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('H', 32)" ontouchend="ptzRelease()"
                                ontouchcancel="ptzRelease()">Droite &#9654;</button>
                            <div></div>
                            <button class="ptz-btn ptz-arrow"
                                onmousedown="ptzPress('V', -32)" onmouseup="ptzRelease()" onmouseleave="ptzRelease()"
                                ontouchstart="ptzPress('V', -32)" ontouchend="ptzRelease()"
                                ontouchcancel="ptzRelease()">&#9660; Bas</button>
                            <div></div>
                        </div>
                        <div class="ptz-hint">Clic rapide = pas large | Maintenir = pas fin et continu</div>
                    </div>

                    <div class="pro-card">
                        <div class="section-title">Resolution Stream</div>
                        <select id="res-select" class="pro-input res-select" onchange="setResolution(this.value)">
                            <option value="AUTO" ${saved.savedRes === 'AUTO' ? 'selected' : ''}>AUTO (adaptatif)</option>
                            <option value="QVGA" ${saved.savedRes === 'QVGA' ? 'selected' : ''}>QVGA (320x240) -- Ultra rapide</option>
                            <option value="VGA" ${saved.savedRes === 'VGA' ? 'selected' : ''}>VGA (640x480) -- Rapide</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>

        <!-- PARAMETRES -->
        <div id="tab-params" class="tab-content">
            <div class="params-grid">
                <div class="pro-card">
                    <div class="section-title">Parametres Capteur OV2640</div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Luminosite capteur (-2 a +2)</span>
                            <span id="val-cam-brightness" class="value-display">1</span>
                        </div>
                        <input type="range" id="cam-brightness" class="pro-slider" min="-2" max="2" value="1" step="1"
                            oninput="document.getElementById('val-cam-brightness').textContent=this.value">
                    </div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Contraste capteur (-2 a +2)</span>
                            <span id="val-cam-contrast" class="value-display">1</span>
                        </div>
                        <input type="range" id="cam-contrast" class="pro-slider" min="-2" max="2" value="1" step="1"
                            oninput="document.getElementById('val-cam-contrast').textContent=this.value">
                    </div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Saturation capteur (-2 a +2)</span>
                            <span id="val-cam-saturation" class="value-display">1</span>
                        </div>
                        <input type="range" id="cam-saturation" class="pro-slider" min="-2" max="2" value="1" step="1"
                            oninput="document.getElementById('val-cam-saturation').textContent=this.value">
                    </div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Nettete capteur (-2 a +2)</span>
                            <span id="val-cam-sharpness" class="value-display">2</span>
                        </div>
                        <input type="range" id="cam-sharpness" class="pro-slider" min="-2" max="2" value="2" step="1"
                            oninput="document.getElementById('val-cam-sharpness').textContent=this.value">
                    </div>
                    <button onclick="applyCameraParams()" class="pro-btn btn-primary" style="width:100%;margin-top:12px;">
                        Appliquer les parametres capteur
                    </button>
                </div>

                <div class="pro-card">
                    <div class="section-title">Traitement d'image</div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Luminosite (-10 a +10)</span>
                            <span id="val-brightness" class="value-display">0</span>
                        </div>
                        <input type="range" id="ctrl-brightness" class="pro-slider" min="-10" max="10" value="0" step="1"
                            oninput="updateFilter('brightness', this.value)">
                    </div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Saturation (-10 a +10)</span>
                            <span id="val-saturation" class="value-display">0</span>
                        </div>
                        <input type="range" id="ctrl-saturation" class="pro-slider" min="-10" max="10" value="0" step="1"
                            oninput="updateFilter('saturation', this.value)">
                    </div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Contraste (-10 a +10)</span>
                            <span id="val-contrast" class="value-display">0</span>
                        </div>
                        <input type="range" id="ctrl-contrast" class="pro-slider" min="-10" max="10" value="0" step="1"
                            oninput="updateFilter('contrast', this.value)">
                    </div>
                </div>

                <div class="pro-card">
                    <div class="section-title">Miroirs</div>
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
                    <div class="section-title">Qualite JPEG Stream</div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Qualite (4=meilleur, 30=minimum)</span>
                            <span id="val-quality" class="value-display">12</span>
                        </div>
                        <input type="range" id="ctrl-quality" class="pro-slider" min="4" max="30" value="12"
                            oninput="updateQuality(this.value)" onchange="setQuality(this.value)">
                    </div>
                </div>

                <div class="pro-card">
                    <div class="section-title">Gestion Thermique</div>
                    <div class="range-group">
                        <div class="range-labels">
                            <span>Puissance WiFi TX (dBm)</span>
                            <span id="val-wifipower" class="value-display">19</span>
                        </div>
                        <input type="range" id="ctrl-wifipower" class="pro-slider" min="8" max="20" value="19" step="1"
                            oninput="document.getElementById('val-wifipower').textContent=this.value" onchange="setWiFiPower(this.value)">
                    </div>
                    <button onclick="forceCameraOff()" class="pro-btn btn-danger" style="width:100%;margin-top:10px;">Eteindre Caméra (Refroidir)</button>
                    <p style="color:var(--text-muted);font-size:12px;margin-top:8px;line-height:1.5;">
                        La caméra est la principale source de chaleur.<br>
                        Eteignez-la quand vous n'en avez pas besoin.<br>
                        Auto-extinction après 5 min d'inactivité.
                    </p>
                </div>

                <div class="pro-card">
                    <div class="section-title">Informations</div>
                    <p style="color:var(--text-muted);font-size:13px;line-height:1.6;">
                        Les parametres capteur sont envoyes directement a l'ESP32.<br><br>
                        Le traitement d'image est applique cote navigateur.<br>
                        Tous les reglages sont sauvegardes automatiquement.<br><br>
                        <strong>Qualite 4-30:</strong> Plus bas = meilleure qualite, plus haut = plus rapide.
                    </p>
                </div>
            </div>
        </div>

        <!-- GALERIE -->
        <div id="tab-gallery" class="tab-content">
            <div class="gallery-layout">
                <div class="pro-card">
                    <div class="section-title">Photos sur carte SD</div>
                    <div id="gallery-grid" class="gallery-grid">
                        <p style="color:var(--text-muted);font-size:14px;">Cliquez sur l'onglet pour charger...</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- TERMINAL -->
        <div id="tab-terminal" class="tab-content">
            <div class="terminal-layout">
                <div class="terminal-zone">
                    <div class="panel-header">
                        <span class="panel-title">Console Systeme</span>
                        <div class="header-actions">
                            <button onclick="copyLogs()" class="pro-btn btn-small">Copier</button>
                            <button onclick="clearLogs()" class="pro-btn btn-small">Effacer</button>
                            <button onclick="executeCommand('status')" class="pro-btn btn-small">Status</button>
                        </div>
                    </div>
                    <div id="console-output" class="console-box">
                        <div class="log-row sys">[SYS] Console PTZ v4.4-fix3</div>
                        <div class="log-row sys">[SYS] Camera ON/OFF | WiFi always ON</div>
                    </div>
                    <div class="console-input-bar">
                        <span class="prompt">&gt;</span>
                        <input type="text" id="console-input" placeholder="Commande..." onkeydown="if(event.key==='Enter')executeCommand(this.value)">
                    </div>
                </div>
                <div class="commands-zone">
                    <div class="panel-header">
                        <span class="panel-title">Commandes Rapides</span>
                    </div>
                    <div class="command-list">
                        <div class="cmd-item" onclick="executeCommand('home')"><span class="cmd-syntax">home</span><span class="cmd-desc">Recalage complet</span></div>
                        <div class="cmd-item" onclick="executeCommand('center')"><span class="cmd-syntax">center</span><span class="cmd-desc">Position 1/4</span></div>
                        <div class="cmd-item" onclick="executeCommand('left')"><span class="cmd-syntax">left</span><span class="cmd-desc">Pan gauche</span></div>
                        <div class="cmd-item" onclick="executeCommand('right')"><span class="cmd-syntax">right</span><span class="cmd-desc">Pan droite</span></div>
                        <div class="cmd-item" onclick="executeCommand('up')"><span class="cmd-syntax">up</span><span class="cmd-desc">Tilt haut</span></div>
                        <div class="cmd-item" onclick="executeCommand('down')"><span class="cmd-syntax">down</span><span class="cmd-desc">Tilt bas</span></div>
                        <div class="cmd-item" onclick="executeCommand('status')"><span class="cmd-syntax">status</span><span class="cmd-desc">Etat complet</span></div>
                        <div class="cmd-item" onclick="executeCommand('camon')"><span class="cmd-syntax">camon</span><span class="cmd-desc">Allumer camera</span></div>
                        <div class="cmd-item" onclick="executeCommand('camoff')"><span class="cmd-syntax">camoff</span><span class="cmd-desc">Eteindre camera</span></div>
                        <div class="cmd-item" onclick="executeCommand('clear')"><span class="cmd-syntax">clear</span><span class="cmd-desc">Effacer console</span></div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function initSwipeTabs() {
    var startX = 0, startY = 0;
    var tabs = ["studio", "params", "gallery", "terminal"];
    document.addEventListener("touchstart", function(e) {
        startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener("touchend", function(e) {
        var diffX = startX - e.changedTouches[0].clientX;
        var diffY = startY - e.changedTouches[0].clientY;
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            var currentTab = document.querySelector(".tab-btn.active").id.replace("nav-", "");
            var idx = tabs.indexOf(currentTab);
            if (diffX > 0 && idx < tabs.length - 1) switchTab(tabs[idx + 1]);
            else if (diffX < 0 && idx > 0) switchTab(tabs[idx - 1]);
        }
    }, { passive: true });
}

// =============================================================================
// STATUS CHECK (no stream yet)
// =============================================================================
function checkSystemStatus() {
    var input = document.getElementById("esp-ip");
    espIp = input.value.trim();
    if (!espIp) { logConsole("Entrez une IP", "err"); return; }
    localStorage.setItem("ptz_ip", espIp);

    fetch("http://" + espIp + "/status", {mode: "cors", cache: "no-cache"})
        .then(function(r) { return r.json(); })
        .then(function(d) {
            isConnected = true;
            updateStatus(true);
            logConsole("Connecte: " + espIp + " | RSSI:" + d.rssi + "dBm", "success");
            logConsole("Caméra: " + (d.camera_enabled ? "ON" : "OFF") + " | Temp: " + d.temp + "°C", d.camera_enabled ? "success" : "sys");
            if (d.sd_available) logConsole("SD OK", "success");
            window.cameraState = d.camera_enabled;
            updateCameraUI();
        })
        .catch(function(e) {
            updateStatus(false);
            logConsole("Connexion: " + e.message, "err");
        });

    fetch("http://" + espIp + "/camera", {mode: "cors", cache: "no-cache"})
        .then(function(r){ return r.text(); })
        .then(function(t){
            window.cameraState = (t.trim() === "ON");
            updateCameraUI();
        })
        .catch(function(){});

    setInterval(fetchTemp, 8000);
    fetchTemp();
}

function updateStatus(ok) {
    document.getElementById("conn-status").className = ok ? "status-dot online" : "status-dot offline";
}

// =============================================================================
// CAMERA TOGGLE
// =============================================================================
function toggleCamera() {
    if (!espIp) { logConsole("IP non definie", "err"); return; }
    var newState = !window.cameraState;
    var cmd = newState ? "ON" : "OFF";
    fetch("http://" + espIp + "/camera", {
        method: "POST", mode: "cors",
        headers: {"Content-Type": "text/plain"},
        body: cmd, cache: "no-cache"
    })
    .then(function(r){ return r.text(); })
    .then(function(t){
        window.cameraState = newState;
        updateCameraUI();
        logConsole("Caméra " + cmd + " | " + t, newState ? "success" : "sys");
        if (newState) {
            // Start stream after camera is ON
            setTimeout(function(){
                var img = document.getElementById("video-stream");
                var placeholder = document.getElementById("stream-placeholder");
                img.src = "http://" + espIp + "/stream?t=" + Date.now();
                img.style.display = "block";
                placeholder.style.display = "none";
                img.onerror = function() {
                    logConsole("Stream erreur", "err");
                };
                img.onload = function() {
                    logConsole("Stream actif", "success");
                };
            }, 800);
        } else {
            var img = document.getElementById("video-stream");
            var placeholder = document.getElementById("stream-placeholder");
            img.src = "";
            img.style.display = "none";
            placeholder.style.display = "flex";
        }
    })
    .catch(function(e){ logConsole("Erreur caméra: " + e.message, "err"); });
}

function forceCameraOff() {
    if (!espIp) return;
    fetch("http://" + espIp + "/camera", {
        method: "POST", mode: "cors",
        headers: {"Content-Type": "text/plain"},
        body: "OFF", cache: "no-cache"
    })
    .then(function(r){ return r.text(); })
    .then(function(t){
        window.cameraState = false;
        updateCameraUI();
        var img = document.getElementById("video-stream");
        var placeholder = document.getElementById("stream-placeholder");
        img.src = ""; img.style.display = "none"; placeholder.style.display = "flex";
        logConsole("Caméra éteinte (refroidissement)", "success");
    })
    .catch(function(e){ logConsole("Erreur: " + e.message, "err"); });
}

function updateCameraUI() {
    var btn = document.getElementById("cam-toggle");
    var badge = document.getElementById("cam-badge");
    var placeholder = document.getElementById("stream-placeholder");
    if (btn) {
        if (window.cameraState) {
            btn.innerHTML = "&#9679; Eteindre Caméra";
            btn.className = "pro-btn btn-primary";
        } else {
            btn.innerHTML = "&#9679; Allumer Caméra";
            btn.className = "pro-btn btn-danger";
        }
    }
    if (badge) {
        if (window.cameraState) {
            badge.innerHTML = "&#9679; CAMERA ON";
            badge.style.background = "rgba(16,185,129,0.1)";
            badge.style.color = "#10b981";
            badge.style.border = "1px solid rgba(16,185,129,0.2)";
        } else {
            badge.innerHTML = "&#9679; CAMERA OFF";
            badge.style.background = "rgba(239,68,68,0.1)";
            badge.style.color = "#ef4444";
            badge.style.border = "1px solid rgba(239,68,68,0.2)";
        }
    }
}

function fetchTemp() {
    if (!espIp) return;
    fetch("http://" + espIp + "/temp", {mode: "cors", cache: "no-cache"})
    .then(function(r){ return r.json(); })
    .then(function(d){
        window.tempC = d.temp;
        var el = document.getElementById("temp-badge");
        if (el) {
            var color = d.temp > 65 ? "#ef4444" : (d.temp > 50 ? "#f59e0b" : "#64748b");
            el.textContent = d.temp.toFixed(1) + "°C";
            el.style.color = color;
            el.style.border = "1px solid " + color;
        }
        if (d.thermal_throttled) logConsole("ALERTE THERMIQUE!", "err");
    })
    .catch(function(){});
}

function setWiFiPower(val) {
    if (!espIp) return;
    fetch("http://" + espIp + "/wifipower", {
        method: "POST", mode: "cors",
        headers: {"Content-Type": "text/plain"},
        body: val, cache: "no-cache"
    })
    .then(function(r){ return r.text(); })
    .then(function(t){ logConsole("WiFi TX: " + val + "dBm", "success"); })
    .catch(function(e){ logConsole("Erreur WiFi power: " + e.message, "err"); });
}

// =============================================================================
// PTZ
// =============================================================================
function ptzPress(axis, steps) {
    if (!isConnected) { logConsole("Non connecte", "err"); return; }
    isHolding = false;
    sendCmd(axis + ":" + steps);
    ptzHoldTimer = setTimeout(function() {
        isHolding = true;
        ptzInterval = setInterval(function() {
            var fineSteps = steps > 0 ? 8 : -8;
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
    fetch("http://" + espIp + "/cmd", {
        method: "POST", mode: "cors",
        headers: {"Content-Type": "text/plain"},
        body: cmd, cache: "no-cache"
    })
    .then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); logConsole("> " + cmd, "cmd"); })
    .catch(function(e) { logConsole("Erreur cmd: " + e.message, "err"); isConnected = false; updateStatus(false); });
}

// =============================================================================
// RESOLUTION
// =============================================================================
function setResolution(res) {
    if (!espIp) { logConsole("IP non definie", "err"); return; }
    localStorage.setItem("ptz_resolution", res);
    logConsole("Resolution: " + res + "...", "sys");
    fetch("http://" + espIp + "/setres", {
        method: "POST", mode: "cors",
        headers: {"Content-Type": "text/plain"},
        body: res, cache: "no-cache"
    })
    .then(function(r) { return r.text(); })
    .then(function(t) {
        logConsole("Resolution: " + res + " | " + t, "success");
        setTimeout(function() {
            var img = document.getElementById("video-stream");
            if (img.style.display !== "none") img.src = "http://" + espIp + "/stream?t=" + Date.now();
        }, 1000);
    })
    .catch(function(e) { logConsole("Erreur: " + e.message, "err"); });
}

// =============================================================================
// QUALITY
// =============================================================================
function updateQuality(val) {
    document.getElementById("val-quality").textContent = val;
}

function setQuality(val) {
    if (!espIp) return;
    localStorage.setItem("ptz_quality", val);
    fetch("http://" + espIp + "/setquality", {
        method: "POST", mode: "cors",
        headers: {"Content-Type": "text/plain"},
        body: val, cache: "no-cache"
    })
    .then(function(r) { return r.text(); })
    .then(function(t) {
        logConsole("Qualite: " + val, "success");
        setTimeout(function() {
            var img = document.getElementById("video-stream");
            if (img.style.display !== "none") img.src = "http://" + espIp + "/stream?t=" + Date.now();
        }, 1000);
    })
    .catch(function(e) { logConsole("Erreur: " + e.message, "err"); });
}

// =============================================================================
// CAMERA PARAMS
// =============================================================================
function applyCameraParams() {
    if (!espIp) { logConsole("IP non definie", "err"); return; }
    var b = document.getElementById("cam-brightness").value;
    var c = document.getElementById("cam-contrast").value;
    var s = document.getElementById("cam-saturation").value;
    var sh = document.getElementById("cam-sharpness").value;
    var params = "brightness:" + b + "|contrast:" + c + "|saturation:" + s + "|sharpness:" + sh;
    logConsole("Application parametres...", "sys");
    fetch("http://" + espIp + "/setparams", {
        method: "POST", mode: "cors",
        headers: {"Content-Type": "text/plain"},
        body: params, cache: "no-cache"
    })
    .then(function(r) { return r.text(); })
    .then(function(t) {
        logConsole("Parametres appliques: " + t, "success");
    })
    .catch(function(e) { logConsole("Erreur: " + e.message, "err"); });
}

// =============================================================================
// FILTERS
// =============================================================================
function applyFiltersToImage(srcImg, callback) {
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    var w = srcImg.naturalWidth || srcImg.width || 640;
    var h = srcImg.naturalHeight || srcImg.height || 480;
    if (filterState.rotation === 90 || filterState.rotation === 270) {
        canvas.width = h; canvas.height = w;
    } else { canvas.width = w; canvas.height = h; }
    var b = 100 + (filterState.brightness * 10);
    var s = 100 + (filterState.saturation * 10);
    var c = 100 + (filterState.contrast * 10);
    ctx.filter = "brightness(" + b + "%) saturate(" + s + "%) contrast(" + c + "%)";
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(filterState.rotation * Math.PI / 180);
    if (filterState.mirrorH) ctx.scale(-1, 1);
    if (filterState.mirrorV) ctx.scale(1, -1);
    ctx.drawImage(srcImg, -w / 2, -h / 2);
    ctx.restore();
    canvas.toBlob(function(blob) { callback(blob); }, "image/jpeg", 0.92);
}

function capturePhoto() {
    if (!espIp) { logConsole("IP non definie", "err"); return; }
    var img = document.getElementById("video-stream");
    if (!img || img.style.display === "none" || !img.complete) {
        logConsole("Flux non actif", "err"); return;
    }
    logConsole("Capture photo...", "sys");
    applyFiltersToImage(img, function(blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = "S3PTZ_" + Date.now() + ".jpg"; a.click();
        URL.revokeObjectURL(url);
        logConsole("Photo sauvegardee!", "success");
    });
}

function captureHD() {
    if (!espIp) { logConsole("IP non definie", "err"); return; }
    logConsole("Capture HD...", "sys");
    fetch("http://" + espIp + "/capturehd", {method: "GET", mode: "cors", cache: "no-cache"})
    .then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
    .then(function(blob) {
        var img = new Image();
        img.onload = function() {
            applyFiltersToImage(img, function(processedBlob) {
                var url = URL.createObjectURL(processedBlob);
                var a = document.createElement("a");
                a.href = url; a.download = "S3PTZ_HD_" + Date.now() + ".jpg"; a.click();
                URL.revokeObjectURL(url);
                logConsole("Photo HD sauvegardee!", "success");
            });
        };
        img.src = URL.createObjectURL(blob);
    })
    .catch(function(e) { logConsole("Erreur HD: " + e.message, "err"); });
}

// =============================================================================
// RECORDING
// =============================================================================
function toggleRecord() {
    var btn = document.getElementById("btn-record");
    if (!isRecording) { startRecording(); btn.innerHTML = "Arreter"; btn.classList.add("recording"); }
    else { stopRecording(); btn.innerHTML = "Enregistrer"; btn.classList.remove("recording"); }
}

function startRecording() {
    var img = document.getElementById("video-stream");
    if (!img.src || img.style.display === "none") { logConsole("Flux non actif", "err"); return; }
    recordCanvas = document.createElement("canvas");
    recordCanvas.width = 640; recordCanvas.height = 480;
    recordCtx = recordCanvas.getContext("2d");
    var stream = recordCanvas.captureStream(15);
    mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    var chunks = [];
    mediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = function() {
        var blob = new Blob(chunks, { type: "video/webm" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "S3PTZ_RECORD_" + Date.now() + ".webm"; a.click();
        logConsole("Video sauvegardee", "success");
    };
    mediaRecorder.start(200);
    isRecording = true;
    logConsole("Enregistrement demarre", "sys");
    recordInterval = setInterval(function() {
        if (!recordCtx || !img.complete) return;
        recordCtx.filter = img.style.filter || "none";
        recordCtx.save();
        recordCtx.translate(recordCanvas.width / 2, recordCanvas.height / 2);
        recordCtx.rotate(filterState.rotation * Math.PI / 180);
        if (filterState.mirrorH) recordCtx.scale(-1, 1);
        if (filterState.mirrorV) recordCtx.scale(1, -1);
        recordCtx.drawImage(img, -recordCanvas.width / 2, -recordCanvas.height / 2);
        recordCtx.restore();
    }, 66);
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    if (recordInterval) clearInterval(recordInterval);
    isRecording = false; recordCanvas = null; recordCtx = null; recordInterval = null;
    logConsole("Enregistrement arrete", "sys");
}

// =============================================================================
// MIRRORS & TRANSFORMS
// =============================================================================
function toggleMirror(axis, checked) {
    if (axis === "h") filterState.mirrorH = checked;
    else filterState.mirrorV = checked;
    saveToStorage(); applyTransform();
}

function applyTransform() {
    var wrapper = document.getElementById("stream-wrapper");
    if (!wrapper) return;
    var transform = "rotate(" + filterState.rotation + "deg)";
    if (filterState.mirrorH) transform += " scaleX(-1)";
    if (filterState.mirrorV) transform += " scaleY(-1)";
    wrapper.style.transform = transform;
}

function updateFilter(type, value) {
    filterState[type] = parseFloat(value);
    document.getElementById("val-" + type).textContent = value;
    saveToStorage(); applyFilters();
}

function applyFilters() {
    var img = document.getElementById("video-stream");
    if (!img) return;
    var b = 100 + (filterState.brightness * 10);
    var s = 100 + (filterState.saturation * 10);
    var c = 100 + (filterState.contrast * 10);
    img.style.filter = "brightness(" + b + "%) saturate(" + s + "%) contrast(" + c + "%)";
}

function rotateStream() {
    filterState.rotation = (filterState.rotation + 90) % 360;
    saveToStorage(); applyTransform();
}

// =============================================================================
// GALLERY
// =============================================================================
function loadGallery() {
    if (!espIp) { logConsole("IP non definie", "err"); return; }
    var grid = document.getElementById("gallery-grid");
    if (!grid) return;
    grid.innerHTML = "<p style='color:var(--text-muted);font-size:14px;'>Chargement...</p>";
    fetch("http://" + espIp + "/gallery", { mode: "cors", cache: "no-cache" })
        .then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function(files) {
            if (!Array.isArray(files)) { grid.innerHTML = "<p style='color:var(--text-muted);font-size:14px;'>Reponse invalide.</p>"; return; }
            if (files.length === 0) { grid.innerHTML = "<p style='color:var(--text-muted);font-size:14px;'>Aucune photo.</p>"; return; }
            var html = "";
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                var url = "http://" + espIp + "/photo?file=" + encodeURIComponent(f.name);
                html += '<div class="gallery-item"><a href="' + url + '" download="' + f.name + '">';
                html += '<img src="' + url + '" alt="' + f.name + '" loading="lazy">';
                html += '<div class="gallery-caption">' + f.name + "<br><small>" + formatBytes(f.size) + "</small></div></a></div>";
            }
            grid.innerHTML = html;
        })
        .catch(function(e) { grid.innerHTML = "<p style='color:var(--text-muted);font-size:14px;'>Erreur: " + e.message + "</p>"; logConsole("Erreur galerie: " + e.message, "err"); });
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// =============================================================================
// CONSOLE
// =============================================================================
function logConsole(msg, type) {
    var out = document.getElementById("console-output");
    if (!out) return;
    var row = document.createElement("div");
    row.className = "log-row " + (type || "");
    var time = new Date().toLocaleTimeString("fr-FR", {hour12: false});
    row.textContent = "[" + time + "] " + msg;
    out.appendChild(row);
    out.scrollTop = out.scrollHeight;
    console.log("[PTZ-" + (type || "info") + "] " + msg);
}

function clearLogs() {
    var out = document.getElementById("console-output");
    if (out) out.innerHTML = '<div class="log-row sys">[SYS] Console effacee</div>';
}

function copyLogs() {
    var out = document.getElementById("console-output");
    if (!out) return;
    var text = Array.from(out.querySelectorAll(".log-row")).map(function(r) { return r.textContent; }).join("\n");
    navigator.clipboard.writeText(text).then(function() { logConsole("Logs copies", "success"); });
}

function executeCommand(val) {
    var input = document.getElementById("console-input");
    var cmd = val.trim().toLowerCase();
    input.value = "";
    if (!cmd) return;
    switch(cmd) {
        case "clear": clearLogs(); return;
        case "home": sendCmd("HOME"); logConsole("HOME envoye", "cmd"); return;
        case "center": sendCmd("CENTER"); logConsole("CENTER envoye", "cmd"); return;
        case "left": sendCmd("H:64"); logConsole("Pan gauche", "cmd"); return;
        case "right": sendCmd("H:-64"); logConsole("Pan droite", "cmd"); return;
        case "up": sendCmd("V:64"); logConsole("Tilt haut", "cmd"); return;
        case "down": sendCmd("V:-64"); logConsole("Tilt bas", "cmd"); return;
        case "camon": toggleCamera(); return;
        case "camoff": forceCameraOff(); return;
        case "status":
            fetch("http://" + espIp + "/status", {mode: "cors"}).then(function(r) { return r.json(); }).then(function(d) {
                logConsole("IP:" + d.ip + " RSSI:" + d.rssi + "dBm Uptime:" + d.uptime + "s Cam:" + (d.camera_enabled ? "ON" : "OFF") + " Temp:" + d.temp + "C", "sys");
            }).catch(function(e) { logConsole("Erreur: " + e.message, "err"); });
            return;
        default: logConsole("Inconnu: " + cmd, "err");
    }
}

// =============================================================================
// TABS
// =============================================================================
function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
    document.querySelectorAll(".tab-content").forEach(function(c) { c.classList.remove("active"); });
    document.getElementById("nav-" + tab).classList.add("active");
    document.getElementById("tab-" + tab).classList.add("active");
    if (tab === "gallery") loadGallery();
}
