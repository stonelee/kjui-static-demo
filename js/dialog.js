define(function(require, exports, module) {
  var $ = require('$'),
    Dialog = require('dialog');

  $(document).delegate('.btn', 'mousedown', function(e) {
    $(this).addClass('btn-is-pressed');
  }).delegate('.btn', 'mouseup', function(e) {
    $(this).removeClass('btn-is-pressed');
  });

  var d11 = new Dialog({
    trigger: '#trigger11',
    title: function() {
      return '我真是标题啊';
    },
    content: '我是内容 我是内容',
    effect: {
      type: 'move',
      from: 'up'
    },
    onConfirm: function() {
      var that = this;
      this.set('title', '三秒后关闭对话框');
      this.set('content', '不要啊！！');
      setTimeout(function() {
        that.hide();
      }, 3000);
    }
  });
  $('#trigger12').click(function() {
    Dialog.alert('静态方法ConfirmBox.alert');
  });

  $('#trigger13').click(function() {
    Dialog.confirm('静态方法ConfirmBox.confirm', '自定义标题', function() {
      alert('点击了确定按钮');
    }, function() {
      alert('点击了取消按钮');
    });
  });

  $('#trigger14').click(function() {
    Dialog.show('只是显示一些信息，右上角关闭');
  });
});
