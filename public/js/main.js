import { socket }         from './socket.js';
import { showScreen }     from './router.js';
import { TimerBar }       from './timer.js';
import { showToast }      from './toast.js';
import { sounds, toggleMute } from './sounds.js';
import { DrawingTool, buildToolbar } from './canvas/tools.js';
import { setupCanvas }    from './canvas/canvasCore.js';
import { exportCanvas, displayImage } from './canvas/export.js';
import { initInAppGuard } from './inapp.js';

// ─── State ───────────────────────────────────────────────────────────────────
let myPlayerId   = null;
let hostId       = null;
let players      = [];
let timerBar     = null;
let drawTool     = null;
let revealChains = [];
let revealChainIdx = 0;
let revealEntryIdx = 0;
let lastSubmission = null;   // { type, content } — 타이머 만료 자동 제출에 사용
let currentPhase = null;     // 현재 게임 페이즈 추적
let inRoom = false;          // 방 입장 여부 (뒤로가기 차단용)

// 방 코드: URL에서 시작값을 읽되, 서버가 알려주는 코드로 항상 덮어쓴다.
let roomCode = window.location.pathname.split('/').pop().toUpperCase();

// 서버가 알려준 방 코드를 단일 출처로 적용 (모든 사람이 같은 코드를 보게 함)
function setRoomCode(code) {
  if (!code) return;
  roomCode = code.toUpperCase();
  sessionStorage.setItem('roomCode', roomCode);
  history.replaceState(null, '', `/room/${roomCode}`);
  document.querySelectorAll('.room-code-badge').forEach(el => el.textContent = roomCode);
  const lobbyCode = document.getElementById('lobby-code');
  if (lobbyCode) lobbyCode.textContent = roomCode;
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initInAppGuard(); // 카톡 등 인앱 브라우저면 외부 브라우저 안내
  bindUI();
  bindAdminUI();
  setupNavGuard();
  init();
});

function init() {
  document.querySelectorAll('.room-code-badge').forEach(el => {
    el.textContent = roomCode !== 'NEW' ? roomCode : '------';
  });

  const pendingAction = sessionStorage.getItem('pendingAction');
  const pendingNick   = sessionStorage.getItem('pendingNickname');
  const pendingCode   = sessionStorage.getItem('pendingCode');
  sessionStorage.removeItem('pendingAction');
  sessionStorage.removeItem('pendingNickname');
  sessionStorage.removeItem('pendingCode');

  if (pendingAction === 'create' && pendingNick) {
    socket.emit('create_room', { nickname: pendingNick });
    showScreen('create');
    const el = document.getElementById('create-nickname');
    if (el) el.value = pendingNick;
    return;
  }
  if (pendingAction === 'join' && pendingNick) {
    socket.emit('join_room', { roomCode, nickname: pendingNick });
    showScreen('join');
    const nEl = document.getElementById('join-nickname');
    const cEl = document.getElementById('join-room-code');
    if (nEl) nEl.value = pendingNick;
    if (cEl && pendingCode) cEl.value = pendingCode;
    return;
  }

  const savedId   = sessionStorage.getItem('playerId');
  const savedRoom = sessionStorage.getItem('roomCode');
  if (savedId && savedRoom === roomCode) {
    socket.emit('reconnect_attempt', { playerId: savedId, roomCode });
    return;
  }

  showScreen(roomCode === 'NEW' ? 'create' : 'join');
  const codeEl = document.getElementById('join-room-code');
  if (codeEl && roomCode !== 'NEW') codeEl.value = roomCode;
}

// ─── Draft autosave (만료 레이스 방지) ──────────────────────────────────────────
let _draftTimer = null;
function scheduleDraft(getContent, delay = 1000) {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(() => {
    try {
      const c = getContent();
      if (typeof c === 'string' && c.length) socket.emit('save_draft', { content: c });
    } catch (_) {}
  }, delay);
}

// ─── Timer ───────────────────────────────────────────────────────────────────
function initTimer(seconds, fillId, labelId, onExpire) {
  const fill  = document.getElementById(fillId);
  const label = document.getElementById(labelId);
  if (fill) timerBar = new TimerBar(fill, label, seconds, onExpire);
}

let _lastTickSecond = -1;
socket.on('timer_tick', ({ secondsLeft }) => {
  timerBar?.sync(secondsLeft);
  if (secondsLeft <= 10 && secondsLeft !== _lastTickSecond && secondsLeft > 0) {
    sounds.tick();
    _lastTickSecond = secondsLeft;
  }
  // 어드민 패널에 남은 시간 표시
  const el = document.getElementById('admin-timer-display');
  if (el) el.textContent = `남은 시간: ${secondsLeft}초`;
});

