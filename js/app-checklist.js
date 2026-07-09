// app-checklist.js — 컴포넌트 6: D-Day 체크리스트
// 다중 체크리스트 · D-Day 그룹(자동배정+파스텔+필터) · 항목 테이블(소항목 CRUD·상태 파생·태그 자동완성) · 캘린더.
// 계산은 JF.checklist(순수) 소비만. 상태는 state.checklists / state.meta.activeChecklistId.
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var CK = JF.checklist;
  var state;
  var activeGroupId = null;   // 항목 테이블 필터(null=전체)
  var openItemId = null;      // 인라인 편집 열린 항목

  function uid(p) { return p + "-" + Math.random().toString(36).slice(2, 8); }
  function save() { JF.store.save(state); }
  function saveRender() { JF.store.save(state); render(); }

  var DEFAULT_GROUPS = [
    { label: "D-14", offsetDays: -14, color: "#D6EAF8" },
    { label: "D-7", offsetDays: -7, color: "#FCF3CF" },
    { label: "D-Day", offsetDays: 0, color: "#FADBD8" },
    { label: "D+7", offsetDays: 7, color: "#D5F5E3" }
  ];
  function makeDefaultGroups() {
    return DEFAULT_GROUPS.map(function (g) {
      var grp = JF.schema.emptyDdayGroup();
      grp.id = uid("g"); grp.label = g.label; grp.offsetDays = g.offsetDays; grp.color = g.color;
      return grp;
    });
  }
  function makeChecklist(title, start, dday) {
    var c = JF.schema.emptyChecklist();
    c.id = uid("cl"); c.title = title; c.startDate = start; c.dDay = dday;
    c.groups = makeDefaultGroups(); c.items = [];
    return c;
  }

  function current() {
    var id = state.meta.activeChecklistId;
    var found = (state.checklists || []).filter(function (c) { return c.id === id; })[0];
    return found || state.checklists[0];
  }

  // ---- 모바일 HTML 내보내기(자기완결형 스냅샷; 체크만 저장) ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function buildMobileHtml(cl) {
    // 그룹 오름차순(이른 마일스톤 먼저) + 미분류 버킷. 각 그룹 내 타겟날짜 오름차순.
    var groups = (cl.groups || []).slice().sort(function (a, b) { return a.offsetDays - b.offsetDays; });
    var byTarget = function (a, b) {
      var ad = a.targetDate || "", bd = b.targetDate || "";
      if (!ad && !bd) return 0; if (!ad) return 1; if (!bd) return -1;
      return ad < bd ? -1 : (ad > bd ? 1 : 0);
    };
    var buckets = groups.map(function (g) {
      return { g: g, items: (cl.items || []).filter(function (it) {
        var ag = CK.assignGroup(it, cl); return ag && ag.id === g.id;
      }).sort(byTarget) };
    });
    var unassigned = (cl.items || []).filter(function (it) { return !CK.assignGroup(it, cl); }).sort(byTarget);
    if (unassigned.length) buckets.push({ g: { label: "미분류", color: "#E5E7EB", offsetDays: null }, items: unassigned });

    function itemHtml(it) {
      var parts = [];
      parts.push('<article class="item" data-item="' + esc(it.id) + '">');
      parts.push('<div class="ihead">');
      if (it.tag) parts.push('<span class="tag">' + esc(it.tag) + '</span>');
      parts.push('<span class="iname">' + esc(it.name || "(무제목)") + '</span>');
      parts.push('<span class="status s-pend" data-status>예정</span>');
      parts.push('</div>');
      var meta = [];
      if (it.targetDate) meta.push("🎯 " + esc(it.targetDate));
      if (it.assignee) meta.push("👤 " + esc(it.assignee));
      if (meta.length) parts.push('<div class="meta">' + meta.join(" · ") + '</div>');
      if ((it.details || []).length) {
        parts.push('<ul class="details">');
        it.details.forEach(function (d) {
          var k = it.id + "::" + d.id;
          parts.push('<li><label><input type="checkbox" data-item="' + esc(it.id) + '" data-k="' + esc(k) + '"> <span>' + esc(d.text) + '</span></label></li>');
        });
        parts.push('</ul>');
      }
      if ((it.memos || []).length) {
        parts.push('<ul class="memos">');
        it.memos.forEach(function (m) { if ((m.text || "").trim()) parts.push('<li>' + esc(m.text) + '</li>'); });
        parts.push('</ul>');
      }
      parts.push('</article>');
      return parts.join("");
    }

    var sections = buckets.filter(function (b) { return b.items.length; }).map(function (b) {
      var head = '<h2 class="grp-h" style="background:' + esc(b.g.color) + '">' + esc(b.g.label) + '</h2>';
      return '<section class="grp" style="border-color:' + esc(b.g.color) + '">' + head + b.items.map(itemHtml).join("") + '</section>';
    }).join("");
    if (!sections) sections = '<p class="empty">항목이 없습니다.</p>';

    var storeKey = "jinfinance:mobile-checklist:" + cl.id;
    var css = [
      "*{box-sizing:border-box}",
      "body{margin:0;padding:16px 12px 48px;font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans KR',sans-serif;background:#f4f5f7;color:#1f2430;line-height:1.5}",
      ".wrap{max-width:640px;margin:0 auto}",
      "header.top h1{font-size:1.3rem;margin:0 0 4px}",
      "header.top .sub{color:#6b7280;font-size:.85rem;margin:0 0 16px}",
      ".grp{background:#fff;border:1px solid #e5e7eb;border-left:6px solid #ccc;border-radius:10px;margin:0 0 16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}",
      ".grp-h{margin:0;padding:8px 12px;font-size:.95rem;color:#242424}",
      ".item{padding:12px;border-top:1px solid #f0f1f3}",
      ".item:first-of-type{border-top:none}",
      ".ihead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".tag{background:#eef1f5;color:#374151;border-radius:999px;padding:1px 8px;font-size:.72rem;font-weight:600}",
      ".iname{font-weight:600;flex:1 1 auto}",
      ".status{border-radius:999px;padding:2px 9px;font-size:.72rem;font-weight:700;white-space:nowrap}",
      ".s-pend{background:#eceff3;color:#6b7280}.s-prog{background:#FCF3CF;color:#7d6608}.s-done{background:#D5F5E3;color:#1e6b3a}",
      ".meta{color:#6b7280;font-size:.8rem;margin:6px 0 0}",
      "ul.details{list-style:none;margin:8px 0 0;padding:0}",
      "ul.details li{margin:0}",
      "ul.details label{display:flex;align-items:flex-start;gap:10px;padding:7px 4px;cursor:pointer}",
      "ul.details input{width:22px;height:22px;margin:0;flex:0 0 auto}",
      "ul.details label span{padding-top:1px}",
      "li.done span{text-decoration:line-through;color:#9ca3af}",
      "ul.memos{list-style:disc;margin:8px 0 0;padding-left:22px;color:#4b5563;font-size:.85rem}",
      ".empty{color:#6b7280}",
      "footer.note{color:#9ca3af;font-size:.75rem;margin-top:24px;text-align:center}"
    ].join("");

    var js = [
      "(function(){",
      "  var KEY=" + JSON.stringify(storeKey) + ";",
      "  function read(){try{return JSON.parse(localStorage.getItem(KEY))||{};}catch(e){return{};}}",
      "  function write(m){try{localStorage.setItem(KEY,JSON.stringify(m));}catch(e){}}",
      "  var m=read();",
      "  function recompute(art){",
      "    var b=art.querySelectorAll('input[type=checkbox]');var t=b.length,c=0;",
      "    for(var i=0;i<b.length;i++){var li=b[i].closest('li');if(b[i].checked){c++;if(li)li.classList.add('done');}else if(li)li.classList.remove('done');}",
      "    var s=(t===0||c===0)?'예정':(c===t?'완료':'진행중');",
      "    var badge=art.querySelector('[data-status]');badge.textContent=s;",
      "    badge.className='status '+(s==='완료'?'s-done':(s==='진행중'?'s-prog':'s-pend'));",
      "  }",
      "  var boxes=document.querySelectorAll('input[type=checkbox]');",
      "  for(var i=0;i<boxes.length;i++){var k=boxes[i].getAttribute('data-k');if(m[k])boxes[i].checked=true;",
      "    boxes[i].addEventListener('change',function(e){var kk=e.target.getAttribute('data-k');if(e.target.checked)m[kk]=1;else delete m[kk];write(m);recompute(e.target.closest('article.item'));});}",
      "  var arts=document.querySelectorAll('article.item');for(var j=0;j<arts.length;j++)recompute(arts[j]);",
      "})();"
    ].join("\n");

    var dstr = (cl.dDay || "");
    return [
      "<!DOCTYPE html>",
      '<html lang="ko"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>" + esc(cl.title || "체크리스트") + "</title>",
      "<style>" + css + "</style>",
      "</head><body><div class=\"wrap\">",
      '<header class="top"><h1>' + esc(cl.title || "체크리스트") + "</h1>",
      '<p class="sub">D-Day ' + esc(dstr) + (cl.startDate ? " · 시작 " + esc(cl.startDate) : "") + "</p></header>",
      sections,
      '<footer class="note">JinFinance 모바일 스냅샷 · 체크 상태는 이 기기에 저장됩니다</footer>',
      "</div><script>" + js + "<\/script>",
      "</body></html>"
    ].join("\n");
  }

  function exportMobileHtml(cl) {
    var html = buildMobileHtml(cl);
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var safe = (cl.title || "checklist").replace(/[\\/:*?"<>|]/g, "_");
    var a = document.createElement("a");
    a.href = url; a.download = "checklist-" + safe + ".html";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    JF.ui.showBanner("모바일 HTML을 내보냈습니다. 안드로이드로 파일을 옮겨 Chrome으로 열면 됩니다(체크만 저장).", "info");
  }
  function groupLabel(cl, id) {
    var g = (cl.groups || []).filter(function (x) { return x.id === id; })[0];
    return g ? g.label : "";
  }

  // ---- 헤더: 선택/생성/삭제 + 주제/시작일/D-Day -----------------------
  function renderHeader() {
    var host = document.getElementById("cl-header");
    host.innerHTML = "";
    var cl = current();

    var sel = el("select", { onChange: function () {
      state.meta.activeChecklistId = sel.value; activeGroupId = null; openItemId = null; saveRender();
    } }, (state.checklists || []).map(function (c) {
      return el("option", { value: c.id, selected: c.id === cl.id }, c.title || "(무제목)");
    }));
    var addBtn = el("button", { class: "btn btn-sm btn-secondary", onClick: function () {
      var c = makeChecklist("새 체크리스트", "2026-07-05", "2026-09-28");
      state.checklists.push(c); state.meta.activeChecklistId = c.id;
      activeGroupId = null; openItemId = null; saveRender();
    } }, "새 체크리스트");
    var delBtn = el("button", { class: "btn btn-sm btn-danger", onClick: function () {
      if (!window.confirm("이 체크리스트를 삭제할까요? (" + (cl.title || "") + ")")) return;
      state.checklists = state.checklists.filter(function (c) { return c.id !== cl.id; });
      if (!state.checklists.length) state.checklists.push(makeChecklist("이사 체크리스트", "2026-07-05", "2026-09-28"));
      state.meta.activeChecklistId = state.checklists[0].id;
      activeGroupId = null; openItemId = null; saveRender();
    } }, "삭제");
    var mobileBtn = el("button", { class: "btn btn-sm btn-secondary", onClick: function () { exportMobileHtml(current()); } }, "📱 모바일 HTML");

    var titleInput = el("input", { type: "text", value: cl.title || "", onInput: function () { cl.title = titleInput.value; save(); } });
    var startInput = el("input", { type: "date", value: cl.startDate || "", onChange: function () { cl.startDate = startInput.value; saveRender(); } });
    var ddayInput = el("input", { type: "date", value: cl.dDay || "", onChange: function () { cl.dDay = ddayInput.value; saveRender(); } });

    host.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-header" }, [
        el("span", { class: "card-title" }, "체크리스트"),
        el("div", { class: "field-row push-right" }, [sel, addBtn, mobileBtn, delBtn])
      ]),
      el("div", { class: "card-body stack" }, [
        el("div", { class: "field-row" }, [el("label", null, "주제:"), titleInput]),
        el("div", { class: "field-row" }, [el("label", null, "시작일:"), startInput, el("label", null, "D-Day:"), ddayInput])
      ])
    ]));
  }

  // ---- D-Day 그룹 테이블 ---------------------------------------------
  function renderGroups() {
    var host = document.getElementById("cl-groups");
    host.innerHTML = "";
    var cl = current();

    var allChip = el("button", { class: "dday-chip" + (activeGroupId === null ? " is-active" : ""), onClick: function () {
      activeGroupId = null; render();
    } }, "전체");
    var addBtn = el("button", { class: "btn btn-sm btn-secondary", onClick: function () {
      var g = JF.schema.emptyDdayGroup(); g.id = uid("g"); g.label = "새 그룹"; g.offsetDays = 0;
      cl.groups.push(g); saveRender();
    } }, "+ 그룹 추가");

    var thead = el("thead", null, el("tr", null, ["라벨", "오프셋(일)", "색", "필터", "삭제"].map(function (h) { return el("th", null, h); })));
    var tbody = el("tbody", null, (cl.groups || []).map(function (g) {
      var labelIn = el("input", { type: "text", value: g.label || "", onInput: function () { g.label = labelIn.value; save(); } });
      var offIn = el("input", { type: "number", value: g.offsetDays, onChange: function () { g.offsetDays = Number(offIn.value) || 0; saveRender(); } });
      var colorIn = el("input", { type: "color", class: "cat-color", value: g.color || "#E5E7EB", onChange: function () { g.color = colorIn.value; saveRender(); } });
      var filterChip = el("button", { class: "dday-chip cell-colored" + (activeGroupId === g.id ? " is-active" : ""), style: { background: g.color }, onClick: function () {
        activeGroupId = (activeGroupId === g.id ? null : g.id); render();
      } }, g.label || "(그룹)");
      var delBtn = el("button", { class: "btn btn-sm btn-danger", onClick: function () {
        cl.groups = cl.groups.filter(function (x) { return x.id !== g.id; });
        if (activeGroupId === g.id) activeGroupId = null;
        saveRender();
      } }, "삭제");
      return el("tr", null, [el("td", null, labelIn), el("td", null, offIn), el("td", null, colorIn), el("td", null, filterChip), el("td", null, delBtn)]);
    }));

    host.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-header" }, [
        el("span", { class: "card-title" }, "D-Day 그룹"),
        el("div", { class: "field-row push-right" }, [allChip, addBtn])
      ]),
      el("div", { class: "card-body stack" }, [
        el("div", { class: "muted" }, "D-Day 이전은 음수(예 D-7 → -7), 이후는 양수(D+7 → 7). 항목은 타겟날짜로 자동 배정됩니다."),
        el("div", { class: "table-wrap" }, el("table", { class: "table table-dense" }, [thead, tbody]))
      ])
    ]));
  }

  // ---- 항목 테이블 --------------------------------------------------
  function distinctTags(cl) {
    var seen = {}, out = [];
    (cl.items || []).forEach(function (it) { var t = (it.tag || "").trim(); if (t && !seen[t]) { seen[t] = 1; out.push(t); } });
    return out;
  }

  // 항목 타겟날짜를 체크리스트 D-Day 기준 오프셋으로 → "D-7" / "D-DAY" / "D+3".
  function ddayLabel(it, cl) {
    if (!it || !it.targetDate || !cl || !cl.dDay) return "";
    var off = CK.offsetOf(it.targetDate, cl.dDay);
    if (off === 0) return "D-DAY";
    return off < 0 ? "D" + off : "D+" + off;
  }

  function renderItems() {
    var host = document.getElementById("cl-items");
    host.innerHTML = "";
    var cl = current();

    var addBtn = el("button", { class: "btn btn-primary", onClick: function () {
      var it = JF.schema.emptyChecklistItem(); it.id = uid("it"); it.name = "새 항목"; it.targetDate = cl.dDay;
      cl.items.push(it); openItemId = it.id; saveRender();
    } }, "+ 항목 추가");
    var datalist = el("datalist", { id: "cl-tag-list" }, distinctTags(cl).map(function (t) { return el("option", { value: t }); }));

    var colDefs = [
      { label: "D-Day", cls: "cl-c-dday" },
      { label: "D-Day그룹", cls: "cl-c-group" },
      { label: "항목태그", cls: "cl-c-tag" },
      { label: "항목명", cls: "cl-c-name" },
      { label: "상태", cls: "cl-c-status" },
      { label: "타겟날짜", cls: "cl-c-target" },
      { label: "담당자", cls: "cl-c-assignee" },
      { label: "편집", cls: "cl-c-edit" }
    ];
    var thead = el("thead", null, el("tr", null, colDefs.map(function (c) { return el("th", { class: c.cls }, c.label); })));
    var tbody = el("tbody", null, []);

    var items = (cl.items || []).filter(function (it) {
      if (activeGroupId === null) return true;
      var g = CK.assignGroup(it, cl);
      return g && g.id === activeGroupId;
    }).sort(function (a, b) {
      // 타겟날짜 오름차순. 날짜 없는 항목은 맨 뒤로.
      var ad = a.targetDate || "", bd = b.targetDate || "";
      if (!ad && !bd) return 0;
      if (!ad) return 1;
      if (!bd) return -1;
      return JF.format.ymCompare(ad, bd);
    });
    if (!items.length) {
      tbody.appendChild(el("tr", null, el("td", { colspan: "8", class: "muted" }, "항목이 없습니다.")));
    } else {
      items.forEach(function (it) {
        var g = CK.assignGroup(it, cl);
        var status = CK.itemStatus(it);
        var statusCls = status === "완료" ? "status-done" : (status === "진행중" ? "status-progress" : "status-pending");
        var groupCell = g
          ? el("td", { class: "cell-colored cl-c-group", style: { background: g.color } }, g.label)
          : el("td", { class: "muted cl-c-group" }, "미분류");
        tbody.appendChild(el("tr", { class: "exp-row" + (openItemId === it.id ? " is-open" : ""), onClick: function () {
          openItemId = (openItemId === it.id ? null : it.id); render();
        } }, [
          el("td", { class: "cl-c-dday" }, ddayLabel(it, cl) || null),
          groupCell,
          el("td", { class: "cl-c-tag" }, it.tag || null),
          el("td", { class: "cell-wrap cl-c-name" }, it.name || ""),
          el("td", { class: "cl-c-status" }, el("span", { class: "status-badge " + statusCls }, status)),
          el("td", { class: "cl-c-target" }, it.targetDate ? it.targetDate.slice(5) : null),
          el("td", { class: "cl-c-assignee" }, it.assignee || null),
          el("td", { class: "cl-c-edit" }, openItemId === it.id ? "닫기 ▾" : "편집 ▸")
        ]));
        if (openItemId === it.id) {
          tbody.appendChild(el("tr", null, el("td", { class: "exp-edit-cell", colspan: "8" }, itemEditor(it, cl))));
        }
      });
    }

    host.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-header" }, [
        el("span", { class: "card-title" }, "체크리스트 항목" + (activeGroupId ? " · 필터: " + groupLabel(cl, activeGroupId) : "")),
        el("div", { class: "field-row push-right" }, [addBtn])
      ]),
      el("div", { class: "card-body stack" }, [
        datalist,
        el("div", { class: "table-wrap" }, el("table", { class: "table table-dense cl-item-table" }, [thead, tbody]))
      ])
    ]));
  }

  function itemEditor(it, cl) {
    var name = el("input", { type: "text", value: it.name || "", onInput: function () { it.name = name.value; save(); } });
    var tag = el("input", { type: "text", value: it.tag || "", list: "cl-tag-list", onInput: function () { it.tag = tag.value; save(); } });
    var target = el("input", { type: "date", value: it.targetDate || "", onChange: function () { it.targetDate = target.value; saveRender(); } });
    var assignee = el("input", { type: "text", value: it.assignee || "", onInput: function () { it.assignee = assignee.value; save(); } });

    var body = el("div", { class: "card-body stack" }, [
      el("div", { class: "field-row" }, [el("label", null, "항목명:"), name, el("label", null, "태그:"), tag]),
      el("div", { class: "field-row" }, [el("label", null, "타겟날짜:"), target, el("label", null, "담당자:"), assignee])
    ]);

    // 상세 내용 (체크박스 → 상태 파생)
    body.appendChild(el("div", { class: "subhead" }, "상세 내용 (체크 → 진행상태)"));
    (it.details || []).forEach(function (d) {
      var cb = el("input", { type: "checkbox", checked: !!d.checked, onChange: function () { d.checked = cb.checked; saveRender(); } });
      var txt = el("input", { type: "text", value: d.text || "", onInput: function () { d.text = txt.value; save(); } });
      var del = el("button", { class: "btn btn-sm btn-danger", onClick: function () { it.details = it.details.filter(function (x) { return x !== d; }); saveRender(); } }, "삭제");
      body.appendChild(el("div", { class: "subitem-row" + (d.checked ? " is-checked" : "") }, [cb, txt, del]));
    });
    body.appendChild(el("button", { class: "btn btn-sm btn-ghost", onClick: function () {
      var d = JF.schema.emptyDetail(); d.id = uid("d"); it.details.push(d); saveRender();
    } }, "+ 상세 추가"));

    // 결과 메모 (텍스트)
    body.appendChild(el("div", { class: "subhead" }, "결과 메모"));
    (it.memos || []).forEach(function (m) {
      var txt = el("input", { type: "text", value: m.text || "", onInput: function () { m.text = txt.value; save(); } });
      var del = el("button", { class: "btn btn-sm btn-danger", onClick: function () { it.memos = it.memos.filter(function (x) { return x !== m; }); saveRender(); } }, "삭제");
      body.appendChild(el("div", { class: "subitem-row" }, [txt, del]));
    });
    body.appendChild(el("button", { class: "btn btn-sm btn-ghost", onClick: function () {
      var m = JF.schema.emptyMemo(); m.id = uid("m"); it.memos.push(m); saveRender();
    } }, "+ 메모 추가"));

    body.appendChild(el("div", { class: "card-footer" }, el("button", { class: "btn btn-sm btn-danger", onClick: function () {
      if (window.confirm("항목을 삭제할까요? (" + (it.name || "") + ")")) {
        cl.items = cl.items.filter(function (x) { return x.id !== it.id; }); openItemId = null; saveRender();
      }
    } }, "항목 삭제")));

    return el("div", { class: "card" }, [el("div", { class: "card-header" }, el("span", { class: "card-title" }, "항목 편집")), body]);
  }

  // ---- 캘린더 ------------------------------------------------------
  function weekdayOf(ymd) {
    var p = ymd.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); // 0=일
  }

  function renderCalendar() {
    var host = document.getElementById("cl-calendar");
    host.innerHTML = "";
    var cl = current();
    var dates = CK.calendarRange(cl);

    var grid = el("div", { class: "cal-grid" }, []);
    ["일", "월", "화", "수", "목", "금", "토"].forEach(function (w) { grid.appendChild(el("div", { class: "cal-weekday" }, w)); });

    if (dates.length) {
      var lead = weekdayOf(dates[0]);
      for (var i = 0; i < lead; i++) grid.appendChild(el("div", { class: "cal-cell is-blank" }, ""));
    }
    dates.forEach(function (ymd) {
      var g = CK.groupForDate(ymd, cl);
      var attrs = { class: "cal-cell" + (g ? " is-colored" : "") };
      if (g) attrs.style = { background: g.color };
      var children = [el("div", { class: "cal-daynum" + (ymd === cl.dDay ? " is-dday" : "") }, String(+ymd.split("-")[2]))];
      (cl.items || []).forEach(function (it) {
        if (it.targetDate !== ymd) return;
        var st = CK.itemStatus(it);
        var cls = "cal-item" + (st === "완료" ? " is-done" : (st === "예정" ? " is-pending" : ""));
        children.push(el("span", { class: cls }, (it.tag ? it.tag + " " : "") + (it.name || "")));
      });
      grid.appendChild(el("div", attrs, children));
    });

    host.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-header" }, [
        el("span", { class: "card-title" }, "캘린더"),
        el("span", { class: "muted" }, "시작일 ~ D-Day+1개월")
      ]),
      el("div", { class: "card-body" }, grid)
    ]));
  }

  function render() { renderHeader(); renderGroups(); renderItems(); renderCalendar(); }

  function boot() {
    JF.ui.renderNav("checklist.html");
    state = JF.store.load();
    if (!state.meta) state.meta = {};
    if (!state.checklists) state.checklists = [];
    if (!state.checklists.length) {
      var c = makeChecklist("이사 체크리스트", "2026-07-05", "2026-09-28");
      state.checklists.push(c); state.meta.activeChecklistId = c.id; JF.store.save(state);
    }
    if (!state.meta.activeChecklistId) { state.meta.activeChecklistId = state.checklists[0].id; JF.store.save(state); }
    render();
    if (JF.syncUI) JF.syncUI.bind({ get: function () { return state; }, set: function (s) { state = s; }, render: render });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();
