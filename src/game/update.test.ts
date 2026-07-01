import { describe, it, expect } from 'vitest';
import { update, BASE_HP_REGEN_PER_SEC, SIM_DT_SECONDS } from './update.js';
import {
  type Base,
  BOSSES_PER_TIER,
  HP_BONUS_PER_TIER,
  createBase,
} from './base.js';
import {
  DUNGEON_ENEMY_COUNT,
  DUNGEON_REWARD,
  DUNGEON_WIDTH,
} from './dungeon.js';
import {
  createPlayer,
  isWalkable,
  type GameState,
  type LiveEnemy,
  type Player,
  type Tile,
  type World,
} from './state.js';
import { createEnemy, type SwarmKind } from './enemy.js';
import { createEnemyAi } from './entities.js';
import {
  BASE_HP,
  createProgression,
  gainXp,
  xpForKill,
  xpToNext,
} from './progression.js';
import type { RngFn } from './combat.js';
import { createBoss, type BossSpec, TOTAL_BOSSES } from '../data/bosses.js';

/** One tick in seconds — the unit `update` advances the sim by. */
const TICK = SIM_DT_SECONDS;

/** RNG that throws on any call — proves a tick consumed no randomness. */
const noRng: RngFn = () => {
  throw new Error('rng must not be called');
};

/** A scriptable RNG: yields queued rolls in order, throwing if over-drawn. */
function scriptedRng(values: number[]): RngFn {
  let i = 0;
  return () => {
    if (i >= values.length)
      throw new Error('scriptedRng drained — unexpected extra roll');
    return values[i++]!;
  };
}

/** A 3x3 plus-shaped floor with wall corners — the movement fixture. */
function plusWorld(): World {
  const F: Tile = 'floor';
  const W: Tile = 'wall';
  const tiles: Tile[][] = [
    [W, F, W],
    [F, F, F],
    [W, F, W],
  ];
  return { width: 3, height: 3, tiles, seed: 0 };
}

/** A fully-open w×h floor — lets enemies actually path across it. */
function openWorld(w: number, h: number): World {
  const tiles: Tile[][] = Array.from({ length: h }, () =>
    Array.from({ length: w }, (): Tile => 'floor'),
  );
  return { width: w, height: h, tiles, seed: 0 };
}

function liveEnemy(kind: SwarmKind, x: number, y: number): LiveEnemy {
  return { enemy: createEnemy(kind, { x, y }), ai: createEnemyAi() };
}

/** A LiveEnemy already at 0 hp — "slain", for exercising the kill→XP cull. */
function deadEnemy(kind: SwarmKind, x: number, y: number): LiveEnemy {
  const base = liveEnemy(kind, x, y);
  return { ...base, enemy: { ...base.enemy, hp: 0 } };
}

function makeState(
  opts: {
    world?: World;
    player?: Player;
    enemies?: readonly LiveEnemy[];
  } = {},
): GameState {
  return {
    world: opts.world ?? plusWorld(),
    player: opts.player ?? createPlayer({ x: 1, y: 1 }),
    enemies: opts.enemies,
    tooTired: false,
    tick: 0,
  };
}

describe('update — movement', () => {
  it('moves the player onto a floor tile', () => {
    const next = update(
      makeState(),
      [{ type: 'move', dx: 1, dy: 0 }],
      TICK,
      noRng,
    );
    expect(next.player.pos).toEqual({ x: 2, y: 1 });
  });

  it('blocks an orthogonal move into a wall', () => {
    // From the top of the plus (1,0), a leftward step targets the (0,0) corner
    // wall. It is orthogonal — no diagonal slide applies — so the player stays.
    // (A blocked *diagonal* slides instead; see the wall-slide suite below.)
    const next = update(
      makeState({ player: createPlayer({ x: 1, y: 0 }) }),
      [{ type: 'move', dx: -1, dy: 0 }],
      TICK,
      noRng,
    );
    expect(next.player.pos).toEqual({ x: 1, y: 0 });
  });

  it('increments the tick every call', () => {
    expect(update(makeState(), [], TICK, noRng).tick).toBe(1);
  });

  it('is pure — does not mutate the input state', () => {
    const before = makeState();
    update(before, [{ type: 'move', dx: 1, dy: 0 }], TICK, noRng);
    expect(before.player.pos).toEqual({ x: 1, y: 1 });
    expect(before.tick).toBe(0);
  });

  it('advances at most one tile for a batch of same-direction intents', () => {
    const next = update(
      makeState(),
      [
        { type: 'move', dx: 1, dy: 0 },
        { type: 'move', dx: 1, dy: 0 },
      ],
      TICK,
      noRng,
    );
    expect(next.player.pos).toEqual({ x: 2, y: 1 });
  });

  it('applies only the valid step when a blocked intent precedes a valid one', () => {
    const next = update(
      makeState(),
      [
        { type: 'move', dx: -1, dy: -1 },
        { type: 'move', dx: 1, dy: 0 },
      ],
      TICK,
      noRng,
    );
    expect(next.player.pos).toEqual({ x: 2, y: 1 });
  });

  it('takes a diagonal step when its target tile is floor', () => {
    // The plus fixture has wall corners, so prove the diagonal *succeeds* on an
    // open 2x2 world: from (0,0) a {dx:1,dy:1} intent lands on the (1,1) floor.
    const next = update(
      makeState({
        world: openWorld(2, 2),
        player: createPlayer({ x: 0, y: 0 }),
      }),
      [{ type: 'move', dx: 1, dy: 1 }],
      TICK,
      noRng,
    );
    expect(next.player.pos).toEqual({ x: 1, y: 1 });
  });

  it('takes only the last of two perpendicular intents — no diagonal combine', () => {
    // "right" then "up" from the center: the engine keeps the last move only, so
    // the player ends at (1,0) (up). A combined step would aim at (2,0) — a wall
    // — landing nowhere; (1,0) distinguishes last-wins from any combine.
    const next = update(
      makeState(),
      [
        { type: 'move', dx: 1, dy: 0 },
        { type: 'move', dx: 0, dy: -1 },
      ],
      TICK,
      noRng,
    );
    expect(next.player.pos).toEqual({ x: 1, y: 0 });
  });

  it('increments the tick by exactly 1 regardless of intent count', () => {
    expect(update(makeState(), [], TICK, noRng).tick).toBe(1);
    expect(
      update(
        makeState(),
        [
          { type: 'move', dx: 1, dy: 0 },
          { type: 'move', dx: 0, dy: 1 },
          { type: 'move', dx: -1, dy: 0 },
        ],
        TICK,
        noRng,
      ).tick,
    ).toBe(1);
  });
});