// ─── 라운드 정보 ─────────────────────────────────────────────────────────────
socket.on('round_info', ({ round, maxRounds, phase }) => {
  const el = document.getElementById('round-indicator');
  if (!el) return;
  const phaseLabel = { WRITING: '제시어', DRAWING: '그림', GUESSING: '유추' }[phase] || phase;
  const exchangeNum = Math.ceil(round / 2);
  const totalExchanges = Math.floor((maxRounds - 1) / 2);
  if (phase === 'WRITING') {
    el.textContent = '제시어 입력 중';
  } else {
    el.textContent = `${phaseLabel} ${exchangeNum} / ${totalExchanges}`;
  }
  el.style.display = 'block';
  currentPhase = phase;
  refreshAdminPlayerList(); // 게임 중 스킵 버튼 갱신
});

// ─── 일시정지 / 재개 ──────────────────────────────────────────────────────────
socket.on('game_paused', ({ secondsLeft }) => {
  timerBar?.sync(secondsLeft);
  showPauseBanner(true);
  const btn = document.getElementById('admin-pause-btn');
  if (btn) btn.textContent = '▶ 재개';
  sounds.error();
});

socket.on('game_resumed', ({ secondsLeft }) => {
  timerBar?.sync(secondsLeft);
  showPauseBanner(false);
  const btn = document.getElementById('admin-pause-btn');
  if (btn) btn.textContent = '⏸ 일시정지';
  sounds.submit();
});

function showPauseBanner(show) {
  const el = document.getElementById('pause-banner');
  if (el) el.style.display = show ? 'flex' : 'none';
}

// ─── 공지 ────────────────────────────────────────────────────────────────────
socket.on('announcement', ({ text }) => {
  const overlay = document.getElementById('announcement-overlay');
  const msg     = document.getElementById('announcement-text');
  if (!overlay || !msg) return;
  msg.textContent = text;
  overlay.style.display = 'flex';
  sounds.phase();
  setTimeout(() => overlay.style.display = 'none', 5000);
});

// ─── 게임 시작 카운트다운 (3·2·1·Start!) ────────────────────────────────────────
socket.on('game_starting', () => { sounds.start(); runCountdown(); });

function runCountdown() {
  const overlay = document.getElementById('countdown-overlay');
  const num     = document.getElementById('countdown-number');
  if (!overlay || !num) return;
  overlay.style.display = 'flex';
  const seq = ['3', '2', '1', 'Start!'];
  let i = 0;
  const tick = () => {
    num.textContent = seq[i];
    num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop');
    if (i < 3) sounds.tick(); else sounds.phase();
    i++;
    if (i < seq.length) setTimeout(tick, 800);
    else setTimeout(() => { overlay.style.display = 'none'; }, 700);
  };
  tick();
}

// ─── 신규 관리 이벤트 ────────────────────────────────────────────────────────────
socket.on('host_changed', ({ hostId: hid, nickname }) => {
  hostId = hid;
  if (hid === myPlayerId) {
    showToast('당신이 방장이 되었습니다 👑', 'success');
  } else {
    showToast(`${esc(nickname)}님이 방장이 되었습니다.`);
    // 더 이상 방장이 아니면 관리 패널을 자동으로 닫는다
    document.getElementById('admin-panel')?.classList.add('closed');
  }
  renderPlayers(players);
  updateHostUI();
});

socket.on('lock_changed', ({ locked }) => {
  const btn = document.getElementById('admin-lock-btn');
  if (btn) btn.textContent = locked ? '🔓 입장 잠금 해제' : '🔒 입장 잠그기';
  showToast(locked ? '입장을 잠갔습니다.' : '입장 잠금을 해제했습니다.', 'success');
});

socket.on('autoadvance_changed', ({ enabled }) => {
  const btn = document.getElementById('admin-autoadvance-btn');
  if (btn) btn.textContent = enabled ? '⏩ 자동 진행: 켜짐' : '⏸ 자동 진행: 꺼짐';
});

socket.on('all_ready', ({ players: list }) => { renderPlayers(list); });
socket.on('order_shuffled', ({ players: list }) => { renderPlayers(list); showToast('순서를 섞었습니다.', 'success'); });

// 닉네임 변경 — 모두에게 알림
socket.on('player_renamed', ({ playerId, oldNickname, nickname, players: list }) => {
  if (playerId === myPlayerId) { showToast(`내 닉네임이 "${esc(nickname)}"(으)로 변경되었습니다.`, 'success'); sounds.ready(); }
  else showToast(`"${esc(oldNickname)}" → "${esc(nickname)}" 닉네임이 변경되었습니다.`);
  renderPlayers(list);
});

// ─── 재접속 & 이탈 방지 ──────────────────────────────────────────────────────────
let _firstConnect = true;
socket.on('connect', () => {
  if (_firstConnect) { _firstConnect = false; return; } // 최초 연결은 init()이 처리
  const savedId   = sessionStorage.getItem('playerId');
  const savedRoom = sessionStorage.getItem('roomCode');
  if (savedId && savedRoom) {
    socket.emit('reconnect_attempt', { playerId: savedId, roomCode: savedRoom });
  }
});

