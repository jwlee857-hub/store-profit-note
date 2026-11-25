// 매출 기록의 데이터 상태, 금액 기준 전환, 날짜별 입력 현황. UI와 무관한 순수 함수.
import { applicableCategories, coveredByPeriodCost, effectiveCost, grossSales, isOpenDay, netSales, requiredCategories, routeHasPlatform, salesSlots, countsUnderSettlement, settlementFor, type SalesAmounts } from './calc';
import { costBasisOf, costDetailText, costKindOf } from './costBasis';
import { averageMenuCostRate, calcFees, estimateFood, feeRuleFor, foodBaseLabel, foodEstimateBase, payKindOf, pickEffective, type FeeCalc, type FeeNeed } from './estimate';
import { isValidDate } from './dates';
import { fmt } from './format';
import { DIRECT_LABEL } from './labels';
import {
  DIRECT_CATEGORIES,
  PER_ORDER_CATEGORIES,
  type AmountMode,
  type AppData,
  type Channel,
  type CostCalc,
  type CostValue,
  type DateStr,
  type DirectCategory,
  type FoodCostRate,
  type PerOrderCategory,
  type PerOrderCost,
  type SalesEntry,
} from './types';

// ───────── 기록별 데이터 상태 ─────────

/**
 * 필수 비용이 다 채워진 기록은 계산이 끝난 것이므로 '진행 중' 표현을 쓰지 않는다.
 * - salesOnly: 매출 입력 완료 (직접 비용은 아직 아무것도 없음)
 * - needsCheck: 비용은 나중에 보완 (일부 비용은 있지만 필수 비용이 빠짐)
 * - estimated: 추정 포함 (필수 비용이 모두 있고, 모르는 값을 가정한 추정값이 하나 이상) — 사용자가 알아야 하는 상태
 * - calculated: 비용 입력 완료 (필수 비용이 모두 있고, 추정 없이 설정값을 입력값에 적용한 계산액이 하나 이상)
 *   설정한 대로 계산된 것은 당연한 동작이므로 계산 방식을 설명하는 문구를 붙이지 않는다
 * - confirmed: 실제 비용 확인 완료 (모든 비용이 실제 금액)
 */
export type EntryStatus = 'salesOnly' | 'needsCheck' | 'estimated' | 'calculated' | 'confirmed';

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  salesOnly: '매출 입력 완료',
  needsCheck: '비용은 나중에 보완',
  estimated: '추정 포함',
  calculated: '비용 입력 완료',
  confirmed: '실제 비용 확인 완료',
};

/** 비용이 모두 채워졌고 따로 확인할 것이 없는 상태 (버튼을 '비용 확인' 대신 '수정'으로) */
export const isCostDone = (s: EntryStatus) => s === 'confirmed' || s === 'calculated';

/** 여러 기록을 묶을 때 더 확인이 필요한 쪽을 대표 상태로 쓴다 */
const STATUS_RANK: Record<EntryStatus, number> = { needsCheck: 4, salesOnly: 3, estimated: 2, calculated: 1, confirmed: 0 };

export interface EntryStatusDetail {
  status: EntryStatus;
  missing: DirectCategory[];
  /** 모르는 값을 가정한 추정값(또는 근거가 불분명한 값)으로 채운 항목 */
  estimated: DirectCategory[];
  /** 설정값을 입력값에 그대로 적용한 계산액으로 채운 항목 */
  calculated: DirectCategory[];
  /** 실제값 + (실제값 없는 항목의) 계산·추정값. 미입력 항목은 더하지 않는다 */
  knownCost: number;
}

export function entryStatus(e: SalesEntry, data: Pick<AppData, 'routes' | 'periodCosts'>): EntryStatusDetail {
  const hasPlatform = routeHasPlatform(data, e.routeId);
  const req = new Set(requiredCategories(e.channel, hasPlatform, e.bundledFee));
  const missing: DirectCategory[] = [];
  const estimated: DirectCategory[] = [];
  const calculated: DirectCategory[] = [];
  let anyEntered = false;
  let knownCost = 0;
  const settled = settlementFor(data.periodCosts, e);
  for (const c of DIRECT_CATEGORIES) {
    if (c === 'payment' && e.bundledFee) continue;
    // 정산서 기간 합계가 대신하는 수수료 (computeSummary와 같은 규칙)
    if (settled && (c === 'brokerage' || c === 'payment') && !countsUnderSettlement(settled, e.costs[c])) continue;
    const ec = effectiveCost(e.costs[c]);
    if (ec.status !== 'missing') {
      anyEntered = true;
      knownCost += ec.amount!;
      const kind = costKindOf(c, e.costs[c], e);
      if (kind === 'estimated') estimated.push(c);
      else if (kind === 'calculated') calculated.push(c);
    } else if (req.has(c) && !coveredByPeriodCost(data.periodCosts, c, e.channel, e.date)) missing.push(c);
  }
  let status: EntryStatus;
  if (missing.length) status = anyEntered ? 'needsCheck' : 'salesOnly';
  else status = estimated.length ? 'estimated' : calculated.length ? 'calculated' : 'confirmed';
  return { status, missing, estimated, calculated, knownCost };
}

