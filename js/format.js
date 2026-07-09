window.JF = window.JF || {};

(function (JF) {

  // ---- 원 <-> 만원 --------------------------------------------------

  function formatWon(n) {
    var num = Math.round(Number(n) || 0);
    var neg = num < 0;
    var s = Math.abs(num).toString();
    var withCommas = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + withCommas;
  }

  // 원 -> 만원(천원 단위 소수 1자리). 예: 32000 -> 3.2, 30000 -> 3, 12340000 -> 1234.
  // 저장은 정수 원 유지, 표시/입력만 0.1만(천원) 정밀도.
  function toMan(n) {
    var num = Number(n) || 0;
    return Math.round(num / 1000) / 10;
  }

  // 만원(소수 허용) -> 원. 예: 3.2 -> 32000. 정수 입력 하위호환.
  function fromMan(man) {
    var num = Number(man) || 0;
    return Math.round(num * 10000);
  }

  // 표시용 만원 문자열, "만" 접미사 없음. 콤마 그룹핑 + 선택적 소수 1자리, 부호 안전.
  // 정수-tenths 기반이라 음수 floor 버그(-3.2 -> -4) 회피.
  // formatManNum(12340000)="1,234", formatManNum(32000)="3.2", formatManNum(-32000)="-3.2", formatManNum(0)="0".
  function formatManNum(n) {
    var t = Math.round((Number(n) || 0) / 1000); // 부호 유지 천원(0.1만) 단위 정수
    var neg = t < 0;
    var a = Math.abs(t);
    var intMan = Math.floor(a / 10);
    var frac = a % 10;
    var s = formatWon(intMan) + (frac ? ('.' + frac) : '');
    return (neg ? '-' : '') + s;
  }

  // 표시용 만원 문자열 + "만" 접미사. (라벨용; 밀집 셀은 formatManNum 사용)
  function formatMan(n) {
    return formatManNum(n) + '만';
  }

  // ---- 월(YYYY-MM) 유틸 ----------------------------------------------

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function ym(dateOrStr) {
    if (dateOrStr instanceof Date) {
      return dateOrStr.getFullYear() + '-' + pad2(dateOrStr.getMonth() + 1);
    }
    if (typeof dateOrStr === 'string') {
      // "YYYY-MM-DD" 또는 "YYYY-MM" 모두 앞 7자리가 "YYYY-MM"
      return dateOrStr.slice(0, 7);
    }
    return null;
  }

  function parseYm(ymStr) {
    var parts = ymStr.split('-');
    return { y: parseInt(parts[0], 10), m: parseInt(parts[1], 10) };
  }

  function ymAdd(ymStr, deltaMonths) {
    var p = parseYm(ymStr);
    var total = p.y * 12 + (p.m - 1) + deltaMonths;
    var newY = Math.floor(total / 12);
    var newM = ((total % 12) + 12) % 12 + 1;
    return newY + '-' + pad2(newM);
  }

  function ymCompare(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  function ymRange(startYm, endYm) {
    var result = [];
    var cur = startYm;
    var guard = 0;
    while (ymCompare(cur, endYm) <= 0 && guard < 5000) {
      result.push(cur);
      cur = ymAdd(cur, 1);
      guard++;
    }
    return result;
  }

  // month1 = 1~12 (달력 표기 규약)
  function daysInMonth(year, month1) {
    return new Date(year, month1, 0).getDate();
  }

  JF.format = {
    formatWon: formatWon,
    toMan: toMan,
    fromMan: fromMan,
    formatManNum: formatManNum,
    formatMan: formatMan,
    ym: ym,
    ymAdd: ymAdd,
    ymCompare: ymCompare,
    ymRange: ymRange,
    daysInMonth: daysInMonth
  };

})(window.JF);
