/* ============================================================
 * 坦克大战 Tank Battle —— 经典 Battle City 风格
 * 纯 Canvas + 原生 JS，无外部依赖
 * ============================================================ */

'use strict';

/* ---------------- 常量 ---------------- */
const TILE = 32;
const COLS = 26;
const ROWS = 19;
const W = COLS * TILE;   // 832
const H = ROWS * TILE;   // 608

const T_EMPTY = 0;
const T_BRICK = 1;
const T_STEEL = 2;
const T_WATER = 3;
const T_TREE  = 4;
const T_BASE  = 5;

const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

const TANK_SIZE = 28;
const BULLET_SIZE = 6;

const MAX_ENEMIES_ON_FIELD = 4;
const PLAYER_SPAWNS = [{ x: 8, y: 17 }];
const ENEMY_SPAWNS = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 24, y: 0 }];
const BASE_TILES = [{ c: 12, r: 17 }, { c: 13, r: 17 }, { c: 12, r: 18 }, { c: 13, r: 18 }];

/* ---------------- 关卡地图 ----------------
 * . 空地   # 砖墙   @ 钢墙   ~ 水域   T 树林   B 基地
 * 每行必须恰好 26 个字符，共 19 行
 */
const LEVELS = [
  [
    "..........................",
    "..........................",
    "....##....##..##....##....",
    "....##....##..##....##....",
    "....##....##..##....##....",
    "....##....##..##....##....",
    "..........................",
    "..##...@@......@@...##....",
    "..##................##....",
    "..##..~~~~....~~~~..##....",
    "......~~~~....~~~~........",
    "..##..~~~~....~~~~..##....",
    "..##................##....",
    "..##...@@......@@...##....",
    "..........................",
    "....##....######....##....",
    "............####..........",
    "..........#.BB.#..........",
    "..........#.BB.#.........."
  ],
  [
    "..........................",
    "..@@@@..##......##..@@@@..",
    "........##..TT..##........",
    "..##....##..TT..##....##..",
    "..##....##......##....##..",
    "..##....##########....##..",
    "..##..................##..",
    "..##..@@..######..@@..##..",
    "...........#....#.........",
    "~~..........####........~~",
    "~~..........####........~~",
    "...........#....#.........",
    "..##..@@..######..@@..##..",
    "..##..................##..",
    "..##....##########....##..",
    "..##....##......##....##..",
    "........##..TT..##........",
    "..@@@@..##.#BB#.##..@@@@..",
    "............#BB#.........."
  ],
  [
    "..........................",
    ".####.######..######.####.",
    ".####.######..######.####.",
    "..........................",
    "..@@..##..######..##..@@..",
    "..@@..##..######..##..@@..",
    ".......#..........#.......",
    "..######..##..##..######..",
    "..######..##..##..######..",
    "..........##..##..........",
    "~~..@@..............@@..~~",
    "~~..@@..TT......TT..@@..~~",
    "..........TT......TT......",
    "..##..####..####..####..##",
    "..##..####..####..####..##",
    "..........................",
    "....##...########...##....",
    "..........##BB##..........",
    "..........##BB##.........."
  ]
];

/* ---------------- 画布 ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const hud = {
  level: document.getElementById('level'),
  score: document.getElementById('score'),
  lives: document.getElementById('lives'),
  enemiesLeft: document.getElementById('enemies-left')
};
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');

/* ---------------- 游戏状态 ---------------- */
let state = 'title';        // title | playing | levelclear | gameover
let paused = false;
let muted = false;
let grid, brickMask;        // 地图
let player, enemies, bullets, particles, powerups;
let spawnQueue, spawnTimer;
let level = 1;
let score = 0;
let lives = 3;
let baseAlive = true;
let animFrame = 0;

