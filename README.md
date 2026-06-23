# Mole Mayhem 🦫💥

A turn-based artillery game in the spirit of the classic **Worms** games from
the 90s/2000s — but starring rival teams of **moles** instead (original
characters, no copyrighted assets).

Two teams take turns lobbing weapons across a randomly generated,
**fully destructible** landscape. Last burrow standing wins.

**▶ Play it now: https://foppc.github.io/Worms-game/** (works on desktop and phone)

![type: browser game](https://img.shields.io/badge/type-browser%20game-blue)
![deps: none](https://img.shields.io/badge/dependencies-none-brightgreen)

## How to play

It runs entirely in the browser with **no build step and no dependencies**.

```bash
# from the project folder, start any static file server, e.g.:
python3 -m http.server 8000
# then open http://localhost:8000
```

…or just open `index.html` directly in a modern browser.

## Controls

**Keyboard (desktop):**

| Key | Action |
| --- | --- |
| **← →** | Walk your mole |
| **↑ ↓** | Aim the weapon |
| **Space** (hold & release) | Charge power and fire |
| **Enter** | Jump |
| **1 – 4** | Select weapon |

**Touch (phones / tablets):** on-screen controls appear automatically — a
D-pad on the left (◀ ▶ walk, ▲ ▼ aim), **FIRE** (hold to charge, release to
shoot) and **JUMP** on the right, and the weapon icons up top to switch
weapons. Landscape orientation gives you the most room.

## Play on your phone

The game is just static files, so any of these work:

- **Same Wi-Fi:** run `python3 -m http.server 8000` on your computer, find its
  local IP (e.g. `192.168.1.x`), and open `http://192.168.1.x:8000` in your
  phone's browser.
- **GitHub Pages:** enable Pages for this repo (Settings → Pages → deploy from
  the branch) and open the published URL on your phone. No install needed.

The layout auto-fits the screen and the touch controls stay anchored to the
visible edges, so the whole battle is reachable with your thumbs.

## Features

- 🌄 **Procedurally generated terrain** — rolling hills, new each match.
- 💣 **Fully destructible ground** — every explosion carves a real crater.
- 🎯 **Projectile physics** — gravity, charge-based power, and **wind** that
  pushes wind-affected weapons.
- 🧨 **Four weapons:**
  - **Bazooka** — wind-affected direct projectile.
  - **Grenade** — bounces off terrain, timed fuse.
  - **Dynamite** — heavy, big crater, timed fuse.
  - **Cluster** — splits into shards on impact.
- 🦫 **Teams of moles** with health bars, knockback, and fall damage.
- ⏱️ **Turn timer**, retreat window after firing, and win detection.
- 🎮 Hot-seat local multiplayer (two players share the keyboard).

## Tech

Plain HTML5 Canvas + vanilla JavaScript. Terrain destruction uses a per-pixel
solidity mask kept in sync with an offscreen canvas for fast collision and
crater carving.

## Project layout

```
index.html   — page, HUD, and start screen
style.css    — styling for the HUD and overlay
game.js      — game engine (terrain, physics, weapons, rendering)
```

Enjoy the mayhem!