describe('update — diagonal wall-slide (TQ-017)', () => {
  // A compact 3x3 world: '#' = wall, '.' = floor. The player starts at the
  // centre (1,1) and pushes up-right {dx:1, dy:-1}, whose diagonal target is the
  // top-right corner (2,0). Each case walls a different combination so the
  // per-axis slide is exercised in isolation.
  const world = (rows: [string, string, string]): World => ({
    width: 3,
    height: 3,
    tiles: rows.map((row) =>
      [...row].map((c): Tile => (c === '#' ? 'wall' : 'floor')),
    ),
    seed: 0,
  });
  const pushUpRight = (rows: [string, string, string]): GameState =>
    update(
      makeState({ world: world(rows), player: createPlayer({ x: 1, y: 1 }) }),
      [{ type: 'move', dx: 1, dy: -1 }],
      TICK,
      noRng,
    );

  it('slides horizontally when the diagonal and the vertical are blocked', () => {
    // corner (2,0) and the tile above (1,0) are walls; the side (2,1) is open.
    expect(pushUpRight(['.##', '...', '...']).player.pos).toEqual({
      x: 2,
      y: 1,
    });
  });

  it('slides vertically when the diagonal and the horizontal are blocked', () => {
    // corner (2,0) and the side (2,1) are walls; the tile above (1,0) is open.
    expect(pushUpRight(['..#', '..#', '...']).player.pos).toEqual({
      x: 1,
      y: 0,
    });
  });

  it('stays put when the diagonal and both orthogonals are blocked', () => {
    // corner (2,0), above (1,0), and side (2,1) all walls → nowhere to slide.
    expect(pushUpRight(['.##', '..#', '...']).player.pos).toEqual({
      x: 1,
      y: 1,
    });
  });

  it('prefers the horizontal at an outer corner where both orthogonals are open', () => {
    // only the diagonal corner (2,0) is a wall; (2,1) and (1,0) are both open —
    // the deterministic tie-break takes the horizontal step.
    expect(pushUpRight(['..#', '...', '...']).player.pos).toEqual({
      x: 2,
      y: 1,
    });
  });
});

describe('update — attacks spend stamina and damage enemies', () => {
  it('a bound attack spends stamina and damages an enemy in radius', () => {
    const state = makeState({ enemies: [liveEnemy('grunt', 2, 1)] }); // adjacent, hp 10
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      scriptedRng([0]), // 0 < 0.9 → hit
    );
    // damage = base 2 + player atk 3 - def 0 = 5 → 10 - 5
    expect(next.enemies![0]!.enemy.hp).toBe(5);
    // spent the jab's cost (2), then regenerated a sliver this tick
    expect(next.player.stamina).toBeCloseTo(10 - 2 + 3 * TICK);
    expect(next.tooTired).toBe(false);
  });

  it('culls an enemy the attack kills before it can bite that tick', () => {
    const state = makeState({ enemies: [liveEnemy('runner', 2, 1)] }); // hp 5, adjacent
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      scriptedRng([0]),
    );
    // 5 damage on a 5-hp runner → dead → removed
    expect(next.enemies).toHaveLength(0);
    // The cull happens before contact damage, so this adjacent runner — killed
    // this very tick — deals no contact: the player is untouched.
    expect(next.player.hp).toBe(20);
  });

  it('applies no damage and culls nothing when the hit-chance roll misses', () => {
    const state = makeState({ enemies: [liveEnemy('grunt', 2, 1)] }); // in radius, hp 10
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      scriptedRng([0.95]), // 0.95 ≥ 0.9 hitChance → miss
    );
    expect(next.enemies).toHaveLength(1);
    expect(next.enemies![0]!.enemy.hp).toBe(10); // whiffed — unscathed
    // ...but the swing still cost stamina: you pay for a miss.
    expect(next.player.stamina).toBeCloseTo(10 - 2 + 3 * TICK);
  });

  it('blocks the attack when stamina is too low: flags tooTired, deals no damage', () => {
    const player: Player = { ...createPlayer({ x: 1, y: 1 }), stamina: 1 };
    const state = makeState({ player, enemies: [liveEnemy('grunt', 2, 1)] });
    // quick-jab costs 2 > 1 stamina → blocked; the blocked path rolls no RNG.
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      noRng,
    );
    expect(next.tooTired).toBe(true);
    expect(next.enemies![0]!.enemy.hp).toBe(10); // untouched
    expect(next.player.stamina).toBeCloseTo(1 + 3 * TICK); // not spent, only regen
  });

  it('does not mutate the input state when resolving an attack', () => {
    const state = makeState({ enemies: [liveEnemy('grunt', 2, 1)] });
    update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      scriptedRng([0]),
    );
    expect(state.enemies![0]!.enemy.hp).toBe(10);
    expect(state.player.stamina).toBe(10);
    expect(state.tooTired).toBe(false);
  });

  it('zips rolled damage back onto the right enemies and preserves order', () => {
    // Three brutes (hp 25) below the player at (5,5): two inside the maelstrom's
    // radius 4 (dist² 4 and 9 ≤ 16), one outside (dist² 49 > 16). Only the
    // in-radius pair is rolled for; the write-back must hit those two by index
    // and leave the far one — and the array order — intact. (scriptedRng has
    // exactly two values, so a stray roll for the out-of-radius enemy throws.)
    const state = makeState({
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [
        liveEnemy('brute', 5, 7),
        liveEnemy('brute', 5, 8),
        liveEnemy('brute', 5, 12),
      ],
    });
    const next = update(
      state,
      [{ type: 'attack', attackId: 'whirling-maelstrom' }],
      TICK,
      scriptedRng([0, 0]),
    );
    // dmg = base 10 + atk 3 = 13 → 25 - 13 = 12 for the two in radius
    expect(next.enemies![0]!.enemy.hp).toBe(12);
    expect(next.enemies![1]!.enemy.hp).toBe(12);
    expect(next.enemies![2]!.enemy.hp).toBe(25); // out of radius — untouched
    expect(next.enemies![2]!.enemy.pos).toEqual({ x: 5, y: 12 }); // order preserved
  });
});

