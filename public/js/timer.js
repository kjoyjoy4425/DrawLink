export class TimerBar {
  constructor(fillEl, labelEl, totalSeconds, onExpire) {
    this.fill = fillEl;
    this.label = labelEl;
    this.total = totalSeconds;
    this.onExpire = onExpire;
    this._update(totalSeconds);
  }

  sync(secondsLeft) {
    this._update(secondsLeft);
    if (secondsLeft <= 0 && this.onExpire) {
      this.onExpire();
      this.onExpire = null; // fire once
    }
  }

  _update(s) {
    const pct = Math.max(0, Math.min(100, (s / this.total) * 100));
    this.fill.style.width = `${pct}%`;
    this.fill.classList.toggle('warning', s <= 20 && s > 10);
    this.fill.classList.toggle('danger', s <= 10);
    if (this.label) this.label.textContent = `${Math.max(0, s)}초`;
  }
}
