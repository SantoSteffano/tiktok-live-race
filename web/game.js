// 3D-гонка чата: кубические человечки бегут по неоновой трассе, зрители
// TikTok LIVE вступают из чата и бустят их лайками и подарками.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Audio } from './audio.js';

const W = 1080, H = 1920;
const params = new URLSearchParams(location.search);
// ?quality=low — для облака без видеокарты: без свечения и с меньшим разрешением
const LOW = params.get('quality') === 'low';
const $ = s => document.querySelector(s);

// ---------------- рендер ----------------
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: !LOW, powerPreference: 'high-performance' });
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07020f);
scene.fog = new THREE.Fog(0x1a0430, 40, 170);
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 500);

let composer = null;
if (!LOW) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.9, 0.5, 0.82));
  composer.addPass(new OutputPass());
}

let fitScale = 1;
function fit() {
  fitScale = Math.min(innerWidth / W, innerHeight / H);
  stage.style.position = 'absolute';
  stage.style.left = '50%';
  stage.style.top = '50%';
  stage.style.transform = `translate(-50%, -50%) scale(${fitScale})`;
  const pr = Math.min(fitScale * devicePixelRatio, LOW ? 0.75 : 1.5);
  renderer.setPixelRatio(pr);
  renderer.setSize(W, H, false);
  if (composer) { composer.setPixelRatio(pr); composer.setSize(W, H); }
  glow.material.uniforms.resY.value = H * pr;
  confetti.material.uniforms.resY.value = H * pr;
}

scene.add(new THREE.HemisphereLight(0xc8a0ff, 0x2a0040, 1.7));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(12, 30, -20);
scene.add(keyLight);

