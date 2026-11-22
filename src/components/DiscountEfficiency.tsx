import type { PeriodSummary } from '../domain/calc';
import { discountEfficiency, discountEfficiencyText } from '../domain/discount';
import { fmtSigned } from '../domain/format';
import { CHANNEL_LABEL } from '../domain/labels';
import type { Channel } from '../domain/types';

/**
 * "할인 1,000원당 늘어난 주문 수 / 남은 금액" 한 블록.
 * 계산할 수 없으면 이유를 보여준다. 단순 전후 비교라 할인 외 요인이 섞여 있다는 점을 함께 적는다.
 */
export function DiscountEfficiencyNote({ b, a, ch, labels = ['실행 전', '실행 후'] }: { b: PeriodSummary; a: PeriodSummary; ch: Channel; labels?: [string, string] }) {
  const e = discountEfficiency(b, a, ch);
  return (
    <div aria-label="할인 1,000원당 효과" className="mt-3 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
      <div className="text-xs font-medium text-slate-600">{CHANNEL_LABEL[ch]} 쿠폰·할인 1,000원당 ({labels[0]} → {labels[1]})</div>
      {e.ok ? (
        <>
          <p className="mt-1 font-semibold text-slate-900">{discountEfficiencyText(e)}</p>
          <p className="mt-0.5 text-xs text-slate-600">
            가게 부담 할인액 {fmtSigned(e.deltaDiscount, 'won')} · 주문 {e.deltaOrders > 0 ? '+' : ''}
            {e.deltaOrders.toLocaleString('ko-KR')}건 · 남은 돈(판매 방식 비용을 뺀 금액, 할인 차감 후) {fmtSigned(e.deltaProfit, 'won')}
            {e.provisional && ' (비용 일부 미입력 — 미확정)'}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            두 기간의 단순 차이를 할인액 차이로 나눈 값이라 노출·날씨·메뉴 같은 다른 요인이 섞여 있어요.{e.businessDaysDiffer && ' 두 기간의 영업일 수도 달라요.'}
          </p>
        </>
      ) : (
        <p className="mt-1 text-slate-700">계산하지 않음: {e.reason}</p>
      )}
    </div>
  );
}
