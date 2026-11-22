// 비용 금액의 근거 구분과 화면 표시. 저장된 값은 바꾸지 않는다.
//
// 데이터 판별 (costBasisOf)
// - 실제(actual): 영수증·정산서에서 확인해 입력한 금액. 있으면 항상 이 값만 쓴다.
// - 설정 기준 계산(calculated): 사용자가 정한 설정값(수수료율·주문 1건당 금액·직접 정한 원가율)을
//   이 기록에 입력된 값(매출 금액·주문 수·카드 결제액 등)에 그대로 적용한 금액. 가정한 값이 없다.
// - 추정(estimated): 계산에 필요한 값 중 하나라도 모르는 값을 가정한 금액
//   (메뉴 원가율 단순 평균, 모르는 할인·환불을 0원으로 가정, 검증되지 않은 임시 원가율 등).
//   근거가 기록되지 않았거나 알아볼 수 없는 기존 값도 '실제'나 '설정 기준 계산'으로 단정하지 않고 추정으로 둔다.
// 판별 순서: v7부터 저장하는 계산 내용(calc)이 있으면 그것으로, 없으면(이전 기록) 저장된 근거 문구(estimateBasis)로.
// 근거 문구는 이전 기록 판별에 쓰는 데이터이므로 형식을 바꾸지 않는다.
//
// 화면 표시 (costDetailText, basisMix)
// - 정상적으로 계산된 값(실제·설정 기준 계산)은 배지 없이 금액만, 상세에는 계산식만 보여준다.
// - 사용자가 알아야 하는 경우(추정, 계산에 필요한 입력 없음)만 따로 표시한다.
import type { SalesAmounts } from './calc';
import { fmt } from './format';
import type { CostCalc, CostValue, DirectCategory, FeeBase } from './types';

export type CostKind = 'actual' | 'calculated' | 'estimated' | 'missing';

/** 세부 근거 */
export type CostMethod =
  | 'settled' // 정산서 확인 수수료
  | 'actual' // 실제 금액
  | 'feeRule' // 수수료 설정 × 기준금액
  | 'perOrder' // 주문 1건당 설정 금액 × 주문 수
  | 'userRate' // 직접 정한 원가율 × 상품 판매액
  | 'cashNoFee' // 현금 결제라 결제 수수료 적용 안 함
  | 'menuAverage' // 메뉴 원가율 단순 평균 (판매 비중 미반영)
  | 'tempRate' // 검증되지 않은 임시 원가율
  | 'assumedZero' // 모르는 할인·환불을 0원으로 가정
  | 'netBase' // 할인 전 판매액을 몰라 순매출로 대신함
  | 'blankAsZero' // 이전 기록: 비어 있는 할인·환불을 0원으로 보고 계산했을 수 있음
  | 'unknown' // 근거 기록 없음·알아볼 수 없음
  | 'missing';

export interface CostBasisInfo {
  kind: CostKind;
  method: CostMethod;
  /** 저장된 근거 문구 (데이터). 비어 있으면 설명 */
  basis: string;
  /** 추정일 때 가정한 내용. 설정 기준 계산·실제에는 없음 */
  assumption: string | null;
}

export const FEE_BASE_LABEL: Record<FeeBase, string> = { gross: '할인·환불 전 판매액', afterDiscount: '할인 후·환불 전 금액', net: '매출 금액(순매출)' };
export const CASH_FEE_BASIS = '현금 결제: 카드 결제 수수료 없음';

const FEE_CATS: DirectCategory[] = ['brokerage', 'payment'];

const A_MENU_AVG = '메뉴별 판매 비중을 몰라 판매 중 메뉴 원가율의 단순 평균을 썼어요';
const A_TEMP = '원가를 몰라 검증되지 않은 임시 원가율을 썼어요';
const A_NET = '할인·환불 상세가 없어 할인 전 판매액 대신 순매출을 기준으로 썼어요';
const A_BLANK = '비어 있는 할인·환불을 0원으로 보고 기준금액을 계산했어요';

/** 판매액 기준(gross) 이전 기록에서 할인·환불 칸이 비어 있는가 (순매출 계산이 빈칸을 0원으로 본다) */
function blankDiscountRefund(e: SalesAmounts | undefined): boolean {
  if (!e || e.amountMode === 'net' || e.gross === null) return false;
  return e.storeDiscount === null || e.refund === null;
}