export function worstStatus(list: EntryStatus[]): EntryStatus | null {
  if (!list.length) return null;
  return list.reduce((a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a));
}

// ───────── 금액 기준 전환 ─────────

/**
 * 금액 기준을 바꿀 때 기존 숫자를 조용히 재해석하지 않는다.
 * 변환할 수 있으면 계산해 옮기고, 할 수 없으면 비워 두고 무엇을 확인해야 하는지 알려준다.
 */
export function switchAmountMode(e: SalesEntry, to: AmountMode): { entry: SalesEntry; notice: string | null } {
  if (e.amountMode === to) return { entry: e, notice: null };
  if (to === 'net') {
    if (e.gross === null) return { entry: { ...e, amountMode: 'net', gross: null, netInput: null }, notice: null };
    if (e.storeDiscount === null || e.refund === null) {
      return {
        entry: { ...e, amountMode: 'net', gross: null, netInput: null },
        notice: `할인·환불 금액을 몰라 순매출을 계산하지 않았습니다. 입력했던 판매액 ${fmt(e.gross, 'won')}은 비웠으니 순매출을 입력하세요.`,
      };
    }
    const net = e.gross - e.storeDiscount - e.refund;
    return {
      entry: { ...e, amountMode: 'net', gross: null, netInput: net },
      notice: `판매액 ${fmt(e.gross, 'won')} − 할인 ${fmt(e.storeDiscount, 'won')} − 환불 ${fmt(e.refund, 'won')} = 순매출 ${fmt(net, 'won')}으로 옮겼습니다. 할인·환불은 상세 정보로 남고 다시 빼지 않습니다.`,
    };
  }
  // net → gross
  const g = grossSales(e);
  if (g !== null) {
    return {
      entry: { ...e, amountMode: 'gross', gross: g, netInput: null },
      notice: `순매출 ${fmt(e.netInput, 'won')} + 할인 ${fmt(e.storeDiscount, 'won')} + 환불 ${fmt(e.refund, 'won')} = 판매액 ${fmt(g, 'won')}으로 복원했습니다.`,
    };
  }
  return {
    entry: { ...e, amountMode: 'gross', gross: null, netInput: null },
    notice:
      e.netInput === null
        ? null
        : `할인·환불 상세가 없어 판매액을 계산할 수 없습니다. 입력했던 순매출 ${fmt(e.netInput, 'won')}은 비웠으니 판매액·할인·환불을 입력하세요.`,
  };
}

// ───────── 자동 계산: 수수료·건당 기준 비용·원가율(설정값 적용) · 식재료비(메뉴 평균 원가율 추정) ─────────

/** 날짜에 적용되는 주문 1건당 기본 비용. 경로 지정 값이 판매 방식 공통 값보다 우선 */
export function perOrderCostFor(list: PerOrderCost[], channel: Channel, routeId: string, category: PerOrderCategory, date: DateStr): PerOrderCost | null {
  const same = list.filter((c) => c.channel === channel && c.category === category);
  return pickEffective(same.filter((c) => c.routeId === routeId), date) ?? pickEffective(same.filter((c) => c.routeId === null), date);
}

/** 날짜에 적용되는 가게 설정 원가율(직접 지정). 판매 방식 지정 값이 모든 판매 방식 값보다 우선 */
export function foodRateFor(list: FoodCostRate[] | undefined, channel: Channel, date: DateStr): FoodCostRate | null {
  if (!list?.length) return null;
  return pickEffective(list.filter((r) => r.channel === channel), date) ?? pickEffective(list.filter((r) => r.channel === null), date);
}

