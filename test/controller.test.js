'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var createController = require('../src/controller');
var FakeRuntime = require('./fake-runtime');

var MANUAL_12V = 'MANUAL_12V';
var MANUAL_FULL = 'MANUAL_FULL';
var TIMER = 'TIMER';
var HOUR = 60 * 60 * 1000;

function start(runtime) {
  var controller = createController(runtime);
  controller.start();
  return controller;
}

function restore(runtime) {
  var controller = start(runtime);
  runtime.resolveKvsGet();
  runtime.advance(0);
  return controller;
}

function kvsWrites(runtime) {
  return runtime.commandHistory().filter(function (command) {
    return command.type === 'kvsSet';
  });
}

function httpGets(runtime) {
  return runtime.commandHistory().filter(function (command) {
    return command.type === 'httpGet';
  });
}

test('start waits for asynchronous KVS restoration before commanding outputs', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: MANUAL_FULL } });
  start(runtime);
  runtime.advance(0);
  assert.deepEqual(runtime.outputHistory(), []);

  runtime.resolveKvsGet();
  runtime.advance(0);
  assert.deepEqual(runtime.outputHistory(), [{ id: 0, on: true }, { id: 1, on: true }]);
});

test('missing, legacy, invalid, and failed KVS restoration enter TIMER off and schedule the first wake', function () {
  [undefined, 'FULL_ON', 'UNKNOWN', null].forEach(function (savedMode) {
    var runtime = savedMode === undefined ? new FakeRuntime() : new FakeRuntime({ kvs: { power_mode: savedMode } });
    start(runtime);
    if (savedMode === null) runtime.resolveKvsGet(null, 'read failed');
    else runtime.resolveKvsGet();
    runtime.advance(0);

    assert.deepEqual(runtime.outputHistory(), [{ id: 1, on: false }, { id: 0, on: false }]);
    runtime.advance(HOUR - 1);
    assert.deepEqual(runtime.outputState(), { 0: false, 1: false });
    runtime.advance(1);
    assert.deepEqual(runtime.outputState(), { 0: true, 1: false });
  });
});

test('restores each persisted manual selection with safe ordering', function () {
  var fullRuntime = new FakeRuntime({ kvs: { power_mode: MANUAL_FULL } });
  restore(fullRuntime);
  assert.deepEqual(fullRuntime.outputHistory(), [{ id: 0, on: true }, { id: 1, on: true }]);

  var busRuntime = new FakeRuntime({ kvs: { power_mode: MANUAL_12V } });
  restore(busRuntime);
  assert.deepEqual(busRuntime.outputHistory(), [{ id: 1, on: false }, { id: 0, on: true }]);
});

test('semantic presses before restore are ignored', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: MANUAL_12V } });
  var controller = start(runtime);
  controller.doublePress();
  controller.longPress();
  controller.shortPress();
  assert.deepEqual(kvsWrites(runtime), []);

  runtime.resolveKvsGet();
  runtime.advance(0);
  assert.deepEqual(runtime.outputState(), { 0: true, 1: false });
});

test('shortPress selects and persists MANUAL_12V', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: TIMER } });
  var controller = restore(runtime);
  controller.shortPress();
  runtime.advance(0);

  assert.deepEqual(runtime.outputState(), { 0: true, 1: false });
  assert.deepEqual(kvsWrites(runtime), [{ type: 'kvsSet', key: 'power_mode', value: MANUAL_12V }]);
});

test('doublePress selects and persists MANUAL_FULL with bus before inverter', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: TIMER } });
  var controller = restore(runtime);
  controller.doublePress();
  runtime.advance(0);

  assert.deepEqual(runtime.outputHistory().slice(-2), [{ id: 0, on: true }, { id: 1, on: true }]);
  assert.deepEqual(kvsWrites(runtime), [{ type: 'kvsSet', key: 'power_mode', value: MANUAL_FULL }]);
});

test('manual modes allow their valid short and double transitions', function () {
  var busRuntime = new FakeRuntime({ kvs: { power_mode: MANUAL_12V } });
  var busController = restore(busRuntime);
  busController.doublePress();
  busRuntime.advance(0);
  assert.deepEqual(busRuntime.outputState(), { 0: true, 1: true });
  assert.deepEqual(kvsWrites(busRuntime), [{ type: 'kvsSet', key: 'power_mode', value: MANUAL_FULL }]);

  var fullRuntime = new FakeRuntime({ kvs: { power_mode: MANUAL_FULL } });
  var fullController = restore(fullRuntime);
  fullController.shortPress();
  fullRuntime.advance(0);
  assert.deepEqual(fullRuntime.outputState(), { 0: true, 1: false });
  assert.deepEqual(kvsWrites(fullRuntime), [{ type: 'kvsSet', key: 'power_mode', value: MANUAL_12V }]);
});

