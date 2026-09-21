const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// ================= input =================
const keys = {};
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  Space: 'fire', KeyP: 'pause', Enter: 'fire',
};
window.addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = false; e.preventDefault(); }
});

// touch controls: drag anywhere moves ship, holding fires
let touchX = null, touchY = null;
canvas.addEventListener('touchstart', e => {
  keys.fire = true;
  const t = e.touches[0], r = canvas.getBoundingClientRect();
  touchX = (t.clientX - r.left) * (W / r.width);
  touchY = (t.clientY - r.top) * (H / r.height);
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  const t = e.touches[0], r = canvas.getBoundingClientRect();
  touchX = (t.clientX - r.left) * (W / r.width);
  touchY = (t.clientY - r.top) * (H / r.height);
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', e => {
  keys.fire = false; touchX = null; touchY = null; e.preventDefault();
}, { passive: false });

// ================= sound (procedural, no assets) =================
let actx = null;
function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}
function beep(freq, dur, type = 'square', vol = 0.15) {
  try {
    const ac = audioCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  } catch (e) { /* audio unavailable, ignore */ }
}
const sfx = {
  shoot: () => beep(880, 0.08, 'square', 0.08),
  explosion: () => beep(80, 0.3, 'sawtooth', 0.2),
  hit: () => beep(150, 0.15, 'sawtooth', 0.2),
  powerup: () => beep(600, 0.2, 'sine', 0.15),
  bossHit: () => beep(220, 0.1, 'square', 0.15),
  gameover: () => { beep(200, 0.4, 'sawtooth', 0.2); setTimeout(() => beep(100, 0.6, 'sawtooth', 0.2), 200); },
};

// ================= starfield =================
const stars = Array.from({ length: 100 }, () => ({
  x: Math.random() * W, y: Math.random() * H,
  speed: 30 + Math.random() * 120, size: 1 + Math.random() * 2,
}));
function updateStars(dt) {
  for (const s of stars) {
    s.y += s.speed * dt;
    if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
  }
}
function drawStars() {
  ctx.fillStyle = '#fff';
  for (const s of stars) ctx.fillRect(s.x, s.y, s.size, s.size);
}

// ================= object pool (bullets) =================
function makePool(create, size) {
  const items = Array.from({ length: size }, create);
  return {
    items,
    spawn(init) {
      const it = items.find(i => !i.alive);
      if (it) { Object.assign(it, init, { alive: true }); return it; }
    },
  };
}

const playerBullets = makePool(() => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, r: 3 }), 60);
const enemyBullets = makePool(() => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, r: 4 }), 80);
const particles = makePool(() => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: '#fff' }), 200);

function spawnExplosion(x, y, color = '#ffa500', count = 14) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 160;
    particles.spawn({
      x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      life: 0.3 + Math.random() * 0.3, maxLife: 0.6, color,
    });
  }
}

// ================= weapon levels =================
const WEAPON_LEVELS = [
  { cooldown: 0.28, pattern: p => [{ x: p.x, y: p.y - 14, vx: 0, vy: -420 }] },
  { cooldown: 0.22, pattern: p => [{ x: p.x - 8, y: p.y - 10, vx: 0, vy: -420 }, { x: p.x + 8, y: p.y - 10, vx: 0, vy: -420 }] },
  { cooldown: 0.16, pattern: p => [
    { x: p.x, y: p.y - 16, vx: 0, vy: -460 },
    { x: p.x - 10, y: p.y - 6, vx: -80, vy: -420 },
    { x: p.x + 10, y: p.y - 6, vx: 80, vy: -420 },
  ] },
];

// ================= player =================
const player = {
  x: W / 2, y: H - 80, w: 24, h: 24, speed: 240,
  cooldown: 0, weaponLevel: 0,
  lives: 3, invuln: 0, shield: 0, alive: true,
  bombs: 1,
};
function resetPlayer() {
  player.x = W / 2; player.y = H - 80;
  player.lives = 3; player.invuln = 2; player.weaponLevel = 0;
  player.shield = 0; player.bombs = 1; player.alive = true;
}

