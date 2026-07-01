import { describe, it, expect } from 'vitest';
import {
  barFill,
  drawHud,
  weaponLabel,
  HUD_ROWS,
  TOTAL_BOSSES,
  type HudScreen,
} from './hud.js';
import { WEAPONS } from '../data/weapons.js';
import type { GameState, Player } from '../game/state.js';
import type { Progression } from '../game/progression.js';

/** One recorded put, flattened to the fields the HUD sets. */
interface Put {
  x: number;
  y: number;
  text: string;
  color: string;
  bold: boolean;
  bgColor: string;
}

/** A recording stand-in for terminal-kit's ScreenBuffer (the `put` surface). */
class FakeScreen implements HudScreen {
  readonly puts: Put[] = [];
  put(
    opts: {
      x: number;
      y: number;
      attr: { color: string; bold: boolean; bgColor: string };
      wrap: boolean;
      dx: number;
      dy: number;
    },
    text: string,
  ): void {
    this.puts.push({
      x: opts.x,
      y: opts.y,
      text,
      color: opts.attr.color,
      bold: opts.attr.bold,
      bgColor: opts.attr.bgColor,
    });
  }
}

/**
 * Reconstruct the visible text of HUD row `y` by laying each recorded segment
 * into a cell grid left-to-right (later writes win, exactly as the real
 * ScreenBuffer composites) — so assertions read the row as a user would see it.
 */
function rowText(screen: FakeScreen, y: number, width: number): string {
  const cells = new Array<string>(width).fill(' ');
  for (const p of screen.puts.filter((put) => put.y === y)) {
    for (let i = 0; i < p.text.length; i++) {
      const x = p.x + i;
      if (x >= 0 && x < width) cells[x] = p.text[i]!;
    }
  }
  return cells.join('');
}

const PROGRESS: Progression = {
  level: 3,
  xp: 12,
  maxHp: 20,
  maxStamina: 10,
  atk: 5,
};

function makeState(over: Partial<GameState> = {}): GameState {
  const player: Player = {
    pos: { x: 0, y: 0 },
    hp: 18,
    stamina: 6,
    def: 0,
    progress: PROGRESS,
  };
  return {
    world: { width: 1, height: 1, tiles: [['floor']], seed: 0 },
    player,
    enemies: [],
    bossesDefeated: 2,
    tooTired: false,
    tick: 0,
    ...over,
  };
}

