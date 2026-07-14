// calc.js — JF.calc: 순수 계산 코어 (plan §5). DOM/localStorage/Date.now() 금지.
// currentMonth는 항상 인자로 주입. Node 테스트 지원을 위한 UMD 가드(예외적으로 허용, contract.md 참조).
var JF = (typeof window !== 'undefined')
  ? (window.JF = window.JF || {})
  : (typeof global !== 'undefined' ? (global.JF = global.JF || {}) : {});

(function (JF) {

  // ============================================================
  // 내부 헬퍼 (format.js에 의존하지 않음 — calc.js는 독립 순수 모듈)
  // ============================================================

  function nvl(a, b) {
    return (a === null || a === undefined) ? b : a;
  }

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function cmpYm(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  function parseYm(ymStr) {
    var parts = ymStr.split('-');
    return { y: parseInt(parts[0], 10), m: parseInt(parts[1], 10) };
  }

  function ymAddLocal(ymStr, deltaMonths) {
    var p = parseYm(ymStr);
    var total = p.y * 12 + (p.m - 1) + deltaMonths;
    var newY = Math.floor(total / 12);
    var newM = ((total % 12) + 12) % 12 + 1;
    return newY + '-' + pad2(newM);
  }

  function ymRangeLocal(startYm, endYm) {
    var result = [];
    var cur = startYm;
    var guard = 0;
    while (cmpYm(cur, endYm) <= 0 && guard < 5000) {
      result.push(cur);
      cur = ymAddLocal(cur, 1);
      guard++;
    }
    return result;
  }

  function monthOfYm(ymStr) {
    return parseYm(ymStr).m;
  }

  function ymFromDateStr(dateStr) {
    // "YYYY-MM-DD" -> "YYYY-MM"
    return dateStr.slice(0, 7);
  }

  function yearOfYm(ymStr) {
    return ymStr.slice(0, 4);
  }

  // ============================================================
  // 5.5 daysInMonth / chargeDate — calc.js 전용 (m0 = 0~11, JS Date 규약)
  // ============================================================

  function daysInMonth(y, m0) {
    return new Date(y, m0 + 1, 0).getDate();
  }

  // ============================================================
  // 대출(loan) 지출 항목 식별 — state.loanExpenses[]의 원소.
  // recurrence 필드가 없고 mode가 'manual'|'auto'이며 manualSegments 배열을 갖는다.
  // (특수 항목의 'fixedMonthly'/'installment'와 구분됨.)
  // loanSchedules는 항상 호출부(js/ui.js:buildLoanSchedules)에서 미리 계산해 인자로 주입한다
  // — calc.js는 조회만 하며 DOM/JF.loan/JF.ui를 참조하지 않는다(순수성 유지).
  // ============================================================

  function isLoanExpense(item) {
    return !!item && (item.mode === 'manual' || item.mode === 'auto') && Array.isArray(item.manualSegments);
  }

  // ============================================================
  // 5.1 effectiveValueFor — 커버 플로어(MF1) + installment + 대출(loan)
  // ============================================================

  function effectiveValueFor(item, month, loanSchedules) {
    loanSchedules = loanSchedules || {};

    if (isLoanExpense(item)) {
      if (item.mode === 'manual') {
        // manualSegments를 배열 순서대로 순회 — fromMonth<=month<=toMonth인 첫 구간 사용.
        // 겹치는 구간이 있으면 first-match-wins(배열상 먼저 나오는 구간의 금액), 나머지는 무시.
        var segs = item.manualSegments || [];
        for (var si = 0; si < segs.length; si++) {
          var seg = segs[si];
          if (seg && seg.fromMonth && seg.toMonth &&
              cmpYm(month, seg.fromMonth) >= 0 && cmpYm(month, seg.toMonth) <= 0) {
            var mAmt = Number(seg.amount) || 0;
            return { plannedAmount: mAmt, actualAmount: mAmt };
          }
        }
        return { plannedAmount: 0, actualAmount: 0 }; // 구간 밖 = 0원
      }
      // mode==='auto': loanId가 가리키는 케이스 스케줄에서 해당 월의 payment를 대입.
      // 매칭 없으면 0(대출 시작 전/상환 완료 후) — 고아 loanId(스케줄에 없음)도 0.
      var rows = loanSchedules[item.loanId] || [];
      for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri];
        if (row && row.date && row.date.slice(0, 7) === month) {
          var pAmt = Number(row.payment) || 0;
          return { plannedAmount: pAmt, actualAmount: pAmt };
        }
      }
      return { plannedAmount: 0, actualAmount: 0 };
    }

    if (item.mode === 'installment') {
      var inst = item.installment;
      if (cmpYm(month, inst.startMonth) >= 0 && cmpYm(month, inst.endMonth) <= 0) {
        var amt = Math.round(inst.total / inst.n);
        return { plannedAmount: amt, actualAmount: amt };
      }
      return { plannedAmount: 0, actualAmount: 0 };
    }

    var segs = item.effectiveValues || [];
    if (segs.length === 0) {
      return { plannedAmount: 0, actualAmount: null };
    }

    // fromMonth 오름차순으로 방어적 정렬(불변식: 이미 오름차순이라 가정하되 방어)
    var sorted = segs.slice().sort(function (a, b) { return cmpYm(a.fromMonth, b.fromMonth); });

    // ★ 커버 플로어: 요청월이 가장 이른 세그먼트보다 이르면 최이른 세그먼트로 clamp
    if (cmpYm(month, sorted[0].fromMonth) < 0) {
      return { plannedAmount: sorted[0].plannedAmount, actualAmount: sorted[0].actualAmount };
    }

    var chosen = sorted[0];
    for (var i = 0; i < sorted.length; i++) {
      if (cmpYm(sorted[i].fromMonth, month) <= 0) {
        chosen = sorted[i];
      } else {
        break;
      }
    }
    return { plannedAmount: chosen.plannedAmount, actualAmount: chosen.actualAmount };
  }

  // ============================================================
  // 5.2 monthlyValueFor — 현금흐름 selector (과거=actual 잠금, 현재/미래=planned)
  // ============================================================

  function monthlyValueFor(item, month, currentMonth, loanSchedules) {
    var ev = effectiveValueFor(item, month, loanSchedules);
    var actual = hasOwn(item.actualsByMonth, month) ? item.actualsByMonth[month] : ev.actualAmount;
    if (cmpYm(month, currentMonth) < 0) {
      return nvl(actual, ev.plannedAmount);
    }
    return ev.plannedAmount;
  }

  // ============================================================
  // 5.2b performanceValueFor — 실적 selector (ACTUAL-first, 게이트 없음, MF2)
  // ============================================================

  function performanceValueFor(item, month, loanSchedules) {
    var ev = effectiveValueFor(item, month, loanSchedules);
    var byMonth = hasOwn(item.actualsByMonth, month) ? item.actualsByMonth[month] : undefined;
    return nvl(byMonth, nvl(ev.actualAmount, ev.plannedAmount));
  }

  // ============================================================
  // 5.3 occursIn — 반복 규칙 전개 (+ installment 자체 기간 처리)
  // ============================================================

  function occursIn(item, month, loanSchedules) {
    loanSchedules = loanSchedules || {};

    // 대출(loan) 항목은 recurrence 필드가 없으므로 반드시 여기서 조기 판정.
    // (이 분기를 빠뜨리면 아래 `if (!rec) return false`로 떨어져 영구 미발생 처리됨.)
    if (isLoanExpense(item)) {
      if (item.mode === 'manual') {
        var segs = item.manualSegments || [];
        for (var si = 0; si < segs.length; si++) {
          var seg = segs[si];
          if (seg && seg.fromMonth && seg.toMonth &&
              cmpYm(month, seg.fromMonth) >= 0 && cmpYm(month, seg.toMonth) <= 0) return true;
        }
        return false;
      }
      // auto: 스케줄에 해당 월(date의 YYYY-MM) 행이 있으면 발생.
      var rows = loanSchedules[item.loanId] || [];
      for (var ri = 0; ri < rows.length; ri++) {
        if (rows[ri] && rows[ri].date && rows[ri].date.slice(0, 7) === month) return true;
      }
      return false;
    }

    if (item.mode === 'installment' && item.installment) {
      return cmpYm(month, item.installment.startMonth) >= 0 && cmpYm(month, item.installment.endMonth) <= 0;
    }

    var rec = item.recurrence;
    if (!rec) return false;

    switch (rec.kind) {
      case 'monthly':
        return cmpYm(month, rec.startMonth) >= 0 && (rec.endMonth == null || cmpYm(month, rec.endMonth) <= 0);

      case 'quarterly': {
        if (cmpYm(month, rec.startMonth) < 0) return false;
        if (rec.endMonth != null && cmpYm(month, rec.endMonth) > 0) return false;
        var pStart = parseYm(rec.startMonth);
        var pMonth = parseYm(month);
        var diff = (pMonth.y * 12 + pMonth.m) - (pStart.y * 12 + pStart.m);
        return (diff % 3) === 0;
      }

      // interval — 시작월부터 매 N개월마다 (quarterly를 일반화; N=1이면 매월과 동일)
      case 'interval': {
        if (cmpYm(month, rec.startMonth) < 0) return false;
        if (rec.endMonth != null && cmpYm(month, rec.endMonth) > 0) return false;
        var n = rec.intervalMonths > 0 ? rec.intervalMonths : 1;
        var iStart = parseYm(rec.startMonth);
        var iMonth = parseYm(month);
        var d = (iMonth.y * 12 + iMonth.m) - (iStart.y * 12 + iStart.m);
        return (d % n) === 0;
      }

      case 'yearly':
        if (cmpYm(month, rec.startMonth) < 0) return false;
        if (rec.endMonth != null && cmpYm(month, rec.endMonth) > 0) return false;
        return monthOfYm(month) === monthOfYm(rec.startMonth);

      case 'period':
        return cmpYm(month, rec.startMonth) >= 0 && (rec.endMonth == null || cmpYm(month, rec.endMonth) <= 0);

      case 'oneoff':
        return cmpYm(month, rec.startMonth) === 0;

      default:
        return false;
    }
  }

  // ============================================================
  // bonusOccursIn — recurring: MM 일치(매년); non-recurring: 특정 날짜 1회
  // ============================================================

  function bonusOccursIn(event, month) {
    if (event.recurring) {
      var mm = event.monthDay.slice(0, 2);
      return monthOfYm(month) === parseInt(mm, 10);
    }
    return ymFromDateStr(event.date) === month;
  }

  // ============================================================
  // salaryForMonth — 기간별 월급(carry-forward). fromMonth <= month 인 세그먼트 중
  // 가장 늦은 것이 이김. 첫 세그먼트 이전 달은 salaryDefault(기본 월급) 사용.
  // ============================================================

  function salaryForMonth(income, month) {
    if (!income) return 0;
    var segs = income.salarySegments || [];
    var best = null;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (!s || !s.fromMonth) continue;
      if (cmpYm(s.fromMonth, month) <= 0 && (best == null || cmpYm(s.fromMonth, best.fromMonth) > 0)) {
        best = s;
      }
    }
    return best ? (best.amount || 0) : (income.salaryDefault || 0);
  }

  // ============================================================
  // 5.4 rollforward — 3-track 단일 루프(MF3): balHybrid/balPlan/balActual
  // ============================================================

  function rollforward(state, currentMonth, loanSchedules) {
    loanSchedules = loanSchedules || {};
    var horizon = state.meta.horizon;
    var months = ymRangeLocal(horizon.start, horizon.end);

    var balHybrid = state.account.seedBalance;
    var balPlan = state.account.seedBalance;
    var balActual = state.account.seedBalance;

    // 대출(loanExpenses) 항목도 다른 지출과 동일하게 잔액 롤포워드에 포함.
    var allItems = [].concat(state.expenses || [], state.specials || [], state.loanExpenses || []);
    var bonuses = (state.income && state.income.bonusEvents) || [];
    var extraIncomes = (state.income && state.income.extraIncomes) || [];

    var results = [];

    for (var mi = 0; mi < months.length; mi++) {
      var month = months[mi];

      var salary = salaryForMonth(state.income, month);

      var bonusPlannedSum = 0, bonusActualSum = 0, bonusCashSum = 0;

      for (var b = 0; b < bonuses.length; b++) {
        var ev = bonuses[b];
        if (!bonusOccursIn(ev, month)) continue;

        var planned = ev.plannedAmount;
        var actual;
        if (ev.recurring) {
          var year = yearOfYm(month);
          actual = hasOwn(ev.actualsByYear, year) ? ev.actualsByYear[year] : planned;
        } else {
          actual = nvl(ev.actualAmount, planned);
        }
        var cashVal = cmpYm(month, currentMonth) < 0 ? actual : planned;

        bonusPlannedSum += planned;
        bonusActualSum += actual;
        bonusCashSum += cashVal;
      }

      // 추가 수입(월별 특별 이벤트) — 성과급과 동일한 hybrid 선택자(과거=실제, 미래=계획)
      var extraPlannedSum = 0, extraActualSum = 0, extraCashSum = 0;
      for (var xi = 0; xi < extraIncomes.length; xi++) {
        var xe = extraIncomes[xi];
        if (xe.month !== month) continue;
        var xPlanned = xe.plannedAmount || 0;
        var xActual = nvl(xe.actualAmount, xPlanned);
        var xCash = cmpYm(month, currentMonth) < 0 ? xActual : xPlanned;
        extraPlannedSum += xPlanned;
        extraActualSum += xActual;
        extraCashSum += xCash;
      }

      var expenseHybrid = 0, expensePlan = 0, expenseActual = 0;
      // 대출: 0 — 대출 항목은 type 필드가 없어 이 맵으로 집계되지 않음(개별행 전용). 일관성 위해 키만 유지.
      var breakdown = { salary: salary, bonus: bonusCashSum, extra: extraCashSum, 고정: 0, 생활: 0, 교육: 0, 특수: 0, 추가: 0, 대출: 0 };
      var itemVariance = [];

      for (var ii = 0; ii < allItems.length; ii++) {
        var item = allItems[ii];
        if (!occursIn(item, month, loanSchedules)) continue;

        var hybridVal = monthlyValueFor(item, month, currentMonth, loanSchedules);
        var ev2 = effectiveValueFor(item, month, loanSchedules);
        var plannedVal = ev2.plannedAmount;
        var actualByMonth = hasOwn(item.actualsByMonth, month) ? item.actualsByMonth[month] : undefined;
        var actualVal = nvl(actualByMonth, nvl(ev2.actualAmount, plannedVal));

        expenseHybrid += hybridVal;
        expensePlan += plannedVal;
        expenseActual += actualVal;

        if (breakdown[item.type] !== undefined) {
          breakdown[item.type] += hybridVal;
        }

        itemVariance.push({ id: item.id, variance: plannedVal - actualVal });
      }

      balHybrid += (salary + bonusCashSum + extraCashSum) - expenseHybrid;
      balPlan += (salary + bonusPlannedSum + extraPlannedSum) - expensePlan;
      balActual += (salary + bonusActualSum + extraActualSum) - expenseActual;

      results.push({
        month: month,
        income: salary + bonusCashSum + extraCashSum,
        expense: expenseHybrid,
        balanceEnd: balHybrid,
        balanceEndPlan: balPlan,
        balanceEndActual: balActual,
        itemVariance: itemVariance,
        breakdown: breakdown
      });
    }

    return results;
  }

  // ============================================================
  // 5.5 chargeDate — 짧은 달 clamp(MF4)
  // ============================================================

  function chargeDate(month, chargeDay) {
    var p = parseYm(month);
    var year = p.y;
    var month0 = p.m - 1; // 0-indexed
    var dim = daysInMonth(year, month0);
    var day = Math.min(chargeDay, dim);
    return new Date(year, month0, day);
  }

  // ============================================================
  // 5.5 windowKeyFor — 산정기간 파생(MF7)
  // ============================================================

  function windowKeyFor(card, date) {
    var s = card.billingWindow.start;
    var y = date.getFullYear();
    var m0 = date.getMonth();
    var day = date.getDate();
    var ymOfDate = y + '-' + pad2(m0 + 1);

    if (s === 1) return ymOfDate;
    if (day >= s) return ymOfDate;
    return ymAddLocal(ymOfDate, -1);
  }

  // ============================================================
  // 5.5 performance — 카드별 산정기간 실적 합산 (ACTUAL-first)
  // ============================================================

  function performance(state, card, windowKey, loanSchedules) {
    loanSchedules = loanSchedules || {};
    // 대출(loanExpenses) 항목의 카드/실적 토글도 실제로 게이지에 반영되도록 포함.
    var allItems = [].concat(state.expenses || [], state.specials || [], state.loanExpenses || []);
    var months = ymRangeLocal(state.meta.horizon.start, state.meta.horizon.end);
    var sum = 0;

    for (var i = 0; i < allItems.length; i++) {
      var item = allItems[i];
      if (item.assignedCardId !== card.id) continue;
      if (!item.countsTowardPerformance) continue;
      // 결제일 없는 항목은 산정기간 귀속 불가 → 실적 집계에서 제외(null이면 chargeDate 오귀속 방지)
      if (item.chargeDay == null) continue;

      for (var j = 0; j < months.length; j++) {
        var month = months[j];
        if (!occursIn(item, month, loanSchedules)) continue;

        var d = chargeDate(month, item.chargeDay);
        var wk = windowKeyFor(card, d);
        if (wk === windowKey) {
          sum += performanceValueFor(item, month, loanSchedules);
        }
      }
    }

    return sum;
  }

  // ============================================================
  // 5.5 gaugeFor
  // ============================================================

  function gaugeFor(state, card, windowKey, loanSchedules) {
    var earned = performance(state, card, windowKey, loanSchedules);
    var primary = null;
    var conds = card.performanceConditions || [];
    for (var i = 0; i < conds.length; i++) {
      if (conds[i].primary) { primary = conds[i]; break; }
    }
    var threshold = primary ? primary.threshold : 0;
    var remaining = Math.max(0, threshold - earned);
    var met = earned >= threshold;
    return { earned: earned, threshold: threshold, remaining: remaining, met: met };
  }

  // ============================================================
  // export
  // ============================================================

  JF.calc = {
    daysInMonth: daysInMonth,
    effectiveValueFor: effectiveValueFor,
    monthlyValueFor: monthlyValueFor,
    performanceValueFor: performanceValueFor,
    occursIn: occursIn,
    bonusOccursIn: bonusOccursIn,
    salaryForMonth: salaryForMonth,
    rollforward: rollforward,
    chargeDate: chargeDate,
    windowKeyFor: windowKeyFor,
    performance: performance,
    gaugeFor: gaugeFor
  };

})(JF);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = JF.calc;
}