// 백그라운드 → 복귀 시 소켓이 끊겨 있으면 즉시 재연결
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && socket.disconnected) socket.connect();
});

// 뒤로가기 / 위로 스와이프(새로고침) 차단
function setupNavGuard() {
  history.pushState({ drawlink: true }, '', location.href);
  window.addEventListener('popstate', () => {
    if (inRoom) {
      history.pushState({ drawlink: true }, '', location.href);
      showToast('게임 중에는 뒤로 갈 수 없어요', 'error');
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (inRoom) { e.preventDefault(); e.returnValue = ''; return ''; }
  });
}

// ─── Lobby helpers ────────────────────────────────────────────────────────────
function renderPlayers(list) {
  players = list;
  const grid    = document.getElementById('player-grid');
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = list.length;
  if (!grid) return;

  grid.innerHTML = list.map(p => {
    const isHost  = p.id === hostId;
    const isReady = p.ready || isHost;
    return `
      <div class="player-card ${isReady ? 'ready' : ''}" data-id="${p.id}">
        <div class="ready-dot ${isReady ? 'ready' : ''}"></div>
        <div style="flex:1;min-width:0">
          <div class="player-name">${esc(p.nickname)}${isHost ? ' 👑' : ''}</div>
          <div class="ready-status">${isReady ? '준비됨' : '대기중'}</div>
        </div>
      </div>`;
  }).join('');

  refreshAdminPlayerList();
  updateHostUI();
}

function updateHostUI() {
  const isHost = myPlayerId === hostId;
  document.getElementById('start-btn').style.display      = isHost ? 'block' : 'none';
  document.getElementById('ready-btn').style.display      = isHost ? 'none'  : 'block';
  document.getElementById('admin-toggle').style.display   = isHost ? 'flex'  : 'none';
}

// ─── Socket: room events ──────────────────────────────────────────────────────
socket.on('room_created', ({ roomCode: code, playerId, players: list, hostId: hid }) => {
  myPlayerId = playerId; hostId = hid; inRoom = true;
  sessionStorage.setItem('playerId', playerId);
  setRoomCode(code);
  renderPlayers(list);
  showScreen('lobby');
});

socket.on('join_ok', ({ roomCode: code, playerId, players: list, hostId: hid }) => {
  myPlayerId = playerId; hostId = hid; inRoom = true;
  sessionStorage.setItem('playerId', playerId);
  setRoomCode(code || roomCode); // 서버가 알려준 코드를 우선 사용
  renderPlayers(list);
  showScreen('lobby');
});

socket.on('join_error', ({ message }) => {
  showToast(message, 'error'); sounds.error();
  const errEl = document.getElementById('join-error');
  if (errEl) errEl.textContent = message;
});

socket.on('player_joined', ({ player }) => {
  players.push(player); renderPlayers(players); sounds.join();
});

socket.on('player_left', ({ playerId, newHostId }) => {
  players = players.filter(p => p.id !== playerId);
  if (newHostId) {
    hostId = newHostId;
    if (newHostId === myPlayerId) showToast('당신이 방장이 되었습니다.', 'success');
  }
  renderPlayers(players); sounds.leave();
});

socket.on('player_rejoined',  ({ nickname })          => showToast(`${esc(nickname)}님이 재접속했습니다.`));

socket.on('player_kicked', ({ playerId, nickname }) => {
  players = players.filter(p => p.id !== playerId);
  renderPlayers(players);
  showToast(`${esc(nickname)}님이 퇴장되었습니다.`); sounds.kick();
});

socket.on('kicked', () => {
  sessionStorage.removeItem('playerId'); sessionStorage.removeItem('roomCode');
  showToast('방에서 퇴장되었습니다.', 'error'); sounds.kick();
  setTimeout(() => window.location.href = '/', 2000);
});

socket.on('ready_update', ({ playerId, ready }) => {
  const p = players.find(x => x.id === playerId);
  if (p) p.ready = ready;
  const card = document.querySelector(`.player-card[data-id="${playerId}"]`);
  if (!card) return;
  card.classList.toggle('ready', ready);
  card.querySelector('.ready-dot').classList.toggle('ready', ready);
  card.querySelector('.ready-status').textContent = ready ? '준비됨' : '대기중';
  if (ready) sounds.ready();
});

socket.on('start_error', ({ message }) => { showToast(message, 'error'); sounds.error(); });

socket.on('reconnect_ok', ({ roomCode: code, phase, players: list, hostId: hid, myPlayerId: pid,
                             assignment, secondsLeft, chains, paused }) => {
  myPlayerId = pid; hostId = hid; players = list; inRoom = true;
  sessionStorage.setItem('playerId', pid);
  setRoomCode(code || roomCode);

  if (phase === 'LOBBY') {
    renderPlayers(list); showScreen('lobby');
  } else if (phase === 'WRITING') {
    showWritingScreen(secondsLeft);
    if (paused) showPauseBanner(true);
  } else if (phase === 'DRAWING') {
    if (assignment) showDrawingScreen(assignment.content, secondsLeft);
    else showWaitingScreen();
    if (paused) showPauseBanner(true);
  } else if (phase === 'GUESSING') {
    if (assignment) showGuessingScreen(assignment.content, secondsLeft);
    else showWaitingScreen();
    if (paused) showPauseBanner(true);
  } else if (phase === 'REVEAL') {
    startReveal(chains);
  }
  updateHostUI();
});

socket.on('reconnect_fail', ({ message }) => {
  sessionStorage.removeItem('playerId'); sessionStorage.removeItem('roomCode');
  showToast(message, 'error');
  showScreen(roomCode === 'NEW' ? 'create' : 'join');
});

socket.on('lobby_reset', ({ players: list, hostId: hid }) => {
  hostId = hid;
  const rb = document.getElementById('ready-btn');
  if (rb) { rb.dataset.ready = 'false'; rb.textContent = '준비 완료!'; rb.classList.remove('btn-dark'); rb.classList.add('btn-ghost'); }
  const ri = document.getElementById('round-indicator');
  if (ri) ri.style.display = 'none';
  showPauseBanner(false);
  renderPlayers(list);
  showAdminSection('lobby');
  showScreen('lobby');
});

// ─── Socket: phases ───────────────────────────────────────────────────────────
socket.on('phase_writing',  ({ timeLimit })            => { sounds.phase(); showWritingScreen(timeLimit);         });
socket.on('phase_drawing',  ({ timeLimit, prompt })    => { sounds.phase(); showDrawingScreen(prompt, timeLimit); });
socket.on('phase_guessing', ({ timeLimit, imageData }) => { sounds.phase(); showGuessingScreen(imageData, timeLimit); });
socket.on('phase_reveal',   ({ chains })               => { sounds.reveal(); startReveal(chains);                });
socket.on('submission_ok',  ()                         => showWaitingScreen());
socket.on('submission_count', ({ submitted, total })  => {
  const el = document.getElementById('submitted-count');
  if (el) el.innerHTML = `<strong>${submitted}</strong> / ${total}명 제출 완료`;
});

// ─── Screen: Writing ──────────────────────────────────────────────────────────
function showWritingScreen(timeLimit) {
  currentPhase = 'WRITING';
  const input = document.getElementById('writing-input');
  const btn   = document.getElementById('writing-submit');
  if (lastSubmission?.type === 'word') input.value = lastSubmission.content;
  else input.value = '';
  document.getElementById('writing-charcount').textContent = `${input.value.length} / 40`;
  btn.disabled = input.value.length === 0;
  showPauseBanner(false);
  showAdminSection('game');
  showScreen('writing');

  initTimer(timeLimit, 'writing-timer-fill', 'writing-timer-label', () => {
    // ★ 타이머 만료 시 현재 내용 자동 제출
    const text = input.value.trim();
    if (!btn.disabled || text) {  // 아직 제출 안 했으면
      lastSubmission = { type: 'word', content: text || '???' };
      socket.emit('submit_word', { text: text || '???' });
    }
    btn.disabled = true;
    showWaitingScreen();
  });
}

// ─── Screen: Drawing ──────────────────────────────────────────────────────────
function showDrawingScreen(prompt, timeLimit) {
  currentPhase = 'DRAWING';
  document.getElementById('draw-prompt-word').textContent =
    (!prompt || prompt === '__blank__') ? '???' : prompt;
  const submitBtn = document.getElementById('draw-submit');
  submitBtn.disabled = true;

  // ★ 캔버스를 측정하려면 먼저 화면을 보여줘야 한다 (display:none이면 크기가 0)
  showPauseBanner(false);
  showAdminSection('game');
  showScreen('drawing');

  const canvas = document.getElementById('draw-canvas');
  const ctx    = canvas.getContext('2d');
  drawTool = new DrawingTool(canvas, ctx, () => {
    submitBtn.disabled = !drawTool.hasStrokes();
    // 그릴 때마다 임시 저장 (시간 만료/이탈 시 그림 유실 방지)
    scheduleDraft(() => exportCanvas(canvas), 1500);
  });

  // ★ 툴바를 먼저 채워 레이아웃을 확정한 뒤에 캔버스를 측정해야
  //    캔버스 크기가 정확해진다 (안 그러면 측정 후 툴바가 자리를 차지해 캔버스가 찌그러짐)
  buildToolbar(document.getElementById('toolbar'), drawTool);
  setupCanvas(canvas); // 이 시점에 실제 표시 크기로 비트맵 설정 + 흰 배경

  if (lastSubmission?.type === 'drawing' && lastSubmission.content) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height); // 새 캔버스 크기에 맞춰 복원
      drawTool.history.push(canvas.toDataURL('image/png'));
      submitBtn.disabled = false;
    };
    img.src = lastSubmission.content;
  }

  initTimer(timeLimit, 'drawing-timer-fill', 'drawing-timer-label', () => {
    // ★ 타이머 만료 시 현재 그림 자동 제출
    if (!submitBtn.disabled) {
      const img = exportCanvas(canvas);
      lastSubmission = { type: 'drawing', content: img };
      socket.emit('submit_drawing', { imageData: img });
    } else {
      // 아무것도 안 그렸으면 빈 캔버스 제출
      const img = exportCanvas(canvas);
      lastSubmission = { type: 'drawing', content: img };
      socket.emit('submit_drawing', { imageData: img });
    }
    submitBtn.disabled = true;
    showWaitingScreen();
  });
}

