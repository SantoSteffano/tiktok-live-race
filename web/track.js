// Извилистая трасса с препятствиями.
// Прогресс бегуна p — в метрах вдоль трассы; sample(p) даёт точку, направление
// и «вбок» (нормаль), так что всё остальное считается в этих координатах.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Препятствия по трассе (доли длины)
const LAYOUT = [
  [0.07, 'boost'], [0.13, 'hammer'], [0.20, 'ramp'], [0.27, 'sweeper'], [0.34, 'slime'],
  [0.41, 'hammer'], [0.47, 'boost'], [0.53, 'ramp'], [0.60, 'sweeper'], [0.67, 'hammer'],
  [0.73, 'slime'], [0.79, 'ramp'], [0.85, 'boost'], [0.90, 'sweeper'],
];

export class Track {
  constructor({ meters, K, roadW, low }) {
    this.L = meters;
    this.K = K;
    this.roadW = roadW;
    this.low = low;
    this.group = new THREE.Group();
    this.obstacles = [];
    this.labels = [];
    this.buildCurve();
    this.buildRoad();
    this.buildArches();
    this.buildObstacles();
  }

  // ---------- геометрия трассы ----------
  buildCurve() {
    const TL = this.L * this.K;
    const rnd = seeded(7);
    const pts = [new THREE.Vector3(0, 0, 40), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -25)];
    const step = 38;
    const n = Math.ceil((TL + 140) / step) + 2;
    const ph1 = rnd() * 6, ph2 = rnd() * 6;
    for (let i = 1; i <= n; i++) {
      // плавный «серпантин»: прямо на старте, прямо на финише, петляет в середине
      const k = i / n;
      const env = Math.min(1, k * 5) * Math.min(1, (1 - k) * 4.5);
      const x = env * (34 * Math.sin(i * 0.55 + ph1) + 14 * Math.sin(i * 1.27 + ph2));
      pts.push(new THREE.Vector3(x, 0, -25 - i * step));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.total = this.curve.getLength();
    this.s0 = 40;  // точка (0,0,0) — 40 единиц от начала кривой
    this.step = 0.5;
    const count = Math.floor(this.total / this.step) + 1;
    this.pos = [];
    for (let i = 0; i < count; i++) this.pos.push(this.curve.getPointAt(Math.min(1, i * this.step / this.total)));
    // финиш должен уместиться на кривой
    this.maxP = (this.total - this.s0 - 10) / this.K;
  }

  sample(p, out = {}) {
    const s = THREE.MathUtils.clamp(this.s0 + p * this.K, 0, this.total - this.step * 2);
    const f = s / this.step;
    const i = Math.floor(f), t = f - i;
    const a = this.pos[i], b = this.pos[i + 1], c = this.pos[Math.min(i + 2, this.pos.length - 1)];
    out.pos = (out.pos || new THREE.Vector3()).lerpVectors(a, b, t);
    const tan = (out.tan || new THREE.Vector3()).subVectors(c, a);
    tan.y = 0;
    tan.normalize();
    out.tan = tan;
    out.nor = (out.nor || new THREE.Vector3()).set(tan.z, 0, -tan.x);
    return out;
  }

  // мировая точка: прогресс p, смещение вбок lat, высота y
  point(p, lat = 0, y = 0) {
    const s = this.sample(p);
    return s.pos.clone().addScaledVector(s.nor, lat).setY(s.pos.y + y);
  }

  yaw(p) {
    const t = this.sample(p).tan;
    return Math.atan2(-t.x, -t.z);
  }

