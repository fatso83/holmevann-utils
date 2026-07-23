'use strict';

var FULL_ON = 'FULL_ON';
var TIMER = 'TIMER';
var POWER_MODE_KEY = 'power_mode';
var WAKE_INTERVAL_MS = 60 * 60 * 1000;
var MINIMUM_ON_MS = 10 * 60 * 1000;
var POLL_INTERVAL_MS = 60 * 1000;
var REQUEST_TIMEOUT_MS = 30 * 1000;
var REMOTE_URL = 'https://api.holmevann.no/power/remote';

function createController(runtime) {
  var mode = TIMER;
  var initialized = false;
  var modeId = 0;
  var cycleId = 0;
  var requestId = 0;
  var wakeTimer = null;
  var deadlineTimer = null;
  var pollTimer = null;
  var requestTimeoutTimer = null;
  var busOn = false;
  var keepOn = false;

  runtime.subscribe(function (event) {
    if (initialized && event && event.component === 'input:0' && event.info && event.info.event === 'single_push') {
      mode = mode === FULL_ON ? TIMER : FULL_ON;
      runtime.kvsSet(POWER_MODE_KEY, mode);
      applyMode();
    }
  });

  function applyMode() {
    modeId += 1;
    stopTimerMode();
    if (mode === FULL_ON) {
      runtime.setOutput(0, true);
      runtime.setOutput(1, true);
      return;
    }
    runtime.setOutput(1, false);
    var thisModeId = modeId;
    wakeTimer = runtime.setTimer(WAKE_INTERVAL_MS, true, function () {
      if (isCurrentMode(thisModeId)) wake();
    });
    wake();
  }

  function stopTimerMode() {
    wakeTimer = clearTimer(wakeTimer);
    deadlineTimer = clearTimer(deadlineTimer);
    pollTimer = clearTimer(pollTimer);
    requestTimeoutTimer = clearTimer(requestTimeoutTimer);
    cycleId += 1;
    requestId += 1;
    busOn = false;
    keepOn = false;
  }

  function clearTimer(timerId) {
    if (timerId !== null) runtime.clearTimer(timerId);
    return null;
  }

  function wake() {
    var thisModeId = modeId;
    var thisCycleId = ++cycleId;
    keepOn = false;
    turnBusOn();
    deadlineTimer = clearTimer(deadlineTimer);
    deadlineTimer = runtime.setTimer(MINIMUM_ON_MS, false, function () {
      if (!isCurrentCycle(thisModeId, thisCycleId)) return;
      deadlineTimer = null;
      if (!keepOn) turnBusOff();
    });
    pollTimer = clearTimer(pollTimer);
    pollTimer = runtime.setTimer(POLL_INTERVAL_MS, true, function () {
      if (isCurrentCycle(thisModeId, thisCycleId) && busOn) poll(thisModeId, thisCycleId);
    });
  }

  function isCurrentCycle(expectedModeId, expectedCycleId) {
    return isCurrentMode(expectedModeId) && cycleId === expectedCycleId;
  }

  function isCurrentMode(expectedModeId) {
    return mode === TIMER && modeId === expectedModeId;
  }

  function turnBusOn() {
    busOn = true;
    runtime.setOutput(0, true);
  }

  function turnBusOff() {
    busOn = false;
    runtime.setOutput(0, false);
    pollTimer = clearTimer(pollTimer);
  }

  function poll(expectedModeId, expectedCycleId) {
    var thisRequestId = ++requestId;
    requestTimeoutTimer = clearTimer(requestTimeoutTimer);
    requestTimeoutTimer = runtime.setTimer(REQUEST_TIMEOUT_MS, false, function () {
      if (isCurrentRequest(expectedModeId, expectedCycleId, thisRequestId)) {
        requestTimeoutTimer = null;
        requestId += 1;
        applyPollResult('DEFAULT');
      }
    });
    runtime.httpGet(REMOTE_URL, function (error, response) {
      if (!isCurrentRequest(expectedModeId, expectedCycleId, thisRequestId)) return;
      requestTimeoutTimer = clearTimer(requestTimeoutTimer);
      applyPollResult(error ? 'DEFAULT' : responseValue(response));
    });
  }

  function isCurrentRequest(expectedModeId, expectedCycleId, expectedRequestId) {
    return isCurrentCycle(expectedModeId, expectedCycleId) && requestId === expectedRequestId;
  }

  function responseValue(response) {
    var body = response && typeof response.body === 'string' ? response.body : response;
    return typeof body === 'string' && body.trim() === 'KEEP_ON' ? 'KEEP_ON' : 'DEFAULT';
  }

  function applyPollResult(value) {
    keepOn = value === 'KEEP_ON';
    if (!keepOn && deadlineTimer === null && busOn) turnBusOff();
  }

  return {
    start: function () {
      runtime.kvsGet(POWER_MODE_KEY, function (error, result) {
        mode = !error && result && (result.value === FULL_ON || result.value === TIMER)
          ? result.value
          : TIMER;
        initialized = true;
        applyMode();
      });
    }
  };
}

module.exports = createController;
module.exports.FULL_ON = FULL_ON;
module.exports.TIMER = TIMER;
