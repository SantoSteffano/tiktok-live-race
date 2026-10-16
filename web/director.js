// Кинематографичная камера: набор «планов» и режиссёр, который склеивает
// их по ходу гонки — с перебивками на препятствия, молнии и финиш.
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rand = (a, b) => a + Math.random() * (b - a);

export class Director {
  constructor(camera, track) {
    this.camera = camera;
    this.track = track;
    this.shot = 'lobbyFly';
    this.shotStart = 0;
    this.shotUntil = 0;
    this.side = 1;
    this.pos = V(0, 10, -20);
    this.look = V();
    this.fov = 55;
    this.cut = true;
    this.override = null;   // крупный план зрителя: {target, until, weight, caption}
    this.focusQueue = [];
    this.cooldownUntil = 0;
    this.usedObstacles = new Set();
    this.shake = 0;
    this.fovKick = 0;
    this.rotation = ['front', 'chase', 'side', 'front', 'drone', 'low', 'front', 'chaseHigh'];
    this.rotIdx = 0;
  }

  setShot(name, real, dur, extra = {}) {
    this.shot = name;
    this.shotStart = real;
    this.shotUntil = real + dur;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.extra = extra;
    this.cut = true;
  }

  // Показать зрителя, который что-то сделал (подарок, подписка, молния…).
  // Дорогое перебивает дешёвое, остальное ждёт в короткой очереди.
  focus(real, target, weight, dur = 2.8, caption = '') {
    const item = { target, weight, dur, caption, at: real };
    const cur = this.override;
    // между показами — пару секунд общего плана (дорогое и молнии — без очереди)
    const busy = (cur && cur.until > real && cur.weight >= weight) || (!cur && weight < 30 && real < this.cooldownUntil);
    if (busy) {
      if (cur && cur.target === target) { cur.until = Math.max(cur.until, real + 1.5); cur.caption = caption; return; }
      this.focusQueue = this.focusQueue.filter(q => q.target !== target);
      this.focusQueue.push(item);
      this.focusQueue.sort((a, b) => b.weight - a.weight);
      this.focusQueue.length = Math.min(this.focusQueue.length, 2);
      return;
    }
    this.startFocus(real, item);
  }

  // молния, ядерка — всегда сразу и подольше
  event(real, target, dur = 2.6, caption = '') { this.focus(real, target, 1000, dur, caption); }

  startFocus(real, item) {
    this.override = { target: item.target, until: real + item.dur, weight: item.weight, caption: item.caption };
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.focusStart = real;
    this.cut = true;
  }

  get caption() { return this.override ? this.override.caption : ''; }

  resetRace() {
    this.usedObstacles.clear();
    this.override = null;
    this.focusQueue = [];
    this.rotIdx = 0;
  }