// ---------------- утилиты ----------------
const audio = new Audio();
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); };
const hueOf = id => hash(id) % 360;
const cssColor = id => `hsl(${hueOf(id)} 95% 62%)`;
const short = (s, n = 14) => { const a = [...String(s)]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function emojiTex(e) {
  return canvasTex(128, 128, (g) => {
    g.font = '100px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(e, 64, 72);
  });
}

function textSprite(text, color, size = 4) {
  const tex = canvasTex(512, 128, (g, w, h) => {
    g.font = '80px "Russo One", Impact, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 24;
    g.fillStyle = '#fff';
    g.fillText(text, w / 2, h / 2);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(size, size / 4, 1);
  return s;
}

// ---------------- частицы (одна отрисовка на систему) ----------------
class Particles {
  constructor(n, tex, blending) {
    this.n = n;
    this.next = 0;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.grav = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, resY: { value: H } },
      vertexShader: `
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        uniform float resY; varying vec3 vC; varying float vA;
        void main() {
          vC = pcolor; vA = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * projectionMatrix[1][1] * resY / (2.0 * -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vC; varying float vA;
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(p, v, { life = 1, size = 0.5, color = 0xffffff, grow = 0, grav = 0 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    const c = new THREE.Color(color);
    this.col.set([c.r, c.g, c.b], i * 3);
    this.size[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.grow[i] = grow;
    this.grav[i] = grav;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = Math.max(0, this.size[i] + this.grow[i] * dt);
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.pcolor.needsUpdate = a.psize.needsUpdate = a.palpha.needsUpdate = true;
  }
}

const softTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
const squareTex = canvasTex(16, 16, (g) => { g.fillStyle = '#fff'; g.fillRect(2, 4, 12, 8); });
const glow = new Particles(LOW ? 700 : 1500, softTex, THREE.AdditiveBlending);
const confetti = new Particles(LOW ? 300 : 600, squareTex, THREE.NormalBlending);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// эмодзи-спрайты (сердечки от лайков и т.п.)
const emojiCache = new Map();
const floaters = [];
function floatEmoji(e, pos, { size = 1.2, life = 1.5, vy = 2.5 } = {}) {
  if (floaters.length > 60) return;
  if (!emojiCache.has(e)) emojiCache.set(e, emojiTex(e));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiCache.get(e), transparent: true, depthWrite: false }));
  s.position.copy(pos);
  s.scale.set(size, size, 1);
  scene.add(s);
  floaters.push({ s, life, max: life, vy, vx: rand(-0.6, 0.6) });
}

// кольца-ударные волны и вспышки
const rings = [];
function shockwave(pos, color = 0x20f0ff, size = 6, life = 0.7) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.copy(pos).setY(0.1);
  scene.add(m);
  rings.push({ m, life, max: life, size });
}

function burst(pos, color, n = 30, speed = 6, size = 0.6) {
  for (let i = 0; i < n; i++) {
    const d = V(rand(-1, 1), rand(0, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(0.3, 1) * speed);
    glow.spawn(pos, d, { life: rand(0.4, 0.9), size, color, grav: 6 });
  }
}

function confettiBurst(pos, n = 160) {
  const colors = [0xff2bd6, 0x20f0ff, 0xffd84d, 0x7dff5a, 0xffffff, 0xff7a1a];
  for (let i = 0; i < n; i++) {
    const v = V(rand(-6, 6), rand(8, 18), rand(-6, 6));
    confetti.spawn(pos, v, { life: rand(1.5, 3), size: rand(0.35, 0.6), color: colors[i % colors.length], grav: 12 });
  }
}

// ---------------- трасса ----------------
let L = 600;               // метры (из config)
const K = 0.25;            // метров → мировые единицы
let MAX = 16;
const LANE = 1.15;
const zOf = p => -p * K;
const world = new THREE.Group();
scene.add(world);
let finishZ = 0;

const archLabels = [];
function buildTrack() {
  world.clear();
  archLabels.length = 0;
  const TL = L * K;
  finishZ = zOf(L);
  const roadW = MAX * LANE + 2;

  // земля-сетка в стиле synthwave
  const grid = new THREE.GridHelper(800, 160, 0xff2bd6, 0x5a1a8a);
  grid.position.set(0, -0.05, -TL / 2);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  world.add(grid);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshBasicMaterial({ color: 0x0b0216 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.1, -TL / 2);
  world.add(ground);

  // дорога с разметкой дорожек
  const roadTex = canvasTex(MAX * 32, 64, (g, w, h) => {
    g.fillStyle = '#160a2a'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(32,240,255,.45)';
    for (let i = 1; i < MAX; i++) g.fillRect(i * 32 - 1, 0, 2, h * 0.6);
  });
  roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1, (TL + 80) / 3);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(roadW, TL + 80),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.5, metalness: 0.4 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -TL / 2);
  world.add(road);

  // неоновые бортики
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, TL + 80),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff2bd6 : 0x20f0ff }));
    rail.position.set(side * (roadW / 2 + 0.2), 0.2, -TL / 2);
    world.add(rail);
  }

  // арки каждые 100 м, старт и финиш
  const arch = (p, color, label, big = false) => {
    const z = zOf(p), h = big ? 9 : 6.5, m = new THREE.MeshBasicMaterial({ color });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.5), m);
      post.position.set(side * (roadW / 2 + 0.6), h / 2, z);
      world.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(roadW + 1.7, 0.5, 0.5), m);
    top.position.set(0, h, z);
    world.add(top);
    if (label) {
      const s = textSprite(label, '#' + new THREE.Color(color).getHexString(), big ? 12 : 4);
      s.position.set(0, h + (big ? 2 : 0.9), z);
      world.add(s);
      archLabels.push(s);
    }
  };
  arch(0, 0x20f0ff, 'СТАРТ', true);
  for (let p = 100; p < L; p += 100) arch(p, p % 200 ? 0xff2bd6 : 0x20f0ff, `${p} м`);
  arch(L, 0xffd84d, '🏁 ФИНИШ 🏁', true);

  const checker = canvasTex(64, 16, (g) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 4, y * 4, 4, 4);
    }
  });
  checker.magFilter = THREE.NearestFilter;
  checker.repeat.set(roadW / 4, 1);
  checker.wrapS = THREE.RepeatWrapping;
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(roadW, 1.2), new THREE.MeshBasicMaterial({ map: checker }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.02, finishZ);
  world.add(strip);

  // пьедестал за финишем
  const podMat = new THREE.MeshStandardMaterial({ color: 0x2a1050, emissive: 0x3a0a60, roughness: 0.3 });
  PODIUM.forEach(({ x, h }, i) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, h, 2.6), podMat);
    b.position.set(x, h / 2, finishZ - 14);
    world.add(b);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.12, 2.7),
      new THREE.MeshBasicMaterial({ color: [0xffd84d, 0xd0d8ff, 0xff9a4d][i] }));
    edge.position.set(x, h, finishZ - 14);
    world.add(edge);
    const n = textSprite(String(i + 1), '#ffd84d', 3);
    n.position.set(x, h / 2, finishZ - 15.35);
    world.add(n);
  });

  // неоновый город по сторонам
  const winTex = canvasTex(64, 128, (g) => {
    g.fillStyle = '#0d0420'; g.fillRect(0, 0, 64, 128);
    const cols = ['#ff2bd6', '#20f0ff', '#ffd84d', '#b44dff'];
    for (let y = 4; y < 124; y += 8) for (let x = 4; x < 60; x += 8) {
      if (Math.random() < 0.35) { g.fillStyle = cols[(Math.random() * 4) | 0]; g.fillRect(x, y, 4, 4); }
    }
  });
  const count = LOW ? 70 : 150;
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: winTex, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: 1.1 }), count);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const w = rand(4, 9), h = rand(8, 40), d = rand(4, 9);
    const x = side * (roadW / 2 + rand(10, 60));
    const z = rand(-TL - 120, 140);
    m4.compose(V(x, h / 2, z), new THREE.Quaternion(), V(w, h, d));
    city.setMatrixAt(i, m4);
  }
  world.add(city);

  // закатное солнце synthwave за стартом (камера смотрит назад, на старт)
  const sunTex = canvasTex(256, 256, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#ffe14d'); gr.addColorStop(0.55, '#ff4d8d'); gr.addColorStop(1, '#a01aff');
    g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) g.fillRect(0, 140 + i * 17, 256, 4 + i);
  });
  const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
    new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false }));
  sunMesh.position.set(0, 38, 230);
  sunMesh.rotation.y = Math.PI;
  world.add(sunMesh);

  const starGeo = new THREE.BufferGeometry();
  const stars = new Float32Array(1500);
  for (let i = 0; i < 500; i++) stars.set([rand(-400, 400), rand(40, 220), rand(-400, 400)], i * 3);
  starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  world.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, fog: false })));
}

const PODIUM = [{ x: 0, h: 2.2 }, { x: -2.8, h: 1.5 }, { x: 2.8, h: 1.0 }];

// ---------------- человечки ----------------
const SKINS = ['#ffd8b0', '#f1c08e', '#c98b5c', '#8d5a3b'];
const faceCache = new Map();
function faceTex(skin, mood) {
  const key = skin + mood;
  if (faceCache.has(key)) return faceCache.get(key);
  const t = canvasTex(64, 64, (g) => {
    g.fillStyle = skin; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#111';
    if (mood === 'cool') {
      g.fillRect(8, 20, 48, 6); g.fillRect(10, 22, 18, 12); g.fillRect(36, 22, 18, 12);
      g.fillRect(22, 46, 20, 4);
    } else if (mood === 'stun') {
      g.lineWidth = 4; g.strokeStyle = '#111';
      for (const cx of [20, 44]) { g.beginPath(); g.moveTo(cx - 6, 20); g.lineTo(cx + 6, 32); g.moveTo(cx + 6, 20); g.lineTo(cx - 6, 32); g.stroke(); }
      g.beginPath(); g.arc(32, 50, 6, 0, Math.PI * 2); g.fill();
    } else {
      g.fillRect(16, 22, 8, 10); g.fillRect(40, 22, 8, 10);
      if (mood === 'happy') { g.beginPath(); g.arc(32, 42, 12, 0, Math.PI); g.fill(); }
      else g.fillRect(22, 46, 20, 4);
    }
  });
  t.magFilter = THREE.NearestFilter;
  faceCache.set(key, t);
  return t;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function part(mat, sx, sy, sz, x, y, z, parent) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function makeBody(id, bot) {
  const h = hash(id);
  const shirt = new THREE.Color().setHSL(hueOf(id) / 360, bot ? 0.1 : 0.85, bot ? 0.45 : 0.55);
  const skin = SKINS[h % SKINS.length];
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.6 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: shirt.clone().multiplyScalar(0.35), roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: ['#1a1a1a', '#5a3214', '#e8c15a', '#ff4dd2', '#3dd6ff'][h % 5] });
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex(skin, 'normal'), roughness: 0.7 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  part(shirtMat, 0.9, 1.0, 0.5, 0, 1.45, 0, body);
  const head = new THREE.Mesh(boxGeo, [skinMat, skinMat, hairMat, skinMat, skinMat, faceMat]);
  head.scale.set(0.78, 0.78, 0.78);
  head.position.set(0, 2.36, 0);
  body.add(head);
  const limb = (mat, x, y, len, w) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    part(mat, w, len, w, 0, -len / 2, 0, pivot);
    body.add(pivot);
    return pivot;
  };
  const armL = limb(shirtMat, -0.62, 1.92, 0.95, 0.3);
  const armR = limb(shirtMat, 0.62, 1.92, 0.95, 0.3);
  const legL = limb(pantsMat, -0.23, 0.95, 0.95, 0.38);
  const legR = limb(pantsMat, 0.23, 0.95, 0.95, 0.38);
  root.scale.setScalar(0.85);

  // аура-свечение для высоких титулов
  const auraSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softTex, color: 0xb44dff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
  }));
  auraSprite.scale.set(4, 5, 1);
  auraSprite.position.y = 1.6;
  body.add(auraSprite);
  const acc = new THREE.Group();
  head.add(acc);
  return { root, body, head, armL, armR, legL, legR, faceMat, skin, acc, auraSprite, mood: 'normal' };
}

const gold = new THREE.MeshStandardMaterial({ color: 0xffd84d, emissive: 0x9a6a00, metalness: 0.8, roughness: 0.25 });
function setAccessory(r) {
  const acc = r.body.acc;
  acc.clear();
  const tier = r.tier;
  const h = hash(r.id);
  if (r.champion) {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8, 1, true), gold);
    crown.position.y = 0.66;
    acc.add(crown);
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 4), gold);
      const a = i / 5 * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.38, 0.92, Math.sin(a) * 0.38);
      acc.add(spike);
    }
  } else if (h % 3 === 1 && !r.bot) {
    const cap = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(((hueOf(r.id) + 180) % 360) / 360, 0.9, 0.5) });
    part(cap, 1.04, 0.28, 1.04, 0, 0.58, 0, acc);
    part(cap, 1.04, 0.08, 0.5, 0, 0.46, -0.7, acc);
  } else if (h % 3 === 2 && !r.bot) {
    const horn = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0x500000 });
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 8), horn);
      c.position.set(s * 0.3, 0.7, 0);
      c.rotation.z = -s * 0.35;
      acc.add(c);
    }
  }
  if (tier >= 3) {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff2a0 }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.05;
    acc.add(halo);
  }
  r.baseMood = tier >= 2 ? 'cool' : 'normal';   // с «сигмы» — в очках
  if (r.body.mood === 'normal' || r.body.mood === 'cool') setMood(r, r.baseMood);
  const am = r.body.auraSprite.material;
  am.opacity = tier >= 4 ? 0.75 : 0;
  am.color.set(tier >= 5 ? 0xffd84d : 0xb44dff);
}

function setMood(r, mood) {
  if (r.body.mood === mood) return;
  r.body.mood = mood;
  r.body.faceMat.map = faceTex(r.body.skin, mood);
  r.body.faceMat.needsUpdate = true;
}

// ---------------- состояние игры ----------------
let CFG = null, RACE = null;
let phase = 'wait';
let phaseEnd = 0;
let clock = 0;             // игровое время (замедляется на фотофинише)
let timeScale = 1, slowUntil = 0;
let raceStart = 0, firstFinish = null, finishedCount = 0, round = 0;
let botsAdded = false, finalStretch = false;
let leaderId = null, leadChangeAt = 0;
let racers = [];
const queue = new Map();   // id → {user, pending}
const wins = new Map();    // id → {name, n}
let championId = null;
let delayed = [];          // молнии/ядерки, отправленные до старта
let results = [];
let status = '';
let countdownShown = -1;
let auraTop = [];

const tagsEl = $('#tags');

function tierOf(aura) {
  let t = 0;
  (CFG?.titles || []).forEach(([need], i) => { if (aura >= need) t = i; });
  return t;
}

function newRacer(user, bot = false) {
  const r = {
    id: user.id, name: user.name, aura: user.aura || 0, title: user.title || '', bot,
    p: 0, base: 1, boosts: [], jumpLeft: 0, jumpTotal: 0, stunUntil: 0,
    finish: null, place: null, pending: [], lane: 0, x: 0, y: 14, vy: 0, landed: false,
    anim: Math.random() * 6, dance: false, wf: rand(0.7, 1.5), wp: rand(0, 6.28),
  };
  r.tier = tierOf(r.aura);
  r.champion = r.id === championId;
  r.body = makeBody(r.id, bot);
  setAccessory(r);
  scene.add(r.body.root);
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.innerHTML = '<span class="t"></span><span class="n"></span>';
  tag.style.setProperty('--c', bot ? '#bbb' : cssColor(r.id));
  tagsEl.appendChild(tag);
  r.tag = tag;
  refreshTag(r);
  return r;
}

function refreshTag(r) {
  r.tag.querySelector('.n').textContent = short(r.name);
  const t = r.tag.querySelector('.t');
  t.textContent = r.bot ? 'NPC' : `${r.title} · ${r.aura}✨`;
  const tierColors = ['#9aa0b5', '#7dff5a', '#20f0ff', '#ff2bd6', '#c58bff', '#ffd84d'];
  r.tag.style.setProperty('--tc', tierColors[clamp(r.tier, 0, 5)]);
}

function removeRacer(r) {
  scene.remove(r.body.root);
  r.tag.remove();
  racers = racers.filter(x => x !== r);
}

function laneX(slot) {
  // от центра к краям: 0, +1, -1, +2, -2…
  const k = Math.ceil(slot / 2) * (slot % 2 ? 1 : -1);
  return k * LANE + (MAX % 2 ? 0 : LANE / 2);
}

function takeSlot() {
  const used = new Set(racers.map(r => r.lane));
  for (let s = 0; s < MAX; s++) if (!used.has(s)) return s;
  return 0;
}

function placeAtStart(r) {
  r.lane = takeSlot();
  r.x = laneX(r.lane);
  r.p = -4;
  r.y = 14 + rand(0, 6);
  r.vy = 0;
  r.landed = false;
}

// ---------------- фазы ----------------
function startLobby() {
  for (const r of racers) removeRacer(r);
  racers = [];
  for (const [id, q] of queue) {
    if (racers.length >= RACE.max_racers) break;
    const r = newRacer(q.user);
    r.pending = q.pending;
    placeAtStart(r);
    racers.push(r);
    queue.delete(id);
  }
  phase = 'lobby';
  phaseEnd = clock + RACE.lobby_seconds;
  botsAdded = false;
  finalStretch = false;
  countdownShown = -1;
  delayed = [];
  audio.setLevel(0);
  $('#results').classList.remove('show');
}

function addBots() {
  botsAdded = true;
  let b = 1;
  while (racers.length < RACE.bots_fill_to) {
    const r = newRacer({ id: '__npc' + b, name: 'NPC #' + b }, true);
    placeAtStart(r);
    racers.push(r);
    b++;
  }
}

function startRace() {
  round++;
  for (const r of racers) {
    r.base = RACE.base_speed * rand(0.92, 1.08) * (r.bot ? 0.97 : 1);
    r.p = 0; r.y = 0; r.vy = 0; r.landed = true;
    const now = r.pending;
    r.pending = [];
    for (const [effect, count, extra] of now) {
      if (effect.kind === 'lightning' || effect.kind === 'nuke') {
        delayed.push({ at: clock + 3 + delayed.length * 1.5, r, effect, count, extra });
      } else {
        apply(r, effect, count, extra);
      }
    }
    // накопленное в лобби не должно решать гонку до старта
    r.jumpLeft = Math.min(r.jumpLeft, L * 0.25);
    r.jumpTotal = r.jumpLeft;
  }
  phase = 'race';
  raceStart = clock;
  firstFinish = null;
  finishedCount = 0;
  leaderId = null;
  audio.setLevel(1);
  audio.play('go');
  flash(0.5);
  showCountdown('GO!');
  pushFeed(`🏁 СТАРТ! Забег #${round}`, '#ffd84d', true);
}

function endRace() {
  results = [...racers].sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9) || b.p - a.p);
  const winner = results.find(r => r.place === 1 && !r.bot);
  if (winner) {
    const w = wins.get(winner.id) || { name: winner.name, n: 0 };
    w.n++; w.name = winner.name;
    wins.set(winner.id, w);
    championId = [...wins.entries()].sort((a, b) => b[1].n - a[1].n)[0][0];
    send({ type: 'win', id: winner.id, name: winner.name });
  }
  // топ-3 — на пьедестал
  results.slice(0, 3).forEach((r, i) => {
    r.podium = i;
    r.dance = true;
    setMood(r, i === 0 ? 'cool' : 'happy');
  });
  for (const r of racers) { r.champion = r.id === championId; setAccessory(r); }
  phase = 'results';
  phaseEnd = clock + RACE.results_seconds;
  audio.setLevel(3);
  renderResults(winner);
}

// ---------------- эффекты ----------------
let lastSound = {};
function sound(name, gap = 0.12) {
  const t = performance.now() / 1000;
  if (t - (lastSound[name] || 0) < gap) return;
  lastSound[name] = t;
  audio.play(name);
}

let shake = 0, fovKick = 0;
function flash(strength = 0.9) {
  const f = $('#flash');
  f.style.setProperty('--fa', strength);
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}

const bannerQueue = [];
let bannerBusyUntil = 0;
function banner(text, sub = '') {
  if (bannerQueue.length >= 3) return;
  bannerQueue.push({ text, sub });
}
function pumpBanner() {
  const t = performance.now();
  if (t < bannerBusyUntil || !bannerQueue.length) return;
  const { text, sub } = bannerQueue.shift();
  const b = $('#banner');
  b.innerHTML = '';
  b.append(text);
  if (sub) { const s = document.createElement('small'); s.textContent = sub; b.append(s); }
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  bannerBusyUntil = t + 2300;
}

function showCountdown(text) {
  const c = $('#countdown');
  c.textContent = text;
  c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
}

const stage3 = new THREE.Vector3();
function toScreen(pos) {
  stage3.copy(pos).project(camera);
  return { x: (stage3.x + 1) / 2 * W, y: (1 - stage3.y) / 2 * H, behind: stage3.z > 1 };
}

function pop(text, worldPos, color = '#fff', emoji = false) {
  const s = toScreen(worldPos);
  if (s.behind || s.x < -100 || s.x > W + 100 || s.y < 0 || s.y > H) return;
  const el = document.createElement('div');
  el.className = 'pop' + (emoji ? ' emoji' : '');
  el.textContent = text;
  el.style.left = s.x + 'px';
  el.style.top = s.y + 'px';
  el.style.setProperty('--c', color);
  $('#hud').appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

const headPos = r => V(r.x, r.y + 3.1, zOf(r.p));

function apply(r, effect, count, extra = {}) {
  count = clamp(count | 0, 1, 10);
  const pos = V(r.x, r.y + 1.5, zOf(r.p));
  const color = cssColor(r.id);
  if (effect.kind === 'boost') {
    r.boosts.push({ mult: effect.multiplier, until: clock + effect.seconds * count });
    if (extra.source === 'like') {
      floatEmoji('❤️', V(r.x + rand(-0.5, 0.5), r.y + 2.8, zOf(r.p)), { size: 0.9 });
    } else {
      burst(pos, 0xffa020, 26, 7);
      pop('⚡ ТУРБО', headPos(r), '#ffd84d');
      sound('boost');
      fovKick = Math.max(fovKick, 5);
    }
  } else if (effect.kind === 'jetpack') {
    r.jumpLeft = Math.min(r.jumpLeft + effect.meters * count, L * 0.33);
    r.jumpTotal = r.jumpLeft;
    pop('🚀 ДЖЕТПАК', headPos(r), '#20f0ff');
    sound('jetpack', 0.3);
    shockwave(pos, 0x20f0ff, 5);
  } else if (effect.kind === 'lightning') {
    strikeLeader(r, effect.seconds * count);
  } else if (effect.kind === 'nuke') {
    nuke(r, effect);
  }
}

function runningLeader(exclude) {
  return racers.filter(x => x !== exclude && x.place === null)
    .sort((a, b) => b.p - a.p)[0];
}

const bolts = [];
function bolt(target) {
  const top = V(target.x + rand(-3, 3), 40, zOf(target.p) + rand(-3, 3));
  const end = V(target.x, target.y + 1.5, zOf(target.p));
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const p = top.clone().lerp(end, i / 10);
    if (i > 0 && i < 10) p.add(V(rand(-1.4, 1.4), 0, rand(-1.4, 1.4)));
    pts.push(p);
  }
  const path = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
  const m = new THREE.Mesh(new THREE.TubeGeometry(path, 40, 0.18, 5, false),
    new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, blending: THREE.AdditiveBlending }));
  scene.add(m);
  bolts.push({ m, life: 0.45 });
  burst(end, 0x60e8ff, 50, 9, 0.8);
  shockwave(end, 0x60e8ff, 8);
}

