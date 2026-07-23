'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var packageJson = require('../package.json');

test('npm test builds the Shelly bundle first', function () {
  assert.equal(packageJson.scripts.pretest, 'npm run build');
});
