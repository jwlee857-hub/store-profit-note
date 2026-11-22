// 추정 계산. 추정값은 입력 시점에 해당 날짜 기준 규칙으로 계산해 실적에 "저장"한다.
// 이후 규칙·가격·원가 설정을 바꿔도 이미 저장된 실적은 바뀌지 않는다(소급 없음).
// 수수료는 "설정 기준 계산"(규칙·기준금액이 있으면 자동), 식재료비 등은 "추정"으로 구분한다.
import type { AppData, Channel, DateStr, FeeBase, FeeRule, Menu, MenuVersion, SalesEntry } from './types';
import { grossSales, netSales, type SalesAmounts } from './calc';
import { CASH_FEE_BASIS, FEE_BASE_LABEL } from './costBasis';

/** 날짜에 적용되는 버전: 적용 시작일이 날짜 이하인 것 중 가장 최근 */
export function pickEffective<T extends { effectiveFrom: DateStr }>(items: T[], date: DateStr): T | null {
  let best: T | null = null;
  for (const it of items) {
    if (it.effectiveFrom <= date && (!best || it.effectiveFrom > best.effectiveFrom)) best = it;
  }
  return best;
}

export function feeRuleFor(data: Pick<AppData, 'feeRules'>, routeId: string, date: DateStr): FeeRule | null {
  return pickEffective(
    data.feeRules.filter((r) => r.routeId === routeId),
    date,
  );
}

/**
 * 수수료 기준 금액. 필요한 상세(판매액·할인·환불)를 모르면 null — 화면에서는 "추가 정보 필요"로 표시한다.
 * 순매출 기준 기록에서 판매액 기준 수수료는 할인·환불을 모두 알 때만 계산한다.
 */
export function feeBaseAmount(e: SalesAmounts, base: FeeBase): number | null {
  if (base === 'net') return netSales(e);
  if (e.amountMode === 'net') {
    if (base === 'gross') return grossSales(e);
    // 할인 후 = 순매출 + 환불
    return e.netInput !== null && e.netInput !== undefined && e.refund !== null ? e.netInput + e.refund : null;
  }
  if (e.gross === null) return null;
  if (base === 'gross') return e.gross;
  return e.gross - (e.storeDiscount ?? 0);
}

export interface FeeEstimate {
  bundled: boolean;
  brokerage: number | null; // 묶음이면 묶음 수수료 전체
  payment: number | null; // 묶음이면 null (중복 부과 방지)
  basis: string;
  /** 요율은 있지만 기준 금액에 필요한 할인·환불 상세가 없어 계산하지 못함 */
  needsInfo: boolean;
  /** 모르는 할인·환불을 0원으로 가정해 계산함 */
  assumedZero?: boolean;
}

const round = (n: number) => Math.round(n);
const NEEDS_INFO = '추가 정보 필요: 이 수수료는 할인·환불 전 금액 기준이라 할인·환불 상세가 있어야 계산합니다';

/**
 * 수수료 추정.
 * assumeZeroUnknown: 순매출 기준 기록에서 모르는 할인·환불을 0원으로 가정해 기준 금액을 구한다(빠른 입력용).
 * 가정을 썼으면 근거 문구에 남기고 assumedZero = true. 상세 입력 화면은 이 가정을 쓰지 않는다.
 */
