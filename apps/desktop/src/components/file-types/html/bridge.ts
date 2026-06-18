/**
 * Bridge script injected into the visual editor iframe.
 * Provides element selection, inline editing, and DOM manipulation APIs.
 * Wrapped in IIFE — only exposes window.__bridge.
 */
export function getBridgeScript(): string {
  return `
(function() {
  'use strict';

  if (window.__bridge) return;

  let nextId = 1;
  let selectedId = null;
  let editingElement = null;
  let observer = null;
  let paused = 0;

  function pause() { paused++; }
  function resume() { if (paused > 0) paused--; }

  // ── Assign unique IDs to all elements ──
  function assignIds(root) {
    const all = root.querySelectorAll('*');
    all.forEach(function(el) {
      if (!el.getAttribute('data-quill-id')) {
        el.setAttribute('data-quill-id', String(nextId++));
      }
    });
  }

  // ── Inject editing CSS ──
  function injectStyles() {
    var style = document.createElement('style');
    style.id = 'quill-bridge-styles';
    style.textContent = [
      '[data-quill-id]:hover { outline: 1px dashed var(--acc, #3a6ef0) !important; outline-offset: -1px; cursor: pointer; }',
      '[data-quill-id].quill-selected { outline: 2px solid var(--acc, #3a6ef0) !important; outline-offset: -1px; }',
      '[data-quill-id][contenteditable="true"] { outline: 2px solid var(--acc, #3a6ef0) !important; outline-offset: -1px; cursor: text; min-height: 1em; }',
      '.quill-editing-overlay { display: none !important; }'
    ].join('\\n');
    document.head.appendChild(style);
  }

  // ── Post message to host ──
  function post(msg) {
    window.parent.postMessage(Object.assign({}, msg, { source: 'quill-bridge' }), '*');
  }

  // ── Get element rect relative to viewport ──
  function getRect(el) {
    var r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
  }

  // ── Select an element ──
  function selectElement(el) {
    // Deselect previous
    if (selectedId) {
      var prev = document.querySelector('[data-quill-id="' + selectedId + '"]');
      if (prev) prev.classList.remove('quill-selected');
    }

    if (!el) {
      selectedId = null;
      post({ type: 'deselect' });
      return;
    }

    var qid = el.getAttribute('data-quill-id');
    if (!qid) return;

    selectedId = qid;
    el.classList.add('quill-selected');
    post({
      type: 'select',
      quillId: qid,
      rect: getRect(el),
      tagName: el.tagName.toLowerCase()
    });
  }

  // ── Enter contenteditable mode ──
  function startEditing(el) {
    if (editingElement) stopEditing();
    editingElement = el;
    el.setAttribute('contenteditable', 'true');
    el.focus();

    // Select all text
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    el.addEventListener('blur', handleEditBlur);
    el.addEventListener('keydown', handleEditKeydown);
  }

  function stopEditing() {
    if (!editingElement) return;
    editingElement.removeAttribute('contenteditable');
    editingElement.removeEventListener('blur', handleEditBlur);
    editingElement.removeEventListener('keydown', handleEditKeydown);
    editingElement = null;
    notifyChange();
  }

  function handleEditBlur() {
    setTimeout(stopEditing, 100);
  }

  function handleEditKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      stopEditing();
    }
    // Prevent Enter from creating new blocks in inline editing
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      stopEditing();
    }
  }

  // ── Notify host of DOM changes ──
  function notifyChange() {
    post({ type: 'change' });
  }

  // ── Setup MutationObserver ──
  function setupObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(function(mutations) {
      if (paused > 0) return;
      var dominated = mutations.some(function(m) {
        // Ignore attribute changes we make ourselves (data-quill-id, contenteditable, class)
        if (m.type === 'attributes') {
          var name = m.attributeName;
          return name !== 'data-quill-id' && name !== 'contenteditable' && name !== 'class';
        }
        return true;
      });
      if (dominated && !editingElement) {
        notifyChange();
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });
  }

  // ── Event handlers ──
  function handleClick(e) {
    if (editingElement) return;
    var target = e.target;
    if (!target || !target.getAttribute) return;
    var el = target.closest ? target.closest('[data-quill-id]') : null;
    if (!el) {
      selectElement(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    selectElement(el);
  }

  function handleDblClick(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var el = target.closest('[data-quill-id]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    selectElement(el);
    startEditing(el);
  }

  // ── Public API: window.__bridge ──
  // All DOM-mutating methods are wrapped with pause/resume to suppress
  // MutationObserver notifications. Each method calls notifyChange()
  // explicitly after the operation.
  var api = {
    setAttr: function(quillId, name, value) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      el.setAttribute(name, value);
      notifyChange();
      return true;
    },

    removeElement: function(quillId) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      el.remove();
      if (selectedId === quillId) {
        selectedId = null;
        post({ type: 'deselect' });
      }
      notifyChange();
      return true;
    },

    moveElement: function(quillId, direction) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el || !el.parentNode) return false;
      if (direction === 'up') {
        var prev = el.previousElementSibling;
        if (!prev) return false;
        el.parentNode.insertBefore(el, prev);
      } else if (direction === 'down') {
        var next = el.nextElementSibling;
        if (!next) return false;
        el.parentNode.insertBefore(next, el);
      }
      notifyChange();
      return true;
    },

    getStyle: function(quillId) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return null;
      var computed = window.getComputedStyle(el);
      var result = {};
      ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily',
       'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
       'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
       'borderWidth', 'borderColor', 'borderRadius',
       'width', 'height', 'display', 'textAlign', 'lineHeight',
       'textDecoration', 'opacity'].forEach(function(prop) {
        result[prop] = computed[prop];
      });
      return result;
    },

    getAttrs: function(quillId) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return null;
      var result = {};
      for (var i = 0; i < el.attributes.length; i++) {
        var attr = el.attributes[i];
        if (attr.name === 'data-quill-id') continue;
        result[attr.name] = attr.value;
      }
      return result;
    },

    removeAttr: function(quillId, name) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      el.removeAttribute(name);
      notifyChange();
      return true;
    },

    setStyle: function(quillId, prop, val) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      el.style[prop] = val;
      notifyChange();
      return true;
    },

    getSelectedId: function() {
      return selectedId;
    },

    refreshIds: function() {
      assignIds(document.body);
    }
  };

  // Wrap every API method with pause/resume to suppress spurious
  // MutationObserver callbacks during programmatic DOM changes.
  window.__bridge = {};
  Object.keys(api).forEach(function(key) {
    window.__bridge[key] = function() {
      pause();
      try {
        return api[key].apply(null, arguments);
      } finally {
        resume();
      }
    };
  });
  // Non-mutating getters don't need pause/resume — restore originals
  window.__bridge.getSelectedId = api.getSelectedId;
  window.__bridge.getStyle = api.getStyle;
  window.__bridge.getAttrs = api.getAttrs;

  // ── Init ──
  function init() {
    assignIds(document.body);
    injectStyles();
    setupObserver();
    document.addEventListener('click', handleClick, true);
    document.addEventListener('dblclick', handleDblClick, true);
    post({ type: 'ready' });
    // Clear any stale selection in the host after iframe reload
    post({ type: 'deselect' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
}
