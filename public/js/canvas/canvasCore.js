const W = 800, H = 500;

export function setupCanvas(canvas) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  return ctx;
}

export function getPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top) * scaleY
  };
}

export function clearCanvas(ctx) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
}
