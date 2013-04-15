define("arale/widget/1.0.2/daparser-debug", ["$-debug"], function(require, DAParser) {

  // DAParser
  // --------
  // data api 解析器，提供对单个 element 的解析，可用来初始化页面中的所有 Widget 组件。

  var $ = require('$-debug')


  // 得到某个 DOM 元素的 dataset
  DAParser.parseElement = function(element, raw) {
    element = $(element)[0]
    var dataset = {}

    // ref: https://developer.mozilla.org/en/DOM/element.dataset
    if (element.dataset) {
      // 转换成普通对象
      dataset = $.extend({}, element.dataset)
    }
    else {
      var attrs = element.attributes

      for (var i = 0, len = attrs.length; i < len; i++) {
        var attr = attrs[i]
        var name = attr.name

        if (name.indexOf('data-') === 0) {
          name = camelCase(name.substring(5))
          dataset[name] = attr.value
        }
      }
    }

    return raw === true ? dataset : normalizeValues(dataset)
  }


  // Helpers
  // ------

  var RE_DASH_WORD = /-([a-z])/g
  var JSON_LITERAL_PATTERN = /^\s*[\[{].*[\]}]\s*$/
  var parseJSON = this.JSON ? JSON.parse : $.parseJSON

  // 仅处理字母开头的，其他情况转换为小写："data-x-y-123-_A" --> xY-123-_a
  function camelCase(str) {
    return str.toLowerCase().replace(RE_DASH_WORD, function(all, letter) {
      return (letter + '').toUpperCase()
    })
  }

  // 解析并归一化配置中的值
  function normalizeValues(data) {
    for (var key in data) {
      if (data.hasOwnProperty(key)) {

        var val = data[key]
        if (typeof val !== 'string') continue

        if (JSON_LITERAL_PATTERN.test(val)) {
          val = val.replace(/'/g, '"')
          data[key] = normalizeValues(parseJSON(val))
        }
        else {
          data[key] = normalizeValue(val)
        }
      }
    }

    return data
  }

  // 将 'false' 转换为 false
  // 'true' 转换为 true
  // '3253.34' 转换为 3253.34
  function normalizeValue(val) {
    if (val.toLowerCase() === 'false') {
      val = false
    }
    else if (val.toLowerCase() === 'true') {
      val = true
    }
    else if (/\d/.test(val) && /[^a-z]/i.test(val)) {
      var number = parseFloat(val)
      if (number + '' === val) {
        val = number
      }
    }

    return val
  }

});

define("arale/widget/1.0.2/auto-render-debug", ["$-debug"], function(require, exports) {

  var $ = require('$-debug')
  var DATA_WIDGET_AUTO_RENDERED = 'data-widget-auto-rendered'


  // 自动渲染接口，子类可根据自己的初始化逻辑进行覆盖
  exports.autoRender = function(config) {
    return new this(config).render()
  }


  // 根据 data-widget 属性，自动渲染所有开启了 data-api 的 widget 组件
  exports.autoRenderAll = function(root, callback) {
    if (typeof root === 'function') {
      callback = root
      root = null
    }

    root = $(root || document.body)
    var modules = []
    var elements = []

    root.find('[data-widget]').each(function(i, element) {
      if (!exports.isDataApiOff(element)) {
        modules.push(element.getAttribute('data-widget').toLowerCase())
        elements.push(element)
      }
    })

    if (modules.length) {
      seajs.use(modules, function() {

        for (var i = 0; i < arguments.length; i++) {
          var SubWidget = arguments[i]
          var element = $(elements[i])

          // 已经渲染过
          if (element.attr(DATA_WIDGET_AUTO_RENDERED)) continue

          // 调用自动渲染接口
          SubWidget.autoRender && SubWidget.autoRender({
            element: element,
            renderType: 'auto'
          })

          // 标记已经渲染过
          element.attr(DATA_WIDGET_AUTO_RENDERED, 'true')
        }

        // 在所有自动渲染完成后，执行回调
        callback && callback()
      })
    }
  }


  var isDefaultOff = $(document.body).attr('data-api') === 'off'

  // 是否没开启 data-api
  exports.isDataApiOff = function(element) {
    var elementDataApi = $(element).attr('data-api')

    // data-api 默认开启，关闭只有两种方式：
    //  1. element 上有 data-api="off"，表示关闭单个
    //  2. document.body 上有 data-api="off"，表示关闭所有
    return  elementDataApi === 'off' ||
        (elementDataApi !== 'on' && isDefaultOff)
  }

});

define("arale/widget/1.0.2/widget-debug", ["./daparser-debug", "./auto-render-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug", "$-debug"], function(require, exports, module) {

  // Widget
  // ---------
  // Widget 是与 DOM 元素相关联的非工具类组件，主要负责 View 层的管理。
  // Widget 组件具有四个要素：描述状态的 attributes 和 properties，描述行为的 events
  // 和 methods。Widget 基类约定了这四要素创建时的基本流程和最佳实践。

  var Base = require('arale/base/1.0.1/base-debug')
  var $ = require('$-debug')
  var DAParser = require('./daparser-debug')
  var AutoRender = require('./auto-render-debug')

  var DELEGATE_EVENT_NS = '.delegate-events-'
  var ON_RENDER = '_onRender'
  var DATA_WIDGET_CID = 'data-widget-cid'

  // 所有初始化过的 Widget 实例
  var cachedInstances = {}


  var Widget = Base.extend({

    // config 中的这些键值会直接添加到实例上，转换成 properties
    propsInAttrs: ['element', 'template', 'model', 'events'],

    // 与 widget 关联的 DOM 元素
    element: null,

    // 默认模板
    template: '<div></div>',

    // 默认数据模型
    model: null,

    // 事件代理，格式为：
    //   {
    //     'mousedown .title': 'edit',
    //     'click {{attrs.saveButton}}': 'save'
    //     'click .open': function(ev) { ... }
    //   }
    events: null,

    // 属性列表
    attrs: {
      // 基本属性
      id: '',
      className: '',
      style: {},

      // 组件的默认父节点
      parentNode: document.body
    },

    // 初始化方法，确定组件创建时的基本流程：
    // 初始化 attrs --》 初始化 props --》 初始化 events --》 子类的初始化
    initialize: function(config) {
      this.cid = uniqueCid()

      // 初始化 attrs
      var dataAttrsConfig = this._parseDataAttrsConfig(config)
      this.initAttrs(config, dataAttrsConfig)

      // 初始化 props
      this.parseElement()
      this.initProps()

      // 初始化 events
      this.delegateEvents()

      // 子类自定义的初始化
      this.setup()

      // 保存实例信息
      this._stamp()
    },

    // 解析通过 data-attr 设置的 api
    _parseDataAttrsConfig: function(config) {
      var element, dataAttrsConfig
      config && (element = $(config.element))

      // 解析 data-api 时，只考虑用户传入的 element，不考虑来自继承或从模板构建的
      if (element && element[0] && !AutoRender.isDataApiOff(element)) {
        dataAttrsConfig = DAParser.parseElement(element)
      }

      return dataAttrsConfig
    },

    // 构建 this.element
    parseElement: function() {
      var element = this.element

      if (element) {
        this.element = $(element)
      }
      // 未传入 element 时，从 template 构建
      else if (this.get('template')) {
        this.parseElementFromTemplate()
      }

      // 如果对应的 DOM 元素不存在，则报错
      if (!this.element || !this.element[0]) {
        throw new Error('element is invalid')
      }
    },

    // 从模板中构建 this.element
    parseElementFromTemplate: function() {
      this.element = $(this.get('template'))
    },

    // 负责 properties 的初始化，提供给子类覆盖
    initProps: function() {
    },

    // 注册事件代理
    delegateEvents: function(events, handler) {
      events || (events = getEvents(this))
      if (!events) return

      // 允许使用：widget.delegateEvents('click p', function(ev) { ... })
      if (isString(events) && isFunction(handler)) {
        var o = {}
        o[events] = handler
        events = o
      }

      // key 为 'event selector'
      for (var key in events) {
        if (!events.hasOwnProperty(key)) continue

        var args = parseEventKey(key, this)
        var eventType = args.type
        var selector = args.selector

        ;(function(handler, widget) {

          var callback = function(ev) {
            if (isFunction(handler)) {
              handler.call(widget, ev)
            } else {
              widget[handler](ev)
            }
          }

          // delegate
          if (selector) {
            widget.element.on(eventType, selector, callback)
          }
          // normal bind
          // 分开写是为了兼容 zepto，zepto 的判断不如 jquery 强劲有力
          else {
            widget.element.on(eventType, callback)
          }

        })(events[key], this)
      }

      return this
    },

    // 卸载事件代理
    undelegateEvents: function(eventKey) {
      var args = {}

      // 卸载所有
      if (arguments.length === 0) {
        args.type = DELEGATE_EVENT_NS + this.cid
      }
      // 卸载特定类型：widget.undelegateEvents('click li')
      else {
        args = parseEventKey(eventKey, this)
      }

      this.element.off(args.type, args.selector)
      return this
    },

    // 提供给子类覆盖的初始化方法
    setup: function() {
    },

    // 将 widget 渲染到页面上
    // 渲染不仅仅包括插入到 DOM 树中，还包括样式渲染等
    // 约定：子类覆盖时，需保持 `return this`
    render: function() {

      // 让渲染相关属性的初始值生效，并绑定到 change 事件
      if (!this.rendered) {
        this._renderAndBindAttrs()
        this.rendered = true
      }

      // 插入到文档流中
      var parentNode = this.get('parentNode')
      if (parentNode && !isInDocument(this.element[0])) {
        this.element.appendTo(parentNode)
      }

      return this
    },

    // 让属性的初始值生效，并绑定到 change:attr 事件上
    _renderAndBindAttrs: function() {
      var widget = this
      var attrs = widget.attrs

      for (var attr in attrs) {
        if (!attrs.hasOwnProperty(attr)) continue
        var m = ON_RENDER + ucfirst(attr)

        if (this[m]) {
          var val = this.get(attr)

          // 让属性的初始值生效。注：默认空值不触发
          if (!isEmptyAttrValue(val)) {
            this[m](val, undefined, attr)
          }

          // 将 _onRenderXx 自动绑定到 change:xx 事件上
          (function(m) {
            widget.on('change:' + attr, function(val, prev, key) {
              widget[m](val, prev, key)
            })
          })(m)
        }
      }
    },

    _onRenderId: function(val) {
      this.element.attr('id', val)
    },

    _onRenderClassName: function(val) {
      this.element.addClass(val)
    },

    _onRenderStyle: function(val) {
      this.element.css(val)
    },

    // 让 element 与 Widget 实例建立关联
    _stamp: function() {
      var cid = this.cid

      this.element.attr(DATA_WIDGET_CID, cid)
      cachedInstances[cid] = this
    },

    // 在 this.element 内寻找匹配节点
    $: function(selector) {
      return this.element.find(selector)
    },

    destroy: function() {
      this.undelegateEvents()
      delete cachedInstances[this.cid]
      Widget.superclass.destroy.call(this)
    }
  })


  // 查询与 selector 匹配的第一个 DOM 节点，得到与该 DOM 节点相关联的 Widget 实例
  Widget.query = function(selector) {
    var element = $(selector).eq(0)
    var cid

    element && (cid = element.attr(DATA_WIDGET_CID))
    return cachedInstances[cid]
  }


  Widget.autoRender = AutoRender.autoRender
  Widget.autoRenderAll = AutoRender.autoRenderAll
  Widget.StaticsWhiteList = ['autoRender']

  module.exports = Widget


  // Helpers
  // ------

  var toString = Object.prototype.toString
  var cidCounter = 0

  function uniqueCid() {
    return 'widget-' + cidCounter++
  }

  function isString(val) {
    return toString.call(val) === '[object String]'
  }

  function isFunction(val) {
    return toString.call(val) === '[object Function]'
  }

  function isEmptyObject(o) {
    for (var p in o) {
      if (o.hasOwnProperty(p)) return false
    }
    return true
  }

  // Zepto 上没有 contains 方法
  var contains = $.contains || function(a, b) {
    //noinspection JSBitwiseOperatorUsage
    return !!(a.compareDocumentPosition(b) & 16)
  }

  function isInDocument(element) {
    return contains(document.documentElement, element)
  }

  function ucfirst(str) {
    return str.charAt(0).toUpperCase() + str.substring(1)
  }


  var EVENT_KEY_SPLITTER = /^(\S+)\s*(.*)$/
  var EXPRESSION_FLAG = /{{([^}]+)}}/g
  var INVALID_SELECTOR = 'INVALID_SELECTOR'

  function getEvents(widget) {
    if (isFunction(widget.events)) {
      widget.events = widget.events()
    }
    return widget.events
  }

  function parseEventKey(eventKey, widget) {
    var match = eventKey.match(EVENT_KEY_SPLITTER)
    var eventType = match[1] + DELEGATE_EVENT_NS + widget.cid

    // 当没有 selector 时，需要设置为 undefined，以使得 zepto 能正确转换为 bind
    var selector = match[2] || undefined

    if (selector && selector.indexOf('{{') > -1) {
      selector = parseExpressionInEventKey(selector, widget)
    }

    return {
      type: eventType,
      selector: selector
    }
  }

  // 解析 eventKey 中的 {{xx}}, {{yy}}
  function parseExpressionInEventKey(selector, widget) {

    return selector.replace(EXPRESSION_FLAG, function(m, name) {
      var parts = name.split('.')
      var point = widget, part

      while (part = parts.shift()) {
        if (point === widget.attrs) {
          point = widget.get(part)
        } else {
          point = point[part]
        }
      }

      // 已经是 className，比如来自 dataset 的
      if (isString(point)) {
        return point
      }

      // 不能识别的，返回无效标识
      return INVALID_SELECTOR
    })
  }


  // 对于 attrs 的 value 来说，以下值都认为是空值： null, undefined, '', [], {}
  function isEmptyAttrValue(o) {
    return o == null || // null, undefined
        (isString(o) || $.isArray(o)) && o.length === 0 || // '', []
        $.isPlainObject(o) && isEmptyObject(o); // {}
  }

});

define("arale/base/1.0.1/aspect-debug", [], function(require, exports) {

  // Aspect
  // ---------------------
  // Thanks to:
  //  - http://yuilibrary.com/yui/docs/api/classes/Do.html
  //  - http://code.google.com/p/jquery-aop/
  //  - http://lazutkin.com/blog/2008/may/18/aop-aspect-javascript-dojo/


  // 在指定方法执行前，先执行 callback
  exports.before = function(methodName, callback, context) {
    return weave.call(this, 'before', methodName, callback, context);
  };


  // 在指定方法执行后，再执行 callback
  exports.after = function(methodName, callback, context) {
    return weave.call(this, 'after', methodName, callback, context);
  };


  // Helpers
  // -------

  var eventSplitter = /\s+/;

  function weave(when, methodName, callback, context) {
    var names = methodName.split(eventSplitter);
    var name, method;

    while (name = names.shift()) {
      method = getMethod(this, name);
      if (!method.__isAspected) {
        wrap.call(this, name);
      }
      this.on(when + ':' + name, callback, context);
    }

    return this;
  }


  function getMethod(host, methodName) {
    var method = host[methodName];
    if (!method) {
      throw new Error('Invalid method name: ' + methodName);
    }
    return method;
  }


  function wrap(methodName) {
    var old = this[methodName];

    this[methodName] = function() {
      var args = Array.prototype.slice.call(arguments);
      var beforeArgs = ['before:' + methodName].concat(args);

      this.trigger.apply(this, beforeArgs);
      var ret = old.apply(this, arguments);
      this.trigger('after:' + methodName, ret);

      return ret;
    };

    this[methodName].__isAspected = true;
  }

});

define("arale/base/1.0.1/attribute-debug", [], function(require, exports) {

  // Attribute
  // -----------------
  // Thanks to:
  //  - http://documentcloud.github.com/backbone/#Model
  //  - http://yuilibrary.com/yui/docs/api/classes/AttributeCore.html
  //  - https://github.com/berzniz/backbone.getters.setters


  // 负责 attributes 的初始化
  // attributes 是与实例相关的状态信息，可读可写，发生变化时，会自动触发相关事件
  exports.initAttrs = function(config, dataAttrsConfig) {

    // 合并来自 data-attr 的配置
    if (dataAttrsConfig) {
      config = config ? merge(dataAttrsConfig, config) : dataAttrsConfig;
    }

    // Get all inherited attributes.
    var specialProps = this.propsInAttrs || [];
    var inheritedAttrs = getInheritedAttrs(this, specialProps);
    var attrs = merge({}, inheritedAttrs);
    var userValues;

    // Merge user-specific attributes from config.
    if (config) {
      userValues = normalize(config, true);
      merge(attrs, userValues);
    }

    // Automatically register `this._onChangeAttr` method as
    // a `change:attr` event handler.
    parseEventsFromInstance(this, attrs);

    // initAttrs 是在初始化时调用的，默认情况下实例上肯定没有 attrs，不存在覆盖问题
    this.attrs = attrs;

    // 对于有 setter 的属性，要用初始值 set 一下，以保证关联属性也一同初始化
    setSetterAttrs(this, attrs, userValues);

    // Convert `on/before/afterXxx` config to event handler.
    parseEventsFromAttrs(this, attrs);

    // 将 this.attrs 上的 special properties 放回 this 上
    copySpecialProps(specialProps, this, this.attrs, true);
  };


  // Get the value of an attribute.
  exports.get = function(key) {
    var attr = this.attrs[key] || {};
    var val = attr.value;
    return attr.getter ? attr.getter.call(this, val, key) : val;
  };


  // Set a hash of model attributes on the object, firing `"change"` unless
  // you choose to silence it.
  exports.set = function(key, val, options) {
    var attrs = {};

    // set("key", val, options)
    if (isString(key)) {
      attrs[key] = val;
    }
    // set({ "key": val, "key2": val2 }, options)
    else {
      attrs = key;
      options = val;
    }

    options || (options = {});
    var silent = options.silent;

    var now = this.attrs;
    var changed = this.__changedAttrs || (this.__changedAttrs = {});

    for (key in attrs) {
      if (!attrs.hasOwnProperty(key)) continue;

      var attr = now[key] || (now[key] = {});
      val = attrs[key];

      if (attr.readOnly) {
        throw new Error('This attribute is readOnly: ' + key);
      }

      // invoke setter
      if (attr.setter) {
        val = attr.setter.call(this, val, key);
      }

      // 获取设置前的 prev 值
      var prev = this.get(key);

      // 获取需要设置的 val 值
      // 都为对象时，做 merge 操作，以保留 prev 上没有覆盖的值
      if (isPlainObject(prev) && isPlainObject(val)) {
        val = merge(merge({}, prev), val);
      }

      // set finally
      now[key].value = val;

      // invoke change event
      // 初始化时对 set 的调用，不触发任何事件
      if (!this.__initializingAttrs && !isEqual(prev, val)) {
        if (silent) {
          changed[key] = [val, prev];
        }
        else {
          this.trigger('change:' + key, val, prev, key);
        }
      }
    }

    return this;
  };


  // Call this method to manually fire a `"change"` event for triggering
  // a `"change:attribute"` event for each changed attribute.
  exports.change = function() {
    var changed = this.__changedAttrs;

    if (changed) {
      for (var key in changed) {
        if (changed.hasOwnProperty(key)) {
          var args = changed[key];
          this.trigger('change:' + key, args[0], args[1], key);
        }
      }
      delete this.__changedAttrs;
    }

    return this;
  };


  // Helpers
  // -------

  var toString = Object.prototype.toString;
  var hasOwn = Object.prototype.hasOwnProperty;

  var isArray = Array.isArray || function(val) {
    return toString.call(val) === '[object Array]';
  };

  function isString(val) {
    return toString.call(val) === '[object String]';
  }

  function isFunction(val) {
    return toString.call(val) === '[object Function]';
  }

  function isWindow(o) {
    return o != null && o == o.window;
  }

  function isPlainObject(o) {
    // Must be an Object.
    // Because of IE, we also have to check the presence of the constructor
    // property. Make sure that DOM nodes and window objects don't
    // pass through, as well
    if (!o || toString.call(o) !== "[object Object]" ||
        o.nodeType || isWindow(o)) {
      return false;
    }

    try {
      // Not own constructor property must be Object
      if (o.constructor &&
          !hasOwn.call(o, "constructor") &&
          !hasOwn.call(o.constructor.prototype, "isPrototypeOf")) {
        return false;
      }
    } catch (e) {
      // IE8,9 Will throw exceptions on certain host objects #9897
      return false;
    }

    // Own properties are enumerated firstly, so to speed up,
    // if last one is own, then all properties are own.
    for (var key in o) {}

    return key === undefined || hasOwn.call(o, key);
  }

  function isEmptyObject(o) {
    for (var p in o) {
      if (o.hasOwnProperty(p)) return false;
    }
    return true;
  }

  function merge(receiver, supplier) {
    var key, value;

    for (key in supplier) {
      if (supplier.hasOwnProperty(key)) {
        value = supplier[key];

        // 只 clone 数组和 plain object，其他的保持不变
        if (isArray(value)) {
          value = value.slice();
        }
        else if (isPlainObject(value)) {
          var prev = receiver[key];
          isPlainObject(prev) || (prev = {});

          value = merge(prev, value);
        }

        receiver[key] = value;
      }
    }

    return receiver;
  }

  var keys = Object.keys;

  if (!keys) {
    keys = function(o) {
      var result = [];

      for (var name in o) {
        if (o.hasOwnProperty(name)) {
          result.push(name);
        }
      }
      return result;
    }
  }

  function ucfirst(str) {
    return str.charAt(0).toUpperCase() + str.substring(1);
  }


  function getInheritedAttrs(instance, specialProps) {
    var inherited = [];
    var proto = instance.constructor.prototype;

    while (proto) {
      // 不要拿到 prototype 上的
      if (!proto.hasOwnProperty('attrs')) {
        proto.attrs = {};
      }

      // 将 proto 上的特殊 properties 放到 proto.attrs 上，以便合并
      copySpecialProps(specialProps, proto.attrs, proto);

      // 为空时不添加
      if (!isEmptyObject(proto.attrs)) {
        inherited.unshift(proto.attrs);
      }

      // 向上回溯一级
      proto = proto.constructor.superclass;
    }

    // Merge and clone default values to instance.
    var result = {};
    for (var i = 0, len = inherited.length; i < len; i++) {
      result = merge(result, normalize(inherited[i]));
    }

    return result;
  }

  function copySpecialProps(specialProps, receiver, supplier, isAttr2Prop) {
    for (var i = 0, len = specialProps.length; i < len; i++) {
      var key = specialProps[i];

      if (supplier.hasOwnProperty(key)) {
        receiver[key] = isAttr2Prop ? receiver.get(key) : supplier[key];
      }
    }
  }


  var EVENT_PATTERN = /^(on|before|after)([A-Z].*)$/;
  var EVENT_NAME_PATTERN = /^(Change)?([A-Z])(.*)/;

  function parseEventsFromInstance(host, attrs) {
    for (var attr in attrs) {
      if (attrs.hasOwnProperty(attr)) {
        var m = '_onChange' + ucfirst(attr);
        if (host[m]) {
          host.on('change:' + attr, host[m]);
        }
      }
    }
  }

  function parseEventsFromAttrs(host, attrs) {
    for (var key in attrs) {
      if (attrs.hasOwnProperty(key)) {
        var value = attrs[key].value, m;

        if (isFunction(value) && (m = key.match(EVENT_PATTERN))) {
          host[m[1]](getEventName(m[2]), value);
          delete attrs[key];
        }
      }
    }
  }

  // Converts `Show` to `show` and `ChangeTitle` to `change:title`
  function getEventName(name) {
    var m = name.match(EVENT_NAME_PATTERN);
    var ret = m[1] ? 'change:' : '';
    ret += m[2].toLowerCase() + m[3];
    return ret;
  }


  function setSetterAttrs(host, attrs, userValues) {
    var options = { silent: true };
    host.__initializingAttrs = true;

    for (var key in userValues) {
      if (userValues.hasOwnProperty(key)) {
        if (attrs[key].setter) {
          host.set(key, userValues[key].value, options);
        }
      }
    }

    delete host.__initializingAttrs;
  }


  var ATTR_SPECIAL_KEYS = ['value', 'getter', 'setter', 'readOnly'];

  // normalize `attrs` to
  //
  //   {
  //      value: 'xx',
  //      getter: fn,
  //      setter: fn,
  //      readOnly: boolean
  //   }
  //
  function normalize(attrs, isUserValue) {
    // clone it
    attrs = merge({}, attrs);

    for (var key in attrs) {
      var attr = attrs[key];

      if (isPlainObject(attr) &&
          !isUserValue &&
          hasOwnProperties(attr, ATTR_SPECIAL_KEYS)) {
        continue;
      }

      attrs[key] = {
        value: attr
      };
    }

    return attrs;
  }

  function hasOwnProperties(object, properties) {
    for (var i = 0, len = properties.length; i < len; i++) {
      if (object.hasOwnProperty(properties[i])) {
        return true;
      }
    }
    return false;
  }


  // 对于 attrs 的 value 来说，以下值都认为是空值： null, undefined, '', [], {}
  function isEmptyAttrValue(o) {
    return o == null || // null, undefined
        (isString(o) || isArray(o)) && o.length === 0 || // '', []
        isPlainObject(o) && isEmptyObject(o); // {}
  }

  // 判断属性值 a 和 b 是否相等，注意仅适用于属性值的判断，非普适的 === 或 == 判断。
  function isEqual(a, b) {
    if (a === b) return true;

    if (isEmptyAttrValue(a) && isEmptyAttrValue(b)) return true;

    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className != toString.call(b)) return false;

    switch (className) {

      // Strings, numbers, dates, and booleans are compared by value.
      case '[object String]':
        // Primitives and their corresponding object wrappers are
        // equivalent; thus, `"5"` is equivalent to `new String("5")`.
        return a == String(b);

      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive. An `equal`
        // comparison is performed for other numeric values.
        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);

      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values.
        // Dates are compared by their millisecond representations.
        // Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a == +b;

      // RegExps are compared by their source patterns and flags.
      case '[object RegExp]':
        return a.source == b.source &&
            a.global == b.global &&
            a.multiline == b.multiline &&
            a.ignoreCase == b.ignoreCase;

      // 简单判断数组包含的 primitive 值是否相等
      case '[object Array]':
        var aString = a.toString();
        var bString = b.toString();

        // 只要包含非 primitive 值，为了稳妥起见，都返回 false
        return aString.indexOf('[object') === -1 &&
            bString.indexOf('[object') === -1 &&
            aString === bString;
    }

    if (typeof a != 'object' || typeof b != 'object') return false;

    // 简单判断两个对象是否相等，只判断第一层
    if (isPlainObject(a) && isPlainObject(b)) {

      // 键值不相等，立刻返回 false
      if (!isEqual(keys(a), keys(b))) {
        return false;
      }

      // 键相同，但有值不等，立刻返回 false
      for (var p in a) {
        if (a[p] !== b[p]) return false;
      }

      return true;
    }

    // 其他情况返回 false, 以避免误判导致 change 事件没发生
    return false;
  }

});

