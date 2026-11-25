// 6차 점검: 기간 집계 · 정산 처리 · 경로 사용 기간 · 성과 확인 기간. 격리된 내장 샘플(가상 데이터)만 사용한다.
import { describe, expect, it } from 'vitest';
import { parseBackup, serialize } from '../storage/storage';
import { comparableValue, compareCalc, computeComparison, computeSummary, getMetric, netSales, type PeriodSummary } from './calc';
import { isFullMonth, previousMonth, previousRange } from './dates';
import { retestDraft } from './draft';
import { markDayClosed, markDayNoSales } from './entry';
import { rangeProblem } from './periods';
import { calcReasons, reasonLine, scopeToRoute, withChannelFrom } from './review';
import { STORY, storySample } from './sample';
import { applyPeriodSettlement, applySettlementEdits, editOf, periodOverlap, settlementBreakdown } from './settlement';
import type { AppData, DateRange, MetricRef } from './types';

const OCT2 = '2026-10-02';
const isA = (e: { routeId: string; channel: string }) => e.routeId === 'route_app_a' && e.channel === 'delivery';
const v = (s: PeriodSummary, r: MetricRef) => comparableValue(getMetric(s, r));
const scoped = (d: AppData, r: DateRange) => withChannelFrom(computeSummary(d, r), computeSummary(scopeToRoute(d, 'delivery', 'route_app_a'), r), 'delivery');