export function estimateFees(e: SalesAmounts & Pick<SalesEntry, 'orders'>, rule: FeeRule, opts: { assumeZeroUnknown?: boolean } = {}): FeeEstimate {
  if (opts.assumeZeroUnknown && e.amountMode === 'net' && (e.storeDiscount === null || e.refund === null) && netSales(e) !== null) {
    const assumed = estimateFees({ ...e, storeDiscount: e.storeDiscount ?? 0, refund: e.refund ?? 0 }, rule);
    const note = `할인·환불 금액을 몰라 ${[e.storeDiscount === null ? '할인' : '', e.refund === null ? '환불' : ''].filter(Boolean).join('·')} 0원으로 가정 — 실제보다 낮게 추정될 수 있음`;
    return { ...assumed, basis: `${assumed.basis} · ${note}`, needsInfo: false, assumedZero: true };
  }
  const vat = rule.vatExclusive ? 1.1 : 1;
  const perOrder = (rule.perOrderFee ?? 0) * (e.orders ?? 0);
  const vatNote = rule.vatExclusive ? ', 부가세 10% 가산' : '';
  if (rule.mode === 'bundled') {
    const base = feeBaseAmount(e, rule.bundledBase);
    if (rule.bundledRate === null) return { bundled: true, brokerage: null, payment: null, basis: '요율 없음', needsInfo: false };
    if (base === null) return { bundled: true, brokerage: null, payment: null, basis: netSales(e) !== null ? NEEDS_INFO : '매출 금액 없음', needsInfo: netSales(e) !== null };
    return {
      bundled: true,
      brokerage: round((base * (rule.bundledRate / 100) + perOrder) * vat),
      payment: null,
      basis: `묶음 ${rule.bundledRate}% (${rule.effectiveFrom} 적용 규칙${vatNote})`,
      needsInfo: false,
    };
  }
  const bBase = feeBaseAmount(e, rule.brokerageBase);
  const pBase = feeBaseAmount(e, rule.paymentBase);
  const wantsBrokerage = rule.brokerageRate !== null || !!rule.perOrderFee;
  const wantsPayment = rule.paymentRate !== null;
  const brokerage = bBase === null || !wantsBrokerage ? null : round((bBase * ((rule.brokerageRate ?? 0) / 100) + perOrder) * vat);
  const payment = pBase === null || !wantsPayment ? null : round(pBase * (rule.paymentRate! / 100) * vat);
  const hasSales = netSales(e) !== null;
  const needsInfo = hasSales && ((wantsBrokerage && bBase === null) || (wantsPayment && pBase === null));
  return {
    bundled: false,
    brokerage,
    payment,
    basis: `중개 ${rule.brokerageRate ?? 0}% · 결제 ${rule.paymentRate ?? 0}% (${rule.effectiveFrom} 적용 규칙${vatNote})${needsInfo ? ` — ${NEEDS_INFO}` : ''}`,
    needsInfo,
  };
}

// ───────── 수수료 자동 계산 (매출 기록용) ─────────

/** 결제수단 구분: 현금(카드 수수료 없음) · 카드 등(수수료 대상) · 모름/섞임 */
export type PayKind = 'card' | 'cash' | 'unknown';

/** 결제수단 이름으로 구분한다. '현금'·'계좌'·'이체'는 카드 수수료 대상이 아니다 */
export function payKindOf(data: Partial<Pick<AppData, 'paymentMethods'>>, paymentMethodId: string | null): PayKind {
  if (!paymentMethodId) return 'unknown';
  const name = data.paymentMethods?.find((p) => p.id === paymentMethodId)?.name ?? '';
  if (!name) return 'unknown';
  return /현금|계좌|이체/.test(name) ? 'cash' : 'card';
}

/** 계산에 더 필요한 정보 (매출 금액·주문 수는 기본 입력칸이므로 따로 안내하지 않는다) */
export type FeeNeed = 'amount' | 'orders' | 'refund' | 'discountRefund' | 'cardSales';

export interface FeeItem {
  category: 'brokerage' | 'payment';
  label: string;
  /** ok: 계산함 · needsInfo: 계산에 필요한 정보 없음 · notApplicable: 적용 대상 아님(현금 등, 0원이 사실) */
  status: 'ok' | 'needsInfo' | 'notApplicable';
  amount: number | null;
  base: number | null;
  baseLabel: string;
  /** 기준금액 종류 ('card' = 카드 결제액). 현금 결제(적용 안 함)는 null */
  baseKind: FeeBase | 'card' | null;
  rate: number | null;
  perOrderFee: number | null;
  vatExclusive: boolean;
  need?: FeeNeed;
  /** 저장할 계산 근거 (적용 규칙·기준금액·요율) */
  basis: string;
}

