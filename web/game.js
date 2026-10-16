// 3D-гонка чата: кубические человечки бегут по извилистой трассе с
// препятствиями, зрители TikTok LIVE вступают из чата и бустят их подарками.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sound } from './audio.js';
import { Track } from './track.js';
import { Director } from './director.js';

const W = 1080, H = 1920;
const params = new URLSearchParams(location.search);
// ?quality=low — для облака без видеокарты: без теней и свечения
const LOW = params.get('quality') === 'low';
const $ = s => document.querySelector(s);

// ---------------- рендер ----------------
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: !LOW, powerPreference: 'high-performance' });
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe6ff, 160, 700);
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 1500);

// небо-градиент
scene.add(new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x2f8cff) }, mid: { value: new THREE.Color(0x8fd3ff) }, bottom: { value: new THREE.Color(0xe8f7ff) } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
    void main(){ float h = vP.y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.7, h)) : mix(bottom, mid, smoothstep(-0.05, 0.15, h));
    gl_FragColor = vec4(c, 1.0); }`,
})));

scene.add(new THREE.HemisphereLight(0xdff2ff, 0x6fbf5a, 1.5));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.position.set(40, 80, 30);
sun.castShadow = !LOW;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

let composer = null;
if (!LOW) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.35, 0.4, 0.92));
  composer.addPass(new OutputPass());
}

let fitScale = 1;
function fit() {
  fitScale = Math.min(innerWidth / W, innerHeight / H);
  Object.assign(stage.style, { position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${fitScale})` });
  const pr = Math.min(fitScale * devicePixelRatio, LOW ? 0.75 : 1.5);
  renderer.setPixelRatio(pr);
  renderer.setSize(W, H, false);
  if (composer) { composer.setPixelRatio(pr); composer.setSize(W, H); }
  for (const p of [sparks, puffs, confetti]) p.material.uniforms.resY.value = H * pr;
}

