(function () {
  'use strict';
  var __modules = {
'controller': function (module, exports, __load) {
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
  var pollingEnabled = Boolean(options && options.pollingEnabled === true);
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

  function clearTimer(timerId) {
    if (timerId !== null) runtime.clearTimer(timerId);
    return null;
  }

  function stopTimerMode() {
    wakeTimer = clearTimer(wakeTimer);
    deadlineTimer = clearTimer(deadlineTimer);
    pollTimer = clearTimer(pollTimer);
    requestTimeoutTimer = clearTimer(requestTimeoutTimer);
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

    runtime.setOutput(1, false);
    runtime.setOutput(0, mode === MANUAL_12V);
    if (mode === TIMER) scheduleWake(modeId);
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

  function poll(expectedModeId, expectedCycleId) {
    var thisRequestId = ++requestId;
    var timeoutTimer = runtime.setTimer(REQUEST_TIMEOUT_MS, false, function () {
      if (requestTimeoutTimer === timeoutTimer) requestTimeoutTimer = null;
      if (isCurrentRequest(expectedModeId, expectedCycleId, thisRequestId)) {
        requestId += 1;
        applyPollResponse();
      }
    });
    requestTimeoutTimer = timeoutTimer;
    runtime.httpGet(REMOTE_URL, function (error, response) {
      if (!isCurrentRequest(expectedModeId, expectedCycleId, thisRequestId)) return;
      runtime.clearTimer(timeoutTimer);
      requestTimeoutTimer = null;
      applyPollResponse(error ? null : response);
    });
  }

  function isCurrentRequest(expectedModeId, expectedCycleId, expectedRequestId) {
    return isCurrentCycle(expectedModeId, expectedCycleId) && requestId === expectedRequestId;
  }

  function applyPollResponse(response) {
    var body = response && typeof response.body === 'string' ? response.body : response;
    keepOn = typeof body === 'string' && body.trim() === 'KEEP_ON';
    if (!keepOn && deadlineTimer === null && busOn) turnBusOff();
  }

  function selectMode(nextMode) {
    if (initialized && mode !== nextMode) setMode(nextMode);
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
    shortPress: function () { selectMode(MANUAL_12V); },
    doublePress: function () { selectMode(MANUAL_FULL); },
    longPress: function () { selectMode(TIMER); }
  };
}

module.exports = createController;
module.exports.MANUAL_12V = MANUAL_12V;
module.exports.MANUAL_FULL = MANUAL_FULL;
module.exports.TIMER = TIMER;

},
'shelly-adapter': function (module, exports, __load) {
'use strict';

var DOUBLE_PRESS_WINDOW_MS = 1000;
// Set to true to re-enable remote KEEP_ON/DEFAULT polling in TIMER wakes.
var POLLING_ENABLED = false;

function createShellyAdapter(platform, createController) {
  var pendingSingleTimer = null;
  var controller;

  function callbackError(errorCode, errorMessage) {
    if (!errorCode) return null;
    return errorMessage || String(errorCode);
  }

  function clearPendingSingle() {
    if (pendingSingleTimer !== null) platform.Timer.clear(pendingSingleTimer);
    pendingSingleTimer = null;
  }

  function eventName(event) {
    return (event.info && event.info.event) || event.event || event.name || '';
  }

  function isLongPress(name) {
    return name === 'long_push' || name === 'long_press' || name === 'longpress' || name === 'long-push';
  }

  function handleEvent(event) {
    if (!event || event.component !== 'input:0') return;
    var name = eventName(event);
    if (name === 'single_push' && pendingSingleTimer === null) {
      pendingSingleTimer = platform.Timer.set(DOUBLE_PRESS_WINDOW_MS, false, function () {
        pendingSingleTimer = null;
        controller.shortPress();
      });
      return;
    }
    if (name === 'single_push' || name === 'double_push') {
      clearPendingSingle();
      controller.doublePress();
      return;
    }
    if (isLongPress(name)) {
      clearPendingSingle();
      controller.longPress();
    }
  }

  function runtime() {
    return {
      kvsGet: function (key, callback) {
        platform.Shelly.call('KVS.Get', { key: key }, function (result, errorCode, errorMessage) {
          callback(callbackError(errorCode, errorMessage), errorCode ? null : result);
        });
      },
      kvsSet: function (key, value, callback) {
        platform.Shelly.call('KVS.Set', { key: key, value: value }, function (result, errorCode, errorMessage) {
          if (callback) callback(callbackError(errorCode, errorMessage), errorCode ? null : result);
        });
      },
      setOutput: function (id, on) {
        platform.Shelly.call('Switch.Set', { id: id, on: on });
      },
      httpGet: function (url, callback) {
        platform.Shelly.call('HTTP.GET', { url: url }, function (result, errorCode, errorMessage) {
          callback(callbackError(errorCode, errorMessage), errorCode ? null : result);
        });
      },
      setTimer: function (delay, repeat, callback) {
        return platform.Timer.set(delay, repeat, callback);
      },
      clearTimer: function (timerId) {
        platform.Timer.clear(timerId);
      },
      log: function () {
        if (platform.print) platform.print.apply(null, arguments);
      }
    };
  }

  return {
    start: function () {
      controller = createController(runtime(), { pollingEnabled: POLLING_ENABLED });
      platform.Shelly.addEventHandler(handleEvent);
      controller.start();
    }
  };
}

module.exports = createShellyAdapter;

}
  };
  var __cache = {};
  function __load(name) {
    var module = __cache[name];
    if (module) return module.exports;
    module = { exports: {} };
    __cache[name] = module;
    __modules[name](module, module.exports, __load);
    return module.exports;
  }
  __load('shelly-adapter')({ Shelly: Shelly, Timer: Timer, print: print }, __load('controller')).start();
}());
