// 5차 점검 1단계: 미입력 매출·할인을 0원으로 비교하지 않는다 + 쿠폰 결정 요약 문장. 가상 데이터만 사용.
// 샘플은 2026-11-19(목)까지 생성 → 배달 계획은 11-20부터. 실행 후 기간 첫날에 배달앱 A만 기록한 상황을 재현한다.
import { describe, expect, it } from 'vitest';
import { GAP_NOTE, basisText, channelCoverage, channelSalesCalc, compareCalc, computeSummary, getMetric, salesSlots } from './calc';
import { diagnoseSummaries } from './diagnosis';
import { discountEfficiency } from './discount';
import { newSalesEntry } from './factory';
import { deliveryChangeText, recordGaps, reviewContext } from './review';
import { generateSample } from './sample';
import type { AppData, MetricRef } from './types';

const BEFORE = { start: '2026-11-06', end: '2026-11-19' };
/** 실행 후 첫 영업일 하루 (그 뒤 날짜는 아직 마감 전) */
const AFTER = { start: '2026-11-20', end: '2026-11-20' };
const D = '2026-11-20';

/** 실행 후 첫 영업일에 배달앱 A 순매출 200,000원·완료 주문 10건만 (홀·포장·배달앱 B, 할인·환불 상세는 비움) */
function repro(): AppData {
  const d = generateSample('2026-11-19');
  d.sales.push(newSalesEntry({ date: D, channel: 'delivery', routeId: 'route_app_a', amountMode: 'net', gross: null, netInput: 200_000, orders: 10, storeDiscount: null, refund: null }));
  return d;
}
const both = (d: AppData) => ({ b: computeSummary(d, BEFORE), a: computeSummary(d, AFTER) });
const cmp = (d: AppData, ref: MetricRef, kind: 'normal' | 'profit' = 'normal') => {
  const { b, a } = both(d);
  return compareCalc(getMetric(b, ref), getMetric(a, ref), kind);
};
/** 그날 기록하지 않은 경로를 모두 '매출 없음'으로 확인 */
function checkRest(d: AppData, date: string) {
  for (const s of salesSlots(d))
    if (!d.sales.some((e) => e.date === date && e.channel === s.channel && e.routeId === s.routeId))
      d.salesChecks.push({ date, channel: s.channel, routeId: s.routeId, status: 'noSales', checkedAt: '' });
}

