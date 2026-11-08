// Preload for the Google sign-in window. The window already sends a Firefox user
// agent; this makes the page's own scripts see Firefox too, since Google also
// checks Chromium-only properties before refusing an embedded browser.
import { webFrame } from "electron";

webFrame.executeJavaScript(`(() => {
  const define = (target, key, value) => {
    try { Object.defineProperty(target, key, { get: () => value, configurable: true }); } catch {}
  };
  define(Navigator.prototype, "userAgentData", undefined);
  define(Navigator.prototype, "vendor", "");
  define(Navigator.prototype, "productSub", "20100101");
  define(Navigator.prototype, "webdriver", false);
  define(window, "chrome", undefined);
})();`);
