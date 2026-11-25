// 샘플 데이터 생성기. 수치는 규칙과 난수 시드로 생성되며, 합계·진단 결과는 화면에서 데이터로부터 계산한다.
// 플랫폼·수수료율은 가상의 예시이며 실제 서비스의 요율이 아니다.
// - storySample(): 앱의 '샘플로 시작'. 2026년 8~11월 배달앱 A 쿠폰 이야기(1,000 → 3,000 → 2,000 → 2,500원), 기준일 2026-11-23 고정
// - generateSample(end): 연속된 두 28일 기간(테스트용 고정 데이터). 같은 생성 규칙·시드를 쓴다
import { computeSummary, netSales } from './calc';
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
  type DayOverride,
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

/**
 * 하루의 판매 조건. 기본 수준(홀 54명·배달앱 A 22건 등)에 곱하는 배수와 가게 부담 할인.
 * 가게 부담 할인 = round(주문 수 × 쿠폰 사용 비율) × 쿠폰 금액 (쿠폰 액면가와 실제 부담 총액을 구분)
 */
interface Regime {
  hallV: number;
  hallT: number;
  aQ: number;
  aP: number;
  aCoupon: number;
  aUsage: number;
  aDel: number;
  bQ: number;
  bP: number;
  bDisc: number;
  bDel: number;
  phQ: number;
  taQ: number;
  taDisc: number;
  /** 홀 기록 메모 (예: 근처 행사) */
  hallMemo?: string;
}

interface Plan {
  start: DateStr;
  end: DateStr;
  closed: DayOverride[];
  /** 이 날까지는 정산을 마쳐 수수료가 실제 금액, 이후는 설정 요율 계산값 */
  settledUntil: DateStr;
  /** 메뉴 가격·원가 변경일 */
  menuChange: DateStr;
  /** 배달앱 A 중개 요율이 7% → 9%로 바뀌는 날 (없으면 null) */
  feeChange: DateStr | null;
  /** 인건비·배달 광고비가 오른 달부터 true */
  later: (month: string) => boolean;
  regime: (d: DateStr) => Regime;
  /** true면 마지막 달 공과금은 고지서 전이라 추정값 */
  lastUtilitiesEstimated: boolean;
}

