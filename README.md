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

供外网演示使用

```
$ node deploy.js
```
生成_site文件夹
