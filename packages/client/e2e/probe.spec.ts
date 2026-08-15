import { test } from '@playwright/test';
import { decodePng, pixelAt } from './pixels.js';

for (const map of ['duel-arena', 'iron-basin']) {
  for (const vp of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    test(`probe ${map} ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto(`./?map=${map}${map === 'iron-basin' ? '&format=4v4' : ''}`);
      await page.waitForTimeout(900);
      const box = (await page.locator('#board canvas').boundingBox())!;
      const img = decodePng(await page.screenshot({ clip: box }));
      const hud = (await page.locator('.hud').boundingBox())!;
      const log = (await page.locator('.log').boundingBox())!;
      const corners = {
        topLeft: pixelAt(img, 6, 6),
        topRightOfLog: pixelAt(img, Math.round(log.x) - 12, 6),
        bottomLeft: pixelAt(img, 6, Math.round(hud.y) - 12),
      };
      console.log(map, `${vp.width}x${vp.height}`, 'canvas', img.width, img.height,
        'hud.y', Math.round(hud.y), 'log.x', Math.round(log.x),
        JSON.stringify(corners));
    });
  }
}