/* ---------------- 音效 (WebAudio) ---------------- */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 无音频环境 */ }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function beep(freq, dur, type = 'square', vol = 0.08, slide = 0) {
  if (muted || !audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}
const SFX = {
  shoot:     () => beep(520, 0.08, 'square', 0.05, -300),
  hitWall:   () => beep(180, 0.05, 'square', 0.04),
  explosion: () => beep(90, 0.35, 'sawtooth', 0.12, -60),
  bigBoom:   () => beep(60, 0.6, 'sawtooth', 0.15, -40),
  powerup:   () => { beep(660, 0.08, 'square', 0.07); setTimeout(() => beep(880, 0.12, 'square', 0.07), 90); },
  stage:     () => { beep(392, 0.1, 'triangle', 0.08); setTimeout(() => beep(523, 0.1, 'triangle', 0.08), 110); setTimeout(() => beep(659, 0.18, 'triangle', 0.08), 220); }
};

/* ---------------- 地图工具 ---------------- */
function tileAt(c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return T_STEEL; // 边界视为钢墙
  return grid[r * COLS + c];
}
function setTile(c, r, t) { grid[r * COLS + c] = t; }
function brickQuads(c, r) { return brickMask[r * COLS + c]; }

function solidForTank(t) { return t === T_BRICK || t === T_STEEL || t === T_WATER || t === T_BASE; }
function solidForBullet(t) { return t === T_BRICK || t === T_STEEL || t === T_BASE; }

function loadLevel(idx) {
  grid = new Uint8Array(ROWS * COLS);
  brickMask = new Uint8Array(ROWS * COLS).fill(15); // 4 个象限都在
  const map = LEVELS[(idx - 1) % LEVELS.length];
  for (let r = 0; r < ROWS; r++) {
    const row = map[r] || '';
    for (let c = 0; c < COLS; c++) {
      switch (row[c]) {
        case '#': setTile(c, r, T_BRICK); break;
        case '@': setTile(c, r, T_STEEL); break;
        case '~': setTile(c, r, T_WATER); break;
        case 'T': setTile(c, r, T_TREE); break;
        case 'B': setTile(c, r, T_BASE); break;
        default:  setTile(c, r, T_EMPTY);
      }
    }
  }
  // 基地周围强制保护墙，防止地图手误
  for (const t of BASE_TILES) setTile(t.c, t.r, T_BASE);
}

/* 矩形 (px) 与地图的碰撞 */
function rectHitsMap(x, y, w, h, solidFn) {
  const c0 = Math.floor(x / TILE), c1 = Math.floor((x + w - 1) / TILE);
  const r0 = Math.floor(y / TILE), r1 = Math.floor((y + h - 1) / TILE);
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (solidFn(tileAt(c, r))) return true;
  return false;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/* ---------------- 坦克 ---------------- */
class Tank {
  constructor(col, row, isPlayer, kind = 0) {
    this.x = col * TILE + (TILE - TANK_SIZE) / 2;
    this.y = row * TILE + (TILE - TANK_SIZE) / 2;
    this.dir = isPlayer ? DIR.UP : DIR.DOWN;
    this.isPlayer = isPlayer;
    this.kind = kind;              // 敌人类型: 0普通 1快速 2炮弹 3装甲
    this.size = TANK_SIZE;
    this.trackFrame = 0;
    this.shieldTime = 0;           // 出生保护罩
    this.spawnTime = 500;          // 出生动画
    this.fireCooldown = 0;
    this.aiTimer = 0;
    this.alive = true;
    if (isPlayer) {
      this.speed = 2.2;
      this.level = 0;              // 0~3 星级
      this.hp = 1;
    } else {
      const cfg = ENEMY_TYPES[kind];
      this.speed = cfg.speed;
      this.hp = cfg.hp;
    }
  }

  get rect() { return { x: this.x, y: this.y, w: this.size, h: this.size }; }

  tryMove(dt) {
    const nx = this.x + DX[this.dir] * this.speed;
    const ny = this.y + DY[this.dir] * this.speed;
    // 转向时吸附到网格，便于穿过窄缝
    const aligned = this.alignToGrid();
    if (!aligned) return false;
    if (rectHitsMap(nx, ny, this.size, this.size, solidForTank)) return false;
    // 坦克之间不能重叠
    const all = this.isPlayer ? enemies : (player && player.alive ? [player, ...enemies] : enemies);
    for (const t of all) {
      if (t === this || !t.alive || t.spawnTime > 0) continue;
      if (rectsOverlap({ x: nx, y: ny, w: this.size, h: this.size }, t.rect)) return false;
    }
    this.x = nx; this.y = ny;
    this.trackFrame += dt * this.speed;
    return true;
  }

  alignToGrid() {
    const GRID = 8;
    if (this.dir === DIR.UP || this.dir === DIR.DOWN) {
      const m = this.x % GRID;
      if (m !== 0) { this.x += m < GRID / 2 ? -m : GRID - m; return false; }
    } else {
      const m = this.y % GRID;
      if (m !== 0) { this.y += m < GRID / 2 ? -m : GRID - m; return false; }
    }
    return true;
  }

  fire() {
    if (this.fireCooldown > 0 || this.spawnTime > 0) return;
    const ownBullets = bullets.filter(b => b.owner === this).length;
    const maxBullets = this.isPlayer ? (this.level >= 2 ? 2 : 1) : 1;
    if (ownBullets >= maxBullets) return;
    const cfg = this.isPlayer
      ? { speed: this.level >= 1 ? 8 : 6, power: this.level >= 3 }
      : { speed: this.kind === 2 ? 7 : 5, power: false };
    const cx = this.x + this.size / 2;
    const cy = this.y + this.size / 2;
    bullets.push(new Bullet(
      cx - BULLET_SIZE / 2 + DX[this.dir] * (this.size / 2),
      cy - BULLET_SIZE / 2 + DY[this.dir] * (this.size / 2),
      this.dir, cfg.speed, cfg.power, this
    ));
    this.fireCooldown = this.isPlayer ? 280 : 900 + Math.random() * 700;
    if (this.isPlayer || dist2(cx, cy, player.x, player.y) < 400 * 400) SFX.shoot();
  }

  hit(byBullet) {
    if (this.spawnTime > 0) return false;
    if (this.isPlayer) {
      if (this.shieldTime > 0) return false;
      this.die();
      return true;
    }
    // 敌人可被任何子弹击杀
    if (byBullet && byBullet.owner && !byBullet.owner.isPlayer && byBullet.owner !== this) return false; // 敌我不分？经典模式敌弹可互伤，这里保留互伤
    this.hp--;
    if (this.hp <= 0) {
      this.die();
      const bonus = this.bonus ? 500 : ENEMY_TYPES[this.kind].score;
      score += bonus;
      if (this.bonus) dropPowerup(this.x + this.size / 2, this.y + this.size / 2);
      return true;
    }
    return true;
  }

  die() {
    this.alive = false;
    explode(this.x + this.size / 2, this.y + this.size / 2, this.size);
    SFX.explosion();
  }

  update(dt) {
    if (!this.alive) return;
    if (this.spawnTime > 0) { this.spawnTime -= dt; return; }
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.shieldTime > 0) this.shieldTime -= dt;
    if (this.isPlayer) {
      this.handleInput(dt);
    } else {
      this.handleAI(dt);
    }
  }

  handleInput(dt) {
    let moved = false;
    if (keys['ArrowUp'] || keys['KeyW'])    { this.setDir(DIR.UP); moved = true; }
    else if (keys['ArrowDown'] || keys['KeyS']) { this.setDir(DIR.DOWN); moved = true; }
    else if (keys['ArrowLeft'] || keys['KeyA']) { this.setDir(DIR.LEFT); moved = true; }
    else if (keys['ArrowRight'] || keys['KeyD']) { this.setDir(DIR.RIGHT); moved = true; }
    if (moved) this.tryMove(dt);
    if (keys['Space'] || keys['KeyJ']) this.fire();
  }

  setDir(d) { if (this.dir !== d) { this.dir = d; } }

  handleAI(dt) {
    this.aiTimer -= dt;
    const moved = this.tryMove(dt);
    if (!moved || this.aiTimer <= 0) {
      this.aiTimer = 400 + Math.random() * 1200;
      this.pickDir();
    }
    // 开火：与玩家或基地大致对齐时概率更高
    if (this.fireCooldown <= 0) {
      const cx = this.x + this.size / 2, cy = this.y + this.size / 2;
      let chance = 0.25;
      if (player && player.alive) {
        const dx = Math.abs(cx - (player.x + player.size / 2));
        const dy = Math.abs(cy - (player.y + player.size / 2));
        if (dx < TILE || dy < TILE) chance = 0.75;
      }
      if (Math.random() < chance) this.fire();
    }
  }

  pickDir() {
    const options = [DIR.UP, DIR.RIGHT, DIR.DOWN, DIR.LEFT];
    // 70% 偏向玩家/基地方向
    if (player && player.alive && Math.random() < 0.7) {
      const tx = player.x + player.size / 2, ty = player.y + player.size / 2;
      const cx = this.x + this.size / 2, cy = this.y + this.size / 2;
      const ddx = tx - cx, ddy = ty - cy;
      const prefer = Math.abs(ddx) > Math.abs(ddy)
        ? (ddx > 0 ? DIR.RIGHT : DIR.LEFT)
        : (ddy > 0 ? DIR.DOWN : DIR.UP);
      this.dir = prefer;
      if (this.tryMove(16)) return;
    }
    // 随机选择一个能走的方向
    const shuffled = options.sort(() => Math.random() - 0.5);
    for (const d of shuffled) {
      this.dir = d;
      if (this.tryMove(16)) return;
    }
  }
}

const ENEMY_TYPES = [
  { speed: 1.3, hp: 1, score: 100, color: '#9aa0a6', name: 'basic' },  // 普通
  { speed: 2.4, hp: 1, score: 200, color: '#e8b04b', name: 'fast'  },  // 快速
  { speed: 1.7, hp: 1, score: 300, color: '#4be86b', name: 'power' },  // 炮弹（弹速快）
  { speed: 1.0, hp: 4, score: 400, color: '#c04be8', name: 'armor' }   // 装甲
];

/* ---------------- 子弹 ---------------- */
class Bullet {
  constructor(x, y, dir, speed, power, owner) {
    this.x = x; this.y = y;
    this.dir = dir;
    this.speed = speed;
    this.power = power;     // 三星子弹可打穿钢墙
    this.owner = owner;
    this.alive = true;
  }
  get rect() { return { x: this.x, y: this.y, w: BULLET_SIZE, h: BULLET_SIZE }; }

  update(dt) {
    const steps = Math.max(1, Math.ceil(this.speed * dt / 16));
    for (let i = 0; i < steps && this.alive; i++) {
      this.x += DX[this.dir] * this.speed / steps;
      this.y += DY[this.dir] * this.speed / steps;
      this.checkCollisions();
    }
    if (this.x < -TILE || this.x > W + TILE || this.y < -TILE || this.y > H + TILE) this.alive = false;
  }

  checkCollisions() {
    const r = this.rect;

    // 子弹对撞抵消
    for (const b of bullets) {
      if (b !== this && b.alive && b.owner !== this.owner && rectsOverlap(r, b.rect)) {
        b.alive = false; this.alive = false;
        return;
      }
    }

    // 打坦克
    if (this.owner.isPlayer) {
      for (const e of enemies) {
        if (e.alive && e.spawnTime <= 0 && rectsOverlap(r, e.rect)) {
          this.alive = false;
          e.hit(this);
          return;
        }
      }
    } else {
      if (player && player.alive && player.spawnTime <= 0 && rectsOverlap(r, player.rect)) {
        this.alive = false;
        player.hit(this);
        return;
      }
      // 敌方子弹可以误伤其他敌人（经典设定）
      for (const e of enemies) {
        if (e !== this.owner && e.alive && e.spawnTime <= 0 && rectsOverlap(r, e.rect)) {
          this.alive = false;
          e.hit(this);
          return;
        }
      }
    }

    // 打地图
    const cx = Math.floor((this.x + BULLET_SIZE / 2) / TILE);
    const cy = Math.floor((this.y + BULLET_SIZE / 2) / TILE);
    for (let rr = cy - 1; rr <= cy + 1; rr++) {
      for (let cc = cx - 1; cc <= cx + 1; cc++) {
        const t = tileAt(cc, rr);
        if (!solidForBullet(t)) continue;
        const tileRect = { x: cc * TILE, y: rr * TILE, w: TILE, h: TILE };
        if (!rectsOverlap(r, tileRect)) continue;
        this.alive = false;
        if (t === T_BRICK) {
          damageBrick(cc, rr, this.dir);
          SFX.hitWall();
        } else if (t === T_STEEL) {
          if (this.power) { setTile(cc, rr, T_EMPTY); explode(cc * TILE + 16, rr * TILE + 16, 20); }
          SFX.hitWall();
        } else if (t === T_BASE) {
          destroyBase();
        }
        return;
      }
    }
  }
}

/* 砖块按象限摧毁：击中某一边就清掉该侧两个象限 */
function damageBrick(c, r, bulletDir) {
  const idx = r * COLS + c;
  let mask = brickMask[idx];
  if (bulletDir === DIR.UP)    mask &= ~(1 | 2);        // 清下排（BL|BR）
  else if (bulletDir === DIR.DOWN)  mask &= ~(4 | 8);    // 清上排（TL|TR）
  else if (bulletDir === DIR.LEFT)  mask &= ~(2 | 8);    // 清右列（TR|BR）
  else                              mask &= ~(1 | 4);    // 清左列（TL|BL）
  brickMask[idx] = mask;
  if (mask === 0) setTile(c, r, T_EMPTY);
}

/* ---------------- 特效 ---------------- */
function explode(x, y, size) {
  particles.push({ x, y, t: 0, dur: 350, size: size * 1.4, type: 'boom' });
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 3;
    particles.push({
      x, y, t: 0, dur: 300 + Math.random() * 200, type: 'spark',
      vx: Math.cos(a) * s, vy: Math.sin(a) * s
    });
  }
}