  update(dt, real, s) {
    const tr = this.track;
    let name = this.shot;
    if (this.override && (this.override.until <= real || this.override.target.removed || s.phase === 'results')) {
      this.override = null;
      this.cut = true;
      this.cooldownUntil = real + 2.5;
    }
    // следующий из очереди, если он ещё свежий и общий план уже показали
    if (!this.override && s.phase !== 'results' && this.focusQueue.length) {
      this.focusQueue = this.focusQueue.filter(q => real - q.at < 7 && !q.target.removed);
      const next = this.focusQueue[0];
      if (next && (next.weight >= 30 || real >= this.cooldownUntil)) this.startFocus(real, this.focusQueue.shift());
    }

    // выбор плана
    if (s.phase === 'lobby') {
      if (!this.shot.startsWith('lobby')) this.setShot('lobbyFly', real, 9);
      else if (real > this.shotUntil) this.setShot(this.shot === 'lobbyFly' ? 'lobbyCrowd' : 'lobbyFly', real, this.shot === 'lobbyFly' ? 11 : 9);
      name = this.override ? 'focus' : this.shot;
    } else if (s.phase === 'results') {
      if (this.shot !== 'podium') this.setShot('podium', real, 999);
      name = 'podium';
    } else if (s.phase === 'race' && s.leader) {
      const lp = s.leader.p;
      if (this.override) name = 'focus';
      else if (lp > tr.L - 110) {
        if (this.shot !== 'finish') this.setShot('finish', real, 999);
        name = 'finish';
      } else {
        const ob = tr.nextObstacle(lp);
        // лидер подбегает к препятствию — в 60% случаев режем на «засаду»
        if (ob && ob.p - lp < 50 && ob.p - lp > 8 && !this.usedObstacles.has(ob)) {
          this.usedObstacles.add(ob);
          if (ob.type !== 'boost' && ob.type !== 'ramp' && Math.random() < 0.7) this.setShot('obstacle', real, 4.2, { o: ob });
        }
        if (real > this.shotUntil || this.shot.startsWith('lobby') || this.shot === 'podium') {
          this.setShot(this.rotation[this.rotIdx++ % this.rotation.length], real, rand(4.5, 7));
        }
        name = this.shot;
      }
    }

    // расчёт позиции камеры для плана
    const t = real - this.shotStart;
    let pos, look, fov = 55;
    const lead = s.leader;
    const packP = s.packP ?? 0;
    if (!lead && !['lobbyFly', 'lobbyCrowd', 'podium', 'finish', 'obstacle', 'focus'].includes(name)) name = 'lobbyCrowd';
    const W = tr.roadW;
    const M = 1 / tr.K;   // мировая единица → метры трассы
    switch (name) {
      case 'lobbyFly': {
        // пролёт над трассой: от середины к старту
        const p = Math.max(-10, 760 - t * 95);
        pos = tr.point(p - 14 * M, this.side * 10, 24);
        look = tr.point(p + 16 * M, 0, 2);
        fov = 60;
        break;
      }
      case 'lobbyCrowd': {
        const a = t * 0.18;
        pos = tr.point(32 * M + Math.cos(a) * 10, Math.sin(a) * 10, 12);
        look = tr.point(-6, 0, 2);
        fov = 50;
        break;
      }
      case 'front':   // спереди, лица лидеров
        pos = tr.point(lead.p + 24 * M, this.side * 4 + Math.sin(t * 0.6) * 2, 11);
        look = tr.point(lead.p - 10 * M, 0, 0.5);
        fov = 54;
        break;
      case 'chase':   // из-за спины, видно поворот впереди
        pos = tr.point(lead.p - 18 * M, this.side * 4, 10);
        look = tr.point(lead.p + 20 * M, 0, 0.5);
        fov = 62;
        break;
      case 'chaseHigh':
        pos = tr.point(packP - 20 * M, this.side * 6, 26);
        look = tr.point(lead.p + 10 * M, 0, 0);
        fov = 58;
        break;
      case 'side': {   // сбоку, «телевик», едет вместе с толпой
        const p = (lead.p + packP) / 2;
        pos = tr.point(p + t * 6, this.side * (W / 2 + 15), 8);
        look = tr.point(p + 8, 0, 1);
        fov = 52;
        break;
      }
      case 'drone': {  // сверху, медленно облетает
        const p = (lead.p + packP) / 2;
        pos = tr.point(p - 12 * M + t * 12, this.side * 18, 46);
        look = tr.point(p + 10 * M, 0, 0);
        fov = 55;
        break;
      }
      case 'low':     // у самой земли перед лидером
        pos = tr.point(lead.p + 9 * M, this.side * (W / 2 - 1.5), 1.4);
        look = tr.point(lead.p - 3 * M, -this.side * 2, 2.2);
        fov = 72;
        break;
      case 'obstacle': {   // засада у препятствия
        const o = this.extra.o;
        pos = tr.point(o.p + 18 * M, this.side * (W / 2 + 9), 10);
        look = tr.point(o.p - 4 * M, 0, 1.5);
        fov = 48;
        break;
      }
      case 'focus': {   // крупно — зритель, который сейчас что-то сделал
        const r = this.override.target;
        const k = real - this.focusStart;
        pos = tr.point(r.p + (17 - k) * M, r.lat * 0.4 + this.side * 9, 10 + (r.y || 0) * 0.6);
        look = tr.point(r.p, r.lat, (r.y || 0) + 1.2);
        fov = 50;
        break;
      }
      case 'finish':
        pos = tr.point(tr.L + 10 * M, this.side * 7, 4.5);
        look = tr.point(tr.L - 8 * M, 0, 1.2);
        fov = 46;
        break;
      case 'podium': {
        const a = Math.sin(t * 0.25) * 0.6;
        const c = tr.point(tr.L + 26, 0, 0);
        const sm = tr.sample(tr.L + 26);
        const fwd = sm.tan.clone().multiplyScalar(-1);
        pos = c.clone().addScaledVector(fwd, 18 * Math.cos(a)).addScaledVector(sm.nor, 18 * Math.sin(a)).setY(8);
        look = c.clone().setY(1.2);
        fov = 52;
        break;
      }
      default:
        pos = tr.point(-24, 0, 9);
        look = tr.point(0, 0, 2);
    }

    // ручная «живость» и плавность внутри плана, склейка — мгновенно
    pos.x += Math.sin(real * 0.7) * 0.25;
    pos.y += Math.sin(real * 0.9) * 0.2;
    if (this.cut) {
      this.pos.copy(pos); this.look.copy(look); this.fov = fov;
      this.cut = false;
    } else {
      const k = 1 - Math.exp(-dt * 4);
      this.pos.lerp(pos, k);
      this.look.lerp(look, k);
      this.fov += (fov - this.fov) * k;
    }
    const cam = this.camera;
    cam.position.copy(this.pos);
    if (this.shake > 0) {
      cam.position.add(V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(this.shake));
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    cam.lookAt(this.look);
    this.fovKick = Math.max(0, this.fovKick - dt * 8);
    cam.fov = this.fov + this.fovKick;
    cam.updateProjectionMatrix();
    return name;
  }
}
