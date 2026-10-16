// Музыка и звуки.
// Музыка — твои файлы из папки music/ (mp3/ogg/m4a/wav). Плеер сам слушает
// каждый трек и находит в нём «дроп» — самый мощный кусок. Каждый забег —
// новый трек: в лобби играет начало, за 3 секунды до старта трек переходит
// на нарастание перед дропом, и дроп падает ровно на «GO!». На ядерке и
// финишной прямой — пауза-напряжение и снова дроп, на результатах музыка
// звучит глухо, «из-за стены».
// Звуковые эффекты синтезируются (WebAudio), файлов для них не нужно.

const LEVEL_GAIN = { 0: 0.55, 1: 0.85, 2: 0.95, 3: 0.5 };

export class Sound {
  constructor() {
    this.ctx = null;
    this.level = 0;
    this.tracks = [];
    this.order = [];
    this.current = null;      // имя текущего трека
    this.info = new Map();    // имя → {drop, duration}
    this.lastRedrop = 0;
    this.muted = new URLSearchParams(location.search).has('mute');
  }

  get started() { return !!this.ctx && this.ctx.state === 'running'; }

  start() {
    if (this.muted) return;
    if (!this.ctx) this.build();
    if (this.ctx.state !== 'running') this.ctx.resume();
    const d = this.deck;
    if (d && d.el.paused && d.el.src) d.el.play().catch(() => {});
  }

  build() {
    const ctx = this.ctx = new AudioContext();
    ctx.addEventListener('statechange', () => { if (this.pendingRound) this.newRound(); });
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // деки → громкость фазы → «пригибание» под эффекты → фильтр → мастер
    this.music = ctx.createGain();
    this.music.gain.value = LEVEL_GAIN[0];
    this.ducker = ctx.createGain();
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.music.connect(this.ducker).connect(this.musicFilter).connect(this.master);

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

    // две деки для плавных переходов между кусками трека
    this.decks = [0, 1].map(() => {
      const el = document.createElement('audio');
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(this.music);
      el.addEventListener('ended', () => { if (this.deck?.el === el) this.onEnded(); });
      return { el, gain };
    });
    this.active = 0;
    this.loadPlaylist();
  }

  get deck() { return this.decks?.[this.active]; }

  async loadPlaylist() {
    try {
      this.tracks = await (await fetch('/music/list')).json();
    } catch { this.tracks = []; }
    if (!this.tracks.length) { console.warn('music/ пустая — положи туда mp3, и они будут играть'); return; }
    if (this.pendingRound || !this.current) this.newRound();
  }

  pick() {
    if (!this.order.length) this.order = [...this.tracks].sort(() => Math.random() - 0.5);
    return this.order.shift();
  }

  url(name) { return '/music/' + encodeURIComponent(name); }