function updatePlayer(dt) {
  let dx = 0, dy = 0;
  if (keys.left) dx -= 1;
  if (keys.right) dx += 1;
  if (keys.up) dy -= 1;
  if (keys.down) dy += 1;
  if (touchX !== null) {
    dx = Math.abs(touchX - player.x) > 4 ? Math.sign(touchX - player.x) : 0;
    dy = Math.abs(touchY - player.y) > 4 ? Math.sign(touchY - player.y) : 0;
  }
  const len = Math.hypot(dx, dy) || 1;
  player.x += (dx / len) * player.speed * dt;
  player.y += (dy / len) * player.speed * dt;
  player.x = Math.max(player.w / 2, Math.min(W - player.w / 2, player.x));
  player.y = Math.max(player.h / 2, Math.min(H - player.h / 2, player.y));

  player.cooldown -= dt;
  if (player.invuln > 0) player.invuln -= dt;

  if (keys.fire && player.cooldown <= 0) {
    const wl = WEAPON_LEVELS[player.weaponLevel];
    for (const b of wl.pattern(player)) playerBullets.spawn({ ...b, dmg: 1, r: 3 });
    player.cooldown = wl.cooldown;
    sfx.shoot();
  }
}

function drawPlayer() {
  if (!player.alive) return;
  if (player.invuln > 0 && Math.floor(player.invuln * 10) % 2 === 0) return; // blink
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.fillStyle = '#4cf';
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(10, 12);
  ctx.lineTo(0, 6);
  ctx.lineTo(-10, 12);
  ctx.closePath();
  ctx.fill();
  if (player.shield > 0) {
    ctx.strokeStyle = 'rgba(100,200,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ================= enemies =================
let enemies = [];
const ENEMY_TYPES = {
  straight: { w: 20, h: 20, hp: 1, color: '#e33', score: 10, speed: 90,
    move(e, dt) { e.y += e.speed * dt; } },
  sine: { w: 20, h: 20, hp: 2, color: '#3e3', score: 20, speed: 70,
    move(e, dt) { e.t += dt; e.y += e.speed * dt; e.x = e.baseX + Math.sin(e.t * 3) * 60; } },
  diver: { w: 22, h: 22, hp: 2, color: '#e3e', score: 30, speed: 130,
    move(e, dt) {
      if (!e.diving && e.y > 80) { e.diving = true; const dx = player.x - e.x, dy = player.y - e.y; const l = Math.hypot(dx, dy) || 1; e.vx = dx / l * e.speed; e.vy = dy / l * e.speed; }
      if (e.diving) { e.x += e.vx * dt; e.y += e.vy * dt; } else { e.y += e.speed * dt; }
    } },
};

function spawnEnemy(type, x, y) {
  const def = ENEMY_TYPES[type];
  enemies.push({ type, x, y, baseX: x, t: 0, vx: 0, vy: 0, diving: false, hp: def.hp, fireTimer: 1 + Math.random() });
}

function updateEnemies(dt, difficulty) {
  for (const e of enemies) {
    ENEMY_TYPES[e.type].move(e, dt);
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && e.y > 0 && e.y < H - 40) {
      e.fireTimer = (1.5 + Math.random()) / difficulty;
      const dx = player.x - e.x, dy = player.y - e.y, l = Math.hypot(dx, dy) || 1;
      enemyBullets.spawn({ x: e.x, y: e.y, vx: dx / l * 150, vy: dy / l * 150 });
    }
  }
  enemies = enemies.filter(e => e.y < H + 40 && e.y > -60 && e.x > -60 && e.x < W + 60);
}

function drawEnemies() {
  for (const e of enemies) {
    const def = ENEMY_TYPES[e.type];
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, def.w / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ================= boss =================
let boss = null;
function spawnBoss() {
  boss = {
    x: W / 2, y: -80, targetY: 100, w: 90, h: 60, hp: 120, maxHp: 120,
    pattern: 0, patternTimer: 0, fireTimer: 0, t: 0, alive: true,
  };
}
const BOSS_PATTERNS = [
  // spread fire
  (b, dt) => {
    b.fireTimer -= dt;
    if (b.fireTimer <= 0) {
      b.fireTimer = 0.5;
      for (let i = -2; i <= 2; i++) {
        const a = Math.PI / 2 + i * 0.25;
        enemyBullets.spawn({ x: b.x, y: b.y + 20, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160 });
      }
    }
  },
  // aimed burst
  (b, dt) => {
    b.fireTimer -= dt;
    if (b.fireTimer <= 0) {
      b.fireTimer = 0.35;
      const dx = player.x - b.x, dy = player.y - b.y, l = Math.hypot(dx, dy) || 1;
      enemyBullets.spawn({ x: b.x, y: b.y + 20, vx: dx / l * 220, vy: dy / l * 220 });
    }
  },
  // side sweep
  (b, dt) => {
    b.x = W / 2 + Math.sin(b.t * 1.5) * 140;
    b.fireTimer -= dt;
    if (b.fireTimer <= 0) {
      b.fireTimer = 0.15;
      enemyBullets.spawn({ x: b.x - 30, y: b.y + 20, vx: 0, vy: 200 });
      enemyBullets.spawn({ x: b.x + 30, y: b.y + 20, vx: 0, vy: 200 });
    }
  },
];
function updateBoss(dt) {
  if (!boss || !boss.alive) return;
  boss.t += dt;
  if (boss.y < boss.targetY) { boss.y += 60 * dt; return; }
  boss.patternTimer -= dt;
  if (boss.patternTimer <= 0) { boss.patternTimer = 5; boss.pattern = (boss.pattern + 1) % BOSS_PATTERNS.length; }
  BOSS_PATTERNS[boss.pattern](boss, dt);
}
function drawBoss() {
  if (!boss) return;
  ctx.fillStyle = '#933';
  ctx.fillRect(boss.x - boss.w / 2, boss.y - boss.h / 2, boss.w, boss.h);
  ctx.fillStyle = '#600';
  ctx.fillRect(boss.x - 10, boss.y - 10, 20, 20);
  // health bar
  ctx.fillStyle = '#333';
  ctx.fillRect(40, 12, W - 80, 10);
  ctx.fillStyle = '#e33';
  ctx.fillRect(40, 12, (W - 80) * (boss.hp / boss.maxHp), 10);
}

// ================= powerups =================
let powerups = [];
const POWERUP_TYPES = ['weapon', 'shield', 'bomb'];
function maybeDropPowerup(x, y) {
  if (Math.random() < 0.18) {
    powerups.push({ x, y, type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)], vy: 60 });
  }
}
function updatePowerups(dt) {
  for (const p of powerups) p.y += p.vy * dt;
  powerups = powerups.filter(p => p.y < H + 20);
}
function drawPowerups() {
  for (const p of powerups) {
    ctx.fillStyle = p.type === 'weapon' ? '#fd0' : p.type === 'shield' ? '#0cf' : '#f60';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ================= wave timeline =================
// each entry fires once at t seconds since stage start
function buildTimeline() {
  const t = [];
  for (let i = 0; i < 6; i++) t.push({ time: i * 1.2 + 1, spawn: () => spawnEnemy('straight', 60 + i * 60, -20) });
  for (let i = 0; i < 4; i++) t.push({ time: 10 + i * 1.5, spawn: () => spawnEnemy('sine', 100 + i * 80, -20) });
  for (let i = 0; i < 5; i++) t.push({ time: 18 + i * 1.3, spawn: () => spawnEnemy('diver', 80 + i * 70, -20) });
  for (let i = 0; i < 8; i++) t.push({ time: 26 + i * 1.0, spawn: () => spawnEnemy(['straight', 'sine', 'diver'][i % 3], 40 + (i * 53) % 400, -20) });
  t.push({ time: 40, spawn: () => spawnBoss() });
  return t.sort((a, b) => a.time - b.time);
}
let timeline = buildTimeline();
let stageTime = 0;
let timelineIdx = 0;

// ================= collisions =================
function circleHit(ax, ay, ar, bx, by, br) {
  return Math.hypot(ax - bx, ay - by) < ar + br;
}

function handleCollisions() {
  // player bullets vs enemies
  for (const b of playerBullets.items) {
    if (!b.alive) continue;
    for (const e of enemies) {
      const def = ENEMY_TYPES[e.type];
      if (circleHit(b.x, b.y, b.r, e.x, e.y, def.w / 2)) {
        b.alive = false;
        e.hp -= b.dmg;
        if (e.hp <= 0) {
          e.dead = true;
          score += def.score;
          spawnExplosion(e.x, e.y, def.color);
          maybeDropPowerup(e.x, e.y);
          sfx.explosion();
        } else {
          sfx.hit();
        }
        break;
      }
    }
    if (boss && boss.alive && circleHit(b.x, b.y, b.r, boss.x, boss.y, boss.w / 2)) {
      b.alive = false;
      boss.hp -= b.dmg;
      sfx.bossHit();
      if (boss.hp <= 0) {
        boss.alive = false;
        score += 500;
        spawnExplosion(boss.x, boss.y, '#f80', 60);
        sfx.explosion();
        state = 'win';
      }
    }
  }
  enemies = enemies.filter(e => !e.dead);

  // enemy bullets / enemies vs player
  if (player.invuln <= 0 && player.alive) {
    for (const b of enemyBullets.items) {
      if (!b.alive) continue;
      if (circleHit(b.x, b.y, b.r, player.x, player.y, 10)) { b.alive = false; hitPlayer(); }
    }
    for (const e of enemies) {
      const def = ENEMY_TYPES[e.type];
      if (circleHit(e.x, e.y, def.w / 2, player.x, player.y, 10)) { e.dead = true; hitPlayer(); }
    }
    enemies = enemies.filter(e => !e.dead);
  }

  // player vs powerups
  powerups = powerups.filter(p => {
    if (circleHit(p.x, p.y, 8, player.x, player.y, 12)) {
      applyPowerup(p.type);
      sfx.powerup();
      return false;
    }
    return true;
  });
}

function hitPlayer() {
  if (player.shield > 0) { player.shield--; player.invuln = 1; return; }
  player.lives--;
  player.invuln = 2;
  screenShake = 0.3;
  spawnExplosion(player.x, player.y, '#4cf', 20);
  sfx.hit();
  if (player.lives <= 0) { player.alive = false; state = 'gameover'; sfx.gameover(); saveHighScore(); }
}

function applyPowerup(type) {
  if (type === 'weapon') player.weaponLevel = Math.min(WEAPON_LEVELS.length - 1, player.weaponLevel + 1);
  else if (type === 'shield') player.shield = Math.min(3, player.shield + 1);
  else if (type === 'bomb') player.bombs++;
}

// ================= particles / bullets update+draw =================
function updateBulletsAndParticles(dt) {
  for (const b of playerBullets.items) if (b.alive) { b.x += b.vx * dt; b.y += b.vy * dt; if (b.y < -10 || b.x < -10 || b.x > W + 10) b.alive = false; }
  for (const b of enemyBullets.items) if (b.alive) { b.x += b.vx * dt; b.y += b.vy * dt; if (b.y > H + 10 || b.y < -10 || b.x < -10 || b.x > W + 10) b.alive = false; }
  for (const p of particles.items) if (p.alive) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.life <= 0) p.alive = false; }
}
function drawBulletsAndParticles() {
  ctx.fillStyle = '#ff0';
  for (const b of playerBullets.items) if (b.alive) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#f44';
  for (const b of enemyBullets.items) if (b.alive) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
  for (const p of particles.items) if (p.alive) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 3, 3);
  }
  ctx.globalAlpha = 1;
}

