import {
  type GameState,
  type GameStatus,
  type HitEvent,
  type LiveEnemy,
  inBase,
  isWalkable,
} from './state.js';
import { baseHpBonus, growBase } from './base.js';
import { generateDungeon } from './dungeon.js';
import {
  type Combatant,
  type RngFn,
  regenStamina,
  resolveAttack,
} from './combat.js';
import { contactDamage, stepEnemy } from './entities.js';
import { createProgression, gainXp, xpForKill } from './progression.js';
import { ATTACKS, type AttackId } from '../data/attacks.js';
import type { Enemy } from './enemy.js';
import { type Boss, TOTAL_BOSSES } from '../data/bosses.js';
import { WEAPONS, applyWeapon } from '../data/weapons.js';

/** A player-issued action for one tick. (More variants land in later PRs.) */
export interface MoveIntent {
  type: 'move';
  dx: number;
  dy: number;
}
/** Perform a named attack (`attacks.ts`) centred on the player this tick. */
export interface AttackIntent {
  type: 'attack';
  attackId: AttackId;
}
export type Intent = MoveIntent | AttackIntent;

/** Constant simulation step (ms). The loop always advances by exactly this. */
export const SIM_DT = 1000 / 15;
/** The same step in seconds — the unit enemy speed and stamina regen use. */
export const SIM_DT_SECONDS = SIM_DT / 1000;

/** Stamina recovered per second of real time. A full bar (10) refills in ~3.3s. */
export const STAMINA_REGEN_PER_SEC = 3;

/**
 * Hp recovered per second while standing on home ground (TQ-013) — the base's
 * "breather" made tangible: retreat home, catch your breath, wade back in.
 * Deliberately gentle (a full level-1 bar takes ~10s) so the base is a
 * recovery anchor, not an in-combat heal — enemies can't follow you in, so the
 * cost of using it is the walk, not the risk.
 */
export const BASE_HP_REGEN_PER_SEC = 2;

/**
 * The player's effective max hp: the progression ceiling plus the home base's
 * tier buff (TQ-013) — the one place the two growth axes meet. States without
 * progression default the fresh level-1 ceiling (the usual idiom); states
 * without a base get no bonus.
 *
 * The buff is PLAYER-BOUND growth, not world scenery: while inside a dungeon
 * the live base is suspended, so callers must pass the suspended one
 * (`state.dungeon?.overworld.base`) — descending must never shrink the hp
 * ceiling. (The audit found a level-up below could otherwise "refill" the
 * player DOWNWARD to the un-buffed ceiling, and the HUD showed hp above max.)
 */
function effectiveMaxHp(
  player: GameState['player'],
  base: GameState['base'],
): number {
  const ceiling = player.progress?.maxHp ?? createProgression().maxHp;
  return ceiling + (base === undefined ? 0 : baseHpBonus(base.growth));
}

/**
 * Damage at or above which a single landed hit is flagged "big" — the render
 * layer (TQ-015) turns a big hit into a screen shake on top of the usual flash +
 * floating number. Co-located here with the other balance knobs (per CLAUDE.md):
 * it's pure presentation, never read back into the rules, so tuning it can only
 * change how a hit *feels*, never what the sim does. Tune by playing.
 */
export const BIG_HIT_DAMAGE = 8;

/**
 * The player's combat stats as the engine's {@link Combatant}: current hp /
 * stamina / def from the player, and the ceilings (`maxStamina`) plus `atk` from
 * progression — defaulting a fresh level-1 progression for pre-progression
 * states. This is the single adapter from the player model to combat math.
 */
function playerCombatant(player: GameState['player']): Combatant {
  const progress = player.progress ?? createProgression();
  return {
    pos: player.pos,
    hp: player.hp,
    stamina: player.stamina,
    maxStamina: progress.maxStamina,
    atk: progress.atk,
    def: player.def,
  };
}