describe('① 미입력과 명시적 0원', () => {
  it('재현: 홀·포장은 미입력(0원 아님), 배달은 배달앱 B가 빠져 일부 확인', () => {
    const { a } = both(repro());
    expect(a.channels.hall.coverage.state).toBe('none');
    expect(a.channels.takeout.coverage.state).toBe('none');
    expect(a.channels.delivery.coverage).toEqual({ state: 'partial', missing: [{ date: D, routeId: 'route_app_b' }] });
    expect(channelSalesCalc(a.channels.hall)).toMatchObject({ value: null, salesGap: true, note: '미입력' });
    expect(channelSalesCalc(a.channels.delivery)).toMatchObject({ value: null, provisional: 200_000, salesGap: true });
  });
  it('재현: 할인 확인 기록 0건이면 할인액 미입력이고 −100%로 비교하지 않는다', () => {
    const d = repro();
    const disc = getMetric(both(d).a, { key: 'storeDiscount', channel: 'delivery' });
    expect(disc).toMatchObject({ value: null, salesGap: true, note: '할인액 미입력' });
    expect(basisText(disc.basis)).toBe('매출 기록 1건 중 0건 확인');
    expect(cmp(d, { key: 'storeDiscount', channel: 'delivery' })).toEqual({ abs: null, pct: null, note: GAP_NOTE });
  });
  it('재현: 총매출·영업이익 증감, 흑자·적자 전환, 대상 외 변화 경고, 목표 판정에 부분 합계가 들어가지 않는다', () => {
    const d = repro();
    expect(cmp(d, { key: 'totalSales', channel: 'all' }).abs).toBeNull();
    expect(cmp(d, { key: 'operatingProfit', channel: 'all' }, 'profit')).toEqual({ abs: null, pct: null, note: GAP_NOTE });
    const { b, a } = both(d);
    const ctx = reviewContext(b, a, 'delivery');
    expect(ctx.opDelta).toBeNull();
    expect(ctx.channelDelta).toEqual({ hall: null, delivery: null, takeout: null });
    expect(ctx.outweighing).toEqual([]);
    expect(ctx.gapChannels).toEqual(['hall', 'delivery', 'takeout']);
    expect(discountEfficiency(b, a, 'delivery').ok).toBe(false);
    // 부분 합계는 보여줄 수 있게 남아 있다
    expect(a.totalSales.provisional).toBe(200_000);
  });
  it('직접 0원을 입력하고 나머지 경로를 매출 없음으로 확인하면 0원은 정상 집계되고 비교한다', () => {
    const d = repro();
    Object.assign(d.sales[d.sales.length - 1], { storeDiscount: 0, refund: 0 });
    checkRest(d, D);
    const { b, a } = both(d);
    expect(a.channels.hall.coverage.state).toBe('zero');
    expect(channelSalesCalc(a.channels.hall)).toEqual({ value: 0 });
    expect(a.channels.delivery.coverage.state).toBe('complete');
    expect(getMetric(a, { key: 'storeDiscount', channel: 'delivery' })).toEqual({ value: 0 });
    expect(a.totalSales).toEqual({ value: 200_000 });
    expect(cmp(d, { key: 'totalSales', channel: 'all' }).abs).toBe(200_000 - (b.totalSales.value as number));
    expect(reviewContext(b, a, 'delivery').channelDelta.hall).not.toBeNull();
    expect(recordGaps(d, a)).toEqual([]);
  });
  it('빠진 기록은 경로별로 묶어 채울 곳을 알려준다 (계산에서 뺀 통째로 빈 날은 넣지 않음)', () => {
    const d = repro();
    const gaps = recordGaps(d, both(d).a);
    expect(gaps).toEqual(
      expect.arrayContaining([
        { kind: 'sales', channel: 'hall', routeId: 'route_hall', dates: [D] },
        { kind: 'sales', channel: 'delivery', routeId: 'route_app_b', dates: [D] },
        { kind: 'discount', channel: 'delivery', routeId: 'route_app_a', dates: [D] },
      ]),
    );
    expect(gaps.every((g) => g.dates.every((x) => x === D))).toBe(true);
  });
  it('문제 진단도 같은 기준: 기록이 빠진 판매 방식은 증감·급감 대신 기록 확인 필요로 알린다', () => {
    const d = repro();
    const { b, a } = both(d);
    const dx = diagnoseSummaries(d, b, a, { channel: 'all', target: { key: 'operatingProfit', channel: 'all' }, targetValue: 1 });
    expect(dx.findings.filter((f) => f.id.startsWith('gap-')).map((f) => f.id)).toEqual(['gap-hall', 'gap-delivery', 'gap-takeout']);
    expect(dx.findings.some((f) => /orders-down|visitors-down|discount-up|unit-profit-down/.test(f.id))).toBe(false);
    expect(dx.totalDelta).toBeNull();
    expect(dx.channelChanges.every((r) => r.gap)).toBe(true);
    expect(dx.target.achieved).toBeNull();
  });
});

describe('② 할인 상세 일부 누락', () => {
  it('10건 중 8건만 알면 확인된 할인 합계(부분 합계)와 매출 기록 기준 범위를 밝히고, 비교·할인 효율은 보류', () => {
    const d = generateSample('2026-11-19');
    const recs = d.sales.filter((e) => e.channel === 'delivery' && e.date >= BEFORE.start && e.date <= BEFORE.end);
    // 순매출만 입력한 기록 2건 (할인액 모름)
    for (const e of recs.slice(0, 2)) Object.assign(e, { amountMode: 'net', netInput: e.gross! - e.storeDiscount! - e.refund!, gross: null, storeDiscount: null, refund: null });
    const known = recs.slice(2).reduce((s, e) => s + e.storeDiscount!, 0);
    const disc = getMetric(computeSummary(d, BEFORE), { key: 'storeDiscount', channel: 'delivery' });
    expect(disc).toMatchObject({ value: null, provisional: known, salesGap: true, note: '확인된 할인 합계' });
    expect(basisText(disc.basis)).toBe(`매출 기록 ${recs.length}건 중 ${recs.length - 2}건 확인`);
    const prev = computeSummary(d, { start: '2026-10-23', end: '2026-11-05' });
    expect(compareCalc(getMetric(prev, { key: 'storeDiscount', channel: 'delivery' }), disc).note).toBe(GAP_NOTE);
    expect(discountEfficiency(prev, computeSummary(d, BEFORE), 'delivery')).toMatchObject({ ok: false });
    // 매출 합계는 다 입력돼 있으니 매출·주문 수 비교는 계속된다
    expect(compareCalc(getMetric(prev, { key: 'netSales', channel: 'delivery' }), getMetric(computeSummary(d, BEFORE), { key: 'netSales', channel: 'delivery' })).abs).not.toBeNull();
  });
});

