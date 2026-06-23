# Mole Mayhem 🦫💥

A turn-based artillery game in the spirit of the classic **Worms** games from
the 90s/2000s — but starring rival teams of **moles** instead (original
characters, no copyrighted assets).

Two teams take turns lobbing weapons across a randomly generated,
**fully destructible** landscape. Last burrow standing wins.

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

| Key | Action |
| --- | --- |
| **← →** | Walk your mole |
| **↑ ↓** | Aim the weapon |
| **Space** (hold & release) | Charge power and fire |
| **Enter** | Jump |
| **1 – 4** | Select weapon |

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
