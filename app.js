/* ============================================================
   RF GATEWAY — app.js  v1.0.0
   100% du comportement UI est ici.
   Pour modifier l'interface : éditer ce fichier sur GitHub,
   jamais besoin de reflasher la carte.

   Architecture :
     Config      — IP/port/token, persistés en localStorage
     WS          — WebSocket temps-réel vers ESP32
     API         — fetch() REST vers ESP32
     Tuner       — canvas "poste radio vintage"
     RSSI        — canvas bargraph + historique
     Frames      — liste trames reçues temps-réel
     Remotes     — table + domotique cards
     Console     — log coloré filtrable
     Settings    — UI + connexion + système
     Toast       — notifications
   ============================================================ */

'use strict';

// ═══════════════════════════════════════════════════════════════
//  CONFIG — modifie l'IP ici ou depuis l'onglet Réglages
// ═══════════════════════════════════════════════════════════════
const DEFAULT_IP    = '192.168.1.20';
const DEFAULT_PORT  = 80;
const DEFAULT_TOKEN = '';

// Fréquences limites de la bande radio affichée sur le tuner vintage
const TUNER_MIN_MHZ = 430.0;
const TUNER_MAX_MHZ = 436.0;

// Protocoles prédéfinis — modifiable ici sans toucher au firmware
const PRESETS = {
  0: { name: 'Somfy RTS',   freq: 433.42, bw: 99.97,  dev: 47.60, mod: 1, color: '#3ecfff' },
  1: { name: 'Moovo',       freq: 433.92, bw: 650.0,  dev: 0,     mod: 2, color: '#2de08a' },
  2: { name: 'Nice Flor-S', freq: 433.92, bw: 650.0,  dev: 0,     mod: 2, color: '#f0a830',
       note: 'Implémentation non validée terrain — tester en RX avant TX' },
  3: { name: 'Custom',      freq: 433.92, bw: 270.0,  dev: 47.6,  mod: 2, color: '#9a7aff' },
};

// ═══════════════════════════════════════════════════════════════
//  ÉTAT GLOBAL
// ═══════════════════════════════════════════════════════════════
let cfg = {
  ip:    localStorage.getItem('gw_ip')    || DEFAULT_IP,
  port:  parseInt(localStorage.getItem('gw_port')   || DEFAULT_PORT),
  token: localStorage.getItem('gw_token') || DEFAULT_TOKEN,
  theme: localStorage.getItem('gw_theme') || 'dark',
  sounds: localStorage.getItem('gw_sounds') === 'true',
  notif:  localStorage.getItem('gw_notif')  !== 'false',
};

let ws           = null;
let wsReconnTimer= null;
let remotes      = [];       // tableau RemoteEntry du firmware
let status       = {};       // dernier objet status reçu
let rssiHistory  = [];       // 60 dernières valeurs RSSI
let frames       = [];       // trames reçues pour affichage
let consoleLogs  = [];       // tous les messages console
let learningActive = false;
let learnCountdownTimer = null;
let activeProto  = 0;
let tunerNeedleX = 0.5;      // position normalisée (0..1) de l'aiguille

// AudioContext pour bips de confirmation (optionnel)
let audioCtx = null;

// ═══════════════════════════════════════════════════════════════
//  UTILITAIRES
// ═══════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const fmtTs = ms => {
  const d = new Date(ms || Date.now());
  return d.toTimeString().slice(0,8);
};
const fmtUptime = s => {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return `${h}h ${m}m ${sec}s`;
};
const clamp = (v,min,max) => Math.max(min, Math.min(max, v));

function saveConfig() {
  localStorage.setItem('gw_ip',     cfg.ip);
  localStorage.setItem('gw_port',   cfg.port);
  localStorage.setItem('gw_token',  cfg.token);
  localStorage.setItem('gw_theme',  cfg.theme);
  localStorage.setItem('gw_sounds', cfg.sounds);
  localStorage.setItem('gw_notif',  cfg.notif);
}

// ═══════════════════════════════════════════════════════════════
//  TOASTS
// ═══════════════════════════════════════════════════════════════
function toast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('dying');
    setTimeout(() => el.remove(), 280);
  }, duration);
}

// ═══════════════════════════════════════════════════════════════
//  SON
// ═══════════════════════════════════════════════════════════════
function beep(freq = 880, dur = 60, vol = 0.08) {
  if (!cfg.sounds) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur/1000);
    osc.start(); osc.stop(audioCtx.currentTime + dur/1000);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
//  WEBSOCKET
// ═══════════════════════════════════════════════════════════════
function wsConnect() {
  if (ws && ws.readyState < 2) return;
  const url = `ws://${cfg.ip}:${cfg.port}/ws`;
  consoleLog('SYS', `Connexion WebSocket → ${url}`);
  ws = new WebSocket(url);

  ws.onopen = () => {
    updateWsDot('connected');
    consoleLog('SYS', 'WebSocket connecté');
    toast('Connecté à la carte', 'ok');
    clearInterval(wsReconnTimer);
    wsReconnTimer = null;
    // heartbeat ping toutes les 25s
    ws._pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    }, 25000);
    apiGetStatus();
    apiGetRemotes();
  };

  ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleWsMessage(msg);
  };

  ws.onerror = () => {
    updateWsDot('disconnected');
    consoleLog('ERR', 'Erreur WebSocket');
  };

  ws.onclose = () => {
    clearInterval(ws._pingInterval);
    updateWsDot('disconnected');
    consoleLog('SYS', 'WebSocket fermé — reconnexion dans 5s');
    if (!wsReconnTimer) wsReconnTimer = setInterval(wsConnect, 5000);
  };
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'status':
      status = msg;
      renderStatus(msg);
      break;
    case 'event':
      handleEvent(msg);
      break;
    case 'log':
      consoleLog('LOG', msg.msg, msg.ts);
      break;
    case 'pong':
      break;
    default:
      consoleLog('LOG', JSON.stringify(msg));
  }
}

