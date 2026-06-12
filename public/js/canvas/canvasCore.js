// 캔버스 비트맵을 "실제 화면에 표시된 크기"에 맞춰 설정한다.
// 고정 800×500 비트맵을 임의 비율 영역에 늘려 그리면 좌표가 어긋나
// 화면 일부에만 그려지는 버그가 생긴다. 표시 크기에 맞추면 항상 1:1로 매핑된다.
const MAX_DPR = 2; // 과도한 고해상도(메모리/성능) 방지

export function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr  = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = Math.max(1, Math.round((rect.width  || 320) * dpr));
  const h = Math.max(1, Math.round((rect.height || 200) * dpr));
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return ctx;
}

// 화면 좌표(clientX/Y) → 캔버스 비트맵 좌표
export function getPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width  ? canvas.width  / rect.width  : 1;
  const scaleY = rect.height ? canvas.height / rect.height : 1;
  const src = (e.touches && e.touches[0])             ? e.touches[0]
            : (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0]
            : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY
  };
}

// 현재 표시 크기 대비 비트맵 배율 (선 굵기 보정용)
export function strokeScale(canvas) {
  const rect = canvas.getBoundingClientRect();
  return rect.width ? canvas.width / rect.width : 1;
}

export function clearCanvas(ctx) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
}
