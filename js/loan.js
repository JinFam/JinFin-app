// js/loan.js — JF.loan: 순수 상환 엔진(대출계산기 plan §3). DOM/JF.ui/location/fetch 금지.
// 최종금리 연동 해석은 호출자(app-loan.js)가 사전에 처리해 숫자 annualRate를 넘긴다.
// Node 테스트 지원을 위한 UMD 가드(calc.js와 동일 패턴).
var JF = (typeof window !== 'undefined')
  ? (window.JF = window.JF || {})
  : (typeof global !== 'undefined' ? (global.JF = global.JF || {}) : {});

(function (JF) {

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // addMonths(startDate, k) — 원점 기준(직전 날짜 누적 금지). k=1이면 startDate+1개월.
  // 일자는 대상 월의 실제 일수로 클램프(1/31 +2mo -> 3/31, 3/28 아님).
  function addMonths(startDate, k) {
    var parts = String(startDate).split('-');
    var y0 = parseInt(parts[0], 10);
    var m0 = parseInt(parts[1], 10);
    var d0 = parseInt(parts[2], 10);
    var total = (m0 - 1) + k; // 0-indexed 월 오프셋(원점 = startDate 월)
    var targetY = y0 + Math.floor(total / 12);
    var targetM = ((total % 12) + 12) % 12 + 1;
    var dim = (JF.format && typeof JF.format.daysInMonth === 'function')
      ? JF.format.daysInMonth(targetY, targetM)
      : new Date(targetY, targetM, 0).getDate();
    var day = Math.min(d0, dim);
    return targetY + '-' + pad2(targetM) + '-' + pad2(day);
  }

  function monthlyRate(annual) {
    return (Number(annual) || 0) / 100 / 12;
  }

  // annuity(B, r, m) — 원리금균등 월납입액(실수). r===0이면 단순 분할.
  function annuity(B, r, m) {
    if (r === 0) return B / m;
    var pow = Math.pow(1 + r, m);
    return B * r * pow / (pow - 1);
  }

  function zeroSummary() {
    return {
      amount: 0,
      termMonths: 0,
      actualMonths: 0,
      graceMonths: 0,
      annualRate: 0,
      hasRateChanges: false,
      firstMonthlyPayment: 0,
      totalInterest: 0
    };
  }

  // computeSchedule(resolvedCase) -> {summary, rows[]}
  // resolvedCase: { amount, termMonths, annualRate(숫자, 사전해석 완료), graceMonths,
  //   startDate, extraPayment:{amount,fromInstallment}, prepayments:[{installment,amount}],
  //   rateChanges:[{fromInstallment,annualRate}] }
  function computeSchedule(resolvedCase) {
    resolvedCase = resolvedCase || {};
    var amount = Number(resolvedCase.amount) || 0;
    var N = Math.floor(Number(resolvedCase.termMonths) || 0);

    if (amount <= 0 || N < 1) {
      return { rows: [], summary: zeroSummary() };
    }

    var g = clamp(Math.floor(Number(resolvedCase.graceMonths) || 0), 0, Math.max(0, N - 1));
    var annualRate = Number(resolvedCase.annualRate) || 0;
    var startDate = resolvedCase.startDate || null;

    // 방어: installment<=0 또는 >N인 이벤트는 무시.
    var rateChanges = (Array.isArray(resolvedCase.rateChanges) ? resolvedCase.rateChanges : [])
      .map(function (rc) { return { fromInstallment: Math.floor(Number(rc && rc.fromInstallment)), annualRate: Number(rc && rc.annualRate) || 0 }; })
      .filter(function (rc) { return rc.fromInstallment >= 1 && rc.fromInstallment <= N; });

    var prepayments = (Array.isArray(resolvedCase.prepayments) ? resolvedCase.prepayments : [])
      .map(function (p) { return { installment: Math.floor(Number(p && p.installment)), amount: Number(p && p.amount) || 0 }; })
      .filter(function (p) { return p.installment >= 1 && p.installment <= N && p.amount > 0; });

    var extra = resolvedCase.extraPayment || {};
    var extraAmount = Number(extra.amount) || 0;
    var extraFrom = Math.floor(Number(extra.fromInstallment)) || 0;
    var extraStart = extraFrom >= 1 ? extraFrom : 1; // 시작 회차 미지정(0) → 1회차부터. 거치기간 포함 적용.
    var extraTo = Math.floor(Number(extra.toInstallment)) || 0;
    var extraEnd = extraTo >= 1 ? extraTo : Infinity; // 끝 회차 미지정(0) → 만기(또는 조기상환)까지.

    function effectiveAnnual(k) {
      var best = null;
      for (var i = 0; i < rateChanges.length; i++) {
        var rc = rateChanges[i];
        if (rc.fromInstallment <= k && (best === null || rc.fromInstallment > best.fromInstallment)) best = rc;
      }
      return best ? best.annualRate : annualRate;
    }

    function isRateChangeAt(k) {
      for (var i = 0; i < rateChanges.length; i++) if (rateChanges[i].fromInstallment === k) return true;
      return false;
    }

    function lumpAt(k) {
      var sum = 0;
      for (var i = 0; i < prepayments.length; i++) if (prepayments[i].installment === k) sum += prepayments[i].amount;
      return sum;
    }

    var rows = [];
    var B = amount;
    var A_int = null;
    var firstMonthlyPayment = 0;
    var totalInterest = 0;

    for (var k = 1; k <= N; k++) {
      var rAnnual = effectiveAnnual(k);
      var r = monthlyRate(rAnnual);
      var interest = Math.round(B * r);
      var date = startDate ? addMonths(startDate, k) : null;

      if (k <= g) {
        // 거치: 예정 원금은 0(이자만)이지만, 월 추가 원금(시작 회차부터)과 중도상환(목돈)은
        // 거치 중에도 원금을 상환해 잔액을 줄인다. 잔액 초과분은 정리(전액 상환 시 조기 종료).
        var gExtra = (extraAmount > 0 && k >= extraStart && k <= extraEnd) ? extraAmount : 0;
        var gLump = lumpAt(k);
        var gPrincipal = gExtra + gLump;
        if (gPrincipal > B) gPrincipal = B;
        var gFinal = gPrincipal >= B; // 원금 상환이 잔액을 모두 갚으면 종료
        B = B - gPrincipal;
        totalInterest += interest;
        rows.push({ n: k, date: date, principal: gPrincipal, interest: interest, payment: interest + gPrincipal, balance: B, prepay: gLump });
        if (gFinal) break;
        continue;
      }

      // A 재계산 트리거: 거치종료 직후(k===g+1) 또는 금리변동 회차.
      if (k === g + 1 || isRateChangeAt(k)) {
        A_int = Math.round(annuity(B, r, N - k + 1));
        if (k === g + 1) firstMonthlyPayment = A_int;
      }

      var scheduledPrincipal = A_int - interest;
      var extraAmt = (extraAmount > 0 && k >= extraStart && k <= extraEnd) ? extraAmount : 0;
      var lump = lumpAt(k);
      var principal = scheduledPrincipal + extraAmt + lump;
      var payment = interest + principal;
      var final = false;

      if (principal >= B || k === N) {
        principal = B;
        payment = interest + principal;
        final = true;
      }

      B = B - principal;
      totalInterest += interest;
      rows.push({ n: k, date: date, principal: principal, interest: interest, payment: payment, balance: B, prepay: lump });

      if (lump > 0 && !final) {
        A_int = Math.round(annuity(B, r, N - k));
      }

      if (final) break;
    }

    var summary = {
      amount: amount,
      termMonths: N,
      actualMonths: rows.length,
      graceMonths: g,
      annualRate: annualRate,
      hasRateChanges: rateChanges.length > 0,
      firstMonthlyPayment: firstMonthlyPayment,
      totalInterest: totalInterest
    };

    return { rows: rows, summary: summary };
  }

  JF.loan = {
    computeSchedule: computeSchedule,
    addMonths: addMonths
  };

})(JF);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = JF.loan;
}
