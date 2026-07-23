'use strict';

function FakeRuntime(options) {
  options = options || {};
  this.now = 0;
  this.nextTimerId = 1;
  this.nextRegistrationOrder = 1;
  this.timers = [];
  this.timerById = {};
  this.outputs = {};
  this.outputsHistory = [];
  this.commands = [];
  this.kvs = copy(options.kvs || {});
  this.pendingKvsGets = [];
  this.eventHandlers = [];
  this.httpOutcomes = [];
  this.logs = [];
}

FakeRuntime.prototype.setTimer = function (delay, repeat, callback) {
  delay = Math.max(0, Number(delay) || 0);
  var timer = {
    id: this.nextTimerId++,
    delay: repeat ? Math.max(1, delay) : delay,
    due: this.now + delay,
    repeat: Boolean(repeat),
    callback: callback,
    order: this.nextRegistrationOrder++,
    cancelled: false
  };
  this.timerById[timer.id] = timer;
  this.timers.push(timer);
  return timer.id;
};

FakeRuntime.prototype.clearTimer = function (id) {
  var timer = this.timerById[id];
  if (timer) timer.cancelled = true;
};

FakeRuntime.prototype.setTimeout = function (callback, delay) {
  return this.setTimer(delay, false, callback);
};

FakeRuntime.prototype.clearTimeout = function (id) {
  this.clearTimer(id);
};

FakeRuntime.prototype.advance = function (ms) {
  var target = this.now + Math.max(0, Number(ms) || 0);
  var timer;
  while ((timer = this.nextDueTimer(target))) {
    this.removeTimer(timer);
    this.now = timer.due;
    timer.callback();
    if (timer.repeat && !timer.cancelled) {
      timer.due = this.now + timer.delay;
      timer.order = this.nextRegistrationOrder++;
      this.timers.push(timer);
    } else {
      delete this.timerById[timer.id];
    }
  }
  this.now = target;
};

FakeRuntime.prototype.nextDueTimer = function (target) {
  var eligible = this.timers.filter(function (timer) {
    return !timer.cancelled && timer.due <= target;
  });
  eligible.sort(function (left, right) {
    return left.due - right.due || left.order - right.order;
  });
  return eligible[0];
};

FakeRuntime.prototype.removeTimer = function (timer) {
  var index = this.timers.indexOf(timer);
  if (index !== -1) this.timers.splice(index, 1);
};

FakeRuntime.prototype.setOutput = function (id, on) {
  var command = { id: id, on: Boolean(on) };
  this.outputs[id] = command.on;
  this.outputsHistory.push(command);
  this.commands.push({ type: 'setOutput', id: id, on: command.on });
};

FakeRuntime.prototype.outputHistory = function () {
  return copy(this.outputsHistory);
};

FakeRuntime.prototype.outputState = function () {
  return copy(this.outputs);
};

FakeRuntime.prototype.commandHistory = function () {
  return copy(this.commands);
};

FakeRuntime.prototype.kvsGet = function (key, callback) {
  this.commands.push({ type: 'kvsGet', key: key });
  this.pendingKvsGets.push({ key: key, callback: callback });
};

FakeRuntime.prototype.resolveKvsGet = function (result, error) {
  var request = this.pendingKvsGets.shift();
  if (!request) throw new Error('No KVS get is pending');
  if (arguments.length === 0) {
    result = Object.prototype.hasOwnProperty.call(this.kvs, request.key) ? { value: this.kvs[request.key] } : { value: null };
  }
  this.setTimer(0, false, function () {
    request.callback(error || null, error ? null : result);
  });
};

FakeRuntime.prototype.kvsSet = function (key, value, callback) {
  var self = this;
  this.commands.push({ type: 'kvsSet', key: key, value: value });
  this.setTimer(0, false, function () {
    self.kvs[key] = value;
    if (callback) callback(null);
  });
};

FakeRuntime.prototype.kvsSnapshot = function () {
  return copy(this.kvs);
};

FakeRuntime.prototype.subscribe = function (handler) {
  this.eventHandlers.push(handler);
};

FakeRuntime.prototype.emit = function (event) {
  this.eventHandlers.slice().forEach(function (handler) { handler(event); });
};

FakeRuntime.prototype.emitSinglePush = function () {
  this.emit({ component: 'input:0', info: { event: 'single_push' } });
};

FakeRuntime.prototype.enqueueHttp = function (outcome) {
  this.httpOutcomes.push(outcome);
};

FakeRuntime.prototype.httpGet = function (url, callback) {
  var outcome = this.httpOutcomes.length ? this.httpOutcomes.shift() : { error: 'No HTTP outcome queued' };
  this.commands.push({ type: 'httpGet', url: url });
  if (outcome && outcome.hang) return;
  this.setTimer(outcome && outcome.delay || 0, false, function () {
    if (outcome && Object.prototype.hasOwnProperty.call(outcome, 'error')) {
      callback(outcome.error, null);
    } else {
      callback(null, outcome && outcome.response !== undefined ? outcome.response : outcome);
    }
  });
};

FakeRuntime.prototype.log = function () {
  this.logs.push(Array.prototype.slice.call(arguments));
};

FakeRuntime.prototype.logsSnapshot = function () {
  return copy(this.logs);
};

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = FakeRuntime;