// ---------------- утилиты ----------------
const sound = new Sound();
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); };
const hueOf = id => hash(id) % 360;
const cssColor = id => `hsl(${hueOf(id)} 90% 60%)`;
const short = (s, n = 14) => { const a = [...String(s)]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------- частицы ----------------
class Particles {
  constructor(n, tex, blending) {
    this.n = n; this.next = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n); this.grav = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, resY: { value: H } },
      vertexShader: `attribute vec3 pcolor; attribute float psize; attribute float palpha;
        uniform float resY; varying vec3 vC; varying float vA;
        void main() { vC = pcolor; vA = palpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * projectionMatrix[1][1] * resY / (2.0 * -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  spawn(p, v, { life = 1, size = 0.5, color = 0xffffff, grow = 0, grav = 0 } = {}) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    const c = new THREE.Color(color); this.col.set([c.r, c.g, c.b], i * 3);
    this.size[i] = size; this.life[i] = this.maxLife[i] = life; this.grow[i] = grow; this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      this.size[i] = Math.max(0, this.size[i] + this.grow[i] * dt);
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.pcolor.needsUpdate = a.psize.needsUpdate = a.palpha.needsUpdate = true;
  }
}

const softTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
const squareTex = canvasTex(16, 16, (g) => { g.fillStyle = '#fff'; g.fillRect(2, 4, 12, 8); });
const sparks = new Particles(LOW ? 500 : 1000, softTex, THREE.AdditiveBlending);   // искры, молнии
const puffs = new Particles(LOW ? 500 : 1000, softTex, THREE.NormalBlending);      // огонь, дым, пыль
const confetti = new Particles(LOW ? 300 : 600, squareTex, THREE.NormalBlending);

function burst(pos, color, n = 30, speed = 6, size = 0.6, sys = puffs) {
  for (let i = 0; i < n; i++) {
    const d = V(rand(-1, 1), rand(0, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(0.3, 1) * speed);
    sys.spawn(pos, d, { life: rand(0.4, 0.9), size, color, grav: 6 });
  }
}
function dust(pos, n = 10) {
  for (let i = 0; i < n; i++) puffs.spawn(pos, V(rand(-2, 2), rand(0.5, 2), rand(-2, 2)), { life: rand(0.5, 0.9), size: rand(0.8, 1.4), grow: 1.5, color: 0xfff4e0 });
}
function confettiBurst(pos, n = 200) {
  const colors = [0xff4fa3, 0x3ee8ff, 0xffd23f, 0x7dff5a, 0xffffff, 0xff7a1a, 0x8a5cff];
  for (let i = 0; i < n; i++) confetti.spawn(pos, V(rand(-8, 8), rand(10, 22), rand(-8, 8)), { life: rand(2, 3.5), size: rand(0.4, 0.7), color: colors[i % colors.length], grav: 12 });
}

const emojiCache = new Map();
const floaters = [];
function floatEmoji(e, pos, { size = 1.2, life = 1.5, vy = 2.5 } = {}) {
  if (floaters.length > 60) return;
  if (!emojiCache.has(e)) emojiCache.set(e, canvasTex(128, 128, (g) => {
    g.font = '100px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, 64, 72);
  }));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiCache.get(e), transparent: true, depthWrite: false }));
  s.position.copy(pos); s.scale.set(size, size, 1);
  scene.add(s);
  floaters.push({ s, life, max: life, vy, vx: rand(-0.6, 0.6) });
}

const rings = [];
function shockwave(pos, color = 0x3ee8ff, size = 6, life = 0.7) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.copy(pos); m.position.y += 0.15;
  scene.add(m);
  rings.push({ m, life, max: life, size });
}

// ---------------- трасса ----------------
let L = 1200, MAX = 16;
const K = 0.25, LANE = 1.15;
let track = null, director = null;
const PODIUM = [{ x: 0, h: 2.2 }, { x: -2.8, h: 1.5 }, { x: 2.8, h: 1.0 }];
const podiumP = () => L + 26;

function buildWorld() {
  const roadW = MAX * LANE + 1.5;
  track = new Track({ meters: L, K, roadW, low: LOW });
  scene.add(track.group);
  director = new Director(camera, track);
  // пьедестал за финишем
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a5cff, roughness: 0.4 });
  PODIUM.forEach(({ x, h }, i) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, h, 2.6), mat);
    b.position.set(x, h / 2, 0); b.castShadow = b.receiveShadow = !LOW;
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.14, 2.7), new THREE.MeshStandardMaterial({ color: [0xffd23f, 0xdfe6ff, 0xff9a4d][i] }));
    top.position.set(x, h, 0);
    g.add(b, top);
  });
  track.orient(g, podiumP());
  g.rotation.y += Math.PI;
  scene.add(g);
}

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
      g.fillRect(8, 20, 48, 6); g.fillRect(10, 22, 18, 12); g.fillRect(36, 22, 18, 12); g.fillRect(22, 46, 20, 4);
    } else if (mood === 'stun') {
      g.lineWidth = 4; g.strokeStyle = '#111';
      for (const cx of [20, 44]) { g.beginPath(); g.moveTo(cx - 6, 20); g.lineTo(cx + 6, 32); g.moveTo(cx + 6, 20); g.lineTo(cx - 6, 32); g.stroke(); }
      g.beginPath(); g.arc(32, 50, 6, 0, Math.PI * 2); g.fill();
    } else {
      g.fillRect(16, 22, 8, 10); g.fillRect(40, 22, 8, 10);
      if (mood === 'happy') { g.beginPath(); g.arc(32, 42, 12, 0, Math.PI); g.fill(); } else g.fillRect(22, 46, 20, 4);
    }
  });
  t.magFilter = THREE.NearestFilter;
  faceCache.set(key, t);
  return t;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function part(mat, sx, sy, sz, x, y, z, parent) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z);
  m.castShadow = !LOW;
  parent.add(m);
  return m;
}
const blobTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
const blobGeo = new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });

function makeBody(id, bot) {
  const h = hash(id);
  const shirt = new THREE.Color().setHSL(hueOf(id) / 360, bot ? 0.08 : 0.85, bot ? 0.55 : 0.55);
  const skin = SKINS[h % SKINS.length];
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.6 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: shirt.clone().multiplyScalar(0.4), roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: ['#1a1a1a', '#5a3214', '#e8c15a', '#ff4dd2', '#3dd6ff'][h % 5] });
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex(skin, 'normal'), roughness: 0.7 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  part(shirtMat, 0.9, 1.0, 0.5, 0, 1.45, 0, body);
  const head = new THREE.Mesh(boxGeo, [skinMat, skinMat, hairMat, skinMat, skinMat, faceMat]);
  head.scale.set(0.78, 0.78, 0.78); head.position.set(0, 2.36, 0); head.castShadow = !LOW;
  body.add(head);
  const limb = (mat, x, y, len, w) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
    part(mat, w, len, w, 0, -len / 2, 0, pivot);
    body.add(pivot);
    return pivot;
  };
  const armL = limb(shirtMat, -0.62, 1.92, 0.95, 0.3), armR = limb(shirtMat, 0.62, 1.92, 0.95, 0.3);
  const legL = limb(pantsMat, -0.23, 0.95, 0.95, 0.38), legR = limb(pantsMat, 0.23, 0.95, 0.95, 0.38);
  root.scale.setScalar(0.85);
  const auraSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xb44dff, transparent: true, depthWrite: false, opacity: 0 }));
  auraSprite.scale.set(4, 5, 1); auraSprite.position.y = 1.6;
  body.add(auraSprite);
  const acc = new THREE.Group();
  head.add(acc);
  const blob = new THREE.Mesh(blobGeo, blobMat);
  return { root, body, head, armL, armR, legL, legR, faceMat, skin, acc, auraSprite, blob, mood: 'normal' };
}

const gold = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x7a5200, metalness: 0.8, roughness: 0.25 });
function setAccessory(r) {
  const acc = r.body.acc;
  acc.clear();
  const h = hash(r.id);
  if (r.champion) {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8, 1, true), gold);
    crown.position.y = 0.66; acc.add(crown);
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 4), gold);
      const a = i / 5 * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.38, 0.92, Math.sin(a) * 0.38); acc.add(spike);
    }
  } else if (h % 3 === 1 && !r.bot) {
    const cap = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(((hueOf(r.id) + 180) % 360) / 360, 0.9, 0.5) });
    part(cap, 1.04, 0.28, 1.04, 0, 0.58, 0, acc); part(cap, 1.04, 0.08, 0.5, 0, 0.46, -0.7, acc);
  } else if (h % 3 === 2 && !r.bot) {
    const horn = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0x500000 });
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 8), horn);
      c.position.set(s * 0.3, 0.7, 0); c.rotation.z = -s * 0.35; acc.add(c);
    }
  }
  if (r.tier >= 3) {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffe866 }));
    halo.rotation.x = Math.PI / 2; halo.position.y = 1.05; acc.add(halo);
  }
  r.baseMood = r.tier >= 2 ? 'cool' : 'normal';   // с «сигмы» — в очках
  if (r.body.mood === 'normal' || r.body.mood === 'cool') setMood(r, r.baseMood);
  const am = r.body.auraSprite.material;
  am.opacity = r.tier >= 4 ? 0.8 : 0;
  am.color.set(r.tier >= 5 ? 0xffd23f : 0xb44dff);
}

function setMood(r, mood) {
  if (r.body.mood === mood) return;
  r.body.mood = mood;
  r.body.faceMat.map = faceTex(r.body.skin, mood);
  r.body.faceMat.needsUpdate = true;
}

// ---------------- состояние игры ----------------
let CFG = null, RACE = null;
let phase = 'wait', phaseEnd = 0;
let clock = 0, timeScale = 1, slowUntil = 0;
let raceStart = 0, firstFinish = null, finishedCount = 0, round = 0;
let botsAdded = false, finalStretch = false;
let leaderId = null, leadChangeAt = 0;
let racers = [];
const queue = new Map();
const wins = new Map();
let championId = null;
let delayed = [];
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
    p: 0, lat: 0, y: 14, vy: 0, landed: false, base: 1, speed: 0, boosts: [], jumpLeft: 0, jumpTotal: 0,
    stunUntil: 0, air: null, finish: null, place: null, pending: [], lane: 0,
    anim: Math.random() * 6, dance: false, wf: rand(0.7, 1.5), wp: rand(0, 6.28), lastHit: 0,
  };
  r.tier = tierOf(r.aura);
  r.champion = r.id === championId;
  r.body = makeBody(r.id, bot);
  setAccessory(r);
  scene.add(r.body.root, r.body.blob);
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.innerHTML = '<span class="t"></span><span class="n"></span>';
  tag.style.setProperty('--c', bot ? '#ccc' : cssColor(r.id));
  tagsEl.appendChild(tag);
  r.tag = tag;
  refreshTag(r);
  return r;
}

const TIER_COLORS = ['#c9cbd8', '#7dff5a', '#3ee8ff', '#ff4fa3', '#c58bff', '#ffd23f'];
function refreshTag(r) {
  r.tag.querySelector('.n').textContent = short(r.name);
  r.tag.querySelector('.t').textContent = r.bot ? 'NPC' : `${r.title} · ${r.aura}✨`;
  r.tag.style.setProperty('--tc', TIER_COLORS[clamp(r.tier, 0, 5)]);
}

function removeRacer(r) {
  scene.remove(r.body.root, r.body.blob);
  r.tag.remove();
  racers = racers.filter(x => x !== r);
}

function laneLat(slot) {
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
  r.lat = laneLat(r.lane);
  r.p = -4 - (r.lane % 3) * 1.2;
  r.y = 16 + rand(0, 8); r.vy = 0; r.landed = false;
}

const worldPos = (r, extra = 0) => track.point(r.p, r.lat, r.y + extra);
const headPos = r => worldPos(r, 3.1);

// ---------------- фазы ----------------
function startLobby() {
  for (const r of [...racers]) removeRacer(r);
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
  botsAdded = false; finalStretch = false; countdownShown = -1; delayed = [];
  sound.setLevel(0);
  $('#results').classList.remove('show');
  buildMap();
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
  buildMap();
}

function startRace() {
  round++;
  for (const r of racers) {
    r.base = RACE.base_speed * rand(0.93, 1.07) * (r.bot ? 0.97 : 1);
    r.p = 0; r.y = 0; r.vy = 0; r.landed = true;
    const now = r.pending;
    r.pending = [];
    for (const [effect, count, extra] of now) {
      if (effect.kind === 'lightning' || effect.kind === 'nuke') delayed.push({ at: clock + 4 + delayed.length * 2, r, effect, count, extra });
      else apply(r, effect, count, extra);
    }
    r.jumpLeft = Math.min(r.jumpLeft, L * 0.15);
    r.jumpTotal = r.jumpLeft;
  }
  phase = 'race';
  raceStart = clock; firstFinish = null; finishedCount = 0; leaderId = null;
  director.resetRace();
  sound.setLevel(1);
  sound.play('go');
  flash(0.4);
  showCountdown('GO!');
  pushFeed(`🏁 СТАРТ! Забег #${round}`, '#ffd23f', true);
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
  results.slice(0, 3).forEach((r, i) => { r.podium = i; r.dance = true; setMood(r, i === 0 ? 'cool' : 'happy'); });
  for (const r of racers) { r.champion = r.id === championId; setAccessory(r); }
  phase = 'results';
  phaseEnd = clock + RACE.results_seconds;
  sound.setLevel(3);
  confettiBurst(track.point(podiumP(), 0, 4), 160);
  renderResults(winner);
}