export interface FeeCalc {
  rule: FeeRule;
  bundled: boolean;
  items: FeeItem[];
}

// 근거 구분(costBasis.ts)이 같은 문구로 판단하므로 한 곳에 둔다
export { CASH_FEE_BASIS, FEE_BASE_LABEL };

function needForBase(e: SalesAmounts, base: FeeBase): FeeNeed {
  if (netSales(e) === null) return 'amount';
  return base === 'gross' ? 'discountRefund' : 'refund';
}

/**
 * 매출 날짜·경로에 적용되는 규칙으로 수수료를 계산한다. 모르는 값을 0으로 가정하지 않는다.
 * - 기준금액(순매출/할인 후/판매액)을 만들 수 없으면 그 항목만 needsInfo
 * - 결제 수수료: 플랫폼 경로는 규칙 기준금액 전체, 그 밖에서는 결제수단에 따라
 *   현금 → 적용 안 함(0원), 카드 → 기준금액 전체, 섞임·모름 → 카드 결제액(cardSales)이 있어야 계산
 * - 묶음 수수료면 결제 수수료를 따로 계산하지 않는다(중복 방지)
 */
export function calcFees(e: SalesEntry, rule: FeeRule, ctx: { hasPlatform: boolean; payKind: PayKind }): FeeCalc {
  const vat = rule.vatExclusive ? 1.1 : 1;
  const vatNote = rule.vatExclusive ? ' · 부가세 별도(10% 가산)' : '';
  const ruleNote = `${rule.effectiveFrom}부터 적용 설정`;
  const make = (category: FeeItem['category'], label: string, rate: number | null, baseKind: FeeBase | 'card', perOrderFee: number | null): FeeItem => {
    const base = baseKind === 'card' ? (e.cardSales ?? null) : feeBaseAmount(e, baseKind);
    const baseLabel = baseKind === 'card' ? '카드 결제액' : FEE_BASE_LABEL[baseKind];
    const common = { category, label, base, baseLabel, baseKind, rate, perOrderFee, vatExclusive: rule.vatExclusive };
    const needsBase = rate !== null;
    if (needsBase && base === null)
      return { ...common, status: 'needsInfo', amount: null, need: baseKind === 'card' ? 'cardSales' : needForBase(e, baseKind), basis: '' };
    if (perOrderFee && e.orders === null) return { ...common, status: 'needsInfo', amount: null, need: 'orders', basis: '' };
    const amount = Math.round(((base ?? 0) * ((rate ?? 0) / 100) + (perOrderFee ?? 0) * (e.orders ?? 0)) * vat);
    const parts = [rate !== null ? `${rate}% × ${baseLabel} ${fmtWon(base!)}` : '', perOrderFee ? `주문 1건당 ${fmtWon(perOrderFee)} × ${e.orders}건` : ''].filter(Boolean).join(' + ');
    return { ...common, status: 'ok', amount, basis: `설정 기준 계산: ${label} ${parts}${vatNote} (${ruleNote})` };
  };
  if (rule.mode === 'bundled') {
    const items = rule.bundledRate === null && !rule.perOrderFee ? [] : [make('brokerage', '묶음 수수료', rule.bundledRate, rule.bundledBase, rule.perOrderFee)];
    return { rule, bundled: true, items };
  }
  const items: FeeItem[] = [];
  if (rule.brokerageRate !== null || rule.perOrderFee) items.push(make('brokerage', '중개 수수료', rule.brokerageRate, rule.brokerageBase, rule.perOrderFee));
  if (rule.paymentRate !== null) {
    if (!ctx.hasPlatform && ctx.payKind === 'cash')
      items.push({ category: 'payment', label: '결제 수수료', status: 'notApplicable', amount: 0, base: null, baseLabel: '현금 결제', baseKind: null, rate: rule.paymentRate, perOrderFee: null, vatExclusive: rule.vatExclusive, basis: CASH_FEE_BASIS });
    else items.push(make('payment', '결제 수수료', rule.paymentRate, !ctx.hasPlatform && ctx.payKind === 'unknown' ? 'card' : rule.paymentBase, null));
  }
  return { rule, bundled: false, items };
}