define("arale/base/1.0.1/base-debug", ["./aspect-debug", "./attribute-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug"], function(require, exports, module) {

  // Base
  // ---------
  // Base 是一个基础类，提供 Class、Events、Attrs 和 Aspect 支持。

  var Class = require('arale/class/1.0.0/class-debug');
  var Events = require('arale/events/1.0.0/events-debug');
  var Aspect = require('./aspect-debug');
  var Attribute = require('./attribute-debug');


  module.exports = Class.create({
    Implements: [Events, Aspect, Attribute],

    initialize: function(config) {
      this.initAttrs(config);
    },

    destroy: function() {
      this.off();

      for (var p in this) {
        if (this.hasOwnProperty(p)) {
          delete this[p];
        }
      }
    }
  });

});

define("arale/class/1.0.0/class-debug", [], function(require, exports, module) {

  // Class
  // -----------------
  // Thanks to:
  //  - http://mootools.net/docs/core/Class/Class
  //  - http://ejohn.org/blog/simple-javascript-inheritance/
  //  - https://github.com/ded/klass
  //  - http://documentcloud.github.com/backbone/#Model-extend
  //  - https://github.com/joyent/node/blob/master/lib/util.js
  //  - https://github.com/kissyteam/kissy/blob/master/src/seed/src/kissy.js


  // The base Class implementation.
  function Class(o) {
    // Convert existed function to Class.
    if (!(this instanceof Class) && isFunction(o)) {
      return classify(o)
    }
  }

  module.exports = Class


  // Create a new Class.
  //
  //  var SuperPig = Class.create({
  //    Extends: Animal,
  //    Implements: Flyable,
  //    initialize: function() {
  //      SuperPig.superclass.initialize.apply(this, arguments)
  //    },
  //    Statics: {
  //      COLOR: 'red'
  //    }
  // })
  //
  Class.create = function(parent, properties) {
    if (!isFunction(parent)) {
      properties = parent
      parent = null
    }

    properties || (properties = {})
    parent || (parent = properties.Extends || Class)
    properties.Extends = parent

    // The created class constructor
    function SubClass() {
      // Call the parent constructor.
      parent.apply(this, arguments)

      // Only call initialize in self constructor.
      if (this.constructor === SubClass && this.initialize) {
        this.initialize.apply(this, arguments)
      }
    }

    // Inherit class (static) properties from parent.
    if (parent !== Class) {
      mix(SubClass, parent, parent.StaticsWhiteList)
    }

    // Add instance properties to the subclass.
    implement.call(SubClass, properties)

    // Make subclass extendable.
    return classify(SubClass)
  }


  function implement(properties) {
    var key, value

    for (key in properties) {
      value = properties[key]

      if (Class.Mutators.hasOwnProperty(key)) {
        Class.Mutators[key].call(this, value)
      } else {
        this.prototype[key] = value
      }
    }
  }


  // Create a sub Class based on `Class`.
  Class.extend = function(properties) {
    properties || (properties = {})
    properties.Extends = this

    return Class.create(properties)
  }


  function classify(cls) {
    cls.extend = Class.extend
    cls.implement = implement
    return cls
  }


  // Mutators define special properties.
  Class.Mutators = {

    'Extends': function(parent) {
      var existed = this.prototype
      var proto = createProto(parent.prototype)

      // Keep existed properties.
      mix(proto, existed)

      // Enforce the constructor to be what we expect.
      proto.constructor = this

      // Set the prototype chain to inherit from `parent`.
      this.prototype = proto

      // Set a convenience property in case the parent's prototype is
      // needed later.
      this.superclass = parent.prototype

      // Add module meta information in sea.js environment.
      addMeta(proto)
    },

    'Implements': function(items) {
      isArray(items) || (items = [items])
      var proto = this.prototype, item

      while (item = items.shift()) {
        mix(proto, item.prototype || item)
      }
    },

    'Statics': function(staticProperties) {
      mix(this, staticProperties)
    }
  }


  // Shared empty constructor function to aid in prototype-chain creation.
  function Ctor() {
  }

  // See: http://jsperf.com/object-create-vs-new-ctor
  var createProto = Object.__proto__ ?
      function(proto) {
        return { __proto__: proto }
      } :
      function(proto) {
        Ctor.prototype = proto
        return new Ctor()
      }


  // Helpers
  // ------------

  function mix(r, s, wl) {
    // Copy "all" properties including inherited ones.
    for (var p in s) {
      if (s.hasOwnProperty(p)) {
        if (wl && indexOf(wl, p) === -1) continue

        // 在 iPhone 1 代等设备的 Safari 中，prototype 也会被枚举出来，需排除
        if (p !== 'prototype') {
          r[p] = s[p]
        }
      }
    }
  }


  var toString = Object.prototype.toString
  var isArray = Array.isArray

  if (!isArray) {
    isArray = function(val) {
      return toString.call(val) === '[object Array]'
    }
  }

  var isFunction = function(val) {
    return toString.call(val) === '[object Function]'
  }

  var indexOf = Array.prototype.indexOf ?
      function(arr, item) {
        return arr.indexOf(item)
      } :
      function(arr, item) {
        for (var i = 0, len = arr.length; i < len; i++) {
          if (arr[i] === item) {
            return i
          }
        }
        return -1
      }


  var getCompilingModule = module.constructor._getCompilingModule

  function addMeta(proto) {
    if (!getCompilingModule) return

    var compilingModule = getCompilingModule()
    if (!compilingModule) return

    var filename = compilingModule.uri.split(/[\/\\]/).pop()

    if (Object.defineProperties) {
      Object.defineProperties(proto, {
        __module: { value: compilingModule },
        __filename: { value: filename }
      })
    }
    else {
      proto.__module = compilingModule
      proto.__filename = filename
    }
  }

})

define("arale/events/1.0.0/events-debug", [], function() {

  // Events
  // -----------------
  // Thanks to:
  //  - https://github.com/documentcloud/backbone/blob/master/backbone.js
  //  - https://github.com/joyent/node/blob/master/lib/events.js


  // Regular expression used to split event strings
  var eventSplitter = /\s+/


  // A module that can be mixed in to *any object* in order to provide it
  // with custom events. You may bind with `on` or remove with `off` callback
  // functions to an event; `trigger`-ing an event fires all callbacks in
  // succession.
  //
  //     var object = new Events();
  //     object.on('expand', function(){ alert('expanded'); });
  //     object.trigger('expand');
  //
  function Events() {
  }


  // Bind one or more space separated events, `events`, to a `callback`
  // function. Passing `"all"` will bind the callback to all events fired.
  Events.prototype.on = function(events, callback, context) {
    var cache, event, list
    if (!callback) return this

    cache = this.__events || (this.__events = {})
    events = events.split(eventSplitter)

    while (event = events.shift()) {
      list = cache[event] || (cache[event] = [])
      list.push(callback, context)
    }

    return this
  }


  // Remove one or many callbacks. If `context` is null, removes all callbacks
  // with that function. If `callback` is null, removes all callbacks for the
  // event. If `events` is null, removes all bound callbacks for all events.
  Events.prototype.off = function(events, callback, context) {
    var cache, event, list, i

    // No events, or removing *all* events.
    if (!(cache = this.__events)) return this
    if (!(events || callback || context)) {
      delete this.__events
      return this
    }

    events = events ? events.split(eventSplitter) : keys(cache)

    // Loop through the callback list, splicing where appropriate.
    while (event = events.shift()) {
      list = cache[event]
      if (!list) continue

      if (!(callback || context)) {
        delete cache[event]
        continue
      }

      for (i = list.length - 2; i >= 0; i -= 2) {
        if (!(callback && list[i] !== callback ||
            context && list[i + 1] !== context)) {
          list.splice(i, 2)
        }
      }
    }

    return this
  }


  // Trigger one or many events, firing all bound callbacks. Callbacks are
  // passed the same arguments as `trigger` is, apart from the event name
  // (unless you're listening on `"all"`, which will cause your callback to
  // receive the true name of the event as the first argument).
  Events.prototype.trigger = function(events) {
    var cache, event, all, list, i, len, rest = [], args
    if (!(cache = this.__events)) return this

    events = events.split(eventSplitter)

    // Fill up `rest` with the callback arguments.  Since we're only copying
    // the tail of `arguments`, a loop is much faster than Array#slice.
    for (i = 1, len = arguments.length; i < len; i++) {
      rest[i - 1] = arguments[i]
    }

    // For each event, walk through the list of callbacks twice, first to
    // trigger the event, then to trigger any `"all"` callbacks.
    while (event = events.shift()) {
      // Copy callback lists to prevent modification.
      if (all = cache.all) all = all.slice()
      if (list = cache[event]) list = list.slice()

      // Execute event callbacks.
      if (list) {
        for (i = 0, len = list.length; i < len; i += 2) {
          list[i].apply(list[i + 1] || this, rest)
        }
      }

      // Execute "all" callbacks.
      if (all) {
        args = [event].concat(rest)
        for (i = 0, len = all.length; i < len; i += 2) {
          all[i].apply(all[i + 1] || this, args)
        }
      }
    }

    return this
  }


  // Mix `Events` to object instance or Class function.
  Events.mixTo = function(receiver) {
    receiver = receiver.prototype || receiver
    var proto = Events.prototype

    for (var p in proto) {
      if (proto.hasOwnProperty(p)) {
        receiver[p] = proto[p]
      }
    }
  }


  // Helpers
  // -------

  var keys = Object.keys

  if (!keys) {
    keys = function(o) {
      var result = []

      for (var name in o) {
        if (o.hasOwnProperty(name)) {
          result.push(name)
        }
      }
      return result
    }
  }


  return Events
})

define("kjui/accordion/0.0.1/accordion-debug", ["$-debug", "gallery/handlebars/1.0.0/handlebars-debug", "kjui/tree/0.0.1/tree-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug", "arale/switchable/0.9.11/switchable-debug", "arale/easing/1.0.0/easing-debug"], function(require, exports, module) {
  var $ = require('$-debug'),
    handlebars = require('gallery/handlebars/1.0.0/handlebars-debug'),
    Tree = require('kjui/tree/0.0.1/tree-debug'),
    Switchable = require('arale/switchable/0.9.11/switchable-debug');

  var tpl = '{{#each headers}} <div class="accordion-hd unselectable" data-role="trigger"> <i class="icon {{this.icon}}"></i> <span>{{this.name}}</span> <i data-role="flag" class="icon icon-tool icon-tool-expand-bottom"></i> </div> <div class="accordion-bd" data-role="panel"></div> {{/each}}';

  var Accordion = Switchable.extend({
    attrs: {
      triggerType: 'click',
      height: 0,
      activeTriggerClass: 'accordion-hd-is-active'
    },

    setup: function(){
      var that = this;
      var url = this.get('url');
      if (url){
        $.getJSON(url, function(data){
          var tpl = that._createAccordion(data);
          that.element.html(tpl);

          Accordion.superclass.setup.call(that);
          that.fitToHeight(that.get('height'));

          that._createSubPanel(data);
        });
      } else {
        Accordion.superclass.setup.call(this);
        this.fitToHeight(this.get('height'));
      }

    },

    _createAccordion: function(data){
      html = handlebars.compile(tpl)({
        headers: data
      });
      return html;
    },
    _createSubPanel: function(data){
      var that = this;
      function onClick(a,b,c){
        var args = Array.prototype.slice.call(arguments, 0);
        args.unshift('itemclick');
        that.trigger.apply(that, args);
      }

      for (var i = 0; i < data.length; i++) {
        var tree = new Tree({
          element: this.panels[i],
          data: data[i]
        });
        tree.on('click', onClick);
      }
    },

    _switchTrigger: function(toIndex, fromIndex) {
      Accordion.superclass._switchTrigger.apply(this, arguments);

      this.triggers.eq(fromIndex).find('[data-role=flag]')
        .toggleClass('icon-tool-collapse-top icon-tool-expand-bottom');
      this.triggers.eq(toIndex).find('[data-role=flag]')
        .toggleClass('icon-tool-collapse-top icon-tool-expand-bottom');
    },

    //高度扩展到height
    fitToHeight: function(height){
      //element
      if (height > 0){
        this.element.height(height);
      }

      //panels
      var panelHeight = height - this.triggers.outerHeight() * this.triggers.length;
      this.panels.height(panelHeight);
    }
  });

  module.exports = Accordion;


});

