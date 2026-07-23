'use strict';

var fs = require('node:fs');
var path = require('node:path');

var root = path.join(__dirname, '..');
var modules = [
  ['controller', path.join(root, 'src', 'controller.js')],
  ['shelly-adapter', path.join(root, 'src', 'shelly-adapter.js')]
];

function moduleSource(entry) {
  return "'" + entry[0] + "': function (module, exports, __load) {\n" +
    fs.readFileSync(entry[1], 'utf8') + '\n}';
}

var source = [
  '(function () {',
  "  'use strict';",
  '  var __modules = {',
  modules.map(moduleSource).join(',\n'),
  '  };',
  '  var __cache = {};',
  '  function __load(name) {',
  '    var module = __cache[name];',
  '    if (module) return module.exports;',
  '    module = { exports: {} };',
  '    __cache[name] = module;',
  '    __modules[name](module, module.exports, __load);',
  '    return module.exports;',
  '  }',
  "  __load('shelly-adapter')({ Shelly: Shelly, Timer: Timer, print: print }, __load('controller')).start();",
  '}());',
  ''
].join('\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'shelly-power-control.js'), source);
