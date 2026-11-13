async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/?defaults&view=first');
  await page.waitForTimeout(7000);
  await page.evaluate(() => {
    const a = window.__app; a.display.showPanel = false; a.display.showMinimap = false; a.display.showFps = false; a.applyDisplay();
    document.getElementById('hint').style.display = 'none'; document.getElementById('menu-key').style.display = 'none';
    a.settings.daySpeed = 0; a.settings.time = 15; a.updateSun(); a.movement.mode = 'fly';
    const comp = a.post.composer; const orig = comp.render.bind(comp);
    const cv = document.createElement('canvas'); cv.width = 480; cv.height = 240; const ctx = cv.getContext('2d', { willReadFrequently: true });
    window.__cap = null;
    comp.render = (...args) => {
      const st = window.__step;
      if (st) { st(); }
      orig(...args);
      if (window.__cap) {
        const el = a.renderer.domElement; const sx = el.width / 1280;
        // native-resolution crop of the lower middle (grass)
        ctx.drawImage(el, 400 * sx, 420 * sx, 480 * sx, 240 * sx, 0, 0, 480, 240);
        const d = ctx.getImageData(0, 0, 480, 240).data; const l = new Float32Array(480 * 240);
        for (let i = 0; i < l.length; i++) l[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
        window.__cap.push(l);
      }
    };
  });
  const run = async (name, setup, speed) => page.evaluate(async ([setup, speed]) => {
    const a = window.__app; (0, eval)(setup)(a);
    const f = a.world.fns; let x = -120, z = 40; const dir = [0.707, 0.707];
    const place = () => { const pl = a.player; pl.position.set(x, f.height(x, z) + 1.7, z); a.lookAt(pl, x + dir[0] * 30, f.height(x, z) + 0.5, z + dir[1] * 30); };
    place(); a.snapView(); a.world.update(a.camera, true);
    window.__step = () => { x += dir[0] * speed; z += dir[1] * speed; place(); };
    await new Promise((r) => setTimeout(r, 1500));
    window.__cap = [];
    await new Promise((r) => { const t = () => (window.__cap.length >= 40 ? r() : setTimeout(t, 50)); t(); });
    const fr = window.__cap; window.__cap = null; window.__step = null;
    let e2 = 0, e1 = 0, n = 0;
    for (let k = 1; k < fr.length - 1; k++) for (let i = 0; i < fr[k].length; i++) {
      e2 += Math.abs(fr[k + 1][i] - 2 * fr[k][i] + fr[k - 1][i]); e1 += Math.abs(fr[k + 1][i] - fr[k][i]); n++;
    }
    return `flicker ${(e2 / n).toFixed(2)}  change ${(e1 / n).toFixed(2)}`;
  }, [setup, speed]);
  const out = [];
  const W = 'a.wind.uWindStrength.value = 1; a.display.taa = true; a.applyDisplay(); a.settings.nightVision = 1; a.post.luminance.enabled = true;';
  for (const [name, setup, speed] of [
    ['walk now', `a => { ${W} }`, 0.04],
    ['walk nometer', `a => { ${W} a.settings.nightVision = 0; }`, 0.04],
    ['walk taa off', `a => { ${W} a.display.taa = false; a.applyDisplay(); }`, 0.04],
    ['still now', `a => { ${W} }`, 0],
  ]) for (let r = 0; r < 2; r++) out.push(name + ': ' + (await run(name, setup, speed)));
  return out.join('\n');
}
