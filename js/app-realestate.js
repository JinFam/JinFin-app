// js/app-realestate.js — 부동산 예산: 스냅샷 CRUD + 렌더링 + 셀 편집 팝오버.
// 계산은 JF.realestate(순수 모듈)에 위임. 상태 CRUD/렌더링은 app-loan.js/app-checklist.js와 동일 관용구.
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var state;

  var activeCellPopover = null; // { snapshotId, group:'sellItems'|'buyItems', itemId, field:'date'|columnId }
  var editingSnapshotId = null; // 스냅샷 헤더(날짜/타이틀) 인라인 편집 중
  var editingItemId = null;     // 항목명 인라인 편집 중
  var editingColumnId = null;   // 열 제목 인라인 편집 중

  var FONT_OPTIONS = [
    { value: "default", label: "기본" },
    { value: "bold", label: "굵게" },
    { value: "italic", label: "기울임" },
    { value: "bold-italic", label: "굵은 기울임" },
    { value: "mono", label: "모노스페이스" }
  ];

  function uid(p) { return p + "-" + Math.random().toString(36).slice(2, 8); }
  function save() { JF.store.save(state); }                 // 타이핑 중(리렌더 없음, 포커스 유지)
  function saveRender() { JF.store.save(state); render(); }  // 구조변경/스타일/닫기(즉시 리렌더)
  function won(n) { return JF.format.formatWon(n) + "원"; }

  function closeAllEditors() {
    editingSnapshotId = null;
    editingItemId = null;
    editingColumnId = null;
  }

  // ---- 조회 헬퍼 ----------------------------------------------------------
  function findSnapshot(id) {
    var list = state.realEstateBudget || [];
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  }
  function findItem(snap, groupKey, itemId) {
    if (!snap) return null;
    var items = snap[groupKey] || [];
    for (var i = 0; i < items.length; i++) { if (items[i].id === itemId) return items[i]; }
    return null;
  }

  // ---- 스냅샷 CRUD ----------------------------------------------------------
  function cloneSnapshotAsNew(prev) {
    var next = prev ? JSON.parse(JSON.stringify(prev)) : JF.schema.emptyRealEstateSnapshot();
    next.id = uid("re-snap");
    if (prev) {
      var colMap = {};
      next.columns = prev.columns.map(function (c) {
        var nc = { id: uid("re-col"), title: c.title };
        colMap[c.id] = nc.id;
        return nc;
      });
      var remap = function (items) {
        return (items || []).map(function (it) {
          var values = {}, styles = {};
          Object.keys(it.values || {}).forEach(function (k) { if (colMap[k]) values[colMap[k]] = it.values[k]; });
          Object.keys(it.cellStyles || {}).forEach(function (k) { styles[colMap[k] || k] = it.cellStyles[k]; });
          return { id: uid("re-item"), name: it.name, date: it.date, locked: it.locked, values: values, cellStyles: styles };
        });
      };
      next.sellItems = remap(prev.sellItems);
      next.buyItems = remap(prev.buyItems);
    }
    return next;
  }
  function addSnapshot() {
    var list = state.realEstateBudget;
    list.push(cloneSnapshotAsNew(list[list.length - 1] || null));
    saveRender();
  }
  function removeSnapshot(id) {
    var snap = findSnapshot(id);
    if (!window.confirm("이 스냅샷을 삭제할까요?" + (snap && snap.title ? " (" + snap.title + ")" : ""))) return;
    state.realEstateBudget = state.realEstateBudget.filter(function (s) { return s.id !== id; });
    activeCellPopover = null;
    closeAllEditors();
    saveRender();
  }

  // ---- 열 CRUD ---------------------------------------------------------------
  function addColumn(snap) {
    var col = JF.schema.emptyRealEstateColumn();
    col.id = uid("re-col");
    col.title = "새 열";
    snap.columns.push(col);
    snap.sellItems.concat(snap.buyItems).forEach(function (it) { it.values[col.id] = 0; });
    saveRender();
  }
  function removeColumn(snap, colId) {
    if (!window.confirm("이 열을 삭제할까요?")) return;
    snap.columns = snap.columns.filter(function (c) { return c.id !== colId; });
    snap.sellItems.concat(snap.buyItems).forEach(function (it) {
      delete it.values[colId];
      delete it.cellStyles[colId];
    });
    if (activeCellPopover && activeCellPopover.field === colId) activeCellPopover = null;
    if (editingColumnId === colId) editingColumnId = null;
    saveRender();
  }

  // ---- 항목 CRUD -------------------------------------------------------------
  function addItem(snap, groupKey) {
    var it = JF.schema.emptyRealEstateItem();
    it.id = uid("re-item");
    it.name = "새 항목";
    snap[groupKey].push(it);
    saveRender();
  }
  function removeItem(snap, groupKey, itemId) {
    if (!window.confirm("이 항목을 삭제할까요?")) return;
    snap[groupKey] = snap[groupKey].filter(function (it) { return it.id !== itemId; });
    if (activeCellPopover && activeCellPopover.itemId === itemId) activeCellPopover = null;
    if (editingItemId === itemId) editingItemId = null;
    saveRender();
  }
  function toggleLock(item) {
    item.locked = !item.locked;
    saveRender();
  }
  function setCellStyle(item, field, patch) {
    var cur = item.cellStyles[field] || {};
    var next = { bg: cur.bg || null, fontPreset: cur.fontPreset || "default" };
    if (Object.prototype.hasOwnProperty.call(patch, "bg")) next.bg = patch.bg;
    if (Object.prototype.hasOwnProperty.call(patch, "fontPreset")) next.fontPreset = patch.fontPreset;
    item.cellStyles[field] = next;
  }

  // ---- 셀 편집 팝오버 --------------------------------------------------------
  function openPopover(snap, groupKey, item, field) {
    closeAllEditors();
    activeCellPopover = { snapshotId: snap.id, group: groupKey, itemId: item.id, field: field };
    render();
  }
  function closePopover() {
    activeCellPopover = null;
    render();
  }
  function removePopoverNode() {
    var existing = document.getElementById("re-popover");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }
  function buildCellPopover(item, field) {
    var isDate = field === "date";
    var valueInput;
    if (isDate) {
      valueInput = el("input", {
        type: "date", value: item.date || "",
        onChange: function () { item.date = valueInput.value || null; saveRender(); }
      });
    } else {
      valueInput = el("input", {
        type: "number", step: "0.1", value: String(JF.format.toMan(item.values[field] || 0)),
        onInput: function () { item.values[field] = JF.format.fromMan(valueInput.value); save(); }
      });
    }

    var style = item.cellStyles[field] || {};
    var bgInput = el("input", {
      type: "color", class: "cat-color", value: style.bg || "#ffffff",
      onChange: function () { setCellStyle(item, field, { bg: bgInput.value }); saveRender(); }
    });
    var bgReset = el("button", {
      class: "btn btn-sm btn-ghost", type: "button",
      onClick: function () { setCellStyle(item, field, { bg: null }); saveRender(); }
    }, "배경 초기화");

    var fontSelect = el("select", {
      onChange: function () { setCellStyle(item, field, { fontPreset: fontSelect.value }); saveRender(); }
    }, FONT_OPTIONS.map(function (o) {
      return el("option", { value: o.value, selected: (style.fontPreset || "default") === o.value }, o.label);
    }));

    return el("div", { class: "re-popover", id: "re-popover" }, [
      el("div", { class: "re-popover-row" }, [el("label", null, isDate ? "날짜:" : "금액(만원):"), valueInput]),
      el("div", { class: "re-popover-row" }, [el("label", null, "배경색:"), bgInput, bgReset]),
      el("div", { class: "re-popover-row" }, [el("label", null, "폰트:"), fontSelect]),
      el("div", { class: "re-popover-footer" },
        el("button", { class: "btn btn-sm btn-secondary", type: "button", onClick: closePopover }, "닫기"))
    ]);
  }
  function mountPopover() {
    var ctx = activeCellPopover;
    if (!ctx) return;
    var snap = findSnapshot(ctx.snapshotId);
    var item = findItem(snap, ctx.group, ctx.itemId);
    var trigger = document.querySelector('[data-re-cell="' + ctx.itemId + ":" + ctx.field + '"]');
    if (!snap || !item || !trigger) { activeCellPopover = null; return; }
    var pop = buildCellPopover(item, ctx.field);
    var rect = trigger.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top = (rect.bottom + 4) + "px";
    pop.style.left = rect.left + "px";
    document.body.appendChild(pop);
  }
  function handleOutsideClick(e) {
    if (!activeCellPopover) return;
    var pop = document.getElementById("re-popover");
    if (pop && !pop.contains(e.target)) { activeCellPopover = null; render(); }
  }
  function handleScrollClose() {
    if (activeCellPopover) { activeCellPopover = null; render(); }
  }

  // ---- 렌더링 ----------------------------------------------------------------
  function renderCellTrigger(snap, groupKey, item, field) {
    var isDate = field === "date";
    var isLockedValue = !isDate && item.locked;
    var raw = isDate ? item.date : Number(item.values[field]) || 0;
    var text = isDate ? (item.date || "-") : won(raw);
    var negative = !isDate && raw < 0;
    var styleCss = JF.realestate.cellStyleToCss(item.cellStyles[field] || {});

    var attrs = {
      class: (isDate ? "" : "num") + (negative ? " negative" : "") +
        " " + (isLockedValue ? "re-cell-locked" : "re-cell-editable"),
      style: styleCss,
      "data-re-cell": item.id + ":" + field
    };
    if (isLockedValue) {
      attrs.title = "고정된 항목입니다";
    } else {
      attrs.onClick = function () { openPopover(snap, groupKey, item, field); };
    }
    return el("td", attrs, text);
  }

  function renderItemNameCell(snap, groupKey, item) {
    if (editingItemId === item.id) {
      var input = el("input", { type: "text", value: item.name || "", onInput: function () { item.name = input.value; save(); } });
      var doneBtn = el("button", { class: "btn btn-sm btn-ghost", type: "button", onClick: function () { editingItemId = null; saveRender(); } }, "완료");
      return el("td", null, [input, doneBtn]);
    }
    var editBtn = el("button", {
      class: "btn btn-sm btn-ghost", type: "button", title: "이름수정",
      onClick: function () { closeAllEditors(); editingItemId = item.id; render(); }
    }, "✎");
    var lockBtn = el("button", {
      class: "btn btn-sm btn-ghost", type: "button", title: item.locked ? "고정 해제" : "고정",
      onClick: function () { toggleLock(item); }
    }, item.locked ? "🔒" : "🔓");
    var removeBtn = el("button", {
      class: "btn btn-sm btn-ghost", type: "button", title: "항목 삭제",
      onClick: function () { removeItem(snap, groupKey, item.id); }
    }, "×");
    var hoverWrap = el("span", { class: "re-hover-label" }, [
      item.name || "(이름 없음)",
      el("span", { class: "re-hover-actions" }, [editBtn, lockBtn, removeBtn])
    ]);
    return el("td", null, hoverWrap);
  }

  function renderItemRow(snap, groupKey, item) {
    var nameCell = renderItemNameCell(snap, groupKey, item);
    var dateCell = renderCellTrigger(snap, groupKey, item, "date");
    var valueCells = snap.columns.map(function (col) { return renderCellTrigger(snap, groupKey, item, col.id); });
    return el("tr", { class: "re-item-row" + (item.locked ? " is-locked" : "") }, [nameCell, dateCell].concat(valueCells));
  }

  function renderGroupRows(snap, groupKey, groupLabel) {
    var items = snap[groupKey] || [];
    var rowCount = items.length + 1; // +1 = "+ 항목 추가" 행 포함
    var rows = [];
    var labelTd = el("td", { rowspan: String(rowCount) }, groupLabel);
    items.forEach(function (item, idx) {
      var tr = renderItemRow(snap, groupKey, item);
      if (idx === 0) tr.insertBefore(labelTd, tr.firstChild);
      rows.push(tr);
    });
    var addRow = el("tr", { class: "re-add-row" }, [
      el("td", { colspan: "2" },
        el("button", { class: "btn btn-sm btn-secondary", type: "button", onClick: function () { addItem(snap, groupKey); } }, "+ 항목 추가"))
    ].concat(snap.columns.map(function () { return el("td", null, ""); })));
    if (items.length === 0) addRow.insertBefore(labelTd, addRow.firstChild);
    rows.push(addRow);
    return rows;
  }

  function renderTotalsRow(label, totals, key) {
    var cells = [el("td", null, label), el("td", { colspan: "2" }, "")];
    totals.forEach(function (t) {
      var v = t[key];
      cells.push(el("td", { class: "num" + (v < 0 ? " negative" : "") }, won(v)));
    });
    return el("tr", { class: "re-totals-row" }, cells);
  }

  function renderColumnHeaderCell(snap, col) {
    if (editingColumnId === col.id) {
      var input = el("input", { type: "text", value: col.title || "", onInput: function () { col.title = input.value; save(); } });
      var doneBtn = el("button", { class: "btn btn-sm btn-ghost", type: "button", onClick: function () { editingColumnId = null; saveRender(); } }, "완료");
      return el("th", null, [input, doneBtn]);
    }
    var editBtn = el("button", {
      class: "btn btn-sm btn-ghost", type: "button", title: "열 이름변경",
      onClick: function () { closeAllEditors(); editingColumnId = col.id; render(); }
    }, "✎");
    var removeBtn = el("button", {
      class: "btn btn-sm btn-ghost", type: "button", title: "열 삭제",
      onClick: function () { removeColumn(snap, col.id); }
    }, "×");
    var hoverWrap = el("span", { class: "re-hover-label" }, [
      col.title || "(제목 없음)",
      el("span", { class: "re-hover-actions" }, [editBtn, removeBtn])
    ]);
    return el("th", null, hoverWrap);
  }

  function renderSnapshotTable(snap) {
    var totals = JF.realestate.computeTotals(snap);
    var headCells = [el("th", null, ""), el("th", null, "항목"), el("th", null, "시행일자")]
      .concat(snap.columns.map(function (col) { return renderColumnHeaderCell(snap, col); }))
      .concat([el("th", null, el("button", { class: "btn btn-sm btn-secondary", type: "button", onClick: function () { addColumn(snap); } }, "+ 열"))]);
    var thead = el("thead", null, el("tr", null, headCells));

    var rows = []
      .concat(renderGroupRows(snap, "sellItems", "매도비용"))
      .concat([renderTotalsRow("예산 총계", totals, "budgetTotal")])
      .concat(renderGroupRows(snap, "buyItems", "매수비용"))
      .concat([renderTotalsRow("비용 총계", totals, "costTotal")])
      .concat([renderTotalsRow("최종 총계", totals, "finalTotal")]);
    var tbody = el("tbody", null, rows);

    return el("table", { class: "table" }, [thead, tbody]);
  }

  function renderSnapshotHeader(snap) {
    if (editingSnapshotId === snap.id) {
      var dateInput = el("input", { type: "date", value: snap.date || "", onChange: function () { snap.date = dateInput.value || null; save(); } });
      var titleInput = el("input", { type: "text", value: snap.title || "", placeholder: "타이틀", onInput: function () { snap.title = titleInput.value; save(); } });
      var doneBtn = el("button", { class: "btn btn-sm btn-secondary", type: "button", onClick: function () { editingSnapshotId = null; saveRender(); } }, "완료");
      return el("div", { class: "re-snapshot-header" }, [dateInput, titleInput, doneBtn]);
    }
    var editBtn = el("button", {
      class: "btn btn-sm btn-ghost", type: "button", title: "수정",
      onClick: function () { closeAllEditors(); editingSnapshotId = snap.id; render(); }
    }, "✎");
    var removeBtn = el("button", {
      class: "btn btn-sm btn-danger push-right", type: "button", title: "스냅샷 삭제",
      onClick: function () { removeSnapshot(snap.id); }
    }, "×");
    var label = el("span", { class: "re-hover-label" }, [
      (snap.date || "날짜 미지정") + " " + (snap.title || "(제목 없음)"),
      el("span", { class: "re-hover-actions" }, editBtn)
    ]);
    return el("div", { class: "re-snapshot-header" }, [label, removeBtn]);
  }

  function renderSnapshotCard(snap) {
    return el("div", { class: "re-snapshot-card card" }, [
      renderSnapshotHeader(snap),
      el("div", { class: "table-wrap" }, renderSnapshotTable(snap))
    ]);
  }

  function renderAddSnapshotButton() {
    return el("div", { class: "re-snapshot-card re-snapshot-add" },
      el("button", { class: "btn btn-primary", type: "button", onClick: addSnapshot }, "+ 새 스냅샷"));
  }

  function render() {
    var host = document.getElementById("re-track");
    var oldTrack = host.querySelector(".re-snapshot-track");
    var savedScrollLeft = oldTrack ? oldTrack.scrollLeft : null;

    host.innerHTML = "";
    removePopoverNode();

    var list = state.realEstateBudget || [];
    var track = el("div", { class: "re-snapshot-track" }, list.map(renderSnapshotCard).concat([renderAddSnapshotButton()]));
    host.appendChild(track);
    if (savedScrollLeft != null) track.scrollLeft = savedScrollLeft;

    if (activeCellPopover) mountPopover();
  }

  // store.load()의 seed-clone 경로(최초 부팅, raw localStorage 없음)는 schema.migrate()를
  // 거치지 않으므로, sync가 넘겨준 state 등 다른 경로까지 포함해 여기서도 배열을 보장한다.
  function ensureSection() {
    if (!Array.isArray(state.realEstateBudget)) state.realEstateBudget = [];
  }

  function boot() {
    JF.ui.renderNav("realestate.html");
    state = JF.store.load();
    ensureSection();
    render();
    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("scroll", handleScrollClose, true);
    if (JF.syncUI) {
      JF.syncUI.bind({
        get: function () { return state; },
        set: function (s) { state = s; ensureSection(); },
        render: render
      });
    }
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();