describe('1. 미입력 영업일과 월별 비교', () => {
  it('10월 2일 배달앱 A만 빠짐: 배달은 일부 확인, 홀·포장은 계속 비교, 이유는 그 경로·날짜', () => {
    const d = storySample();
    d.sales = d.sales.filter((e) => !(e.date === OCT2 && isA(e)));
    const { s, p } = computeComparison(d, STORY.oct, STORY.sep);
    expect(s.unrecordedDays).toEqual([]);
    expect(s.channels.delivery.coverage.missing).toEqual([{ date: OCT2, routeId: 'route_app_a' }]);
    expect(compareCalc(getMetric(p, { key: 'netSales', channel: 'delivery' }), getMetric(s, { key: 'netSales', channel: 'delivery' })).abs).toBeNull();
    expect(compareCalc(getMetric(p, { key: 'netSales', channel: 'hall' }), getMetric(s, { key: 'netSales', channel: 'hall' })).abs).not.toBeNull();
    expect(reasonLine(s.totalSales, calcReasons(d, s, 'all'))).toBe('10월 2일 배달앱 A 배달 매출 입력 필요');
  });
  it('10월 2일 전체 미입력: "10월 2일 마감 입력 필요", 0원이 아닌 부분 합계, 월 증감·목표 판정 보류', () => {
    const d = storySample();
    const oct2 = d.sales.filter((e) => e.date === OCT2).reduce((t, e) => t + netSales(e)!, 0);
    d.sales = d.sales.filter((e) => e.date !== OCT2);
    const { s, p } = computeComparison(d, STORY.oct, STORY.sep);
    expect(s.unrecordedDays).toEqual([OCT2]);
    expect(s.businessDays).toBe(27); // 빼지 않는다
    expect(s.totalSales).toMatchObject({ value: null, provisional: 46_123_000 - oct2, salesGap: true });
    expect(compareCalc(p.totalSales, s.totalSales).abs).toBeNull();
    expect(compareCalc(p.operatingProfit, s.operatingProfit, 'profit').abs).toBeNull();
    expect(reasonLine(s.operatingProfit, calcReasons(d, s, 'all'))).toBe('10월 2일 마감 입력 필요');
  });
  it('10월 기록을 비우거나 추가해도 9월 합계는 그대로 (각 달을 따로 집계)', () => {
    const d = storySample();
    const sep = computeSummary(d, STORY.sep).totalSales;
    expect(sep).toEqual({ value: 42_527_200 });
    d.sales = d.sales.filter((e) => e.date !== OCT2);
    expect(computeComparison(d, STORY.oct, STORY.sep).p.totalSales).toEqual(sep);
    d.sales.push({ ...structuredClone(d.sales[0]), id: 'extra', date: '2026-10-20' });
    expect(computeComparison(d, STORY.oct, STORY.sep).p.totalSales).toEqual(sep);
  });
  it('매출 없음 확인은 0원 확인, 임시 휴업은 영업일에서 빠진다 — 둘 다 그 달을 다시 완전한 실적으로 만든다', () => {
    const base = storySample();
    const oct2 = base.sales.filter((e) => e.date === OCT2).reduce((t, e) => t + netSales(e)!, 0);
    base.sales = base.sales.filter((e) => e.date !== OCT2);
    const zero = computeSummary(markDayNoSales(base, OCT2), STORY.oct);
    expect(zero.totalSales).toEqual({ value: 46_123_000 - oct2 });
    expect(zero.businessDays).toBe(27);
    const closed = computeSummary(markDayClosed(base, OCT2), STORY.oct);
    expect(closed.totalSales).toEqual({ value: 46_123_000 - oct2 });
    expect(closed.businessDays).toBe(26);
  });
  it('홈 10월 합계 = 매출과 비용 일별 매출의 필터 없는 10월 합계 (원 단위)', () => {
    const d = storySample();
    const list = d.sales.filter((e) => e.date.startsWith('2026-10')).reduce((t, e) => t + (netSales(e) ?? 0), 0);
    expect(computeSummary(d, STORY.oct).totalSales.value).toBe(list);
    expect(list).toBe(46_123_000);
  });
  it('완료된 두 달: 증감 = 10월 − 9월, 증감률 = 증감 ÷ 9월. 지난달 전체(9.1~9.30)와 직전 같은 일수(8.31~9.30)를 구별', () => {
    const d = storySample();
    const { s, p } = computeComparison(d, STORY.oct, STORY.sep);
    const c = compareCalc(p.totalSales, s.totalSales);
    expect(c.abs).toBe(3_595_800);
    expect(c.pct).toBeCloseTo((3_595_800 / 42_527_200) * 100);
    expect([p.businessDays, s.businessDays]).toEqual([25, 27]);
    expect(isFullMonth(STORY.oct)).toBe(true);
    expect(previousMonth(STORY.oct)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(previousRange(STORY.oct)).toEqual({ start: '2026-08-31', end: '2026-09-30' });
  });
  it('검증표: 9월·10월 배달앱 A와 가게 전체 (원천 기록 집계)', () => {
    const d = storySample();
    const sep = scoped(d, STORY.sep);
    const oct = scoped(d, STORY.oct);
    const row = (r: MetricRef) => [Math.round(v(sep, r)!), Math.round(v(oct, r)!)];
    expect(row({ key: 'orders', channel: 'delivery' })).toEqual([785, 665]);
    expect(row({ key: 'storeDiscount', channel: 'delivery' })).toEqual([1_923_000, 1_090_000]);
    expect(row({ key: 'directProfitPerOrder', channel: 'delivery' })).toEqual([6_218, 7_153]);
    expect(row({ key: 'directProfit', channel: 'delivery' })).toEqual([4_881_520, 4_757_049]);
    expect(row({ key: 'operatingProfit', channel: 'all' })).toEqual([4_994_423, 7_950_942]);
    expect(row({ key: 'totalSales', channel: 'all' })).toEqual([42_527_200, 46_123_000]);
    expect([sep.businessDays, oct.businessDays]).toEqual([25, 27]);
  });
});

describe('2. 정산 수수료 중복·누락', () => {
  const WEEK = { start: '2026-10-01', end: '2026-10-07' };
  /** 정산 전 상태: 배달앱 A 10월 1~11일 수수료를 계산값으로 되돌린다 */
  const unsettled = () => {
    const d = storySample();
    for (const e of d.sales)
      if (isA(e) && e.date >= '2026-10-01' && e.date <= '2026-10-11')
        for (const c of ['brokerage', 'payment'] as const) {
          e.costs[c] = { actual: null, estimated: e.costs[c].actual, estimateBasis: '설정 기준 계산: 테스트' };
        }
    return d;
  };
  const feeA = (d: AppData, r: DateRange) => {
    const c = computeSummary(scopeToRoute(d, 'delivery', 'route_app_a'), r).channels.delivery.directByCategory;
    return [c.brokerage, c.payment].reduce((t, x) => t + x.actual + x.calculated + x.estimated, 0);
  };
  const ps = { routeId: 'route_app_a', channel: 'delivery' as const, ...WEEK, amount: 70_000 };
  const oct1 = (d: AppData) => d.sales.find((e) => e.date === '2026-10-01' && isA(e))!;
  const save = (d: AppData, p = ps) => {
    const r = applyPeriodSettlement(d, p);
    if ('error' in r) throw new Error(r.error);
    Object.assign(d, r);
  };
  it('기간 합계 70,000원 뒤 그 안의 10월 1일 실제 10,000원: 최종 70,000원 = 일별 확인 10,000원 / 나머지 60,000원', () => {
    const d = unsettled();
    save(d);
    d.sales = applySettlementEdits(d, [{ ...editOf(oct1(d)), brokerage: 10_000, payment: 0 }]);
    expect(feeA(d, WEEK)).toBe(70_000);
    expect(settlementBreakdown(d, d.periodCosts.find((p) => p.routeId)!)).toEqual({ total: 70_000, daily: 10_000, dailyCount: 1, rest: 60_000, unverified: false });
  });
  it('일별 먼저 / 기간 합계 먼저 / 같은 정산서 다시 저장: 최종 비용과 영업이익이 같다', () => {
    const a = unsettled();
    save(a);
    a.sales = applySettlementEdits(a, [{ ...editOf(oct1(a)), brokerage: 10_000, payment: 0 }]);
    const b = unsettled();
    b.sales = applySettlementEdits(b, [{ ...editOf(oct1(b)), brokerage: 10_000, payment: 0 }]);
    save(b);
    const c = unsettled();
    c.sales = applySettlementEdits(c, [{ ...editOf(oct1(c)), brokerage: 10_000, payment: 0 }]);
    save(c);
    save(c);
    c.sales = applySettlementEdits(c, [{ ...editOf(oct1(c)), brokerage: 10_000, payment: 0 }]);
    for (const x of [a, b, c]) {
      expect(feeA(x, WEEK)).toBe(70_000);
      expect(x.periodCosts.filter((p) => p.routeId)).toHaveLength(1);
      expect(computeSummary(x, STORY.oct).operatingProfit).toEqual(computeSummary(a, STORY.oct).operatingProfit);
    }
  });
  it('10월 1~7일 뒤 10월 5~11일: 겹친 금액을 나눌 수 없어 저장하지 않고, 기존 1~4일 비용을 지킨다', () => {
    const d = unsettled();
    save(d);
    const before = feeA(d, { start: '2026-10-01', end: '2026-10-04' });
    const next = { ...ps, start: '2026-10-05', end: '2026-10-11' };
    expect(periodOverlap(d, next).conflicts.map((c) => [c.start, c.end])).toEqual([['2026-10-05', '2026-10-07']]);
    const r = applyPeriodSettlement(d, next);
    expect(r).toHaveProperty('error');
    expect('error' in r && r.error).toContain('10월 5~7일이 이미 저장한 정산 10월 1~7일 70,000원과 겹쳐요');
    expect(d.periodCosts.filter((p) => p.routeId).map((p) => [p.start, p.end])).toEqual([['2026-10-01', '2026-10-07']]);
    expect(feeA(d, { start: '2026-10-01', end: '2026-10-04' })).toBe(before);
    // 겹치지 않는 날짜만 넣으면 저장된다
    save(d, { ...ps, start: '2026-10-08', end: '2026-10-11', amount: 40_000 });
    expect(feeA(d, { start: '2026-10-01', end: '2026-10-11' })).toBe(110_000);
  });
  it('실제 수수료는 추정 수수료를 대체하고, 순매출 기록에 할인 상세를 나중에 넣어도 할인을 두 번 빼지 않는다', () => {
    const d = unsettled();
    const e = oct1(d);
    Object.assign(e, { amountMode: 'net', netInput: netSales(e), gross: null, storeDiscount: null, refund: null });
    const net = netSales(e);
    d.sales = applySettlementEdits(d, [{ ...editOf(e), storeDiscount: 40_000, refund: 0, brokerage: 9_000, payment: 3_000 }]);
    const x = oct1(d);
    expect(netSales(x)).toBe(net);
    expect(feeA(d, { start: '2026-10-01', end: '2026-10-01' })).toBe(12_000);
  });
});

describe('3. 새 주문 경로가 과거 성과를 바꾸지 않는다', () => {
  it('11월에 사용 시작한 새 배달 경로는 10월 27영업일의 누락 검사에 들어가지 않는다', () => {
    const d = storySample();
    const oct = JSON.stringify(scoped(d, STORY.oct).operatingProfit);
    d.routes.push({ id: 'route_new', name: '배달앱 C', channels: ['delivery'], platformId: null, activeFrom: '2026-11-01', activeTo: null });
    const s = computeSummary(d, STORY.oct);
    expect(s.channels.delivery.coverage).toEqual({ state: 'complete', missing: [] });
    expect(s.totalSales).toEqual({ value: 46_123_000 });
    expect(JSON.stringify(scoped(d, STORY.oct).operatingProfit)).toBe(oct);
    // 11월부터는 그 경로도 기다린다
    expect(computeSummary(d, { start: '2026-11-02', end: '2026-11-02' }).channels.delivery.coverage.missing).toEqual([{ date: '2026-11-02', routeId: 'route_new' }]);
  });
  it('사용을 끝낸 경로: 종료일 뒤에는 미입력으로 세지 않고, 그 전 실적은 그대로', () => {
    const d = storySample();
    const oct = computeSummary(d, STORY.oct).totalSales;
    d.routes = d.routes.map((r) => (r.id === 'route_app_b' ? { ...r, activeTo: '2026-11-10' } : r));
    d.sales = d.sales.filter((e) => !(e.routeId === 'route_app_b' && e.date > '2026-11-10'));
    expect(computeSummary(d, STORY.oct).totalSales).toEqual(oct);
    expect(computeSummary(d, { start: '2026-11-11', end: '2026-11-21' }).channels.delivery.coverage.state).toBe('complete');
  });
  it('사용 시작일이 없는 기존 경로·백업: 이전 매출이 빠지거나 과거가 미입력으로 바뀌지 않는다', () => {
    const d = storySample();
    expect(d.routes.every((r) => r.activeFrom === undefined)).toBe(true);
    const p = parseBackup(serialize(d));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const r of [STORY.aug, STORY.sep, STORY.oct]) expect(computeSummary(p.data, r).totalSales).toEqual(computeSummary(d, r).totalSales);
    expect(computeSummary(p.data, STORY.oct).unrecordedDays).toEqual([]);
  });
});

