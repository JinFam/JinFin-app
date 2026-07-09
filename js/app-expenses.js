// app-expenses.js — 컴포넌트 3: 지출·부채 관리 (AC-3.x)
// 탭(고정/생활/교육/특수) · CRUD · 반복규칙 · 카드/결제일/실적포함 태그
// · effective-dated + pastLock(과거잠금) · 특수 2모드(고정월액/총액÷N 할부) · 이 달 실제 보정(N4).
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var state;
  var tab = "고정";           // 고정 | 생활 | 교육 | 특수
  var openId = null;          // 편집 열린 항목 id
  var perfMonth = null;       // 실적 패널 선택 월(YYYY-MM) — 재렌더시 유지(사용자 선택 보존)

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
  function save() { JF.store.save(state); render(); }
  function isSpecialTab() { return tab === "특수"; }
  function listForTab() {
    if (tab === "특수") return state.specials;
    return state.expenses.filter(function (e) { return e.type === tab; });
  }

  function currentPlanned(item) {
    var ev = JF.calc.effectiveValueFor(item, state.meta.currentMonth);
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
    var bar = el("div", { class: "field-row" }, ["고정", "생활", "교육", "특수", "추가"].map(function (t) {
      return el("button", { class: "btn btn-sm " + (tab === t ? "btn-primary" : "btn-secondary"),
        onClick: function () { tab = t; openId = null; render(); } }, t);
    }));
    host.appendChild(el("div", { class: "card" }, el("div", { class: "card-body" }, bar)));
  }

  function cardName(id) {
    var c = (state.cards || []).filter(function (x) { return x.id === id; })[0];
    return c ? c.name : id;
  }

  // 결제 수단 라벨: null=미배정 / "transfer"=계좌이체 / 그 외=카드명
  function methodLabel(item) {
    if (item.assignedCardId === "transfer") return "계좌이체";
    if (item.assignedCardId) return cardName(item.assignedCardId);
    return "미배정";
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

  // ---- 편집 폼 -------------------------------------------------------
  function editForm(item) {
    var body = el("div", { class: "card-body stack" }, []);
    // 편집 기본 적용월: 현재월이 기간(horizon) 이전이면 기간 시작월로 clamp.
    // (현재월이 기간 밖이면 currentMonth 기준 append/보정이 rollforward에 반영되지 않으므로)
    var effMonth = JF.format.ymCompare(state.meta.currentMonth, state.meta.horizon.start) < 0
      ? state.meta.horizon.start : state.meta.currentMonth;

    body.appendChild(el("div", { class: "subhead" }, "기본"));
    // 이름/카테고리 — 입력 즉시 item에 반영해 다른 저장 버튼을 눌러도 유실되지 않게 함(#3)
    var name = el("input", { type: "text", value: item.name, onInput: function () { item.name = name.value; } });
    var cat = el("input", { type: "text", value: item.category || "", list: "exp-cat-list", onInput: function () { item.category = cat.value; } });
    var catPicker = el("input", { type: "color", class: "cat-color", value: categoryColor(item.category), onChange: function () {
      if (item.category) { state.categoryColors[item.category] = catPicker.value; save(); }
    } });
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "이름:"), name, el("label", null, "분류:"), cat, catPicker]));
    body.appendChild(catDatalist());

    // 특수: 모드 선택
    if (isSpecialTab()) {
      var modeSel = el("select", { onChange: function () {
        item.mode = modeSel.value;
        if (item.mode === "installment" && !item.installment) {
          item.installment = { total: 0, n: 5, startMonth: state.meta.horizon.start, endMonth: JF.format.ymAdd(state.meta.horizon.start, 4) };
        }
        if (item.mode === "fixedMonthly" && (!item.effectiveValues || !item.effectiveValues.length)) {
          item.effectiveValues = [{ fromMonth: state.meta.horizon.start, plannedAmount: 0, actualAmount: null }];
        }
        save();
      } }, [
        el("option", { value: "fixedMonthly", selected: item.mode === "fixedMonthly" }, "고정 월액"),
        el("option", { value: "installment", selected: item.mode === "installment" }, "총액 ÷ N 할부")
      ]);
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "특수 모드:"), modeSel]));
    }

    // 금액 편집
    body.appendChild(el("div", { class: "subhead" }, "금액"));
    if (tab === "추가") {
      var amtOneoff = el("input", { type: "number", value: currentPlanned(item), min: "0", step: "1000" });
      var monthOneoff = el("input", { type: "month", value: item.recurrence.startMonth, min: state.meta.horizon.start });
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "금액(원):"), amtOneoff, el("label", null, "해당 년월:"), monthOneoff]));
      body.appendChild(el("div", { class: "field-row" }, [
        el("button", { class: "btn btn-sm btn-primary", onClick: function () {
          var mv = JF.format.ymCompare(monthOneoff.value, state.meta.horizon.start) < 0 ? state.meta.horizon.start : monthOneoff.value;
          item.recurrence.startMonth = mv;
          item.recurrence.endMonth = null;
          var prevActual = (item.effectiveValues[0] && item.effectiveValues[0].actualAmount != null) ? item.effectiveValues[0].actualAmount : null;
          item.effectiveValues = [{ fromMonth: mv, plannedAmount: Number(amtOneoff.value) || 0, actualAmount: prevActual }];
          save();
        } }, "저장")
      ]));
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
      body.appendChild(el("div", { class: "field-row" }, [
        el("button", { class: "btn btn-sm btn-primary", onClick: function () {
          item.installment.total = Number(total.value) || 0;
          item.installment.n = Number(n.value) || 1;
          item.installment.startMonth = sM.value; item.installment.endMonth = eM.value;
          save();
        } }, "할부 저장"),
        el("span", { class: "muted" }, "※ 할부는 forward-only(지난 할부월은 불변).")
      ]));
    } else {
      var amt = el("input", { type: "number", value: currentPlanned(item), min: "0", step: "1000" });
      var applyM = el("input", { type: "month", value: effMonth, min: state.meta.horizon.start });
      var lock = el("input", { type: "checkbox", checked: !!item.pastLock, onChange: function () { item.pastLock = lock.checked; save(); } });
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "월 금액(원):"), amt, el("label", null, "적용 시작월:"), applyM]));
      body.appendChild(el("div", { class: "field-row" }, [
        el("label", null, [lock, " 과거 잠금(pastLock)"]),
        el("span", { class: "muted" }, item.pastLock ? "변경 시 지난 달은 고정, 적용월부터만 반영(새 구간 추가)" : "변경 시 전 기간에 반영")
      ]));
      body.appendChild(el("div", { class: "field-row" }, [
        el("button", { class: "btn btn-sm btn-primary", onClick: function () {
          // 적용월이 기간 시작 이전이면 clamp(그 이전 구간은 rollforward가 읽지 않음) (#1/#8)
          var am = JF.format.ymCompare(applyM.value, state.meta.horizon.start) < 0 ? state.meta.horizon.start : applyM.value;
          applyAmountChange(item, Number(amt.value) || 0, am); save();
        } }, "금액 저장")
      ]));
      // effectiveValues 구간 목록
      if (item.effectiveValues && item.effectiveValues.length > 1) {
        body.appendChild(el("div", { class: "muted" }, "금액 변경 이력(구간):"));
        item.effectiveValues.slice().sort(function (a, b) { return JF.format.ymCompare(a.fromMonth, b.fromMonth); }).forEach(function (seg, idx, arr) {
          body.appendChild(el("div", { class: "field-row" }, [
            el("span", null, seg.fromMonth + "부터 " + JF.format.formatWon(seg.plannedAmount) + "원"),
            (arr.length > 1 && idx > 0) ? el("button", { class: "btn btn-sm btn-danger push-right", onClick: function () {
              item.effectiveValues = item.effectiveValues.filter(function (s) { return s !== seg; }); save();
            } }, "구간 삭제") : el("span", { class: "muted push-right" }, "(기준 구간)")
          ]));
        });
      }
    }

    // 반복 규칙 (추가 항목은 오늘 날짜의 oneoff이므로 별도 규칙 편집이 필요 없음)
    if (tab !== "추가") {
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
        body.appendChild(el("div", { class: "subhead" }, "반복"));
        body.appendChild(el("div", { class: "field-row" }, [el("label", null, "반복:"), recKind, el("label", null, "시작:"), recStart, el("label", null, "종료:"), recEnd,
          el("label", null, "개월(N):"), recN,
          el("button", { class: "btn btn-sm btn-secondary", onClick: function () {
            var rec = { kind: recKind.value, startMonth: recStart.value, endMonth: recEnd.value || null };
            if (rec.kind === "interval") rec.intervalMonths = Number(recN.value) || 1;
            item.recurrence = rec; save();
          } }, "반복 저장")]));
        body.appendChild(el("div", { class: "muted" }, "예: 시작월부터 매 3개월마다 발생 (분기)."));
        if (tab === "교육") {
          body.appendChild(el("div", { class: "muted" }, "교육비는 종료월(예: 2028-02)이 있는 기간한정 항목입니다. 분기/연 추가 지출은 반복=interval(N=3)/yearly 로 별도 항목을 추가하세요."));
        }
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
      if (isTransfer) { chargeDay.value = ""; counts.checked = false; }
    }
    var cardSel = el("select", { onChange: syncMethod }, [
      el("option", { value: "" }, "(미배정)"),
      el("option", { value: "transfer", selected: item.assignedCardId === "transfer" }, "계좌이체(카드 아님)")
    ].concat(
      (state.cards || []).map(function (c) { return el("option", { value: c.id, selected: item.assignedCardId === c.id }, c.name); })));
    syncMethod();
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "결제 수단:"), cardSel, el("label", null, "결제일:"), chargeDay,
      el("label", null, [counts, " 실적 포함"])]));
    body.appendChild(el("div", { class: "field-row" }, [
      el("button", { class: "btn btn-sm btn-secondary", onClick: function () {
        var newCard = cardSel.value || null;
        var isTransfer = newCard === "transfer";
        var isRealCard = !!newCard && !isTransfer;
        var newDay = chargeDay.value === "" ? null : Number(chargeDay.value);
        // 실적 포함 + 실제 카드 배정이면 결제일 필수 (#4: null이면 chargeDate가 전월로 오귀속)
        if (isRealCard && counts.checked && (newDay == null || newDay < 1 || newDay > 31)) {
          JF.ui.showBanner("실적 포함 + 카드 배정 항목은 결제일(1~31)이 필요합니다.", "warn");
          return;
        }
        item.assignedCardId = newCard;
        item.chargeDay = isTransfer ? null : newDay;                 // 계좌이체는 결제일 없음
        item.countsTowardPerformance = isTransfer ? false : counts.checked; // 계좌이체는 실적 제외
        item.name = name.value; item.category = cat.value;
        save();
      } }, "태그/이름 저장"),
      el("span", { class: "muted" }, "카드 대신 계좌이체면 결제 수단에서 '계좌이체' 선택(자동 실적 제외). 주유비는 혜택은 받되 '실적 포함' 해제(주유 실적 제외 카드).")
    ]));

    // 이 달 실제 보정 (N4) — 원 단위 입력, 기간 시작월 기본
    body.appendChild(el("div", { class: "subhead" }, "실제 보정"));
    var corrM = el("input", { type: "month", value: effMonth, min: state.meta.horizon.start });
    var corrA = el("input", { type: "number", placeholder: "실제 원", min: "0", step: "1000" });
    body.appendChild(el("div", { class: "field-row" }, [
      el("label", null, "이 달 실제 보정(원):"), corrM, corrA,
      el("button", { class: "btn btn-sm btn-secondary", onClick: function () {
        if (corrM.value && corrA.value !== "") {
          item.actualsByMonth = item.actualsByMonth || {};
          item.actualsByMonth[corrM.value] = Number(corrA.value) || 0; save();
        }
      } }, "실제값 저장")
    ]));
    var corrKeys = Object.keys(item.actualsByMonth || {}).sort();
    if (corrKeys.length) {
      body.appendChild(el("div", { class: "muted" }, "보정된 실제값:"));
      corrKeys.forEach(function (m) {
        body.appendChild(el("div", { class: "field-row" }, [
          el("span", null, m + ": " + JF.format.formatMan(item.actualsByMonth[m])),
          el("button", { class: "btn btn-sm btn-danger push-right", onClick: function () { delete item.actualsByMonth[m]; save(); } }, "삭제")
        ]));
      });
    }

    // 삭제
    body.appendChild(el("div", { class: "card-footer" }, [
      el("button", { class: "btn btn-sm btn-danger", onClick: function () {
        if (window.confirm("삭제할까요? (" + item.name + ")")) { removeItem(item); }
      } }, "항목 삭제")
    ]));

    return el("div", { class: "card" }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, item.name + " — 편집")),
      body
    ]);
  }

  function removeItem(item) {
    if (isSpecialTab()) { state.specials = state.specials.filter(function (x) { return x.id !== item.id; }); }
    else { state.expenses = state.expenses.filter(function (x) { return x.id !== item.id; }); }
    openId = null; save();
  }

  // 항목 순서 이동: dir -1(위) / +1(아래). 같은 탭(type) 내에서만 이동, 경계에서는 no-op.
  function moveItem(item, dir) {
    var arr = isSpecialTab() ? state.specials : state.expenses;
    var siblings = arr.filter(function (x) { return isSpecialTab() ? true : x.type === item.type; });
    var pos = siblings.indexOf(item);
    var target = siblings[pos + dir];
    if (!target) return;
    var i = arr.indexOf(item), j = arr.indexOf(target);
    arr[i] = target; arr[j] = item;
    save();
  }

  function addItem() {
    if (isSpecialTab()) {
      state.specials.push({
        id: uid("sp"), name: "새 특수 항목", type: "특수", mode: "fixedMonthly",
        recurrence: { kind: "period", startMonth: state.meta.horizon.start, endMonth: state.meta.horizon.end },
        effectiveValues: [{ fromMonth: state.meta.horizon.start, plannedAmount: 0, actualAmount: null }],
        actualsByMonth: {}, pastLock: true, assignedCardId: null, chargeDay: null, countsTowardPerformance: false
      });
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
    var earned = JF.calc.performance(state, card, perfMonth);
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
    renderPerformance();
    renderTabs();
    var host = document.getElementById("exp-list");
    host.innerHTML = "";
    host.appendChild(el("div", { class: "card" }, el("div", { class: "card-body" }, el("div", { class: "field-row" }, [
      el("button", { class: "btn btn-primary", onClick: addItem }, "+ " + tab + " 항목 추가")
    ]))));

    var items = listForTab();
    var thead = el("thead", null, el("tr", null, ["항목", "분류", "비용", "적용기간", "반복", "카드", "실적", "순서", "편집"].map(function (h) {
      return el("th", null, h);
    })));
    var tbody = el("tbody", null, []);

    if (!items.length) {
      tbody.appendChild(el("tr", null, el("td", { colspan: "9", class: "muted" }, tab + " 항목이 없습니다.")));
    } else {
      items.forEach(function (item) {
        var amt = item.mode === "installment"
          ? "할부 " + JF.format.formatMan(Math.round(item.installment.total / item.installment.n)) + "/월"
          : JF.format.formatMan(currentPlanned(item)) + "/월";
        tbody.appendChild(el("tr", { class: "exp-row" + (openId === item.id ? " is-open" : ""), onClick: function () {
          openId = (openId === item.id ? null : item.id); render();
        } }, [
          el("td", { class: "cell-wrap" }, item.name),
          el("td", null, el("span", { class: "cat-chip", style: { background: categoryColor(item.category) } }, item.category || "-")),
          el("td", null, amt),
          el("td", null, periodLabel(item)),
          el("td", null, recurrenceLabel(item)),
          el("td", null, methodLabel(item)),
          el("td", null, item.countsTowardPerformance ? "포함" : "제외"),
          el("td", { class: "reorder-cell" }, [
            el("button", { class: "btn btn-sm btn-ghost", onClick: function (ev) { ev.stopPropagation(); moveItem(item, -1); } }, "↑"),
            el("button", { class: "btn btn-sm btn-ghost", onClick: function (ev) { ev.stopPropagation(); moveItem(item, 1); } }, "↓")
          ]),
          el("td", null, openId === item.id ? "닫기 ▾" : "편집 ▸")
        ]));
        if (openId === item.id) {
          tbody.appendChild(el("tr", null, el("td", { class: "exp-edit-cell", colspan: "9" }, editForm(item))));
        }
      });
    }

    host.appendChild(el("div", { class: "table-wrap" }, el("table", { class: "table table-dense" }, [thead, tbody])));
  }

  function boot() {
    JF.ui.renderNav("expenses.html");
    state = JF.store.load();
    var params = new URLSearchParams(location.search);
    var t = params.get("tab"); if (t && ["고정", "생활", "교육", "특수", "추가"].indexOf(t) >= 0) tab = t;
    var o = params.get("open"); if (o) openId = o;
    perfMonth = JF.format.ymCompare(state.meta.currentMonth, state.meta.horizon.start) < 0
      ? state.meta.horizon.start : state.meta.currentMonth;
    render();
    if (JF.syncUI) JF.syncUI.bind({ get: function () { return state; }, set: function (s) { state = s; }, render: render });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();
