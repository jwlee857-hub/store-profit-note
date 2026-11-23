// 배달앱 정산 반영: 정산일에 여러 날의 할인·환불·실제 수수료를 한 번에 보완한다. UI와 무관한 순수 함수.
// - 실제 수수료는 actual로 넣는다 → 계산·추정 수수료를 대체(합산하지 않음). 식재료비 등 다른 항목은 건드리지 않는다.
// - 순매출 직접 입력 기록에 할인을 나중에 넣어도 할인은 상세 정보일 뿐 다시 빼지 않는다(netSales 규칙 그대로).
// - 정산서에 기간 합계만 있으면 기간 비용(배달앱·판매 방식·기간 범위 보존)으로 저장하고, 그 범위의 일별 계산·추정 수수료는 계산에서 뺀다.
// - 같은 정산서를 다시 저장해도 같은 결과(값을 더하지 않고 바꿔 넣음).
import { coveredByPeriodCost, discountDetailKnown, effectiveCost, netSales, requiredCategories, routeHasPlatform, settledByPeriod } from './calc';
import { fillEstimates, refreshEstimates } from './entry';
import { uid } from './factory';
import { fmt } from './format';
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
  /** 이 기간에 이미 일별로 넣은 실제 수수료 */
  dailyActual: { count: number; amount: number };
  /** 기간 합계로 대체되는 일별 계산·추정 수수료 */
  calculated: { count: number; amount: number };
  /** 같은 배달앱·판매 방식의 겹치는 기간 합계 (다시 저장하면 바꿔 넣는다) */
  replaced: PeriodCost[];
}

const isSettlement = (pc: PeriodCost, routeId: string, channel: Channel) => pc.routeId === routeId && pc.attribution === channel;

export function periodOverlap(data: Pick<AppData, 'sales' | 'periodCosts'>, ps: PeriodSettlement): PeriodOverlap {
  const list = settlementEntries(data, ps.routeId, ps.channel, ps);
  const dailyActual = { count: 0, amount: 0 };
  const calculated = { count: 0, amount: 0 };
  for (const e of list) {
    const act = FEES.filter((c) => !(c === 'payment' && e.bundledFee)).reduce<number | null>((s, c) => (e.costs[c].actual === null ? s : (s ?? 0) + e.costs[c].actual!), null);
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
  const replaced = data.periodCosts.filter((pc) => isSettlement(pc, ps.routeId, ps.channel) && pc.start <= ps.end && ps.start <= pc.end);
  return { dailyActual, calculated, replaced };
}

/**
 * 기간 합계 저장.
 * - keepDaily: 일별 실제액은 그대로 두고, 기간 합계에서 그만큼 뺀 나머지만 기간 비용으로 (겹친 금액을 두 번 넣지 않음)
 * - replaceDaily: 그 기간의 일별 실제 수수료를 지우고 기간 합계 전체를 기간 비용으로
 * 같은 배달앱·판매 방식의 겹치는 기간 합계는 바꿔 넣는다(다시 저장해도 한 번만 반영).
 */
export function applyPeriodSettlement(data: AppData, ps: PeriodSettlement, mode: 'keepDaily' | 'replaceDaily'): { sales: SalesEntry[]; periodCosts: PeriodCost[] } | { error: string } {
  const ov = periodOverlap(data, ps);
  const amount = mode === 'keepDaily' ? ps.amount - ov.dailyActual.amount : ps.amount;
  if (amount < 0) return { error: `일별로 넣은 실제 수수료(${fmt(ov.dailyActual.amount, 'won')})가 기간 합계보다 커요. 금액을 확인하거나 일별 실제액을 기간 합계로 대체하세요.` };
  const ids = new Set(settlementEntries(data, ps.routeId, ps.channel, ps).map((e) => e.id));
  const sales =
    mode === 'replaceDaily'
      ? data.sales.map((e) =>
          ids.has(e.id) && FEES.some((c) => e.costs[c].actual !== null)
            ? { ...e, costs: { ...e.costs, brokerage: { ...e.costs.brokerage, actual: null }, payment: { ...e.costs.payment, actual: null } } }
            : e,
        )
      : data.sales;
  const replacedIds = new Set(ov.replaced.map((p) => p.id));
  // shortcut: 기간 합계는 중개·결제를 합친 한 금액으로 중개 수수료 항목에 둔다, 정산서가 둘을 나눠 주면 항목별로 저장한다
  const pc: PeriodCost = {
    id: uid('pc'),
    category: 'brokerage',
    attribution: ps.channel,
    nature: 'variable',
    start: ps.start,
    end: ps.end,
    amount,
    source: 'actual',
    memo: `배달앱 정산서 기간 합계 ${fmt(ps.amount, 'won')} (중개·결제 수수료)${mode === 'keepDaily' && ov.dailyActual.count ? ` − 일별 실제액 ${ov.dailyActual.count}건 ${fmt(ov.dailyActual.amount, 'won')}` : ''}`,
    routeId: ps.routeId,
  };
  return { sales, periodCosts: [...data.periodCosts.filter((p) => !replacedIds.has(p.id)), pc] };
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
