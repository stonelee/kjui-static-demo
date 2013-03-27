define("kj/static-demo/0.0.1/tab-debug", ["$-debug", "kjui/tab/0.0.1/tab-debug", "arale/switchable/0.9.11/switchable-debug", "arale/easing/1.0.0/easing-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug"], function(require, exports, module) {
  var $ = require('$-debug'),
    Tab = require('kjui/tab/0.0.1/tab-debug');

  var tab = new Tab({
    element: '#tab',
    triggers: '.tab-nav li',
    panels: '.tab-bd div'
  });
});