type EstimateData = Pick<AppData, 'feeRules' | 'menus'> & Partial<Pick<AppData, 'perOrderCosts' | 'routes' | 'paymentMethods' | 'foodCostRates'>>;

/**
 * 계산값을 넣는다. 근거 문구(데이터)와 계산 내용(calc)을 항상 함께 바꿔 서로 어긋나지 않게 한다.
 * 실제 금액은 그대로 둔다.
 */
export function withEstimate(cv: CostValue, estimated: number | null, estimateBasis: string, calc?: CostCalc): CostValue {
  return { actual: cv.actual, estimated, estimateBasis: estimated === null ? '' : estimateBasis, ...(estimated !== null && calc ? { calc } : {}) };
}

/** 원가율 × 기준 금액으로 식재료비 계산값을 만든다. 기준 금액이 없으면 null */
export function foodRateEstimate(e: SalesAmounts, rate: number, source: Extract<CostCalc, { method: 'foodRate' }>['source'], extra: { label: string; menuCount?: number; effectiveFrom?: DateStr }): { amount: number; basis: string; calc: CostCalc } | null {
  const base = foodEstimateBase(e);
  const v = estimateFood(e, rate);
  if (v === null || base.amount === null || base.kind === null) return null;
  return {
    amount: v,
    basis: `${extra.label} × ${foodBaseLabel(e)}`,
    calc: { method: 'foodRate', source, rate, base: base.amount, baseKind: base.kind, ...(extra.menuCount !== undefined ? { menuCount: extra.menuCount } : {}), ...(extra.effectiveFrom ? { effectiveFrom: extra.effectiveFrom } : {}) },
  };
}

/** 가게 설정 원가율의 근거 문구. '직접 지정 원가율'로 시작해야 이전 판별 규칙과도 같은 출처(설정값)로 읽힌다 */
const storeRateLabel = (r: FoodCostRate) => `직접 지정 원가율 ${r.rate}% (가게 설정, ${r.effectiveFrom}부터 적용)`;

const hasPlatformOf = (data: EstimateData, routeId: string) => !!data.routes?.find((r) => r.id === routeId)?.platformId;

/** 이 기록의 날짜·경로·결제수단에 적용되는 수수료 계산. 적용할 설정이 없으면 null */
export function feeCalcFor(e: SalesEntry, data: EstimateData): FeeCalc | null {
  if (!isValidDate(e.date) || !e.routeId) return null;
  const rule = feeRuleFor(data, e.routeId, e.date);
  if (!rule) return null;
  return calcFees(e, rule, { hasPlatform: hasPlatformOf(data, e.routeId), payKind: payKindOf(data, e.paymentMethodId) });
}

/**
 * 저장할 때 근거 있는 비용만 자동으로 채운다. 실제 금액이나 이미 있는 값은 건드리지 않는다.
 * - 수수료: 날짜·경로에 맞는 설정으로 계산 (모르는 할인·환불·카드 결제액을 0으로 가정하지 않음 → needsInfo)
 * - 포장비·배달비 등: 가게 설정의 주문 1건당 기준 × 주문 수
 * - 식재료비: 가게 설정 원가율(직접 지정)이 있으면 그 원가율 × 기준 금액, 없으면 메뉴 평균 원가율 × 기준 금액(판매 비중 미반영 추정)
 * 근거 문구(estimateBasis)는 이전과 같은 형식으로 남기고, 화면 표시용 계산 내용(calc)을 함께 저장한다.
 */
