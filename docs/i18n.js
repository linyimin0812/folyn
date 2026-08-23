// i18n runtime: zero-dependency locale swap. data-i18n="key" sets textContent;
// data-i18n-html="key" sets innerHTML (for elements with embedded markup).
// <html lang> + <title> + meta description update per language. Choice persists.
(function () {
  var LANGS = ['zh', 'en', 'ja', 'es', 'de', 'fr'];
  var STORAGE_KEY = 'quill.lang';
  var DEFAULT = 'zh';

  function resolveInitial() {
    var stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (stored && LANGS.indexOf(stored) !== -1) return stored;
    var nav = (navigator.language || '').toLowerCase();
    var primary = nav.split('-')[0];
    if (LANGS.indexOf(primary) !== -1) return primary;
    return DEFAULT;
  }

  function lookup(dict, key) {
    if (!dict || !key) return undefined;
    var parts = key.split('.');
    var cur = dict;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return typeof cur === 'string' ? cur : undefined;
  }

  function applyDict(lang, dict) {
    document.documentElement.lang = lang;
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-i18n');
      var v = lookup(dict, k);
      if (typeof v === 'string') nodes[i].textContent = v;
    }
    nodes = document.querySelectorAll('[data-i18n-html]');
    for (var j = 0; j < nodes.length; j++) {
      var kh = nodes[j].getAttribute('data-i18n-html');
      var vh = lookup(dict, kh);
      if (typeof vh === 'string') nodes[j].innerHTML = vh;
    }
    var bodyAttr = document.body.getAttribute('data-i18n-title');
    if (bodyAttr) {
      var t = lookup(dict, bodyAttr);
      if (typeof t === 'string') document.title = t;
    }
    var metaDesc = document.querySelector('meta[name="description"][data-i18n-desc]');
    if (metaDesc) {
      var d = lookup(dict, metaDesc.getAttribute('data-i18n-desc'));
      if (typeof d === 'string') metaDesc.setAttribute('content', d);
    }
    window.I18N_DICT = dict;
  }

  var cache = {};
  function loadLang(lang) {
    if (cache[lang]) return Promise.resolve(cache[lang]);
    return fetch('locales/' + lang + '.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) { cache[lang] = d; return d; })
      .catch(function () { cache[lang] = {}; return cache[lang]; });
  }

  function setSwitcherValue(lang) {
    var sels = document.querySelectorAll('[data-i18n-switcher]');
    for (var i = 0; i < sels.length; i++) {
      if (sels[i].value !== lang) sels[i].value = lang;
    }
  }

  function switchTo(lang) {
    if (LANGS.indexOf(lang) === -1) lang = DEFAULT;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    return loadLang(lang).then(function (d) { applyDict(lang, d); setSwitcherValue(lang); });
  }

  window.I18N = { langs: LANGS, cache: cache, switchTo: switchTo, current: resolveInitial() };

  document.addEventListener('DOMContentLoaded', function () {
    var sels = document.querySelectorAll('[data-i18n-switcher]');
    for (var i = 0; i < sels.length; i++) {
      sels[i].addEventListener('change', function () { switchTo(this.value); });
    }
    switchTo(window.I18N.current);
  });
})();
