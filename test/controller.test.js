'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var createController = require('../src/controller');
var FakeRuntime = require('./fake-runtime');

test('start waits for the asynchronous KVS read before commanding outputs', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'FULL_ON' } });
  var controller = createController(runtime);

  controller.start();
  runtime.advance(0);
  assert.deepEqual(runtime.outputHistory(), []);

  runtime.resolveKvsGet();
  runtime.advance(0);
  assert.deepEqual(runtime.outputHistory(), [
    { id: 0, on: true },
    { id: 1, on: true }
  ]);
});

test('single push before KVS restore does not command outputs or overwrite the restored mode', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'FULL_ON' } });
  var controller = createController(runtime);

  controller.start();
  runtime.emitSinglePush();
  runtime.advance(0);

  assert.deepEqual(runtime.outputHistory(), []);
  assert.deepEqual(runtime.commandHistory().filter(function (command) {
    return command.type === 'kvsSet';
  }), []);

  runtime.resolveKvsGet();
  runtime.advance(0);

  assert.deepEqual(runtime.outputHistory(), [
    { id: 0, on: true },
    { id: 1, on: true }
  ]);
});

test('start defaults missing KVS mode to TIMER with inverter-off then bus-on ordering', function () {
  var runtime = new FakeRuntime();
  var controller = createController(runtime);

  controller.start();
  runtime.resolveKvsGet();
  runtime.advance(0);

  assert.deepEqual(runtime.outputHistory(), [
    { id: 1, on: false },
    { id: 0, on: true }
  ]);
});

test('start restores persisted FULL_ON mode with bus-on then inverter-on ordering', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'FULL_ON' } });
  var controller = createController(runtime);

  controller.start();
  runtime.resolveKvsGet();
  runtime.advance(0);

  assert.deepEqual(runtime.outputHistory(), [
    { id: 0, on: true },
    { id: 1, on: true }
  ]);
});

test('start falls back to TIMER when KVS returns an invalid mode or error', function () {
  var invalidRuntime = new FakeRuntime({ kvs: { power_mode: 'UNKNOWN' } });
  createController(invalidRuntime).start();
  invalidRuntime.resolveKvsGet();
  invalidRuntime.advance(0);

  var errorRuntime = new FakeRuntime();
  createController(errorRuntime).start();
  errorRuntime.resolveKvsGet(null, 'read failed');
  errorRuntime.advance(0);

  var expected = [{ id: 1, on: false }, { id: 0, on: true }];
  assert.deepEqual(invalidRuntime.outputHistory(), expected);
  assert.deepEqual(errorRuntime.outputHistory(), expected);
});

test('single push toggles modes, persists each selection, and uses safe output ordering', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
  var controller = createController(runtime);

  controller.start();
  runtime.resolveKvsGet();
  runtime.advance(0);
  runtime.emitSinglePush();
  runtime.emitSinglePush();
  runtime.advance(0);

  assert.deepEqual(runtime.outputHistory(), [
    { id: 1, on: false },
    { id: 0, on: true },
    { id: 0, on: true },
    { id: 1, on: true },
    { id: 1, on: false },
    { id: 0, on: true }
  ]);
  assert.deepEqual(runtime.commandHistory().filter(function (command) {
    return command.type === 'kvsSet';
  }), [
    { type: 'kvsSet', key: 'power_mode', value: 'FULL_ON' },
    { type: 'kvsSet', key: 'power_mode', value: 'TIMER' }
  ]);
  assert.deepEqual(runtime.kvsSnapshot(), { power_mode: 'TIMER' });
});

function restoreTimer(runtime) {
  var controller = createController(runtime);
  controller.start();
  runtime.resolveKvsGet();
  runtime.advance(0);
  return controller;
}

function httpGets(runtime) {
  return runtime.commandHistory().filter(function (command) {
    return command.type === 'httpGet';
  });
}

