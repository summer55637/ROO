/* RO 水波核心數學：半徑擴張、透明度衰減與輸入邊界。 */
const H = require('./harness');
const g = H.boot();
const t = H.tester();
const water = g.ROWaterEffect;

t.ok('水波模組載入', !!water && typeof water.rippleFrame === 'function');
const start = water.rippleFrame(0, 100);
const middle = water.rippleFrame(0.5, 100);
const end = water.rippleFrame(1, 100);
t.eq('初始波紋半徑從水滴開始', start.radius, 12);
t.eq('完整波紋抵達最大半徑', end.radius, 100);
t.ok('波紋擴散且透明度逐步衰減',
  middle.radius > start.radius && middle.radius < end.radius
  && middle.opacity < start.opacity && middle.opacity > end.opacity);
t.eq('波紋到達壽命終點時消失', end.opacity, 0);
t.eq('負進度限制在波紋起點', water.rippleFrame(-1, 100).radius, 12);
t.eq('超時進度限制在波紋終點', water.rippleFrame(4, 100).opacity, 0);
t.ok('動態水紋位移保持有限值', Number.isFinite(water.waveOffset(120, 45, 1500)));

process.exit(t.report('RO 水波特效'));
