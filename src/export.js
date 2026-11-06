import { toPng, toBlob } from 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm';
import { sleep } from './util.js';
import { readImageFile } from './storage.js';

const EXPORT_WIDTH = 3840;
const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Oswald:wght@400;500;600;700&family=Unbounded:wght@700;800;900&display=swap';
const FONT_URL_RE = /https:\/\/fonts\.gstatic\.com[^)'"\s]+/g;
let fontCssPromise = null;

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

async function buildFontCss() {
  const res = await fetch(FONT_CSS_URL);
  if (!res.ok) throw new Error('fonts');
  const css = (await res.text())
    .split(/(?=\/\*)/)
    .filter(block => /^\/\* (latin|cyrillic) \*\//.test(block))
    .join('');
  const urls = [...new Set(css.match(FONT_URL_RE) || [])];
  const inlined = new Map(await Promise.all(urls.map(async u => {
    const r = await fetch(u);
    if (!r.ok) throw new Error('fonts');
    return [u, await blobToDataUrl(await r.blob())];
  })));
  return css.replace(FONT_URL_RE, u => inlined.get(u));
}

async function fontCss() {
  fontCssPromise ??= buildFontCss().catch(() => {
    fontCssPromise = null;
    return null;
  });
  return fontCssPromise;
}

async function fetchDataUrl(src) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(src);
      if (res.ok) return await readImageFile(await res.blob());
    } catch {
      await sleep(400 * (attempt + 1));
      continue;
    }
    await sleep(400 * (attempt + 1));
  }
  throw new Error('Не удалось загрузить картинку.');
}

async function inlineImages(el) {
  await Promise.all([...el.querySelectorAll('img')].map(async img => {
    if (!img.src || img.src.startsWith('data:')) return;
    try {
      img.src = await fetchDataUrl(img.src);
    } catch {
      img.style.display = 'none';
      img.parentElement?.classList.add('fail');
    }
  }));
}

async function prepare(el) {
  await document.fonts.ready;
  await inlineImages(el);
  await Promise.all([...el.querySelectorAll('img')].map(img => img.complete ? null : new Promise(resolve => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  })));
  const fontEmbedCSS = await fontCss();
  const w = el.offsetWidth, h = el.offsetHeight, k = EXPORT_WIDTH / w;
  return {
    ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
    width: EXPORT_WIDTH,
    height: Math.round(h * k),
    pixelRatio: 1,
    cacheBust: true,
    style: { transform: `scale(${k})`, transformOrigin: 'top left', width: `${w}px`, height: `${h}px` },
  };
}

export async function downloadPng(el, fileName) {
  const url = await toPng(el, await prepare(el));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
}

export async function copyPng(el) {
  const blob = await toBlob(el, await prepare(el));
  if (!blob) throw new Error('Пустое изображение.');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