function dropPowerup(x, y) {
  const types = ['star', 'shield', 'life'];
  const type = types[Math.floor(Math.random() * types.length)];
  powerups.push({ type, x: x - 14, y: y - 14, w: 28, h: 28, ttl: 12000 });
  SFX.powerup();
}

function applyPowerup(p) {
  SFX.powerup();
  if (p.type === 'star') {
    if (player.level < 3) player.level++;
  } else if (p.type === 'shield') {
    player.shieldTime = 8000;
  } else if (p.type === 'life') {
    lives++;
  }
}

/* ---------------- 基地 ---------------- */
function destroyBase() {
  if (!baseAlive) return;
  baseAlive = false;
  for (const t of BASE_TILES) {
    explode(t.c * TILE + 16, t.r * TILE + 16, TILE);
  }
  SFX.bigBoom();
  gameOver();
}

/* ---------------- 关卡流程 ---------------- */
function startGame() {
  ensureAudio();
  level = 1;
  score = 0;
  lives = 3;
  startLevel();
}

function startLevel() {
  loadLevel(level);
  bullets = [];
  particles = [];
  powerups = [];
  enemies = [];
  baseAlive = true;
  player = new Tank(PLAYER_SPAWNS[0].x, PLAYER_SPAWNS[0].y, true);
  player.shieldTime = 2500;
  // 生成敌人队列：总数与强度随关卡提升
  spawnQueue = [];
  const total = Math.min(20, 10 + level * 2);
  for (let i = 0; i < total; i++) {
    // 越往后装甲车越多
    const roll = Math.random();
    let kind;
    if (roll < Math.max(0.05, 0.5 - level * 0.06)) kind = 3;
    else if (roll < 0.65) kind = Math.floor(Math.random() * 3);
    else kind = 0;
    spawnQueue.push({ kind, bonus: (i % 4 === 3) }); // 每第 4 辆是奖励车
  }
  spawnTimer = 500;
  state = 'playing';
  paused = false;
  hideOverlay();
  SFX.stage();
}

