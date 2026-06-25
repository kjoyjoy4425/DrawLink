// 캔버스 비트맵을 "모든 기기에서 동일한" 고정 논리 해상도(4:3)로 둔다.
// CSS 가 표시 영역을 4:3 으로 맞춰(레터박스) 늘리므로 PC·모바일 그림판 크기/비율이 같고,
// 좌표는 getPos 에서 표시크기→비트맵으로 환산되어 항상 정확히 매핑된다.
export const CANVAS_W = 1024;
export const CANVAS_H = 768;

export function setupCanvas(canvas) {
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
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
