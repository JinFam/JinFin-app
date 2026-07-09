window.JF = window.JF || {};

(function (JF) {

  var SCHEMA_VERSION = 1;
  var STORAGE_KEY = 'jinfinance:v1';

  function emptyExpenseItem() {
    return {
      id: '',
      name: '',
      type: '고정', // "고정" | "생활" | "교육" | "추가"(일회성)  ("특수"는 state.specials)
      category: '',
      recurrence: { kind: 'monthly', startMonth: null, endMonth: null },
      effectiveValues: [ { fromMonth: null, plannedAmount: 0, actualAmount: null } ],
      actualsByMonth: {},
      pastLock: true,
      assignedCardId: null,
      chargeDay: null,
      countsTowardPerformance: false
    };
  }

  function emptyBonusEvent() {
    return {
      id: '',
      label: '',
      monthDay: null,     // recurring: "MM-DD"
      date: null,         // non-recurring: "YYYY-MM-DD"
      plannedAmount: 0,
      actualAmount: null,       // non-recurring 전용
      actualsByYear: {},        // recurring 전용, key = "YYYY"
      starTag: 1,
      recurring: false
    };
  }

  // 기간별 월급 세그먼트 — fromMonth부터 다음 세그먼트 전까지 적용(carry-forward). 원 저장.
  // 첫 세그먼트 이전 달은 income.salaryDefault(기본 월급)을 사용.
  function emptySalarySegment() {
    return {
      id: '',
      fromMonth: null,   // "YYYY-MM"
      amount: 0
    };
  }

  // 추가 수입(월별 특별 이벤트) — 고정 월급 외 변동 수입. 원 저장.
  function emptyExtraIncome() {
    return {
      id: '',
      label: '',
      kind: '추가수당',   // "추가수당" | "비정기수입"
      month: null,        // "YYYY-MM"
      plannedAmount: 0,
      actualAmount: null, // 확정 시 입력(없으면 계획값 사용)
      note: ''            // 상세 내역(펼치기)
    };
  }

  function emptyCard() {
    return {
      id: '',
      name: '',
      issuer: '',
      billingWindow: { start: 1 }, // end = start-1 파생, start=1 = 달력월
      paymentDay: null,
      limit: null,
      annualFee: 0,
      performanceConditions: [], // [{label, threshold, primary, exclusions}]
      benefits: [],               // [{desc, cap}]
      mainMerchants: [],
      guide: null
    };
  }

  // ---- D-Day 체크리스트 --------------------------------------------------
  function emptyChecklist() {
    return {
      id: '',
      title: '',
      startDate: null,   // "YYYY-MM-DD"
      dDay: null,        // "YYYY-MM-DD" (타겟일)
      groups: [],        // [emptyDdayGroup]
      items: []          // [emptyChecklistItem]
    };
  }
  // D-Day 그룹: offsetDays 부호 오프셋(이전=음수, 예 D-7 -> -7, D+7 -> +7, D-Day -> 0)
  function emptyDdayGroup() {
    return { id: '', label: '', offsetDays: 0, color: '#E5E7EB' };
  }
  function emptyChecklistItem() {
    return {
      id: '',
      tag: '',              // 항목 태그(카테고리, 자동완성)
      name: '',
      targetDate: null,     // "YYYY-MM-DD" — 그룹 자동배정 기준
      assignee: '',
      details: [],          // [emptyDetail] — 체크박스, 상태 파생
      memos: []             // [emptyMemo] — 텍스트(체크 없음)
    };
  }
  function emptyDetail() { return { id: '', text: '', checked: false }; }
  function emptyMemo() { return { id: '', text: '' }; }

  // schemaVersion 확인/업그레이드 + 상시 정규화(로드된 구버전 상태 보정).
  function migrate(state) {
    if (!state) return state;
    if (typeof state.schemaVersion !== 'number' || state.schemaVersion < SCHEMA_VERSION) {
      state.schemaVersion = SCHEMA_VERSION;
    }
    if (state.income) {
      // 추가 수입 / 기간별 월급 배열 보장(버전과 무관하게 상시 정규화)
      if (!Array.isArray(state.income.extraIncomes)) state.income.extraIncomes = [];
      if (!Array.isArray(state.income.salarySegments)) state.income.salarySegments = [];
      // 월별 조정(salaryOverrides) 폐지(#5) — 추가 수입으로 대체. 숨은 값이 잔액을
      // 움직이지 않도록 로드 시 제거(계산도 더 이상 읽지 않음).
      if (state.income.salaryOverrides) delete state.income.salaryOverrides;
    }
    // 분류별 색상 맵(이름 -> hex) 보장
    if (!state.categoryColors || typeof state.categoryColors !== 'object') state.categoryColors = {};
    // D-Day 체크리스트 배열 + meta 보장(meta가 없을 수 있는 구버전 대비)
    if (!state.meta || typeof state.meta !== 'object') state.meta = {};
    if (!Array.isArray(state.checklists)) state.checklists = [];
    // 레거시 quarterly → interval(매 3개월)로 정규화(UI가 interval만 노출)
    var normRec = function (it) {
      if (it && it.recurrence && it.recurrence.kind === 'quarterly') {
        it.recurrence = { kind: 'interval', intervalMonths: 3, startMonth: it.recurrence.startMonth, endMonth: it.recurrence.endMonth || null };
      }
    };
    (state.expenses || []).forEach(normRec);
    (state.specials || []).forEach(normRec);
    return state;
  }

  JF.schema = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    emptyExpenseItem: emptyExpenseItem,
    emptyBonusEvent: emptyBonusEvent,
    emptySalarySegment: emptySalarySegment,
    emptyExtraIncome: emptyExtraIncome,
    emptyCard: emptyCard,
    emptyChecklist: emptyChecklist,
    emptyDdayGroup: emptyDdayGroup,
    emptyChecklistItem: emptyChecklistItem,
    emptyDetail: emptyDetail,
    emptyMemo: emptyMemo,
    migrate: migrate
  };

})(window.JF);
