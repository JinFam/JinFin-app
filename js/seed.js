window.JF = window.JF || {};

(function (JF) {

  // 공개 배포용 시드 — 실제 재무데이터 없음(모두 더미/빈 값).
  // 실제 데이터는 비공개 동기화 저장소에서 토큰 입력 후 런타임에 로드된다.
  // (원본 개발용 seed.js에는 실데이터가 있으므로 이 파일로 대체해 공개함.)

  var SEED_STATE = {
    schemaVersion: 1,

    meta: {
      currentMonth: '2026-10', // placeholder — store.load()가 today로 갱신
      horizon: { start: '2026-10', end: '2028-03' },
      educationEnd: '2028-02'
    },

    account: { seedBalance: 0 },

    income: {
      // 월급 섹션(동시 발생하는 여러 수입원, 예: 본인/배우자) — salaryForMonth는 전 섹션 합산.
      // migrate()를 거치지 않는 seed-clone 최초 부팅 경로이므로 여기서 직접 새 형태로 제공.
      salaries: [
        { id: 'sal-default', label: '', salaryDefault: 0, segments: [] }
      ],
      extraIncomes: [],
      bonusEvents: []
    },

    expenses: [
      {
        id: 'ex-sample', name: '예시 지출', type: '생활', category: '생활비',
        recurrence: { kind: 'monthly', startMonth: '2026-10', endMonth: null },
        effectiveValues: [ { fromMonth: '2026-10', plannedAmount: 0, actualAmount: null } ],
        actualsByMonth: {}, pastLock: false,
        assignedCardId: null, chargeDay: null, countsTowardPerformance: false
      }
    ],

    specials: [],

    cards: [
      {
        id: 'card-sample', name: '예시 카드', issuer: '',
        billingWindow: { start: 1 }, paymentDay: 15,
        limit: null, annualFee: 0,
        performanceConditions: [],
        benefits: [],
        mainMerchants: [], guide: null
      }
    ],

    categories: [
      { id: 'cat-living', name: '생활비', cardBenefitMapping: [] },
      { id: 'cat-food', name: '외식/카페', cardBenefitMapping: [] }
    ]
  };

  JF.seed = {
    SEED_STATE: SEED_STATE
  };

})(window.JF);
