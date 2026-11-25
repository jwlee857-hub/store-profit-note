// 쿠폰·할인 비용을 원 단위로 비교하고, "할인 1,000원당 늘어난 주문 수 / 남은 금액"을 계산한다.
// 단순 전후 비교라 할인 외 요인(날씨·노출·메뉴 변경 등)이 섞여 있다. 원인 효과로 단정하지 않는다.
import { comparableValue, discountCalc, type ChannelSummary, type PeriodSummary } from './calc';
import { fmt } from './format';
import type { Calc, Channel } from './types';

export interface DiscountRow {
  channel: Channel;
  prev: Calc;
  cur: Calc;
  /** 주문 1건당 가게 부담 할인액 (모든 날에 주문 수가 있고 할인 상세가 모두 있을 때만) */
  prevPerOrder: number | null;
  curPerOrder: number | null;
  /** 할인 전 판매액 대비 할인 비율(%) */
  prevRate: number | null;
  curRate: number | null;
}

export type DiscountEfficiency =
  | {
      ok: true;
      /** 'up' = 할인을 더 썼다, 'down' = 할인을 줄였다 */
      direction: 'up' | 'down';
      deltaDiscount: number;
      deltaOrders: number;
      /** 판매 방식 비용을 뺀 금액(할인은 이미 매출에서 빠져 있음)의 변화 */
      deltaProfit: number;
      /** 할인 1,000원 변화당 주문 수 변화 */
      ordersPer1000: number;
      /** 할인 1,000원 변화당 남은 금액 변화 */
      profitPer1000: number;
      /** 비용 일부 미입력으로 남은 금액이 잠정값 */
      provisional: boolean;
      businessDaysDiffer: boolean;
    }
  | { ok: false; reason: string };

/** 할인액을 바꾼 효과를 계산하려면 이 금액 이상 달라져야 한다 (작은 차이로 나누면 숫자가 튄다) */
export const MIN_DISCOUNT_DELTA = 10_000;

const fullOrders = (c: ChannelSummary) => (c.entryCount && c.ordersDays === c.entryDays ? c.orders : null);

export function discountRow(prev: ChannelSummary, cur: ChannelSummary): DiscountRow {
  // 할인 금액을 다 알 때만(빠진 경로·날, 상세 없는 기록 없음) 주문당·비율을 계산한다
  const known = (c: ChannelSummary) => discountCalc(c).value !== null;
  const per = (c: ChannelSummary) => {
    const q = fullOrders(c);
    return q && known(c) ? c.discount / q : null;
  };
  const rate = (c: ChannelSummary) => (c.gross && known(c) ? (c.discount / c.gross) * 100 : null);
  return { channel: cur.channel, prev: discountCalc(prev), cur: discountCalc(cur), prevPerOrder: per(prev), curPerOrder: per(cur), prevRate: rate(prev), curRate: rate(cur) };
}

export function discountEfficiency(p: PeriodSummary, c: PeriodSummary, ch: Channel): DiscountEfficiency {
  const a = p.channels[ch];
  const b = c.channels[ch];
  if (!a.entryCount || !b.entryCount) return { ok: false, reason: '두 기간 모두 매출 기록이 있어야 계산할 수 있어요.' };
  if (a.coverage.missing.length || b.coverage.missing.length)
    return { ok: false, reason: '매출 기록이 빠진 경로·날이 있어 할인 효율을 계산하지 않아요. 빠진 기록을 채우거나 매출 없음으로 확인하면 계산합니다.' };
  if (a.detailMissing || b.detailMissing)
    return { ok: false, reason: '할인·환불 상세 없이 순매출만 입력한 기록이 있어 할인액 합계를 정확히 알 수 없어요. 상세를 입력하면 계산합니다.' };
  if (a.salesMissing || b.salesMissing) return { ok: false, reason: '매출 금액이 빠진 기록이 있어 계산하지 않아요.' };
  const q0 = fullOrders(a);
  const q1 = fullOrders(b);
  if (q0 === null || q1 === null) return { ok: false, reason: '주문 수가 빠진 날이 있어 주문 수 변화를 계산하지 않아요.' };
  const dp0 = comparableValue(a.directProfit);
  const dp1 = comparableValue(b.directProfit);
  if (dp0 === null || dp1 === null) return { ok: false, reason: '판매 방식 비용을 알 수 없어 남은 금액 변화를 계산하지 않아요.' };
  const deltaDiscount = b.discount - a.discount;
  if (Math.abs(deltaDiscount) < MIN_DISCOUNT_DELTA)
    return { ok: false, reason: `두 기간의 가게 부담 할인액 차이가 ${fmt(MIN_DISCOUNT_DELTA, 'won')} 미만이라 1,000원당 효과를 계산하지 않아요.` };
  const unit = Math.abs(deltaDiscount) / 1000;
  return {
    ok: true,
    direction: deltaDiscount > 0 ? 'up' : 'down',
    deltaDiscount,
    deltaOrders: q1 - q0,
    deltaProfit: dp1 - dp0,
    ordersPer1000: (q1 - q0) / unit,
    profitPer1000: (dp1 - dp0) / unit,
    provisional: a.directProfit.value === null || b.directProfit.value === null,
    businessDaysDiffer: p.businessDays !== c.businessDays,
  };
}

/** "할인 1,000원 더 쓸 때마다 주문 +0.11건, 남은 돈 −775원" */
export function discountEfficiencyText(e: Extract<DiscountEfficiency, { ok: true }>): string {
  const sign = (n: number, digits: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
  return `할인 1,000원 ${e.direction === 'up' ? '더 쓸' : '줄일'} 때마다 주문 ${sign(e.ordersPer1000, 2)}건, 남은 돈 ${sign(Math.round(e.profitPer1000), 0)}원`;
}