/** 가게·경로·메뉴·수수료·일별 매출·기간 비용·건당 비용 (문제·계획·고객 지표 제외) */
function buildBase(plan: Plan, seed: number) {
  const rnd = mulberry32(seed);
  const noise = (spread: number) => 1 + (rnd() * 2 - 1) * spread;
  const r100 = (n: number) => Math.round(n / 100) * 100;
  let n = 0;
  const id = (p: string) => `${p}_s${++n}`;
  const closedSet = new Set(plan.closed.map((c) => c.date));

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
    dayOverrides: plan.closed,
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

  const longAgo = addDays(plan.start, -90);
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
    ...(plan.feeChange
      ? [
          rule({
            routeId: 'route_app_a',
            effectiveFrom: plan.feeChange,
            brokerageRate: 9,
            brokerageBase: 'afterDiscount',
            paymentRate: 3,
            paymentBase: 'afterDiscount',
            vatExclusive: true,
            note: '샘플용 가상 요율 (분석 기간부터 중개 요율 변경)',
          }),
        ]
      : []),
    rule({ routeId: 'route_app_b', effectiveFrom: longAgo, mode: 'bundled', bundledRate: 11, bundledBase: 'gross', perOrderFee: 300, vatExclusive: true }),
  ];
  // 이전 생성기와 같은 id 순서를 유지한다 (요율 변경이 없으면 번호 하나를 건너뜀)
  if (!plan.feeChange) n++;

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
    effectiveFrom: plan.menuChange,
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

  // 일별 매출 (판매 방식·경로별 원천 기록)
  const sales: SalesEntry[] = [];
  for (const d of eachDay({ start: plan.start, end: plan.end })) {
    const wd = weekday(d);
    if (wd === 0 || closedSet.has(d)) continue;
    const g = plan.regime(d);
    const wf = wd === 6 ? 1.3 : wd === 5 ? 1.15 : 1;

    const addEntry = (
      channel: SalesEntry['channel'],
      routeId: string,
      paymentMethodId: string | null,
      orders: number,
      aov: number,
      coupon: number,
      usage: number,
      extra: { visitors?: number; foodRate: number; deliveryPerOrder?: number; packPerOrder?: number; suppliesPerVisitor?: number; memo?: string },
    ) => {
      const gross = r100(orders * aov);
      const storeDiscount = Math.round(orders * usage) * coupon;
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
        memo: extra.memo ?? '',
      };
      e.costs.food.actual = Math.round(gross * extra.foodRate * noise(0.04));
      if (extra.deliveryPerOrder) e.costs.delivery.actual = orders * extra.deliveryPerOrder;
      if (extra.packPerOrder) e.costs.packaging.actual = orders * extra.packPerOrder;
      if (extra.suppliesPerVisitor) e.costs.hallSupplies.actual = (extra.visitors ?? 0) * extra.suppliesPerVisitor;
      const fr = feeRuleFor(data, routeId, d);
      if (fr) {
        const est = estimateFees(e, fr);
        e.bundledFee = est.bundled;
        const settled = d <= plan.settledUntil;
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

    const visitors = Math.round(54 * wf * g.hallV * noise(0.08));
    addEntry('hall', 'route_hall', null, Math.round(visitors / 1.9), 11400 * g.hallT * noise(0.03) * 1.9, 0, 1, {
      visitors,
      foodRate: 0.33,
      suppliesPerVisitor: 250,
      memo: g.hallMemo,
    });
    addEntry('delivery', 'route_app_a', 'pay_platform', Math.round(22 * wf * g.aQ * noise(0.1)), 23500 * g.aP * noise(0.03), g.aCoupon, g.aUsage, {
      foodRate: 0.34,
      deliveryPerOrder: g.aDel,
      packPerOrder: 700,
    });
    addEntry('delivery', 'route_app_b', 'pay_platform', Math.round(9 * wf * g.bQ * noise(0.12)), 24000 * g.bP * noise(0.03), g.bDisc, 1, {
      foodRate: 0.34,
      deliveryPerOrder: g.bDel,
      packPerOrder: 700,
    });
    addEntry('takeout', 'route_phone', 'pay_card', Math.round(10 * wf * g.phQ * noise(0.12)), 14500 * noise(0.04), 0, 1, {
      foodRate: 0.33,
      packPerOrder: 400,
    });
    // 배달앱 A를 통한 포장 주문 (같은 경로, 판매 방식은 포장)
    addEntry('takeout', 'route_app_a', 'pay_platform', Math.max(1, Math.round(3 * wf * g.taQ * noise(0.2))), 15500 * noise(0.04), g.taDisc, 1, {
      foodRate: 0.33,
      packPerOrder: 400,
    });
  }
  data.sales = sales;

  // 기간 비용: 달력 월 단위로 등록하고 조회 기간에 달력 일수로 안분
  const periodCosts: PeriodCost[] = [];
  const lastMonth = plan.end.slice(0, 7);
  let m = `${plan.start.slice(0, 7)}-01`;
  while (m.slice(0, 7) <= lastMonth) {
    const dt = new Date(parseDate(m));
    const monthEnd = formatDateStr(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
    const later = plan.later(m.slice(0, 7));
    const estUtil = plan.lastUtilitiesEstimated && m.slice(0, 7) === lastMonth;
    const add = (category: PeriodCost['category'], attribution: PeriodCost['attribution'], nature: PeriodCost['nature'], amount: number, source: PeriodCost['source'] = 'actual', memo = '') =>
      periodCosts.push({ id: id('pc'), category, attribution, nature, start: m, end: monthEnd, amount, source, memo });
    const commons: [CommonCategory, PeriodCost['nature'], number, string?][] = [
      ['labor', 'mixed', later ? 10_200_000 : 9_800_000, later ? '시급 인상으로 월 980만 → 1,020만 원 (샘플 가상 사건)' : ''],
      ['rent', 'fixed', 2_500_000],
      ['maintenance', 'fixed', 300_000],
      ['rental', 'fixed', 120_000],
      ['insurance', 'fixed', 90_000],
      ['commonAd', 'fixed', 200_000],
      ['depreciation', 'fixed', 400_000],
    ];
    for (const [cat, nat, amt, memo] of commons) add(cat, 'common', nat, amt, 'actual', memo);
    // 고지서 전 달은 지난달까지의 실제 금액(매달 650,000원)과 같다고 추정
    add('utilities', 'common', 'mixed', 650_000, estUtil ? 'estimated' : 'actual', estUtil ? '고지서 도착 전 · 지난달까지 실제 금액(650,000원)으로 추정' : '');
    add('channelAd', 'delivery', 'fixed', later ? 600_000 : 300_000, 'actual', later ? '배달앱 광고 상품 변경: 월 30만 → 60만 원 (샘플 가상 사건)' : '배달앱 광고 상품');
    m = addDays(monthEnd, 1);
  }
  data.periodCosts = periodCosts;

  // 주문 1건당 기본 비용 (빠른 입력 때 추정값으로 채움). 마지막 날 생성 규칙과 같은 값 (홀 소모품: 방문객당 250원 × 1건당 1.9명 ≈ 480원)
  const last = plan.regime(plan.end);
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
    poc('delivery', 'route_app_a', 'delivery', last.aDel),
    poc('delivery', 'route_app_b', 'delivery', last.bDel),
    poc('delivery', null, 'packaging', 700),
    poc('takeout', null, 'packaging', 400),
  ];
  return { data, id };
}