function handleEvent(msg) {
  const type = msg.evtType;
  const label = `[${msg.protoName || '?'}] ${msg.remote || '—'}`;

  if (type === 'frame' || type === 'raw') {
    addFrame(msg);
    consoleLog('RX', `${label} → ${msg.cmd} (code=${msg.rolling})`);
    beep(660, 50);
    if (cfg.notif && document.hidden) {
      notify(`RF reçu : ${msg.remote} — ${msg.cmd}`);
    }
  } else if (type === 'tx') {
    addFrame({ ...msg, isTx: true });
    consoleLog('TX', `${label} ← ${msg.cmd} (code=${msg.rolling})`);
    beep(880, 80);
    // Met à jour le rolling code affiché localement immédiatement
    const r = remotes.find(r => r.addr === msg.addr || r.label === msg.remote);
    if (r) { r.rollingCode = (msg.rolling || 0) + 1; renderRemotesTable(); }
  } else if (type === 'paired') {
    consoleLog('PAIR', `Appairage réussi : ${label} (code=${msg.rolling})`);
    toast(`Appairage réussi : ${msg.remote}`, 'ok', 5000);
    beep(440, 100); setTimeout(() => beep(880, 100), 150);
    stopLearning();
    apiGetRemotes();
    broadcastStatus();
  } else if (type === 'learn_timeout') {
    consoleLog('PAIR', 'Appairage expiré (20s)');
    toast('Appairage expiré — aucun signal reçu', 'warn');
    stopLearning();
  }
}

function updateWsDot(state) {
  const dot = $('ws-indicator');
  dot.className = `dot ${state}`;
}

