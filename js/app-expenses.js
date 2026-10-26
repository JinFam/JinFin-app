// app-expenses.js — 컴포넌트 3: 지출·부채 관리 (AC-3.x)
// 탭(고정/생활/교육/특수) · CRUD · 반복규칙 · 카드/결제일/실적포함 태그
// · effective-dated + pastLock(과거잠금) · 특수 2모드(고정월액/총액÷N 할부) · 이 달 실제 보정(N4).
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var state;
  var tab = "고정-카드";      // 고정-카드 | 고정-이체 | 생활 | 교육 | 특수
  var openId = null;          // 편집 열린 항목 id
  var perfMonth = null;       // 실적 패널 선택 월(YYYY-MM) — 재렌더시 유지(사용자 선택 보존)
  var loanSchedules = {};     // 자동 모드 대출 항목용 스케줄 맵(render() 시작부에서 재계산)

  var CAT_PASTELS = ["#FADBD8", "#D6EAF8", "#D5F5E3", "#FCF3CF", "#E8DAEF", "#FDEBD0", "#D1F2EB", "#F5EEF8", "#EBDEF0", "#EAF2F8"];
  function hashStr(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return Math.abs(h); }
  function categoryColor(name) {
    if (!name) return "#E5E7EB";
    state.categoryColors = state.categoryColors || {};
    if (state.categoryColors[name]) return state.categoryColors[name];
    return CAT_PASTELS[hashStr(name) % CAT_PASTELS.length];
  }

  // 분류 자동완성용 datalist: state.categories명 ∪ 지출/특수 항목의 분류(중복 제거)
  function catDatalist() {
    var names = {};
    (state.categories || []).forEach(function (c) { if (c.name) names[c.name] = true; });
    (state.expenses || []).forEach(function (x) { if (x.category) names[x.category] = true; });
    (state.specials || []).forEach(function (x) { if (x.category) names[x.category] = true; });
    return el("datalist", { id: "exp-cat-list" }, Object.keys(names).map(function (n) {
      return el("option", { value: n }, n);
    }));
  }

  function man(n) { return JF.format.toMan(n); }
  function fromMan(m) { return JF.format.fromMan(m); }
  function uid(p) { return p + "-" + Math.random().toString(36).slice(2, 8); }
  // ---- 저장 큐 -------------------------------------------------------
  // 모든 변경은 큐에 들어가 한 번에 하나씩 순차 처리(적용 → 저장 → 큐가 비면 1회 렌더).
  // 같은 항목의 "저장" 작업(coalesce key)이 처리 전 대기 중이면 마지막 입력으로 대체한다.
  var saveQueue = [];
  var draining = false;
  var flashSavedId = null; // 방금 저장한 항목 id — 편집 폼에 "저장됨" 표시용
  function enqueue(job, key) {
    if (key) saveQueue = saveQueue.filter(function (j) { return j.key !== key; });
    saveQueue.push({ key: key || null, job: job });
    drain();
  }
  function drain() {
    if (draining) return;
    draining = true;
    Promise.resolve().then(function step() {
      var j = saveQueue.shift();
      if (!j) { draining = false; render(); return; }
      try { j.job(); JF.store.save(state); }
      catch (e) { JF.ui.showBanner("저장 중 오류: " + (e && e.message ? e.message : e), "error"); }
      return Promise.resolve().then(step);
    });
  }
  function save() { enqueue(function () {}); }
  var ALL_ORDER = ["고정-카드", "고정-이체", "생활", "교육", "특수", "추가"]; // "전체" 탭 표시 순서(대출 제외)
  // 항목이 속한 탭 이름. "전체" 탭에서도 항목 단위로 올바른 편집/삭제/이동 로직을 타게 함.
  function tabOf(item) {
    if (tab !== "전체") return tab;
    if ((state.specials || []).indexOf(item) >= 0) return "특수";
    return item.type;
  }
  function isSpecialTab(item) { return tabOf(item) === "특수"; }
  function isLoanTab(item) { return tabOf(item) === "대출"; }
  function listForTab() {
    if (tab === "전체") {
      var all = [];
      ALL_ORDER.forEach(function (t) {
        if (t === "특수") { all = all.concat(state.specials || []); }
        else { all = all.concat(state.expenses.filter(function (e) { return e.type === t; })); }
      });
      return all;
    }
    if (tab === "특수") return state.specials;
    if (tab === "대출") return state.loanExpenses || [];
    return state.expenses.filter(function (e) { return e.type === tab; });
  }

  function currentPlanned(item) {
    var ev = JF.calc.effectiveValueFor(item, state.meta.currentMonth, loanSchedules);
    return ev.plannedAmount;
  }

  // ---- pastLock 반영 금액 변경 ---------------------------------------
  function applyAmountChange(item, newWon, applyMonth) {
    if (item.mode === "installment") return; // 할부는 별도 total/n
    if (item.pastLock) {
      var seg = item.effectiveValues.filter(function (s) { return s.fromMonth === applyMonth; })[0];
      if (seg) { seg.plannedAmount = newWon; }
      else { item.effectiveValues.push({ fromMonth: applyMonth, plannedAmount: newWon, actualAmount: null }); }
      item.effectiveValues.sort(function (a, b) { return JF.format.ymCompare(a.fromMonth, b.fromMonth); });
    } else {
      var base = item.effectiveValues[0] || { actualAmount: null };
      var start = (item.recurrence && item.recurrence.startMonth) || applyMonth;
      item.effectiveValues = [{ fromMonth: start, plannedAmount: newWon, actualAmount: base.actualAmount != null ? base.actualAmount : null }];
    }
  }

  // ---- 탭 바 ---------------------------------------------------------
  function renderTabs() {
    var host = document.getElementById("exp-tabs");
    host.innerHTML = "";
    var bar = el("div", { class: "field-row" }, ["전체", "대출", "고정-카드", "고정-이체", "생활", "교육", "특수", "추가"].map(function (t) {
      return el("button", { class: "btn btn-sm " + (tab === t ? "btn-primary" : "btn-secondary"),
        onClick: function () { tab = t; openId = null; render(); } }, t);
    }));
    host.appendChild(el("div", { class: "card" }, el("div", { class: "card-body" }, bar)));
  }

  function cardName(id) {
    var c = (state.cards || []).filter(function (x) { return x.id === id; })[0];
    return c ? c.name : id;
  }

  function bankAccount(id) {
    return (state.bankAccounts || []).filter(function (x) { return x.id === id; })[0] || null;
  }
  // 카드 열: 카드 결제 항목만 카드명, 그 외 "-"
  function cardLabel(item) {
    if (item.assignedCardId && item.assignedCardId !== "transfer") return cardName(item.assignedCardId);
    return "-";
  }
  // 계좌 열: 계좌이체는 항목에 지정한 계좌, 카드 결제는 카드에 연동된 결제 계좌(파생, 흐리게)
  function accountCell(item) {
    if (item.assignedCardId === "transfer") {
      var a = bankAccount(item.assignedAccountId);
      return a ? a.name : el("span", { class: "muted" }, "미지정");
    }
    if (item.assignedCardId) {
      var c = (state.cards || []).filter(function (x) { return x.id === item.assignedCardId; })[0];
      var ca = c && bankAccount(c.paymentAccountId);
      return ca ? el("span", { class: "muted", title: "카드에 연동된 결제 계좌" }, ca.name) : "-";
    }
    return "-";
  }

  // 적용기간 라벨: installment는 자체 기간, oneoff는 해당월 1개, 그 외는 시작~종료(계속)
  function periodLabel(item) {
    if (item.mode === "installment") return item.installment.startMonth + "~" + item.installment.endMonth;
    var r = item.recurrence;
    if (!r) return "-";
    if (r.kind === "oneoff") return r.startMonth || "-";
    return (r.startMonth || "-") + "~" + (r.endMonth || "계속");
  }

  // 반복 라벨: 표에서 반복 규칙을 사람이 읽기 좋은 한글로 표시
  function recurrenceLabel(item) {
    if (item.mode === "installment") return "할부";
    var r = item.recurrence; if (!r) return "-";
    switch (r.kind) {
      case "monthly": return "매월";
      case "interval": return "매 " + (r.intervalMonths || 1) + "개월";
      case "yearly": return "매년";
      case "period": return "기간(매월)";
      case "oneoff": return "일회성";
      default: return r.kind;
    }
  }

  // manualSegments 겹침 여부(두 구간의 [from,to]가 월 단위로 교차하면 true). 경고용(차단 아님).
  function hasOverlap(segs) {
    for (var i = 0; i < segs.length; i++) {
      for (var j = i + 1; j < segs.length; j++) {
        var a = segs[i], b = segs[j];
        if (!a || !b || !a.fromMonth || !a.toMonth || !b.fromMonth || !b.toMonth) continue;
        if (JF.format.ymCompare(a.fromMonth, b.toMonth) <= 0 && JF.format.ymCompare(b.fromMonth, a.toMonth) <= 0) return true;
      }
    }
    return false;
  }

  // 대출 항목 편집: 수동/자동 모드 토글 + 각 모드 UI를 body에 append.
  // (이름/카드/실적·실제보정/삭제 섹션은 editForm이 이어서 기존 컴포넌트를 그대로 재사용)
  // ctx: { collectors, act } — editForm의 단일 "저장" 버튼 / 구조 변경 시 입력값 보존용.
  function loanEditSection(body, item, ctx) {
    body.appendChild(el("div", { class: "subhead" }, "입력 모드"));
    function setMode(m) {
      ctx.act(function () {
        item.mode = m;
        if (m === "manual" && !Array.isArray(item.manualSegments)) item.manualSegments = [];
      });
    }
    var modeSeg = el("div", { class: "seg-group" }, [
      el("button", { type: "button", class: "btn btn-sm seg-btn" + (item.mode === "manual" ? " is-active" : ""),
        onClick: function () { setMode("manual"); } }, "수동 입력"),
      el("button", { type: "button", class: "btn btn-sm seg-btn" + (item.mode === "auto" ? " is-active" : ""),
        onClick: function () { setMode("auto"); } }, "자동(대출계산기)")
    ]);
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "모드:"), modeSeg]));

    if (item.mode === "auto") {
      var loans = state.loans || [];
      var caseSel = el("select", { onChange: function () {
        var v = caseSel.value || null;
        ctx.act(function () { item.loanId = v; });
      } },
        [el("option", { value: "" }, "(케이스 선택)")].concat(loans.map(function (c) {
          return el("option", { value: c.id, selected: item.loanId === c.id }, c.name || c.id);
        })));
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "대출 케이스:"), caseSel]));
      var linked = loans.filter(function (c) { return c.id === item.loanId; })[0];
      if (item.loanId && !linked) {
        // 고아 참조: 참조한 케이스가 삭제됨 → 에러 없이 0원, 안내 표시.
        body.appendChild(el("div", { class: "muted" }, "⚠ 연결된 케이스 없음 — 참조한 대출 케이스가 삭제되었습니다. 해당 월 금액은 0원으로 처리됩니다."));
      } else if (linked) {
        var sched = JF.ui.computeCaseSchedule(linked);
        var cm = state.meta.currentMonth;
        var payRow = (sched.rows || []).filter(function (r) { return r.date && r.date.slice(0, 7) === cm; })[0];
        var payTxt = payRow ? (JF.format.formatWon(payRow.payment) + "원")
          : ("이 달(" + cm + ")은 상환 스케줄 밖 — 0원");
        body.appendChild(el("div", { class: "muted" }, "이 달 예상 상환액: " + payTxt + " (참고용, 저장 데이터 아님)"));
      } else {
        body.appendChild(el("div", { class: "muted" }, "대출계산기(loan.html)에 등록된 케이스를 선택하면 회차별 상환액이 자동 대입됩니다."));
      }
      return;
    }

    // 수동 모드 — manualSegments 표(시작월/종료월/금액 + 행 추가/삭제). 구간 밖은 0원.
    body.appendChild(el("div", { class: "subhead" }, "수동 구간(월별 원리금)"));
    var segs = item.manualSegments || (item.manualSegments = []);
    if (hasOverlap(segs)) {
      body.appendChild(el("div", { class: "muted" }, "⚠ 겹치는 구간이 있습니다(저장은 됨). 겹치는 달은 목록에서 먼저 나오는 구간의 금액이 적용됩니다."));
    }
    if (!segs.length) {
      body.appendChild(el("div", { class: "muted" }, "구간이 없습니다. 아래 '구간 추가'로 적용 기간과 금액을 지정하세요(구간 밖은 0원)."));
    }
    segs.forEach(function (seg) {
      var f = el("input", { type: "month", value: seg.fromMonth || "" });
      var t = el("input", { type: "month", value: seg.toMonth || "" });
      var a = el("input", { type: "number", min: "0", step: "1000", value: (seg.amount != null ? seg.amount : 0) });
      ctx.collectors.push(function () {
        var fv = f.value || null, tv = t.value || null, av = Number(a.value) || 0;
        return function () { seg.fromMonth = fv; seg.toMonth = tv; seg.amount = av; };
      });
      body.appendChild(el("div", { class: "field-row" }, [
        el("label", null, "시작:"), f, el("label", null, "종료:"), t, el("label", null, "금액(원):"), a,
        el("button", { class: "btn btn-sm btn-danger push-right", onClick: function () {
          ctx.act(function () { item.manualSegments = segs.filter(function (x) { return x !== seg; }); });
        } }, "삭제")
      ]));
    });
    body.appendChild(el("div", { class: "field-row" }, [
      el("button", { class: "btn btn-sm btn-primary", onClick: function () {
        ctx.act(function () {
          segs.push({ id: uid("seg"), fromMonth: state.meta.horizon.start, toMonth: state.meta.horizon.end, amount: 0 });
        });
      } }, "+ 구간 추가")
    ]));
  }

  // ---- 편집 폼 -------------------------------------------------------
  // 입력은 모두 폼에 머물다가 하단 단일 "저장" 버튼에서 한꺼번에 수집 → 저장 큐로 전달된다.
  // (collectors: 각 섹션이 입력값을 "그 시점 값"으로 캡처해 apply 함수를 돌려줌 / false=검증 실패 / null=변경 없음)
  function editForm(item) {
    var itab = tabOf(item);
    var body = el("div", { class: "card-body stack" }, []);
    var collectors = [];
    function collectAll() {
      var out = [];
      for (var i = 0; i < collectors.length; i++) {
        var r = collectors[i]();
        if (r === false) return false;
        if (r) out.push(r);
      }
      return out;
    }
    // 구조 변경(모드 전환·행 삭제 등): 입력 중이던 값을 먼저 반영한 뒤 변경을 큐에 넣는다(입력 유실 방지).
    function act(fn) {
      var applies = collectAll();
      if (applies === false) return;
      enqueue(function () { applies.forEach(function (ap) { ap(); }); fn(); });
    }
    var ctx = { collectors: collectors, act: act };
    function dirtyTracker() {
      var d = { v: false };
      d.mark = function () { d.v = true; };
      return d;
    }
    // 편집 기본 적용월: 현재월이 기간(horizon) 이전이면 기간 시작월로 clamp.
    // (현재월이 기간 밖이면 currentMonth 기준 append/보정이 rollforward에 반영되지 않으므로)
    var effMonth = JF.format.ymCompare(state.meta.currentMonth, state.meta.horizon.start) < 0
      ? state.meta.horizon.start : state.meta.currentMonth;

    body.appendChild(el("div", { class: "subhead" }, "기본"));
    var name = el("input", { type: "text", value: item.name });
    var cat = el("input", { type: "text", value: item.category || "", list: "exp-cat-list" });
    var catPicker = el("input", { type: "color", class: "cat-color", value: categoryColor(item.category), onChange: function () {
      var c = cat.value, col = catPicker.value;
      if (c) act(function () { state.categoryColors[c] = col; });
    } });
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "이름:"), name, el("label", null, "분류:"), cat, catPicker]));
    body.appendChild(catDatalist());
    collectors.push(function () {
      var nv = name.value, cv = cat.value;
      return function () { item.name = nv; item.category = cv; };
    });

    // 고정-카드/고정-이체: 결제수단이 바뀌면 탭도 옮길 수 있게 종류 전환 셀렉트 제공.
    if (itab === "고정-카드" || itab === "고정-이체") {
      var fixedKindSel = el("select", { onChange: function () {
        var v = fixedKindSel.value;
        act(function () { item.type = v; });
      } }, [
        el("option", { value: "고정-카드", selected: item.type === "고정-카드" }, "고정-카드"),
        el("option", { value: "고정-이체", selected: item.type === "고정-이체" }, "고정-이체")
      ]);
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "고정 종류:"), fixedKindSel]));
    }

    // 특수: 모드 선택
    if (isSpecialTab(item)) {
      var modeSel = el("select", { onChange: function () {
        var v = modeSel.value;
        act(function () {
          item.mode = v;
          if (item.mode === "installment" && !item.installment) {
            item.installment = { total: 0, n: 5, startMonth: state.meta.horizon.start, endMonth: JF.format.ymAdd(state.meta.horizon.start, 4) };
          }
          if (item.mode === "fixedMonthly" && (!item.effectiveValues || !item.effectiveValues.length)) {
            item.effectiveValues = [{ fromMonth: state.meta.horizon.start, plannedAmount: 0, actualAmount: null }];
          }
        });
      } }, [
        el("option", { value: "fixedMonthly", selected: item.mode === "fixedMonthly" }, "고정 월액"),
        el("option", { value: "installment", selected: item.mode === "installment" }, "총액 ÷ N 할부")
      ]);
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "특수 모드:"), modeSel]));
    }

    // 금액/모드 편집 — 대출 항목은 수동/자동 모드 UI(별도), 그 외는 기존 금액 편집.
    if (isLoanTab(item)) {
      loanEditSection(body, item, ctx);
    } else {
    body.appendChild(el("div", { class: "subhead" }, "금액"));
    if (itab === "추가") {
      var amtOneoff = el("input", { type: "number", value: currentPlanned(item), min: "0", step: "1000" });
      var monthOneoff = el("input", { type: "month", value: item.recurrence.startMonth, min: state.meta.horizon.start });
      var dOne = dirtyTracker();
      amtOneoff.addEventListener("input", dOne.mark); monthOneoff.addEventListener("input", dOne.mark);
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "금액(원):"), amtOneoff, el("label", null, "해당 년월:"), monthOneoff]));
      collectors.push(function () {
        if (!dOne.v) return null;
        var mv = JF.format.ymCompare(monthOneoff.value, state.meta.horizon.start) < 0 ? state.meta.horizon.start : monthOneoff.value;
        var av = Number(amtOneoff.value) || 0;
        return function () {
          item.recurrence.startMonth = mv;
          item.recurrence.endMonth = null;
          var prevActual = (item.effectiveValues[0] && item.effectiveValues[0].actualAmount != null) ? item.effectiveValues[0].actualAmount : null;
          item.effectiveValues = [{ fromMonth: mv, plannedAmount: av, actualAmount: prevActual }];
        };
      });
    } else if (item.mode === "installment") {
      var total = el("input", { type: "number", value: item.installment.total, min: "0", step: "10000" });
      var n = el("input", { type: "number", value: item.installment.n, min: "1" });
      var sM = el("input", { type: "month", value: item.installment.startMonth });
      var eM = el("input", { type: "month", value: item.installment.endMonth });
      var preview = el("span", { class: "num" }, "월 " + JF.format.formatMan(Math.round(item.installment.total / item.installment.n)));
      function upPrev() {
        var t = Number(total.value) || 0, nn = Number(n.value) || 1;
        preview.textContent = "월 " + JF.format.formatMan(Math.round(t / nn)) + " (" + JF.format.formatWon(Math.round(t / nn)) + "원)";
      }
      total.addEventListener("input", upPrev); n.addEventListener("input", upPrev);
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "총액(원):"), total, el("label", null, "개월(N):"), n, preview]));
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "시작월:"), sM, el("label", null, "종료월:"), eM]));
      body.appendChild(el("div", { class: "muted" }, "※ 할부는 forward-only(지난 할부월은 불변)."));
      collectors.push(function () {
        var tv = Number(total.value) || 0, nv = Number(n.value) || 1, sv = sM.value, ev = eM.value;
        return function () {
          item.installment.total = tv; item.installment.n = nv;
          item.installment.startMonth = sv; item.installment.endMonth = ev;
        };
      });
    } else {
      var amt = el("input", { type: "number", value: currentPlanned(item), min: "0", step: "1000" });
      var applyM = el("input", { type: "month", value: effMonth, min: state.meta.horizon.start });
      var lock = el("input", { type: "checkbox", checked: !!item.pastLock });
      var dAmt = dirtyTracker();
      amt.addEventListener("input", dAmt.mark); applyM.addEventListener("input", dAmt.mark);
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "월 금액(원):"), amt, el("label", null, "적용 시작월:"), applyM]));
      body.appendChild(el("div", { class: "field-row" }, [
        el("label", null, [lock, " 과거 잠금(pastLock)"]),
        el("span", { class: "muted" }, item.pastLock ? "변경 시 지난 달은 고정, 적용월부터만 반영(새 구간 추가)" : "변경 시 전 기간에 반영")
      ]));
      collectors.push(function () {
        var lk = lock.checked, newWon = Number(amt.value) || 0, am = applyM.value;
        var lockChanged = lk !== !!item.pastLock;
        if (!dAmt.v && !lockChanged) return null;
        // 적용월이 기간 시작 이전이면 clamp(그 이전 구간은 rollforward가 읽지 않음) (#1/#8)
        var amc = JF.format.ymCompare(am, state.meta.horizon.start) < 0 ? state.meta.horizon.start : am;
        var changeAmount = dAmt.v;
        return function () {
          item.pastLock = lk;
          if (changeAmount) applyAmountChange(item, newWon, amc);
        };
      });
      // effectiveValues 구간 목록
      if (item.effectiveValues && item.effectiveValues.length > 1) {
        body.appendChild(el("div", { class: "muted" }, "금액 변경 이력(구간):"));
        item.effectiveValues.slice().sort(function (a, b) { return JF.format.ymCompare(a.fromMonth, b.fromMonth); }).forEach(function (seg, idx, arr) {
          body.appendChild(el("div", { class: "field-row" }, [
            el("span", null, seg.fromMonth + "부터 " + JF.format.formatWon(seg.plannedAmount) + "원"),
            (arr.length > 1 && idx > 0) ? el("button", { class: "btn btn-sm btn-danger push-right", onClick: function () {
              act(function () { item.effectiveValues = item.effectiveValues.filter(function (s) { return s !== seg; }); });
            } }, "구간 삭제") : el("span", { class: "muted push-right" }, "(기준 구간)")
          ]));
        });
      }
    }
    }

    // 반복 규칙 (추가/대출 항목은 별도 규칙 편집이 필요 없음)
    if (itab !== "추가" && !isLoanTab(item)) {
      var RECURRENCE_KINDS = [
        { value: "monthly", label: "매월" },
        { value: "interval", label: "매 N개월마다" },
        { value: "yearly", label: "매년" },
        { value: "period", label: "기간(매월)" },
        { value: "oneoff", label: "일회성" }
      ];
      var curKind = item.recurrence && item.recurrence.kind;
      var knownKind = RECURRENCE_KINDS.some(function (k) { return k.value === curKind; });
      var recKind = el("select", null, RECURRENCE_KINDS.map(function (k) {
        var isSel = knownKind ? curKind === k.value : k.value === "monthly";
        return el("option", { value: k.value, selected: isSel }, k.label);
      }));
      var recStart = el("input", { type: "month", value: item.recurrence ? item.recurrence.startMonth : state.meta.horizon.start });
      var recEnd = el("input", { type: "month", value: (item.recurrence && item.recurrence.endMonth) || "" });
      var recN = el("input", { type: "number", min: "1", value: (item.recurrence && item.recurrence.intervalMonths) || 3 });
      if (item.mode !== "installment") {
        var dRec = dirtyTracker();
        [recKind, recStart, recEnd, recN].forEach(function (x) { x.addEventListener("input", dRec.mark); x.addEventListener("change", dRec.mark); });
        body.appendChild(el("div", { class: "subhead" }, "반복"));
        body.appendChild(el("div", { class: "field-row" }, [el("label", null, "반복:"), recKind, el("label", null, "시작:"), recStart, el("label", null, "종료:"), recEnd,
          el("label", null, "개월(N):"), recN]));
        body.appendChild(el("div", { class: "muted" }, "예: 시작월부터 매 3개월마다 발생 (분기)."));
        if (itab === "교육") {
          body.appendChild(el("div", { class: "muted" }, "교육비는 종료월(예: 2028-02)이 있는 기간한정 항목입니다. 분기/연 추가 지출은 반복=interval(N=3)/yearly 로 별도 항목을 추가하세요."));
        }
        collectors.push(function () {
          if (!dRec.v) return null;
          var rec = { kind: recKind.value, startMonth: recStart.value, endMonth: recEnd.value || null };
          if (rec.kind === "interval") rec.intervalMonths = Number(recN.value) || 1;
          return function () { item.recurrence = rec; };
        });
      }
    }

    // 태그: 카드/결제일/실적포함
    body.appendChild(el("div", { class: "subhead" }, "카드·실적"));
    var chargeDay = el("input", { type: "number", value: (item.chargeDay != null ? item.chargeDay : ""), min: "1", max: "31", placeholder: "결제일" });
    var counts = el("input", { type: "checkbox", checked: !!item.countsTowardPerformance });
    // 계좌이체는 카드가 아니므로 결제일·실적 포함을 비활성화(자동 제외)
    function syncMethod() {
      var isTransfer = cardSel.value === "transfer";
      chargeDay.disabled = isTransfer;
      counts.disabled = isTransfer;
      acctRow.hidden = !isTransfer;
      if (isTransfer) { chargeDay.value = ""; counts.checked = false; }
    }
    // 계좌이체 선택 시 연결할 계좌('카드/계좌' 페이지의 계좌 탭에서 등록) — 대시보드 하위항목 그룹 기준
    var acctSel = el("select", null, [el("option", { value: "" }, "(미지정)")].concat(
      (state.bankAccounts || []).map(function (a) {
        return el("option", { value: a.id, selected: item.assignedAccountId === a.id }, a.name);
      })));
    var acctRow = el("div", { class: "field-row" }, [el("label", null, "계좌:"), acctSel,
      (state.bankAccounts || []).length ? null : el("span", { class: "muted" }, "'카드/계좌' 페이지의 계좌 탭에서 먼저 계좌를 등록하세요.")]);
    var cardSel = el("select", { onChange: syncMethod }, [
      el("option", { value: "" }, "(미배정)"),
      el("option", { value: "transfer", selected: item.assignedCardId === "transfer" }, "계좌이체(카드 아님)")
    ].concat(
      (state.cards || []).map(function (c) { return el("option", { value: c.id, selected: item.assignedCardId === c.id }, c.name); })));
    syncMethod();
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "결제 수단:"), cardSel, el("label", null, "결제일:"), chargeDay,
      el("label", null, [counts, " 실적 포함"])]));
    body.appendChild(acctRow);
    body.appendChild(el("div", { class: "muted" }, "카드 대신 계좌이체면 결제 수단에서 '계좌이체' 선택 후 계좌 지정(자동 실적 제외). 카드 결제의 계좌는 카드/계좌 페이지의 카드 편집에서 연동. 주유비는 혜택은 받되 '실적 포함' 해제(Deep Oil 주유 제외)."));
    collectors.push(function () {
      var newCard = cardSel.value || null;
      var isTransfer = newCard === "transfer";
      var isRealCard = !!newCard && !isTransfer;
      var newDay = chargeDay.value === "" ? null : Number(chargeDay.value);
      var cnt = counts.checked, acct = acctSel.value || null;
      // 실적 포함 + 실제 카드 배정이면 결제일 필수 (#4: null이면 chargeDate가 전월로 오귀속)
      if (isRealCard && cnt && (newDay == null || newDay < 1 || newDay > 31)) {
        JF.ui.showBanner("실적 포함 + 카드 배정 항목은 결제일(1~31)이 필요합니다.", "warn");
        return false;
      }
      return function () {
        item.assignedCardId = newCard;
        item.assignedAccountId = isTransfer ? acct : null;
        item.chargeDay = isTransfer ? null : newDay;                 // 계좌이체는 결제일 없음
        item.countsTowardPerformance = isTransfer ? false : cnt;     // 계좌이체는 실적 제외
      };
    });

    // 이 달 실제 보정 (N4) — 원 단위 입력, 기간 시작월 기본 (월·금액을 모두 입력했을 때만 저장 시 반영)
    body.appendChild(el("div", { class: "subhead" }, "실제 보정"));
    var corrM = el("input", { type: "month", value: effMonth, min: state.meta.horizon.start });
    var corrA = el("input", { type: "number", placeholder: "실제 원", min: "0", step: "1000" });
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "이 달 실제 보정(원):"), corrM, corrA]));
    collectors.push(function () {
      if (!corrM.value || corrA.value === "") return null;
      var cm = corrM.value, cv = Number(corrA.value) || 0;
      return function () {
        item.actualsByMonth = item.actualsByMonth || {};
        item.actualsByMonth[cm] = cv;
      };
    });
    var corrKeys = Object.keys(item.actualsByMonth || {}).sort();
    if (corrKeys.length) {
      body.appendChild(el("div", { class: "muted" }, "보정된 실제값:"));
      corrKeys.forEach(function (m) {
        body.appendChild(el("div", { class: "field-row" }, [
          el("span", null, m + ": " + JF.format.formatMan(item.actualsByMonth[m])),
          el("button", { class: "btn btn-sm btn-danger push-right", onClick: function () { act(function () { delete item.actualsByMonth[m]; }); } }, "삭제")
        ]));
      });
    }

    // 저장 / 닫기 / 삭제
    var savedMark = el("span", { class: "muted" }, flashSavedId === item.id ? "✓ 저장됨" : "");
    if (flashSavedId === item.id) {
      flashSavedId = null;
      setTimeout(function () { savedMark.textContent = ""; }, 2500);
    }
    body.appendChild(el("div", { class: "card-footer" }, [
      el("button", { class: "btn btn-primary", onClick: function () {
        var applies = collectAll();
        if (applies === false) return;
        // 같은 항목의 대기 중 저장은 마지막 입력으로 대체(coalesce) — 큐는 순차 처리
        enqueue(function () {
          if (allItems().indexOf(item) < 0) return; // 그 사이 삭제된 항목
          applies.forEach(function (ap) { ap(); });
          flashSavedId = item.id;
        }, "save:" + item.id);
      } }, "저장"),
      el("button", { class: "btn btn-ghost", onClick: function () { openId = null; render(); } }, "닫기"),
      savedMark,
      el("button", { class: "btn btn-sm btn-danger push-right", onClick: function () {
        if (window.confirm("삭제할까요? (" + item.name + ")")) { removeItem(item); }
      } }, "항목 삭제")
    ]));

    return el("div", { class: "card" }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, item.name + " — 편집")),
      body
    ]);
  }

  function allItems() {
    return (state.expenses || []).concat(state.specials || [], state.loanExpenses || []);
  }

  function removeItem(item) {
    // 3-way: 특수→specials, 대출→loanExpenses, 그 외→expenses (탭별로 대상 배열이 다름)
    if (isSpecialTab(item)) { state.specials = state.specials.filter(function (x) { return x.id !== item.id; }); }
    else if (isLoanTab(item)) { state.loanExpenses = (state.loanExpenses || []).filter(function (x) { return x.id !== item.id; }); }
    else { state.expenses = state.expenses.filter(function (x) { return x.id !== item.id; }); }
    openId = null; save();
  }

  // 항목 순서 이동: dir -1(위) / +1(아래). 같은 탭 내에서만 이동, 경계에서는 no-op.
  // 3-way: 특수/대출은 배열 전체가 형제, 그 외(expenses)는 같은 type만 형제.
  function moveItem(item, dir) {
    var arr = isSpecialTab(item) ? state.specials : (isLoanTab(item) ? (state.loanExpenses || []) : state.expenses);
    var siblings = arr.filter(function (x) { return (isSpecialTab(item) || isLoanTab(item)) ? true : x.type === item.type; });
    var pos = siblings.indexOf(item);
    var target = siblings[pos + dir];
    if (!target) return;
    var i = arr.indexOf(item), j = arr.indexOf(target);
    arr[i] = target; arr[j] = item;
    save();
  }

  function addItem() {
    if (tab === "전체") return; // 전체 탭은 조회/편집 전용 — 추가는 각 탭에서
    if (tab === "특수") {
      state.specials.push({
        id: uid("sp"), name: "새 특수 항목", type: "특수", mode: "fixedMonthly",
        recurrence: { kind: "period", startMonth: state.meta.horizon.start, endMonth: state.meta.horizon.end },
        effectiveValues: [{ fromMonth: state.meta.horizon.start, plannedAmount: 0, actualAmount: null }],
        actualsByMonth: {}, pastLock: true, assignedCardId: null, chargeDay: null, countsTowardPerformance: false
      });
    } else if (tab === "대출") {
      var li = JF.schema.emptyLoanExpenseItem();
      li.id = uid("ln"); li.name = "새 대출 항목";
      state.loanExpenses = state.loanExpenses || [];
      state.loanExpenses.push(li);
    } else if (tab === "추가") {
      var clamped = JF.format.ymCompare(state.meta.currentMonth, state.meta.horizon.start) < 0
        ? state.meta.horizon.start : state.meta.currentMonth;
      var itx = JF.schema.emptyExpenseItem();
      itx.id = uid("ex"); itx.name = "새 추가 항목"; itx.type = "추가";
      itx.recurrence = { kind: "oneoff", startMonth: clamped, endMonth: null };
      itx.effectiveValues = [{ fromMonth: clamped, plannedAmount: 0, actualAmount: null }];
      itx.countsTowardPerformance = true;
      state.expenses.push(itx);
    } else {
      var it = JF.schema.emptyExpenseItem();
      it.id = uid("ex"); it.name = "새 " + tab + " 항목"; it.type = tab;
      it.recurrence = { kind: tab === "교육" ? "period" : "monthly", startMonth: state.meta.horizon.start, endMonth: tab === "교육" ? state.meta.educationEnd : null };
      it.effectiveValues = [{ fromMonth: state.meta.horizon.start, plannedAmount: 0, actualAmount: null }];
      it.countsTowardPerformance = true;
      state.expenses.push(it);
    }
    save();
  }

  // ---- 카드별 실적 현황(멀티티어 게이지) -------------------------------
  function renderPerformance() {
    var host = document.getElementById("exp-performance");
    host.innerHTML = "";

    var monthInput = el("input", { type: "month", value: perfMonth,
      min: state.meta.horizon.start, max: state.meta.horizon.end,
      onChange: function () { perfMonth = monthInput.value; renderPerformance(); } });
    var header = el("div", { class: "card-header" }, [
      el("span", { class: "card-title" }, "카드별 실적 현황"),
      el("div", { class: "field-row push-right" }, [el("label", null, "월:"), monthInput])
    ]);

    var panel = el("div", { class: "perf-panel" }, []);
    var cards = state.cards || [];
    if (!cards.length) {
      panel.appendChild(el("div", { class: "muted" }, "등록된 카드가 없습니다."));
    } else {
      cards.forEach(function (card) { appendPerfRow(panel, card); });
    }

    host.appendChild(el("div", { class: "card" }, [header, el("div", { class: "card-body" }, panel)]));
  }

  // 카드 1개 분량의 실적 행(머리글 + 멀티티어 바)을 panel에 append.
  function appendPerfRow(panel, card) {
    var earned = JF.calc.performance(state, card, perfMonth, loanSchedules);
    var conds = card.performanceConditions || [];
    var tiers = [];
    conds.forEach(function (c) {
      if (c.threshold > 0 && tiers.indexOf(c.threshold) < 0) tiers.push(c.threshold);
    });
    tiers.sort(function (a, b) { return a - b; });

    var primaryCond = null;
    conds.forEach(function (c) { if (c.primary) primaryCond = c; });
    var primaryThreshold = primaryCond ? primaryCond.threshold : tiers[0];
    var met = tiers.length ? earned >= primaryThreshold : false;

    if (!tiers.length) {
      panel.appendChild(el("div", { class: "perf-row-head" }, el("span", { class: "perf-name" }, card.name)));
      panel.appendChild(el("div", { class: "muted" }, "실적조건 없음 · 실적 " + JF.format.formatMan(earned)));
      return;
    }

    var maxT = tiers[tiers.length - 1];
    var scale = maxT;
    var pct = Math.min(100, earned / scale * 100);

    panel.appendChild(el("div", { class: "perf-row-head" }, [
      el("span", { class: "perf-name" }, card.name),
      el("span", { class: "num" }, "실적 " + JF.format.formatMan(earned) + " / 최대 " + JF.format.formatMan(maxT) + (met ? " ✓" : ""))
    ]));

    var track = el("div", { class: "perf-track" }, el("div", { class: "perf-fill" + (met ? " is-met" : ""), style: { width: pct + "%" } }, ""));
    var bar = el("div", { class: "perf-bar" }, track);
    tiers.forEach(function (t) {
      var tierMet = earned >= t;
      var leftPct = (t / scale * 100) + "%";
      bar.appendChild(el("div", { class: "perf-tier" + (tierMet ? " is-met" : ""), style: { left: leftPct } }, ""));
      bar.appendChild(el("span", { class: "perf-tier-lbl" + (tierMet ? " is-met" : ""), style: { left: leftPct } }, man(t)));
    });
    panel.appendChild(bar);
  }

  function render() {
    // 자동 모드 대출 항목의 월별 금액/실적 계산에 쓰이므로 renderPerformance()보다 먼저 계산.
    loanSchedules = JF.ui.buildLoanSchedules(state);
    renderPerformance();
    renderTabs();
    var host = document.getElementById("exp-list");
    host.innerHTML = "";
    var isAll = tab === "전체";
    host.appendChild(el("div", { class: "card" }, el("div", { class: "card-body" }, el("div", { class: "field-row" }, [
      isAll ? el("span", { class: "muted" }, "고정-카드·고정-이체·생활·교육·특수·추가 항목을 한 번에 봅니다(대출 제외). 항목 추가는 각 탭에서 하세요.")
        : el("button", { class: "btn btn-primary", onClick: addItem }, "+ " + tab + " 항목 추가")
    ]))));

    var items = listForTab();
    var heads = ["항목"].concat(isAll ? ["구분"] : [], ["분류", "비용", "적용기간", "반복", "카드", "계좌", "실적", "순서", "편집"]);
    var colspan = String(heads.length);
    var thead = el("thead", null, el("tr", null, heads.map(function (h) {
      return el("th", null, h);
    })));
    var tbody = el("tbody", null, []);

    if (!items.length) {
      tbody.appendChild(el("tr", null, el("td", { colspan: colspan, class: "muted" }, tab + " 항목이 없습니다.")));
    } else {
      items.forEach(function (item) {
        var amt = item.mode === "installment"
          ? "할부 " + JF.format.formatMan(Math.round(item.installment.total / item.installment.n)) + "/월"
          : JF.format.formatMan(currentPlanned(item)) + "/월";
        tbody.appendChild(el("tr", { class: "exp-row" + (openId === item.id ? " is-open" : ""), onClick: function () {
          openId = (openId === item.id ? null : item.id); render();
        } }, [
          el("td", { class: "cell-wrap" }, item.name),
          isAll ? el("td", null, tabOf(item)) : null,
          el("td", null, el("span", { class: "cat-chip", style: { background: categoryColor(item.category) } }, item.category || "-")),
          el("td", null, amt),
          el("td", null, periodLabel(item)),
          el("td", null, recurrenceLabel(item)),
          el("td", null, cardLabel(item)),
          el("td", null, accountCell(item)),
          el("td", null, item.countsTowardPerformance ? "포함" : "제외"),
          el("td", { class: "reorder-cell" }, [
            el("button", { class: "btn btn-sm btn-ghost", onClick: function (ev) { ev.stopPropagation(); moveItem(item, -1); } }, "↑"),
            el("button", { class: "btn btn-sm btn-ghost", onClick: function (ev) { ev.stopPropagation(); moveItem(item, 1); } }, "↓")
          ]),
          el("td", null, openId === item.id ? "닫기 ▾" : "편집 ▸")
        ]));
        if (openId === item.id) {
          tbody.appendChild(el("tr", null, el("td", { class: "exp-edit-cell", colspan: colspan }, editForm(item))));
        }
      });
    }

    host.appendChild(el("div", { class: "table-wrap" }, el("table", { class: "table table-dense" }, [thead, tbody])));
  }

  function boot() {
    JF.ui.renderNav("expenses.html");
    state = JF.store.load();
    state.bankAccounts = state.bankAccounts || [];
    var params = new URLSearchParams(location.search);
    var t = params.get("tab"); if (t && ["전체", "대출", "고정-카드", "고정-이체", "생활", "교육", "특수", "추가"].indexOf(t) >= 0) tab = t;
    var o = params.get("open"); if (o) openId = o;
    perfMonth = JF.format.ymCompare(state.meta.currentMonth, state.meta.horizon.start) < 0
      ? state.meta.horizon.start : state.meta.currentMonth;
    render();
    if (JF.syncUI) JF.syncUI.bind({ get: function () { return state; }, set: function (s) { state = s; }, render: render });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();
