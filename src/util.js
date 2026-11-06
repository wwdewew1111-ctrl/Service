export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtDot = s => esc(s).replace('.', '<span class="dot">.</span>');

export const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const imageSrc = url => url.startsWith('data:')
  ? url
  : `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=png`;

export function logo(url, name, cls = '') {
  const letter = esc((name || '?').trim().charAt(0).toUpperCase());
  const img = url
    ? `<img src="${esc(imageSrc(url))}" crossorigin="anonymous" alt="" onerror="this.parentElement.classList.add('fail');this.remove()">`
    : '';
  return `<div class="lg ${cls}${url ? '' : ' fail'}">${img}<div class="ph">${letter}</div></div>`;
}
