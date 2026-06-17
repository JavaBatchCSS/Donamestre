let currentRotation = parseInt(localStorage.getItem('donamestre_rotation')) || 0;
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

// ALGORITHME DE REPIXELISATION (Filtre Kernel Sharpening)
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

// INITIALISATION AUTOMATIQUE AU CHARGEMENT (Mise à jour demandée)
window.addEventListener('DOMContentLoaded', async () => {
    if (espIp) {
        document.getElementById('esp-ip').value = espIp;
        // Connexion automatique immédiate
        connectSystem();
    }
    
    // Restauration des configurations sauvegardées dans le LocalStorage
    restoreSavedConfig();
    buildSidebarCommands();
    initAiEngine();
    
    // Boucle de traitement pour la repixelisation (si activée)
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
    
    document.getElementById('canvas-wrapper').style.transform = `rotate(${currentRotation}deg)`;
    applyFilters();
}

function saveConfigToLocalStorage() {
    localStorage.setItem('donamestre_bright', document.getElementById('slider-bright').value);
    localStorage.setItem('donamestre_saturate', document.getElementById('slider-saturate').value);
    localStorage.setItem('donamestre_contrast', document.getElementById('slider-contrast').value);
    localStorage.setItem('donamestre_rotation', currentRotation);
    localStorage.setItem('donamestre_upscale', useUpscaling);
}

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
// CORRECTION SYNTAXE : Remplacement du void function par une déclaration standard
function buildSidebarCommands() {
    const container = document.getElementById('commands-container');
    if (!container) return; // Sécurité si l'élément n'existe pas dans le DOM
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
    else if (syntax === 'upscale=on') { useUpscaling = true; saveConfigToLocalStorage(); appendLog("Repixelisation logicielle activée.", "success"); }
    else if (syntax === 'upscale=off') { useUpscaling = false; saveConfigToLocalStorage(); appendLog("Repixelisation désactivée.", "sys"); }
    else if (syntax === 'status') appendLog(`Liaison=${isSystemOn} // IA=${isAiReady} // Upscale=${useUpscaling}`, 'sys');
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

function connectSystem() {
    const input = document.getElementById('esp-ip').value.trim();
    if (!input) return;
    
    espIp = input.replace(/^https?:\/\//, '').replace(/\/$/, '');
    localStorage.setItem('donamestre_ip', espIp);
    appendLog(`Liaison automatique : Vérification de l'hôte distant sur http://${espIp}...`, 'sys');
    
    fetch(`http://${espIp}/control?cmd=ping`, { mode: 'cors' })
        .then(r => r.text())
        .then(res => {
            if (res.includes("PONG")) {
                appendLog("Poignée de main matérielle réussie. Liaison OK.", "success");
                if(!isSystemOn) toggleSystem(); // Déclenche le flux de manière transparente
            }
        })
        .catch(() => appendLog("L'appareil n'est pas encore synchronisé (En attente du flux).", "err"));
}

function toggleSystem() {
    if (!espIp) return;
    const glyph = document.getElementById('power-main');
    const img = document.getElementById('video-stream');
    isSystemOn = !isSystemOn;
    
    if (isSystemOn) {
        if(glyph) glyph.classList.add('active');
        
        // CORRECTIONS CRITIQUES ANTI-TAINTED CANVAS (CORS)
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
        document.getElementById('toggle-face').checked = false;
        const c = document.getElementById('ai-overlay'); if (c) c.remove();
        appendLog("Flux coupé.", "sys");
    }
}
// LOGICIEL DE REPIXELISATION PAR CONVOLUTION (Filtre de convolution 3x3)
function startProcessingLoop() {
    const img = document.getElementById('video-stream');
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
                img.style.display = "none"; // On cache le flux brut
                if(!document.getElementById('processed-canvas')) {
                    img.parentNode.insertBefore(procCanvas, img);
                }
            }
            
            procCtx.drawImage(img, 0, 0);
            const weights = [  0, -1,  0, 
                              -1,  5, -1, 
                               0, -1,  0 ]; // Noyau d'accentuation de netteté (Sharpen matrix)
            
            let src = procCtx.getImageData(0, 0, procCanvas.width, procCanvas.height);
            let dst = procCtx.createImageData(src.width, src.height);
            
            // Algorithme d'accentuation de texture
            for (let y = 1; y < src.height - 1; y++) {
                for (let x = 1; x < src.width - 1; x++) {
                    for (let c = 0; c < 3; c++) { // Canaux R, G, B
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
                    dst.data[(y * src.width + x) * 4 + 3] = 255; // Alpha
                }
            }
            procCtx.putImageData(dst, 0, 0);
        } else {
            // Si désactivé, on s'assure de réafficher l'image brute
            const pc = document.getElementById('processed-canvas');
            if(pc) pc.remove();
            img.style.display = "block";
        }
        requestAnimationFrame(processFrame);
    }
    requestAnimationFrame(processFrame);
}

// RECONNAISSANCE FACIALE ET COMPATIBILITÉ CANVAS LAYER
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
                
                // IA PTZ: Asservissement automatique des moteurs selon la position du visage
                const faceCenterX = d.box.x + (d.box.width / 2);
                const frameCenterX = size.width / 2;
                if (faceCenterX < frameCenterX - 40) moveH('left');
                else if (faceCenterX > frameCenterX + 40) moveH('right');
            });
        }, 150);
    } else {
        if (faceDetectionInterval) clearInterval(faceDetectionInterval);
        const c = document.getElementById('ai-overlay'); if (c) c.remove();
    }
}

// ENREGISTREMENT ET CAPTURES DE FLUX
function toggleRecording() {
    const btn = document.getElementById('rec-btn');
    const img = document.getElementById('video-stream');
    if (!isSystemOn || !img.naturalWidth) return alert("Aucun flux actif.");
    
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
            a.href = url; a.download = `DONAMESTRE_CAPTURE_${Date.now()}.webm`;
            a.click();
        };

        mediaRecorder.start();
        isRecording = true;
        btn.innerText = "⏹️ Arrêter";
        
        function drawFrame() {
            if (!isRecording) return;
            ctx.filter = img.style.filter;
            ctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
            // On enregistre la version traitée par convolution si elle est présente
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
    
    const filterString = `brightness(${b}%) saturate(${s}%) contrast(${c}%)`;
    document.getElementById('video-stream').style.filter = filterString;
    
    saveConfigToLocalStorage();
}

function setPreset(p) {
    const b = document.getElementById('slider-bright');
    const s = document.getElementById('slider-saturate');
    const c = document.getElementById('slider-contrast');
    const img = document.getElementById('video-stream');
    if(p==='normal'){ b.value=100; s.value=100; c.value=100; img.style.filter=''; }
    else if(p==='vision-noire'){ b.value=150; s.value=10; c.value=140; img.style.filter='brightness(150%) saturate(10%) contrast(140%) hue-rotate(90deg) sepia(100%) saturate(300%)'; }
    else if(p==='high-contrast'){ b.value=95; s.value=140; c.value=160; img.style.filter='brightness(95%) contrast(160%) saturate(140%)'; }
    applyFilters();
}

function rotateVideo() { 
    currentRotation = (currentRotation + 90) % 360; 
    document.getElementById('canvas-wrapper').style.transform = `rotate(${currentRotation}deg)`; 
    saveConfigToLocalStorage();
}

function takeSnapshot() { 
    const img = document.getElementById('video-stream'); 
    if(!isSystemOn||!img.naturalWidth) return; 
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