function stun(r, seconds) {
  r.stunUntil = Math.max(r.stunUntil, clock + seconds);
  r.jumpLeft = 0;
  setMood(r, 'stun');
  floatEmoji('💀', headPos(r), { size: 1.6, life: 1.6, vy: 1.5 });
}

function strikeLeader(sender, seconds) {
  const target = runningLeader(sender);
  if (!target) return;
  bolt(target);
  stun(target, seconds);
  flash(0.45);
  shake = Math.max(shake, 0.8);
  sound('lightning', 0.2);
  pushFeed(`⚡ ${short(sender.name)} ударил молнией ${short(target.name)}!`, '#60e8ff', true);
}

function nuke(sender, effect) {
  const pos = V(sender.x, 1, zOf(sender.p));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  ball.position.copy(pos);
  scene.add(ball);
  rings.push({ m: ball, life: 1.4, max: 1.4, size: 26, sphere: true });
  shockwave(pos, 0xffd84d, 40, 1.4);
  burst(pos, 0xff6a00, 140, 18, 1.2);
  for (const r of racers) if (r !== sender && r.place === null) stun(r, effect.seconds);
  sender.jumpLeft = Math.min(sender.jumpLeft + effect.meters, L * 0.33);
  sender.jumpTotal = sender.jumpLeft;
  flash();
  shake = 1.6;
  sound('nuke', 0.5);
  banner('☢️ ЯДЕРКА ☢️', `от ${short(sender.name, 18)}`);
}