const fmtWon = (n: number) => `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(n)}원`;

/** 사용자에게 보여줄 '필요한 정보' 문구 */
export const FEE_NEED_TEXT: Record<FeeNeed, string> = {
  amount: '매출 금액',
  orders: '완료 주문 수',
  refund: '환불액(없으면 0원)',
  discountRefund: '할인 전 판매액(가게 부담 할인액과 환불액)',
  cardSales: '카드 결제액',
};

/**
 * 식재료비 추정 기준 금액: 할인은 원가를 줄이지 않으므로 할인 전 판매액이 기준.
 * 순매출만 아는 기록은 순매출을 기준으로 쓰되, 실제보다 낮게 추정될 수 있음을 근거 문구에 남긴다.
 */
export function foodEstimateBase(e: SalesAmounts): { amount: number | null; kind: 'gross' | 'net' | null } {
  const g = grossSales(e);
  if (g !== null) return { amount: g, kind: 'gross' };
  const n = netSales(e);
  if (n !== null) return { amount: n, kind: 'net' };
  return { amount: null, kind: null };
}

/** 식재료비 추정: 기준 금액 × 원가율 */
export function estimateFood(e: SalesAmounts, ratePct: number): number | null {
  const base = foodEstimateBase(e).amount;
  if (base === null) return null;
  return round(base * (ratePct / 100));
}

/** 식재료비 추정 근거 문구의 기준 금액 설명 */
export function foodBaseLabel(e: SalesAmounts): string {
  return foodEstimateBase(e).kind === 'net' ? '순매출 (할인·환불 상세가 없어 실제보다 낮게 추정될 수 있음)' : '상품 판매액';
}

export function menuVersionAt(menu: Menu, date: DateStr): MenuVersion | null {
  return pickEffective(menu.versions, date);
}

/** 메뉴 버전의 채널별 원가율(%). 원가 미입력·가격 없음이면 null */
export function menuCostRate(v: MenuVersion, channel: Channel): number | null {
  const price = v.prices[channel];
  if (v.costMode === 'rate') return v.costRate;
  if (v.costMode === 'amount' && v.costAmount !== null && price) return (v.costAmount / price) * 100;
  return null;
}

export function menuCostAmount(v: MenuVersion, channel: Channel): number | null {
  const price = v.prices[channel];
  if (v.costMode === 'amount') return v.costAmount;
  if (v.costMode === 'rate' && v.costRate !== null && price) return (price * v.costRate) / 100;
  return null;
}

/** 판매 중 메뉴의 단순 평균 원가율 (판매량 미반영). 원가가 입력된 메뉴가 없으면 null */
export function averageMenuCostRate(menus: Menu[], channel: Channel, date: DateStr): { rate: number | null; count: number } {
  const rates: number[] = [];
  for (const m of menus) {
    if (!m.onSale) continue;
    const v = menuVersionAt(m, date);
    if (!v) continue;
    const r = menuCostRate(v, channel);
    if (r !== null) rates.push(r);
  }
  if (!rates.length) return { rate: null, count: 0 };
  return { rate: rates.reduce((a, b) => a + b, 0) / rates.length, count: rates.length };
}

/** 사용자가 선택할 수 있는 임시 추정 원가율. 업종 평균이나 검증된 기본값이 아니다. */
export const TEMP_FOOD_RATE = 30;
