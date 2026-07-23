'use strict';

var FULL_ON = 'FULL_ON';
var TIMER = 'TIMER';
var POWER_MODE_KEY = 'power_mode';

function createController(runtime) {
  var mode = TIMER;
  var initialized = false;

  runtime.subscribe(function (event) {
    if (initialized && event && event.component === 'input:0' && event.info && event.info.event === 'single_push') {
      mode = mode === FULL_ON ? TIMER : FULL_ON;
      runtime.kvsSet(POWER_MODE_KEY, mode);
      applyMode();
    }
  });

  function applyMode() {
    if (mode === FULL_ON) {
      runtime.setOutput(0, true);
      runtime.setOutput(1, true);
      return;
    }
    runtime.setOutput(1, false);
    runtime.setOutput(0, true);
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
