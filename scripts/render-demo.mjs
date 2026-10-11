// Renders assets/video/demo.html to docs/demo.mp4 and docs/demo.gif.
//
//   npm run demo              # video + gif
//   npm run demo -- 3.2 5     # just stills at those times, to check layout
//
// Needs ffmpeg and Playwright's Chromium (npx playwright install chromium).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = pathToFileURL(join(ROOT, 'assets/video/demo.html')).href;
const FPS = 60;
const SCALE = 1.5; // 1280x720 page -> 1920x1080 frames
const GIF = { fps: 25, width: 1280, colours: 160 };
const CLIP = { x: 0, y: 0, width: 1280, height: 720 };

async function withPage(fn) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: SCALE });
    await page.goto(PAGE);
    await page.evaluate(() => window.ready);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function stills(times) {
  await withPage(async (page) => {
    for (const t of times) {
      await page.evaluate((t) => window.render(t), t);
      const out = join(tmpdir(), `reviewload-${t.toFixed(2)}.png`);
      await page.screenshot({ path: out, clip: CLIP });
      console.log(out);
    }
  });
}

async function video() {
  const frames = mkdtempSync(join(tmpdir(), 'reviewload-frames-'));
  try {
    const count = await withPage(async (page) => {
      const duration = await page.evaluate(() => window.DURATION);
      const n = Math.round(duration * FPS);
      for (let i = 0; i < n; i++) {
        await page.evaluate((t) => window.render(t), i / FPS);
        await page.screenshot({ path: join(frames, `${String(i).padStart(4, '0')}.png`), clip: CLIP });
      }
      return n;
    });
    console.log(`captured ${count} frames`);

    const input = ['-framerate', String(FPS), '-i', join(frames, '%04d.png')];
    const mp4 = join(ROOT, 'docs/demo.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        ...input,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '18',
        '-preset',
        'slow',
        '-movflags',
        '+faststart',
        mp4,
      ],
      { stdio: 'inherit' },
    );

    // The GIF comes from the MP4 with one palette for the whole clip; diff_mode keeps
    // unchanged regions identical between frames so the file stays small.
    const gif = join(ROOT, 'docs/demo.gif');
    const filter =
      `fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos,split[a][b];` +
      `[a]palettegen=max_colors=${GIF.colours}:stats_mode=diff[p];` +
      '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-filter_complex', filter, gif], { stdio: 'inherit' });
    console.log(mp4);
    console.log(gif);
  } finally {
    rmSync(frames, { recursive: true, force: true });
  }
}

const times = process.argv.slice(2).map(Number);
await (times.length ? stills(times) : video());
