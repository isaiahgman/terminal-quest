/**
 * Balance report — a static analysis of the tuning knobs, computed from the
 * SAME pure modules the game runs on (no copies of any formula). Run with:
 *
 *   npx tsx scripts/balance-report.ts
 *
 * It answers, without playing: is the run *winnable*, where are the walls, and
 * does the "impossible → trivial" delta (prd §2, §13) actually show up in the
 * numbers? It deliberately models a competent-but-not-perfect player:
 *
 *  - **Sustained DPS** is stamina-bound: long fights settle to
 *    `regen / cost` attacks per second, each landing `hitChance × damage`.
 *    (Burst from a full bar shortens real fights a little; ignored — this is a
 *    conservative floor.)
 *  - **Kiting is assumed** for bosses (the player out-speeds every boss except
 *    an enraged late-game one), so boss fights are DPS races, not tank checks.
 *  - **Contact lethality** is reported so the "one mistake" cost is visible:
 *    contact damage is per-tick (15 Hz), so standing on an enemy for one
 *    second costs `atk × 15` hp.
 *
 * Nothing here mutates anything; it's a lens, not a test. Numbers change ⇒
 * regenerate and re-read.
 */

import {
  createProgression,
  gainXp,
  xpForKill,
  xpToNext,
  type Progression,
} from '../src/game/progression.js';
import { ATTACKS, type AttackId } from '../src/data/attacks.js';
import { WEAPONS, applyWeapon, type WeaponId } from '../src/data/weapons.js';
import { BOSS_ROSTER } from '../src/data/bosses.js';
import { ENEMY_TYPES, type SwarmKind } from '../src/game/enemy.js';
import { STAMINA_REGEN_PER_SEC } from '../src/game/update.js';

/** Progression advanced to exactly `level` via the real gainXp/level-up path. */
function progressionAt(level: number): Progression {
  let p = createProgression();
  while (p.level < level) {
    p = gainXp(p, xpToNext(p.level) - p.xp);
  }
  return p;
}

/** Total XP spent getting from level 1 to `level`. */
function cumulativeXp(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
}

/**
 * Stamina-sustained DPS of one attack against a `def` target: long-run attack
 * rate is regen/cost (can't spend faster than it refills), each landing
 * hitChance × max(1, damage + atk − def) — the live `combat.ts` formula shape,
 * with the weapon folded in via the live `applyWeapon`.
 */
function sustainedDps(
  attackId: AttackId,
  atk: number,
  def: number,
  weapon: WeaponId | undefined,
): number {
  const spec = applyWeapon(
    ATTACKS[attackId],
    weapon === undefined ? undefined : WEAPONS[weapon],
  );
  const perHit = Math.max(1, spec.damage + atk - def);
  const rate = Math.min(
    15, // can't attack more than once per tick
    STAMINA_REGEN_PER_SEC / spec.staminaCost,
  );
  return rate * spec.hitChance * perHit;
}

/** Best sustained DPS across the three attacks. */
function bestDps(atk: number, def: number, weapon: WeaponId | undefined) {
  const ids = Object.keys(ATTACKS) as AttackId[];
  let best = { id: ids[0]!, dps: -1 };
  for (const id of ids) {
    const dps = sustainedDps(id, atk, def, weapon);
    if (dps > best.dps) best = { id, dps };
  }
  return best;
}

function fmt(n: number, w = 7): string {
  return n.toFixed(1).padStart(w);
}

// --- 1. The power curve ------------------------------------------------------
console.log('\n== Power curve (level → stats, grind cost) ==');
console.log('lvl    atk   maxHp   maxSp   xpToNext   cumXP   ~grunts-to-here');
const gruntXp = xpForKill({
  maxHp: ENEMY_TYPES.grunt.hp,
  atk: ENEMY_TYPES.grunt.atk,
});
for (const level of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15]) {
  const p = progressionAt(level);
  const cum = cumulativeXp(level);
  console.log(
    `${String(level).padStart(3)} ${String(p.atk).padStart(6)} ${String(p.maxHp).padStart(7)} ${String(p.maxStamina).padStart(7)} ${String(xpToNext(level)).padStart(10)} ${String(cum).padStart(7)} ${String(Math.ceil(cum / gruntXp)).padStart(12)}`,
  );
}

// --- 2. Boss ladder: time-to-kill at various (level, weapon) loadouts --------
console.log('\n== Boss ladder: sustained time-to-kill in seconds ==');
console.log('(kiting assumed; "∞-ish" > 300s reads as a wall)\n');
const loadouts: { label: string; level: number; weapon?: WeaponId }[] = [
  { label: 'L1 unarmed ', level: 1 },
  { label: 'L3 +dagger ', level: 3, weapon: 'rusted-dagger' },
  { label: 'L5 +sword  ', level: 5, weapon: 'iron-sword' },
  { label: 'L8 +hammer ', level: 8, weapon: 'warhammer' },
  { label: 'L12 +hammer', level: 12, weapon: 'warhammer' },
  { label: 'L15 +hammer', level: 15, weapon: 'warhammer' },
];
const header = ['boss (hp/atk/def)'.padEnd(34)]
  .concat(loadouts.map((l) => l.label))
  .join(' ');
console.log(header);
for (const boss of BOSS_ROSTER) {
  const cells = loadouts.map(({ level, weapon }) => {
    const p = progressionAt(level);
    const { dps } = bestDps(p.atk, boss.def, weapon);
    const ttk = boss.hp / dps;
    return ttk > 300 ? '   WALL' : fmt(ttk);
  });
  const label = `${boss.name} (${boss.hp}/${boss.atk}/${boss.def})`;
  console.log(label.padEnd(34) + ' ' + cells.join('     '));
}

// --- 3. What a boss kill pays back -------------------------------------------
console.log('\n== Boss XP payouts vs the grind ==');
for (const boss of BOSS_ROSTER) {
  const xp = xpForKill({ maxHp: boss.hp, atk: boss.atk });
  console.log(
    `${boss.name.padEnd(22)} pays ${String(xp).padStart(5)} xp  (= ${Math.ceil(
      xp / gruntXp,
    )} grunts)`,
  );
}

// --- 4. Contact lethality (the "one mistake" price) --------------------------
console.log('\n== Contact lethality: hp lost per SECOND of overlap (15 Hz) ==');
const kinds = Object.keys(ENEMY_TYPES) as SwarmKind[];
for (const kind of kinds) {
  const stats = ENEMY_TYPES[kind];
  console.log(
    `${kind.padEnd(10)} ${String(stats.atk * 15).padStart(5)} hp/s  (L1 pool: ${createProgression().maxHp} hp → dead in ${(
      createProgression().maxHp /
      (stats.atk * 15)
    ).toFixed(2)}s)`,
  );
}
for (const boss of [BOSS_ROSTER[0]!, BOSS_ROSTER[BOSS_ROSTER.length - 1]!]) {
  console.log(
    `${boss.name.padEnd(10)} ${String(boss.atk * 15).padStart(5)} hp/s`,
  );
}
console.log();
