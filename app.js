// ==========================================
// S3-PRO PTZ — Interface Web (2 axes Pan/Tilt)
// Version complète et mise à jour
// ==========================================

var espIp = window.location.hostname;
if (!espIp || espIp === "localhost" || espIp.includes("github.io")) {
    espIp = localStorage.getItem('ptz_ip') || '';
}

var isConnected = false;
var logCount = 0;
const STEP_SIZE = 32;

// ==========================================
// GÉNÉRATION INTERFACE
// ==========================================
window.addEventListener('DOMContentLoaded', function() {
    const root = document.getElementById('app-root');
    if (!root) return;

    root.innerHTML = `
    <div class="ptz-app">
        <header class="ptz-header">
            <h1>S3-PRO <span style="color:#6366f1">PTZ</span></h1>
            <div class="connexion-bar">
                <input type="text" id="esp-ip" class="ptz-input" placeholder="IP ESP32" value="${espIp}">
                <button onclick="connect()" class="ptz-btn btn-primary">Connecter</button>
                <span id="conn-status" class="status-dot offline">●</span>
            </div>
        </header>

        <div class="ptz-main">
            <!-- VIDEO -->
            <div class="ptz-video-panel">
                <div class="video-box">
                    <img id="stream-img" src="" alt="Flux video" style="display:none">
                    <div id="stream-placeholder" class="stream-placeholder">Entrez l'IP et cliquez Connecter</div>
                </div>
                <div class="video-actions">
                    <button onclick="rotateStream()" class="ptz-btn">↻ Rotation</button>
                    <button onclick="captureFrame()" class="ptz-btn">📷 Capture</button>
                </div>
            </div>

            <!-- CONTROLES -->
            <div class="ptz-controls-panel">
                
                <!-- PAN / TILT -->
                <div class="ptz-card">
                    <h3>🎮 Contrôle Pan / Tilt</h3>
                    <div class="ptz-pad">
                        <div class="ptz-row">
                            <div></div>
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="startMove('V', -${STEP_SIZE})" 
                                onmouseup="stopMove()" 
                                onmouseleave="stopMove()"
                                ontouchstart="startMove('V', -${STEP_SIZE})" 
                                ontouchend="stopMove()">▲</button>
                            <div></div>
                        </div>
                        <div class="ptz-row">
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="startMove('H', -${STEP_SIZE})" 
                                onmouseup="stopMove()" 
                                onmouseleave="stopMove()"
                                ontouchstart="startMove('H', -${STEP_SIZE})" 
                                ontouchend="stopMove()">◀ Gauche</button>
                            <button class="ptz-btn ptz-home" onclick="sendCmd('HOME')">⌂ HOME</button>
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="startMove('H', ${STEP_SIZE})" 
                                onmouseup="stopMove()" 
                                onmouseleave="stopMove()"
                                ontouchstart="startMove('H', ${STEP_SIZE})" 
                                ontouchend="stopMove()">Droite ▶</button>
                        </div>
                        <div class="ptz-row">
                            <div></div>
                            <button class="ptz-btn ptz-arrow" 
                                onmousedown="startMove('V', ${STEP_SIZE})" 
                                onmouseup="stopMove()" 
                                onmouseleave="stopMove()"
                                ontouchstart="startMove('V', ${STEP_SIZE})" 
                                ontouchend="stopMove()">▼</button>
                            <div></div>
                        </div>
                    </div>
                </div>

                <!-- IMAGE -->
                <div class="ptz-card">
                    <h3>🎨 Image</h3>
                    <label>Luminosité <input type="range" id="brightness" min="0" max="200" value="100" oninput="updateFilter()"><span id="val-bri">100%</span></label>
                    <label>Contraste <input type="range" id="contrast" min="0" max="200" value="100" oninput="updateFilter()"><span id="val-con">100%</span></label>
                    <label>Saturation <input type="range" id="saturation" min="0" max="200" value="100" oninput="updateFilter()"><span id="val-sat">100%</span></label>
                    <div class="mode-btns">
                        <button onclick="setMode('normal')" class="mode-btn active">Normal</button>
                        <button onclick="setMode('night')" class="mode-btn">Nuit</button>
                        <button onclick="setMode('yuv')" class="mode-btn">YUV</button>
                    </div>
                </div>

                <!-- CONSOLE -->
                <div class="ptz-card console-card">
                    <h3>📟 Console <button onclick="clearLog()" class="ptz-btn btn-small">Effacer</button></h3>
                    <div id="console-output" class="console-box"></div>
                    <div class="console-input-bar">
                        <span class="prompt">&gt;</span>
                        <input type="text" id="console-in" placeholder="Commande..." onkeydown="if(event.key==='Enter')execCommand(this.value)">
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    if (espIp) connect();
});

// ==========================================
// CONNEXION
// ==========================================
function connect() {
    const ipInput = document.getElementById('esp-ip');
    espIp = ipInput.value.trim();
    if (!espIp) { log("Entrez une IP", "err"); return; }
    localStorage.setItem('ptz_ip', espIp);

    const img = document.getElementById('stream-img');
    const placeholder = document.getElementById('stream-placeholder');
    img.src = `http://${espIp}/stream`;
    img.style.display = 'block';
    placeholder.style.display = 'none';

    fetch(`http://${espIp}/status`, {mode: 'cors'})
        .then(r => r.json())
        .then(d => {
            isConnected = true;
            updateStatus(true);
            log(`Connecte a ${espIp} | RSSI: ${d.rssi}dBm`, "success");
        })
        .catch(e => {
            updateStatus(false);
            log("Connexion impossible", "err");
        });
}

function updateStatus(ok) {
    const dot = document.getElementById('conn-status');
    dot.className = ok ? 'status-dot online' : 'status-dot offline';
}

// ==========================================
// COMMANDES PTZ
// ==========================================
var moveInterval = null;

function startMove(axis, steps) {
    if (!isConnected) { log("Non connecte", "err"); return; }
    sendCmd(axis + ":" + steps);
    moveInterval = setInterval(() => sendCmd(axis + ":" + steps), 400);
}

function stopMove() {
    if (moveInterval) {
        clearInterval(moveInterval);
        moveInterval = null;
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
    .then(r => {
        if (r.ok) log("> " + cmd, "cmd");
        else log("Erreur: " + cmd, "err");
    })
    .catch(e => log("Reseau: " + e, "err"));
}

// ==========================================
// IMAGE & FILTRES
// ==========================================
var currentRotation = 0;
var currentMode = 'normal';

function rotateStream() {
    currentRotation = (currentRotation + 90) % 360;
    document.getElementById('stream-img').style.transform = `rotate(${currentRotation}deg)`;
}

function captureFrame() {
    const img = document.getElementById('stream-img');
    if (!img.src || img.style.display === 'none') return;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 640;
    canvas.height = img.naturalHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const a = document.createElement('a');
    a.download = 'capture_' + Date.now() + '.jpg';
    a.href = canvas.toDataURL('image/jpeg', 0.9);
    a.click();
    log("Capture effectuee", "success");
}

function updateFilter() {
    const b = document.getElementById('brightness').value;
    const c = document.getElementById('contrast').value;
    const s = document.getElementById('saturation').value;
    document.getElementById('val-bri').textContent = b + '%';
    document.getElementById('val-con').textContent = c + '%';
    document.getElementById('val-sat').textContent = s + '%';
    
    const img = document.getElementById('stream-img');
    let filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
    if (currentMode === 'night') filter += ' invert(1) hue-rotate(180deg)';
    if (currentMode === 'yuv') filter += ' grayscale(100%) contrast(150%)';
    img.style.filter = filter;
}

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    updateFilter();
}

// ==========================================
// CONSOLE
// ==========================================
function log(msg, type) {
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

function clearLog() {
    const out = document.getElementById('console-output');
    if (out) out.innerHTML = '';
    logCount = 0;
}

function execCommand(val) {
    const input = document.getElementById('console-in');
    const cmd = val.trim().toLowerCase();
    if (!cmd) return;
    
    if (cmd === 'clear') { clearLog(); input.value = ''; return; }
    if (cmd === 'home') { sendCmd('HOME'); input.value = ''; return; }
    if (cmd === 'left') { sendCmd('H:-32'); input.value = ''; return; }
    if (cmd === 'right') { sendCmd('H:32'); input.value = ''; return; }
    if (cmd === 'up') { sendCmd('V:-32'); input.value = ''; return; }
    if (cmd === 'down') { sendCmd('V:32'); input.value = ''; return; }
    if (cmd === 'status') {
        fetch(`http://${espIp}/status`).then(r=>r.json()).then(d=>log(JSON.stringify(d), "sys"));
        input.value = ''; return;
    }
    
    log("Inconnu: " + cmd, "err");
    input.value = '';
}
