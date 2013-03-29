var fs = require('fs');
var spawn = require('child_process').spawn;

//删除文件夹
function clearDir(path) {
  if (fs.existsSync(path)) {
    fs.readdirSync(path).forEach(function(file) {
      var curPath = path + '/' + file;
      if (fs.statSync(curPath).isDirectory()) { // recurse
        clearDir(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
}

//重建文件夹
function reCreateDir(path) {
  clearDir(path);
  fs.mkdirSync(path);
}

//复制文件或文件夹
function cp(origin, target) {
  if (fs.statSync(origin).isFile()) {
    fs.writeFileSync(target, fs.readFileSync(origin));
  } else if (fs.statSync(origin).isDirectory()) {
    reCreateDir(target);

    fs.readdirSync(origin).forEach(function(file) {
      var oCurrent = origin + '/' + file;
      var tCurrent = target + '/' + file;
      if (fs.statSync(oCurrent).isFile()) {
        fs.writeFileSync(tCurrent, fs.readFileSync(oCurrent));
      } else if (fs.statSync(oCurrent).isDirectory()) {
        cp(oCurrent, tCurrent);
      }
    });
  }
}

function runCmd(cmd) {
  var args = cmd.split(' ');
  return spawn(args.shift(), args);
}

//quick and dirty
function progressHtml(filename) {
  fs.readFile(filename, 'utf8', function(err, data) {
    data = data.replace('href="./css/all.css"', 'href="http://stonelee.info/kjui-extui/css/all.css"');
    data = data.replace('href="../css/all.css"', 'href="http://stonelee.info/kjui-extui/css/all.css"');
    data = data.replace('<script src="/sea-modules/seajs/1.3.0/sea.js" data-main="./config"></script>', '<script src="http://static.alipayobjects.com/seajs/1.3.1/sea.js"></script>');
    data = data.replace('<script src="/sea-modules/seajs/1.3.0/sea.js" data-main="../config"></script>', '<script src="http://static.alipayobjects.com/seajs/1.3.1/sea.js"></script>');

    //replace中$$代表$
    var data_config = "seajs.config({ alias: { '$$': 'gallery/jquery/1.8.1/jquery', '$$-debug': 'gallery/jquery/1.8.1/jquery-debug' } });";
    data = data.replace(/seajs\.use\('(\.{1,2})[^']+'\);/, data_config + "\nseajs.use('$1/js/common', function() {$&});");

    fs.writeFileSync(filename, data);
  });
}

var siteName = '_site';

reCreateDir(siteName);
cp('view/', siteName + '/view/');
cp('data/', siteName + '/data/');
cp('index.html', siteName + '/index.html');
cp('.gitignore', siteName + '/.gitignore');

runCmd('spm build --src js/').on('exit', function() {
  cp('dist/', siteName + '/js/');
  clearDir('dist/');
});

progressHtml(siteName + '/index.html');
fs.readdirSync(siteName + '/view').forEach(function(file) {
  progressHtml(siteName + '/view/' + file);
});
