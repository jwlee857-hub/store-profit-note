import { addDays, todayStr } from './dates';
import {
  DIRECT_CATEGORIES,
  SCHEMA_VERSION,
  type AppData,
  type AppPrefs,
  type Channel,
  type CostValue,
  type CustomerMetric,
  type DateStr,
  type DirectCategory,
  type Problem,
  type SalesEntry,
  type Solution,
  type StoreSettings,
  type CouponTerms,
} from './types';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export const emptyCost = (): CostValue => ({ actual: null, estimated: null, estimateBasis: '' });

export function emptyCosts(): Record<DirectCategory, CostValue> {
  const o = {} as Record<DirectCategory, CostValue>;
  for (const c of DIRECT_CATEGORIES) o[c] = emptyCost();
  return o;
}

export function emptyData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: 'user',
    store: null,
    platforms: [],
    routes: [],
    paymentMethods: [],
    feeRules: [],
    dayOverrides: [],
    menus: [],
    sales: [],
    periodCosts: [],
    customerMetrics: [],
    problems: [],
    solutions: [],
    salesChecks: [],
    perOrderCosts: [],
    foodCostRates: [],
    prefs: defaultPrefs(),
    updatedAt: new Date().toISOString(),
  };
}

export function defaultPrefs(): AppPrefs {
  return { lastEntry: null, customerData: 'unasked' };
}

export function defaultStore(name: string): StoreSettings {
  return {
    name,
    channels: ['hall'],
    regularOpenDays: [1, 2, 3, 4, 5, 6],
    openTime: '11:00',
    closeTime: '21:00',
    seats: null,
    commonCostChecklist: ['labor', 'rent'],
    vatBasis: 'included',
  };
}

/** 가게 등록 때 입력한 배달앱 한 곳. 수수료율은 모르면 비워 둔다(null = 나중에 설정) */
export interface DeliveryAppInput {
  name: string;
  brokerageRate: number | null;
  paymentRate: number | null;
  vatExclusive: boolean;
}

export interface RegisterInput {
  name: string;
  channels: Channel[];
  regularOpenDays: number[];
  /** 배달 판매 시 사용하는 배달앱 (이름이 빈 항목은 무시) */
  deliveryApps?: DeliveryAppInput[];
  /** 배달앱 없이 직접 배달(전화 주문 등)도 하는가 */
  directDelivery?: boolean;
  /** 수수료 규칙 적용 시작일 계산 기준 (기본 오늘) */
  today?: DateStr;
}

/**
 * 가게 등록 데이터. 판매 방식마다 매출을 넣을 기본 주문 경로를 하나 이상 만든다.
 * - 홀: 매장 방문 주문 / 포장: 매장 포장 주문
 * - 배달: 배달앱마다 플랫폼 + 배달 주문 경로(수수료율을 입력했으면 수수료 자동 계산 설정도). 직접 배달을 고르면 플랫폼 없는 경로.
 *   배달앱도 직접 배달도 없으면 '배달 주문' 경로를 만들어 배달 매출을 바로 넣을 수 있게 한다(배달앱은 나중에 연결).
 */
