define(function(require, exports, module) {
  var $ = require('$'),
    Tree = require('tree');

  var tree = new Tree({
    element: '#tree',
    headers: ['','编号','名称'],
    fields: ['id','name'],
    url: '../data/tree.json'
  });
  tree.on('click',function(){
    console.log(arguments);
  });
});
