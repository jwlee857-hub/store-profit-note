// 성과 확인: 실행 전후 비교에서 해석을 흐리는 요인(영업일 수 차이, 대상 외 판매 방식의 변화)을 계산한다.
// 매출 기록이 빠진 부분 합계는 증감·경고 판정에 쓰지 않는다 (comparableValue · salesComplete — 진단과 같은 기준).
import { comparableValue, discountDetailKnown, netSales, salesComplete, type ChannelSummary, type PeriodSummary } from './calc';
import { inRange, krDate } from './dates';
import { CATEGORY_LABEL, CHANNEL_LABEL } from './labels';
import { CHANNELS, type AppData, type Calc, type Channel, type DateRange, type DateStr } from './types';

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

/** 비교 판정을 보류하게 만든 빠진 기록을 경로별로 묶는다 (마감 미입력 영업일의 경로도 포함) */
export function recordGaps(data: Pick<AppData, 'sales'>, s: PeriodSummary): RecordGap[] {
  const out = new Map<string, RecordGap>();
  const add = (kind: RecordGap['kind'], channel: Channel, routeId: string, date: DateStr) => {
    const k = `${kind}|${channel}|${routeId}`;
    const g = out.get(k) ?? { kind, channel, routeId, dates: [] };
    if (!g.dates.includes(date)) g.dates.push(date);
    out.set(k, g);
  };
  for (const ch of CHANNELS) for (const m of s.channels[ch].coverage.missing) add('sales', ch, m.routeId, m.date);
  for (const e of data.sales) if (inRange(e.date, s.range) && netSales(e) !== null && !discountDetailKnown(e)) add('discount', e.channel, e.routeId, e.date);
  for (const g of out.values()) g.dates.sort();
  return [...out.values()];
}

// ───────── 쿠폰 결정 요약 문장 ─────────

/**
 * 배달 한 건당 남은 돈·주문 수·배달 전체에서 남은 돈의 전후 변화를 한 문장으로. 화면에 보이는 반올림 값끼리 뺀다.
 * 예: "주문 한 건당 935원 더 남았지만 주문이 120건 줄어 배달앱 A에서 한 달간 남은 돈은 약 12만 4천 원 줄었어요."
 * 원인을 말하지 않는다(쿠폰 효과로 단정하지 않음).
 */
/** 124,471 → '약 12만 4천 원', 50,000 → '5만 원', 5,000 → '5,000원' (천 원 단위 반올림, 반올림했으면 '약') */
export function wonKo(n: number): string {
  const a = Math.abs(Math.round(n));
  if (a < 10_000) return `${a.toLocaleString('ko-KR')}원`;
  let man = Math.floor(a / 10_000);
  let cheon = Math.round((a % 10_000) / 1000);
  if (cheon === 10) [man, cheon] = [man + 1, 0];
  const exact = man * 10_000 + cheon * 1000 === a;
  return `${exact ? '' : '약 '}${man.toLocaleString('ko-KR')}만${cheon ? ` ${cheon}천` : ''} 원`;
}

export function deliveryChangeText(per: [number, number], orders: [number, number], total: [number, number], where = '배달 전체에서'): string {
  const dp = Math.round(per[1]) - Math.round(per[0]);
  const dq = Math.round(orders[1]) - Math.round(orders[0]);
  const dt = Math.round(total[1]) - Math.round(total[0]);
  const won = (n: number) => `${Math.abs(n).toLocaleString('ko-KR')}원`;
  const perPart = dp === 0 ? '주문 한 건당 남은 돈은 같았' : `주문 한 건당 ${won(dp)} ${dp < 0 ? '덜' : '더'} 남았`;
  const join = dp !== 0 && dt !== 0 && Math.sign(dp) !== Math.sign(dt) ? '지만' : '고';
  const qPart = dq === 0 ? '주문 수는 같아' : `주문이 ${Math.abs(dq).toLocaleString('ko-KR')}건 ${dq > 0 ? '늘어' : '줄어'}`;
  // 한 달 총액은 읽기 쉽게 '약 12만 4천 원' (정확한 원 단위는 바로 아래 표에)
  const tPart = dt === 0 ? `${where} 남은 돈은 같았어요.` : `${where} 남은 돈은 ${wonKo(dt)} ${dt > 0 ? '늘었' : '줄었'}어요.`;
  return `${perPart}${join} ${qPart} ${tPart}`;
}

// ───────── 대상 배달앱만 집계 ─────────

/**
 * 계획이 한 배달앱만 대상으로 할 때: 그 판매 방식의 기록·'매출 없음' 확인·경로·기간 비용을 그 배달앱 것만 남긴다(다른 판매 방식은 그대로).
 * 판매 방식 전체에 걸친 기간 비용(배달 광고비 등)은 한 배달앱 몫을 알 수 없어 빼고, 그 배달앱의 정산서 기간 합계만 남긴다.
 */
// shortcut: 판매 방식 전체에 걸친 기간 비용(광고비 등)은 앱별로 나누지 않고 뺀다, 앱별 광고비를 따로 기록하게 되면 그 몫을 넣는다
export function scopeToRoute(data: AppData, channel: Channel, routeId: string): AppData {
  return {
    ...data,
    sales: data.sales.filter((e) => e.channel !== channel || e.routeId === routeId),
    salesChecks: data.salesChecks.filter((c) => c.channel !== channel || c.routeId === routeId),
    routes: data.routes.map((r) => (r.id === routeId || !r.channels.includes(channel) ? r : { ...r, channels: r.channels.filter((c) => c !== channel) })),
    periodCosts: data.periodCosts.filter((pc) => pc.attribution !== channel || pc.routeId === routeId),
  };
}

