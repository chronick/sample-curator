(function () {
  "use strict";

  if (window.__AUTOMATION__) return;

  // --- Console interceptor ---
  var MAX_CONSOLE_BUFFER = 500;
  var consoleLogs = [];
  var consoleSeq = 0;

  function serializeArg(arg) {
    if (arg === undefined) return "undefined";
    if (arg === null) return "null";
    if (arg instanceof Error) return arg.stack || arg.message || String(arg);
    if (typeof arg === "object") {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (_e) {
        return String(arg);
      }
    }
    return String(arg);
  }

  function interceptConsole(level) {
    var original = console[level];
    console["_original_" + level] = original;
    console[level] = function () {
      // Call original so dev tools still work
      original.apply(console, arguments);

      var args = Array.prototype.slice.call(arguments);
      var entry = {
        seq: consoleSeq++,
        level: level,
        message: args.map(serializeArg).join(" "),
        timestamp: Date.now(),
      };

      // Store in ring buffer
      consoleLogs.push(entry);
      if (consoleLogs.length > MAX_CONSOLE_BUFFER) {
        consoleLogs.shift();
      }

      // Emit event for real-time streaming
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        window.__TAURI_INTERNALS__
          .invoke("plugin:event|emit", {
            event: "automation:console",
            payload: entry,
          })
          .catch(function () {});
      }
    };
  }

  interceptConsole("log");
  interceptConsole("warn");
  interceptConsole("error");
  interceptConsole("info");
  interceptConsole("debug");

  // --- DOM helpers ---
  function getElementInfo(el) {
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      attrs[attr.name] = attr.value;
    }
    return {
      found: true,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").slice(0, 500),
      value: el.value !== undefined ? el.value : null,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      attrs: attrs,
      visible:
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0,
    };
  }

  window.__AUTOMATION__ = {
    // Console buffer access
    getConsoleLogs: function (since, clear) {
      var result;
      if (since !== undefined && since !== null) {
        result = consoleLogs.filter(function (e) {
          return e.seq > since;
        });
      } else {
        result = consoleLogs.slice();
      }
      if (clear) {
        consoleLogs.length = 0;
      }
      return result;
    },

    clearConsoleLogs: function () {
      consoleLogs.length = 0;
      return { cleared: true };
    },

    queryElement: function (selector) {
      var el = document.querySelector(selector);
      if (!el) return { found: false };
      return getElementInfo(el);
    },

    queryAll: function (selector) {
      var els = document.querySelectorAll(selector);
      return Array.from(els).map(getElementInfo);
    },

    click: function (selector) {
      var el = document.querySelector(selector);
      if (!el) return { clicked: false, error: "Element not found: " + selector };
      el.click();
      return { clicked: true };
    },

    type: function (selector, text, clear) {
      var el = document.querySelector(selector);
      if (!el)
        return { typed: false, error: "Element not found: " + selector };

      el.focus();

      var nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      );
      var textareaSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      );
      var setter =
        el.tagName === "TEXTAREA" ? textareaSetter : nativeSetter;

      if (setter && setter.set) {
        if (clear) {
          setter.set.call(el, "");
        }
        var newValue = clear ? text : el.value + text;
        setter.set.call(el, newValue);
      } else {
        el.value = clear ? text : el.value + text;
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));

      return { typed: true, value: el.value };
    },

    scroll: function (selector, x, y) {
      if (selector) {
        var el = document.querySelector(selector);
        if (!el)
          return {
            scrolled: false,
            error: "Element not found: " + selector,
          };
        el.scrollBy(x || 0, y || 0);
        return {
          scrolled: true,
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop,
        };
      } else {
        window.scrollBy(x || 0, y || 0);
        return {
          scrolled: true,
          scrollLeft: window.scrollX,
          scrollTop: window.scrollY,
        };
      }
    },
  };
})();
