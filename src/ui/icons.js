// メニューと上部の帯で使うアイコン。
//
// 絵文字は端末のフォントで絵が変わり、無い端末では豆腐になる（落とし穴 16 と同じ理由）。
// だから全部 24×24 の SVG で持つ。色は currentColor に従う。

const P = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h5v-5.5h3v5.5h5V10"/>',
  horse: '<path d="M7 21c.3-3.4 1.4-5.7 3.2-7.3L7.4 12c-.9-.6-1-1.8-.2-2.5l1.2-1.1c.6-.6 1.6-.6 2.2 0l.4.4C12.6 7 14 6.1 15.6 5.8L16 3.5l1.4 1.8c2 .9 3.1 2.9 3.1 5.2V14l-1.6 1.1-1.7-1.5-1.6 1.4c.5 1.7.6 3.6.4 6"/><circle cx="15.6" cy="9" r=".7" fill="currentColor"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2"/>',
  barn: '<path d="M2.5 11 12 4l9.5 7"/><path d="M4.5 9.6V20h15V9.6"/><path d="M9 20v-6h6v6M9 14l6 6M15 14l-6 6"/>',
  trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5c0 3 1.3 4.6 3.4 5M16.5 6h3c0 3-1.3 4.6-3.4 5"/><path d="M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  next: '<path d="M6 5.5 13 12l-7 6.5M12 5.5 19 12l-7 6.5"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M8.6 7.5 12 12l3.4-4.5M12 12v5M9 12.2h6M9 14.8h6"/>',
  star: '<path d="m12 3.5 2.6 5.5 6 .7-4.5 4.1 1.2 5.9L12 16.8l-5.3 2.9 1.2-5.9-4.5-4.1 6-.7z"/>',
  medal: '<path d="M8 3.5 10.5 9M16 3.5 13.5 9"/><circle cx="12" cy="14.5" r="5.5"/><path d="m12 11.8.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z"/>',
  mare: '<path d="M12 20.5s-7.5-4.3-7.5-10A4.3 4.3 0 0 1 12 7.7a4.3 4.3 0 0 1 7.5 2.8c0 5.7-7.5 10-7.5 10z"/>',
  sprout: '<path d="M12 21v-8.5"/><path d="M12 12.5C12 8.5 9.5 6 5 6c0 4 2.5 6.5 7 6.5zM12 14.5c0-3.6 2.4-6 6.5-6 0 3.6-2.4 6-6.5 6z"/><path d="M7 21h10"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h11l-2 3.5 2 3.5h-11"/>',
  mountain: '<path d="M3 19.5 9.5 8l4 6.5 2.5-4 5 9z"/>',
  water: '<path d="M12 4s5.5 6 5.5 10a5.5 5.5 0 0 1-11 0C6.5 10 12 4 12 4z"/>',
  cross: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  bank: '<path d="M3.5 9.5 12 4l8.5 5.5z"/><path d="M5.5 10v8M10 10v8M14 10v8M18.5 10v8M3.5 20h17"/>',
  gate: '<rect x="3.5" y="6" width="17" height="13" rx="1"/><path d="M7.7 6v13M12 6v13M16.3 6v13M3.5 3.5h17"/>',
  news: '<rect x="3.5" y="5" width="13" height="14" rx="1.5"/><path d="M16.5 8.5h3.5V17a2 2 0 0 1-4 0M6.5 9h7M6.5 12h7M6.5 15h4.5"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="M15 5.5 8.5 12l6.5 6.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
};

/**
 * SVG のアイコン要素を返す。
 * @param {keyof P} name
 * @param {{size?:number, cls?:string}} opts
 */
export function icon(name, { size = 24, cls = '' } = {}) {
  const span = document.createElement('span');
  span.className = `ico${cls ? ` ${cls}` : ''}`;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
  return span;
}

export const ICON_NAMES = Object.keys(P);