test('TIMER wakes immediately after restore and starts a fresh cycle every 60 minutes', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
  restoreTimer(runtime);

  assert.deepEqual(runtime.outputHistory(), [{ id: 1, on: false }, { id: 0, on: true }]);
  runtime.advance(599999);
  assert.equal(runtime.outputState()[0], true);
  runtime.advance(1);
  assert.equal(runtime.outputState()[0], false);
  runtime.advance(50 * 60000);
  assert.equal(runtime.outputState()[0], true);
  runtime.advance(600000);
  assert.equal(runtime.outputState()[0], false);
});

test('TIMER polls after 60 seconds and repeats only while its bus is on', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
  restoreTimer(runtime);

  runtime.advance(59999);
  assert.equal(httpGets(runtime).length, 0);
  runtime.advance(1);
  assert.deepEqual(httpGets(runtime), [{ type: 'httpGet', url: 'https://api.holmevann.no/power/remote' }]);
  runtime.advance(9 * 60000);
  assert.equal(runtime.outputState()[0], false);
  assert.equal(httpGets(runtime).length, 9);
  runtime.advance(60000);
  assert.equal(httpGets(runtime).length, 9);
});

test('only a trimmed KEEP_ON response keeps TIMER bus on beyond its 10 minute deadline', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
  for (var count = 0; count < 10; count += 1) {
    runtime.enqueueHttp({ response: { body: '  KEEP_ON\n' } });
  }
  restoreTimer(runtime);

  runtime.advance(60000);
  assert.equal(httpGets(runtime).length, 1);
  runtime.advance(540000);
  assert.equal(runtime.outputState()[0], true);
});

test('the 60 minute wake resets the 10 minute deadline even when the prior cycle was held', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
  for (var count = 0; count < 60; count += 1) {
    runtime.enqueueHttp({ response: { body: 'KEEP_ON' } });
  }
  restoreTimer(runtime);

  runtime.advance(60 * 60000);
  assert.equal(runtime.outputState()[0], true);
  runtime.advance(10 * 60000);
  assert.equal(runtime.outputState()[0], false);
});

test('DEFAULT, malformed, error, and hung poll results use the deadline default', function () {
  [
    { response: { body: ' DEFAULT ' } },
    { response: { body: 'keep_on' } },
    { error: 'network down' },
    { hang: true }
  ].forEach(function (outcome) {
    var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
    runtime.enqueueHttp(outcome);
    restoreTimer(runtime);
    runtime.advance(600000);
    assert.equal(runtime.outputState()[0], false);
  });
});

test('a request times out after 30 seconds and a late KEEP_ON reply is ignored', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
  runtime.enqueueHttp({ delay: 31000, response: { body: 'KEEP_ON' } });
  restoreTimer(runtime);

  runtime.advance(60000);
  runtime.advance(30000);
  runtime.advance(510000);
  assert.equal(runtime.outputState()[0], false);
  runtime.advance(1000);
  assert.equal(runtime.outputState()[0], false);
});

test('a mode change makes pending TIMER callbacks harmless and FULL_ON creates no timer polling', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
  runtime.enqueueHttp({ delay: 31000, response: { body: 'KEEP_ON' } });
  var controller = restoreTimer(runtime);

  runtime.advance(60000);
  runtime.emitSinglePush();
  runtime.advance(0);
  assert.deepEqual(runtime.outputState(), { 0: true, 1: true });
  runtime.advance(3600000);
  assert.equal(httpGets(runtime).length, 1);
  assert.deepEqual(runtime.outputState(), { 0: true, 1: true });
});

test('a stale TIMER wake cannot start an extra cycle after returning from FULL_ON', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
  restoreTimer(runtime);
  var staleWake = runtime.timers.filter(function (timer) {
    return timer.repeat && timer.delay === 60 * 60 * 1000;
  })[0];

  runtime.emitSinglePush();
  runtime.emitSinglePush();
  runtime.advance(0);
  var before = runtime.outputHistory();
  staleWake.callback();

  assert.deepEqual(runtime.outputHistory(), before);
});
