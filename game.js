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

    // Texture: dirt gradient + grass cap.
    const grad = terrainCtx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#6b4a2b");
    grad.addColorStop(0.4, "#5a3d22");
    grad.addColorStop(1, "#3e2a16");
    // Draw dirt where solid by stamping columns.
    const img = terrainCtx.createImageData(W, H);
    const data = img.data;
    for (let x = 0; x < W; x++) {
      const top = Math.max(20, Math.min(H - 10, profile[x] | 0));
      for (let y = top; y < H; y++) {
        const i = (y * W + x) * 4;
        const depth = y - top;
        let r, g, b;
        if (depth < 6) { r = 86; g = 160; b = 58; }        // grass
        else if (depth < 9) { r = 60; g = 110; b = 40; }   // grass shadow
        else {
          // dirt with subtle noise
          const n = (Math.sin(x * 0.3) + Math.cos(y * 0.27)) * 8;
          r = 96 + n; g = 64 + n; b = 38 + n;
        }
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    terrainCtx.putImageData(img, 0, 0);
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
    lastTs: 0,
    timerAcc: 0,
    settleAcc: 0,
    cameraShake: 0,
    winner: null,
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
    game.winner = null;
    ui.overlay.classList.add("hidden");
    buildTray();
    beginTurn(true);
    game.lastTs = performance.now();
    requestAnimationFrame(loop);
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
    endTurnSoon();
  }

  function explode(x, y, wpn) {
    carve(x, y, wpn.radius);
    game.cameraShake = Math.min(18, wpn.radius * 0.4);
    spawnExplosionParticles(x, y, wpn.radius);

    // Damage + knockback to moles in radius.
    for (const m of game.moles) {
      if (m.hp <= 0) continue;
      const dx = m.x - x, dy = m.y - y;
      const dist = Math.hypot(dx, dy);
      const reach = wpn.radius + MOLE_R;
      if (dist < reach) {
        const falloff = 1 - dist / reach;
        const dmg = Math.round(wpn.damage * falloff);
        m.hp = Math.max(0, m.hp - dmg);
        m.flash = 0.4;
        const force = (wpn.radius / 30) * (0.6 + falloff) * 6;
        const nd = dist || 1;
        m.vx += (dx / nd) * force;
        m.vy += (dy / nd) * force - 2.2;
        m.onGround = false;
      }
    }
  }

  // ============================================================
  //  Particles
  // ============================================================
  function spawnExplosionParticles(x, y, r) {
    const n = Math.floor(r * 1.4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * (r * 0.18);
      game.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1,
        life: 0.5 + Math.random() * 0.6,
        max: 1.1,
        r: 1 + Math.random() * 3,
        kind: Math.random() < 0.5 ? "fire" : "smoke",
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
  function loop(ts) {
    const dt = Math.min(0.05, (ts - game.lastTs) / 1000);
    game.lastTs = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    // Decay camera shake & flashes.
    if (game.cameraShake > 0) game.cameraShake = Math.max(0, game.cameraShake - dt * 30);
    for (const m of game.moles) if (m.flash > 0) m.flash = Math.max(0, m.flash - dt);

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
  }

  // ============================================================
  //  Rendering
  // ============================================================
  function render() {
    ctx.save();
    // Camera shake.
    if (game.cameraShake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * game.cameraShake,
        (Math.random() - 0.5) * game.cameraShake
      );
    }

    // Sky already via CSS background; draw distant hills + clouds.
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

    // Particles.
    for (const pt of game.particles) drawParticle(pt);

    // Wind streaks indicator near top.
    drawWindArrow();

    ctx.restore();
  }

  let cloudOffset = 0;
  function drawBackground() {
    cloudOffset += 0.15;
    // Far hills.
    ctx.fillStyle = "rgba(30, 60, 90, 0.5)";
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) {
      ctx.lineTo(x, H * 0.55 + Math.sin(x * 0.01 + 1) * 30);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    // Clouds.
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 280 + cloudOffset) % (W + 160)) - 80;
      const cy = 60 + i * 28;
      drawCloud(cx, cy, 36 + i * 6);
    }
  }
  function drawCloud(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 0.8, y + 6, r * 0.7, 0, Math.PI * 2);
    ctx.arc(x - r * 0.8, y + 8, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMole(m) {
    const team = TEAMS[m.team];
    const isActive = m === activeMole() &&
      (game.state === "aiming" || game.state === "retreat");
    ctx.save();
    ctx.translate(m.x, m.y);

    // Active indicator arrow.
    if (isActive) {
      const bob = Math.sin(performance.now() / 200) * 2;
      ctx.fillStyle = "#f1c40f";
      ctx.beginPath();
      ctx.moveTo(0, -MOLE_R - 18 + bob);
      ctx.lineTo(-6, -MOLE_R - 26 + bob);
      ctx.lineTo(6, -MOLE_R - 26 + bob);
      ctx.closePath();
      ctx.fill();
    }

    // Body (rounded). Flash white when hit.
    const bodyColor = m.flash > 0 ? "#ffffff" : "#5b4636";
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, MOLE_R, MOLE_R + 1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly (team color).
    ctx.fillStyle = m.flash > 0 ? "#ffd5cf" : team.color;
    ctx.beginPath();
    ctx.ellipse(0, 3, MOLE_R * 0.6, MOLE_R * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Snout.
    ctx.fillStyle = "#d98ba0";
    ctx.beginPath();
    ctx.ellipse(m.facing * (MOLE_R - 2), 1, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Nose tip.
    ctx.fillStyle = "#b35c77";
    ctx.beginPath();
    ctx.arc(m.facing * (MOLE_R + 1), 1, 2, 0, Math.PI * 2);
    ctx.fill();

    // Eyes (little dots).
    ctx.fillStyle = "#1a120c";
    ctx.beginPath();
    ctx.arc(m.facing * 3, -3, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Claws.
    ctx.strokeStyle = "#e8e8e8";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(m.facing * 4, MOLE_R - 1);
    ctx.lineTo(m.facing * 7, MOLE_R + 3);
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
    if (p.wpn.type === "grenade") color = "#2c3e1f";
    else if (p.wpn.type === "dynamite") color = "#b03a2e";
    else if (p.wpn.type === "shard") color = "#777";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.wpn.type === "dynamite" ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();

    // Blinking fuse light for timed weapons.
    if (p.wpn.fuse > 0) {
      const blink = Math.sin(performance.now() / 80) > 0;
      if (blink) {
        ctx.fillStyle = "#ff5a3c";
        ctx.beginPath();
        ctx.arc(p.x, p.y - 5, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawParticle(pt) {
    const a = Math.max(0, pt.life / pt.max);
    let c;
    if (pt.kind === "fire") c = `rgba(255,${120 + Math.random() * 80 | 0},40,${a})`;
    else if (pt.kind === "smoke") c = `rgba(90,90,90,${a * 0.6})`;
    else c = `rgba(110,75,45,${a})`;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
    ctx.fill();
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
    if (code === "Space" && game.state === "aiming") {
      if (!game.charging && activeMole()) {
        game.charging = true;
        game.power = 0;
        ui.powerBar.classList.add("active");
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

  // Draw a static menu backdrop so the canvas isn't blank behind overlay.
  generateTerrain();
  function menuFrame() {
    if (game.state === "menu") {
      ctx.clearRect(0, 0, W, H);
      drawBackground();
      ctx.drawImage(terrainCanvas, 0, 0);
      requestAnimationFrame(menuFrame);
    }
  }
  menuFrame();
})();
