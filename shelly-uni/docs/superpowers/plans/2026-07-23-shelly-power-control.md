# Shelly Plus Uni Power Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a testable two-mode Shelly Plus Uni power controller and one paste-ready bundled Shelly Script.

**Architecture:** A CommonJS controller owns all behavior through an injected runtime interface. A fake runtime deterministically advances time and resolves queued HTTP outcomes. The adapter translates the small runtime interface to Shelly Script globals; a dependency-free build script wraps the controller and adapter into one ES5-compatible IIFE.

**Tech Stack:** Node.js built-in test runner and `assert`, CommonJS, dependency-free Node build script, ES5-compatible production JavaScript.

---

### Task 1: Project test harness and deterministic fake runtime

**Files:**
- Create: `package.json`
- Create: `test/fake-runtime.js`
- Create: `test/fake-runtime.test.js`

- [ ] **Step 1: Write the failing fake-runtime timer/order tests**

```js
test('runs virtual timers in due-time then registration order', function () {
  var runtime = new FakeRuntime();
  var seen = [];
  runtime.setTimer(10, false, function () { seen.push('first'); });
  runtime.setTimer(10, false, function () { seen.push('second'); });
  runtime.advance(10);
  assert.deepStrictEqual(seen, ['first', 'second']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/fake-runtime.test.js`

Expected: FAIL because `FakeRuntime` does not exist.

- [ ] **Step 3: Implement the minimal fake runtime**

Provide virtual clock/timer scheduling and cancellation; output state and command history; KVS; subscribed events; queued HTTP responses/errors/hangs; and logs. Expose `advance(ms)`, `emit(event)`, `enqueueHttp(outcome)`, and snapshot helpers. Make HTTP callbacks asynchronous through virtual timers.

- [ ] **Step 4: Run the fake-runtime tests**

Run: `node --test test/fake-runtime.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json test/fake-runtime.js test/fake-runtime.test.js
git commit -m "test: add deterministic Shelly runtime fake"
```

### Task 2: Test and implement the pure controller’s modes and outputs

**Files:**
- Create: `src/controller.js`
- Create: `test/controller.test.js`

- [ ] **Step 1: Write failing tests for startup and button transitions**

```js
test('defaults to TIMER and powers inverter off before the 12 V wake', function () {
  var runtime = new FakeRuntime();
  createController(runtime).start();
  runtime.resolveKvsGet({ value: null });
  assert.deepStrictEqual(runtime.outputHistory(), [
    { id: 1, on: false }, { id: 0, on: true }
  ]);
});

test('single push enters FULL_ON by commanding bus before inverter', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
  createController(runtime).start();
  runtime.resolveKvsGet({ value: 'TIMER' });
  runtime.emitSinglePush();
  assert.deepStrictEqual(runtime.outputHistory().slice(-2), [
    { id: 0, on: true }, { id: 1, on: true }
  ]);
});
```

- [ ] **Step 2: Run the controller tests to verify they fail**

Run: `node --test test/controller.test.js`

Expected: FAIL because `createController` is not implemented.

- [ ] **Step 3: Implement minimal mode persistence and safe output helpers**

Export `createController(runtime)`. Define `FULL_ON`/`TIMER`, and make `start()` read `power_mode` asynchronously: it must command no outputs until the read callback supplies a valid mode, a missing value, or an error; missing/error falls back to TIMER. Write mode on toggles and use output helpers that command `0 → 1` for on and `1 → 0` for off. Subscribe through the injected runtime only.

- [ ] **Step 4: Run all tests**

Run: `node --test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controller.js test/controller.test.js
git commit -m "feat: add power mode controller"
```

### Task 3: Test and implement TIMER scheduling, polling, and timeouts

**Files:**
- Modify: `src/controller.js`
- Modify: `test/controller.test.js`

- [ ] **Step 1: Add failing TIMER behavior tests**

