/**
 * Boss data — the win-condition content layer (prd §7, F7). A boss is modelled
 * as a very tough {@link Enemy} that also carries identity (`id`, `name`) and a
 * **signature behaviour**, so it reuses the enemy movement, combat, contact, XP,
 * and rendering paths wholesale; only defeat-counting (`update.ts`) and the
 * signature are special. Reaching the full roster of 10 is therefore *authoring*
 * — append entries to {@link BOSS_ROSTER} — not engineering (prd §7, TQ-011).
 *
 * Pure data + a factory, mirroring `enemy.ts`: no world/loop logic and no render
 * imports (`glyph`/`color` are plain strings the renderer maps).
 */

import type { Enemy } from '../game/enemy.js';
import type { Vec2 } from '../game/state.js';

/**
 * A boss's signature behaviour, selected by data. `none` is a pure stat wall
 * (uses the standard enemy AI unchanged); `enrage` speeds the boss up once its
 * health drops below `below` (a fraction of `maxHp`), multiplying its move speed
 * by `speedMultiplier` — riding the existing move-budget/charge system rather
 * than a bespoke movement path. A discriminated union (not optional fields) so
 * each variant carries exactly its own tuning and nothing unused.
 *
 * Adding a boss that reuses an existing variant is pure data; inventing a *new*
 * variant is the only part that needs code.
 */
export type BossSignature =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'enrage';
      /** Health fraction in (0, 1] below which the boss enrages (strict `<`). */
      readonly below: number;
      /** Speed multiplier applied while enraged (> 1 ⇒ faster). */
      readonly speedMultiplier: number;
    };

/**
 * A live boss: a full {@link Enemy} (so every enemy system handles it) plus
 * identity and its signature. `kind` is always `'boss'`. There is intentionally
 * **no `defeated` flag** — defeat is recorded by culling the boss from the live
 * set and the `bossesDefeated` counter on `GameState` (see TDD §12), so there is
 * no second source of truth to keep in sync.
 */
export interface Boss extends Enemy {
  readonly kind: 'boss';
  /** Stable identifier, unique within {@link BOSS_ROSTER}. */
  readonly id: string;
  /** Display name (e.g. for the victory screen / HUD). */
  readonly name: string;
  /** Data-selected signature behaviour. */
  readonly signature: BossSignature;
}

/**
 * The position-less authoring template for a boss. {@link createBoss} stamps a
 * concrete {@link Boss} onto a world tile from one of these. The roster ships
 * 1–2 fully-authored bosses; reaching 10 is appending entries (acceptance #5).
 */
export interface BossSpec {
  readonly id: string;
  readonly name: string;
  /** Spawn (and max) health — bosses are deliberately far tougher than swarm. */
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly speed: number;
  readonly glyph: string;
  readonly color: string;
  readonly signature: BossSignature;
}

/**
 * The boss roster — the single place reaching 10 is authored, and with TQ-024
 * it is: ten bosses on an ascending difficulty ladder (hp/atk/def climb; the
 * later walls are meant to read *impossible* until the grind makes them
 * trivial — prd §2). Signatures alternate stat-walls and varied enrage tunings
 * so the climb changes texture, not just magnitude. Balance numbers are
 * deliberate starting points to tune by playing (the TQ-011 stance, kept).
 */
const roster: BossSpec[] = [
  {
    id: 'gatekeeper',
    name: 'The Gatekeeper',
    hp: 120,
    atk: 8,
    def: 1,
    speed: 3,
    glyph: 'Ω',
    color: 'brightMagenta',
    signature: { kind: 'enrage', below: 0.4, speedMultiplier: 2 },
  },
  {
    id: 'hollow-sovereign',
    name: 'The Hollow Sovereign',
    hp: 200,
    atk: 12,
    def: 2,
    speed: 2,
    glyph: 'Φ',
    color: 'brightRed',
    signature: { kind: 'none' },
  },
  {
    id: 'carrion-shepherd',
    name: 'The Carrion Shepherd',
    hp: 300,
    atk: 14,
    def: 2,
    speed: 4,
    glyph: 'Ψ',
    color: 'brightGreen',
    signature: { kind: 'enrage', below: 0.5, speedMultiplier: 1.5 },
  },
  {
    id: 'rust-colossus',
    name: 'The Rust Colossus',
    hp: 420,
    atk: 16,
    def: 4,
    speed: 1.5,
    glyph: 'Θ',
    color: 'yellow',
    signature: { kind: 'none' },
  },
  {
    id: 'pale-huntress',
    name: 'The Pale Huntress',
    hp: 520,
    atk: 18,
    def: 3,
    speed: 6,
    glyph: 'λ',
    color: 'brightWhite',
    signature: { kind: 'enrage', below: 0.6, speedMultiplier: 1.8 },
  },
  {
    id: 'grave-tide',
    name: 'The Grave Tide',
    hp: 650,
    atk: 20,
    def: 4,
    speed: 3,
    glyph: 'Ξ',
    color: 'brightBlue',
    signature: { kind: 'none' },
  },
  {
    id: 'ember-tyrant',
    name: 'The Ember Tyrant',
    hp: 800,
    atk: 23,
    def: 5,
    speed: 3,
    glyph: 'Δ',
    color: 'red',
    signature: { kind: 'enrage', below: 0.35, speedMultiplier: 2.5 },
  },
  {
    id: 'silent-choir',
    name: 'The Silent Choir',
    hp: 1000,
    atk: 25,
    def: 5,
    speed: 4,
    glyph: 'Π',
    color: 'magenta',
    signature: { kind: 'none' },
  },
  {
    id: 'abyss-warden',
    name: 'The Abyss Warden',
    hp: 1200,
    atk: 28,
    def: 6,
    speed: 4,
    glyph: 'Σ',
    color: 'brightCyan',
    signature: { kind: 'enrage', below: 0.5, speedMultiplier: 2 },
  },
  {
    id: 'shadow-monarch',
    name: 'The Shadow Monarch',
    hp: 1500,
    atk: 32,
    def: 7,
    speed: 5,
    glyph: '♛',
    color: 'brightMagenta',
    signature: { kind: 'enrage', below: 0.25, speedMultiplier: 3 },
  },
];

export const BOSS_ROSTER: readonly BossSpec[] = Object.freeze(roster);

/**
 * The win target: defeat this many bosses to win (prd §7/F7). The single source
 * of truth for both the victory check (`update.ts`) and the HUD denominator
 * (`render/hud.ts` re-exports it) — so "n/total" on screen and the victory
 * trigger can never disagree. Equal to the roster length, so it grows from 2 to
 * the design target of 10 as bosses are appended — pure data, no code change
 * (the agreed TQ-011 win-target = roster-length decision).
 */
export const TOTAL_BOSSES = BOSS_ROSTER.length;

/**
 * Build a live {@link Boss} of `spec` at `pos`. `hp` starts at `maxHp`; the
 * position is copied so the caller's `Vec2` is never aliased in (mirrors
 * {@link createEnemy}).
 */
export function createBoss(spec: BossSpec, pos: Vec2): Boss {
  return {
    kind: 'boss',
    pos: { x: pos.x, y: pos.y },
    hp: spec.hp,
    maxHp: spec.hp,
    atk: spec.atk,
    def: spec.def,
    speed: spec.speed,
    glyph: spec.glyph,
    color: spec.color,
    id: spec.id,
    name: spec.name,
    signature: spec.signature,
  };
}
