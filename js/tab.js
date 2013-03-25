define(function(require, exports, module) {
  var $ = require('$'),
    Tab = require('tab');

  var tab = new Tab({
    element: '#tab',
    triggers: '.tab-nav li',
    panels: '.tab-bd div'
  });
});
