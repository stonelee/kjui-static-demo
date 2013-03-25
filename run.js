var fs = require('fs');

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

var siteName = '_site';

reCreateDir(siteName);
cp('view/', siteName + '/view/');
cp('data/', siteName + '/data/');
cp('index.html', siteName + '/index.html');

var spawn = require('child_process').spawn;

function runCmd(cmd) {
  var args = cmd.split(' ');
  return spawn(args.shift(), args);
}
runCmd('spm build --src js/').on('exit', function() {
  cp('dist/', siteName + '/js/');
  clearDir('dist/');
});
