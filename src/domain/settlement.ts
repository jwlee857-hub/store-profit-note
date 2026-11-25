// 배달앱 정산 반영: 정산일에 여러 날의 할인·환불·실제 수수료를 한 번에 보완한다. UI와 무관한 순수 함수.
// - 실제 수수료는 actual로 넣는다 → 계산·추정 수수료를 대체(합산하지 않음). 식재료비 등 다른 항목은 건드리지 않는다.
// - 순매출 직접 입력 기록에 할인을 나중에 넣어도 할인은 상세 정보일 뿐 다시 빼지 않는다(netSales 규칙 그대로).
// - 정산서에 기간 합계만 있으면 기간 비용(배달앱·판매 방식·기간 범위 보존)으로 저장한다. 그 범위 수수료의 최종 금액은 기간 합계이고 일별 금액은 내역일 뿐이다.
// - 같은 정산서를 다시 저장해도 같은 결과(값을 더하지 않고 바꿔 넣음).
import { coveredByPeriodCost, discountDetailKnown, effectiveCost, netSales, requiredCategories, routeHasPlatform, settledByPeriod } from './calc';
import { fillEstimates, refreshEstimates } from './entry';
import { uid } from './factory';
import { validateSalesEntry } from './validation';
import { fmt } from './format';
import { krRange } from './dates';
import type { AppData, Channel, DateRange, DateStr, PeriodCost, SalesEntry } from './types';

const FEES = ['brokerage', 'payment'] as const;