function spawnEnemy() {
  const spot = ENEMY_SPAWNS[Math.floor(Math.random() * ENEMY_SPAWNS.length)];
  const x = spot.x * TILE + 2, y = spot.y * TILE + 2;
  // 出生点被占用则跳过
  for (const e of enemies) {
    if (e.alive && Math.abs(e.x - x) < TILE && Math.abs(e.y - y) < TILE) return;
  }
  const item = spawnQueue.shift();
  if (!item) return;
  const e = new Tank(spot.x, spot.y, false, item.kind);
  e.bonus = item.bonus;
  e.spawnTime = 800;
  enemies.push(e);
}

function levelCleared() {
  state = 'levelclear';
  score += 300;
  showOverlay('第 ' + level + ' 关完成！', '按 回车键 进入下一关');
  SFX.stage();
}

function gameOver() {
  state = 'gameover';
  if (player) player.alive = false;
  showOverlay('游戏结束', '最终得分：' + score + '　按 回车键 重新开始');
}

function nextLevel() {
  level++;
  startLevel();
}

function respawnPlayer() {
  player = new Tank(PLAYER_SPAWNS[0].x, PLAYER_SPAWNS[0].y, true);
  player.shieldTime = 2500;
}

/* ---------------- 输入 ---------------- */
const keys = {};
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  ensureAudio();

  if (e.code === 'KeyM') { muted = !muted; }
  if (e.code === 'KeyP' && state === 'playing') {
    paused = !paused;
    if (paused) showOverlay('已暂停', '按 P 键继续游戏');
    else hideOverlay();
  }
  if (e.code === 'Enter') {
    if (state === 'title' || state === 'gameover') startGame();
    else if (state === 'levelclear') nextLevel();
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => {
  if (state === 'playing' && !paused) {
    paused = true;
    showOverlay('已暂停', '按 P 键继续游戏');
  }
});

