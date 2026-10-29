/**
 * Renders Billy into PNG app icons. Run: npx tsx scripts/generate-icons.tsx
 * The artwork is scripts/assets/billy-icon.png: the idle Billy drawing, background removed and
 * cropped to his head and shoulders so he still reads at home-screen size.
 * Uses the preinstalled Playwright Chromium.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const LIME = "#c1f474";
const art = `data:image/png;base64,${readFileSync("scripts/assets/billy-icon.png").toString("base64")}`;

// `scale` is the artwork's width as a share of the icon; maskable icons keep Billy inside the safe zone.
function page(size: number, scale: number, radius: number) {
  return `<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;background:${LIME};border-radius:${radius}px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden">
  <img src="${art}" style="width:${size * scale}px;margin-bottom:${size * (1 - scale) * 0.12}px"></div></body></html>`;
}

const targets: { file: string; size: number; scale: number; radius: number }[] = [
  { file: "public/icons/icon-192.png", size: 192, scale: 0.86, radius: 0 },
  { file: "public/icons/icon-512.png", size: 512, scale: 0.86, radius: 0 },
  { file: "public/icons/maskable-512.png", size: 512, scale: 0.66, radius: 0 },
  { file: "public/icons/apple-touch-icon.png", size: 180, scale: 0.86, radius: 0 },
  { file: "public/icons/favicon-32.png", size: 32, scale: 0.96, radius: 7 },
  { file: "src/app/icon.png", size: 32, scale: 0.96, radius: 7 },
];

(async () => {
  const browser = await chromium.launch();
  for (const t of targets) {
    const p = await browser.newPage({ viewport: { width: t.size, height: t.size } });
    await p.setContent(page(t.size, t.scale, t.radius), { waitUntil: "load" });
    await p.screenshot({ path: t.file, omitBackground: true });
    await p.close();
  }
  // Monochrome badge for Android status bar.
  const p = await browser.newPage({ viewport: { width: 96, height: 96 } });
  await p.setContent(`<html><body style="margin:0;background:transparent"><svg width="96" height="96" viewBox="0 0 120 162"><path d="M30 22 Q30 16 36 16 L80 16 L92 28 L92 114 L88 122 L84 114 L80 122 L76 114 L72 122 L68 114 L64 122 L60 114 L56 122 L52 114 L48 122 L44 114 L40 122 L36 114 L32 122 L30 114 Z" fill="white"/></svg></body></html>`);
  await p.screenshot({ path: "public/icons/badge-96.png", omitBackground: true });
  await browser.close();
  console.log("icons written");
})();
