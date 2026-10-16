// Мемные лица для кубических человечков (рисуются на холсте 128×128).
// npc, normal, smug (сигма), gigachad, cool (deal with it), hype, scream,
// stun, cry, laugh (😂), cursed, sus, skull (💀), moai (🗿), clown (🤡),
// happy, angry.

const INK = '#16121f';

function eye(g, x, y, r = 9, px = 0, py = 0, pr = 5) {
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(x, y, r, r * 1.1, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = INK;
  g.beginPath(); g.arc(x + px, y + py, pr, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(x + px - pr * 0.35, y + py - pr * 0.35, pr * 0.3, 0, Math.PI * 2); g.fill();
}

function line(g, pts, w = 5, color = INK) {
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke();
}

function arc(g, x, y, r, a0, a1, w = 5, color = INK) {
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke();
}

function blush(g) {
  g.fillStyle = 'rgba(255, 90, 120, .35)';
  for (const x of [26, 102]) { g.beginPath(); g.ellipse(x, 82, 11, 6, 0, 0, Math.PI * 2); g.fill(); }
}

function grin(g, x, y, w, h, teeth = true) {
  g.fillStyle = INK;
  g.beginPath(); g.moveTo(x - w, y); g.quadraticCurveTo(x, y + h * 2, x + w, y); g.closePath(); g.fill();
  if (teeth) { g.fillStyle = '#fff'; g.fillRect(x - w * 0.75, y + 1, w * 1.5, h * 0.35); }
  g.fillStyle = '#ff5c7a';
  g.beginPath(); g.ellipse(x, y + h * 0.95, w * 0.4, h * 0.25, 0, 0, Math.PI * 2); g.fill();
}

const FACES = {
  npc(g) {           // пустой NPC-взгляд
    g.fillStyle = INK;
    g.fillRect(34, 50, 10, 10); g.fillRect(84, 50, 10, 10);
    line(g, [[48, 92], [80, 92]], 5);
  },
  normal(g) {
    eye(g, 40, 54); eye(g, 88, 54);
    arc(g, 64, 78, 18, 0.2 * Math.PI, 0.8 * Math.PI, 6);
    blush(g);
  },
  happy(g) {
    arc(g, 40, 58, 10, 1.1 * Math.PI, 1.9 * Math.PI, 6); arc(g, 88, 58, 10, 1.1 * Math.PI, 1.9 * Math.PI, 6);
    grin(g, 64, 80, 22, 14, false);
    blush(g);
  },
  smug(g) {          // сигма: бровь вверх, прищур, ухмылка набок
    line(g, [[26, 38], [52, 30]], 6); line(g, [[76, 42], [102, 42]], 6);
    g.fillStyle = '#fff'; g.fillRect(28, 50, 24, 10); g.fillRect(76, 52, 24, 8);
    g.fillStyle = INK; g.fillRect(40, 50, 9, 10); g.fillRect(88, 52, 9, 8);
    line(g, [[30, 49], [52, 49]], 4); line(g, [[76, 51], [100, 51]], 4);
    line(g, [[50, 90], [70, 92], [88, 82]], 6);
  },
  gigachad(g) {      // челюсть, щетина, тяжёлые брови
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 84, 128, 44);
    g.fillStyle = 'rgba(0,0,0,.25)';
    for (let i = 0; i < 40; i++) g.fillRect(14 + ((i * 37) % 100), 90 + ((i * 53) % 30), 3, 3);
    line(g, [[22, 40], [56, 46]], 9); line(g, [[72, 46], [106, 40]], 9);
    g.fillStyle = INK; g.fillRect(32, 52, 20, 6); g.fillRect(76, 52, 20, 6);
    line(g, [[64, 58], [60, 76], [68, 78]], 4, 'rgba(0,0,0,.45)');
    line(g, [[48, 96], [80, 92]], 6);
    line(g, [[64, 112], [64, 122]], 3, 'rgba(0,0,0,.4)');
  },
  cool(g) {          // deal with it
    g.fillStyle = INK;
    g.fillRect(16, 44, 96, 8);
    for (const x of [18, 70]) {
      g.fillRect(x, 44, 40, 22);
      g.fillStyle = '#4a4a5a'; g.fillRect(x + 4, 48, 8, 6); g.fillRect(x + 4, 54, 4, 4); g.fillStyle = INK;
    }
    line(g, [[48, 92], [66, 94], [84, 86]], 6);
  },
  hype(g) {          // орёт от восторга
    eye(g, 40, 50, 12, 0, 0, 6); eye(g, 88, 50, 12, 0, 0, 6);
    line(g, [[26, 30], [50, 34]], 6); line(g, [[78, 34], [102, 30]], 6);
    grin(g, 64, 74, 30, 20);
  },
  scream(g) {
    eye(g, 40, 48, 13, 0, 0, 3); eye(g, 88, 48, 13, 0, 0, 3);
    g.fillStyle = INK; g.beginPath(); g.ellipse(64, 92, 16, 22, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff5c7a'; g.beginPath(); g.ellipse(64, 104, 9, 7, 0, 0, Math.PI * 2); g.fill();
  },
  stun(g) {
    for (const cx of [40, 88]) line(g, [[cx - 10, 44], [cx + 10, 64]], 6), line(g, [[cx + 10, 44], [cx - 10, 64]], 6);
    line(g, [[40, 94], [50, 88], [60, 94], [70, 88], [80, 94], [90, 88]], 5);
  },
  cry(g) {
    arc(g, 40, 50, 10, 0.1 * Math.PI, 0.9 * Math.PI, 6); arc(g, 88, 50, 10, 0.1 * Math.PI, 0.9 * Math.PI, 6);
    g.fillStyle = '#5ac8ff'; g.fillRect(34, 60, 10, 50); g.fillRect(84, 60, 10, 50);
    arc(g, 64, 104, 18, 1.2 * Math.PI, 1.8 * Math.PI, 6);
  },
  laugh(g) {         // 😂
    line(g, [[28, 48], [42, 56], [28, 62]], 6); line(g, [[100, 48], [86, 56], [100, 62]], 6);
    g.fillStyle = '#5ac8ff';
    g.beginPath(); g.ellipse(20, 70, 6, 12, 0.3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(108, 70, 6, 12, -0.3, 0, Math.PI * 2); g.fill();
    grin(g, 64, 78, 28, 18);
  },
  cursed(g) {        // проклятые огромные глаза
    eye(g, 38, 52, 18, 6, -4, 3); eye(g, 92, 50, 14, -5, 6, 2.5);
    g.fillStyle = INK; g.fillRect(60, 98, 8, 5);
    line(g, [[30, 28], [46, 34]], 4); line(g, [[84, 36], [102, 26]], 4);
  },
  sus(g) {           // косится
    g.fillStyle = '#fff'; g.fillRect(26, 50, 28, 12); g.fillRect(74, 50, 28, 12);
    g.fillStyle = INK; g.fillRect(44, 50, 10, 12); g.fillRect(92, 50, 10, 12);
    line(g, [[26, 46], [54, 46]], 5); line(g, [[74, 40], [102, 46]], 5);
    line(g, [[50, 92], [82, 92]], 5);
  },
  angry(g) {
    line(g, [[24, 36], [54, 48]], 8); line(g, [[74, 48], [104, 36]], 8);
    eye(g, 40, 58, 8, 0, 0, 5); eye(g, 88, 58, 8, 0, 0, 5);
    g.fillStyle = INK; g.fillRect(42, 86, 44, 16);
    g.fillStyle = '#fff'; for (let x = 44; x < 84; x += 8) g.fillRect(x, 88, 6, 12);
  },
  skull(g) {         // 💀
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(40, 54, 15, 17, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(88, 54, 15, 17, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(64, 70); g.lineTo(56, 84); g.lineTo(72, 84); g.fill();
    g.fillRect(36, 96, 56, 18);
    g.fillStyle = '#f4f1ea'; for (let x = 40; x < 90; x += 10) g.fillRect(x, 96, 5, 18);
  },
  moai(g) {          // 🗿
    g.fillStyle = '#9a9a92'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(18, 36, 92, 14);
    g.fillStyle = '#5c5c56'; g.fillRect(28, 50, 26, 10); g.fillRect(74, 50, 26, 10);
    g.fillStyle = '#86867e'; g.fillRect(56, 44, 16, 50);
    g.fillStyle = '#5c5c56'; g.fillRect(40, 102, 48, 8);
  },
  clown(g) {         // 🤡
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#3b6bff';
    for (const x of [40, 88]) { g.beginPath(); g.moveTo(x, 34); g.lineTo(x + 12, 54); g.lineTo(x, 74); g.lineTo(x - 12, 54); g.fill(); }
    eye(g, 40, 54, 7, 0, 0, 4); eye(g, 88, 54, 7, 0, 0, 4);
    g.fillStyle = '#ff2b3b'; g.beginPath(); g.arc(64, 74, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff2b3b'; g.beginPath(); g.moveTo(30, 92); g.quadraticCurveTo(64, 124, 98, 92); g.quadraticCurveTo(64, 108, 30, 92); g.fill();
  },
};

export const MOODS = Object.keys(FACES);

export function drawFace(g, mood, skin) {
  g.fillStyle = skin;
  g.fillRect(0, 0, 128, 128);
  (FACES[mood] || FACES.normal)(g);
}

// реакция на мем-слово из чата
export const EMOTE_MOOD = {
  '🗿': 'moai', '💀': 'skull', '😂': 'laugh', '🤡': 'clown', '😎': 'cool', '🔥': 'hype',
  '🏆': 'happy', '✨': 'smug', '🚽': 'cursed', '6️⃣7️⃣': 'sus', '❤️': 'happy',
};