// ═══════════════════════════════════════════════════════════════
//  API REST
// ═══════════════════════════════════════════════════════════════
function apiUrl(path) { return `http://${cfg.ip}:${cfg.port}${path}`; }

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.token) headers['X-Auth-Token'] = cfg.token;
  try {
    const res = await fetch(apiUrl(path), { ...options, headers: { ...headers, ...options.headers } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } catch(e) {
    consoleLog('ERR', `API ${path}: ${e.message}`);
    throw e;
  }
}

async function apiGetStatus() {
  try {
    const s = await apiFetch('/api/status');
    status = s;
    renderStatus(s);
  } catch(e) { /* déjà loggué */ }
}

async function apiGetRemotes() {
  try {
    const arr = await apiFetch('/api/remotes');
    remotes = arr;
    renderRemotesTable();
    renderDomotique();
  } catch(e) { /* déjà loggué */ }
}

async function apiSend(id, cmd) {
  const r = remotes[id];
  if (!r) return;
  const card = document.querySelector(`.remote-card[data-id="${id}"]`);
  const statusEl = card && card.querySelector('.rc-status');
  try {
    if (card) card.classList.add('active-tx');
    if (statusEl) { statusEl.textContent = 'Envoi…'; statusEl.className = 'rc-status'; }
    await apiFetch('/api/remotes_send', {
      method: 'POST',
      body: JSON.stringify({ id, cmd }),
    });
    if (statusEl) { statusEl.textContent = `✓ ${cmd}`; statusEl.className = 'rc-status ok'; }
    setTimeout(() => { if (statusEl) { statusEl.textContent = ''; statusEl.className = 'rc-status'; } }, 2500);
  } catch(e) {
    if (statusEl) { statusEl.textContent = `Erreur`; statusEl.className = 'rc-status err'; }
    toast(`Erreur TX : ${e.message}`, 'err');
  } finally {
    if (card) { setTimeout(() => card.classList.remove('active-tx'), 600); }
  }
}

async function apiDeleteRemote(id) {
  if (!confirm(`Supprimer "${remotes[id]?.label}" ?`)) return;
  try {
    await apiFetch('/api/remotes_delete', { method: 'POST', body: JSON.stringify({ id }) });
    toast(`Télécommande supprimée`, 'ok');
    apiGetRemotes();
  } catch(e) { toast(`Erreur : ${e.message}`, 'err'); }
}

async function apiUpdateRemote(id, data) {
  try {
    await apiFetch('/api/remotes_update', { method: 'POST', body: JSON.stringify({ id, ...data }) });
    apiGetRemotes();
  } catch(e) { toast(`Erreur : ${e.message}`, 'err'); }
}

async function apiRelay(state, autoOffMs = 0) {
  try {
    await apiFetch('/api/relay', { method: 'POST', body: JSON.stringify({ state, autoOff: autoOffMs }) });
    updateRelayUi(state);
  } catch(e) { toast(`Erreur relais : ${e.message}`, 'err'); }
}

async function apiPulse(ms) {
  try {
    await apiFetch('/api/pulse', { method: 'POST', body: JSON.stringify({ ms }) });
    toast(`Impulsion relais ${ms}ms`, 'info');
    updateRelayUi(true);
    setTimeout(() => updateRelayUi(false), ms);
  } catch(e) { toast(`Erreur : ${e.message}`, 'err'); }
}

async function apiSetProtocol(proto, customCfg = {}) {
  try {
    await apiFetch('/api/protocol', {
      method: 'POST',
      body: JSON.stringify({ proto, ...customCfg }),
    });
    consoleLog('SYS', `Protocole → ${PRESETS[proto]?.name || 'Custom'}`);
    toast(`Protocole : ${PRESETS[proto]?.name || 'Custom'}`, 'info');
  } catch(e) { toast(`Erreur : ${e.message}`, 'err'); }
}

async function apiStartLearn(proto) {
  try {
    await apiFetch('/api/learn', { method: 'POST', body: JSON.stringify({ proto }) });
  } catch(e) { toast(`Erreur appairage : ${e.message}`, 'err'); }
}

async function apiCancelLearn() {
  try { await apiFetch('/api/learn/cancel', { method: 'POST' }); } catch {}
}

async function apiCreateRemote(data) {
  try {
    const res = await apiFetch('/api/remotes', { method: 'POST', body: JSON.stringify(data) });
    toast(`Télécommande créée : ${data.label}`, 'ok');
    apiGetRemotes();
    return res;
  } catch(e) { toast(`Erreur : ${e.message}`, 'err'); return null; }
}

async function apiSendProg(id) {
  await apiSend(id, 'PROG');
  $('pair-result').textContent = '✓ PROG envoyé — attendez 2 clignotements du LED moteur';
}

async function apiSetTxPower(dbm) {
  try {
    await apiFetch('/api/txpower', { method: 'POST', body: JSON.stringify({ dbm }) });
  } catch(e) { toast(`Erreur TX power : ${e.message}`, 'err'); }
}

async function apiReboot() {
  if (!confirm('Redémarrer la carte ?')) return;
  try {
    await apiFetch('/api/reboot', { method: 'POST' });
    toast('Redémarrage en cours…', 'warn');
    setTimeout(wsConnect, 5000);
  } catch(e) {}
}

async function apiScanRssi() {
  try {
    const r = await apiFetch('/api/scan');
    return r.rssi;
  } catch { return null; }
}

function broadcastStatus() { apiGetStatus(); apiGetRemotes(); }

// ═══════════════════════════════════════════════════════════════
//  RENDER — STATUS
// ═══════════════════════════════════════════════════════════════
function renderStatus(s) {
  if (!s) return;
  activeProto = s.protocol ?? activeProto;

  // Barre de statut
  $('rssi-display').textContent = s.rssi ? `${s.rssi} dBm` : '—';
  $('proto-badge').textContent  = s.protoName || '—';
  $('relay-led').className      = `dot ${s.relay ? 'on' : 'off'}`;
  updateRelayUi(s.relay);

  // Paramètres radio
  if (s.freq)  { $('p-freq').value = s.freq; }
  if (s.bw)    { $('p-bw').value   = s.bw;   $('p-bw-range').value   = s.bw; }
  if (s.dev)   { $('p-dev').value  = s.dev;  $('p-dev-range').value  = s.dev; }
  if (s.mod    !== undefined)      $('p-mod').value = s.mod;
  if (s.txPower !== undefined)     { $('p-tx').value = s.txPower; $('p-tx-range').value = s.txPower; }

  // Boutons presets — highlight celui actif
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.proto) === activeProto);
  });

  // Mise à jour fréquence sur le tuner
  if (s.freq) setTunerFreq(s.freq);

  // Onglet réglages — info système
  $('si-ip').textContent       = s.ip || cfg.ip;
  $('si-hostname').textContent = s.hostname || '—';
  $('si-proto').textContent    = s.protoName || '—';
  $('si-rssi').textContent     = s.rssi ? `${s.rssi} dBm` : '—';
  $('si-uptime').textContent   = s.uptime ? fmtUptime(s.uptime) : '—';
  $('si-heap').textContent     = s.freeHeap ? `${(s.freeHeap/1024).toFixed(0)} KB` : '—';
  $('si-fw').textContent       = s.firmwareVersion || '—';
  $('si-remotes').textContent  = s.remoteCount ?? '—';

  // RSSI history
  if (typeof s.rssi === 'number') {
    rssiHistory.push(s.rssi);
    if (rssiHistory.length > 60) rssiHistory.shift();
    renderRssiCanvas(s.rssi);
    renderRssiHistory();
  }
}

function updateRelayUi(on) {
  const el = $('relay-status-text');
  if (el) { el.textContent = on ? 'FERMÉ' : 'OUVERT'; el.className = on ? 'active' : ''; }
}

// ═══════════════════════════════════════════════════════════════
//  TUNER CANVAS — POSTE RADIO VINTAGE
// ═══════════════════════════════════════════════════════════════
function setTunerFreq(mhz) {
  tunerNeedleX = clamp((mhz - TUNER_MIN_MHZ) / (TUNER_MAX_MHZ - TUNER_MIN_MHZ), 0, 1);
  drawTuner(mhz);
  animateNeedle();
  $('freq-mhz').textContent = mhz.toFixed(2);
}

