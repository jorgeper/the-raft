async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/?defaults&view=first&time=12');
  await page.waitForTimeout(9000);
  await page.evaluate(() => {
    const a = window.__app; a.display.showPanel = false; a.display.showMinimap = false; a.display.showFps = false; a.applyDisplay();
    document.getElementById('hint').style.display = 'none'; document.getElementById('menu-key').style.display = 'none';
    a.settings.daySpeed = 0; a.movement.mode = 'fly';
  });
  const shots = [
    ['forest-23', 23, -524, 464, 1.7, -500, 1.5, 470],
    ['forest-01', 1, -524, 464, 1.7, -500, 1.5, 470],
    ['forest-21', 21.3, -524, 464, 1.7, -500, 1.5, 470],
    ['forest-noon', 13, -524, 464, 1.7, -500, 1.5, 470],
    ['meadow-01', 1, -60, 20, 1.7, 0, 3, 30],
    ['sky-noon', 13, -60, 20, 1.7, 0, 25, 60],
    ['sky-17', 17, -60, 20, 1.7, 40, 10, 0],
    ['sky-19', 19.5, -60, 20, 1.7, 40, 10, 0],
    ['meadow-10', 10, -60, 20, 1.7, -100, 0, 60],
  ];
  const tag = 'v3';
  const out = {};
  for (const [name, time, x, z, up, tx, ty, tz] of shots) {
    await page.evaluate(([time, x, z, up, tx, ty, tz]) => {
      const a = window.__app; a.settings.time = time; a.updateSun();
      const g = a.world.height(x, z), gt = a.world.height(tx, tz);
      a.player.position.set(x, g + up, z); a.lookAt(a.player, tx, gt + ty, tz); a.snapView();
    }, [time, x, z, up, tx, ty, tz]);
    await page.waitForTimeout(3000);
    out[name] = await page.evaluate(() => { const a = window.__app, L = a.post.luminance.average, e = a.post.composer.renderer.toneMappingExposure; return [L.toFixed(4), e.toFixed(3), (L * e).toFixed(4)].join(' '); });
    await page.screenshot({ path: `.playwright-mcp/measure/${tag}-${name}.png` });
  }
  return JSON.stringify(out, null, 1);
}
