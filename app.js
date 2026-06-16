let baseIp = localStorage.getItem('esp_ip') || '';
const feed = document.getElementById('livestream');
const canvas = document.getElementById('hidden-canvas');
const ctx = canvas.getContext('2d');
const statusBadge = document.getElementById('status');
const powerBtn = document.getElementById('power-trigger');
let isSystemOn = false;
let recorder;
let pieces = [];
let activeRec = false;

if (baseIp) {
    document.getElementById('esp-ip').value = baseIp;
}

function saveIP() {
    const inputIp = document.getElementById('esp-ip').value.trim().replace(/^http?:\/\//, '');
    if (inputIp) {
        baseIp = inputIp;
        localStorage.setItem('esp_ip', baseIp);
        if(isSystemOn) initConnection();
    }
}

function toggleSystemPower() {
    if (!baseIp) return alert("Veuillez d'abord configurer l'adresse IP de l'ESP32.");
    isSystemOn = !isSystemOn;
    
    if (isSystemOn) {
        powerBtn.classList.add('online');
        initConnection();
    } else {
        powerBtn.classList.remove('online');
        statusBadge.innerText = "● SYSTEM OFF";
        statusBadge.className = "status-badge disconnected";
        feed.src = "";
    }
}

function initConnection() {
    if(!isSystemOn) return;
    statusBadge.innerText = "● RECH. SIGNAL...";
    statusBadge.className = "status-badge disconnected";
    
    fetch(`http://${baseIp}/control?cmd=ping`, { mode: 'cors' })
        .then(() => {
            statusBadge.innerText = "● DYN_LIVE ACTIVE";
            statusBadge.className = "status-badge connected";
            feed.src = `http://${baseIp}/stream`;
        })
        .catch(err => {
            console.error("Liaison interrompue:", err);
            statusBadge.innerText = "● LIEN ROMPU";
            statusBadge.className = "status-badge disconnected";
            feed.src = "";
        });
}

function sendPTZ(axis) {
    if (!baseIp || !isSystemOn) return;
    fetch(`http://${baseIp}/ptz?dir=${axis}`, { mode: 'cors' }).catch(e => console.error(e));
}

function pushConfig(param, value) {
    if (!baseIp || !isSystemOn) return;
    fetch(`http://${baseIp}/control?cmd=${param}&val=${value}`, { mode: 'cors' })
        .then(() => {
            if(param === 'sharpness') {
                document.getElementById('val-sharpness').innerText = {"-2":"Flou", "-1":"Lissé", "0":"Normal", "1":"Précis", "2":"Très Net"}[value];
            } else if(param === 'quality') {
                document.getElementById('val-quality').innerText = value <= 8 ? "Ultra-HD" : (value >= 20 ? "Fluide" : "Optimale");
            }
        });
}

function capturePhoto() {
    if (!feed.naturalWidth || !isSystemOn) return;
    canvas.width = feed.naturalWidth;
    canvas.height = feed.naturalHeight;
    ctx.drawImage(feed, 0, 0, canvas.width, canvas.height);
    const link = document.createElement('a');
    link.download = `DONAMESTRE_${Date.now()}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.98);
    link.click();
}

function toggleRecording() {
    const btn = document.getElementById('rec-btn');
    const badge = document.getElementById('rec-badge');
    if (!isSystemOn) return;
    
    if (activeRec) {
        recorder.stop();
        activeRec = false;
        badge.style.display = 'none';
        btn.innerText = "🔴 Enregistrer Flux";
        btn.style.background = "#dc2626";
    } else {
        if (!feed.naturalWidth) return;
        pieces = [];
        canvas.width = feed.naturalWidth;
        canvas.height = feed.naturalHeight;
        const stream = canvas.captureStream(24);
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        recorder.ondataavailable = e => { if (e.data.size > 0) pieces.push(e.data); };
        recorder.onstop = () => {
            const blob = new Blob(pieces, { type: 'video/webm' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `DONAMESTRE_CAP_${Date.now()}.webm`;
            a.click();
        };
        recorder.start();
        activeRec = true;
        badge.style.display = 'block';
        btn.innerText = "⏹️ Arrêter Enr.";
        btn.style.background = "#4b5563";
        function stepDraw() {
            if(activeRec) { ctx.drawImage(feed, 0, 0, canvas.width, canvas.height); requestAnimationFrame(stepDraw); }
        }
        stepDraw();
    }
}
