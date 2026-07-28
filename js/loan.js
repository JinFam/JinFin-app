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
        rows.push({ n: k, date: date, principal: gPrincipal, interest: interest, payment: interest + gPrincipal, balance: B, prepay: gLump, extraApplied: gExtra });
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
      rows.push({ n: k, date: date, principal: principal, interest: interest, payment: payment, balance: B, prepay: lump, extraApplied: extraAmt });

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

  // daysBetween(dateA, dateB) — "YYYY-MM-DD" 두 날짜의 캘린더 일수 차(dateB - dateA).
  // UTC 자정 기준 차이라 로컬 타임존/DST 영향 없음(addMonths는 문자열 클램프, 이건 순수 일수).
  function daysBetween(dateA, dateB) {
    var a = String(dateA).split('-');
    var b = String(dateB).split('-');
    var ua = Date.UTC(parseInt(a[0], 10), parseInt(a[1], 10) - 1, parseInt(a[2], 10));
    var ub = Date.UTC(parseInt(b[0], 10), parseInt(b[1], 10) - 1, parseInt(b[2], 10));
    return Math.round((ub - ua) / 86400000);
  }

  // computePrepayFeeSchedule(resolvedCase, rows) — 각 회차 시점에 잔액 전부를 갚으면 발생할
  // 중도상환수수료(prepayFeeFull)를 회차별로 계산해 rows의 얕은 복제본 배열로 반환(입력 rows 불변).
  // rows는 computeSchedule(resolvedCase).rows(각 행에 n,date,principal,interest,payment,balance,prepay).
  function computePrepayFeeSchedule(resolvedCase, rows) {
    resolvedCase = resolvedCase || {};
    rows = Array.isArray(rows) ? rows : [];

    var fee = resolvedCase.prepayFee || {};
    var ratePercent = Number(fee.ratePercent) || 0;
    var feeWindowMonths = Math.floor(Number(fee.feeWindowMonths) || 0);
    var dayProration = !!fee.dayProration;
    var exemptionPercent = Number(fee.exemptionPercent) || 0;
    var exemptionBasis = (fee.exemptionBasis === 'balance') ? 'balance' : 'principal';
    var exemptionPeriod = (fee.exemptionPeriod === 'once') ? 'once' : 'annual';

    var amount = Number(resolvedCase.amount) || 0;
    var startDate = resolvedCase.startDate || null;

    function cloneRow(row) {
      var out = {};
      for (var key in row) { if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key]; }
      return out;
    }

    // ratePercent===0(예: 카카오뱅크) → 전 회차 0. 불필요한 계산/반올림 아티팩트 방지.
    if (ratePercent === 0) {
      return rows.map(function (row) {
        var out = cloneRow(row);
        out.prepayFeeFull = 0;
        return out;
      });
    }

    // 일수 윈도(캡): feeWindowMonths>0일 때만 유효. 0=무제한 → 항상 정액(proration=1).
    var windowEndDate = (feeWindowMonths > 0 && startDate) ? addMonths(startDate, feeWindowMonths) : null;
    var windowTotalDays = windowEndDate ? daysBetween(startDate, windowEndDate) : 0;

    function periodIndex(n) {
      return exemptionPeriod === 'annual' ? Math.floor((n - 1) / 12) : 0;
    }

    return rows.map(function (row, i) {
      var out = cloneRow(row);

      var period = periodIndex(row.n);

      // 같은 면제기간 내, 이 회차 '이전' 행들의 실제 중도상환액(목돈 prepay + 추가원금
      // extraApplied) 누적 — plan §4.2: "실제 prepayments[]+extraPayment 누적 중도상환액".
      var used = 0;
      for (var j = 0; j < i; j++) {
        if (periodIndex(rows[j].n) === period) used += (Number(rows[j].prepay) || 0) + (Number(rows[j].extraApplied) || 0);
      }

      var exemptionCap = (exemptionBasis === 'balance' ? (Number(row.balance) || 0) : amount) * exemptionPercent / 100;
      var availableExemption = Math.max(0, exemptionCap - used);
      var feeBase = Math.max(0, (Number(row.balance) || 0) - availableExemption);

      var proration = 1;
      if (windowEndDate) {
        var elapsedDays = daysBetween(startDate, row.date);
        if (elapsedDays >= windowTotalDays) {
          out.prepayFeeFull = 0;
          return out;
        }
        var remainingDays = daysBetween(row.date, windowEndDate);
        proration = dayProration ? (remainingDays / windowTotalDays) : 1;
      }

      out.prepayFeeFull = Math.round(feeBase * ratePercent / 100 * proration);
      return out;
    });
  }

  // cumulativeCostAt(rows, n) — rows=computePrepayFeeSchedule 결과, n=회차.
  // { cumulativeInterest(1..n 이자합), prepayFee(n회차 전액상환 수수료), total }.
  function cumulativeCostAt(rows, n) {
    rows = Array.isArray(rows) ? rows : [];
    n = Math.floor(Number(n) || 0);

    var cumulativeInterest = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].n <= n) cumulativeInterest += Number(rows[i].interest) || 0;
    }

    var prepayFee = 0;
    if (rows.length > 0) {
      var target = null;
      for (var k = 0; k < rows.length; k++) {
        if (rows[k].n === n) { target = rows[k]; break; }
      }
      // n이 배열 길이를 넘어서면(조기종료로 이미 완납) 마지막 행 기준으로 해석.
      if (target === null && n >= rows.length) target = rows[rows.length - 1];
      if (target !== null) prepayFee = Number(target.prepayFeeFull) || 0;
    }

    return { cumulativeInterest: cumulativeInterest, prepayFee: prepayFee, total: cumulativeInterest + prepayFee };
  }

  JF.loan = {
    computeSchedule: computeSchedule,
    addMonths: addMonths,
    daysBetween: daysBetween,
    computePrepayFeeSchedule: computePrepayFeeSchedule,
    cumulativeCostAt: cumulativeCostAt
  };

})(JF);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = JF.loan;
}