describe('update — weapons: equip on pickup + boosted damage (TQ-010)', () => {
  it('walking onto a pickup equips it to the single slot and removes it', () => {
    // Player at (1,1) steps right onto a pickup at (2,1).
    const state: GameState = {
      ...makeState(),
      pickups: [{ pos: { x: 2, y: 1 }, weaponId: 'iron-sword' }],
    };
    const next = update(state, [{ type: 'move', dx: 1, dy: 0 }], TICK, noRng);
    expect(next.player.pos).toEqual({ x: 2, y: 1 });
    expect(next.player.weapon).toBe('iron-sword');
    expect(next.pickups).toEqual([]); // consumed
  });

  it('the latest pickup wins when several share the stepped-onto tile', () => {
    const state: GameState = {
      ...makeState(),
      pickups: [
        { pos: { x: 2, y: 1 }, weaponId: 'rusted-dagger' },
        { pos: { x: 2, y: 1 }, weaponId: 'warhammer' },
      ],
    };
    const next = update(state, [{ type: 'move', dx: 1, dy: 0 }], TICK, noRng);
    expect(next.player.weapon).toBe('warhammer'); // last on the tile
    expect(next.pickups).toEqual([]); // the whole pile is consumed
  });

  it('a new pickup replaces the previously equipped weapon (single slot)', () => {
    const player: Player = {
      ...createPlayer({ x: 1, y: 1 }),
      weapon: 'warhammer',
    };
    const state: GameState = {
      ...makeState({ player }),
      pickups: [{ pos: { x: 2, y: 1 }, weaponId: 'rusted-dagger' }],
    };
    const next = update(state, [{ type: 'move', dx: 1, dy: 0 }], TICK, noRng);
    expect(next.player.weapon).toBe('rusted-dagger');
  });

  it('leaves a pickup untouched when the player only passes near it', () => {
    // Player at (1,1) moves down to (1,2); the pickup at (2,1) is not stepped on.
    const state: GameState = {
      ...makeState(),
      pickups: [{ pos: { x: 2, y: 1 }, weaponId: 'iron-sword' }],
    };
    const next = update(state, [{ type: 'move', dx: 0, dy: 1 }], TICK, noRng);
    expect(next.player.weapon).toBeUndefined();
    expect(next.pickups).toHaveLength(1);
  });

  it('an equipped weapon adds its damageBonus to the attack (reuses the combat path)', () => {
    // Equip the iron-sword (+4 damage) up front, then jab an adjacent grunt:
    // base 2 + bonus 4 + atk 3 - def 0 = 9 → 10 - 9 = 1 (vs 5 unarmed).
    const player: Player = {
      ...createPlayer({ x: 1, y: 1 }),
      weapon: 'iron-sword',
    };
    const state = makeState({ player, enemies: [liveEnemy('grunt', 2, 1)] });
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      scriptedRng([0]),
    );
    expect(next.enemies![0]!.enemy.hp).toBe(1);
  });

  it('a weapon picked up this tick already swings boosted on the same tick', () => {
    // Player at (1,1) steps onto the iron-sword at (2,1) AND jabs; the grunt sits
    // at (2,0), adjacent to the new position. Equip happens before the attack, so
    // the boosted damage (9) lands this tick, not next: 10 - 9 = 1.
    const state: GameState = {
      ...makeState({ enemies: [liveEnemy('grunt', 2, 0)] }),
      pickups: [{ pos: { x: 2, y: 1 }, weaponId: 'iron-sword' }],
    };
    const next = update(
      state,
      [
        { type: 'move', dx: 1, dy: 0 },
        { type: 'attack', attackId: 'quick-jab' },
      ],
      TICK,
      scriptedRng([0]),
    );
    expect(next.player.weapon).toBe('iron-sword');
    expect(next.enemies![0]!.enemy.hp).toBe(1);
  });

  it('unarmed leaves the attack unchanged (no slot, no bonus)', () => {
    const state = makeState({ enemies: [liveEnemy('grunt', 2, 1)] });
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      scriptedRng([0]),
    );
    // base 2 + atk 3 = 5 → 10 - 5 = 5, the unarmed baseline.
    expect(next.player.weapon).toBeUndefined();
    expect(next.enemies![0]!.enemy.hp).toBe(5);
  });
});

describe('update — risk/reward: low vs high attacks differ in play', () => {
  // One enemy three tiles straight below the player: out of the jab's radius 1.5
  // (dist² 9 > 2.25), inside the maelstrom's radius 4. Same press, very
  // different outcomes.
  const farEnemy = (): LiveEnemy => liveEnemy('grunt', 1, 4);

  it('the cheap jab cannot reach a distant enemy (and rolls no RNG for it)', () => {
    const state = makeState({ enemies: [farEnemy()] });
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      noRng, // out of radius → no roll consumed
    );
    expect(next.enemies![0]!.enemy.hp).toBe(10); // unscathed
    expect(next.tooTired).toBe(false); // stamina was spent, just nothing hit
    // You pay the cost even when the swing reaches nothing.
    expect(next.player.stamina).toBeCloseTo(10 - 2 + 3 * TICK);
  });

  it('the expensive maelstrom reaches and flattens the same enemy', () => {
    const state = makeState({ enemies: [farEnemy()] });
    const next = update(
      state,
      [{ type: 'attack', attackId: 'whirling-maelstrom' }],
      TICK,
      scriptedRng([0]),
    );
    // base 10 + atk 3 = 13 damage on a 10-hp grunt → dead
    expect(next.enemies).toHaveLength(0);
  });
});

