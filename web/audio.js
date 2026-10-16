// Фонк, который синтезируется прямо в браузере (WebAudio): коубелл, 808,
// дисторшн-кик, хэты. Никаких чужих треков — TikTok глушит эфиры за
// музыку с авторскими правами, а это наш собственный звук.
// Плюс звуковые эффекты: турбо, джетпак, молния, ядерка, «бум» для мемов.

const BPM = 132;
const STEP = 60 / BPM / 4;           // шестнадцатая
const STEPS = 32;                    // 2 такта
const ROOT = 73.42;                  // D2

const semi = (base, n) => base * Math.pow(2, n / 12);

// Мелодии (смещения в полутонах от ре, null — пауза). Ре минор.
const COWBELL_A = [12, null, 12, null, 15, null, 12, 10, null, 12, null, 7, 8, null, 7, null,
                   12, null, 12, null, 15, null, 17, null, 15, null, 12, null, 10, null, 8, null];
const COWBELL_B = [19, null, 17, 15, null, 15, 12, null, 15, null, 17, null, 19, null, 20, 19,
                   17, null, 15, null, 12, null, 15, null, 17, 15, 12, null, 10, null, 12, null];
const BASS = [0, null, null, null, null, null, 0, null, null, null, -2, null, null, null, null, null,
              -4, null, null, null, null, null, -4, null, -5, null, null, null, -2, null, null, null];
const KICK = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];

export class Audio {
  constructor() {
    this.ctx = null;
    this.level = 0;        // 0 — лобби, 1 — гонка, 2 — финишная прямая, 3 — результаты
    this.step = 0;
    this.bar = 0;
    this.nextTime = 0;
    this.muted = new URLSearchParams(location.search).has('mute');
  }

  get started() { return !!this.ctx && this.ctx.state === 'running'; }

  // Браузер разрешает звук только после клика (в облаке запускаем Chromium
  // с флагом автоплея, там стартует сразу).
  start() {
    if (this.muted) return;
    if (!this.ctx) this.build();
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  build() {
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.music.connect(this.musicFilter).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    // простое «эхо» для коубелла и ударов
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2500;
    this.echo.connect(echoTone).connect(fb).connect(this.echo);
    echoTone.connect(this.music);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // постоянные шины: каждая нота подключается к своей, а не к новой цепочке
    this.kickBus = this.shaper(30);
    this.kickBus.connect(this.music);
    this.bassBus = ctx.createGain();
    const bassLp = ctx.createBiquadFilter();
    bassLp.type = 'lowpass';
    bassLp.frequency.value = 600;
    this.bassBus.connect(this.shaper(80)).connect(bassLp).connect(this.music);
    this.sfxDrive = this.shaper(30);
    this.sfxDrive.connect(this.sfx);
    this.sfxCrush = this.shaper(80);
    this.sfxCrush.connect(this.sfx);

    this.nextTime = ctx.currentTime + 0.1;
    setInterval(() => this.schedule(), 25);
  }

  shaper(k) {
    const s = this.ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * 2 / n - 1;
      curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
    }
    s.curve = curve;
    return s;
  }

  setLevel(level) {
    this.level = level;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.cancelScheduledValues(t);
    this.musicFilter.frequency.setTargetAtTime(level === 3 ? 900 : level === 0 ? 5000 : 18000, t, 0.4);
  }

