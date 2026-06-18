/**
 * HUD — the read-only status overlay (prd F1/F3, TQ-008). Draws health,
 * stamina, level/XP, and boss progress into a reserved band of rows at the
 * bottom of the screen, composited by the renderer after the world viewport.
 *
 * Architecture bet (TDD §2): this is the *render* layer — it only ever reads
 * `GameState` and draws; it never mutates state and holds no game math beyond
 * pure presentation. Its one piece of logic, {@link barFill} (value → filled
 * cells), is a pure, unit-tested function, mirroring how `combat.ts` /
 * `progression.ts` keep their math pure and tested.
 */

import { type GameState } from '../game/state.js';
import { createProgression, xpToNext } from '../game/progression.js';

/**
 * Rows the HUD reserves at the bottom of the screen. The renderer shrinks the
 * world viewport by exactly this many so the two regions never overlap.
 */
export const HUD_ROWS = 3;

/**
 * Win condition: defeat all of these bosses (prd §7/F7). The HUD reads
 * `bossesDefeated / TOTAL_BOSSES`, showing `0/10` until TQ-011 spawns bosses and
 * drives the counter. Inline here until the bosses module owns the real source.
 */
export const TOTAL_BOSSES = 10;

/** Width, in cells, of the health/stamina bars. */
const BAR_WIDTH = 12;
const FILLED_CELL = '█';
const EMPTY_CELL = '░';

/** Background behind the whole HUD band — matches the floor/player palette. */
const HUD_BG = 'black';

// Foreground colours (terminal-kit names). Tune the HUD's look here.
const LABEL_COLOR = 'brightWhite';
const HP_COLOR = 'brightRed';
const SP_COLOR = 'brightGreen';
const EMPTY_COLOR = 'gray';
const TEXT_COLOR = 'white';
const TIRED_COLOR = 'brightYellow';
/** Blank padding cells carry no visible glyph, so their foreground is moot — a
 *  neutral name, kept decoupled from the bar palette. */
const PAD_COLOR = 'gray';

/**
 * Filled-cell count for a bar showing `value` out of `max` across `width` cells.
 * Pure and total: non-finite inputs or a non-positive `width`/`max` yield 0
 * (never `NaN`); the ratio is clamped to `[0, 1]`; a non-empty value always
 * shows at least one cell (a living sliver never reads as empty); and — because
 * the count is floored — a value short of `max` never fills the final cell, so
 * "not quite full" stays visually distinct from "full".
 */
export function barFill(value: number, max: number, width: number): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(max) ||
    !Number.isFinite(width)
  ) {
    return 0;
  }
  if (width <= 0 || max <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, value / max));
  let filled = Math.floor(ratio * width);
  if (filled === 0 && value > 0) filled = 1;
  return filled;
}

/** A coloured run of text laid out left-to-right within a HUD row. */
interface Segment {
  text: string;
  color: string;
  bold?: boolean;
}

/**
 * The slice of terminal-kit's `ScreenBuffer` the HUD draws through — just
 * `put`. Declared structurally so the HUD doesn't depend on terminal-kit
 * directly and tests can pass a lightweight fake.
 */
export interface HudScreen {
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
  ): void;
}

/** Draw one coloured run at (x, y) on the HUD background. */
function putSegment(
  screen: HudScreen,
  x: number,
  y: number,
  text: string,
  color: string,
  bold: boolean,
): void {
  screen.put(
    { x, y, attr: { color, bold, bgColor: HUD_BG }, wrap: false, dx: 1, dy: 0 },
    text,
  );
}

/**
 * Lay `segments` left-to-right across row `y`, clipping any run that would
 * overflow `width` and padding the remainder with spaces — so the row paints
 * every cell of the reserved band each frame. Without the padding, delta draws
 * would let stale world tiles or last-frame digits bleed through.
 */
function layoutRow(
  screen: HudScreen,
  y: number,
  width: number,
  segments: readonly Segment[],
): void {
  let x = 0;
  for (const seg of segments) {
    if (x >= width) break;
    const text =
      seg.text.length > width - x ? seg.text.slice(0, width - x) : seg.text;
    putSegment(screen, x, y, text, seg.color, seg.bold ?? false);
    x += text.length;
  }
  if (x < width) {
    putSegment(screen, x, y, ' '.repeat(width - x), PAD_COLOR, false);
  }
}

/** The filled and empty halves of a bar as two coloured segments. */
function barSegments(
  value: number,
  max: number,
  filledColor: string,
): [Segment, Segment] {
  const filled = barFill(value, max, BAR_WIDTH);
  return [
    { text: FILLED_CELL.repeat(filled), color: filledColor },
    { text: EMPTY_CELL.repeat(BAR_WIDTH - filled), color: EMPTY_COLOR },
  ];
}

/**
 * Draw the HUD into the `HUD_ROWS`-tall band whose first row is `top`, spanning
 * `width` columns. Read-only: derives everything from `state` and mutates
 * nothing. Missing `progress`/`bossesDefeated` default (level-1 stats, 0
 * bosses), the same incremental-wiring idiom `update()` uses.
 */
export function drawHud(
  screen: HudScreen,
  state: GameState,
  top: number,
  width: number,
): void {
  const { player, tooTired } = state;
  const progress = player.progress ?? createProgression();
  // Floor each current value once and feed the SAME number to both the bar and
  // the numeric readout, so the two can never disagree — e.g. a rounded "10/10"
  // sitting beside a bar that isn't full. hp is integer; stamina accrues
  // fractionally per tick (regen), which is the case this guards.
  const hp = Math.floor(player.hp);
  const stamina = Math.floor(player.stamina);

  // Row 0 — health.
  layoutRow(screen, top, width, [
    { text: 'HP ', color: LABEL_COLOR, bold: true },
    ...barSegments(hp, progress.maxHp, HP_COLOR),
    { text: ` ${hp}/${progress.maxHp}`, color: TEXT_COLOR },
  ]);

  // Row 1 — stamina, with the "too tired" cue when an attack was just blocked.
  const staminaRow: Segment[] = [
    { text: 'SP ', color: LABEL_COLOR, bold: true },
    ...barSegments(stamina, progress.maxStamina, SP_COLOR),
    { text: ` ${stamina}/${progress.maxStamina}`, color: TEXT_COLOR },
  ];
  if (tooTired) {
    staminaRow.push({ text: '  TIRED', color: TIRED_COLOR, bold: true });
  }
  layoutRow(screen, top + 1, width, staminaRow);

  // Row 2 — level, XP toward the next level, and boss progress.
  layoutRow(screen, top + 2, width, [
    { text: `Lv ${progress.level}`, color: LABEL_COLOR, bold: true },
    {
      text: `   XP ${progress.xp}/${xpToNext(progress.level)}`,
      color: TEXT_COLOR,
    },
    {
      text: `   Bosses ${state.bossesDefeated ?? 0}/${TOTAL_BOSSES}`,
      color: TEXT_COLOR,
    },
  ]);
}
