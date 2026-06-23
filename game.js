/* ============================================================
   Mole Mayhem — a turn-based artillery game (a "Worms"-style
   game starring moles). Pure vanilla JS + Canvas, no deps.
   ============================================================ */

(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // ---------- DOM refs ----------
  const ui = {
    overlay: document.getElementById("overlay"),
    startBtn: document.getElementById("start-btn"),
    moleCount: document.getElementById("molecount"),
    teamName: document.getElementById("team-name"),
    timer: document.getElementById("timer"),
    windVal: document.getElementById("wind-val"),
    weaponName: document.getElementById("weapon-name"),
    powerBar: document.getElementById("power-bar"),
    powerFill: document.getElementById("power-fill"),
    tray: document.getElementById("weapon-tray"),
  };

  // ---------- Constants ----------
  const GRAVITY = 0.32;
  const MOLE_R = 11;           // mole body radius (for collision)
  const MAX_HP = 100;
  const TURN_SECONDS = 30;
  const WALK_SPEED = 1.5;
  const JUMP_VY = -6.2;
  const FALL_DAMAGE_THRESHOLD = 8.5; // vy above which falling hurts
  const RETREAT_SECONDS = 4;   // time to move after firing

  const TEAMS = [
    { name: "Diggers", color: "#e74c3c", dark: "#a02418" },
    { name: "Tunnelers", color: "#3498db", dark: "#1d5a8a" },
  ];

  // ---------- Weapons ----------
  const WEAPONS = [
    { id: "bazooka", name: "Bazooka", icon: "🚀", windAffected: true,
      type: "projectile", radius: 34, damage: 48, fuse: 0 },
    { id: "grenade", name: "Grenade", icon: "💣", windAffected: false,
      type: "grenade", radius: 38, damage: 55, fuse: 3.0, bounce: 0.55 },
    { id: "dynamite", name: "Dynamite", icon: "🧨", windAffected: false,
      type: "dynamite", radius: 46, damage: 70, fuse: 2.4 },
    { id: "cluster", name: "Cluster", icon: "✴️", windAffected: true,
      type: "cluster", radius: 26, damage: 30, fuse: 2.5, shards: 5 },
  ];

  // ============================================================
  //  Audio — tiny Web Audio synth (no asset files)
  // ============================================================
  const audio = (() => {
    let ctx = null, master = null, muted = false;
    let chargeOsc = null, chargeGain = null;

    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = 0.4;
          master.connect(ctx.destination);
        } catch (e) { ctx = null; }
      }
      // Browsers (esp. mobile) start the context suspended until a gesture.
      if (ctx && ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    function tone(freq, dur, type, vol, slideTo) {
      if (muted || !ensure()) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.03);
    }

    function noise(dur, vol, filterFreq, type) {
      if (muted || !ensure()) return;
      const t = ctx.currentTime;
      const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = type || "lowpass"; f.frequency.value = filterFreq || 800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol || 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur);
    }

    return {
      ensure,
      setMuted(v) { muted = v; if (v) this.chargeStop(); },
      isMuted() { return muted; },
      shoot() { tone(440, 0.18, "sawtooth", 0.22, 130); noise(0.14, 0.16, 1400); },
      explosion(size) {
        const s = Math.min(2, size / 36);
        noise(0.55 * s, 0.8, 600);
        tone(110, 0.5 * s, "sine", 0.55, 38);
        tone(70, 0.45 * s, "triangle", 0.4, 30);
      },
      bounce() { tone(320, 0.07, "square", 0.1, 200); },
      jump() { tone(260, 0.14, "sine", 0.16, 540); },
      hit() { tone(180, 0.16, "square", 0.18, 80); noise(0.12, 0.2, 1000); },
      win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.32, "triangle", 0.3), i * 150)); },
      chargeStart() {
        if (muted || !ensure()) return;
        this.chargeStop();
        chargeOsc = ctx.createOscillator();
        chargeGain = ctx.createGain();
        chargeOsc.type = "sawtooth";
        chargeOsc.frequency.value = 180;
        chargeGain.gain.value = 0.0001;
        chargeGain.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.05);
        chargeOsc.connect(chargeGain); chargeGain.connect(master);
        chargeOsc.start();
      },
      chargeUpdate(power) {
        if (chargeOsc && ctx) chargeOsc.frequency.setTargetAtTime(180 + power * 720, ctx.currentTime, 0.04);
      },
      chargeStop() {
        if (chargeOsc && ctx) {
          const o = chargeOsc, g = chargeGain;
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
          o.stop(ctx.currentTime + 0.09);
        }
        chargeOsc = null; chargeGain = null;
      },
    };
  })();

  // ============================================================
  //  Terrain  — per-pixel destructible mask + offscreen canvas
  // ============================================================
  const terrainCanvas = document.createElement("canvas");
  terrainCanvas.width = W;
  terrainCanvas.height = H;
  const terrainCtx = terrainCanvas.getContext("2d");
  let mask = new Uint8Array(W * H); // 1 = solid

  function solidAt(x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    return mask[y * W + x] === 1;
  }

  function generateTerrain() {
    mask = new Uint8Array(W * H);

    // Build a rolling hill profile using layered sine waves.
    const base = H * 0.62;
    const profile = new Float32Array(W);
    const octaves = [
      { amp: 70, len: 520, phase: Math.random() * 7 },
      { amp: 34, len: 230, phase: Math.random() * 7 },
      { amp: 16, len: 90,  phase: Math.random() * 7 },
    ];
    for (let x = 0; x < W; x++) {
      let y = base;
      for (const o of octaves) {
        y -= Math.sin((x / o.len) * Math.PI * 2 + o.phase) * o.amp;
      }
      profile[x] = y;
    }

    // Paint terrain into offscreen canvas with a grassy top + dirt body.
    terrainCtx.clearRect(0, 0, W, H);
    for (let x = 0; x < W; x++) {
      const top = Math.max(20, Math.min(H - 10, profile[x] | 0));
      for (let y = top; y < H; y++) {
        mask[y * W + x] = 1;
      }
    }

    // Per-pixel texture: layered grass cap over noisy dirt with rock specks.
    const img = terrainCtx.createImageData(W, H);
    const data = img.data;
    for (let x = 0; x < W; x++) {
      const top = Math.max(20, Math.min(H - 10, profile[x] | 0));
      for (let y = top; y < H; y++) {
        const i = (y * W + x) * 4;
        const depth = y - top;
        let r, g, b;
        if (depth < 5) {              // bright grass
          r = 104; g = 178; b = 66;
        } else if (depth < 9) {       // grass blend
          r = 74; g = 132; b = 48;
        } else if (depth < 13) {      // soil just under grass
          r = 110; g = 78; b = 46;
        } else {
          // Dirt with multi-frequency noise so it isn't flat.
          const n = (Math.sin(x * 0.25 + y * 0.13) + Math.cos(y * 0.31 - x * 0.05)) * 9;
          const deepen = Math.min(34, depth * 0.08);
          r = 96 + n - deepen; g = 66 + n - deepen; b = 40 + n - deepen;
          // Occasional rock/pebble speck.
          const speck = Math.sin(x * 1.7) * Math.cos(y * 1.3);
          if (speck > 0.93) { r += 28; g += 26; b += 22; }
          else if (speck < -0.95) { r -= 18; g -= 14; b -= 10; }
        }
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    terrainCtx.putImageData(img, 0, 0);

    // Grass blades along the surface for a tufted edge.
    terrainCtx.strokeStyle = "rgba(120,196,74,0.9)";
    terrainCtx.lineWidth = 1;
    for (let x = 2; x < W; x += 3) {
      const top = Math.max(20, Math.min(H - 10, profile[x] | 0));
      if (top >= H - 10) continue;
      const h = 2 + ((x * 7) % 4);
      const lean = ((x * 13) % 3) - 1;
      terrainCtx.beginPath();
      terrainCtx.moveTo(x + 0.5, top + 1);
      terrainCtx.lineTo(x + 0.5 + lean, top - h);
      terrainCtx.stroke();
    }
  }

  // Carve a circular crater out of the terrain (explosion).
  function carve(cx, cy, r) {
    cx |= 0; cy |= 0;
    const r2 = r * r;
    const x0 = Math.max(0, cx - r), x1 = Math.min(W - 1, cx + r);
    const y0 = Math.max(0, cy - r), y1 = Math.min(H - 1, cy + r);
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) mask[y * W + x] = 0;
      }
    }
    // Clear the same circle in the offscreen visual.
    terrainCtx.save();
    terrainCtx.globalCompositeOperation = "destination-out";
    terrainCtx.beginPath();
    terrainCtx.arc(cx, cy, r, 0, Math.PI * 2);
    terrainCtx.fill();
    terrainCtx.restore();
    // Scorch ring.
    terrainCtx.save();
    terrainCtx.globalCompositeOperation = "source-atop";
    const rg = terrainCtx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r + 6);
    rg.addColorStop(0, "rgba(20,12,6,0)");
    rg.addColorStop(0.8, "rgba(20,12,6,0.55)");
    rg.addColorStop(1, "rgba(20,12,6,0)");
    terrainCtx.fillStyle = rg;
    terrainCtx.beginPath();
    terrainCtx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    terrainCtx.fill();
    terrainCtx.restore();
  }

  // ============================================================
  //  Game state
  // ============================================================
  const game = {
    moles: [],
    teamTurn: 0,
    activeIndex: [0, 0],   // which mole is active per team
    state: "menu",         // menu | aiming | retreat | firing | settle | gameover
    wind: 0,
    timeLeft: TURN_SECONDS,
    weaponIdx: 0,
    aimAngle: -Math.PI / 4, // up-right
    charging: false,
    power: 0,
    projectiles: [],
    particles: [],
    shockwaves: [],   // expanding rings from explosions
    screenFlash: 0,   // white flash intensity (0..1) after a blast
    lastTs: 0,
    timerAcc: 0,
    settleAcc: 0,
    cameraShake: 0,
    winner: null,
    time: 0,          // accumulated seconds (for animations)
  };

  const keys = Object.create(null);

  function activeMole() {
    const team = game.teamTurn;
    const list = teamMoles(team);
    if (!list.length) return null;
    return list[game.activeIndex[team] % list.length];
  }
  function teamMoles(team) {
    return game.moles.filter((m) => m.team === team && m.hp > 0);
  }

  // ============================================================
  //  Setup
  // ============================================================
  function startGame() {
    generateTerrain();
    game.moles = [];
    const perTeam = parseInt(ui.moleCount.value, 10) || 3;

    // Place moles at valid ground positions, spread across the map.
    const slots = perTeam * 2;
    const positions = [];
    for (let i = 0; i < slots; i++) {
      const frac = (i + 0.5) / slots;
      const x = Math.floor(40 + frac * (W - 80));
      positions.push(x);
    }
    // Interleave teams so they aren't all clustered.
    let idx = 0;
    for (let i = 0; i < perTeam; i++) {
      for (let t = 0; t < 2; t++) {
        const x = positions[idx++];
        const y = surfaceY(x) - MOLE_R - 1;
        game.moles.push(makeMole(t, x, y, i + 1));
      }
    }

    game.teamTurn = 0;
    game.activeIndex = [0, 0];
    game.weaponIdx = 0;
    game.projectiles = [];
    game.particles = [];
    game.shockwaves = [];
    game.screenFlash = 0;
    game.winner = null;
    ui.overlay.classList.add("hidden");
    buildTray();
    beginTurn(true);
    audio.ensure();   // unlock audio within the start-click gesture
    startLoop();
  }

  function makeMole(team, x, y, num) {
    return {
      team, x, y, vx: 0, vy: 0,
      hp: MAX_HP, facing: team === 0 ? 1 : -1,
      onGround: false, num,
      name: TEAMS[team].name + " #" + num,
      flash: 0,
    };
  }

  // Find the surface (topmost solid) at column x.
  function surfaceY(x) {
    x = Math.max(0, Math.min(W - 1, x | 0));
    for (let y = 0; y < H; y++) {
      if (mask[y * W + x] === 1) return y;
    }
    return H - 1;
  }

  // ============================================================
  //  Turn management
  // ============================================================
  function beginTurn(first) {
    // Advance to next team (unless first turn).
    if (!first) game.teamTurn = 1 - game.teamTurn;

    // Check win condition.
    const a = teamMoles(0).length, b = teamMoles(1).length;
    if (a === 0 || b === 0) {
      game.state = "gameover";
      game.winner = a === 0 && b === 0 ? -1 : (a === 0 ? 1 : 0);
      showGameOver();
      return;
    }

    // Skip empty team (shouldn't happen given win check, but safe).
    if (teamMoles(game.teamTurn).length === 0) game.teamTurn = 1 - game.teamTurn;

    // Rotate active mole within the team.
    const list = teamMoles(game.teamTurn);
    game.activeIndex[game.teamTurn] =
      (game.activeIndex[game.teamTurn] + (first ? 0 : 1)) % list.length;

    // Random wind for the turn: -1 .. 1
    game.wind = +(Math.random() * 2 - 1).toFixed(2);
    game.timeLeft = TURN_SECONDS;
    game.timerAcc = 0;
    game.charging = false;
    game.power = 0;
    game.state = "aiming";
    const m = activeMole();
    if (m) game.aimAngle = m.facing === 1 ? -Math.PI / 4 : -Math.PI * 3 / 4;
    updateHud();
  }

  function endTurnSoon() {
    // Give the player a short retreat window after firing.
    game.state = "retreat";
    game.timeLeft = RETREAT_SECONDS;
    game.timerAcc = 0;
  }

  function settleThenNextTurn() {
    game.state = "settle";
    game.settleAcc = 0;
  }

  // ============================================================
  //  Firing
  // ============================================================
  function fire() {
    const m = activeMole();
    if (!m) return;
    const wpn = WEAPONS[game.weaponIdx];
    const speed = 4 + game.power * 13;
    const ang = game.aimAngle;
    const muzzle = MOLE_R + 6;
    const px = m.x + Math.cos(ang) * muzzle;
    const py = m.y + Math.sin(ang) * muzzle;
    const proj = {
      x: px, y: py,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      wpn,
      fuse: wpn.fuse,
      owner: m,
      trail: [],
    };
    game.projectiles.push(proj);
    game.charging = false;
    game.power = 0;
    ui.powerBar.classList.remove("active");
    audio.chargeStop();
    audio.shoot();
    // Muzzle flash + smoke puff.
    spawnMuzzle(px, py, ang);
    endTurnSoon();
  }

  function spawnMuzzle(x, y, ang) {
    for (let i = 0; i < 8; i++) {
      const a = ang + (Math.random() - 0.5) * 0.8;
      const sp = 1.5 + Math.random() * 3;
      game.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.18 + Math.random() * 0.18, max: 0.36,
        r: 1.5 + Math.random() * 2.5, kind: "fire",
      });
    }
  }

  function explode(x, y, wpn) {
    carve(x, y, wpn.radius);
    game.cameraShake = Math.min(22, wpn.radius * 0.5);
    spawnExplosionParticles(x, y, wpn.radius);
    // Visual punch: an expanding shockwave ring + a brief screen flash.
    game.shockwaves.push({ x, y, r: wpn.radius * 0.3, max: wpn.radius * 1.9, life: 1, max_life: 0.45 });
    game.screenFlash = Math.min(0.9, game.screenFlash + wpn.radius / 70);
    audio.explosion(wpn.radius);

    // Damage + knockback to moles in radius.
    let anyHit = false;
    for (const m of game.moles) {
      if (m.hp <= 0) continue;
      const dx = m.x - x, dy = m.y - y;
      const dist = Math.hypot(dx, dy);
      const reach = wpn.radius + MOLE_R;
      if (dist < reach) {
        const falloff = 1 - dist / reach;
        const dmg = Math.round(wpn.damage * falloff);
        if (dmg > 0) anyHit = true;
        m.hp = Math.max(0, m.hp - dmg);
        m.flash = 0.4;
        const force = (wpn.radius / 30) * (0.6 + falloff) * 6;
        const nd = dist || 1;
        m.vx += (dx / nd) * force;
        m.vy += (dy / nd) * force - 2.2;
        m.onGround = false;
      }
    }
    if (anyHit) audio.hit();
  }

  // ============================================================
  //  Particles
  // ============================================================
  function spawnExplosionParticles(x, y, r) {
    // Fireball: fast outward fire particles.
    const fire = Math.floor(r * 1.3);
    for (let i = 0; i < fire; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * (r * 0.22);
      game.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.2,
        life: 0.35 + Math.random() * 0.5, max: 0.85,
        r: 2 + Math.random() * 3.5, kind: "fire",
      });
    }
    // Smoke: slower, rising, longer-lived.
    const smoke = Math.floor(r * 0.7);
    for (let i = 0; i < smoke; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * (r * 0.08);
      game.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.6,
        life: 0.8 + Math.random() * 0.9, max: 1.7,
        r: 3 + Math.random() * 4, kind: "smoke",
      });
    }
    // Debris dirt clods flung out.
    const debris = Math.floor(r * 0.4);
    for (let i = 0; i < debris; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 2 + Math.random() * (r * 0.12);
      game.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.5, max: 1.0,
        r: 1.5 + Math.random() * 2.5, kind: "dirt",
      });
    }
  }
  function spawnDirt(x, y) {
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const sp = 1 + Math.random() * 3;
      game.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.3, max: 0.7, r: 1 + Math.random() * 2,
        kind: "dirt",
      });
    }
  }

  // ============================================================
  //  Physics helpers
  // ============================================================
  // Push a circle up out of terrain; returns true if grounded.
  function resolveGround(o, radius) {
    // If the point below body is solid, we are on ground.
    let grounded = false;
    // Move up until not embedded (cap iterations).
    let safety = 0;
    while (solidAt(o.x, o.y + radius) && safety < radius + 4) {
      o.y -= 1;
      grounded = true;
      safety++;
    }
    return grounded;
  }

  function stepMolePhysics(m, dt) {
    // Gravity
    m.vy += GRAVITY;
    let nx = m.x + m.vx;
    let ny = m.y + m.vy;

    // Horizontal collision (walls / steep slopes): try to step up.
    if (solidAt(nx, ny + 0)) {
      // try stepping up to climb slopes
      let climbed = false;
      for (let step = 1; step <= 6; step++) {
        if (!solidAt(nx, ny - step)) {
          ny -= step; climbed = true; break;
        }
      }
      if (!climbed) { nx = m.x; m.vx = 0; }
    }

    m.x = Math.max(MOLE_R, Math.min(W - MOLE_R, nx));
    m.y = ny;

    // Vertical / ground resolution.
    const wasFalling = m.vy;
    if (solidAt(m.x, m.y + MOLE_R)) {
      // Land.
      const grounded = resolveGround(m, MOLE_R);
      if (grounded) {
        if (wasFalling > FALL_DAMAGE_THRESHOLD) {
          const dmg = Math.round((wasFalling - FALL_DAMAGE_THRESHOLD) * 4);
          if (dmg > 0) { m.hp = Math.max(0, m.hp - dmg); m.flash = 0.4; }
        }
        m.vy = 0;
        m.vx *= 0.6; // friction on landing
        if (Math.abs(m.vx) < 0.05) m.vx = 0;
        m.onGround = true;
      }
    } else {
      m.onGround = false;
    }

    // Fell out of the world.
    if (m.y > H + 40) { m.hp = 0; m.flash = 0; }
  }

  function stepProjectile(p, dt) {
    if (p.wpn.windAffected) p.vx += game.wind * 0.05;
    p.vy += GRAVITY;
    // Move in small sub-steps for accurate terrain hits.
    const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy) / 4));
    for (let s = 0; s < steps; s++) {
      p.x += p.vx / steps;
      p.y += p.vy / steps;

      // Off-sides: bazooka/cluster die at world edges horizontally? Keep flying but cull if far below.
      if (p.y > H + 60) { detonate(p); return; }

      const hit = solidAt(p.x, p.y);
      if (hit) {
        if (p.wpn.type === "grenade") {
          bounce(p);
          break;
        } else {
          detonate(p);
          return;
        }
      }
      // Direct mole impact for projectile-types (bazooka, cluster shards).
      if (p.wpn.type === "projectile" || p.wpn.type === "cluster" || p.wpn.type === "shard") {
        for (const m of game.moles) {
          if (m.hp <= 0 || m === p.owner && p.justFired) continue;
          if (Math.hypot(m.x - p.x, m.y - p.y) < MOLE_R) {
            detonate(p);
            return;
          }
        }
      }
    }

    // Record trail.
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 14) p.trail.shift();

    // Fuse countdown for timed weapons.
    if (p.wpn.fuse > 0) {
      p.fuse -= dt;
      if (p.fuse <= 0) { detonate(p); }
    }
  }

  function bounce(p) {
    // Reflect velocity off terrain by sampling a normal.
    const n = terrainNormal(p.x, p.y);
    const dot = p.vx * n.x + p.vy * n.y;
    p.vx = (p.vx - 2 * dot * n.x) * p.wpn.bounce;
    p.vy = (p.vy - 2 * dot * n.y) * p.wpn.bounce;
    // Nudge out of the ground.
    p.x += n.x * 2;
    p.y += n.y * 2;
    spawnDirt(p.x, p.y);
    audio.bounce();
  }

  // Approximate surface normal by sampling solidity around a point.
  function terrainNormal(x, y) {
    let nx = 0, ny = 0;
    const R = 4;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const sx = x + Math.cos(a) * R;
      const sy = y + Math.sin(a) * R;
      if (solidAt(sx, sy)) { nx -= Math.cos(a); ny -= Math.sin(a); }
    }
    const len = Math.hypot(nx, ny) || 1;
    return { x: nx / len, y: ny / len };
  }

  function detonate(p) {
    explode(p.x, p.y, p.wpn);
    // Cluster spawns shards.
    if (p.wpn.type === "cluster" && p.wpn.shards) {
      for (let i = 0; i < p.wpn.shards; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.0;
        const sp = 3 + Math.random() * 3;
        game.projectiles.push({
          x: p.x, y: p.y - 4,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          wpn: { type: "shard", windAffected: false, radius: 18, damage: 22, fuse: 0 },
          fuse: 0, owner: p.owner, trail: [],
        });
      }
    }
    // Remove this projectile.
    const i = game.projectiles.indexOf(p);
    if (i >= 0) game.projectiles.splice(i, 1);
  }

  // ============================================================
  //  Main loop
  // ============================================================
  let loopRunning = false;
  function loop(ts) {
    // Reschedule FIRST so a single bad frame can never freeze the screen.
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - game.lastTs) / 1000);
    game.lastTs = ts;
    try {
      update(dt);
      render();
    } catch (err) {
      if (!loop._warned) { console.error("Frame error (loop continues):", err); loop._warned = true; }
    }
  }
  function startLoop() {
    if (loopRunning) return;
    loopRunning = true;
    game.lastTs = performance.now();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    game.time += dt;
    // Decay camera shake, screen flash & hit-flashes.
    if (game.cameraShake > 0) game.cameraShake = Math.max(0, game.cameraShake - dt * 30);
    if (game.screenFlash > 0) game.screenFlash = Math.max(0, game.screenFlash - dt * 3.2);
    for (const m of game.moles) if (m.flash > 0) m.flash = Math.max(0, m.flash - dt);

    // Expand & fade shockwave rings.
    for (let i = game.shockwaves.length - 1; i >= 0; i--) {
      const s = game.shockwaves[i];
      s.life -= dt / s.max_life;
      s.r += (s.max - s.r) * Math.min(1, dt * 9);
      if (s.life <= 0) game.shockwaves.splice(i, 1);
    }

    // Player input (only during aiming/retreat with active mole).
    if (game.state === "aiming" || game.state === "retreat") {
      handleActiveInput(dt);
    }

    // Timer.
    if (game.state === "aiming" || game.state === "retreat") {
      game.timerAcc += dt;
      if (game.timerAcc >= 1) {
        game.timerAcc -= 1;
        game.timeLeft--;
        updateHud();
        if (game.timeLeft <= 0) {
          if (game.state === "aiming") {
            // Time up without firing → next turn.
            settleThenNextTurn();
          } else {
            settleThenNextTurn();
          }
        }
      }
    }

    // Charging power.
    if (game.charging) {
      game.power = Math.min(1, game.power + dt * 0.85);
      ui.powerFill.style.width = (game.power * 100) + "%";
      audio.chargeUpdate(game.power);
      if (game.power >= 1) fire();
    }

    // Step all moles physics.
    for (const m of game.moles) {
      if (m.hp <= 0) continue;
      stepMolePhysics(m, dt);
    }

    // Step projectiles.
    for (let i = game.projectiles.length - 1; i >= 0; i--) {
      const p = game.projectiles[i];
      p.justFired = false;
      stepProjectile(p, dt);
    }

    // Step particles.
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const pt = game.particles[i];
      pt.vy += GRAVITY * 0.4;
      pt.x += pt.vx; pt.y += pt.vy;
      pt.life -= dt;
      if (pt.life <= 0) game.particles.splice(i, 1);
    }

    // Settle state: wait for projectiles & motion to stop, then next turn.
    if (game.state === "settle") {
      game.settleAcc += dt;
      const moving = game.projectiles.length > 0 ||
        game.moles.some((m) => m.hp > 0 && (Math.abs(m.vx) > 0.3 || Math.abs(m.vy) > 0.3 || !m.onGround));
      if (!moving && game.settleAcc > 0.6) {
        beginTurn(false);
      } else if (game.settleAcc > 8) {
        // Safety timeout.
        beginTurn(false);
      }
    }

    // If active mole died mid-turn (e.g., fell), move on.
    if ((game.state === "aiming" || game.state === "retreat") && !activeMole()) {
      settleThenNextTurn();
    }
  }

  function handleActiveInput(dt) {
    const m = activeMole();
    if (!m || !m.onGround && game.state === "aiming") {
      // allow aiming even airborne, but no walking
    }
    if (!m) return;

    // Aiming.
    if (keys["ArrowUp"]) game.aimAngle -= 1.8 * dt;
    if (keys["ArrowDown"]) game.aimAngle += 1.8 * dt;

    // Walking (only when on ground).
    let moved = false;
    if (keys["ArrowLeft"]) {
      m.facing = -1;
      if (m.onGround) { tryWalk(m, -WALK_SPEED); moved = true; }
    }
    if (keys["ArrowRight"]) {
      m.facing = 1;
      if (m.onGround) { tryWalk(m, WALK_SPEED); moved = true; }
    }
    // Mirror aim with facing when idle-ish: clamp angle to a sane range.
    game.aimAngle = Math.max(-Math.PI + 0.2, Math.min(-0.05 - 0, clampAim(game.aimAngle)));
  }

  function clampAim(a) {
    // Keep within upper hemisphere-ish (-PI..0).
    if (a < -Math.PI) a = -Math.PI;
    if (a > -0.02) a = -0.02;
    return a;
  }

  function tryWalk(m, dx) {
    const targetX = m.x + dx;
    // Step over small bumps: scan a few heights.
    for (let up = 0; up <= 7; up++) {
      if (!solidAt(targetX, m.y + MOLE_R - 1 - up) && !solidAt(targetX, m.y - up)) {
        // Is there ground below within a small drop?
        m.x = Math.max(MOLE_R, Math.min(W - MOLE_R, targetX));
        if (up > 0) m.y -= up;
        // settle down onto ground
        let drop = 0;
        while (!solidAt(m.x, m.y + MOLE_R) && drop < 8) { m.y += 1; drop++; }
        return;
      }
    }
    // Blocked by a wall.
  }

  function jump() {
    const m = activeMole();
    if (!m || !m.onGround) return;
    if (game.state !== "aiming" && game.state !== "retreat") return;
    m.vy = JUMP_VY;
    m.vx = m.facing * 2.6;
    m.onGround = false;
    audio.jump();
  }

  // ============================================================
  //  Rendering
  // ============================================================
  // Cached sky gradient (rebuilt lazily).
  let skyGrad = null;
  function getSky() {
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, "#0e2a52");
      skyGrad.addColorStop(0.45, "#2f6aa6");
      skyGrad.addColorStop(0.8, "#6aa6cf");
      skyGrad.addColorStop(1, "#bfe0e8");
    }
    return skyGrad;
  }

  function render() {
    // ---- Clear & paint the sky EVERY frame (this is the refresh fix) ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getSky();
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    // Camera shake.
    if (game.cameraShake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * game.cameraShake,
        (Math.random() - 0.5) * game.cameraShake
      );
    }

    // Sun, parallax hills, clouds.
    drawBackground();

    // Terrain.
    ctx.drawImage(terrainCanvas, 0, 0);

    // Moles.
    for (const m of game.moles) {
      if (m.hp <= 0) continue;
      drawMole(m);
    }

    // Aiming reticle for active mole.
    if (game.state === "aiming" || game.state === "retreat") {
      drawAim();
    }

    // Projectiles.
    for (const p of game.projectiles) drawProjectile(p);

    // Explosion shockwave rings.
    for (const s of game.shockwaves) drawShockwave(s);

    // Particles (fire/smoke/dirt).
    for (const pt of game.particles) drawParticle(pt);

    // Wind streaks indicator near top.
    drawWindArrow();

    ctx.restore();

    // Full-screen white flash on big blasts.
    if (game.screenFlash > 0.01) {
      ctx.fillStyle = `rgba(255,245,220,${game.screenFlash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Subtle vignette for depth.
    drawVignette();
  }

  let vignette = null;
  function drawVignette() {
    if (!vignette) {
      vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.95);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.28)");
    }
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function drawShockwave(s) {
    const a = Math.max(0, s.life);
    ctx.save();
    ctx.strokeStyle = `rgba(255,230,180,${a * 0.6})`;
    ctx.lineWidth = 2 + a * 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBackground() {
    const t = game.time;

    // Sun with a soft glow.
    const sx = W * 0.82, sy = H * 0.2;
    const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 140);
    glow.addColorStop(0, "rgba(255,247,214,0.95)");
    glow.addColorStop(0.25, "rgba(255,240,190,0.45)");
    glow.addColorStop(1, "rgba(255,240,190,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 150, sy - 150, 300, 300);
    ctx.fillStyle = "#fff7d6";
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.fill();

    // Far parallax hill layer.
    ctx.fillStyle = "#3f6f8e";
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) {
      ctx.lineTo(x, H * 0.5 + Math.sin(x * 0.006 + 0.6) * 36 + Math.sin(x * 0.02) * 8);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    // Nearer parallax hill layer.
    ctx.fillStyle = "#356070";
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) {
      ctx.lineTo(x, H * 0.62 + Math.sin(x * 0.009 + 2.2) * 30);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    // Drifting clouds.
    for (let i = 0; i < 4; i++) {
      const speed = 6 + i * 3;
      const cx = ((i * 300 + t * speed) % (W + 200)) - 100;
      const cy = 55 + i * 26;
      drawCloud(cx, cy, 34 + i * 7);
    }
  }
  function drawCloud(x, y, r) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 0.85, y + 6, r * 0.72, 0, Math.PI * 2);
    ctx.arc(x - r * 0.85, y + 8, r * 0.62, 0, Math.PI * 2);
    ctx.arc(x + r * 0.2, y - r * 0.5, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    // Soft shadow underside.
    ctx.fillStyle = "rgba(200,210,225,0.5)";
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.5, r * 1.4, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMole(m) {
    const team = TEAMS[m.team];
    const isActive = m === activeMole() &&
      (game.state === "aiming" || game.state === "retreat");

    // Ground shadow.
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(m.x, m.y + MOLE_R, MOLE_R * 1.0, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(m.x, m.y);

    // Active indicator arrow (bobbing).
    if (isActive) {
      const bob = Math.sin(game.time * 5) * 2;
      ctx.fillStyle = "#ffd23f";
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -MOLE_R - 16 + bob);
      ctx.lineTo(-6, -MOLE_R - 25 + bob);
      ctx.lineTo(6, -MOLE_R - 25 + bob);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    // Body with soft shading (radial gradient), white flash when hit.
    if (m.flash > 0) {
      ctx.fillStyle = "#ffffff";
    } else {
      const bg = ctx.createRadialGradient(-3, -4, 2, 0, 0, MOLE_R + 2);
      bg.addColorStop(0, "#7a6049");
      bg.addColorStop(1, "#4a3829");
      ctx.fillStyle = bg;
    }
    ctx.beginPath();
    ctx.ellipse(0, 0, MOLE_R, MOLE_R + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    // Outline.
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Belly (team color) as an ID patch.
    ctx.fillStyle = m.flash > 0 ? "#ffd5cf" : team.color;
    ctx.beginPath();
    ctx.ellipse(0, 4, MOLE_R * 0.58, MOLE_R * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ears.
    ctx.fillStyle = m.flash > 0 ? "#ffffff" : "#3f3022";
    ctx.beginPath();
    ctx.arc(-MOLE_R * 0.55, -MOLE_R * 0.7, 2.6, 0, Math.PI * 2);
    ctx.arc(MOLE_R * 0.55, -MOLE_R * 0.7, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Snout.
    ctx.fillStyle = "#e2a0b4";
    ctx.beginPath();
    ctx.ellipse(m.facing * (MOLE_R - 2), 2, 5.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Nose tip.
    ctx.fillStyle = "#c1657f";
    ctx.beginPath();
    ctx.arc(m.facing * (MOLE_R + 1.5), 2, 2.2, 0, Math.PI * 2);
    ctx.fill();
    // Whiskers.
    ctx.strokeStyle = "rgba(20,12,8,0.5)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(m.facing * (MOLE_R + 1), 1); ctx.lineTo(m.facing * (MOLE_R + 7), -1);
    ctx.moveTo(m.facing * (MOLE_R + 1), 3); ctx.lineTo(m.facing * (MOLE_R + 7), 4);
    ctx.stroke();

    // Eye (with highlight).
    ctx.fillStyle = "#15100a";
    ctx.beginPath();
    ctx.arc(m.facing * 3.5, -3, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(m.facing * 4.2, -3.7, 0.7, 0, Math.PI * 2);
    ctx.fill();

    // Claws.
    ctx.strokeStyle = "#f0f0f0";
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(m.facing * 4, MOLE_R - 1);
    ctx.lineTo(m.facing * 7.5, MOLE_R + 3);
    ctx.moveTo(m.facing * 1, MOLE_R - 1);
    ctx.lineTo(m.facing * 2, MOLE_R + 4);
    ctx.stroke();

    ctx.restore();

    // Health bar + name above.
    const barW = 30, barH = 4;
    const bx = m.x - barW / 2, by = m.y - MOLE_R - 12;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
    ctx.fillStyle = m.hp > 50 ? "#2ecc71" : m.hp > 25 ? "#f1c40f" : "#e74c3c";
    ctx.fillRect(bx, by, barW * (m.hp / MAX_HP), barH);
    ctx.fillStyle = team.color;
    ctx.font = "9px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(m.hp + "", m.x, by - 4);
  }

  function drawAim() {
    const m = activeMole();
    if (!m) return;
    const len = 34 + game.power * 26;
    const ex = m.x + Math.cos(game.aimAngle) * len;
    const ey = m.y + Math.sin(game.aimAngle) * len;

    // Dotted aim line.
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    // Crosshair.
    ctx.strokeStyle = "#f1c40f";
    ctx.beginPath();
    ctx.arc(ex, ey, 5, 0, Math.PI * 2);
    ctx.moveTo(ex - 8, ey); ctx.lineTo(ex + 8, ey);
    ctx.moveTo(ex, ey - 8); ctx.lineTo(ex, ey + 8);
    ctx.stroke();
    ctx.restore();
  }

  function drawProjectile(p) {
    // Trail.
    ctx.save();
    for (let i = 0; i < p.trail.length; i++) {
      const t = p.trail[i];
      const a = i / p.trail.length;
      ctx.fillStyle = `rgba(255,180,80,${a * 0.5})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 2 * a + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Body.
    let color = "#333";
    if (p.wpn.type === "grenade") color = "#33491f";
    else if (p.wpn.type === "dynamite") color = "#c0392b";
    else if (p.wpn.type === "shard") color = "#888";
    const rad = p.wpn.type === "dynamite" ? 5 : 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Highlight.
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(p.x - rad * 0.35, p.y - rad * 0.35, rad * 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Blinking fuse light for timed weapons.
    if (p.wpn.fuse > 0) {
      const blink = Math.sin(game.time * 26) > 0;
      if (blink) {
        ctx.fillStyle = "#ff5a3c";
        ctx.beginPath();
        ctx.arc(p.x, p.y - rad - 2, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawParticle(pt) {
    const a = Math.max(0, pt.life / pt.max);
    if (pt.kind === "fire") {
      // Hot core fading to orange/red as it dies (additive glow).
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = 120 + (a * 130 | 0);
      ctx.fillStyle = `rgba(255,${g},40,${a})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r * (0.6 + a), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (pt.kind === "smoke") {
      ctx.fillStyle = `rgba(70,68,66,${a * 0.5})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r * (1.4 - a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `rgba(110,75,45,${a})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawWindArrow() {
    const cx = W / 2, cy = 24;
    const mag = Math.abs(game.wind);
    const dir = Math.sign(game.wind) || 1;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    const len = 12 + mag * 60;
    ctx.beginPath();
    ctx.moveTo(cx - dir * len / 2, cy);
    ctx.lineTo(cx + dir * len / 2, cy);
    // Arrow head.
    ctx.lineTo(cx + dir * len / 2 - dir * 6, cy - 4);
    ctx.moveTo(cx + dir * len / 2, cy);
    ctx.lineTo(cx + dir * len / 2 - dir * 6, cy + 4);
    ctx.stroke();
    ctx.restore();
  }

  // ============================================================
  //  HUD / UI
  // ============================================================
  function updateHud() {
    const team = TEAMS[game.teamTurn];
    ui.teamName.textContent = team.name + (game.state === "retreat" ? " — retreat!" : "");
    ui.teamName.style.background = team.dark;
    ui.timer.textContent = Math.max(0, game.timeLeft);
    const w = game.wind;
    const arrow = w > 0.05 ? "→" : w < -0.05 ? "←" : "·";
    ui.windVal.textContent = `${arrow} ${Math.abs(Math.round(w * 100))}`;
    ui.weaponName.textContent = WEAPONS[game.weaponIdx].name;
    updateTray();
  }

  function buildTray() {
    ui.tray.innerHTML = "";
    WEAPONS.forEach((w, i) => {
      const el = document.createElement("div");
      el.className = "wpn";
      el.dataset.idx = i;
      el.innerHTML = `<div class="ico">${w.icon}</div><div>${i + 1}</div>`;
      el.addEventListener("click", () => selectWeapon(i));
      ui.tray.appendChild(el);
    });
    updateTray();
  }
  function updateTray() {
    [...ui.tray.children].forEach((el, i) => {
      el.classList.toggle("selected", i === game.weaponIdx);
    });
  }
  function selectWeapon(i) {
    if (game.state !== "aiming" && game.state !== "retreat") return;
    game.weaponIdx = i;
    updateHud();
  }

  function showGameOver() {
    let msg;
    if (game.winner === -1) msg = "It's a draw — everyone burrowed out!";
    else msg = `${TEAMS[game.winner].name} win the burrow!`;
    if (game.winner !== -1) audio.win();
    ui.overlay.classList.remove("hidden");
    ui.overlay.querySelector(".panel").innerHTML = `
      <h1>${game.winner === -1 ? "Draw!" : "Victory!"}</h1>
      <p class="tagline">${msg}</p>
      <button id="start-btn">Play Again</button>
    `;
    document.getElementById("start-btn").addEventListener("click", startGame);
  }

  // ============================================================
  //  Input handling — shared by keyboard and on-screen touch buttons
  // ============================================================
  function pressKey(code) {
    keys[code] = true;
    audio.ensure();   // unlock/resume audio on first interaction
    if (code === "Space" && game.state === "aiming") {
      if (!game.charging && activeMole()) {
        game.charging = true;
        game.power = 0;
        ui.powerBar.classList.add("active");
        audio.chargeStart();
      }
    }
    if (code === "Enter") jump();
    if (code.startsWith("Digit")) {
      const idx = parseInt(code.slice(5), 10) - 1;
      if (idx >= 0 && idx < WEAPONS.length) selectWeapon(idx);
    }
  }

  function releaseKey(code) {
    keys[code] = false;
    if (code === "Space" && game.charging) fire();
  }

  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    if (e.repeat) return; // OS key-repeat shouldn't re-trigger press logic
    pressKey(e.code);
  });

  window.addEventListener("keyup", (e) => releaseKey(e.code));

  // Wire up the touch / pointer control pads.
  document.querySelectorAll("#touch-controls .tbtn").forEach((btn) => {
    const code = btn.dataset.code;
    const press = (e) => {
      e.preventDefault();
      btn.classList.add("held");
      pressKey(code);
    };
    const release = (e) => {
      e.preventDefault();
      if (!btn.classList.contains("held")) return;
      btn.classList.remove("held");
      releaseKey(code);
    };
    btn.addEventListener("touchstart", press, { passive: false });
    btn.addEventListener("touchend", release, { passive: false });
    btn.addEventListener("touchcancel", release, { passive: false });
    // Mouse fallback so the same buttons work on desktop too.
    btn.addEventListener("mousedown", press);
    btn.addEventListener("mouseup", release);
    btn.addEventListener("mouseleave", release);
  });

  ui.startBtn.addEventListener("click", startGame);

  // Mute toggle.
  const muteBtn = document.getElementById("mute-btn");
  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      const next = !audio.isMuted();
      audio.setMuted(next);
      muteBtn.textContent = next ? "🔇" : "🔊";
      audio.ensure();
    });
  }

  // Lightweight read-only hook for automated testing / debugging.
  window.__moleTest = () => {
    let solid = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) solid++;
    return {
      state: game.state,
      teamTurn: game.teamTurn,
      moles: game.moles.map((m) => ({ team: m.team, hp: m.hp, x: Math.round(m.x), y: Math.round(m.y) })),
      projectiles: game.projectiles.length,
      solidPixels: solid,
      wind: game.wind,
    };
  };

  // Generate an initial landscape for the menu backdrop, then run the
  // single hardened render loop for the whole lifetime of the page.
  generateTerrain();
  startLoop();
})();