export function fillEstimates(e: SalesEntry, data: EstimateData): { entry: SalesEntry; applied: string[]; needsInfo: string[]; assumptions: string[] } {
  const costs = { ...e.costs };
  const applied: string[] = [];
  const needsInfo: string[] = [];
  let bundledFee = e.bundledFee;
  const isEmpty = (c: DirectCategory) => costs[c].actual === null && costs[c].estimated === null;
  const fc = feeCalcFor(e, data);
  if (fc) {
    bundledFee = fc.bundled;
    // 묶음 수수료면 결제 수수료를 따로 계산하지 않는다(중복 방지). 직접 넣은 실제 금액은 남긴다
    if (fc.bundled) costs.payment = withEstimate(costs.payment, null, '');
    for (const it of fc.items) {
      if (!isEmpty(it.category)) continue;
      if (it.amount !== null) {
        const calc: CostCalc =
          it.status === 'notApplicable' || it.baseKind === null
            ? { method: 'cashNoFee' }
            : { method: 'feeRule', rate: it.rate, base: it.base, baseLabel: it.baseLabel, baseKind: it.baseKind, perOrderFee: it.perOrderFee, orders: e.orders, vatExclusive: it.vatExclusive, effectiveFrom: fc.rule.effectiveFrom };
        costs[it.category] = withEstimate(costs[it.category], it.amount, it.basis, calc);
        if (it.status === 'ok') applied.push(it.label);
      } else if (it.status === 'needsInfo') needsInfo.push(it.label);
    }
  }
  if (e.orders !== null && data.perOrderCosts?.length) {
    const applicable = new Set(applicableCategories(e.channel, hasPlatformOf(data, e.routeId)));
    for (const cat of PER_ORDER_CATEGORIES) {
      if (!applicable.has(cat) || !isEmpty(cat)) continue;
      const d = perOrderCostFor(data.perOrderCosts, e.channel, e.routeId, cat, e.date);
      if (!d) continue;
      costs[cat] = withEstimate(
        costs[cat],
        Math.round(d.amount * e.orders),
        `가게 설정 기본값: 주문 1건당 ${fmt(d.amount, 'won')} × ${fmt(e.orders, 'orders')} (${d.effectiveFrom}부터 적용)`,
        { method: 'perOrder', unitAmount: d.amount, orders: e.orders, effectiveFrom: d.effectiveFrom },
      );
      applied.push(DIRECT_LABEL[cat]);
    }
  }
  if (isEmpty('food') && isValidDate(e.date)) {
    const sr = foodRateFor(data.foodCostRates, e.channel, e.date);
    const avg = sr ? null : averageMenuCostRate(data.menus, e.channel, e.date);
    const f = sr
      ? foodRateEstimate(e, sr.rate, 'store', { label: storeRateLabel(sr), effectiveFrom: sr.effectiveFrom })
      : avg && avg.rate !== null
        ? foodRateEstimate(e, avg.rate, 'menuAverage', { label: `메뉴 ${avg.count}개 단순 평균 원가율 ${avg.rate.toFixed(1)}%`, menuCount: avg.count })
        : null;
    if (f) {
      // 메뉴 평균은 이전과 같이 근거 문구 끝에 '(판매량 미반영 추정)'을 남긴다
      costs.food = withEstimate(costs.food, f.amount, sr ? f.basis : `${f.basis} (판매량 미반영 추정)`, f.calc);
      applied.push('식재료비');
    }
  }
  // assumptions: 이전 버전 호환용(더 이상 0원 가정을 쓰지 않으므로 항상 비어 있음)
  return { entry: { ...e, costs, bundledFee }, applied, needsInfo, assumptions: [] };
}

// ───────── 자동 계산 미리보기 (빠른 입력 화면) ─────────

export interface CostPreviewLine {
  category: DirectCategory;
  label: string;
  /** ok: 계산됨(금액만 표시) · estimated: 추정 · needsInput: 입력이 더 필요 · notApplicable: 적용 안 함(0원) */
  state: 'ok' | 'estimated' | 'needsInput' | 'notApplicable';
  amount: number | null;
  /** 상세 보기의 계산식 ("건당 500원 × 10건") */
  detail: string;
  /** 추정일 때 가정한 내용 */
  assumption: string | null;
  /** 입력이 필요할 때 안내 ("주문 수를 입력해 주세요") */
  prompt: string | null;
}

/** 입력이 필요한 값별 안내 문구 */
export const NEED_PROMPT: Record<FeeNeed, string> = {
  amount: '매출 금액을 입력해 주세요',
  orders: '주문 수를 입력해 주세요',
  refund: '환불액을 입력해 주세요(없으면 0원)',
  discountRefund: '가게 부담 할인액과 환불액을 입력해 주세요',
  cardSales: '카드 결제액을 입력해 주세요',
};

/**
 * 빠른 입력 화면의 자동 계산 결과. 저장할 때와 같은 fillEstimates로 계산하므로 보이는 금액 = 저장되는 금액이다.
 * 설정은 있는데 입력이 모자라 계산하지 못한 항목은 무엇을 넣어야 하는지 알려준다.
 */
