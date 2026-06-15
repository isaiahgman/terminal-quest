/**
 * Combat engine — the signature mechanic as pure, deterministic logic
 * (prd §6, tdd §6). A radius attack rolls an independent hit chance per target
 * inside the radius, applies damage, and costs stamina; stamina gates attacks
 * and regenerates over time.
 *
 * This module is intentionally **decoupled**: it defines the minimal
 * `Combatant` shape it needs rather than importing `Player`/`Enemy`, and takes
 * randomness as an injected function. That keeps the math buildable and fully
 * unit-testable ahead of the entity/loop wiring (PR-005/007), and honours the
 * architecture bet — game math lives in pure, tested modules, never leaking
 * into render/input.
 *
 * Purity contract: every function returns new objects and never mutates its
 * inputs. No I/O, no rendering, and **no `Math.random`** — pass a seeded `Rng`.
 */

/**
 * The minimal slice of a combatant the engine operates on. Player and enemy
 * entities (defined elsewhere) are structurally compatible with this — combat
 * stays ignorant of everything else they carry.
 */
export interface Combatant {
  /** Grid position; radius is measured from the attacker's position. */
  pos: { x: number; y: number };
  /** Current hit points; reduced by incoming damage. */
  hp: number;
  /** Current stamina; spent on attacks, replenished by {@link regenStamina}. */
  stamina: number;
  /** Upper bound stamina regenerates toward. */
  maxStamina: number;
  /** Offensive power added to an attack's base damage. */
  atk: number;
  /** Defensive power subtracted from incoming damage. */
  def: number;
}

/** A named attack on the risk/reward axis (prd §6). */
export interface AttackSpec {
  /** Display name (e.g. "Quick Slash", "Whirlwind"). */
  name: string;
  /** Reach from the attacker, in grid units (inclusive boundary). */
  radius: number;
  /** Base damage before the attacker's `atk` and the target's `def`. */
  damage: number;
  /** Stamina spent to perform the attack. */
  staminaCost: number;
  /** Independent per-target chance to land, in `[0, 1]`. */
  hitChance: number;
}

/**
 * Injected source of randomness: returns a float in `[0, 1)`, exactly like
 * `Math.random` but seedable so combat is deterministic and testable.
 */
export type Rng = () => number;

/** Per-target outcome of an attack, by index into the `targets` array. */
export interface HitOutcome {
  /** Index of the target in the input `targets` array. */
  index: number;
  /** Whether the roll landed within `hitChance`. */
  hit: boolean;
  /** Damage actually dealt (0 on a miss). */
  damage: number;
}

/** Result of {@link resolveAttack} — new combatants plus what happened. */
export interface AttackResult {
  /** The attacker after paying the stamina cost (unchanged copy if blocked). */
  attacker: Combatant;
  /** All targets, in input order; damaged where hit (unchanged copies otherwise). */
  targets: Combatant[];
  /** True when the attack could not be paid for ("too tired"). */
  blocked: boolean;
  /** Outcomes for the targets inside the radius, in input order. */
  outcomes: HitOutcome[];
}

/** Squared Euclidean distance — avoids a sqrt and keeps the boundary exact. */
function distanceSquared(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Damage a hit deals: base attack damage boosted by the attacker's `atk` and
 * mitigated by the target's `def`, clamped so a landed hit always stings.
 */
function damageTo(
  attacker: Combatant,
  target: Combatant,
  spec: AttackSpec,
): number {
  return Math.max(1, spec.damage + attacker.atk - target.def);
}

/**
 * Clone a combatant including its nested `pos`, so a returned object shares no
 * reference with its input. A bare `{ ...c }` spread would alias `pos`, and a
 * downstream consumer mutating `result…pos` would then mutate the original —
 * breaking the purity contract below.
 */
function cloneCombatant(c: Combatant): Combatant {
  return { ...c, pos: { ...c.pos } };
}

/**
 * Resolve a radius attack.
 *
 * If the attacker lacks the stamina, the attack is **blocked**: copies are
 * returned unchanged, `blocked` is `true`, and the RNG is not consumed. When
 * the cost can be paid, stamina is deducted once and every target **within the
 * radius** gets an independent `hitChance` roll (RNG is consumed only for
 * those targets, in input order); a successful roll applies {@link damageTo}.
 *
 * Target selection **fails closed**: a negative or `NaN` `spec.radius`, or a
 * target with a `NaN` coordinate, selects *nobody* (rather than attacking
 * everyone and silently desyncing the deterministic RNG sequence the rest of
 * the engine relies on).
 *
 * Pure: inputs are never mutated; all returned combatants are fresh objects.
 */
export function resolveAttack(
  attacker: Combatant,
  targets: readonly Combatant[],
  spec: AttackSpec,
  rng: Rng,
): AttackResult {
  if (attacker.stamina < spec.staminaCost) {
    return {
      attacker: cloneCombatant(attacker),
      targets: targets.map(cloneCombatant),
      blocked: true,
      outcomes: [],
    };
  }

  // A negative/NaN radius yields -1, so the `<=` test below excludes everyone.
  const radiusSquared = spec.radius >= 0 ? spec.radius * spec.radius : -1;
  const outcomes: HitOutcome[] = [];
  const nextTargets = targets.map((target, index) => {
    const next = cloneCombatant(target);
    // Negated so a NaN distance (NaN <= r² is false) fails closed: excluded,
    // and crucially consumes no roll, keeping the RNG sequence deterministic.
    if (!(distanceSquared(attacker.pos, target.pos) <= radiusSquared)) {
      return next;
    }

    const hit = rng() < spec.hitChance;
    const damage = hit ? damageTo(attacker, target, spec) : 0;
    if (hit) next.hp = target.hp - damage;
    outcomes.push({ index, hit, damage });
    return next;
  });

  const nextAttacker = cloneCombatant(attacker);
  nextAttacker.stamina = attacker.stamina - spec.staminaCost;
  return {
    attacker: nextAttacker,
    targets: nextTargets,
    blocked: false,
    outcomes,
  };
}

/**
 * Regenerate stamina by `amount`, clamped to `maxStamina` (and never below the
 * current value, so a non-positive `amount` is a no-op). If stamina already
 * sits above `maxStamina`, it is held — never clamped *down*, honouring the
 * "never below the current value" contract. A non-finite `amount`
 * (`NaN`/`Infinity` from a bad `rate * dt`) is treated as zero — otherwise it
 * would poison `stamina` to `NaN` and permanently disable the "too tired" gate
 * (`NaN < cost` is always `false`). Returns a new combatant; input untouched.
 */
export function regenStamina(combatant: Combatant, amount: number): Combatant {
  const delta = Number.isFinite(amount) ? amount : 0;
  // max(current, …) outside guarantees regen never reduces stamina, even when
  // the current value is already above maxStamina.
  const stamina = Math.max(
    combatant.stamina,
    Math.min(combatant.maxStamina, combatant.stamina + delta),
  );
  return { ...combatant, stamina };
}
