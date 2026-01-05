(() => {
  const DEFAULT_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#a855f7", "#06b6d4"];

  let canvas = null;
  let ctx = null;
  let rafId = null;
  let particles = [];

  function prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  function ensureCanvas() {
    if (canvas && ctx) return;
    canvas = document.createElement("canvas");
    canvas.className = "axis-confetti-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "9999";

    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d", { alpha: true });
    resize();
    window.addEventListener("resize", resize, { passive: true });
  }

  function resize() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function tick() {
    rafId = null;
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const next = [];
    for (const p of particles) {
      p.life += 1;
      p.vx *= p.decay;
      p.vy = p.vy * p.decay + p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.vr;

      const t = p.life / p.ttl;
      const alpha = t < 0.85 ? 1 : Math.max(0, 1 - (t - 0.85) / 0.15);
      if (alpha <= 0 || p.y > window.innerHeight + 50) continue;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }
      ctx.restore();

      next.push(p);
    }

    particles = next;
    if (particles.length) {
      rafId = window.requestAnimationFrame(tick);
    } else if (canvas) {
      // Keep the canvas around, but stop rendering.
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function burst(options = {}) {
    if (prefersReducedMotion()) return;
    ensureCanvas();

    const x = Number(options.x ?? window.innerWidth / 2);
    const y = Number(options.y ?? window.innerHeight / 3);
    const particleCount = Math.max(6, Math.min(180, Number(options.particleCount ?? 26)));
    const spread = Math.max(10, Math.min(140, Number(options.spread ?? 70)));
    const scalar = Math.max(0.6, Math.min(2.2, Number(options.scalar ?? 1)));

    const colors = Array.isArray(options.colors) && options.colors.length ? options.colors : DEFAULT_COLORS;
    const gravity = Number(options.gravity ?? 0.22);
    const decay = Number(options.decay ?? 0.92);
    const startVelocity = Number(options.startVelocity ?? 7.2);

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI / 2) + randomBetween(-spread / 2, spread / 2) * (Math.PI / 180);
      const velocity = startVelocity * randomBetween(0.65, 1.15);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * -velocity,
        gravity,
        decay,
        rotation: randomBetween(0, Math.PI * 2),
        vr: randomBetween(-0.18, 0.18),
        size: randomBetween(6, 10) * scalar,
        ttl: Math.round(randomBetween(44, 78)),
        life: 0,
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: Math.random() < 0.25 ? "circle" : "square",
      });
    }

    if (!rafId) {
      rafId = window.requestAnimationFrame(tick);
    }
  }

  window.AxisConfetti = { burst };
})();