export function autoCostPreview(e: SalesEntry, data: EstimateData): CostPreviewLine[] {
  if (!isValidDate(e.date) || !e.routeId) return [];
  const filled = fillEstimates(e, data).entry;
  const lines: CostPreviewLine[] = [];
  const fc = feeCalcFor(e, data);
  const labelOf = (c: DirectCategory) => (c === 'brokerage' && filled.bundledFee ? '묶음 수수료' : DIRECT_LABEL[c]);
  for (const c of DIRECT_CATEGORIES) {
    const cv = filled.costs[c];
    if (cv.actual !== null || cv.estimated === null || e.costs[c].estimated !== null) continue; // 이번 계산으로 채운 값만
    const info = costBasisOf(c, cv, filled);
    lines.push({
      category: c,
      label: labelOf(c),
      state: info.method === 'cashNoFee' ? 'notApplicable' : info.kind === 'estimated' ? 'estimated' : 'ok',
      amount: cv.estimated,
      detail: costDetailText(cv),
      assumption: info.assumption,
      prompt: null,
    });
  }
  // 설정은 있지만 계산하지 못한 항목: 수수료(필요한 정보), 주문 1건당 비용(주문 수)
  for (const it of fc?.items ?? []) {
    if (it.status !== 'needsInfo' || lines.some((l) => l.category === it.category)) continue;
    lines.push({ category: it.category, label: it.label, state: 'needsInput', amount: null, detail: '', assumption: null, prompt: NEED_PROMPT[it.need ?? 'amount'] });
  }
  if (e.orders === null) {
    const applicable = new Set(applicableCategories(e.channel, hasPlatformOf(data, e.routeId)));
    for (const cat of PER_ORDER_CATEGORIES) {
      if (!applicable.has(cat) || e.costs[cat].actual !== null || e.costs[cat].estimated !== null) continue;
      if (!perOrderCostFor(data.perOrderCosts ?? [], e.channel, e.routeId, cat, e.date)) continue;
      lines.push({ category: cat, label: DIRECT_LABEL[cat], state: 'needsInput', amount: null, detail: '', assumption: null, prompt: NEED_PROMPT.orders });
    }
  }
  return lines.sort((a, b) => DIRECT_CATEGORIES.indexOf(a.category) - DIRECT_CATEGORIES.indexOf(b.category));
}

// ───────── 자동 계산 상태 (입력 화면 표시용) ─────────

export interface OtherCostLine {
  category: DirectCategory;
  label: string;
  kind: 'perOrder' | 'reference';
  text: string;
  amount: number | null;
}

export interface AutoCalcSummary {
  /** null = 이 날짜·경로에 수수료 설정 없음 */
  fee: FeeCalc | null;
  /** 사용자가 더 넣어야 하는 정보 (매출 금액·주문 수 같은 기본 칸 제외). 필요할 때만 안내 */
  needs: { need: FeeNeed; labels: string[] }[];
  /** 수수료 외 자동 계산: 건당 기준 비용(계산), 식재료비(참고 추정) */
  others: OtherCostLine[];
}

export function autoCalcSummary(e: SalesEntry, data: EstimateData): AutoCalcSummary {
  const fee = feeCalcFor(e, data);
  const needs: AutoCalcSummary['needs'] = [];
  for (const it of fee?.items ?? []) {
    if (it.status !== 'needsInfo' || !it.need || it.need === 'amount' || it.need === 'orders') continue;
    const found = needs.find((n) => n.need === it.need);
    if (found) found.labels.push(it.label);
    else needs.push({ need: it.need, labels: [it.label] });
  }
  const others: OtherCostLine[] = [];
  if (isValidDate(e.date) && e.routeId) {
    const applicable = new Set(applicableCategories(e.channel, hasPlatformOf(data, e.routeId)));
    for (const cat of PER_ORDER_CATEGORIES) {
      if (!applicable.has(cat)) continue;
      const d = perOrderCostFor(data.perOrderCosts ?? [], e.channel, e.routeId, cat, e.date);
      if (!d) continue;
      others.push({
        category: cat,
        label: DIRECT_LABEL[cat],
        kind: 'perOrder',
        text: e.orders === null ? NEED_PROMPT.orders : `건당 ${fmt(d.amount, 'won')} × ${fmt(e.orders, 'orders')}`,
        amount: e.orders === null ? null : Math.round(d.amount * e.orders),
      });
    }
    const avg = averageMenuCostRate(data.menus, e.channel, e.date);
    if (avg.rate !== null)
      others.push({
        category: 'food',
        label: DIRECT_LABEL.food,
        kind: 'reference',
        text: `추정: 메뉴 ${avg.count}개 평균 원가율 ${avg.rate.toFixed(1)}% · 메뉴별 판매 비중을 몰라 단순 평균을 씀`,
        amount: estimateFood(e, avg.rate),
      });
  }
  return { fee, needs, others };
}

