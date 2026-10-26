// app-cards.js — 컴포넌트 4: 신용카드 혜택 관리 (AC-4.x)
// 카드별 단(段) 블록 + 템플릿 CRUD + PDF→템플릿 가이드/프롬프트 + 7번째 카드 안내.
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var state;
  var editingId = null; // 편집 중인 카드 id (null=없음, ""=신규)
  var editingAcctId = null; // 편집 중인 계좌 id (null=없음, ""=신규)
  var tab = "카드";      // 카드 | 계좌

  function uid() { return "card-" + Math.random().toString(36).slice(2, 8); }
  function acctUid() { return "acct-" + Math.random().toString(36).slice(2, 8); }
  function acctName(id) {
    var a = (state.bankAccounts || []).filter(function (x) { return x.id === id; })[0];
    return a ? a.name : null;
  }
  function save() { JF.store.save(state); render(); }
  function won(n) { return JF.format.formatWon(n) + "원"; }
  function windowLabel(card) {
    var s = card.billingWindow && card.billingWindow.start;
    if (!s || s === 1) return "매월 1일 ~ 말일 (달력월)";
    var end = s - 1;
    return "매월 " + s + "일 ~ 다음달 " + end + "일";
  }

  // ---- 7번째 카드 배너 (AC-4.3) --------------------------------------
  function renderBanner() {
    var host = document.getElementById("cards-banner");
    host.innerHTML = "";
    if ((state.cards || []).length < 7) {
      host.appendChild(el("div", { class: "jf-banner jf-banner-warn", style: { position: "static" } },
        "안내: 요구사항 상 카드는 7개이나 현재 " + (state.cards || []).length + "개만 등록되어 있습니다. 7번째 카드는 상품안내 PDF를 참고해 아래 [+ 카드 추가]로 직접 등록하세요(임의 생성하지 않음)."));
    }
  }

  function renderToolbar() {
    var host = document.getElementById("cards-toolbar");
    host.innerHTML = "";
    host.appendChild(el("div", { class: "card" },
      el("div", { class: "card-header" }, [
        el("span", { class: "muted" }, "총 " + (state.cards || []).length + "개 카드"),
        el("button", { class: "btn btn-primary", onClick: function () { editingId = ""; render(); } }, "+ 카드 추가")
      ])
    ));
  }

  // ---- 카드 단(段) 블록 — 표(table) 형태로 정렬 (#3) ------------------
  function kvRow(k, v) { return el("tr", null, [el("th", null, k), el("td", null, v)]); }

  function cardBlock(card) {
    // 기본 정보 (항목 | 내용)
    var infoRows = [
      kvRow("산정기간", windowLabel(card)),
      kvRow("결제일", card.paymentDay ? card.paymentDay + "일" : "-"),
      kvRow("결제 계좌", card.paymentAccountId
        ? (acctName(card.paymentAccountId) || el("span", { class: "badge badge-muted" }, "삭제된 계좌"))
        : el("span", { class: "badge badge-muted" }, "미연동")),
      kvRow("한도", card.limit != null ? won(card.limit) : el("span", { class: "badge badge-muted" }, "발급 전")),
      kvRow("연회비", won(card.annualFee || 0))
    ];
    if (card.mainMerchants && card.mainMerchants.length) {
      infoRows.push(kvRow("주요사용처", card.mainMerchants.map(function (m) { return el("span", { class: "badge badge-muted" }, m); })));
    }
    var infoTable = el("table", { class: "kv-table" }, [
      el("caption", null, "기본 정보"),
      el("tbody", null, infoRows)
    ]);

    // 실적조건 (전월실적 | 조건)
    var condRows = (card.performanceConditions || []).map(function (c) {
      var cond = [c.label || "-"];
      if (c.primary) cond.unshift(el("span", { class: "badge" }, "주"), " ");
      if (c.exclusions && c.exclusions.length) cond.push(" ", el("span", { class: "badge badge-muted" }, "제외: " + c.exclusions.join(",")));
      return el("tr", null, [
        el("td", { class: "kv-amt" }, JF.format.formatMan(c.threshold)),
        el("td", null, cond)
      ]);
    });
    var condTable = el("table", { class: "kv-table" }, [
      el("caption", null, "실적조건 (전월실적 기준)"),
      el("thead", null, el("tr", null, [el("th", { class: "kv-amt" }, "전월실적"), el("th", null, "조건")])),
      el("tbody", null, condRows.length ? condRows : [el("tr", null, el("td", { colspan: "2", class: "muted" }, "실적조건 없음"))])
    ]);

    // 혜택 (혜택내용 | 한도)
    var benRows = (card.benefits || []).map(function (b) {
      return el("tr", null, [el("td", null, b.desc || "-"), el("td", { class: "kv-amt" }, b.cap || "-")]);
    });
    var benTable = el("table", { class: "kv-table" }, [
      el("caption", null, "혜택"),
      el("thead", null, el("tr", null, [el("th", null, "혜택내용"), el("th", { class: "kv-amt" }, "한도")])),
      el("tbody", null, benRows.length ? benRows : [el("tr", null, el("td", { colspan: "2", class: "muted" }, "혜택 없음"))])
    ]);

    var body = [infoTable, condTable, benTable];
    if (card.guide) {
      body.push(el("div", { class: "muted", style: { fontStyle: "italic" } }, "메모: " + card.guide));
    }

    return el("div", { class: "card" }, [
      el("div", { class: "card-header" }, [
        el("span", { class: "card-title" }, card.name),
        el("span", { class: "badge badge-muted" }, card.issuer || "")
      ]),
      el("div", { class: "card-body stack" }, body),
      el("div", { class: "card-footer" }, [
        el("button", { class: "btn btn-sm btn-secondary", onClick: function () { editingId = card.id; render(); } }, "편집"),
        el("button", { class: "btn btn-sm btn-danger", onClick: function () {
          if (window.confirm("이 카드를 삭제할까요? (" + card.name + ")")) {
            state.cards = state.cards.filter(function (c) { return c.id !== card.id; }); save();
          }
        } }, "삭제")
      ])
    ]);
  }

  // ---- 카드 편집 폼 (템플릿 CRUD, AC-4.2) ----------------------------
  function editForm(card) {
    var isNew = !card;
    var c = card ? JSON.parse(JSON.stringify(card)) : JF.schema.emptyCard();
    if (isNew) c.id = uid();

    function textField(label, val, oninput) {
      var i = el("input", { type: "text", value: val || "", onInput: function () { oninput(i.value); } });
      return el("div", { class: "field-row" }, [el("label", null, label), i]);
    }
    function numField(label, val, oninput) {
      var i = el("input", { type: "number", value: (val != null ? val : ""), onInput: function () { oninput(i.value === "" ? null : Number(i.value)); } });
      return el("div", { class: "field-row" }, [el("label", null, label), i]);
    }

    var body = el("div", { class: "card-body stack" }, []);
    body.appendChild(textField("카드명", c.name, function (v) { c.name = v; }));
    body.appendChild(textField("발급사", c.issuer, function (v) { c.issuer = v; }));
    body.appendChild(numField("산정기간 개시일(1~31, 1=달력월)", c.billingWindow.start, function (v) { c.billingWindow.start = v || 1; }));
    body.appendChild(numField("결제일", c.paymentDay, function (v) { c.paymentDay = v; }));
    var acctSel = el("select", { onChange: function () { c.paymentAccountId = acctSel.value || null; } },
      [el("option", { value: "" }, "(미연동)")].concat((state.bankAccounts || []).map(function (a) {
        return el("option", { value: a.id, selected: c.paymentAccountId === a.id }, a.name || a.id);
      })));
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "결제 계좌"), acctSel,
      (state.bankAccounts || []).length ? null : el("span", { class: "muted" }, "'계좌' 탭에서 먼저 계좌를 등록하세요.")]));
    body.appendChild(numField("한도(원, 발급전은 비움)", c.limit, function (v) { c.limit = v; }));
    body.appendChild(numField("연회비(원)", c.annualFee, function (v) { c.annualFee = v || 0; }));

    // 실적조건 편집
    body.appendChild(el("div", { class: "muted" }, "실적조건(주 조건 1개 선택):"));
    var condHost = el("div", { class: "stack" }, []);
    function drawConds() {
      condHost.innerHTML = "";
      c.performanceConditions.forEach(function (cond, idx) {
        var lab = el("input", { type: "text", value: cond.label, placeholder: "설명", onInput: function () { cond.label = lab.value; } });
        var thr = el("input", { type: "number", value: cond.threshold, placeholder: "원", onInput: function () { cond.threshold = Number(thr.value) || 0; } });
        var prim = el("input", { type: "radio", name: "primcond", checked: !!cond.primary, onChange: function () {
          c.performanceConditions.forEach(function (x, i) { x.primary = (i === idx); });
        } });
        condHost.appendChild(el("div", { class: "field-row" }, [prim, el("span", { class: "muted" }, "주"), lab, thr,
          el("button", { class: "btn btn-sm btn-danger", onClick: function () { c.performanceConditions.splice(idx, 1); drawConds(); } }, "×")]));
      });
      condHost.appendChild(el("button", { class: "btn btn-sm btn-ghost", onClick: function () {
        c.performanceConditions.push({ label: "", threshold: 0, primary: c.performanceConditions.length === 0, exclusions: [] }); drawConds();
      } }, "+ 실적조건"));
    }
    drawConds();
    body.appendChild(condHost);

    // 혜택 편집
    body.appendChild(el("div", { class: "muted" }, "혜택:"));
    var benHost = el("div", { class: "stack" }, []);
    function drawBens() {
      benHost.innerHTML = "";
      c.benefits.forEach(function (b, idx) {
        var d = el("input", { type: "text", value: b.desc, placeholder: "혜택", onInput: function () { b.desc = d.value; } });
        var cap = el("input", { type: "text", value: b.cap || "", placeholder: "한도(선택)", onInput: function () { b.cap = cap.value || null; } });
        benHost.appendChild(el("div", { class: "field-row" }, [d, cap,
          el("button", { class: "btn btn-sm btn-danger", onClick: function () { c.benefits.splice(idx, 1); drawBens(); } }, "×")]));
      });
      benHost.appendChild(el("button", { class: "btn btn-sm btn-ghost", onClick: function () { c.benefits.push({ desc: "", cap: null }); drawBens(); } }, "+ 혜택"));
    }
    drawBens();
    body.appendChild(benHost);

    var merchants = el("input", { type: "text", value: (c.mainMerchants || []).join(", "), placeholder: "쉼표로 구분" });
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "주요사용처:"), merchants]));
    var guide = el("textarea", { rows: "2" }, c.guide || "");
    body.appendChild(el("div", null, [el("label", null, "메모/가이드:"), guide]));

    body.appendChild(el("div", { class: "field-row" }, [
      el("button", { class: "btn btn-primary", onClick: function () {
        c.mainMerchants = merchants.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        c.guide = guide.value || null;
        if (isNew) { state.cards.push(c); } else {
          var i = state.cards.findIndex(function (x) { return x.id === c.id; });
          if (i >= 0) state.cards[i] = c;
        }
        editingId = null; save();
      } }, "저장"),
      el("button", { class: "btn btn-ghost", onClick: function () { editingId = null; render(); } }, "취소")
    ]));

    return el("div", { class: "card", style: { borderColor: "var(--jf-primary)" } }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, isNew ? "새 카드 추가" : "카드 편집")),
      body
    ]);
  }

  // ---- PDF→템플릿 가이드 (AC-4.4) ------------------------------------
  var PROMPT_TEXT =
    "다음 신용카드 상품안내 PDF의 내용을 아래 고정 템플릿(JSON)으로 정리해줘. " +
    "추측하지 말고 PDF에 있는 값만 채우고, 없으면 null로 둬.\n\n" +
    "{\n" +
    '  "name": "카드명",\n' +
    '  "issuer": "발급사",\n' +
    '  "billingWindow": { "start": 8 },   // 이용금액 산정기간 개시일(1~31). "매월 8일~다음달 7일"이면 8. 달력월이면 1\n' +
    '  "paymentDay": 21,                    // 결제일\n' +
    '  "limit": 10000000,                   // 한도(원), 발급전이면 null\n' +
    '  "annualFee": 10000,                  // 연회비(원)\n' +
    '  "performanceConditions": [           // 전월실적 조건들. 게이지에 쓸 주 조건 1개에 primary:true\n' +
    '    { "label": "전월 30만원 이상", "threshold": 300000, "primary": true, "exclusions": [] }\n' +
    "  ],\n" +
    '  "benefits": [ { "desc": "혜택 설명", "cap": "한도(있으면)" } ],\n' +
    '  "mainMerchants": ["주요 사용처"],\n' +
    '  "guide": "특이사항 메모(실적 제외 항목 등)"\n' +
    "}\n\n" +
    "threshold/limit/annualFee는 원 단위 정수로. 실적에서 제외되는 항목(예: 주유)이 있으면 exclusions와 guide에 명시해줘.";

  function renderGuide() {
    var host = document.getElementById("cards-guide");
    host.innerHTML = "";
    var ta = el("textarea", { rows: "12", readonly: true, style: { fontFamily: "monospace" } }, PROMPT_TEXT);
    host.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, "가이드: 카드 PDF → 고정 템플릿 변환")),
      el("div", { class: "card-body stack" }, [
        el("ol", { class: "stack" }, [
          el("li", null, "카드사 홈페이지/앱에서 해당 카드의 상품안내 PDF를 받는다."),
          el("li", null, "아래 프롬프트와 PDF를 LLM에 함께 넣어 고정 템플릿(JSON)으로 변환한다."),
          el("li", null, "결과 JSON을 이 페이지의 [+ 카드 추가] 폼에 옮겨 입력한다(또는 내보낸 jinfinance.json의 cards 배열에 직접 추가)."),
          el("li", null, "산정기간 개시일(billingWindow.start)과 결제일, 주 실적조건(primary)을 반드시 확인한다 — 카드도우미의 실적 게이지가 이 값으로 계산된다.")
        ]),
        el("div", { class: "muted" }, "변환 프롬프트 (복사해서 사용):"),
        ta,
        el("button", { class: "btn btn-sm btn-secondary", onClick: function () {
          ta.removeAttribute("readonly"); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.setAttribute("readonly", "");
          JF.ui.showBanner("변환 프롬프트를 클립보드에 복사했습니다.", "info");
        } }, "프롬프트 복사")
      ])
    ]));
  }

  // ---- 계좌 탭 ---------------------------------------------------------
  function wonOrDash(n) { return n != null ? won(n) : "-"; }

  function acctBlock(a) {
    var usedByCards = (state.cards || []).filter(function (c) { return c.paymentAccountId === a.id; });
    var info = el("table", { class: "kv-table" }, [
      el("caption", null, "기본 정보"),
      el("tbody", null, [
        kvRow("1일 이체한도", wonOrDash(a.dailyLimit)),
        kvRow("1회 이체한도", wonOrDash(a.perTxLimit)),
        kvRow("혜택내용", a.benefits ? el("span", { style: { whiteSpace: "pre-wrap" } }, a.benefits) : "-"),
        kvRow("연동 카드", usedByCards.length
          ? usedByCards.map(function (c) { return el("span", { class: "badge badge-muted" }, c.name); })
          : "-")
      ])
    ]);
    return el("div", { class: "card" }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, a.name || "(이름 없음)")),
      el("div", { class: "card-body stack" }, info),
      el("div", { class: "card-footer" }, [
        el("button", { class: "btn btn-sm btn-secondary", onClick: function () { editingAcctId = a.id; render(); } }, "편집"),
        el("button", { class: "btn btn-sm btn-danger", onClick: function () {
          if (!window.confirm("이 계좌를 삭제할까요? (" + a.name + ")\n연동된 카드/지출 항목의 계좌 연결은 해제됩니다.")) return;
          state.bankAccounts = state.bankAccounts.filter(function (x) { return x.id !== a.id; });
          (state.cards || []).forEach(function (c) { if (c.paymentAccountId === a.id) c.paymentAccountId = null; });
          (state.expenses || []).concat(state.specials || [], state.loanExpenses || []).forEach(function (it) {
            if (it.assignedAccountId === a.id) it.assignedAccountId = null;
          });
          save();
        } }, "삭제")
      ])
    ]);
  }

  function acctEditForm(acct) {
    var isNew = !acct;
    var a = acct ? JSON.parse(JSON.stringify(acct)) : JF.schema.emptyBankAccount();
    if (isNew) a.id = acctUid();
    var name = el("input", { type: "text", value: a.name || "", onInput: function () { a.name = name.value; } });
    var daily = el("input", { type: "number", min: "0", step: "10000", value: a.dailyLimit != null ? a.dailyLimit : "",
      onInput: function () { a.dailyLimit = daily.value === "" ? null : Number(daily.value); } });
    var per = el("input", { type: "number", min: "0", step: "10000", value: a.perTxLimit != null ? a.perTxLimit : "",
      onInput: function () { a.perTxLimit = per.value === "" ? null : Number(per.value); } });
    var ben = el("textarea", { rows: "3", onInput: function () { a.benefits = ben.value; } }, a.benefits || "");
    var body = el("div", { class: "card-body stack" }, [
      el("div", { class: "field-row" }, [el("label", null, "계좌명"), name]),
      el("div", { class: "field-row" }, [el("label", null, "1일 이체한도(원)"), daily]),
      el("div", { class: "field-row" }, [el("label", null, "1회 이체한도(원)"), per]),
      el("div", null, [el("label", null, "혜택내용"), ben]),
      el("div", { class: "field-row" }, [
        el("button", { class: "btn btn-primary", onClick: function () {
          if (!(a.name || "").trim()) { JF.ui.showBanner("계좌명을 입력하세요.", "warn"); return; }
          a.name = a.name.trim();
          if (isNew) { state.bankAccounts.push(a); } else {
            var i = state.bankAccounts.findIndex(function (x) { return x.id === a.id; });
            if (i >= 0) state.bankAccounts[i] = a;
          }
          editingAcctId = null; save();
        } }, "저장"),
        el("button", { class: "btn btn-ghost", onClick: function () { editingAcctId = null; render(); } }, "취소")
      ])
    ]);
    return el("div", { class: "card", style: { borderColor: "var(--jf-primary)" } }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, isNew ? "새 계좌 추가" : "계좌 편집")),
      body
    ]);
  }

  function renderTabs() {
    var host = document.getElementById("cards-tabs");
    host.innerHTML = "";
    host.appendChild(el("div", { class: "card" }, el("div", { class: "card-body" },
      el("div", { class: "field-row" }, ["카드", "계좌"].map(function (t) {
        return el("button", { class: "btn btn-sm " + (tab === t ? "btn-primary" : "btn-secondary"),
          onClick: function () { tab = t; editingId = null; editingAcctId = null; render(); } }, t);
      })))));
  }

  function render() {
    renderTabs();
    var banner = document.getElementById("cards-banner");
    var toolbar = document.getElementById("cards-toolbar");
    var grid = document.getElementById("cards-grid");
    var guide = document.getElementById("cards-guide");
    grid.innerHTML = "";
    if (tab === "계좌") {
      banner.innerHTML = ""; guide.innerHTML = "";
      toolbar.innerHTML = "";
      var accts = state.bankAccounts || [];
      toolbar.appendChild(el("div", { class: "card" },
        el("div", { class: "card-header" }, [
          el("span", { class: "muted" }, "총 " + accts.length + "개 계좌"),
          el("button", { class: "btn btn-primary", onClick: function () { editingAcctId = ""; render(); } }, "+ 계좌 추가")
        ])));
      if (editingAcctId === "") grid.appendChild(acctEditForm(null));
      accts.forEach(function (a) {
        grid.appendChild(editingAcctId === a.id ? acctEditForm(a) : acctBlock(a));
      });
      return;
    }
    renderBanner();
    renderToolbar();
    if (editingId === "") { grid.appendChild(editForm(null)); }
    (state.cards || []).forEach(function (card) {
      if (editingId === card.id) { grid.appendChild(editForm(card)); }
      else { grid.appendChild(cardBlock(card)); }
    });
    renderGuide();
  }

  function boot() {
    JF.ui.renderNav("cards.html");
    state = JF.store.load();
    state.bankAccounts = state.bankAccounts || [];
    render();
    if (JF.syncUI) JF.syncUI.bind({ get: function () { return state; }, set: function (s) { state = s; }, render: render });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();
