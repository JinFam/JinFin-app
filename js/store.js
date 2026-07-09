// js/store.js — JF.store: state load/save, localStorage feature-probe, export/import.
// Classic script. No ES modules, no fetch, no build step. Works on file:// and http://.
window.JF = window.JF || {};

(function () {
  "use strict";

  var EXPORT_TS_KEY = "jinfinance:lastExportAt";
  var PROBE_KEY = "__jinfinance_probe__";

  // ---- feature-probe -------------------------------------------------
  // try { setItem; getItem; removeItem } catch -> bool.
  // This is the single source of truth for "can we persist at all?".
  function probeStorage() {
    try {
      var ls = window.localStorage;
      ls.setItem(PROBE_KEY, "1");
      ls.getItem(PROBE_KEY);
      ls.removeItem(PROBE_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  function storageBlockedBanner(prefix) {
    if (JF.ui && typeof JF.ui.showBanner === "function") {
      JF.ui.showBanner(
        (prefix ? prefix + " " : "") +
          "이 브라우저/모드에서는 데이터가 저장되지 않습니다 (localStorage 사용 불가). " +
          "터미널에서 ./serve.sh 를 실행해 http://localhost:8000 으로 접속하거나, " +
          "지금 바로 [내보내기]로 jinfinance.json을 저장해 두세요.",
        "error"
      );
    }
  }

  function corruptedDataBanner() {
    if (JF.ui && typeof JF.ui.showBanner === "function") {
      JF.ui.showBanner(
        "저장된 데이터를 읽을 수 없습니다 (손상됨). 기본 시드 데이터로 시작합니다. " +
          "최근 내보내기(jinfinance.json)가 있다면 [가져오기]로 복원하세요.",
        "error"
      );
    }
  }

  function saveFailedBanner() {
    if (JF.ui && typeof JF.ui.showBanner === "function") {
      JF.ui.showBanner(
        "저장 실패: 브라우저 저장 공간이 가득 찼거나 접근할 수 없습니다. " +
          "지금 바로 [내보내기]로 데이터를 백업하세요.",
        "error"
      );
    }
  }

  // ---- helpers ---------------------------------------------------------
  function getStorageKey() {
    return (JF.schema && JF.schema.STORAGE_KEY) || "jinfinance:v1";
  }

  function migrate(state) {
    if (JF.schema && typeof JF.schema.migrate === "function") {
      return JF.schema.migrate(state);
    }
    return state;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function todayYm() {
    var now = new Date();
    if (JF.format && typeof JF.format.ym === "function") {
      return JF.format.ym(now);
    }
    var y = now.getFullYear();
    var m = now.getMonth() + 1;
    return y + "-" + (m < 10 ? "0" + m : String(m));
  }

  // ---- public API --------------------------------------------------------

  // load(): localStorage[STORAGE_KEY] parse -> migrate; absent/blocked/corrupt -> clone(SEED_STATE).
  // This is the ONE place "today" is read: meta.currentMonth is stamped here, always.
  function load() {
    var key = getStorageKey();
    var state = null;

    if (!probeStorage()) {
      storageBlockedBanner();
    } else {
      try {
        var raw = window.localStorage.getItem(key);
        if (raw) {
          state = migrate(JSON.parse(raw));
        }
      } catch (e) {
        state = null;
        corruptedDataBanner();
      }
    }

    if (!state) {
      var seed = JF.seed && JF.seed.SEED_STATE;
      state = seed ? deepClone(seed) : {};
    }

    if (!state.meta) state.meta = {};
    state.meta.currentMonth = todayYm();

    return state;
  }

  // save(state): JSON.stringify -> localStorage[STORAGE_KEY]. Probe failure -> banner, no throw.
  function save(state) {
    if (!probeStorage()) {
      storageBlockedBanner();
      return false;
    }
    try {
      window.localStorage.setItem(getStorageKey(), JSON.stringify(state));
      // 동기화 활성 시 변경 섹션을 원격에 반영(비활성/미배선이면 no-op).
      if (JF.sync && typeof JF.sync.onLocalSave === "function") {
        try { JF.sync.onLocalSave(state); } catch (e2) {}
      }
      return true;
    } catch (e) {
      // e.g. QuotaExceededError
      saveFailedBanner();
      return false;
    }
  }

  // exportJson(state): Blob download named "jinfinance.json". Works on file:// (no server needed).
  function exportJson(state) {
    var json = JSON.stringify(state, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "jinfinance.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
    try {
      window.localStorage.setItem(EXPORT_TS_KEY, String(Date.now()));
    } catch (e) {
      // exporting still succeeded even if we can't remember when
    }
  }

  // importJson(file, cb): FileReader -> JSON.parse -> migrate -> cb(state). No server needed.
  function importJson(file, cb) {
    var reader = new FileReader();
    reader.onload = function (evt) {
      var state;
      try {
        state = migrate(JSON.parse(evt.target.result));
      } catch (e) {
        if (JF.ui && typeof JF.ui.showBanner === "function") {
          JF.ui.showBanner("가져오기 실패: 올바른 jinfinance.json 파일이 아닙니다.", "error");
        }
        return;
      }
      cb(state);
    };
    reader.onerror = function () {
      if (JF.ui && typeof JF.ui.showBanner === "function") {
        JF.ui.showBanner("가져오기 실패: 파일을 읽을 수 없습니다.", "error");
      }
    };
    reader.readAsText(file);
  }

  // lastBackupInfo(): "마지막 백업: N일 전" nudge string.
  function lastBackupInfo() {
    var ts;
    try {
      ts = window.localStorage.getItem(EXPORT_TS_KEY);
    } catch (e) {
      ts = null;
    }
    if (!ts) return "마지막 백업: 기록 없음";
    var days = Math.floor((Date.now() - Number(ts)) / 86400000);
    if (days <= 0) return "마지막 백업: 오늘";
    return "마지막 백업: " + days + "일 전";
  }

  JF.store = {
    probeStorage: probeStorage,
    load: load,
    save: save,
    exportJson: exportJson,
    importJson: importJson,
    lastBackupInfo: lastBackupInfo
  };
})();
