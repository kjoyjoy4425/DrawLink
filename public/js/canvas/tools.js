import { getPos, clearCanvas, strokeScale } from './canvasCore.js';

const COLORS = [
  '#2b3a42','#4f6d7a','#90a4ae','#cfd8dc','#f4f7f8',
  '#ffffff','#c0392b','#e67e22','#f1c40f','#27ae60',
  '#2980b9','#8e44ad'
];

// ─── Flood Fill ───────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#',''), 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}

function floodFill(canvas, ctx, startX, startY, fillHex) {
  const W = canvas.width, H = canvas.height;
  const imgData = ctx.getImageData(0, 0, W, H);
  const data = imgData.data;

  const sx = Math.round(startX), sy = Math.round(startY);
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return;

  const si = (sy * W + sx) * 4;
  const [tr, tg, tb] = [data[si], data[si+1], data[si+2]];
  const [fr, fg, fb] = hexToRgb(fillHex);

  if (tr === fr && tg === fg && tb === fb) return;

  const TOLERANCE = 28;
  function match(i) {
    return Math.abs(data[i]   - tr) <= TOLERANCE &&
           Math.abs(data[i+1] - tg) <= TOLERANCE &&
           Math.abs(data[i+2] - tb) <= TOLERANCE;
  }
  function set(i) { data[i] = fr; data[i+1] = fg; data[i+2] = fb; data[i+3] = 255; }

  const visited = new Uint8Array(W * H);
  const stack   = new Int32Array(W * H * 2);
  let head = 0, tail = 0;

  visited[sy * W + sx] = 1;
  stack[tail++] = sx; stack[tail++] = sy;

  while (head < tail) {
    const x = stack[head++], y = stack[head++];
    set((y * W + x) * 4);

    const neighbors = [x-1,y, x+1,y, x,y-1, x,y+1];
    for (let n = 0; n < 8; n += 2) {
      const nx = neighbors[n], ny = neighbors[n+1];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (visited[ni]) continue;
      const pi = ni * 4;
      if (!match(pi)) continue;
      visited[ni] = 1;
      stack[tail++] = nx; stack[tail++] = ny;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// ─── DrawingTool ──────────────────────────────────────────────────────────────
export class DrawingTool {
  constructor(canvas, ctx, onStroke) {
    this.canvas   = canvas;
    this.ctx      = ctx;
    this.onStroke = onStroke;
    this.tool     = 'pen';
    this.color    = '#2b3a42';
    this.size     = 4;
    this.drawing  = false;
    this.history  = [];
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    // 이전 라운드에서 같은 canvas에 붙은 리스너 제거 (중복 누적 방지)
    if (c._drawAC) c._drawAC.abort();
    this._ac = new AbortController();
    c._drawAC = this._ac;
    const opt = { signal: this._ac.signal };
    const popt = { passive: false, signal: this._ac.signal };

    c.addEventListener('mousedown',  e => this._start(e), opt);
    c.addEventListener('mousemove',  e => this._move(e), opt);
    c.addEventListener('mouseup',    e => this._end(e), opt);
    c.addEventListener('mouseleave', e => this._end(e), opt);
    c.addEventListener('touchstart', e => { e.preventDefault(); this._start(e); }, popt);
    c.addEventListener('touchmove',  e => { e.preventDefault(); this._move(e); }, popt);
    c.addEventListener('touchend',   e => { e.preventDefault(); this._end(e);  }, popt);
    c.addEventListener('touchcancel',e => { this._end(e); }, popt);

    // 화면 회전/리사이즈 시 현재 그림 보존하며 캔버스 재설정
    let rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => this.resize(), 200);
    }, opt);
  }

  resize() {
    // 비트맵은 고정 논리 해상도(CANVAS_W×CANVAS_H)라 화면 회전/리사이즈 시
    // 다시 만들 필요가 없다. CSS 가 표시 크기만 조절하므로 그림은 그대로 유지된다.
  }

  _start(e) {
    const pos = getPos(e, this.canvas);
    if (this.tool === 'fill') {
      floodFill(this.canvas, this.ctx, pos.x, pos.y, this.color);
      this.history.push(this.canvas.toDataURL('image/png'));
      if (this.onStroke) this.onStroke();
      return;
    }
    this.drawing = true;
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
    this._applyStyle();
  }

  _move(e) {
    if (!this.drawing || this.tool === 'fill') return;
    const pos = getPos(e, this.canvas);
    this.ctx.lineTo(pos.x, pos.y);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
  }

  _end(e) {
    if (!this.drawing) return;
    this.drawing = false;
    this.history.push(this.canvas.toDataURL('image/png'));
    if (this.onStroke) this.onStroke();
    this.ctx.beginPath();
  }

  _applyStyle() {
    const ctx = this.ctx;
    if (this.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = this.color;
    }
    // 비트맵이 표시 크기보다 크면(고해상도) 굵기도 같은 비율로 키워 손맛 유지
    ctx.lineWidth  = this.size * strokeScale(this.canvas);
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';
  }

  setTool(t)  {
    this.tool = t;
    this.canvas.classList.toggle('tool-fill', t === 'fill');
  }
  setColor(c) { this.color = c; this.tool = 'pen'; this.canvas.classList.remove('tool-fill'); }
  setSize(s)  { this.size  = s; }

  undo() {
    if (!this.history.length) return;
    this.history.pop();
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    if (!this.history.length) {
      clearCanvas(ctx);
    } else {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
      };
      img.src = this.history[this.history.length - 1];
    }
    if (this.onStroke) this.onStroke();
  }

  clear() {
    clearCanvas(this.ctx);
    this.history = [];
    if (this.onStroke) this.onStroke();
  }

  hasStrokes() { return this.history.length > 0; }
}

