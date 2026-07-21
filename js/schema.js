window.JF = window.JF || {};

(function (JF) {

  var SCHEMA_VERSION = 1;
  var STORAGE_KEY = 'jinfinance:v1';

  function emptyExpenseItem() {
    return {
      id: '',
      name: '',
      type: '고정-카드', // "고정-카드" | "고정-이체" | "생활" | "교육" | "추가"(일회성)  ("특수"는 state.specials)
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

  // ---- 대출(loan) 지출 항목 --------------------------------------------
  // state.loanExpenses[]의 원소. ⚠️ state.loans(대출계산기 케이스 설정)와는 다른 개념 —
  // loanExpenses는 "대출" 지출 탭의 항목(월별 원리금 지출), state.loans는 상환 스케줄을
  // 만드는 계산기 입력값이다. auto 모드일 때 loanId로 state.loans[].id를 참조한다.
  //  - mode 'manual': manualSegments의 각 구간(fromMonth<=month<=toMonth)에 amount 적용,
  //    구간 밖은 0원. 겹치는 구간은 배열 순서상 first-match-wins.
  //  - mode 'auto': loanId가 가리키는 state.loans 케이스의 회차별 상환액(payment)을 월별로 대입.
  function emptyLoanExpenseItem() {
    return {
      id: '',
      name: '',
      mode: 'manual',        // 'manual' | 'auto'
      manualSegments: [],    // [{ id, fromMonth: 'YYYY-MM', toMonth: 'YYYY-MM', amount: 0 }] — 구간 밖은 0원
      loanId: null,          // mode==='auto'일 때 state.loans[].id 참조
      category: '',
      actualsByMonth: {},
      pastLock: true,
      assignedCardId: null,
      chargeDay: null,
      countsTowardPerformance: false
    };
  }

  // ---- 대출계산기 -----------------------------------------------------
  // 금액: 원(정수). annualRate: %(예 4.45). linkToFinalRate=true면 계산 시 최종금리로 해석(호출자 책임).
  function emptyLoanCase() {
    return {
      id: '',
      name: '',
      amount: 0,              // 원
      termMonths: 0,          // 총 개월수(거치 포함)
      annualRate: 0,          // %
      linkToFinalRate: false, // 최종금리 연동
      graceMonths: 0,         // 거치(개월) — 이자만
      startDate: null,        // "YYYY-MM-DD" 실행일(1회차=실행일+1개월)
      extraPayment: { amount: 0, fromInstallment: 0, toInstallment: 0 }, // 월 추가 원금(시작~끝 회차, 끝 0=만기까지)
      prepayments: [],        // [{id, installment, amount(원)}] 중도상환
      rateChanges: []         // [{id, fromInstallment, annualRate(%)}] 금리변동
    };
  }

  // ---- 부동산 예산 ------------------------------------------------------
  // state.realEstateBudget[] = 스냅샷 배열(시간순, index 0=가장 오래됨). 스냅샷마다
  // 독립된 열(columns) 구성 + 매도비용/매수비용 소항목(item)을 가진다.
  function emptyRealEstateColumn() {
    return { id: '', title: '' };
  }
  // cellStyles: { date: {bg, fontPreset}, [columnId]: {bg, fontPreset} } — 날짜/비용 칸 전용
  // (항목명 칸은 이름수정/고정 아이콘 전용, 스타일 없음). locked=true면 비용 값 셀만 잠김.
  function emptyRealEstateItem() {
    return {
      id: '',
      name: '',
      date: null,       // "YYYY-MM-DD" 시행일자
      locked: false,
      values: {},         // { [columnId]: number(원) } — 키 없으면 0, 마이너스 허용
      cellStyles: {}
    };
  }
  function emptyRealEstateSnapshot() {
    return {
      id: '',
      date: null,        // "YYYY-MM-DD" — 상단 "{날짜} {타이틀}"의 날짜
      title: '',
      columns: [],         // [emptyRealEstateColumn]
      sellItems: [],        // [emptyRealEstateItem] 매도비용
      buyItems: []           // [emptyRealEstateItem] 매수비용
    };
  }

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
    // "대출" 지출 탭 항목 배열 보장(구버전/미필드 상태 방어). state.loans(대출계산기)와 별개.
    if (!Array.isArray(state.loanExpenses)) state.loanExpenses = [];
    // 레거시 quarterly → interval(매 3개월)로 정규화(UI가 interval만 노출)
    var normRec = function (it) {
      if (it && it.recurrence && it.recurrence.kind === 'quarterly') {
        it.recurrence = { kind: 'interval', intervalMonths: 3, startMonth: it.recurrence.startMonth, endMonth: it.recurrence.endMonth || null };
      }
    };
    (state.expenses || []).forEach(normRec);
    (state.specials || []).forEach(normRec);
    // "고정" 단일 탭 폐지(2026-07-22) → "고정-카드"/"고정-이체"로 분리. 기존 결제수단
    // (assignedCardId==="transfer") 기준 자동 분류, 그 외(카드/미배정)는 고정-카드로.
    (state.expenses || []).forEach(function (it) {
      if (it && it.type === '고정') {
        it.type = (it.assignedCardId === 'transfer') ? '고정-이체' : '고정-카드';
      }
    });

    // 대출계산기 배열 보장 + 케이스 하위필드 정규화(동기화/구버전으로 유입된 부분 데이터 방어).
    if (!Array.isArray(state.loans)) state.loans = [];
    state.loans.forEach(function (loanCase) {
      if (!loanCase) return;
      if (!loanCase.extraPayment || typeof loanCase.extraPayment !== 'object') {
        loanCase.extraPayment = { amount: 0, fromInstallment: 0, toInstallment: 0 };
      } else {
        loanCase.extraPayment.amount = Number(loanCase.extraPayment.amount) || 0;
        loanCase.extraPayment.fromInstallment = Number(loanCase.extraPayment.fromInstallment) || 0;
        loanCase.extraPayment.toInstallment = Number(loanCase.extraPayment.toInstallment) || 0;
      }
      if (!Array.isArray(loanCase.prepayments)) loanCase.prepayments = [];
      if (!Array.isArray(loanCase.rateChanges)) loanCase.rateChanges = [];
      var termMonths = Number(loanCase.termMonths) || 0;
      var maxGrace = Math.max(0, termMonths - 1);
      var grace = Number(loanCase.graceMonths) || 0;
      loanCase.graceMonths = Math.max(0, Math.min(maxGrace, grace));
    });

    // 부동산 예산 스냅샷 배열 보장 + 하위필드 정규화(동기화/구버전으로 유입된 부분 데이터 방어).
    if (!Array.isArray(state.realEstateBudget)) state.realEstateBudget = [];
    state.realEstateBudget.forEach(function (snap) {
      if (!snap) return;
      if (!Array.isArray(snap.columns)) snap.columns = [];
      if (!Array.isArray(snap.sellItems)) snap.sellItems = [];
      if (!Array.isArray(snap.buyItems)) snap.buyItems = [];
      snap.sellItems.concat(snap.buyItems).forEach(function (it) {
        if (!it) return;
        if (!it.values || typeof it.values !== 'object') it.values = {};
        if (!it.cellStyles || typeof it.cellStyles !== 'object') it.cellStyles = {};
      });
    });

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
    emptyLoanExpenseItem: emptyLoanExpenseItem,
    emptyLoanCase: emptyLoanCase,
    emptyRealEstateColumn: emptyRealEstateColumn,
    emptyRealEstateItem: emptyRealEstateItem,
    emptyRealEstateSnapshot: emptyRealEstateSnapshot,
    migrate: migrate
  };

})(window.JF);