// ---------------- события от сервера ----------------
function updateUser(user) {
  const touch = r => {
    r.name = user.name; r.aura = user.aura ?? r.aura; r.title = user.title ?? r.title;
    const tier = tierOf(r.aura);
    if (tier !== r.tier) {
      const up = tier > r.tier;
      r.tier = tier;
      setAccessory(r);
      if (up && tier >= 2) {
        pop(`✨ ${r.title.toUpperCase()}`, headPos(r), '#c58bff');
        pushFeed(`✨ ${short(r.name)} теперь «${r.title}»`, '#c58bff', true);
      }
    }
    refreshTag(r);
  };
  racers.filter(r => r.id === user.id).forEach(touch);
  const q = queue.get(user.id);
  if (q) q.user = user;
}

function queueUser(user) {
  const q = queue.get(user.id) || { user, pending: [] };
  q.user = user;
  queue.set(user.id, q);
  return q;
}

function addPlayer(user) {
  let r = racers.find(x => x.id === user.id);
  if (r && phase === 'lobby') return r;
  if (phase === 'lobby' && racers.filter(x => !x.bot).length < RACE.max_racers) {
    const q = queue.get(user.id);
    // живой зритель вытесняет NPC
    if (racers.length >= RACE.max_racers || (botsAdded && racers.length >= RACE.bots_fill_to)) {
      const bot = racers.find(x => x.bot);
      if (bot) removeRacer(bot);
    }
    if (racers.length >= RACE.max_racers) return queueUser(user);
    r = newRacer(user);
    if (q) { r.pending = q.pending; queue.delete(user.id); }
    placeAtStart(r);
    racers.push(r);
    pushFeed(`${short(user.name, 18)} в забеге!`, cssColor(user.id));
    return r;
  }
  return queueUser(user);
}

