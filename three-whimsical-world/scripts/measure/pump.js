async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/?defaults&view=first&time=15');
  await page.waitForTimeout(9000);
  await page.evaluate(() => {
    const a = window.__app; a.display.showPanel = false; a.display.showMinimap = false; a.display.showFps = false; a.applyDisplay();
    document.getElementById('hint').style.display = 'none'; document.getElementById('menu-key').style.display = 'none';
    a.settings.daySpeed = 0; a.movement.mode = 'fly';
  });
  const run = (time, x, z, nv) => page.evaluate(([time, x, z, nv]) => new Promise(res => {
    const a = window.__app; a.settings.time = time; a.updateSun(); a.settings.nightVision = nv;
    const f = a.world.fns; let yaw = 0, px = x, pz = z;
    const place = () => { a.player.position.set(px, f.height(px, pz) + 1.7, pz); a.lookAt(a.player, px + Math.sin(yaw) * 20, f.height(px, pz) + 1.2, pz + Math.cos(yaw) * 20); };
    place(); a.snapView();
    setTimeout(() => {
      const ex = [], met = []; const t0 = performance.now();
      const step = () => {
        yaw += 0.012; px += Math.sin(yaw) * 0.05; pz += Math.cos(yaw) * 0.05; place();
        ex.push(a.renderer.toneMappingExposure); met.push(a.post.luminance.average);
        if (performance.now() - t0 < 6000) requestAnimationFrame(step);
        else {
          let maxd = 0; for (let i = 1; i < ex.length; i++) maxd = Math.max(maxd, Math.abs(ex[i] / ex[i - 1] - 1));
          res(`exp ${Math.min(...ex).toFixed(3)}..${Math.max(...ex).toFixed(3)} maxFrameChange ${(maxd * 100).toFixed(2)}% metered ${Math.min(...met).toFixed(4)}..${Math.max(...met).toFixed(4)}`);
        }
      };
      requestAnimationFrame(step);
    }, 2500);
  }), [time, x, z, nv]);
  const out = [];
  out.push('forest day nv1: ' + await run(15, -524, 464, 1));
  out.push('forest day nv0: ' + await run(15, -524, 464, 0));
  out.push('meadow day nv1: ' + await run(15, -60, 20, 1));
  out.push('forest night nv1: ' + await run(23, -524, 464, 1));
  out.push('forest dusk nv1: ' + await run(20.5, -524, 464, 1));
  return out.join('\n');
}
