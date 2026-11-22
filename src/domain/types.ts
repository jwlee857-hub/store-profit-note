// 데이터 모델 정의. UI와 무관한 순수 타입만 둔다.

export const SCHEMA_VERSION = 7 as const;

export type Channel = 'hall' | 'delivery' | 'takeout';
export const CHANNELS: Channel[] = ['hall', 'delivery', 'takeout'];

export type Attribution = Channel | 'common';
export type CostNature = 'fixed' | 'variable' | 'mixed';
export type ValueSource = 'actual' | 'estimated';

/** YYYY-MM-DD 형식의 날짜 문자열 */
export type DateStr = string;

export interface DateRange {
  start: DateStr;
  end: DateStr; // 포함
}

/** 일별 매출 입력에 붙는 직접 비용 항목 */
export type DirectCategory =
  | 'food'
  | 'brokerage'
  | 'payment'
  | 'delivery'
  | 'packaging'
  | 'hallSupplies'
  | 'channelAd'
  | 'otherDirect';

export const DIRECT_CATEGORIES: DirectCategory[] = [
  'food',
  'brokerage',
  'payment',
  'delivery',
  'packaging',
  'hallSupplies',
  'channelAd',
  'otherDirect',
];

/** 공통 운영비 항목 */
export type CommonCategory =
  | 'labor'
  | 'rent'
  | 'maintenance'
  | 'utilities'
  | 'rental'
  | 'insurance'
  | 'commonAd'
  | 'depreciation'
  | 'otherOperating';

export const COMMON_CATEGORIES: CommonCategory[] = [
  'labor',
  'rent',
  'maintenance',
  'utilities',
  'rental',
  'insurance',
  'commonAd',
  'depreciation',
  'otherOperating',
];

export type CostCategory = DirectCategory | CommonCategory;

export interface StoreSettings {
  name: string;
  channels: Channel[];
  /** 0=일 ... 6=토 */
  regularOpenDays: number[];
  openTime: string; // HH:MM
  closeTime: string;
  seats: number | null;
  /** 이 가게에서 매 기간 발생하는 공통비 항목. 영업이익 완결성 판단에 사용 */
  commonCostChecklist: CommonCategory[];
  /** 입력 금액 기준 안내용 (모든 입력을 같은 기준으로 맞춘다) */
  vatBasis: 'included' | 'excluded';
}

export interface DayOverride {
  date: DateStr;
  open: boolean;
  note: string;
}

export interface Platform {
  id: string;
  name: string;
  note: string;
}

/** 주문 경로: 주문이 들어온 경로 (예: 매장 방문, 전화, 배달앱 A) */
export interface OrderRoute {
  id: string;
  name: string;
  channels: Channel[];
  platformId: string | null;
}

/** 결제수단: 대금을 치른 수단 (예: 카드, 현금) — 주문 경로와 별개 */
export interface PaymentMethod {
  id: string;
  name: string;
}

export type FeeBase = 'gross' | 'afterDiscount' | 'net';

/** 수수료 추정 규칙. 적용 시작일 기준으로 버전 관리 */
export interface FeeRule {
  id: string;
  routeId: string;
  effectiveFrom: DateStr;
  mode: 'separate' | 'bundled';
  brokerageRate: number | null; // %
  brokerageBase: FeeBase;
  paymentRate: number | null; // %
  paymentBase: FeeBase;
  bundledRate: number | null; // %
  bundledBase: FeeBase;
  perOrderFee: number | null; // 원/건
  /** true면 입력한 요율·정액이 부가세 별도이므로 1.1배 적용 */
  vatExclusive: boolean;
  note: string;
}

export interface MenuVersion {
  id: string;
  effectiveFrom: DateStr;
  prices: Record<Channel, number | null>;
  costMode: 'amount' | 'rate' | 'unknown';
  costAmount: number | null;
  costRate: number | null; // %
  costSource: ValueSource;
  note: string;
}

export interface Menu {
  id: string;
  name: string;
  onSale: boolean;
  versions: MenuVersion[];
}