function onEffect(user, effect, count, extra) {
  updateUser(user);
  const r = racers.find(x => x.id === user.id);
  if (phase === 'race' && r && r.place === null) {
    apply(r, effect, count, extra);
  } else {
    const target = phase === 'lobby' ? addPlayer(user) : queueUser(user);
    if (target.pending.length < 20) target.pending.push([effect, count, extra]);
    if (r && phase === 'lobby') floatEmoji('⚡', headPos(r), { size: 1 });
  }
  if (extra.source !== 'like') {
    const big = effect.kind === 'lightning' || effect.kind === 'nuke' || (extra.diamonds || 0) >= 10;
    pushFeed(`${short(user.name, 16)}: ${effect.label}`, cssColor(user.id), big);
    if ((extra.diamonds || 0) >= 30 && effect.kind !== 'nuke') {
      banner(effect.label.split(' (')[0], short(user.name, 18) + (phase === 'race' ? '' : ' · после старта'));
    }
  }
}

function onEmote(user, emoji) {
  updateUser(user);
  const r = racers.find(x => x.id === user.id);
  if (r) {
    floatEmoji(emoji, headPos(r).add(V(0, 0.8, 0)), { size: 2.2, life: 1.8, vy: 1.2 });
    if (emoji === '🗿' || emoji === '💀') sound('boom', 0.8);
  }
}

function pushFeed(text, color, big = false) {
  const feed = $('#feed');
  const el = document.createElement('div');
  el.className = 'f' + (big ? ' big' : '');
  el.textContent = text;
  el.style.setProperty('--c', color);
  feed.prepend(el);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 700); }, big ? 9000 : 6000);
}

let ws = null;
function send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type === 'config') {
      const first = !CFG;
      CFG = m.config; RACE = CFG.race;
      if (first) {
        L = RACE.track_meters; MAX = RACE.max_racers;
        buildLegend();
        // надписи на арках рисуются шрифтом — ждём его (но не дольше 2 с)
        const fontReady = document.fonts.load('80px "Russo One"').catch(() => {});
        Promise.race([fontReady, new Promise(r => setTimeout(r, 2000))]).then(() => {
          buildTrack();
          startLobby();
        });
      }
    } else if (m.type === 'status') status = m.text;
    else if (m.type === 'aura_top') { auraTop = m.top; renderAuraTop(); }
    else if (!RACE) return;
    else if (m.type === 'join') { updateUser(m.user); const r = addPlayer(m.user); if (r?.body) sound('join', 0.15); }
    else if (m.type === 'effect') onEffect(m.user, m.effect, m.count || 1, { source: m.source, diamonds: m.diamonds });
    else if (m.type === 'emote') onEmote(m.user, m.emoji);
    else if (m.type === 'user') updateUser(m.user);
  };
  ws.onclose = () => { status = 'нет связи с сервером'; setTimeout(connect, 2000); };
}