describe('update — render-only hit events (TQ-015 juice)', () => {
  it('emits one hit event at the struck enemy with the rolled damage', () => {
    // grunt adjacent at (2,1); quick-jab lands for base 2 + atk 3 = 5 (< 8, so
    // not "big"). The event anchors at the enemy's pre-move cell.
    const state = makeState({ enemies: [liveEnemy('grunt', 2, 1)] });
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      scriptedRng([0]),
    );
    expect(next.hitEvents).toEqual([
      { pos: { x: 2, y: 1 }, amount: 5, big: false },
    ]);
  });

  it('flags a high-damage hit as "big" (the screen-shake trigger)', () => {
    // brute at (5,7) below the player at (5,5), inside the maelstrom radius 4.
    // base 10 + atk 3 = 13 ≥ BIG_HIT_DAMAGE → big. The 25-hp brute survives, so
    // the event reflects a landed (not lethal) hit.
    const state = makeState({
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [liveEnemy('brute', 5, 7)],
    });
    const next = update(
      state,
      [{ type: 'attack', attackId: 'whirling-maelstrom' }],
      TICK,
      scriptedRng([0]),
    );
    expect(next.hitEvents).toEqual([
      { pos: { x: 5, y: 7 }, amount: 13, big: true },
    ]);
  });

  it('emits no hit events on a miss, a block, or a tick with no attack', () => {
    const enemies = [liveEnemy('grunt', 2, 1)];
    const miss = update(
      makeState({ enemies }),
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      scriptedRng([0.95]), // ≥ 0.9 hitChance → miss
    );
    expect(miss.hitEvents).toEqual([]);

    const tired: Player = { ...createPlayer({ x: 1, y: 1 }), stamina: 0 };
    const blocked = update(
      makeState({ player: tired, enemies }),
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      noRng,
    );
    expect(blocked.hitEvents).toEqual([]);

    const idle = update(makeState({ enemies }), [], TICK, noRng);
    expect(idle.hitEvents).toEqual([]);
  });

  it('does not read hit events back into the rules (pure OUTPUT)', () => {
    // A state carrying stale hitEvents must advance identically to one without:
    // update writes hitEvents but never consumes them, so determinism holds.
    const base = makeState({ enemies: [liveEnemy('grunt', 2, 1)] });
    const withStale: GameState = {
      ...base,
      hitEvents: [{ pos: { x: 99, y: 99 }, amount: 999, big: true }],
    };
    const a = update(base, [], TICK, noRng);
    const b = update(withStale, [], TICK, noRng);
    expect({ ...b, hitEvents: a.hitEvents }).toEqual(a);
  });
});

describe('update — attack reach (Euclidean radius vs the contact 8-ring)', () => {
  it('the jab reaches a diagonal neighbour — radius 1.5 covers the 8-ring', () => {
    // (2,2) is diagonally adjacent to the player at (1,1): Euclidean dist² = 2,
    // inside 1.5² = 2.25. This is the very cell an enemy contact-bites from, so
    // the cheapest attack must reach it; a radius-1 jab (dist² 1) would not.
    const state = makeState({ enemies: [liveEnemy('grunt', 2, 2)] });
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      scriptedRng([0]),
    );
    expect(next.enemies![0]!.enemy.hp).toBe(5); // 10 - (base 2 + atk 3)
  });

  it('the jab stops at the 8-ring — the next tile out (dist² = 4) is safe', () => {
    // (3,1) is two tiles away (dist² = 4 > 2.25): outside the jab. noRng proves
    // the engine consumes no roll for an out-of-radius target.
    const state = makeState({ enemies: [liveEnemy('grunt', 3, 1)] });
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      noRng,
    );
    expect(next.enemies![0]!.enemy.hp).toBe(10); // out of reach — untouched
  });
});

describe('update — the stamina gate: mash, block, regen, reopen', () => {
  it('mashing one attack drains stamina to a block, and regen reopens it', () => {
    let state = makeState({ enemies: [] }); // attack the void: isolates stamina
    const blocked: boolean[] = [];
    // Mash quick-jab (cost 2, regen 3*TICK≈0.2/tick → net drain) every tick.
    for (let i = 0; i < 20; i++) {
      state = update(
        state,
        [{ type: 'attack', attackId: 'quick-jab' }],
        TICK,
        noRng,
      );
      blocked.push(state.tooTired);
    }
    const firstBlock = blocked.indexOf(true);
    expect(firstBlock).toBeGreaterThan(0); // it took several swings to run dry
    // While blocked, stamina regenerates until a later swing lands again.
    expect(blocked.slice(firstBlock + 1)).toContain(false);
  });
});

describe('update — enemies are wired into the tick', () => {
  it('advances an enemy toward the player over several ticks', () => {
    const state = makeState({
      world: openWorld(10, 3),
      player: createPlayer({ x: 1, y: 1 }),
      enemies: [liveEnemy('grunt', 8, 1)],
    });
    let s = state;
    for (let i = 0; i < 30; i++) s = update(s, [], TICK, noRng);
    expect(s.enemies![0]!.enemy.pos.x).toBeLessThan(8); // closed the distance
  });

  it('chips the player via adjacent enemy contact damage', () => {
    const state = makeState({ enemies: [liveEnemy('grunt', 2, 1)] }); // grunt atk 2
    const next = update(state, [], TICK, noRng);
    expect(next.player.hp).toBe(18); // 20 - 2
  });

  it('floors player hp at 0 under lethal contact — never negative', () => {
    // A 3-hp player next to a brute (atk 5): 3 - 5 must clamp to 0, not -2, so
    // downstream HUD/death logic (TQ-008) never sees negative hp.
    const player: Player = { ...createPlayer({ x: 1, y: 1 }), hp: 3 };
    const state = makeState({ player, enemies: [liveEnemy('brute', 2, 1)] });
    const next = update(state, [], TICK, noRng);
    expect(next.player.hp).toBe(0);
  });
});

describe('update — player defeat (TQ-020)', () => {
  it("flips status to 'defeat' when contact damage depletes the player's hp", () => {
    const player: Player = { ...createPlayer({ x: 1, y: 1 }), hp: 3 };
    const state = makeState({ player, enemies: [liveEnemy('brute', 2, 1)] }); // atk 5
    const next = update(state, [], TICK, noRng);
    expect(next.player.hp).toBe(0);
    expect(next.status).toBe('defeat');
  });

  it("stays 'playing' while the player still has hp", () => {
    const state = makeState({ enemies: [liveEnemy('grunt', 2, 1)] }); // atk 2, 20hp
    const next = update(state, [], TICK, noRng);
    expect(next.player.hp).toBe(18);
    expect(next.status).toBe('playing');
  });

  it("keeps 'defeat' sticky across a later tick", () => {
    const player: Player = { ...createPlayer({ x: 1, y: 1 }), hp: 3 };
    const dead = update(
      makeState({ player, enemies: [liveEnemy('brute', 2, 1)] }),
      [],
      TICK,
      noRng,
    );
    expect(dead.status).toBe('defeat');
    expect(update(dead, [], TICK, noRng).status).toBe('defeat');
  });

  it("never overrides a 'victory' set the same tick the player dies (you won)", () => {
    // A run already 'victory' with the player simultaneously at lethal contact
    // must stay 'victory': the terminal status is sticky and 'defeat' is only set
    // while still 'playing'. Models clearing the last boss and dying in one tick.
    const player: Player = { ...createPlayer({ x: 1, y: 1 }), hp: 3 };
    const state: GameState = {
      ...makeState({ player, enemies: [liveEnemy('brute', 2, 1)] }),
      status: 'victory',
    };
    const next = update(state, [], TICK, noRng);
    expect(next.player.hp).toBe(0);
    expect(next.status).toBe('victory');
  });
});

