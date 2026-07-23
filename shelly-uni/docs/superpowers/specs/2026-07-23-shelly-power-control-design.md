# Shelly Plus Uni power control

## Goal

Build a paste-ready Shelly Script for a Shelly Plus Uni that controls a
BatteryProtect/common 12 V bus and an inverter remote input. The production
script must use only JavaScript compatible with Shelly Script's modified
Espruino runtime, while its business logic remains independently testable in
Node.js.

## Hardware and event mapping

- `input:0` is a momentary button configured as Button + Detached.
- `switch:0` controls the BatteryProtect and common 12 V load bus.
- `switch:1` controls the inverter remote input.
- A short press uses a one-second recognition window: a single press selects
  MANUAL_12V and a double press selects MANUAL_FULL. A two-second long press
  selects TIMER. The Shelly adapter normalizes hardware events to these
  controller actions.

## Modes

### MANUAL_FULL

- Entered by a double press completed within one second while in TIMER/off.
- The 12 V bus is on.
- The inverter is on only after the bus has been commanded on.
- No periodic wake or remote polling runs; outstanding TIMER callbacks are
  invalidated.

### MANUAL_12V

- Entered by a single press while in TIMER/off.
- The 12 V bus is on and the inverter is off.
- No periodic wake or remote polling runs; outstanding TIMER callbacks are
  invalidated.

### TIMER (off and scheduled)

- Entered by holding the button for two seconds from either manual mode.
- The inverter and 12 V bus are immediately off; the inverter remains off.
- The first 12 V wake happens 60 minutes after entering TIMER, then once every
  60 minutes.
- Each wake keeps the bus on for a minimum of 10 minutes.
- While the bus is on, poll `https://api.holmevann.no/power/remote` every 60
  seconds.
- The plain-text body `KEEP_ON` keeps the bus on beyond its minimum duration.
- The plain-text body `DEFAULT` allows the bus to turn off once the minimum
  duration has elapsed.
- HTTP failures, malformed replies, and requests without a response within 30
  seconds act as `DEFAULT`: they must never indefinitely keep the 12 V bus on.
- Compare a successful response after trimming leading and trailing whitespace;
  only `KEEP_ON` has the keep-on effect. Any other body is `DEFAULT`.
- A scheduled 60-minute wake always starts a fresh TIMER cycle. If the bus is
  already on because the prior cycle received `KEEP_ON`, it remains on and the
  fresh cycle resets the minimum-on deadline to ten minutes after that wake.

## State and safety semantics

- Persist the selected mode in KVS, restoring it after a script/device restart.
- Default to `TIMER` when no persisted mode is present.
- KVS restoration is asynchronous in the Shelly adapter. On startup the
  controller must not command either output until the KVS read callback returns
  (or reports an error), then it applies the restored mode or TIMER fallback.
- Enforce output ordering: enabling uses `switch:0` then `switch:1`; disabling
  uses `switch:1` then `switch:0`.
- Mode transitions increment a mode generation; every TIMER wake increments a
  cycle generation; every HTTP request has its own request token. A callback
  must match the mode and cycle for which it was created (and HTTP replies must
  also match their request token). Thus a newer poll cannot invalidate the
  cycle's minimum-off timer, while callbacks from old modes/cycles are harmless.
- Button recognition must not duplicate timers or permit an old cycle to change
  current outputs.

## Implementation boundaries

1. A pure controller accepts a small injected runtime interface for clock,
   timers, persistence, HTTP, output commands, and logs. It contains all
   policy and timing decisions.
2. A thin Shelly adapter maps the runtime interface to `Shelly`, `Timer`, and
   the `input:0` event API. It contains no control policy.
3. A deterministic fake runtime implements virtual timers, queued HTTP
   outcomes, output state/history, KVS, events, and logs for Node tests.
4. A build script concatenates/wraps production modules into one
   `dist/shelly-power-control.js` file with syntax compatible with Shelly.

## Verification

Use Node's built-in test runner. Tests must cover mode changes, output command
ordering, 60-second polling, 10-minute and network timeout behavior, stale
timer/HTTP callbacks, persisted restarts, and repeated button events. Tests
will run entirely against the deterministic fake runtime.