/**
 * An enemy as the combat engine's {@link Combatant} target. {@link resolveAttack}
 * only reads `pos`/`hp`/`def` off a target, but the shape also carries stamina
 * fields — enemies have no stamina of their own, so they're zeroed. The enemy
 * twin of {@link playerCombatant}: one named adapter from the entity model to
 * combat math, rather than an anonymous inline object literal.
 */
function enemyCombatant(enemy: Enemy): Combatant {
  return {
    pos: enemy.pos,
    hp: enemy.hp,
    stamina: 0,
    maxStamina: 0,
    atk: enemy.atk,
    def: enemy.def,
  };
}

/** A boss is an enemy whose archetype tag is `'boss'` (only `createBoss` sets it). */
function isBoss(enemy: Enemy): enemy is Boss {
  return enemy.kind === 'boss';
}

/**
 * The enemy as this tick's movement step should see it: an `enrage` boss below
 * its health threshold moves at a multiple of its speed (the signature
 * behaviour, TQ-011), reusing the move-budget path in {@link stepEnemy} rather
 * than a bespoke one. Every other enemy is returned unchanged. The boosted copy
 * is transient — used only for the step calculation, never stored — so the
 * boss keeps its real `speed` (see the survivors loop below).
 */
function steppingEnemy(enemy: Enemy): Enemy {
  if (
    isBoss(enemy) &&
    enemy.signature.kind === 'enrage' &&
    enemy.hp < enemy.maxHp * enemy.signature.below
  ) {
    return { ...enemy, speed: enemy.speed * enemy.signature.speedMultiplier };
  }
  return enemy;
}

/**
 * The nearest walkable tile outside the base's safe zone (Chebyshev distance
 * to `from`, ties by row-major scan order — deterministic). `undefined` on a
 * degenerate world with no walkable ground outside the zone. Used to evict
 * enemies the growing zone swallows, so the "enemies never set foot on home
 * ground" invariant holds by construction.
 */
function nearestTileOutsideBase(
  world: GameState['world'],
  base: NonNullable<GameState['base']>,
  from: { x: number; y: number },
): { x: number; y: number } | undefined {
  let best: { x: number; y: number } | undefined;
  let bestDist = Infinity;
  for (let ty = 0; ty < world.height; ty++) {
    for (let tx = 0; tx < world.width; tx++) {
      if (!isWalkable(world, tx, ty) || inBase(base, tx, ty)) continue;
      const dist = Math.max(Math.abs(tx - from.x), Math.abs(ty - from.y));
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: tx, y: ty };
      }
    }
  }
  return best;
}

/**
 * Advance the simulation by one tick. PURE: the same (state, intents, dt, rng)
 * always produces the same result — no I/O, no drawing, no `Math.random` (the
 * only randomness is the injected `rng`, consumed solely by attack rolls). This
 * is the heart of the game; the renderer only ever reads what this returns.
 *
 * One tick, in order: the player moves, then optionally attacks (spending
 * stamina and damaging enemies in radius via the combat engine); slain enemies
 * (hp ≤ 0) convert to player XP and leave the world (TQ-009); stamina
 * regenerates; the survivors advance toward the player's new position; and their
 * contact damage chips the player.
 */
