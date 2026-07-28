// app-loan.js — 대출계산기: 케이스 CRUD + 대출 계산(원리금균등 상환표) + 대출 비교.
// 계산은 JF.loan(순수 엔진)에 위임. 최종금리 연동 해석은 여기서 사전 처리(엔진은 JF.ui 무참조).
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var state;
  var editingId = null;     // null=폼 숨김, ""=신규, caseId=기존 편집
  var selectedCaseId = null; // "대출 계산" 섹션에 표시 중인 케이스
  var compareIds = [];       // 비교 체크된 케이스 id(로컬 전용, 동기화 안 함, 최대 3개)
  var calcCollapsed = true;    // "대출 계산" 펼치기/접기(기본 접힘)
  var compareCollapsed = true; // "대출 비교" 펼치기/접기(기본 접힘)
  var payoffCompareCollapsed = true; // "시점별 총비용 비교" 펼치기/접기(기본 접힘)
  var payoffN = 6;                    // 선택된 N(개월), 기본값 6

  function uid(p) { return p + "-" + Math.random().toString(36).slice(2, 8); }
  function save() {
    JF.store.save(state);
    render();
    if (JF.ui && typeof JF.ui.refreshRepPayment === "function") JF.ui.refreshRepPayment();
  }

  // 케이스 목록/헤더 표기용 이율 문자열 — resolveRate()에 위임(단일 소스).
  function rateDisplay(c) {
    var r = resolveRate(c);
    return Number(r.value).toFixed(2) + "%" + (c.linkToFinalRate ? " (" + r.source + ")" : "");
  }

  // 대표 대출 지정/해제(기기 로컬). 지정 시 상단 헤더에 예상 원리금 표기.
  function toggleRep(id) {
    if (!JF.ui || typeof JF.ui.setRepresentativeLoan !== "function") return;
    var cur = JF.ui.getRepresentativeLoan();
    JF.ui.setRepresentativeLoan(cur === id ? null : id);
    render();
  }
  function man(n) { return JF.format.toMan(n); }
  function fromMan(m) { return JF.format.fromMan(m); }
  function won(n) { return JF.format.formatWon(n) + "원"; }

  // seriesId → JF.ratesData.banks의 표시용 label(못 찾으면 seriesId 원문, 없으면 "기준금리").
  function seriesLabel(seriesId) {
    if (!seriesId) return "기준금리";
    var banks = (JF.ratesData && JF.ratesData.banks) || [];
    var found = banks.filter(function (b) { return b.id === seriesId; })[0];
    return found ? found.label : seriesId;
  }

  // ---- rate 사전해석(기준금리+가산금리, js/ui.js resolveCaseRate와 동일 규칙의 독립 구현) ----
  // { value: number, source: string(표시용 라벨) }
  function resolveRate(loanCase) {
    var c = loanCase || {};
    if (c.linkToFinalRate) {
      var base = null;
      if (c.baseRateSeriesId && JF.ratesData && JF.ratesData.series && JF.ratesData.series[c.baseRateSeriesId] &&
          JF.rates && typeof JF.rates.latestValue === "function") {
        base = JF.rates.latestValue(JF.ratesData.series[c.baseRateSeriesId]);
      }
      if (base != null) {
        var label = seriesLabel(c.baseRateSeriesId);
        return { value: base + (Number(c.spreadRate) || 0), source: "연동(" + label + ")" };
      }
      return { value: Number(c.annualRate) || 0, source: "연동(기준금리 미확인 — 수동 폴백값 사용)" };
    }
    return { value: (Number(c.baseRateManual) || 0) + (Number(c.spreadRate) || 0), source: "수동입력" };
  }

  function computeForCase(loanCase) {
    var rateInfo = resolveRate(loanCase);
    var resolved = {
      amount: loanCase.amount,
      termMonths: loanCase.termMonths,
      annualRate: rateInfo.value,
      graceMonths: loanCase.graceMonths,
      startDate: loanCase.startDate,
      extraPayment: loanCase.extraPayment || { amount: 0, fromInstallment: 0 },
      prepayments: loanCase.prepayments || [],
      rateChanges: loanCase.rateChanges || []
    };
    var schedule = JF.loan.computeSchedule(resolved);
    var prepayFee = loanCase.prepayFee || JF.schema.emptyLoanCase().prepayFee;
    var rowsWithFee = (JF.loan.computePrepayFeeSchedule && resolved.startDate && schedule.rows.length)
      ? JF.loan.computePrepayFeeSchedule({ amount: resolved.amount, startDate: resolved.startDate, prepayFee: prepayFee }, schedule.rows)
      : schedule.rows;
    return { result: { rows: rowsWithFee, summary: schedule.summary }, rateInfo: rateInfo };
  }

  function findCase(id) {
    return (state.loans || []).filter(function (c) { return c.id === id; })[0];
  }

  function removeCase(id) {
    var c = findCase(id);
    if (!window.confirm("이 대출 케이스를 삭제할까요?" + (c && c.name ? " (" + c.name + ")" : ""))) return;
    state.loans = state.loans.filter(function (x) { return x.id !== id; });
    if (selectedCaseId === id) selectedCaseId = null;
    var idx = compareIds.indexOf(id);
    if (idx !== -1) compareIds.splice(idx, 1);
    if (JF.ui && typeof JF.ui.getRepresentativeLoan === "function" && JF.ui.getRepresentativeLoan() === id) {
      JF.ui.setRepresentativeLoan(null); // 대표로 지정된 케이스 삭제 → 헤더 표기 해제
    }
    save();
  }

  function toggleCompare(id) {
    var idx = compareIds.indexOf(id);
    if (idx !== -1) {
      compareIds.splice(idx, 1);
      render();
      return;
    }
    if (compareIds.length >= 3) {
      if (JF.ui && typeof JF.ui.showBanner === "function") {
        JF.ui.showBanner("비교는 최대 3개까지 선택할 수 있습니다.", "warn");
      }
      render();
      return;
    }
    var wasEmpty = compareIds.length === 0;
    compareIds.push(id);
    if (wasEmpty) { compareCollapsed = false; payoffCompareCollapsed = false; } // 첫 케이스 선택 시 두 비교 섹션 모두 자동으로 펼침
    render();
  }

  // ---- 케이스 편집 폼(신규/수정 공용) ----------------------------------
  function caseEditor(existingCase) {
    var isNew = !existingCase;
    var c = existingCase ? JSON.parse(JSON.stringify(existingCase)) : JF.schema.emptyLoanCase();
    if (isNew) c.id = uid("loan");
    if (!c.extraPayment || typeof c.extraPayment !== "object") c.extraPayment = { amount: 0, fromInstallment: 0, toInstallment: 0 };
    if (typeof c.extraPayment.toInstallment !== "number") c.extraPayment.toInstallment = 0;
    if (!Array.isArray(c.prepayments)) c.prepayments = [];
    if (!Array.isArray(c.rateChanges)) c.rateChanges = [];
    if (!c.prepayFee || typeof c.prepayFee !== "object") c.prepayFee = JF.schema.emptyLoanCase().prepayFee;

    var body = el("div", { class: "card-body stack" }, []);

    var nameInput = el("input", { type: "text", value: c.name || "", onInput: function () { c.name = nameInput.value; } });
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "이름:"), nameInput]));

    var amountInput = el("input", { type: "number", value: man(c.amount), min: "0", step: "0.1", onInput: function () { c.amount = fromMan(amountInput.value); } });
    var termInput = el("input", { type: "number", value: c.termMonths, min: "0", step: "1", onInput: function () { c.termMonths = parseInt(termInput.value, 10) || 0; } });
    body.appendChild(el("div", { class: "field-row" }, [
      el("label", null, "대출금액(만원):"), amountInput,
      el("label", null, "대출기간(개월):"), termInput
    ]));

    var graceInput = el("input", { type: "number", value: c.graceMonths, min: "0", step: "1", onInput: function () { c.graceMonths = parseInt(graceInput.value, 10) || 0; } });
    var startInput = el("input", { type: "date", value: c.startDate || "", onChange: function () { c.startDate = startInput.value; } });
    body.appendChild(el("div", { class: "field-row" }, [
      el("label", null, "거치기간(개월):"), graceInput,
      el("label", null, "대출 실행일:"), startInput
    ]));

    var linkCb = el("input", { type: "checkbox", checked: !!c.linkToFinalRate, onChange: function () { c.linkToFinalRate = linkCb.checked; syncRateFields(); } });

    var seriesSelect = el("select", { onChange: function () { c.baseRateSeriesId = seriesSelect.value || null; syncRateFields(); } },
      [el("option", { value: "", selected: !c.baseRateSeriesId }, "(선택)")].concat(
        ((JF.ratesData && JF.ratesData.banks) || []).map(function (b) {
          return el("option", { value: b.id, selected: c.baseRateSeriesId === b.id }, b.label);
        })
      ));
    var baseReadout = el("span", { class: "muted" }, "—");
    var baseManualInput = el("input", { type: "number", value: c.baseRateManual, min: "0", step: "0.01",
      onInput: function () { c.baseRateManual = parseFloat(baseManualInput.value) || 0; refreshPreview(); } });
    var spreadInput = el("input", { type: "number", value: c.spreadRate, step: "0.01",
      onInput: function () { c.spreadRate = parseFloat(spreadInput.value) || 0; refreshPreview(); } });
    var previewSpan = el("span", { class: "muted" }, "");

    function refreshBaseReadout() {
      var series = (c.baseRateSeriesId && JF.ratesData && JF.ratesData.series) ? JF.ratesData.series[c.baseRateSeriesId] : null;
      if (series && series.length) {
        var last = series[series.length - 1];
        baseReadout.textContent = Number(last[1]).toFixed(2) + "% (기준일 " + last[0] + ")";
      } else {
        baseReadout.textContent = "—";
      }
    }
    function refreshPreview() {
      previewSpan.textContent = "최종금리 " + Number(resolveRate(c).value).toFixed(2) + "%";
    }
    function syncRateFields() {
      seriesSelect.disabled = !c.linkToFinalRate;
      baseManualInput.disabled = !!c.linkToFinalRate;
      refreshBaseReadout();
      refreshPreview();
    }
    syncRateFields();

    body.appendChild(el("div", { class: "field-row" }, [
      linkCb, el("span", { class: "muted" }, "최종금리 연동")
    ]));
    body.appendChild(el("div", { class: "field-row" }, [
      el("label", null, "기준금리 시계열:"), seriesSelect, baseReadout
    ]));
    body.appendChild(el("div", { class: "field-row" }, [
      el("label", null, "기준금리 수동입력(%):"), baseManualInput,
      el("label", null, "가산금리(%):"), spreadInput
    ]));
    body.appendChild(el("div", { class: "field-row" }, [previewSpan]));
    body.appendChild(el("div", { class: "muted" }, "연동 체크 시 선택한 기준금리 시계열의 최신값 + 가산금리로 계산됩니다. 기준금리를 직접 입력하려면 연동을 해제하세요. 가산금리는 연동 여부와 무관하게 항상 직접 입력합니다."));

    body.appendChild(el("div", { class: "subhead" }, "월 상환금액(추가 원금)"));
    var extraAmountInput = el("input", { type: "number", value: man(c.extraPayment.amount), min: "0", step: "0.1", onInput: function () { c.extraPayment.amount = fromMan(extraAmountInput.value); } });
    var extraFromInput = el("input", { type: "number", value: c.extraPayment.fromInstallment, min: "0", step: "1", onInput: function () { c.extraPayment.fromInstallment = parseInt(extraFromInput.value, 10) || 0; } });
    var extraToInput = el("input", { type: "number", value: (c.extraPayment.toInstallment || ""), min: "0", step: "1", placeholder: "만기까지", onInput: function () { c.extraPayment.toInstallment = parseInt(extraToInput.value, 10) || 0; } });
    body.appendChild(el("div", { class: "field-row" }, [
      el("label", null, "추가 원금(만원):"), extraAmountInput,
      el("label", null, "시작 회차:"), extraFromInput,
      el("label", null, "끝 회차:"), extraToInput
    ]));
    body.appendChild(el("div", { class: "muted" }, "예정 원리금(거치 중에는 이자) 위에 시작~끝 회차 동안 매월 추가 원금을 더 냅니다. 끝 회차를 비우면 만기(또는 조기상환)까지 적용됩니다. 거치기간에도 적용되며, 잔액을 더 빨리 소진해 조기 종료될 수 있습니다."));

    // 중도상환(회차별 목돈)
    body.appendChild(el("div", { class: "subhead" }, "중도상환(회차별 목돈)"));
    var prepayHost = el("div", { class: "stack" }, []);
    function drawPrepay() {
      prepayHost.innerHTML = "";
      c.prepayments.forEach(function (p) {
        var insIn = el("input", { type: "number", value: p.installment, min: "1", step: "1", onInput: function () { p.installment = parseInt(insIn.value, 10) || 0; } });
        var amtIn = el("input", { type: "number", value: man(p.amount), min: "0", step: "0.1", onInput: function () { p.amount = fromMan(amtIn.value); } });
        prepayHost.appendChild(el("div", { class: "field-row" }, [
          el("label", null, "회차:"), insIn,
          el("label", null, "금액(만원):"), amtIn,
          el("button", { class: "btn btn-sm btn-danger", onClick: function () { c.prepayments = c.prepayments.filter(function (x) { return x !== p; }); drawPrepay(); } }, "삭제")
        ]));
      });
      prepayHost.appendChild(el("button", { class: "btn btn-sm btn-ghost", onClick: function () {
        c.prepayments.push({ id: uid("prepay"), installment: 1, amount: 0 }); drawPrepay();
      } }, "+ 중도상환 추가"));
    }
    drawPrepay();
    body.appendChild(prepayHost);

    // 금리변동(회차부터 이율 변경)
    body.appendChild(el("div", { class: "subhead" }, "금리변동(회차부터 이율 변경)"));
    var rateHost = el("div", { class: "stack" }, []);
    function drawRateChanges() {
      rateHost.innerHTML = "";
      c.rateChanges.forEach(function (rc) {
        var fromIn = el("input", { type: "number", value: rc.fromInstallment, min: "1", step: "1", onInput: function () { rc.fromInstallment = parseInt(fromIn.value, 10) || 0; } });
        var rateIn = el("input", { type: "number", value: rc.annualRate, min: "0", step: "0.01", onInput: function () { rc.annualRate = parseFloat(rateIn.value) || 0; } });
        rateHost.appendChild(el("div", { class: "field-row" }, [
          el("label", null, "회차부터:"), fromIn,
          el("label", null, "연이자율(%):"), rateIn,
          el("button", { class: "btn btn-sm btn-danger", onClick: function () { c.rateChanges = c.rateChanges.filter(function (x) { return x !== rc; }); drawRateChanges(); } }, "삭제")
        ]));
      });
      rateHost.appendChild(el("button", { class: "btn btn-sm btn-ghost", onClick: function () {
        c.rateChanges.push({ id: uid("rate"), fromInstallment: 1, annualRate: 0 }); drawRateChanges();
      } }, "+ 금리변동 추가"));
    }
    drawRateChanges();
    body.appendChild(rateHost);

    // 중도상환수수료
    body.appendChild(el("div", { class: "subhead" }, "중도상환수수료"));
    var feeRateInput = el("input", { type: "number", value: c.prepayFee.ratePercent, min: "0", step: "0.01",
      onInput: function () { c.prepayFee.ratePercent = parseFloat(feeRateInput.value) || 0; } });
    var feeWindowInput = el("input", { type: "number", value: c.prepayFee.feeWindowMonths, min: "0", step: "1",
      onInput: function () { c.prepayFee.feeWindowMonths = parseInt(feeWindowInput.value, 10) || 0; } });
    body.appendChild(el("div", { class: "field-row" }, [
      el("label", null, "수수료율(%):"), feeRateInput,
      el("label", null, "적용기간(개월, 0=무제한):"), feeWindowInput
    ]));

    var feeDayProrationCb = el("input", { type: "checkbox", checked: !!c.prepayFee.dayProration,
      onChange: function () { c.prepayFee.dayProration = feeDayProrationCb.checked; } });
    body.appendChild(el("div", { class: "field-row" }, [
      feeDayProrationCb, el("span", { class: "muted" }, "일수비례 적용")
    ]));

    var feeExemptionPercentInput = el("input", { type: "number", value: c.prepayFee.exemptionPercent, min: "0", step: "0.01",
      onInput: function () { c.prepayFee.exemptionPercent = parseFloat(feeExemptionPercentInput.value) || 0; } });
    var feeExemptionBasisSelect = el("select", { onChange: function () { c.prepayFee.exemptionBasis = feeExemptionBasisSelect.value; } }, [
      el("option", { value: "principal", selected: c.prepayFee.exemptionBasis === "principal" }, "최초 원금"),
      el("option", { value: "balance", selected: c.prepayFee.exemptionBasis === "balance" }, "해당 시점 잔액")
    ]);
    var feeExemptionPeriodSelect = el("select", { onChange: function () { c.prepayFee.exemptionPeriod = feeExemptionPeriodSelect.value; } }, [
      el("option", { value: "annual", selected: c.prepayFee.exemptionPeriod === "annual" }, "매년(대출연도)"),
      el("option", { value: "once", selected: c.prepayFee.exemptionPeriod === "once" }, "전체 기간 1회")
    ]);
    body.appendChild(el("div", { class: "field-row" }, [
      el("label", null, "면제율(%):"), feeExemptionPercentInput,
      el("label", null, "면제 기준:"), feeExemptionBasisSelect,
      el("label", null, "면제 주기:"), feeExemptionPeriodSelect
    ]));
    body.appendChild(el("div", { class: "muted" }, "전액상환 시 수수료 = (잔액 − 면제한도) × 수수료율 × 잔존일수비례. 적용기간이 지나면 수수료가 0이 됩니다."));

    body.appendChild(el("div", { class: "card-footer" }, [
      el("button", { class: "btn btn-primary", onClick: function () {
        c.annualRate = resolveRate(c).value; // annualRate를 최신 스냅샷으로 갱신(구버전 코드/동기화 상대방 호환용)
        if (isNew) {
          state.loans.push(c);
        } else {
          var i = state.loans.findIndex(function (x) { return x.id === c.id; });
          if (i >= 0) state.loans[i] = c;
        }
        editingId = null;
        save();
      } }, "저장"),
      el("button", { class: "btn btn-ghost", onClick: function () { editingId = null; render(); } }, "취소")
    ]));

    return el("div", { class: "card" }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, isNew ? "새 대출 케이스" : "케이스 편집")),
      body
    ]);
  }

  // ---- 케이스 목록 ------------------------------------------------------
  function caseRow(c) {
    var checked = compareIds.indexOf(c.id) !== -1;
    var compareCb = el("input", { type: "checkbox", checked: checked, onChange: function () { toggleCompare(c.id); } });
    var isRep = !!(JF.ui && typeof JF.ui.getRepresentativeLoan === "function" && JF.ui.getRepresentativeLoan() === c.id);
    return el("tr", null, [
      el("td", null, c.name || "(이름 없음)"),
      el("td", { class: "num" }, won(c.amount)),
      el("td", { class: "num" }, c.termMonths + "개월"),
      el("td", { class: "num" }, rateDisplay(c)),
      el("td", null, c.startDate || "-"),
      el("td", null, [
        el("button", { class: "btn btn-sm btn-primary", onClick: function () { selectedCaseId = c.id; calcCollapsed = false; render(); } }, "대출 계산"),
        el("button", { class: "btn btn-sm btn-secondary", onClick: function () { editingId = c.id; render(); } }, "편집"),
        el("button", { class: "btn btn-sm btn-danger", onClick: function () { removeCase(c.id); } }, "삭제")
      ]),
      el("td", { class: "text-center" }, [compareCb, el("span", { class: "muted" }, " 비교")]),
      el("td", { class: "text-center" },
        el("button", { class: "btn btn-sm " + (isRep ? "btn-primary" : "btn-ghost"), onClick: function () { toggleRep(c.id); } },
          isRep ? "★ 대표" : "대표 지정"))
    ]);
  }

  function renderCaseListCard() {
    var list = state.loans || [];
    var thead = el("thead", null, el("tr", null,
      ["이름", "금액", "기간", "연이자율", "실행일", "작업", "비교(최대 3)", "대표 대출"].map(function (h) { return el("th", null, h); })));
    var tbody = list.length
      ? el("tbody", null, list.map(caseRow))
      : el("tbody", null, el("tr", null, el("td", { class: "muted", colspan: "8" }, "등록된 대출 케이스가 없습니다. 위 [+ 케이스 추가]로 등록하세요.")));

    return el("div", { class: "card" }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, "케이스 목록")),
      el("div", { class: "card-body" }, el("div", { class: "table-wrap" }, el("table", { class: "table table-dense" }, [thead, tbody])))
    ]);
  }

  function renderCases() {
    var host = document.getElementById("loan-cases");
    host.innerHTML = "";

    var header = el("div", { class: "card-header" }, [
      el("span", { class: "card-title" }, "대출 케이스"),
      el("button", { class: "btn btn-sm btn-secondary", onClick: function () { editingId = ""; render(); } }, "+ 케이스 추가")
    ]);
    var formBody = el("div", { class: "card-body stack" }, []);
    if (editingId !== null) {
      var existing = editingId === "" ? null : findCase(editingId);
      formBody.appendChild(caseEditor(existing));
    } else {
      formBody.appendChild(el("p", { class: "muted" }, "[+ 케이스 추가]를 눌러 새 대출 케이스를 등록하거나, 아래 목록에서 [편집]을 누르세요."));
    }
    host.appendChild(el("div", { class: "card" }, [header, formBody]));
    host.appendChild(renderCaseListCard());
  }

  // ---- 대출 계산 --------------------------------------------------------
  function kpiTile(label, value, sub) {
    return el("div", { class: "kpi-tile" }, [
      el("div", { class: "kpi-label" }, label),
      el("div", { class: "kpi-value" }, value),
      el("div", { class: "kpi-sub" }, sub || "")
    ]);
  }

  // 카드 헤더용 펼치기/접기 토글 버튼.
  function collapseToggle(collapsed, onToggle) {
    return el("button", { class: "btn btn-sm btn-ghost push-right", onClick: onToggle },
      collapsed ? "▶ 펼치기" : "▼ 접기");
  }

  function renderCalc() {
    var host = document.getElementById("loan-calc");
    host.innerHTML = "";

    var loanCase = selectedCaseId ? findCase(selectedCaseId) : null;
    if (selectedCaseId && !loanCase) selectedCaseId = null;

    var title = "대출 계산" + (loanCase ? " — " + (loanCase.name || "(이름 없음)") : "");
    var header = el("div", { class: "card-header" }, [
      el("span", { class: "card-title" }, title),
      collapseToggle(calcCollapsed, function () { calcCollapsed = !calcCollapsed; render(); })
    ]);

    if (calcCollapsed) {
      var hint = loanCase
        ? "접힘 · [펼치기]로 상환표를 확인하세요."
        : "접힘 · 위 케이스 목록에서 [대출 계산]을 누르면 상환표가 펼쳐집니다.";
      host.appendChild(el("div", { class: "card" }, [header, el("div", { class: "card-body" }, el("p", { class: "muted" }, hint))]));
      return;
    }

    if (!loanCase) {
      host.appendChild(el("div", { class: "card" }, [header,
        el("div", { class: "card-body" }, el("p", { class: "muted" }, "위 케이스 목록에서 [대출 계산] 버튼을 눌러 상환표를 확인하세요."))]));
      return;
    }

    var calc = computeForCase(loanCase);
    var summary = calc.result.summary;
    var rows = calc.result.rows;
    var rateInfo = calc.rateInfo;

    var hasEvents = summary.hasRateChanges ||
      (loanCase.prepayments && loanCase.prepayments.length > 0) ||
      (loanCase.extraPayment && Number(loanCase.extraPayment.amount) > 0);

    var termSub = (summary.actualMonths !== summary.termMonths ? "명목 " + summary.termMonths + "개월" : "") +
      (summary.graceMonths > 0 ? (summary.actualMonths !== summary.termMonths ? " · " : "") + "거치 " + summary.graceMonths + "개월" : "");

    var kpis = el("div", { class: "kpi-grid" }, [
      kpiTile("금액", won(summary.amount)),
      kpiTile("상환기간", summary.actualMonths + "개월", termSub),
      kpiTile("연이자율", Number(rateInfo.value).toFixed(2) + "%", rateInfo.source + (summary.hasRateChanges ? " · 회차별 변동" : "")),
      kpiTile("월원리금상환액", won(summary.firstMonthlyPayment), hasEvents ? "회차별 변동" : "세그먼트 내 고정"),
      kpiTile("총이자액", won(summary.totalInterest))
    ]);

    var notice = null;
    if (loanCase.linkToFinalRate && rateInfo.source.indexOf("미확인") !== -1) {
      notice = el("p", { class: "muted" }, "최종금리를 아직 불러오지 못했습니다(오프라인/file:// 등) — 케이스에 저장된 연이자율(수동 입력값)을 임시로 사용 중입니다. 최종금리 로드 시 자동으로 재계산됩니다.");
    }

    var thead = el("thead", null, el("tr", null, [
      el("th", null, "회차"),
      el("th", null, "상환일"),
      el("th", { class: "num" }, "상환원금"),
      el("th", { class: "num" }, "이자액"),
      el("th", { class: "num loan-hl-pay" }, "납부액"),
      el("th", { class: "num loan-hl-bal" }, "대출잔액"),
      el("th", { class: "num" }, "중도상환수수료(전액상환기준)")
    ]));
    var tbody = el("tbody", null, rows.map(function (row) {
      var hasPrepay = row.prepay > 0;
      var principalCell = hasPrepay
        ? el("td", { class: "num loan-prepay-cell" }, [
            won(row.principal),
            el("span", { class: "badge badge-prepay", title: "중도상환 " + won(row.prepay) + " 포함" },
              "중도 +" + JF.format.formatMan(row.prepay))
          ])
        : el("td", { class: "num" }, won(row.principal));
      return el("tr", { class: hasPrepay ? "loan-prepay-row" : null }, [
        el("td", null, String(row.n)),
        el("td", null, row.date || "-"),
        principalCell,
        el("td", { class: "num" }, won(row.interest)),
        el("td", { class: "num loan-hl-pay" }, won(row.payment)),
        el("td", { class: "num loan-hl-bal" }, won(row.balance)),
        el("td", { class: "num" }, won(row.prepayFeeFull != null ? row.prepayFeeFull : 0))
      ]);
    }));

    var bodyChildren = [kpis];
    if (notice) bodyChildren.push(notice);
    bodyChildren.push(el("div", { class: "table-wrap" }, el("table", { class: "table table-dense" }, [thead, tbody])));

    host.appendChild(el("div", { class: "card" }, [
      header,
      el("div", { class: "card-body stack" }, bodyChildren)
    ]));
  }

  // ---- 대출 비교 --------------------------------------------------------
  function renderCompare() {
    var host = document.getElementById("loan-compare");
    host.innerHTML = "";

    var header = el("div", { class: "card-header" }, [
      el("span", { class: "card-title" }, "대출 비교 (" + compareIds.length + "/3)"),
      collapseToggle(compareCollapsed, function () { compareCollapsed = !compareCollapsed; render(); })
    ]);

    if (compareCollapsed) {
      var hint = compareIds.length
        ? "접힘 · [펼치기]로 비교 표를 확인하세요(" + compareIds.length + "개 선택됨)."
        : "접힘 · 케이스 목록에서 비교 체크박스를 선택하면 펼쳐집니다(최대 3개).";
      host.appendChild(el("div", { class: "card" }, [header, el("div", { class: "card-body" }, el("p", { class: "muted" }, hint))]));
      return;
    }

    if (!compareIds.length) {
      host.appendChild(el("div", { class: "card" }, [header,
        el("div", { class: "card-body" }, el("p", { class: "muted" }, "케이스 목록에서 비교 체크박스를 선택하세요(최대 3개)."))]));
      return;
    }

    var cases = compareIds.map(findCase).filter(Boolean);
    // 캐시 없음 → 매번 엔진 재계산(비교도 대출 계산과 동일 결과, stale 방지)
    var computed = cases.map(function (c) { return { loanCase: c, out: computeForCase(c).result }; });
    var maxLen = computed.reduce(function (m, c) { return Math.max(m, c.out.rows.length); }, 0);

    var theadCells = [el("th", null, "회차"), el("th", null, "상환일")];
    computed.forEach(function (c, ci) {
      var nm = c.loanCase.name || "(이름없음)";
      theadCells.push(el("th", { class: "num loan-cmp-c" + ci + "-pay" }, nm + " 납부액"));
      theadCells.push(el("th", { class: "num loan-cmp-c" + ci + "-bal" }, nm + " 잔액"));
    });
    var thead = el("thead", null, el("tr", null, theadCells));

    var bodyRows = [];
    for (var i = 0; i < maxLen; i++) {
      var anyRow = null;
      for (var j = 0; j < computed.length; j++) { if (computed[j].out.rows[i]) { anyRow = computed[j].out.rows[i]; break; } }
      var cells = [
        el("td", null, anyRow ? String(anyRow.n) : String(i + 1)),
        el("td", null, anyRow ? (anyRow.date || "-") : "-")
      ];
      computed.forEach(function (c, ci) {
        var row = c.out.rows[i];
        cells.push(el("td", { class: "num loan-cmp-c" + ci + "-pay" }, row ? won(row.payment) : "-"));
        cells.push(el("td", { class: "num loan-cmp-c" + ci + "-bal" }, row ? won(row.balance) : "-"));
      });
      bodyRows.push(el("tr", null, cells));
    }
    var tbody = el("tbody", null, bodyRows);

    host.appendChild(el("div", { class: "card" }, [
      header,
      el("div", { class: "card-body" }, el("div", { class: "table-wrap" }, el("table", { class: "table table-dense" }, [thead, tbody])))
    ]));
  }

  // ---- 시점별 총비용 비교 (누적이자+중도상환수수료) --------------------
  var PAYOFF_N_PRESETS = [1, 3, 6, 9, 12, 18, 24, 36];

  function renderPayoffCompare() {
    var host = document.getElementById("loan-payoff-compare");
    host.innerHTML = "";

    var header = el("div", { class: "card-header" }, [
      el("span", { class: "card-title" }, "시점별 총비용 비교 (누적이자+중도상환수수료)"),
      collapseToggle(payoffCompareCollapsed, function () { payoffCompareCollapsed = !payoffCompareCollapsed; render(); })
    ]);

    if (payoffCompareCollapsed) {
      var hint = compareIds.length
        ? "접힘 · [펼치기]로 시점별 총비용 비교를 확인하세요(" + compareIds.length + "개 선택됨)."
        : "접힘 · 케이스 목록에서 비교 체크박스를 선택하면 펼쳐집니다(최대 3개, 대출 비교 섹션과 동일 선택).";
      host.appendChild(el("div", { class: "card" }, [header, el("div", { class: "card-body" }, el("p", { class: "muted" }, hint))]));
      return;
    }

    if (!compareIds.length) {
      host.appendChild(el("div", { class: "card" }, [header,
        el("div", { class: "card-body" }, el("p", { class: "muted" }, "케이스 목록에서 비교 체크박스를 선택하세요(최대 3개, 대출 비교 섹션과 동일 선택)."))]));
      return;
    }

    var presetSeg = el("div", { class: "seg-group" }, PAYOFF_N_PRESETS.map(function (n) {
      return el("button", {
        type: "button",
        class: "btn btn-sm seg-btn" + (payoffN === n ? " is-active" : ""),
        onClick: function () { payoffN = n; render(); }
      }, n + "개월");
    }));
    // onChange(blur/엔터, onInput 아님): render()가 이 입력창 자체를 재생성하므로, 매 키 입력마다
    // 재렌더하면 포커스가 끊겨 두 자리 이상 입력이 불가능해짐(1글자 후 포커스 소실).
    var customInput = el("input", {
      type: "number", min: "1", step: "1", value: payoffN, style: { width: "5em" },
      onChange: function () { var v = parseInt(customInput.value, 10); if (v > 0) { payoffN = v; render(); } }
    });
    var controls = el("div", { class: "field-row" }, [presetSeg, el("label", null, "직접입력(개월):"), customInput]);

    var cases = compareIds.map(findCase).filter(Boolean);
    var computed = cases.map(function (c) {
      var calc = computeForCase(c);
      var cost = JF.loan.cumulativeCostAt(calc.result.rows, payoffN);
      return { loanCase: c, summary: calc.result.summary, cost: cost };
    });
    var minTotal = computed.reduce(function (m, c) { return Math.min(m, c.cost.total); }, Infinity);

    var thead = el("thead", null, el("tr", null, [
      el("th", null, "케이스"),
      el("th", { class: "num" }, "월원리금"),
      el("th", { class: "num" }, "누적이자(" + payoffN + "개월)"),
      el("th", { class: "num" }, "중도상환수수료(" + payoffN + "회차)"),
      el("th", { class: "num" }, "합계")
    ]));
    var tbody = el("tbody", null, computed.map(function (c) {
      var isBest = c.cost.total === minTotal;
      return el("tr", { class: isBest ? "loan-payoff-best-row" : null }, [
        el("td", null, c.loanCase.name || "(이름없음)"),
        el("td", { class: "num" }, won(c.summary.firstMonthlyPayment)),
        el("td", { class: "num" }, won(c.cost.cumulativeInterest)),
        el("td", { class: "num" }, won(c.cost.prepayFee)),
        el("td", { class: "num" + (isBest ? " loan-payoff-best-cell" : "") }, won(c.cost.total))
      ]);
    }));

    host.appendChild(el("div", { class: "card" }, [
      header,
      el("div", { class: "card-body stack" }, [controls, el("div", { class: "table-wrap" }, el("table", { class: "table table-dense" }, [thead, tbody]))])
    ]));
  }

  function render() { renderCases(); renderCalc(); renderCompare(); renderPayoffCompare(); }

  function boot() {
    JF.ui.renderNav("loan.html");
    state = JF.store.load();
    render();
    // 최종금리가 이번 로드에서 오거나 바뀌면 연동 케이스를 재계산·재렌더(render는 매번 순수 재계산이라 저비용).
    if (JF.ui && typeof JF.ui.onFinalRate === "function") {
      JF.ui.onFinalRate(function () { render(); });
    }
    if (JF.syncUI) JF.syncUI.bind({ get: function () { return state; }, set: function (s) { state = s; }, render: render });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();