/* ---------------- 覆盖层 ---------------- */
function showOverlay(title, sub) {
  overlayTitle.textContent = title;
  overlaySub.textContent = sub;
  overlay.classList.remove('hidden');
}
function hideOverlay() { overlay.classList.add('hidden'); }

/* ---------------- 主循环 ---------------- */
let lastTime = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(50, t - lastTime || 16);
  lastTime = t;
  animFrame = t;

  if (state === 'playing' && !paused) update(dt);
  render();
}

function update(dt) {
  // 出怪
  if (spawnQueue.length && enemies.filter(e => e.alive).length < MAX_ENEMIES_ON_FIELD) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnEnemy(); spawnTimer = 1200; }
  }

  player.update(dt);
  for (const e of enemies) e.update(dt);
  for (const b of bullets) b.update(dt);
  bullets = bullets.filter(b => b.alive);
  enemies = enemies.filter(e => e.alive);

  // 粒子
  for (const p of particles) {
    p.t += dt;
    if (p.type === 'spark') { p.x += p.vx; p.y += p.vy; }
  }
  particles = particles.filter(p => p.t < p.dur);

  // 道具拾取
  for (const p of powerups) {
    p.ttl -= dt;
    if (player.alive && rectsOverlap(p, player.rect)) { applyPowerup(p); p.ttl = 0; }
  }
  powerups = powerups.filter(p => p.ttl > 0);

  // 玩家死亡
  if (player && !player.alive && baseAlive) {
    lives--;
    if (lives > 0) respawnPlayer();
    else gameOver();
  }

  // 过关判定
  if (baseAlive && !spawnQueue.length && enemies.length === 0 && state === 'playing') {
    levelCleared();
  }

  updateHUD();
}