// ---------------- эффекты ----------------
const lastSound = {};
function sfx(name, gap = 0.12) {
  const t = performance.now() / 1000;
  if (t - (lastSound[name] || 0) < gap) return;
  lastSound[name] = t;
  sound.play(name);
}

function flash(strength = 0.9) {
  const f = $('#flash');
  f.style.setProperty('--fa', strength);
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}

const bannerQueue = [];
let bannerBusyUntil = 0;
function banner(text, sub = '') { if (bannerQueue.length < 3) bannerQueue.push({ text, sub }); }
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

const proj = V();
function toScreen(pos) {
  proj.copy(pos).project(camera);
  return { x: (proj.x + 1) / 2 * W, y: (1 - proj.y) / 2 * H, behind: proj.z > 1 };
}

function pop(text, worldPosition, color = '#fff') {
  const s = toScreen(worldPosition);
  if (s.behind || s.x < -100 || s.x > W + 100 || s.y < 0 || s.y > H) return;
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = text;
  el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
  el.style.setProperty('--c', color);
  $('#hud').appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function apply(r, effect, count, extra = {}) {
  count = clamp(count | 0, 1, 10);
  const pos = worldPos(r, 1.5);
  if (effect.kind === 'boost') {
    r.boosts.push({ mult: effect.multiplier, until: clock + effect.seconds * count });
    if (extra.source === 'like') {
      floatEmoji('❤️', worldPos(r, 2.8).add(V(rand(-0.5, 0.5), 0, 0)), { size: 0.9 });
    } else {
      burst(pos, 0xffa020, 26, 7, 0.6, sparks);
      pop('⚡ ТУРБО', headPos(r), '#ffd23f');
      sfx('boost');
      director.fovKick = Math.max(director.fovKick, 6);
    }
  } else if (effect.kind === 'jetpack') {
    r.jumpLeft = Math.min(r.jumpLeft + effect.meters * count, L * 0.2);
    r.jumpTotal = r.jumpLeft;
    pop('🚀 ДЖЕТПАК', headPos(r), '#3ee8ff');
    sfx('jetpack', 0.3);
    shockwave(worldPos(r), 0x3ee8ff, 5);
  } else if (effect.kind === 'lightning') {
    strikeLeader(r, effect.seconds * count);
  } else if (effect.kind === 'nuke') {
    nuke(r, effect);
  }
}

function runningLeader(exclude) {
  return racers.filter(x => x !== exclude && x.place === null).sort((a, b) => b.p - a.p)[0];
}

const bolts = [];
function bolt(target) {
  const end = worldPos(target, 1.5);
  const top = end.clone().add(V(rand(-4, 4), 45, rand(-4, 4)));
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const p = top.clone().lerp(end, i / 10);
    if (i > 0 && i < 10) p.add(V(rand(-1.6, 1.6), 0, rand(-1.6, 1.6)));
    pts.push(p);
  }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05), 40, 0.22, 5, false),
    new THREE.MeshBasicMaterial({ color: 0xe6fbff, transparent: true }));
  scene.add(m);
  bolts.push({ m, life: 0.5 });
  burst(end, 0x60e8ff, 50, 9, 0.8, sparks);
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
  director.shake = Math.max(director.shake, 0.8);
  director.event(performance.now() / 1000, target, 2.6);
  slowMo(0.45, 0.9);
  sfx('lightning', 0.2);
  pushFeed(`⚡ ${short(sender.name)} ударил молнией ${short(target.name)}!`, '#60e8ff', true);
}