export function generateSample(end: DateStr, seed = 20261116): AppData {
  const { prev, cur } = samplePeriods(end);
  // 분석 기간 중 하루 임시 휴업 (영업일 수·요일 구성 차이 확인용)
  let closedDay = addDays(cur.start, 12);
  while (weekday(closedDay) === 0) closedDay = addDays(closedDay, 1);
  const before: Regime = { hallV: 1, hallT: 1, aQ: 1, aP: 1, aCoupon: 1000, aUsage: 1, aDel: 2400, bQ: 1, bP: 1, bDisc: 1000, bDel: 2500, phQ: 1, taQ: 1, taDisc: 500 };
  // 홀: 방문 고객 감소·객단가 소폭 상승 / 배달앱 A: 주문 증가, 할인·배달비 부담 증가, 평균 주문금액 하락 / 배달앱 B: 소폭 증가 / 포장 증가
  const after: Regime = { hallV: 0.83, hallT: 1.02, aQ: 1.35, aP: 0.94, aCoupon: 3000, aUsage: 1, aDel: 3300, bQ: 1.15, bP: 0.97, bDisc: 1500, bDel: 3000, phQ: 1.4, taQ: 1.6, taDisc: 1000 };
  const { data, id } = buildBase(
    {
      start: prev.start,
      end,
      closed: [{ date: closedDay, open: false, note: '임시 휴업 (설비 점검)' }],
      settledUntil: addDays(end, -7), // 이후는 정산 전이라 수수료를 추정값으로 저장
      menuChange: cur.start,
      feeChange: cur.start,
      later: (month) => month >= cur.start.slice(0, 7),
      regime: (d) => (d >= cur.start ? after : before),
      lastUtilitiesEstimated: true,
    },
    seed,
  );

  // 문제·해결안·고객 집계 기간은 화면과 같은 기준일(가장 최근 매출 입력일)로 맞춘다.
  // 생성 마지막 날이 정기 휴무일(일요일)이면 기준일은 그 전 영업일이 된다.
  // 홈 '최근 4주'·새 문제 등록과 같은 함수로 기간을 계산한다
  const ref = referenceDate(data);
  const view = presetRanges('recent28', ref, ref);

  // 고객 집계(선택 입력 예시)
  data.customerMetrics = customerExamples(data, id, view.prev, view.cur, ref);

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

  const t1 = tpl('delivery-discount');
  const midCur = addDays(view.cur.start, 14);
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
    takeoutPlan(data, id, problem.id, { start: view.cur.start, end: addDays(midCur, -1) }, { start: midCur, end: ref }),
  ];

  return data;
}

const tpl = (tid: string) => SOLUTION_TEMPLATES.find((t) => t.id === tid)!;

/**
 * 고객 집계 예시. 주문 수·매출 합계는 그 기간 배달앱 A 배달 기록에서 계산해 매출 기록과 맞춘다.
 * 플랫폼 통계에서만 알 수 있는 값(신규 비중, 고객 1명당 주문, 30일 재구매 비율)만 가상 예시 비율이다.
 */
