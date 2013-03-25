define(function(require, exports, module) {
  var $ = require('$'),
    Tree = require('tree');

  var tree = new Tree({
    element: '#tree',
    url: '../data/tree.json'
  });
  tree.on('click',function(){
    console.log(arguments);
  });
});
