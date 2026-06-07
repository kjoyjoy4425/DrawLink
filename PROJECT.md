# DrawLink — 프로젝트 문서

> 갈틱폰 스타일 실시간 멀티플레이 그림 전달 게임  
> 마지막 업데이트: 2026-05-31

---

## 목차
1. [게임 개요](#1-게임-개요)
2. [기술 스택](#2-기술-스택)
3. [파일 구조](#3-파일-구조)
4. [게임 흐름 & 상태 머신](#4-게임-흐름--상태-머신)
5. [핵심 알고리즘](#5-핵심-알고리즘-체인-로테이션)
6. [Socket.io 이벤트 레퍼런스](#6-socketio-이벤트-레퍼런스)
7. [서버 데이터 구조](#7-서버-데이터-구조)
8. [배포 가이드](#8-배포-가이드)
9. [개발 환경 설정](#9-개발-환경-설정)
10. [기능 로드맵](#10-기능-로드맵)

---

## 1. 게임 개요

각 플레이어가 제시어를 적으면 체인처럼 순환하며 그림 그리기와 유추를 반복.  
마지막에 모든 체인의 변화 과정을 공개해 웃음 포인트를 즐기는 파티 게임.

**게임 순서:**
```
[제시어 입력] → [그림 그리기] → [단어 유추] → [그림 그리기] → ... → [결과 공개]
```

**인원:** 2~8명  
**소요 시간:** 5~15분 (인원 수, 설정 시간에 따라 다름)

---

## 2. 기술 스택

| 역할 | 기술 |
|------|------|
| 런타임 | Node.js v24+ |
| 웹 서버 | Express 4 |
| 실시간 통신 | Socket.io 4 |
| 프론트엔드 | Vanilla HTML/CSS/JS (ES Modules, 빌드 도구 없음) |
| 상태 저장 | 서버 인메모리 (DB 없음) |
| 사운드 | Web Audio API (외부 파일 없음) |

**색상 팔레트 (5색만 사용):**
- `#f4f7f8` — 페이지 배경, 가장 밝음
- `#cfd8dc` — 테두리, 구분선, 보조 배경
- `#90a4ae` — 무음 텍스트, 비활성 요소
- `#4f6d7a` — 주요 버튼, 액센트
- `#2b3a42` — 메인 텍스트, 헤더, 가장 어두움

---

## 3. 파일 구조

```
DrawLink/
├── PROJECT.md                   ← 이 파일 (자동 업데이트)
├── package.json
├── server.js                    ← Express + Socket.io 서버, 게임 로직 전체
├── src/
│   └── game/
│       ├── Room.js              ← Room 클래스 (상태 + 플레이어 관리 + 설정)
│       ├── RoomManager.js       ← rooms Map (생성/조회/삭제)
│       ├── ChainBuilder.js      ← 체인 초기화, 제출 처리, 할당 계산
│       └── idGen.js             ← 6자리 룸 코드 생성
└── public/
    ├── index.html               ← 랜딩 페이지 (방 만들기 / 참여)
    ├── room.html                ← 게임 메인 (모든 화면 포함)
    ├── css/
    │   ├── main.css             ← 전체 스타일 (라이트 테마)
    │   └── canvas.css           ← 캔버스 도구 스타일
    └── js/
        ├── main.js              ← 클라이언트 진입점 (ES Module)
        ├── socket.js            ← Socket.io 클라이언트 래퍼
        ├── router.js            ← showScreen() 화면 전환
        ├── timer.js             ← TimerBar 컴포넌트
        ├── toast.js             ← 토스트 알림
        ├── sounds.js            ← Web Audio API 효과음
        └── canvas/
            ├── canvasCore.js    ← 캔버스 셋업, 좌표 변환
            ├── tools.js         ← DrawingTool (펜/지우개/채우기) + buildToolbar
            └── export.js        ← base64 내보내기, 이미지 표시
```

---

## 4. 게임 흐름 & 상태 머신

```
LOBBY → WRITING → DRAWING → GUESSING → DRAWING → ... → REVEAL
                  [홀수 라운드]  [짝수 라운드]
```

| 상태 | 설명 | 기본 시간 |
|------|------|-----------|
| LOBBY | 플레이어 대기, 호스트가 설정 및 시작 | 무제한 |
| WRITING | 각자 제시어 입력 | 30초 |
| DRAWING | 제시어 보고 그림 그리기 | 80초 |
| GUESSING | 그림 보고 단어 유추 | 45초 |
| REVEAL | 결과 공개 (방장이 진행 제어) | 무제한 |

**진행 조건:** 모두 제출하거나 타이머 만료 시 자동 진행  
**라운드 수:** 기본값 = 플레이어 수 (방장이 조절 가능)

---

## 5. 핵심 알고리즘: 체인 로테이션

N명의 플레이어, 좌석 `i`, 라운드 `r`일 때:

```
담당 체인 인덱스 = (i - r + N) % N
```

**4명 예시 (A=0, B=1, C=2, D=3):**
```
Round 0 (WRITE): A→chain0, B→chain1, C→chain2, D→chain3
Round 1 (DRAW):  A→chain3, B→chain0, C→chain1, D→chain2
Round 2 (GUESS): A→chain2, B→chain3, C→chain0, D→chain1
Round 3 (DRAW):  A→chain1, B→chain2, C→chain3, D→chain0
```

각 체인은 모든 플레이어를 한 번씩 거침. `chain[0]`의 흐름: A가 적고 → B가 그리고 → C가 유추하고 → D가 그림.

---

## 6. Socket.io 이벤트 레퍼런스

### 방 관리

| 이벤트 | 방향 | 페이로드 | 설명 |
|--------|------|---------|------|
| `create_room` | C→S | `{ nickname }` | 방 생성 |
| `room_created` | S→C | `{ roomCode, playerId, players, hostId }` | 생성 확인 |
| `join_room` | C→S | `{ roomCode, nickname }` | 방 참여 |
| `join_ok` | S→C | `{ playerId, players, hostId }` | 참여 확인 |
| `join_error` | S→C | `{ message }` | 참여 오류 |
| `player_joined` | S→C | `{ player }` | 새 플레이어 입장 브로드캐스트 |
| `player_left` | S→C | `{ playerId, newHostId? }` | 플레이어 퇴장 |
| `player_rejoined` | S→C | `{ playerId, nickname }` | 재접속 |
| `player_kicked` | S→C | `{ playerId, nickname }` | 강제 퇴장 |
| `kicked` | S→C | `{}` | 퇴장된 플레이어에게 전송 |

### 로비

| 이벤트 | 방향 | 페이로드 | 설명 |
|--------|------|---------|------|
| `set_ready` | C→S | `{ ready }` | 준비 상태 토글 |
| `ready_update` | S→C | `{ playerId, ready }` | 준비 상태 변경 브로드캐스트 |
| `start_game` | C→S | `{ settings? }` | 게임 시작 (설정 포함) |
| `start_error` | S→C | `{ message }` | 시작 불가 사유 |

### 게임 페이즈

| 이벤트 | 방향 | 페이로드 | 설명 |
|--------|------|---------|------|
| `phase_writing` | S→C | `{ timeLimit }` | 제시어 입력 시작 |
| `phase_drawing` | S→개인 | `{ timeLimit, prompt }` | 그림 그리기 시작 |
| `phase_guessing` | S→개인 | `{ timeLimit, imageData }` | 유추 시작 |
| `phase_reveal` | S→C | `{ chains }` | 결과 공개 |
| `timer_tick` | S→C | `{ secondsLeft }` | 매초 타이머 동기화 |
| `submit_word` | C→S | `{ text }` | 제시어 제출 |
| `submit_drawing` | C→S | `{ imageData }` | 그림 제출 |
| `submit_guess` | C→S | `{ text }` | 유추 제출 |
| `submission_ok` | S→C | `{}` | 제출 확인 |
| `submission_count` | S→C | `{ submitted, total }` | 제출 수 브로드캐스트 |
| `request_edit` | C→S | `{}` | 제출 취소 후 재편집 요청 |

### 결과 공개

| 이벤트 | 방향 | 페이로드 | 설명 |
|--------|------|---------|------|
| `reveal_action` | C→S | `{ type }` | 방장이 결과 진행 제어 |
| `reveal_action` | S→C | `{ type }` | 모든 클라이언트에 릴레이 |
| `play_again` | C→S | `{}` | 방장이 다시 하기 |
| `lobby_reset` | S→C | `{ players, hostId }` | 로비 초기화 |

### 관리 패널 (방장 전용)

| 이벤트 | 방향 | 페이로드 | 설명 |
|--------|------|---------|------|
| `admin_add_time` | C→S | `{ seconds }` | 타이머 시간 추가 |
| `admin_next_phase` | C→S | `{}` | 강제 다음 단계 |
| `admin_kick` | C→S | `{ playerId }` | 특정 플레이어 강제 퇴장 |

### 채팅 (로비 + 결과 공개 중)

| 이벤트 | 방향 | 페이로드 | 설명 |
|--------|------|---------|------|
| `chat_message` | C→S | `{ text }` | 채팅 메시지 전송 |
| `chat_broadcast` | S→C | `{ nickname, text, isHost }` | 채팅 메시지 브로드캐스트 |

### 재접속

| 이벤트 | 방향 | 페이로드 | 설명 |
|--------|------|---------|------|
| `reconnect_attempt` | C→S | `{ playerId, roomCode }` | 재접속 시도 |
| `reconnect_ok` | S→C | `{ phase, players, hostId, myPlayerId, assignment, secondsLeft, chains }` | 재접속 성공 |
| `reconnect_fail` | S→C | `{ message }` | 재접속 실패 |

---

## 7. 서버 데이터 구조

```javascript
// Room
{
  code: string,              // "ABC123"
  hostId: string,            // socket.id
  players: Map<id, Player>,
  chains: Chain[],
  submissions: Map<id, string>, // 현재 라운드 제출
  currentAssignments: Map<id, { chainIndex, content }>,
  phase: 'LOBBY'|'WRITING'|'DRAWING'|'GUESSING'|'REVEAL',
  round: number,
  timer: IntervalID | null,
  secondsLeft: number,
  reconnectTimers: Map<id, TimeoutID>,
  settings: {
    writeTime: number,   // 기본 30
    drawTime: number,    // 기본 80
    guessTime: number,   // 기본 45
    maxRounds: number    // 기본 = players.size
  }
}

// Player
{ id, nickname, ready, connected, order }

// Chain
{ ownerNickname: string, entries: Entry[] }

// Entry
{ type: 'word'|'drawing'|'guess', authorNickname: string, content: string }
```

---

## 8. 배포 가이드

### ⚠️ Netlify 주의사항

**Netlify는 이 게임에 직접 사용할 수 없습니다.**  
이유: Socket.io는 지속적인 WebSocket 연결이 필요한데, Netlify Functions는 단기 실행 서버리스 함수만 지원하기 때문입니다.

### 권장 배포 플랫폼

| 플랫폼 | 무료 티어 | 특징 |
|--------|-----------|------|
| **Railway** | 월 $5 크레딧 | 가장 간단, Git 연동 |
| **Render** | 무료 (슬립 있음) | GitHub 연동, 자동 배포 |
| **Fly.io** | 소규모 무료 | 글로벌 엣지 |
| **Heroku** | 없음 (유료) | 안정적 |

### Railway 배포 방법 (권장)

```bash
# 1. Railway CLI 설치
npm install -g @railway/cli

# 2. 로그인
railway login

# 3. 프로젝트 초기화 및 배포
cd DrawLink
railway init
railway up
```

### 환경 변수
```
PORT=3000  # 배포 플랫폼이 자동 설정
```

### 로컬 네트워크 공유 (임시)
같은 Wi-Fi 환경에서 임시 공유 방법:

```powershell
# 내 IP 확인
ipconfig

# 서버 시작 후 아래 URL 공유
http://192.168.x.x:3000
```

---

## 9. 개발 환경 설정

```powershell
# Node.js 24 필요 (winget으로 설치 가능)
winget install OpenJS.NodeJS.LTS

# 패키지 설치
cd C:\Users\USER\Desktop\Ai_개발\DrawLink
npm install

# 서버 시작
npm start
# → http://localhost:3000

# 멀티 탭으로 테스트
# 브라우저 탭 2~3개 열고 각각 접속
```

---

## 10. 기능 로드맵

### 구현 완료 ✅
- [x] 방 생성/참여 (URL 공유)
- [x] 실시간 로비 (준비 시스템)
- [x] 제시어 입력 (30초)
- [x] 그림 그리기 (펜/지우개/색상/굵기/채우기/실행취소, 80초)
- [x] 단어 유추 (45초)
- [x] 결과 공개 (방장 제어, 체인별 순차 공개)
- [x] 채팅 (로비 + 결과 화면)
- [x] 관리 패널 (타이머 조절, 강제 진행, 강제 퇴장)
- [x] 게임 설정 (시간, 라운드 수 조절)
- [x] 편집하기 버튼 (대기 중 재수정)
- [x] 효과음 (Web Audio API)
- [x] 연결 끊김/재접속 처리
- [x] 다시 하기

### 계획 중 🔜
- [ ] 관전자 모드
- [ ] 게임 기록 저장 (로컬스토리지)
- [ ] 결과 이미지 다운로드
- [ ] 모바일 최적화 강화
- [ ] 방 비밀번호 설정
- [ ] 커스텀 제시어 팩 (방장이 테마 단어 목록 입력)
- [ ] 랭킹 시스템 (투표로 최고의 그림 선정)