// ───────── 비용 출처 표시 ─────────

/**
 * 상세 화면의 비용 출처. 근거 구분(costBasis.ts)을 화면용으로 나눈 것이다.
 * - feeCalc / perOrderCalc / rateCalc: 설정값을 그대로 적용한 계산 (수수료율 / 주문 1건당 금액 / 직접 정한 원가율) — 배지 없이 금액만
 * - reference: 추정 (메뉴 원가율 단순 평균) · estimated: 추정 (그 밖의 가정) · unknownBasis: 추정 (근거 불분명)
 * 라벨이 빈 문자열이면 배지를 붙이지 않는다.
 */
export type CostSourceKind =
  | 'settled'
  | 'actual'
  | 'feeCalc'
  | 'perOrderCalc'
  | 'rateCalc'
  | 'reference'
  | 'estimated'
  | 'unknownBasis'
  | 'notApplicable'
  | 'needsInfo'
  | 'missing';

export const COST_SOURCE_LABEL: Record<CostSourceKind, string> = {
  settled: '정산 금액',
  actual: '실제 금액',
  feeCalc: '',
  perOrderCalc: '',
  rateCalc: '',
  reference: '추정',
  estimated: '추정',
  unknownBasis: '추정 · 근거 불분명',
  notApplicable: '적용 안 함(현금)',
  needsInfo: '계산 불가 · 정보 필요',
  missing: '미입력',
};

/** 출처가 설정값을 적용한 계산인가 */
export const isCalculatedSource = (k: CostSourceKind) => k === 'feeCalc' || k === 'perOrderCalc' || k === 'rateCalc' || k === 'notApplicable';
/** 출처가 추정인가 */
export const isEstimatedSource = (k: CostSourceKind) => k === 'reference' || k === 'estimated' || k === 'unknownBasis';

/** 계산액을 정산 확인액처럼, 추정을 설정 기준 계산처럼 보이지 않게 비용 값의 출처를 구분한다 */
export function costSourceOf(cat: DirectCategory, cv: SalesEntry['costs'][DirectCategory], needsInfo = false, e?: SalesAmounts): CostSourceKind {
  const info = costBasisOf(cat, cv, e);
  switch (info.method) {
    case 'settled':
    case 'actual':
      return info.method;
    case 'cashNoFee':
      return 'notApplicable';
    case 'feeRule':
      return 'feeCalc';
    case 'perOrder':
      return 'perOrderCalc';
    case 'userRate':
      return 'rateCalc';
    case 'menuAverage':
      return 'reference';
    case 'unknown':
      return 'unknownBasis';
    case 'missing':
      return needsInfo ? 'needsInfo' : 'missing';
    default:
      return 'estimated';
  }
}

// ───────── 계산 근거가 바뀐 자동 계산값 갱신 ─────────

/** 자동 계산에 쓰이는 값. 이 중 하나라도 바뀌면 저장된 계산값은 다시 계산해야 한다 */
export function estimateInputsKey(e: SalesEntry): string {
  return JSON.stringify([netSales(e), grossSales(e), e.storeDiscount, e.refund, e.orders, e.date, e.channel, e.routeId, e.paymentMethodId, e.cardSales]);
}

/**
 * 실제값이 없는 항목의 기존 계산·추정값을 현재 값으로 다시 계산한다. 실제 금액(정산 확인액)은 건드리지 않는다.
 * - 수수료·주문 1건당 기본값·메뉴 평균 원가율: 현재 설정으로 다시 계산
 * - 직접 지정한 원가율(근거 문구의 "원가율 N%"): 같은 원가율로 다시 계산
 * - 다시 계산할 근거가 없으면 오래된 값을 지우고 removed에 알린다(미입력·계산 불가로 표시됨)
 * 원래 값이 없던 항목은 새로 채우지 않는다.
 */