// ---------------- HUD ----------------
let legendLines = [];
function describe(e) {
  return {
    boost: `скорость ×${e.multiplier} на ${e.seconds}с`,
    jetpack: `джетпак +${e.meters} м`,
    lightning: `молния в лидера (${e.seconds}с стоит)`,
    nuke: `ЯДЕРКА: все стоят, ты летишь`,
  }[e.kind] || '';
}
function buildLegend() {
  const join = CFG.join.any_comment ? 'Пиши в чат — бежишь!' : `Пиши «${CFG.join.keywords[0]}» — бежишь!`;
  legendLines = [];
  const fx = CFG.effects;
  if (fx.like) legendLines.push(['❤️', `Лайк — ${describe(fx.like)}`]);
  if (fx.follow) legendLines.push(['➕', `Подписка — ${describe(fx.follow)}`]);
  if (fx.share) legendLines.push(['🔁', `Репост — ${describe(fx.share)}`]);
  for (const [name, e] of Object.entries(CFG.gifts_by_name || {})) {
    legendLines.push([[...e.label][0], `${name[0].toUpperCase() + name.slice(1)} — ${describe(e)}`]);
  }
  for (const t of [...(CFG.gifts_by_diamonds || [])].sort((a, b) => a.min - b.min).slice(1)) {
    legendLines.push([[...t.label][0], `Подарок ${t.min}💎+ — ${describe(t)}`]);
  }
  legendLines.push(['🗿', 'Пиши 🗿 💀 67 скибиди — мем над бегуном', 'wide']);
  const el = $('#legend');
  el.innerHTML = '';
  const mk = (ico, text, cls = '') => {
    const row = document.createElement('div');
    row.className = 'row ' + cls;
    const i = document.createElement('span'); i.className = 'ico'; i.textContent = ico;
    const t = document.createElement('span'); t.textContent = text;
    row.append(i, t);
    el.append(row);
  };
  mk('💬', join, 'join');
  legendLines.forEach(([i, t, cls]) => mk(i, t, cls));
}

function renderAuraTop() {
  const el = $('#auratop');
  el.innerHTML = '<h3>🔮 ЛЕГЕНДЫ АУРЫ</h3>';
  if (!auraTop.length) { el.innerHTML += '<div class="a"><span>пока никого — будь первым</span></div>'; return; }
  auraTop.slice(0, 5).forEach((u, i) => {
    const row = document.createElement('div');
    row.className = 'a';
    const a = document.createElement('span'); a.textContent = `${i + 1}. ${short(u.name, 16)} · ${u.title}`;
    const b = document.createElement('span'); b.textContent = `${u.aura}✨`;
    row.append(a, b);
    el.append(row);
  });
}

function renderResults(winner) {
  const el = $('#results');
  el.innerHTML = '<h2 class="neon">🏆 РЕЗУЛЬТАТЫ</h2>';
  results.slice(0, 5).forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'r';
    row.style.setProperty('--c', r.bot ? '#bbb' : cssColor(r.id));
    const m = document.createElement('span'); m.className = 'm'; m.textContent = ['🥇', '🥈', '🥉', '4', '5'][i];
    const n = document.createElement('span'); n.className = 'nm'; n.textContent = short(r.name, 16);
    const tm = document.createElement('span'); tm.className = 'tm';
    tm.textContent = r.finish !== null ? `${r.finish.toFixed(1)}с` : `${Math.round(r.p / L * 100)}%`;
    row.append(m, n, tm);
    el.append(row);
  });
  if (winner) {
    const a = document.createElement('div');
    a.className = 'aura';
    a.textContent = `+${CFG.aura.per_win} АУРЫ → ${short(winner.name, 14)}`;
    el.append(a);
  }
  setTimeout(() => el.classList.add('show'), 1200);
}

let tickerIdx = 0, tickerAt = 0, standingsAt = 0;
function updateHud(real) {
  const left = Math.max(0, Math.ceil(phaseEnd - clock));
  const humans = racers.filter(r => !r.bot).length;
  let line = 'Подключение…';
  if (phase === 'lobby') line = `Старт через ${left}с · бегунов: ${humans}/${RACE.max_racers}`;
  else if (phase === 'race') line = `ЗАБЕГ #${round} · ${Math.min(99, Math.round((racers.reduce((m, r) => Math.max(m, r.p), 0)) / L * 100))}%`;
  else if (phase === 'results') line = `Новый забег через ${left}с`;
  $('#phase').textContent = line;
  $('#status').textContent = status;

  const lobby = phase === 'lobby';
  $('#legend').classList.toggle('hidden', !lobby);
  $('#auratop').classList.toggle('hidden', !lobby);
  $('#standings').classList.toggle('hidden', phase !== 'race');
  $('#feed').classList.toggle('hidden', phase === 'results');
  const ticker = $('#ticker');
  ticker.classList.toggle('hidden', lobby || !legendLines.length);
  if (!lobby && legendLines.length && real - tickerAt > 3.5) {
    tickerAt = real;
    const extra = queue.size ? [['⏳', `В очереди: ${queue.size} — пиши, чтобы попасть`]] : [];
    const lines = [['💬', 'Пиши в чат — бежишь в след. забеге!'], ...legendLines, ...extra];
    const [i, t] = lines[tickerIdx++ % lines.length];
    ticker.textContent = `${i} ${t}`;
  }
  if (phase === 'race' && real - standingsAt > 0.25) {
    standingsAt = real;
    const top = [...racers].sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9) || b.p - a.p).slice(0, 5);
    const el = $('#standings');
    el.innerHTML = '';
    top.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'st';
      row.style.setProperty('--c', r.bot ? '#888' : cssColor(r.id));
      const pos = document.createElement('span'); pos.className = 'pos'; pos.textContent = i + 1;
      const nm = document.createElement('span'); nm.className = 'nm';
      nm.textContent = (r.stunUntil > clock ? '💫 ' : r.jumpLeft > 0 ? '🚀 ' : r.boosts.length ? '🔥 ' : '') + short(r.name, 12);
      row.append(pos, nm);
      el.append(row);
    });
  }
}

