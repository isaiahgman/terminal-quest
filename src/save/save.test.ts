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
import { BOSS_ROSTER, TOTAL_BOSSES } from '../data/bosses.js';
import { BOSSES_PER_TIER, HP_BONUS_PER_TIER } from '../game/base.js';

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

  it('captures the equipped weapon; unarmed writes no weapon key (TQ-021)', () => {
    const state = makeState();
    const armed = serialize({
      ...state,
      player: { ...state.player, weapon: 'iron-sword' },
    });
    expect(armed.player.weapon).toBe('iron-sword');
    // Unarmed is the ABSENT key, not an explicit null/undefined value — so the
    // JSON on disk is identical to a pre-weapon save.
    const unarmed = JSON.parse(JSON.stringify(serialize(state))) as {
      player: Record<string, unknown>;
    };
    expect('weapon' in unarmed.player).toBe(false);
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

describe('serialize — inside a dungeon (TQ-014)', () => {
  it('records the suspended overworld with the player at the entrance', () => {
    const state = makeState();
    const inDungeon: GameState = {
      ...state,
      // A stand-in dungeon world with different dims/seed than the overworld.
      world: { width: 9, height: 9, tiles: [['floor']], seed: 777 },
      player: { ...state.player, pos: { x: 2, y: 2 } },
      dungeon: {
        returnPos: { x: 30, y: 12 },
        exitPos: { x: 2, y: 2 },
        overworld: { world },
      },
    };
    const save = serialize(inDungeon);
    // The OVERWORLD's seed/dims, not the dungeon's…
    expect(save.world).toEqual({ seed: 1234, width: 40, height: 25 });
    // …with the player at the door they went down through.
    expect(save.player.pos).toEqual({ x: 30, y: 12 });
    // Player-bound state persists exactly as held mid-dungeon.
    expect(save.player.hp).toBe(12);
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

  it('playerFromSave restores the equipped weapon (TQ-021)', () => {
    const state = makeState();
    const save = serialize({
      ...state,
      player: { ...state.player, weapon: 'warhammer' },
    });
    expect(playerFromSave(save).weapon).toBe('warhammer');
    // And the unarmed baseline stays unarmed.
    expect(playerFromSave(serialize(state)).weapon).toBeUndefined();
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

  it('returns null on any version mismatch — hard reset on bump (TQ-022)', () => {
    for (const version of [SAVE_VERSION + 1, SAVE_VERSION - 1]) {
      const wrong = { ...valid, version };
      expect(parseSave(JSON.stringify(wrong))).toBeNull();
    }
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

  it('returns null for a weapon id the catalogue does not know (TQ-021)', () => {
    for (const weapon of ['excalibur', 42, null]) {
      const bad = JSON.stringify({
        ...valid,
        player: { ...valid.player, weapon },
      });
      expect(parseSave(bad)).toBeNull();
    }
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

describe('boss progress round trip (TQ-022)', () => {
  it('survives serialize → parse with no reset', () => {
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

describe('domain upper bounds (audit hardening)', () => {
  const valid: SaveData = serialize(makeState());

  it('rejects an all-bosses-defeated save still marked playing (unwinnable)', () => {
    const everyBoss = BOSS_ROSTER.map((spec) => spec.id);
    const wedged = { ...valid, defeatedBosses: everyBoss, status: 'playing' };
    expect(parseSave(JSON.stringify(wedged))).toBeNull();
    // The same ids with a terminal status are a legitimate finished run.
    const won = { ...valid, defeatedBosses: everyBoss, status: 'victory' };
    expect(parseSave(JSON.stringify(won))).not.toBeNull();
  });

  it('rejects hp above the buffed ceiling but accepts hp exactly at it', () => {
    const progress = createProgression();
    const maxBonus =
      Math.floor(TOTAL_BOSSES / BOSSES_PER_TIER) * HP_BONUS_PER_TIER;
    const at = {
      ...valid,
      player: { ...valid.player, hp: progress.maxHp + maxBonus },
    };
    expect(parseSave(JSON.stringify(at))).not.toBeNull();
    const above = {
      ...valid,
      player: { ...valid.player, hp: progress.maxHp + maxBonus + 1 },
    };
    expect(parseSave(JSON.stringify(above))).toBeNull();
  });

  it('rejects stamina above the progression ceiling', () => {
    const over = {
      ...valid,
      player: {
        ...valid.player,
        stamina: createProgression().maxStamina + 1,
      },
    };
    expect(parseSave(JSON.stringify(over))).toBeNull();
  });

  it('rejects absurd world dimensions (the OOM crash-loop guard)', () => {
    for (const dims of [
      { width: 1e9, height: 25 },
      { width: 40, height: 4096 },
    ]) {
      const huge = { ...valid, world: { ...valid.world, ...dims } };
      expect(parseSave(JSON.stringify(huge))).toBeNull();
    }
  });
});

describe('write-failure cleanup (audit hardening)', () => {
  const realHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tq-savefail-'));
    process.env.HOME = home;
  });

  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('a failed rename surfaces the error and leaves no orphan .tmp files', async () => {
    // A DIRECTORY squatting on the save path makes the atomic rename fail
    // (file → non-empty-dir is not renameable), exercising the finally-cleanup.
    mkdirSync(join(saveFilePath(), 'occupied'), { recursive: true });
    const state = makeState();
    await expect(writeSave(state)).rejects.toThrow();
    expect(() => writeSaveSync(state)).toThrow();
    const tmps = readdirSync(saveDir()).filter((f) => f.endsWith('.tmp'));
    expect(tmps).toEqual([]);
  });

  it('readSave rethrows a non-ENOENT failure instead of nuking the save', () => {
    // Same squatter: reading a directory raises EISDIR, which must NOT be
    // treated as "no save" — that would let the next autosave overwrite it.
    mkdirSync(saveFilePath(), { recursive: true });
    expect(() => readSave()).toThrow();
  });
});