/** 가게 전체 합계는 그대로 두고 한 판매 방식만 대상 배달앱 집계로 바꾼 요약 */
export function withChannelFrom(full: PeriodSummary, scoped: PeriodSummary, channel: Channel): PeriodSummary {
  return { ...full, channels: { ...full.channels, [channel]: scoped.channels[channel] } };
}

/** 계산에 들어간 기록 중 식재료비를 메뉴 평균 원가율로 추정한 기록 수 (성과 화면의 근거 표시용) */
export function menuAverageFoodCount(data: Pick<AppData, 'sales'>, s: PeriodSummary, channel?: Channel): number {
  return data.sales.filter((e) => {
    if (!inRange(e.date, s.range) || (channel && e.channel !== channel)) return false;
    const f = e.costs.food;
    if (f.actual !== null || f.estimated === null) return false;
    // v7 이후는 계산 내용으로, 이전 기록은 저장 당시 근거 문구로 판별
    return f.calc ? f.calc.method === 'foodRate' && f.calc.source === 'menuAverage' : /메뉴 \d+개 단순 평균 원가율/.test(f.estimateBasis);
  }).length;
}

// ───────── 미확정·추정 포함·비교 보류의 구체적인 이유 ─────────

export interface CalcReasons {
  /** 비교 보류(부분 합계): 10월 2일 마감 입력 필요, 10월 5일 배달앱 B 매출 입력 필요, 할인액 미입력 3건 */
  gap: string[];
  /** 미확정(비용 미입력): 10월 2일 배달 식재료비 입력 필요 */
  missing: string[];
  /** 추정 포함: 식재료비 3건은 메뉴 평균으로 계산, 공과금 추정(고지서 도착 전 추정) */
  estimated: string[];
}

/** 지표 옆에 붙일 이유. ch가 판매 방식이면 그 판매 방식에 해당하는 것만, 'all'이면 가게 전체 */
export function calcReasons(data: Pick<AppData, 'sales' | 'routes' | 'periodCosts'>, s: PeriodSummary, ch: Channel | 'all'): CalcReasons {
  const chans = ch === 'all' ? CHANNELS : [ch];
  const routeName = (id: string) => data.routes.find((r) => r.id === id)?.name ?? '(삭제된 경로)';
  const whole = new Set(s.unrecordedDays);
  const gap = s.unrecordedDays.map((d) => `${krDate(d)} 마감 입력 필요`);
  for (const c of chans) for (const m of s.channels[c].coverage.missing) if (!whole.has(m.date)) gap.push(`${krDate(m.date)} ${routeName(m.routeId)} ${CHANNEL_LABEL[c]} 매출 입력 필요`);
  const noDiscount = data.sales.filter((e) => inRange(e.date, s.range) && chans.includes(e.channel) && netSales(e) !== null && !discountDetailKnown(e)).length;
  if (noDiscount) gap.push(`할인액 미입력 매출 기록 ${noDiscount}건`);
  const missing = s.status.missing
    .filter((m) => m.kind !== 'sales' && (ch === 'all' || m.label.includes(CHANNEL_LABEL[ch])))
    .map((m) => (/^\d{4}-\d{2}-\d{2} /.test(m.label) ? `${krDate(m.label.slice(0, 10))} ${m.label.slice(11)} 입력 필요` : `${m.label}`));
  const estimated: string[] = [];
  const menuAvg = menuAverageFoodCount(data, s, ch === 'all' ? undefined : ch);
  if (menuAvg) estimated.push(`식재료비 ${menuAvg}건은 메뉴 평균으로 계산`);
  for (const pc of data.periodCosts)
    if (pc.source === 'estimated' && pc.start <= s.range.end && s.range.start <= pc.end && (ch === 'all' || pc.attribution === ch))
      estimated.push(`${CATEGORY_LABEL[pc.category]} 추정${pc.memo ? `(${pc.memo})` : ''}`);
  return { gap, missing, estimated };
}

/** 지표 상태에 맞는 이유 한 줄 (앞의 2개 + 외 N건). 해당 없으면 null */
export function reasonLine(c: Calc, r: CalcReasons): string | null {
  const list = c.salesGap ? r.gap : c.value === null && c.reason === 'incomplete' ? r.missing : c.estimated ? r.estimated : [];
  if (!list.length) return null;
  return list.slice(0, 2).join(' · ') + (list.length > 2 ? ` 외 ${list.length - 2}건` : '');
}

/** 기간 안 매출 기록 메모를 같은 내용끼리 묶는다 (예: 10월 15~17일 근처 가을 축제로 홀 손님 증가) */
export function memoRanges(data: Pick<AppData, 'sales'>, r: DateRange): { range: DateRange; memo: string }[] {
  const by = new Map<string, DateStr[]>();
  for (const e of data.sales) if (e.memo.trim() && inRange(e.date, r)) by.set(e.memo.trim(), [...(by.get(e.memo.trim()) ?? []), e.date]);
  return [...by.entries()].map(([memo, ds]) => ({ memo, range: { start: ds.reduce((a, b) => (b < a ? b : a)), end: ds.reduce((a, b) => (b > a ? b : a)) } }));
}