  schedule() {
    if (!this.started) return;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % STEPS;
      if (this.step === 0) this.bar++;
    }
  }

  playStep(s, t) {
    const lvl = this.level;
    const melody = (this.bar % 4 >= 2 && lvl >= 1) ? COWBELL_B : COWBELL_A;
    const bell = melody[s];
    if (bell !== null) this.cowbell(semi(ROOT * 4, bell + (lvl === 2 ? 12 : 0)) / 4, t, lvl === 3 ? 0.18 : 0.3);
    if (lvl === 3) return;  // на результатах — только коубелл через фильтр
    if (KICK[s]) this.kick(t, lvl === 0 ? 0.6 : 1);
    if (lvl >= 1) {
      if (SNARE[s]) this.snare(t);
      if (BASS[s] !== null) this.bass(semi(ROOT, BASS[s]), t, STEP * 5);
    }
    // хэты: в гонке 16-е, на финишной прямой — с триольными «роллами»
    if (lvl >= 1 || s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.16 : 0.08);
    if (lvl === 2 && s % 8 === 7) {
      this.hat(t + STEP / 3, 0.1);
      this.hat(t + STEP * 2 / 3, 0.12);
    }
  }

  env(gainNode, t, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  osc(type, freq, t, dur, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noiseSrc(t, dur, dest) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.connect(dest);
    n.start(t, Math.random());
    n.stop(t + dur + 0.05);
    return n;
  }

  cowbell(freq, t, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 1.7;
    bp.Q.value = 1.2;
    bp.connect(g);
    g.connect(this.music);
    g.connect(this.echo);
    this.osc('square', freq, t, 0.4, bp);
    this.osc('square', freq * 1.48, t, 0.4, bp);
    this.env(g, t, vol, 0.003, 0.32);
  }

  kick(t, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const o = this.osc('sine', 160, t, 0.5, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.connect(this.kickBus);
    this.env(g, t, vol, 0.002, 0.45);
  }

  bass(freq, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const o = this.osc('sine', freq * 1.5, t, dur, g);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);  // «слайд» 808
    g.connect(this.bassBus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.7, dur * 0.2);
  }

  snare(t) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    this.noiseSrc(t, 0.25, bp);
    bp.connect(g);
    g.connect(this.music);
    g.connect(this.echo);
    this.env(g, t, 0.55, 0.002, 0.2);
  }

  hat(t, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8000;
    this.noiseSrc(t, 0.06, hp);
    hp.connect(g).connect(this.music);
    this.env(g, t, vol, 0.001, 0.04);
  }

  // ---------------- эффекты ----------------
  play(name) {
    if (!this.started) return;
    const t = this.ctx.currentTime + 0.01;
    const fx = {
      join: () => {
        const g = this.ctx.createGain(); g.connect(this.sfx);
        const o = this.osc('triangle', 660, t, 0.15, g);
        o.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
        this.env(g, t, 0.25, 0.005, 0.12);
      },
      boost: () => {
        const g = this.ctx.createGain(); g.connect(this.sfx);
        const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
        bp.frequency.setValueAtTime(400, t);
        bp.frequency.exponentialRampToValueAtTime(4000, t + 0.35);
        this.noiseSrc(t, 0.4, bp); bp.connect(g);
        this.env(g, t, 0.5, 0.02, 0.35);
      },
      jetpack: () => {
        const g = this.ctx.createGain(); g.connect(this.sfx);
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        this.noiseSrc(t, 1.2, lp); lp.connect(g);
        const g2 = this.ctx.createGain(); g2.connect(this.sfx);
        const o = this.osc('sawtooth', 120, t, 1, g2);
        o.frequency.exponentialRampToValueAtTime(600, t + 0.9);
        this.env(g, t, 0.6, 0.05, 1.1);
        this.env(g2, t, 0.12, 0.05, 0.9);
      },
      lightning: () => {
        const g = this.ctx.createGain(); g.connect(this.sfxCrush);
        this.noiseSrc(t, 0.5, g);
        this.env(g, t, 0.9, 0.001, 0.45);
        this.boom(t + 0.05, 0.8);
      },
      nuke: () => {
        this.boom(t, 1.2, 2.5);
        const g = this.ctx.createGain(); g.connect(this.sfx);
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(3000, t);
        lp.frequency.exponentialRampToValueAtTime(200, t + 2.5);
        this.noiseSrc(t, 2.6, lp); lp.connect(g);
        this.env(g, t, 0.9, 0.01, 2.5);
      },
      boom: () => this.boom(t, 1),
      win: () => {
        [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.cowbell(semi(ROOT * 4, n), t + i * 0.09, 0.35));
        this.boom(t, 0.7);
      },
      beep: () => {
        const g = this.ctx.createGain(); g.connect(this.sfx);
        this.osc('square', 880, t, 0.12, g);
        this.env(g, t, 0.2, 0.002, 0.1);
      },
      go: () => {
        const g = this.ctx.createGain(); g.connect(this.sfx);
        this.osc('square', 1760, t, 0.4, g);
        this.env(g, t, 0.25, 0.002, 0.35);
        this.boom(t, 0.9);
      },
    }[name];
    if (fx) fx();
  }

  // «бум» как в мемах: низкий удар с перегрузом и хвостом
  boom(t, vol, len = 1.2) {
    const g = this.ctx.createGain();
    const o = this.osc('sine', 110, t, len, g);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    g.connect(this.sfxDrive);
    g.connect(this.echo);
    this.env(g, t, vol, 0.003, len);
  }
}