function nuke(sender, effect) {
  const pos = worldPos(sender, 1);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, depthWrite: false }));
  ball.position.copy(pos);
  scene.add(ball);
  rings.push({ m: ball, life: 1.4, max: 1.4, size: 26, sphere: true });
  shockwave(pos, 0xffd23f, 40, 1.4);
  burst(pos, 0xff6a00, 140, 18, 1.2, sparks);
  for (const r of racers) if (r !== sender && r.place === null) stun(r, effect.seconds);
  sender.jumpLeft = Math.min(sender.jumpLeft + effect.meters, L * 0.2);
  sender.jumpTotal = sender.jumpLeft;
  flash(0.9);
  director.shake = 1.6;
  director.event(performance.now() / 1000, sender, 3);
  slowMo(0.35, 1.2);
  sfx('nuke', 0.5);
  banner('☢️ ЯДЕРКА ☢️', `от ${short(sender.name, 18)}`);
}

function slowMo(scale, seconds) {
  timeScale = Math.min(timeScale, scale);
  slowUntil = Math.max(slowUntil, performance.now() / 1000 + seconds);
}

// препятствия
let lastHitFeed = 0;
function onObstacle(r, ev) {
  if (ev.type === 'hit') {
    if (r.jumpLeft > 0 || r.y > 1.2 || Math.random() < 0.15) { pop('😎 УВЕРНУЛСЯ', headPos(r), '#7dff5a'); return; }
    r.stunUntil = clock + 1.1;
    r.knock = { t: clock, dir: Math.random() < 0.5 ? -1 : 1 };
    r.p = Math.max(0, r.p - 6);
    setMood(r, 'stun');
    burst(worldPos(r, 1.5), 0xffffff, 18, 7);
    pop(ev.by === 'hammer' ? '💥 БОНК' : '🌀 СНЕСЛО', headPos(r), '#ff4fa3');
    sfx('bonk', 0.08);
    if (r.id === leaderId && clock - lastHitFeed > 3) {
      lastHitFeed = clock;
      pushFeed(`💥 ${short(r.name)} снесло ${ev.by === 'hammer' ? 'молотом' : 'вертушкой'}!`, cssColor(r.id), true);
    }
  } else if (ev.type === 'hop') {
    r.air = { from: r.p, len: 10, h: 1.6 };
  } else if (ev.type === 'ramp') {
    r.air = { from: r.p, len: 34, h: 3.2 };
    sfx('ramp', 0.25);
  } else if (ev.type === 'pad') {
    r.boosts.push({ mult: 1.7, until: clock + 2.2 });
    sparks.spawn(worldPos(r, 0.4), V(0, 3, 0), { life: 0.5, size: 1.4, color: 0x26e07f });
    sfx('pad', 0.15);
  } else if (ev.type === 'slime') {
    burst(worldPos(r, 0.3), 0x6af03a, 10, 4, 0.5);
    sfx('splash', 0.25);
  }
}

