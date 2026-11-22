// 매출 금액 입력 모델 (화면용).
// 화면에는 언제나 "매출 금액 = 가게 부담 할인·환불을 반영하고 수수료·배달비를 빼기 전 금액"(순매출) 하나만 보여준다.
// 할인·환불은 분석용 상세이며 매출 금액에서 다시 빼지 않는다.
// 저장 형식(SalesEntry.amountMode 'gross' | 'net')은 바꾸지 않는다:
//  - 기존 기록을 열어 금액·상세를 고치지 않고 저장하면 원래 필드를 그대로 둔다(판매액 기준 기록도 그대로).
//  - 고친 경우에만 순매출 기준(net)으로 저장하고, 알고 있는 할인·환불은 상세로 남긴다.
import { grossSales, netSales } from './calc';
import { fmt } from './format';
import type { SalesEntry } from './types';

export interface AmountForm {
  /** 매출 금액(순매출). null = 미입력 */
  net: number | null;
  /** 가게 부담 할인액. null = 모름(0원이 아님) */
  discount: number | null;
  /** 환불액. null = 모름(0원이 아님) */
  refund: number | null;
}

type AmountFields = Pick<SalesEntry, 'amountMode' | 'gross' | 'netInput' | 'storeDiscount' | 'refund'>;

/** 저장된 기록 → 화면 값. 판매액 기준 기록도 매출 금액에는 계산된 순매출을 보여준다 */
export function formFromEntry(e: AmountFields): AmountForm {
  return { net: netSales(e), discount: e.storeDiscount, refund: e.refund };
}

export function sameForm(a: AmountForm, b: AmountForm): boolean {
  return a.net === b.net && a.discount === b.discount && a.refund === b.refund;
}

/**
 * 화면 값 → 저장 필드.
 * 처음 연 값(initial)과 같으면 원래 필드를 그대로 돌려준다(합계·입력 출처 보존, 일괄 변환 없음).
 * 달라졌으면 순매출 기준으로 저장한다. 할인·환불은 상세로만 남고 매출에서 다시 빼지 않는다.
 */
export function amountFieldsFromForm(original: AmountFields, initial: AmountForm, form: AmountForm): AmountFields {
  if (sameForm(initial, form))
    return { amountMode: original.amountMode, gross: original.gross, netInput: original.netInput, storeDiscount: original.storeDiscount, refund: original.refund };
  return { amountMode: 'net', gross: null, netInput: form.net, storeDiscount: form.discount, refund: form.refund };
}

/** 할인·환불 상세가 모두 있을 때만 복원한 할인·환불 전 판매액. 하나라도 모르면 null */
export function restoredGross(form: AmountForm): number | null {
  return grossSales({ amountMode: 'net', gross: null, netInput: form.net, storeDiscount: form.discount, refund: form.refund });
}

// ───────── 할인 전 금액 계산 도우미 ─────────

export interface HelperInput {
  gross: number | null;
  discount: number | null;
  refund: number | null;
}

export type HelperResult =
  | { ok: true; net: number }
  | { ok: false; errors: Partial<Record<keyof HelperInput, string>> };

/**
 * 기록할 매출 = 판매액 − 가게 부담 할인액 − 환불액.
 * 모르는 값을 0원으로 확정하지 않는다: 세 칸 모두 입력(없으면 0 또는 '없음')해야 계산한다.
 */
export function computeHelper(h: HelperInput): HelperResult {
  const errors: Partial<Record<keyof HelperInput, string>> = {};
  if (h.gross === null) errors.gross = '할인·환불 전 판매액을 입력하세요.';
  else if (h.gross <= 0) errors.gross = '판매액은 0보다 커야 합니다.';
  if (h.discount === null) errors.discount = "할인이 없었다면 0을 넣거나 '없음'을 누르세요.";
  else if (h.discount < 0) errors.discount = '할인액은 0 이상이어야 합니다.';
  if (h.refund === null) errors.refund = "환불이 없었다면 0을 넣거나 '없음'을 누르세요.";
  else if (h.refund < 0) errors.refund = '환불액은 0 이상이어야 합니다.';
  if (!Object.keys(errors).length && h.discount! + h.refund! > h.gross!)
    errors.discount = `할인과 환불의 합(${fmt(h.discount! + h.refund!, 'won')})이 판매액(${fmt(h.gross, 'won')})보다 큽니다.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, net: h.gross! - h.discount! - h.refund! };
}

/**
 * 도우미를 열 때 보여줄 값. 매출·할인·환불이 모두 있으면 서로 맞는 판매액을 복원해 보여주고,
 * 아니면 알고 있는 할인·환불만 채운다(판매액은 비움).
 */
export function helperPrefill(form: AmountForm): HelperInput {
  return { gross: restoredGross(form), discount: form.discount, refund: form.refund };
}

/** 도우미 값을 적용했을 때 바뀌는 항목 (적용 전 미리 보여주기용). 바뀌지 않는 항목은 빼고, 비어 있던 칸은 '미입력'으로 표시 */
export function helperChanges(form: AmountForm, h: HelperInput, net: number): { label: string; from: string; to: string }[] {
  const show = (v: number | null) => (v === null ? '미입력' : fmt(v, 'won'));
  const out: { label: string; from: string; to: string }[] = [];
  if (form.net !== null && form.net !== net) out.push({ label: '매출 금액', from: show(form.net), to: show(net) });
  if (form.discount !== null && form.discount !== h.discount) out.push({ label: '가게 부담 할인액', from: show(form.discount), to: show(h.discount) });
  if (form.refund !== null && form.refund !== h.refund) out.push({ label: '환불액', from: show(form.refund), to: show(h.refund) });
  return out;
}

/** 도우미 적용: 계산한 순매출을 매출 금액에, 할인·환불은 상세로 (다시 빼지 않음) */
export function applyHelper(h: HelperInput): { form: AmountForm; message: string } | null {
  const r = computeHelper(h);
  if (!r.ok) return null;
  return { form: { net: r.net, discount: h.discount, refund: h.refund }, message: `계산한 매출 ${fmt(r.net, 'won')}을 적용했어요` };
}