// ---------------- симуляция ----------------
function update(dt) {
  if (phase === 'lobby') {
    if (!botsAdded && clock > phaseEnd - 6) addBots();
    const left = Math.ceil(phaseEnd - clock);
    if (left <= 3 && left >= 1 && left !== countdownShown) {
      countdownShown = left;
      showCountdown(String(left));
      sound('beep', 0.5);
    }
    if (clock >= phaseEnd) startRace();
  } else if (phase === 'results' && clock >= phaseEnd) {
    startLobby();
  }

  for (const r of racers) {
    r.boosts = r.boosts.filter(b => b.until > clock);
    // падение с неба при вступлении
    if (!r.landed) {
      r.vy -= 40 * dt;
      r.y += r.vy * dt;
      if (r.y <= 0) {
        r.y = 0; r.landed = true;
        shockwave(V(r.x, 0, zOf(r.p)), 0xff2bd6, 3, 0.5);
        burst(V(r.x, 0.2, zOf(r.p)), 0xff2bd6, 14, 4, 0.4);
      }
    }
  }

  if (phase === 'race') {
    for (const d of delayed.filter(d => d.at <= clock)) apply(d.r, d.effect, d.count, d.extra);
    delayed = delayed.filter(d => d.at > clock);

    for (const r of racers) {
      if (r.place !== null) continue;
      if (r.stunUntil > clock) continue;
      if (r.body.mood === 'stun') setMood(r, r.baseMood);
      let mult = 1;
      for (const b of r.boosts) mult += b.mult - 1;
      mult = Math.min(mult, RACE.max_speed_multiplier);
      const wobble = 1 + 0.1 * Math.sin(clock * r.wf + r.wp);
      r.speed = r.base * mult * wobble;
      r.p += r.speed * dt;
      if (r.jumpLeft > 0) {
        const step = Math.min(r.jumpLeft, 90 * dt);
        r.p += step; r.jumpLeft -= step;
        const k = 1 - r.jumpLeft / r.jumpTotal;
        r.y = Math.sin(k * Math.PI) * Math.min(6, 1.5 + r.jumpTotal / 30);
        if (r.jumpLeft <= 0) {
          r.y = 0;
          shockwave(V(r.x, 0, zOf(r.p)), 0x20f0ff, 6);
          burst(V(r.x, 0.3, zOf(r.p)), 0x20f0ff, 20, 6, 0.5);
          shake = Math.max(shake, 0.25);
        }
      }
      if (r.p >= L) {
        r.p = L; r.jumpLeft = 0; r.y = 0;
        r.finish = clock - raceStart;
        r.place = ++finishedCount;
        if (r.place <= 3) pushFeed(`${['🥇', '🥈', '🥉'][r.place - 1]} ${short(r.name)} — ${r.finish.toFixed(1)}с`, cssColor(r.id), r.place === 1);
        if (r.place === 1) {
          firstFinish = clock;
          confettiBurst(V(0, 2, finishZ));
          sound('win', 1);
          banner(`${short(r.name, 14)}`, 'ПОБЕДА 🏆');
          const second = runningLeader(null);
          if (second && L - second.p < L * 0.03) {
            timeScale = 0.3; slowUntil = performance.now() / 1000 + 1.4;
            banner('📸 ФОТОФИНИШ');
          }
        }
      }
    }

    // смена лидера
    const lead = [...racers].sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9) || b.p - a.p)[0];
    if (lead && lead.id !== leaderId) {
      if (leaderId && clock - raceStart > 3 && clock - leadChangeAt > 2.5 && lead.place === null) {
        floatEmoji('🗿', headPos(lead).add(V(0, 0.6, 0)), { size: 1.8, life: 1.4, vy: 1 });
        pushFeed(`🗿 ${short(lead.name)} вырвался вперёд!`, cssColor(lead.id));
        sound('boom', 1.5);
      }
      leaderId = lead.id;
      leadChangeAt = clock;
      for (const r of racers) r.tag.classList.toggle('lead', r === lead);
    }
    if (!finalStretch && lead && lead.p > L * 0.82) {
      finalStretch = true;
      audio.setLevel(2);
      banner('ФИНИШНАЯ ПРЯМАЯ 🔥');
    }

    const allDone = racers.every(r => r.place !== null);
    const graceOver = firstFinish !== null && clock - firstFinish > RACE.finish_grace_seconds;
    if (allDone || graceOver || clock - raceStart > 240) endRace();
  }
}

