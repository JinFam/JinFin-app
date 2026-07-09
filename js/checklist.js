// checklist.js — JF.checklist: D-Day 체크리스트 순수 계산 코어.
// DOM/localStorage/Date.now() 금지(오늘 판정은 app 계층). calc/머니 도메인과 분리.
window.JF = window.JF || {};

(function (JF) {

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // "YYYY-MM-DD" -> {y,m,d} 정수 파싱
  function parseYmd(s) {
    var p = String(s).split('-');
    return { y: parseInt(p[0], 10), m: parseInt(p[1], 10), d: parseInt(p[2], 10) };
  }

  // b - a 일수(정수). UTC 기준이라 로컬 TZ off-by-one 없음.
  function daysBetween(aYmd, bYmd) {
    var a = parseYmd(aYmd), b = parseYmd(bYmd);
    var au = Date.UTC(a.y, a.m - 1, a.d);
    var bu = Date.UTC(b.y, b.m - 1, b.d);
    return Math.round((bu - au) / 86400000);
  }

  // 오프셋(부호): 대상 날짜 - dDay. 이전이면 음수(D-10 -> -10), 이후면 양수(D+3 -> +3).
  function offsetOf(ymd, dDay) {
    return daysBetween(dDay, ymd);
  }

  // 공용 배정 규칙(B1 이중규칙). assignGroup / groupForDate가 이 함수를 공유 → 색 패리티 보장.
  //  o <= 0 (D-Day 이전/당일): g <= o 인 그룹 오프셋 중 최대(더 이른 마일스톤). 없으면 가장 이른 그룹으로 clamp.
  //  o >  0 (D-Day 이후)     : g >= o 인 그룹 오프셋 중 최소(더 늦은 마일스톤). 없으면 가장 늦은 그룹으로 clamp.
  function groupForOffset(o, groups) {
    if (!groups || !groups.length) return null;
    var sorted = groups.slice().sort(function (x, y) { return x.offsetDays - y.offsetDays; });
    var i;
    if (o <= 0) {
      var pick = null;
      for (i = 0; i < sorted.length; i++) { if (sorted[i].offsetDays <= o) pick = sorted[i]; }
      return pick || sorted[0];                    // clamp: 가장 이른 그룹
    }
    for (i = 0; i < sorted.length; i++) { if (sorted[i].offsetDays >= o) return sorted[i]; }
    return sorted[sorted.length - 1];              // clamp: 가장 늦은 그룹
  }

  // 항목 -> 그룹(자동배정). 그룹 0개면 null(미분류).
  function assignGroup(item, checklist) {
    if (!item || !item.targetDate || !checklist || !checklist.dDay) return null;
    return groupForOffset(offsetOf(item.targetDate, checklist.dDay), checklist.groups);
  }

  // 특정 날짜 -> 그룹. assignGroup과 동일 로직 → 그 날짜 항목의 그룹색과 일치.
  function groupForDate(ymd, checklist) {
    if (!ymd || !checklist || !checklist.dDay) return null;
    return groupForOffset(offsetOf(ymd, checklist.dDay), checklist.groups);
  }

  // 상태 파생: 상세내용 체크박스 기준. 0=예정, 일부=진행중, 전부=완료. 상세 없으면 예정.
  function itemStatus(item) {
    var d = (item && item.details) || [];
    if (!d.length) return '예정';
    var checked = 0;
    for (var i = 0; i < d.length; i++) { if (d[i].checked) checked++; }
    if (checked === 0) return '예정';
    if (checked === d.length) return '완료';
    return '진행중';
  }

  // 캘린더 날짜 배열: startDate ~ (dDay + 1개월)의 말일. "YYYY-MM-DD" 리스트.
  function calendarRange(checklist) {
    if (!checklist || !checklist.startDate || !checklist.dDay) return [];
    var s = parseYmd(checklist.startDate);
    var d = parseYmd(checklist.dDay);
    var ey = d.y, em = d.m + 1;                    // dDay + 1개월
    if (em > 12) { em -= 12; ey += 1; }
    var lastDay = JF.format.daysInMonth(ey, em);   // format.js: month1(1-12)
    var cur = Date.UTC(s.y, s.m - 1, s.d);
    var end = Date.UTC(ey, em - 1, lastDay);
    var out = [], guard = 0;
    while (cur <= end && guard < 3000) {
      var dt = new Date(cur);
      out.push(dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate()));
      cur += 86400000;
      guard++;
    }
    return out;
  }

  JF.checklist = {
    daysBetween: daysBetween,
    offsetOf: offsetOf,
    assignGroup: assignGroup,
    groupForDate: groupForDate,
    itemStatus: itemStatus,
    calendarRange: calendarRange
  };

})(window.JF);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window.JF.checklist : null);
}