function updateHUD() {
  hud.level.textContent = level;
  hud.score.textContent = score;
  hud.lives.textContent = lives;
  hud.enemiesLeft.textContent = spawnQueue.length + enemies.filter(e => e.alive).length;
}

/* ---------------- 渲染 ---------------- */
function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  drawMap();
  for (const p of powerups) drawPowerup(p);
  for (const e of enemies) drawTank(e);
  if (player && (player.alive || state !== 'gameover')) drawTank(player);
  for (const b of bullets) drawBullet(b);
  drawParticles();
  drawTrees(); // 树林画在最上层，可以藏身
}

function drawMap() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = tileAt(c, r);
      const x = c * TILE, y = r * TILE;
      if (t === T_BRICK) drawBrickTile(c, r, x, y);
      else if (t === T_STEEL) drawSteel(x, y);
      else if (t === T_WATER) drawWater(x, y);
      else if (t === T_BASE) drawBase(x, y, baseAlive);
    }
  }
}

function drawBrickTile(c, r, x, y) {
  const mask = brickQuads(c, r);
  const q = TILE / 2;
  const quads = [
    { bit: 1, qx: 0, qy: 0 }, { bit: 2, qx: q, qy: 0 },
    { bit: 4, qx: 0, qy: q }, { bit: 8, qx: q, qy: q }
  ];
  ctx.fillStyle = '#b3502e';
  for (const it of quads) {
    if (!(mask & it.bit)) continue;
    ctx.fillRect(x + it.qx, y + it.qy, q, q);
    // 砖缝
    ctx.fillStyle = '#7a3018';
    ctx.fillRect(x + it.qx, y + it.qy + q / 2 - 1, q, 2);
    ctx.fillRect(x + it.qx + q / 2 - 1, y + it.qy, 2, q / 2);
    ctx.fillStyle = '#b3502e';
  }
}