describe('③ 휴업일·매출 없음·운영하지 않는 경로', () => {
  it('휴업일의 빈 경로는 빠진 기록이 아니고, 모든 경로를 매출 없음으로 확인한 판매 방식은 0원 확인', () => {
    const d = generateSample('2026-11-19');
    // 11-20 임시 휴업 + 11-21 배달만 기록, 홀·포장은 매출 없음 확인
    d.dayOverrides.push({ date: D, open: false, note: '임시 휴업' });
    const day2 = '2026-11-21';
    d.sales.push(
      newSalesEntry({ date: day2, channel: 'delivery', routeId: 'route_app_a', amountMode: 'net', netInput: 100_000, orders: 5, storeDiscount: 0, refund: 0 }),
      newSalesEntry({ date: day2, channel: 'delivery', routeId: 'route_app_b', amountMode: 'net', netInput: 50_000, orders: 2, storeDiscount: 0, refund: 0 }),
    );
    checkRest(d, day2);
    const days = [D, day2];
    expect(channelCoverage(d, 'hall', days)).toEqual({ state: 'zero', missing: [] });
    expect(channelCoverage(d, 'delivery', days)).toEqual({ state: 'complete', missing: [] });
    const a = computeSummary(d, { start: D, end: day2 });
    expect(a.totalSales).toEqual({ value: 150_000 });
    expect(getMetric(a, { key: 'storeDiscount', channel: 'all' })).toEqual({ value: 0 });
  });
  it('가게가 운영하지 않는 판매 방식·경로는 기다리지 않는다 (영원히 미완료로 남지 않음)', () => {
    const d = generateSample('2026-11-19');
    d.store!.channels = ['delivery'];
    d.routes = d.routes.filter((r) => r.id !== 'route_app_b');
    d.sales.push(newSalesEntry({ date: D, channel: 'delivery', routeId: 'route_app_a', amountMode: 'net', netInput: 200_000, orders: 10, storeDiscount: 0, refund: 0 }));
    const a = computeSummary(d, AFTER);
    expect(a.channels.hall.coverage.state).toBe('notUsed');
    expect(a.channels.delivery.coverage.state).toBe('complete');
    expect(a.totalSales).toEqual({ value: 200_000 });
  });
  it('가게 설정이 없는 이전 데이터는 경로 목록을 모르므로 판정을 바꾸지 않는다 (기록이 있으면 그대로 집계)', () => {
    const d = repro();
    d.store = null;
    const a = computeSummary(d, AFTER);
    expect(a.channels.delivery.coverage.state).toBe('complete');
    expect(a.totalSales.salesGap).toBeUndefined();
  });
});

describe('쿠폰 결정 요약 문장', () => {
  it('샘플 점검 숫자: 한 건당 141원 덜 남았지만 주문이 69건 늘어 배달 전체에서는 276,394원 더 남았어요', () => {
    expect(deliveryChangeText([5_081.4, 4_940.2], [458, 527], [2_326_992, 2_603_386])).toBe('주문 한 건당 141원 덜 남았지만 주문이 69건 늘어 배달 전체에서 남은 돈은 약 27만 6천 원 늘었어요.');
  });
  it('방향이 같으면 "고", 주문이 줄면 "줄어" (원인은 말하지 않음)', () => {
    expect(deliveryChangeText([4_000, 4_500], [100, 90], [400_000, 405_000])).toBe('주문 한 건당 500원 더 남았고 주문이 10건 줄어 배달 전체에서 남은 돈은 5,000원 늘었어요.');
    expect(deliveryChangeText([4_000, 3_500], [100, 100], [400_000, 350_000])).toBe('주문 한 건당 500원 덜 남았고 주문 수는 같아 배달 전체에서 남은 돈은 5만 원 줄었어요.');
  });
});