/**
 * 하나의 비용 항목 값. 실제값이 있으면 추정값은 무시된다(합산하지 않음).
 * - estimateBasis: 저장 당시 계산 근거 문구(데이터). 이전 기록의 출처 판별에 쓰므로 형식을 바꾸지 않는다.
 * - calc: v7부터 자동 계산할 때 함께 저장하는 계산 내용(화면 표시·출처 판별용). 이전 기록에는 없다.
 */
export interface CostValue {
  actual: number | null;
  estimated: number | null;
  estimateBasis: string;
  calc?: CostCalc;
}

/** 자동 계산한 비용의 계산 내용. 저장 당시 값 그대로 남는다(설정을 바꿔도 바뀌지 않음) */
export type CostCalc =
  | { method: 'perOrder'; unitAmount: number; orders: number; effectiveFrom: DateStr }
  | {
      method: 'feeRule';
      rate: number | null;
      base: number | null;
      baseLabel: string;
      /** 기준금액 종류: 'card' = 카드 결제액 */
      baseKind: FeeBase | 'card';
      perOrderFee: number | null;
      orders: number | null;
      vatExclusive: boolean;
      effectiveFrom: DateStr;
    }
  | { method: 'cashNoFee' }
  /** 원가율 × 기준 금액. source: store = 가게 설정의 원가율, entry = 기록에서 직접 지정, temp = 임시 원가율, menuAverage = 메뉴 평균 */
  | { method: 'foodRate'; source: 'store' | 'entry' | 'temp' | 'menuAverage'; rate: number; base: number; baseKind: 'gross' | 'net'; menuCount?: number; effectiveFrom?: DateStr };

/** 가게 설정의 식재료비 원가율(직접 지정). channel이 null이면 모든 판매 방식에 적용, 판매 방식 지정 값이 우선 — v7 */
export interface FoodCostRate {
  id: string;
  channel: Channel | null;
  /** % */
  rate: number;
  effectiveFrom: DateStr;
}

/**
 * 매출 금액 입력 기준 (v3에서 추가, 이전 데이터는 gross)
 * - gross: 할인·환불 전 판매액을 입력. 순매출 = 판매액 − 가게 부담 할인 − 환불
 * - net: 할인·환불 반영 후 순매출을 직접 입력. 할인·환불은 상세 정보일 뿐 다시 빼지 않는다.
 */
export type AmountMode = 'gross' | 'net';

export interface SalesEntry {
  id: string;
  date: DateStr;
  channel: Channel;
  routeId: string;
  paymentMethodId: string | null; // null = 혼합/미지정
  /** 전액 취소를 제외한 완료 주문 수 */
  orders: number | null;
  /** 홀만 사용 */
  visitors: number | null;
  amountMode: AmountMode;
  /** gross 모드: 할인·환불 반영 전 상품 판매액. net 모드에서는 쓰지 않는다(null) */
  gross: number | null;
  /** net 모드: 사용자가 입력한 순매출. gross 모드에서는 null */
  netInput: number | null;
  /** net 모드에서 null은 "모름"(0원이 아님) */
  storeDiscount: number | null;
  refund: number | null;
  /**
   * v5: 카드 결제액(결제 수수료 대상). 결제수단이 섞였거나 미지정일 때만 쓴다. null = 모름.
   * 모르면 전체 매출을 카드 매출로 간주하지 않는다.
   */
  cardSales: number | null;
  costs: Record<DirectCategory, CostValue>;
  /** 묶음 수수료: brokerage 칸에 묶음 수수료를 담고 결제 수수료는 별도로 받지 않음 */
  bundledFee: boolean;
  memo: string;
}

/** 기간에 걸친 비용. 귀속이 채널이면 그 채널의 직접 비용, common이면 공통 운영비 */
export interface PeriodCost {
  id: string;
  category: CostCategory;
  attribution: Attribution;
  nature: CostNature;
  start: DateStr;
  end: DateStr;
  amount: number;
  source: ValueSource;
  memo: string;
}