let needleAnimFrame = null;
let needleCurrentX = 0.5;

function animateNeedle() {
  if (needleAnimFrame) cancelAnimationFrame(needleAnimFrame);
  function step() {
    needleCurrentX += (tunerNeedleX - needleCurrentX) * 0.18;
    const canvas = $('tuner-canvas');
    if (!canvas) return;
    const needle = $('tuner-needle');
    if (needle) {
      const px = needleCurrentX * canvas.offsetWidth;
      needle.style.left = `${px}px`;
    }
    if (Math.abs(tunerNeedleX - needleCurrentX) > 0.001) {
      needleAnimFrame = requestAnimationFrame(step);
    }
  }
  needleAnimFrame = requestAnimationFrame(step);
}

function drawTuner(currentMhz) {
  const canvas = $('tuner-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const dpr = window.devicePixelRatio || 1;

  ctx.clearRect(0, 0, W, H);

  // Fond dégradé "papier vieilli"
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0c1820');
  bg.addColorStop(1, '#060c12');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Ligne de base
  ctx.strokeStyle = 'rgba(62,207,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H-22); ctx.lineTo(W, H-22); ctx.stroke();

  // Marqueurs de protocoles connus
  const markers = [
    { mhz: 433.42, label: 'SOMFY',  color: '#3ecfff' },
    { mhz: 433.92, label: 'MOOVO/NICE', color: '#2de08a' },
  ];
  markers.forEach(m => {
    const x = freqToX(m.mhz, W);
    const grad = ctx.createLinearGradient(x, 0, x, H-22);
    grad.addColorStop(0, m.color + '00');
    grad.addColorStop(0.5, m.color + '30');
    grad.addColorStop(1, m.color + '55');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, H-22); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.color;
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillText(m.label, x+4, 20);
  });

  // Graduations
  const step = 0.1; // tous les 100 kHz
  for (let f = TUNER_MIN_MHZ; f <= TUNER_MAX_MHZ + 0.01; f = Math.round((f + step) * 100) / 100) {
    const x = freqToX(f, W);
    const isMajor = Math.round(f * 10) % 10 === 0; // tous les MHz
    const isMid   = Math.round(f * 10) % 5 === 0;  // tous les 0.5 MHz
    const tickH = isMajor ? 22 : (isMid ? 14 : 8);
    ctx.strokeStyle = isMajor ? 'rgba(62,207,255,0.6)'
                   : isMid   ? 'rgba(62,207,255,0.3)'
                              : 'rgba(62,207,255,0.15)';
    ctx.lineWidth = isMajor ? 1.5 : 0.8;
    ctx.beginPath();
    ctx.moveTo(x, H-22);
    ctx.lineTo(x, H-22-tickH);
    ctx.stroke();

    if (isMajor) {
      ctx.fillStyle = 'rgba(62,207,255,0.7)';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(f.toFixed(0), x, H-4);
    } else if (isMid) {
      ctx.fillStyle = 'rgba(62,207,255,0.35)';
      ctx.font = '8px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(f.toFixed(1), x, H-4);
    }
  }

  // Halo sous l'aiguille courante
  const nx = freqToX(currentMhz || (TUNER_MIN_MHZ + TUNER_MAX_MHZ)/2, W);
  const halo = ctx.createRadialGradient(nx, H-22, 0, nx, H-22, 40);
  halo.addColorStop(0, 'rgba(240,64,96,0.2)');
  halo.addColorStop(1, 'rgba(240,64,96,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(nx-50, H-60, 100, 40);

  // Fil de guidage horizontal (le fameux fil métallique du poste radio)
  ctx.strokeStyle = 'rgba(200,220,255,0.18)';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, H-40); ctx.lineTo(W, H-40); ctx.stroke();

  // Légende bandes
  ctx.fillStyle = 'rgba(62,207,255,0.2)';
  ctx.font = '9px Rajdhani, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('UHF 433 MHz', 8, H-44);
  ctx.textAlign = 'right';
  ctx.fillText('ISM BAND', W-8, H-44);
}

function freqToX(mhz, W) {
  return clamp((mhz - TUNER_MIN_MHZ) / (TUNER_MAX_MHZ - TUNER_MIN_MHZ), 0, 1) * W;
}

// ═══════════════════════════════════════════════════════════════
//  RSSI CANVAS
// ═══════════════════════════════════════════════════════════════
function rssiToColor(dbm) {
  if (dbm > -60) return '#2de08a';
  if (dbm > -80) return '#f0a830';
  return '#f04060';
}

