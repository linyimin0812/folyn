/**
 * Bridge script injected into the visual editor iframe.
 * Full interaction engine: selection, hover, text editing, drag with lerp + snap,
 * liftToCanvas, arrow key nudge, padding/resize support, and DOM manipulation APIs.
 * Wrapped in IIFE — only exposes window.__bridge.
 */
export function getBridgeScript(): string {
  return `
(function() {
  'use strict';

  if (window.__bridge) return;

  /* ═══════════════════════════════════════════
     State
     ═══════════════════════════════════════════ */
  var nextId = 1;
  var selectedEl = null;
  var selectedId = null;
  var editingElement = null;
  var observer = null;
  var paused = 0;

  // Drag state (element drag — initiated inside iframe)
  var dragPending = false;
  var dragActive = false;
  var dragStartMouse = null;
  var dragStartOffset = null;
  var dragElement = null;
  var dragQuillId = null;
  var dragStartPos = null;
  var mousePos = { x: 0, y: 0 };
  var altKeyDown = false;
  var snapLines = [];
  var canvasRect = null;
  var animFrame = null;
  var lerpPos = { x: 0, y: 0 };
  var justDragged = false;

  // Padding drag state (initiated from host overlay handles)
  var paddingDrag = null; // { el, side, startValue, quillId }

  // Resize state (initiated from host overlay handle)
  var resizeDrag = null; // { el, startW, startH, quillId }

  function pause() { paused++; }
  function resume() { if (paused > 0) paused--; }

  /* ═══════════════════════════════════════════
     Element ID system
     ═══════════════════════════════════════════ */
  function assignIds(root) {
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (!all[i].getAttribute('data-quill-id')) {
        all[i].setAttribute('data-quill-id', String(nextId++));
      }
    }
  }

  /* ═══════════════════════════════════════════
     CSS injection
     ═══════════════════════════════════════════ */
  function injectStyles() {
    var style = document.createElement('style');
    style.id = 'quill-bridge-styles';
    style.textContent = [
      '[data-quill-id] { cursor: pointer; }',
      '[data-quill-id][contenteditable="true"] { outline: 2px solid var(--acc, #3a6ef0) !important; outline-offset: -1px; cursor: text; min-height: 1em; }'
    ].join('\\n');
    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════════
     Post message to host
     ═══════════════════════════════════════════ */
  function post(msg) {
    window.parent.postMessage(Object.assign({}, msg, { source: 'quill-bridge' }), '*');
  }

  /* ═══════════════════════════════════════════
     Geometry helpers
     ═══════════════════════════════════════════ */
  function getRect(el) {
    var r = el.getBoundingClientRect();
    var br = document.body.getBoundingClientRect();
    return {
      x: r.left - br.left,
      y: r.top - br.top,
      w: r.width,
      h: r.height
    };
  }

  /* ═══════════════════════════════════════════
     Selection + Hover
     ═══════════════════════════════════════════ */
  function selectElement(el) {
    if (selectedEl) {
      selectedEl.style.outline = '';
      selectedEl.style.outlineOffset = '';
    }
    if (!el) {
      selectedEl = null;
      selectedId = null;
      post({ type: 'deselect' });
      return;
    }
    var qid = el.getAttribute('data-quill-id');
    if (!qid) return;
    selectedEl = el;
    selectedId = qid;
    el.style.outline = '2px solid var(--acc, #3a6ef0)';
    el.style.outlineOffset = '-1px';
    post({
      type: 'select',
      quillId: qid,
      rect: getRect(el),
      tagName: el.tagName.toLowerCase(),
      positionType: window.getComputedStyle(el).position
    });
  }

  function setHover(el) {
    if (el === selectedEl) return;
    if (dragActive) return;
    var qid = el.getAttribute('data-quill-id');
    if (!qid) return;
    post({ type: 'hover', quillId: qid, rect: getRect(el) });
  }

  function clearHover() {
    if (!dragActive) {
      post({ type: 'hoverEnd' });
    }
  }

  /* ═══════════════════════════════════════════
     Text editing (double-click)
     ═══════════════════════════════════════════ */
  var EDITABLE_TAGS = ['A','BUTTON','SPAN','H1','H2','H3','H4','P','LI','TD','TH','LABEL'];

  function isEditable(el) {
    if (EDITABLE_TAGS.indexOf(el.tagName) >= 0) return true;
    var children = el.children;
    for (var i = 0; i < children.length; i++) {
      if (children[i].nodeType === 1) return false;
    }
    return true;
  }

  function startEditing(el) {
    if (editingElement) stopEditing();
    if (!isEditable(el)) return;
    editingElement = el;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch(e) {}
    el.addEventListener('blur', handleEditBlur);
    post({ type: 'editing', quillId: el.getAttribute('data-quill-id') });
  }

  function stopEditing() {
    if (!editingElement) return;
    var qid = editingElement.getAttribute('data-quill-id');
    editingElement.removeAttribute('contenteditable');
    editingElement.removeEventListener('blur', handleEditBlur);
    editingElement = null;
    post({ type: 'editDone', quillId: qid });
    notifyChange();
  }

  function handleEditBlur() {
    setTimeout(stopEditing, 100);
  }

  /* ═══════════════════════════════════════════
     DOM change notification
     ═══════════════════════════════════════════ */
  function notifyChange() {
    post({ type: 'change' });
  }

  /* ═══════════════════════════════════════════
     MutationObserver
     ═══════════════════════════════════════════ */
  function setupObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(function(mutations) {
      if (paused > 0) return;
      if (editingElement) return;
      var dominated = mutations.some(function(m) {
        if (m.type === 'attributes') {
          var name = m.attributeName;
          return name !== 'data-quill-id' && name !== 'contenteditable' && name !== 'class' && name !== 'style';
        }
        return true;
      });
      if (dominated) {
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

  /* ═══════════════════════════════════════════
     Drag system (element drag)
     ═══════════════════════════════════════════ */
  function checkDragStart() {
    if (!dragPending || !dragStartMouse || !dragElement) return;
    var dx = mousePos.x - dragStartMouse.x;
    var dy = mousePos.y - dragStartMouse.y;
    if (Math.sqrt(dx * dx + dy * dy) <= 3) return;

    dragActive = true;
    dragPending = false;

    var el = dragElement;
    var computed = window.getComputedStyle(el);

    // liftToCanvas if not absolute
    if (computed.position !== 'absolute') {
      liftToCanvas(el);
    }

    // Capture current position after potential lift
    var rect = el.getBoundingClientRect();
    var cr = document.body.getBoundingClientRect();
    canvasRect = cr;

    dragStartPos = {
      x: rect.left - cr.left,
      y: rect.top - cr.top
    };
    dragStartOffset = {
      x: dragStartMouse.x - dragStartPos.x,
      y: dragStartMouse.y - dragStartPos.y
    };

    lerpPos = { x: dragStartPos.x, y: dragStartPos.y };
    snapLines = collectSnapLines();

    post({ type: 'dragStart', quillId: dragQuillId });
    animFrame = requestAnimationFrame(dragLoop);
  }

  function dragLoop() {
    if (!dragActive || !dragElement) return;

    var targetX = mousePos.x - dragStartOffset.x;
    var targetY = mousePos.y - dragStartOffset.y;

    var w = dragElement.offsetWidth;
    var h = dragElement.offsetHeight;

    // Snap (disabled when Alt is held)
    var snappedX = [];
    var snappedY = [];
    if (!altKeyDown) {
      var snapped = applySnap(targetX, targetY, w, h, snapLines, 6);
      targetX = snapped.x;
      targetY = snapped.y;
      snappedX = snapped.snappedX;
      snappedY = snapped.snappedY;
    }

    // Lerp
    lerpPos.x = lerp(lerpPos.x, targetX, 0.65);
    lerpPos.y = lerp(lerpPos.y, targetY, 0.65);

    dragElement.style.left = lerpPos.x + 'px';
    dragElement.style.top = lerpPos.y + 'px';

    post({
      type: 'dragging',
      quillId: dragQuillId,
      x: lerpPos.x,
      y: lerpPos.y,
      w: w,
      h: h,
      snappedX: snappedX,
      snappedY: snappedY
    });

    animFrame = requestAnimationFrame(dragLoop);
  }

  function stopDrag() {
    // Also clear pending drag (user released mouse outside iframe before
    // crossing the 3px threshold)
    if (dragPending && !dragActive) {
      dragPending = false;
      dragElement = null;
      dragQuillId = null;
      return;
    }
    if (!dragActive) return;
    dragActive = false;
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    var qid = dragQuillId;
    dragElement = null;
    dragQuillId = null;
    snapLines = [];
    justDragged = true;
    post({ type: 'dragEnd', quillId: qid });
    notifyChange();
  }

  /* ═══════════════════════════════════════════
     liftToCanvas
     ═══════════════════════════════════════════ */
  function liftToCanvas(el) {
    var rect = el.getBoundingClientRect();
    var cr = document.body.getBoundingClientRect();
    var computed = window.getComputedStyle(el);

    // Capture 13 inherited properties + backgroundColor
    var props = ['color','fontFamily','fontSize','fontWeight','fontStyle',
      'lineHeight','letterSpacing','textAlign','textDecoration',
      'textTransform','whiteSpace','wordSpacing','backgroundColor'];
    var captured = {};
    for (var i = 0; i < props.length; i++) {
      captured[props[i]] = computed[props[i]];
    }

    // Set absolute positioning
    el.style.position = 'absolute';
    el.style.left = (rect.left - cr.left) + 'px';
    el.style.top = (rect.top - cr.top) + 'px';
    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';
    el.style.margin = '0';

    // Write inherited styles
    var keys = Object.keys(captured);
    for (var j = 0; j < keys.length; j++) {
      el.style[keys[j]] = captured[keys[j]];
    }

    // Move to body direct child
    document.body.appendChild(el);
  }

  /* ═══════════════════════════════════════════
     Snap system
     ═══════════════════════════════════════════ */
  function collectSnapLines() {
    var lines = [];
    var cr = document.body.getBoundingClientRect();
    var cw = cr.width;
    var ch = cr.height;

    // Canvas edges + center
    lines.push({ axis: 'x', value: 0 });
    lines.push({ axis: 'x', value: cw / 2 });
    lines.push({ axis: 'x', value: cw });
    lines.push({ axis: 'y', value: 0 });
    lines.push({ axis: 'y', value: ch / 2 });
    lines.push({ axis: 'y', value: ch });

    // Sibling elements (body direct children with data-quill-id)
    var sibs = document.body.querySelectorAll(':scope > [data-quill-id]');
    for (var i = 0; i < sibs.length; i++) {
      if (sibs[i] === selectedEl) continue;
      var r = sibs[i].getBoundingClientRect();
      var l = r.left - cr.left;
      var ri = r.right - cr.left;
      var t = r.top - cr.top;
      var b = r.bottom - cr.top;
      lines.push({ axis: 'x', value: l });
      lines.push({ axis: 'x', value: (l + ri) / 2 });
      lines.push({ axis: 'x', value: ri });
      lines.push({ axis: 'y', value: t });
      lines.push({ axis: 'y', value: (t + b) / 2 });
      lines.push({ axis: 'y', value: b });
    }
    return lines;
  }

  function applySnap(x, y, w, h, lines, threshold) {
    var snappedX = [];
    var snappedY = [];
    var edgesX = [x, x + w / 2, x + w];
    var edgesY = [y, y + h / 2, y + h];
    var dx = 0, dy = 0;
    var minDx = threshold, minDy = threshold;

    for (var ei = 0; ei < edgesX.length; ei++) {
      for (var li = 0; li < lines.length; li++) {
        if (lines[li].axis !== 'x') continue;
        var d = Math.abs(edgesX[ei] - lines[li].value);
        if (d < minDx) {
          minDx = d;
          dx = lines[li].value - edgesX[ei];
          snappedX.length = 0;
          snappedX.push(lines[li].value);
        }
      }
    }
    for (var ey = 0; ey < edgesY.length; ey++) {
      for (var ly = 0; ly < lines.length; ly++) {
        if (lines[ly].axis !== 'y') continue;
        var d2 = Math.abs(edgesY[ey] - lines[ly].value);
        if (d2 < minDy) {
          minDy = d2;
          dy = lines[ly].value - edgesY[ey];
          snappedY.length = 0;
          snappedY.push(lines[ly].value);
        }
      }
    }
    return { x: x + dx, y: y + dy, snappedX: snappedX, snappedY: snappedY };
  }

  /* ═══════════════════════════════════════════
     Lerp helper
     ═══════════════════════════════════════════ */
  function lerp(current, target, factor) {
    return current + (target - current) * factor;
  }

  /* ═══════════════════════════════════════════
     Padding drag (initiated from host)
     ═══════════════════════════════════════════ */
  function startPaddingDragInternal(el, side, quillId) {
    var prop = 'padding' + side.charAt(0).toUpperCase() + side.slice(1);
    var computed = window.getComputedStyle(el);
    paddingDrag = {
      el: el,
      side: side,
      startValue: parseFloat(computed[prop]) || 0,
      quillId: quillId,
      prop: prop
    };
  }

  function updatePaddingDragInternal(delta) {
    if (!paddingDrag) return;
    var newVal = Math.max(0, paddingDrag.startValue + delta);
    paddingDrag.el.style[paddingDrag.prop] = newVal + 'px';
    post({
      type: 'paddingDrag',
      quillId: paddingDrag.quillId,
      side: paddingDrag.side,
      value: newVal
    });
  }

  function endPaddingDragInternal() {
    if (!paddingDrag) return;
    var qid = paddingDrag.quillId;
    paddingDrag = null;
    post({ type: 'paddingEnd', quillId: qid });
    notifyChange();
  }

  /* ═══════════════════════════════════════════
     Resize drag (initiated from host)
     ═══════════════════════════════════════════ */
  function startResizeInternal(el, quillId) {
    resizeDrag = {
      el: el,
      startW: el.offsetWidth,
      startH: el.offsetHeight,
      quillId: quillId
    };
    post({ type: 'resizeStart', quillId: quillId });
  }

  function updateResizeInternal(deltaX, deltaY) {
    if (!resizeDrag) return;
    var newW = Math.max(20, resizeDrag.startW + deltaX);
    var newH = Math.max(20, resizeDrag.startH + deltaY);
    resizeDrag.el.style.width = newW + 'px';
    resizeDrag.el.style.height = newH + 'px';
    post({
      type: 'resizing',
      quillId: resizeDrag.quillId,
      w: newW,
      h: newH
    });
  }

  function endResizeInternal() {
    if (!resizeDrag) return;
    var qid = resizeDrag.quillId;
    resizeDrag = null;
    post({ type: 'resizeEnd', quillId: qid });
    notifyChange();
  }

  /* ═══════════════════════════════════════════
     Event handlers
     ═══════════════════════════════════════════ */
  function handleClick(e) {
    if (editingElement) return;
    if (justDragged) {
      justDragged = false;
      return;
    }
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
    if (editingElement) return;
    var target = e.target;
    if (!target || !target.closest) return;
    var el = target.closest('[data-quill-id]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    selectElement(el);
    startEditing(el);
  }

  function handleMouseOver(e) {
    if (editingElement || dragActive) return;
    var target = e.target;
    if (!target || !target.closest) return;
    var el = target.closest('[data-quill-id]');
    if (!el || el === selectedEl) return;
    el.style.outline = '1px dashed var(--acc, #3a6ef0)';
    el.style.outlineOffset = '-1px';
    setHover(el);
  }

  function handleMouseOut(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var el = target.closest('[data-quill-id]');
    if (el && el !== selectedEl) {
      el.style.outline = '';
      el.style.outlineOffset = '';
    }
    clearHover();
  }

  function handleMouseDown(e) {
    if (editingElement) return;
    if (!selectedEl) return;
    if (e.button !== 0) return;
    var target = e.target;
    if (!target || !target.closest) return;
    var el = target.closest('[data-quill-id]');
    if (el !== selectedEl) return;

    dragPending = true;
    dragElement = selectedEl;
    dragQuillId = selectedId;
    dragStartMouse = { x: e.clientX, y: e.clientY };
    mousePos = { x: e.clientX, y: e.clientY };
  }

  function handleMouseMove(e) {
    mousePos = { x: e.clientX, y: e.clientY };
    altKeyDown = e.altKey;
    if (dragPending && !dragActive) {
      checkDragStart();
    }
  }

  function handleMouseUp(e) {
    if (dragPending || dragActive) {
      if (dragActive) {
        stopDrag();
      }
      dragPending = false;
      dragElement = null;
      dragQuillId = null;
    }
  }

  function handleKeyDown(e) {
    // Text editing key handling is done via the editBlur listener
    if (editingElement) {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopEditing();
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        stopEditing();
      }
      return;
    }

    // Arrow key nudge
    if (selectedEl && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      var step = e.shiftKey ? 10 : 1;
      var computed = window.getComputedStyle(selectedEl);
      if (computed.position !== 'absolute') {
        liftToCanvas(selectedEl);
      }
      var left = parseFloat(selectedEl.style.left) || 0;
      var top = parseFloat(selectedEl.style.top) || 0;
      if (e.key === 'ArrowUp') top -= step;
      if (e.key === 'ArrowDown') top += step;
      if (e.key === 'ArrowLeft') left -= step;
      if (e.key === 'ArrowRight') left += step;
      selectedEl.style.left = left + 'px';
      selectedEl.style.top = top + 'px';
      post({ type: 'nudge', quillId: selectedId });
      notifyChange();
      return;
    }

    // Escape to deselect
    if (e.key === 'Escape' && selectedEl) {
      selectElement(null);
    }
  }

  /* ═══════════════════════════════════════════
     Public API: window.__bridge
     ═══════════════════════════════════════════ */
  var api = {
    setStyle: function(quillId, prop, value) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      el.style[prop] = value;
      notifyChange();
      return true;
    },

    setPosition: function(quillId, x, y) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      notifyChange();
      return true;
    },

    setPadding: function(quillId, side, value) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      var prop = 'padding' + side.charAt(0).toUpperCase() + side.slice(1);
      el.style[prop] = value;
      notifyChange();
      return true;
    },

    setSize: function(quillId, w, h) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      el.style.width = Math.max(20, w) + 'px';
      el.style.height = Math.max(20, h) + 'px';
      notifyChange();
      return true;
    },

    getStyle: function(quillId) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return null;
      var computed = window.getComputedStyle(el);
      var result = {};
      ['color','backgroundColor','fontSize','fontWeight','fontFamily',
       'marginTop','marginBottom','marginLeft','marginRight',
       'paddingTop','paddingBottom','paddingLeft','paddingRight',
       'borderRadius','width','height','textAlign','lineHeight',
       'opacity'].forEach(function(prop) {
        result[prop] = computed[prop];
      });
      return result;
    },

    getPosition: function(quillId) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return null;
      var rect = getRect(el);
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    },

    getSelectedId: function() {
      return selectedId;
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

    setAttr: function(quillId, name, value) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      el.setAttribute(name, value);
      notifyChange();
      return true;
    },

    removeAttr: function(quillId, name) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      el.removeAttribute(name);
      notifyChange();
      return true;
    },

    removeElement: function(quillId) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      el.remove();
      if (selectedId === quillId) {
        selectedEl = null;
        selectedId = null;
        post({ type: 'deselect' });
      }
      notifyChange();
      return true;
    },

    getCanvasInnerHTML: function() {
      return document.body.innerHTML;
    },

    // Padding drag (called from host overlay handles)
    startPaddingDrag: function(quillId, side) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      startPaddingDragInternal(el, side, quillId);
      return true;
    },

    updatePaddingDrag: function(delta) {
      updatePaddingDragInternal(delta);
      return true;
    },

    endPaddingDrag: function() {
      endPaddingDragInternal();
      return true;
    },

    // Resize drag (called from host overlay handle)
    startResize: function(quillId) {
      var el = document.querySelector('[data-quill-id="' + quillId + '"]');
      if (!el) return false;
      startResizeInternal(el, quillId);
      return true;
    },

    updateResize: function(deltaX, deltaY) {
      updateResizeInternal(deltaX, deltaY);
      return true;
    },

    endResize: function() {
      endResizeInternal();
      return true;
    },

    // Called from host when mouseup fires outside iframe during element drag
    stopDrag: function() {
      stopDrag();
      return true;
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

  // Non-mutating getters don't need pause/resume
  window.__bridge.getSelectedId = api.getSelectedId;
  window.__bridge.getStyle = api.getStyle;
  window.__bridge.getPosition = api.getPosition;
  window.__bridge.getAttrs = api.getAttrs;
  window.__bridge.getCanvasInnerHTML = api.getCanvasInnerHTML;

  /* ═══════════════════════════════════════════
     Init
     ═══════════════════════════════════════════ */
  function init() {
    assignIds(document.body);
    injectStyles();
    setupObserver();

    document.addEventListener('click', handleClick, true);
    document.addEventListener('dblclick', handleDblClick, true);
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('keydown', handleKeyDown, true);

    post({ type: 'ready' });
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