describe('update — kill → XP hook (TQ-009)', () => {
  it('removes a slain enemy (hp ≤ 0) and awards its XP to the player', () => {
    // Dead grunt on the player's cell (culled before it could bite); a live
    // runner far away survives the tick.
    const state = makeState({
      enemies: [deadEnemy('grunt', 1, 1), liveEnemy('runner', 20, 20)],
    });
    const next = update(state, [], TICK, noRng);

    expect(next.enemies).toHaveLength(1);
    expect(next.enemies![0]!.enemy.kind).toBe('runner');
    expect(next.player.progress?.level).toBe(1);
    expect(next.player.progress?.xp).toBe(xpForKill({ maxHp: 10, atk: 2 }));
  });

  it('levels the player up when a kill crosses the XP threshold', () => {
    const reward = xpForKill({ maxHp: 25, atk: 5 }); // brute
    // Decouple from brute's concrete stats: the kill is worth at least one level
    // but fewer than two, so a rebalance trips these preconditions, not the test.
    expect(reward).toBeGreaterThanOrEqual(xpToNext(1));
    expect(reward).toBeLessThan(xpToNext(1) + xpToNext(2));

    const state = makeState({ enemies: [deadEnemy('brute', 1, 1)] });
    const next = update(state, [], TICK, noRng);

    expect(next.enemies).toHaveLength(0);
    expect(next.player.progress?.level).toBe(2);
  });

  it('refills hp/stamina to the new ceilings on level-up (TQ-023)', () => {
    // A damaged player whose kill crosses a level threshold comes out topped up
    // to the *new* (higher) caps — the level-up surge, not just added headroom.
    const reward = xpForKill({ maxHp: 25, atk: 5 }); // brute — worth ≥ one level
    expect(reward).toBeGreaterThanOrEqual(xpToNext(1));

    const hurt: Player = { ...createPlayer({ x: 1, y: 1 }), hp: 4, stamina: 1 };
    const next = update(
      makeState({ player: hurt, enemies: [deadEnemy('brute', 1, 1)] }),
      [],
      TICK,
      noRng,
    );

    const p = next.player.progress!;
    expect(p.level).toBe(2);
    expect(next.player.hp).toBe(p.maxHp); // fully refilled to the new cap
    expect(next.player.stamina).toBe(p.maxStamina);
  });

  it('does not refill on a kill that does not level you up (TQ-023)', () => {
    // A single grunt is worth less than the first threshold: no level, no heal.
    const reward = xpForKill({ maxHp: 10, atk: 2 }); // grunt
    expect(reward).toBeLessThan(xpToNext(1));

    const hurt: Player = { ...createPlayer({ x: 1, y: 1 }), hp: 4, stamina: 1 };
    const next = update(
      makeState({ player: hurt, enemies: [deadEnemy('grunt', 1, 1)] }),
      [],
      TICK,
      noRng,
    );

    expect(next.player.progress?.level).toBe(1);
    expect(next.player.hp).toBe(4); // unchanged — no level-up, no refill
  });

  it('defaults a fresh progression for a player that had none', () => {
    const player: Player = { pos: { x: 1, y: 1 }, hp: 20, stamina: 10, def: 0 };
    const state = makeState({ player, enemies: [deadEnemy('grunt', 1, 1)] });
    const next = update(state, [], TICK, noRng);

    expect(next.player.progress?.level).toBe(1);
    expect(next.player.progress?.xp).toBe(xpForKill({ maxHp: 10, atk: 2 }));
  });

  it('keeps a non-finite-hp enemy in the world (partition is exhaustive)', () => {
    const cursed: LiveEnemy = {
      enemy: { ...createEnemy('grunt', { x: 20, y: 20 }), hp: NaN },
      ai: createEnemyAi(),
    };
    const state = makeState({ enemies: [deadEnemy('grunt', 1, 1), cursed] });
    const next = update(state, [], TICK, noRng);

    // The genuinely dead grunt is removed; the NaN-hp enemy neither dies nor
    // vanishes — it stays put rather than falling through both predicates.
    expect(next.enemies).toHaveLength(1);
    expect(Number.isNaN(next.enemies![0]!.enemy.hp)).toBe(true);
  });

  it('leaves a movement-only state (no enemies) untouched by the hook', () => {
    const player: Player = { pos: { x: 1, y: 1 }, hp: 20, stamina: 10, def: 0 };
    const next = update(makeState({ player }), [], TICK, noRng);
    expect(next.enemies).toBeUndefined();
    expect(next.player.progress).toBeUndefined();
  });

  it('is pure — does not mutate the input enemies or player', () => {
    const slain = deadEnemy('grunt', 1, 1);
    const progress = createProgression();
    const player: Player = {
      pos: { x: 1, y: 1 },
      hp: 20,
      stamina: 10,
      def: 0,
      progress,
    };
    const state = makeState({ player, enemies: [slain] });

    update(state, [], TICK, noRng);

    expect(state.enemies![0]!.enemy.hp).toBe(0);
    expect(state.player.progress).toEqual(progress);
  });
});

