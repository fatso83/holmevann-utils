'use strict';

var MANUAL_12V = 'MANUAL_12V';
var MANUAL_FULL = 'MANUAL_FULL';
var TIMER = 'TIMER';
var POWER_MODE_KEY = 'power_mode';
var WAKE_INTERVAL_MS = 60 * 60 * 1000;
var MINIMUM_ON_MS = 10 * 60 * 1000;
var POLL_INTERVAL_MS = 60 * 1000;
var REQUEST_TIMEOUT_MS = 30 * 1000;
var REMOTE_URL = 'https://api.holmevann.no/power/remote';

function createController(runtime, options) {
  options = options || {};
  var pollingEnabled = options.pollingEnabled === true;
  var mode = TIMER;
  var initialized = false;
  var modeId = 0;
  var cycleId = 0;
  var requestId = 0;
  var wakeTimer = null;
  var deadlineTimer = null;
  var pollTimer = null;
  var requestTimeoutTimers = [];
  var busOn = false;
  var keepOn = false;

  function clearTimer(timerId) {
    if (timerId !== null) runtime.clearTimer(timerId);
    return null;
  }

  function clearRequestTimeouts() {
    requestTimeoutTimers.forEach(function (timerId) { runtime.clearTimer(timerId); });
    requestTimeoutTimers = [];
  }

  function stopTimerMode() {
    wakeTimer = clearTimer(wakeTimer);
    deadlineTimer = clearTimer(deadlineTimer);
    pollTimer = clearTimer(pollTimer);
    clearRequestTimeouts();
    cycleId += 1;
    requestId += 1;
    busOn = false;
    keepOn = false;
  }

  function setMode(nextMode) {
    mode = nextMode;
    runtime.kvsSet(POWER_MODE_KEY, mode);
    applyMode();
  }

  function applyMode() {
    modeId += 1;
    stopTimerMode();

    if (mode === MANUAL_FULL) {
      runtime.setOutput(0, true);
      runtime.setOutput(1, true);
      return;
    }

    if (mode === MANUAL_12V) {
      runtime.setOutput(1, false);
      runtime.setOutput(0, true);
      return;
    }

    runtime.setOutput(1, false);
    runtime.setOutput(0, false);
    scheduleWake(modeId);
  }

  function scheduleWake(expectedModeId) {
    wakeTimer = runtime.setTimer(WAKE_INTERVAL_MS, true, function () {
      if (isCurrentMode(expectedModeId)) wake(expectedModeId);
    });
  }

  function isCurrentMode(expectedModeId) {
    return mode === TIMER && modeId === expectedModeId;
  }

  function isCurrentCycle(expectedModeId, expectedCycleId) {
    return isCurrentMode(expectedModeId) && cycleId === expectedCycleId;
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

  function wake(expectedModeId) {
    var thisCycleId = ++cycleId;
    keepOn = false;
    turnBusOn();
    deadlineTimer = clearTimer(deadlineTimer);
    deadlineTimer = runtime.setTimer(MINIMUM_ON_MS, false, function () {
      if (!isCurrentCycle(expectedModeId, thisCycleId)) return;
      deadlineTimer = null;
      if (!keepOn) turnBusOff();
    });
    if (pollingEnabled) {
      pollTimer = clearTimer(pollTimer);
      pollTimer = runtime.setTimer(POLL_INTERVAL_MS, true, function () {
        if (isCurrentCycle(expectedModeId, thisCycleId) && busOn) poll(expectedModeId, thisCycleId);
      });
    }
  }

  function removeRequestTimeout(timerId) {
    requestTimeoutTimers = requestTimeoutTimers.filter(function (id) { return id !== timerId; });
  }

  function poll(expectedModeId, expectedCycleId) {
    var thisRequestId = ++requestId;
    var timeoutTimer = runtime.setTimer(REQUEST_TIMEOUT_MS, false, function () {
      removeRequestTimeout(timeoutTimer);
      if (isCurrentRequest(expectedModeId, expectedCycleId, thisRequestId)) {
        requestId += 1;
        applyPollResult('DEFAULT');
      }
    });
    requestTimeoutTimers.push(timeoutTimer);
    runtime.httpGet(REMOTE_URL, function (error, response) {
      if (!isCurrentRequest(expectedModeId, expectedCycleId, thisRequestId)) return;
      runtime.clearTimer(timeoutTimer);
      removeRequestTimeout(timeoutTimer);
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
        mode = !error && result && (result.value === MANUAL_12V || result.value === MANUAL_FULL || result.value === TIMER)
          ? result.value
          : TIMER;
        initialized = true;
        applyMode();
      });
    },
    shortPress: function () {
      if (initialized && (mode === TIMER || mode === MANUAL_FULL)) setMode(MANUAL_12V);
    },
    doublePress: function () {
      if (initialized && (mode === TIMER || mode === MANUAL_12V)) setMode(MANUAL_FULL);
    },
    longPress: function () {
      if (initialized && (mode === MANUAL_12V || mode === MANUAL_FULL)) setMode(TIMER);
    }
  };
}

module.exports = createController;
module.exports.MANUAL_12V = MANUAL_12V;
module.exports.MANUAL_FULL = MANUAL_FULL;
module.exports.TIMER = TIMER;
