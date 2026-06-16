let currentRotation = 0;
let isSystemOn = false;
let espIp = localStorage.getItem('donamestre_ip') || '';
let logCount = 0;
let isAiReady = false;
let faceDetectionInterval = null;
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

if (espIp) document.getElementById('esp-ip').value = espIp;

function appendLog(message, type = 'sys') {
    const consoleBody = document.getElementById('console-output');
    if (!consoleBody) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
    consoleBody.appendChild(line);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    logCount++;
    document.getElementById('log-count').innerText = logCount;
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

// CONSOLE INTERACTIVE INTERPRÉTEUR DE COMMANDES
function handleConsoleInput(e) {
    if (e.key === 'Enter') {
        const inputField = document.getElementById('cmd-field');
        const rawCmd = inputField.value.trim().toLowerCase();
        if (!rawCmd) return;
        
        appendLog(`shell execute: ${rawCmd}`, 'cmd');
        inputField.value = '';

        if (rawCmd === 'help') {
            appendLog(`Commandes disponibles : left, right, home, clear, vision-noire, normal, status, quality=[num]`, 'sys');
        } else if (rawCmd === 'clear') {
            clearConsole();
        } else if (['left', 'right', 'home'].includes(rawCmd)) {
            moveH(rawCmd);
        } else if (['normal', 'vision-noire', 'retro', 'high-contrast'].includes(rawCmd)) {
            setPreset(rawCmd);
        } else if (rawCmd.startsWith('quality=')) {
            let val = rawCmd.split('=')[1];
            sendRawControl('quality', val);
        } else if (rawCmd === 'status') {
            appendLog(`Status : Connecté=${isSystemOn}, IP=${espIp}, Module IA Ready=${isAiReady}`, 'sys');
        } else {
            // Tentative d'envoi brute au matériel
            appendLog(`Commande inconnue au niveau du shell local. Envoi direct à l'adresse IP...`, 'sys');
            fetch(`http://${espIp}/control?cmd=${rawCmd}`, { mode: 'cors' })
                .then(r => r.text()).then(txt => appendLog(`Réponse matérielle: ${txt}`, 'success'))
                .catch(() => appendLog(`Erreur de transmission réseau`, 'err'));
        }
    }
}

// LIAISON ET CHARGEMENT DE L'IA EN LOCAL SÉCURISÉ
window.addEventListener('DOMContentLoaded', async () => {
    appendLog("Chargement des réseaux de neurones locaux (TinyFaceDetector)...", "sys");
    try {
        // Chargement des poids IA depuis un CDN vers la mémoire du navigateur
        await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
        isAiReady = true;
        const badge = document.getElementById('ai-status');
        badge.innerText = "IA LOCALE PRÊTE";
        badge.className = "ai-badge ready";
        appendLog("Modèles IA compilés avec succès dans le navigateur (0% Cloud).", "success");
    } catch (err) {
        appendLog("Erreur de chargement de l'IA locale. Mode détection indisponible.", "err");
    }
});

function connectSystem() {
    const input = document.getElementById('esp-ip').value.trim();
    if (!input) return alert("Veuillez entrer l'IP.");
    espIp = input.replace(/^http?:\/\//, '');
    localStorage.setItem('donamestre_ip', espIp);
    
    appendLog(`Liaison réseau vers http://${espIp}...`, 'sys');
    fetch(`http://${espIp}/control?cmd=ping`, { mode: 'cors' })
        .then(res => res.text())
        .then(data => {
            if(data.includes("PONG")) {
                appendLog(`Liaison établie. Puce matérielle synchronisée.`, 'success');
                if(!isSystemOn) toggleSystem();
            }
        })
        .catch(() => appendLog(`Hôte introuvable. Vérifiez l'alimentation ou le Wi-Fi local.`, 'err'));
}

function toggleSystem() {
    if (!espIp) return;
    const powerGlyph = document.getElementById('power-main');
    const streamImg = document.getElementById('video-stream');
    isSystemOn = !isSystemOn;
    
    if (isSystemOn) {
        powerGlyph.classList.add('active');
        streamImg.src = `http://${espIp}/stream`;
        appendLog(`Flux vidéo actif. décodage JPEG démarré.`, 'success');
    } else {
        powerGlyph.classList.remove('active');
        streamImg.src = '';
        if(faceDetectionInterval) clearInterval(faceDetectionInterval);
        document.getElementById('toggle-face').checked = false;
        removeAiCanvas();
        appendLog(`Système hors tension. Dispositif sécurisé.`, 'err');
    }
}

// MACHINE LEARNING : DÉTECTION ET ENCADREMENT FACIAL EN TEMPS RÉEL (100% LOCAL)
function toggleFaceDetection() {
    const active = document.getElementById('toggle-face').checked;
    if(!isSystemOn) {
        document.getElementById('toggle-face').checked = false;
        return alert("Activez d'abord le système général.");
    }
    if (!isAiReady) return alert("L'IA n'a pas fini de s'initialiser.");

    if (active) {
        appendLog("Moteur IA démarré : Analyse matricielle active.", "success");
        const img = document.getElementById('video-stream');
        
        // Création ou récupération du canvas de dessin
        let canvas = document.getElementById('ai-overlay');
        if(!canvas) {
            canvas = faceapi.createCanvasFromMedia(img);
            canvas.id = 'ai-overlay';
            document.getElementById('canvas-wrapper').appendChild(canvas);
        }

        faceDetectionInterval = setInterval(async () => {
            if(!isSystemOn) return;
            const displaySize = { width: img.clientWidth, height: img.clientHeight };
            faceapi.matchDimensions(canvas, displaySize);

            // Détection purement exécutée par le processeur/carte graphique de votre PC
            const detections = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 }));
            const resizedDetections = faceapi.resizeResults(detections, displaySize);
            
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            
            // Dessiner les cadres néons autour des visages
            resizedDetections.forEach(detection => {
                const box = detection.box;
                const drawBox = new faceapi.draw.DrawBox(box, { label: 'CIBLE', boxColor: '#00f2fe', lineWidth: 2 });
                drawBox.draw(canvas);
            });
        }, 100); // Analyse toutes les 100ms
    } else {
        if(faceDetectionInterval) clearInterval(faceDetectionInterval);
        removeAiCanvas();
        appendLog("Moteur IA suspendu.", "sys");
    }
}

