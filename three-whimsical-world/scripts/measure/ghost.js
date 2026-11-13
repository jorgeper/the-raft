async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/?defaults&view=first');
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    const a = window.__app; a.display.showPanel = false; a.display.showMinimap = false; a.display.showFps = false; a.applyDisplay();
    document.getElementById('hint').style.display = 'none'; document.getElementById('menu-key').style.display = 'none';
    a.settings.daySpeed = 0; a.settings.time = 15; a.updateSun(); a.movement.mode = 'fly';
    const comp = a.post.composer; const orig = comp.render.bind(comp);
    const cv = document.createElement('canvas'); cv.width = 480; cv.height = 240; const ctx = cv.getContext('2d', { willReadFrequently: true });
    window.__frames = 1e9; window.__cap = null;
    comp.render = (...args) => {
      if (window.__frames <= 0) return;
      window.__frames--;
      if (window.__step) window.__step();
      orig(...args);
      if (window.__cap) {
        const el = a.renderer.domElement; const sx = el.width / 1280;
        ctx.drawImage(el, 400 * sx, 400 * sx, 480 * sx, 240 * sx, 0, 0, 480, 240);
        const d = ctx.getImageData(0, 0, 480, 240).data; const l = new Float32Array(480 * 240);
        for (let i = 0; i < l.length; i++) l[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
        // 3x3 box blur, so plain aliasing differences count less than smears and ghosts
        const b = new Float32Array(l.length);
        for (let y = 1; y < 239; y++) for (let x = 1; x < 479; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += l[(y + j) * 480 + x + i]; b[y * 480 + x] = s / 9; }
        window.__cap.push({ raw: l, blur: b });
      }
    };
  });
  // Runs a deterministic sequence: same positions and wind time per frame index. Returns captured frames.
  const seq = (setup, speed, wind) => page.evaluate(([setup, speed, wind]) => new Promise(res => {
    const a = window.__app; (0, eval)(setup)(a);
    a.wind.uWindStrength.value = wind;
    const f = a.world.fns; let x = -120, z = 40, k = 0; const dir = [0.707, 0.707];
    const place = () => { a.player.position.set(x, f.height(x, z) + 1.7, z); a.lookAt(a.player, x + dir[0] * 30, f.height(x, z) + 0.5, z + dir[1] * 30); };
    place(); a.snapView(); a.world.update(a.camera, true); a.post.taa.reset();
    window.__step = () => { x += dir[0] * speed; z += dir[1] * speed; k++; place(); a.snapView(); a.wind.uPrevTime.value = 100 + (k - 1) / 60; a.wind.uTime.value = 100 + k / 60; };
    window.__frames = 0; window.__cap = null;
    // warm up 40 frames, then capture 12
    window.__frames = 40;
    const wait = () => { if (window.__frames > 0) return requestAnimationFrame(wait);
      if (!window.__cap) { window.__cap = []; window.__frames = 12; return requestAnimationFrame(wait); }
      const c = window.__cap; window.__cap = null; window.__step = null; window.__seq = c; res(c.length); };
    requestAnimationFrame(wait);
  }), [setup, speed, wind]);
  const OFF = `a => { a.display.taa = false; a.applyDisplay(); }`;
  const T = (g, gm, mm, bs, bm, wm) => `a => { a.display.taa = true; a.applyDisplay(); const u = a.post.taa.uniforms; u.uGamma.value = ${g}; u.uGammaMoving.value = ${gm}; u.uMinMaxMoving.value = ${mm}; u.uBlendStill.value = ${bs}; u.uBlendMoving.value = ${bm}; u.uWindMotion.value = ${wm}; }`;
  const configs = globalThis.__configs || [
    ['A now', T(1.5, 1.5, 0, 0.1, 0.3, 1)],
    ['A no wind tracking', T(1.5, 1.5, 0, 0.1, 0.3, 0)],
    ['G g1.0 moving', T(1.5, 1.0, 0, 0.1, 0.3, 1)],
    ['H g1.0+mm moving', T(1.5, 1.0, 1, 0.1, 0.3, 1)],
    ['I g1.0+mm, blend .1/.2', T(1.5, 1.0, 1, 0.1, 0.2, 1)],
    ['J g0.75+mm, blend .1/.2', T(1.5, 0.75, 1, 0.1, 0.2, 1)],
  ];
  const out = [];
  for (const wind of [0, 1]) for (const speed of [0.1, 0.25]) {
    await seq(OFF, speed, wind);
    const ref = await page.evaluate(() => { window.__ref = window.__seq; return 1; });
    for (const [name, setup] of configs) {
      await seq(setup, speed, wind);
      const r = await page.evaluate(() => {
        const c = window.__seq, R = window.__ref; let ghost = 0, flick = 0, sharp = 0, n = 0, nf = 0;
        for (let k = 0; k < c.length; k++) for (let i = 481; i < 480 * 239; i += 2) { ghost += Math.abs(c[k].blur[i] - R[k].blur[i]); n++; }
        // temporal instability of the error against the reference (what blinks that the true image doesn't)
        for (let k = 1; k < c.length - 1; k++) for (let i = 481; i < 480 * 239; i += 2) {
          const e = (q) => c[q].blur[i] - R[q].blur[i];
          flick += Math.abs(e(k + 1) - 2 * e(k) + e(k - 1)); nf++;
        }
        const L = c[c.length - 1].raw; let m = 0;
        for (let y = 1; y < 239; y++) for (let x = 1; x < 479; x++) { const i = y * 480 + x; sharp += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - 480] - L[i + 480]); m++; }
        return `ghost ${(ghost / n).toFixed(2)} flick ${(flick / nf).toFixed(2)} sharp ${(sharp / m).toFixed(1)}`;
      });
      out.push(`wind${wind} v${speed} ${name}: ${r}`);
    }
  }
  await page.evaluate(() => { window.__frames = 1e9; });
  return out.join('\n');
}