export interface CustomerMetric {
  id: string;
  label: string;
  channel: Channel | 'all';
  periodStart: DateStr;
  periodEnd: DateStr;
  newCustomers: number | null;
  newOrders: number | null;
  newSales: number | null;
  existingCustomers: number | null; // 해당 기간에 실제 구매한 기존 고객 수
  existingOrders: number | null;
  existingSales: number | null;
  cohortStart: DateStr | null;
  cohortEnd: DateStr | null;
  observationDate: DateStr | null;
  observedCustomers: number | null; // 첫 구매 후 30일 관찰 완료 고객 수
  repurchased30: number | null;
  /** 집계 출처 (예: 배달앱 A 사장님 통계 화면) — v3 */
  source: string;
  /** 플랫폼이 제공하는 재주문율(%). 앱의 30일 재구매율과 정의가 달라 비교하지 않는다 — v3 */
  platformRepeatRate: number | null;
  /** 플랫폼 재주문율의 정의(플랫폼 안내 문구를 옮겨 적음) — v3 */
  platformRepeatDefinition: string;
  memo: string;
}

export type MetricKey =
  | 'totalSales'
  | 'operatingProfit'
  | 'operatingMargin'
  | 'salesPerBusinessDay'
  | 'netSales'
  | 'orders'
  | 'visitors'
  | 'avgTicket'
  | 'directProfit'
  | 'directCostPerOrder'
  | 'directProfitPerOrder'
  /** 가게 부담 할인액(원). 할인·환불 상세가 있는 기록만 합산 */
  | 'storeDiscount';

export interface MetricRef {
  key: MetricKey;
  channel: Channel | 'all';
}

export type ProblemType = 'salesDecline' | 'profitDecline' | 'other';

export interface Problem {
  id: string;
  name: string;
  type: ProblemType;
  analysis: DateRange;
  compare: DateRange;
  channel: Channel | 'all';
  target: MetricRef;
  targetValue: number | null;
  memo: string;
  createdAt: string;
}

export type SolutionStatus = 'planned' | 'running' | 'reviewPending' | 'done' | 'stopped';
export type SolutionDirection = 'revenue' | 'cost' | 'mixed';
export type Decision = 'keep' | 'revise' | 'stop';
/**
 * 목표 기준
 * - total: 실행 후 기간 값 자체
 * - increase: 실행 전 대비 변화량
 * - growthRate: 실행 전 대비 증가율(%) — v3
 * - perBusinessDay: 실행 후 기간의 영업일당 값 — v3, 합계형 지표에만
 */
export type KpiTargetMode = 'total' | 'increase' | 'growthRate' | 'perBusinessDay';

export interface SolutionReview {
  before: DateRange | null;
  after: DateRange | null;
  decision: Decision | null;
  judgment: string;
  externalFactors: string;
  reviewedAt: string | null;
  /** 결과를 보고 정한 다음 기간 쿠폰 금액(원). 다음 계획의 쿠폰 금액 기본값으로 쓴다 — v6. null = 미정 */
  nextCouponAmount: number | null;
}

/** 쿠폰·할인 조건 (선택) — v6. 모르면 null */
export interface CouponTerms {
  /** 쿠폰 1장 금액(원) */
  amount: number | null;
  /** 최소 주문금액(원) */
  minOrder: number | null;
}

export interface Solution {
  id: string;
  problemId: string | null;
  name: string;
  target: Channel | 'common';
  direction: SolutionDirection;
  hypothesis: string;
  evidence: string;
  actions: string;
  owner: string;
  start: DateStr | null;
  end: DateStr | null;
  budget: number | null;
  expectedRevenueChange: number | null;
  /** 증가는 +, 감소는 − */
  expectedCostChange: number | null;
  budgetIncludedInCost: boolean;
  /** 주 성과지표. 목표값·달성 판정은 이 지표 기준 */
  kpi: MetricRef;
  /** 함께 확인할 성과지표 (목표 없이 실행 전후만 비교) — v6 */
  extraKpis: MetricRef[];
  /** 쿠폰·할인 조건 (선택) — v6 */
  coupon: CouponTerms;
  kpiTarget: number | null;
  /** 목표값 해석: total = 실행 후 기간 값 자체, increase = 실행 전 대비 변화량 (v2에서 추가, v1 데이터는 total) */
  kpiTargetMode: KpiTargetMode;
  successCriteria: string;
  stopCriteria: string;
  status: SolutionStatus;
  templateId: string | null;
  review: SolutionReview;
  createdAt: string;
}