/** 정산 화면의 대상 기록: 그 배달앱·판매 방식·기간의 매출 기록 (날짜순) */
export function settlementEntries(data: Pick<AppData, 'sales'>, routeId: string, channel: Channel, range: DateRange): SalesEntry[] {
  return data.sales
    .filter((e) => e.routeId === routeId && e.channel === channel && e.date >= range.start && e.date <= range.end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** 실제값이 없는 수수료(설정 기준 계산·추정) 합계. 없으면 null */
export function calculatedFee(e: SalesEntry): number | null {
  let sum: number | null = null;
  for (const c of FEES) {
    if (c === 'payment' && e.bundledFee) continue;
    const cv = e.costs[c];
    if (cv.actual === null && cv.estimated !== null) sum = (sum ?? 0) + cv.estimated;
  }
  return sum;
}

export interface SettleEdit {
  id: string;
  storeDiscount: number | null;
  refund: number | null;
  brokerage: number | null;
  payment: number | null;
}

/** 화면 초기값 */
export const editOf = (e: SalesEntry): SettleEdit => ({ id: e.id, storeDiscount: e.storeDiscount, refund: e.refund, brokerage: e.costs.brokerage.actual, payment: e.bundledFee ? null : e.costs.payment.actual });

/**
 * 일별 정산 반영. 바뀐 기록만 새 객체로 돌려준다.
 * 할인·환불이 바뀌면 실제값이 없는 수수료만 현재 설정으로 다시 계산한다(수수료 기준금액이 할인 후 금액일 수 있음).
 */
export function applySettlementEdits(data: AppData, edits: SettleEdit[]): SalesEntry[] {
  const byId = new Map(edits.map((x) => [x.id, x]));
  return data.sales.map((e) => {
    const x = byId.get(e.id);
    if (!x) return e;
    const amountsChanged = x.storeDiscount !== e.storeDiscount || x.refund !== e.refund;
    let next: SalesEntry = { ...e, storeDiscount: x.storeDiscount, refund: x.refund, costs: { ...e.costs } };
    next.costs.brokerage = { ...next.costs.brokerage, actual: x.brokerage };
    if (!next.bundledFee) next.costs.payment = { ...next.costs.payment, actual: x.payment };
    if (amountsChanged) {
      const fresh = fillEstimates(refreshEstimates(next, data).entry, data).entry;
      next = { ...next, bundledFee: fresh.bundledFee, costs: { ...next.costs, brokerage: fresh.costs.brokerage, payment: fresh.costs.payment } };
    }
    const same = JSON.stringify(next) === JSON.stringify(e);
    return same ? e : next;
  });
}

// ───────── 기간 합계 ─────────

export interface PeriodSettlement {
  routeId: string;
  channel: Channel;
  start: DateStr;
  end: DateStr;
  /** 정산서의 기간 수수료 합계 (중개·결제) */
  amount: number;
}

export interface PeriodOverlap {
  /** 이 기간에 일별로 넣은 실제 수수료 — 기간 합계에 포함된 내역으로 본다 (따로 더하지 않음) */
  dailyActual: { count: number; amount: number };
  /** 기간 합계로 대체되는 일별 계산·추정 수수료 */
  calculated: { count: number; amount: number };
  /** 같은 배달앱·판매 방식·같은 기간의 기존 합계 (다시 저장하면 바꿔 넣는다) */
  replaced: PeriodCost[];
  /** 같은 배달앱·판매 방식의 기간이 일부만 겹치는 기존 합계 — 겹친 금액을 나눌 근거가 없어 저장하지 않는다 */
  conflicts: { cost: PeriodCost; start: DateStr; end: DateStr }[];
}

const isSettlement = (pc: PeriodCost, routeId: string, channel: Channel) => pc.routeId === routeId && pc.attribution === channel;

/** 일별 실제 수수료 합 (없으면 null) */
const dailyFee = (e: SalesEntry) => FEES.filter((c) => !(c === 'payment' && e.bundledFee)).reduce<number | null>((s, c) => (e.costs[c].actual === null ? s : (s ?? 0) + e.costs[c].actual!), null);

export function periodOverlap(data: Pick<AppData, 'sales' | 'periodCosts'>, ps: PeriodSettlement): PeriodOverlap {
  const dailyActual = { count: 0, amount: 0 };
  const calculated = { count: 0, amount: 0 };
  for (const e of settlementEntries(data, ps.routeId, ps.channel, ps)) {
    const act = dailyFee(e);
    if (act !== null) {
      dailyActual.count++;
      dailyActual.amount += act;
    }
    const calc = calculatedFee(e);
    if (calc !== null) {
      calculated.count++;
      calculated.amount += calc;
    }
  }
  const same = data.periodCosts.filter((pc) => isSettlement(pc, ps.routeId, ps.channel) && pc.start <= ps.end && ps.start <= pc.end);
  const replaced = same.filter((pc) => pc.start === ps.start && pc.end === ps.end);
  const conflicts = same
    .filter((pc) => !replaced.includes(pc))
    .map((cost) => ({ cost, start: cost.start > ps.start ? cost.start : ps.start, end: cost.end < ps.end ? cost.end : ps.end }));
  return { dailyActual, calculated, replaced, conflicts };
}

/**
 * 기간 합계 저장. 기간 합계가 그 범위 수수료의 최종 금액이다(일별 실제액은 그 안의 내역). 어떤 순서로 넣어도 같은 비용이 된다.
 * - 같은 배달앱·판매 방식·같은 기간: 바꿔 넣는다 (다시 저장해도 한 번만 반영)
 * - 기간이 일부만 겹침: 겹친 금액을 나눌 근거가 없으므로 저장하지 않고 기존 기록을 그대로 둔다 (겹친 날짜·정정 방법 안내)
 */
export function applyPeriodSettlement(data: AppData, ps: PeriodSettlement): { periodCosts: PeriodCost[] } | { error: string } {
  if (!(ps.amount >= 0)) return { error: '금액을 확인하세요.' };
  const ov = periodOverlap(data, ps);
  if (ov.conflicts.length)
    return {
      error: ov.conflicts
        .map((c) => `${krRange(c)}이 이미 저장한 정산 ${krRange(c.cost)} ${fmt(c.cost.amount, 'won')}과 겹쳐요.`)
        .concat('겹치지 않는 날짜만 입력하거나, 기존 기간 합계를 지운 뒤 두 기간을 합친 금액으로 다시 저장하세요.')
        .join(' '),
    };
  const pc: PeriodCost = {
    id: uid('pc'),
    category: 'brokerage',
    attribution: ps.channel,
    nature: 'variable',
    start: ps.start,
    end: ps.end,
    amount: ps.amount,
    source: 'actual',
    memo: `배달앱 정산서 기간 합계 (중개·결제 수수료)`,
    routeId: ps.routeId,
    settlementBasis: 'total',
  };
  const replacedIds = new Set(ov.replaced.map((p) => p.id));
  return { periodCosts: [...data.periodCosts.filter((p) => !replacedIds.has(p.id)), pc] };
}

/** 저장된 기간 합계의 내역: "일별 확인 10,000원 / 나머지 60,000원" */
export function settlementBreakdown(data: Pick<AppData, 'sales'>, pc: PeriodCost): { total: number; daily: number; dailyCount: number; rest: number; unverified: boolean } {
  let daily = 0;
  let dailyCount = 0;
  for (const e of settlementEntries(data, pc.routeId!, pc.attribution as Channel, pc)) {
    const act = dailyFee(e);
    if (act !== null) {
      daily += act;
      dailyCount++;
    }
  }
  // 확인 필요(이전 방식): 저장된 금액은 잔여액으로 보고 일별 실제액을 더한 값이 지금 계산에 들어간 총액
  if (pc.settlementBasis === 'unverified') return { total: pc.amount + daily, daily, dailyCount, rest: pc.amount, unverified: true };
  return { total: pc.amount, daily, dailyCount, rest: pc.amount - daily, unverified: false };
}

/**
 * 정산 표 수정 검증: 매출 상세 입력과 같은 규칙(validateSalesEntry)으로 할인·환불을 확인한다.
 * 오류가 하나라도 있으면 표 전체를 저장하지 않는다 (일부 행만 반영되지 않게). 기록 id → 오류 문구
 */
export function validateSettlementEdits(data: AppData, edits: SettleEdit[]): Record<string, string> {
  const ids = new Set(edits.map((x) => x.id));
  const out: Record<string, string> = {};
  for (const e of applySettlementEdits(data, edits)) {
    if (!ids.has(e.id)) continue;
    const v = validateSalesEntry(e, data);
    const msg = v.errors.storeDiscount ?? v.errors.refund;
    if (msg) out[e.id] = msg;
  }
  return out;
}

// ───────── 홈: 쿠폰 판단에 필요한 정산 할 일 ─────────

export interface SettlementTodo {
  routeId: string;
  channel: Channel;
  start: DateStr;
  end: DateStr;
  /** 할인액을 모르는 기록 (순매출만 입력) */
  discountUnknown: number;
  /** 필수 수수료가 비어 있는 기록 */
  feeMissing: number;
}

/** 배달앱 경로별로 할인액 미입력·수수료 미입력 기록을 모은다 (정산서로 채울 수 있는 것만) */
export function settlementTodos(data: Pick<AppData, 'sales' | 'routes' | 'periodCosts'>, range: DateRange): SettlementTodo[] {
  const map = new Map<string, SettlementTodo>();
  for (const e of data.sales) {
    if (e.date < range.start || e.date > range.end || !routeHasPlatform(data, e.routeId)) continue;
    const discountUnknown = netSales(e) !== null && !discountDetailKnown(e);
    const req = requiredCategories(e.channel, true, e.bundledFee);
    const feeMissing =
      !settledByPeriod(data.periodCosts, e) && FEES.some((c) => req.includes(c) && effectiveCost(e.costs[c]).status === 'missing' && !coveredByPeriodCost(data.periodCosts, c, e.channel, e.date));
    if (!discountUnknown && !feeMissing) continue;
    const k = `${e.routeId}|${e.channel}`;
    const t = map.get(k) ?? { routeId: e.routeId, channel: e.channel, start: e.date, end: e.date, discountUnknown: 0, feeMissing: 0 };
    if (e.date < t.start) t.start = e.date;
    if (e.date > t.end) t.end = e.date;
    if (discountUnknown) t.discountUnknown++;
    if (feeMissing) t.feeMissing++;
    map.set(k, t);
  }
  return [...map.values()].sort((a, b) => b.discountUnknown + b.feeMissing - (a.discountUnknown + a.feeMissing));
}

// ───────── 첫 기록 뒤 설정 제안 ─────────

export interface SetupHint {
  text: string;
  /** 가게 설정의 해당 칸 (StoreSettings section id) */
  section: 'per-order' | 'fee-rules' | 'food-rate';
}

/**
 * 방금 저장한 기록에 관련된 설정 하나만 제안한다 (모르는 값은 비워 둔 채 저장할 수 있음).
 * 비어 있는 비용 중 가게 설정으로 다음부터 자동 계산할 수 있는 것: 용기(포장비) → 배달비 → 수수료율 → 원가율 순.
 */
export function setupHint(data: Pick<AppData, 'routes' | 'feeRules' | 'perOrderCosts' | 'foodCostRates' | 'menus'>, e: SalesEntry): SetupHint | null {
  const empty = (c: keyof SalesEntry['costs']) => e.costs[c].actual === null && e.costs[c].estimated === null;
  const hasPerOrder = (cat: string) => data.perOrderCosts.some((p) => p.channel === e.channel && p.category === cat && (p.routeId === null || p.routeId === e.routeId));
  if ((e.channel === 'delivery' || e.channel === 'takeout') && empty('packaging') && !hasPerOrder('packaging'))
    return { text: '용기 한 개 가격을 알면 다음부터 포장비를 자동 계산해요.', section: 'per-order' };
  if (e.channel === 'delivery' && empty('delivery') && !hasPerOrder('delivery')) return { text: '배달 한 건에 드는 배달비를 알면 다음부터 자동 계산해요.', section: 'per-order' };
  if (routeHasPlatform(data, e.routeId) && empty('brokerage') && !data.feeRules.some((f) => f.routeId === e.routeId))
    return { text: '배달앱 수수료율을 알면 다음부터 수수료를 자동 계산해요.', section: 'fee-rules' };
  if (e.channel === 'hall' && empty('hallSupplies') && !hasPerOrder('hallSupplies')) return { text: '주문 한 건에 드는 물티슈·소모품 값을 알면 다음부터 자동 계산해요.', section: 'per-order' };
  if (empty('food') && !data.foodCostRates.length && !data.menus.length) return { text: '메뉴 평균 원가율(예: 35%)을 알면 다음부터 식재료비를 자동 계산해요.', section: 'food-rate' };
  return null;
}