// ---------------- события от сервера ----------------
function updateUser(user) {
  for (const r of racers.filter(x => x.id === user.id)) {
    r.name = user.name; r.aura = user.aura ?? r.aura; r.title = user.title ?? r.title;
    const tier = tierOf(r.aura);
    if (tier !== r.tier) {
      const up = tier > r.tier;
      r.tier = tier;
      setAccessory(r);
      if (up && tier >= 2) {
        pop(`✨ ${r.title.toUpperCase()}`, headPos(r), '#e7b6ff');
        pushFeed(`✨ ${short(r.name)} теперь «${r.title}»`, '#c58bff', true);
      }
    }
    refreshTag(r);
  }
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
    buildMap();
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
    if (emoji === '🗿' || emoji === '💀') sfx('boom', 0.8);
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
      CFG = m.config;
      if (first) {
        L = CFG.race.track_meters; MAX = CFG.race.max_racers;
        buildLegend();
        // надписи на арках рисуются шрифтом — ждём его (но не дольше 2 с)
        const fontReady = document.fonts.load('80px "Russo One"').catch(() => {});
        Promise.race([fontReady, new Promise(r => setTimeout(r, 2000))]).then(() => {
          buildWorld();
          RACE = CFG.race;
          startLobby();
        });
      }
    } else if (m.type === 'status') status = m.text;
    else if (m.type === 'aura_top') { auraTop = m.top; renderAuraTop(); }
    else if (!RACE) return;
    else if (m.type === 'join') { updateUser(m.user); const r = addPlayer(m.user); if (r?.body) sfx('join', 0.15); }
    else if (m.type === 'effect') onEffect(m.user, m.effect, m.count || 1, { source: m.source, diamonds: m.diamonds });
    else if (m.type === 'emote') onEmote(m.user, m.emoji);
    else if (m.type === 'user') updateUser(m.user);
  };
  ws.onclose = () => { status = 'нет связи с сервером'; setTimeout(connect, 2000); };
}

// ---------------- HUD ----------------
let legendLines = [];
function describe(e) {
  return { boost: `скорость ×${e.multiplier} на ${e.seconds}с`, jetpack: `джетпак +${e.meters} м`,
    lightning: `молния в лидера (${e.seconds}с стоит)`, nuke: 'ЯДЕРКА: все стоят, ты летишь' }[e.kind] || '';
}
function buildLegend() {
  const join = CFG.join.any_comment ? 'Пиши в чат — бежишь!' : `Пиши «${CFG.join.keywords[0]}» — бежишь!`;
  legendLines = [];
  const fx = CFG.effects;
  if (fx.like) legendLines.push(['❤️', `Лайк — ${describe(fx.like)}`]);
  if (fx.follow) legendLines.push(['➕', `Подписка — ${describe(fx.follow)}`]);
  if (fx.share) legendLines.push(['🔁', `Репост — ${describe(fx.share)}`]);
  for (const [name, e] of Object.entries(CFG.gifts_by_name || {})) legendLines.push([[...e.label][0], `${name[0].toUpperCase() + name.slice(1)} — ${describe(e)}`]);
  for (const t of [...(CFG.gifts_by_diamonds || [])].sort((a, b) => a.min - b.min).slice(1)) legendLines.push([[...t.label][0], `Подарок ${t.min}💎+ — ${describe(t)}`]);
  legendLines.push(['🗿', 'Пиши 🗿 💀 67 скибиди — мем над бегуном', 'wide']);
  const el = $('#legend');
  el.innerHTML = '';
  const mk = (ico, text, cls = '') => {
    const row = document.createElement('div'); row.className = 'row ' + cls;
    const i = document.createElement('span'); i.className = 'ico'; i.textContent = ico;
    const t = document.createElement('span'); t.textContent = text;
    row.append(i, t); el.append(row);
  };
  mk('💬', join, 'join');
  legendLines.forEach(([i, t, cls]) => mk(i, t, cls));
}

const OB_ICON = { hammer: '🔨', sweeper: '🌀', ramp: '⛰️', boost: '⏩', slime: '🟢' };
function buildMap() {
  const map = $('#map');
  map.querySelectorAll('.ob, .dot').forEach(e => e.remove());
  if (!track) return;
  const width = W - 120 - 60;
  for (const o of track.obstacles) {
    const e = document.createElement('div');
    e.className = 'ob'; e.textContent = OB_ICON[o.type];
    e.style.left = (o.p / L * width) + 'px';
    map.append(e);
  }
  for (const r of racers) {
    const d = document.createElement('div');
    d.className = 'dot';
    d.style.setProperty('--c', r.bot ? '#ccc' : cssColor(r.id));
    d.textContent = r.bot ? '🤖' : [...r.name][0].toUpperCase();
    map.append(d);
    r.dot = d;
  }
}