// ================= score / highscore =================
let score = 0;
let highScore = Number(localStorage.getItem('shooter_highscore') || 0);
function saveHighScore() {
  if (score > highScore) { highScore = score; localStorage.setItem('shooter_highscore', String(highScore)); }
}

// ================= difficulty scaling =================
function currentDifficulty() { return 1 + stageTime / 60; }

// ================= state machine =================
let state = 'title'; // title | playing | paused | gameover | win
let screenShake = 0;
let pauseLatch = false;

function startGame() {
  score = 0;
  enemies = []; powerups = []; boss = null;
  playerBullets.items.forEach(b => b.alive = false);
  enemyBullets.items.forEach(b => b.alive = false);
  particles.items.forEach(p => p.alive = false);
  timeline = buildTimeline();
  stageTime = 0; timelineIdx = 0;
  resetPlayer();
  state = 'playing';
}

function updateGame(dt) {
  if (keys.pause && !pauseLatch && (state === 'playing' || state === 'paused')) {
    state = state === 'playing' ? 'paused' : 'playing';
  }
  pauseLatch = keys.pause;

  updateStars(dt);

  if (state === 'title') {
    if (keys.fire) startGame();
    return;
  }
  if (state === 'gameover' || state === 'win') {
    updateBulletsAndParticles(dt);
    if (keys.fire) state = 'title';
    return;
  }
  if (state === 'paused') return;

  // playing
  stageTime += dt;
  const difficulty = currentDifficulty();
  while (timelineIdx < timeline.length && timeline[timelineIdx].time <= stageTime) {
    timeline[timelineIdx].spawn();
    timelineIdx++;
  }
  updatePlayer(dt);
  updateEnemies(dt, difficulty);
  updateBoss(dt);
  updatePowerups(dt);
  updateBulletsAndParticles(dt);
  handleCollisions();
  if (screenShake > 0) screenShake -= dt;
}