// ─── Toolbar builder ──────────────────────────────────────────────────────────
export function buildToolbar(toolEl, drawTool) {
  toolEl.innerHTML = `
    <button class="tool-btn active" data-tool="pen"    title="펜">✏️</button>
    <button class="tool-btn"        data-tool="eraser" title="지우개">◻️</button>
    <button class="tool-btn"        data-tool="fill"   title="채우기">🪣</button>
    <div class="toolbar-sep"></div>
    <div class="color-palette">
      ${COLORS.map((c, i) => {
        const isLight = ['#ffffff','#f4f7f8','#cfd8dc'].includes(c);
        return `<div class="color-swatch ${i===0?'active':''} ${isLight?'light-swatch':''}" data-color="${c}" style="background:${c}"></div>`;
      }).join('')}
      <input type="color" id="color-custom" value="#2b3a42" title="직접 선택">
    </div>
    <div class="toolbar-sep"></div>
    <div class="size-wrap">
      <label>굵기</label>
      <input type="range" id="size-range" min="1" max="40" value="4">
      <div class="size-preview"><div class="size-dot" style="width:4px;height:4px"></div></div>
    </div>
    <div class="toolbar-sep"></div>
    <button class="tool-btn" id="undo-btn" title="실행 취소">↩️</button>
    <button class="tool-btn" id="clear-btn" title="전체 지우기">🗑️</button>
  `;

  // Tool buttons
  toolEl.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      toolEl.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drawTool.setTool(btn.dataset.tool);
    });
  });

  // Color swatches
  toolEl.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      toolEl.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      drawTool.setColor(sw.dataset.color);
      document.getElementById('color-custom').value = sw.dataset.color;
      toolEl.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      toolEl.querySelector('[data-tool="pen"]').classList.add('active');
    });
  });

  // Custom color
  document.getElementById('color-custom')?.addEventListener('input', e => {
    drawTool.setColor(e.target.value);
    toolEl.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    toolEl.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
    toolEl.querySelector('[data-tool="pen"]').classList.add('active');
  });

  // Size
  const sizeRange = document.getElementById('size-range');
  const sizeDot   = toolEl.querySelector('.size-dot');
  sizeRange?.addEventListener('input', e => {
    const s = parseInt(e.target.value);
    drawTool.setSize(s);
    const px = Math.min(s, 20);
    if (sizeDot) { sizeDot.style.width = `${px}px`; sizeDot.style.height = `${px}px`; }
  });

  document.getElementById('undo-btn')?.addEventListener('click',  () => drawTool.undo());
  document.getElementById('clear-btn')?.addEventListener('click', () => drawTool.clear());
}