export function update(
  state: GameState,
  intents: readonly Intent[],
  dt: number,
  rng: RngFn,
): GameState {
  // --- A finished run is inert (TQ-020's sim-level invariant). The loop
  // already freezes on a terminal status, but the guarantee belongs to the
  // sim itself: any caller (a replay tool, a test harness, a future rewind)
  // ticking a 'victory'/'defeat' state gets a world where nothing moves,
  // bites, or spends — time passes, the dead run doesn't. No RNG consumed. ---
  if (state.status === 'victory' || state.status === 'defeat') {
    return {
      ...state,
      tooTired: false,
      hitEvents: [],
      tick: state.tick + 1,
    };
  }

  // --- Intent selection: at most one move and one attack per tick. ---
  // Auto-repeat (holding a key) and the input buffer can queue several intents
  // per step; applying all moves would let the player jump multiple tiles in one
  // tick, breaking the fixed-timestep model. Take the last move (most recent
  // direction) and the last attack, so a mash within one tick is a single swing
  // — the stamina gate, not the buffer depth, is what limits attacking.
  let lastMove: MoveIntent | undefined;
  let lastAttack: AttackIntent | undefined;
  for (const intent of intents) {
    if (intent.type === 'move') lastMove = intent;
    else lastAttack = intent;
  }

  let { x, y } = state.player.pos;
  if (lastMove !== undefined) {
    const { dx, dy } = lastMove;
    if (isWalkable(state.world, x + dx, y + dy)) {
      // Target tile (orthogonal or diagonal) is open — take it.
      x += dx;
      y += dy;
    } else if (dx !== 0 && dy !== 0) {
      // Diagonal blocked: slide along the wall by trying each axis alone, so a
      // blocked corner doesn't make the player stick (TQ-017). Prefer the
      // horizontal step, then the vertical. At an outer corner — where only the
      // diagonal tile is a wall — both orthogonals are open and the horizontal
      // wins: arbitrary but deterministic.
      if (isWalkable(state.world, x + dx, y)) {
        x += dx;
      } else if (isWalkable(state.world, x, y + dy)) {
        y += dy;
      }
    }
  }

  // --- Dungeon transitions (TQ-014): stepping onto an entrance descends;
  // stepping onto the dungeon's exit tile surfaces. A transition consumes the
  // whole tick (the fresh context acts from the NEXT tick), and both trigger
  // only on a tile the player *moved onto this tick* — so surfacing onto the
  // entrance tile, or arriving on the exit tile, never chain-fires: you must
  // step off and back on to go through again. ---
  const moved = x !== state.player.pos.x || y !== state.player.pos.y;
  if (moved && state.dungeon === undefined) {
    const entrance = state.entrances?.find((e) => e.x === x && e.y === y);
    if (entrance !== undefined) {
      // Descend: swap in the entrance's deterministic dungeon (same entrance ⇒
      // same dungeon) and suspend the overworld exactly as it stands. The base
      // is suspended too — there is no home ground below.
      const context = generateDungeon(state.world.seed, entrance);
      return {
        ...state,
        world: context.world,
        player: {
          ...state.player,
          pos: { x: context.spawn.x, y: context.spawn.y },
        },
        enemies: context.enemies,
        pickups: context.pickups,
        entrances: undefined,
        base: undefined,
        dungeon: {
          returnPos: { x, y },
          exitPos: { x: context.spawn.x, y: context.spawn.y },
          overworld: {
            world: state.world,
            enemies: state.enemies,
            pickups: state.pickups,
            entrances: state.entrances,
            base: state.base,
          },
        },
        tooTired: false,
        hitEvents: [],
        tick: state.tick + 1,
      };
    }
  }
  if (
    moved &&
    x === state.dungeon?.exitPos.x &&
    y === state.dungeon.exitPos.y
  ) {
    // Surface: restore the suspended overworld wholesale and stand back on the
    // entrance tile. Everything player-bound — hp, level, XP, the weapon you
    // dove for — walks out with you.
    const { returnPos, overworld } = state.dungeon;
    // Settle the suspended base against the live boss count on the way out
    // (audit L4): unreachable today (no bosses spawn below), but if one ever
    // does, its growth must not be lost until the next surface kill. growBase
    // is monotonic and idempotent, so this is free when nothing changed.
    let surfacedBase = overworld.base;
    if (overworld.base !== undefined) {
      const settled = growBase(
        overworld.base.growth,
        state.bossesDefeated ?? 0,
      );
      // Keep the suspended object's identity when nothing grew — restoring
      // the overworld is reference-exact unless growth genuinely changed.
      if (
        settled.tier !== overworld.base.growth.tier ||
        settled.bossesDefeated !== overworld.base.growth.bossesDefeated
      ) {
        surfacedBase = { ...overworld.base, growth: settled };
      }
    }
    return {
      ...state,
      world: overworld.world,
      player: { ...state.player, pos: { x: returnPos.x, y: returnPos.y } },
      enemies: overworld.enemies,
      pickups: overworld.pickups,
      entrances: overworld.entrances,
      base: surfacedBase,
      dungeon: undefined,
      tooTired: false,
      hitEvents: [],
      tick: state.tick + 1,
    };
  }

  let player = { ...state.player, pos: { x, y } };
  let enemies = state.enemies;
  let pickups = state.pickups;
  let tooTired = false;
  let bossesDefeated = state.bossesDefeated ?? 0;
  let defeatedBossIds = state.defeatedBossIds;
  let base = state.base;
  let status: GameStatus = state.status ?? 'playing';
  // Render-only hit feedback for this tick (TQ-015); populated below from the
  // attack outcomes, then handed back on the returned state as pure OUTPUT.
  let hitEvents: HitEvent[] = [];

  // --- Pickups: STEPPING onto a weapon equips it to the single slot (TQ-010). ---
  // Gated on `moved`, like the dungeon transitions: equipping is a deliberate
  // step onto the tile, never something that happens to a player *standing*
  // there. (The audit found the standing case: surface from a dungeon onto an
  // entrance that also holds a pickup, and one tick later — zero input — the
  // pickup would replace the reward you just risked the run for.) Done after
  // the move and before the attack (so the swing this tick already swings the
  // new weapon). The last matching pickup wins if several stack on one tile —
  // the slot holds exactly one — and every picked-up tile is cleared, so a
  // pile is consumed in a single step.
  if (pickups !== undefined && moved) {
    const here = pickups.filter(
      (p) => p.pos.x === player.pos.x && p.pos.y === player.pos.y,
    );
    if (here.length > 0) {
      player = { ...player, weapon: here[here.length - 1]!.weaponId };
      pickups = pickups.filter((p) => !here.includes(p));
    }
  }

  // --- Attack: resolve a radius swing against the enemies in reach. ---
  if (lastAttack !== undefined) {
    // Fold the equipped weapon into the chosen attack before the engine resolves
    // it — reusing the combat damage path, never forking it (TQ-010 constraint).
    // Unarmed (`player.weapon` undefined) returns the attack unchanged.
    const spec = applyWeapon(
      ATTACKS[lastAttack.attackId],
      player.weapon === undefined ? undefined : WEAPONS[player.weapon],
    );
    // Enemies aren't Combatants (no stamina of their own), so adapt them to the
    // engine's shape; it only reads pos/hp/def from a target, and `def` comes
    // from the enemy data model so the damage formula has one source.
    const targets: Combatant[] = (enemies ?? []).map(({ enemy }) =>
      enemyCombatant(enemy),
    );
    const result = resolveAttack(playerCombatant(player), targets, spec, rng);
    if (result.blocked) {
      tooTired = true;
    } else {
      // Spend the stamina the engine deducted, and write the rolled damage onto
      // each enemy by index (targets stay in input order).
      player = { ...player, stamina: result.attacker.stamina };
      if (enemies !== undefined) {
        const struck = enemies;
        enemies = struck.map((live, i) => ({
          ...live,
          enemy: { ...live.enemy, hp: result.targets[i]!.hp },
        }));
        // Emit a render-only hit event per landed hit (TQ-015). Outcome `index`
        // points back into the targets/enemies array (same order), so we read the
        // struck enemy's pre-move position for the flash/number anchor. OUTPUT
        // only — never read back, so the sim stays pure/deterministic.
        hitEvents = result.outcomes
          .filter((o) => o.hit)
          .map((o): HitEvent => {
            const pos = struck[o.index]!.enemy.pos;
            return {
              pos: { x: pos.x, y: pos.y },
              amount: o.damage,
              big: o.damage >= BIG_HIT_DAMAGE,
            };
          });
      }
    }
  }

  // --- Kill → XP, and cull the slain before they move or bite (TQ-009). ---
  if (enemies !== undefined) {
    const slain = enemies.filter(({ enemy }) => enemy.hp <= 0);
    if (slain.length > 0) {
      // Survivors are the exact negation of the slain predicate — NOT `hp > 0`.
      // For a non-finite hp both `hp <= 0` and `hp > 0` are false, so `hp > 0`
      // would silently drop a NaN-hp enemy; `!(hp <= 0)` keeps it (the same
      // partition `slain` used). This negated-predicate filter also avoids the
      // O(n*m) `slain.includes(live)` that coupled correctness to object
      // identity surviving the upstream attack-resolution map.
      enemies = enemies.filter(({ enemy }) => !(enemy.hp <= 0));
      const awarded = slain.reduce(
        (total, { enemy }) => total + xpForKill(enemy),
        0,
      );
      const priorLevel = player.progress?.level ?? 1;
      player = {
        ...player,
        progress: gainXp(player.progress ?? createProgression(), awarded),
      };

      // Bosses are slain through the same path as a normal enemy; count the
      // ones that fell this tick and declare victory once `TOTAL_BOSSES` (the
      // roster length — the same denominator the HUD shows) are down (TQ-011).
      // Gated on a boss actually dying this tick, so a no-boss game never wins;
      // the `> 0` guard keeps an empty roster from auto-winning at 0/0.
      // Identity is recorded alongside the count (`defeatedBossIds`, the
      // count's twin — see `state.ts`), appended here and nowhere else, so the
      // save can keep dead bosses dead across a resume (TQ-022).
      const slainBossIds = slain
        .map(({ enemy }) => enemy)
        .filter(isBoss)
        .map((boss) => boss.id);
      if (slainBossIds.length > 0) {
        bossesDefeated += slainBossIds.length;
        defeatedBossIds = [...(defeatedBossIds ?? []), ...slainBossIds];
        // The home base grows on the same signal (TQ-013): settle its tier
        // against the new count here — the only place the count rises — so the
        // home visibly levels up the tick the boss falls. growBase is
        // monotonic, so this only ever steps the base up.
        if (base !== undefined) {
          base = { ...base, growth: growBase(base.growth, bossesDefeated) };
          // The grown ring may swallow enemies that were standing just outside
          // (audit M2): they could never step within the zone again, freezing
          // them inside the "enemies never enter" home as statues. Evict each
          // to its nearest walkable tile OUTSIDE the new zone (nearest by
          // Chebyshev, ties by scan order — deterministic), so the safe-zone
          // invariant holds by construction, not luck.
          const grown = base;
          enemies = enemies.map((live) => {
            if (!inBase(grown, live.enemy.pos.x, live.enemy.pos.y)) {
              return live;
            }
            const out = nearestTileOutsideBase(
              state.world,
              grown,
              live.enemy.pos,
            );
            return out === undefined
              ? live
              : { ...live, enemy: { ...live.enemy, pos: out } };
          });
        }
        if (TOTAL_BOSSES > 0 && bossesDefeated >= TOTAL_BOSSES) {
          status = 'victory';
        }
      }

      // Level-up power surge (TQ-023): a level you earn must be *felt*, not just
      // banked as headroom. `gainXp` raised the hp/stamina ceilings; on any level
      // gain, refill current hp/stamina to the new caps so the HUD jumps and you
      // come out of the grind measurably stronger (prd §2). Full-refill policy;
      // a multi-level gain heals once, to the final caps. `atk` already applies
      // live, so the offensive half of the surge needed nothing here. The hp
      // ceiling includes the base's tier buff (TQ-013) — via buffBase, so a
      // level-up INSIDE a dungeon still counts the suspended home — and the
      // Math.max guard means a "refill" can never heal DOWNWARD, whatever the
      // ceiling does. Runs after the boss/base block so a boss kill that levels
      // you refills to the ceiling the kill just grew.
      // `base` (the grown local) on the surface; the suspended home below.
      const homeForBuff = base ?? state.dungeon?.overworld.base;
      const progressNow = player.progress ?? createProgression();
      if (progressNow.level > priorLevel) {
        player = {
          ...player,
          hp: Math.max(player.hp, effectiveMaxHp(player, homeForBuff)),
          stamina: progressNow.maxStamina,
        };
      }
    }
  }

  // --- Stamina regen (after spending), so a mash nets a drain. ---
  // Quantize post-regen stamina to a fine grid: the per-tick increment
  // (3 × 1/15 = 0.2) is inexact in binary, and ten accumulations reach
  // 1.9999999999999998 — one hair short of a 2-cost jab, so the gate blocked
  // an attack the HUD said you could afford (audit M3). A 1e-9 quantum erases
  // the drift without touching the balance numbers.
  const regenerated = regenStamina(
    playerCombatant(player),
    STAMINA_REGEN_PER_SEC * dt,
  ).stamina;
  player = {
    ...player,
    stamina: Math.round(regenerated * 1e9) / 1e9,
  };

  // --- Survivors advance toward the player's new position. ---
  if (enemies !== undefined) {
    // Home ground is impassable to enemies (TQ-013): the safe zone is enforced
    // where they *step*, so the swarm parts around the base rather than needing
    // a bespoke AI mode. Growth can't entomb anyone either — the growth branch
    // above evicts enemies the new ring swallows.
    const home = base; // narrow once for the closure
    const walkable = (ex: number, ey: number): boolean =>
      isWalkable(state.world, ex, ey) &&
      (home === undefined || !inBase(home, ex, ey));
    enemies = enemies.map((live): LiveEnemy => {
      const next = stepEnemy(
        steppingEnemy(live.enemy),
        live.ai,
        player.pos,
        walkable,
        dt,
      );
      // Take only the new position back onto the real enemy, so a transient
      // enrage speed boost (steppingEnemy) never persists on the stored entity.
      return { enemy: { ...live.enemy, pos: next.enemy.pos }, ai: next.ai };
    });

    // --- Contact damage: adjacent enemies chip the player (floored at 0). ---
    // contactDamage is flat-per-tick by design (TQ-023): unlike the dt-scaled
    // movement/regen above, contact DPS is `atk × tickRate`, an accepted
    // invariant while SIM_DT is fixed. A dt-scaled rate was rejected — it can't
    // reproduce today's exact integer damage in IEEE-754. See contactDamage in
    // entities.ts; revisit both if SIM_DT ever becomes tunable.
    // No contact damage lands on home ground (TQ-013) — enemies can't enter the
    // zone, but one standing just outside its edge is still adjacent to a player
    // standing just inside; the exemption is what makes the base actually safe.
    const playerHome =
      base !== undefined && inBase(base, player.pos.x, player.pos.y);
    if (!playerHome) {
      let contact = 0;
      for (const { enemy } of enemies) {
        contact += contactDamage(enemy, player.pos);
      }
      if (contact > 0) {
        player = { ...player, hp: Math.max(0, player.hp - contact) };
      }
    }
  }

  // --- Home ground heals (TQ-013): the breather, made tangible. Gentle regen
  // toward the effective ceiling (progression + base buff); safe because the
  // zone already blocks entry and contact, so this can never tug against
  // same-tick damage. ---
  if (base !== undefined && inBase(base, player.pos.x, player.pos.y)) {
    const ceiling = effectiveMaxHp(player, base);
    if (player.hp < ceiling) {
      player = {
        ...player,
        hp: Math.min(ceiling, player.hp + BASE_HP_REGEN_PER_SEC * dt),
      };
    }
  }

  // --- Defeat: hp depleted ends the run (TQ-020). Sticky like victory, and set
  // only while still 'playing' so that clearing the last boss *this same tick*
  // (a 'victory' set in the cull step above) is never overridden by a
  // simultaneous contact death — if you won, you won. The visible defeat screen
  // and the loop halt are a later TQ-020 PR; this is just the sim-side trigger,
  // set-but-not-yet-presented exactly like 'victory'. (`<= 0` excludes a
  // non-finite hp, matching the engine's NaN-fails-safe stance.) ---
  if (status === 'playing' && player.hp <= 0) {
    status = 'defeat';
  }

  return {
    ...state,
    player,
    enemies,
    pickups,
    tooTired,
    bossesDefeated,
    defeatedBossIds,
    base,
    status,
    hitEvents,
    tick: state.tick + 1,
  };
}