function renderAuraTop() {
  const el = $('#auratop');
  el.innerHTML = '<h3>🔮 ЛЕГЕНДЫ АУРЫ</h3>';
  if (!auraTop.length) { el.innerHTML += '<div class="a"><span>пока никого — будь первым</span></div>'; return; }
  auraTop.slice(0, 5).forEach((u, i) => {
    const row = document.createElement('div'); row.className = 'a';
    const a = document.createElement('span'); a.textContent = `${i + 1}. ${short(u.name, 16)} · ${u.title}`;
    const b = document.createElement('span'); b.textContent = `${u.aura}✨`;
    row.append(a, b); el.append(row);
  });
}

function renderResults(winner) {
  const el = $('#results');
  el.innerHTML = '<h2 class="toon">🏆 РЕЗУЛЬТАТЫ</h2>';
  results.slice(0, 5).forEach((r, i) => {
    const row = document.createElement('div'); row.className = 'r';
    row.style.setProperty('--c', r.bot ? '#ddd' : cssColor(r.id));
    const m = document.createElement('span'); m.className = 'm'; m.textContent = ['🥇', '🥈', '🥉', '4', '5'][i];
    const n = document.createElement('span'); n.className = 'nm'; n.textContent = short(r.name, 16);
    const tm = document.createElement('span'); tm.className = 'tm';
    tm.textContent = r.finish !== null ? `${r.finish.toFixed(1)}с` : `${Math.round(r.p / L * 100)}%`;
    row.append(m, n, tm); el.append(row);
  });
  if (winner) {
    const a = document.createElement('div'); a.className = 'aura';
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
  else if (phase === 'race') line = `ЗАБЕГ #${round} · ${Math.min(99, Math.round(Math.max(0, ...racers.map(r => r.p)) / L * 100))}%`;
  else if (phase === 'results') line = `Новый забег через ${left}с`;
  $('#phase').textContent = line;
  $('#status').textContent = status;

  const lobby = phase === 'lobby';
  // в лобби правила и «Легенды ауры» сменяют друг друга на одном месте
  const showAura = lobby && auraTop.length > 0 && Math.floor(real / 7) % 2 === 1;
  $('#legend').classList.toggle('hidden', !lobby || showAura);
  $('#auratop').classList.toggle('hidden', !showAura);
  $('#map').classList.toggle('hidden', phase !== 'race');
  $('#standings').classList.toggle('hidden', phase !== 'race');
  $('#feed').classList.toggle('hidden', phase === 'results');
  const ticker = $('#ticker');
  ticker.classList.toggle('hidden', phase !== 'race' || !legendLines.length);
  if (phase === 'race' && real - tickerAt > 3.5) {
    tickerAt = real;
    const extra = queue.size ? [['⏳', `В очереди: ${queue.size} — пиши, чтобы попасть`]] : [];
    const lines = [['💬', 'Пиши в чат — бежишь в след. забеге!'], ...legendLines, ...extra];
    const [i, t] = lines[tickerIdx++ % lines.length];
    ticker.textContent = `${i} ${t}`;
  }
  if (phase === 'race' && real - standingsAt > 0.25) {
    standingsAt = real;
    const sorted = [...racers].sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9) || b.p - a.p);
    const el = $('#standings');
    el.innerHTML = '';
    sorted.slice(0, 5).forEach((r, i) => {
      const row = document.createElement('div'); row.className = 'st';
      row.style.setProperty('--c', r.bot ? '#ccc' : cssColor(r.id));
      const pos = document.createElement('span'); pos.className = 'pos'; pos.textContent = i + 1;
      const nm = document.createElement('span'); nm.className = 'nm';
      nm.textContent = (r.stunUntil > clock ? '💫 ' : r.jumpLeft > 0 ? '🚀 ' : r.boosts.length ? '🔥 ' : '') + short(r.name, 12);
      row.append(pos, nm); el.append(row);
    });
    const width = W - 120 - 60;
    sorted.forEach((r, i) => {
      if (!r.dot) return;
      r.dot.style.left = (clamp(r.p, 0, L) / L * width) + 'px';
      r.dot.classList.toggle('lead', i === 0);
      r.dot.style.zIndex = String(50 - i);
    });
  }
}