function drawSteel(x, y) {
  ctx.fillStyle = '#b8c0c8';
  ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  ctx.fillStyle = '#e8eef4';
  ctx.fillRect(x + 4, y + 4, TILE - 12, TILE - 12);
  ctx.fillStyle = '#788088';
  ctx.fillRect(x + 4, y + 4, 3, 3);
  ctx.fillRect(x + TILE - 7, y + 4, 3, 3);
  ctx.fillRect(x + 4, y + TILE - 7, 3, 3);
  ctx.fillRect(x + TILE - 7, y + TILE - 7, 3, 3);
}

function drawWater(x, y) {
  const phase = Math.floor(animFrame / 400) % 2;
  ctx.fillStyle = '#2040c0';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#4a78e8';
  for (let i = 0; i < 3; i++) {
    const wy = y + 6 + i * 10;
    const wx = x + ((phase ? 4 : 0) + i * 6) % 12;
    ctx.fillRect(x + 2 + (wx % 8), wy, 12, 2);
    ctx.fillRect(x + 18 - (wx % 6), wy + 4, 10, 2);
  }
}

function drawBase(x, y, alive) {
  ctx.fillStyle = alive ? '#d8b840' : '#606060';
  // 简化鹰形
  ctx.fillRect(x + 12, y + 4, 8, 8);
  ctx.fillRect(x + 8, y + 12, 16, 8);
  ctx.fillRect(x + 12, y + 20, 8, 8);
  ctx.fillRect(x + 6, y + 26, 20, 4);
  if (!alive) {
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(x + 6, y + 6, 8, 8);
    ctx.fillRect(x + 18, y + 14, 8, 10);
  }
}

function drawTrees(x, y) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (tileAt(c, r) !== T_TREE) continue;
      const px = c * TILE, py = r * TILE;
      ctx.fillStyle = 'rgba(20,120,30,0.92)';
      ctx.fillRect(px + 2, py + 2, 12, 12);
      ctx.fillRect(px + 18, py + 2, 12, 12);
      ctx.fillRect(px + 2, py + 18, 12, 12);
      ctx.fillRect(px + 18, py + 18, 12, 12);
      ctx.fillStyle = 'rgba(40,160,50,0.9)';
      ctx.fillRect(px + 6, py + 6, 8, 8);
      ctx.fillRect(px + 20, py + 20, 6, 6);
    }
  }
}

