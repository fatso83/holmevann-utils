'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var path = require('node:path');
var FakeRuntime = require('./fake-runtime');

test('runs virtual timers by due time then registration order', function () {
  var runtime = new FakeRuntime();
  var calls = [];

  runtime.setTimer(20, false, function () { calls.push('late'); });
  runtime.setTimer(10, false, function () { calls.push('first'); });
  runtime.setTimer(10, false, function () { calls.push('second'); });

  runtime.advance(10);
  assert.deepEqual(calls, ['first', 'second']);
  runtime.advance(10);
  assert.deepEqual(calls, ['first', 'second', 'late']);
});

test('cancels virtual timers and repeats only while scheduled', function () {
  var runtime = new FakeRuntime();
  var calls = 0;
  var timer = runtime.setTimer(5, true, function () { calls += 1; });

  runtime.advance(15);
  runtime.clearTimer(timer);
  runtime.advance(15);
  assert.equal(calls, 3);
});

test('schedules a zero-delay repeating timer at least one virtual millisecond apart', function () {
  var runtimePath = path.join(__dirname, 'fake-runtime.js');
  var program = [
    "var FakeRuntime = require(" + JSON.stringify(runtimePath) + ");",
    'var runtime = new FakeRuntime();',
    'var calls = 0;',
    'runtime.setTimer(0, true, function () { calls += 1; });',
    'runtime.advance(1);',
    'process.stdout.write(String(calls));'
  ].join('');
  var result = childProcess.spawnSync(process.execPath, ['-e', program], {
    encoding: 'utf8',
    timeout: 500
  });

  assert.equal(result.status, 0, result.error && result.error.message);
  assert.equal(result.stdout, '2');
});

test('records output commands and maintains output state', function () {
  var runtime = new FakeRuntime();

  runtime.setOutput(1, false);
  runtime.setOutput(0, true);

  assert.deepEqual(runtime.outputHistory(), [
    { id: 1, on: false },
    { id: 0, on: true }
  ]);
  assert.deepEqual(runtime.outputState(), { 0: true, 1: false });
});

test('holds KVS reads until explicitly resolved and then delivers them asynchronously', function () {
  var runtime = new FakeRuntime({ kvs: { power_mode: 'TIMER' } });
  var result;

  runtime.kvsGet('power_mode', function (error, value) { result = [error, value]; });
  assert.equal(result, undefined);
  runtime.advance(0);
  assert.equal(result, undefined);
  runtime.resolveKvsGet({ value: 'TIMER' });
  assert.equal(result, undefined);
  runtime.advance(0);
  assert.deepEqual(result, [null, { value: 'TIMER' }]);
  runtime.kvsSet('power_mode', 'FULL_ON', function () {});
  runtime.advance(0);
  assert.deepEqual(runtime.kvsSnapshot(), { power_mode: 'FULL_ON' });
});

test('dispatches emitted events to subscribed handlers', function () {
  var runtime = new FakeRuntime();
  var events = [];
  runtime.subscribe(function (event) { events.push(event); });

  runtime.emit({ component: 'input:0', info: { event: 'single_push' } });

  assert.deepEqual(events, [{ component: 'input:0', info: { event: 'single_push' } }]);
});

test('delivers queued HTTP responses and errors asynchronously but leaves hangs pending', function () {
  var runtime = new FakeRuntime();
  var seen = [];
  runtime.enqueueHttp({ response: { code: 200, body: 'KEEP_ON' } });
  runtime.enqueueHttp({ error: 'network down' });
  runtime.enqueueHttp({ hang: true });

  runtime.httpGet('https://example.test/one', function (error, response) {
    seen.push([error, response]);
  });
  runtime.httpGet('https://example.test/two', function (error, response) {
    seen.push([error, response]);
  });
  runtime.httpGet('https://example.test/three', function () { seen.push('unexpected'); });
  assert.deepEqual(seen, []);
  runtime.advance(0);

  assert.deepEqual(seen, [
    [null, { code: 200, body: 'KEEP_ON' }],
    ['network down', null]
  ]);
  assert.deepEqual(runtime.commandHistory(), [
    { type: 'httpGet', url: 'https://example.test/one' },
    { type: 'httpGet', url: 'https://example.test/two' },
    { type: 'httpGet', url: 'https://example.test/three' }
  ]);
});

test('captures runtime logs', function () {
  var runtime = new FakeRuntime();
  runtime.log('mode', 'TIMER');
  assert.deepEqual(runtime.logsSnapshot(), [['mode', 'TIMER']]);
});
