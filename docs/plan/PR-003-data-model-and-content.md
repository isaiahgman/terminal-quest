# PR-003 — Data model + class content
Status: ready · Depends on: PR-001 · Scope: ~M · Touches: src/types.ts, src/data/classes.ts, src/art/portraits.ts

## Context
The typed domain everything else consumes ([tdd §4](../tdd.md#4-state-model)). Combat (005) and char creation (004) both block on this.

## Goal
Merged means: domain types exist and 3 fully-specified classes (Warrior/Mage/Rogue) are loadable data.

## Acceptance
- [ ] `types.ts` defines `Character`, `Klass`, `Ability`, `Item`, `Enemy`, `Scene`
- [ ] `classes.ts` exports 3 classes, each with: name, base stats (hp/mp/atk/def/spd), 1–2 abilities, an ASCII portrait key
- [ ] A `createHero(klass, name)` factory returns a fully-initialized `Character`
- [ ] Stats are balanced so each class is viable (documented rationale in a comment)
- [ ] `pnpm typecheck` passes

## Plan
1. Flesh out `types.ts`.
2. Author Warrior (tanky, high hp/def), Mage (high mp/abilities, low def), Rogue (high spd, balanced).
3. Add ASCII portraits in `art/portraits.ts`; reference by key from class data.
4. `createHero` factory.

## Constraints
- Data only — no React, no engine logic here. Abilities are described declaratively (effect data), executed later by the engine.

## Notes
- Keep ability effects data-driven (`{type:'damage', power:n}` / `{type:'heal', power:n}`) so the engine in PR-005 stays generic.
