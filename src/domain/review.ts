// 성과 확인: 실행 전후 비교에서 해석을 흐리는 요인(영업일 수 차이, 대상 외 판매 방식의 변화)을 계산한다.
// 매출 기록이 빠진 부분 합계는 증감·경고 판정에 쓰지 않는다 (comparableValue · salesComplete — 진단과 같은 기준).
import { comparableValue, discountDetailKnown, netSales, salesComplete, type ChannelSummary, type PeriodSummary } from './calc';
import { inRange } from './dates';
import { CHANNELS, type AppData, type Channel, type DateStr } from './types';

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
  /** 가게 전체 영업이익 변화 (입력된 비용만 반영한 잠정값일 수 있음). 매출 기록이 빠졌으면 null */
  opDelta: number | null;
  /** 영업일당 영업이익 */
  opPerDay: PerDay;
  /** 영업일당 매출 */
  salesPerDay: PerDay;
  /** 판매 방식별 '판매 방식 비용을 뺀 금액' 변화. 기록이 빠져 비교할 수 없으면 null */
  channelDelta: Record<Channel, number | null>;
  /** 대상 판매 방식의 변화 (가게 전체 대상이면 null) */
  targetDelta: number | null;
  /** 대상보다 변화(절댓값)가 큰 대상 외 판매 방식. 크기 순 */
  outweighing: Channel[];
  /** 매출 기록이 빠져 비교를 보류한 판매 방식 */
  gapChannels: Channel[];
}

const perDay = (v: number | null, days: number) => (v === null || days <= 0 ? null : v / days);

/** 판매 방식의 '판매 방식 비용을 뺀 금액'을 비교용으로: 기록이 빠졌으면 null, 매출 없음 확인·미운영이면 0 */
function channelProfit(c: ChannelSummary): number | null {
  if (!salesComplete(c)) return null;
  return c.entryCount ? comparableValue(c.directProfit) : 0;
}

export function reviewContext(b: PeriodSummary, a: PeriodSummary, target: Channel | 'all'): ReviewContext {
  const opB = comparableValue(b.operatingProfit);
  const opA = comparableValue(a.operatingProfit);
  const sB = comparableValue(b.totalSales);
  const sA = comparableValue(a.totalSales);
  const mk = (x: number | null, y: number | null): PerDay => {
    const before = perDay(x, b.businessDays);
    const after = perDay(y, a.businessDays);
    return { before, after, delta: before !== null && after !== null ? after - before : null };
  };
  const channelDelta = {} as Record<Channel, number | null>;
  const gapChannels: Channel[] = [];
  for (const c of CHANNELS) {
    const x = b.channels[c];
    const y = a.channels[c];
    if (!salesComplete(x) || !salesComplete(y)) gapChannels.push(c);
    // 두 기간 모두 입력이 없는 판매 방식은 변화 없음이 아니라 비교 대상이 아니다
    if (!x.entryCount && !y.entryCount) {
      channelDelta[c] = null;
      continue;
    }
    const px = channelProfit(x);
    const py = channelProfit(y);
    channelDelta[c] = px !== null && py !== null ? py - px : null;
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
    gapChannels,
  };
}

// ───────── 빠진 기록 (성과 확인·문제 진단 공통) ─────────

export interface RecordGap {
  /** sales: 영업일인데 기록도 '매출 없음' 확인도 없는 경로·날 · discount: 순매출만 입력해 할인액을 모르는 매출 기록 */
  kind: 'sales' | 'discount';
  channel: Channel;
  routeId: string;
  /** 오름차순 */
  dates: DateStr[];
}

/** 비교 판정을 보류하게 만든 빠진 기록을 경로별로 묶는다. 계산에서 뺀 미입력 영업일(통째로 빈 날)은 넣지 않는다 */
export function recordGaps(data: Pick<AppData, 'sales'>, s: PeriodSummary): RecordGap[] {
  const out = new Map<string, RecordGap>();
  const add = (kind: RecordGap['kind'], channel: Channel, routeId: string, date: DateStr) => {
    const k = `${kind}|${channel}|${routeId}`;
    const g = out.get(k) ?? { kind, channel, routeId, dates: [] };
    if (!g.dates.includes(date)) g.dates.push(date);
    out.set(k, g);
  };
  for (const ch of CHANNELS) for (const m of s.channels[ch].coverage.missing) add('sales', ch, m.routeId, m.date);
  const skipped = new Set([...s.unrecordedDays, ...s.pairedExcluded]);
  for (const e of data.sales)
    if (inRange(e.date, s.range) && !skipped.has(e.date) && netSales(e) !== null && !discountDetailKnown(e)) add('discount', e.channel, e.routeId, e.date);
  for (const g of out.values()) g.dates.sort();
  return [...out.values()];
}

// ───────── 쿠폰 결정 요약 문장 ─────────

/**
 * 배달 한 건당 남은 돈·주문 수·배달 전체에서 남은 돈의 전후 변화를 한 문장으로. 화면에 보이는 반올림 값끼리 뺀다.
 * 예: "한 건당 141원 덜 남았지만 주문이 69건 늘어 배달 전체에서는 276,394원 더 남았어요."
 * 원인을 말하지 않는다(쿠폰 효과로 단정하지 않음).
 */
export function deliveryChangeText(per: [number, number], orders: [number, number], total: [number, number]): string {
  const dp = Math.round(per[1]) - Math.round(per[0]);
  const dq = Math.round(orders[1]) - Math.round(orders[0]);
  const dt = Math.round(total[1]) - Math.round(total[0]);
  const won = (n: number) => `${Math.abs(n).toLocaleString('ko-KR')}원`;
  const perPart = dp === 0 ? '한 건당 남은 돈은 같았' : `한 건당 ${won(dp)} ${dp < 0 ? '덜' : '더'} 남았`;
  const join = dp !== 0 && dt !== 0 && Math.sign(dp) !== Math.sign(dt) ? '지만' : '고';
  const qPart = dq === 0 ? '주문 수는 같아' : `주문이 ${Math.abs(dq).toLocaleString('ko-KR')}건 ${dq > 0 ? '늘어' : '줄어'}`;
  const tPart = dt === 0 ? '배달 전체에서 남은 돈은 같았어요.' : `배달 전체에서는 ${won(dt)} ${dt > 0 ? '더' : '덜'} 남았어요.`;
  return `${perPart}${join} ${qPart} ${tPart}`;
}