define('gallery/handlebars/1.0.0/handlebars-debug', [], function() {

// lib/handlebars/base.js

/*jshint eqnull:true*/
this.Handlebars = {};

(function(Handlebars) {

Handlebars.VERSION = "1.0.rc.1";

Handlebars.helpers  = {};
Handlebars.partials = {};

Handlebars.registerHelper = function(name, fn, inverse) {
  if(inverse) { fn.not = inverse; }
  this.helpers[name] = fn;
};

Handlebars.registerPartial = function(name, str) {
  this.partials[name] = str;
};

Handlebars.registerHelper('helperMissing', function(arg) {
  if(arguments.length === 2) {
    return undefined;
  } else {
    throw new Error("Could not find property '" + arg + "'");
  }
});

var toString = Object.prototype.toString, functionType = "[object Function]";

Handlebars.registerHelper('blockHelperMissing', function(context, options) {
  var inverse = options.inverse || function() {}, fn = options.fn;


  var ret = "";
  var type = toString.call(context);

  if(type === functionType) { context = context.call(this); }

  if(context === true) {
    return fn(this);
  } else if(context === false || context == null) {
    return inverse(this);
  } else if(type === "[object Array]") {
    if(context.length > 0) {
      return Handlebars.helpers.each(context, options);
    } else {
      return inverse(this);
    }
  } else {
    return fn(context);
  }
});

Handlebars.K = function() {};

Handlebars.createFrame = Object.create || function(object) {
  Handlebars.K.prototype = object;
  var obj = new Handlebars.K();
  Handlebars.K.prototype = null;
  return obj;
};

Handlebars.registerHelper('each', function(context, options) {
  var fn = options.fn, inverse = options.inverse;
  var ret = "", data;

  if (options.data) {
    data = Handlebars.createFrame(options.data);
  }

  if(context && context.length > 0) {
    for(var i=0, j=context.length; i<j; i++) {
      if (data) { data.index = i; }
      ret = ret + fn(context[i], { data: data });
    }
  } else {
    ret = inverse(this);
  }
  return ret;
});

Handlebars.registerHelper('if', function(context, options) {
  var type = toString.call(context);
  if(type === functionType) { context = context.call(this); }

  if(!context || Handlebars.Utils.isEmpty(context)) {
    return options.inverse(this);
  } else {
    return options.fn(this);
  }
});

Handlebars.registerHelper('unless', function(context, options) {
  var fn = options.fn, inverse = options.inverse;
  options.fn = inverse;
  options.inverse = fn;

  return Handlebars.helpers['if'].call(this, context, options);
});

Handlebars.registerHelper('with', function(context, options) {
  return options.fn(context);
});

Handlebars.registerHelper('log', function(context) {
  Handlebars.log(context);
});

}(this.Handlebars));
;
// lib/handlebars/compiler/parser.js
/* Jison generated parser */
var handlebars = (function(){
var parser = {trace: function trace() { },
yy: {},
symbols_: {"error":2,"root":3,"program":4,"EOF":5,"statements":6,"simpleInverse":7,"statement":8,"openInverse":9,"closeBlock":10,"openBlock":11,"mustache":12,"partial":13,"CONTENT":14,"COMMENT":15,"OPEN_BLOCK":16,"inMustache":17,"CLOSE":18,"OPEN_INVERSE":19,"OPEN_ENDBLOCK":20,"path":21,"OPEN":22,"OPEN_UNESCAPED":23,"OPEN_PARTIAL":24,"params":25,"hash":26,"DATA":27,"param":28,"STRING":29,"INTEGER":30,"BOOLEAN":31,"hashSegments":32,"hashSegment":33,"ID":34,"EQUALS":35,"pathSegments":36,"SEP":37,"$accept":0,"$end":1},
terminals_: {2:"error",5:"EOF",14:"CONTENT",15:"COMMENT",16:"OPEN_BLOCK",18:"CLOSE",19:"OPEN_INVERSE",20:"OPEN_ENDBLOCK",22:"OPEN",23:"OPEN_UNESCAPED",24:"OPEN_PARTIAL",27:"DATA",29:"STRING",30:"INTEGER",31:"BOOLEAN",34:"ID",35:"EQUALS",37:"SEP"},
productions_: [0,[3,2],[4,3],[4,1],[4,0],[6,1],[6,2],[8,3],[8,3],[8,1],[8,1],[8,1],[8,1],[11,3],[9,3],[10,3],[12,3],[12,3],[13,3],[13,4],[7,2],[17,3],[17,2],[17,2],[17,1],[17,1],[25,2],[25,1],[28,1],[28,1],[28,1],[28,1],[28,1],[26,1],[32,2],[32,1],[33,3],[33,3],[33,3],[33,3],[33,3],[21,1],[36,3],[36,1]],
performAction: function anonymous(yytext,yyleng,yylineno,yy,yystate,$$,_$) {

var $0 = $$.length - 1;
switch (yystate) {
case 1: return $$[$0-1]; 
break;
case 2: this.$ = new yy.ProgramNode($$[$0-2], $$[$0]); 
break;
case 3: this.$ = new yy.ProgramNode($$[$0]); 
break;
case 4: this.$ = new yy.ProgramNode([]); 
break;
case 5: this.$ = [$$[$0]]; 
break;
case 6: $$[$0-1].push($$[$0]); this.$ = $$[$0-1]; 
break;
case 7: this.$ = new yy.BlockNode($$[$0-2], $$[$0-1].inverse, $$[$0-1], $$[$0]); 
break;
case 8: this.$ = new yy.BlockNode($$[$0-2], $$[$0-1], $$[$0-1].inverse, $$[$0]); 
break;
case 9: this.$ = $$[$0]; 
break;
case 10: this.$ = $$[$0]; 
break;
case 11: this.$ = new yy.ContentNode($$[$0]); 
break;
case 12: this.$ = new yy.CommentNode($$[$0]); 
break;
case 13: this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1]); 
break;
case 14: this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1]); 
break;
case 15: this.$ = $$[$0-1]; 
break;
case 16: this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1]); 
break;
case 17: this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1], true); 
break;
case 18: this.$ = new yy.PartialNode($$[$0-1]); 
break;
case 19: this.$ = new yy.PartialNode($$[$0-2], $$[$0-1]); 
break;
case 20: 
break;
case 21: this.$ = [[$$[$0-2]].concat($$[$0-1]), $$[$0]]; 
break;
case 22: this.$ = [[$$[$0-1]].concat($$[$0]), null]; 
break;
case 23: this.$ = [[$$[$0-1]], $$[$0]]; 
break;
case 24: this.$ = [[$$[$0]], null]; 
break;
case 25: this.$ = [[new yy.DataNode($$[$0])], null]; 
break;
case 26: $$[$0-1].push($$[$0]); this.$ = $$[$0-1]; 
break;
case 27: this.$ = [$$[$0]]; 
break;
case 28: this.$ = $$[$0]; 
break;
case 29: this.$ = new yy.StringNode($$[$0]); 
break;
case 30: this.$ = new yy.IntegerNode($$[$0]); 
break;
case 31: this.$ = new yy.BooleanNode($$[$0]); 
break;
case 32: this.$ = new yy.DataNode($$[$0]); 
break;
case 33: this.$ = new yy.HashNode($$[$0]); 
break;
case 34: $$[$0-1].push($$[$0]); this.$ = $$[$0-1]; 
break;
case 35: this.$ = [$$[$0]]; 
break;
case 36: this.$ = [$$[$0-2], $$[$0]]; 
break;
case 37: this.$ = [$$[$0-2], new yy.StringNode($$[$0])]; 
break;
case 38: this.$ = [$$[$0-2], new yy.IntegerNode($$[$0])]; 
break;
case 39: this.$ = [$$[$0-2], new yy.BooleanNode($$[$0])]; 
break;
case 40: this.$ = [$$[$0-2], new yy.DataNode($$[$0])]; 
break;
case 41: this.$ = new yy.IdNode($$[$0]); 
break;
case 42: $$[$0-2].push($$[$0]); this.$ = $$[$0-2]; 
break;
case 43: this.$ = [$$[$0]]; 
break;
}
},
table: [{3:1,4:2,5:[2,4],6:3,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],22:[1,13],23:[1,14],24:[1,15]},{1:[3]},{5:[1,16]},{5:[2,3],7:17,8:18,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,19],20:[2,3],22:[1,13],23:[1,14],24:[1,15]},{5:[2,5],14:[2,5],15:[2,5],16:[2,5],19:[2,5],20:[2,5],22:[2,5],23:[2,5],24:[2,5]},{4:20,6:3,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],20:[2,4],22:[1,13],23:[1,14],24:[1,15]},{4:21,6:3,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],20:[2,4],22:[1,13],23:[1,14],24:[1,15]},{5:[2,9],14:[2,9],15:[2,9],16:[2,9],19:[2,9],20:[2,9],22:[2,9],23:[2,9],24:[2,9]},{5:[2,10],14:[2,10],15:[2,10],16:[2,10],19:[2,10],20:[2,10],22:[2,10],23:[2,10],24:[2,10]},{5:[2,11],14:[2,11],15:[2,11],16:[2,11],19:[2,11],20:[2,11],22:[2,11],23:[2,11],24:[2,11]},{5:[2,12],14:[2,12],15:[2,12],16:[2,12],19:[2,12],20:[2,12],22:[2,12],23:[2,12],24:[2,12]},{17:22,21:23,27:[1,24],34:[1,26],36:25},{17:27,21:23,27:[1,24],34:[1,26],36:25},{17:28,21:23,27:[1,24],34:[1,26],36:25},{17:29,21:23,27:[1,24],34:[1,26],36:25},{21:30,34:[1,26],36:25},{1:[2,1]},{6:31,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],22:[1,13],23:[1,14],24:[1,15]},{5:[2,6],14:[2,6],15:[2,6],16:[2,6],19:[2,6],20:[2,6],22:[2,6],23:[2,6],24:[2,6]},{17:22,18:[1,32],21:23,27:[1,24],34:[1,26],36:25},{10:33,20:[1,34]},{10:35,20:[1,34]},{18:[1,36]},{18:[2,24],21:41,25:37,26:38,27:[1,45],28:39,29:[1,42],30:[1,43],31:[1,44],32:40,33:46,34:[1,47],36:25},{18:[2,25]},{18:[2,41],27:[2,41],29:[2,41],30:[2,41],31:[2,41],34:[2,41],37:[1,48]},{18:[2,43],27:[2,43],29:[2,43],30:[2,43],31:[2,43],34:[2,43],37:[2,43]},{18:[1,49]},{18:[1,50]},{18:[1,51]},{18:[1,52],21:53,34:[1,26],36:25},{5:[2,2],8:18,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],20:[2,2],22:[1,13],23:[1,14],24:[1,15]},{14:[2,20],15:[2,20],16:[2,20],19:[2,20],22:[2,20],23:[2,20],24:[2,20]},{5:[2,7],14:[2,7],15:[2,7],16:[2,7],19:[2,7],20:[2,7],22:[2,7],23:[2,7],24:[2,7]},{21:54,34:[1,26],36:25},{5:[2,8],14:[2,8],15:[2,8],16:[2,8],19:[2,8],20:[2,8],22:[2,8],23:[2,8],24:[2,8]},{14:[2,14],15:[2,14],16:[2,14],19:[2,14],20:[2,14],22:[2,14],23:[2,14],24:[2,14]},{18:[2,22],21:41,26:55,27:[1,45],28:56,29:[1,42],30:[1,43],31:[1,44],32:40,33:46,34:[1,47],36:25},{18:[2,23]},{18:[2,27],27:[2,27],29:[2,27],30:[2,27],31:[2,27],34:[2,27]},{18:[2,33],33:57,34:[1,58]},{18:[2,28],27:[2,28],29:[2,28],30:[2,28],31:[2,28],34:[2,28]},{18:[2,29],27:[2,29],29:[2,29],30:[2,29],31:[2,29],34:[2,29]},{18:[2,30],27:[2,30],29:[2,30],30:[2,30],31:[2,30],34:[2,30]},{18:[2,31],27:[2,31],29:[2,31],30:[2,31],31:[2,31],34:[2,31]},{18:[2,32],27:[2,32],29:[2,32],30:[2,32],31:[2,32],34:[2,32]},{18:[2,35],34:[2,35]},{18:[2,43],27:[2,43],29:[2,43],30:[2,43],31:[2,43],34:[2,43],35:[1,59],37:[2,43]},{34:[1,60]},{14:[2,13],15:[2,13],16:[2,13],19:[2,13],20:[2,13],22:[2,13],23:[2,13],24:[2,13]},{5:[2,16],14:[2,16],15:[2,16],16:[2,16],19:[2,16],20:[2,16],22:[2,16],23:[2,16],24:[2,16]},{5:[2,17],14:[2,17],15:[2,17],16:[2,17],19:[2,17],20:[2,17],22:[2,17],23:[2,17],24:[2,17]},{5:[2,18],14:[2,18],15:[2,18],16:[2,18],19:[2,18],20:[2,18],22:[2,18],23:[2,18],24:[2,18]},{18:[1,61]},{18:[1,62]},{18:[2,21]},{18:[2,26],27:[2,26],29:[2,26],30:[2,26],31:[2,26],34:[2,26]},{18:[2,34],34:[2,34]},{35:[1,59]},{21:63,27:[1,67],29:[1,64],30:[1,65],31:[1,66],34:[1,26],36:25},{18:[2,42],27:[2,42],29:[2,42],30:[2,42],31:[2,42],34:[2,42],37:[2,42]},{5:[2,19],14:[2,19],15:[2,19],16:[2,19],19:[2,19],20:[2,19],22:[2,19],23:[2,19],24:[2,19]},{5:[2,15],14:[2,15],15:[2,15],16:[2,15],19:[2,15],20:[2,15],22:[2,15],23:[2,15],24:[2,15]},{18:[2,36],34:[2,36]},{18:[2,37],34:[2,37]},{18:[2,38],34:[2,38]},{18:[2,39],34:[2,39]},{18:[2,40],34:[2,40]}],
defaultActions: {16:[2,1],24:[2,25],38:[2,23],55:[2,21]},
parseError: function parseError(str, hash) {
    throw new Error(str);
},
parse: function parse(input) {
    var self = this, stack = [0], vstack = [null], lstack = [], table = this.table, yytext = "", yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
    this.lexer.setInput(input);
    this.lexer.yy = this.yy;
    this.yy.lexer = this.lexer;
    this.yy.parser = this;
    if (typeof this.lexer.yylloc == "undefined")
        this.lexer.yylloc = {};
    var yyloc = this.lexer.yylloc;
    lstack.push(yyloc);
    var ranges = this.lexer.options && this.lexer.options.ranges;
    if (typeof this.yy.parseError === "function")
        this.parseError = this.yy.parseError;
    function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }
    function lex() {
        var token;
        token = self.lexer.lex() || 1;
        if (typeof token !== "number") {
            token = self.symbols_[token] || token;
        }
        return token;
    }
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == "undefined") {
                symbol = lex();
            }
            action = table[state] && table[state][symbol];
        }
        if (typeof action === "undefined" || !action.length || !action[0]) {
            var errStr = "";
            if (!recovering) {
                expected = [];
                for (p in table[state])
                    if (this.terminals_[p] && p > 2) {
                        expected.push("'" + this.terminals_[p] + "'");
                    }
                if (this.lexer.showPosition) {
                    errStr = "Parse error on line " + (yylineno + 1) + ":\n" + this.lexer.showPosition() + "\nExpecting " + expected.join(", ") + ", got '" + (this.terminals_[symbol] || symbol) + "'";
                } else {
                    errStr = "Parse error on line " + (yylineno + 1) + ": Unexpected " + (symbol == 1?"end of input":"'" + (this.terminals_[symbol] || symbol) + "'");
                }
                this.parseError(errStr, {text: this.lexer.match, token: this.terminals_[symbol] || symbol, line: this.lexer.yylineno, loc: yyloc, expected: expected});
            }
        }
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error("Parse Error: multiple actions possible at state: " + state + ", token: " + symbol);
        }
        switch (action[0]) {
        case 1:
            stack.push(symbol);
            vstack.push(this.lexer.yytext);
            lstack.push(this.lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
                yyleng = this.lexer.yyleng;
                yytext = this.lexer.yytext;
                yylineno = this.lexer.yylineno;
                yyloc = this.lexer.yylloc;
                if (recovering > 0)
                    recovering--;
            } else {
                symbol = preErrorSymbol;
                preErrorSymbol = null;
            }
            break;
        case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {first_line: lstack[lstack.length - (len || 1)].first_line, last_line: lstack[lstack.length - 1].last_line, first_column: lstack[lstack.length - (len || 1)].first_column, last_column: lstack[lstack.length - 1].last_column};
            if (ranges) {
                yyval._$.range = [lstack[lstack.length - (len || 1)].range[0], lstack[lstack.length - 1].range[1]];
            }
            r = this.performAction.call(yyval, yytext, yyleng, yylineno, this.yy, action[1], vstack, lstack);
            if (typeof r !== "undefined") {
                return r;
            }
            if (len) {
                stack = stack.slice(0, -1 * len * 2);
                vstack = vstack.slice(0, -1 * len);
                lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
        case 3:
            return true;
        }
    }
    return true;
}
};
/* Jison generated lexer */
var lexer = (function(){
var lexer = ({EOF:1,
parseError:function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },
setInput:function (input) {
        this._input = input;
        this._more = this._less = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {first_line:1,first_column:0,last_line:1,last_column:0};
        if (this.options.ranges) this.yylloc.range = [0,0];
        this.offset = 0;
        return this;
    },
input:function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) this.yylloc.range[1]++;

        this._input = this._input.slice(1);
        return ch;
    },
unput:function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length-len-1);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length-1);
        this.matched = this.matched.substr(0, this.matched.length-1);

        if (lines.length-1) this.yylineno -= lines.length-1;
        var r = this.yylloc.range;

        this.yylloc = {first_line: this.yylloc.first_line,
          last_line: this.yylineno+1,
          first_column: this.yylloc.first_column,
          last_column: lines ?
              (lines.length === oldLines.length ? this.yylloc.first_column : 0) + oldLines[oldLines.length - lines.length].length - lines[0].length:
              this.yylloc.first_column - len
          };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        return this;
    },
more:function () {
        this._more = true;
        return this;
    },
less:function (n) {
        this.unput(this.match.slice(n));
    },
pastInput:function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },
upcomingInput:function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20)+(next.length > 20 ? '...':'')).replace(/\n/g, "");
    },
showPosition:function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c+"^";
    },
next:function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) this.done = true;

        var token,
            match,
            tempMatch,
            index,
            col,
            lines;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i=0;i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (!this.options.flex) break;
            }
        }
        if (match) {
            lines = match[0].match(/(?:\r\n?|\n).*/g);
            if (lines) this.yylineno += lines.length;
            this.yylloc = {first_line: this.yylloc.last_line,
                           last_line: this.yylineno+1,
                           first_column: this.yylloc.last_column,
                           last_column: lines ? lines[lines.length-1].length-lines[lines.length-1].match(/\r?\n?/)[0].length : this.yylloc.last_column + match[0].length};
            this.yytext += match[0];
            this.match += match[0];
            this.matches = match;
            this.yyleng = this.yytext.length;
            if (this.options.ranges) {
                this.yylloc.range = [this.offset, this.offset += this.yyleng];
            }
            this._more = false;
            this._input = this._input.slice(match[0].length);
            this.matched += match[0];
            token = this.performAction.call(this, this.yy, this, rules[index],this.conditionStack[this.conditionStack.length-1]);
            if (this.done && this._input) this.done = false;
            if (token) return token;
            else return;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line '+(this.yylineno+1)+'. Unrecognized text.\n'+this.showPosition(),
                    {text: "", token: null, line: this.yylineno});
        }
    },
lex:function lex() {
        var r = this.next();
        if (typeof r !== 'undefined') {
            return r;
        } else {
            return this.lex();
        }
    },
begin:function begin(condition) {
        this.conditionStack.push(condition);
    },
popState:function popState() {
        return this.conditionStack.pop();
    },
_currentRules:function _currentRules() {
        return this.conditions[this.conditionStack[this.conditionStack.length-1]].rules;
    },
topState:function () {
        return this.conditionStack[this.conditionStack.length-2];
    },
pushState:function begin(condition) {
        this.begin(condition);
    }});
