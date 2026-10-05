/* Local monthly series shared by the archive's data modules. */
function lineChart(rows, key = 'mentions', options = {}) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const label = options.label || (key === 'char_count' ? '月度字数' : '月度提及');
  const unit = options.unit || (key === 'char_count' ? '字' : '次');
  const monthly = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(row?.month || '');
    if (!match || Number(match[1]) < 1 || row[key] == null || row[key] === '') continue;
    const value = Number(row[key]);
    if (!Number.isFinite(value) || value < 0) continue;
    const previous = monthly.get(row.month);
    monthly.set(row.month, {month:row.month, value:(previous?.value || 0) + value, time:Number(match[1]) * 12 + Number(match[2]) - 1});
  }
  const items = [...monthly.values()].sort((a, b) => a.time - b.time);
  if (!items.length) return `<div class="lineChartEmpty" role="status">${escape(options.emptyText || '暂无月度记录')}</div>`;
  const format = value => value.toLocaleString('zh-CN', {maximumFractionDigits:2});
  const largest = Math.max(...items.map(item => item.value));
  const scale = largest > 0 ? 10 ** Math.floor(Math.log10(largest)) : 1;
  const maximum = largest > 0 ? Math.ceil(largest / scale) * scale : 1;
  const first = items[0].time, span = items[items.length - 1].time - first;
  const plotWidth = 600, plotHeight = 180;
  const points = items.map(item => ({...item, x:span ? (item.time - first) / span * plotWidth : plotWidth / 2, y:plotHeight - item.value / maximum * plotHeight}));
  const middle = points.reduce((closest,p,i) => Math.abs(p.x - plotWidth / 2) < Math.abs(points[closest].x - plotWidth / 2) ? i : closest, 0);
  const ticks = [...new Set([0, ...(points[middle].x > plotWidth * .25 && points[middle].x < plotWidth * .75 ? [middle] : []), items.length - 1])];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const description = `${items[0].month} 至 ${items[items.length - 1].month}，${items.length} 个记录月份，共 ${format(total)} ${unit}`;
  return `<figure class="lifeLineChart">
    <figcaption><span>${escape(label)}</span><span>${escape(unit)}</span></figcaption>
    <div class="lineChartGrid"><div class="lineChartY" aria-hidden="true"><span>${format(maximum)}</span><span>${format(maximum / 2)}</span><span>0</span></div>
      <div class="lineChartPlot"><svg viewBox="-5 -6 610 192" preserveAspectRatio="none" role="img" aria-label="${escape(label + ' · ' + description)}"><title>${escape(label)}</title><desc>${escape(description)}</desc>
        ${[0, plotHeight / 2, plotHeight].map(y => `<line class="lineChartGuide" x1="0" x2="${plotWidth}" y1="${y}" y2="${y}"/>`).join('')}
        ${points.length > 1 ? `<polyline class="lineChartStroke" points="${points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}"/>` : ''}
        ${points.map(p => `<circle class="lineChartPoint" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="2.5"><title>${escape(p.month)} · ${format(p.value)} ${escape(unit)}</title></circle>`).join('')}
      </svg><div class="lineChartX" aria-hidden="true">${ticks.map(i => `<time class="${i === 0 && span ? 'first' : i === items.length - 1 && span ? 'last' : ''}" style="left:${(points[i].x / plotWidth * 100).toFixed(2)}%">${escape(items[i].month)}</time>`).join('')}</div></div>
    </div><details class="lineChartDetails"><summary>月度数据</summary><table><thead><tr><th scope="col">月份</th><th scope="col">${escape(label)}（${escape(unit)}）</th></tr></thead><tbody>${items.map(item => `<tr><th scope="row">${escape(item.month)}</th><td>${format(item.value)}</td></tr>`).join('')}</tbody></table></details>
  </figure>`;
}