describe('update — bosses & victory', () => {
  /** A pure stat-wall boss (no signature behaviour). */
  const wall: BossSpec = {
    id: 'wall',
    name: 'Wall',
    hp: 100,
    atk: 6,
    def: 0,
    speed: 3,
    glyph: 'W',
    color: 'red',
    signature: { kind: 'none' },
  };

  /** A fast enrage boss, for isolating the signature speed boost in `advance`. */
  const berserker: BossSpec = {
    id: 'berserker',
    name: 'Berserker',
    hp: 100,
    atk: 6,
    def: 0,
    speed: 6,
    glyph: 'Z',
    color: 'red',
    signature: { kind: 'enrage', below: 0.4, speedMultiplier: 2 },
  };

  /** A live boss of `spec` at (x, y), optionally pre-damaged to `hp`. */
  function liveBoss(
    spec: BossSpec,
    x: number,
    y: number,
    hp?: number,
  ): LiveEnemy {
    const boss = createBoss(spec, { x, y });
    return {
      enemy: hp === undefined ? boss : { ...boss, hp },
      ai: createEnemyAi(),
    };
  }

  /** Run `n` input-free ticks (no attack ⇒ the rng is never consumed). */
  function runTicks(state: GameState, n: number): GameState {
    let s = state;
    for (let i = 0; i < n; i++) s = update(s, [], TICK, noRng);
    return s;
  }

  it('a boss killed by an attack increments the count but does not yet win', () => {
    expect(TOTAL_BOSSES).toBeGreaterThan(1); // the "not yet" half assumes >1 boss
    const state: GameState = {
      world: openWorld(10, 10),
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [liveBoss(wall, 6, 5, 1)],
      bossesDefeated: 0,
      tooTired: false,
      tick: 0,
    };
    // Quick Jab (radius 1.5) reaches the adjacent boss; a 0 roll lands the hit.
    const next = update(
      state,
      [{ type: 'attack', attackId: 'quick-jab' }],
      TICK,
      scriptedRng([0]),
    );

    expect(next.enemies).toHaveLength(0);
    expect(next.bossesDefeated).toBe(1);
    expect(next.status).toBe('playing'); // 1 < TOTAL_BOSSES
  });

  it("records a slain boss's id alongside the count (TQ-022)", () => {
    const state: GameState = {
      world: openWorld(10, 10),
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [liveBoss(wall, 2, 2, 0), deadEnemy('grunt', 8, 8)],
      bossesDefeated: 0,
      tooTired: false,
      tick: 0,
    };
    const next = update(state, [], TICK, noRng);
    // Identity twin of the count: only the boss's id, never the grunt's kind.
    expect(next.defeatedBossIds).toEqual(['wall']);
    expect(next.bossesDefeated).toBe(1);
  });

  it('appends to existing defeatedBossIds without dropping earlier kills', () => {
    const state: GameState = {
      world: openWorld(10, 10),
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [liveBoss(berserker, 2, 2, 0)],
      bossesDefeated: 1,
      defeatedBossIds: ['wall'],
      tooTired: false,
      tick: 0,
    };
    const next = update(state, [], TICK, noRng);
    expect(next.defeatedBossIds).toEqual(['wall', 'berserker']);
    expect(next.bossesDefeated).toBe(2);
  });

  it('leaves defeatedBossIds untouched on a tick where no boss dies', () => {
    const state = makeState({ enemies: [deadEnemy('grunt', 1, 1)] });
    const next = update(state, [], TICK, noRng);
    expect(next.defeatedBossIds).toBeUndefined();
  });

  it('declares victory once the whole roster (TOTAL_BOSSES) is down', () => {
    // Pre-slain bosses, one per roster slot, all culled this tick → the count
    // reaches TOTAL_BOSSES and the run flips to victory. Generic over the roster
    // size so growing it to 10 keeps the test honest.
    const enemies = Array.from({ length: TOTAL_BOSSES }, (_, i) =>
      liveBoss(wall, i, 0, 0),
    );
    const state: GameState = {
      world: openWorld(Math.max(TOTAL_BOSSES, 2) + 1, 2),
      player: createPlayer({ x: 0, y: 1 }),
      enemies,
      bossesDefeated: 0,
      tooTired: false,
      tick: 0,
    };
    const next = update(state, [], TICK, noRng);

    expect(next.enemies).toHaveLength(0);
    expect(next.bossesDefeated).toBe(TOTAL_BOSSES);
    expect(next.status).toBe('victory');
  });

  it('never declares victory in a state with no bosses', () => {
    const state = makeState({ enemies: [deadEnemy('grunt', 1, 1)] });
    const next = update(state, [], TICK, noRng);
    expect(next.bossesDefeated).toBe(0);
    expect(next.status).toBe('playing');
  });

  it('counts only the bosses among a mixed swarm+boss wipe in one tick', () => {
    expect(TOTAL_BOSSES).toBeGreaterThan(1); // so one boss down ⇒ not yet victory
    // A boss and a grunt both fall this tick; only the boss must increment the
    // count — guards the `isBoss` filter (counting all slain would read 2).
    const state: GameState = {
      world: openWorld(10, 10),
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [liveBoss(wall, 2, 2, 0), deadEnemy('grunt', 8, 8)],
      bossesDefeated: 0,
      tooTired: false,
      tick: 0,
    };
    const next = update(state, [], TICK, noRng);

    expect(next.enemies).toHaveLength(0);
    expect(next.bossesDefeated).toBe(1);
    expect(next.status).toBe('playing');
  });

  it('keeps victory sticky across a later tick', () => {
    const state: GameState = {
      world: openWorld(10, 10),
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [],
      bossesDefeated: TOTAL_BOSSES,
      status: 'victory',
      tooTired: false,
      tick: 0,
    };
    const next = update(state, [], TICK, noRng);
    expect(next.status).toBe('victory');
    expect(next.bossesDefeated).toBe(TOTAL_BOSSES);
  });

  it('enrage: a low-health boss advances faster than a full-health one', () => {
    const make = (hp: number): GameState => ({
      world: openWorld(40, 40),
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [liveBoss(berserker, 35, 5, hp)],
      tooTired: false,
      tick: 0,
    });
    // Full health ⇒ not enraged; below 0.4·maxHp ⇒ enraged the whole run. Both
    // stay outside the charge radius over 20 ticks, so only enrage differs.
    const calm = runTicks(make(berserker.hp), 20);
    const enraged = runTicks(make(30), 20);
    const xOf = (s: GameState): number => s.enemies![0]!.enemy.pos.x;

    expect(xOf(enraged)).toBeLessThan(xOf(calm));
  });

  it('enrage gate is strict — a boss at exactly the threshold does not enrage', () => {
    const make = (hp: number): GameState => ({
      world: openWorld(40, 40),
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [liveBoss(berserker, 35, 5, hp)],
      tooTired: false,
      tick: 0,
    });
    // hp === maxHp·below (100·0.4 = 40): `hp < maxHp·below` is false, so it
    // advances at the same pace as a full-health (un-enraged) boss.
    const boundary = runTicks(make(berserker.hp * 0.4), 20);
    const calm = runTicks(make(berserker.hp), 20);
    const xOf = (s: GameState): number => s.enemies![0]!.enemy.pos.x;

    expect(xOf(boundary)).toBe(xOf(calm));
  });

  it('enrage stacks on charge — an enraged boss inside the charge radius closes faster', () => {
    // Both bosses start Chebyshev 4 from the player (= CHARGE_RADIUS) and stay
    // within it, so both are charging every tick; the enraged one additionally
    // gets its signature ×mult, so enrage and charge compound (×4 vs ×2) and it
    // closes strictly faster. Pins the in-combat case the other enrage tests
    // (out at range 30, pure advance) never exercise.
    const make = (hp: number): GameState => ({
      world: openWorld(12, 12),
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [liveBoss(berserker, 5, 9, hp)], // Chebyshev 4 → in charge range
      tooTired: false,
      tick: 0,
    });
    const calm = runTicks(make(berserker.hp), 2);
    const enraged = runTicks(make(30), 2);
    const yOf = (s: GameState): number => s.enemies![0]!.enemy.pos.y;

    expect(yOf(enraged)).toBeLessThan(yOf(calm));
  });

  it('enrage is transient — the stored boss keeps its real speed', () => {
    const state: GameState = {
      world: openWorld(40, 40),
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [liveBoss(berserker, 35, 5, 30)],
      tooTired: false,
      tick: 0,
    };
    const next = update(state, [], TICK, noRng);
    expect(next.enemies![0]!.enemy.speed).toBe(berserker.speed);
  });
});

