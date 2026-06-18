import { describe, it, expect } from 'vitest';
import {
  SAVE_VERSION,
  type SaveData,
  parseSave,
  playerFromSave,
  serialize,
} from './save.js';
import { type GameState, type World, createPlayer } from '../game/state.js';
import { createProgression } from '../game/progression.js';

/** A minimal valid world — `serialize` only reads seed/width/height, not tiles. */
const world: World = {
  width: 40,
  height: 25,
  tiles: [['floor']],
  seed: 1234,
};

function makeState(): GameState {
  const player = createPlayer({ x: 7, y: 3 });
  return {
    world,
    player: { ...player, hp: 12, stamina: 4, def: 2 },
    // Enemies are intentionally present but must NOT appear in the save.
    enemies: [],
    tooTired: false,
    tick: 99,
  };
}

describe('serialize', () => {
  it('captures version, world seed + dims, player stats, and tick', () => {
    const save = serialize(makeState());
    expect(save).toEqual({
      version: SAVE_VERSION,
      world: { seed: 1234, width: 40, height: 25 },
      player: {
        pos: { x: 7, y: 3 },
        hp: 12,
        stamina: 4,
        def: 2,
        progress: createProgression(),
      },
      tick: 99,
    });
  });

  it('does not persist enemies (they respawn from the seed on load)', () => {
    const save = serialize(makeState());
    expect(Object.keys(save)).not.toContain('enemies');
  });

  it('defaults a fresh progression when the player has none', () => {
    const state = makeState();
    const save = serialize({
      ...state,
      player: {
        pos: state.player.pos,
        hp: state.player.hp,
        stamina: state.player.stamina,
        def: state.player.def,
      },
    });
    expect(save.player.progress).toEqual(createProgression());
  });
});

describe('round trip', () => {
  it('serialize → JSON → parseSave reproduces the save', () => {
    const save = serialize(makeState());
    const reloaded = parseSave(JSON.stringify(save));
    expect(reloaded).toEqual(save);
  });

  it('playerFromSave restores the player fields', () => {
    const save = serialize(makeState());
    expect(playerFromSave(save)).toEqual({
      pos: { x: 7, y: 3 },
      hp: 12,
      stamina: 4,
      def: 2,
      progress: createProgression(),
    });
  });
});

describe('parseSave rejects corrupt input (→ new game)', () => {
  const valid: SaveData = serialize(makeState());

  it('returns null for non-JSON text', () => {
    expect(parseSave('}{ not json')).toBeNull();
    expect(parseSave('')).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    expect(parseSave('42')).toBeNull();
    expect(parseSave('null')).toBeNull();
    expect(parseSave('"a string"')).toBeNull();
  });

  it('returns null on a version mismatch', () => {
    const wrong = { ...valid, version: SAVE_VERSION + 1 };
    expect(parseSave(JSON.stringify(wrong))).toBeNull();
  });

  it('returns null when a required section is missing', () => {
    const noPlayer = { version: SAVE_VERSION, world: valid.world, tick: 0 };
    expect(parseSave(JSON.stringify(noPlayer))).toBeNull();
  });

  it('returns null for non-finite player stats', () => {
    // NaN/Infinity do not survive JSON (they become null), which the guard rejects.
    const nanHp = JSON.stringify({
      ...valid,
      player: { ...valid.player, hp: Number.NaN },
    });
    expect(parseSave(nanHp)).toBeNull();
  });

  it('returns null for non-integer or non-positive world dims', () => {
    const fractional = { ...valid, world: { ...valid.world, width: 40.5 } };
    expect(parseSave(JSON.stringify(fractional))).toBeNull();
    const zeroHeight = { ...valid, world: { ...valid.world, height: 0 } };
    expect(parseSave(JSON.stringify(zeroHeight))).toBeNull();
  });

  it('returns null for a non-integer seed', () => {
    const badSeed = { ...valid, world: { ...valid.world, seed: 1.5 } };
    expect(parseSave(JSON.stringify(badSeed))).toBeNull();
  });

  it('returns null when the progression is malformed', () => {
    const badProgress = JSON.stringify({
      ...valid,
      player: { ...valid.player, progress: { level: 2 } },
    });
    expect(parseSave(badProgress)).toBeNull();
  });
});