function customerExamples(data: AppData, id: (p: string) => string, prev: DateRange, cur: DateRange, observationDate: DateStr) {
  const split = (r: DateRange, newShare: number, repurchase: number) => {
    const es = data.sales.filter((e) => e.routeId === 'route_app_a' && e.channel === 'delivery' && e.date >= r.start && e.date <= r.end);
    const orders = es.reduce((s, e) => s + (e.orders ?? 0), 0);
    const sales = es.reduce((s, e) => s + (netSales(e) ?? 0), 0);
    const newOrders = Math.round(orders * newShare);
    const newSales = Math.round(sales * newShare);
    const newCustomers = Math.round(newOrders * 0.95);
    // 첫 구매 집단 = 기간 첫 14일의 신규 고객
    const observedCustomers = Math.round((newCustomers * 14) / eachDay(r).length);
    return {
      channel: 'delivery' as const,
      periodStart: r.start,
      periodEnd: r.end,
      newCustomers,
      newOrders,
      newSales,
      existingCustomers: Math.round((orders - newOrders) * 0.68),
      existingOrders: orders - newOrders,
      existingSales: sales - newSales,
      cohortStart: r.start,
      cohortEnd: addDays(r.start, 13),
      observationDate,
      observedCustomers,
      repurchased30: Math.round(observedCustomers * repurchase),
    };
  };
  return [
    newCustomerMetric({
      id: id('cust'),
      label: '배달앱 A 비교 기간',
      ...split(prev, 0.54, 0.23),
      source: '배달앱 A 사장님 통계 화면 (가상)',
      memo: '플랫폼 통계 화면의 집계값을 옮겨 적은 예시',
    }),
    newCustomerMetric({
      id: id('cust'),
      label: '배달앱 A 분석 기간',
      ...split(cur, 0.62, 0.15),
      source: '배달앱 A 사장님 통계 화면 (가상)',
      platformRepeatRate: 24,
      platformRepeatDefinition: '플랫폼 안내: 최근 3개월 내 2회 이상 주문한 고객 비율 (가상 예시)',
      memo: '관찰 기간이 끝나지 않은 집단',
    }),
  ];
}

/** '포장 주문과 픽업 개선' (검증 대기). 목표: 실행 전 포장 주문 수보다 약 10% 많게(10건 단위 올림) — 실행 전 실적보다 낮은 목표가 되지 않도록 계산 */
function takeoutPlan(data: AppData, id: (p: string) => string, problemId: string | null, before: DateRange, after: DateRange) {
  const t2 = tpl('takeout-pickup');
  const beforeOrders = computeSummary(data, before).channels.takeout.orders ?? 0;
  return newSolution({
    id: id('sol'),
    problemId,
    name: t2.name,
    target: t2.target,
    direction: t2.direction,
    hypothesis: t2.hypothesis,
    evidence: '포장 주문 수 증가 추세',
    actions: t2.actions,
    owner: '홀 매니저',
    start: after.start,
    end: after.end,
    // 근거로 삼을 자료가 없어 예산·예상 효과는 비워 둔다 (미입력)
    budget: null,
    expectedRevenueChange: null,
    expectedCostChange: null,
    budgetIncludedInCost: true,
    kpi: { key: 'orders', channel: 'takeout' },
    kpiTarget: Math.ceil((beforeOrders * 1.1) / 10) * 10,
    kpiTargetMode: 'total',
    successCriteria: t2.successCriteria,
    stopCriteria: t2.stopCriteria,
    status: 'reviewPending',
    templateId: t2.id,
    review: { before, after, decision: null, judgment: '', externalFactors: '', reviewedAt: null, nextCouponAmount: null },
  });
}

// ───────────────────────── 앱 내장 샘플: 2026년 8~11월 쿠폰 이야기 ─────────────────────────

/** 샘플의 '오늘' — 11월 22일까지 마감, 이후는 미입력 */
export const STORY_TODAY = '2026-11-23';
export const STORY = {
  aug: { start: '2026-08-01', end: '2026-08-31' },
  sep: { start: '2026-09-01', end: '2026-09-30' },
  oct: { start: '2026-10-01', end: '2026-10-31' },
  nov: { start: '2026-11-01', end: '2026-11-30' },
  /** 10월 근처 행사(홀 손님 증가) */
  event: { start: '2026-10-15', end: '2026-10-17' },
} as const;
const EVENT_MEMO = '근처 가을 축제로 홀 손님 증가';

/**
 * 8월 쿠폰 1,000원(기준) → 9월 3,000원(주문↑·건당↓, 문제 진단) → 10월 2,000원(실행·판단 완료) → 11월 2,500원(재시험 실행 중).
 * 9월 25일 추석 휴무, 10월 15~17일 근처 행사로 홀 손님 증가. 9·10월은 정산 완료(수수료 실제 금액), 11월 16일 이후는 정산 전.
 */