Cover these independent cases: start commands no outputs until asynchronous KVS restoration completes; no poll in FULL_ON; the first poll runs 60 seconds after each wake and repeats every 60 seconds only while bus is on; `DEFAULT` powers off precisely at the 10-minute minimum; `KEEP_ON` holds the bus after that deadline; a 30-second HTTP timeout/error/malformed response behaves as DEFAULT; a late `KEEP_ON` after its request timeout is ignored; and the next 60-minute wake starts a new 10-minute minimum even if an earlier cycle is held on.

- [ ] **Step 2: Run the relevant controller tests to verify failure**

Run: `node --test test/controller.test.js`

Expected: FAIL because TIMER polling/deadline behavior is absent.

- [ ] **Step 3: Implement minimal cycle and poll logic**

On each TIMER entry/wake, increment cycle generation, ensure inverter off then bus on, set a 10-minute off-eligibility timer, and schedule the next wake for 60 minutes. Poll every 60 seconds only while current. Treat trimmed `KEEP_ON` as hold; all other outcomes clear hold. Install a 30-second request timeout. Use scoped mode/cycle/request identities so each response is matched to its own cycle without invalidating the cycle deadline.

- [ ] **Step 4: Run all tests**

Run: `node --test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controller.js test/controller.test.js
git commit -m "feat: add timer wake and remote polling"
```

### Task 4: Replace toggle controls with manual/TIMER button states

**Files:**
- Modify: `test/controller.test.js`
- Modify: `src/controller.js`

- [ ] **Step 1: Add failing safety regression tests**

Test that a short press from TIMER selects MANUAL_12V; a qualifying double press
selects MANUAL_FULL; a long press enters TIMER/off and schedules its first wake
60 minutes later; manual modes ignore TIMER callbacks; and stale timer/HTTP
callbacks cannot change the current state.

- [ ] **Step 2: Run the regression tests to verify failure**

Run: `node --test test/controller.test.js`

Expected: FAIL with stale callbacks changing output or duplicate active schedules.

- [ ] **Step 3: Implement only missing token/cancellation safeguards**

Replace FULL_ON with MANUAL_12V and MANUAL_FULL. Delay a single press for a
one-second double-press window; accept a second press in that window as
MANUAL_FULL. Enter TIMER/off on long press, cancel known timers on every
transition where possible, and retain identity guards on every callback for
behavior correctness even if cancellation races. Do not add retries, backoff,
or unrequested state.

- [ ] **Step 4: Run all tests**

Run: `node --test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controller.js test/controller.test.js
git commit -m "test: cover stale callbacks and restarts"
```

### Task 5: Shelly adapter and deployable bundle

**Files:**
- Create: `src/shelly-adapter.js`
- Create: `scripts/build.js`
- Create: `test/build.test.js`
- Create: `dist/shelly-power-control.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing adapter/build tests**

Test the adapter with a minimal fake global object: it maps `Switch.Set`, `KVS.Get/Set`, `HTTP.GET`, timers, and only `input:0` `single_push`; assert the generated bundle contains neither `require(` nor modern forbidden syntax (`const`, `let`, arrows, classes, promises, async).

- [ ] **Step 2: Run build tests to verify failure**

Run: `node --test test/build.test.js`

Expected: FAIL because adapter/build output is absent.

- [ ] **Step 3: Implement adapter and build script**

Keep the adapter policy-free and compatible with Shelly callback APIs. Build a single IIFE by embedding production modules with a tiny local module loader. Add `npm test` and `npm run build` scripts. Generate `dist/shelly-power-control.js`.

- [ ] **Step 4: Run complete verification**

Run: `npm test && npm run build && node --test test/build.test.js`

Expected: all tests pass, build exits 0, and the generated bundle satisfies the compatibility test.

- [ ] **Step 5: Commit**

```bash
git add package.json src/shelly-adapter.js scripts/build.js test/build.test.js dist/shelly-power-control.js
git commit -m "feat: bundle Shelly power control script"
```
