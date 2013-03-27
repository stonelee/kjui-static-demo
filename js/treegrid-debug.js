define("kj/static-demo/0.0.1/treegrid-debug", ["$-debug", "kjui/tree/0.0.1/tree-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug", "gallery/handlebars/1.0.0/handlebars-debug"], function(require, exports, module) {
  var $ = require('$-debug'),
    Tree = require('kjui/tree/0.0.1/tree-debug');

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
