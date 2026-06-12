const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const RoomManager = require('./src/game/RoomManager');
const { initChains, processSubmissions, computeAssignments } = require('./src/game/ChainBuilder');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
const roomManager = new RoomManager();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/room/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function fillMissing(room) {
  for (const player of room.players.values()) {
    if (!room.submissions.has(player.id)) {
      // 드래프트(임시 저장)가 있으면 그것을 사용 — 만료 레이스로 인한 ???/빈그림 방지
      const draft = room.drafts.get(player.id);
      if (draft !== undefined && draft !== null && draft !== '') {
        room.submissions.set(player.id, draft);
      } else {
        room.submissions.set(player.id, room.phase === 'DRAWING' ? '__blank__' : '???');
      }
    }
  }
}

function broadcastCount(room) {
  // 분모는 "현재 접속 중인" 플레이어 기준 — 나간 사람을 기다리는 것처럼 보이지 않게
  const connected = room.getConnectedPlayers();
  const submitted = connected.filter(p => room.submissions.has(p.id)).length;
  io.to(room.code).emit('submission_count', { submitted, total: connected.length });
}

function broadcastRoundInfo(room) {
  const maxR = room.getMaxRounds();
  io.to(room.code).emit('round_info', {
    round: room.round,
    maxRounds: maxR,
    phase: room.phase
  });
}