  // лента вдоль трассы: from..to метров, смещения left/right, высота, цвета
  ribbon(from, to, left, right, y, { stepM = 4, color, map, vRepeat = 4, vertical = false, bottom = 0 } = {}) {
    const verts = [], uvs = [], idx = [];
    let n = 0, dist = 0, prev = null;
    for (let p = from; p <= to + 1e-6; p += stepM) {
      const s = this.sample(p);
      if (prev) dist += prev.distanceTo(s.pos);
      prev = s.pos.clone();
      if (vertical) {
        const e = s.pos.clone().addScaledVector(s.nor, left);
        verts.push(e.x, y, e.z, e.x, bottom, e.z);
      } else {
        const a = s.pos.clone().addScaledVector(s.nor, left);
        const b = s.pos.clone().addScaledVector(s.nor, right);
        verts.push(a.x, y, a.z, b.x, y, b.z);
      }
      uvs.push(0, dist / vRepeat, 1, dist / vRepeat);
      if (n > 0) {
        const k = n * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: color ?? 0xffffff, map: map || null, roughness: 0.7, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  buildRoad() {
    const W = this.roadW, from = -60, to = this.L + 80;
    const lanes = Math.round((W - 1.5) / 1.15);
    const roadTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#b9a8ff'; g.fillRect(0, 0, w, h / 2);
      g.fillStyle = '#a593ff'; g.fillRect(0, h / 2, w, h / 2);
      g.fillStyle = 'rgba(255,255,255,.3)';
      for (let i = 1; i < lanes; i++) g.fillRect(Math.round(i * w / lanes) - 1, 0, 2, h);
    });
    roadTex.wrapT = THREE.RepeatWrapping;
    this.ribbon(from, to, -W / 2, W / 2, 0.02, { map: roadTex, vRepeat: 10 });

    const curbTex = canvasTex(4, 4, (g) => {
      g.fillStyle = '#ff3b4e'; g.fillRect(0, 0, 4, 2);
      g.fillStyle = '#ffffff'; g.fillRect(0, 2, 4, 2);
    });
    curbTex.wrapT = THREE.RepeatWrapping;
    curbTex.magFilter = THREE.NearestFilter;
    for (const side of [-1, 1]) {
      const a = side * W / 2, b = side * (W / 2 + 0.7);
      this.ribbon(from, to, Math.min(a, b), Math.max(a, b), 0.18, { map: curbTex, vRepeat: 3 });
      this.ribbon(from, to, side * (W / 2 + 0.7), 0, 0.18, { vertical: true, bottom: -2, color: 0x8f9cff });
    }

    // земля, вода и окружение
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.MeshStandardMaterial({ color: 0x7ed957, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    this.group.add(ground);

    const rnd = seeded(11);
    const trees = this.low ? 120 : 260;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x8a5a33 }), trees);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.2, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), trees);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const greens = [0x3fbf4f, 0x5ad35a, 0x2ea84a, 0x8be06a, 0xff9ad5, 0xffc44d];
    for (let i = 0; i < trees; i++) {
      const p = -40 + rnd() * (this.L + 120);
      const side = rnd() < 0.5 ? -1 : 1;
      const at = this.point(p, side * (W / 2 + 4 + rnd() * 50), 0);
      const sc = 0.7 + rnd() * 1.1;
      m4.compose(at.clone().setY(-1.2 + 1.2 * sc), q, new THREE.Vector3(sc, sc, sc));
      trunk.setMatrixAt(i, m4);
      m4.compose(at.clone().setY(-1.2 + 3.6 * sc), q.setFromAxisAngle(UP, rnd() * 6), new THREE.Vector3(sc, sc * 1.1, sc));
      crown.setMatrixAt(i, m4);
      crown.setColorAt(i, col.set(greens[(rnd() * (rnd() < 0.85 ? 4 : 6)) | 0]));
    }
    trunk.castShadow = crown.castShadow = !this.low;
    this.group.add(trunk, crown);

    // горы на горизонте
    const mountains = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), 40);
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, r = 380 + rnd() * 200;
      const h = 60 + rnd() * 120;
      m4.compose(new THREE.Vector3(Math.cos(a) * r, h / 2 - 2, -this.L * this.K / 2 + Math.sin(a) * r), q.identity(), new THREE.Vector3(h * 0.9, h, h * 0.9));
      mountains.setMatrixAt(i, m4);
      mountains.setColorAt(i, col.set([0x8fa6ff, 0xa7b8ff, 0x9c8cff, 0xb3a3ff][i % 4]));
    }
    this.group.add(mountains);

    // облака
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const puff = new THREE.IcosahedronGeometry(1, 1);
    this.clouds = [];
    for (let i = 0; i < (this.low ? 14 : 28); i++) {
      const c = new THREE.Group();
      for (let j = 0; j < 5; j++) {
        const s = new THREE.Mesh(puff, cloudMat);
        s.position.set((j - 2) * 3 + rnd() * 2, rnd() * 2, rnd() * 3);
        s.scale.setScalar(2.5 + rnd() * 2.5);
        c.add(s);
      }
      c.position.set((rnd() - 0.5) * 400, 45 + rnd() * 40, 60 - rnd() * (this.L * this.K + 200));
      this.group.add(c);
      this.clouds.push(c);
    }
  }

  orient(obj, p, lift = 0) {
    obj.position.copy(this.point(p, 0, lift));
    obj.rotation.set(0, this.yaw(p), 0);
  }

  textSprite(text, color, size) {
    const tex = canvasTex(512, 128, (g, w, h) => {
      g.font = '86px "Russo One", Impact, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 14; g.strokeStyle = '#1b1040'; g.lineJoin = 'round';
      g.strokeText(text, w / 2, h / 2);
      g.fillStyle = color; g.fillText(text, w / 2, h / 2);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    s.scale.set(size, size / 4, 1);
    this.labels.push(s);
    return s;
  }

  arch(p, colors, label, big) {
    const g = new THREE.Group();
    const R = this.roadW / 2 + 1.5;
    const segs = 9;
    for (let i = 0; i < segs; i++) {
      const piece = new THREE.Mesh(new THREE.TorusGeometry(R, big ? 1.2 : 0.8, 10, 8, Math.PI / segs),
        new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.4 }));
      piece.rotation.z = i * Math.PI / segs;
      piece.castShadow = !this.low;
      g.add(piece);
    }
    if (label) {
      const s = this.textSprite(label, '#ffffff', big ? 14 : 7);
      s.position.set(0, R + (big ? 3.4 : 2.2), 0);
      g.add(s);
    }
    this.orient(g, p);
    this.group.add(g);
  }

  buildArches() {
    this.arch(0, [0x3d7bff, 0xffffff], 'СТАРТ', true);
    for (let p = 200; p < this.L; p += 200) this.arch(p, [0xff5cb8, 0x7cf0ff], `${p} м`, false);
    this.arch(this.L, [0xff3b4e, 0xffffff], '🏁 ФИНИШ 🏁', true);
    const checker = canvasTex(64, 16, (g) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 4, y * 4, 4, 4); }
    });
    checker.magFilter = THREE.NearestFilter;
    this.ribbon(this.L - 2, this.L + 2, -this.roadW / 2, this.roadW / 2, 0.04, { map: checker, stepM: 2, vRepeat: 4 });
    this.ribbon(-2, 2, -this.roadW / 2, this.roadW / 2, 0.04, { map: checker, stepM: 2, vRepeat: 4 });
  }

  // ---------- препятствия ----------
  buildObstacles() {
    const W = this.roadW;
    const stripes = (a, b) => {
      const t = canvasTex(8, 8, (g) => { g.fillStyle = a; g.fillRect(0, 0, 8, 8); g.fillStyle = b; g.fillRect(0, 0, 8, 4); });
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.NearestFilter;
      return t;
    };
    const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, ...extra });
    const shadow = m => { m.castShadow = !this.low; return m; };

    for (const [frac, type] of LAYOUT) {
      const p = frac * this.L;
      const o = { type, p, phase: frac * 17 };
      const root = new THREE.Group();
      this.orient(root, p);
      this.group.add(root);
      o.root = root;

      if (type === 'hammer') {
        // рама над дорогой и три маятника
        const H = 10;
        for (const s of [-1, 1]) {
          const post = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.8, H, 0.8), mat(0x5b4bff)));
          post.position.set(s * (W / 2 + 1), H / 2, 0);
          root.add(post);
        }
        const beam = shadow(new THREE.Mesh(new THREE.BoxGeometry(W + 3, 0.9, 0.9), mat(0x5b4bff)));
        beam.position.y = H;
        root.add(beam);
        o.hammers = [-6, 0, 6].map((x, i) => {
          const pivot = new THREE.Group();
          pivot.position.set(x, H, 0);
          const R = 7.6;
          const rod = new THREE.Mesh(new THREE.BoxGeometry(0.3, R, 0.3), mat(0xdddddd, { metalness: 0.6 }));
          rod.position.y = -R / 2;
          const head = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.6, 16), mat(0xffffff, { map: stripes('#ff3b4e', '#ffffff') })));
          head.rotation.x = Math.PI / 2;
          head.position.y = -R;
          pivot.add(rod, head);
          root.add(pivot);
          return { pivot, x, R, H, phase: i * 1.7 };
        });
      } else if (type === 'sweeper') {
        const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 2, 12), mat(0xffd84d)));
        post.position.y = 1;
        const bar = shadow(new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.8, 0.8), mat(0xffffff, { map: stripes('#ff8a1a', '#222222') })));
        bar.position.y = 1.1;
        const spin = new THREE.Group();
        spin.add(bar);
        root.add(post, spin);
        o.spin = spin;
      } else if (type === 'ramp') {
        const len = 5, h = 1.4;
        const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(len, 0), new THREE.Vector2(len, h)]);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
        geo.translate(0, 0, -W / 2);
        geo.rotateY(Math.PI / 2);  // вдоль трассы (локальная -Z)
        const ramp = shadow(new THREE.Mesh(geo, mat(0xffffff, { map: stripes('#ffd84d', '#2b2b2b') })));
        ramp.material.map.repeat.set(4, 1);
        root.add(ramp);
      } else if (type === 'boost') {
        const tex = canvasTex(128, 128, (g) => {
          g.fillStyle = '#26e07f'; g.fillRect(0, 0, 128, 128);
          g.fillStyle = '#eaffef';
          for (const y of [10, 70]) { g.beginPath(); g.moveTo(64, y); g.lineTo(110, y + 40); g.lineTo(18, y + 40); g.fill(); }
        });
        tex.wrapS = THREE.RepeatWrapping;
        tex.repeat.set(6, 1);
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(W, 4), new THREE.MeshBasicMaterial({ map: tex }));
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.05;
        root.add(pad);
        o.pad = pad;
      } else if (type === 'slime') {
        o.len = 40;
        this.ribbon(p, p + o.len, -W / 2, W / 2, 0.06, { color: 0x7dff3a, stepM: 2 }).material =
          new THREE.MeshStandardMaterial({ color: 0x6af03a, emissive: 0x1c6a00, roughness: 0.15, metalness: 0.1 });
      }
      this.obstacles.push(o);
    }
  }

  update(t) {
    for (const o of this.obstacles) {
      if (o.hammers) for (const h of o.hammers) h.pivot.rotation.z = this.hammerAngle(h, t);
      if (o.spin) o.spin.rotation.y = this.sweepAngle(o, t);
      if (o.pad) o.pad.material.map.offset.y = -t * 1.5;
    }
    for (const c of this.clouds || []) c.position.x += Math.sin(t * 0.05 + c.position.z) * 0.01;
  }

  hammerAngle(h, t) { return 1.15 * Math.sin(t * 2.1 + h.phase); }
  sweepAngle(o, t) { return t * 1.7 + o.phase; }

  slowdown(p) {
    for (const o of this.obstacles) if (o.type === 'slime' && p >= o.p && p <= o.p + o.len) return 0.5;
    return 1;
  }

  // Бегун пробежал отрезок prev→now: что с ним случилось?
  interact(prev, now, lat, t) {
    const out = [];
    for (const o of this.obstacles) {
      if (!(prev < o.p && now >= o.p)) continue;
      if (o.type === 'hammer') {
        for (const h of o.hammers) {
          const a = this.hammerAngle(h, t);
          const headLat = h.x + h.R * Math.sin(a);
          const headY = h.H - h.R * Math.cos(a);
          // локальная ось X рамы противоположна нормали трассы
          if (headY < 3.4 && Math.abs(-lat - headLat) < 1.9) { out.push({ type: 'hit', by: 'hammer', o }); break; }
        }
      } else if (o.type === 'sweeper') {
        const s = Math.abs(Math.sin(this.sweepAngle(o, t)));
        if (s < 0.3) out.push({ type: 'hit', by: 'sweeper', o });
        else if (s < 0.55) out.push({ type: 'hop', o });
      } else if (o.type === 'ramp') out.push({ type: 'ramp', o });
      else if (o.type === 'boost') out.push({ type: 'pad', o });
      else if (o.type === 'slime') out.push({ type: 'slime', o });
    }
    return out;
  }

  nextObstacle(p) {
    return this.obstacles.find(o => o.p > p);
  }
}