// ─── Screen: Guessing ─────────────────────────────────────────────────────────
function showGuessingScreen(imageData, timeLimit) {
  currentPhase = 'GUESSING';
  displayImage(imageData, document.getElementById('guess-image-wrap'));
  const input = document.getElementById('guess-input');
  const btn   = document.getElementById('guess-submit');
  if (lastSubmission?.type === 'guess') input.value = lastSubmission.content;
  else input.value = '';
  document.getElementById('guess-charcount').textContent = `${input.value.length} / 40`;
  btn.disabled = input.value.length === 0;
  showPauseBanner(false);
  showAdminSection('game');
  showScreen('guessing');

  initTimer(timeLimit, 'guessing-timer-fill', 'guessing-timer-label', () => {
    // ★ 타이머 만료 시 현재 내용 자동 제출
    const text = input.value.trim();
    lastSubmission = { type: 'guess', content: text || '???' };
    socket.emit('submit_guess', { text: text || '???' });
    btn.disabled = true;
    showWaitingScreen();
  });
}

function showWaitingScreen() {
  currentPhase = 'WAITING';
  document.getElementById('submitted-count').innerHTML = '';
  showScreen('waiting');
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
socket.on('chat_broadcast', ({ nickname, text, isHost }) => {
  sounds.chat();
  appendChat('lobby-messages',  nickname, text, isHost);
  appendChat('reveal-messages', nickname, text, isHost);
});

function appendChat(listId, nickname, text, isHost) {
  const list = document.getElementById(listId);
  if (!list) return;
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="cn ${isHost ? 'host' : ''}">${esc(nickname)}</span><span class="ct">${esc(text)}</span>`;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

function sendChat(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat_message', { text });
  input.value = '';
}

// ─── Reveal ───────────────────────────────────────────────────────────────────
function startReveal(chains) {
  revealChains   = chains;
  revealChainIdx = 0;
  revealEntryIdx = 0;
  showAdminSection('reveal');
  showScreen('reveal');
  renderRevealChain(0);
}

socket.on('reveal_action', ({ type }) => {
  if (type === 'next_entry')       { sounds.nextEntry(); revealNextEntry(); }
  else if (type === 'next_chain')  { sounds.phase(); renderRevealChain(revealChainIdx + 1); }
  else if (type === 'play_again')  { socket.emit('play_again'); }
});

function renderRevealChain(idx) {
  if (idx >= revealChains.length) return;
  revealChainIdx = idx;
  revealEntryIdx = 0;
  const chain = revealChains[idx];
  if (!chain) return;

  document.getElementById('reveal-chain-title').innerHTML =
    `<span>${esc(chain.ownerNickname)}</span>의 이야기`;
  document.getElementById('reveal-entries').innerHTML = '';
  document.getElementById('reveal-indicator').textContent =
    `${idx + 1} / ${revealChains.length}`;

  const dots = document.getElementById('chain-dots');
  dots.innerHTML = revealChains.map((_, i) =>
    `<div class="chain-dot ${i === idx ? 'active' : ''}" data-i="${i}"></div>`
  ).join('');
  if (myPlayerId === hostId) {
    dots.querySelectorAll('.chain-dot').forEach(d =>
      d.addEventListener('click', () => {
        const i = parseInt(d.dataset.i);
        socket.emit('reveal_action', { type: 'next_chain' });
        renderRevealChain(i);
      })
    );
  }

  updateRevealButtons();
  revealNextEntry();
}

function revealNextEntry() {
  const chain = revealChains[revealChainIdx];
  if (!chain || revealEntryIdx >= chain.entries.length) return;

  const entry = chain.entries[revealEntryIdx++];
  const wrap  = document.getElementById('reveal-entries');

  const div   = document.createElement('div');
  div.className = `reveal-entry type-${entry.type}`;

  let label = '', body = '';
  if (entry.type === 'word') {
    label = `📝 시작 제시어 — ${esc(entry.authorNickname)}`;
    body  = `<div class="reveal-word-content">${esc(entry.content)}</div>`;
  } else if (entry.type === 'drawing') {
    label = `🎨 그림 — ${esc(entry.authorNickname)}`;
    body  = (!entry.content || entry.content === '__blank__')
      ? `<div class="reveal-blank">(그림 없음)</div>`
      : `<img src="${entry.content}" class="reveal-image" alt="그림">`;
  } else {
    label = `💬 유추 — ${esc(entry.authorNickname)}`;
    body  = `<div class="reveal-guess-content">${esc(entry.content)}</div>`;
  }

  div.innerHTML = `<div class="reveal-entry-label">${label}</div>${body}`;
  wrap.appendChild(div);
  requestAnimationFrame(() => div.classList.add('visible'));
  wrap.scrollTop = wrap.scrollHeight;
  updateRevealButtons();
}

function updateRevealButtons() {
  const isHost      = myPlayerId === hostId;
  const chain       = revealChains[revealChainIdx];
  const moreEntries = chain && revealEntryIdx < chain.entries.length;
  const nextChain   = revealChainIdx < revealChains.length - 1;
  const done        = !moreEntries && !nextChain;

  const show = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis ? 'block' : 'none'; };
  if (isHost) {
    show('next-entry-btn', moreEntries);
    show('next-chain-btn', !moreEntries && nextChain);
    show('play-again-btn', done);
    show('reveal-host-waiting', false);
  } else {
    show('next-entry-btn', false);
    show('next-chain-btn', false);
    show('play-again-btn', false);
    show('reveal-host-waiting', !done);
  }
  // 관리 패널 버튼 동기화
  const ae = document.getElementById('admin-reveal-next-entry');
  const ac = document.getElementById('admin-reveal-next-chain');
  if (ae) ae.style.display = moreEntries ? 'block' : 'none';
  if (ac) ac.style.display = (!moreEntries && nextChain) ? 'block' : 'none';
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function showAdminSection(section) {
  ['admin-lobby-settings', 'admin-game-controls', 'admin-reveal-controls'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const targets = {
    lobby: 'admin-lobby-settings',
    game:  'admin-game-controls',
    reveal:'admin-reveal-controls'
  };
  const el = document.getElementById(targets[section]);
  if (el) el.style.display = 'block';
}

function refreshAdminPlayerList() {
  const list = document.getElementById('admin-player-list');
  if (!list) return;
  const inGame = ['WRITING', 'DRAWING', 'GUESSING'].includes(currentPhase);
  list.innerHTML = players.map(p => {
    if (p.id === myPlayerId) {
      return `<div class="admin-player-item">
        <span class="admin-player-nick">${esc(p.nickname)}${p.id === hostId ? ' 👑' : ''} (나)</span>
      </div>`;
    }
    return `<div class="admin-player-item">
      <span class="admin-player-nick">${esc(p.nickname)}${p.id === hostId ? ' 👑' : ''}</span>
      <span class="admin-player-actions">
        <button class="admin-mini-btn" data-act="rename" data-id="${p.id}" title="닉네임 변경">✏️</button>
        <button class="admin-mini-btn" data-act="host" data-id="${p.id}" title="방장 양도">👑</button>
        ${inGame ? `<button class="admin-mini-btn" data-act="skip" data-id="${p.id}" title="제출 스킵">⏭</button>` : ''}
        <button class="admin-kick-btn" data-act="kick" data-id="${p.id}">퇴장</button>
      </span>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.id;
      const name = btn.closest('.admin-player-item').querySelector('.admin-player-nick').textContent.replace(' 👑','').trim();
      if (btn.dataset.act === 'kick') {
        if (confirm(`${name} 님을 퇴장시키겠습니까?`)) socket.emit('admin_kick', { playerId: id });
      } else if (btn.dataset.act === 'host') {
        if (confirm(`${name} 님에게 방장을 넘기겠습니까?`)) socket.emit('admin_transfer_host', { playerId: id });
      } else if (btn.dataset.act === 'skip') {
        socket.emit('admin_skip_player', { playerId: id });
        showToast(`${name} 님 제출을 스킵했습니다.`, 'success');
      } else if (btn.dataset.act === 'rename') {
        const next = prompt(`"${name}" 님의 새 닉네임을 입력하세요 (최대 12자)`, name);
        if (next && next.trim() && next.trim() !== name) {
          socket.emit('admin_rename', { playerId: id, nickname: next.trim().slice(0, 12) });
        }
      }
    });
  });
}