export interface AppData {
  schemaVersion: typeof SCHEMA_VERSION;
  mode: 'sample' | 'user';
  store: StoreSettings | null;
  platforms: Platform[];
  routes: OrderRoute[];
  paymentMethods: PaymentMethod[];
  feeRules: FeeRule[];
  dayOverrides: DayOverride[];
  menus: Menu[];
  sales: SalesEntry[];
  periodCosts: PeriodCost[];
  customerMetrics: CustomerMetric[];
  problems: Problem[];
  solutions: Solution[];
  /** 사용자가 "이 날 이 경로는 매출 없음"으로 확인한 기록 — v3 */
  salesChecks: SalesCheck[];
  /** 주문 1건당 기본 비용 (날마다 알기 어려운 소모품·배달비·포장비 추정용) — v4 */
  perOrderCosts: PerOrderCost[];
  /** 식재료비 원가율(직접 지정) — v7 */
  foodCostRates: FoodCostRate[];
  prefs: AppPrefs;
  updatedAt: string;
}

/** 비용을 주문 1건당 금액으로 추정할 수 있는 항목 */
export type PerOrderCategory = 'hallSupplies' | 'delivery' | 'packaging' | 'otherDirect';
export const PER_ORDER_CATEGORIES: PerOrderCategory[] = ['hallSupplies', 'delivery', 'packaging', 'otherDirect'];

/**
 * 주문 1건당 기본 비용. 빠른 저장 때 주문 수 × 금액을 '추정값'으로 기록에 저장한다(입력 시점 저장 → 나중에 바꿔도 과거 기록은 그대로).
 * routeId가 null이면 그 판매 방식의 모든 경로에 적용, 경로를 지정한 값이 우선한다.
 */
export interface PerOrderCost {
  id: string;
  channel: Channel;
  routeId: string | null;
  category: PerOrderCategory;
  amount: number;
  effectiveFrom: DateStr;
}

/** 매출 없음 확인. 매출 기록을 만들지 않고 입력 현황 표시에만 쓴다 */
export interface SalesCheck {
  date: DateStr;
  channel: Channel;
  routeId: string;
  status: 'noSales';
  checkedAt: string;
}

export interface AppPrefs {
  /** 간편 입력에서 마지막으로 쓴 채널·경로·금액 기준 (금액·수량은 저장하지 않음) */
  lastEntry: { channel: Channel; routeId: string; amountMode: AmountMode } | null;
  /** 고객 집계 데이터를 확인할 수 있는지: unasked = 아직 묻지 않음 */
  customerData: 'unasked' | 'available' | 'unavailable';
}

/**
 * 계산 결과. value가 null이면 reason으로 표시 문구를 정한다.
 * - noData: 데이터 필요
 * - divZero: 계산 불가 (분모 0)
 * - incomplete: 누락 비용이 있어 확정 불가 (provisional에 입력된 값만 반영한 잠정치)
 */
export interface Calc {
  value: number | null;
  reason?: 'noData' | 'divZero' | 'incomplete';
  /** 모르는 값을 가정한 추정 비용이 들어 있음 → '추정 포함' */
  estimated?: boolean;
  /** 설정값을 입력값에 그대로 적용한 계산 비용이 들어 있음(추정은 없음) → '설정 기준 계산액 포함' */
  calculated?: boolean;
  provisional?: number | null;
  /** 선택 입력 항목이 일부 날짜에만 있을 때: 값이 있는 날만으로 계산했음을 표시 (예: 23일 중 22일 기준) */
  basis?: CalcBasis;
}

export interface CalcBasis {
  /** 값이 있어 계산에 쓴 수 */
  used: number;
  /** 전체 수 */
  total: number;
  unit: '일' | '건';
}