function removeAiCanvas() {
    const canvas = document.getElementById('ai-overlay');
    if(canvas) canvas.remove();
}

// ENREGISTREMENT FLUX VIDÉO EN LOCAL SANS COMPRESSION SERVEUR
function toggleRecording() {
    const btn = document.getElementById('rec-btn');
    const img = document.getElementById('video-stream');
    
    if (!isSystemOn || !img.naturalWidth) return alert("Aucun flux actif à filmer.");
    
    if (isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        btn.innerText = "🔴 Enregistrer Flux";
        btn.style.background = "#991b1b";
    } else {
        recordedChunks = [];
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = img.naturalWidth;
        captureCanvas.height = img.naturalHeight;
        const ctx = captureCanvas.getContext('2d');
        
        const stream = captureCanvas.captureStream(20); // 20 FPS
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `DONAMESTRE_RECORD_${Date.now()}.webm`;
            a.click();
            appendLog("Fichier vidéo enregistré localement.", "success");
        };

        mediaRecorder.start();
        isRecording = true;
        btn.innerText = "⏹️ Arrêter Enr.";
        btn.style.background = "#475569";
        
        function drawFrame() {
            if (!isRecording) return;
            ctx.filter = img.style.filter;
            ctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
            ctx.drawImage(img, 0, 0, captureCanvas.width, captureCanvas.height);
            requestAnimationFrame(drawFrame);
        }
        drawFrame();
        appendLog("Capture et enregistrement vidéo en cours...", "cmd");
    }
}

// FILTRES & ROTATION
function applyFilters() {
    const bright = document.getElementById('slider-bright').value;
    const saturate = document.getElementById('slider-saturate').value;
    const contrast = document.getElementById('slider-contrast').value;
    document.getElementById('val-bright').innerText = `${bright}%`;
    document.getElementById('val-saturate').innerText = `${saturate}%`;
    document.getElementById('val-contrast').innerText = `${contrast}%`;
    document.getElementById('video-stream').style.filter = `brightness(${bright}%) saturate(${saturate}%) contrast(${contrast}%)`;
}

function setPreset(p) {
    const b = document.getElementById('slider-bright');
    const s = document.getElementById('slider-saturate');
    const c = document.getElementById('slider-contrast');
    const img = document.getElementById('video-stream');
    if (p === 'normal') { b.value=100; s.value=100; c.value=100; img.style.filter=''; }
    else if (p === 'vision-noire') { b.value=160; s.value=20; c.value=150; img.style.filter='brightness(160%) saturate(20%) contrast(150%) hue-rotate(100deg) sepia(100%) saturate(300%)'; }
    else if (p === 'retro') { b.value=100; s.value=30; c.value=110; img.style.filter='contrast(110%) saturate(30%) sepia(40%)'; }
    else if (p === 'high-contrast') { b.value=90; s.value=160; c.value=180; img.style.filter='brightness(90%) contrast(180%) saturate(160%)'; }
    applyFilters();
    appendLog(`Filtre matériel configuré : ${p.toUpperCase()}`);
}

function rotateVideo() {
    currentRotation = (currentRotation + 90) % 360;
    document.querySelector('.canvas-container').style.transform = `rotate(${currentRotation}deg)`;
}

function takeSnapshot() {
    const img = document.getElementById('video-stream');
    if(!isSystemOn || !img.naturalWidth) return;
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d');
    ctx.filter = img.style.filter;
    ctx.drawImage(img, 0, 0);
    const l = document.createElement('a');
    l.download = `DONAMESTRE_${Date.now()}.jpg`;
    l.href = cv.toDataURL('image/jpeg', 0.95);
    l.click();
}

function moveH(direction) {
    if (!isSystemOn || !espIp) return;
    appendLog(`Signal PTZ -> Axe Horizontal : [${direction.toUpperCase()}]`, 'cmd');
    fetch(`http://${espIp}/ptz?dir=${direction}`, { mode: 'cors' })
        .catch(() => appendLog("Échec transmission PTZ", "err"));
}

function sendRawControl(cmd, val) {
    fetch(`http://${espIp}/control?cmd=${cmd}&val=${val}`, { mode: 'cors' })
        .then(() => appendLog(`Ajustement validé : ${cmd}=${val}`, 'success'));
}
