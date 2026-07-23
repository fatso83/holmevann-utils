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
    var name;
    if (!event || event.component !== 'input:0') return;
    name = eventName(event);
    if (name === 'single_push') {
      if (pendingSingleTimer !== null) {
        clearPendingSingle();
        controller.doublePress();
        return;
      }
      pendingSingleTimer = platform.Timer.set(DOUBLE_PRESS_WINDOW_MS, false, function () {
        pendingSingleTimer = null;
        controller.shortPress();
      });
      return;
    }
    if (name === 'double_push') {
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