/** Recursively freeze an object graph so any write attempt throws. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe('barFill', () => {
  it('is empty at 0 and full at max', () => {
    expect(barFill(0, 20, 12)).toBe(0);
    expect(barFill(20, 20, 12)).toBe(12);
  });

  it('is proportional in between', () => {
    expect(barFill(10, 20, 12)).toBe(6); // 0.5 * 12
    expect(barFill(15, 20, 12)).toBe(9); // 0.75 * 12
  });

  it('shows at least one cell for any non-empty value (a living sliver)', () => {
    expect(barFill(1, 1000, 12)).toBe(1);
  });

  it('never fills the last cell when short of max', () => {
    // 19/20 = 0.95 → 11.4 floored to 11; the final cell stays empty so
    // "almost full" reads differently from "full".
    expect(barFill(19, 20, 12)).toBe(11);
  });

  it('clamps an over-max value to a full bar', () => {
    expect(barFill(30, 20, 12)).toBe(12);
  });

  it('is total: non-finite or non-positive inputs yield 0, never NaN', () => {
    expect(barFill(Number.NaN, 20, 12)).toBe(0);
    expect(barFill(5, Number.POSITIVE_INFINITY, 12)).toBe(0);
    expect(barFill(5, 0, 12)).toBe(0);
    expect(barFill(5, 20, 0)).toBe(0);
    expect(barFill(5, 20, -4)).toBe(0);
    expect(barFill(-5, 20, 12)).toBe(0);
  });
});

describe('drawHud', () => {
  const WIDTH = 40;

  it('renders health, stamina, level/XP, and boss progress', () => {
    const screen = new FakeScreen();
    drawHud(screen, makeState(), 0, WIDTH);

    expect(rowText(screen, 0, WIDTH)).toContain('HP ');
    expect(rowText(screen, 0, WIDTH)).toContain('18/20');
    expect(rowText(screen, 1, WIDTH)).toContain('SP ');
    expect(rowText(screen, 1, WIDTH)).toContain('6/10');

    const statsRow = rowText(screen, 2, WIDTH);
    expect(statsRow).toContain('Lv 3');
    expect(statsRow).toContain('XP 12/45'); // xpToNext(3) = round(20 * 1.5^2)
    expect(statsRow).toContain(`Bosses 2/${TOTAL_BOSSES}`);
  });

  it('draws filled and empty bar cells proportional to the values', () => {
    const screen = new FakeScreen();
    drawHud(screen, makeState(), 0, WIDTH);

    const hpRow = rowText(screen, 0, WIDTH);
    // 18/20 over a 12-cell bar → 10 filled, 2 empty.
    expect(hpRow).toContain('█'.repeat(10));
    expect(hpRow).toContain('░'.repeat(2));
  });

  it('paints every cell of its reserved band each frame (no stale bleed-through)', () => {
    const screen = new FakeScreen();
    const top = 5;
    drawHud(screen, makeState(), top, WIDTH);

    // Exactly HUD_ROWS rows, starting at `top`.
    expect(HUD_ROWS).toBe(3);
    const rows = new Set(screen.puts.map((p) => p.y));
    expect([...rows].sort((a, b) => a - b)).toEqual([5, 6, 7]);

    // Every cell in [0, WIDTH) of every HUD row must be written by *some* put —
    // this is what `layoutRow`'s trailing space-padding guarantees, and what
    // stops stale world tiles bleeding through under delta draws. Build the
    // coverage from the recorded puts directly (not `rowText`, which always
    // returns WIDTH chars and so could never catch a gap).
    for (let y = top; y < top + HUD_ROWS; y++) {
      const covered = new Array<boolean>(WIDTH).fill(false);
      for (const p of screen.puts.filter((put) => put.y === y)) {
        for (let i = 0; i < p.text.length; i++) {
          const x = p.x + i;
          if (x >= 0 && x < WIDTH) covered[x] = true;
        }
      }
      expect(covered.every(Boolean)).toBe(true);
    }
  });

  it('surfaces the "too tired" cue after the stamina readout, only when blocked', () => {
    const calm = new FakeScreen();
    drawHud(calm, makeState({ tooTired: false }), 0, WIDTH);
    expect(rowText(calm, 1, WIDTH)).not.toContain('TIRED');

    const tired = new FakeScreen();
    drawHud(tired, makeState({ tooTired: true }), 0, WIDTH);
    const row = rowText(tired, 1, WIDTH);
    expect(row).toContain('TIRED');
    // It trails the readout — a regression that prepended it over the SP
    // label/bar would still contain "TIRED" but fail this ordering.
    expect(row.indexOf('TIRED')).toBeGreaterThan(row.indexOf('6/10'));
  });

  it('keeps the readout consistent with the bar — never rounds up to a false full', () => {
    const screen = new FakeScreen();
    const state = makeState();
    state.player.stamina = 9.6; // fractional regen; must not read as "10/10"
    drawHud(screen, state, 0, WIDTH);
    const row = rowText(screen, 1, WIDTH);
    expect(row).toContain('9/10');
    expect(row).not.toContain('10/10');
    // And the bar agrees: not full (no 12th filled cell) since stamina < max.
    expect(row).not.toContain('█'.repeat(12));
  });

  it('defaults missing progress and bossesDefeated (incremental wiring)', () => {
    const screen = new FakeScreen();
    const player: Player = { pos: { x: 0, y: 0 }, hp: 20, stamina: 10, def: 0 };
    const state = makeState({ player });
    delete state.bossesDefeated;
    drawHud(screen, state, 0, WIDTH);

    // Defaults: a fresh level-1 progression (maxHp/maxStamina 20/10), 0 bosses.
    expect(rowText(screen, 0, WIDTH)).toContain('20/20');
    expect(rowText(screen, 1, WIDTH)).toContain('10/10');
    const statsRow = rowText(screen, 2, WIDTH);
    expect(statsRow).toContain('Lv 1');
    expect(statsRow).toContain(`Bosses 0/${TOTAL_BOSSES}`);
  });

  it('never mutates the state it reads', () => {
    const screen = new FakeScreen();
    const state = makeState();
    const snapshot = structuredClone(state);
    deepFreeze(state);

    expect(() => {
      drawHud(screen, state, 0, WIDTH);
    }).not.toThrow();
    expect(state).toEqual(snapshot);
  });

  it('shows the equipped weapon name on the stats row (TQ-010)', () => {
    const screen = new FakeScreen();
    const player: Player = { ...makeState().player, weapon: 'iron-sword' };
    // A generous width so the readout (after Lv/XP/Bosses) is not clipped.
    drawHud(screen, makeState({ player }), 0, 80);
    expect(rowText(screen, 2, 80)).toContain(WEAPONS['iron-sword'].name);
  });

  it('shows "Unarmed" when the slot is empty', () => {
    const screen = new FakeScreen();
    drawHud(screen, makeState(), 0, 80); // makeState's player has no weapon
    expect(rowText(screen, 2, 80)).toContain('Unarmed');
  });
});

describe('drawHud — home base (TQ-013)', () => {
  const WIDTH = 60;

  it('shows the base tier when a base exists, and omits it otherwise', () => {
    const withBase = new FakeScreen();
    drawHud(
      withBase,
      makeState({
        base: { pos: { x: 0, y: 0 }, growth: { tier: 3, bossesDefeated: 4 } },
      }),
      0,
      WIDTH,
    );
    expect(rowText(withBase, 2, WIDTH)).toContain('Base T3');

    const without = new FakeScreen();
    drawHud(without, makeState(), 0, WIDTH);
    expect(rowText(without, 2, WIDTH)).not.toContain('Base');
  });

  it("the hp ceiling includes the base's tier buff", () => {
    const screen = new FakeScreen();
    drawHud(
      screen,
      makeState({
        base: { pos: { x: 0, y: 0 }, growth: { tier: 2, bossesDefeated: 2 } },
      }),
      0,
      WIDTH,
    );
    // 18 hp against maxHp 20 + HP_BONUS_PER_TIER (10) = 30.
    expect(rowText(screen, 0, WIDTH)).toContain('18/30');
  });
});

describe('drawHud — the base buff is player-bound (audit fix)', () => {
  it('the hp ceiling keeps the SUSPENDED base buff inside a dungeon', () => {
    const screen = new FakeScreen();
    drawHud(
      screen,
      makeState({
        dungeon: {
          returnPos: { x: 1, y: 1 },
          exitPos: { x: 0, y: 0 },
          overworld: {
            world: makeState().world,
            base: {
              pos: { x: 0, y: 0 },
              growth: { tier: 2, bossesDefeated: 2 },
            },
          },
        },
      }),
      0,
      60,
    );
    // 18 hp against maxHp 20 + the suspended tier-2 buff (10) = 30 — NOT the
    // over-full 18/20 the un-buffed ceiling produced before the fix.
    expect(rowText(screen, 0, 60)).toContain('18/30');
  });
});

describe('drawHud — dungeons (TQ-014)', () => {
  const WIDTH = 60;

  it('tags the stats row DUNGEON while below, and omits it on the surface', () => {
    const below = new FakeScreen();
    drawHud(
      below,
      makeState({
        dungeon: {
          returnPos: { x: 1, y: 1 },
          exitPos: { x: 0, y: 0 },
          overworld: { world: makeState().world },
        },
      }),
      0,
      WIDTH,
    );
    expect(rowText(below, 2, WIDTH)).toContain('DUNGEON');

    const surface = new FakeScreen();
    drawHud(surface, makeState(), 0, WIDTH);
    expect(rowText(surface, 2, WIDTH)).not.toContain('DUNGEON');
  });
});

describe('weaponLabel', () => {
  it('returns "Unarmed" for an empty slot', () => {
    expect(weaponLabel(makeState())).toBe('Unarmed');
  });

  it('returns the catalogue display name for the equipped weapon', () => {
    const player: Player = { ...makeState().player, weapon: 'warhammer' };
    expect(weaponLabel(makeState({ player }))).toBe(WEAPONS.warhammer.name);
  });
});
