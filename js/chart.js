// Tiny SVG charts with hover/tap tooltips. One series per chart, recessive grid, thin marks.
const W = 340, H = 170, PL = 36, PR = 10, PT = 12, PB = 24;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function niceTicks(min, max, n = 4) {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || mag * 10;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(6));
  return out;
}

const shortDate = (s) => { const [, m, d] = s.split('-').map(Number); return `${d}/${m}`; };

/** Line chart for weight: points [{x:'YYYY-MM-DD', y:number}] */
export function lineChart(points, { unit = 'kg', label = 'Weight' } = {}) {
  if (points.length < 2) return '';
  const ts = points.map((p) => new Date(p.x + 'T00:00').getTime());
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const ys = points.map((p) => p.y);
  const ticks = niceTicks(Math.min(...ys) - 0.5, Math.max(...ys) + 0.5);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const sx = (t) => PL + ((t - t0) / (t1 - t0 || 1)) * (W - PL - PR);
  const sy = (v) => PT + (1 - (v - y0) / (y1 - y0 || 1)) * (H - PT - PB);
  const pts = points.map((p, i) => ({ X: sx(ts[i]), Y: sy(p.y), lab: `${shortDate(p.x)} · ${p.y} ${unit}` }));
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.X.toFixed(1)},${p.Y.toFixed(1)}`).join('');
  const grid = ticks.map((v) => `<line x1="${PL}" x2="${W - PR}" y1="${sy(v)}" y2="${sy(v)}"/>`).join('');
  const yl = ticks.map((v) => `<text x="${PL - 6}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const xl = [0, pts.length - 1].map((i) => `<text x="${pts[i].X}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${shortDate(points[i].x)}</text>`).join('');
  const markers = pts.length <= 40 ? pts.map((p) => `<circle class="pt" r="4" cx="${p.X}" cy="${p.Y}"/>`).join('') : '';
  return `<div class="chart" data-chart='${esc(JSON.stringify(pts))}' role="img" aria-label="${esc(label)} chart">
    <svg viewBox="0 0 ${W} ${H}"><g class="grid">${grid}</g><g class="axis">${yl}${xl}</g>
    <path class="series" d="${path}"/>${markers}<line class="hover-line hidden" y1="${PT}" y2="${H - PB}"/></svg><div class="tip hidden"></div></div>`;
}

/** Bars with a dashed target line: rows [{x:'YYYY-MM-DD', y, target}] */
export function barChart(rows, { unit = 'kcal', label = 'Calories' } = {}) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => Math.max(r.y, r.target || 0)), 1);
  const ticks = niceTicks(0, max * 1.05);
  const y1 = ticks[ticks.length - 1];
  const sy = (v) => PT + (1 - v / y1) * (H - PT - PB);
  const bw = (W - PL - PR) / rows.length;
  const pts = [];
  const bars = rows.map((r, i) => {
    const x = PL + i * bw + bw * 0.2, w = bw * 0.6, top = sy(r.y), h = Math.max(0, sy(0) - top);
    pts.push({ X: x + w / 2, Y: top, lab: `${shortDate(r.x)} · ${Math.round(r.y)} / ${Math.round(r.target)} ${unit}` });
    const rad = Math.min(4, w / 2, h);
    const d = h > 0 ? `M${x},${sy(0)}V${top + rad}Q${x},${top} ${x + rad},${top}H${x + w - rad}Q${x + w},${top} ${x + w},${top + rad}V${sy(0)}Z` : '';
    return `<path class="bar ${r.target && r.y > r.target * 1.05 ? 'over' : ''}" d="${d}"/>`;
  }).join('');
  const target = rows[rows.length - 1].target;
  const grid = ticks.map((v) => `<line x1="${PL}" x2="${W - PR}" y1="${sy(v)}" y2="${sy(v)}"/>`).join('');
  const yl = ticks.map((v) => `<text x="${PL - 6}" y="${sy(v) + 4}" text-anchor="end">${v >= 1000 ? (v / 1000) + 'k' : v}</text>`).join('');
  const xl = rows.map((r, i) => `<text x="${PL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(r.x + 'T00:00').getDay()]}</text>`).join('');
  const tl = target ? `<line class="target" x1="${PL}" x2="${W - PR}" y1="${sy(target)}" y2="${sy(target)}"/>` : '';
  return `<div class="chart" data-chart='${esc(JSON.stringify(pts))}' role="img" aria-label="${esc(label)} chart">
    <svg viewBox="0 0 ${W} ${H}"><g class="grid">${grid}</g><g class="axis">${yl}${xl}</g>${bars}${tl}<line class="hover-line hidden" y1="${PT}" y2="${H - PB}"/></svg><div class="tip hidden"></div></div>`;
}

/** Attach nearest-point tooltips to every chart inside root. */
export function bindCharts(root) {
  root.querySelectorAll('.chart[data-chart]').forEach((el) => {
    const pts = JSON.parse(el.dataset.chart);
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), line = el.querySelector('.hover-line');
    const show = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * W;
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.X - x) < Math.abs(best.X - x)) best = p;
      tip.textContent = best.lab;
      tip.style.left = (best.X / W) * r.width + 'px';
      tip.style.top = (best.Y / H) * r.height + 'px';
      tip.classList.remove('hidden');
      line.setAttribute('x1', best.X); line.setAttribute('x2', best.X); line.classList.remove('hidden');
    };
    const hide = () => { tip.classList.add('hidden'); line.classList.add('hidden'); };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  });
}