function drawHUD() {
  ctx.fillStyle = '#fff';
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE ${score}`, 8, 20);
  ctx.fillText(`HI ${highScore}`, 8, 36);
  ctx.textAlign = 'right';
  ctx.fillText(`LIVES ${player.lives}`, W - 8, 20);
  ctx.fillText(`BOMB ${player.bombs}`, W - 8, 36);
  ctx.textAlign = 'center';
}

function drawCenterText(lines) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? '28px monospace' : '16px monospace';
    ctx.fillText(line, W / 2, H / 2 - 20 + i * 30);
  });
}

function drawGame() {
  let sx = 0, sy = 0;
  if (screenShake > 0) { sx = (Math.random() - 0.5) * 8 * screenShake; sy = (Math.random() - 0.5) * 8 * screenShake; }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = '#000';
  ctx.fillRect(-10, -10, W + 20, H + 20);
  drawStars();

  if (state === 'title') {
    drawCenterText(['SHOOTER', 'press SPACE to start', `HI ${highScore}`]);
    ctx.restore();
    return;
  }

  drawEnemies();
  drawBoss();
  drawPowerups();
  drawPlayer();
  drawBulletsAndParticles();
  drawHUD();

  if (state === 'gameover') drawCenterText(['GAME OVER', `SCORE ${score}`, 'press SPACE to restart']);
  if (state === 'win') drawCenterText(['STAGE CLEAR', `SCORE ${score}`, 'press SPACE to restart']);
  if (state === 'paused') drawCenterText(['PAUSED']);
  ctx.restore();
}

// ================= fixed-timestep loop with fps sanity check =================
const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let frameCount = 0, fpsTimer = 0, fps = 60;

function loop(now) {
  const rawDt = (now - last) / 1000;
  last = now;
  acc += rawDt;
  fpsTimer += rawDt; frameCount++;
  if (fpsTimer >= 1) { fps = frameCount; frameCount = 0; fpsTimer -= 1; }
  let steps = 0;
  while (acc >= STEP && steps < 5) { updateGame(STEP); acc -= STEP; steps++; }
  drawGame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
