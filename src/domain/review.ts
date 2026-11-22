// 성과 확인: 실행 전후 비교에서 해석을 흐리는 요인(영업일 수 차이, 대상 외 판매 방식의 변화)을 계산한다.
import { displayValue, type PeriodSummary } from './calc';
import { CHANNELS, type Channel } from './types';

export interface PerDay {
  before: number | null;
  after: number | null;
  /** 실행 후 − 실행 전 (영업일당) */
  delta: number | null;
}

export interface ReviewContext {
  beforeDays: number;
  afterDays: number;
  businessDaysDiffer: boolean;
  /** 가게 전체 영업이익 변화 (입력된 비용만 반영한 잠정값일 수 있음) */
  opDelta: number | null;
  /** 영업일당 영업이익 */
  opPerDay: PerDay;
  /** 영업일당 매출 */
  salesPerDay: PerDay;
  /** 판매 방식별 '판매 방식 비용을 뺀 금액' 변화 */
  channelDelta: Record<Channel, number | null>;
  /** 대상 판매 방식의 변화 (가게 전체 대상이면 null) */
  targetDelta: number | null;
  /** 대상보다 변화(절댓값)가 큰 대상 외 판매 방식. 크기 순 */
  outweighing: Channel[];
}

const perDay = (v: number | null, days: number) => (v === null || days <= 0 ? null : v / days);

export function reviewContext(b: PeriodSummary, a: PeriodSummary, target: Channel | 'all'): ReviewContext {
  const opB = displayValue(b.operatingProfit);
  const opA = displayValue(a.operatingProfit);
  const sB = displayValue(b.totalSales);
  const sA = displayValue(a.totalSales);
  const mk = (x: number | null, y: number | null): PerDay => {
    const before = perDay(x, b.businessDays);
    const after = perDay(y, a.businessDays);
    return { before, after, delta: before !== null && after !== null ? after - before : null };
  };
  const channelDelta = {} as Record<Channel, number | null>;
  for (const c of CHANNELS) {
    // 두 기간 모두 입력이 없는 판매 방식은 변화 없음이 아니라 비교 대상이 아니다
    if (!b.channels[c].entryCount && !a.channels[c].entryCount) {
      channelDelta[c] = null;
      continue;
    }
    const x = b.channels[c].entryCount ? displayValue(b.channels[c].directProfit) : 0;
    const y = a.channels[c].entryCount ? displayValue(a.channels[c].directProfit) : 0;
    channelDelta[c] = x !== null && y !== null ? y - x : null;
  }
  const targetDelta = target === 'all' ? null : channelDelta[target];
  const outweighing =
    target === 'all' || targetDelta === null
      ? []
      : CHANNELS.filter((c) => c !== target && channelDelta[c] !== null && Math.abs(channelDelta[c]!) > Math.abs(targetDelta)).sort(
          (x, y) => Math.abs(channelDelta[y]!) - Math.abs(channelDelta[x]!),
        );
  return {
    beforeDays: b.businessDays,
    afterDays: a.businessDays,
    businessDaysDiffer: b.businessDays !== a.businessDays,
    opDelta: opB !== null && opA !== null ? opA - opB : null,
    opPerDay: mk(opB, opA),
    salesPerDay: mk(sB, sA),
    channelDelta,
    targetDelta,
    outweighing,
  };
}