  // Ищем дроп: самый громкий 8-секундный кусок, а в нём — момент, где громкость
  // резче всего прыгает вверх. Результат кешируем в браузере.
  async analyze(name) {
    if (this.info.has(name)) return this.info.get(name);
    const key = 'race-drop2:' + name;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null');
      if (cached) { this.info.set(name, cached); return cached; }
    } catch {}
    const buf = await this.ctx.decodeAudioData(await (await fetch(this.url(name))).arrayBuffer());
    const data = buf.getChannelData(0), sr = buf.sampleRate, win = Math.floor(sr / 2);
    const e = [];
    for (let i = 0; i + win <= data.length; i += win) {
      let sum = 0;
      for (let j = i; j < i + win; j += 8) sum += data[j] * data[j];
      e.push(Math.sqrt(sum / (win / 8)));
    }
    const mean = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += e[i] || 0; return s / Math.max(1, b - a); };
    // уровень самого мощного 8-секундного куска…
    const span = 16;
    let peak = 0;
    for (let i = 0; i + span <= e.length; i++) peak = Math.max(peak, mean(i, i + span));
    // …и первый момент после 8-й секунды, где трек выходит на этот уровень
    let first = Math.min(40, e.length - 1);
    for (let i = 16; i + span <= e.length; i++) if (mean(i, i + span) >= peak * 0.85) { first = i; break; }
    // уточняем: где именно громкость прыгает вверх
    let drop = first, jump = -1;
    for (let j = Math.max(8, first - 8); j <= first + 8 && j + 4 < e.length; j++) {
      const d = mean(j, j + 4) - mean(j - 4, j);
      if (d > jump) { jump = d; drop = j; }
    }
    const info = { drop: drop / 2, duration: buf.duration };
    this.info.set(name, info);
    try { localStorage.setItem(key, JSON.stringify(info)); } catch {}
    return info;
  }

  dropOf(name) {
    const i = this.info.get(name);
    return i ? i.drop : null;
  }

  // перейти на другой трек/место: новая дека разгоняется, старая затухает
  async crossTo(name, time, fade = 0.3) {
    if (!this.ctx) return;
    const from = this.deck;
    this.active = 1 - this.active;
    const to = this.deck;
    const src = this.url(name);
    if (!to.el.src.endsWith(src)) to.el.src = src;
    await new Promise(res => {
      if (to.el.readyState >= 1) return res();
      to.el.addEventListener('loadedmetadata', res, { once: true });
      setTimeout(res, 3000);
    });
    try { to.el.currentTime = Math.max(0, time); } catch {}
    to.el.play().catch(() => {});
    this.current = name;
    const t = this.ctx.currentTime;
    to.gain.gain.cancelScheduledValues(t);
    to.gain.gain.setValueAtTime(to.gain.gain.value, t);
    to.gain.gain.linearRampToValueAtTime(1, t + fade);
    if (from && from !== to) {
      from.gain.gain.cancelScheduledValues(t);
      from.gain.gain.setValueAtTime(from.gain.gain.value, t);
      from.gain.gain.linearRampToValueAtTime(0, t + fade);
      setTimeout(() => { if (this.deck !== from) from.el.pause(); }, fade * 1000 + 100);
    }
  }

  // ---- хуки игры ----
  newRound() {
    // звук ещё не разрешён или плейлист не загружен — запустим, как только сможем
    if (!this.started || !this.tracks.length) { this.pendingRound = true; return; }
    this.pendingRound = false;
    const name = this.pick();
    this.analyze(name).catch(e => console.warn('не удалось разобрать трек', name, e));
    this.crossTo(name, 0, 1.5);
  }

  // за lead секунд до старта — на нарастание перед дропом
  preDrop(lead = 3) {
    const drop = this.dropOf(this.current);
    if (drop === null || !this.deck) return;
    const want = drop - lead;
    if (Math.abs(this.deck.el.currentTime - want) > 0.8) this.crossTo(this.current, want, 0.6);
  }

  // старт: дроп падает ровно сейчас
  drop() {
    const drop = this.dropOf(this.current) ?? (this.deck ? this.deck.el.currentTime : 0);
    if (this.deck && Math.abs(this.deck.el.currentTime - drop) > 0.5) this.crossTo(this.current, drop, 0.08);
    this.openFilter(0.05);
  }

  // эпичный момент: на полсекунды «затянуть» звук, потом снова дроп
  redrop(force = false) {
    if (!this.started || !this.current) return;
    const now = performance.now() / 1000;
    if (!force && now - this.lastRedrop < 14) return;
    this.lastRedrop = now;
    const t = this.ctx.currentTime, f = this.musicFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(350, t + 0.45);
    setTimeout(() => {
      const drop = this.dropOf(this.current);
      if (drop !== null) this.crossTo(this.current, drop, 0.05);
      this.openFilter(0.03);
    }, 500);
  }

  openFilter(time) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = this.musicFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(f.value, 300), t);
    f.exponentialRampToValueAtTime(this.level === 3 ? 700 : 20000, t + time + 0.01);
  }

  onEnded() {
    // трек кончился: во время гонки сразу следующий с дропа, иначе с начала
    const name = this.pick();
    this.analyze(name).then(info => {
      if (this.level === 1 || this.level === 2) this.crossTo(name, info.drop, 0.2);
    }).catch(() => {});
    if (this.level !== 1 && this.level !== 2) this.crossTo(name, 0, 0.5);
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
    g.setTargetAtTime(LEVEL_GAIN[level], t, 0.5);
  }

  // приглушить музыку на мгновение (под «бум», молнию)
  duck(amount = 0.35, time = 0.8) {
    if (!this.started) return;
    const t = this.ctx.currentTime, g = this.ducker.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(amount, t);
    g.setTargetAtTime(1, t + 0.05, time);
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