describe('update — home base (TQ-013)', () => {
  /** A tier-1 home at (10, 10) in a 21×21 open field (safe radius 2). */
  function homeState(opts: {
    playerPos?: { x: number; y: number };
    hp?: number;
    enemies?: readonly LiveEnemy[];
    growth?: Base;
    bossesDefeated?: number;
  }): GameState {
    const player = createPlayer(opts.playerPos ?? { x: 10, y: 10 });
    return {
      world: openWorld(21, 21),
      player: opts.hp === undefined ? player : { ...player, hp: opts.hp },
      enemies: opts.enemies ?? [],
      base: { pos: { x: 10, y: 10 }, growth: opts.growth ?? createBase() },
      bossesDefeated: opts.bossesDefeated ?? 0,
      tooTired: false,
      tick: 0,
    };
  }

  /** A slain (0-hp) boss for the cull step, mirroring the victory suite. */
  function slainBoss(id: string, x: number, y: number): LiveEnemy {
    const boss = createBoss(
      {
        id,
        name: id,
        hp: 100,
        atk: 6,
        def: 0,
        speed: 3,
        glyph: 'B',
        color: 'red',
        signature: { kind: 'none' },
      },
      { x, y },
    );
    return { enemy: { ...boss, hp: 0 }, ai: createEnemyAi() };
  }

  it('grows the base the tick enough bosses fall', () => {
    const enemies = Array.from({ length: BOSSES_PER_TIER }, (_, i) =>
      slainBoss(`b${String(i)}`, i, 0),
    );
    const next = update(homeState({ enemies }), [], TICK, noRng);
    expect(next.base?.growth.tier).toBe(2);
    expect(next.base?.growth.bossesDefeated).toBe(BOSSES_PER_TIER);
  });

  it('leaves the base untouched on a boss-less tick', () => {
    const state = homeState({ enemies: [deadEnemy('grunt', 1, 1)] });
    const next = update(state, [], TICK, noRng);
    expect(next.base).toBe(state.base); // not even a fresh copy — untouched
  });

  it('enemies never set foot on home ground', () => {
    // A runner charging straight at a player standing at home: it must pull up
    // at the safe-zone edge (Chebyshev radius 2 of the base) and stay there,
    // however long it waits.
    let state = homeState({ enemies: [liveEnemy('runner', 10, 2)] });
    for (let i = 0; i < 90; i++) {
      state = update(state, [], TICK, noRng);
      const pos = state.enemies![0]!.enemy.pos;
      const cheb = Math.max(Math.abs(pos.x - 10), Math.abs(pos.y - 10));
      expect(cheb).toBeGreaterThan(2);
    }
  });

  it('contact damage does not land on a player inside the zone', () => {
    // Enemy just outside the edge (7,10), player just inside it (8,10) —
    // adjacent, which would chip hp anywhere else in the world.
    const inside = homeState({
      playerPos: { x: 8, y: 10 },
      enemies: [liveEnemy('brute', 7, 10)],
    });
    const safe = update(inside, [], TICK, noRng);
    expect(safe.player.hp).toBe(safe.player.progress!.maxHp);

    // The same adjacency without a base chips the player — proving the
    // exemption (not the geometry) is what kept them whole above.
    const exposed: GameState = { ...inside, base: undefined };
    const chipped = update(exposed, [], TICK, noRng);
    expect(chipped.player.hp).toBeLessThan(chipped.player.progress!.maxHp);
  });

  it('hp regenerates on home ground, and only there', () => {
    const home = update(homeState({ hp: 5 }), [], TICK, noRng);
    expect(home.player.hp).toBeCloseTo(5 + BASE_HP_REGEN_PER_SEC * TICK, 10);

    const away = update(
      homeState({ hp: 5, playerPos: { x: 20, y: 20 } }),
      [],
      TICK,
      noRng,
    );
    expect(away.player.hp).toBe(5);
  });

  it('regen tops out at the effective ceiling — progression + base buff', () => {
    // A tier-2 home grants +HP_BONUS_PER_TIER headroom: a player at the bare
    // progression ceiling keeps healing toward the buffed one…
    const grown: Base = { tier: 2, bossesDefeated: 2 };
    const buffed = update(
      homeState({ hp: BASE_HP, growth: grown, bossesDefeated: 2 }),
      [],
      TICK,
      noRng,
    );
    expect(buffed.player.hp).toBeGreaterThan(BASE_HP);

    // …while at a tier-1 home the bare ceiling IS the cap: no drift past full.
    const capped = update(homeState({ hp: BASE_HP }), [], TICK, noRng);
    expect(capped.player.hp).toBe(BASE_HP);
  });
});

