'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const screens = { home: $('homeView'), lobby: $('lobbyView'), game: $('gameView') };
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const WORLD = { w: 1600, h: 1120 };
  const MAX_HUMANS = 3;
  const TOTAL_PLAYERS = 6;
  const ROUND_SECONDS = 240;
  const STATIONS = [
    { id: 'camp', x: 800, y: 555, title: 'Api unggun', detail: 'Pos jaga', kind: 'camp' },
    { id: 'radio', x: 405, y: 285, title: 'Radio tua', detail: 'Perbaiki radio', kind: 'radio' },
    { id: 'shrine', x: 1240, y: 265, title: 'Punden batu', detail: 'Ritual penanda', kind: 'shrine' },
    { id: 'cave', x: 315, y: 820, title: 'Mulut gua', detail: 'Sinyal gua', kind: 'cave' },
    { id: 'pond', x: 1280, y: 775, title: 'Telaga hitam', detail: 'Air telaga', kind: 'pond' },
    { id: 'herbs', x: 835, y: 950, title: 'Kebun jamur', detail: 'Jamur bercahaya', kind: 'herbs' },
  ];
  const BOT_NAMES = ['Wulan', 'Bagas', 'Sari', 'Dimas', 'Jaka', 'Maya', 'Tegar', 'Ningsih'];
  const COLORS = ['#c6d1a5', '#d8b48c', '#9fc5b0', '#b1a9d4', '#d49a98', '#c6b980'];
  const RUNES = ['ᚷ', 'ᚺ', 'ᛟ', 'ᛞ', 'ᛉ', 'ᚱ'];
  const WIRE_SIGNS = ['☾', '✧', '♧', 'ᚷ'];

  let peer = null;
  let hostConnection = null;
  let connections = new Map();
  let lobbyHumans = [];
  let lobbyRoster = [];
  let localId = 'human';
  let isHost = false;
  let isOnline = false;
  let roomCode = '';
  let playerName = 'Penjelajah';
  let game = null;
  let lastPhase = '';
  let lastSnapshotAt = 0;
  let lastInputSendAt = 0;
  let activePuzzles = new Map();
  let localPuzzle = null;
  let taskCardHidden = false;
  let lastToastUntil = 0;
  let toastTimeout = null;
  let soundOn = true;
  let audioContext = null;
  let ambienceNodes = [];
  let keys = new Set();
  let joystickInput = { x: 0, y: 0 };
  let localInput = { x: 0, y: 0 };
  let joystickPointer = null;
  let joystickCenter = { x: 0, y: 0 };
  let renderWidth = 900;
  let renderHeight = 600;
  let dpr = 1;
  let camera = { x: 0, y: 0 };
  let lastFrameAt = 0;
  let latestHudAt = 0;
  let initialGameStarted = false;
  let clientLastSnapshot = 0;
  let toastMessage = '';

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randint(min, max) { return Math.floor(rand(min, max + 1)); }
  function choose(items) { return items[Math.floor(Math.random() * items.length)]; }
  function shuffle(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  function safeName(raw) {
    const cleaned = String(raw || '').replace(/[<>\[\]{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    return cleaned || 'Penjelajah';
  }
  function setStatus(id, msg, isError = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', isError);
  }
  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle('active', key === name);
    });
    if (name === 'game') resizeCanvas();
  }
  function showToast(message, duration = 2300) {
    toastMessage = message;
    const el = $('gameToast');
    el.textContent = message;
    el.classList.add('show');
    lastToastUntil = Date.now() + duration;
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('show'), duration);
  }
  function startAudio() {
    if (!soundOn) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContext) audioContext = new AudioCtx();
      if (audioContext.state === 'suspended') audioContext.resume();
    } catch (_) { /* audio is optional */ }
  }
  function tone(freq = 430, duration = .09, type = 'sine', volume = .035, bend = 0) {
    if (!soundOn) return;
    startAudio();
    if (!audioContext) return;
    try {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioContext.currentTime);
      if (bend) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + bend), audioContext.currentTime + duration);
      gain.gain.setValueAtTime(volume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(); osc.stop(audioContext.currentTime + duration);
    } catch (_) { /* ignore sound failure */ }
  }
  function soundEvent(kind) {
    if (!soundOn) return;
    if (kind === 'click') tone(350, .045, 'sine', .018, 40);
    if (kind === 'success') { tone(520, .12, 'sine', .04, 120); setTimeout(() => tone(720, .16, 'sine', .03, 60), 80); }
    if (kind === 'bad') tone(170, .18, 'triangle', .035, -50);
    if (kind === 'ghost') { tone(90, .3, 'sawtooth', .035, -30); setTimeout(() => tone(58, .42, 'triangle', .025, -10), 80); }
    if (kind === 'meeting') { tone(220, .16, 'triangle', .035, -50); setTimeout(() => tone(180, .22, 'triangle', .03, -40), 190); }
  }

  function setHomeNameIfNeeded() {
    // Ask only once per browser session; private browsing may block sessionStorage.
    let asked = true;
    try { asked = !!sessionStorage.getItem('rimbaNameAsked'); } catch (_) { asked = true; }
    if (!asked) {
      const entered = window.prompt('Nama penjelajah (maks. 16 karakter):', playerName);
      if (entered !== null) playerName = safeName(entered);
      try { sessionStorage.setItem('rimbaNameAsked', 'yes'); } catch (_) { /* private mode */ }
    }
  }
  function resetNetwork() {
    try {
      if (hostConnection) { hostConnection.close(); hostConnection = null; }
      for (const conn of connections.values()) { try { conn.close(); } catch (_) {} }
      connections.clear();
      if (peer) { try { peer.destroy(); } catch (_) {} peer = null; }
    } catch (_) {}
    isHost = false;
    isOnline = false;
    roomCode = '';
    lobbyHumans = [];
    lobbyRoster = [];
  }
  function returnHome() {
    resetNetwork();
    game = null;
    localPuzzle = null;
    activePuzzles.clear();
    lastPhase = '';
    initialGameStarted = false;
    $('puzzleOverlay').classList.add('hidden');
    $('meetingOverlay').classList.add('hidden');
    $('resultOverlay').classList.add('hidden');
    showScreen('home');
    setStatus('homeStatus', 'Butuh internet untuk room online. Mode AI bisa langsung dimainkan.');
  }
  function makeRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }
  function currentHumans() {
    return lobbyHumans.map((h) => ({ id: h.id, name: h.name, isHuman: true }));
  }
  function renderRoster() {
    const list = $('roster');
    list.innerHTML = '';
    const humans = lobbyRoster.length ? lobbyRoster : lobbyHumans;
    $('rosterCount').textContent = `${humans.length} / ${MAX_HUMANS}`;
    for (let i = 0; i < MAX_HUMANS; i++) {
      const human = humans[i];
      const row = document.createElement('div');
      row.className = 'roster-item';
      if (human) {
        const current = human.id === localId;
        row.innerHTML = `<div class="avatar">${current ? '✦' : '♙'}</div><div class="roster-name"><b></b><small>${current ? 'Kamu' : 'Penjelajah'} · pemain manusia</small></div><span class="roster-state">SIAP</span>`;
        row.querySelector('.roster-name b').textContent = human.name || 'Penjelajah';
      } else {
        row.innerHTML = `<div class="avatar" style="background:#202d31;color:#718986">＋</div><div class="roster-name"><b>Slot kosong</b><small>AI akan mengisi saat mulai</small></div><span class="roster-state waiting">AI FILL</span>`;
      }
      list.appendChild(row);
    }
    if ($('startBtn')) $('startBtn').disabled = !isHost;
    if (isHost) $('lobbyStatus').textContent = humans.length >= 3 ? 'Lobby penuh. Kalian siap menghadapi malam.' : 'Bagikan kode room ke teman. Slot kosong akan diisi AI saat mulai.';
  }
  function openLobby() {
    $('roomCodeDisplay').textContent = roomCode;
    lobbyRoster = [...lobbyHumans];
    renderRoster();
    showScreen('lobby');
  }
  function publishLobby() {
    lobbyRoster = [...lobbyHumans];
    renderRoster();
    for (const conn of connections.values()) {
      if (conn && conn.open) {
        try { conn.send({ type: 'LOBBY', code: roomCode, players: lobbyRoster, maxHumans: MAX_HUMANS }); } catch (_) {}
      }
    }
  }
  function createRoom() {
    startAudio();
    setHomeNameIfNeeded();
    if (!window.Peer) {
      setStatus('homeStatus', 'Library koneksi belum termuat. Periksa internet lalu muat ulang halaman.', true);
      return;
    }
    resetNetwork();
    isHost = true; isOnline = true; localId = 'host';
    playerName = safeName(playerName);
    roomCode = makeRoomCode();
    lobbyHumans = [{ id: 'host', name: playerName, isHuman: true }];
    setStatus('homeStatus', 'Membuka room...');
    try {
      peer = new Peer(`rimba-${roomCode.toLowerCase()}`, { debug: 0 });
      peer.on('open', () => {
        openLobby();
        setStatus('lobbyStatus', 'Room aktif. Bagikan kode ini ke teman.');
      });
      peer.on('connection', (conn) => {
        connections.set(conn.peer, conn);
        conn.on('data', (data) => handleHostMessage(conn, data));
        conn.on('close', () => handleDisconnect(conn.peer));
        conn.on('error', () => {});
      });
      peer.on('error', (err) => {
        const type = err && err.type;
        if (type === 'unavailable-id') {
          try { peer.destroy(); } catch (_) {}
          peer = null;
          roomCode = makeRoomCode();
          $('roomCodeDisplay').textContent = roomCode;
          createPeerWithFreshCode();
          return;
        }
        const msg = type === 'network' ? 'Koneksi signaling gagal. Coba lagi atau gunakan mode AI.' : 'Room gagal dibuka. Coba buat room baru.';
        if (screens.lobby.classList.contains('active')) setStatus('lobbyStatus', msg, true);
        else setStatus('homeStatus', msg, true);
      });
    } catch (err) {
      setStatus('homeStatus', 'Tidak bisa membuat room di browser ini. Coba muat ulang.', true);
      resetNetwork();
    }
  }
  function createPeerWithFreshCode() {
    if (!isHost || !isOnline) return;
    try {
      peer = new Peer(`rimba-${roomCode.toLowerCase()}`, { debug: 0 });
      peer.on('open', () => { $('roomCodeDisplay').textContent = roomCode; openLobby(); });
      peer.on('connection', (conn) => {
        connections.set(conn.peer, conn);
        conn.on('data', (data) => handleHostMessage(conn, data));
        conn.on('close', () => handleDisconnect(conn.peer));
      });
      peer.on('error', (err) => setStatus('homeStatus', `Room error: ${err.type || 'koneksi'}. Coba lagi.`, true));
    } catch (_) { setStatus('homeStatus', 'Room gagal dibuat.'); }
  }
  function joinRoom() {
    startAudio();
    setHomeNameIfNeeded();
    if (!window.Peer) {
      setStatus('homeStatus', 'Library koneksi belum termuat. Periksa internet lalu muat ulang halaman.', true);
      return;
    }
    const code = String($('joinCode').value || '').trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) {
      setStatus('homeStatus', 'Kode room harus 5 karakter (huruf/angka, tanpa O atau I).', true);
      return;
    }
    resetNetwork();
    isHost = false; isOnline = true; roomCode = code; playerName = safeName(playerName);
    setStatus('homeStatus', 'Mencari room...');
    try {
      peer = new Peer(undefined, { debug: 0 });
      peer.on('open', () => {
        localId = peer.id;
      const conn = peer.connect(`rimba-${code.toLowerCase()}`, { reliable: true });
        hostConnection = conn;
        conn.on('open', () => {
          conn.send({ type: 'JOIN', name: playerName });
          setStatus('homeStatus', 'Terhubung. Menunggu lobby...');
        });
        conn.on('data', handleClientMessage);
        conn.on('close', () => {
          if (isOnline && !game?.phase?.includes('ended')) setStatus('homeStatus', 'Koneksi ke host terputus.', true);
        });
        conn.on('error', () => setStatus('homeStatus', 'Koneksi room gagal.', true));
      });
      peer.on('error', (err) => {
        const msg = err.type === 'peer-unavailable' ? 'Room tidak ditemukan. Periksa kode dan pastikan host masih membuka room.' : 'Gagal terhubung. Pastikan internet aktif dan coba lagi.';
        setStatus('homeStatus', msg, true);
      });
    } catch (_) { setStatus('homeStatus', 'Browser tidak dapat membuka koneksi P2P.', true); }
  }
  function handleDisconnect(id) {
    connections.delete(id);
    if (game && isHost) {
      const p = game.players.find((x) => x.id === id);
      if (p && p.alive) {
        p.alive = false; p.disconnected = true; p.body = { x: p.x, y: p.y, reported: false };
        showToast(`${p.name} kehilangan koneksi.`);
      }
    }
    if (isHost && !initialGameStarted) {
      lobbyHumans = lobbyHumans.filter((h) => h.id !== id);
      publishLobby();
    }
  }
  function handleHostMessage(conn, message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'JOIN') {
      if (initialGameStarted || lobbyHumans.length >= MAX_HUMANS) {
        try { conn.send({ type: 'ERROR', message: initialGameStarted ? 'Ronde sudah dimulai.' : 'Room sudah penuh.' }); } catch (_) {}
        conn.close(); connections.delete(conn.peer); return;
      }
      const name = safeName(message.name);
      if (!lobbyHumans.some((h) => h.id === conn.peer)) lobbyHumans.push({ id: conn.peer, name, isHuman: true });
      publishLobby();
      try { conn.send({ type: 'LOBBY', code: roomCode, players: lobbyRoster, maxHumans: MAX_HUMANS }); } catch (_) {}
      return;
    }
    if (!game) return;
    if (message.type === 'INPUT') {
      const p = game.players.find((x) => x.id === conn.peer);
      if (p && p.alive && game.phase === 'playing') p.input = normalizeInput(message.input);
      return;
    }
    if (message.type === 'ACTION') { handleAction(conn.peer, message.action); return; }
    if (message.type === 'TASK_DONE') { finalizeTask(conn.peer, message.taskId); return; }
    if (message.type === 'PUZZLE_CANCEL') {
      if (activePuzzles.get(conn.peer) === message.taskId) activePuzzles.delete(conn.peer);
      return;
    }
    if (message.type === 'VOTE') { registerVote(conn.peer, message.target); return; }
    if (message.type === 'REMATCH_REQUEST') { startGame(); return; }
    if (message.type === 'LEAVE') { handleDisconnect(conn.peer); return; }
  }
  function handleClientMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ERROR') { setStatus('homeStatus', message.message || 'Room menolak koneksi.', true); return; }
    if (message.type === 'LOBBY') {
      roomCode = message.code || roomCode;
      lobbyRoster = message.players || [];
      $('roomCodeDisplay').textContent = roomCode;
      $('startBtn').disabled = true;
      renderRoster();
      showScreen('lobby');
      setStatus('lobbyStatus', 'Menunggu host memulai permainan.');
      return;
    }
    if (message.type === 'START') {
      localId = message.localId;
      game = message.state;
      initialGameStarted = true;
      activePuzzles.clear(); localPuzzle = null;
      $('puzzleOverlay').classList.add('hidden'); $('meetingOverlay').classList.add('hidden'); $('resultOverlay').classList.add('hidden');
      showScreen('game'); lastPhase = ''; updateHud(true); showScreen('game');
      return;
    }
    if (message.type === 'SNAPSHOT') {
      if (message.state) {
        game = message.state;
        clientLastSnapshot = Date.now();
        if (screens.game.classList.contains('active')) updateHud(false);
      }
      return;
    }
    if (message.type === 'PUZZLE_START') { openPuzzle(message.task, message.station); return; }
    if (message.type === 'TASK_RESULT') {
      activePuzzles.delete(message.taskId);
      if (localPuzzle && localPuzzle.taskId === message.taskId) closePuzzle();
      if (message.ok) { soundEvent('success'); showToast('Puzzle selesai. Penanda menyala!'); }
      else showToast(message.message || 'Tugas tidak valid.');
      return;
    }
    if (message.type === 'TOAST') { showToast(message.message || ''); if (message.sound) soundEvent(message.sound); return; }
    if (message.type === 'PONG') return;
  }
  function sendToPlayer(id, packet) {
    const conn = connections.get(id);
    if (conn && conn.open) { try { conn.send(packet); } catch (_) {} }
  }
  function sendSnapshot() {
    if (!game || !isHost || !isOnline) return;
    for (const h of lobbyHumans) {
      if (h.id === localId) continue;
      sendToPlayer(h.id, { type: 'SNAPSHOT', state: viewFor(h.id) });
    }
  }
  function viewFor(recipientId) {
    if (!game) return null;
    const ended = game.phase === 'ended';
    const now = Date.now();
    const teamCompleted = game.players.filter((p) => !p.isGhost).reduce((sum, p) => sum + (p.tasks || []).filter((t) => t.done).length, 0);
    const teamPending = game.players.filter((p) => p.alive && !p.isGhost).reduce((sum, p) => sum + (p.tasks || []).filter((t) => !t.done).length, 0);
    return {
      phase: game.phase,
      timeLeft: game.timeLeft,
      taskStats: { completed: teamCompleted, pending: teamPending },
      emergencyUsed: game.emergencyUsed,
      lightsOutUntil: game.lightsOutUntil || 0,
      winner: game.winner,
      endReason: game.endReason,
      stations: STATIONS,
      startedAt: game.startedAt,
      meeting: game.meeting ? { endsAt: game.meeting.endsAt, startedAt: game.meeting.startedAt, youVoted: !!game.votes?.[recipientId] } : null,
      players: game.players.map((p) => {
        const own = p.id === recipientId;
        const revealed = !!p.revealed || (p.revealUntil && p.revealUntil > now);
        return {
          id: p.id, name: p.name, x: p.x, y: p.y, alive: p.alive,
          isHuman: p.isHuman, isBot: p.isBot, color: p.color,
          body: p.body ? { x: p.body.x, y: p.body.y, reported: !!p.body.reported } : null,
          exiled: !!p.exiled, disconnected: !!p.disconnected, revealed: !!revealed,
          isGhost: own || ended || revealed ? !!p.isGhost : false,
          tasks: own ? (p.tasks || []).map((t) => ({ ...t })) : [],
          votesSubmitted: own ? !!game.votes?.[recipientId] : undefined,
        };
      }),
    };
  }

  function makePlayer(id, name, isHuman, isBot, index) {
    return {
      id, name: safeName(name), isHuman, isBot, x: 770 + rand(-70, 70), y: 520 + rand(-55, 55),
      alive: true, isGhost: false, color: COLORS[index % COLORS.length], body: null, exiled: false,
      disconnected: false, tasks: [], input: { x: 0, y: 0 }, lastAttack: 0, revealUntil: 0, revealed: false,
      botWaitUntil: 0, botTaskId: null,
    };
  }
  function createGame(humans, solo) {
    const players = humans.map((h, i) => makePlayer(h.id, h.name, true, false, i));
    const usedNames = new Set(players.map((p) => p.name.toLowerCase()));
    let botIndex = 0;
    while (players.length < TOTAL_PLAYERS) {
      let name = BOT_NAMES[botIndex % BOT_NAMES.length];
      while (usedNames.has(name.toLowerCase())) name = `${name}${randint(2, 9)}`;
      usedNames.add(name.toLowerCase());
      const id = `bot-${botIndex + 1}`;
      players.push(makePlayer(id, name, false, true, players.length));
      botIndex++;
    }
    let ghost;
    if (!solo && humans.length > 1) ghost = choose(players.filter((p) => p.isHuman));
    else if (Math.random() < .48) ghost = players.find((p) => p.id === localId) || players[0];
    else ghost = choose(players.filter((p) => p.isBot));
    ghost.isGhost = true;
    for (const p of players) {
      if (p.isGhost) { p.tasks = []; continue; }
      const stationOrder = shuffle(STATIONS).slice(0, 3);
      p.tasks = stationOrder.map((station, idx) => ({
        id: `${p.id}-task-${idx + 1}`,
        stationId: station.id,
        title: choose(['Aktifkan', 'Periksa', 'Pulihkan', 'Kalibrasi']) + ' ' + station.title.toLowerCase(),
        done: false,
        startedAt: 0,
        finishAt: 0,
      }));
    }
    return {
      phase: 'playing', players, timeLeft: ROUND_SECONDS, emergencyUsed: false,
      meeting: null, votes: {}, winner: null, endReason: '', startedAt: Date.now(),
      totalHumans: humans.length, solo, lastKill: null,
    };
  }
  function startSolo() {
    startAudio(); setHomeNameIfNeeded(); resetNetwork();
    isHost = true; isOnline = false; localId = 'human';
    lobbyHumans = [{ id: localId, name: playerName, isHuman: true }];
    game = createGame(currentHumans(), true);
    initialGameStarted = true; activePuzzles.clear(); localPuzzle = null; lastPhase = '';
    $('puzzleOverlay').classList.add('hidden'); $('meetingOverlay').classList.add('hidden'); $('resultOverlay').classList.add('hidden');
    showScreen('game'); updateHud(true); showToast('Temukan titik cahaya. Jangan terlalu lama sendirian.');
  }
  function startGame() {
    if (!isHost) return;
    if (lobbyHumans.length < 1) return;
    game = createGame(currentHumans(), !isOnline || lobbyHumans.length === 1);
    initialGameStarted = true; activePuzzles.clear(); localPuzzle = null; lastPhase = '';
    $('puzzleOverlay').classList.add('hidden'); $('meetingOverlay').classList.add('hidden'); $('resultOverlay').classList.add('hidden');
    showScreen('game'); updateHud(true); showToast('Malam dimulai. Dengarkan hutan.');
    if (isOnline) {
      for (const h of lobbyHumans) {
        if (h.id !== localId) sendToPlayer(h.id, { type: 'START', localId: h.id, state: viewFor(h.id) });
      }
    }
  }

  function getPlayer(id = localId) { return game?.players?.find((p) => p.id === id); }
  function getStation(id) { return STATIONS.find((s) => s.id === id); }
  function normalizeInput(input) {
    if (!input || typeof input !== 'object') return { x: 0, y: 0 };
    let x = clamp(Number(input.x) || 0, -1, 1), y = clamp(Number(input.y) || 0, -1, 1);
    const mag = Math.hypot(x, y);
    if (mag > 1) { x /= mag; y /= mag; }
    return { x, y };
  }
  function closestPersonalTask(p, onlyPending = true) {
    if (!p || !p.tasks) return null;
    let best = null;
    for (const task of p.tasks) {
      if (onlyPending && task.done) continue;
      const station = getStation(task.stationId);
      if (!station) continue;
      const distance = dist(p, station);
      if (!best || distance < best.distance) best = { task, station, distance };
    }
    return best;
  }
  function closestSurvivor(p, includeBots = true) {
    let best = null;
    for (const other of game.players) {
      if (!other.alive || other.id === p.id || other.isGhost) continue;
      if (!includeBots && other.isBot) continue;
      const distance = dist(p, other);
      if (!best || distance < best.distance) best = { player: other, distance };
    }
    return best;
  }
  function nearbyBody(p) {
    if (!p) return null;
    let best = null;
    for (const other of game.players) {
      if (!other.body || other.body.reported) continue;
      const distance = dist(p, other.body);
      if (!best || distance < best.distance) best = { player: other, distance };
    }
    return best;
  }
  function canCallMeeting(p) {
    if (!p || !p.alive || game.phase !== 'playing') return false;
    const body = nearbyBody(p);
    if (body && body.distance < 85) return true;
    const camp = getStation('camp');
    return !game.emergencyUsed && camp && dist(p, camp) < 90;
  }
  function handleAction(id, action) {
    if (!game || game.phase !== 'playing') return;
    const p = game.players.find((x) => x.id === id);
    if (!p || !p.alive) return;
    if (action === 'interact') {
      if (p.isGhost) {
        game.lightsOutUntil = Date.now() + 9000;
        p.revealUntil = Date.now() + 2500;
        broadcastToast('Lampu penanda padam. Sesuatu bergerak di antara pohon...', 'ghost');
        return;
      }
      const nearest = closestPersonalTask(p);
      if (nearest && nearest.distance <= 82) {
        if (nearest.task.done) { notifyPlayer(id, 'Tugas di titik ini sudah selesai.', null); return; }
        if (activePuzzles.has(id)) { notifyPlayer(id, 'Selesaikan puzzle yang sedang terbuka.', null); return; }
        activePuzzles.set(id, nearest.task.id);
        const packet = { type: 'PUZZLE_START', task: { ...nearest.task }, station: nearest.station };
        if (id === localId) openPuzzle(packet.task, packet.station);
        else sendToPlayer(id, packet);
      } else {
        notifyPlayer(id, p.isGhost ? 'Dekati pemain lain untuk menghantui.' : 'Tidak ada tugas di dekatmu. Ikuti ikon cahaya.', null);
      }
      return;
    }
    if (action === 'attack') {
      if (!p.isGhost) { notifyPlayer(id, 'Kamu bukan hantu.', null); return; }
      const target = closestSurvivor(p);
      if (!target || target.distance > 78) { notifyPlayer(id, 'Dekati penyintas sebelum menghantui.', null); return; }
      killPlayer(p, target.player);
      return;
    }
    if (action === 'report') {
      const body = nearbyBody(p);
      const camp = getStation('camp');
      const atCamp = !game.emergencyUsed && camp && dist(p, camp) < 90;
      if (body && body.distance < 85) {
        body.player.body.reported = true;
        game.lastKill = { reporter: p.id, body: body.player.id };
        startMeeting(p, `Mayat ${body.player.name} ditemukan.`);
      } else if (atCamp) {
        game.emergencyUsed = true;
        startMeeting(p, `${p.name} memanggil rapat darurat.`);
      } else {
        notifyPlayer(id, 'Dekati mayat atau gunakan rapat darurat di dekat api unggun.', null);
      }
    }
  }
  function notifyPlayer(id, message, sound) {
    if (id === localId) { showToast(message); if (sound) soundEvent(sound); }
    else sendToPlayer(id, { type: 'TOAST', message, sound });
  }
  function broadcastToast(message, sound) {
    showToast(message); if (sound) soundEvent(sound);
    for (const h of lobbyHumans) if (h.id !== localId) sendToPlayer(h.id, { type: 'TOAST', message, sound });
  }
  function killPlayer(ghost, victim) {
    if (!game || !ghost?.alive || !victim?.alive || !ghost.isGhost || victim.isGhost) return;
    victim.alive = false;
    victim.body = { x: victim.x, y: victim.y, reported: false };
    ghost.lastAttack = Date.now();
    ghost.revealUntil = Date.now() + 3600;
    game.lastKill = { ghost: ghost.id, victim: victim.id, time: Date.now() };
    broadcastToast('Ada yang ditemukan tumbang. Jangan abaikan jejaknya.', 'ghost');
    checkVictory();
  }
  function startMeeting(reporter, message) {
    if (game.phase !== 'playing') return;
    game.phase = 'meeting';
    game.meeting = { startedAt: Date.now(), endsAt: Date.now() + 15000, message };
    game.votes = {};
    for (const p of game.players) {
      if (!p.alive) continue;
      if (p.isBot) {
        const eligible = game.players.filter((x) => x.alive && !x.isBot && x.id !== p.id);
        const target = Math.random() < .48 ? choose(eligible.length ? eligible : game.players.filter((x) => x.alive)) : 'skip';
        game.votes[p.id] = typeof target === 'string' ? target : target?.id || 'skip';
      }
    }
    broadcastToast(message || 'Rapat darurat dimulai.', 'meeting');
    lastPhase = '';
  }
  function registerVote(voterId, targetId) {
    if (!game || game.phase !== 'meeting' || !game.meeting) return;
    const voter = game.players.find((p) => p.id === voterId);
    if (!voter || !voter.alive || game.votes[voterId]) return;
    const candidate = targetId === 'skip' ? null : game.players.find((p) => p.id === targetId && p.alive);
    if (targetId !== 'skip' && !candidate) return;
    game.votes[voterId] = targetId === 'skip' ? 'skip' : candidate.id;
    if (voterId === localId) showToast('Vote kamu terkunci.');
    const livingHumans = game.players.filter((p) => p.alive && p.isHuman);
    if (livingHumans.every((p) => !!game.votes[p.id])) resolveMeeting();
  }
  function resolveMeeting() {
    if (!game || game.phase !== 'meeting') return;
    const counts = new Map();
    for (const [voterId, target] of Object.entries(game.votes || {})) {
      const voter = game.players.find((p) => p.id === voterId);
      if (!voter?.alive || target === 'skip') continue;
      counts.set(target, (counts.get(target) || 0) + 1);
    }
    let selected = null, top = 0, tie = false;
    for (const [id, votes] of counts.entries()) {
      if (votes > top) { top = votes; selected = id; tie = false; }
      else if (votes === top) tie = true;
    }
    if (top === 0 || tie) {
      game.phase = 'playing'; game.meeting = null; game.votes = {};
      broadcastToast('Suara terpecah. Tidak ada yang diusir.');
      lastPhase = '';
      return;
    }
    const accused = game.players.find((p) => p.id === selected);
    if (accused && accused.alive) {
      accused.alive = false; accused.exiled = true; accused.body = null;
      if (accused.isGhost) {
        endGame('survivors', `${accused.name} adalah Kuntilanak yang menyamar. Hutan kembali sunyi.`);
        return;
      }
      broadcastToast(`${accused.name} diusir dari rimba. Voting bisa saja salah...`);
    }
    game.phase = 'playing'; game.meeting = null; game.votes = {};
    lastPhase = '';
    checkVictory();
  }
  function finalizeTask(id, taskId) {
    if (!game) return;
    const p = game.players.find((x) => x.id === id);
    if (!p || !p.alive || p.isGhost || activePuzzles.get(id) !== taskId) {
      sendToPlayer(id, { type: 'TASK_RESULT', taskId, ok: false, message: 'Tugas tidak bisa diverifikasi.' });
      return;
    }
    const task = p.tasks.find((t) => t.id === taskId);
    if (!task || task.done) {
      activePuzzles.delete(id);
      sendToPlayer(id, { type: 'TASK_RESULT', taskId, ok: false, message: 'Tugas ini sudah selesai.' });
      return;
    }
    task.done = true;
    task.startedAt = 0; task.finishAt = 0;
    activePuzzles.delete(id);
    if (id === localId) {
      closePuzzle(); soundEvent('success'); showToast('Tugas selesai. Penanda menyala!');
    } else {
      sendToPlayer(id, { type: 'TASK_RESULT', taskId, ok: true });
    }
    checkVictory();
  }
  function checkVictory() {
    if (!game || game.phase === 'ended' || game.phase === 'meeting') return;
    const ghost = game.players.find((p) => p.isGhost);
    const aliveSurvivors = game.players.filter((p) => p.alive && !p.isGhost);
    if (!ghost || !ghost.alive) { endGame('survivors', 'Hantu berhasil diusir. Semua penyintas bisa pulang.'); return; }
    if (aliveSurvivors.length <= 1) { endGame('ghost', 'Kuntilanak menguasai hutan. Tidak ada cukup penyintas yang tersisa.'); return; }
    const pending = aliveSurvivors.some((p) => p.tasks.some((t) => !t.done));
    if (!pending) { endGame('survivors', 'Semua penanda aktif. Jalan keluar dari hutan terbuka.'); return; }
    if (game.timeLeft <= 0) endGame('ghost', 'Waktu habis. Hutan menelan semua jejak.');
  }
  function endGame(winner, reason) {
    if (!game || game.phase === 'ended') return;
    game.phase = 'ended'; game.winner = winner; game.endReason = reason; game.meeting = null;
    activePuzzles.clear(); localPuzzle = null;
    $('puzzleOverlay').classList.add('hidden'); $('meetingOverlay').classList.add('hidden');
    lastPhase = '';
    updateHud(true);
  }

  function updateGame(dt) {
    if (!game || !isHost || game.phase === 'ended') return;
    const step = Math.min(dt, 45) / 1000;
    if (game.phase === 'playing') {
      game.timeLeft -= step;
      for (const p of game.players) {
        if (!p.alive) continue;
        if (p.isHuman) {
          const input = p.id === localId ? localInput : normalizeInput(p.input);
          if (p.id === localId) p.input = input;
          p.x = clamp(p.x + input.x * 170 * step, 40, WORLD.w - 40);
          p.y = clamp(p.y + input.y * 170 * step, 40, WORLD.h - 40);
        } else if (p.isBot) updateBot(p, step);
        if (p.revealUntil && p.revealUntil <= Date.now()) p.revealUntil = 0;
      }
      checkVictory();
    } else if (game.phase === 'meeting') {
      game.timeLeft -= step;
      if (game.meeting && Date.now() >= game.meeting.endsAt) resolveMeeting();
      if (game.timeLeft <= 0 && game.phase !== 'ended') endGame('ghost', 'Waktu habis saat rapat belum menemukan jawaban.');
    }
  }
  function updateBot(bot, step) {
    if (!bot.alive) return;
    const now = Date.now();
    if (bot.isGhost) {
      const target = closestSurvivor(bot);
      if (!target) return;
      const dx = target.player.x - bot.x, dy = target.player.y - bot.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      if (target.distance > 52) {
        bot.x = clamp(bot.x + dx / d * 105 * step, 40, WORLD.w - 40);
        bot.y = clamp(bot.y + dy / d * 105 * step, 40, WORLD.h - 40);
      } else if (now - bot.lastAttack > 18500) {
        killPlayer(bot, target.player);
      }
      return;
    }
    const next = closestPersonalTask(bot);
    if (!next) return;
    const dx = next.station.x - bot.x, dy = next.station.y - bot.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    if (next.distance > 27) {
      bot.x = clamp(bot.x + dx / d * 84 * step, 40, WORLD.w - 40);
      bot.y = clamp(bot.y + dy / d * 84 * step, 40, WORLD.h - 40);
      next.task.startedAt = 0; next.task.finishAt = 0;
    } else {
      if (!next.task.startedAt) {
        next.task.startedAt = now;
        next.task.finishAt = now + rand(8500, 15500);
      } else if (now >= next.task.finishAt) {
        next.task.done = true;
        next.task.startedAt = 0; next.task.finishAt = 0;
      }
    }
  }

  function updateHud(force = false) {
    if (!game || !screens.game.classList.contains('active')) return;
    const me = getPlayer();
    if (!me) return;
    const phase = game.phase;
    if (phase !== lastPhase) {
      if (phase === 'meeting') { openMeeting(); soundEvent('meeting'); }
      if (phase === 'playing') $('meetingOverlay').classList.add('hidden');
      if (phase === 'ended') showResult();
      lastPhase = phase;
    }
    $('gameTimer').textContent = formatTime(game.timeLeft ?? ROUND_SECONDS);
    const survivors = (game.players || []).filter((p) => !p.isGhost);
    let complete = 0, pending = 0;
    if (game.taskStats) {
      complete = game.taskStats.completed || 0;
      pending = game.taskStats.pending || 0;
    } else {
      for (const p of survivors) for (const t of (p.tasks || [])) {
        if (t.done) complete++;
        else if (p.alive) pending++;
      }
    }
    $('taskProgress').textContent = `${complete} / ${complete + pending}`;
    $('taskProgressBar').style.width = `${complete + pending ? complete / (complete + pending) * 100 : 0}%`;
    const roleCard = $('roleCard');
    roleCard.classList.toggle('ghost-role', !!me.isGhost);
    $('roleSymbol').textContent = me.isGhost ? '☠' : '✧';
    $('roleName').textContent = me.isGhost ? 'KUNTILANAK' : 'PENYINTAS';
    $('roleSubtitle').textContent = me.isGhost ? 'Menyamar. Hantui saat ada kesempatan.' : (me.alive ? 'Selesaikan 3 tugas dan tetap waspada.' : 'Kamu tumbang. Amati sisa malam.');
    $('taskCard').classList.toggle('collapsed', taskCardHidden);
    $('taskCardToggle').textContent = taskCardHidden ? '+' : '−';
    const list = $('taskList'); list.innerHTML = '';
    if (me.isGhost) {
      const li = document.createElement('div'); li.className = 'task-empty'; li.textContent = 'Dekati penyintas, tekan HANTUI. Menyamar itu kunci.'; list.appendChild(li);
    } else if (!me.tasks?.length) {
      const li = document.createElement('div'); li.className = 'task-empty'; li.textContent = me.alive ? 'Cari penanda cahaya di sekitar hutan.' : 'Tugasmu berhenti setelah tumbang.'; list.appendChild(li);
    } else {
      for (const t of me.tasks) {
        const row = document.createElement('div'); row.className = `task-item${t.done ? ' done' : ''}`;
        const check = document.createElement('span'); check.className = 'task-check'; check.textContent = t.done ? '✓' : '';
        const text = document.createElement('span'); text.textContent = t.title;
        row.append(check, text); list.appendChild(row);
      }
    }
    const body = nearbyBody(me);
    const task = closestPersonalTask(me);
    let hint = 'Jelajahi hutan dan cari titik cahaya.';
    if (!me.alive) hint = 'Kamu tumbang. Lihat keadaan dan tunggu ronde berakhir.';
    else if (phase === 'meeting') hint = 'Rapat berlangsung. Pilih dengan hati-hati.';
    else if (me.isGhost) {
      const target = closestSurvivor(me);
      hint = target && target.distance < 90 ? `Ada penyintas dekat: ${target.player.name}.` : 'Berbaur dengan kelompok. Jangan sampai ketahuan.';
    } else if (task && task.distance < 85) hint = `${task.station.title} di dekatmu — tekan AKSI untuk puzzle.`;
    else if (body && body.distance < 90) hint = `Mayat ${body.player.name} dekat sini — tekan LAPOR.`;
    else if (!game.emergencyUsed && dist(me, getStation('camp')) < 100) hint = 'Dekat api unggun, kamu bisa memanggil rapat darurat.';
    $('nearbyHint').textContent = hint;
    $('attackBtn').classList.toggle('hidden', !me.isGhost || !me.alive || phase !== 'playing');
    $('interactBtn').disabled = !me.alive || phase !== 'playing';
    $('reportBtn').disabled = !me.alive || phase !== 'playing';
    $('attackBtn').disabled = !me.alive || phase !== 'playing';
    const banner = $('meetingBanner');
    banner.classList.toggle('hidden', phase !== 'meeting');
    if (phase === 'meeting' && game.meeting) $('meetingCountdown').textContent = `${game.meeting.message || 'Voting berlangsung.'} ${formatTime(Math.max(0, (game.meeting.endsAt - Date.now()) / 1000))}`;
    if (force) drawFrame();
  }
  function showResult() {
    $('puzzleOverlay').classList.add('hidden'); $('meetingOverlay').classList.add('hidden');
    const survivorWin = game.winner === 'survivors';
    $('resultSigil').textContent = survivorWin ? '✦' : '☠';
    $('resultSigil').style.background = survivorWin ? '#1e3d32' : '#48252b';
    $('resultSigil').style.color = survivorWin ? 'var(--green)' : 'var(--red)';
    $('resultEyebrow').textContent = survivorWin ? 'PENYINTAS MENANG' : 'KUNTILANAK MENANG';
    $('resultTitle').textContent = survivorWin ? 'Fajar akhirnya datang.' : 'Malam memilih korban.';
    $('resultText').textContent = game.endReason || 'Ronde selesai.';
    const me = getPlayer();
    const ghosts = game.players.filter((p) => p.isGhost).map((p) => p.name).join(', ');
    $('resultStats').innerHTML = `<div class="result-stat"><b>${game.players.filter((p) => p.alive).length}</b><small>MASIH HIDUP</small></div><div class="result-stat"><b>${game.players.filter((p) => !p.isGhost).reduce((n,p)=>n+(p.tasks||[]).filter(t=>t.done).length,0)}</b><small>TUGAS SELESAI</small></div>`;
    if (me?.isGhost) $('resultText').textContent += ' Peranmu: Kuntilanak.';
    else $('resultText').textContent += ` Hantu ronde ini: ${ghosts || 'tidak diketahui'}.`;
    $('againBtn').textContent = isOnline && !isHost ? 'Minta main lagi ↻' : 'Main lagi ↻';
    $('resultOverlay').classList.remove('hidden');
  }

  function openPuzzle(task, station) {
    if (!task || !station || !game) return;
    localPuzzle = { taskId: task.id, taskTitle: task.title, station, mode: choose(['rune', 'wire', 'code']), complete: false };
    $('puzzleOverlay').classList.remove('hidden');
    $('puzzleSymbol').textContent = station.kind === 'shrine' ? 'ᚷ' : station.kind === 'radio' ? '⌁' : station.kind === 'cave' ? '◌' : station.kind === 'pond' ? '☾' : '✧';
    $('puzzleTitle').textContent = task.title;
    $('puzzleFeedback').textContent = '';
    const desc = {
      rune: 'Sambungkan urutan simbol yang benar untuk menyalakan penanda.',
      wire: 'Pasangkan simbol kiri dengan pasangan yang sama di kanan.',
      code: 'Pecahkan kode radio. Hitung angka lalu masukkan hasilnya.',
    };
    $('puzzleDescription').textContent = desc[localPuzzle.mode];
    const content = $('puzzleContent'); content.innerHTML = '';
    if (localPuzzle.mode === 'rune') buildRunePuzzle(content);
    else if (localPuzzle.mode === 'wire') buildWirePuzzle(content);
    else buildCodePuzzle(content);
  }
  function buildRunePuzzle(container) {
    const sequence = Array.from({ length: 4 }, () => choose(RUNES));
    localPuzzle.sequence = sequence;
    localPuzzle.input = [];
    const clue = document.createElement('div'); clue.className = 'rune-clue';
    clue.style.cssText = 'display:flex;gap:8px;justify-content:center;padding:13px 0;color:#dce9d3;font-size:24px;letter-spacing:.08em';
    clue.textContent = sequence.join('  ');
    const note = document.createElement('p'); note.className = 'muted-text'; note.style.textAlign = 'center'; note.textContent = 'Urutan: klik simbol dari kiri ke kanan.';
    const feedback = document.createElement('div'); feedback.style.cssText = 'font-size:10px;text-align:center;color:#91aaa0;margin-top:7px'; feedback.textContent = '0 / 4 simbol';
    const buttons = document.createElement('div'); buttons.className = 'puzzle-buttons';
    shuffle([...RUNES]).forEach((rune) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'rune-btn'; b.textContent = rune;
      b.addEventListener('click', () => {
        if (!localPuzzle || localPuzzle.mode !== 'rune') return;
        const index = localPuzzle.input.length;
        if (rune === localPuzzle.sequence[index]) {
          localPuzzle.input.push(rune); b.classList.add('selected'); feedback.textContent = `${localPuzzle.input.length} / 4 simbol`; tone(470 + index * 80, .07, 'sine', .025);
          if (localPuzzle.input.length === localPuzzle.sequence.length) puzzleSuccess();
        } else {
          localPuzzle.input = []; buttons.querySelectorAll('button').forEach((btn) => btn.classList.remove('selected'));
          feedback.textContent = 'Urutannya meleset. Coba ulang dari awal.'; soundEvent('bad');
        }
      }); buttons.appendChild(b);
    });
    container.append(clue, note, buttons, feedback);
  }
  function buildWirePuzzle(container) {
    const left = shuffle([...WIRE_SIGNS]); const right = shuffle([...WIRE_SIGNS]);
    localPuzzle.left = left; localPuzzle.right = right; localPuzzle.selectedLeft = null; localPuzzle.matches = new Set();
    const layout = document.createElement('div'); layout.className = 'wire-layout';
    const leftCol = document.createElement('div'); leftCol.className = 'wire-col';
    const rightCol = document.createElement('div'); rightCol.className = 'wire-col';
    const lh = document.createElement('h4'); lh.textContent = 'SUMBER'; const rh = document.createElement('h4'); rh.textContent = 'TUJUAN';
    leftCol.appendChild(lh); rightCol.appendChild(rh);
    for (const sign of left) {
      const b = document.createElement('button'); b.className = 'wire-choice'; b.type = 'button'; b.innerHTML = `<span>${sign}</span><small>↗</small>`;
      b.addEventListener('click', () => {
        if (!localPuzzle || localPuzzle.mode !== 'wire' || localPuzzle.matches.has(sign)) return;
        localPuzzle.selectedLeft = sign;
        leftCol.querySelectorAll('.wire-choice').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected'); $('puzzleFeedback').textContent = `Pilih pasangan ${sign} di kolom tujuan.`;
      }); leftCol.appendChild(b);
    }
    for (const sign of right) {
      const b = document.createElement('button'); b.className = 'wire-choice'; b.type = 'button'; b.innerHTML = `<span>${sign}</span><small>⌁</small>`;
      b.addEventListener('click', () => {
        if (!localPuzzle || localPuzzle.mode !== 'wire' || !localPuzzle.selectedLeft || localPuzzle.matches.has(sign)) return;
        if (localPuzzle.selectedLeft === sign) {
          localPuzzle.matches.add(sign); leftCol.querySelectorAll('.wire-choice').forEach((x) => { if (x.textContent.includes(sign)) x.classList.add('matched'); });
          rightCol.querySelectorAll('.wire-choice').forEach((x) => { if (x.textContent.includes(sign)) x.classList.add('matched'); });
          $('puzzleFeedback').textContent = `Pasangan benar · ${localPuzzle.matches.size} / 4`;
          tone(510 + localPuzzle.matches.size * 55, .08, 'sine', .025);
          if (localPuzzle.matches.size === 4) puzzleSuccess();
        } else { $('puzzleFeedback').textContent = 'Kabel salah sambung. Pilih simbol yang sama.'; soundEvent('bad'); }
        localPuzzle.selectedLeft = null; leftCol.querySelectorAll('.wire-choice').forEach((x) => x.classList.remove('selected'));
      }); rightCol.appendChild(b);
    }
    layout.append(leftCol, rightCol); container.appendChild(layout);
  }
  function buildCodePuzzle(container) {
    const a = randint(3, 12), b = randint(2, 9), c = randint(2, 5);
    const answer = (a + b) * c;
    localPuzzle.answer = answer;
    const equation = document.createElement('div'); equation.style.cssText = 'text-align:center;padding:16px 0 18px;font-family:var(--display);font-size:30px;color:#e8ebd8;letter-spacing:-.04em';
    equation.textContent = `(${a} + ${b}) × ${c} = ?`;
    const input = document.createElement('input'); input.className = 'text-input number-input'; input.type = 'number'; input.inputMode = 'numeric'; input.placeholder = 'HASIL KODE'; input.setAttribute('aria-label', 'Jawaban kode');
    const button = document.createElement('button'); button.className = 'btn btn-primary puzzle-submit'; button.type = 'button'; button.textContent = 'Kirim kode →';
    const check = () => {
      if (Number(input.value) === answer) puzzleSuccess();
      else { $('puzzleFeedback').textContent = 'Kode belum tepat. Hitung ulang dengan teliti.'; soundEvent('bad'); input.select(); }
    };
    button.addEventListener('click', check); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    container.append(equation, input, button); setTimeout(() => input.focus({ preventScroll: true }), 80);
  }
  function puzzleSuccess() {
    if (!localPuzzle || localPuzzle.complete) return;
    localPuzzle.complete = true;
    const taskId = localPuzzle.taskId;
    $('puzzleFeedback').textContent = 'Penanda aktif. Bagus!';
    soundEvent('success');
    if (isHost) finalizeTask(localId, taskId);
    else if (hostConnection && hostConnection.open) {
      hostConnection.send({ type: 'TASK_DONE', taskId });
      closePuzzle(); showToast('Puzzle terkunci. Menunggu konfirmasi host...');
    } else { closePuzzle(); showToast('Koneksi terputus. Tugas belum tersimpan.', 2600); }
  }
  function closePuzzle() {
    localPuzzle = null;
    $('puzzleOverlay').classList.add('hidden');
  }

  function openMeeting() {
    if (!game || game.phase !== 'meeting') return;
    const options = $('voteOptions'); options.innerHTML = '';
    const me = getPlayer();
    const targets = game.players.filter((p) => p.alive && p.id !== localId);
    const choiceList = [...targets, { id: 'skip', name: 'Lewati voting', alive: true, isGhost: false }];
    for (const p of choiceList) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'vote-option';
      const isSkip = p.id === 'skip';
      btn.innerHTML = `<span class="vote-avatar">${isSkip ? '↷' : '♙'}</span><span><b></b><small>${isSkip ? 'Tidak ada yang diusir' : 'Pemain di rimba'}</small></span><em>${isSkip ? 'SKIP' : 'VOTE'}</em>`;
      btn.querySelector('b').textContent = p.name;
      btn.addEventListener('click', () => {
        if (game?.meeting?.youVoted || game?.votes?.[localId]) return;
        options.querySelectorAll('.vote-option').forEach((x) => x.classList.remove('selected'));
        btn.classList.add('selected'); registerLocalVote(p.id);
      });
      options.appendChild(btn);
    }
    $('voteStatus').textContent = game.meeting?.youVoted ? 'Vote kamu sudah terkunci.' : 'Pilih satu suara. Pilihan tidak bisa diubah.';
    $('meetingOverlay').classList.remove('hidden');
  }
  function registerLocalVote(target) {
    if (!game || game.phase !== 'meeting') return;
    if (isHost) registerVote(localId, target);
    else if (hostConnection && hostConnection.open) {
      hostConnection.send({ type: 'VOTE', target });
      $('voteStatus').textContent = 'Vote terkirim. Menunggu hasil...';
      $('voteOptions').querySelectorAll('button').forEach((x) => x.disabled = true);
    }
  }

  // Canvas map rendering: all artwork is drawn locally, so no image assets need downloading.
  let trees = [];
  let fireflies = [];
  function seededRandom(seed) {
    let x = seed | 0;
    return () => { x = (x * 1664525 + 1013904223) | 0; return (x >>> 0) / 4294967296; };
  }
  function buildForest() {
    const rnd = seededRandom(32017);
    trees = [];
    for (let i = 0; i < 115; i++) {
      let x = 30 + rnd() * (WORLD.w - 60), y = 30 + rnd() * (WORLD.h - 60);
      const nearStation = STATIONS.some((s) => Math.hypot(s.x - x, s.y - y) < 105);
      if (nearStation) { i--; continue; }
      trees.push({ x, y, size: 18 + rnd() * 24, tone: rnd(), lean: (rnd() - .5) * 9 });
    }
    fireflies = Array.from({ length: 45 }, () => ({ x: rand(60, WORLD.w - 60), y: rand(50, WORLD.h - 50), phase: rand(0, Math.PI * 2), size: rand(1, 2.4) }));
  }
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    renderWidth = Math.max(300, rect.width || window.innerWidth);
    renderHeight = Math.max(240, rect.height || window.innerHeight);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(renderWidth * dpr);
    canvas.height = Math.round(renderHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrame();
  }
  function worldToScreen(x, y) { return { x: x - camera.x, y: y - camera.y }; }
  function drawTree(tree) {
    const x = tree.x - camera.x, y = tree.y - camera.y;
    if (x < -80 || x > renderWidth + 80 || y < -100 || y > renderHeight + 90) return;
    ctx.fillStyle = 'rgba(0,0,0,.23)'; ctx.beginPath(); ctx.ellipse(x + 4, y + tree.size * .55, tree.size * .85, tree.size * .33, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#142d27'; ctx.fillRect(x - 3, y - 2, 7, tree.size * .85);
    const colors = tree.tone < .33 ? ['#183b32', '#214738', '#102b27'] : tree.tone < .66 ? ['#19392e', '#28513a', '#143127'] : ['#1b342d', '#29483a', '#102923'];
    ctx.fillStyle = colors[0]; ctx.beginPath(); ctx.moveTo(x + tree.lean, y - tree.size * 1.5); ctx.lineTo(x + tree.size * .95, y + tree.size * .45); ctx.lineTo(x - tree.size * .95, y + tree.size * .45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = colors[1]; ctx.beginPath(); ctx.moveTo(x + tree.lean - 1, y - tree.size * 1.2); ctx.lineTo(x + tree.size * .62, y + tree.size * .1); ctx.lineTo(x - tree.size * .35, y + tree.size * .12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = colors[2]; ctx.beginPath(); ctx.moveTo(x + tree.lean, y - tree.size * .7); ctx.lineTo(x + tree.size * .8, y + tree.size * .43); ctx.lineTo(x - tree.size * .7, y + tree.size * .43); ctx.closePath(); ctx.fill();
  }
  function drawStation(station) {
    const { x, y } = worldToScreen(station.x, station.y);
    if (x < -100 || x > renderWidth + 100 || y < -100 || y > renderHeight + 100) return;
    const me = getPlayer(); const myTask = me && (me.tasks || []).find((t) => t.stationId === station.id && !t.done);
    const glow = ctx.createRadialGradient(x, y, 3, x, y, station.kind === 'camp' ? 100 : 55);
    glow.addColorStop(0, station.kind === 'camp' ? 'rgba(255,171,98,.23)' : myTask ? 'rgba(179,225,146,.2)' : 'rgba(157,201,155,.07)');
    glow.addColorStop(1, 'rgba(150,210,165,0)'); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 100, 0, Math.PI * 2); ctx.fill();
    if (station.kind === 'camp') {
      ctx.fillStyle = '#4b3529'; ctx.fillRect(x - 28, y + 14, 56, 7); ctx.save(); ctx.translate(x, y + 12); ctx.rotate(.13); ctx.fillStyle = '#7b5034'; ctx.fillRect(-27, -4, 54, 8); ctx.restore();
      ctx.fillStyle = '#f08a4d'; ctx.beginPath(); ctx.moveTo(x, y - 25); ctx.quadraticCurveTo(x + 23, y + 4, x + 3, y + 15); ctx.quadraticCurveTo(x - 19, y + 9, x, y - 25); ctx.fill();
      ctx.fillStyle = '#f9d48d'; ctx.beginPath(); ctx.moveTo(x + 1, y - 13); ctx.quadraticCurveTo(x + 13, y + 5, x + 1, y + 11); ctx.quadraticCurveTo(x - 8, y + 2, x + 1, y - 13); ctx.fill();
    } else if (station.kind === 'radio') {
      ctx.fillStyle = '#334642'; ctx.fillRect(x - 20, y - 13, 40, 28); ctx.fillStyle = '#6f8d78'; ctx.fillRect(x - 14, y - 7, 14, 12); ctx.strokeStyle = '#a8c4a3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 8, y - 9); ctx.lineTo(x + 18, y - 22); ctx.stroke(); ctx.fillStyle = '#e2bc7f'; ctx.beginPath(); ctx.arc(x + 10, y + 5, 3, 0, Math.PI * 2); ctx.fill();
    } else if (station.kind === 'shrine') {
      ctx.strokeStyle = '#9caa8f'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x - 24, y + 21); ctx.lineTo(x - 24, y - 14); ctx.quadraticCurveTo(x, y - 42, x + 24, y - 14); ctx.lineTo(x + 24, y + 21); ctx.stroke(); ctx.strokeStyle = '#526d5a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 31, y + 22); ctx.lineTo(x + 31, y + 22); ctx.stroke();
    } else if (station.kind === 'cave') {
      ctx.fillStyle = '#1a2827'; ctx.beginPath(); ctx.ellipse(x, y + 5, 34, 28, 0, Math.PI, Math.PI * 2); ctx.lineTo(x + 34, y + 24); ctx.lineTo(x - 34, y + 24); ctx.fill(); ctx.strokeStyle = '#556957'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y + 4, 31, Math.PI, Math.PI * 2); ctx.stroke();
    } else if (station.kind === 'pond') {
      ctx.fillStyle = '#173e3c'; ctx.beginPath(); ctx.ellipse(x, y, 43, 26, -.15, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#477b70'; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = '#9cc9ad'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x - 5, y - 3, 25, 9, -.15, .1, Math.PI * 1.15); ctx.stroke();
    } else if (station.kind === 'herbs') {
      for (let i = 0; i < 5; i++) { const hx = x - 25 + i * 12, hy = y + (i % 2) * 4; ctx.strokeStyle = '#557c51'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx, hy + 11); ctx.lineTo(hx, hy - 3); ctx.stroke(); ctx.fillStyle = i % 2 ? '#b8d98b' : '#8dbb83'; ctx.beginPath(); ctx.arc(hx - 3, hy - 5, 5, 0, Math.PI * 2); ctx.arc(hx + 4, hy - 7, 5, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.font = '600 10px DM Sans, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const label = station.kind === 'camp' ? 'POS JAGA' : station.title.toUpperCase();
    ctx.fillStyle = 'rgba(6,17,18,.82)'; roundRect(ctx, x - 42, y + 31, 84, 18, 7); ctx.fill();
    ctx.fillStyle = myTask ? '#c5e6a9' : '#a4bcb0'; ctx.fillText(label, x, y + 35);
    if (myTask) { ctx.strokeStyle = '#c6e5a7'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, 38, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#d8eca8'; ctx.beginPath(); ctx.arc(x + 29, y - 27, 4, 0, Math.PI * 2); ctx.fill(); }
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function drawBody(p) {
    if (!p.body) return;
    const { x, y } = worldToScreen(p.body.x, p.body.y);
    if (x < -40 || x > renderWidth + 40 || y < -40 || y > renderHeight + 40) return;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-.2);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 12, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.isGhost ? '#d6e7d2' : '#9daea0'; roundRect(ctx, -12, -14, 24, 34, 10); ctx.fill();
    ctx.fillStyle = '#8b9e91'; ctx.beginPath(); ctx.arc(0, -14, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d56a65'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8, -2); ctx.lineTo(8, 5); ctx.stroke();
    ctx.restore();
    if (!p.body.reported) { ctx.fillStyle = '#ffb2a4'; ctx.font = '800 9px DM Sans'; ctx.textAlign = 'center'; ctx.fillText('!', x, y - 28); }
  }
  function drawCharacter(p) {
    if (!p.alive) return;
    const x = p.x - camera.x, y = p.y - camera.y;
    if (x < -50 || x > renderWidth + 50 || y < -60 || y > renderHeight + 60) return;
    const own = p.id === localId;
    const revealed = p.revealed || (p.revealUntil && p.revealUntil > Date.now());
    const showGhost = !!p.isGhost && !!revealed;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(1,7,9,.42)'; ctx.beginPath(); ctx.ellipse(0, 13, 18, 7, 0, 0, Math.PI * 2); ctx.fill();
    if (showGhost) {
      // Kuntilanak reveal: a pale hanging silhouette, otherwise she looks like a regular survivor.
      ctx.globalAlpha = .96;
      ctx.fillStyle = '#cfded0'; ctx.beginPath(); ctx.ellipse(0, -16, 13, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#dce5d6'; ctx.beginPath(); ctx.moveTo(-15, -10); ctx.quadraticCurveTo(-19, 9, -16, 21); ctx.lineTo(-8, 17); ctx.lineTo(-1, 23); ctx.lineTo(8, 17); ctx.lineTo(16, 21); ctx.quadraticCurveTo(20, 1, 14, -10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#302d33'; ctx.beginPath(); ctx.ellipse(-4, -18, 1.7, 2.4, 0, 0, Math.PI * 2); ctx.ellipse(4, -18, 1.7, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e7e9dc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, -26); ctx.quadraticCurveTo(-21, -36, -16, -44); ctx.moveTo(-3, -30); ctx.quadraticCurveTo(-5, -42, -1, -46); ctx.moveTo(9, -27); ctx.quadraticCurveTo(19, -36, 17, -43); ctx.stroke();
    } else {
      const color = p.color || '#b9c9a7';
      ctx.fillStyle = color; roundRect(ctx, -12, -8, 24, 26, 9); ctx.fill();
      ctx.fillStyle = '#d7dfc5'; ctx.beginPath(); ctx.ellipse(0, -17, 11.5, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7c9987'; ctx.beginPath(); ctx.arc(0, -19, 12, Math.PI, Math.PI * 2); ctx.lineTo(12, -14); ctx.quadraticCurveTo(0, -8, -12, -14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#243b34'; ctx.beginPath(); ctx.arc(-4, -16, 1.3, 0, Math.PI * 2); ctx.arc(4, -16, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#94ad95'; roundRect(ctx, -9, 15, 7, 10, 3); ctx.fill(); roundRect(ctx, 2, 15, 7, 10, 3); ctx.fill();
      ctx.strokeStyle = '#172a26'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(-18, 6); ctx.moveTo(12, -2); ctx.lineTo(18, 6); ctx.stroke();
      if (own) { ctx.strokeStyle = 'rgba(197,231,166,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, -4, 21, 31, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (own && game?.phase === 'playing' && p.alive) {
      const glow = ctx.createRadialGradient(0, -5, 3, 0, -5, 58); glow.addColorStop(0, 'rgba(236,228,163,.13)'); glow.addColorStop(1, 'rgba(236,228,163,0)'); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, -5, 58, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.font = own ? '700 10px DM Sans, sans-serif' : '600 9px DM Sans, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const name = p.name || 'Penjelajah';
    ctx.fillStyle = 'rgba(3,13,15,.73)'; roundRect(ctx, x - Math.max(22, name.length * 3.2) - 6, y + 25, Math.max(44, name.length * 6.4) + 12, 17, 6); ctx.fill();
    ctx.fillStyle = own ? '#eff3d9' : '#bccdc0'; ctx.fillText(name, x, y + 33.5);
  }
  function drawFrame() {
    if (!ctx || !screens.game.classList.contains('active')) return;
    const w = renderWidth, h = renderHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const me = getPlayer();
    if (me) {
      camera.x = clamp(me.x - w / 2, 0, WORLD.w - w);
      camera.y = clamp(me.y - h / 2, 0, WORLD.h - h);
    } else { camera.x = 0; camera.y = 0; }
    const bg = ctx.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#102925'); bg.addColorStop(.45, '#10231f'); bg.addColorStop(1, '#091716'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    // Mossy texture, repeated in world coordinates so the map feels continuous.
    const cell = 82;
    const sx = Math.floor(camera.x / cell) * cell, sy = Math.floor(camera.y / cell) * cell;
    for (let wx = sx; wx < camera.x + w + cell; wx += cell) {
      for (let wy = sy; wy < camera.y + h + cell; wy += cell) {
        const n = Math.abs(Math.sin(wx * .012 + wy * .027) * 10000) % 1;
        ctx.fillStyle = n > .5 ? 'rgba(79,113,76,.055)' : 'rgba(7,18,16,.07)';
        ctx.beginPath(); ctx.ellipse(wx - camera.x + cell / 2, wy - camera.y + cell / 2, cell * .53, cell * .38, n, 0, Math.PI * 2); ctx.fill();
      }
    }
    // A winding trail between the landmark areas.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#26382d'; ctx.lineWidth = 80; ctx.beginPath();
    ctx.moveTo(405, 285); ctx.bezierCurveTo(540, 370, 570, 475, 800, 555); ctx.bezierCurveTo(990, 620, 1120, 680, 1280, 775); ctx.bezierCurveTo(1180, 910, 970, 885, 835, 950); ctx.moveTo(800, 555); ctx.bezierCurveTo(650, 640, 420, 700, 315, 820); ctx.moveTo(800, 555); ctx.bezierCurveTo(920, 390, 1100, 310, 1240, 265); ctx.stroke();
    ctx.strokeStyle = 'rgba(88,111,76,.18)'; ctx.lineWidth = 3; ctx.stroke();
    // Pond surface behind the landmarks.
    const pond = worldToScreen(1280, 775); ctx.fillStyle = '#0b2526'; ctx.beginPath(); ctx.ellipse(pond.x, pond.y, 70, 45, -.18, 0, Math.PI * 2); ctx.fill();
    for (const tree of trees) drawTree(tree);
    // A few roots and scattered stones provide texture without blocking movement.
    for (let i = 0; i < 12; i++) {
      const rx = 180 + i * 107, ry = 190 + ((i * 131) % 700), x = rx - camera.x, y = ry - camera.y;
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
      ctx.fillStyle = '#33473a'; ctx.beginPath(); ctx.ellipse(x, y, 8 + (i % 3) * 3, 4 + (i % 2) * 2, i * .3, 0, Math.PI * 2); ctx.fill();
    }
    for (const station of STATIONS) drawStation(station);
    if (game?.players) for (const p of game.players) drawBody(p);
    // Darken the perimeter while keeping the local lantern readable.
    const meScreen = me ? { x: me.x - camera.x, y: me.y - camera.y - 8 } : { x: w / 2, y: h / 2 };
    const radius = Math.min(440, Math.max(260, Math.min(w, h) * .66));
    const fog = ctx.createRadialGradient(meScreen.x, meScreen.y, radius * .12, meScreen.x, meScreen.y, radius);
    fog.addColorStop(0, 'rgba(0,6,7,0)'); fog.addColorStop(.52, 'rgba(0,7,8,.12)'); fog.addColorStop(1, 'rgba(0,5,7,.74)');
    ctx.fillStyle = fog; ctx.fillRect(0, 0, w, h);
    const now = performance.now() / 1000;
    for (const f of fireflies) {
      const x = f.x - camera.x, y = f.y - camera.y;
      if (x < 0 || x > w || y < 0 || y > h) continue;
      const alpha = .18 + (Math.sin(now * 1.8 + f.phase) + 1) * .22;
      ctx.globalAlpha = alpha; ctx.fillStyle = '#d7ee9b'; ctx.shadowColor = '#c7e88a'; ctx.shadowBlur = 7; ctx.beginPath(); ctx.arc(x, y, f.size, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (game?.players) for (const p of game.players) drawCharacter(p);
    if (game?.lightsOutUntil && game.lightsOutUntil > Date.now()) {
      ctx.fillStyle = 'rgba(0,3,5,.45)'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c9ddaf'; ctx.font = '800 10px DM Sans'; ctx.textAlign = 'center'; ctx.fillText('PENANDA PADAM', w / 2, h * .28);
    }
  }

  function performLocalAction(action) {
    if (!game || game.phase !== 'playing') return;
    if (isHost) handleAction(localId, action);
    else if (hostConnection && hostConnection.open) hostConnection.send({ type: 'ACTION', action });
  }
  function localMovement() {
    let x = joystickInput.x, y = joystickInput.y;
    if (keys.has('w') || keys.has('arrowup')) y -= 1;
    if (keys.has('s') || keys.has('arrowdown')) y += 1;
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    localInput = normalizeInput({ x, y });
  }
  function gameTick(time) {
    const dt = lastFrameAt ? Math.min(time - lastFrameAt, 50) : 16;
    lastFrameAt = time;
    if (game && screens.game.classList.contains('active')) {
      localMovement();
      if (isHost) {
        updateGame(dt);
        if (isOnline && Date.now() - lastSnapshotAt > 100) { sendSnapshot(); lastSnapshotAt = Date.now(); }
      } else if (isOnline && hostConnection && hostConnection.open && Date.now() - lastInputSendAt > 45) {
        hostConnection.send({ type: 'INPUT', input: localInput }); lastInputSendAt = Date.now();
      }
      if (Date.now() - latestHudAt > 180) { updateHud(false); latestHudAt = Date.now(); }
      drawFrame();
    }
    requestAnimationFrame(gameTick);
  }

  function setupJoystick() {
    const base = $('joystick'), knob = $('joystickKnob');
    const reset = () => { joystickPointer = null; joystickInput = { x: 0, y: 0 }; localInput = { x: 0, y: 0 }; knob.style.transform = 'translate(0,0)'; };
    function update(e) {
      if (joystickPointer !== e.pointerId) return;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const max = rect.width * .34;
      const mag = Math.hypot(dx, dy);
      if (mag > max) { dx = dx / mag * max; dy = dy / mag * max; }
      joystickInput = normalizeInput({ x: dx / max, y: dy / max });
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    }
    base.addEventListener('pointerdown', (e) => { e.preventDefault(); startAudio(); joystickPointer = e.pointerId; base.setPointerCapture?.(e.pointerId); update(e); });
    base.addEventListener('pointermove', update);
    base.addEventListener('pointerup', (e) => { if (joystickPointer === e.pointerId) reset(); });
    base.addEventListener('pointercancel', reset);
  }

  $('soloBtn').addEventListener('click', () => { soundEvent('click'); startSolo(); });
  $('createBtn').addEventListener('click', () => { soundEvent('click'); createRoom(); });
  $('joinBtn').addEventListener('click', () => { soundEvent('click'); joinRoom(); });
  $('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('soundToggle').addEventListener('click', () => {
    soundOn = !soundOn; $('soundLabel').textContent = soundOn ? 'ON' : 'OFF';
    if (soundOn) { startAudio(); soundEvent('success'); }
  });
  $('copyCodeBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(roomCode); $('copyCodeBtn').textContent = 'Tersalin ✓'; setTimeout(() => $('copyCodeBtn').textContent = 'Salin kode', 1600); }
    catch (_) { window.prompt('Salin kode room ini:', roomCode); }
  });
  $('startBtn').addEventListener('click', () => { if (isHost) { soundEvent('click'); startGame(); } });
  $('lobbyBackBtn').addEventListener('click', returnHome);
  $('leaveRoomBtn').addEventListener('click', returnHome);
  $('gameExitBtn').addEventListener('click', () => {
    if (isOnline && isHost) { returnHome(); return; }
    if (isOnline && hostConnection?.open) { hostConnection.send({ type: 'LEAVE' }); }
    returnHome();
  });
  $('interactBtn').addEventListener('click', () => { soundEvent('click'); performLocalAction('interact'); });
  $('reportBtn').addEventListener('click', () => { soundEvent('click'); performLocalAction('report'); });
  $('attackBtn').addEventListener('click', () => { soundEvent('click'); performLocalAction('attack'); });
  $('taskCardToggle').addEventListener('click', () => { taskCardHidden = !taskCardHidden; $('taskCard').classList.toggle('collapsed', taskCardHidden); $('taskCardToggle').textContent = taskCardHidden ? '+' : '−'; });
  $('closePuzzleBtn').addEventListener('click', () => {
    if (localPuzzle) {
      if (isHost) activePuzzles.delete(localId);
      else if (hostConnection && hostConnection.open) hostConnection.send({ type: 'PUZZLE_CANCEL', taskId: localPuzzle.taskId });
    }
    closePuzzle();
  });
  $('againBtn').addEventListener('click', () => {
    if (isOnline && !isHost) {
      if (hostConnection?.open) hostConnection.send({ type: 'REMATCH_REQUEST' });
      $('resultText').textContent = 'Permintaan main lagi dikirim ke host.';
      return;
    }
    if (isOnline && isHost) startGame(); else startSolo();
  });
  $('resultMenuBtn').addEventListener('click', returnHome);

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key) && screens.game.classList.contains('active')) e.preventDefault();
    keys.add(key);
    if (!screens.game.classList.contains('active') || e.repeat) return;
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
    if (key === 'e') performLocalAction('interact');
    if (key === 'q') performLocalAction('attack');
    if (key === 'r') performLocalAction('report');
    if (key === 'escape' && ! $('puzzleOverlay').classList.contains('hidden')) closePuzzle();
  }, { passive: false });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { keys.clear(); joystickInput = { x: 0, y: 0 }; localInput = { x: 0, y: 0 }; });
  window.addEventListener('resize', resizeCanvas);

  buildForest(); setupJoystick();
  requestAnimationFrame(gameTick);
})();
