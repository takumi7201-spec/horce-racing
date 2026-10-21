// DOM の小物。
// フレームワークを入れない代わりに、ここだけで「要素を組む」語彙を揃える。
// シミュレーション層は DOM を知らないので、変換はすべて画面側の責任。

/**
 * el('div.card', {onclick}, [子...]) の形で要素を作る。
 * タグ名に .cls と #id を書ける。
 */
export function el(spec, attrs = null, children = null) {
  let tag = 'div', id = null;
  const classes = [];
  const m = String(spec).match(/^([a-zA-Z0-9]+)?((?:[.#][\w-]+)*)$/);
  if (m) {
    if (m[1]) tag = m[1];
    for (const part of (m[2] || '').match(/[.#][\w-]+/g) ?? []) {
      if (part[0] === '.') classes.push(part.slice(1));
      else id = part.slice(1);
    }
  } else {
    tag = spec;
  }
  const node = document.createElement(tag);
  if (classes.length) node.className = classes.join(' ');
  if (id) node.id = id;

  // 第 2 引数が子要素だけのこともある。
  if (Array.isArray(attrs) || typeof attrs === 'string' || attrs instanceof Node) {
    children = attrs;
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
      else if (k in node && k !== 'list') node[k] = v;
      else node.setAttribute(k, v);
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  if (children == null || children === false) return node;
  if (Array.isArray(children)) {
    for (const c of children) append(node, c);
    return node;
  }
  node.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  return node;
}

export const clear = (node) => { node.textContent = ''; return node; };

/** 表。head は見出しの配列、rows は行（セルの配列、または {cells, onclick, cls}）。 */
export function table(head, rows, { cls = '', align = [] } = {}) {
  const t = el(`table.tbl${dot(cls)}`);
  if (head) {
    const tr = el('tr');
    head.forEach((h, i) => tr.appendChild(el('th', { text: h, class: align[i] ? `a-${align[i]}` : null })));
    t.appendChild(el('thead', tr));
  }
  const tb = el('tbody');
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : row.cells;
    const tr = el('tr', {
      onclick: row.onclick, class: [row.cls, row.onclick ? 'clickable' : null].filter(Boolean).join(' ') || null,
    });
    cells.forEach((c, i) => {
      const td = el('td', { class: align[i] ? `a-${align[i]}` : null });
      append(td, c);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  return t;
}

/** 'sm primary' のような空白区切りのクラス指定を el() のセレクタ形に直す。 */
const dot = (cls) => (cls ? `.${String(cls).trim().split(/\s+/).join('.')}` : '');

/** 見出し付きの区画。 */
export function card(title, children, { cls = '', actions = null } = {}) {
  return el(`section.card${dot(cls)}`, [
    title ? el('header.card-h', [el('h2', { text: title }), actions]) : null,
    el('div.card-b', children),
  ]);
}

export function button(label, onclick, { cls = '', disabled = false, title = '' } = {}) {
  return el(`button.btn${dot(cls)}`, { text: label, onclick, disabled, title });
}

/** 横並びのラベル付き値。 */
export function kv(pairs, { cls = '' } = {}) {
  return el(`dl.kv${dot(cls)}`, pairs.flatMap(([k, v]) => [
    el('dt', { text: k }), el('dd', v instanceof Node ? v : { text: String(v) }),
  ]));
}

/** 0..1 を横棒で見せる。能力・適性の表示に使う。 */
export function bar(value, { label = '', color = null, max = 1 } = {}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return el('div.bar', [
    label ? el('span.bar-l', { text: label }) : null,
    el('div.bar-t', el('div.bar-f', { style: { width: `${pct}%`, background: color || '' } })),
  ]);
}

/** タブ。 */
export function tabs(items, current, onPick) {
  return el('nav.tabs', items.map((it) => el('button.tab', {
    text: it.name,
    class: it.id === current ? 'on' : null,
    onclick: () => onPick(it.id),
  })));
}

/** モーダル。close() で閉じる。 */
export function modal(title, body, { onClose = null, wide = false } = {}) {
  const close = () => {
    wrap.remove();
    if (onClose) onClose();
  };
  const wrap = el('div.modal-wrap', {
    onclick: (e) => { if (e.target === wrap) close(); },
  }, el(`div.modal${wide ? '.wide' : ''}`, [
    el('header.modal-h', [el('h2', { text: title }), button('✕', close, { cls: 'ghost' })]),
    el('div.modal-b', body),
  ]));
  document.body.appendChild(wrap);
  return { close, wrap };
}

/** 画面下に出す短い通知。 */
let toastTimer = 0;
export function toast(msg, { bad = false } = {}) {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('div#toast');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = bad ? 'show bad' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2600);
}

/** 枠色のしるし。 */
const FRAME_CSS = ['#fff', '#1c1c1c', '#d42b2b', '#2a62c8', '#f2d024', '#1e9c4a', '#ee7d26', '#f2a0c0'];
const FRAME_FG = ['#111', '#fff', '#fff', '#fff', '#111', '#fff', '#111', '#111'];
export function frameChip(frame, gate) {
  const i = (Math.max(1, Math.min(8, frame || 1)) - 1);
  return el('span.chip', {
    text: String(gate ?? frame),
    style: { background: FRAME_CSS[i], color: FRAME_FG[i] },
  });
}

export { FRAME_CSS };
