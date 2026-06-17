# TQ-018 — Real key-release via the kitty keyboard protocol (progressive enhancement)
Status: ready · Depends on: TQ-016 · Scope: ~M · Touches: src/input/input.ts (+ src/input/input.test.ts), src/cli.ts (enable/restore the mode on the real terminal)

## Context
[TQ-016](TQ-016-input-responsiveness.md) made held-direction movement responsive, but it rests on a workaround: because we assumed terminals emit key-DOWN only (no key-up), it *infers* release with a timeout (`HELD_WINDOW_MS`). That inference has an unavoidable cost — a bounded **coast after release** — and is only a best-effort guess.

During TQ-016 we found that assumption is outdated. Modern terminals implement the **[kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)**: an opt-in mode that reports real **key-release** events (and distinguishes a genuine repeat from a fresh press). Supported broadly in 2026 — kitty, WezTerm, Ghostty, iTerm2, Alacritty, foot, Rio, Windows Terminal (Preview 1.25). With true release events, "is this direction held?" is a live flag, not a timeout — which removes the coast, the window-tuning, and the reversal-ordering hazard entirely. See [`tdd.md` §12](../tdd.md) for the full decision.

This ticket adds **Tier 1**: use real key-release where the terminal supports it, and fall back to TQ-016's timeout model where it doesn't. Both tiers feed the same `Intent` seam, so the game loop and the sim are untouched.

## Goal
Merged means: on a terminal that supports the kitty keyboard protocol, holding a direction moves with **zero coast** — movement stops on the tick after the physical release — while terminals without support keep TQ-016's timeout behaviour unchanged. The simulation still receives only `Intent`s and stays pure.

## Acceptance
- [ ] On startup, the input layer **probes** for protocol support (`CSI ? u`) with a bounded wait, and records support as a boolean. No hang when there's no response (legacy terminal) — it falls back.
- [ ] When supported, release reporting is enabled (`CSI = 2 u`, "report event types") and the **held-set is driven by real press/release events**, not the timeout; a key-up removes its direction on the next tick (no coast).
- [ ] When **not** supported, behaviour is byte-for-byte TQ-016 (timeout model) — verified by the existing TQ-016 tests still passing unchanged.
- [ ] The enhanced mode is **restored on exit** (and on crash/SIGINT) so the user's terminal is never left in the protocol mode — ties into the existing "always restore the terminal" exit handling in `cli.ts`.
- [ ] A genuine OS auto-repeat event (event type 2) does **not** double-count as a new press in a way that breaks movement; repeats are treated as "still held."
- [ ] Tier selection is unit-tested with an injected/faked event source: a release event clears the direction (Tier 1); with the timeout source the TQ-016 cases still hold (Tier 2).
- [ ] `npm run check` green (typecheck + strict lint + tests). No rule disables.

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
- Open question for the breakdown stage: confirm whether `terminal-kit`'s key handler can be left attached for non-`CSI u` input while we intercept the `CSI u` sequences, or whether we need to take over raw-mode key parsing for the whole input stream. Spike this first — it sizes the ticket.
- If raw `CSI u` parsing turns out large, it can split further (probe+restore in one PR, the held-set wiring in another). Keep PRs tiny per project convention.