export function registerStoreData(input: RegisterInput): AppData {
  const d = emptyData();
  const today = input.today ?? todayStr();
  d.store = { ...defaultStore(input.name.trim()), channels: input.channels, regularOpenDays: input.regularOpenDays };
  d.paymentMethods = [
    { id: 'pay_card', name: '카드' },
    { id: 'pay_cash', name: '현금' },
  ];
  if (input.channels.includes('hall')) d.routes.push({ id: 'route_hall', name: '매장 방문 주문', channels: ['hall'], platformId: null });
  if (input.channels.includes('delivery')) {
    const apps = (input.deliveryApps ?? []).filter((a) => a.name.trim());
    if (apps.length) d.paymentMethods.push({ id: 'pay_platform', name: '플랫폼 결제' });
    for (const a of apps) {
      const platformId = uid('plat');
      const routeId = uid('route');
      d.platforms.push({ id: platformId, name: a.name.trim(), note: '' });
      d.routes.push({ id: routeId, name: a.name.trim(), channels: ['delivery'], platformId });
      if (a.brokerageRate !== null || a.paymentRate !== null)
        d.feeRules.push({
          id: uid('fee'),
          routeId,
          // 등록 전 날짜의 매출을 나중에 입력해도 적용되도록 1년 전부터
          effectiveFrom: addDays(today, -365),
          mode: 'separate',
          brokerageRate: a.brokerageRate,
          brokerageBase: 'net',
          paymentRate: a.paymentRate,
          paymentBase: 'net',
          bundledRate: null,
          bundledBase: 'net',
          perOrderFee: null,
          vatExclusive: a.vatExclusive,
          note: '가게 등록 때 입력한 요율',
        });
    }
    if (input.directDelivery || !apps.length)
      d.routes.push({ id: 'route_delivery', name: apps.length || input.directDelivery ? '직접 배달 주문' : '배달 주문', channels: ['delivery'], platformId: null });
  }
  if (input.channels.includes('takeout')) d.routes.push({ id: 'route_takeout', name: '매장 포장 주문', channels: ['takeout'], platformId: null });
  return d;
}

export function newSalesEntry(partial: Partial<SalesEntry> = {}): SalesEntry {
  return {
    id: uid('sale'),
    date: todayStr(),
    channel: 'hall',
    routeId: '',
    paymentMethodId: null,
    orders: null,
    visitors: null,
    amountMode: 'gross',
    gross: null,
    netInput: null,
    // 할인·환불은 모르면 비워 둔다(0으로 가정하지 않음)
    storeDiscount: null,
    refund: null,
    cardSales: null,
    costs: emptyCosts(),
    bundledFee: false,
    memo: '',
    ...partial,
  };
}

export function newProblem(partial: Partial<Problem> = {}): Problem {
  return {
    id: uid('prob'),
    name: '',
    type: 'salesDecline',
    analysis: { start: todayStr(), end: todayStr() },
    compare: { start: todayStr(), end: todayStr() },
    channel: 'all',
    target: { key: 'totalSales', channel: 'all' },
    targetValue: null,
    memo: '',
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

export const emptyCoupon = (): CouponTerms => ({ amount: null, minOrder: null, routeId: null, previousAmount: null, usedCount: null });

export function newSolution(partial: Partial<Solution> = {}): Solution {
  return {
    id: uid('sol'),
    problemId: null,
    name: '',
    target: 'common',
    direction: 'revenue',
    hypothesis: '',
    evidence: '',
    actions: '',
    owner: '',
    start: null,
    end: null,
    budget: null,
    expectedRevenueChange: null,
    expectedCostChange: null,
    budgetIncludedInCost: true,
    kpi: { key: 'operatingProfit', channel: 'all' },
    extraKpis: [],
    coupon: emptyCoupon(),
    kpiTarget: null,
    kpiTargetMode: 'total',
    successCriteria: '',
    stopCriteria: '',
    status: 'planned',
    templateId: null,
    review: { before: null, after: null, decision: null, judgment: '', externalFactors: '', reviewedAt: null, nextCouponAmount: null },
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

export function newCustomerMetric(partial: Partial<CustomerMetric> = {}): CustomerMetric {
  return {
    id: uid('cust'),
    label: '',
    channel: 'all',
    periodStart: todayStr(),
    periodEnd: todayStr(),
    newCustomers: null,
    newOrders: null,
    newSales: null,
    existingCustomers: null,
    existingOrders: null,
    existingSales: null,
    cohortStart: null,
    cohortEnd: null,
    observationDate: null,
    observedCustomers: null,
    repurchased30: null,
    source: '',
    platformRepeatRate: null,
    platformRepeatDefinition: '',
    memo: '',
    ...partial,
  };
}
