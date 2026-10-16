// Музыка и звуки.
// Музыка — твои файлы из папки music/ (mp3/ogg/m4a/wav), играют по кругу
// в случайном порядке. На результатах приглушаются «как из-за стены».
// Звуковые эффекты синтезируются (WebAudio), файлов для них не нужно.

export class Sound {
  constructor() {
    this.ctx = null;
    this.level = 0;
    this.tracks = [];
    this.order = [];
    this.muted = new URLSearchParams(location.search).has('mute');
  }

  get started() { return !!this.ctx && this.ctx.state === 'running'; }

  start() {
    if (this.muted) return;
    if (!this.ctx) this.build();
    if (this.ctx.state !== 'running') this.ctx.resume();
    if (this.el && this.el.paused && this.el.src) this.el.play().catch(() => {});
  }

  build() {
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.music = ctx.createGain();
    this.music.gain.value = 0.8;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.music.connect(this.musicFilter).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.85;
    this.sfx.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.drive = this.shaper(30);
    this.drive.connect(this.sfx);
    this.crush = this.shaper(90);
    this.crush.connect(this.sfx);

    this.el = document.createElement('audio');
    this.el.crossOrigin = 'anonymous';
    this.el.addEventListener('ended', () => this.next());
    this.el.addEventListener('error', () => setTimeout(() => this.next(), 1000));
    ctx.createMediaElementSource(this.el).connect(this.music);
    this.loadPlaylist();
  }

  async loadPlaylist() {
    try {
      this.tracks = await (await fetch('/music/list')).json();
    } catch { this.tracks = []; }
    if (!this.tracks.length) console.warn('music/ пустая — положи туда mp3, и они будут играть');
    this.next();
  }

  next() {
    if (!this.tracks.length) return;
    if (!this.order.length) this.order = [...this.tracks].sort(() => Math.random() - 0.5);
    this.el.src = '/music/' + encodeURIComponent(this.order.shift());
    this.el.play().catch(() => {});
  }

  shaper(k) {
    const s = this.ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    s.curve = curve;
    return s;
  }

  // 0 — лобби, 1 — гонка, 2 — финишная прямая, 3 — результаты
  setLevel(level) {
    this.level = level;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = this.musicFilter.frequency, g = this.music.gain;
    f.cancelScheduledValues(t); g.cancelScheduledValues(t);
    f.setTargetAtTime(level === 3 ? 700 : 20000, t, 0.35);
    g.setTargetAtTime({ 0: 0.6, 1: 0.8, 2: 0.95, 3: 0.55 }[level], t, 0.5);
  }

  // приглушить музыку на мгновение (под «бум», ядерку)
  duck(amount = 0.35, time = 0.8) {
    if (!this.started) return;
    const t = this.ctx.currentTime, g = this.music.gain, v = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(v * amount, t);
    g.setTargetAtTime(v, t + 0.05, time);
  }

  env(node, t, peak, attack, decay) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  osc(type, freq, t, dur, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  noiseSrc(t, dur, dest) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.connect(dest);
    n.start(t, Math.random()); n.stop(t + dur + 0.05);
    return n;
  }

  gain(dest = this.sfx) { const g = this.ctx.createGain(); g.connect(dest); return g; }
  filter(type, freq, dest) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.connect(dest); return f; }

  boom(t, vol, len = 1.2) {
    const g = this.gain(this.drive);
    const o = this.osc('sine', 110, t, len, g);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.25);
    this.env(g, t, vol, 0.003, len);
  }

  play(name) {
    if (!this.started) return;
    const t = this.ctx.currentTime + 0.01;
    const fx = {
      join: () => { const g = this.gain(); const o = this.osc('triangle', 660, t, 0.15, g); o.frequency.exponentialRampToValueAtTime(1320, t + 0.08); this.env(g, t, 0.22, 0.005, 0.12); },
      boost: () => {
        const g = this.gain(); const bp = this.filter('bandpass', 400, g); bp.Q.value = 3;
        bp.frequency.exponentialRampToValueAtTime(4500, t + 0.35);
        this.noiseSrc(t, 0.4, bp); this.env(g, t, 0.45, 0.02, 0.35);
      },
      pad: () => { const g = this.gain(); const o = this.osc('square', 520, t, 0.25, g); o.frequency.exponentialRampToValueAtTime(1560, t + 0.2); this.env(g, t, 0.12, 0.005, 0.22); },
      ramp: () => { const g = this.gain(); const bp = this.filter('bandpass', 300, g); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.5); this.noiseSrc(t, 0.6, bp); this.env(g, t, 0.35, 0.05, 0.5); },
      bonk: () => {
        const g = this.gain(this.drive); const o = this.osc('square', 220, t, 0.3, g);
        o.frequency.exponentialRampToValueAtTime(70, t + 0.25); this.env(g, t, 0.5, 0.002, 0.28);
        const g2 = this.gain(); this.noiseSrc(t, 0.08, this.filter('highpass', 2000, g2)); this.env(g2, t, 0.5, 0.001, 0.07);
      },
      splash: () => { const g = this.gain(); this.noiseSrc(t, 0.4, this.filter('lowpass', 900, g)); this.env(g, t, 0.35, 0.01, 0.35); },
      jetpack: () => {
        const g = this.gain(); this.noiseSrc(t, 1.2, this.filter('lowpass', 900, g)); this.env(g, t, 0.55, 0.05, 1.1);
        const g2 = this.gain(); const o = this.osc('sawtooth', 120, t, 1, g2); o.frequency.exponentialRampToValueAtTime(600, t + 0.9); this.env(g2, t, 0.1, 0.05, 0.9);
      },
      lightning: () => { const g = this.gain(this.crush); this.noiseSrc(t, 0.5, g); this.env(g, t, 0.9, 0.001, 0.45); this.boom(t + 0.05, 0.8); this.duck(0.3, 0.6); },
      nuke: () => {
        this.boom(t, 1.2, 2.5);
        const g = this.gain(); const lp = this.filter('lowpass', 3000, g);
        lp.frequency.exponentialRampToValueAtTime(200, t + 2.5);
        this.noiseSrc(t, 2.6, lp); this.env(g, t, 0.9, 0.01, 2.5);
        this.duck(0.15, 1.5);
      },
      boom: () => { this.boom(t, 1); this.duck(0.5, 0.5); },
      win: () => { [0, 4, 7, 12].forEach((n, i) => { const g = this.gain(); this.osc('square', 523 * Math.pow(2, n / 12), t + i * 0.11, 0.3, g); this.env(g, t + i * 0.11, 0.15, 0.005, 0.3); }); this.boom(t, 0.7); },
      beep: () => { const g = this.gain(); this.osc('square', 880, t, 0.12, g); this.env(g, t, 0.2, 0.002, 0.1); },
      go: () => { const g = this.gain(); this.osc('square', 1760, t, 0.4, g); this.env(g, t, 0.25, 0.002, 0.35); this.boom(t, 0.9); },
    }[name];
    if (fx) fx();
  }
}
