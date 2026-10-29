/**
 * Renders Billy into PNG app icons. Run: npx tsx scripts/generate-icons.tsx
 * Uses the preinstalled Playwright Chromium.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { chromium } from "playwright";
import { BillyMascot } from "../src/components/billy/BillyMascot";

const vars = "--billy-ink:#233018;--billy-shade:#9fd24f;--billy-limb:#6f9a3e;--color-lime:#c1f474;--color-ivory:#f4f5ee;--color-peach:#ffb49c;";
const svg = renderToStaticMarkup(createElement(BillyMascot, { mood: "neutral", size: 100, decorative: true }));

function page(size: number, pad: number, radius: number, bg = "#141714") {
  const inner = size - pad * 2;
  return `<html><body style="margin:0;background:transparent"><div style="${vars}width:${size}px;height:${size}px;background:${bg};border-radius:${radius}px;display:flex;align-items:center;justify-content:center;overflow:hidden">
  <div style="height:${inner}px;display:flex">${svg.replace(/width="100" height="135"/, `height="${inner}" width="${(inner * 120) / 162}"`)}</div></div>
  <style>.billy-body,.billy-wave,.billy-sparks{animation:none!important}</style></body></html>`;
}

const targets: { file: string; size: number; pad: number; radius: number; bg?: string }[] = [
  { file: "icon-192.png", size: 192, pad: 22, radius: 0 },
  { file: "icon-512.png", size: 512, pad: 60, radius: 0 },
  { file: "maskable-512.png", size: 512, pad: 110, radius: 0 },
  { file: "apple-touch-icon.png", size: 180, pad: 20, radius: 0 },
  { file: "favicon-32.png", size: 32, pad: 2, radius: 6 },
];

(async () => {
  const browser = await chromium.launch();
  for (const t of targets) {
    const p = await browser.newPage({ viewport: { width: t.size, height: t.size } });
    await p.setContent(page(t.size, t.pad, t.radius, t.bg));
    await p.screenshot({ path: `public/icons/${t.file}`, omitBackground: true });
    await p.close();
  }
  // Monochrome badge for Android status bar.
  const p = await browser.newPage({ viewport: { width: 96, height: 96 } });
  await p.setContent(`<html><body style="margin:0;background:transparent"><svg width="96" height="96" viewBox="0 0 120 162"><path d="M30 22 Q30 16 36 16 L80 16 L92 28 L92 114 L88 122 L84 114 L80 122 L76 114 L72 122 L68 114 L64 122 L60 114 L56 122 L52 114 L48 122 L44 114 L40 122 L36 114 L32 122 L30 114 Z" fill="white"/></svg></body></html>`);
  await p.screenshot({ path: "public/icons/badge-96.png", omitBackground: true });
  await browser.close();
  console.log("icons written");
})();
