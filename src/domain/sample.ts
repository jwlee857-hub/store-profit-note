// 샘플 데이터 생성기. 연속된 두 28일 기간을 만든다.
// 수치는 규칙과 난수 시드로 생성되며, 합계·진단 결과는 화면에서 데이터로부터 계산한다.
// 플랫폼·수수료율은 가상의 예시이며 실제 서비스의 요율이 아니다.
import { computeSummary } from './calc';
import { addDays, eachDay, formatDateStr, parseDate, weekday } from './dates';
import { estimateFees, feeRuleFor } from './estimate';
import { emptyCosts, newCustomerMetric, newProblem, newSolution } from './factory';
import { presetRanges, rangesEndingAt, referenceDate } from './periods';
import { SOLUTION_TEMPLATES, defaultKpisFor } from './templates';
import {
  SCHEMA_VERSION,
  type AppData,
  type CommonCategory,
  type DateRange,
  type DateStr,
  type FeeRule,
  type Menu,
  type PeriodCost,
  type PerOrderCost,
  type SalesEntry,
} from './types';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 생성 범위: end로 끝나는 28일과 그 직전 28일 */
export function samplePeriods(end: DateStr): { prev: DateRange; cur: DateRange } {
  return rangesEndingAt(end, 28);
}

export function generateSample(end: DateStr, seed = 20261116): AppData {
  const rnd = mulberry32(seed);
  const noise = (spread: number) => 1 + (rnd() * 2 - 1) * spread;
  const r100 = (n: number) => Math.round(n / 100) * 100;
  let n = 0;
  const id = (p: string) => `${p}_s${++n}`;

  const { prev, cur } = samplePeriods(end);

  // 분석 기간 중 하루 임시 휴업 (영업일 수·요일 구성 차이 확인용)
  let closedDay = addDays(cur.start, 12);
  while (weekday(closedDay) === 0) closedDay = addDays(closedDay, 1);

  const data: AppData = {
    schemaVersion: SCHEMA_VERSION,
    mode: 'sample',
    store: {
      name: '샘플 식당 (가상)',
      channels: ['hall', 'delivery', 'takeout'],
      regularOpenDays: [1, 2, 3, 4, 5, 6],
      openTime: '11:00',
      closeTime: '21:30',
      seats: 32,
      commonCostChecklist: ['labor', 'rent', 'maintenance', 'utilities'],
      vatBasis: 'included',
    },
    platforms: [
      { id: 'plat_a', name: '배달앱 A (가상)', note: '샘플용 가상 플랫폼' },
      { id: 'plat_b', name: '배달앱 B (가상)', note: '샘플용 가상 플랫폼' },
    ],
    routes: [
      { id: 'route_hall', name: '매장 방문 주문', channels: ['hall'], platformId: null },
      { id: 'route_app_a', name: '배달앱 A', channels: ['delivery', 'takeout'], platformId: 'plat_a' },
      { id: 'route_app_b', name: '배달앱 B', channels: ['delivery'], platformId: 'plat_b' },
      { id: 'route_phone', name: '전화 주문', channels: ['takeout'], platformId: null },
    ],
    paymentMethods: [
      { id: 'pay_card', name: '카드' },
      { id: 'pay_cash', name: '현금' },
      { id: 'pay_platform', name: '플랫폼 결제' },
    ],
    feeRules: [],
    dayOverrides: [{ date: closedDay, open: false, note: '임시 휴업 (설비 점검)' }],
    menus: [],
    sales: [],
    periodCosts: [],
    customerMetrics: [],
    problems: [],
    solutions: [],
    salesChecks: [],
    perOrderCosts: [],
    foodCostRates: [],
    prefs: { lastEntry: null, customerData: 'available' },
    updatedAt: new Date().toISOString(),
  };

  const longAgo = addDays(prev.start, -90);
  const rule = (r: Partial<FeeRule> & Pick<FeeRule, 'routeId' | 'effectiveFrom'>): FeeRule => ({
    id: id('fee'),
    mode: 'separate',
    brokerageRate: null,
    brokerageBase: 'afterDiscount',
    paymentRate: null,
    paymentBase: 'net',
    bundledRate: null,
    bundledBase: 'gross',
    perOrderFee: null,
    vatExclusive: false,
    note: '샘플용 가상 요율',
    ...r,
  });
  data.feeRules = [
    rule({ routeId: 'route_hall', effectiveFrom: longAgo, paymentRate: 1.5, paymentBase: 'net' }),
    rule({ routeId: 'route_phone', effectiveFrom: longAgo, paymentRate: 1.5, paymentBase: 'net' }),
    rule({ routeId: 'route_app_a', effectiveFrom: longAgo, brokerageRate: 7, brokerageBase: 'afterDiscount', paymentRate: 3, paymentBase: 'afterDiscount', vatExclusive: true }),
    rule({
      routeId: 'route_app_a',
      effectiveFrom: cur.start,
      brokerageRate: 9,
      brokerageBase: 'afterDiscount',
      paymentRate: 3,
      paymentBase: 'afterDiscount',
      vatExclusive: true,
      note: '샘플용 가상 요율 (분석 기간부터 중개 요율 변경)',
    }),
    rule({ routeId: 'route_app_b', effectiveFrom: longAgo, mode: 'bundled', bundledRate: 11, bundledBase: 'gross', perOrderFee: 300, vatExclusive: true }),
  ];

  const mk = (name: string, h: number | null, d: number | null, t: number | null, cost: Partial<Menu['versions'][0]>, from = longAgo): Menu => ({
    id: id('menu'),
    name,
    onSale: true,
    versions: [
      {
        id: id('mv'),
        effectiveFrom: from,
        prices: { hall: h, delivery: d, takeout: t },
        costMode: 'amount',
        costAmount: null,
        costRate: null,
        costSource: 'actual',
        note: '',
        ...cost,
      },
    ],
  });
  const kimchi = mk('김치찌개', 9000, 10500, 9000, { costAmount: 3100 });
  kimchi.versions.push({
    ...kimchi.versions[0],
    id: id('mv'),
    effectiveFrom: cur.start,
    prices: { hall: 9500, delivery: 11000, takeout: 9500 },
    costAmount: 3300,
    note: '가격·원가 변경',
  });
  data.menus = [
    kimchi,
    mk('제육볶음', 10000, 11500, 10000, { costAmount: 3600 }),
    mk('된장찌개', 8500, 10000, 8500, { costAmount: 2700 }),
    mk('제육 세트(2인)', null, 26000, 24000, { costAmount: 8800 }),
    mk('계란말이', 7000, 8000, 7000, { costMode: 'rate', costRate: 30, costSource: 'estimated', note: '임시 추정 원가율' }),
    mk('공기밥', 1000, 1500, 1000, { costAmount: 350 }),
    mk('계절 반찬 정식', 11000, null, null, { costMode: 'unknown' }),
  ];
  const offMenu = mk('냉면(시즌 종료)', 9000, 10000, 9000, { costAmount: 3000 });
  offMenu.onSale = false;
  data.menus.push(offMenu);

  // 일별 매출
  const settledUntil = addDays(end, -7); // 이후는 정산 전이라 수수료를 추정값으로 저장
  const sales: SalesEntry[] = [];
  const days = eachDay({ start: prev.start, end });
  for (const d of days) {
    const wd = weekday(d);
    if (wd === 0 || d === closedDay) continue;
    const isCur = d >= cur.start;
    const wf = wd === 6 ? 1.3 : wd === 5 ? 1.15 : 1;

    const addEntry = (
      channel: SalesEntry['channel'],
      routeId: string,
      paymentMethodId: string | null,
      orders: number,
      aov: number,
      perOrderDiscount: number,
      extra: { visitors?: number; foodRate: number; deliveryPerOrder?: number; packPerOrder?: number; suppliesPerVisitor?: number },
    ) => {
      const gross = r100(orders * aov);
      const storeDiscount = orders * perOrderDiscount;
      const refund = rnd() < 0.08 ? r100(aov * 0.6) : 0;
      const e: SalesEntry = {
        id: id('sale'),
        date: d,
        channel,
        routeId,
        paymentMethodId,
        orders,
        visitors: channel === 'hall' ? extra.visitors ?? null : null,
        amountMode: 'gross',
        gross,
        netInput: null,
        storeDiscount,
        refund,
        cardSales: null,
        costs: emptyCosts(),
        bundledFee: false,
        memo: '',
      };
      e.costs.food.actual = Math.round(gross * extra.foodRate * noise(0.04));
      if (extra.deliveryPerOrder) e.costs.delivery.actual = orders * extra.deliveryPerOrder;
      if (extra.packPerOrder) e.costs.packaging.actual = orders * extra.packPerOrder;
      if (extra.suppliesPerVisitor) e.costs.hallSupplies.actual = (extra.visitors ?? 0) * extra.suppliesPerVisitor;
      const fr = feeRuleFor(data, routeId, d);
      if (fr) {
        const est = estimateFees(e, fr);
        e.bundledFee = est.bundled;
        const settled = d <= settledUntil;
        for (const [cat, v] of [
          ['brokerage', est.brokerage],
          ['payment', est.payment],
        ] as const) {
          if (v === null) continue;
          if (settled) e.costs[cat].actual = Math.round(v * noise(0.01));
          else {
            e.costs[cat].estimated = v;
            e.costs[cat].estimateBasis = est.basis;
          }
        }
      }
      sales.push(e);
    };

    // 홀: 방문 고객 감소, 객단가는 소폭 상승
    const visitors = Math.round(54 * wf * (isCur ? 0.83 : 1) * noise(0.08));
    addEntry('hall', 'route_hall', null, Math.round(visitors / 1.9), 11400 * (isCur ? 1.02 : 1) * noise(0.03) * 1.9, 0, {
      visitors,
      foodRate: 0.33,
      suppliesPerVisitor: 250,
    });
    // 배달앱 A: 주문 증가, 할인·배달비 부담 증가, 평균 주문금액 하락
    addEntry('delivery', 'route_app_a', 'pay_platform', Math.round(22 * wf * (isCur ? 1.35 : 1) * noise(0.1)), 23500 * (isCur ? 0.94 : 1) * noise(0.03), isCur ? 3000 : 1000, {
      foodRate: 0.34,
      deliveryPerOrder: isCur ? 3300 : 2400,
      packPerOrder: 700,
    });
    // 배달앱 B: 소폭 증가 (묶음 수수료)
    addEntry('delivery', 'route_app_b', 'pay_platform', Math.round(9 * wf * (isCur ? 1.15 : 1) * noise(0.12)), 24000 * (isCur ? 0.97 : 1) * noise(0.03), isCur ? 1500 : 1000, {
      foodRate: 0.34,
      deliveryPerOrder: isCur ? 3000 : 2500,
      packPerOrder: 700,
    });
    // 포장: 전화 주문 + 배달앱 A 포장 주문 증가
    addEntry('takeout', 'route_phone', 'pay_card', Math.round(10 * wf * (isCur ? 1.4 : 1) * noise(0.12)), 14500 * noise(0.04), 0, {
      foodRate: 0.33,
      packPerOrder: 400,
    });
    addEntry('takeout', 'route_app_a', 'pay_platform', Math.max(1, Math.round(3 * wf * (isCur ? 1.6 : 1) * noise(0.2))), 15500 * noise(0.04), isCur ? 1000 : 500, {
      foodRate: 0.33,
      packPerOrder: 400,
    });
  }
  data.sales = sales;

  // 기간 비용: 달력 월 단위로 등록하고 조회 기간에 달력 일수로 안분
  const periodCosts: PeriodCost[] = [];
  const firstMonth = prev.start.slice(0, 7);
  const lastMonth = end.slice(0, 7);
  let m = `${firstMonth}-01`;
  while (m.slice(0, 7) <= lastMonth) {
    const dt = new Date(parseDate(m));
    const monthEnd = formatDateStr(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
    const later = m.slice(0, 7) >= cur.start.slice(0, 7);
    const isLast = m.slice(0, 7) === lastMonth;
    const add = (category: PeriodCost['category'], attribution: PeriodCost['attribution'], nature: PeriodCost['nature'], amount: number, source: PeriodCost['source'] = 'actual', memo = '') =>
      periodCosts.push({ id: id('pc'), category, attribution, nature, start: m, end: monthEnd, amount, source, memo });
    const commons: [CommonCategory, PeriodCost['nature'], number][] = [
      ['labor', 'mixed', later ? 10_200_000 : 9_800_000],
      ['rent', 'fixed', 2_500_000],
      ['maintenance', 'fixed', 300_000],
      ['rental', 'fixed', 120_000],
      ['insurance', 'fixed', 90_000],
      ['commonAd', 'fixed', 200_000],
      ['depreciation', 'fixed', 400_000],
    ];
    for (const [cat, nat, amt] of commons) add(cat, 'common', nat, amt);
    add('utilities', 'common', 'mixed', isLast ? 700_000 : 650_000, isLast ? 'estimated' : 'actual', isLast ? '고지서 도착 전 추정' : '');
    add('channelAd', 'delivery', 'fixed', later ? 600_000 : 300_000, 'actual', '배달앱 광고 상품');
    m = addDays(monthEnd, 1);
  }
  data.periodCosts = periodCosts;

  // 주문 1건당 기본 비용 (빠른 입력 때 추정값으로 채움). 생성한 실적과 비슷한 수준의 가상 값
  const poc = (channel: SalesEntry['channel'], routeId: string | null, category: PerOrderCost['category'], amount: number): PerOrderCost => ({
    id: id('poc'),
    channel,
    routeId,
    category,
    amount,
    effectiveFrom: longAgo,
  });
  data.perOrderCosts = [
    poc('hall', null, 'hallSupplies', 480),
    poc('delivery', 'route_app_a', 'delivery', 3300),
    poc('delivery', 'route_app_b', 'delivery', 3000),
    poc('delivery', null, 'packaging', 700),
    poc('takeout', null, 'packaging', 400),
  ];

  // 문제·해결안·고객 집계 기간은 화면과 같은 기준일(가장 최근 매출 입력일)로 맞춘다.
  // 생성 마지막 날이 정기 휴무일(일요일)이면 기준일은 그 전 영업일이 된다.
  // 홈 '최근 4주'·새 문제 등록과 같은 함수로 기간을 계산한다
  const ref = referenceDate(data);
  const view = presetRanges('recent28', ref, ref);

  // 고객 집계(선택 입력 예시)
  data.customerMetrics = [
    newCustomerMetric({
      id: id('cust'),
      label: '배달앱 A 비교 기간',
      channel: 'delivery',
      periodStart: view.prev.start,
      periodEnd: view.prev.end,
      newCustomers: 280,
      newOrders: 296,
      newSales: 6_700_000,
      existingCustomers: 170,
      existingOrders: 250,
      existingSales: 5_800_000,
      cohortStart: view.prev.start,
      cohortEnd: addDays(view.prev.start, 13),
      observationDate: ref,
      observedCustomers: 140,
      repurchased30: 32,
      source: '배달앱 A 사장님 통계 화면 (가상)',
      memo: '플랫폼 통계 화면의 집계값을 옮겨 적은 예시',
    }),
    newCustomerMetric({
      id: id('cust'),
      label: '배달앱 A 분석 기간',
      channel: 'delivery',
      periodStart: view.cur.start,
      periodEnd: view.cur.end,
      newCustomers: 430,
      newOrders: 452,
      newSales: 9_300_000,
      existingCustomers: 185,
      existingOrders: 268,
      existingSales: 5_700_000,
      cohortStart: view.cur.start,
      cohortEnd: addDays(view.cur.start, 13),
      observationDate: ref,
      observedCustomers: 210,
      repurchased30: 31,
      source: '배달앱 A 사장님 통계 화면 (가상)',
      platformRepeatRate: 24,
      platformRepeatDefinition: '플랫폼 안내: 최근 3개월 내 2회 이상 주문한 고객 비율 (가상 예시)',
      memo: '관찰 기간이 끝나지 않은 집단',
    }),
  ];

  // 문제·해결안 예시 (목표값은 비교 기간 실적에서 계산)
  const prevSummary = computeSummary(data, view.prev);
  const problem = newProblem({
    id: id('prob'),
    name: '최근 28일 영업이익 점검',
    type: 'profitDecline',
    analysis: view.cur,
    compare: view.prev,
    channel: 'all',
    target: { key: 'operatingProfit', channel: 'all' },
    targetValue: prevSummary.operatingProfit.value !== null ? Math.round(prevSummary.operatingProfit.value / 10000) * 10000 : null,
    memo: '목표: 비교 기간 영업이익 수준 회복',
    createdAt: new Date(parseDate(ref)).toISOString(),
  });
  data.problems = [problem];

  const tpl = (tid: string) => SOLUTION_TEMPLATES.find((t) => t.id === tid)!;
  const t1 = tpl('delivery-discount');
  const t2 = tpl('takeout-pickup');
  const midCur = addDays(view.cur.start, 14);
  // 포장 계획 목표: 실행 전 2주 포장 주문 수보다 약 10% 많게(10건 단위 올림) — 실행 전 실적보다 낮은 목표가 되지 않도록 계산
  const takeoutBefore = { start: view.cur.start, end: addDays(midCur, -1) };
  const takeoutBeforeOrders = computeSummary(data, takeoutBefore).channels.takeout.orders ?? 0;
  const takeoutTarget = Math.ceil((takeoutBeforeOrders * 1.1) / 10) * 10;
  data.solutions = [
    newSolution({
      id: id('sol'),
      problemId: problem.id,
      name: t1.name,
      target: t1.target,
      direction: t1.direction,
      hypothesis: t1.hypothesis,
      evidence: '진단 화면의 배달 주문 1건당 남는 금액 변화와 할인 비율 변화 참고',
      actions: t1.actions,
      owner: '점장',
      start: addDays(ref, 1),
      end: addDays(ref, 28),
      budget: 0,
      expectedRevenueChange: -400_000,
      expectedCostChange: -1_000_000,
      budgetIncludedInCost: true,
      // 배달 대상: 1건당 남는 금액·배달에서 남은 금액·가게 전체 영업이익을 함께 본다
      ...defaultKpisFor('delivery', { key: 'directProfit', channel: 'delivery' }),
      coupon: { amount: 3000, minOrder: 15000, routeId: 'route_app_a', previousAmount: 1000, usedCount: null },
      kpiTarget: null,
      successCriteria: t1.successCriteria,
      stopCriteria: t1.stopCriteria,
      status: 'planned',
      templateId: t1.id,
    }),
    newSolution({
      id: id('sol'),
      problemId: problem.id,
      name: t2.name,
      target: t2.target,
      direction: t2.direction,
      hypothesis: t2.hypothesis,
      evidence: '포장 주문 수 증가 추세',
      actions: t2.actions,
      owner: '홀 매니저',
      start: midCur,
      end: ref,
      budget: 150_000,
      expectedRevenueChange: 800_000,
      expectedCostChange: 350_000,
      budgetIncludedInCost: true,
      kpi: { key: 'orders', channel: 'takeout' },
      kpiTarget: takeoutTarget,
      kpiTargetMode: 'total',
      successCriteria: t2.successCriteria,
      stopCriteria: t2.stopCriteria,
      status: 'reviewPending',
      templateId: t2.id,
      review: {
        before: takeoutBefore,
        after: { start: midCur, end: ref },
        decision: null,
        judgment: '',
        externalFactors: '',
        reviewedAt: null,
        nextCouponAmount: null,
      },
    }),
  ];

  return data;
}