// ---------------- анимация и камера ----------------
const camPos = V(0, 10, 20);
const camLook = V(0, 1, 0);
function animate(dt, real) {
  for (const r of racers) {
    const z = zOf(r.p);
    const root = r.body.root;
    let tx = r.x, ty = r.y, tz = z;
    const b = r.body;
    if (phase === 'results' && r.podium !== undefined) {
      const pd = PODIUM[r.podium];
      tx = pd.x; tz = finishZ - 14; ty = pd.h;
      root.rotation.y = Math.PI + Math.sin(real * 2) * 0.3;  // лицом к камере
    } else {
      root.rotation.y = 0;
    }
    root.position.set(tx, ty, tz);

    const stunned = r.stunUntil > clock;
    const running = phase === 'race' && r.place === null && !stunned;
    if (running) r.anim += dt * (r.speed || 10) * 0.55;
    if (r.dance) {
      const t = real * 8;
      b.armL.rotation.set(Math.PI + Math.sin(t) * 0.4, 0, 0.3);
      b.armR.rotation.set(Math.PI + Math.sin(t + 2) * 0.4, 0, -0.3);
      b.legL.rotation.x = b.legR.rotation.x = 0;
      b.body.position.y = Math.abs(Math.sin(t / 2)) * 0.5;
    } else if (stunned) {
      b.body.rotation.y += dt * 9;
      b.armL.rotation.set(0, 0, 0.6); b.armR.rotation.set(0, 0, -0.6);
    } else if (r.jumpLeft > 0) {
      b.body.rotation.y = 0;
      b.armL.rotation.set(Math.PI, 0, 0.2); b.armR.rotation.set(Math.PI, 0, -0.2);
      b.legL.rotation.x = 0.4; b.legR.rotation.x = -0.4;
      glow.spawn(V(tx, ty + 1.2, tz + 0.5), V(rand(-0.5, 0.5), -6, rand(0.5, 2)), { life: 0.4, size: 0.9, color: 0xff8a1a });
      glow.spawn(V(tx, ty + 1.2, tz + 0.5), V(rand(-0.3, 0.3), -5, rand(0.5, 1.5)), { life: 0.3, size: 0.5, color: 0xffffff });
    } else if (running) {
      b.body.rotation.y = 0;
      const s = Math.sin(r.anim);
      b.legL.rotation.x = s * 0.9; b.legR.rotation.x = -s * 0.9;
      b.armL.rotation.set(-s * 0.9, 0, 0); b.armR.rotation.set(s * 0.9, 0, 0);
      b.body.position.y = Math.abs(Math.cos(r.anim)) * 0.18;
      b.body.rotation.x = -0.12;
      if (r.boosts.some(x => x.mult >= 1.5)) {
        glow.spawn(V(tx + rand(-0.4, 0.4), ty + rand(0.4, 2), tz + 0.6), V(0, rand(0, 1), rand(3, 6)),
          { life: 0.35, size: 0.8, color: 0xff6a00 });
      } else if (r.boosts.length) {
        glow.spawn(V(tx + rand(-0.3, 0.3), ty + 0.3, tz + 0.5), V(0, 0.5, 2), { life: 0.25, size: 0.4, color: 0xff2bd6 });
      }
    } else {
      // ждёт старта — пританцовывает
      b.body.rotation.set(0, 0, 0);
      const t = real * 3 + r.wp;
      b.armL.rotation.set(Math.sin(t) * 0.3, 0, 0.15); b.armR.rotation.set(-Math.sin(t) * 0.3, 0, -0.15);
      b.legL.rotation.x = b.legR.rotation.x = 0;
      b.body.position.y = Math.abs(Math.sin(t)) * 0.08;
    }
    if (b.auraSprite.material.opacity > 0) {
      b.auraSprite.scale.set(4 + Math.sin(real * 4) * 0.4, 5 + Math.sin(real * 4) * 0.5, 1);
    }
  }

  // камера
  let target, look, fov = 55;
  if (phase === 'race' && racers.length) {
    const lead = Math.max(...racers.map(r => r.p));
    const mean = racers.reduce((s, r) => s + r.p, 0) / racers.length;
    const focus = Math.max(mean, lead - 50);
    const cz = Math.min(zOf(focus) - 24, zOf(lead) - 8);
    target = V(Math.sin(real * 0.25) * 2.5, 13, cz);
    look = V(0, 0.5, zOf(focus) + 7);
  } else if (phase === 'results') {
    const a = Math.PI + Math.sin(real * 0.3) * 0.5;
    target = V(Math.sin(a) * 17, 8, finishZ - 14 - Math.cos(a) * 17);
    look = V(0, -0.5, finishZ - 14);
    fov = 50;
  } else {
    const a = real * 0.12;
    target = V(Math.sin(a) * 5, 11, -20 + Math.cos(a) * 1.5);
    look = V(0, 2.2, 0);
  }
  const k = 1 - Math.exp(-dt * 3);
  camPos.lerp(target, k);
  camLook.lerp(look, k);
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.add(V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake));
    shake = Math.max(0, shake - dt * 2.5);
  }
  camera.lookAt(camLook);
  fovKick = Math.max(0, fovKick - dt * 8);
  camera.fov = fov + fovKick;
  camera.updateProjectionMatrix();

  // эффекты
  glow.update(dt);
  confetti.update(dt);
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    f.s.position.y += f.vy * dt;
    f.s.position.x += f.vx * dt;
    f.s.material.opacity = clamp(f.life / f.max * 1.5, 0, 1);
    if (f.life <= 0) { scene.remove(f.s); f.s.material.dispose(); floaters.splice(i, 1); }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i];
    g.life -= dt;
    const k2 = 1 - g.life / g.max;
    g.m.scale.setScalar(0.2 + k2 * g.size);
    g.m.material.opacity = (1 - k2) * (g.sphere ? 0.8 : 1);
    if (g.life <= 0) { scene.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); rings.splice(i, 1); }
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const bo = bolts[i];
    bo.life -= dt;
    bo.m.visible = Math.random() > 0.25;
    bo.m.material.opacity = clamp(bo.life * 3, 0, 1);
    if (bo.life <= 0) { scene.remove(bo.m); bo.m.geometry.dispose(); bo.m.material.dispose(); bolts.splice(i, 1); }
  }

  // надписи на арках гаснут, когда камера пролетает сквозь них
  for (const s of archLabels) {
    s.material.opacity = clamp((camera.position.distanceTo(s.position) - 10) / 12, 0, 1);
  }

  // таблички с никами
  for (const r of racers) {
    const s = toScreen(headPos(r));
    const hide = s.behind || s.x < -60 || s.x > W + 60 || s.y < 260 || s.y > H;
    r.tag.style.display = hide ? 'none' : '';
    if (!hide) {
      const dist = camera.position.distanceTo(headPos(r));
      const sc = clamp(16 / dist, 0.45, 1.25);
      r.tag.style.transform = `translate(-50%, -100%) scale(${sc.toFixed(3)})`;
      r.tag.style.left = s.x.toFixed(1) + 'px';
      r.tag.style.top = s.y.toFixed(1) + 'px';
      r.tag.style.zIndex = String(1000 - Math.round(dist));
      r.tag.classList.toggle('stun', r.stunUntil > clock);
    }
  }
}

// ---------------- цикл ----------------
let last = performance.now() / 1000;
function frame() {
  const real = performance.now() / 1000;
  const rdt = Math.min(0.1, real - last);
  last = real;
  if (slowUntil && real > slowUntil) { timeScale = 1; slowUntil = 0; }
  const dt = rdt * timeScale;
  if (RACE) {
    clock += dt;
    update(dt);
    animate(dt, real);
    updateHud(real);
    pumpBanner();
  }
  if (composer) composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', fit);
fit();
connect();
requestAnimationFrame(frame);

// звук: в облаке Chromium запущен с автоплеем; в обычном браузере нужен клик
audio.start();
const hint = $('#hint');
setTimeout(() => { if (!audio.started && !audio.muted && !params.has('nohint')) hint.style.display = 'block'; }, 800);
addEventListener('pointerdown', () => { audio.start(); hint.style.display = 'none'; });
