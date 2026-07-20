// js/realestate.js — JF.realestate: 부동산 예산 탭의 순수 계산 모듈. state/DOM 미참조.
// Node 테스트 지원을 위한 UMD 가드(loan.js와 동일 패턴).
var JF = (typeof window !== 'undefined')
  ? (window.JF = window.JF || {})
  : (typeof global !== 'undefined' ? (global.JF = global.JF || {}) : {});

(function (JF) {

  function sumColumn(items, columnId) {
    return (items || []).reduce(function (sum, it) {
      var v = it && it.values ? Number(it.values[columnId]) : 0;
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
  }

  // computeTotals(snapshot) -> [{ columnId, budgetTotal, costTotal, finalTotal }]
  // budgetTotal(예산 총계)=매도비용 합(마이너스 허용), costTotal(비용 총계)=매수비용 합,
  // finalTotal(최종 총계)=budgetTotal-costTotal.
  function computeTotals(snapshot) {
    var columns = (snapshot && snapshot.columns) || [];
    return columns.map(function (col) {
      var budgetTotal = sumColumn(snapshot.sellItems, col.id);
      var costTotal = sumColumn(snapshot.buyItems, col.id);
      return { columnId: col.id, budgetTotal: budgetTotal, costTotal: costTotal, finalTotal: budgetTotal - costTotal };
    });
  }

  // 외부 폰트/CDN 금지(styles.css 상단 주석) -> 고정 프리셋만 제공.
  var FONT_PRESETS = {
    'default': {},
    'bold': { fontWeight: '700' },
    'italic': { fontStyle: 'italic' },
    'bold-italic': { fontWeight: '700', fontStyle: 'italic' },
    'mono': { fontFamily: 'var(--jf-font-mono)' }
  };

  // cellStyleToCss(cellStyle) -> el()의 style 속성에 바로 넣을 수 있는 plain object.
  function cellStyleToCss(cellStyle) {
    var out = {};
    if (cellStyle && cellStyle.bg) out.background = cellStyle.bg;
    var preset = FONT_PRESETS[(cellStyle && cellStyle.fontPreset) || 'default'] || {};
    Object.keys(preset).forEach(function (k) { out[k] = preset[k]; });
    return out;
  }

  JF.realestate = {
    computeTotals: computeTotals,
    cellStyleToCss: cellStyleToCss,
    FONT_PRESETS: FONT_PRESETS,
    sumColumn: sumColumn
  };

})(JF);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = JF.realestate;
}
