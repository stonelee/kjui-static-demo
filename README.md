#本地开发

##配置

* 将extui的css，images软链接到目录中
* 将~/.spm/sources/modules.spmjs.org软链接为sea-modules

##整体结构

index.html为主页面入口，各功能模块以iframe形式嵌入

各功能模块单独开发，页面在view中，对应的js在js中，data中为json数据供演示使用

config.js为各页面共用的seajs配置文件，项目所要使用的组件都在这里引入

每个页面都要引入合适的css，然后创建合适的页面，然后引入seajs和配置文件，最后引入业务模块js

##打包

package.json为打包配置文件

* name为项目名
* root为公司名
* dependencies与config.js中的alias相同
* output为打包输出文件，其中common.js为公共组件，然后各功能模块分别打包

打包命令

```
  $ spm build
```

##发布

生成_site



打包

开发环境下的模块依赖在config.js中指定

生产环境部署

1. 打包

使用package.json进行打包配置

1.1 配置依赖模块路径

将config.js中alias复制到package.json中的dependencies

1.2 将公共依赖模块打包到common

在src/common.js中require所有公共模块

package.json中配置公共模块
    "output": {
      "common.js": "*"
    }

package.json中配置各业务模块
    "output": {
        "main.js": ".",
        "tab.js": ".",
        "tree.js": ".",
        "treegrid.js": "."
    }

1.3 spm build

2. 生产环境页面配置

将所有html文件复制到生产环境目录

更改css路径

更改js配置

  <script src="../sea-modules/seajs/1.3.0/sea.js"></script>
  <script type="text/javascript">
    seajs.config({
      alias: {
        '$': 'gallery/jquery/1.8.1/jquery',
        '$-debug': 'gallery/jquery/1.8.1/jquery-debug',
        'common': 'kj/demo/0.0.1/common'
      }
    });

    seajs.use(['common', '../sea-modules/kj/demo/0.0.1/main']);
  </script>

这种配置省掉了config.js文件,页面加载时需要sea.js, jquery.js, common.js, main.js四个文件

如果需要调试可加上-debug
    seajs.config({
      alias: {
        '$': 'gallery/jquery/1.8.1/jquery',
        '$-debug': 'gallery/jquery/1.8.1/jquery-debug',
        'common': 'kj/demo/0.0.1/common-debug'
      }
    });

    seajs.use(['common', '../sea-modules/kj/demo/0.0.1/main-debug']);