/** 근거 문구에서 '…가정…' 부분만 뽑는다 */
function assumptionPart(b: string): string {
  const seg = b.split(' · ').find((s) => s.includes('가정'));
  return (seg ?? b).trim();
}

/** v7 계산 내용으로 판별 */
function fromCalc(c: CostCalc, b: string, e: SalesAmounts | undefined): CostBasisInfo {
  const calc = (method: CostMethod): CostBasisInfo => ({ kind: 'calculated', method, basis: b, assumption: null });
  const est = (method: CostMethod, assumption: string): CostBasisInfo => ({ kind: 'estimated', method, basis: b, assumption });
  switch (c.method) {
    case 'perOrder':
      return calc('perOrder');
    case 'cashNoFee':
      return calc('cashNoFee');
    case 'feeRule':
      if ((c.baseKind === 'afterDiscount' || c.baseKind === 'net') && blankDiscountRefund(e)) return est('blankAsZero', A_BLANK);
      return calc('feeRule');
    case 'foodRate': {
      const net = c.baseKind === 'net';
      if (c.source === 'menuAverage') return est('menuAverage', net ? `${A_MENU_AVG} · ${A_NET}` : A_MENU_AVG);
      if (c.source === 'temp') return est('tempRate', net ? `${A_TEMP} · ${A_NET}` : A_TEMP);
      return net ? est('netBase', A_NET) : calc('userRate');
    }
  }
}

/**
 * 비용 값 하나의 근거. e(같은 기록의 매출 금액 필드)를 넘기면 이전 기록의 빈칸 가정까지 확인한다.
 * 계산 내용(calc)이 없는 이전 값은 앱이 만든 근거 문구 형식만 인정하고, 알아볼 수 없으면 추정(근거 불분명)으로 둔다.
 */
export function costBasisOf(cat: DirectCategory, cv: CostValue | undefined, e?: SalesAmounts): CostBasisInfo {
  const isFee = FEE_CATS.includes(cat);
  if (!cv) return { kind: 'missing', method: 'missing', basis: '', assumption: null };
  if (cv.actual !== null && cv.actual !== undefined)
    return { kind: 'actual', method: isFee ? 'settled' : 'actual', basis: isFee ? '정산서에서 확인한 금액' : '영수증 등에서 확인한 실제 금액', assumption: null };
  if (cv.estimated === null || cv.estimated === undefined) return { kind: 'missing', method: 'missing', basis: '', assumption: null };

  const b = (cv.estimateBasis ?? '').trim();
  if (cv.calc && typeof cv.calc === 'object' && 'method' in cv.calc) return fromCalc(cv.calc, b, e);

  // ── 이전 기록: 저장된 근거 문구로 판별 ──
  const est = (method: CostMethod, assumption: string): CostBasisInfo => ({ kind: 'estimated', method, basis: b || '저장된 계산 근거 없음', assumption });
  if (b === CASH_FEE_BASIS) return { kind: 'calculated', method: 'cashNoFee', basis: b, assumption: null };
  if (!b) return est('unknown', '어떻게 구한 금액인지 기록이 없어 추정으로 표시해요');

  // 가정이 들어간 계산 (설정 요율을 썼더라도 값 하나를 가정했다면 추정)
  if (b.includes('0원으로 가정')) return est('assumedZero', assumptionPart(b));
  const netNote = b.includes('순매출 (할인·환불 상세가 없어') ? A_NET : '';
  const withNet = (s: string) => (netNote ? `${s} · ${netNote}` : s);
  if (b.includes('평균 원가율')) return est('menuAverage', withNet(A_MENU_AVG));
  if (b.includes('임시 추정 원가율')) return est('tempRate', withNet(A_TEMP));
  if (netNote) return est('netBase', netNote);

  // 설정값을 입력값에 그대로 적용한 계산
  let method: CostMethod | null = null;
  if (isFee && (b.startsWith('설정 기준 계산') || /적용 규칙/.test(b))) method = 'feeRule';
  else if (b.startsWith('가게 설정 기본값') && b.includes('주문 1건당')) method = 'perOrder';
  else if (cat === 'food' && b.startsWith('직접 지정 원가율')) method = 'userRate';
  if (!method) return est('unknown', '계산 근거를 알아볼 수 없어 추정으로 표시해요');

  // 판매액 기준 이전 기록: 할인·환불 빈칸을 0원으로 보고 기준금액을 만들었을 수 있다(판매액·카드 결제액 기준은 해당 없음)
  if (method === 'feeRule' && blankDiscountRefund(e)) {
    const grossOnly = b.startsWith('설정 기준 계산') && !b.includes(FEE_BASE_LABEL.afterDiscount) && !b.includes(FEE_BASE_LABEL.net);
    if (!grossOnly) return est('blankAsZero', A_BLANK);
  }
  return { kind: 'calculated', method, basis: b, assumption: null };
}

