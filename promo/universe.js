// A small, dependency-free observatory. All geometry lives in three dimensions;
// the only light source is the quiet, upper-right glow of the memory sphere.
export function initUniverse() {
  const canvas = document.getElementById('universe');
  const hero = canvas?.closest('.hero');
  if (!canvas || !hero) return () => {};
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return () => {};

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const TAU = Math.PI * 2;
  const palette = ['211,233,181', '245,241,220', '159,192,150'];
  const buckets = Array.from({ length: 24 }, () => []);
  let width = 0;
  let height = 0;
  let radius = 0;
  let cx = 0;
  let cy = 0;
  let mobile = false;
  let visible = true;
  let frame = 0;
  let lastTime = 0;
  let sceneTime = 0;
  let burstTime = -10;
  let pitch = -0.13;
  let yaw = 0.27;
  let spin = 0;
  let targetX = 0;
  let targetY = 0;
  let mouseX = 0;
  let mouseY = 0;
  let dragging = false;
  let moved = false;
  let activePointerId = null;
  let pressX = 0;
  let pressY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let velocity = 0;
  let sphere = [];
  let orbitDust = [];
  let stars = [];
  let glow = null;
  let shade = null;
  let destroyed = false;
  let sinY = 0;
  let cosY = 1;
  let sinX = 0;
  let cosX = 1;
  let expansion = 0;

  // A repeatable distribution avoids a flash of different stars on every resize.
  function randomGenerator(seed) {
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
  }

  function orbitalPoint(t, band = 0, offset = 0) {
    const r = [1.35, 1.57, 1.21][band] + offset;
    const waviness = 1 + Math.sin(t * 3 + band * 1.7) * 0.012;
    const x = Math.cos(t) * r * waviness;
    const y = Math.sin(t) * [0.31, 0.3, 0.71][band];
    const z = Math.sin(t) * r * [0.95, 0.94, 0.81][band];
    const tilt = [-0.41, -0.41, 0.58][band];
    return [x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt), z];
  }

  function buildGeometry() {
    const rand = randomGenerator(524052);
    sphere = [];
    orbitDust = [];
    stars = [];
    const rows = mobile ? 51 : 68;
    const columns = mobile ? 90 : 119;
    for (let row = 0; row < rows; row += 1) {
      const latitude = -Math.PI / 2 + ((row + 0.5) / rows) * Math.PI;
      const ringSize = Math.cos(latitude);
      const count = Math.max(8, Math.round(columns * ringSize));
      for (let i = 0; i < count; i += 1) {
        const angle = ((i + rand() * 0.36) / count) * TAU + row * 0.18;
        const curl = Math.sin(angle * 3 + latitude * 5) * 0.018;
        const lat = latitude + curl + (rand() - 0.5) * 0.009;
        const r = 0.955 + Math.sin(angle * 4 + lat * 7) * 0.024 + rand() * 0.037;
        sphere.push([
          Math.cos(angle) * Math.cos(lat) * r,
          Math.sin(lat) * r,
          Math.sin(angle) * Math.cos(lat) * r,
          0.4 + Math.pow(rand(), 3) * 1.04,
          rand() > 0.77 ? 1 : rand() > 0.72 ? 2 : 0,
          0.38 + rand() * 0.62,
        ]);
      }
    }
    // A few grains inside the shell make it read as volume, rather than a cage.
    for (let i = 0; i < (mobile ? 360 : 660); i += 1) {
      const z = rand() * 2 - 1;
      const angle = rand() * TAU;
      const r = 0.25 + Math.pow(rand(), 0.35) * 0.65;
      const side = Math.sqrt(1 - z * z);
      sphere.push([Math.cos(angle) * side * r, z * r, Math.sin(angle) * side * r, 0.45 + rand() * 0.6, 2, 0.35 + rand() * 0.35]);
    }
    for (let i = 0; i < (mobile ? 1050 : 2300); i += 1) {
      const band = rand() > 0.16 ? 0 : 1;
      const t = rand() * TAU;
      const scatter = (rand() + rand() + rand() - 1.5) * 0.071;
      const p = orbitalPoint(t, band, scatter);
      p[1] += (rand() - 0.5) * 0.019;
      orbitDust.push([...p, 0.35 + rand() * 0.83, rand() > 0.62 ? 1 : 0, 0.38 + rand() * 0.6]);
    }
    for (let i = 0; i < (mobile ? 65 : 135); i += 1) {
      stars.push({ x: rand(), y: rand(), size: rand() > 0.93 ? 1.2 : 0.45 + rand() * 0.35, alpha: 0.055 + rand() * 0.24 });
    }
  }

  function project(x, y, z, scale = 1) {
    const rx = x * cosY + z * sinY;
    const rz = z * cosY - x * sinY;
    const ry = y * cosX - rz * sinX;
    const depth = y * sinX + rz * cosX;
    const perspective = 4.8 / (4.8 - depth * scale);
    return [cx + rx * radius * scale * perspective, cy + ry * radius * scale * perspective, depth, perspective];
  }

  function drawDust(points, layer) {
    for (const bucket of buckets) bucket.length = 0;
    const sphereLayer = layer === 0;
    const scale = 1 + expansion * (sphereLayer ? 0.7 : 1.1);
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const p = project(point[0], point[1], point[2], scale);
      if (!sphereLayer && ((layer < 0 && p[2] >= 0) || (layer > 0 && p[2] < 0))) continue;
      const front = Math.max(0, Math.min(1, (p[2] + 1) * 0.5));
      const light = Math.max(0.16, 0.5 + point[0] * 0.19 - point[1] * 0.22 + front * 0.4);
      const alpha = sphereLayer ? (0.12 + front * 0.72) * light * point[5] : (0.27 + front * 0.65) * point[5];
      const bin = Math.min(7, Math.floor(alpha * 8));
      const bucket = buckets[point[4] * 8 + bin];
      const size = point[3] * p[3] * (mobile ? 0.85 : 1);
      bucket.push(p[0], p[1], size);
    }
    for (let i = 0; i < buckets.length; i += 1) {
      const bucket = buckets[i];
      if (!bucket.length) continue;
      ctx.fillStyle = `rgba(${palette[Math.floor(i / 8)]},${(i % 8 + 1) / 9})`;
      ctx.beginPath();
      for (let j = 0; j < bucket.length; j += 3) {
        const size = bucket[j + 2];
        ctx.rect(bucket[j] - size * 0.5, bucket[j + 1] - size * 0.5, size, size);
      }
      ctx.fill();
    }
  }

  function drawRibbons(front) {
    const segments = mobile ? 95 : 145;
    for (let band = 0; band < 3; band += 1) {
      for (let i = 0; i < segments; i += 1) {
        const t = (i / segments) * TAU;
        // These are irregular, twisting strips of light, with deliberately lost edges.
        const flow = Math.sin(t * 2 + band * 1.5 + sceneTime * 0.07);
        const halfWidth = band === 0 ? 0.008 + Math.pow(flow, 2) * 0.017 : 0.0025 + Math.pow(flow, 2) * 0.0035;
        const a = orbitalPoint(t, band, -halfWidth);
        const b = orbitalPoint(t, band, halfWidth);
        const c = orbitalPoint(t + TAU / segments, band, halfWidth);
        const d = orbitalPoint(t + TAU / segments, band, -halfWidth);
        const pa = project(...a, 1 + expansion);
        if ((pa[2] > 0) !== front) continue;
        const pb = project(...b, 1 + expansion);
        const pc = project(...c, 1 + expansion);
        const pd = project(...d, 1 + expansion);
        const light = 0.22 + Math.pow(Math.sin(t + band + 0.7), 2) * 0.78;
        const alpha = (front ? 0.37 : 0.1) * light * (band === 0 ? 1 : 0.55);
        ctx.fillStyle = `rgba(${band === 0 ? '239,242,210' : '181,210,155'},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.lineTo(pc[0], pc[1]);
        ctx.lineTo(pd[0], pd[1]);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawPages(front) {
    const positions = [0.1, 1.29, 2.83, 3.71, 4.72, 5.52];
    for (let i = 0; i < positions.length; i += 1) {
      const t = positions[i] + sceneTime * 0.024;
      const center = orbitalPoint(t, i === 4 ? 2 : 0, i % 2 ? 0.12 : -0.07);
      const centerScreen = project(...center, 1 + expansion);
      if ((centerScreen[2] > 0) !== front) continue;
      const w = [0.039, 0.028, 0.044, 0.027, 0.035, 0.029][i];
      const h = w * 1.33;
      const twist = t * 0.7 + i;
      const flutter = Math.sin(sceneTime * 0.35 + i) * 0.22 + 0.3;
      const corners = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => {
        const px = x * Math.cos(twist) - y * Math.sin(twist);
        const py = x * Math.sin(twist) + y * Math.cos(twist);
        return project(center[0] + px, center[1] + py, center[2] + x * flutter, 1 + expansion);
      });
      ctx.fillStyle = front ? 'rgba(242,239,216,0.92)' : 'rgba(193,206,167,0.3)';
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      for (let j = 1; j < corners.length; j += 1) ctx.lineTo(corners[j][0], corners[j][1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = front ? 'rgba(38,60,38,0.42)' : 'rgba(41,64,43,0.2)';
      ctx.lineWidth = 0.65;
      for (let row = 0; row < 3; row += 1) {
        const y = -h * 0.42 + row * h * 0.32;
        const line = [-w * 0.52, w * (row === 2 ? 0.12 : 0.5)].map(x => project(
          center[0] + x * Math.cos(twist) - y * Math.sin(twist),
          center[1] + x * Math.sin(twist) + y * Math.cos(twist),
          center[2] + x * flutter,
          1 + expansion,
        ));
        ctx.beginPath();
        ctx.moveTo(line[0][0], line[0][1]);
        ctx.lineTo(line[1][0], line[1][1]);
        ctx.stroke();
      }
    }
  }

  function draw() {
    if (!width || !height || destroyed) return;
    ctx.clearRect(0, 0, width, height);
    sinY = Math.sin(yaw + spin + mouseX * 0.07);
    cosY = Math.cos(yaw + spin + mouseX * 0.07);
    sinX = Math.sin(pitch + mouseY * 0.055);
    cosX = Math.cos(pitch + mouseY * 0.055);
    const burstProgress = Math.max(0, Math.min(1, (sceneTime - burstTime) / 2.2));
    expansion = reduced.matches ? 0 : Math.pow(Math.sin(burstProgress * Math.PI), 2) * 0.14;

    for (const star of stars) {
      ctx.fillStyle = `rgba(215,230,199,${star.alpha})`;
      ctx.fillRect(star.x * width + mouseX * 2, star.y * height + mouseY * 2, star.size, star.size);
    }
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius * 1.75, cy - radius * 1.75, radius * 3.5, radius * 3.5);
    drawRibbons(false);
    drawDust(orbitDust, -1);
    drawPages(false);

    // The translucent central shadow hides distant orbits without painting a backdrop.
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.98, radius * 0.98, 0, 0, TAU);
    ctx.fill();
    drawDust(sphere, 0);
    drawRibbons(true);
    drawDust(orbitDust, 1);
    drawPages(true);
  }

  function resize() {
    const bounds = hero.getBoundingClientRect();
    const newWidth = Math.round(bounds.width);
    const newHeight = Math.round(bounds.height);
    if (!newWidth || !newHeight) return;
    width = newWidth;
    height = newHeight;
    mobile = width < 760;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = width * (mobile ? 0.62 : 0.71);
    cy = height * (mobile ? 0.65 : 0.52);
    radius = mobile ? Math.min(width * 0.48, height * 0.255) : Math.min(width * 0.245, height * 0.36);
    glow = ctx.createRadialGradient(cx + radius * 0.12, cy - radius * 0.1, 0, cx, cy, radius * 1.7);
    glow.addColorStop(0, 'rgba(163,203,96,0.065)');
    glow.addColorStop(0.55, 'rgba(171,217,109,0.035)');
    glow.addColorStop(1, 'rgba(171,217,109,0)');
    shade = ctx.createRadialGradient(cx + radius * 0.3, cy - radius * 0.4, radius * 0.03, cx, cy, radius * 1.02);
    shade.addColorStop(0, 'rgba(32,45,30,0.6)');
    shade.addColorStop(0.7, 'rgba(16,24,20,0.8)');
    shade.addColorStop(0.9, 'rgba(16,24,20,0.69)');
    shade.addColorStop(1, 'rgba(16,24,20,0)');
    buildGeometry();
    draw();
  }

  function canAnimate() {
    return !destroyed && visible && !document.hidden && !reduced.matches && document.body.dataset.motion !== 'paused';
  }

  function tick(now) {
    frame = 0;
    if (!canAnimate()) return;
    const elapsed = now - lastTime;
    if (elapsed >= (mobile ? 1000 / 30 : 1000 / 40)) {
      const dt = Math.min(elapsed / 1000, 0.08);
      lastTime = now;
      sceneTime += dt;
      mouseX += (targetX - mouseX) * 0.065;
      mouseY += (targetY - mouseY) * 0.065;
      if (!dragging) {
        spin += dt * 0.024 + velocity;
        velocity *= Math.pow(0.9, dt * 40);
      }
      draw();
    }
    frame = requestAnimationFrame(tick);
  }

  function syncAnimation() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (canAnimate()) {
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    } else if (visible && !document.hidden) {
      draw();
    }
  }

  function pointerMove(event) {
    if (dragging && event.pointerId !== activePointerId) return;
    const bounds = hero.getBoundingClientRect();
    targetX = (event.clientX - bounds.left) / width - 0.5;
    targetY = (event.clientY - bounds.top) / height - 0.5;
    if (!dragging) return;
    const dx = event.clientX - pointerX;
    const dy = event.clientY - pointerY;
    if (Math.abs(event.clientX - pressX) + Math.abs(event.clientY - pressY) > 3) moved = true;
    yaw += dx * 0.004;
    pitch = Math.max(-0.9, Math.min(0.7, pitch + dy * 0.002));
    velocity = Math.max(-0.02, Math.min(0.02, dx * 0.0006));
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!canAnimate()) draw();
  }

  function pointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false || activePointerId !== null) return;
    activePointerId = event.pointerId;
    dragging = true;
    moved = false;
    velocity = 0;
    pointerX = event.clientX;
    pointerY = event.clientY;
    pressX = event.clientX;
    pressY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.style.cursor = 'grabbing';
  }

  function pointerUp(event) {
    if (!dragging || event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    if (!moved && event.type === 'pointerup' && canAnimate()) burstTime = sceneTime;
    if (event.type !== 'pointerup') velocity = 0;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
  }

  function pointerLeave() {
    if (dragging) return;
    targetX = 0;
    targetY = 0;
  }

  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'pan-y';
  hero.addEventListener('pointermove', pointerMove, { passive: true });
  hero.addEventListener('pointerleave', pointerLeave, { passive: true });
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('lostpointercapture', pointerUp);
  document.addEventListener('visibilitychange', syncAnimation);
  reduced.addEventListener('change', syncAnimation);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(hero);
  const intersectionObserver = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    syncAnimation();
  }, { threshold: 0.01 });
  intersectionObserver.observe(hero);
  const motionObserver = new MutationObserver(syncAnimation);
  motionObserver.observe(document.body, { attributes: true, attributeFilter: ['data-motion'] });
  resize();
  syncAnimation();

  return () => {
    destroyed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    motionObserver.disconnect();
    hero.removeEventListener('pointermove', pointerMove);
    hero.removeEventListener('pointerleave', pointerLeave);
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerUp);
    canvas.removeEventListener('lostpointercapture', pointerUp);
    document.removeEventListener('visibilitychange', syncAnimation);
    reduced.removeEventListener('change', syncAnimation);
  };
}