// ---------------- симуляция ----------------
function update(dt) {
  if (phase === 'lobby') {
    if (!botsAdded && clock > phaseEnd - 6) addBots();
    const left = Math.ceil(phaseEnd - clock);
    if (left <= 3 && left >= 1 && left !== countdownShown) { countdownShown = left; showCountdown(String(left)); sfx('beep', 0.5); }
    if (clock >= phaseEnd) startRace();
  } else if (phase === 'results' && clock >= phaseEnd) {
    startLobby();
  }

  for (const r of racers) {
    r.boosts = r.boosts.filter(b => b.until > clock);
    if (!r.landed) {
      r.vy -= 40 * dt;
      r.y += r.vy * dt;
      if (r.y <= 0) {
        r.y = 0; r.landed = true;
        shockwave(worldPos(r), 0xff4fa3, 3, 0.5);
        dust(worldPos(r, 0.2), 8);
      }
    }
  }
  if (phase !== 'race') return;

  for (const d of delayed.filter(d => d.at <= clock)) apply(d.r, d.effect, d.count, d.extra);
  delayed = delayed.filter(d => d.at > clock);

  for (const r of racers) {
    if (r.place !== null || r.stunUntil > clock) continue;
    if (r.body.mood === 'stun') setMood(r, r.baseMood);
    let mult = 1;
    for (const b of r.boosts) mult += b.mult - 1;
    mult = Math.min(mult, RACE.max_speed_multiplier);
    const slime = r.jumpLeft > 0 || r.air ? 1 : track.slowdown(r.p);
    const wobble = 1 + 0.1 * Math.sin(clock * r.wf + r.wp);
    r.speed = r.base * mult * wobble * slime;
    const prev = r.p;
    r.p += r.speed * dt;
    let jetY = 0;
    if (r.jumpLeft > 0) {
      const step = Math.min(r.jumpLeft, 90 * dt);
      r.p += step; r.jumpLeft -= step;
      const k = 1 - r.jumpLeft / r.jumpTotal;
      jetY = Math.sin(k * Math.PI) * Math.min(7, 2 + r.jumpTotal / 25);
      if (r.jumpLeft <= 0) {
        shockwave(worldPos(r), 0x3ee8ff, 6);
        dust(worldPos(r, 0.2), 12);
      }
    }
    let airY = 0;
    if (r.air) {
      const k = (r.p - r.air.from) / r.air.len;
      if (k >= 1) { r.air = null; dust(worldPos(r, 0.1), 6); } else airY = Math.sin(k * Math.PI) * r.air.h;
    }
    r.y = Math.max(jetY, airY);
    if (r.jumpLeft <= 0) for (const ev of track.interact(prev, r.p, r.lat, clock)) onObstacle(r, ev);

    if (r.p >= L) {
      r.p = L; r.jumpLeft = 0; r.y = 0; r.air = null;
      r.finish = clock - raceStart;
      r.place = ++finishedCount;
      if (r.place <= 3) pushFeed(`${['🥇', '🥈', '🥉'][r.place - 1]} ${short(r.name)} — ${r.finish.toFixed(1)}с`, cssColor(r.id), r.place === 1);
      if (r.place === 1) {
        firstFinish = clock;
        confettiBurst(track.point(L, 0, 3));
        sfx('win', 1);
        banner(short(r.name, 14), 'ПОБЕДА 🏆');
        const second = runningLeader(null);
        if (second && L - second.p < L * 0.025) { slowMo(0.3, 1.4); banner('📸 ФОТОФИНИШ'); }
      }
    }
  }

  const lead = [...racers].sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9) || b.p - a.p)[0];
  if (lead && lead.id !== leaderId) {
    if (leaderId && clock - raceStart > 3 && clock - leadChangeAt > 2.5 && lead.place === null) {
      floatEmoji('🗿', headPos(lead).add(V(0, 0.6, 0)), { size: 1.8, life: 1.4, vy: 1 });
      pushFeed(`🗿 ${short(lead.name)} вырвался вперёд!`, cssColor(lead.id));
      sfx('boom', 1.5);
    }
    leaderId = lead.id;
    leadChangeAt = clock;
    for (const r of racers) r.tag.classList.toggle('lead', r === lead);
  }
  if (!finalStretch && lead && lead.p > L * 0.85) {
    finalStretch = true;
    sound.setLevel(2);
    banner('ФИНИШНАЯ ПРЯМАЯ 🔥');
  }
  const allDone = racers.every(r => r.place !== null);
  const graceOver = firstFinish !== null && clock - firstFinish > RACE.finish_grace_seconds;
  if (allDone || graceOver || clock - raceStart > 300) endRace();
}

