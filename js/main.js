define(function(require, exports, module) {
  var $ = require('$'),
    Accordion = require('accordion');

  var menu = new Accordion({
    element: '#menu',
    url: 'data/menu.json',
    height: 600 - 26
  });
  menu.on('itemclick', function(data) {
    $('#main').attr('src', 'view/' + data.uri + '.html');
  });

});
