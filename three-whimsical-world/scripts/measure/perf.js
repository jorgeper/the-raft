// Frame cost by effect: at a few views, times N synchronous composer renders (readPixels forces the GPU to finish)
// with everything on, then with one thing off at a time. Prints ms/frame and the saving of each toggle.
async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/?defaults&view=first&time=10');
  await page.waitForTimeout(9000);
  await page.evaluate(() => { const a = window.__app; a.display.showPanel = false; a.display.showMinimap = false; a.applyDisplay();
    document.getElementById('hint').style.display = 'none'; document.getElementById('menu-key').style.display = 'none'; a.settings.daySpeed = 0; });
  const views = globalThis.__views || [['meadow', -60, 20, -120, 60], ['forest', -524, 464, -500, 470], ['coast', 60, 0, 300, 0]];
  const out = [];
  for (const [name, x, z, tx, tz] of views) {
    await page.evaluate(([x, z, tx, tz]) => { const a = window.__app, f = a.world.fns;
      a.player.position.set(x, f.height(x, z) + 1.7, z); a.lookAt(a.player, tx, f.height(tx, tz) + 1.5, tz); a.snapView(); }, [x, z, tx, tz]);
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => {
      const a = window.__app, P = a.post.composer.passes, w = a.world, gl = a.renderer.getContext(), px = new Uint8Array(4);
      const time = () => { for (let i = 0; i < 3; i++) a.post.composer.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t0 = performance.now(); for (let i = 0; i < 20; i++) a.post.composer.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / 20; };
      const pass = (cls) => P.filter((p) => p.constructor.name === cls);
      const toggles = {
        water: [() => pass('WaterPass').forEach((p) => (p.enabled = false)), () => pass('WaterPass').forEach((p) => (p.enabled = true))],
        ao: [() => pass('AOPass').forEach((p) => (p.enabled = false)), () => pass('AOPass').forEach((p) => (p.enabled = true))],
        volumetric: [() => pass('VolumetricPass').forEach((p) => (p.enabled = false)), () => pass('VolumetricPass').forEach((p) => (p.enabled = true))],
        clouds: [() => pass('CloudPass').forEach((p) => (p.enabled = false)), () => pass('CloudPass').forEach((p) => (p.enabled = true))],
        taa: [() => ['TAAPass', 'MotionPass'].forEach((c) => pass(c).forEach((p) => (p.enabled = false))), () => ['TAAPass', 'MotionPass'].forEach((c) => pass(c).forEach((p) => (p.enabled = true)))],
        bloom: [() => pass('UnrealBloomPass').forEach((p) => (p.__e = p.enabled, p.enabled = false)), () => pass('UnrealBloomPass').forEach((p) => (p.enabled = p.__e))],
        shadows: [() => (a.renderer.shadowMap.autoUpdate = false), () => (a.renderer.shadowMap.autoUpdate = true)],
        grass: [() => (w.grass.group.visible = false), () => (w.grass.group.visible = true)],
        cover: [() => (w.cover.group.visible = false), () => (w.cover.group.visible = true)],
        trees: [() => (w.trees.group.visible = false), () => (w.trees.group.visible = true)],
        rocks: [() => (w.rocks.group.visible = false), () => (w.rocks.group.visible = true)],
        life: [() => [w.life.group, w.deer.group, w.pondLife.group].forEach((g) => (g.visible = false)), () => [w.life.group, w.deer.group, w.pondLife.group].forEach((g) => (g.visible = true))],
      };
      const base = time();
      const res = { all: base.toFixed(2) };
      for (const [k, [off, on]] of Object.entries(toggles)) { off(); res[k] = '-' + (base - time()).toFixed(2); on(); }
      res.calls = a.renderer.info.render.calls; res.tris = (a.renderer.info.render.triangles / 1e6).toFixed(2) + 'M';
      return res;
    });
    out.push(name + ' ' + JSON.stringify(r));
  }
  return out.join('\n');
}
