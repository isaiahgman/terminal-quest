# PRD — Terminal Quest

## 1. Summary
A **real-time terminal action-roguelike** with **Solo-Leveling-style power progression**. You move through a large, open-feeling, procedurally generated world; enemies hunt you on a clock; you fight back with stamina-gated **radius attacks**; you level up, find weapons, grow a home base, and hunt down **10 bosses** scattered across the map. Progression is **persistent** — you keep your power across sessions. Closest reference: *Vampire Survivors × Solo Leveling, in a terminal.*

## 2. The feeling we're chasing (the real spec)
Solo Leveling is addictive because it shows you a wall the hero **cannot** overcome, then — through struggle and grind — delivers a moment where that same wall is **unbelievably easy**. **That power-delta is the product.** Every system (level curve, enemy scaling, weapon drops, boss difficulty) exists to manufacture *impossible → trivial*.

## 3. Why this project
Implementation is no longer the barrier to building games — **judgment and system-readiness are.** This is a deliberate rep: build the engine, rendering, and progression systems locally, *for myself*, so that when a great idea lands I can execute in hours, not weeks. Originality isn't the assignment; a reusable system + a finished rep is.

## 4. Platform
Node ≥ 18, any reasonably-sized terminal, keyboard only. Launch via `npx terminal-quest`.

**Controls feel (a real requirement, not polish).** This is a real-time swarm-dodger, so movement must feel *immediate*: hold a direction and you keep moving smoothly with **no initial stall**, and a direction change registers at once. We originally assumed terminals can't see key-release (key-DOWN only), which forces a small unavoidable "coast" after you let go. During TQ-016 we found modern terminals **can** report real key-release (the kitty keyboard protocol), so the plan is two-tier: best-feel, no-coast input where the terminal supports it, with a graceful held-with-timeout fallback everywhere else. The player should never feel their OS keyboard-repeat settings — cadence is the game's, not the OS's. (See `tdd.md` §12 and `plan/TQ-016`/`TQ-018`.)

## 5. Core loop (moment to moment)
1. You're in the world. Enemies advance toward you **on a clock, whether or not you move** — stand still and you die.
2. When they're in range, fight back with a **radius attack**; each enemy in range has a *chance* to be hit.
3. Attacks cost **stamina**. You can mash, but stamina caps you — manage it or get overwhelmed.
4. Kills give XP → **level up** → stronger. Find **weapons** → equip → more damage.
5. Roam the open world, dip into **high-risk/high-reward dungeons**, return to your **growing base**.
6. Reach and defeat the **10 bosses**. Hard to get to, hard to beat. All 10 down → you win.

## 6. Combat — the signature system
- **Radius attacks, 1–3 types**, with creative names, on a **risk/reward axis**:
  - *Low risk / low reward* — small radius, low damage, cheap stamina, reliable.
  - *High risk / high reward* — large radius, big damage, expensive stamina (and/or a vulnerable wind-up).
  - *(optional medium)* between the two.
- **Probabilistic hits** — each enemy inside the radius has a random chance to be hit, not a guarantee.
- **Stamina** — every attack costs it; it regenerates over time; empty = can't attack → you must reposition/flee.
- **Enemy AI** — advance toward the player continuously; inside a proximity threshold they charge straight in.

## 7. World & progression
- **Procedural**, open-feeling world, **larger than the screen**; the **camera follows the player**.
- **Dungeons** — optional high-risk/high-reward pockets.
- **10 bosses** scattered across the world = the win condition.
- **Persistent (roguelite) progression** — level, stats, weapon, and base growth persist across runs/sessions. Death returns you to base; you keep your growth.
- **Weapons** — a single **weapon slot**; weapons are found randomly in the world; equipping boosts damage; upgradeable.
- **Base** — a home that **grows** as you progress; the meta-progression anchor.

## 8. Save
- **Autosave** (desired) of: player stats/level, **location**, current status, equipped weapon, world seed, base state, and bosses defeated — so you drop back exactly where you left off.

## 9. Game feel / juice (when we get there)
- Hit flashes, floating damage numbers, screen shake. Acknowledged as hard and renderer-dependent — treated as polish *after* the loop is proven, not before.

## 10. Features
| ID | Feature |
|----|---------|
| F1 | Procedural open-feeling world + camera that follows the player |
| F2 | Real-time enemy swarm AI (advance on a clock; charge in close) |
| F3 | Radius attacks + stamina system |
| F4 | 1–3 named attack types on a risk/reward axis |
| F5 | Leveling / stat progression (the power curve) |
| F6 | Weapons: single slot, random drops, equip, damage boost |
| F7 | 10 bosses scattered across the world + win condition |
| F8 | Save / autosave (resume exactly where you were) |
| F9 | Growing home base (persistent meta) |
| F10 | High-risk/high-reward dungeons |
| F11 | Game feel / juice (flashes, damage numbers, shake) |

## 11. MVP cut line
Prove the **core dopamine loop** first: procedural world + camera + swarm + radius/stamina combat + leveling + one weapon + save. Get the *feel* right, then layer bosses, base, dungeons, and juice. (See `plan/README.md` phases.)

## 12. Non-goals (v1)
No multiplayer, no sound, no story/dialogue trees, no smooth sub-tile movement (grid-based), no mouse.

## 13. Definition of done (v1 / MVP)
- [ ] One command launches; you move through a procedural world with a following camera
- [ ] Enemies swarm on a clock; radius attacks + stamina work; standing still kills you
- [ ] Killing enemies levels you up and you feel measurably stronger
- [ ] At least one boss is reachable and beatable; design supports all 10
- [ ] Progress persists across relaunch (save/load)
- [ ] No crashes; terminal is restored to a clean state on exit
- [ ] The "impossible → trivial" power delta is observable across a session
