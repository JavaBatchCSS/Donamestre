let currentRotation = 0;
let isSystemOn = false;
let espIp = localStorage.getItem('donamestre_ip') || '';
let logCount = 0;

// Chargement initial de l'IP sauvegardée
if (espIp) {
    document.getElementById('esp-ip').value = espIp;
}

// LOG LOGIC: Alimente l'onglet Console en direct
function appendLog(message, type = 'sys') {
    const consoleBody = document.getElementById('console-output');
    const line = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    
    line.className = `log-line ${type}`;
    line.innerText = `[${timestamp}] ${message}`;
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

// NAVIGATION ENTRE ONGLETS
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tabId}`).classList.add('active');
    event.currentTarget.classList.add('active');
    appendLog(`Navigation : Affichage de l'onglet [${tabId.toUpperCase()}]`, 'sys');
}

// LIAISON ET CONNEXION
function connectSystem() {
    const input = document.getElementById('esp-ip').value.trim();
    if (!input) return alert("Veuillez saisir une adresse IP.");
    
    espIp = input.replace(/^http?:\/\//, '');
    localStorage.setItem('donamestre_ip', espIp);
    appendLog(`Tentative de liaison réseau locale vers http://${espIp}...`, 'sys');
    
    // Test de connexion ping
    fetch(`http://${espIp}/control?cmd=ping`, { mode: 'cors' })
        .then(res => res.text())
        .then(data => {
            if(data.includes("PONG")) {
                appendLog(`Liaison établie avec succès. Réponse matérielle reçue.`, 'success');
                if(!isSystemOn) toggleSystem();
            }
        })
        .catch(err => {
            appendLog(`Échec de la liaison : L'ESP32 est introuvable ou occupé. Vérifiez votre réseau Wi-Fi local.`, 'err');
        });
}

function toggleSystem() {
    if (!espIp) return alert("Veuillez d'abord lier votre matériel via son adresse IP.");
    
    const powerGlyph = document.getElementById('power-main');
    const streamImg = document.getElementById('video-stream');
    isSystemOn = !isSystemOn;
    
    if (isSystemOn) {
        powerGlyph.classList.add('active');
        streamImg.src = `http://${espIp}/stream`;
        appendLog(`Système GLOBAL mis SOUS TENSION. Flux vidéo redirigé vers l'hôte local.`, 'success');
    } else {
        powerGlyph.classList.remove('active');
        streamImg.src = '';
        appendLog(`Système mis HORS TENSION. Coupure instantanée du flux pour confidentialité absolue.`, 'err');
    }
}

// SÉCURITÉ ET PROTECTION COMPLÈTE DE LA VIE PRIVÉE :
// Tout se passe dans la mémoire de la carte graphique de votre ordinateur via CSS.
function applyFilters() {
    const bright = document.getElementById('slider-bright').value;
    const saturate = document.getElementById('slider-saturate').value;
    const contrast = document.getElementById('slider-contrast').value;
    
    document.getElementById('val-bright').innerText = `${bright}%`;
    document.getElementById('val-saturate').innerText = `${saturate}%`;
    document.getElementById('val-contrast').innerText = `${contrast}%`;
    
    const streamImg = document.getElementById('video-stream');
    // Application directe du filtre CSS sur l'élément vidéo
    streamImg.style.filter = `brightness(${bright}%) saturate(${saturate}%) contrast(${contrast}%)`;
}

// PRÉRÉGLAGES DE VISION NUMÉRIQUE QUICK-SET
function setPreset(preset) {
    appendLog(`Filtre graphique appliqué : [${preset.toUpperCase()}]`, 'cmd');
    const sBright = document.getElementById('slider-bright');
    const sSat = document.getElementById('slider-saturate');
    const sContrast = document.getElementById('slider-contrast');
    const streamImg = document.getElementById('video-stream');
    
    if (preset === 'normal') {
        sBright.value = 100; sSat.value = 100; sContrast.value = 100;
        streamImg.style.filter = '';
    } else if (preset === 'vision-noire') {
        sBright.value = 160; sSat.value = 0; sContrast.value = 140;
        // Effet intensification de lumière + filtre vert phosphore
        streamImg.style.filter = 'brightness(160%) saturate(0%) contrast(140%) hue-rotate(90deg) sepia(100%) saturate(400%)';
    } else if (preset === 'retro') {
        sBright.value = 100; sSat.value = 40; sContrast.value = 110;
        streamImg.style.filter = 'contrast(120%) saturate(30%) sepia(50%)';
    } else if (preset === 'high-contrast') {
        sBright.value = 90; sSat.value = 180; sContrast.value = 170;
        streamImg.style.filter = 'brightness(90%) contrast(170%) saturate(180%)';
    }
    applyFilters();
}

// ROTATION PHYSIQUE APPLIQUÉE SUR LE CONTENEUR GRAPHIQUE (POST-RENDER)
function rotateVideo() {
    currentRotation = (currentRotation + 90) % 360;
    const container = document.querySelector('.canvas-container');
    container.style.transform = `rotate(${currentRotation}deg)`;
    appendLog(`Matrice vidéo : Rotation logicielle de +90° (Total : ${currentRotation}°)`, 'cmd');
}

// CAPTURE DE FRAME SÉCURISÉE (Directement via le rendu GPU du navigateur)
function takeSnapshot() {
    const img = document.getElementById('video-stream');
    if (!img.naturalWidth || !isSystemOn) return appendLog("Impossible de capturer : Aucun flux vidéo actif.", "err");
    
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    
    // Application des transformations physiques et filtres sur le fichier de sauvegarde final
    ctx.filter = img.style.filter;
    ctx.translate(canvas.width/2, canvas.height/2);
    ctx.rotate((currentRotation * Math.PI) / 180);
    ctx.drawImage(img, -canvas.width/2, -canvas.height/2, canvas.width, canvas.height);
    
    const link = document.createElement('a');
    link.download = `DONAMESTRE_CAPTURE_${Date.now()}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    appendLog(`Fichier image généré localement et téléchargé sur l'hôte avec succès.`, 'success');
}

// PILOTAGE DES MOTEURS (VERS L'ESP32)
function moveH(direction) {
    if (!isSystemOn || !espIp) return;
    appendLog(`Commande moteur émise : Axe-H [${direction.toUpperCase()}]`, 'cmd');
    fetch(`http://${espIp}/ptz?dir=${direction}`, { mode: 'cors' })
        .catch(e => appendLog(`Erreur de transmission réseau de la commande PTZ.`, 'err'));
}