test('invalid or repeated actions are harmless no-ops', function () {
  [
    { mode: TIMER, action: 'longPress', output: { 0: false, 1: false } },
    { mode: MANUAL_12V, action: 'shortPress', output: { 0: true, 1: false } },
    { mode: MANUAL_FULL, action: 'doublePress', output: { 0: true, 1: true } }
  ].forEach(function (example) {
    var runtime = new FakeRuntime({ kvs: { power_mode: example.mode } });
    var controller = restore(runtime);
    var beforeCommands = runtime.commandHistory();
    var beforeTimers = runtime.timers.slice();

    controller[example.action]();
    runtime.advance(0);

    assert.deepEqual(runtime.commandHistory(), beforeCommands);
    assert.deepEqual(runtime.timers, beforeTimers);
    assert.deepEqual(runtime.outputState(), example.output);
  });
});

test('longPress enters TIMER off, persists it, and first wakes exactly one hour later', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: MANUAL_FULL } });
  var controller = restore(runtime);
  controller.longPress();
  runtime.advance(0);

  assert.deepEqual(runtime.outputHistory().slice(-2), [{ id: 1, on: false }, { id: 0, on: false }]);
  assert.deepEqual(kvsWrites(runtime), [{ type: 'kvsSet', key: 'power_mode', value: TIMER }]);
  runtime.advance(HOUR - 1);
  assert.deepEqual(runtime.outputState(), { 0: false, 1: false });
  runtime.advance(1);
  assert.deepEqual(runtime.outputState(), { 0: true, 1: false });
});

test('TIMER polling and deadline behavior start only after its scheduled wake', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: TIMER } });
  for (var count = 0; count < 10; count += 1) runtime.enqueueHttp({ response: { body: '  KEEP_ON\n' } });
  var controller = restore(runtime);

  runtime.advance(HOUR - 1);
  assert.equal(httpGets(runtime).length, 0);
  runtime.advance(1);
  runtime.advance(60000);
  assert.equal(httpGets(runtime).length, 1);
  runtime.advance(9 * 60000);
  assert.equal(runtime.outputState()[0], true);

  controller.longPress();
  runtime.advance(0);
  assert.deepEqual(runtime.outputState(), { 0: true, 1: false });
});

test('TIMER polls every minute only while its scheduled-wake bus is on', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: TIMER } });
  restore(runtime);

  runtime.advance(HOUR + 59999);
  assert.equal(httpGets(runtime).length, 0);
  runtime.advance(1);
  assert.equal(httpGets(runtime).length, 1);
  runtime.advance(9 * 60000);
  assert.equal(runtime.outputState()[0], false);
  assert.equal(httpGets(runtime).length, 9);
  runtime.advance(60000);
  assert.equal(httpGets(runtime).length, 9);
});

test('DEFAULT, malformed, error, and hung scheduled-wake poll results use the deadline default', function () {
  [
    { response: { body: ' DEFAULT ' } },
    { response: { body: 'keep_on' } },
    { error: 'network down' },
    { hang: true }
  ].forEach(function (outcome) {
    var runtime = new FakeRuntime({ kvs: { power_mode: TIMER } });
    runtime.enqueueHttp(outcome);
    restore(runtime);
    runtime.advance(HOUR + 10 * 60000);
    assert.equal(runtime.outputState()[0], false);
  });
});

test('a scheduled-wake request times out after 30 seconds and ignores a late KEEP_ON reply', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: TIMER } });
  runtime.enqueueHttp({ delay: 31000, response: { body: 'KEEP_ON' } });
  restore(runtime);

  runtime.advance(HOUR + 60000 + 30000);
  runtime.advance(9 * 60000);
  assert.equal(runtime.outputState()[0], false);
  runtime.advance(1000);
  assert.equal(runtime.outputState()[0], false);
});

test('manual modes cancel and ignore stale TIMER wake, poll, deadline, and HTTP callbacks', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: TIMER } });
  runtime.enqueueHttp({ delay: 31000, response: { body: 'KEEP_ON' } });
  var controller = restore(runtime);
  var staleWake = runtime.timers.filter(function (timer) { return timer.repeat && timer.delay === HOUR; })[0];

  runtime.advance(HOUR + 60000);
  var staleTimers = runtime.timers.slice();
  controller.shortPress();
  runtime.advance(0);
  var before = runtime.outputHistory();
  staleWake.callback();
  staleTimers.forEach(function (timer) { timer.callback(); });
  runtime.advance(2 * HOUR);

  assert.deepEqual(runtime.outputHistory(), before);
  assert.deepEqual(runtime.outputState(), { 0: true, 1: false });
  assert.equal(httpGets(runtime).length, 1);
});

test('a persisted manual mode survives restart and never schedules TIMER work', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: MANUAL_FULL } });
  restore(runtime);
  runtime.advance(2 * HOUR);
  assert.deepEqual(runtime.outputState(), { 0: true, 1: true });
  assert.equal(httpGets(runtime).length, 0);
});

test('later TIMER wakes retain the existing remote behavior and reset the deadline', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: TIMER } });
  for (var count = 0; count < 60; count += 1) runtime.enqueueHttp({ response: { body: 'KEEP_ON' } });
  restore(runtime);

  runtime.advance(2 * HOUR);
  assert.equal(runtime.outputState()[0], true);
  runtime.advance(10 * 60000);
  assert.equal(runtime.outputState()[0], false);
});
