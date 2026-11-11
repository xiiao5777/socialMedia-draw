// 黑底／白底 for every page of the site. Loaded in <head>, so a remembered choice applies before
// the page paints. Until someone presses the button, pages follow the computer's setting.
(function () {
  'use strict';
  var KEY = 'giveaway-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var COLORS = { dark: '#11151C', light: '#F2F4F7' };

  function apply(t) {
    if (t === 'dark' || t === 'light') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    // Phone browsers colour their toolbar from theme-color: follow the choice too.
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i];
      if (!m.hasAttribute('data-auto')) m.setAttribute('data-auto', m.getAttribute('content'));
      m.setAttribute('content', COLORS[t] || m.getAttribute('data-auto'));
    }
  }
  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function isDark() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : !!(media && media.matches);
  }

  apply(saved());
  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-theme'));
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* storage off: this visit only */ }
    });
  });
  // Changed on another tab of the site: follow it.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === null) apply(e.newValue);
  });
})();