function renderRssiCanvas(dbm) {
  const canvas = $('rssi-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Fond
  ctx.fillStyle = '#060810';
  ctx.fillRect(0, 0, W, H);

  // Niveaux de référence
  const levels = [
    { dbm: -50, label: 'Excellent' },
    { dbm: -70, label: 'Bon' },
    { dbm: -90, label: 'Faible' },
  ];
  levels.forEach(l => {
    const y = dbmToY(l.dbm, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W-70, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '9px Share Tech Mono';
    ctx.fillText(`${l.dbm} ${l.label}`, W-68, y+3);
  });

  // Historique en miniature (sparkline gauche)
  if (rssiHistory.length > 1) {
    ctx.beginPath();
    rssiHistory.forEach((v, i) => {
      const x = (i / 59) * (W - 80);
      const y = dbmToY(v, H);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(62,207,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Barre principale
  const barH = H - dbmToY(dbm, H);
  const grad = ctx.createLinearGradient(0, H, 0, H - barH);
  const c = rssiToColor(dbm);
  grad.addColorStop(0, c + 'dd');
  grad.addColorStop(1, c + '22');
  ctx.fillStyle = grad;
  ctx.fillRect(W - 55, H - barH, 22, barH);

  // Valeur numérique
  $('rssi-num').textContent = typeof dbm === 'number' ? dbm.toFixed(1) : '—';
  $('rssi-num').style.color = typeof dbm === 'number' ? rssiToColor(dbm) : '#48566a';
}

function dbmToY(dbm, H) {
  // -110 dBm en bas, -30 dBm en haut
  return H - clamp((dbm + 110) / 80, 0, 1) * H;
}

function renderRssiHistory() {
  const bar = $('rssi-history-bar');
  if (!bar) return;
  bar.innerHTML = '';
  rssiHistory.slice(-40).forEach(v => {
    const seg = document.createElement('div');
    seg.className = 'rssi-bar-seg';
    const h = clamp((v + 110) / 80, 0.02, 1) * 100;
    seg.style.height = `${h}%`;
    seg.style.background = rssiToColor(v);
    seg.style.opacity = '0.7';
    bar.appendChild(seg);
  });
}

// ═══════════════════════════════════════════════════════════════
//  FRAMES TEMPS-RÉEL
// ═══════════════════════════════════════════════════════════════
function addFrame(msg) {
  frames.unshift(msg);
  if (frames.length > 120) frames.pop();
  renderFrames();
}

function renderFrames() {
  const list = $('frame-list');
  if (!list) return;
  list.innerHTML = '';
  frames.slice(0, 60).forEach(f => {
    const el = document.createElement('div');
    const protoClass = f.isTx ? 'tx'
      : f.proto === 0 ? 'somfy' : f.proto === 1 ? 'moovo' : f.proto === 2 ? 'nice' : 'raw';
    el.className = `frame-entry ${protoClass}`;
    el.innerHTML = `
      <span class="frame-ts">${fmtTs(f.ts)}</span>
      <span class="frame-proto">${f.protoName || '?'}</span>
      <span class="frame-remote">${f.remote || '—'}</span>
      <span class="frame-cmd cmd-${f.cmd}">${f.cmd}</span>
      <span class="frame-rolling">#${f.rolling}</span>
    `;
    list.appendChild(el);
  });
}

// ═══════════════════════════════════════════════════════════════
//  REMOTES TABLE
// ═══════════════════════════════════════════════════════════════
function renderRemotesTable() {
  const body = $('remotes-body');
  if (!body) return;
  body.innerHTML = '';

  if (!remotes.length) {
    body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-family:var(--mono);font-size:0.8rem">Aucune télécommande. Créez-en une ou appairez depuis une vraie télécommande.</div>';
    return;
  }

  remotes.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'remote-row';
    const protoClass = ['proto-somfy','proto-moovo','proto-nice','proto-custom'][r.proto] || 'proto-custom';
    row.innerHTML = `
      <span class="rr-name">${r.label}${r.isGroup ? ' <small style="color:var(--accent);font-size:0.65rem">[GROUPE]</small>' : ''}</span>
      <span class="rr-addr">${r.addr || '—'}</span>
      <span><span class="rr-proto-badge ${protoClass}">${r.protoName || '—'}</span></span>
      <span class="rr-code">${r.rollingCode}</span>
      <span class="rr-toggle">
        <label class="toggle-switch">
          <input type="checkbox" data-id="${i}" ${r.active ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </span>
      <span class="rr-actions">
        <button class="btn-icon" data-action="rename" data-id="${i}" title="Renommer">✎</button>
        <button class="btn-icon del" data-action="del" data-id="${i}" title="Supprimer">✕</button>
      </span>
    `;
    body.appendChild(row);
  });

  // Toggle actif
  body.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      apiUpdateRemote(parseInt(cb.dataset.id), { active: cb.checked });
    });
  });

  // Boutons
  body.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      if (btn.dataset.action === 'del') apiDeleteRemote(id);
      if (btn.dataset.action === 'rename') {
        const newName = prompt('Nouveau nom :', remotes[id]?.label || '');
        if (newName && newName.trim()) apiUpdateRemote(id, { label: newName.trim() });
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  DOMOTIQUE — CARDS
// ═══════════════════════════════════════════════════════════════
function renderDomotique() {
  const volets   = remotes.filter(r => r.proto === 0 && !r.isGroup);
  const groupes  = remotes.filter(r => r.proto === 0 && r.isGroup);
  const portails = remotes.filter(r => r.proto === 1 || r.proto === 2);

  renderRemoteCards('cards-volets',   volets,   buildSomfyCard);
  renderRemoteCards('cards-groupes',  groupes,  buildSomfyCard);
  renderRemoteCards('cards-portails', portails, buildOokCard);
}

function renderRemoteCards(containerId, list, builder) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = '';
  if (!list.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:0.78rem;font-family:var(--mono);padding:8px">Aucun appareil</div>';
    return;
  }
  list.forEach(r => {
    const idx = remotes.indexOf(r);
    el.appendChild(builder(r, idx));
  });
}

function buildSomfyCard(r, idx) {
  const div = document.createElement('div');
  div.className = 'remote-card';
  div.dataset.id = idx;
  div.innerHTML = `
    ${r.isGroup ? '<span class="rc-group-badge">GROUPE</span>' : ''}
    <div class="rc-name" title="${r.label}">${r.label}</div>
    <div class="rc-proto">Somfy RTS · ${r.addr}</div>
    <div class="rc-btns">
      <button class="rc-btn up"   data-id="${idx}" data-cmd="MONTER">▲ MONTER</button>
      <button class="rc-btn my"   data-id="${idx}" data-cmd="MY">● MY</button>
      <button class="rc-btn down" data-id="${idx}" data-cmd="DESCENDRE">▼ DESCENDRE</button>
    </div>
    <div class="rc-status"></div>
  `;
  div.querySelectorAll('.rc-btn').forEach(b =>
    b.addEventListener('click', () => apiSend(parseInt(b.dataset.id), b.dataset.cmd))
  );
  return div;
}

function buildOokCard(r, idx) {
  const div = document.createElement('div');
  div.className = 'remote-card';
  div.dataset.id = idx;
  div.innerHTML = `
    <div class="rc-name" title="${r.label}">${r.label}</div>
    <div class="rc-proto">${r.protoName} · ${r.addr}</div>
    <div class="rc-btns">
      <div class="rc-btns-row">
        <button class="rc-btn btn1" data-id="${idx}" data-cmd="BTN1">BTN 1</button>
        <button class="rc-btn btn2" data-id="${idx}" data-cmd="BTN2">BTN 2</button>
      </div>
      <div class="rc-btns-row">
        <button class="rc-btn btn3" data-id="${idx}" data-cmd="BTN3">BTN 3</button>
        <button class="rc-btn btn4" data-id="${idx}" data-cmd="BTN4">BTN 4</button>
      </div>
    </div>
    <div class="rc-status"></div>
  `;
  div.querySelectorAll('.rc-btn').forEach(b =>
    b.addEventListener('click', () => apiSend(parseInt(b.dataset.id), b.dataset.cmd))
  );
  return div;
}

// ═══════════════════════════════════════════════════════════════
//  CONSOLE DEBUG
// ═══════════════════════════════════════════════════════════════
function consoleLog(type, msg, ts) {
  const entry = { type, msg, ts: ts || Date.now() };
  consoleLogs.push(entry);
  if (consoleLogs.length > 2000) consoleLogs.shift();
  appendConsoleLine(entry);
}

function appendConsoleLine(entry) {
  const out = $('console-output');
  if (!out) return;

  // Filtres
  const filters = {
    LOG: $('flt-log')?.checked,
    EVENT: $('flt-event')?.checked,
    STATUS: $('flt-status')?.checked,
    TX: $('flt-tx')?.checked,
    RX: $('flt-rx')?.checked,
    SYS: true, ERR: true, PAIR: true,
  };
  if (!filters[entry.type]) return;

  const line = document.createElement('div');
  line.className = 'log-line';
  line.dataset.type = entry.type;
  line.innerHTML = `
    <span class="log-ts">${fmtTs(entry.ts)}</span>
    <span class="log-type ${entry.type}">${entry.type}</span>
    <span class="log-msg">${entry.msg}</span>
  `;
  out.appendChild(line);

  const autoScroll = $('dbg-autoscroll');
  if (!autoScroll || autoScroll.checked) {
    out.scrollTop = out.scrollHeight;
  }
}

function refilterConsole() {
  const out = $('console-output');
  if (!out) return;
  out.innerHTML = '';
  consoleLogs.forEach(e => appendConsoleLine(e));
}

function exportLog() {
  const text = consoleLogs.map(e => `${fmtTs(e.ts)} [${e.type}] ${e.msg}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rf-gateway-log-${Date.now()}.txt`;
  a.click();
}

function handleDebugCmd(cmd) {
  cmd = cmd.trim().toLowerCase();
  consoleLog('SYS', `> ${cmd}`);
  if (cmd === 'status') apiGetStatus();
  else if (cmd === 'remotes') apiGetRemotes();
  else if (cmd === 'scan') apiScanRssi().then(v => consoleLog('LOG', `RSSI scan: ${v} dBm`));
  else if (cmd === 'reboot') apiReboot();
  else if (cmd === 'clear') { consoleLogs.length = 0; $('console-output').innerHTML = ''; }
  else consoleLog('ERR', `Commande inconnue: "${cmd}". Disponibles: status, remotes, scan, reboot, clear`);
}

// ═══════════════════════════════════════════════════════════════
//  NOTIFICATIONS NAVIGATEUR
// ═══════════════════════════════════════════════════════════════
function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
function notify(msg) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('RF Gateway', { body: msg, icon: '' });
  }
}