export function costKindOf(cat: DirectCategory, cv: CostValue | undefined, e?: SalesAmounts): CostKind {
  return costBasisOf(cat, cv, e).kind;
}

// ───────── 화면 표시 ─────────

/**
 * 비용 항목에 붙일 짧은 표시. 정상 계산(실제·설정 기준 계산)은 null(배지 없음).
 * 추정만 '추정', 근거를 알 수 없는 이전 값은 '추정 · 근거 불분명'.
 */
export function costFlag(info: CostBasisInfo): string | null {
  if (info.kind !== 'estimated') return null;
  return info.method === 'unknown' ? '추정 · 근거 불분명' : '추정';
}

const BASE_SHORT: Record<'gross' | 'net', string> = { gross: '상품 판매액', net: '순매출' };

/**
 * 상세 화면의 계산식. 계산 내용(calc)이 있으면 그것으로 짧게 만들고("건당 500원 × 10건"),
 * 없으면(이전 기록) 저장된 근거 문구를 그대로 보여준다(저장 당시 근거 유지).
 */
export function costDetailText(cv: Pick<CostValue, 'estimateBasis' | 'calc'>): string {
  const c = cv.calc;
  if (!c || typeof c !== 'object' || !('method' in c)) return (cv.estimateBasis ?? '').trim();
  switch (c.method) {
    case 'perOrder':
      return `건당 ${fmt(c.unitAmount, 'won')} × ${fmt(c.orders, 'orders')}`;
    case 'cashNoFee':
      return '현금 결제라 결제 수수료 없음';
    case 'feeRule': {
      const parts = [c.rate !== null && c.base !== null ? `${c.baseLabel} ${fmt(c.base, 'won')} × ${c.rate}%` : '', c.perOrderFee ? `건당 ${fmt(c.perOrderFee, 'won')} × ${fmt(c.orders, 'orders')}` : '']
        .filter(Boolean)
        .join(' + ');
      return `${parts}${c.vatExclusive ? ' (부가세 10% 가산)' : ''}`;
    }
    case 'foodRate': {
      const base = `${BASE_SHORT[c.baseKind]} ${fmt(c.base, 'won')}`;
      if (c.source === 'menuAverage') return `${base} × 메뉴 ${c.menuCount ?? ''}개 평균 원가율 ${c.rate.toFixed(1)}%`;
      if (c.source === 'temp') return `${base} × 임시 원가율 ${c.rate}%`;
      return `${base} × 원가율 ${c.rate}%`;
    }
  }
}

// ───────── 합계의 근거 표시 ─────────

/** 실제·설정 기준 계산·추정 금액을 나눠 담은 합계 */
export interface BasisAmounts {
  actual: number;
  calculated: number;
  estimated: number;
}

/**
 * 합계 하나에 붙일 표시. 추정이 하나라도 있으면 모두 추정이면 '추정', 섞였으면 '추정 포함'.
 * 실제·설정 기준 계산만 있으면 정상 계산이므로 표시하지 않는다(null).
 */
export function basisMix(b: BasisAmounts): { text: string; tone: 'amber' } | null {
  const total = b.actual + b.calculated + b.estimated;
  if (b.estimated > 0) return { text: b.estimated >= total ? '추정' : '추정 포함', tone: 'amber' };
  return null;
}

export const ESTIMATED_HINT = '모르는 값을 가정해 구한 추정 금액이 들어 있어요(예: 메뉴 원가율 단순 평균, 모르는 할인·환불 0원, 지난달 청구액). 정산서·영수증 금액을 넣으면 그 금액만 반영해요.';
