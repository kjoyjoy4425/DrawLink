export function exportCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  // Ensure white background
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function displayImage(src, container) {
  container.innerHTML = '';
  if (!src || src === '__blank__') {
    const placeholder = document.createElement('div');
    placeholder.className = 'reveal-blank';
    placeholder.textContent = '(그림 없음)';
    container.appendChild(placeholder);
    return;
  }
  const img = document.createElement('img');
  img.src = src;
  img.className = 'reveal-image';
  img.alt = '그림';
  container.appendChild(img);
}
