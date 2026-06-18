# TQ-019 — Real key-release via the kitty keyboard protocol (progressive enhancement)
Depends on: TQ-016, TQ-007 (attack-key integration) · Scope: ~M · Touches: src/input/{keyDecoder,input,terminalKeyboard}.ts (+ tests), src/cli.ts, scripts/capture-keys.mjs

## Context
[TQ-016](TQ-016-input-responsiveness.md) made held-direction movement responsive, but it rests on a workaround: because we assumed terminals emit key-DOWN only (no key-up), it *infers* release with a timeout (`HELD_WINDOW_MS`). That inference has an unavoidable cost — a bounded **coast after release** — and is only a best-effort guess.

During TQ-016 we found that assumption is outdated. Modern terminals implement the **[kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)**: an opt-in mode that reports real **key-release** events (and distinguishes a genuine repeat from a fresh press). Supported broadly in 2026 — kitty, WezTerm, Ghostty, iTerm2, Alacritty, foot, Rio, Windows Terminal (Preview 1.25). With true release events, "is this direction held?" is a live flag, not a timeout — which removes the coast, the window-tuning, and the reversal-ordering hazard entirely. See [`tdd.md` §12](../tdd.md) for the full decision.

This ticket adds **Tier 1**: use real key-release where the terminal supports it, and fall back to TQ-016's timeout model where it doesn't. Both tiers feed the same `Intent` seam, so the game loop and the sim are untouched.

## Goal
Merged means: on a terminal that supports the kitty keyboard protocol, holding a direction moves with **zero coast** — movement stops on the tick after the physical release — while terminals without support keep TQ-016's timeout behaviour unchanged. The simulation still receives only `Intent`s and stays pure.

## Acceptance
- [x] On startup, the input layer **probes** for protocol support (`CSI ? u` + a `CSI c` DA sentinel) with a bounded wait, and records support as a boolean. No hang when there's no response (legacy terminal) — it falls back. *(unit-tested in `terminalKeyboard.test.ts`: supported / DA-fallback / timeout-fallback; live-verified in a real terminal.)*
- [x] When supported, release reporting is enabled (`CSI > 10 u` — event types **+ all keys as escape codes**, required so WASD also gets release events) and the **held-set is driven by real press/release events**, not the timeout; a key-up removes its direction on the next tick (no coast). *(unit-tested in `input.test.ts` release tier)*
- [x] When **not** supported, the **timeout model is unchanged** — same held-direction behaviour, verified by the timeout-tier tests still passing. *(Now fed by the decoder's legacy parsing rather than terminal-kit, since the input layer owns stdin; behaviour is equivalent, not the same code path.)*
- [x] The enhanced mode is **restored on exit** (and on crash/SIGINT/uncaught) so the user's terminal is never left in the protocol mode — `keyboard.restore()` runs first in `shutdown()`, covering every exit path.
- [x] A genuine OS auto-repeat event (event type 2) does **not** double-count as a new press in a way that breaks movement; repeats refresh the hold like a press. *(decoder maps event-type 2 → `repeat`; `input.test.ts` covers it.)*
- [x] Tier selection is unit-tested with an injected event source: a release event clears the direction (Tier 1); with no releases the timeout cases still hold (Tier 2). The decoder grammar and the `terminalKeyboard` negotiation/restore are both unit-tested. A focus-loss safety net (`RELEASE_SAFETY_NET_MS`) recovers from a lost key-up.
- [x] `npm run check` green (typecheck + strict lint + tests). No rule disables. Build green.

## Plan
1. Add an input-source abstraction so `Input` consumes a normalised stream of `{ dir, kind: 'press' | 'repeat' | 'release' }` events; the held-set logic keys off that.
2. **Tier 1 source:** parse kitty `CSI <code> ; <mods> : <event-type> u` sequences (event-type 3 = release). `terminal-kit` does **not** parse these (confirmed), so read/parse the raw escape sequences ourselves on the input stream, gated behind the support probe.
3. **Probe + enable + restore:** in `cli.ts`, send `CSI ? u`, wait briefly for `CSI ? <flags> u`; if present, push the enhancement (`CSI = 2 u`) and register a teardown that pops/disables it on every exit path.
4. **Tier 2 source:** the existing TQ-016 timeout path, used when the probe finds no support.
5. Keep `drain()`/`update()` and the `Intent` contract unchanged — only how the held-set gains/loses directions differs by tier.

## Constraints
- Input layer + `cli.ts` terminal setup only. `update()` stays pure; the sim still sees only `Intent`s.
- Never leave the terminal in enhanced mode after exit — restoration must cover crash/SIGINT, per the project's "always restore the terminal" rule.
- No `eslint-disable`/`any`/`@ts-ignore`. Inject the event source so both tiers are unit-testable without a real terminal.
- Don't regress the Tier-2 fallback — the TQ-016 tests must keep passing untouched.

## Notes
- This composes with [TQ-017](TQ-017-diagonal-movement.md): diagonals just read which directions are live in the held-set, so Tier 1 makes them exact (no timeout smearing) but 017 doesn't depend on 018 — either order works.
- **Spike resolved:** terminal-kit's key handler **cannot** coexist with the protocol — its parser emits `'unknown'` and aborts the chunk on `CSI u` sequences (Terminal.js `onStdin`). So the input layer **owns stdin**: `keyDecoder.ts` parses both the protocol form and the legacy form (plain bytes + letter arrows + raw Ctrl-C), and terminal-kit is used only for rendering. One path covers supported and unsupported terminals.
- **Live-verified:** confirmed in a real terminal — movement feels crisp with no coast, `q`/Ctrl-C quit, terminal is clean after exit.
- **Robustness (from review):**
  - *Focus-loss recovery* — the release tier no longer relies on a key-up always arriving. A `release` removes a direction instantly, but a long {@link RELEASE_SAFETY_NET_MS} (1 s) backstop, refreshed by the protocol's `repeat` events, force-expires a direction whose event stream goes silent (alt-tab away mid-hold) so you can't "return moving forever."
  - *SS3 arrows* — `ESC O A/B/C/D` (application-cursor-key mode / some tmux configs) are decoded alongside the CSI and CSI-u forms, so arrows don't silently fail in the fallback tier.
  - *Probe doesn't swallow input* — bytes typed during the probe (after its reply) are replayed into the decoder.
  - *`terminalKeyboard.ts` is unit-tested* via the injectable `KeyboardIo` (probe supported / DA-fallback / timeout-fallback / restore-idempotency / teardown ordering / leftover forwarding).
- **One terminal-specific constant:** WASD uses ASCII codepoints (certain). The **arrow** functional codepoints (`ARROW_CODEPOINT_TO_NAME`, currently 57297–57300) plus the letter and SS3 forms are all decoded, but if arrows misbehave on a given terminal, run `node scripts/capture-keys.mjs` to see the real bytes and adjust that one map.
