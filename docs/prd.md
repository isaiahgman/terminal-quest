# PRD — Terminal Quest

## 1. Summary
Terminal Quest is a small, winnable **turn-based fantasy RPG** that runs entirely in the terminal, with animated ASCII characters and combat. A full playthrough takes ~10 minutes. Tone: heroic with a wink of humor.

## 2. Why (goals)
- **Process goal (primary):** run the full discovery → planning-artifact → atomic-PR → ship flow end-to-end on a fun, low-stakes project, and leave behind reusable process/context.
- **Product goal:** a complete, charming micro-RPG that *feels alive* (animation, personality), installable with one command.

## 3. Non-goals (v1)
- No multiplayer / networking.
- No procedural generation or large branching world — linear, hand-authored scenes.
- No sound.
- No meta-progression beyond a single playthrough (save/load is a stretch, see §7).

## 4. Player & platform
- Anyone with **Node ≥ 18** and a terminal. Launch via `npx terminal-quest`.
- Keyboard only (arrows + Enter + a few hotkeys).

## 5. Core loop (player experience)
1. Launch → **animated title screen**.
2. **Create hero** — pick one of 3 classes (Warrior / Mage / Rogue); see portrait + stats.
3. **Explore** a short linear map: Town → Forest → Cave → Boss Lair, via scene screens with flavor text + choices.
4. **Battle** — turn-based encounters with animated attacks, HP/MP bars, and an action menu (Attack / Ability / Item / Flee).
5. **Manage** HP/MP/potions between fights.
6. **Resolve** — beat the final boss → victory screen; die → game-over screen. Either path → back to title.

## 6. Features (MVP)
| ID | Feature |
|----|---------|
| F1 | Title screen: ASCII art + keyboard menu (New Game / Quit) |
| F2 | Character creation: 3 classes with distinct stats/abilities |
| F3 | Linear exploration across 4 scenes |
| F4 | Turn-based combat engine |
| F5 | Animated battle UI (attack frames, hit reaction, faint, HP-bar tween) |
| F6 | 3 enemy types + 1 boss |
| F7 | Inventory with potions (usable in & out of battle) |
| F8 | Victory / defeat / game-over flow + restart |

## 7. Stretch (post-MVP)
- S1 Save/load to JSON · S2 More classes/enemies/scenes · S3 Status effects (poison/stun) · S4 Packaging + recorded GIF + publish to npm.

## 8. Success criteria
- New player launches with one command and completes a full playthrough (both win and lose paths) **without crashes**.
- Combat is **animated**, not static.
- Each system is independently understandable in the code.
- The repo carries the **full planning trail** (this PRD, the TDD, per-PR artifacts).

## 9. Definition of done (v1)
- [ ] `pnpm dev` (and `npx`) launches the game
- [ ] All 4 scenes traversable; boss reachable and beatable
- [ ] Win and lose both reachable and return to title
- [ ] At least one animation type plays in battle
- [ ] No unhandled crashes in a normal playthrough