describe('update — the base buff is player-bound (audit fix)', () => {
  /** In-dungeon state: live base suspended, tier-2 home in the overworld. */
  function dungeonState(hp: number, xpAward = false): GameState {
    const player = createPlayer({ x: 5, y: 5 });
    return {
      world: openWorld(12, 12),
      player: { ...player, hp },
      enemies: xpAward ? [deadEnemy('grunt', 1, 1)] : [],
      dungeon: {
        returnPos: { x: 2, y: 2 },
        exitPos: { x: 9, y: 9 },
        overworld: {
          world: openWorld(30, 30),
          base: {
            pos: { x: 2, y: 2 },
            growth: { tier: 2, bossesDefeated: 2 },
          },
        },
      },
      tooTired: false,
      tick: 0,
    };
  }

  /** XP that crosses exactly one level from a fresh progression. */
  function levelUpXp(state: GameState): GameState {
    const primed = gainXp(
      createProgression(),
      xpToNext(1) - xpForKill(state.enemies![0]!.enemy),
    );
    return {
      ...state,
      player: { ...state.player, progress: primed },
    };
  }

  it('a level-up below refills toward the SUSPENDED base-buffed ceiling', () => {
    const state = levelUpXp(dungeonState(5, true));
    const next = update(state, [], TICK, noRng);
    expect(next.player.progress!.level).toBe(2);
    // New ceiling = level-2 maxHp + the suspended tier-2 home's bonus.
    expect(next.player.hp).toBe(
      next.player.progress!.maxHp + HP_BONUS_PER_TIER,
    );
  });

  it('a level-up can never heal DOWNWARD, whatever the ceiling', () => {
    // Player above the bare level-2 ceiling (buffed healing on the surface);
    // pre-fix the refill SET hp to the un-buffed ceiling, cutting it.
    const state = levelUpXp(dungeonState(1, true));
    const level2MaxHp = gainXp(createProgression(), xpToNext(1)).maxHp;
    const rich = {
      ...state,
      player: { ...state.player, hp: level2MaxHp + HP_BONUS_PER_TIER + 5 },
    };
    const next = update(rich, [], TICK, noRng);
    expect(next.player.progress!.level).toBe(2);
    expect(next.player.hp).toBeGreaterThanOrEqual(rich.player.hp);
  });
});

describe('update — dungeons (TQ-014)', () => {
  /** Player at (5,5) in an open world with one entrance at (6,5). */
  function surfaceState(): GameState {
    return {
      world: openWorld(30, 30),
      player: createPlayer({ x: 5, y: 5 }),
      enemies: [liveEnemy('grunt', 20, 20)],
      pickups: [{ pos: { x: 9, y: 9 }, weaponId: 'iron-sword' }],
      base: { pos: { x: 3, y: 3 }, growth: createBase() },
      entrances: [{ x: 6, y: 5 }],
      tooTired: false,
      tick: 0,
    };
  }

  const stepEast = [{ type: 'move', dx: 1, dy: 0 } as const];

  it('stepping onto an entrance descends into its seeded dungeon', () => {
    const surface = surfaceState();
    const below = update(surface, stepEast, TICK, noRng);

    expect(below.dungeon).toBeDefined();
    expect(below.world).not.toBe(surface.world);
    expect(below.world.width).toBe(DUNGEON_WIDTH);
    expect(below.enemies).toHaveLength(DUNGEON_ENEMY_COUNT);
    expect(below.pickups![0]!.weaponId).toBe(DUNGEON_REWARD);
    // The player stands on the exit tile; the door home is recorded.
    expect(below.player.pos).toEqual(below.dungeon!.exitPos);
    expect(below.dungeon!.returnPos).toEqual({ x: 6, y: 5 });
    // No home ground below, and no doors within doors.
    expect(below.base).toBeUndefined();
    expect(below.entrances).toBeUndefined();
  });

  /**
   * A move intent that steps off the exit tile onto an open neighbour (the
   * generated cavern is fully connected, so one always exists), used to
   * exercise the step-off/step-back exit path deterministically.
   */
  function openNeighbourStep(s: GameState): { dx: number; dy: number } {
    const exit = s.dungeon!.exitPos;
    const dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: 1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: -1 },
    ];
    const open = dirs.find((d) =>
      isWalkable(s.world, exit.x + d.dx, exit.y + d.dy),
    );
    expect(open).toBeDefined();
    return open!;
  }

  /** Step off the exit tile and straight back on, surfacing to the overworld. */
  function stepOffAndBack(below: GameState): GameState {
    const step = openNeighbourStep(below);
    const off = update(below, [{ type: 'move', ...step }], TICK, noRng);
    expect(off.player.pos).not.toEqual(below.dungeon!.exitPos);
    return update(
      off,
      [{ type: 'move', dx: -step.dx, dy: -step.dy }],
      TICK,
      noRng,
    );
  }

  it('suspends the overworld exactly as it stood and restores it on exit', () => {
    const surface = surfaceState();
    const below = update(surface, stepEast, TICK, noRng);

    // Arriving on the exit tile does NOT bounce straight back out…
    const still = update(below, [], TICK, noRng);
    expect(still.dungeon).toBeDefined();

    // …but stepping off and back onto it surfaces, restoring the overworld
    // wholesale (same references — frozen, not recomputed).
    const back = stepOffAndBack(still);
    expect(back.dungeon).toBeUndefined();
    expect(back.world).toBe(surface.world);
    expect(back.enemies).toBe(surface.enemies);
    expect(back.pickups).toBe(surface.pickups);
    expect(back.base).toBe(surface.base);
    expect(back.entrances).toBe(surface.entrances);
    expect(back.player.pos).toEqual({ x: 6, y: 5 });
  });

  it('what you gain below walks out with you (XP persists across exit)', () => {
    const surface = surfaceState();
    let s = update(surface, stepEast, TICK, noRng);
    // Award XP below by slaying a pre-dead enemy injected into the dungeon.
    s = {
      ...s,
      enemies: [...(s.enemies ?? []), deadEnemy('grunt', 1, 1)],
    };
    s = update(s, [], TICK, noRng);
    const xpBelow = s.player.progress!.xp;
    expect(xpBelow).toBeGreaterThan(0);

    const out = stepOffAndBack(s);
    expect(out.dungeon).toBeUndefined();
    expect(out.player.progress!.xp).toBe(xpBelow);
  });

  it('standing on the entrance without moving does not re-descend', () => {
    const surface = surfaceState();
    // Put the player ON the entrance with no move intent: no transition.
    const parked: GameState = {
      ...surface,
      player: { ...surface.player, pos: { x: 6, y: 5 } },
    };
    const next = update(parked, [], TICK, noRng);
    expect(next.dungeon).toBeUndefined();
    expect(next.world).toBe(surface.world);
  });
});