function bindAdminUI() {
  // 패널 토글
  document.getElementById('admin-toggle')?.addEventListener('click', () => {
    document.getElementById('admin-panel').classList.toggle('closed');
  });
  document.getElementById('admin-close')?.addEventListener('click', () => {
    document.getElementById('admin-panel').classList.add('closed');
  });

  // 타이머
  document.getElementById('admin-add-10')?.addEventListener('click',  () => socket.emit('admin_add_time', { seconds: 10  }));
  document.getElementById('admin-add-30')?.addEventListener('click',  () => socket.emit('admin_add_time', { seconds: 30  }));
  document.getElementById('admin-add-60')?.addEventListener('click',  () => socket.emit('admin_add_time', { seconds: 60  }));

  // 일시정지/재개
  let paused = false;
  document.getElementById('admin-pause-btn')?.addEventListener('click', function() {
    paused = !paused;
    socket.emit(paused ? 'admin_pause' : 'admin_resume');
    this.textContent = paused ? '▶ 재개' : '⏸ 일시정지';
  });

  // 강제 다음 단계
  document.getElementById('admin-force-next')?.addEventListener('click', () => {
    if (confirm('강제로 다음 단계로 이동하겠습니까?')) socket.emit('admin_next_phase');
  });

  // 강제 결과 공개
  document.getElementById('admin-end-game')?.addEventListener('click', () => {
    if (confirm('지금 바로 결과를 공개하겠습니까?')) socket.emit('admin_end_game');
  });

  // 빠른 모드 프리셋
  document.getElementById('admin-quick-mode')?.addEventListener('click', () => {
    const wt = document.getElementById('admin-write-time');
    const dt = document.getElementById('admin-draw-time');
    const gt = document.getElementById('admin-guess-time');
    if (wt) wt.value = 15;
    if (dt) dt.value = 40;
    if (gt) gt.value = 20;
    showToast('빠른 모드 적용됨 (15s / 40s / 20s)', 'success');
  });

  // 공지 전송
  document.getElementById('admin-announce-btn')?.addEventListener('click', () => {
    const input = document.getElementById('admin-announce-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    socket.emit('admin_announce', { text });
    input.value = '';
    showToast('공지를 전송했습니다.', 'success');
  });
  document.getElementById('admin-announce-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('admin-announce-btn')?.click();
  });

  // 시간 줄이기
  document.getElementById('admin-reduce-10')?.addEventListener('click', () => socket.emit('admin_add_time', { seconds: -10 }));
  document.getElementById('admin-reduce-30')?.addEventListener('click', () => socket.emit('admin_add_time', { seconds: -30 }));

  // 즉시 시간 종료
  document.getElementById('admin-end-timer')?.addEventListener('click', () => socket.emit('admin_end_timer'));

  // 현재 단계 다시 시작
  document.getElementById('admin-restart-phase')?.addEventListener('click', () => {
    if (confirm('현재 단계를 처음부터 다시 시작하겠습니까? (제출이 초기화됩니다)')) socket.emit('admin_restart_phase');
  });

  // 자동 진행 토글
  let autoAdv = true;
  document.getElementById('admin-autoadvance-btn')?.addEventListener('click', function() {
    autoAdv = !autoAdv;
    socket.emit('admin_toggle_autoadvance', { enabled: autoAdv });
    this.textContent = autoAdv ? '⏩ 자동 진행: 켜짐' : '⏸ 자동 진행: 꺼짐';
  });

  // 입장 잠금 (로비)
  let locked = false;
  document.getElementById('admin-lock-btn')?.addEventListener('click', function() {
    locked = !locked;
    socket.emit('admin_lock', { locked });
  });

  // 모두 준비 완료 (로비)
  document.getElementById('admin-force-ready')?.addEventListener('click', () => socket.emit('admin_force_ready'));

  // 순서 섞기 (로비)
  document.getElementById('admin-shuffle')?.addEventListener('click', () => socket.emit('admin_shuffle'));

  // 느린 모드 프리셋 (로비)
  document.getElementById('admin-slow-mode')?.addEventListener('click', () => {
    const wt = document.getElementById('admin-write-time');
    const dt = document.getElementById('admin-draw-time');
    const gt = document.getElementById('admin-guess-time');
    if (wt) wt.value = 60;
    if (dt) dt.value = 120;
    if (gt) gt.value = 60;
    showToast('느린 모드 적용됨 (60s / 120s / 60s)', 'success');
  });

  // 공지 프리셋
  document.querySelectorAll('.admin-preset').forEach(btn => {
    btn.addEventListener('click', () => socket.emit('admin_announce', { text: btn.dataset.msg }));
  });

  // 결과 제어 (관리 패널)
  document.getElementById('admin-reveal-next-entry')?.addEventListener('click', () => {
    socket.emit('reveal_action', { type: 'next_entry' });
    sounds.nextEntry(); revealNextEntry();
  });
  document.getElementById('admin-reveal-next-chain')?.addEventListener('click', () => {
    socket.emit('reveal_action', { type: 'next_chain' });
    sounds.phase(); renderRevealChain(revealChainIdx + 1);
  });
}

