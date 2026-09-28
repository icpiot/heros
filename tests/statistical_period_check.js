const fs = require('fs');
const path = require('path');
const vm = require('vm');

let source = fs.readFileSync(path.join(__dirname, '..', 'examples', 'www', 'heros-report-card.008.js'), 'utf8')
  .replace('class ByteWattReportCard extends HTMLElement',
           'globalThis.ByteWattReportCard = class ByteWattReportCard extends HTMLElement');
class HTMLElement {}
const ctx = { console, HTMLElement, customElements: undefined,
  window: { customCards: [] }, setTimeout, clearTimeout, Date, Math, Number,
  String, Array, Map, Set, Object };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(source, ctx);
const statisticalBlock = source.match(/const HEROS_STATISTICAL_PERIODS = \[(.*?)\];/s)?.[1] || '';
if (/label: "(?:1H|6H|12H|24H)"/.test(statisticalBlock) ||
    !['Day', 'Week', 'Month', 'Quarter', 'Year'].every(label => statisticalBlock.includes(`label: "${label}"`))) {
  throw new Error('Statistical Diagram period selector contains the wrong periods');
}
const card = Object.create(ctx.ByteWattReportCard.prototype);
card._selectedReportDate = () => '2026-09-25';
card._parseLocalDate = d => new Date(d + 'T00:00:00');
card._todayLocalDate = () => new Date('2026-09-25T00:00:00');
card._formatLocalDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
card._timeSeriesPointCount = () => 3;
card._powerDiagramUsesKw = () => true;
card._historyRecordForDate = () => ({power_diagram: {
  time: ['00:00', '12:00', '24:00'],
  series: {solar: [0, 1, 0], load: [1, 2, 1]},
}});
card._powerDiagramFromRecord = r => r.power_diagram;
card._isTodaySelection = () => false;
card._timeLabelToMinutesOfDay = t => ({'00:00': 0, '12:00': 720, '24:00': 1440})[t];
card._providerDataCutoffMinutes = () => 1440;
card._powerAxisScale = () => ({max: 2, ticks: [0, 1, 2]});
card._fmtNumber = n => String(n);
card._escape = x => String(x);
card._renderReportNavigation = () => '';
card._legendButton = () => '';
card._displayTimeLabel = x => x;
card._summaryCards = () => [];
card._chartViewportWidth = 900;
const report = {power_diagram: {
  time: ['00:00', '12:00', '24:00'],
  series: {solar: [0, 1, 0], load: [1, 2, 1]},
}};
for (const period of ['week', 'month', 'quarter', 'year']) {
  card._statisticalPeriod = period;
  const html = card._renderStatsDiagram(report, null, false);
  if (!html.includes('HEROS statistical power line chart') ||
      !html.includes('2026-09-25')) {
    throw new Error(`${period} chart did not render its selected date`);
  }
  if (period === 'week' &&
      !['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22',
        '2026-09-23', '2026-09-24', '2026-09-25'].every(d => html.includes(d))) {
    throw new Error('week chart did not render all seven date labels');
  }
}
console.log('Multi-day Statistical Diagram periods render correctly');