export function refreshEstimates(e: SalesEntry, data: EstimateData): { entry: SalesEntry; updated: string[]; removed: string[] } {
  const targets = DIRECT_CATEGORIES.filter((c) => e.costs[c].actual === null && e.costs[c].estimated !== null);
  if (!targets.length) return { entry: e, updated: [], removed: [] };
  const cleared = { ...e, costs: { ...e.costs } };
  for (const c of targets) cleared.costs[c] = withEstimate(cleared.costs[c], null, '');
  const fresh = fillEstimates(cleared, data).entry;
  const costs = { ...e.costs };
  const updated: string[] = [];
  const removed: string[] = [];
  for (const c of targets) {
    const old = e.costs[c];
    let next = fresh.costs[c];
    // 기록에서 직접 고른 원가율(직접 지정·임시)은 같은 원가율로 다시 계산한다. 가게 설정 원가율은 위에서 현재 설정으로 다시 계산됨
    const oldCalc = old.calc && old.calc.method === 'foodRate' ? old.calc : null;
    const manualRate = c === 'food' && (oldCalc ? oldCalc.source === 'entry' || oldCalc.source === 'temp' : true) && /(직접 지정|임시 추정) 원가율 ([\d.]+)%/.exec(old.estimateBasis);
    if (manualRate && !(oldCalc === null && old.estimateBasis.includes('(가게 설정,'))) {
      const rate = oldCalc ? oldCalc.rate : Number(manualRate[2]);
      const source = oldCalc ? oldCalc.source : manualRate[1] === '임시 추정' ? 'temp' : 'entry';
      const f = foodRateEstimate(e, rate, source, { label: old.estimateBasis.split(' × ')[0] });
      next = f ? withEstimate(old, f.amount, f.basis, f.calc) : withEstimate(old, null, '');
    }
    if (next.estimated === null) {
      costs[c] = withEstimate(old, null, '');
      removed.push(DIRECT_LABEL[c]);
    } else {
      costs[c] = withEstimate(old, next.estimated, next.estimateBasis, next.calc);
      if (next.estimated !== old.estimated) updated.push(DIRECT_LABEL[c]);
    }
  }
  return { entry: { ...e, costs, bundledFee: fresh.bundledFee }, updated, removed };
}

/**
 * 입력 화면용: 기존 계산값은 현재 값으로 갱신하고, 비어 있는 항목은 근거가 있으면 새로 계산한다.
 * 새 기록이거나 계산 근거가 바뀐 기록에만 쓴다(그대로 연 과거 기록은 조용히 재계산하지 않음).
 */
export function recalcAuto(e: SalesEntry, data: EstimateData): { entry: SalesEntry; updated: string[]; removed: string[]; needsInfo: string[] } {
  const r = refreshEstimates(e, data);
  const f = fillEstimates(r.entry, data);
  return { entry: f.entry, updated: r.updated, removed: r.removed, needsInfo: f.needsInfo };
}

// ───────── 날짜별 입력 현황 ─────────

// 성과 비교의 입력 현황(channelCoverage)과 같은 경로 목록을 쓴다
export { salesSlots, type SalesSlot } from './calc';
import type { SalesSlot } from './calc';

/** 마감 미입력 날을 '매출 없음'으로 확인: 그날 사용 중인 경로 중 기록이 없는 곳을 모두 매출 없음(0원 확인)으로 */
export function markDayNoSales(d: AppData, date: DateStr): AppData {
  const checkedAt = new Date().toISOString();
  const add = salesSlots(d, date)
    .filter((s) => !d.sales.some((e) => e.date === date && e.channel === s.channel && e.routeId === s.routeId))
    .filter((s) => !d.salesChecks.some((c) => c.date === date && c.channel === s.channel && c.routeId === s.routeId))
    .map((s) => ({ date, channel: s.channel, routeId: s.routeId, status: 'noSales' as const, checkedAt }));
  return { ...d, salesChecks: [...d.salesChecks, ...add] };
}

/** 마감 미입력 날을 임시 휴업으로 (그날의 기존 영업·휴업 설정은 바꿔 넣는다) */
export function markDayClosed(d: AppData, date: DateStr, note = '임시 휴업'): AppData {
  return { ...d, dayOverrides: [...d.dayOverrides.filter((o) => o.date !== date), { date, open: false, note }] };
}

export type SlotState =
  | { kind: 'entered'; status: EntryStatus; entries: SalesEntry[]; net: number | null }
  | { kind: 'noSales' }
  | { kind: 'closed' }
  | { kind: 'missing' };

export interface DayStatus {
  date: DateStr;
  open: boolean;
  slots: (SalesSlot & { state: SlotState })[];
  enteredCount: number;
  missingCount: number;
}