function checkAdvance(room) {
  if (!['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase)) return;
  if (room.paused) return;
  if (!room.autoAdvance) return; // 자동 진행 꺼져 있으면 방장이 수동으로만 진행
  const connected = room.getConnectedPlayers();
  if (connected.length === 0) return;
  if (connected.every(p => room.submissions.has(p.id))) advance(room);
}

function startTimer(room, seconds) {
  if (room.timer) clearInterval(room.timer);
  if (room.advanceTimeout) { clearTimeout(room.advanceTimeout); room.advanceTimeout = null; }
  room.secondsLeft = seconds;
  room.paused = false;

  room.timer = setInterval(() => {
    if (room.paused) return; // 일시정지 중 tick 건너뜀
    room.secondsLeft--;
    io.to(room.code).emit('timer_tick', { secondsLeft: room.secondsLeft });
    if (room.secondsLeft <= 0) {
      clearInterval(room.timer);
      room.timer = null;
      // 2.5초 유예: 느린 모바일/네트워크에서도 클라이언트 자동 제출이 도착하도록
      // (드래프트 자동저장과 함께 ???/빈그림 유실을 이중으로 방지)
      room.advanceTimeout = setTimeout(() => {
        room.advanceTimeout = null;
        advance(room);
      }, 2500);
    }
  }, 1000);
}

function advance(room) {
  if (room.timer)         { clearInterval(room.timer); room.timer = null; }
  if (room.advanceTimeout){ clearTimeout(room.advanceTimeout); room.advanceTimeout = null; }

  for (const handle of room.reconnectTimers.values()) clearTimeout(handle);
  room.reconnectTimers.clear();

  fillMissing(room);
  processSubmissions(room.chains, room.submissions, room.round, room.getPlayerArray());

  room.round++;
  room.submissions.clear();
  room.drafts.clear();
  room.paused = false;

  const maxR = room.getMaxRounds();
  if (room.round >= maxR) {
    startReveal(room);
  } else if (room.round % 2 === 1) {
    startDrawing(room);
  } else {
    startGuessing(room);
  }
}

// ─── Phase Starters ───────────────────────────────────────────────────────────

function startWriting(room) {
  room.phase = 'WRITING';
  room.round = 0;
  room.submissions.clear();
  room.drafts.clear();
  room.chains = initChains(room.getPlayerArray());

  const tl = room.settings.writeTime;
  io.to(room.code).emit('phase_writing', { timeLimit: tl });
  broadcastRoundInfo(room);
  startTimer(room, tl);
}

function startDrawing(room) {
  room.phase = 'DRAWING';
  room.submissions.clear();

  const players = room.getPlayerArray();
  const assignments = computeAssignments(room.chains, room.round, players);
  room.currentAssignments = assignments;

  const tl = room.settings.drawTime;
  for (const player of room.players.values()) {
    const a = assignments.get(player.id);
    if (a && player.connected) {
      io.to(player.id).emit('phase_drawing', { timeLimit: tl, prompt: a.content });
    }
  }
  broadcastRoundInfo(room);
  startTimer(room, tl);
}

function startGuessing(room) {
  room.phase = 'GUESSING';
  room.submissions.clear();

  const players = room.getPlayerArray();
  const assignments = computeAssignments(room.chains, room.round, players);
  room.currentAssignments = assignments;

  const tl = room.settings.guessTime;
  for (const player of room.players.values()) {
    const a = assignments.get(player.id);
    if (a && player.connected) {
      io.to(player.id).emit('phase_guessing', { timeLimit: tl, imageData: a.content });
    }
  }
  broadcastRoundInfo(room);
  startTimer(room, tl);
}

function startReveal(room) {
  if (room.timer)         { clearInterval(room.timer); room.timer = null; }
  if (room.advanceTimeout){ clearTimeout(room.advanceTimeout); room.advanceTimeout = null; }
  room.phase = 'REVEAL';
  io.to(room.code).emit('phase_reveal', { chains: room.chains });
}

// ─── Socket Events ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  // ── Room management ──────────────────────────────────────────────────────────

  socket.on('create_room', ({ nickname }) => {
    const nick = (nickname || '').trim();
    if (!nick) return;
    const room = roomManager.createRoom(socket.id, nick);
    socket.join(room.code);
    socket.emit('room_created', {
      roomCode: room.code, playerId: socket.id,
      players: room.getPlayerArray(), hostId: room.hostId
    });
  });

  socket.on('join_room', ({ roomCode, nickname }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const nick = (nickname || '').trim();
    if (!code || !nick) return socket.emit('join_error', { message: '방 코드와 닉네임을 입력해주세요.' });

    const room = roomManager.getRoom(code);
    if (!room)                  return socket.emit('join_error', { message: '존재하지 않는 방입니다.' });
    if (room.phase !== 'LOBBY') return socket.emit('join_error', { message: '이미 게임이 시작되었습니다.' });
    if (room.locked)            return socket.emit('join_error', { message: '방장이 입장을 잠갔습니다.' });
    if (room.players.size >= room.maxPlayers) return socket.emit('join_error', { message: `방이 가득 찼습니다. (최대 ${room.maxPlayers}명)` });

    const player = room.addPlayer(socket.id, nick);
    roomManager.registerSocket(socket.id, code);
    socket.join(code);

    socket.emit('join_ok', { roomCode: code, playerId: socket.id, players: room.getPlayerArray(), hostId: room.hostId });
    socket.to(code).emit('player_joined', { player });
  });

  // ── Lobby ────────────────────────────────────────────────────────────────────

  socket.on('set_ready', ({ ready }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.phase !== 'LOBBY') return;
    const player = room.players.get(socket.id);
    if (!player) return;
    player.ready = !!ready;
    io.to(room.code).emit('ready_update', { playerId: socket.id, ready: player.ready });
  });

  socket.on('start_game', (payload = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== 'LOBBY') return;
    if (room.players.size < 2) return socket.emit('start_error', { message: '최소 2명이 필요합니다.' });

    const s = (payload && payload.settings) ? payload.settings : {};
    room.settings.writeTime     = clamp(parseInt(s.writeTime)     || 30, 10, 300);
    room.settings.drawTime      = clamp(parseInt(s.drawTime)      || 80, 15, 600);
    room.settings.guessTime     = clamp(parseInt(s.guessTime)     || 45, 10, 300);
    room.settings.exchangeCount = clamp(parseInt(s.exchangeCount) || 0,   0,   8);
    room.settings.maxRounds     = room.settings.exchangeCount > 0
      ? Math.min(1 + room.settings.exchangeCount * 2, room.players.size)
      : (clamp(parseInt(s.maxRounds) || 0, 0, room.players.size) || room.players.size);

    // 3·2·1·Start! 카운트다운 후 시작 (모든 클라이언트 동기화)
    room.phase = 'COUNTDOWN';
    io.to(room.code).emit('game_starting');
    setTimeout(() => {
      if (room.phase !== 'COUNTDOWN') return;
      if (room.getConnectedPlayers().length < 2) {
        room.phase = 'LOBBY';
        io.to(room.code).emit('lobby_reset', { players: room.getPlayerArray(), hostId: room.hostId });
        return;
      }
      startWriting(room);
    }, 3400);
  });

  // ── Submissions ──────────────────────────────────────────────────────────────

  socket.on('submit_word', ({ text }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.phase !== 'WRITING' || room.submissions.has(socket.id)) return;
    room.submissions.set(socket.id, (text || '').trim() || '???');
    socket.emit('submission_ok');
    broadcastCount(room);
    checkAdvance(room);
  });

  socket.on('submit_drawing', ({ imageData }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.phase !== 'DRAWING' || room.submissions.has(socket.id)) return;
    room.submissions.set(socket.id, imageData || '__blank__');
    socket.emit('submission_ok');
    broadcastCount(room);
    checkAdvance(room);
  });

  socket.on('submit_guess', ({ text }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.phase !== 'GUESSING' || room.submissions.has(socket.id)) return;
    room.submissions.set(socket.id, (text || '').trim() || '???');
    socket.emit('submission_ok');
    broadcastCount(room);
    checkAdvance(room);
  });

  // ── Draft autosave (만료 레이스 방지) ──────────────────────────────────────────
  socket.on('save_draft', ({ content }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || !['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase)) return;
    if (room.submissions.has(socket.id)) return; // 이미 제출했으면 무시
    if (typeof content !== 'string') return;
    // 그림은 dataURL이라 큼 — 과도하게 큰 페이로드는 잘라냄(약 2MB)
    room.drafts.set(socket.id, content.slice(0, 2_000_000));
  });

  // ── Re-edit ──────────────────────────────────────────────────────────────────

  socket.on('request_edit', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || !['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase)) return;
    if (!room.submissions.has(socket.id)) return;

    room.submissions.delete(socket.id);
    broadcastCount(room);

    const assignment = room.currentAssignments.get(socket.id);
    const tl = room.secondsLeft;

    if (room.phase === 'WRITING') {
      socket.emit('phase_writing', { timeLimit: tl });
    } else if (room.phase === 'DRAWING' && assignment) {
      socket.emit('phase_drawing', { timeLimit: tl, prompt: assignment.content });
    } else if (room.phase === 'GUESSING' && assignment) {
      socket.emit('phase_guessing', { timeLimit: tl, imageData: assignment.content });
    }
  });

  // ── Chat ─────────────────────────────────────────────────────────────────────

  socket.on('chat_message', ({ text }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !['LOBBY', 'REVEAL'].includes(room.phase)) return;
    const clean = (text || '').trim().slice(0, 200);
    if (!clean) return;
    io.to(room.code).emit('chat_broadcast', {
      nickname: player.nickname, text: clean, isHost: player.id === room.hostId
    });
  });

  // ── Reveal ───────────────────────────────────────────────────────────────────

  socket.on('reveal_action', ({ type }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== 'REVEAL') return;
    io.to(room.code).emit('reveal_action', { type });
  });

  socket.on('play_again', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== 'REVEAL') return;

    for (const [id, player] of room.players) {
      if (!player.connected) { room.players.delete(id); roomManager.unregisterSocket(id); }
    }
    let order = 0;
    for (const player of room.players.values()) {
      player.order = order++;
      player.ready = false;
    }
    room.phase = 'LOBBY';
    room.round = 0;
    room.chains = [];
    room.submissions.clear();
    room.currentAssignments.clear();
    room.paused = false;

    io.to(room.code).emit('lobby_reset', { players: room.getPlayerArray(), hostId: room.hostId });
  });

  // ── Admin ─────────────────────────────────────────────────────────────────────

  socket.on('admin_add_time', ({ seconds }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || !room.timer) return;
    room.secondsLeft = Math.max(1, room.secondsLeft + (parseInt(seconds) || 0));
    io.to(room.code).emit('timer_tick', { secondsLeft: room.secondsLeft });
  });

  socket.on('admin_next_phase', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if (!['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase)) return;
    advance(room);
  });

  socket.on('admin_kick', ({ playerId }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || playerId === socket.id) return;
    const target = room.players.get(playerId);
    if (!target) return;

    const targetSocket = io.sockets.sockets.get(playerId);
    if (targetSocket) { targetSocket.emit('kicked'); targetSocket.leave(room.code); targetSocket.disconnect(true); }

    room.players.delete(playerId);
    roomManager.unregisterSocket(playerId);
    io.to(room.code).emit('player_kicked', { playerId, nickname: target.nickname });

    if (['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase) && !room.submissions.has(playerId)) {
      room.submissions.set(playerId, room.phase === 'DRAWING' ? '__blank__' : '???');
      broadcastCount(room);
      checkAdvance(room);
    }
    if (room.isEmpty() && room.phase === 'LOBBY') roomManager.deleteRoom(room.code);
  });

  // 일시정지
  socket.on('admin_pause', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if (!['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase) || room.paused) return;
    room.paused = true;
    io.to(room.code).emit('game_paused', { secondsLeft: room.secondsLeft });
  });

  // 재개
  socket.on('admin_resume', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || !room.paused) return;
    room.paused = false;
    io.to(room.code).emit('game_resumed', { secondsLeft: room.secondsLeft });
  });

  // 공지 전송
  socket.on('admin_announce', ({ text }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    const clean = (text || '').trim().slice(0, 100);
    if (!clean) return;
    io.to(room.code).emit('announcement', { text: clean });
  });

  // 강제 결과 공개
  socket.on('admin_end_game', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if (!['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase)) return;
    if (room.timer)         { clearInterval(room.timer); room.timer = null; }
    if (room.advanceTimeout){ clearTimeout(room.advanceTimeout); room.advanceTimeout = null; }
    fillMissing(room);
    processSubmissions(room.chains, room.submissions, room.round, room.getPlayerArray());
    startReveal(room);
  });

  // ── 신규 관리 기능 ─────────────────────────────────────────────────────────────

  // 호스트(방장) 양도
  socket.on('admin_transfer_host', ({ playerId }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    const target = room.players.get(playerId);
    if (!target || !target.connected || playerId === socket.id) return;
    room.hostId = playerId;
    io.to(room.code).emit('host_changed', { hostId: playerId, nickname: target.nickname });
  });

  // 즉시 시간 종료 (현재 단계 마감)
  socket.on('admin_end_timer', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if (!['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase) || room.paused) return;
    room.secondsLeft = 1;
    io.to(room.code).emit('timer_tick', { secondsLeft: 1 });
  });

  // 자동 진행 토글
  socket.on('admin_toggle_autoadvance', ({ enabled }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    room.autoAdvance = !!enabled;
    io.to(room.code).emit('autoadvance_changed', { enabled: room.autoAdvance });
    if (room.autoAdvance) checkAdvance(room);
  });

  // 현재 단계 다시 시작 (시간 초기화 + 제출 리셋)
  socket.on('admin_restart_phase', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if (room.phase === 'WRITING')      startWriting(room);
    else if (room.phase === 'DRAWING') { room.round = Math.max(1, room.round); startDrawing(room); }
    else if (room.phase === 'GUESSING') startGuessing(room);
    else return;
  });

  // 특정 플레이어 제출 강제 완료 (그 사람을 기다리지 않고 진행)
  socket.on('admin_skip_player', ({ playerId }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if (!['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase)) return;
    if (room.submissions.has(playerId)) return;
    const draft = room.drafts.get(playerId);
    room.submissions.set(playerId, (draft && draft !== '')
      ? draft : (room.phase === 'DRAWING' ? '__blank__' : '???'));
    broadcastCount(room);
    checkAdvance(room);
  });

  // 입장 잠금/해제 (로비)
  socket.on('admin_lock', ({ locked }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    room.locked = !!locked;
    io.to(room.code).emit('lock_changed', { locked: room.locked });
  });

  // 모두 준비 완료 처리 (로비)
  socket.on('admin_force_ready', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== 'LOBBY') return;
    for (const p of room.players.values()) p.ready = true;
    io.to(room.code).emit('all_ready', { players: room.getPlayerArray() });
  });

  // 플레이어 순서 섞기 (로비)
  socket.on('admin_shuffle', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== 'LOBBY') return;
    const arr = room.getPlayerArray();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i].order, arr[j].order] = [arr[j].order, arr[i].order];
    }
    io.to(room.code).emit('order_shuffled', { players: room.getPlayerArray() });
  });

  // ── Reconnect ────────────────────────────────────────────────────────────────

  socket.on('reconnect_attempt', ({ playerId, roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return socket.emit('reconnect_fail', { message: '방을 찾을 수 없습니다.' });

    const player = [...room.players.values()].find(p => p.id === playerId);
    if (!player) return socket.emit('reconnect_fail', { message: '플레이어를 찾을 수 없습니다.' });

    if (room.reconnectTimers.has(playerId)) {
      clearTimeout(room.reconnectTimers.get(playerId));
      room.reconnectTimers.delete(playerId);
    }

    room.players.delete(playerId);
    roomManager.unregisterSocket(playerId);
    player.id = socket.id;
    player.connected = true;
    room.players.set(socket.id, player);
    roomManager.registerSocket(socket.id, room.code);
    if (room.hostId === playerId) room.hostId = socket.id;

    if (room.submissions.has(playerId)) {
      const sub = room.submissions.get(playerId);
      room.submissions.delete(playerId);
      room.submissions.set(socket.id, sub);
    }
    if (room.currentAssignments.has(playerId)) {
      const a = room.currentAssignments.get(playerId);
      room.currentAssignments.delete(playerId);
      room.currentAssignments.set(socket.id, a);
    }

    socket.join(room.code);
    socket.emit('reconnect_ok', {
      roomCode: room.code,
      phase: room.phase, players: room.getPlayerArray(),
      hostId: room.hostId, myPlayerId: socket.id,
      assignment: room.currentAssignments.get(socket.id) || null,
      secondsLeft: room.secondsLeft,
      chains: room.phase === 'REVEAL' ? room.chains : null,
      paused: room.paused
    });
    socket.to(room.code).emit('player_rejoined', { playerId: socket.id, nickname: player.nickname });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    if (room.phase === 'LOBBY') {
      room.players.delete(socket.id);
      roomManager.unregisterSocket(socket.id);
      let newHostId = null;
      if (room.hostId === socket.id) {
        const next = room.getConnectedPlayers()[0];
        if (next) { room.hostId = next.id; newHostId = next.id; }
      }
      io.to(room.code).emit('player_left', { playerId: socket.id, newHostId });
      if (room.isEmpty()) roomManager.deleteRoom(room.code);
      return;
    }

    player.connected = false;
    let newHostId = null;
    if (room.hostId === socket.id) {
      const next = room.getConnectedPlayers()[0];
      if (next) { room.hostId = next.id; newHostId = next.id; }
    }
    io.to(room.code).emit('player_left', { playerId: socket.id, newHostId });

    // 나간 사람을 기다리는 것처럼 보이지 않도록 즉시 카운트 갱신 후 진행 판정
    broadcastCount(room);

    // 접속자가 2명 미만으로 줄면 게임을 정리하고 결과로 이동
    if (room.getConnectedPlayers().length < 2 && ['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase)) {
      if (room.timer)          { clearInterval(room.timer); room.timer = null; }
      if (room.advanceTimeout) { clearTimeout(room.advanceTimeout); room.advanceTimeout = null; }
      fillMissing(room);
      processSubmissions(room.chains, room.submissions, room.round, room.getPlayerArray());
      startReveal(room);
      return;
    }

    const handle = setTimeout(() => {
      room.reconnectTimers.delete(socket.id);
      if (!room.submissions.has(socket.id) && ['WRITING', 'DRAWING', 'GUESSING'].includes(room.phase)) {
        room.submissions.set(socket.id, room.phase === 'DRAWING' ? '__blank__' : '???');
        broadcastCount(room);
        checkAdvance(room);
      }
    }, 30_000);
    room.reconnectTimers.set(socket.id, handle);
    checkAdvance(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DrawLink 실행 중: http://localhost:${PORT}`));