// ─── UI Bindings ──────────────────────────────────────────────────────────────
function bindUI() {
  // 음소거
  document.getElementById('mute-btn')?.addEventListener('click', function() {
    const m = toggleMute();
    this.textContent = m ? '🔇' : '🔊';
  });

  // Create
  document.getElementById('create-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const nick = document.getElementById('create-nickname').value.trim();
    if (nick) socket.emit('create_room', { nickname: nick });
  });

  // Join
  document.getElementById('join-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const nick = document.getElementById('join-nickname').value.trim();
    const code = document.getElementById('join-room-code').value.trim().toUpperCase();
    if (nick && code) socket.emit('join_room', { roomCode: code, nickname: nick });
  });
  document.getElementById('join-room-code')?.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // Lobby
  document.getElementById('ready-btn')?.addEventListener('click', function() {
    const next = this.dataset.ready !== 'true';
    socket.emit('set_ready', { ready: next });
    this.dataset.ready = String(next);
    this.textContent = next ? '준비 취소' : '준비 완료!';
    this.classList.toggle('btn-dark',  next);
    this.classList.toggle('btn-ghost', !next);
  });

  document.getElementById('start-btn')?.addEventListener('click', () => {
    const settings = {
      writeTime:     parseInt(document.getElementById('admin-write-time')?.value)     || 30,
      drawTime:      parseInt(document.getElementById('admin-draw-time')?.value)      || 80,
      guessTime:     parseInt(document.getElementById('admin-guess-time')?.value)     || 45,
      exchangeCount: parseInt(document.getElementById('admin-exchange-count')?.value) || 0,
      maxRounds:     0
    };
    socket.emit('start_game', { settings });
    sounds.start();
  });

  document.getElementById('copy-code-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => showToast(`링크 복사됨!`, 'success'))
      .catch(() => showToast(`방 코드: ${document.getElementById('lobby-code').textContent}`, 'success'));
  });

  // Writing
  const writingInput = document.getElementById('writing-input');
  writingInput?.addEventListener('input', () => {
    const n = writingInput.value.length;
    document.getElementById('writing-charcount').textContent = `${n} / 40`;
    document.getElementById('writing-submit').disabled = n === 0;
    scheduleDraft(() => writingInput.value.trim(), 500);
  });
  document.getElementById('writing-submit')?.addEventListener('click', () => {
    const text = writingInput.value.trim();
    if (!text) return;
    lastSubmission = { type: 'word', content: text };
    socket.emit('submit_word', { text });
    sounds.submit();
    document.getElementById('writing-submit').disabled = true;
  });

  // Drawing
  document.getElementById('draw-submit')?.addEventListener('click', () => {
    const canvas = document.getElementById('draw-canvas');
    const img    = exportCanvas(canvas);
    lastSubmission = { type: 'drawing', content: img };
    socket.emit('submit_drawing', { imageData: img });
    sounds.submit();
    document.getElementById('draw-submit').disabled = true;
  });

  // Guessing
  const guessInput = document.getElementById('guess-input');
  guessInput?.addEventListener('input', () => {
    const n = guessInput.value.length;
    document.getElementById('guess-charcount').textContent = `${n} / 40`;
    document.getElementById('guess-submit').disabled = n === 0;
    scheduleDraft(() => guessInput.value.trim(), 500);
  });
  document.getElementById('guess-submit')?.addEventListener('click', () => {
    const text = guessInput.value.trim();
    if (!text) return;
    lastSubmission = { type: 'guess', content: text };
    socket.emit('submit_guess', { text });
    sounds.submit();
    document.getElementById('guess-submit').disabled = true;
  });

  // 편집하기
  document.getElementById('edit-btn')?.addEventListener('click', () => socket.emit('request_edit'));

  // 결과 네비게이션 (방장)
  document.getElementById('next-entry-btn')?.addEventListener('click', () => {
    socket.emit('reveal_action', { type: 'next_entry' }); sounds.nextEntry(); revealNextEntry();
  });
  document.getElementById('next-chain-btn')?.addEventListener('click', () => {
    socket.emit('reveal_action', { type: 'next_chain' }); sounds.phase(); renderRevealChain(revealChainIdx + 1);
  });
  document.getElementById('play-again-btn')?.addEventListener('click', () => {
    socket.emit('reveal_action', { type: 'play_again' });
  });

  // 채팅 접기/펼치기 (특히 모바일에서 그림을 가리지 않도록)
  document.querySelectorAll('.chat-toggle').forEach(h => {
    h.addEventListener('click', () => h.closest('.chat-panel')?.classList.toggle('collapsed'));
  });

  // Chat
  document.getElementById('lobby-chat-send')?.addEventListener('click',  () => sendChat('lobby-chat-input'));
  document.getElementById('reveal-chat-send')?.addEventListener('click', () => sendChat('reveal-chat-input'));
  document.getElementById('lobby-chat-input')?.addEventListener('keydown',  e => { if (e.key === 'Enter') { e.preventDefault(); sendChat('lobby-chat-input');  } });
  document.getElementById('reveal-chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendChat('reveal-chat-input'); } });

  // 공지 닫기
  document.getElementById('announcement-close')?.addEventListener('click', () => {
    document.getElementById('announcement-overlay').style.display = 'none';
  });
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