// ═══════════════════════════════════════════════════════════════
//  MODE APPRENTISSAGE
// ═══════════════════════════════════════════════════════════════
function startLearning(proto) {
  learningActive = true;
  $('learn-progress').classList.remove('hidden');
  $('learn-status-text').textContent = `Écoute ${PRESETS[proto]?.name || '?'}…`;
  let count = 20;
  $('learn-countdown').textContent = count;
  clearInterval(learnCountdownTimer);
  learnCountdownTimer = setInterval(() => {
    count--;
    $('learn-countdown').textContent = count;
    if (count <= 0) stopLearning();
  }, 1000);
  apiStartLearn(proto);
  consoleLog('PAIR', `Appairage démarré: ${PRESETS[proto]?.name}. Appuyez sur PROG de la télécommande physique.`);
  toast(`Appairage ${PRESETS[proto]?.name} — appuyez sur PROG`, 'warn', 20000);
}

function stopLearning() {
  learningActive = false;
  clearInterval(learnCountdownTimer);
  $('learn-progress')?.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
//  SCAN RSSI EN CONTINU (quand onglet Radio actif)
// ═══════════════════════════════════════════════════════════════
let rssiScanInterval = null;

function startRssiScan() {
  if (rssiScanInterval) return;
  rssiScanInterval = setInterval(async () => {
    const v = await apiScanRssi();
    if (typeof v === 'number') {
      rssiHistory.push(v);
      if (rssiHistory.length > 60) rssiHistory.shift();
      renderRssiCanvas(v);
      renderRssiHistory();
    }
  }, 1000);
}

function stopRssiScan() {
  clearInterval(rssiScanInterval);
  rssiScanInterval = null;
}

// ═══════════════════════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════════════════════
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));

  if (name === 'radio') { startRssiScan(); drawTuner(parseFloat($('p-freq')?.value || 433.42)); }
  else stopRssiScan();

  if (name === 'domotique') renderDomotique();
  if (name === 'remotes') {
    renderRemotesTable();
    // Met à jour la liste des groupes pour le modal d'appairage groupe
    const sel = $('pair-group-select');
    if (sel) {
      sel.innerHTML = '';
      remotes.filter(r => r.isGroup).forEach((r, i) => {
        const o = document.createElement('option');
        o.value = remotes.indexOf(r);
        o.textContent = r.label;
        sel.appendChild(o);
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  THÈME
// ═══════════════════════════════════════════════════════════════
function applyTheme(theme) {
  cfg.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
}

// ═══════════════════════════════════════════════════════════════
//  COMMANDES "TOUT" (volets)
// ═══════════════════════════════════════════════════════════════
function sendToAll(cmd) {
  const somfyRemotes = remotes.filter(r => r.proto === 0);
  if (!somfyRemotes.length) { toast('Aucune télécommande Somfy', 'warn'); return; }
  somfyRemotes.forEach(r => apiSend(remotes.indexOf(r), cmd));
  toast(`${cmd} → ${somfyRemotes.length} volet(s)`, 'info');
}

// ═══════════════════════════════════════════════════════════════
//  INIT & LISTENERS
// ═══════════════════════════════════════════════════════════════
function init() {
  applyTheme(cfg.theme);

  // Remplir les champs de réglages
  $('s-ip').value    = cfg.ip;
  $('s-port').value  = cfg.port;
  $('s-token').value = cfg.token;
  $('s-theme').value = cfg.theme;
  if ($('s-sounds')) $('s-sounds').checked = cfg.sounds;
  if ($('s-notif'))  $('s-notif').checked  = cfg.notif;

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Presets radio
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const proto = parseInt(btn.dataset.proto);
      const p = PRESETS[proto];
      if (!p) return;
      // Met à jour les sliders
      $('p-freq').value = p.freq;
      $('p-bw').value   = p.bw;   $('p-bw-range').value   = p.bw;
      $('p-dev').value  = p.dev;  $('p-dev-range').value  = p.dev;
      $('p-mod').value  = p.mod;
      setTunerFreq(p.freq);
      if (proto !== 3) {
        // Protocoles prédéfinis → appliquer directement
        apiSetProtocol(proto);
        if (p.note) toast(p.note, 'warn', 8000);
      }
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Sync sliders ↔ inputs
  [['p-bw-range','p-bw'],['p-dev-range','p-dev'],['p-tx-range','p-tx']].forEach(([rid, nid]) => {
    $(rid).addEventListener('input', () => $(nid).value = $(rid).value);
    $(nid).addEventListener('input', () => $(rid).value = $(nid).value);
  });

  // Freq input → tuner
  $('p-freq').addEventListener('input', () => {
    const v = parseFloat($('p-freq').value);
    if (!isNaN(v)) setTunerFreq(v);
  });

  // Appliquer réglages custom
  $('btn-apply-custom').addEventListener('click', () => {
    const customCfg = {
      freq: parseFloat($('p-freq').value),
      bw:   parseFloat($('p-bw').value),
      dev:  parseFloat($('p-dev').value),
      mod:  parseInt($('p-mod').value),
    };
    apiSetProtocol(3, customCfg);
    apiSetTxPower(parseInt($('p-tx').value));
    toast('Réglages radio appliqués', 'info');
  });

  $('btn-reset-proto').addEventListener('click', () => {
    const p = PRESETS[activeProto] || PRESETS[0];
    $('p-freq').value = p.freq; $('p-bw').value = p.bw; $('p-dev').value = p.dev; $('p-mod').value = p.mod;
    $('p-bw-range').value = p.bw; $('p-dev-range').value = p.dev;
    setTunerFreq(p.freq);
  });

  // Effacer trames
  $('btn-clear-frames').addEventListener('click', () => { frames = []; renderFrames(); });

  // Domotique — commandes globales
  $('btn-all-up').addEventListener('click', () => sendToAll('MONTER'));
  $('btn-all-my').addEventListener('click', () => sendToAll('MY'));
  $('btn-all-down').addEventListener('click', () => sendToAll('DESCENDRE'));

  // Relais
  $('btn-relay-on').addEventListener('click', () => apiRelay(true));
  $('btn-relay-off').addEventListener('click', () => apiRelay(false));
  $('btn-relay-pulse').addEventListener('click', () => {
    const ms = parseInt($('relay-pulse-ms').value) || 500;
    apiPulse(ms);
  });

  // Appairage
  document.querySelectorAll('.btn-learn').forEach(btn => {
    btn.addEventListener('click', () => {
      const proto = parseInt(btn.dataset.proto);
      startLearning(proto);
      switchTab('remotes');
    });
  });
  $('btn-learn-cancel').addEventListener('click', () => {
    apiCancelLearn();
    stopLearning();
    toast('Appairage annulé', 'warn');
  });

  // Nouvelle télécommande
  $('btn-new-remote').addEventListener('click', () => $('modal-new-remote').classList.remove('hidden'));
  $('btn-nr-cancel').addEventListener('click', () => $('modal-new-remote').classList.add('hidden'));
  $('btn-nr-confirm').addEventListener('click', async () => {
    const label = $('nr-label').value.trim();
    const proto = parseInt($('nr-proto').value);
    const isGroup = $('nr-group').checked;
    const addr  = $('nr-addr').value.trim() || undefined;
    const startCode = parseInt($('nr-startcode').value) || 1;
    if (!label) { toast('Nom requis', 'warn'); return; }
    await apiCreateRemote({ label, proto, isGroup, addr, startCode });
    $('modal-new-remote').classList.add('hidden');
    $('nr-label').value = '';
  });

  // Modal groupe — guide appairage Somfy
  // (accessible via menu contextuel futur, ou bouton dans domotique)
  $('btn-send-prog').addEventListener('click', () => {
    const id = parseInt($('pair-group-select').value);
    if (isNaN(id)) return;
    apiSendProg(id);
  });
  $('btn-modal-group-close').addEventListener('click', () => $('modal-group-pair').classList.add('hidden'));

  // Console
  $('btn-clear-console').addEventListener('click', () => {
    consoleLogs.length = 0;
    $('console-output').innerHTML = '';
  });
  $('btn-export-log').addEventListener('click', exportLog);
  $('debug-cmd').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      handleDebugCmd($('debug-cmd').value);
      $('debug-cmd').value = '';
    }
  });
  $('btn-debug-send').addEventListener('click', () => {
    handleDebugCmd($('debug-cmd').value);
    $('debug-cmd').value = '';
  });

  // Filtres console
  ['flt-log','flt-event','flt-status','flt-tx','flt-rx'].forEach(id => {
    $(id)?.addEventListener('change', refilterConsole);
  });

  // Réglages — connexion
  $('btn-save-connection').addEventListener('click', () => {
    cfg.ip    = $('s-ip').value.trim()    || DEFAULT_IP;
    cfg.port  = parseInt($('s-port').value) || DEFAULT_PORT;
    cfg.token = $('s-token').value.trim();
    saveConfig();
    toast('Connexion mise à jour — reconnexion…', 'ok');
    ws && ws.close();
    setTimeout(wsConnect, 500);
  });

  $('btn-test-connection').addEventListener('click', async () => {
    const el = $('conn-test-result');
    el.textContent = 'Test…'; el.className = '';
    try {
      const s = await apiFetch('/api/status');
      el.textContent = `✓ OK — ${s.hostname || cfg.ip}`;
      el.className = 'ok';
    } catch {
      el.textContent = '✕ Inaccessible';
      el.className = 'err';
    }
  });

  // Réglages UI
  $('s-theme').addEventListener('change', () => applyTheme($('s-theme').value));
  $('btn-save-ui').addEventListener('click', () => {
    cfg.sounds = $('s-sounds').checked;
    cfg.notif  = $('s-notif').checked;
    cfg.theme  = $('s-theme').value;
    saveConfig();
    toast('Préférences sauvegardées', 'ok');
    if (cfg.notif) requestNotifPermission();
  });

  $('btn-reboot').addEventListener('click', apiReboot);

  // Resize → redraw canvas
  window.addEventListener('resize', () => {
    drawTuner(parseFloat($('p-freq')?.value || 433.42));
  });

  // Init tuner
  drawTuner(433.42);
  setTunerFreq(433.42);

  // Lancer WS
  wsConnect();

  // Scan RSSI initial (onglet radio actif par défaut)
  startRssiScan();

  consoleLog('SYS', `RF Gateway UI démarrée — cible: ${cfg.ip}:${cfg.port}`);
  if (cfg.notif) requestNotifPermission();
}

document.addEventListener('DOMContentLoaded', init);
