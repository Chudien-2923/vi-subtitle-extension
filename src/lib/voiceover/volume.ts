/** Own writes never become the user's next baseline. No Web Audio rerouting of YouTube. */
export class SourceVolume {
  private baseline: number;
  private lastWrite: number | undefined;
  private reading = false;
  private factor: number;
  private fade: ReturnType<typeof setInterval> | undefined;
  private readonly changed = () => {
    if (this.lastWrite !== undefined && Math.abs(this.video.volume - this.lastWrite) < 0.0001) return;
    this.baseline = this.video.volume;
    this.transition();
  };
  constructor(
    private readonly video: HTMLVideoElement,
    factor: number,
  ) {
    this.baseline = video.volume;
    this.factor = factor;
    video.addEventListener('volumechange', this.changed);
  }
  get userVolume(): number {
    return this.baseline;
  }
  setFactor(factor: number): void {
    this.factor = factor;
    this.transition();
  }
  setReading(reading: boolean): void {
    if (reading === this.reading) return;
    this.reading = reading;
    this.transition();
  }
  destroy(): void {
    clearInterval(this.fade);
    this.video.removeEventListener('volumechange', this.changed);
    this.write(this.baseline);
  }
  private write(value: number): void {
    this.lastWrite = Math.min(1, Math.max(0, value));
    if (Math.abs(this.video.volume - this.lastWrite) > 0.0001) this.video.volume = this.lastWrite;
  }
  private transition(): void {
    clearInterval(this.fade);
    const from = this.video.volume;
    const to = this.baseline * (this.reading ? this.factor : 1);
    const started = Date.now();
    this.fade = setInterval(() => {
      const fraction = Math.min(1, (Date.now() - started) / 120);
      this.write(from + (to - from) * fraction);
      if (fraction === 1) clearInterval(this.fade);
    }, 20);
  }
}
