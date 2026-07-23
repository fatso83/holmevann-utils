'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var createShellyAdapter = require('../src/shelly-adapter');

function createPlatform() {
  var calls = [];
  var timers = [];
  var handler = null;
  var nextTimerId = 1;
  return {
    calls: calls,
    timers: timers,
    Shelly: {
      call: function (method, params, callback) {
        calls.push({ method: method, params: params, callback: callback });
      },
      addEventHandler: function (nextHandler) { handler = nextHandler; }
    },
    Timer: {
      set: function (delay, repeat, callback) {
        var timer = { id: nextTimerId++, delay: delay, repeat: repeat, callback: callback, cleared: false };
        timers.push(timer);
        return timer.id;
      },
      clear: function (id) {
        timers.forEach(function (timer) { if (timer.id === id) timer.cleared = true; });
      }
    },
    emit: function (event) { handler(event); }
  };
}

function createControllerSpy() {
  var calls = [];
  return {
    calls: calls,
    create: function (runtime) {
      return {
        start: function () { calls.push({ type: 'start', runtime: runtime }); },
        shortPress: function () { calls.push({ type: 'shortPress' }); },
        doublePress: function () { calls.push({ type: 'doublePress' }); },
        longPress: function () { calls.push({ type: 'longPress' }); }
      };
    }
  };
}

test('adapter maps Shelly calls and callback errors to the controller runtime', function () {
  var platform = createPlatform();
  var spy = createControllerSpy();
  createShellyAdapter(platform, spy.create).start();
  var runtime = spy.calls[0].runtime;
  var received;

  runtime.kvsGet('power_mode', function (error, result) { received = { error: error, result: result }; });
  assert.deepEqual(platform.calls[0].method, 'KVS.Get');
  assert.deepEqual(platform.calls[0].params, { key: 'power_mode' });
  platform.calls[0].callback({ value: 'TIMER' }, 0, null);
  assert.deepEqual(received, { error: null, result: { value: 'TIMER' } });

  runtime.kvsSet('power_mode', 'MANUAL_FULL');
  runtime.setOutput(1, true);
  runtime.httpGet('https://example.test', function (error, result) { received = { error: error, result: result }; });
  assert.deepEqual(platform.calls.slice(1).map(function (call) { return [call.method, call.params]; }), [
    ['KVS.Set', { key: 'power_mode', value: 'MANUAL_FULL' }],
    ['Switch.Set', { id: 1, on: true }],
    ['HTTP.GET', { url: 'https://example.test' }]
  ]);
  platform.calls[3].callback(null, -1, 'offline');
  assert.deepEqual(received, { error: 'offline', result: null });
});

test('adapter recognizes input:0 single, double, and long button presses', function () {
  var platform = createPlatform();
  var spy = createControllerSpy();
  createShellyAdapter(platform, spy.create).start();

  platform.emit({ component: 'input:0', info: { event: 'single_push' } });
  assert.equal(platform.timers.length, 1);
  assert.equal(platform.timers[0].delay, 1000);
  platform.timers[0].callback();
  assert.deepEqual(spy.calls.map(function (call) { return call.type; }), ['start', 'shortPress']);

  platform.emit({ component: 'input:0', info: { event: 'single_push' } });
  platform.emit({ component: 'input:0', event: 'single_push' });
  assert.equal(platform.timers[1].cleared, true);
  assert.deepEqual(spy.calls.map(function (call) { return call.type; }), ['start', 'shortPress', 'doublePress']);

  platform.emit({ component: 'input:0', info: { event: 'single_push' } });
  platform.emit({ component: 'input:0', info: { event: 'double_push' } });
  assert.equal(platform.timers[2].cleared, true);
  assert.deepEqual(spy.calls.map(function (call) { return call.type; }), ['start', 'shortPress', 'doublePress', 'doublePress']);

  platform.emit({ component: 'input:0', info: { event: 'long_press' } });
  assert.deepEqual(spy.calls.map(function (call) { return call.type; }), ['start', 'shortPress', 'doublePress', 'doublePress', 'longPress']);
});

test('generated Shelly bundle uses no CommonJS loader or modern JavaScript syntax', function () {
  var bundle = fs.readFileSync(path.join(__dirname, '..', 'dist', 'shelly-power-control.js'), 'utf8');
  assert.doesNotMatch(bundle, /require\s*\(/);
  assert.doesNotMatch(bundle, /\b(?:const|let|class|async|await|Promise)\b|=>/);
});
