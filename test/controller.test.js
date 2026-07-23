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