// ---------------- анимация и камера ----------------
function animate(dt, real) {
  track.update(clock);
  for (const r of racers) {
    const b = r.body, root = b.root;
    if (phase === 'results' && r.podium !== undefined) {
      const pd = PODIUM[r.podium];
      root.position.copy(track.point(podiumP(), pd.x, pd.h));
      root.rotation.set(0, track.yaw(podiumP()) + Math.PI + Math.sin(real * 2) * 0.3, 0);
    } else {
      root.position.copy(worldPos(r));
      root.rotation.set(0, track.yaw(Math.max(r.p, -20)), 0);
    }
    b.blob.position.copy(root.position).setY(track.point(r.p).y + 0.06);
    b.blob.visible = !(phase === 'results' && r.podium !== undefined);
    const sc = 1 / (1 + r.y * 0.15);
    b.blob.scale.set(sc, 1, sc);

    const stunned = r.stunUntil > clock;
    const running = phase === 'race' && r.place === null && !stunned;
    if (running) r.anim += dt * (r.speed || 10) * 0.5;
    b.body.rotation.set(0, 0, 0);
    if (r.dance) {
      const t = real * 8;
      b.armL.rotation.set(Math.PI + Math.sin(t) * 0.4, 0, 0.3);
      b.armR.rotation.set(Math.PI + Math.sin(t + 2) * 0.4, 0, -0.3);
      b.legL.rotation.x = b.legR.rotation.x = 0;
      b.body.position.y = Math.abs(Math.sin(t / 2)) * 0.5;
    } else if (stunned) {
      if (r.knock && clock - r.knock.t < 0.7) {
        const k = (clock - r.knock.t) / 0.7;
        b.body.rotation.set(-k * Math.PI * 2, 0, r.knock.dir * 0.6);
        b.body.position.y = Math.sin(k * Math.PI) * 2.5;
      } else {
        b.body.rotation.y = real * 9;
        b.body.position.y = 0;
      }
      b.armL.rotation.set(0, 0, 0.6); b.armR.rotation.set(0, 0, -0.6);
    } else if (r.jumpLeft > 0) {
      b.armL.rotation.set(Math.PI, 0, 0.2); b.armR.rotation.set(Math.PI, 0, -0.2);
      b.legL.rotation.x = 0.4; b.legR.rotation.x = -0.4;
      const back = worldPos(r, 1.2);
      puffs.spawn(back, V(rand(-0.5, 0.5), -6, rand(-0.5, 0.5)), { life: 0.4, size: 1.1, color: 0xff8a1a, grow: 1 });
      sparks.spawn(back, V(rand(-0.3, 0.3), -5, rand(-0.3, 0.3)), { life: 0.3, size: 0.6, color: 0xffe0a0 });
    } else if (running) {
      const s = Math.sin(r.anim);
      b.legL.rotation.x = s * 0.9; b.legR.rotation.x = -s * 0.9;
      b.armL.rotation.set(-s * 0.9, 0, 0); b.armR.rotation.set(s * 0.9, 0, 0);
      b.body.position.y = Math.abs(Math.cos(r.anim)) * 0.18;
      b.body.rotation.x = -0.12;
      if (r.air) { b.legL.rotation.x = 0.8; b.legR.rotation.x = -0.3; b.armL.rotation.set(Math.PI * 0.8, 0, 0.4); b.armR.rotation.set(Math.PI * 0.8, 0, -0.4); }
      if (r.boosts.some(x => x.mult >= 1.5)) {
        puffs.spawn(worldPos(r, rand(0.4, 2)).add(V(rand(-0.3, 0.3), 0, rand(-0.3, 0.3))), V(0, rand(0, 1), 0), { life: 0.35, size: 0.9, color: 0xff6a00, grow: 1 });
      }
      if (Math.random() < 0.15) puffs.spawn(worldPos(r, 0.1), V(rand(-0.5, 0.5), 0.6, rand(-0.5, 0.5)), { life: 0.5, size: 0.6, grow: 1, color: 0xf5efe6 });
    } else {
      const t = real * 3 + r.wp;
      b.armL.rotation.set(Math.sin(t) * 0.3, 0, 0.15); b.armR.rotation.set(-Math.sin(t) * 0.3, 0, -0.15);
      b.legL.rotation.x = b.legR.rotation.x = 0;
      b.body.position.y = Math.abs(Math.sin(t)) * 0.08;
    }
    if (b.auraSprite.material.opacity > 0) b.auraSprite.scale.set(4 + Math.sin(real * 4) * 0.4, 5 + Math.sin(real * 4) * 0.5, 1);
  }

  // камера-режиссёр
  const leader = racers.length ? racers.reduce((a, b) => (b.p > a.p ? b : a)) : null;
  const packP = racers.length ? racers.reduce((s, r) => s + r.p, 0) / racers.length : 0;
  director.update(dt, real, { phase, leader, packP });
  // солнце и тени следуют за камерой
  const focus = director.look;
  sun.position.copy(focus).add(V(40, 80, 30));
  sun.target.position.copy(focus);

  sparks.update(dt); puffs.update(dt); confetti.update(dt);
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt; f.s.position.y += f.vy * dt; f.s.position.x += f.vx * dt;
    f.s.material.opacity = clamp(f.life / f.max * 1.5, 0, 1);
    if (f.life <= 0) { scene.remove(f.s); f.s.material.dispose(); floaters.splice(i, 1); }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i];
    g.life -= dt;
    const k = 1 - g.life / g.max;
    g.m.scale.setScalar(0.2 + k * g.size);
    g.m.material.opacity = (1 - k) * (g.sphere ? 0.8 : 1);
    if (g.life <= 0) { scene.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); rings.splice(i, 1); }
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const bo = bolts[i];
    bo.life -= dt;
    bo.m.visible = Math.random() > 0.25;
    bo.m.material.opacity = clamp(bo.life * 3, 0, 1);
    if (bo.life <= 0) { scene.remove(bo.m); bo.m.geometry.dispose(); bo.m.material.dispose(); bolts.splice(i, 1); }
  }
  for (const s of track.labels) {
    const wp = s.getWorldPosition(proj.clone());
    s.material.opacity = clamp((camera.position.distanceTo(wp) - 12) / 14, 0, 1);
  }

  // таблички с никами
  for (const r of racers) {
    const hp = r.podium !== undefined && phase === 'results' ? r.body.root.position.clone().add(V(0, 3.1, 0)) : headPos(r);
    const s = toScreen(hp);
    const hide = s.behind || s.x < -60 || s.x > W + 60 || s.y < 240 || s.y > H;
    r.tag.style.display = hide ? 'none' : '';
    if (!hide) {
      const dist = camera.position.distanceTo(hp);
      const sc = clamp(18 / dist, 0.4, 1.25);
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

sound.start();
const hint = $('#hint');
setTimeout(() => { if (!sound.started && !sound.muted && !params.has('nohint')) hint.style.display = 'block'; }, 800);
addEventListener('pointerdown', () => { sound.start(); hint.style.display = 'none'; });