export function storySample(seed = 20261116): AppData {
  const month = (d: DateStr) => d.slice(0, 7);
  const base: Regime = { hallV: 1, hallT: 1, aQ: 1, aP: 1, aCoupon: 1000, aUsage: 0.82, aDel: 3100, bQ: 1, bP: 1, bDisc: 1000, bDel: 2700, phQ: 1, taQ: 1, taDisc: 500 };
  const byMonth: Record<string, Partial<Regime>> = {
    '2026-08': {},
    // 쿠폰 3,000원: 주문은 늘고 평균 주문금액은 낮아짐
    '2026-09': { hallV: 0.93, hallT: 1.01, aQ: 1.35, aP: 0.94, aCoupon: 3000, bQ: 1.08, bP: 0.98, bDisc: 1500, phQ: 1.2, taQ: 1.3, taDisc: 1000 },
    // 쿠폰 2,000원 (최소 주문 15,000원 유지): 주문이 줄고 건당 남는 돈은 회복
    '2026-10': { hallV: 0.93, hallT: 1.01, aQ: 1.04, aP: 0.96, aCoupon: 2000, bQ: 1.12, bP: 0.98, bDisc: 1500, phQ: 1.3, taQ: 1.45, taDisc: 1000 },
    // 쿠폰 2,500원 재시험
    '2026-11': { hallV: 0.92, hallT: 1.02, aQ: 1.18, aP: 0.95, aCoupon: 2500, bQ: 1.15, bP: 0.97, bDisc: 1500, phQ: 1.4, taQ: 1.6, taDisc: 1000 },
  };
  const { data, id } = buildBase(
    {
      start: STORY.aug.start,
      end: addDays(STORY_TODAY, -1),
      closed: [{ date: '2026-09-25', open: false, note: '추석 연휴 휴무' }],
      settledUntil: '2026-11-15',
      menuChange: STORY.sep.start,
      feeChange: null,
      later: (m) => m >= '2026-09',
      regime: (d) => {
        const r = { ...base, ...byMonth[month(d)] };
        return d >= STORY.event.start && d <= STORY.event.end ? { ...r, hallV: r.hallV * 1.8, hallMemo: EVENT_MEMO } : r;
      },
      lastUtilitiesEstimated: true,
    },
    seed,
  );
  data.sampleToday = STORY_TODAY;
  data.customerMetrics = customerExamples(data, id, STORY.aug, STORY.sep, '2026-10-31');

  // 9월 문제 진단: 8월(비교) 대 9월(분석)
  const augPerOrder = computeSummary(data, STORY.aug).channels.delivery.directProfitPerOrder.value;
  const problem = newProblem({
    id: id('prob'),
    name: '9월 배달 수익성 점검',
    type: 'profitDecline',
    analysis: STORY.sep,
    compare: STORY.aug,
    channel: 'delivery',
    target: { key: 'directProfitPerOrder', channel: 'delivery' },
    targetValue: augPerOrder !== null ? Math.round(augPerOrder / 100) * 100 : null,
    memo: '배달앱 A 쿠폰을 1,000원에서 3,000원으로 올린 뒤 주문은 늘었지만 배달 한 건당 남는 돈이 줄었다. 목표: 8월 수준 회복',
    createdAt: '2026-09-30T12:00:00.000Z',
  });
  data.problems = [problem];

  const t1 = tpl('delivery-discount');
  const deliveryKpis = defaultKpisFor('delivery', { key: 'directProfit', channel: 'delivery' });
  // 예상 효과: 9월 쿠폰 사용 건수가 10월에도 같다고 가정하면, 쿠폰 1,000원 인하만큼 할인 차감이 줄어 순매출이 늘고
  // 할인 후 금액에 붙는 배달앱 A 수수료(중개+결제, 부가세 별도)가 그만큼 는다. 주문 수 변화는 미리 알 수 없어 넣지 않는다
  const sepUsed = data.sales
    .filter((e) => e.routeId === 'route_app_a' && e.channel === 'delivery' && e.date >= STORY.sep.start && e.date <= STORY.sep.end)
    .reduce((s, e) => s + (e.storeDiscount ?? 0) / 3000, 0);
  const feeA = feeRuleFor(data, 'route_app_a', STORY.oct.start)!;
  const feeRate = (((feeA.brokerageRate ?? 0) + (feeA.paymentRate ?? 0)) / 100) * (feeA.vatExclusive ? 1.1 : 1);
  const expRevenue = Math.round((sepUsed * 1000) / 1000) * 1000;
  const expCost = Math.round((expRevenue * feeRate) / 1000) * 1000;
  // 9월에 제안해 10월에 실행을 마친 바로 그 계획 (성과 비교: 9월 대 10월로 저장)
  const october = newSolution({
    id: id('sol'),
    problemId: problem.id,
    name: t1.name,
    target: t1.target,
    direction: t1.direction,
    hypothesis: t1.hypothesis,
    evidence: `9월 문제 진단: 배달 주문 1건당 남는 금액 감소와 가게 부담 할인 비율 상승 (8월 대비). 예상 효과: 9월 쿠폰 사용 ${Math.round(sepUsed).toLocaleString('ko-KR')}건이 그대로라면 할인 차감이 건당 1,000원 줄어 매출 +${expRevenue.toLocaleString('ko-KR')}원, 할인 후 금액에 붙는 수수료 ${Math.round(feeRate * 1000) / 10}%만큼 비용 +${expCost.toLocaleString('ko-KR')}원. 주문 수가 줄면 이보다 작아진다.`,
    actions: '배달앱 A 쿠폰 3,000원 → 2,000원으로 낮추고 최소 주문금액 15,000원은 그대로 둔다. 10월 한 달 실행 후 정산서로 수수료를 확인한다.',
    owner: '점장',
    start: STORY.oct.start,
    end: STORY.oct.end,
    budget: 0,
    expectedRevenueChange: expRevenue,
    expectedCostChange: expCost,
    budgetIncludedInCost: true,
    ...deliveryKpis,
    coupon: { amount: 2000, minOrder: 15000, routeId: 'route_app_a', previousAmount: 3000, usedCount: null },
    kpiTarget: null,
    successCriteria: t1.successCriteria,
    stopCriteria: t1.stopCriteria,
    status: 'done',
    templateId: t1.id,
    createdAt: '2026-09-30T12:30:00.000Z',
    review: {
      before: STORY.sep,
      after: STORY.oct,
      decision: 'revise',
      judgment: '쿠폰을 줄이니 한 건에서는 더 남았지만, 주문이 줄어서 배달앱 A에서 한 달 동안 남긴 돈은 오히려 줄었다. 다음 달에는 2,500원으로 시험해 보자.',
      externalFactors: '근처 행사 기간(10월 15~17일)에 홀 손님이 늘었다. 가게 전체 이익이 오른 데에는 홀 실적 영향도 있다.',
      reviewedAt: '2026-11-03T12:00:00.000Z',
      nextCouponAmount: 2500,
    },
  });
  // 10월 판단을 이어받은 11월 재시험 (실행 중, 11월 22일까지 기록)
  const november = newSolution({
    id: id('sol'),
    problemId: problem.id,
    name: '배달앱 A 쿠폰 2,500원 재시험',
    target: 'delivery',
    direction: t1.direction,
    hypothesis: '쿠폰을 2,000원과 3,000원 사이로 두면 주문 감소를 줄이면서 한 건당 남는 돈도 지킬 수 있다(확인 필요).',
    evidence: '10월 ‘배달 할인 효율 검토’ 결과 판단(수정 후 재시험)에서 이어짐',
    actions: '배달앱 A 쿠폰 2,000원 → 2,500원, 최소 주문금액 15,000원 유지. 11월 한 달 실행.',
    owner: '점장',
    start: STORY.nov.start,
    end: STORY.nov.end,
    budget: 0,
    ...deliveryKpis,
    coupon: { amount: 2500, minOrder: 15000, routeId: 'route_app_a', previousAmount: 2000, usedCount: null },
    kpiTarget: null,
    successCriteria: t1.successCriteria,
    stopCriteria: t1.stopCriteria,
    status: 'running',
    templateId: t1.id,
    createdAt: '2026-11-03T12:10:00.000Z',
    retestOf: october.id,
  });
  data.solutions = [october, november, takeoutPlan(data, id, null, { start: '2026-10-19', end: '2026-11-01' }, { start: '2026-11-02', end: '2026-11-15' })];
  return data;
}
