class Room {
  constructor(code) {
    this.code = code;
    this.hostId = null;
    this.players = new Map();
    this.chains = [];
    this.submissions = new Map();
    this.currentAssignments = new Map();
    this.phase = 'LOBBY';
    this.round = 0;
    this.timer = null;
    this.advanceTimeout = null; // grace period timeout handle
    this.secondsLeft = 0;
    this.paused = false;
    this.locked = false;        // 입장 잠금 (방장 제어)
    this.autoAdvance = true;    // 모두 제출 시 자동 진행 여부
    this.reconnectTimers = new Map();
    this.drafts = new Map();    // 임시 저장 (만료 레이스 방지)
    this.tokens = new Map();    // playerId → 비밀 토큰 (재접속 본인 확인, 외부 미공개)
    this.maxPlayers = 10;
    this.settings = {
      writeTime:     30,
      drawTime:      80,
      guessTime:     45,
      maxRounds:     0,  // 0 = playerCount
      exchangeCount: 0   // 0 = auto (그림+추리 교환 횟수)
    };
  }

  addPlayer(socketId, nickname) {
    const unique = this._uniqueNickname(nickname);
    const player = {
      id: socketId,
      nickname: unique,
      ready: false,
      connected: true,
      order: this.players.size
    };
    this.players.set(socketId, player);
    return player;
  }

  _uniqueNickname(nickname) {
    const taken = new Set([...this.players.values()].map(p => p.nickname));
    if (!taken.has(nickname)) return nickname;
    let i = 2;
    while (taken.has(`${nickname}(${i})`)) i++;
    return `${nickname}(${i})`;
  }

  getPlayerArray()      { return [...this.players.values()]; }
  getConnectedPlayers() { return [...this.players.values()].filter(p => p.connected); }
  isEmpty()             { return this.getConnectedPlayers().length === 0; }

  // 최대 라운드 계산 (exchangeCount 또는 maxRounds 기준)
  getMaxRounds() {
    const N = this.players.size;
    if (this.settings.exchangeCount > 0) {
      return Math.min(1 + this.settings.exchangeCount * 2, N);
    }
    return this.settings.maxRounds || N;
  }
}

module.exports = Room;
