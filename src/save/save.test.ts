import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SAVE_VERSION,
  type SaveData,
  parseSave,
  playerFromSave,
  readSave,
  saveDir,
  saveFilePath,
  serialize,
  writeSave,
  writeSaveSync,
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
      defeatedBosses: [],
      status: 'playing',
      tick: 99,
    });
  });

  it('captures defeated-boss ids and run status (TQ-022)', () => {
    const save = serialize({
      ...makeState(),
      bossesDefeated: 1,
      defeatedBossIds: ['gatekeeper'],
      status: 'victory',
    });
    expect(save.defeatedBosses).toEqual(['gatekeeper']);
    expect(save.status).toBe('victory');
  });

  it('copies defeatedBossIds (no aliasing of the live state array)', () => {
    const defeatedBossIds = ['gatekeeper'];
    const save = serialize({ ...makeState(), defeatedBossIds });
    expect(save.defeatedBosses).not.toBe(defeatedBossIds);
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

  it('playerFromSave deep-copies pos and progress (no aliasing)', () => {
    const save = serialize(makeState());
    const player = playerFromSave(save);
    expect(player.pos).not.toBe(save.player.pos);
    expect(player.progress).not.toBe(save.player.progress);
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

  it('returns null on an unknown (newer) version', () => {
    const wrong = { ...valid, version: SAVE_VERSION + 1 };
    expect(parseSave(JSON.stringify(wrong))).toBeNull();
  });

  it('returns null for an unknown defeated-boss id', () => {
    const bad = { ...valid, defeatedBosses: ['not-a-real-boss'] };
    expect(parseSave(JSON.stringify(bad))).toBeNull();
  });

  it('returns null for duplicate defeated-boss ids (an inflated count)', () => {
    const bad = { ...valid, defeatedBosses: ['gatekeeper', 'gatekeeper'] };
    expect(parseSave(JSON.stringify(bad))).toBeNull();
  });

  it('returns null for a non-array defeatedBosses or non-string entries', () => {
    expect(
      parseSave(JSON.stringify({ ...valid, defeatedBosses: 'gatekeeper' })),
    ).toBeNull();
    expect(
      parseSave(JSON.stringify({ ...valid, defeatedBosses: [42] })),
    ).toBeNull();
  });

  it('returns null for a status outside the GameStatus union', () => {
    for (const status of ['won', '', 42, null]) {
      expect(parseSave(JSON.stringify({ ...valid, status }))).toBeNull();
    }
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

  it('returns null for a malformed player.pos', () => {
    for (const pos of [{ x: 1.5, y: 0 }, { x: 1 }, null]) {
      const bad = JSON.stringify({
        ...valid,
        player: { ...valid.player, pos },
      });
      expect(parseSave(bad)).toBeNull();
    }
  });

  it('returns null for a non-integer / negative tick', () => {
    expect(parseSave(JSON.stringify({ ...valid, tick: 1.5 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...valid, tick: -1 }))).toBeNull();
    // NaN serializes to null, which is also rejected.
    expect(
      parseSave(JSON.stringify({ ...valid, tick: Number.NaN })),
    ).toBeNull();
  });

  it('returns null when world is null or missing', () => {
    expect(parseSave(JSON.stringify({ ...valid, world: null }))).toBeNull();
    const noWorld: Record<string, unknown> = { ...valid };
    delete noWorld.world;
    expect(parseSave(JSON.stringify(noWorld))).toBeNull();
  });

  it('returns null for type-valid but out-of-domain stats', () => {
    const cases: Array<Record<string, unknown>> = [
      { ...valid.player, hp: -9999 },
      { ...valid.player, def: -50 },
      { ...valid.player, progress: { ...valid.player.progress, level: 2.7 } },
      { ...valid.player, progress: { ...valid.player.progress, xp: -100 } },
      { ...valid.player, progress: { ...valid.player.progress, atk: 0 } },
    ];
    for (const player of cases) {
      expect(parseSave(JSON.stringify({ ...valid, player }))).toBeNull();
    }
  });
});

describe('v1 → v2 upgrade (tolerant loader, TQ-022)', () => {
  /** A save exactly as v1 wrote it: no defeatedBosses, no status, version 1. */
  function v1Save(): Record<string, unknown> {
    const v2 = serialize(makeState()) as unknown as Record<string, unknown>;
    const v1: Record<string, unknown> = { ...v2, version: 1 };
    delete v1.defeatedBosses;
    delete v1.status;
    return v1;
  }

  it('loads a v1 save with the new fields defaulted (progress kept)', () => {
    const upgraded = parseSave(JSON.stringify(v1Save()));
    expect(upgraded).not.toBeNull();
    expect(upgraded).toEqual({
      ...v1Save(),
      version: SAVE_VERSION,
      defeatedBosses: [],
      status: 'playing',
    });
  });

  it('still rejects a corrupt v1 save (upgrade is not a bypass)', () => {
    const bad = { ...v1Save(), player: null };
    expect(parseSave(JSON.stringify(bad))).toBeNull();
  });

  it('boss progress survives a serialize → parse round trip (no reset)', () => {
    const save = serialize({
      ...makeState(),
      bossesDefeated: 1,
      defeatedBossIds: ['gatekeeper'],
    });
    const reloaded = parseSave(JSON.stringify(save));
    expect(reloaded?.defeatedBosses).toEqual(['gatekeeper']);
  });
});

describe('file I/O (real disk, temp HOME)', () => {
  // os.homedir() honours $HOME on POSIX, so pointing it at a throwaway dir
  // exercises the real write→read path (atomic temp+rename, mkdir -p, parse)
  // without touching the developer's actual save.
  const realHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tq-save-'));
    process.env.HOME = home;
  });

  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('readSave returns null when no save file exists', () => {
    expect(saveFilePath().startsWith(home)).toBe(true);
    expect(readSave()).toBeNull();
  });

  it('writeSaveSync then readSave round-trips through disk', () => {
    const state = makeState();
    writeSaveSync(state);
    expect(readSave()).toEqual(serialize(state));
  });

  it('writeSave (async) round-trips and leaves no .tmp files behind', async () => {
    const state = makeState();
    await writeSave(state);
    expect(readSave()).toEqual(serialize(state));
    const tmps = readdirSync(saveDir()).filter((f) => f.endsWith('.tmp'));
    expect(tmps).toEqual([]);
  });

  it('readSave returns null for a corrupt on-disk file (→ new game)', () => {
    mkdirSync(saveDir(), { recursive: true });
    writeFileSync(saveFilePath(), '{ truncated json', 'utf8');
    expect(readSave()).toBeNull();
  });
});