lexer.options = {};
lexer.performAction = function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {

var YYSTATE=YY_START
switch($avoiding_name_collisions) {
case 0:
                                   if(yy_.yytext.slice(-1) !== "\\") this.begin("mu");
                                   if(yy_.yytext.slice(-1) === "\\") yy_.yytext = yy_.yytext.substr(0,yy_.yyleng-1), this.begin("emu");
                                   if(yy_.yytext) return 14;
                                 
break;
case 1: return 14; 
break;
case 2:
                                   if(yy_.yytext.slice(-1) !== "\\") this.popState();
                                   if(yy_.yytext.slice(-1) === "\\") yy_.yytext = yy_.yytext.substr(0,yy_.yyleng-1);
                                   return 14;
                                 
break;
case 3: return 24; 
break;
case 4: return 16; 
break;
case 5: return 20; 
break;
case 6: return 19; 
break;
case 7: return 19; 
break;
case 8: return 23; 
break;
case 9: return 23; 
break;
case 10: yy_.yytext = yy_.yytext.substr(3,yy_.yyleng-5); this.popState(); return 15; 
break;
case 11: return 22; 
break;
case 12: return 35; 
break;
case 13: return 34; 
break;
case 14: return 34; 
break;
case 15: return 37; 
break;
case 16: /*ignore whitespace*/ 
break;
case 17: this.popState(); return 18; 
break;
case 18: this.popState(); return 18; 
break;
case 19: yy_.yytext = yy_.yytext.substr(1,yy_.yyleng-2).replace(/\\"/g,'"'); return 29; 
break;
case 20: yy_.yytext = yy_.yytext.substr(1,yy_.yyleng-2).replace(/\\"/g,'"'); return 29; 
break;
case 21: yy_.yytext = yy_.yytext.substr(1); return 27; 
break;
case 22: return 31; 
break;
case 23: return 31; 
break;
case 24: return 30; 
break;
case 25: return 34; 
break;
case 26: yy_.yytext = yy_.yytext.substr(1, yy_.yyleng-2); return 34; 
break;
case 27: return 'INVALID'; 
break;
case 28: return 5; 
break;
}
};
lexer.rules = [/^(?:[^\x00]*?(?=(\{\{)))/,/^(?:[^\x00]+)/,/^(?:[^\x00]{2,}?(?=(\{\{|$)))/,/^(?:\{\{>)/,/^(?:\{\{#)/,/^(?:\{\{\/)/,/^(?:\{\{\^)/,/^(?:\{\{\s*else\b)/,/^(?:\{\{\{)/,/^(?:\{\{&)/,/^(?:\{\{![\s\S]*?\}\})/,/^(?:\{\{)/,/^(?:=)/,/^(?:\.(?=[} ]))/,/^(?:\.\.)/,/^(?:[\/.])/,/^(?:\s+)/,/^(?:\}\}\})/,/^(?:\}\})/,/^(?:"(\\["]|[^"])*")/,/^(?:'(\\[']|[^'])*')/,/^(?:@[a-zA-Z]+)/,/^(?:true(?=[}\s]))/,/^(?:false(?=[}\s]))/,/^(?:[0-9]+(?=[}\s]))/,/^(?:[a-zA-Z0-9_$-]+(?=[=}\s\/.]))/,/^(?:\[[^\]]*\])/,/^(?:.)/,/^(?:$)/];
lexer.conditions = {"mu":{"rules":[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28],"inclusive":false},"emu":{"rules":[2],"inclusive":false},"INITIAL":{"rules":[0,1,28],"inclusive":true}};
return lexer;})()
parser.lexer = lexer;
function Parser () { this.yy = {}; }Parser.prototype = parser;parser.Parser = Parser;
return new Parser;
})();
if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
exports.parser = handlebars;
exports.Parser = handlebars.Parser;
exports.parse = function () { return handlebars.parse.apply(handlebars, arguments); }
exports.main = function commonjsMain(args) {
    if (!args[1])
        throw new Error('Usage: '+args[0]+' FILE');
    var source, cwd;
    if (typeof process !== 'undefined') {
        source = require('fs').readFileSync(require('path').resolve(args[1]), "utf8");
    } else {
        source = require("file").path(require("file").cwd()).join(args[1]).read({charset: "utf-8"});
    }
    return exports.parser.parse(source);
}
if (typeof module !== 'undefined' && require.main === module) {
  exports.main(typeof process !== 'undefined' ? process.argv.slice(1) : require("system").args);
}
};
;
// lib/handlebars/compiler/base.js
Handlebars.Parser = handlebars;

Handlebars.parse = function(string) {
  Handlebars.Parser.yy = Handlebars.AST;
  return Handlebars.Parser.parse(string);
};

Handlebars.print = function(ast) {
  return new Handlebars.PrintVisitor().accept(ast);
};

Handlebars.logger = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, level: 3,

  // override in the host environment
  log: function(level, str) {}
};

Handlebars.log = function(level, str) { Handlebars.logger.log(level, str); };
;
// lib/handlebars/compiler/ast.js
(function() {

  Handlebars.AST = {};

  Handlebars.AST.ProgramNode = function(statements, inverse) {
    this.type = "program";
    this.statements = statements;
    if(inverse) { this.inverse = new Handlebars.AST.ProgramNode(inverse); }
  };

  Handlebars.AST.MustacheNode = function(rawParams, hash, unescaped) {
    this.type = "mustache";
    this.escaped = !unescaped;
    this.hash = hash;

    var id = this.id = rawParams[0];
    var params = this.params = rawParams.slice(1);

    // a mustache is an eligible helper if:
    // * its id is simple (a single part, not `this` or `..`)
    var eligibleHelper = this.eligibleHelper = id.isSimple;

    // a mustache is definitely a helper if:
    // * it is an eligible helper, and
    // * it has at least one parameter or hash segment
    this.isHelper = eligibleHelper && (params.length || hash);

    // if a mustache is an eligible helper but not a definite
    // helper, it is ambiguous, and will be resolved in a later
    // pass or at runtime.
  };

  Handlebars.AST.PartialNode = function(id, context) {
    this.type    = "partial";

    // TODO: disallow complex IDs

    this.id      = id;
    this.context = context;
  };

  var verifyMatch = function(open, close) {
    if(open.original !== close.original) {
      throw new Handlebars.Exception(open.original + " doesn't match " + close.original);
    }
  };

  Handlebars.AST.BlockNode = function(mustache, program, inverse, close) {
    verifyMatch(mustache.id, close);
    this.type = "block";
    this.mustache = mustache;
    this.program  = program;
    this.inverse  = inverse;

    if (this.inverse && !this.program) {
      this.isInverse = true;
    }
  };

  Handlebars.AST.ContentNode = function(string) {
    this.type = "content";
    this.string = string;
  };

  Handlebars.AST.HashNode = function(pairs) {
    this.type = "hash";
    this.pairs = pairs;
  };

  Handlebars.AST.IdNode = function(parts) {
    this.type = "ID";
    this.original = parts.join(".");

    var dig = [], depth = 0;

    for(var i=0,l=parts.length; i<l; i++) {
      var part = parts[i];

      if(part === "..") { depth++; }
      else if(part === "." || part === "this") { this.isScoped = true; }
      else { dig.push(part); }
    }

    this.parts    = dig;
    this.string   = dig.join('.');
    this.depth    = depth;

    // an ID is simple if it only has one part, and that part is not
    // `..` or `this`.
    this.isSimple = parts.length === 1 && !this.isScoped && depth === 0;
  };

  Handlebars.AST.DataNode = function(id) {
    this.type = "DATA";
    this.id = id;
  };

  Handlebars.AST.StringNode = function(string) {
    this.type = "STRING";
    this.string = string;
  };

  Handlebars.AST.IntegerNode = function(integer) {
    this.type = "INTEGER";
    this.integer = integer;
  };

  Handlebars.AST.BooleanNode = function(bool) {
    this.type = "BOOLEAN";
    this.bool = bool;
  };

  Handlebars.AST.CommentNode = function(comment) {
    this.type = "comment";
    this.comment = comment;
  };

})();;
// lib/handlebars/utils.js
Handlebars.Exception = function(message) {
  var tmp = Error.prototype.constructor.apply(this, arguments);

  for (var p in tmp) {
    if (tmp.hasOwnProperty(p)) { this[p] = tmp[p]; }
  }

  this.message = tmp.message;
};
Handlebars.Exception.prototype = new Error();

// Build out our basic SafeString type
Handlebars.SafeString = function(string) {
  this.string = string;
};
Handlebars.SafeString.prototype.toString = function() {
  return this.string.toString();
};

(function() {
  var escape = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
    "`": "&#x60;"
  };

  var badChars = /[&<>"'`]/g;
  var possible = /[&<>"'`]/;

  var escapeChar = function(chr) {
    return escape[chr] || "&amp;";
  };

  Handlebars.Utils = {
    escapeExpression: function(string) {
      // don't escape SafeStrings, since they're already safe
      if (string instanceof Handlebars.SafeString) {
        return string.toString();
      } else if (string == null || string === false) {
        return "";
      }

      if(!possible.test(string)) { return string; }
      return string.replace(badChars, escapeChar);
    },

    isEmpty: function(value) {
      if (typeof value === "undefined") {
        return true;
      } else if (value === null) {
        return true;
      } else if (value === false) {
        return true;
      } else if(Object.prototype.toString.call(value) === "[object Array]" && value.length === 0) {
        return true;
      } else {
        return false;
      }
    }
  };
})();;
// lib/handlebars/compiler/compiler.js

/*jshint eqnull:true*/
Handlebars.Compiler = function() {};
Handlebars.JavaScriptCompiler = function() {};

(function(Compiler, JavaScriptCompiler) {
  // the foundHelper register will disambiguate helper lookup from finding a
  // function in a context. This is necessary for mustache compatibility, which
  // requires that context functions in blocks are evaluated by blockHelperMissing,
  // and then proceed as if the resulting value was provided to blockHelperMissing.

  Compiler.prototype = {
    compiler: Compiler,

    disassemble: function() {
      var opcodes = this.opcodes, opcode, out = [], params, param;

      for (var i=0, l=opcodes.length; i<l; i++) {
        opcode = opcodes[i];

        if (opcode.opcode === 'DECLARE') {
          out.push("DECLARE " + opcode.name + "=" + opcode.value);
        } else {
          params = [];
          for (var j=0; j<opcode.args.length; j++) {
            param = opcode.args[j];
            if (typeof param === "string") {
              param = "\"" + param.replace("\n", "\\n") + "\"";
            }
            params.push(param);
          }
          out.push(opcode.opcode + " " + params.join(" "));
        }
      }

      return out.join("\n");
    },

    guid: 0,

    compile: function(program, options) {
      this.children = [];
      this.depths = {list: []};
      this.options = options;

      // These changes will propagate to the other compiler components
      var knownHelpers = this.options.knownHelpers;
      this.options.knownHelpers = {
        'helperMissing': true,
        'blockHelperMissing': true,
        'each': true,
        'if': true,
        'unless': true,
        'with': true,
        'log': true
      };
      if (knownHelpers) {
        for (var name in knownHelpers) {
          this.options.knownHelpers[name] = knownHelpers[name];
        }
      }

      return this.program(program);
    },

    accept: function(node) {
      return this[node.type](node);
    },

    program: function(program) {
      var statements = program.statements, statement;
      this.opcodes = [];

      for(var i=0, l=statements.length; i<l; i++) {
        statement = statements[i];
        this[statement.type](statement);
      }
      this.isSimple = l === 1;

      this.depths.list = this.depths.list.sort(function(a, b) {
        return a - b;
      });

      return this;
    },

    compileProgram: function(program) {
      var result = new this.compiler().compile(program, this.options);
      var guid = this.guid++, depth;

      this.usePartial = this.usePartial || result.usePartial;

      this.children[guid] = result;

      for(var i=0, l=result.depths.list.length; i<l; i++) {
        depth = result.depths.list[i];

        if(depth < 2) { continue; }
        else { this.addDepth(depth - 1); }
      }

      return guid;
    },

    block: function(block) {
      var mustache = block.mustache,
          program = block.program,
          inverse = block.inverse;

      if (program) {
        program = this.compileProgram(program);
      }

      if (inverse) {
        inverse = this.compileProgram(inverse);
      }

      var type = this.classifyMustache(mustache);

      if (type === "helper") {
        this.helperMustache(mustache, program, inverse);
      } else if (type === "simple") {
        this.simpleMustache(mustache);

        // now that the simple mustache is resolved, we need to
        // evaluate it by executing `blockHelperMissing`
        this.opcode('pushProgram', program);
        this.opcode('pushProgram', inverse);
        this.opcode('pushLiteral', '{}');
        this.opcode('blockValue');
      } else {
        this.ambiguousMustache(mustache, program, inverse);

        // now that the simple mustache is resolved, we need to
        // evaluate it by executing `blockHelperMissing`
        this.opcode('pushProgram', program);
        this.opcode('pushProgram', inverse);
        this.opcode('pushLiteral', '{}');
        this.opcode('ambiguousBlockValue');
      }

      this.opcode('append');
    },

    hash: function(hash) {
      var pairs = hash.pairs, pair, val;

      this.opcode('push', '{}');

      for(var i=0, l=pairs.length; i<l; i++) {
        pair = pairs[i];
        val  = pair[1];

        this.accept(val);
        this.opcode('assignToHash', pair[0]);
      }
    },

    partial: function(partial) {
      var id = partial.id;
      this.usePartial = true;

      if(partial.context) {
        this.ID(partial.context);
      } else {
        this.opcode('push', 'depth0');
      }

      this.opcode('invokePartial', id.original);
      this.opcode('append');
    },

    content: function(content) {
      this.opcode('appendContent', content.string);
    },

    mustache: function(mustache) {
      var options = this.options;
      var type = this.classifyMustache(mustache);

      if (type === "simple") {
        this.simpleMustache(mustache);
      } else if (type === "helper") {
        this.helperMustache(mustache);
      } else {
        this.ambiguousMustache(mustache);
      }

      if(mustache.escaped && !options.noEscape) {
        this.opcode('appendEscaped');
      } else {
        this.opcode('append');
      }
    },

    ambiguousMustache: function(mustache, program, inverse) {
      var id = mustache.id, name = id.parts[0];

      this.opcode('getContext', id.depth);

      this.opcode('pushProgram', program);
      this.opcode('pushProgram', inverse);

      this.opcode('invokeAmbiguous', name);
    },

    simpleMustache: function(mustache, program, inverse) {
      var id = mustache.id;

      if (id.type === 'DATA') {
        this.DATA(id);
      } else if (id.parts.length) {
        this.ID(id);
      } else {
        // Simplified ID for `this`
        this.addDepth(id.depth);
        this.opcode('getContext', id.depth);
        this.opcode('pushContext');
      }

      this.opcode('resolvePossibleLambda');
    },

    helperMustache: function(mustache, program, inverse) {
      var params = this.setupFullMustacheParams(mustache, program, inverse),
          name = mustache.id.parts[0];

      if (this.options.knownHelpers[name]) {
        this.opcode('invokeKnownHelper', params.length, name);
      } else if (this.knownHelpersOnly) {
        throw new Error("You specified knownHelpersOnly, but used the unknown helper " + name);
      } else {
        this.opcode('invokeHelper', params.length, name);
      }
    },

    ID: function(id) {
      this.addDepth(id.depth);
      this.opcode('getContext', id.depth);

      var name = id.parts[0];
      if (!name) {
        this.opcode('pushContext');
      } else {
        this.opcode('lookupOnContext', id.parts[0]);
      }

      for(var i=1, l=id.parts.length; i<l; i++) {
        this.opcode('lookup', id.parts[i]);
      }
    },

    DATA: function(data) {
      this.options.data = true;
      this.opcode('lookupData', data.id);
    },

    STRING: function(string) {
      this.opcode('pushString', string.string);
    },

    INTEGER: function(integer) {
      this.opcode('pushLiteral', integer.integer);
    },

    BOOLEAN: function(bool) {
      this.opcode('pushLiteral', bool.bool);
    },

    comment: function() {},

    // HELPERS
    opcode: function(name) {
      this.opcodes.push({ opcode: name, args: [].slice.call(arguments, 1) });
    },

    declare: function(name, value) {
      this.opcodes.push({ opcode: 'DECLARE', name: name, value: value });
    },

    addDepth: function(depth) {
      if(isNaN(depth)) { throw new Error("EWOT"); }
      if(depth === 0) { return; }

      if(!this.depths[depth]) {
        this.depths[depth] = true;
        this.depths.list.push(depth);
      }
    },

    classifyMustache: function(mustache) {
      var isHelper   = mustache.isHelper;
      var isEligible = mustache.eligibleHelper;
      var options    = this.options;

      // if ambiguous, we can possibly resolve the ambiguity now
      if (isEligible && !isHelper) {
        var name = mustache.id.parts[0];

        if (options.knownHelpers[name]) {
          isHelper = true;
        } else if (options.knownHelpersOnly) {
          isEligible = false;
        }
      }

      if (isHelper) { return "helper"; }
      else if (isEligible) { return "ambiguous"; }
      else { return "simple"; }
    },

    pushParams: function(params) {
      var i = params.length, param;

      while(i--) {
        param = params[i];

        if(this.options.stringParams) {
          if(param.depth) {
            this.addDepth(param.depth);
          }

          this.opcode('getContext', param.depth || 0);
          this.opcode('pushStringParam', param.string);
        } else {
          this[param.type](param);
        }
      }
    },

    setupMustacheParams: function(mustache) {
      var params = mustache.params;
      this.pushParams(params);

      if(mustache.hash) {
        this.hash(mustache.hash);
      } else {
        this.opcode('pushLiteral', '{}');
      }

      return params;
    },

    // this will replace setupMustacheParams when we're done
    setupFullMustacheParams: function(mustache, program, inverse) {
      var params = mustache.params;
      this.pushParams(params);

      this.opcode('pushProgram', program);
      this.opcode('pushProgram', inverse);

      if(mustache.hash) {
        this.hash(mustache.hash);
      } else {
        this.opcode('pushLiteral', '{}');
      }

      return params;
    }
  };

  var Literal = function(value) {
    this.value = value;
  };

  JavaScriptCompiler.prototype = {
    // PUBLIC API: You can override these methods in a subclass to provide
    // alternative compiled forms for name lookup and buffering semantics
    nameLookup: function(parent, name, type) {
      if (/^[0-9]+$/.test(name)) {
        return parent + "[" + name + "]";
      } else if (JavaScriptCompiler.isValidJavaScriptVariableName(name)) {
        return parent + "." + name;
      }
      else {
        return parent + "['" + name + "']";
      }
    },

    appendToBuffer: function(string) {
      if (this.environment.isSimple) {
        return "return " + string + ";";
      } else {
        return "buffer += " + string + ";";
      }
    },

    initializeBuffer: function() {
      return this.quotedString("");
    },

    namespace: "Handlebars",
    // END PUBLIC API

    compile: function(environment, options, context, asObject) {
      this.environment = environment;
      this.options = options || {};

      Handlebars.log(Handlebars.logger.DEBUG, this.environment.disassemble() + "\n\n");

      this.name = this.environment.name;
      this.isChild = !!context;
      this.context = context || {
        programs: [],
        aliases: { }
      };

      this.preamble();

      this.stackSlot = 0;
      this.stackVars = [];
      this.registers = { list: [] };
      this.compileStack = [];

      this.compileChildren(environment, options);

      var opcodes = environment.opcodes, opcode;

      this.i = 0;

      for(l=opcodes.length; this.i<l; this.i++) {
        opcode = opcodes[this.i];

        if(opcode.opcode === 'DECLARE') {
          this[opcode.name] = opcode.value;
        } else {
          this[opcode.opcode].apply(this, opcode.args);
        }
      }

      return this.createFunctionContext(asObject);
    },

    nextOpcode: function() {
      var opcodes = this.environment.opcodes, opcode = opcodes[this.i + 1];
      return opcodes[this.i + 1];
    },

    eat: function(opcode) {
      this.i = this.i + 1;
    },

    preamble: function() {
      var out = [];

      if (!this.isChild) {
        var namespace = this.namespace;
        var copies = "helpers = helpers || " + namespace + ".helpers;";
        if (this.environment.usePartial) { copies = copies + " partials = partials || " + namespace + ".partials;"; }
        if (this.options.data) { copies = copies + " data = data || {};"; }
        out.push(copies);
      } else {
        out.push('');
      }

      if (!this.environment.isSimple) {
        out.push(", buffer = " + this.initializeBuffer());
      } else {
        out.push("");
      }

      // track the last context pushed into place to allow skipping the
      // getContext opcode when it would be a noop
      this.lastContext = 0;
      this.source = out;
    },

    createFunctionContext: function(asObject) {
      var locals = this.stackVars.concat(this.registers.list);

      if(locals.length > 0) {
        this.source[1] = this.source[1] + ", " + locals.join(", ");
      }

      // Generate minimizer alias mappings
      if (!this.isChild) {
        var aliases = [];
        for (var alias in this.context.aliases) {
          this.source[1] = this.source[1] + ', ' + alias + '=' + this.context.aliases[alias];
        }
      }

      if (this.source[1]) {
        this.source[1] = "var " + this.source[1].substring(2) + ";";
      }

      // Merge children
      if (!this.isChild) {
        this.source[1] += '\n' + this.context.programs.join('\n') + '\n';
      }

      if (!this.environment.isSimple) {
        this.source.push("return buffer;");
      }

      var params = this.isChild ? ["depth0", "data"] : ["Handlebars", "depth0", "helpers", "partials", "data"];

      for(var i=0, l=this.environment.depths.list.length; i<l; i++) {
        params.push("depth" + this.environment.depths.list[i]);
      }

      if (asObject) {
        params.push(this.source.join("\n  "));

        return Function.apply(this, params);
      } else {
        var functionSource = 'function ' + (this.name || '') + '(' + params.join(',') + ') {\n  ' + this.source.join("\n  ") + '}';
        Handlebars.log(Handlebars.logger.DEBUG, functionSource + "\n\n");
        return functionSource;
      }
    },

    // [blockValue]
    //
    // On stack, before: hash, inverse, program, value
    // On stack, after: return value of blockHelperMissing
    //
    // The purpose of this opcode is to take a block of the form
    // `{{#foo}}...{{/foo}}`, resolve the value of `foo`, and
    // replace it on the stack with the result of properly
    // invoking blockHelperMissing.
    blockValue: function() {
      this.context.aliases.blockHelperMissing = 'helpers.blockHelperMissing';

      var params = ["depth0"];
      this.setupParams(0, params);

      this.replaceStack(function(current) {
        params.splice(1, 0, current);
        return current + " = blockHelperMissing.call(" + params.join(", ") + ")";
      });
    },

    // [ambiguousBlockValue]
    //
    // On stack, before: hash, inverse, program, value
    // Compiler value, before: lastHelper=value of last found helper, if any
    // On stack, after, if no lastHelper: same as [blockValue]
    // On stack, after, if lastHelper: value
    ambiguousBlockValue: function() {
      this.context.aliases.blockHelperMissing = 'helpers.blockHelperMissing';

      var params = ["depth0"];
      this.setupParams(0, params);

      var current = this.topStack();
      params.splice(1, 0, current);

      this.source.push("if (!" + this.lastHelper + ") { " + current + " = blockHelperMissing.call(" + params.join(", ") + "); }");
    },

    // [appendContent]
    //
    // On stack, before: ...
    // On stack, after: ...
    //
    // Appends the string value of `content` to the current buffer
    appendContent: function(content) {
      this.source.push(this.appendToBuffer(this.quotedString(content)));
    },

    // [append]
    //
    // On stack, before: value, ...
    // On stack, after: ...
    //
    // Coerces `value` to a String and appends it to the current buffer.
    //
    // If `value` is truthy, or 0, it is coerced into a string and appended
    // Otherwise, the empty string is appended
    append: function() {
      var local = this.popStack();
      this.source.push("if(" + local + " || " + local + " === 0) { " + this.appendToBuffer(local) + " }");
      if (this.environment.isSimple) {
        this.source.push("else { " + this.appendToBuffer("''") + " }");
      }
    },

    // [appendEscaped]
    //
    // On stack, before: value, ...
    // On stack, after: ...
    //
    // Escape `value` and append it to the buffer
    appendEscaped: function() {
      var opcode = this.nextOpcode(), extra = "";
      this.context.aliases.escapeExpression = 'this.escapeExpression';

      if(opcode && opcode.opcode === 'appendContent') {
        extra = " + " + this.quotedString(opcode.args[0]);
        this.eat(opcode);
      }

      this.source.push(this.appendToBuffer("escapeExpression(" + this.popStack() + ")" + extra));
    },

    // [getContext]
    //
    // On stack, before: ...
    // On stack, after: ...
    // Compiler value, after: lastContext=depth
    //
    // Set the value of the `lastContext` compiler value to the depth
    getContext: function(depth) {
      if(this.lastContext !== depth) {
        this.lastContext = depth;
      }
    },

    // [lookupOnContext]
    //
    // On stack, before: ...
    // On stack, after: currentContext[name], ...
    //
    // Looks up the value of `name` on the current context and pushes
    // it onto the stack.
    lookupOnContext: function(name) {
      this.pushStack(this.nameLookup('depth' + this.lastContext, name, 'context'));
    },

    // [pushContext]
    //
    // On stack, before: ...
    // On stack, after: currentContext, ...
    //
    // Pushes the value of the current context onto the stack.
    pushContext: function() {
      this.pushStackLiteral('depth' + this.lastContext);
    },

    // [resolvePossibleLambda]
    //
    // On stack, before: value, ...
    // On stack, after: resolved value, ...
    //
    // If the `value` is a lambda, replace it on the stack by
    // the return value of the lambda
    resolvePossibleLambda: function() {
      this.context.aliases.functionType = '"function"';

      this.replaceStack(function(current) {
        return "typeof " + current + " === functionType ? " + current + "() : " + current;
      });
    },

    // [lookup]
    //
    // On stack, before: value, ...
    // On stack, after: value[name], ...
    //
    // Replace the value on the stack with the result of looking
    // up `name` on `value`
    lookup: function(name) {
      this.replaceStack(function(current) {
        return current + " == null || " + current + " === false ? " + current + " : " + this.nameLookup(current, name, 'context');
      });
    },

    // [lookupData]
    //
    // On stack, before: ...
    // On stack, after: data[id], ...
    //
    // Push the result of looking up `id` on the current data
    lookupData: function(id) {
      this.pushStack(this.nameLookup('data', id, 'data'));
    },

    // [pushStringParam]
    //
    // On stack, before: ...
    // On stack, after: string, currentContext, ...
    //
    // This opcode is designed for use in string mode, which
    // provides the string value of a parameter along with its
    // depth rather than resolving it immediately.
    pushStringParam: function(string) {
      this.pushStackLiteral('depth' + this.lastContext);
      this.pushString(string);
    },

    // [pushString]
    //
    // On stack, before: ...
    // On stack, after: quotedString(string), ...
    //
    // Push a quoted version of `string` onto the stack
    pushString: function(string) {
      this.pushStackLiteral(this.quotedString(string));
    },

    // [push]
    //
    // On stack, before: ...
    // On stack, after: expr, ...
    //
    // Push an expression onto the stack
    push: function(expr) {
      this.pushStack(expr);
    },

    // [pushLiteral]
    //
    // On stack, before: ...
    // On stack, after: value, ...
    //
    // Pushes a value onto the stack. This operation prevents
    // the compiler from creating a temporary variable to hold
    // it.
    pushLiteral: function(value) {
      this.pushStackLiteral(value);
    },

    // [pushProgram]
    //
    // On stack, before: ...
    // On stack, after: program(guid), ...
    //
    // Push a program expression onto the stack. This takes
    // a compile-time guid and converts it into a runtime-accessible
    // expression.
    pushProgram: function(guid) {
      if (guid != null) {
        this.pushStackLiteral(this.programExpression(guid));
      } else {
        this.pushStackLiteral(null);
      }
    },

    // [invokeHelper]
    //
    // On stack, before: hash, inverse, program, params..., ...
    // On stack, after: result of helper invocation
    //
    // Pops off the helper's parameters, invokes the helper,
    // and pushes the helper's return value onto the stack.
    //
    // If the helper is not found, `helperMissing` is called.
    invokeHelper: function(paramSize, name) {
      this.context.aliases.helperMissing = 'helpers.helperMissing';

      var helper = this.lastHelper = this.setupHelper(paramSize, name);
      this.register('foundHelper', helper.name);

      this.pushStack("foundHelper ? foundHelper.call(" +
        helper.callParams + ") " + ": helperMissing.call(" +
        helper.helperMissingParams + ")");
    },

    // [invokeKnownHelper]
    //
    // On stack, before: hash, inverse, program, params..., ...
    // On stack, after: result of helper invocation
    //
    // This operation is used when the helper is known to exist,
    // so a `helperMissing` fallback is not required.
    invokeKnownHelper: function(paramSize, name) {
      var helper = this.setupHelper(paramSize, name);
      this.pushStack(helper.name + ".call(" + helper.callParams + ")");
    },

    // [invokeAmbiguous]
    //
    // On stack, before: hash, inverse, program, params..., ...
    // On stack, after: result of disambiguation
    //
    // This operation is used when an expression like `{{foo}}`
    // is provided, but we don't know at compile-time whether it
    // is a helper or a path.
    //
    // This operation emits more code than the other options,
    // and can be avoided by passing the `knownHelpers` and
    // `knownHelpersOnly` flags at compile-time.
    invokeAmbiguous: function(name) {
      this.context.aliases.functionType = '"function"';

      this.pushStackLiteral('{}');
      var helper = this.setupHelper(0, name);

      var helperName = this.lastHelper = this.nameLookup('helpers', name, 'helper');
      this.register('foundHelper', helperName);

      var nonHelper = this.nameLookup('depth' + this.lastContext, name, 'context');
      var nextStack = this.nextStack();

      this.source.push('if (foundHelper) { ' + nextStack + ' = foundHelper.call(' + helper.callParams + '); }');
      this.source.push('else { ' + nextStack + ' = ' + nonHelper + '; ' + nextStack + ' = typeof ' + nextStack + ' === functionType ? ' + nextStack + '() : ' + nextStack + '; }');
    },

    // [invokePartial]
    //
    // On stack, before: context, ...
    // On stack after: result of partial invocation
    //
    // This operation pops off a context, invokes a partial with that context,
    // and pushes the result of the invocation back.
    invokePartial: function(name) {
      var params = [this.nameLookup('partials', name, 'partial'), "'" + name + "'", this.popStack(), "helpers", "partials"];

      if (this.options.data) {
        params.push("data");
      }

      this.context.aliases.self = "this";
      this.pushStack("self.invokePartial(" + params.join(", ") + ");");
    },

    // [assignToHash]
    //
    // On stack, before: value, hash, ...
    // On stack, after: hash, ...
    //
    // Pops a value and hash off the stack, assigns `hash[key] = value`
    // and pushes the hash back onto the stack.
    assignToHash: function(key) {
      var value = this.popStack();
      var hash = this.topStack();

      this.source.push(hash + "['" + key + "'] = " + value + ";");
    },

    // HELPERS

    compiler: JavaScriptCompiler,

    compileChildren: function(environment, options) {
      var children = environment.children, child, compiler;

      for(var i=0, l=children.length; i<l; i++) {
        child = children[i];
        compiler = new this.compiler();

        this.context.programs.push('');     // Placeholder to prevent name conflicts for nested children
        var index = this.context.programs.length;
        child.index = index;
        child.name = 'program' + index;
        this.context.programs[index] = compiler.compile(child, options, this.context);
      }
    },

    programExpression: function(guid) {
      this.context.aliases.self = "this";

      if(guid == null) {
        return "self.noop";
      }

      var child = this.environment.children[guid],
          depths = child.depths.list, depth;

      var programParams = [child.index, child.name, "data"];

      for(var i=0, l = depths.length; i<l; i++) {
        depth = depths[i];

        if(depth === 1) { programParams.push("depth0"); }
        else { programParams.push("depth" + (depth - 1)); }
      }

      if(depths.length === 0) {
        return "self.program(" + programParams.join(", ") + ")";
      } else {
        programParams.shift();
        return "self.programWithDepth(" + programParams.join(", ") + ")";
      }
    },

    register: function(name, val) {
      this.useRegister(name);
      this.source.push(name + " = " + val + ";");
    },

    useRegister: function(name) {
      if(!this.registers[name]) {
        this.registers[name] = true;
        this.registers.list.push(name);
      }
    },

    pushStackLiteral: function(item) {
      this.compileStack.push(new Literal(item));
      return item;
    },

    pushStack: function(item) {
      this.source.push(this.incrStack() + " = " + item + ";");
      this.compileStack.push("stack" + this.stackSlot);
      return "stack" + this.stackSlot;
    },

    replaceStack: function(callback) {
      var item = callback.call(this, this.topStack());

      this.source.push(this.topStack() + " = " + item + ";");
      return "stack" + this.stackSlot;
    },

    nextStack: function(skipCompileStack) {
      var name = this.incrStack();
      this.compileStack.push("stack" + this.stackSlot);
      return name;
    },

    incrStack: function() {
      this.stackSlot++;
      if(this.stackSlot > this.stackVars.length) { this.stackVars.push("stack" + this.stackSlot); }
      return "stack" + this.stackSlot;
    },

    popStack: function() {
      var item = this.compileStack.pop();

      if (item instanceof Literal) {
        return item.value;
      } else {
        this.stackSlot--;
        return item;
      }
    },

    topStack: function() {
      var item = this.compileStack[this.compileStack.length - 1];

      if (item instanceof Literal) {
        return item.value;
      } else {
        return item;
      }
    },

    quotedString: function(str) {
      return '"' + str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r') + '"';
    },

    setupHelper: function(paramSize, name) {
      var params = [];
      this.setupParams(paramSize, params);
      var foundHelper = this.nameLookup('helpers', name, 'helper');

      return {
        params: params,
        name: foundHelper,
        callParams: ["depth0"].concat(params).join(", "),
        helperMissingParams: ["depth0", this.quotedString(name)].concat(params).join(", ")
      };
    },

    // the params and contexts arguments are passed in arrays
    // to fill in
    setupParams: function(paramSize, params) {
      var options = [], contexts = [], param, inverse, program;

      options.push("hash:" + this.popStack());

      inverse = this.popStack();
      program = this.popStack();

      // Avoid setting fn and inverse if neither are set. This allows
      // helpers to do a check for `if (options.fn)`
      if (program || inverse) {
        if (!program) {
          this.context.aliases.self = "this";
          program = "self.noop";
        }

        if (!inverse) {
         this.context.aliases.self = "this";
          inverse = "self.noop";
        }

        options.push("inverse:" + inverse);
        options.push("fn:" + program);
      }

      for(var i=0; i<paramSize; i++) {
        param = this.popStack();
        params.push(param);

        if(this.options.stringParams) {
          contexts.push(this.popStack());
        }
      }

      if (this.options.stringParams) {
        options.push("contexts:[" + contexts.join(",") + "]");
      }

      if(this.options.data) {
        options.push("data:data");
      }

      params.push("{" + options.join(",") + "}");
      return params.join(", ");
    }
  };

  var reservedWords = (
    "break else new var" +
    " case finally return void" +
    " catch for switch while" +
    " continue function this with" +
    " default if throw" +
    " delete in try" +
    " do instanceof typeof" +
    " abstract enum int short" +
    " boolean export interface static" +
    " byte extends long super" +
    " char final native synchronized" +
    " class float package throws" +
    " const goto private transient" +
    " debugger implements protected volatile" +
    " double import public let yield"
  ).split(" ");

  var compilerWords = JavaScriptCompiler.RESERVED_WORDS = {};

  for(var i=0, l=reservedWords.length; i<l; i++) {
    compilerWords[reservedWords[i]] = true;
  }

  JavaScriptCompiler.isValidJavaScriptVariableName = function(name) {
    if(!JavaScriptCompiler.RESERVED_WORDS[name] && /^[a-zA-Z_$][0-9a-zA-Z_$]+$/.test(name)) {
      return true;
    }
    return false;
  };

})(Handlebars.Compiler, Handlebars.JavaScriptCompiler);

Handlebars.precompile = function(string, options) {
  options = options || {};

  var ast = Handlebars.parse(string);
  var environment = new Handlebars.Compiler().compile(ast, options);
  return new Handlebars.JavaScriptCompiler().compile(environment, options);
};

Handlebars.compile = function(string, options) {
  options = options || {};

  var compiled;
  function compile() {
    var ast = Handlebars.parse(string);
    var environment = new Handlebars.Compiler().compile(ast, options);
    var templateSpec = new Handlebars.JavaScriptCompiler().compile(environment, options, undefined, true);
    return Handlebars.template(templateSpec);
  }

  // Template is only compiled on first use and cached after that point.
  return function(context, options) {
    if (!compiled) {
      compiled = compile();
    }
    return compiled.call(this, context, options);
  };
};
;
// lib/handlebars/runtime.js
Handlebars.VM = {
  template: function(templateSpec) {
    // Just add water
    var container = {
      escapeExpression: Handlebars.Utils.escapeExpression,
      invokePartial: Handlebars.VM.invokePartial,
      programs: [],
      program: function(i, fn, data) {
        var programWrapper = this.programs[i];
        if(data) {
          return Handlebars.VM.program(fn, data);
        } else if(programWrapper) {
          return programWrapper;
        } else {
          programWrapper = this.programs[i] = Handlebars.VM.program(fn);
          return programWrapper;
        }
      },
      programWithDepth: Handlebars.VM.programWithDepth,
      noop: Handlebars.VM.noop
    };

    return function(context, options) {
      options = options || {};
      return templateSpec.call(container, Handlebars, context, options.helpers, options.partials, options.data);
    };
  },

  programWithDepth: function(fn, data, $depth) {
    var args = Array.prototype.slice.call(arguments, 2);

    return function(context, options) {
      options = options || {};

      return fn.apply(this, [context, options.data || data].concat(args));
    };
  },
  program: function(fn, data) {
    return function(context, options) {
      options = options || {};

      return fn(context, options.data || data);
    };
  },
  noop: function() { return ""; },
  invokePartial: function(partial, name, context, helpers, partials, data) {
    var options = { helpers: helpers, partials: partials, data: data };

    if(partial === undefined) {
      throw new Handlebars.Exception("The partial " + name + " could not be found");
    } else if(partial instanceof Function) {
      return partial(context, options);
    } else if (!Handlebars.compile) {
      throw new Handlebars.Exception("The partial " + name + " could not be compiled when running in runtime-only mode");
    } else {
      partials[name] = Handlebars.compile(partial, {data: data !== undefined});
      return partials[name](context, options);
    }
  }
};

Handlebars.template = Handlebars.VM.template;
;


return Handlebars;
});

define("kjui/tree/0.0.1/tree-debug", ["$-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug", "gallery/handlebars/1.0.0/handlebars-debug"], function(require, exports, module) {
  var $ = require('$-debug'),
    Widget = require('arale/widget/1.0.2/widget-debug'),
    handlebars = require('gallery/handlebars/1.0.0/handlebars-debug');

  var rowTpl = '<tr class="grid-row" {{#if expanded}}data-status="expanded"{{/if}} {{#if leaf}}data-type="leaf"{{/if}}> <td class="grid-cell"> {{#each icons}}<i class="icon icon-tree-{{this}}"></i>{{/each}}{{name}} </td> {{#each grids}} <td class="grid-cell">{{this}}</td> {{/each}} </tr>',
    headerTpl = '{{#if headers}} <thead class="grid-hd unselectable"> <tr> {{#each headers}} <td class="grid-hd-cell"><span>{{this}}</span></td> {{/each}} </tr> </thead> {{/if}}';

  var Tree = Widget.extend({
    setup: function() {
      var that = this;

      var url = this.get('url');
      if (url){
        $.getJSON(url, function(data){
          that.data = data;
          var tpl = that._createTree(data);
          that.element.html(tpl);
        });
      } else {
        //避免向服务端发送请求
        var data =this.get('data');
        if (data){
          this.data = data;
          var tpl = that._createTree(data);
          that.element.html(tpl);
        }
      }

      this.render();
    },

    events: {
      'click .grid-row': 'click'
    },

    click: function(e){
      var node = $(e.target);
      var data = node.parents('tr').data('data');

      //打开折叠
      if (/minus|plus/.test(node.attr('class'))){
        this.toggle(node);
      } else {
        //点击事件
        node.parents('tr').addClass('grid-row-is-selected')
          .siblings().removeClass('grid-row-is-selected');

        //参数为点击项对应数据，节点，整个tree数据
        this.trigger('click', data, node, this.data);
      }
    },

    toggle: function(node){
      var index = node.parent().children().index(node);
      var row = node.parents('tr');

      var cls = node.attr('class');
      if (/minus/.test(cls)){
        cls = cls.replace('minus', 'plus');

        toggle('hide', row, index);
        row.removeAttr('data-status');
      } else if (/plus/.test(cls)){
        cls = cls.replace('plus', 'minus');

        toggle('show', row, index);
        row.attr('data-status', 'expanded');
      } else {
        seajs.console('不合法的class');
      }
      node.attr('class', cls);
    },

    //生成tree
    _tree: null,

    _createTree: function(data){
      this._tree = $('<table>', {
        'class': 'grid tree unselectable',
        border: '0',
        cellspacing: '0',
        cellpadding: '0'
      }).append('<tbody>');

      this._createHeader();

      this._loopRow(data,[]);
      return this._tree;
    },

    _createHeader: function(){
      var headers = this.get('headers');
      var header = handlebars.compile(headerTpl)({
        headers: headers
      });
      this._tree.append(header);
    },

    _createRow: function(icons, data) {
      var fields = this.get('fields');
      var grids = fields? $.map(fields,function(field){
        return data[field];
      }):[];

      var row = handlebars.compile(rowTpl)({
        icons: icons,
        name: data.name,
        expanded: data.children.length !== 0? true:false,
        leaf: data.children.length === 0? true:false,
        grids: grids
      });
      row = $(row);
      row.data('data', data);
      this._tree.append(row);
    },

    _loopRow: function(data, prefix){
      for (var i = 0; i < data.children.length; i++) {
        var d = data.children[i];
        if (d.children.length === 0) {
          if (i != data.children.length-1){
            this._createRow(prefix.concat('elbow','leaf'), d);
          } else {
            this._createRow(prefix.concat('elbow-end','leaf'), d);
          }
        } else {
          if (i != data.children.length-1){
            this._createRow(prefix.concat('elbow-minus','folder'), d);
          } else {
            this._createRow(prefix.concat('elbow-end-minus','folder'), d);
          }
          if (i != data.children.length-1){
            this._loopRow(d, prefix.concat('elbow-line'));
          }
          else {
            this._loopRow(d, prefix.concat('elbow-empty'));
          }
        }
      }
    }

  });

  module.exports = Tree;

  function toggle(type, row, index){
    var nextRow = row.next();
    var nextNode = nextRow.children().eq(0).children().eq(index);
    if (nextNode.hasClass('icon-tree-elbow-line') || nextNode.hasClass('icon-tree-elbow-empty')){
      nextRow[type]();

      if (type == 'show'){
        if (nextRow.attr('data-type') == 'leaf'){
          toggle(type, nextRow, index);
        } else {
          if (nextRow.attr('data-status') == 'expanded'){
            toggle(type, nextRow, index);
          }
        }
      } else {
        toggle(type, nextRow, index);
      }
    }
  }

});

define("arale/switchable/0.9.11/const-debug", [], function(require, exports) {

    var UI_SWITCHABLE = 'ui-switchable';

    // 内部默认的 className
    exports.UI_SWITCHABLE = UI_SWITCHABLE;
    exports.NAV_CLASS = UI_SWITCHABLE + '-nav';
    exports.CONTENT_CLASS = UI_SWITCHABLE + '-content';
    exports.TRIGGER_CLASS = UI_SWITCHABLE + '-trigger';
    exports.PANEL_CLASS = UI_SWITCHABLE + '-panel';
    exports.ACTIVE_CLASS = UI_SWITCHABLE + '-active';
    exports.PREV_BTN_CLASS = UI_SWITCHABLE + '-prev-btn';
    exports.NEXT_BTN_CLASS = UI_SWITCHABLE + '-next-btn';
    exports.DISABLED_BTN_CLASS = UI_SWITCHABLE + '-disabled-btn';

});

define("arale/switchable/0.9.11/plugins/effects-debug", ["$-debug"], function(require, exports, module) {

    var $ = require('$-debug');

    var SCROLLX = 'scrollx';
    var SCROLLY = 'scrolly';
    var FADE = 'fade';


    // 切换效果插件
    module.exports = {

        isNeeded: function() {
            return this.get('effect') !== 'none';
        },

        install: function() {
            var panels = this.panels;

            // 注：
            // 1. 所有 panel 的尺寸应该相同
            //    最好指定第一个 panel 的 width 和 height
            //    因为 Safari 下，图片未加载时，读取的 offsetHeight 等值会不对
            // 2. 初始化 panels 样式
            //    这些特效需要将 panels 都显示出来
            // 3. 在 CSS 里，需要给 container 设定高宽和 overflow: hidden
            panels.show();

            var effect = this.get('effect');
            var step = this.get('step');

            // 初始化滚动效果
            if (effect.indexOf('scroll') === 0) {
                var content = this.content;
                var firstPanel = panels.eq(0);

                // 设置定位信息，为滚动效果做铺垫
                content.css('position', 'relative');

                // 注：content 的父级不一定是 container
                if (content.parent().css('position') === 'static') {
                    content.parent().css('position', 'relative');
                }

                // 水平排列
                if (effect === SCROLLX) {
                    panels.css('float', 'left');
                    // 设置最大宽度，以保证有空间让 panels 水平排布
                    content.width('9999px');
                }

                // 只有 scrollX, scrollY 需要设置 viewSize
                // 其他情况下不需要
                var viewSize = this.get('viewSize');
                if (!viewSize[0]) {
                    viewSize[0] = firstPanel.outerWidth() * step;
                    viewSize[1] = firstPanel.outerHeight() * step;
                    this.set('viewSize', viewSize);
                }

                if (!viewSize[0]) {
                    throw new Error('Please specify viewSize manually');
                }
            }
            // 初始化淡隐淡出效果
            else if (effect === FADE) {
                var activeIndex = this.get('activeIndex');
                var min = activeIndex * step;
                var max = min + step - 1;

                panels.each(function(i, panel) {
                    var isActivePanel = i >= min && i <= max;
                    $(panel).css({
                        opacity: isActivePanel ? 1 : 0,
                        position: 'absolute',
                        zIndex: isActivePanel ? 9 : 1
                    });
                });
            }

            // 覆盖 switchPanel 方法
            this._switchPanel = function(panelInfo) {
                var effect = this.get('effect');
                var fn = $.isFunction(effect) ? effect : Effects[effect];
                fn.call(this, panelInfo);
            };
        }
    };


    // 切换效果方法集
    var Effects = {

        // 淡隐淡现效果
        fade: function(panelInfo) {
            // 简单起见，目前不支持 step > 1 的情景。若需要此效果时，可修改结构来达成。
            if (this.get('step') > 1) {
                throw new Error('Effect "fade" only supports step === 1');
            }

            var fromPanel = panelInfo.fromPanels.eq(0);
            var toPanel = panelInfo.toPanels.eq(0);
            var anim = this.anim;

            if (anim) {
                // 立刻停止，以开始新的
                anim.stop(false, true);
            }

            // 首先显示下一张
            toPanel.css('opacity', 1);

            if (fromPanel[0]) {
                var duration = this.get('duration');
                var easing = this.get('easing');
                var that = this;

                // 动画切换
                this.anim = fromPanel.animate({ opacity: 0 }, duration, easing,
                        function() {
                            that.anim = null; // free

                            // 切换 z-index
                            toPanel.css('zIndex', 9);
                            fromPanel.css('zIndex', 1);
                        });
            }
            // 初始情况下没有必要动画切换
            else {
                toPanel.css('zIndex', 9);
            }
        },

        // 水平/垂直滚动效果
        scroll: function(panelInfo) {
            var isX = this.get('effect') === SCROLLX;
            var diff = this.get('viewSize')[isX ? 0 : 1] * panelInfo.toIndex;

            var props = {};
            props[isX ? 'left' : 'top'] = -diff + 'px';

            if (this.anim) {
                this.anim.stop();
            }

            if (panelInfo.fromIndex > -1) {
                var that = this;
                var duration = this.get('duration');
                var easing = this.get('easing');

                this.anim = this.content.animate(props, duration, easing,
                        function() {
                            that.anim = null; // free
                        });
            }
            else {
                this.content.css(props);
            }
        }
    };

    Effects[SCROLLY] = Effects.scroll;
    Effects[SCROLLX] = Effects.scroll;
    module.exports.Effects = Effects;

});

define("arale/switchable/0.9.11/plugins/autoplay-debug", ["$-debug"], function(require, exports, module) {

    var $ = require('$-debug');


    // 自动播放插件
    module.exports = {

        attrs: {
            autoplay: true,

            // 自动播放的间隔时间
            interval: 5000,

            // 滚出可视区域后，是否停止自动播放
            pauseOnScroll: true,

            // 鼠标悬停时，是否停止自动播放
            pauseOnHover: true
        },

        isNeeded: function() {
            return this.get('autoplay');
        },

        install: function() {
            var element = this.element;
            var EVENT_NS = '.' + this.cid;
            var timer;
            var interval = this.get('interval');
            var that = this;

            // start autoplay
            start();

            function start() {
                // 停止之前的
                stop();

                // 设置状态
                that.paused = false;

                // 开始现在的
                timer = setInterval(function() {
                    if (that.paused) return;
                    that.next();
                }, interval);
            }

            function stop() {
                if (timer) {
                    clearInterval(timer);
                    timer = null;
                }
                that.paused = true;
            }

            // public api
            this.stop = stop;
            this.start = start;

            // 滚出可视区域后，停止自动播放
            if (this.get('pauseOnScroll')) {
                this._scrollDetect = throttle(function() {
                    that[isInViewport(element) ? 'start' : 'stop']();
                });
                win.on('scroll' + EVENT_NS, this._scrollDetect);
            }

            // 鼠标悬停时，停止自动播放
            if (this.get('pauseOnHover')) {
                this.element.hover(stop, start);
            }
        },

        destroy: function() {
            var EVENT_NS = '.' + this.cid;
            this.stop();

            if (this._scrollDetect) {
                this._scrollDetect.stop();
                win.off('scroll' + EVENT_NS);
            }
        }
    };


    // Helpers
    // -------


    function throttle(fn, ms) {
        ms = ms || 200;
        var throttleTimer;

        function f() {
            f.stop();
            throttleTimer = setTimeout(fn, ms);
        }

        f.stop = function() {
            if (throttleTimer) {
                clearTimeout(throttleTimer);
                throttleTimer = 0;
            }
        };

        return f;
    }


    var win = $(window);

    function isInViewport(element) {
        var scrollTop = win.scrollTop();
        var scrollBottom = scrollTop + win.height();
        var elementTop = element.offset().top;
        var elementBottom = elementTop + element.height();

        // 只判断垂直位置是否在可视区域，不判断水平。只有要部分区域在可视区域，就返回 true
        return elementTop < scrollBottom && elementBottom > scrollTop;
    }

});

define("arale/switchable/0.9.11/plugins/circular-debug", ["./effects-debug", "$-debug"], function(require, exports, module) {

    var $ = require('$-debug');

    var SCROLLX = 'scrollx';
    var SCROLLY = 'scrolly';
    var Effects = require('./effects-debug').Effects;


    // 无缝循环滚动插件
    module.exports = {

        // 仅在开启滚动效果时需要
        isNeeded: function() {
            var effect = this.get('effect');
            var circular = this.get('circular');
            return circular && (effect === SCROLLX || effect === SCROLLY);
        },

        install: function() {
            this.set('scrollType', this.get('effect'));
            this.set('effect', 'scrollCircular');
        }
    };

    Effects.scrollCircular = function(panelInfo) {
        var toIndex = panelInfo.toIndex;
        var fromIndex = panelInfo.fromIndex;
        var len = this.get('length');
        var isNext = this.get('_isNext');

        var isBackwardCritical = (fromIndex === 0 && toIndex === len - 1 && !isNext);
        var isForwardCritical = (fromIndex === len - 1 && toIndex === 0 && isNext);

        var isBackward = isBackwardCritical ||
                (!isForwardCritical && toIndex < fromIndex);
        var isCritical = isBackwardCritical || isForwardCritical;

        var isX = this.get('scrollType') === SCROLLX;
        var prop = isX ? 'left' : 'top';
        var viewDiff = this.get('viewSize')[isX ? 0 : 1];
        var diff = -viewDiff * toIndex;

        // 开始动画前，先停止掉上一动画
        if (this.anim) {
            this.anim.stop(false, true);
        }

        // 在临界点时，先调整 panels 位置
        if (isCritical) {
            diff = adjustPosition.call(this, isBackward, prop, viewDiff);
        }

        var props = {};
        props[prop] = diff + 'px';

        // 开始动画
        if (fromIndex > -1) {
            var duration = this.get('duration');
            var easing = this.get('easing');
            var that = this;

            this.anim = this.content.animate(props, duration, easing,
                    function() {
                        that.anim = null; // free

                        // 复原位置
                        if (isCritical) {
                            resetPosition.call(that, isBackward,
                                    prop, viewDiff);
                        }
                    });
        }
        // 初始化
        else {
            this.content.css(props);
        }

    };

    // 调整位置
    function adjustPosition(isBackward, prop, viewDiff) {
        var step = this.get('step');
        var len = this.get('length');
        var start = isBackward ? len - 1 : 0;
        var from = start * step;
        var to = (start + 1) * step;
        var diff = isBackward ? viewDiff : -viewDiff * len;

        // 调整 panels 到下一个视图中
        var toPanels = $(this.panels.get().slice(from, to));
        toPanels.css('position', 'relative');
        toPanels.css(prop, -diff + 'px');

        // 返回偏移量
        return diff;
    }

    // 复原位置
    function resetPosition(isBackward, prop, viewDiff) {
        var step = this.get('step');
        var len = this.get('length');
        var start = isBackward ? len - 1 : 0;
        var from = start * step;
        var to = (start + 1) * step;

        // 滚动完成后，复位到正常状态
        var toPanels = $(this.panels.get().slice(from, to));
        toPanels.css('position', '');
        toPanels.css(prop, '');

        // 瞬移到正常位置
        this.content.css(prop, isBackward ? -viewDiff * (len - 1) : '');
    }

});

define("arale/switchable/0.9.11/plugins/multiple-debug", ["../const-debug"], function(require, exports, module) {

    var CONST = require('../const-debug');


    // 手风琴组件
    module.exports = {

        isNeeded: function() {
            return this.get('multiple');
        },

        methods: {
            switchTo: function(toIndex) {
              this._switchTo(toIndex, toIndex);
            },

            _switchTrigger: function(toIndex) {
                this.triggers.eq(toIndex).toggleClass(this.get('activeTriggerClass'));
            },

            _triggerIsValid: function() {
                // multiple 模式下，再次触发意味着切换展开/收缩状态
                return true;
            },

            _switchPanel: function(panelInfo) {
                panelInfo.toPanels.toggle();
            }
        }
    };

});

define("arale/switchable/0.9.11/switchable-debug", ["./const-debug", "./plugins/effects-debug", "./plugins/autoplay-debug", "./plugins/circular-debug", "./plugins/multiple-debug", "$-debug", "arale/easing/1.0.0/easing-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug"], function(require, exports, module) {

    // Switchable
    // -----------
    // 可切换组件，核心特征是：有一组可切换的面板（Panel），可通过触点（Trigger）来触发。
    // 感谢：
    //  - https://github.com/kissyteam/kissy/blob/master/src/switchable/


    var $ = require('$-debug');
    var Easing = require('arale/easing/1.0.0/easing-debug');
    var Widget = require('arale/widget/1.0.2/widget-debug');

    var CONST = require('./const-debug');
    var Effects = require('./plugins/effects-debug');
    var Autoplay = require('./plugins/autoplay-debug');
    var Circular = require('./plugins/circular-debug');
    var Multiple = require('./plugins/multiple-debug');


    var Switchable = Widget.extend({

        attrs: {

            // 用户传入的 triggers 和 panels
            // 可以是 Selector、jQuery 对象、或 DOM 元素集
            triggers: {
                value: [],
                getter: function(val) {
                    return $(val);
                }
            },
            panels: {
                value: [],
                getter: function(val) {
                    return $(val);
                }
            },

            // 是否包含 triggers，用于没有传入 triggers 时，是否自动生成的判断标准
            hasTriggers: true,
            // 触发类型
            triggerType: 'hover', // or 'click'
            // 触发延迟
            delay: 100,

            // 切换效果，可取 scrollx | scrolly | fade 或直接传入 effect function
            effect: 'none',
            easing: 'linear',
            duration: 500,

            // 初始切换到哪个面板
            activeIndex: 0,

            // 一屏内有多少个 panels
            step: 1,
            // 有多少屏
            length: {
                readOnly: true,
                getter: function() {
                    return this.panels.length / this.get('step');
                }
            },

            // 可见视图区域的大小。一般不需要设定此值，仅当获取值不正确时，用于手工指定大小
            viewSize: [],

            activeTriggerClass: CONST.ACTIVE_CLASS 
        },

        setup: function() {
            this._parseRole();
            this._initElement();
            this._initPanels();
            this._initTriggers();
            this._initPlugins();
            this.render();
        },


        _parseRole: function(role) {
            // var role = this.dataset && this.dataset.role;
            role = role || this._getDatasetRole();
            if (!role) return;

            var element = this.element;
            var triggers = this.get('triggers');
            var panels = this.get('panels');

            // attr 里没找到时，才根据 data-role 来解析
            if (triggers.length === 0 && (role.trigger || role.nav)) {
                triggers = role.trigger || role.nav.find('> *');
            }

            if (panels.length === 0 && (role.panel || role.content)) {
                panels = role.panel || role.content.find('> *');
            }

            this.set('triggers', triggers);
            this.set('panels', panels);
        },

        _getDatasetRole: function(role) {
            var element = this.element;
            var role = role || {};
            var isHaveRole = false;
            var roles = ['trigger', 'panel', 'nav', 'content'];
            $.each(roles, function(index, key) {
              var elems = $('[data-role=' + key + ']', element); 
              if (elems.length) {
                role[key] = elems;
                isHaveRole = true;
              }
            });
            if (!isHaveRole) return null;
            return role;
        },

        _initElement: function() {
            this.element.addClass(CONST.UI_SWITCHABLE);
        },

        _initPanels: function() {
            var panels = this.panels = this.get('panels');
            if (panels.length === 0) {
                throw new Error('panels.length is ZERO');
            }

            this.content = panels.parent().addClass(CONST.CONTENT_CLASS);
            panels.addClass(CONST.PANEL_CLASS);
        },

        _initTriggers: function() {
            var triggers = this.triggers = this.get('triggers');

            // 用户没有传入 triggers，也没有通过 data-role 指定时，如果
            // hasTriggers 为 true，则自动生成 triggers
            if (triggers.length === 0 && this.get('hasTriggers')) {
                this.nav = generateTriggersMarkup(
                        this.get('length'),
                        this.get('activeIndex'),
                        this.get('activeTriggerClass')
                ).appendTo(this.element);

                // update triggers
                this.triggers = this.nav.children();
            }
            else {
                this.nav = triggers.parent();
            }

            this.triggers.addClass(CONST.TRIGGER_CLASS);
            this.nav.addClass(CONST.NAV_CLASS);

            this.triggers.each(function(i, trigger) {
                $(trigger).data('value', i);
            });
            this._bindTriggers();
        },

        _initPlugins: function() {
            this._plugins = [];

            this._plug(Effects);
            this._plug(Autoplay);
            this._plug(Circular);
            this._plug(Multiple);
        },


        _bindTriggers: function() {
            var that = this;

            if (this.get('triggerType') === 'click') {
                this.triggers.click(focus);
            }
            // hover
            else {
                this.triggers.hover(focus, leave);
            }

            function focus(ev) {
                that._onFocusTrigger(ev.type, $(this).data('value'));
            }

            function leave() {
                clearTimeout(that._switchTimer);
            }
        },

        _onFocusTrigger: function(type, index) {
            var that = this;

            // click or tab 键激活时
            if (type === 'click') {
                this.switchTo(index);
            }

            // hover
            else {
                this._switchTimer = setTimeout(function() {
                    that.switchTo(index);
                }, this.get('delay'));
            }
        },


        // 切换到指定 index
        switchTo: function(toIndex) {
            this.set('activeIndex', toIndex);
            return this;
        },

        _onRenderActiveIndex: function(toIndex, fromIndex) {
            if (this._triggerIsValid(toIndex, fromIndex)) {
                this._switchTo(toIndex, fromIndex);
            }
        },

        _switchTo: function(toIndex, fromIndex) {
            this.trigger('switch', toIndex, fromIndex);
            this._switchTrigger(toIndex, fromIndex);
            this._switchPanel(this._getPanelInfo(toIndex, fromIndex));
            this.trigger('switched', toIndex, fromIndex);
        },

        // 触发是否有效
        _triggerIsValid: function(toIndex, fromIndex) {
            return toIndex !== fromIndex;
        },

        _switchTrigger: function(toIndex, fromIndex) {
            var triggers = this.triggers;
            if (triggers.length < 1) return;

            triggers.eq(fromIndex).removeClass(this.get('activeTriggerClass'));
            triggers.eq(toIndex).addClass(this.get('activeTriggerClass'));
        },

        _switchPanel: function(panelInfo) {
            // 默认是最简单的切换效果：直接隐藏/显示
            panelInfo.fromPanels.hide();
            panelInfo.toPanels.show();
        },

        _getPanelInfo: function(toIndex, fromIndex) {
            var panels = this.panels.get();
            var step = this.get('step');

            var fromPanels, toPanels;

            if (fromIndex > -1) {
                var begin = fromIndex * step;
                var end = (fromIndex + 1) * step;
                fromPanels = panels.slice(begin, end);
            }

            toPanels = panels.slice(toIndex * step, (toIndex + 1) * step);

            return {
                toIndex: toIndex,
                fromIndex: fromIndex,
                toPanels: $(toPanels),
                fromPanels: $(fromPanels)
            };
        },

        // 切换到上一视图
        prev: function() {
            var fromIndex = this.get('activeIndex');
            // 考虑循环切换的情况
            var index = (fromIndex - 1 + this.get('length')) % this.get('length');
            this.switchTo(index);
        },

        // 切换到下一视图
        next: function() {
            var fromIndex = this.get('activeIndex');
            var index = (fromIndex + 1) % this.get('length');
            this.switchTo(index);
        },


        _plug: function(plugin) {
            if (!plugin.isNeeded.call(this)) return;

            var pluginAttrs = plugin.attrs;
            var methods = plugin.methods;

            if (pluginAttrs) {
                for (var key in pluginAttrs) {
                    if (pluginAttrs.hasOwnProperty(key) &&
                            // 不覆盖用户传入的配置
                            !(key in this.attrs)) {
                        this.set(key, pluginAttrs[key]);
                    }
                }
            }

            if (methods) {
                for (var method in methods) {
                    if (methods.hasOwnProperty(method)) {
                        // 覆盖实例方法。
                        this[method] = methods[method];
                    }
                }
            }

            if (plugin.install) {
                plugin.install.call(this);
            }

            this._plugins.push(plugin);
        },


        destroy: function() {
            $.each(this._plugins, function(i, plugin) {
                if (plugin.destroy) {
                    plugin.destroy.call(this);
                }
            });

            Switchable.superclass.destroy.call(this);
        }
    });

    module.exports = Switchable;


    // Helpers
    // -------

    function generateTriggersMarkup(length, activeIndex, activeTriggerClass) {
        var nav = $('<ul>');

        for (var i = 0; i < length; i++) {
            var className = i === activeIndex ? activeTriggerClass : '';

            $('<li>', {
                'class': className,
                'html': i + 1
            }).appendTo(nav);
        }

        return nav;
    }

});

define("arale/easing/1.0.0/easing-debug", ["$-debug"], function(require, exports, module) {

    // Based on Easing Equations (c) 2003 Robert Penner, all rights reserved.
    // This work is subject to the terms in
    // http://www.robertpenner.com/easing_terms_of_use.html
    // Preview: http://www.robertpenner.com/Easing/easing_demo.html
    //
    // Thanks to:
    //  - https://github.com/yui/yui3/blob/master/src/anim/js/anim-easing.js
    //  - https://github.com/gilmoreorless/jquery-easing-molecules


    var PI = Math.PI;
    var pow = Math.pow;
    var sin = Math.sin;
    var MAGIC_NUM = 1.70158; // Penner's magic number


    /**
     * 和 YUI 的 Easing 相比，这里的 Easing 进行了归一化处理，参数调整为：
     * @param {Number} t Time value used to compute current value 0 =< t <= 1
     * @param {Number} b Starting value  b = 0
     * @param {Number} c Delta between start and end values  c = 1
     * @param {Number} d Total length of animation d = 1
     */
    var Easing = {

        /**
         * Uniform speed between points.
         */
        easeNone: function(t) {
            return t;
        },

        /**
         * Begins slowly and accelerates towards end. (quadratic)
         */
        easeIn: function(t) {
            return t * t;
        },

        /**
         * Begins quickly and decelerates towards end.  (quadratic)
         */
        easeOut: function(t) {
            return (2 - t) * t;
        },

        /**
         * Begins slowly and decelerates towards end. (quadratic)
         */
        easeBoth: function(t) {
            return (t *= 2) < 1 ?
                    .5 * t * t :
                    .5 * (1 - (--t) * (t - 2));
        },

        /**
         * Begins slowly and accelerates towards end. (quartic)
         */
        easeInStrong: function(t) {
            return t * t * t * t;
        },
        /**
         * Begins quickly and decelerates towards end.  (quartic)
         */
        easeOutStrong: function(t) {
            return 1 - (--t) * t * t * t;
        },

        /**
         * Begins slowly and decelerates towards end. (quartic)
         */
        easeBothStrong: function(t) {
            return (t *= 2) < 1 ?
                    .5 * t * t * t * t :
                    .5 * (2 - (t -= 2) * t * t * t);
        },

        /**
         * Backtracks slightly, then reverses direction and moves to end.
         */
        backIn: function(t) {
            if (t === 1) t -= .001;
            return t * t * ((MAGIC_NUM + 1) * t - MAGIC_NUM);
        },

        /**
         * Overshoots end, then reverses and comes back to end.
         */
        backOut: function(t) {
            return (t -= 1) * t * ((MAGIC_NUM + 1) * t + MAGIC_NUM) + 1;
        },

        /**
         * Backtracks slightly, then reverses direction, overshoots end,
         * then reverses and comes back to end.
         */
        backBoth: function(t) {
            var s = MAGIC_NUM;
            var m = (s *= 1.525) + 1;

            if ((t *= 2 ) < 1) {
                return .5 * (t * t * (m * t - s));
            }
            return .5 * ((t -= 2) * t * (m * t + s) + 2);
        },

        /**
         * Snap in elastic effect.
         */
        elasticIn: function(t) {
            var p = .3, s = p / 4;
            if (t === 0 || t === 1) return t;
            return -(pow(2, 10 * (t -= 1)) * sin((t - s) * (2 * PI) / p));
        },

        /**
         * Snap out elastic effect.
         */
        elasticOut: function(t) {
            var p = .3, s = p / 4;
            if (t === 0 || t === 1) return t;
            return pow(2, -10 * t) * sin((t - s) * (2 * PI) / p) + 1;
        },

        /**
         * Snap both elastic effect.
         */
        elasticBoth: function(t) {
            var p = .45, s = p / 4;
            if (t === 0 || (t *= 2) === 2) return t;

            if (t < 1) {
                return -.5 * (pow(2, 10 * (t -= 1)) *
                        sin((t - s) * (2 * PI) / p));
            }
            return pow(2, -10 * (t -= 1)) *
                    sin((t - s) * (2 * PI) / p) * .5 + 1;
        },

        /**
         * Bounce off of start.
         */
        bounceIn: function(t) {
            return 1 - Easing.bounceOut(1 - t);
        },

        /**
         * Bounces off end.
         */
        bounceOut: function(t) {
            var s = 7.5625, r;

            if (t < (1 / 2.75)) {
                r = s * t * t;
            }
            else if (t < (2 / 2.75)) {
                r = s * (t -= (1.5 / 2.75)) * t + .75;
            }
            else if (t < (2.5 / 2.75)) {
                r = s * (t -= (2.25 / 2.75)) * t + .9375;
            }
            else {
                r = s * (t -= (2.625 / 2.75)) * t + .984375;
            }

            return r;
        },

        /**
         * Bounces off start and end.
         */
        bounceBoth: function(t) {
            if (t < .5) {
                return Easing.bounceIn(t * 2) * .5;
            }
            return Easing.bounceOut(t * 2 - 1) * .5 + .5;
        }
    };

    // 可以通过 require 获取
    module.exports = Easing;


    // 也可以直接通过 jQuery.easing 来使用
    var $ = require('$-debug');
    $.extend($.easing, Easing);

});

define("kjui/tab/0.0.1/tab-debug", ["$-debug", "arale/switchable/0.9.11/switchable-debug", "arale/easing/1.0.0/easing-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug"], function(require, exports, module) {
  var $ = require('$-debug'),
    Switchable = require('arale/switchable/0.9.11/switchable-debug');

  var Tab = Switchable.extend({
    attrs: {
      triggerType: 'click',
      activeTriggerClass: 'tab-hd-is-active'
    },

    setup: function() {
      Tab.superclass.setup.call(this);

      this._fixNavHeight();
    },

    //nav比原始高度少1像素，盖住strip
    _fixNavHeight: function(){
      var nav = this.triggers.parent();
      if (navHeight === 0) {
        navHeight = nav.height();
      }
      if (navHeight > 0) {
        nav.height(navHeight - 1);
      }
    }

  });

  module.exports = Tab;

  var navHeight = 0;

});

define("kjui/dialog/0.0.1/dialog-debug", ["$-debug", "arale/overlay/0.9.12/mask-debug", "arale/overlay/0.9.12/overlay-debug", "arale/position/1.0.0/position-debug", "arale/iframe-shim/1.0.0/iframe-shim-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug", "arale/dialog/0.9.1/confirm-box-debug", "arale/dialog/0.9.1/anim-dialog-debug", "arale/dialog/0.9.1/base-dialog-debug", "arale/easing/1.0.0/easing-debug", "arale/widget/1.0.2/templatable-debug", "gallery/handlebars/1.0.0/handlebars-debug"], function(require, exports, module) {
  var $ = require('$-debug'),
    mask = require('arale/overlay/0.9.12/mask-debug'),
    ConfirmBox = require('arale/dialog/0.9.1/confirm-box-debug');

  var EVENT_NS = '.dialog-events-';

  mask.set('className', 'mask').set('opacity', 0.5).set('backgroundColor', 'rgb(204, 204, 204)');

  var Dialog = ConfirmBox.extend({
    attrs: {
      template: '<div class="dialog" style="left:50px;top:150px;"> {{#if hasCloseX}}<i class="icon icon-tool icon-tool-close" data-role="close"></i>{{/if}} {{#if hasTitle}} <div class="dialog-hd unselectable" data-role="head"> <span data-role="title">{{title}}</span> </div> {{/if}} <div class="dialog-bd"> {{#if icon}} <i class="icon icon-{{icon}}"></i> {{/if}} <span data-role="content">{{content}}</span> {{#if hasFoot}} <div class="dialog-toolbar" data-role="foot"> {{#if hasOk}}<button class="btn" data-role="confirm">确定</button>{{/if}} {{#if hasCancel}}<button class="btn" data-role="cancel">取消</button>{{/if}} </div> {{/if}} </div> </div>',
      width: 300
    },

    parseElement: function() {
      this.model = {
        title: this.get('title'),
        content: this.get('content'),
        icon: this.get('icon'),
        hasTitle: this.get('hasTitle'),
        hasOk: this.get('hasOk'),
        hasCancel: this.get('hasCancel'),
        hasCloseX: this.get('hasCloseX'),
        hasFoot: this.get('hasOk') || this.get('hasCancel')
      };
      //直接调用父类的父类
      ConfirmBox.superclass.parseElement.call(this);
    },

    events: {
      'mousedown [data-role=head]': 'dragStart',
      'mouseup [data-role=head]': 'dragEnd'
    },

    dragStart: function(e) {
      //鼠标左键
      if (e.which == 1) {
        //避免鼠标变为text-selection
        e.preventDefault();

        this.onDrag = true;
        this.mouseX = e.pageX;
        this.mouseY = e.pageY;
      }
    },
    drag: function(e) {
      if (this.onDrag) {
        var deltaX = e.pageX - this.mouseX;
        var deltaY = e.pageY - this.mouseY;

        var p = this.element.offset();
        var newLeft = p.left + deltaX;
        var newTop = p.top + deltaY;
        this.element.offset({
          left: newLeft,
          top: newTop
        });
        this.mouseX = e.pageX;
        this.mouseY = e.pageY;
      }
    },
    dragEnd: function(e) {
      this.onDrag = false;
    },

    setup: function() {
      Dialog.superclass.setup.call(this);

      var that = this;
      $(document).on('mousemove' + EVENT_NS + this.cid, function() {
        that.drag.apply(that, arguments);
      });
    },
    destroy: function() {
      $(document).off('mousemove' + EVENT_NS + this.cid);
      return Dialog.superclass.destroy.call(this);
    }

  });

  Dialog.alert = function(content, callback) {
    new Dialog({
      content: content,
      icon: 'info',
      hasTitle: false,
      hasCancel: false,
      hasCloseX: false,
      onConfirm: function() {
        callback && callback();
        this.hide();
      }
    }).show();
  };

  Dialog.confirm = function(content, title, confirmCb, cancelCb) {
    new Dialog({
      content: content,
      title: title || '提示',
      icon: 'question',
      hasCloseX: false,
      onConfirm: function() {
        confirmCb && confirmCb();
        this.hide();
      },
      onClose: function() {
        cancelCb && cancelCb();
      }
    }).show();
  };

  Dialog.show = function(content, callback) {
    new Dialog({
      content: content,
      hasTitle: false,
      hasOk: false,
      hasCancel: false,
      hasCloseX: true,
      onConfirm: function() {
        callback && callback();
        this.hide();
      }
    }).show();
  };

  module.exports = Dialog;

});

define("arale/overlay/0.9.12/mask-debug", ["./overlay-debug", "$-debug", "arale/position/1.0.0/position-debug", "arale/iframe-shim/1.0.0/iframe-shim-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug"], function(require, exports, module) {

    var $ = require('$-debug'),
        Overlay = require('./overlay-debug'),
        isIE6 = ($.browser || 0).msie && $.browser.version == 6.0,
        body = $(document.body),
        doc = $(document);


    // Mask
    // ----------
    // 全屏遮罩层组件

    var Mask = Overlay.extend({

        attrs: {
            width: isIE6 ? doc.outerWidth(true) : '100%',
            height: isIE6 ? doc.outerHeight(true) : '100%',

            className: 'ui-mask',
            style: {
                opacity: .2,
                backgroundColor: '#000',
                position: isIE6 ? 'absolute' : 'fixed'
            },

            align: {
                // undefined 表示相对于当前可视范围定位
                baseElement: isIE6 ? body : undefined
            }
        },

        show: function() {
            if (isIE6) {
                this.set('width', doc.outerWidth(true));
                this.set('height', doc.outerHeight(true));
            }
            return Mask.superclass.show.call(this);
        },

        setup: function() {
            // 加载 iframe 遮罩层并与 overlay 保持同步
            this._setupShim();
        },

        _onRenderBackgroundColor: function(val) {
            this.element.css('backgroundColor', val);
        },

        _onRenderOpacity: function(val) {
            this.element.css('opacity', val);
        }
    });

    // 单例
    module.exports = new Mask();

});

define("arale/overlay/0.9.12/overlay-debug", ["$-debug", "arale/position/1.0.0/position-debug", "arale/iframe-shim/1.0.0/iframe-shim-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug"], function(require, exports, module) {

    var $ = require('$-debug'),
        Position = require('arale/position/1.0.0/position-debug'),
        Shim = require('arale/iframe-shim/1.0.0/iframe-shim-debug'),
        Widget = require('arale/widget/1.0.2/widget-debug');


    // Overlay
    // -------
    // Overlay 组件的核心特点是可定位（Positionable）和可层叠（Stackable），是一切悬浮类
    // UI 组件的基类。

    var Overlay = Widget.extend({

        attrs: {
            // 基本属性
            width: '',
            height: '',
            zIndex: 99,
            visible: false,

            // 定位配置
            align: {
                // element 的定位点，默认为左上角
                selfXY: [0, 0],
                // 基准定位元素，默认为当前可视区域
                baseElement: Position.VIEWPORT,
                // 基准定位元素的定位点，默认为左上角
                baseXY: [0, 0]
            },

            // 父元素
            parentNode: document.body
        },

        show: function() {
            // 若从未渲染，则调用 render
            if (!this.rendered) {
                this.render();
            }
            this.set('visible', true);
            this._setPosition();
            return this;
        },

        hide: function() {
            this.set('visible', false);
            return this;
        },

        setup: function() {
            // 加载 iframe 遮罩层并与 overlay 保持同步
            this._setupShim();
            // 窗口resize时，重新定位浮层
            this._setupResize();
        },

        // 进行定位
        _setPosition: function(align) {
            // 不在文档流中，定位无效
            if (!isInDocument(this.element[0])) return;

            align || (align = this.get('align'));
            var isHidden = this.element.css('display') === 'none';

            // 在定位时，为避免元素高度不定，先显示出来
            if (isHidden) {
                this.element.css({ visibility: 'hidden', display: 'block' });
            }

            Position.pin({
                element: this.element,
                x: align.selfXY[0],
                y: align.selfXY[1]
            }, {
                element: align.baseElement,
                x: align.baseXY[0],
                y: align.baseXY[1]
            });

            // 定位完成后，还原
            if (isHidden) {
                this.element.css({ visibility: '', display: 'none' });
            }

            return this;
        },

        // 加载 iframe 遮罩层并与 overlay 保持同步
        _setupShim: function() {
            var shim = new Shim(this.element);
            this.after('show hide', shim.sync, shim);

            // 除了 parentNode 之外的其他属性发生变化时，都触发 shim 同步
            var attrs = Overlay.prototype.attrs;
            for (var attr in attrs) {
                if (attrs.hasOwnProperty(attr)) {
                    if (attr === 'parentNode') continue;
                    this.on('change:' + attr, shim.sync, shim);
                }
            }
        },

        // resize窗口时重新定位浮层，用这个方法收集所有浮层实例
        _setupResize: function() {
            Overlay.allOverlays.push(this);
        },
        
        // 除了 element 和 relativeElements，点击 body 后都会隐藏 element
        _blurHide: function(arr) {
            arr = arr || [];
            arr.push(this.element);
            this._relativeElements = arr;
            Overlay.blurOverlays.push(this);
        },

        // 用于 set 属性后的界面更新

        _onRenderWidth: function(val) {
            this.element.css('width', val);
        },

        _onRenderHeight: function(val) {
            this.element.css('height', val);
        },

        _onRenderZIndex: function(val) {
            this.element.css('zIndex', val);
        },

        _onRenderAlign: function(val) {
            this._setPosition(val);
        },

        _onRenderVisible: function(val) {
            this.element[val ? 'show' : 'hide']();
        }

    });

    // 绑定 blur 隐藏事件
    Overlay.blurOverlays = [];
    $(document).on('click', function(e) {
        hideBlurOverlays(e);
    });

    // 绑定 resize 重新定位事件
    var timeout;    
    Overlay.allOverlays = [];
    $(window).resize(function() {
        timeout && clearTimeout(timeout);
        timeout = setTimeout(function() {
            $(Overlay.allOverlays).each(function(i, item) {
                // 当元素隐藏时，不处理
                if(!item.get('visible')) {
                    return;
                }
                item._setPosition();
            });
        }, 80);
    });

    module.exports = Overlay;


    // Helpers
    // -------

    function isInDocument(element) {
        return $.contains(document.documentElement, element);
    }

    function hideBlurOverlays(e) {
        $(Overlay.blurOverlays).each(function(i, item) {
            // 当元素隐藏时，不处理
            if(!item.get('visible')) {
                return;
            }
            
            // 遍历 _relativeElements ，当点击的元素落在这些元素上时，不处理
            for(var i=0; i<item._relativeElements.length; i++) {
                var el = $(item._relativeElements[i])[0];
                if (el === e.target || $.contains(el, e.target)) {
                    return;
                }
            }

            // 到这里，判断触发了元素的 blur 事件，隐藏元素
            item.hide();
        });
    }

});


define("arale/position/1.0.0/position-debug", ["$-debug"], function(require, exports) {

    // Position
    // --------
    // 定位工具组件，将一个 DOM 节点相对对另一个 DOM 节点进行定位操作。
    // 代码易改，人生难得

    var Position = exports,
        VIEWPORT = { _id: 'VIEWPORT', nodeType: 1 },
        $ = require('$-debug'),
        isPinFixed = false,
        isIE6 = $.browser.msie && $.browser.version == 6.0;


    // 将目标元素相对于基准元素进行定位
    // 这是 Position 的基础方法，接收两个参数，分别描述了目标元素和基准元素的定位点
    Position.pin = function(pinObject, baseObject) {

        // 将两个参数转换成标准定位对象 { element: a, x: 0, y: 0 }
        pinObject = normalize(pinObject);
        baseObject = normalize(baseObject);

        // 设定目标元素的 position 为绝对定位
        // 若元素的初始 position 不为 absolute，会影响元素的 display、宽高等属性
        var pinElement = $(pinObject.element);

        if (pinElement.css('position') !== 'fixed' || isIE6) {
            pinElement.css('position', 'absolute');
            isPinFixed = false;
        }
        else {
            // 定位 fixed 元素的标志位，下面有特殊处理
            isPinFixed = true;
        }

        // 将位置属性归一化为数值
        // 注：必须放在上面这句 `css('position', 'absolute')` 之后，
        //    否则获取的宽高有可能不对
        posConverter(pinObject);
        posConverter(baseObject);

        var parentOffset = getParentOffset(pinElement);
        var baseOffset = baseObject.offset();

        // 计算目标元素的位置
        var top = baseOffset.top + baseObject.y -
                pinObject.y - parentOffset.top;

        var left = baseOffset.left + baseObject.x -
                pinObject.x - parentOffset.left;

        // 定位目标元素
        pinElement.css({ left: left, top: top });
    };


    // 将目标元素相对于基准元素进行居中定位
    // 接受两个参数，分别为目标元素和定位的基准元素，都是 DOM 节点类型
    Position.center = function(pinElement, baseElement) {
        Position.pin({
            element: pinElement,
            x: '50%',
            y: '50%'
        }, {
            element: baseElement,
            x: '50%',
            y: '50%'
        });
    };


    // 这是当前可视区域的伪 DOM 节点
    // 需要相对于当前可视区域定位时，可传入此对象作为 element 参数
    Position.VIEWPORT = VIEWPORT;


    // Helpers
    // -------

    // 将参数包装成标准的定位对象，形似 { element: a, x: 0, y: 0 }
    function normalize(posObject) {
        posObject = toElement(posObject) || {};

        if (posObject.nodeType) {
            posObject = { element: posObject };
        }

        var element = toElement(posObject.element) || VIEWPORT;
        if (element.nodeType !== 1) {
            throw new Error('posObject.element is invalid.');
        }

        var result = {
            element: element,
            x: posObject.x || 0,
            y: posObject.y || 0
        };

        // config 的深度克隆会替换掉 Position.VIEWPORT, 导致直接比较为 false
        var isVIEWPORT = (element === VIEWPORT || element._id === 'VIEWPORT');

        // 归一化 offset
        result.offset = function() {
            // 若定位 fixed 元素，则父元素的 offset 没有意义
            if (isPinFixed) {
                return {
                    left: 0,
                    top: 0
                };
            }
            else if (isVIEWPORT) {
                return {
                    left: $(document).scrollLeft(),
                    top: $(document).scrollTop()
                };
            }
            else {
                return $(element).offset();
            }
        };

        // 归一化 size, 含 padding 和 border
        result.size = function() {
            var el = isVIEWPORT ? $(window) : $(element);
            return {
                width: el.outerWidth(),
                height: el.outerHeight()
            };
        };

        return result;
    }

    // 对 x, y 两个参数为 left|center|right|%|px 时的处理，全部处理为纯数字
    function posConverter(pinObject) {
        pinObject.x = xyConverter(pinObject.x, pinObject, 'width');
        pinObject.y = xyConverter(pinObject.y, pinObject, 'height');
    }

    // 处理 x, y 值，都转化为数字
    function xyConverter(x, pinObject, type) {
        // 先转成字符串再说！好处理
        x = x + '';

        // 处理 px
        x = x.replace(/px/gi, '');

        // 处理 alias
        if (/\D/.test(x)) {
            x = x.replace(/(?:top|left)/gi, '0%')
                 .replace(/center/gi, '50%')
                 .replace(/(?:bottom|right)/gi, '100%');
        }

        // 将百分比转为像素值
        if (x.indexOf('%') !== -1) {
            //支持小数
            x = x.replace(/(\d+(?:\.\d+)?)%/gi, function(m, d) {
                return pinObject.size()[type] * (d / 100.0);
            });
        }

        // 处理类似 100%+20px 的情况
        if (/[+\-*\/]/.test(x)) {
            try {
                // eval 会影响压缩
                // new Function 方法效率高于 for 循环拆字符串的方法
                // 参照：http://jsperf.com/eval-newfunction-for
                x = (new Function('return ' + x))();
            } catch (e) {
                throw new Error('Invalid position value: ' + x);
            }
        }

        // 转回为数字
        return numberize(x);
    }

    // 获取 offsetParent 的位置
    function getParentOffset(element) {
        var parent = element.offsetParent();

        if (parent[0] === document.documentElement) {
            parent = $(document.body);
        }

        // 修正 ie6 下 absolute 定位不准的 bug
        if (isIE6) {
            parent.css('zoom', 1);
        }

        // 获取 offsetParent 的 offset
        // 注1：document.body 会默认带 8 像素的偏差
        //
        // 注2：IE7 下，body 子节点的 offsetParent 为 html 元素，其 offset 为
        // { top: 2, left: 2 }，会导致定位差 2 像素，所以这里将 parent
        // 转为 document.body
        //
        // 以上两种情况直接赋为 0
        var offset = (parent[0] === document.body) ?
            { left: 0, top: 0 } : parent.offset();

        // 根据基准元素 offsetParent 的 border 宽度，来修正 offsetParent 的基准位置
        offset.top += numberize(parent.css('border-top-width'));
        offset.left += numberize(parent.css('border-left-width'));

        return offset;
    }

    function numberize(s) {
        return parseFloat(s, 10) || 0;
    }

    function toElement(element) {
        return $(element)[0];
    }

});

define("arale/iframe-shim/1.0.0/iframe-shim-debug", ["$-debug", "arale/position/1.0.0/position-debug"], function(require, exports, module) {

    var $ = require('$-debug');
    var Position = require('arale/position/1.0.0/position-debug');


    // target 是需要添加垫片的目标元素，可以传 `DOM Element` 或 `Selector`
    function Shim(target) {
        // 如果选择器选了多个 DOM，则只取第一个
        this.target = $(target).eq(0);
    }


    // 根据目标元素计算 iframe 的显隐、宽高、定位
    Shim.prototype.sync = function() {
        var target = this.target;
        var iframe = this.iframe;

        // 如果未传 target 则不处理
        if (!target.length) return this;

        var height = target.outerHeight();
        var width = target.outerWidth();

        // 如果目标元素隐藏，则 iframe 也隐藏
        // jquery 判断宽高同时为 0 才算隐藏，这里判断宽高其中一个为 0 就隐藏
        // http://api.jquery.com/hidden-selector/
        if (!height || !width || target.is(':hidden')) {
            iframe && iframe.hide();
        } else {
            // 第一次显示时才创建：as lazy as possible
            iframe || (iframe = this.iframe = createIframe(target));

            iframe.css({
                'height': height,
                'width': width
            });

            Position.pin(iframe[0], target[0]);
            iframe.show();
        }

        return this;
    };


    // 销毁 iframe 等
    Shim.prototype.destroy = function() {
        if (this.iframe) {
            this.iframe.remove();
            delete this.iframe;
        }
        delete this.target;
    };


    if ($.browser.msie && $.browser.version == 6.0) {
        module.exports = Shim;
    } else {
        // 除了 IE6 都返回空函数
        function Noop() {
        }

        Noop.prototype.sync = Noop;
        Noop.prototype.destroy = Noop;

        module.exports = Noop;
    }


    // Helpers

    // 在 target 之前创建 iframe，这样就没有 z-index 问题
    // iframe 永远在 target 下方
    function createIframe(target) {
        return $('<iframe>', {
            src: 'javascript:\'\'', // 不加的话，https 下会弹警告
            frameborder: 0,
            css: {
                display: 'none',
                border: 'none',
                opacity: 0,
                position: 'absolute'
            }
        }).insertBefore(target);
    }

});

define("arale/dialog/0.9.1/confirm-box-debug", ["./anim-dialog-debug", "./base-dialog-debug", "$-debug", "arale/overlay/0.9.12/overlay-debug", "arale/position/1.0.0/position-debug", "arale/iframe-shim/1.0.0/iframe-shim-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug", "arale/easing/1.0.0/easing-debug", "arale/overlay/0.9.12/mask-debug", "arale/widget/1.0.2/templatable-debug", "gallery/handlebars/1.0.0/handlebars-debug"], function(require, exports, module) {

    var $ = require('$-debug'),
        AnimDialog = require('./anim-dialog-debug'),
        Templatable = require('arale/widget/1.0.2/templatable-debug');

    // ConfirmBox
    // -------
    // ConfirmBox 是一个有基础模板和样式的对话框组件。

    var ConfirmBox = AnimDialog.extend({

        Implements: Templatable,

        attrs: {

            // 默认模板，不要覆盖
            template: '<div class="ui-xbox"> <div class="ui-xbox-action"> {{#if hasCloseX}}<a href="javascript:;" class="ui-xbox-close" data-role="close" title="关闭">×</a>{{/if}} </div> <div class="ui-xbox-content"> <div class="ui-confirmXbox"> {{#if hasTitle}} <div class="ui-confirmXbox-title sl-linear-light" data-role="head"> <h2 data-role="title">{{title}}</h2> </div> {{/if}} <div class="ui-confirmXbox-container"> <div class="ui-confirmXbox-content" data-role="content">{{content}}</div> {{#if hasFoot}}        <div class="ui-confirmXbox-operation" data-role="foot"> {{#if hasOk}} <div class="ui-button ui-button-sorange ui-confirmXbox-confirm" data-role="confirm"> <a href="javascript:;" class="ui-button-text">确定</a> </div> {{/if}} {{#if hasCancel}} <div class="ui-button ui-button-swhite ui-confirmXbox-cancel" data-role="cancel"> <a href="javascript:;" class="ui-button-text">取消</a> </div> {{/if}} </div> {{/if}} </div> </div> </div> </div>',        
            // 指定标题内容
            title: '默认标题',
            // 指定内容的 html
            content: '默认内容',

            width: 500,
            hasMask: true,
            effect: null,

            align: {
                selfXY: ['50%', '50%'],
                baseXY: ['50%', '38%']
            },

            hasTitle: true,
            hasOk: true,
            hasCancel: true,            
            hasCloseX: true
        },

        parseElement: function() {
            this.model = {
                title: this.get('title'),
                content: this.get('content'),
                hasTitle: this.get('hasTitle'),
                hasOk: this.get('hasOk'),
                hasCancel: this.get('hasCancel'),
                hasCloseX: this.get('hasCloseX'),
                hasFoot: this.get('hasOk') || this.get('hasCancel')
            }
            AnimDialog.superclass.parseElement.call(this);
        }

    });

    ConfirmBox.alert = function(content, callback) {
        new ConfirmBox({
            content: content,
            hasTitle: false,
            hasCancel: false,
            hasCloseX: false,
            onConfirm: function() {
                callback && callback();
                this.hide();
            }
        }).show();
    };

    ConfirmBox.confirm = function(content, title, confirmCb, cancelCb) {
        new ConfirmBox({
            content: content,
            title: title || '确认框',
            hasCloseX: false,
            onConfirm: function() {
                confirmCb && confirmCb();
                this.hide();
            },
            onClose: function() {
                cancelCb && cancelCb();            
            }
        }).show();
    };

    ConfirmBox.show = function(content, callback) {
        new ConfirmBox({
            content: content,
            hasTitle: false,
            hasOk: false,            
            hasCancel: false,
            hasCloseX: true,
            onConfirm: function() {
                callback && callback();
                this.hide();
            }
        }).show();
    };

    module.exports = ConfirmBox;

});


define("arale/dialog/0.9.1/anim-dialog-debug", ["./base-dialog-debug", "$-debug", "arale/overlay/0.9.12/overlay-debug", "arale/position/1.0.0/position-debug", "arale/iframe-shim/1.0.0/iframe-shim-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug", "arale/easing/1.0.0/easing-debug", "arale/overlay/0.9.12/mask-debug"], function(require, exports, module) {

    var $ = require('$-debug'),
        Overlay = require('arale/overlay/0.9.12/overlay-debug'),
        easing = require('arale/easing/1.0.0/easing-debug'),
        BaseDialog = require('./base-dialog-debug');

    // AnimDialog
    // -------
    // AnimDialog 组件继承自 Dialog 组件，提供了显隐的基本动画。

    var AnimDialog = BaseDialog.extend({

        attrs: {
            effect: {
                type: 'fade',
                duration: 400,      // 动画时长
                easing: 'easeOut',  // 平滑函数
                from: 'up'          // 方向 up|down|left|right
            },
            // 显示的动画效果，若未指定则采用 effect
            showEffect: {},
            // 隐藏时的动画效果，若未指定则采用 effect
            hideEffect: {}
        },

        show: function() {
            AnimDialog.superclass.show.call(this);
            this.element.hide();
            
            var elem = this.element,
                that = this,
                ef = this.get('showEffect');

            ef = $.extend(null, this.get('effect'), ef);

            if (ef.type == null) {
                ef = { type: 'none' };
            }

            // 无动画
            if (ef.type === 'none') {
                elem.show().focus();
            }
            // 淡入淡出
            else if (ef.type === 'fade') {
                elem.hide().fadeIn(ef.duration, ef.easing).focus();
            }
            // 滑动
            else if (ef.type === 'slide') {
                var properties = /left|right/i.test(ef.from)
                        ? { width: 'toggle' } 
                        : { height: 'toggle' };
                elem.hide().animate(properties, {
                    duration: ef.duration,
                    easing: ef.easing
                }).focus();
            }
            // 移动
            else if (ef.type === 'move') {
                // 避免当 elem.focus() 时的一个诡异的定位 bug
                // http://jsfiddle.net/ukKfH/1/
                elem.removeAttr('tabindex');
                elem.blur();
                
                // 确保目标元素为 block 对象，以便创建窗口层
                elem.css({ display:'block' });
                
                // 得到窗口层
                createLayer.call(this, elem);

                var width = this._layer.get('width'),
                    height = this._layer.get('height'),
                    properties;

                // 位置和显示前的准备
                elem.appendTo(this._layer.element).css({
                    top: 0,
                    left: 0,
                    display: 'block'
                });
                
                if (ef.from === 'left') {
                    elem.css('left', 0-width);
                    properties = { left: '+=' + width };
                }
                else if (ef.from === 'right') {
                    elem.css('left', width);    
                    properties = { left: '-=' + width };                    
                }
                else if (ef.from === 'up') {
                    elem.css('top', 0-height);
                    properties = { top: '+=' + height };                    
                }
                else if (ef.from === 'down') {
                    elem.css('top', height);
                    properties = { top: '-=' + height };                    
                }

                elem.animate(properties, {
                    duration: ef.duration,
                    easing: ef.easing,
                    complete: function() {
                        // 这里要复原因为 move 而造成的文档变化
                        // 真恶心
                        that.element.appendTo(document.body);
                        that.set('align', that.get('align'));
                        that.set('visible', 'true');                        
                        that._layer.hide();
                        
                        // 重新 focus
                        elem.attr('tabindex', '-1');
                        elem.focus();
                    }
                });
            }

            return this;
        },

        hide: function() {
            AnimDialog.superclass.hide.call(this);
            this.element.show();

            var elem = this.element,
                that = this,
                ef = this.get('hideEffect');

            ef = $.extend(null, this.get('effect'), ef);

            if (ef.type == null) {
                ef = { type: 'none' };
            }

            // 无动画
            if (!ef || ef.type === 'none') {
                elem.hide();
            }
            // 淡入淡出
            else if (ef.type === 'fade') {
                elem.fadeOut(ef.duration, ef.easing);
            }
            // 滑动
            else if (ef.type === 'slide') {
                var properties = /left|right/i.test(ef.from)
                        ? { width: 'toggle' } 
                        : { height: 'toggle' };
                elem.animate(properties, {
                    duration: ef.duration,
                    easing: ef.easing
                });
            }
            // 移动
            else if (ef.type === 'move') {
                // 如果已经隐藏，则不重复调用
                if (elem.css('display') === 'none') {
                    return;
                }
                // 得到窗口层
                createLayer.call(this, elem);
                
                var width = this._layer.get('width'),
                    height = this._layer.get('height'),
                    properties;

                // 位置和显示前的准备
                elem.appendTo(this._layer.element).css({
                    top: 0,
                    left: 0,
                    display: 'block'
                });

                if (ef.from === 'left') {
                    properties = { left: '-=' + width };
                }
                else if (ef.from === 'right') {
                    properties = { left: '+=' + width };
                }
                else if (ef.from === 'up') {
                    properties = { top: '-=' + height };
                }
                else if (ef.from === 'down') {
                    properties = { top: '+=' + height };
                }

                elem.animate(properties, {
                    duration: ef.duration,
                    easing: ef.easing,
                    complete: function() {
                        elem.appendTo(document.body);
                        that.set('align', that.get('align'));
                        elem.hide();
                        that.set('visible', false);
                        that._layer.hide();
                    }
                });
            }

            return this;
        }

    });

    module.exports = AnimDialog;

    // Helpers
    // -------

    // 准备好窗口层
    function createLayer(elem) {
        if (!this._layer) {
            this._layer = new Overlay({
                width: elem.outerWidth(true),
                height: elem.outerHeight(true),
                zIndex: 100,
                visible: true,
                style: {
                    overflow: 'hidden'
                },
                align: {
                    baseElement: elem[0]
                }
            });
        }
        this._layer.set('align', this._layer.get('align')).show();
    }

});


define("arale/dialog/0.9.1/base-dialog-debug", ["$-debug", "arale/overlay/0.9.12/overlay-debug", "arale/position/1.0.0/position-debug", "arale/iframe-shim/1.0.0/iframe-shim-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug", "arale/overlay/0.9.12/mask-debug"], function(require, exports, module) {

    var $ = require('$-debug'),
        Overlay = require('arale/overlay/0.9.12/overlay-debug'),
        mask = require('arale/overlay/0.9.12/mask-debug'),
        Events = require('arale/events/1.0.0/events-debug'),
        
        TRIGGER_EVENT_NS = '.trigger-events-';


    // BaseDialog
    // -------
    // BaseDialog 是通用对话框组件，提供确定、取消、关闭、标题设置、内容区域自定义功能。
    // 是所有对话框类型组件的基类。

    var BaseDialog = Overlay.extend({

        attrs: {
            // 对话框触发点
            trigger: null,

            // 对话框触发方式
            triggerType: 'click',

            // 不用解释了吧
            zIndex: 999,

            // 指定标题内容
            title: '',

            // 指定内容元素
            content: '',

            // 是否有背景遮罩层
            hasMask: false,

            // 点击确定时触发的函数，供覆盖
            onConfirm: function() {},

            // 点击取消或关闭时触发的函数，供覆盖
            onClose: function() {}
        },

        parseElement: function() {
            BaseDialog.superclass.parseElement.call(this);

            // 绑定额外的 dom 元素
            this.set('trigger', $(this.get('trigger')));
            this.set('titleElement', this.$('[data-role=title]'));
            this.set('contentElement', this.$('[data-role=content]'));
        },

        events: {
            'click [data-role=confirm]' : 'confirm',
            'click [data-role=cancel]' : 'close',
            'click [data-role=close]' : 'close'
        },

        confirm: function() {
            this.trigger('confirm');
        },

        close: function() {
            this.trigger('close');
            this.hide();
            // 关于网页中浮层消失后的焦点处理
            // http://www.qt06.com/post/280/
            this.activeTrigger && this.activeTrigger.focus();
        },

        show: function() {
            BaseDialog.superclass.show.call(this);
            
            // 处理动态绑定的 content 和 title
            if (this._contentFunction) {
                this.get('contentElement').html(this._contentFunction.call(this));                
            }
            if (this._titleFunction) {
                this.get('titleElement').html(this._titleFunction.call(this));                
            }

            this.element.focus();
            return this;
        },

        destroy: function() {
            this.get('trigger').off(this.get('triggerType') + TRIGGER_EVENT_NS + this.cid);
            return BaseDialog.superclass.destroy.call(this);
        },

        setup: function() {
            BaseDialog.superclass.setup.call(this);

            this._setupTrigger();
            this._setupMask();
            this._setupKeyEvents();
            toTabed(this.element);
            toTabed(this.get('trigger'));
        },

        // 绑定触发对话框出现的事件
        _setupTrigger: function() {
            var that = this;
            this.get('trigger').on(this.get('triggerType') + TRIGGER_EVENT_NS + this.cid, function(e) {
                e.preventDefault();
                // 标识当前点击的元素
                that.activeTrigger = $(this);
                that.show();
            });
        },

        // 绑定遮罩层事件
        _setupMask: function() {
            this.before('show', function() {
                this.get('hasMask') && mask.show();
            });
            this.before('hide', function() {
                this.get('hasMask') && mask.hide();
            });
        },

        // 绑定键盘事件，ESC关闭窗口
        _setupKeyEvents: function() {
            this.delegateEvents('keyup', function(e) {
                if (e.keyCode === 27) {
                    this.close();
                }
            });
        },

        _onRenderTitle: function(val) {
            if($.isFunction(val)) {
                this._titleFunction = val;
            }
            else {
                this._titleFunction = null;                
                this.get('titleElement').html(val);
            }
        },

        _onRenderContent: function(val) {
            if($.isFunction(val)) {
                this._contentFunction = val;
            }
            else {
                this._contentFunction = null;
                this.get('contentElement').html(val);
            }
        }

    });

    module.exports = BaseDialog;

    // Helpers
    // ----

    function toTabed(element) {
        if(element.attr('tabindex') == null) {
            element.attr('tabindex', '-1');
        }
    }

});


define("arale/widget/1.0.2/templatable-debug", ["$-debug", "gallery/handlebars/1.0.0/handlebars-debug"], function(require, exports, module) {

  var $ = require('$-debug')
  var Handlebars = require('gallery/handlebars/1.0.0/handlebars-debug')


  // 提供 Template 模板支持，默认引擎是 Handlebars
  module.exports = {

    // Handlebars 的 helpers
    templateHelpers: null,

    // template 对应的 DOM-like object
    templateObject: null,

    // 根据配置的模板和传入的数据，构建 this.element 和 templateElement
    parseElementFromTemplate: function() {
      this.templateObject = convertTemplateToObject(this.template)
      this.element = $(this.compile())
    },

    // 编译模板，混入数据，返回 html 结果
    compile: function(template, model) {
      template || (template = this.template)

      model || (model = this.model)
      if (model.toJSON) {
        model = model.toJSON()
      }

      var helpers = this.templateHelpers

      // 注册 helpers
      if (helpers) {
        for (var name in helpers) {
          if (helpers.hasOwnProperty(name)) {
            Handlebars.registerHelper(name, helpers[name])
          }
        }
      }

      // 生成 html
      var html = Handlebars.compile(template)(model)

      // 卸载 helpers
      if (helpers) {
        for (name in helpers) {
          if (helpers.hasOwnProperty(name)) {
            delete Handlebars.helpers[name]
          }
        }
      }

      return html
    },

    // 刷新 selector 指定的局部区域
    renderPartial: function(selector) {
      var template = convertObjectToTemplate(this.templateObject, selector)
      this.$(selector).html(this.compile(template))
      return this
    }
  }


  // Helpers
  // -------

  // 将 template 字符串转换成对应的 DOM-like object
  function convertTemplateToObject(template) {
    return $(encode(template))
  }

  // 根据 selector 得到 DOM-like template object，并转换为 template 字符串
  function convertObjectToTemplate(templateObject, selector) {
    var element = templateObject.find(selector)
    if (element.length === 0) {
      throw new Error('Invalid template selector: ' + selector)
    }

    return decode(element.html())
  }

  function encode(template) {
    return template
        // 替换 {{xxx}} 为 <!-- {{xxx}} -->
        .replace(/({[^}]+}})/g, '<!--$1-->')
        // 替换 src="{{xxx}}" 为 data-TEMPLATABLE-src="{{xxx}}"
        .replace(/\s(src|href)\s*=\s*(['"])(.*?\{.+?)\2/g,
        ' data-templatable-$1=$2$3$2')
  }

  function decode(template) {
    return template
        .replace(/(?:<|&lt;)!--({{[^}]+}})--(?:>|&gt;)/g, '$1')
        .replace(/data-templatable-/ig, '')
  }

});

// 调用 renderPartial 时，Templatable 对模板有一个约束：
// ** template 自身必须是有效的 html 代码片段**，比如
//   1. 代码闭合
//   2. 嵌套符合规范
//
// 总之，要保证在 template 里，将 `{{...}}` 转换成注释后，直接 innerHTML 插入到
// DOM 中，浏览器不会自动增加一些东西。比如：
//
// tbody 里没有 tr：
//  `<table><tbody>{{#each items}}<td>{{this}}</td>{{/each}}</tbody></table>`
//
// 标签不闭合：
//  `<div><span>{{name}}</div>`

define("kjui/grid/0.0.1/grid-debug", ["$-debug", "gallery/underscore/1.4.2/underscore-debug", "gallery/handlebars/1.0.0/handlebars-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug"], function(require, exports, module) {
  var $ = require('$-debug'),
    _ = require('gallery/underscore/1.4.2/underscore-debug'),
    handlebars = require('gallery/handlebars/1.0.0/handlebars-debug'),
    Widget = require('arale/widget/1.0.2/widget-debug');

  var tpl = '<div class="mod" style="width:{{width}}px;"> {{#if title}} <div class="hd unselectable"> <span class="hd-title">{{title}}</span> </div> {{/if}} <div class="bd"><div class="grid-hd unselectable"> <table><thead><tr> {{#each fields}} <th class="grid-cell" data-name="{{name}}" width="{{width}}"> <span>{{header}}</span> </th> {{/each}} </tr></thead></table> </div><div class="grid-bd"{{#if height}} style="height:{{height}}px"{{/if}}> <table><tbody> {{#each records}} <tr class="grid-row{{#if isAlt}} grid-row-alt{{/if}}" data-id="{{id}}"> {{#each values}} <td class="grid-cell" width="{{width}}"{{#if align}} style="text-align:{{align}};"{{/if}}>{{{value}}}</td> {{/each}} </tr> {{/each}} </tbody></table> </div><div class="toolbar toolbar-ft"> <span class="toolbar-text toolbar-text-right">共{{totalCount}}条记录，每页{{pageSize}}条</span> <i class="icon icon-btn {{#if isFirst}}icon-btn-is-disabled icon-grid-page-first-disabled{{else}}icon-grid-page-first{{/if}}" data-role="first"></i> <i class="icon icon-btn {{#if hasPrev}}icon-grid-page-prev{{else}}icon-btn-is-disabled icon-grid-page-prev-disabled{{/if}}" data-role="prev"></i> <i class="toolbar-separator"></i> <span class="toolbar-text">当前第</span> <input style="width:40px;" type="text" data-role="num"> <span class="toolbar-text">/10页</span> <i class="toolbar-separator"></i> <i class="icon icon-btn {{#if hasNext}}icon-grid-page-next{{else}}icon-btn-is-disabled icon-grid-page-next-disabled{{/if}}" data-role="next"></i> <i class="icon icon-btn {{#if isLast}}icon-btn-is-disabled icon-grid-page-last-disabled{{else}}icon-grid-page-last{{/if}}" data-role="last"></i> <i class="toolbar-separator"></i> <i class="icon icon-btn icon-grid-refresh" data-role="refresh"></i> </div> </div> </div>';

  var Grid = Widget.extend({
    attrs: {
      title: '',
      url: '',
      urlParser: null,
      data: [],
      fields: [],
      width: 0,
      height: 0
    },

    _onRenderUrl: function(url) {
      var self = this;
      $.getJSON(url, function(data) {
        self._createGrid(data.data);
      });
    },
    _onRenderData: function(data) {
      this._createGrid(data);
    },

    _createGrid: function(data) {
      this.data = data;

      var gridWidth = this.get('width') || this.element.parent().width();
      var fields = this._processField(gridWidth);
      var records = $.map(data.result, function(record, index) {
        return {
          isAlt: index % 2 === 1,
          id: record.id,
          values: $.map(fields, function(field) {
            var value = record[field.name];
            value = _.escape(value);

            if ($.isFunction(field.render)) {
              value = field.render(value);
            }

            return {
              width: field.width,
              align: field.align,
              value: value
            };
          })
        };
      });

      var gridHeight = this.get('height');
      var html = handlebars.compile(tpl)({
        width: gridWidth,
        title: this.get('title'),
        height: gridHeight,
        fields: fields,
        records: records,
        isFirst: function() {
          return data.pageNumber <= 1;
        },
        isLast: function() {
          return data.totalPages === 0 || data.pageNumber === data.totalPages;
        },
        hasPrev: data.hasPrev,
        hasNext: data.hasNext,
        totalCount: data.totalCount,
        pageSize: data.pageSize
      });
      this.element.html(html);

      if (!gridHeight) {
        gridHeight = this.element.height() - this.$('.grid-bd').position().top - this.$('.toolbar-ft').outerHeight() - 1;
        this.$('.grid-bd').height(gridHeight);
      }

      this.$('[data-role=num]').val(data.pageNumber);

      //disabled button will not be clicked
      this.$('.icon-btn').click(function(e) {
        if ($(this).hasClass('icon-btn-is-disabled')) {
          e.stopImmediatePropagation();
        }
      });
    },
    _processField: function(gridWidth) {
      var fields = this.get('fields');

      var totalWidth = 0,
        totalNum = 0;
      $.each(fields, function() {
        if (this.width) {
          totalWidth += this.width;
          totalNum += 1;
        }
      });

      var averageWidth = (gridWidth - fields.length * 9 - totalWidth - 18) / (fields.length - totalNum);

      fields = $.map(fields, function(field) {
        if (!field.width) {
          field.width = averageWidth;
        }
        return field;
      });
      return fields;
    },

    events: {
      'click .grid-hd': '_sort',
      'click .grid-row': '_click',
      'click [data-role=prev]': 'prevPage',
      'click [data-role=next]': 'nextPage',
      'click [data-role=first]': 'firstPage',
      'click [data-role=last]': 'lastPage',
      'click [data-role=refresh]': 'refresh',
      'keyup [data-role=num]': '_gotoPage'
    },

    _sort: function(e) {
      var cell = $(e.target).closest('th');
      var name = cell.attr('data-name');

      //只能按照单独的列排序
      if (!this._oldSortHeader) {
        this._oldSortHeader = cell;
      } else {
        if (this._oldSortHeader.attr('data-name') !== name) {
          this._oldSortHeader.removeClass('grid-is-desc grid-is-asc');
          this._oldSortHeader = cell;
        }
      }

      if (cell.hasClass('grid-is-desc')) {
        cell.removeClass('grid-is-desc').addClass('grid-is-asc');
        this.trigger('sort', name, 'asc');
      } else {
        cell.removeClass('grid-is-asc').addClass('grid-is-desc');
        this.trigger('sort', name, 'desc');
      }
    },

    _click: function(e) {
      var target = $(e.target);
      var row = target.parents('tr');

      var id = row.attr('data-id');
      var data = _.find(this.data.result, function(record) {
        return record.id == id;
      });
      this.trigger('click', target, data);
    },

    _gotoPage: function(e) {
      var $input = $(e.target);
      var value = $input.val();

      if (value && e.which == 13) {
        this.gotoPage(value);
      } else {
        value = value.replace(/\D/g, '');
        if (value) {
          value = parseInt(value, 10);

          var totalPages = this.data.totalPages;
          if (value > totalPages) {
            value = totalPages;
          } else if (value === 0) {
            value = 1;
          }
          $input.val(value);
        } else {
          $input.val('');
        }
      }
    },

    //public method
    gotoPage: function(id) {
      var r = this.get('urlParser');
      var url = this.get('url').replace(r, '$1' + id + '$2');
      this.set('url', url);
    },
    prevPage: function() {
      var id = this.data.prevPage;
      this.gotoPage(id);
    },
    nextPage: function() {
      var id = this.data.nextPage;
      this.gotoPage(id);
    },
    firstPage: function() {
      var id = this.data.firstPage;
      this.gotoPage(id);
    },
    lastPage: function() {
      var id = this.data.lastPage;
      this.gotoPage(id);
    },
    refresh: function() {
      //刷新往往不会改变url
      var url = this.get('url');
      this._onRenderUrl(url);
    }

  });

  module.exports = Grid;

});

define('gallery/underscore/1.4.2/underscore-debug', [], function(require, exports, module) {

//     Underscore.js 1.4.2
//     http://underscorejs.org
//     (c) 2009-2012 Jeremy Ashkenas, DocumentCloud Inc.
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `global` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Establish the object that gets returned to break out of a loop iteration.
  var breaker = {};

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var push             = ArrayProto.push,
      slice            = ArrayProto.slice,
      concat           = ArrayProto.concat,
      unshift          = ArrayProto.unshift,
      toString         = ObjProto.toString,
      hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeForEach      = ArrayProto.forEach,
    nativeMap          = ArrayProto.map,
    nativeReduce       = ArrayProto.reduce,
    nativeReduceRight  = ArrayProto.reduceRight,
    nativeFilter       = ArrayProto.filter,
    nativeEvery        = ArrayProto.every,
    nativeSome         = ArrayProto.some,
    nativeIndexOf      = ArrayProto.indexOf,
    nativeLastIndexOf  = ArrayProto.lastIndexOf,
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object via a string identifier,
  // for Closure Compiler "advanced" mode.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root['_'] = _;
  }

  // Current version.
  _.VERSION = '1.4.2';

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles objects with the built-in `forEach`, arrays, and raw objects.
  // Delegates to **ECMAScript 5**'s native `forEach` if available.
  var each = _.each = _.forEach = function(obj, iterator, context) {
    if (obj == null) return;
    if (nativeForEach && obj.forEach === nativeForEach) {
      obj.forEach(iterator, context);
    } else if (obj.length === +obj.length) {
      for (var i = 0, l = obj.length; i < l; i++) {
        if (iterator.call(context, obj[i], i, obj) === breaker) return;
      }
    } else {
      for (var key in obj) {
        if (_.has(obj, key)) {
          if (iterator.call(context, obj[key], key, obj) === breaker) return;
        }
      }
    }
  };

  // Return the results of applying the iterator to each element.
  // Delegates to **ECMAScript 5**'s native `map` if available.
  _.map = _.collect = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeMap && obj.map === nativeMap) return obj.map(iterator, context);
    each(obj, function(value, index, list) {
      results[results.length] = iterator.call(context, value, index, list);
    });
    return results;
  };

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`. Delegates to **ECMAScript 5**'s native `reduce` if available.
  _.reduce = _.foldl = _.inject = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduce && obj.reduce === nativeReduce) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduce(iterator, memo) : obj.reduce(iterator);
    }
    each(obj, function(value, index, list) {
      if (!initial) {
        memo = value;
        initial = true;
      } else {
        memo = iterator.call(context, memo, value, index, list);
      }
    });
    if (!initial) throw new TypeError('Reduce of empty array with no initial value');
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  // Delegates to **ECMAScript 5**'s native `reduceRight` if available.
  _.reduceRight = _.foldr = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduceRight && obj.reduceRight === nativeReduceRight) {
      if (context) iterator = _.bind(iterator, context);
      return arguments.length > 2 ? obj.reduceRight(iterator, memo) : obj.reduceRight(iterator);
    }
    var length = obj.length;
    if (length !== +length) {
      var keys = _.keys(obj);
      length = keys.length;
    }
    each(obj, function(value, index, list) {
      index = keys ? keys[--length] : --length;
      if (!initial) {
        memo = obj[index];
        initial = true;
      } else {
        memo = iterator.call(context, memo, obj[index], index, list);
      }
    });
    if (!initial) throw new TypeError('Reduce of empty array with no initial value');
    return memo;
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, iterator, context) {
    var result;
    any(obj, function(value, index, list) {
      if (iterator.call(context, value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Delegates to **ECMAScript 5**'s native `filter` if available.
  // Aliased as `select`.
  _.filter = _.select = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeFilter && obj.filter === nativeFilter) return obj.filter(iterator, context);
    each(obj, function(value, index, list) {
      if (iterator.call(context, value, index, list)) results[results.length] = value;
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    each(obj, function(value, index, list) {
      if (!iterator.call(context, value, index, list)) results[results.length] = value;
    });
    return results;
  };

  // Determine whether all of the elements match a truth test.
  // Delegates to **ECMAScript 5**'s native `every` if available.
  // Aliased as `all`.
  _.every = _.all = function(obj, iterator, context) {
    iterator || (iterator = _.identity);
    var result = true;
    if (obj == null) return result;
    if (nativeEvery && obj.every === nativeEvery) return obj.every(iterator, context);
    each(obj, function(value, index, list) {
      if (!(result = result && iterator.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if at least one element in the object matches a truth test.
  // Delegates to **ECMAScript 5**'s native `some` if available.
  // Aliased as `any`.
  var any = _.some = _.any = function(obj, iterator, context) {
    iterator || (iterator = _.identity);
    var result = false;
    if (obj == null) return result;
    if (nativeSome && obj.some === nativeSome) return obj.some(iterator, context);
    each(obj, function(value, index, list) {
      if (result || (result = iterator.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `include`.
  _.contains = _.include = function(obj, target) {
    var found = false;
    if (obj == null) return found;
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) return obj.indexOf(target) != -1;
    found = any(obj, function(value) {
      return value === target;
    });
    return found;
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    return _.map(obj, function(value) {
      return (_.isFunction(method) ? method : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, function(value){ return value[key]; });
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // with specific `key:value` pairs.
  _.where = function(obj, attrs) {
    if (_.isEmpty(attrs)) return [];
    return _.filter(obj, function(value) {
      for (var key in attrs) {
        if (attrs[key] !== value[key]) return false;
      }
      return true;
    });
  };

  // Return the maximum element or (element-based computation).
  // Can't optimize arrays of integers longer than 65,535 elements.
  // See: https://bugs.webkit.org/show_bug.cgi?id=80797
  _.max = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.max.apply(Math, obj);
    }
    if (!iterator && _.isEmpty(obj)) return -Infinity;
    var result = {computed : -Infinity};
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      computed >= result.computed && (result = {value : value, computed : computed});
    });
    return result.value;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.min.apply(Math, obj);
    }
    if (!iterator && _.isEmpty(obj)) return Infinity;
    var result = {computed : Infinity};
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      computed < result.computed && (result = {value : value, computed : computed});
    });
    return result.value;
  };

  // Shuffle an array.
  _.shuffle = function(obj) {
    var rand;
    var index = 0;
    var shuffled = [];
    each(obj, function(value) {
      rand = _.random(index++);
      shuffled[index - 1] = shuffled[rand];
      shuffled[rand] = value;
    });
    return shuffled;
  };

  // An internal function to generate lookup iterators.
  var lookupIterator = function(value) {
    return _.isFunction(value) ? value : function(obj){ return obj[value]; };
  };

  // Sort the object's values by a criterion produced by an iterator.
  _.sortBy = function(obj, value, context) {
    var iterator = lookupIterator(value);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value : value,
        index : index,
        criteria : iterator.call(context, value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index < right.index ? -1 : 1;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(obj, value, context, behavior) {
    var result = {};
    var iterator = lookupIterator(value);
    each(obj, function(value, index) {
      var key = iterator.call(context, value, index, obj);
      behavior(result, key, value);
    });
    return result;
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = function(obj, value, context) {
    return group(obj, value, context, function(result, key, value) {
      (_.has(result, key) ? result[key] : (result[key] = [])).push(value);
    });
  };

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = function(obj, value, context) {
    return group(obj, value, context, function(result, key, value) {
      if (!_.has(result, key)) result[key] = 0;
      result[key]++;
    });
  };

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iterator, context) {
    iterator = iterator == null ? _.identity : lookupIterator(iterator);
    var value = iterator.call(context, obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = (low + high) >>> 1;
      iterator.call(context, array[mid]) < value ? low = mid + 1 : high = mid;
    }
    return low;
  };

  // Safely convert anything iterable into a real, live array.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (obj.length === +obj.length) return slice.call(obj);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    return (obj.length === +obj.length) ? obj.length : _.keys(obj).length;
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    return (n != null) && !guard ? slice.call(array, 0, n) : array[0];
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, array.length - ((n == null) || guard ? 1 : n));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if ((n != null) && !guard) {
      return slice.call(array, Math.max(array.length - n, 0));
    } else {
      return array[array.length - 1];
    }
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, (n == null) || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, function(value){ return !!value; });
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, output) {
    each(input, function(value) {
      if (_.isArray(value)) {
        shallow ? push.apply(output, value) : flatten(value, shallow, output);
      } else {
        output.push(value);
      }
    });
    return output;
  };

  // Return a completely flattened version of an array.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iterator, context) {
    var initial = iterator ? _.map(array, iterator, context) : array;
    var results = [];
    var seen = [];
    each(initial, function(value, index) {
      if (isSorted ? (!index || seen[seen.length - 1] !== value) : !_.contains(seen, value)) {
        seen.push(value);
        results.push(array[index]);
      }
    });
    return results;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(concat.apply(ArrayProto, arguments));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    var rest = slice.call(arguments, 1);
    return _.filter(_.uniq(array), function(item) {
      return _.every(rest, function(other) {
        return _.indexOf(other, item) >= 0;
      });
    });
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = concat.apply(ArrayProto, slice.call(arguments, 1));
    return _.filter(array, function(value){ return !_.contains(rest, value); });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    var args = slice.call(arguments);
    var length = _.max(_.pluck(args, 'length'));
    var results = new Array(length);
    for (var i = 0; i < length; i++) {
      results[i] = _.pluck(args, "" + i);
    }
    return results;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    var result = {};
    for (var i = 0, l = list.length; i < l; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // If the browser doesn't supply us with indexOf (I'm looking at you, **MSIE**),
  // we need this function. Return the position of the first occurrence of an
  // item in an array, or -1 if the item is not included in the array.
  // Delegates to **ECMAScript 5**'s native `indexOf` if available.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i = 0, l = array.length;
    if (isSorted) {
      if (typeof isSorted == 'number') {
        i = (isSorted < 0 ? Math.max(0, l + isSorted) : isSorted);
      } else {
        i = _.sortedIndex(array, item);
        return array[i] === item ? i : -1;
      }
    }
    if (nativeIndexOf && array.indexOf === nativeIndexOf) return array.indexOf(item, isSorted);
    for (; i < l; i++) if (array[i] === item) return i;
    return -1;
  };

  // Delegates to **ECMAScript 5**'s native `lastIndexOf` if available.
  _.lastIndexOf = function(array, item, from) {
    if (array == null) return -1;
    var hasIndex = from != null;
    if (nativeLastIndexOf && array.lastIndexOf === nativeLastIndexOf) {
      return hasIndex ? array.lastIndexOf(item, from) : array.lastIndexOf(item);
    }
    var i = (hasIndex ? from : array.length);
    while (i--) if (array[i] === item) return i;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = arguments[2] || 1;

    var len = Math.max(Math.ceil((stop - start) / step), 0);
    var idx = 0;
    var range = new Array(len);

    while(idx < len) {
      range[idx++] = start;
      start += step;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Binding with arguments is also known as `curry`.
  // Delegates to **ECMAScript 5**'s native `Function.bind` if available.
  // We check for `func.bind` first, to fail fast when `func` is undefined.
  _.bind = function bind(func, context) {
    var bound, args;
    if (func.bind === nativeBind && nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError;
    args = slice.call(arguments, 2);
    return bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      ctor.prototype = func.prototype;
      var self = new ctor;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (Object(result) === result) return result;
      return self;
    };
  };

  // Bind all of an object's methods to that object. Useful for ensuring that
  // all callbacks defined on an object belong to it.
  _.bindAll = function(obj) {
    var funcs = slice.call(arguments, 1);
    if (funcs.length == 0) funcs = _.functions(obj);
    each(funcs, function(f) { obj[f] = _.bind(obj[f], obj); });
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memo = {};
    hasher || (hasher = _.identity);
    return function() {
      var key = hasher.apply(this, arguments);
      return _.has(memo, key) ? memo[key] : (memo[key] = func.apply(this, arguments));
    };
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){ return func.apply(null, args); }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time.
  _.throttle = function(func, wait) {
    var context, args, timeout, throttling, more, result;
    var whenDone = _.debounce(function(){ more = throttling = false; }, wait);
    return function() {
      context = this; args = arguments;
      var later = function() {
        timeout = null;
        if (more) {
          result = func.apply(context, args);
        }
        whenDone();
      };
      if (!timeout) timeout = setTimeout(later, wait);
      if (throttling) {
        more = true;
      } else {
        throttling = true;
        result = func.apply(context, args);
      }
      whenDone();
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, result;
    return function() {
      var context = this, args = arguments;
      var later = function() {
        timeout = null;
        if (!immediate) result = func.apply(context, args);
      };
      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) result = func.apply(context, args);
      return result;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = function(func) {
    var ran = false, memo;
    return function() {
      if (ran) return memo;
      ran = true;
      memo = func.apply(this, arguments);
      func = null;
      return memo;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return function() {
      var args = [func];
      push.apply(args, arguments);
      return wrapper.apply(this, args);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var funcs = arguments;
    return function() {
      var args = arguments;
      for (var i = funcs.length - 1; i >= 0; i--) {
        args = [funcs[i].apply(this, args)];
      }
      return args[0];
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    if (times <= 0) return func();
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = nativeKeys || function(obj) {
    if (obj !== Object(obj)) throw new TypeError('Invalid object');
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys[keys.length] = key;
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var values = [];
    for (var key in obj) if (_.has(obj, key)) values.push(obj[key]);
    return values;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var pairs = [];
    for (var key in obj) if (_.has(obj, key)) pairs.push([key, obj[key]]);
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    for (var key in obj) if (_.has(obj, key)) result[obj[key]] = key;
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      for (var prop in source) {
        obj[prop] = source[prop];
      }
    });
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    each(keys, function(key) {
      if (key in obj) copy[key] = obj[key];
    });
    return copy;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    for (var key in obj) {
      if (!_.contains(keys, key)) copy[key] = obj[key];
    }
    return copy;
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      for (var prop in source) {
        if (obj[prop] == null) obj[prop] = source[prop];
      }
    });
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the Harmony `egal` proposal: http://wiki.ecmascript.org/doku.php?id=harmony:egal.
    if (a === b) return a !== 0 || 1 / a == 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className != toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, dates, and booleans are compared by value.
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return a == String(b);
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
        // other numeric values.
        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a == +b;
      // RegExps are compared by their source patterns and flags.
      case '[object RegExp]':
        return a.source == b.source &&
               a.global == b.global &&
               a.multiline == b.multiline &&
               a.ignoreCase == b.ignoreCase;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] == a) return bStack[length] == b;
    }
    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    var size = 0, result = true;
    // Recursively compare objects and arrays.
    if (className == '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size == b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          if (!(result = eq(a[size], b[size], aStack, bStack))) break;
        }
      }
    } else {
      // Objects with different constructors are not equivalent, but `Object`s
      // from different frames are.
      var aCtor = a.constructor, bCtor = b.constructor;
      if (aCtor !== bCtor && !(_.isFunction(aCtor) && (aCtor instanceof aCtor) &&
                               _.isFunction(bCtor) && (bCtor instanceof bCtor))) {
        return false;
      }
      // Deep compare objects.
      for (var key in a) {
        if (_.has(a, key)) {
          // Count the expected number of properties.
          size++;
          // Deep compare each member.
          if (!(result = _.has(b, key) && eq(a[key], b[key], aStack, bStack))) break;
        }
      }
      // Ensure that both objects contain the same number of properties.
      if (result) {
        for (key in b) {
          if (_.has(b, key) && !(size--)) break;
        }
        result = !size;
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return result;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, [], []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) == '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    return obj === Object(obj);
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp.
  each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) == '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return !!(obj && _.has(obj, 'callee'));
    };
  }

  // Optimize `isFunction` if appropriate.
  if (typeof (/./) !== 'function') {
    _.isFunction = function(obj) {
      return typeof obj === 'function';
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return _.isNumber(obj) && isFinite(obj);
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj != +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) == '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iterators.
  _.identity = function(value) {
    return value;
  };

  // Run a function **n** times.
  _.times = function(n, iterator, context) {
    for (var i = 0; i < n; i++) iterator.call(context, i);
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + (0 | Math.random() * (max - min + 1));
  };

  // List of HTML entities for escaping.
  var entityMap = {
    escape: {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;'
    }
  };
  entityMap.unescape = _.invert(entityMap.escape);

  // Regexes containing the keys and values listed immediately above.
  var entityRegexes = {
    escape:   new RegExp('[' + _.keys(entityMap.escape).join('') + ']', 'g'),
    unescape: new RegExp('(' + _.keys(entityMap.unescape).join('|') + ')', 'g')
  };

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  _.each(['escape', 'unescape'], function(method) {
    _[method] = function(string) {
      if (string == null) return '';
      return ('' + string).replace(entityRegexes[method], function(match) {
        return entityMap[method][match];
      });
    };
  });

  // If the value of the named property is a function then invoke it;
  // otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return null;
    var value = object[property];
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    each(_.functions(obj), function(name){
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result.call(this, func.apply(_, args));
      };
    });
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = idCounter++;
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\t':     't',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  _.template = function(text, data, settings) {
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = new RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset)
        .replace(escaper, function(match) { return '\\' + escapes[match]; });
      source +=
        escape ? "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'" :
        interpolate ? "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'" :
        evaluate ? "';\n" + evaluate + "\n__p+='" : '';
      index = offset + match.length;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + "return __p;\n";

    try {
      var render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    if (data) return render(data, _);
    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled function source as a convenience for precompilation.
    template.source = 'function(' + (settings.variable || 'obj') + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function, which will delegate to the wrapper.
  _.chain = function(obj) {
    return _(obj).chain();
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(obj) {
    return this._chain ? _(obj).chain() : obj;
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name == 'shift' || name == 'splice') && obj.length === 0) delete obj[0];
      return result.call(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result.call(this, method.apply(this._wrapped, arguments));
    };
  });

  _.extend(_.prototype, {

    // Start chaining a wrapped Underscore object.
    chain: function() {
      this._chain = true;
      return this;
    },

    // Extracts the result from a wrapped and chained object.
    value: function() {
      return this._wrapped;
    }

  });

}).call(this);


});

define("kj/static-demo/0.0.1/common-debug", ["$-debug", "arale/widget/1.0.2/widget-debug", "arale/base/1.0.1/base-debug", "arale/class/1.0.0/class-debug", "arale/events/1.0.0/events-debug", "kjui/accordion/0.0.1/accordion-debug", "gallery/handlebars/1.0.0/handlebars-debug", "kjui/tree/0.0.1/tree-debug", "arale/switchable/0.9.11/switchable-debug", "arale/easing/1.0.0/easing-debug", "kjui/tab/0.0.1/tab-debug", "kjui/dialog/0.0.1/dialog-debug", "arale/overlay/0.9.12/mask-debug", "arale/overlay/0.9.12/overlay-debug", "arale/position/1.0.0/position-debug", "arale/iframe-shim/1.0.0/iframe-shim-debug", "arale/dialog/0.9.1/confirm-box-debug", "arale/dialog/0.9.1/anim-dialog-debug", "arale/dialog/0.9.1/base-dialog-debug", "arale/widget/1.0.2/templatable-debug", "kjui/grid/0.0.1/grid-debug", "gallery/underscore/1.4.2/underscore-debug"], function(require, exports, module) {
  require('$-debug');
  require('arale/widget/1.0.2/widget-debug');
  require('kjui/accordion/0.0.1/accordion-debug');
  require('kjui/tab/0.0.1/tab-debug');
  require('kjui/dialog/0.0.1/dialog-debug');
  require('kjui/grid/0.0.1/grid-debug');
  require('kjui/tree/0.0.1/tree-debug');
});
