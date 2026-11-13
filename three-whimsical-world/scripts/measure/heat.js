async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/?defaults&view=first');
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    const a = window.__app; a.display.showPanel = false; a.display.showMinimap = false; a.display.showFps = false; a.applyDisplay();
    document.getElementById('hint').style.display = 'none'; document.getElementById('menu-key').style.display = 'none';
    a.settings.daySpeed = 0; a.settings.time = 15; a.updateSun(); a.movement.mode = 'fly';
    const comp = a.post.composer; const orig = comp.render.bind(comp);
    const W = 640, H = 360;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d', { willReadFrequently: true });
    window.__frames = 1e9; window.__cap = null;
    comp.render = (...args) => {
      if (window.__frames <= 0) return;
      window.__frames--;
      if (window.__step) window.__step();
      orig(...args);
      if (window.__cap) {
        ctx.drawImage(a.renderer.domElement, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data; const l = new Float32Array(W * H);
        for (let i = 0; i < l.length; i++) l[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
        window.__cap.push(l);
      }
    };
  });
  const heat = (tag, setup, x0, z0, yaw, speed, wind) => page.evaluate(([setup, x0, z0, yaw, speed, wind]) => new Promise(res => {
    const a = window.__app; (0, eval)(setup)(a); a.wind.uWindStrength.value = wind;
    const f = a.world.fns; let x = x0, z = z0, k = 0; const dir = [Math.sin(yaw), Math.cos(yaw)];
    const place = () => { a.player.position.set(x, f.height(x, z) + 1.7, z); a.lookAt(a.player, x + dir[0] * 30, f.height(x, z) + 0.2, z + dir[1] * 30); };
    place(); a.snapView(); a.world.update(a.camera, true); a.post.taa.reset();
    window.__step = () => { x += dir[0] * speed; z += dir[1] * speed; k++; place(); a.snapView(); a.wind.uPrevTime.value = 100 + (k - 1) / 60; a.wind.uTime.value = 100 + k / 60; };
    window.__frames = 40; window.__cap = null;
    const wait = () => { if (window.__frames > 0) return requestAnimationFrame(wait);
      if (!window.__cap) { window.__cap = []; window.__frames = 24; return requestAnimationFrame(wait); }
      const c = window.__cap; window.__cap = null; window.__step = null;
      const W = 640, H = 360, acc = new Float32Array(W * H);
      for (let q = 1; q < c.length - 1; q++) for (let i = 0; i < acc.length; i++) acc[i] += Math.abs(c[q + 1][i] - 2 * c[q][i] + c[q - 1][i]);
      let tot = 0; for (let i = 0; i < acc.length; i++) tot += acc[i];
      const img = new ImageData(W, H);
      for (let i = 0; i < acc.length; i++) { const v = Math.min(255, acc[i] / (c.length - 2) * 6); img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.6; img.data[i * 4 + 2] = 0; img.data[i * 4 + 3] = 255; }
      let hv = document.getElementById('heat'); if (!hv) { hv = document.createElement('canvas'); hv.id = 'heat'; hv.width = W; hv.height = H; hv.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99;display:none'; document.body.appendChild(hv); }
      hv.getContext('2d').putImageData(img, 0, 0);
      res((tot / acc.length / (c.length - 2)).toFixed(2));
    };
    requestAnimationFrame(wait);
  }), [setup, x0, z0, yaw, speed, wind]);
  const out = [];
  const shots = globalThis.__shots || [
    ['forest-taa', `a => { a.display.taa = true; a.applyDisplay(); }`, -540, 450, 0.9, 0.03, 1],
    ['forest-taa-noshade', `a => { a.display.taa = true; a.applyDisplay(); a.post.atmosphere.uShadeTint.value = 0; }`, -540, 450, 0.9, 0.03, 1],
    ['forest-taa-nowind', `a => { a.display.taa = true; a.applyDisplay(); a.post.atmosphere.uShadeTint.value = 0.6; }`, -540, 450, 0.9, 0.03, 0],
  ];
  for (const [tag, setup, x0, z0, yaw, speed, wind] of shots) {
    const v = await heat(tag, setup, x0, z0, yaw, speed, wind);
    out.push(`${tag}: ${v}`);
    await page.evaluate(() => { document.getElementById('heat').style.display = 'block'; });
    await page.screenshot({ path: `.playwright-mcp/measure/heat-${tag}.png` });
    await page.evaluate(() => { document.getElementById('heat').style.display = 'none'; });
    await page.screenshot({ path: `.playwright-mcp/measure/heatframe-${tag}.png` });
  }
  await page.evaluate(() => { window.__frames = 1e9; });
  return out.join('\n');
}