describe('4. 성과 확인 비교 기간과 재시험 연결', () => {
  it('겹치거나 뒤집히거나 잘못된 기간은 이유와 함께 막는다', () => {
    expect(rangeProblem({ start: '2026-09-01', end: '2026-10-03' }, STORY.oct)).toBe('실행 전 기간(9월 1일~10월 3일)과 실행 후 기간(10월 1~31일)이 겹쳐요. 실행 전은 9월 30일까지로 지정하세요.');
    expect(rangeProblem(STORY.nov, STORY.oct)).toContain('보다 늦어요');
    expect(rangeProblem({ start: '2026-09-30', end: '2026-09-01' }, STORY.oct)).toContain('날짜를 올바르게');
    expect(rangeProblem(STORY.sep, STORY.oct)).toBeNull();
  });
  it('10월 계획의 원래 비교 기간은 저장된 9월 1~30일 / 10월 1~31일 — 11월 기록이 늘어도 고정', () => {
    const d = storySample();
    const oct = d.solutions[0];
    d.sales.push({ ...structuredClone(d.sales[d.sales.length - 1]), id: 'nov23', date: '2026-11-23' });
    expect([oct.review.before, oct.review.after]).toEqual([STORY.sep, STORY.oct]);
  });
  it('11월 재시험은 10월 계획에 연결돼 있고, 재시험 초안도 원래 계획을 기억한다 (중복 생성 방지 근거)', () => {
    const d = storySample();
    const [oct, nov] = d.solutions;
    expect(nov.retestOf).toBe(oct.id);
    expect(retestDraft(oct, '2026-11-23').retestOf).toBe(oct.id);
  });
});
