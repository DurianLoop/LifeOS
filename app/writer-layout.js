(() => {
  'use strict';
  const GAP = 16, EPSILON = .5, SNAP_DISTANCE = 8, MIN_WIDTH = 220, MIN_HEIGHT = 160, MAX_HEIGHT = 4000, MAX_Y = 100000;
  const DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const number = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const copy = frames => new Map([...frames].map(([key, frame]) => [key, {...frame}]));
  const overlaps = (a, b, spacing = GAP) => a.x < b.x + b.width + spacing - EPSILON && a.x + a.width + spacing > b.x + EPSILON &&
    a.y < b.y + b.height + spacing - EPSILON && a.y + a.height + spacing > b.y + EPSILON;
  const sharesColumn = (a, b) => a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON;
  const orderedFrames = frames => [...frames].sort(([a, af], [b, bf]) => af.y - bf.y || af.x - bf.x || a.localeCompare(b));

  // Keep horizontal choices and row order, then fill each column from the top.
  // Testing candidate rows also fills holes below short cards beside taller ones.
  function pack(frames) {
    const placed = [], result = new Map();
    for (const [key, source] of orderedFrames(frames)) {
      const frame = {...source, y:0};let hits;
      while ((hits = placed.filter(other => sharesColumn(frame, other) &&
        frame.y < other.y + other.height + GAP - EPSILON && frame.y + frame.height + GAP > other.y + EPSILON)).length) {
        frame.y = Math.max(...hits.map(other => other.y + other.height + GAP));
      }
      placed.push(frame);result.set(key, frame);
    }
    return result;
  }

  function normalFrame(value, basis, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    const reference = clamp(number(source.basis, basis), MIN_WIDTH, 10000);
    const width = clamp(number(source.width, fallback.width), Math.min(MIN_WIDTH, reference), reference);
    return {x:clamp(number(source.x, fallback.x), 0, reference - width),
      y:clamp(number(source.y, fallback.y), 0, MAX_Y), width,
      height:clamp(number(source.height, fallback.height), MIN_HEIGHT, MAX_HEIGHT), basis:reference};
  }

  function adapt(frame, width) {
    const scale = width / frame.basis, cardWidth = clamp(frame.width * scale, Math.min(MIN_WIDTH, width), width);
    return {x:clamp(frame.x * scale, 0, width - cardWidth), y:frame.y,
      width:cardWidth, height:frame.height, basis:width};
  }

  // The edited card keeps its position. Each neighbour only moves down, including collision chains.
  function separate(frames, activeKey) {
    const placed = [], result = new Map();
    const ordered = [...frames].sort(([a, af], [b, bf]) => a === activeKey ? -1 : b === activeKey ? 1 : af.y - bf.y || af.x - bf.x);
    for (const [key, source] of ordered) {
      const frame = {...source};
      let hits;
      // Responsive widths may shrink an existing gutter. Move neighbours only when their cards overlap.
      while ((hits = placed.filter(other => overlaps(frame, other, 0))).length) {
        frame.y = Math.max(...hits.map(other => other.y + other.height + GAP));
      }
      placed.push(frame);result.set(key, frame);
    }
    return result;
  }

  function legacyFrame(cell, basis) {
    const columns = Math.max(1, Math.min(3, Math.floor((basis + GAP) / 376)));
    const unit = (basis - GAP * (columns - 1)) / columns;
    const wide = cell.size === 'wide' || cell.size === 'large';
    return {x:0, y:0, width:wide ? Math.min(basis, unit * 2 + GAP) : unit,
      height:({compact:190, standard:230, tall:380, wide:320, large:460})[cell.size] || 230, basis};
  }

  function placeNew(frame, placed) {
    const rows = [0, ...placed.map(other => other.y + other.height + GAP)].sort((a, b) => a - b);
    const xs = [0, ...placed.map(other => other.x + other.width + GAP)].sort((a, b) => a - b);
    for (const y of rows) for (const x of xs) {
      const candidate = {...frame, x, y};
      if (x + frame.width <= frame.basis + .01 && !placed.some(other => overlaps(candidate, other))) return candidate;
    }
    return {...frame, x:0, y:Math.max(0, ...placed.map(other => other.y + other.height + GAP))};
  }

  function resize(frame, direction, dx, dy, width) {
    const next = {...frame}, minimum = Math.min(MIN_WIDTH, width);
    if (direction.includes('w')) {
      const right = frame.x + frame.width;
      next.x = clamp(frame.x + dx, 0, right - minimum);next.width = right - next.x;
    } else if (direction.includes('e')) next.width = clamp(frame.width + dx, minimum, width - frame.x);
    if (direction.includes('n')) {
      const bottom = frame.y + frame.height;
      next.y = clamp(frame.y + dy, Math.max(0, bottom - MAX_HEIGHT), Math.min(MAX_Y, bottom - MIN_HEIGHT));next.height = bottom - next.y;
    } else if (direction.includes('s')) next.height = clamp(frame.height + dy, MIN_HEIGHT, MAX_HEIGHT);
    return next;
  }

  function snap(frame, kind, direction, peers, canvasWidth) {
    const next = {...frame}, guides = [];
    for (const axis of ['x', 'y']) {
      const horizontal = axis === 'x', length = horizontal ? 'width' : 'height';
      const leading = horizontal ? 'w' : 'n', trailing = horizontal ? 'e' : 's';
      const features = kind === 'move' ? [0, .5, 1] : direction.includes(leading) ? [0] : direction.includes(trailing) ? [1] : [];
      if (!features.length) continue;
      const targets = [{value:0, feature:0}];
      if (horizontal) targets.push({value:canvasWidth / 2, feature:.5}, {value:canvasWidth, feature:1});
      for (const other of peers.values()) {
        for (const feature of [0, .5, 1]) targets.push({value:other[axis] + other[length] * feature, feature});
        targets.push({value:other[axis] + other[length] + GAP, feature:0}, {value:other[axis] - GAP, feature:1});
      }
      let closest = null;
      for (const feature of features) for (const target of targets) {
        // Moving uses matching edges and centres; a resizing edge may match either edge or a centre.
        if (kind === 'move' && feature !== target.feature) continue;
        const delta = target.value - (next[axis] + next[length] * feature);
        if (Math.abs(delta) <= SNAP_DISTANCE && (!closest || Math.abs(delta) < Math.abs(closest.delta))) closest = {...target, delta, activeFeature:feature};
      }
      if (!closest) continue;
      if (kind === 'move') next[axis] = clamp(next[axis] + closest.delta, 0, horizontal ? canvasWidth - next.width : MAX_Y);
      else Object.assign(next, resize(next, direction, horizontal ? closest.delta : 0, horizontal ? 0 : closest.delta, canvasWidth));
      if (Math.abs(next[axis] + next[length] * closest.activeFeature - closest.value) < EPSILON) guides.push({axis, value:closest.value});
    }
    return {frame:next, guides};
  }

  function mount(grid, {cells = [], onChange = () => {}} = {}) {
    if (!grid || typeof grid.querySelectorAll !== 'function') throw new TypeError('A writer grid is required.');
    const doc = grid.ownerDocument || document, view = doc.defaultView || window;
    const owner = new AbortController(), made = new Set(), original = new Map(), guides = new Map();
    const originalGrid = {height:grid.style.height, canvas:grid.style.getPropertyValue('--writer-canvas-height')};
    let entries = [], frames = new Map(), nodes = new Map(), editing = false, destroyed = false;
    let gesture = null, autoFrame = 0, resizeFrame = 0, signature = '', observedWidth = 0, suppressClickUntil = 0;
    const width = () => Math.max(1, grid.getBoundingClientRect().width || grid.clientWidth || 900);
    const focused = () => grid.classList.contains('is-focused-cell');
    const narrow = () => width() <= 600;
    const connected = () => grid.isConnected !== false;
    const visible = (key, node) => !node.classList.contains('i2Hidden') && entries.find(cell => cell.key === key)?.visible !== false;
    const directCells = () => [...grid.children].filter(node => node.classList.contains('i2WriterCell') && node.dataset.key);
    const stateSignature = () => `${focused()}|${directCells().map(node => `${node.dataset.key}:${node.classList.contains('i2Hidden')}`).join('|')}`;
    const round = value => Math.round(value * 100) / 100;
    const emit = (reason = 'edit') => onChange(Object.fromEntries([...frames].map(([key, frame]) => [key, Object.fromEntries(Object.entries(frame).map(([field, value]) => [field, round(value)]))])), {reason});

    function remember(node) {
      if (!original.has(node)) original.set(node, Object.fromEntries(['position', 'left', 'top', 'width', 'height'].map(field => [field, node.style[field]])));
    }

    function button(node, attribute, value, label, parent) {
      let control = node.querySelector(`[${attribute}${value ? `="${value}"` : ''}]`);
      if (!control) {
        control = doc.createElement('button');control.type = 'button';control.setAttribute(attribute, value || '');
        control.textContent = attribute === 'data-writer-move' ? '⠿' : '';
        if (attribute === 'data-writer-move') parent.prepend(control);else parent.append(control);
        made.add(control);
      }
      control.setAttribute('aria-label', label);control.title = label;
      const enabled = editing && !narrow() && !focused() && visible(node.dataset.key, node);
      control.hidden = !enabled;control.disabled = !enabled;control.tabIndex = enabled ? 0 : -1;
    }

    function controls(node, cell) {
      const head = node.querySelector('.i2CellHead');if (!head) return;
      const label = String(cell?.label || node.dataset.key), english = doc.documentElement?.lang?.startsWith('en');
      button(node, 'data-writer-move', '', english ? `Move ${label}` : `移动“${label}”`, head);
      const names = english ? {n:'top', ne:'top right', e:'right', se:'bottom right', s:'bottom', sw:'bottom left', w:'left', nw:'top left'} :
        {n:'上边', ne:'右上角', e:'右边', se:'右下角', s:'下边', sw:'左下角', w:'左边', nw:'左上角'};
      for (const direction of DIRECTIONS) button(node, 'data-writer-resize', direction,
        english ? `Resize ${label}, ${names[direction]}` : `调整“${label}”大小：${names[direction]}`, node);
    }

    function clearGeometry() {
      for (const node of nodes.values()) for (const field of ['position', 'left', 'top', 'width', 'height']) node.style[field] = '';
      grid.style.height = '';grid.style.removeProperty('--writer-canvas-height');
    }

    function rendered() {
      const layout = new Map(), currentWidth = width();
      for (const [key, node] of nodes) if (visible(key, node) && frames.has(key)) layout.set(key, adapt(frames.get(key), currentWidth));
      return pack(layout);
    }

    function showGuides(active = []) {
      for (const axis of ['x', 'y']) {
        const guide = active.find(item => item.axis === axis);let line = guides.get(axis);
        if (guide && !line) {
          line = doc.createElement('div');line.classList.add('i2WriterGuide', `i2WriterGuide--${axis}`);
          line.setAttribute('aria-hidden', 'true');grid.append(line);guides.set(axis, line);made.add(line);
        }
        if (!line) continue;line.hidden = !guide;
        if (guide) line.style[axis === 'x' ? 'left' : 'top'] = guide.value + 'px';
      }
    }

    function compactStored(basis) {
      const visibleFrames = new Map();
      for (const [key, node] of nodes) if (visible(key, node) && frames.has(key)) visibleFrames.set(key, adapt(frames.get(key), basis));
      let changed = false;
      for (const [key, frame] of pack(visibleFrames)) {
        if (Math.abs(frames.get(key).y - frame.y) > .01) {frames.get(key).y = frame.y;changed = true;}
      }
      return changed;
    }

    function paint(layout) {
      let bottom = 0;
      for (const [key, frame] of layout) {
        const node = nodes.get(key);if (!node) continue;
        node.style.position = 'absolute';node.style.left = frame.x + 'px';node.style.top = frame.y + 'px';
        node.style.width = frame.width + 'px';node.style.height = frame.height + 'px';
        bottom = Math.max(bottom, frame.y + frame.height);
      }
      grid.style.height = (bottom ? bottom + GAP : 0) + 'px';
      grid.style.setProperty('--writer-canvas-height', grid.style.height);
    }

    function apply() {
      if (destroyed) return;if (!connected()) {destroy();return;}
      const mobile = narrow(), focus = focused();
      grid.classList.toggle('is-layout-narrow', mobile);
      for (const [key, node] of nodes) controls(node, entries.find(cell => cell.key === key));
      if (focus) {clearGeometry();return;}
      if (mobile) {
        let y = 0;const layout = new Map();
        for (const [key, node] of nodes) if (visible(key, node)) {
          const height = frames.get(key)?.height || 230;
          layout.set(key, {x:0, y, width:width(), height});y += height + GAP;
        }
        paint(layout);return;
      }
      paint(gesture?.pending || rendered());
    }

    function seed(nextCells, retain = false, reason = 'hydrate') {
      const before = frames, basis = width() > 600 ? width() : 900;
      entries = (Array.isArray(nextCells) ? nextCells : []).filter(cell => cell && typeof cell.key === 'string').map(cell => ({...cell}));
      nodes = new Map(directCells().map(node => [node.dataset.key, node]));
      frames = new Map();const placed = [];let migrated = false;
      for (const [key, node] of nodes) {
        remember(node);const cell = entries.find(item => item.key === key) || {key};
        const fallback = legacyFrame(cell, basis), source = retain ? before.get(key) || cell.frame : cell.frame || before.get(key);
        const frame = source ? normalFrame(source, basis, fallback) : placeNew(fallback, placed);
        if (!source || Object.keys(frame).some(field => source[field] !== frame[field])) migrated = true;
        frames.set(key, frame);if (visible(key, node)) placed.push(adapt(frame, basis));
      }
      migrated = compactStored(basis) || migrated;
      signature = stateSignature();observedWidth = width();apply();if (migrated) emit(reason);
    }

    function scrollParent() {
      for (let node = grid; node && node !== doc.documentElement; node = node.parentElement) {
        if (/(auto|scroll)/.test(view.getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
      }
      return doc.scrollingElement || doc.documentElement;
    }

    function point(event) {
      const rect = grid.getBoundingClientRect();
      return {x:event.clientX - rect.left + (grid.scrollLeft || 0), y:event.clientY - rect.top + (grid.scrollTop || 0)};
    }

    function transform(start, kind, direction, dx, dy) {
      if (kind === 'resize') return resize(start, direction, dx, dy, width());
      return {...start, x:clamp(start.x + dx, 0, width() - start.width), y:clamp(start.y + dy, 0, MAX_Y)};
    }

    function preview(event) {
      if (!gesture || destroyed) return;if (!connected()) {destroy();return;}
      gesture.last = {clientX:event.clientX, clientY:event.clientY};
      const now = point(event), dx = now.x - gesture.point.x, dy = now.y - gesture.point.y;
      if (!gesture.active && Math.hypot(dx, dy) < 4) return;
      gesture.active = true;gesture.node.classList.add(gesture.kind === 'move' ? 'is-moving' : 'is-resizing');
      const trial = copy(gesture.start), peers = copy(gesture.start);peers.delete(gesture.key);
      const aligned = snap(transform(gesture.start.get(gesture.key), gesture.kind, gesture.direction, dx, dy), gesture.kind, gesture.direction, peers, width());
      trial.set(gesture.key, aligned.frame);
      gesture.pending = separate(trial, gesture.key);paint(gesture.pending);showGuides(aligned.guides);
    }

    function autoScroll() {
      if (!gesture || destroyed) return;
      if (!gesture.active) {autoFrame = view.requestAnimationFrame(autoScroll);return;}
      const scroller = gesture.scroller, isDocument = scroller === doc.scrollingElement || scroller === doc.documentElement;
      const rect = isDocument ? {top:0, bottom:view.innerHeight} : scroller.getBoundingClientRect();
      const y = gesture.last.clientY, edge = 40;
      const speed = y < rect.top + edge ? -Math.min(18, (rect.top + edge - y) / 2) :
        y > rect.bottom - edge ? Math.min(18, (y - rect.bottom + edge) / 2) : 0;
      if (speed) {const before = scroller.scrollTop;scroller.scrollTop += speed;if (scroller.scrollTop !== before) preview(gesture.last);}
      if (gesture && !destroyed) autoFrame = view.requestAnimationFrame(autoScroll);
    }

    function finish(save) {
      if (!gesture) return;
      const action = gesture;gesture = null;action.owner.abort();view.cancelAnimationFrame(autoFrame);autoFrame = 0;
      delete grid.dataset.layoutGesture;action.node.classList.remove('is-moving', 'is-resizing');showGuides();
      try {action.handle.releasePointerCapture?.(action.pointerId);} catch (_) {}
      if (save && action.active && action.pending) {
        for (const [key, frame] of pack(action.pending)) frames.set(key, {...frame});
        suppressClickUntil = Date.now() + 250;apply();emit();
      } else apply();
      if (connected() && editing) action.handle.focus({preventScroll:true});
    }

    function start(event) {
      if (!editing || narrow() || focused() || destroyed || event.button !== 0) return;
      const target = event.target, node = target.closest('.i2WriterCell');
      if (!node || node.parentElement !== grid || !visible(node.dataset.key, node)) return;
      const sizeHandle = target.closest('[data-writer-resize]'), moveHandle = target.closest('[data-writer-move]');
      const head = target.closest('.i2CellHead');
      if (!sizeHandle && !moveHandle && (!head || target.closest('button,input,select,textarea,a,[contenteditable],[data-cell-title],.i2CellTitle'))) return;
      const kind = sizeHandle ? 'resize' : 'move', direction = sizeHandle?.dataset.writerResize || '';
      if (sizeHandle && !DIRECTIONS.includes(direction)) return;
      if (gesture) finish(false);
      const local = new AbortController(), handle = sizeHandle || moveHandle || head;
      gesture = {key:node.dataset.key, node, handle, kind, direction, pointerId:event.pointerId, point:point(event),
        last:{clientX:event.clientX, clientY:event.clientY}, start:rendered(), pending:null, active:false, owner:local, scroller:scrollParent()};
      grid.dataset.layoutGesture = kind;
      try {handle.setPointerCapture?.(event.pointerId);} catch (_) {}
      doc.addEventListener('pointermove', move => {if (move.pointerId === gesture?.pointerId) preview(move);}, {signal:local.signal});
      doc.addEventListener('pointerup', up => {if (up.pointerId === gesture?.pointerId) finish(true);}, {signal:local.signal});
      doc.addEventListener('pointercancel', cancel => {if (cancel.pointerId === gesture?.pointerId) finish(false);}, {signal:local.signal});
      doc.addEventListener('scroll', () => {if (gesture) preview(gesture.last);}, {signal:local.signal, capture:true, passive:true});
      doc.addEventListener('visibilitychange', () => {if (doc.hidden) finish(false);}, {signal:local.signal});
      doc.addEventListener('keydown', key => {if (key.key === 'Escape') {key.preventDefault();key.stopPropagation();finish(false);}}, {signal:local.signal, capture:true});
      autoFrame = view.requestAnimationFrame(autoScroll);event.preventDefault();event.stopPropagation();
    }

    function keyboard(event) {
      if (!editing || narrow() || focused() || gesture || destroyed) return;
      const sizeHandle = event.target.closest('[data-writer-resize]'), moveHandle = event.target.closest('[data-writer-move]');
      if (!sizeHandle && !moveHandle) return;
      const node = event.target.closest('.i2WriterCell');if (!node || node.parentElement !== grid) return;
      const step = event.shiftKey ? 20 : 1, vectors = {ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,-step], ArrowDown:[0,step]};
      const vector = vectors[event.key];if (!vector) return;
      const direction = sizeHandle?.dataset.writerResize || '';
      if (sizeHandle && ((vector[0] && !/[ew]/.test(direction)) || (vector[1] && !/[ns]/.test(direction)))) return;
      const layout = rendered(), key = node.dataset.key;if (!layout.has(key)) return;
      const current = layout.get(key), next = transform(current, sizeHandle ? 'resize' : 'move', direction, ...vector);
      if (moveHandle && vector[1]) {
        // Vertical positions are packed, so arrow keys reorder within the same column.
        const neighbours = orderedFrames(layout).filter(([otherKey, other]) => otherKey !== key && sharesColumn(current, other) &&
          (vector[1] < 0 ? other.y < current.y : other.y > current.y));
        const neighbour = vector[1] < 0 ? neighbours.at(-1) : neighbours[0];
        if (neighbour) {next.y = neighbour[1].y;layout.set(neighbour[0], {...neighbour[1], y:current.y});}
      }
      layout.set(key, next);
      const pending = moveHandle && vector[1] ? layout : separate(layout, key);
      for (const [changedKey, frame] of pack(pending)) frames.set(changedKey, frame);
      apply();emit();event.preventDefault();event.stopPropagation();
    }

    function setEditing(value) {
      if (destroyed) return;if (gesture) finish(false);
      const wasEditing = editing;editing = Boolean(value);grid.classList.toggle('is-layout-editing', editing);apply();
      if (editing && !wasEditing && !narrow() && !focused()) grid.querySelector('[data-writer-move]:not([hidden])')?.focus({preventScroll:true});
      else if (!editing && doc.activeElement?.closest?.('[data-writer-move],[data-writer-resize]')) doc.activeElement.closest('.i2WriterCell')?.focus({preventScroll:true});
    }

    function update(nextCells) {if (destroyed) return;if (gesture) finish(false);seed(nextCells, false, 'update');}

    function compact() {
      if (destroyed) return;if (gesture) finish(false);
      const changed = compactStored(width() > 600 ? width() : 900);apply();if (changed) emit('compact');
      return changed;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;if (gesture) {const action = gesture;gesture = null;action.owner.abort();action.node.classList.remove('is-moving', 'is-resizing');}
      view.cancelAnimationFrame(autoFrame);view.cancelAnimationFrame(resizeFrame);owner.abort();resizeObserver?.disconnect();observer?.disconnect();lifecycle?.disconnect();
      delete grid.dataset.layoutGesture;
      grid.classList.remove('i2FreeLayout', 'is-layout-editing', 'is-layout-narrow');
      grid.style.height = originalGrid.height || '';
      if (originalGrid.canvas) grid.style.setProperty('--writer-canvas-height', originalGrid.canvas);else grid.style.removeProperty('--writer-canvas-height');
      for (const [node, styles] of original) Object.assign(node.style, styles);
      for (const control of made) control.remove();
    }

    const resizeObserver = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(() => {
      if (destroyed || resizeFrame) return;
      resizeFrame = view.requestAnimationFrame(() => {
        resizeFrame = 0;if (destroyed) return;
        const next = width();if (Math.abs(next - observedWidth) < .1) return;
        observedWidth = next;if (gesture) finish(false);apply();
      });
    }) : null;
    const observer = typeof view.MutationObserver === 'function' ? new view.MutationObserver(() => {
      const next = stateSignature();if (next === signature) return;
      if (gesture) finish(false);seed(entries, true, 'update');
    }) : null;
    const lifecycle = typeof view.MutationObserver === 'function' ? new view.MutationObserver(() => {if (!connected()) destroy();}) : null;
    grid.classList.add('i2FreeLayout');seed(cells);
    grid.addEventListener('pointerdown', start, {signal:owner.signal});grid.addEventListener('keydown', keyboard, {signal:owner.signal});
    grid.addEventListener('click', event => {if (Date.now() < suppressClickUntil) {event.preventDefault();event.stopPropagation();}}, {signal:owner.signal, capture:true});
    resizeObserver?.observe(grid);observer?.observe(grid, {attributes:true, attributeFilter:['class'], childList:true, subtree:true});
    if (doc.documentElement) lifecycle?.observe(doc.documentElement, {childList:true, subtree:true});
    return {update, setEditing, compact, destroy};
  }

  window.lifeosWriterLayout = {mount};
})();
