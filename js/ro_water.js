/* RO 水面程序化波紋：只在 renderMapBackground 已標記的水域啟用。 */
(function exposeRoWaterEffect(root) {
  'use strict';

  const STYLE_ID = 'ro-water-ripple-style';
  const instances = new WeakMap();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rippleFrame(progress, maxRadius) {
    const p = clamp(Number.isFinite(Number(progress)) ? Number(progress) : 0, 0, 1);
    const radius = Math.max(0, Number(maxRadius) || 0);
    return {
      radius: radius * (0.12 + 0.88 * p),
      opacity: Math.pow(1 - p, 1.45)
    };
  }

  function waveOffset(x, y, time) {
    const px = Number(x) || 0;
    const py = Number(y) || 0;
    const t = Number(time) || 0;
    return Math.sin(px * 0.018 + py * 0.009 + t * 0.0011)
      + 0.45 * Math.sin(px * 0.007 - py * 0.021 - t * 0.0007);
  }

  function prefersReducedMotion() {
    return !!(root.matchMedia
      && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function ensureStyles(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.map-bg-layer .water-surface { isolation: isolate; }',
      '.map-bg-layer .water-ripple-canvas { position: absolute; inset: 0; z-index: 0;',
      '  display: block; width: 100%; height: 100%; pointer-events: none;',
      '  opacity: .82; mix-blend-mode: screen; }',
      '.battle-panel.is-underwater .map-bg-layer .water-ripple-canvas {',
      '  opacity: .36; mix-blend-mode: screen; }'
    ].join('\n');
    const target = doc.head || doc.documentElement;
    if (target) target.appendChild(style);
  }

  function schedule(instance) {
    if (instance.frameId !== null || instance.doc.hidden) return;
    instance.frameId = root.requestAnimationFrame(time => drawFrame(instance, time));
  }

  function syncSize(instance) {
    const rect = instance.surface.getBoundingClientRect();
    const width = Math.max(1, rect.width || 1);
    const height = Math.max(1, rect.height || 1);
    const dpr = Math.min(1.5, Math.max(1, Number(root.devicePixelRatio) || 1));
    if (width === instance.width && height === instance.height && dpr === instance.dpr) return false;

    instance.width = width;
    instance.height = height;
    instance.dpr = dpr;
    instance.canvas.width = Math.max(1, Math.round(width * dpr));
    instance.canvas.height = Math.max(1, Math.round(height * dpr));
    instance.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    instance.ctx.clearRect(0, 0, width, height);
    return true;
  }

  function spawnRipple(instance, time) {
    const w = instance.width;
    const h = instance.height;
    if (w < 8 || h < 8) return;
    instance.ripples.push({
      x: w * (0.08 + Math.random() * 0.84),
      y: h * (0.16 + Math.random() * 0.69),
      born: time,
      life: 2600 + Math.random() * 1400,
      maxRadius: Math.min(w, h) * (0.2 + Math.random() * 0.28),
      squash: 0.2 + Math.random() * 0.18
    });
    if (instance.ripples.length > 12) instance.ripples.shift();
  }

  function drawRipples(instance, time) {
    const ctx = instance.ctx;
    const alive = [];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (const ripple of instance.ripples) {
      const progress = (time - ripple.born) / ripple.life;
      if (progress >= 1) continue;
      alive.push(ripple);
      for (let ring = 0; ring < 3; ring++) {
        const p = progress - ring * 0.15;
        if (p < 0 || p >= 1) continue;
        const frame = rippleFrame(p, ripple.maxRadius);
        ctx.beginPath();
        ctx.ellipse(
          ripple.x, ripple.y,
          frame.radius, Math.max(1, frame.radius * ripple.squash),
          -0.035, 0, Math.PI * 2
        );
        ctx.strokeStyle = 'rgba(196, 244, 255, 1)';
        ctx.globalAlpha = frame.opacity * (0.34 - ring * 0.065);
        ctx.lineWidth = Math.max(0.65, 1.65 * (1 - p));
        ctx.stroke();
      }
    }
    instance.ripples = alive;
    ctx.restore();
  }

  function drawSurfaceShimmer(instance, time) {
    const ctx = instance.ctx;
    const w = instance.width;
    const h = instance.height;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let band = 0; band < 5; band++) {
      const baseY = h * (0.2 + band * 0.145);
      ctx.beginPath();
      for (let x = -8; x <= w + 8; x += 8) {
        const y = baseY
          + waveOffset(x, band * 27, time) * (2.1 + band * 0.35)
          + Math.sin(x * 0.011 - time * 0.0004 + band) * 1.8;
        if (x === -8) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(191, 242, 255, 1)';
      ctx.globalAlpha = 0.055 + (band % 2) * 0.018;
      ctx.lineWidth = band % 2 ? 1.1 : 0.7;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawUnderwaterCaustics(instance, time) {
    const ctx = instance.ctx;
    const w = instance.width;
    const h = instance.height;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let band = 0; band < 8; band++) {
      const baseX = (band + 0.5) * w / 8;
      ctx.beginPath();
      for (let y = -8; y <= h + 8; y += 8) {
        const x = baseX
          + Math.sin(y * 0.022 + time * 0.00032 + band * 0.8) * 12
          + Math.sin(y * 0.008 - time * 0.00021 + band) * 6;
        if (y === -8) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(163, 238, 250, 1)';
      ctx.globalAlpha = 0.055 + (band % 3) * 0.012;
      ctx.lineWidth = 1 + (band % 2) * 0.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  function dispose(instance) {
    if (instance.frameId !== null) root.cancelAnimationFrame(instance.frameId);
    if (instance.resizeObserver) instance.resizeObserver.disconnect();
    if (instance.onWindowResize && root.removeEventListener) {
      root.removeEventListener('resize', instance.onWindowResize);
    }
    if (instance.onVisibilityChange) {
      instance.doc.removeEventListener('visibilitychange', instance.onVisibilityChange);
    }
    instances.delete(instance.surface);
    if (instance.canvas.parentNode) instance.canvas.parentNode.removeChild(instance.canvas);
  }

  function drawFrame(instance, timestamp) {
    instance.frameId = null;
    if (instance.surface.isConnected === false) {
      dispose(instance);
      return;
    }
    if (instance.doc.hidden) return;

    syncSize(instance);
    const time = Number(timestamp) || 0;
    const ctx = instance.ctx;
    ctx.clearRect(0, 0, instance.width, instance.height);

    if (instance.underwater) {
      drawUnderwaterCaustics(instance, time);
    } else {
      if (time >= instance.nextRippleAt) {
        spawnRipple(instance, time);
        instance.nextRippleAt = time + 700 + Math.random() * 850;
      }
      drawRipples(instance, time);
      drawSurfaceShimmer(instance, time);
    }

    if (!prefersReducedMotion()) schedule(instance);
  }

  function mount(surface) {
    const doc = root.document;
    const panel = surface.closest('.battle-panel');
    const underwater = !!(panel && panel.classList.contains('is-underwater'));
    let instance = instances.get(surface);
    surface.classList.toggle('ro-water-underwater', underwater);
    if (instance) {
      instance.underwater = underwater;
      schedule(instance);
      return;
    }

    const canvas = doc.createElement('canvas');
    canvas.className = 'water-ripple-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    let ctx = null;
    try {
      ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    } catch (e) {
      try { ctx = canvas.getContext('2d'); } catch (ignored) { ctx = null; }
    }
    if (!ctx) return;

    surface.appendChild(canvas);
    instance = {
      surface,
      canvas,
      ctx,
      doc,
      frameId: null,
      resizeObserver: null,
      onWindowResize: null,
      onVisibilityChange: null,
      width: 0,
      height: 0,
      dpr: 0,
      underwater,
      ripples: [],
      nextRippleAt: 0
    };
    instances.set(surface, instance);
    syncSize(instance);

    instance.onVisibilityChange = () => {
      if (doc.hidden && instance.frameId !== null) {
        root.cancelAnimationFrame(instance.frameId);
        instance.frameId = null;
      } else if (!doc.hidden) {
        schedule(instance);
      }
    };
    doc.addEventListener('visibilitychange', instance.onVisibilityChange);

    if (typeof root.ResizeObserver === 'function') {
      instance.resizeObserver = new root.ResizeObserver(() => {
        syncSize(instance);
        schedule(instance);
      });
      instance.resizeObserver.observe(surface);
    } else if (root.addEventListener) {
      instance.onWindowResize = () => {
        syncSize(instance);
        schedule(instance);
      };
      root.addEventListener('resize', instance.onWindowResize);
    }
    schedule(instance);
  }

  function refresh() {
    const doc = root.document;
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    doc.querySelectorAll('.map-bg-layer .water-surface').forEach(mount);
  }

  function installRendererHook() {
    const original = root.renderMapBackground;
    if (typeof original !== 'function' || original.__roWaterWrapped) return;
    const wrapped = function () {
      const result = original.apply(this, arguments);
      refresh();
      return result;
    };
    wrapped.__roWaterWrapped = true;
    root.renderMapBackground = wrapped;
  }

  root.ROWaterEffect = Object.freeze({ rippleFrame, waveOffset, refresh });
  installRendererHook();

  function boot() {
    installRendererHook();
    const doc = root.document;
    if (!doc || !doc.body || typeof root.requestAnimationFrame !== 'function') return;
    ensureStyles(doc);
    refresh();
  }

  if (root.document && root.document.readyState === 'loading'
    && typeof root.document.addEventListener === 'function') {
    root.document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
