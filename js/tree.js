define("kj/static-demo/0.0.1/tree",["$","kjui/tree/0.0.1/tree","arale/widget/1.0.2/widget","arale/base/1.0.1/base","arale/class/1.0.0/class","arale/events/1.0.0/events","gallery/handlebars/1.0.0/handlebars"],function(e,t,n){var r=e("$"),i=e("kjui/tree/0.0.1/tree"),s=new i({element:"#tree",url:"../data/tree.json"});s.on("click",function(){console.log(arguments)})});