function drawTank(t) {
  const x = t.x, y = t.y, s = t.size;
  if (t.spawnTime > 0) {
    // 出生旋转特效
    const ph = Math.floor(animFrame / 90) % 2;
    ctx.strokeStyle = ph ? '#ffd460' : '#4a78e8';
    ctx.lineWidth = 3;
    const cx = x + s / 2, cy = y + s / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(animFrame / 100);
    ctx.strokeRect(-s / 3, -s / 3, s / 1.5, s / 1.5);
    ctx.restore();
    return;
  }

  let bodyColor, trackColor;
  if (t.isPlayer) {
    bodyColor = ['#e8c832', '#f0d040', '#f8e050', '#ffe860'][t.level];
    trackColor = '#a08018';
  } else {
    bodyColor = t.bonus && Math.floor(animFrame / 120) % 2 ? '#ffffff' : ENEMY_TYPES[t.kind].color;
    trackColor = '#404040';
  }

  const cx = x + s / 2, cy = y + s / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t.dir * Math.PI / 2); // dir 0=上

  // 履带
  ctx.fillStyle = trackColor;
  ctx.fillRect(-s / 2, -s / 2, 7, s);
  ctx.fillRect(s / 2 - 7, -s / 2, 7, s);
  // 履带动画
  ctx.fillStyle = t.isPlayer ? '#604810' : '#222';
  const off = Math.floor(t.trackFrame / 6) % 2;
  for (let i = 0; i < 4; i++) {
    const ty = -s / 2 + 3 + i * 7 + off * 3;
    if (ty < s / 2 - 3) {
      ctx.fillRect(-s / 2 + 1, ty, 5, 2);
      ctx.fillRect(s / 2 - 6, ty, 5, 2);
    }
  }

  // 车身
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-s / 2 + 7, -s / 2 + 3, s - 14, s - 6);
  // 炮塔
  ctx.fillStyle = t.isPlayer ? '#c8a020' : shade(bodyColor, -30);
  ctx.fillRect(-5, -5, 10, 10);
  // 炮管
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-2, -s / 2 - 2, 4, s / 2 + 2);

  ctx.restore();

  // 护盾
  if (t.shieldTime > 0) {
    ctx.strokeStyle = Math.floor(animFrame / 100) % 2 ? '#4ad8ff' : '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 2, y - 2, s + 4, s + 4);
  }
  // 装甲车血量
  if (!t.isPlayer && t.kind === 3 && t.hp < 4) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 4, y - 5, 20, 3);
    ctx.fillStyle = '#e04040';
    ctx.fillRect(x + 4, y - 5, 20 * (t.hp / 4), 3);
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

function drawBullet(b) {
  ctx.fillStyle = b.owner && b.owner.isPlayer ? '#ffe860' : '#e8e8e8';
  ctx.fillRect(b.x, b.y, BULLET_SIZE, BULLET_SIZE);
}

function drawPowerup(p) {
  if (Math.floor(animFrame / 200) % 2 && p.ttl < 3000) return; // 快消失时闪烁
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.strokeStyle = '#ffd460';
  ctx.lineWidth = 2;
  ctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd460';
  const icon = p.type === 'star' ? '★' : p.type === 'shield' ? '⛨' : '♥';
  ctx.fillText(icon, p.x + p.w / 2, p.y + p.h / 2 + 1);
}

function drawParticles() {
  for (const p of particles) {
    const k = p.t / p.dur;
    if (p.type === 'boom') {
      const r = p.size * (0.4 + k);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = k < 0.4 ? '#ffe860' : '#e86020';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = '#ffb040';
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      ctx.globalAlpha = 1;
    }
  }
}

/* ---------------- 启动 ---------------- */
loadLevel(1); // 标题界面背后显示地图
player = null;
enemies = [];
bullets = [];
particles = [];
powerups = [];
spawnQueue = [];
requestAnimationFrame(loop);