/**
 * 날짜별 입력 현황. 기록이 없다는 이유로 매출 0원으로 보지 않는다.
 * - 휴업일이면 closed, 사용자가 확인한 경우에만 noSales, 그 외는 missing(미입력)
 */
export function dayInputStatus(data: Pick<AppData, 'store' | 'routes' | 'sales' | 'salesChecks' | 'dayOverrides' | 'periodCosts'>, date: DateStr): DayStatus {
  const open = isOpenDay(data, date);
  const slots = salesSlots(data, date).map((s) => {
    const entries = data.sales.filter((e) => e.date === date && e.channel === s.channel && e.routeId === s.routeId);
    let state: SlotState;
    if (entries.length) {
      const nets = entries.map((e) => netSales(e));
      state = {
        kind: 'entered',
        status: worstStatus(entries.map((e) => entryStatus(e, data).status))!,
        entries,
        net: nets.some((n) => n === null) ? null : nets.reduce<number>((a, b) => a + (b ?? 0), 0),
      };
    } else if (data.salesChecks.some((c) => c.date === date && c.channel === s.channel && c.routeId === s.routeId && c.status === 'noSales')) state = { kind: 'noSales' };
    else if (!open) state = { kind: 'closed' };
    else state = { kind: 'missing' };
    return { ...s, state };
  });
  return {
    date,
    open,
    slots,
    enteredCount: slots.filter((s) => s.state.kind === 'entered' || s.state.kind === 'noSales').length,
    missingCount: slots.filter((s) => s.state.kind === 'missing').length,
  };
}

// ───────── 판매 방식별 입력 현황 (홀 / 배달 / 포장) ─────────

export type ChannelGroupState = 'missing' | 'partial' | 'done' | 'noSales' | 'closed';

export interface ChannelGroup {
  channel: Channel;
  slots: DayStatus['slots'];
  /** 경로 수 (같은 경로의 결제수단별 기록은 한 경로로 센다) */
  routeCount: number;
  /** 매출 입력 또는 '매출 없음' 확인이 된 경로 수 */
  doneCount: number;
  /** 화면 표시용 합계(저장하지 않음). 입력된 경로의 매출만 더하고 미입력은 0원으로 보지 않는다. 입력·확인이 하나도 없으면 null */
  total: number | null;
  /** 입력된 기록 중 매출 금액이 비어 있는 것이 있어 합계가 불완전함 */
  amountMissing: boolean;
  state: ChannelGroupState;
  /** 주요 버튼이 이어서 열 경로: 첫 미입력 경로(휴업일이면 첫 경로) */
  nextSlot: DayStatus['slots'][number] | null;
}

/**
 * 날짜별 경로 상태를 판매 방식별로 묶는다. 기존 경로별 판정(dayInputStatus)을 그대로 쓰고, 매출 계산 기준도 같다.
 * - 완료: 모든 경로가 매출 입력 또는 '매출 없음' 확인
 * - 매출 없음: 모든 경로가 '매출 없음' 확인 (0원이 사실로 확인된 경우)
 * - 일부 입력: 일부 경로만 입력·확인 / 미입력: 하나도 없음 / 휴업: 기록 없이 휴업일
 */
export function groupDayStatus(day: DayStatus): ChannelGroup[] {
  const order: Channel[] = [];
  for (const s of day.slots) if (!order.includes(s.channel)) order.push(s.channel);
  return order.map((channel) => {
    const slots = day.slots.filter((s) => s.channel === channel);
    const done = slots.filter((s) => s.state.kind === 'entered' || s.state.kind === 'noSales');
    const missing = slots.filter((s) => s.state.kind === 'missing');
    const entered = slots.filter((s) => s.state.kind === 'entered') as (DayStatus['slots'][number] & { state: Extract<SlotState, { kind: 'entered' }> })[];
    const amountMissing = entered.some((s) => s.state.net === null);
    const total = done.length ? entered.reduce((sum, s) => sum + (s.state.net ?? 0), 0) : null;
    let state: ChannelGroupState;
    if (missing.length) state = done.length ? 'partial' : 'missing';
    else if (!done.length) state = 'closed';
    else state = entered.length ? 'done' : 'noSales';
    const nextSlot = missing[0] ?? (state === 'closed' ? slots[0] : null) ?? null;
    return { channel, slots, routeCount: slots.length, doneCount: done.length, total, amountMissing, state, nextSlot };
  });
}
