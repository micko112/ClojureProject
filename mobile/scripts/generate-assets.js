/**
 * Generates the app icon, Android adaptive icon layers, splash image and
 * favicon from one SVG mark (white "B" in the Courgette wordmark font on
 * black). Re-run after changing the mark:
 *
 *   NODE_PATH=$(npm root -g) node scripts/generate-assets.js
 *
 * Needs Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`).
 * Output goes to ./assets and is committed, so normal development never runs this.
 */
const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright not found. Install it globally and run with NODE_PATH=$(npm root -g).');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const fontPath = path.join(
  root,
  'node_modules/@expo-google-fonts/courgette/400Regular/Courgette_400Regular.ttf',
);
const fontData = fs.readFileSync(fontPath).toString('base64');

/**
 * @param {object} o
 * @param {number} o.size      canvas size in px
 * @param {string} o.bg        background CSS color ("transparent" allowed)
 * @param {string} o.fg        glyph color
 * @param {number} o.scale     glyph height as a fraction of the canvas
 * @param {boolean} [o.rounded] round the corners (favicon only)
 */
function html({ size, bg, fg, scale, rounded }) {
  return `<!doctype html><html><head><style>
@font-face { font-family: Courgette; src: url(data:font/ttf;base64,${fontData}); }
html, body { margin: 0; padding: 0; background: transparent; }
.c { width: ${size}px; height: ${size}px; background: ${bg}; display: flex;
     align-items: center; justify-content: center; overflow: hidden;
     border-radius: ${rounded ? size * 0.22 : 0}px; }
.m { font-family: Courgette; color: ${fg}; font-size: ${size * scale}px; line-height: 1;
     transform: translate(${size * -0.012}px, ${size * -0.035}px); }
</style></head><body><div class="c"><span class="m">B</span></div></body></html>`;
}

const outputs = [
  // iOS + default icon: full-bleed black, iOS applies its own corner mask.
  { file: 'icon.png', size: 1024, bg: '#000000', fg: '#FFFFFF', scale: 0.62 },
  // Android adaptive icon: the launcher crops to the inner ~66%, keep the mark small.
  { file: 'android-icon-foreground.png', size: 1024, bg: 'transparent', fg: '#FFFFFF', scale: 0.42 },
  { file: 'android-icon-background.png', size: 1024, bg: '#000000', fg: 'transparent', scale: 0.42 },
  { file: 'android-icon-monochrome.png', size: 1024, bg: 'transparent', fg: '#FFFFFF', scale: 0.42 },
  // Splash: mark on transparent, the splash background colour is black.
  { file: 'splash-icon.png', size: 1024, bg: 'transparent', fg: '#FFFFFF', scale: 0.8 },
  { file: 'favicon.png', size: 96, bg: '#000000', fg: '#FFFFFF', scale: 0.66, rounded: true },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const o of outputs) {
    await page.setViewportSize({ width: o.size, height: o.size });
    await page.setContent(html(o));
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.c').screenshot({
      path: path.join(root, 'assets', o.file),
      omitBackground: true,
    });
    console.log('wrote assets/' + o.file);
  }
  await browser.close();
})();
