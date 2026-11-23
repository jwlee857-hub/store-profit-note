// 5차 점검 2단계: 정산 반영 · 쿠폰 조건 승계 · 첫 마감 안내. 가상 데이터만 사용.
import { describe, expect, it } from 'vitest';
import { parseBackup, serialize } from '../storage/storage';
import { computeSummary, getMetric, netSales } from './calc';
import { retestDraft, solutionDraft } from './draft';
import { fillEstimates } from './entry';
import { newSalesEntry, newSolution, registerStoreData } from './factory';
import { pendingEstimates } from './pending';
import { scopeToRoute, withChannelFrom } from './review';
import { generateSample } from './sample';
import { applyPeriodSettlement, applySettlementEdits, editOf, periodOverlap, settlementTodos, setupHint } from './settlement';
import { SCHEMA_VERSION, type AppData, type SalesEntry } from './types';

const D = '2026-11-20';
/** 마감 직후처럼 배달앱 A 순매출·주문 수만 저장 (할인·환불 모름 → 수수료는 계산하지 않음) */
function closing(d: AppData, date = D, net = 200_000, orders = 10): SalesEntry {
  const e = fillEstimates(newSalesEntry({ date, channel: 'delivery', routeId: 'route_app_a', paymentMethodId: 'pay_platform', amountMode: 'net', netInput: net, orders }), d).entry;
  d.sales.push(e);
  return e;
}
const R = { start: D, end: D };
const deliveryCost = (d: AppData) => {
  const c = computeSummary(d, R).channels.delivery.directByCategory;
  return c.brokerage.actual + c.brokerage.calculated + c.brokerage.estimated + c.payment.actual + c.payment.calculated + c.payment.estimated;
};

describe('④ 배달앱 정산 반영 — 일별', () => {
  it('할인을 나중에 넣어도 순매출에서 다시 빼지 않고, 실제 수수료가 계산 수수료를 대체하며, 식재료비 추정은 그대로 둔다', () => {
    const d = generateSample('2026-11-19');
    const e = closing(d);
    expect(e.costs.brokerage.estimated).toBeNull(); // 환불을 몰라 수수료 미계산(0원 아님)
    const food = e.costs.food;
    d.sales = applySettlementEdits(d, [{ ...editOf(e), storeDiscount: 30_000, refund: 0 }]);
    let x = d.sales.find((s) => s.id === e.id)!;
    expect(netSales(x)).toBe(200_000);
    expect(x.costs.brokerage.estimated).not.toBeNull(); // 할인·환불을 알게 되어 계산 수수료가 생김
    expect(x.costs.food).toEqual(food);
    const calculated = deliveryCost(d);
    d.sales = applySettlementEdits(d, [{ ...editOf(x), brokerage: 17_000, payment: 6_000 }]);
    x = d.sales.find((s) => s.id === e.id)!;
    expect(deliveryCost(d)).toBe(23_000); // 실제값만 (계산값과 더하지 않음)
    expect(calculated).not.toBe(23_000);
    expect(x.costs.food).toEqual(food);
    // 그날 배달앱 B는 매출 없음으로 확인해야 배달 할인 합계가 완전한 값이 된다 (1단계 입력 현황 규칙)
    expect(getMetric(computeSummary(d, R), { key: 'storeDiscount', channel: 'delivery' })).toMatchObject({ value: null, provisional: 30_000, salesGap: true });
    d.salesChecks.push({ date: D, channel: 'delivery', routeId: 'route_app_b', status: 'noSales', checkedAt: '' });
    expect(getMetric(computeSummary(d, R), { key: 'storeDiscount', channel: 'delivery' })).toEqual({ value: 30_000 });
  });
  it('같은 정산 값을 다시 저장해도 기록·합계가 바뀌지 않는다', () => {
    const d = generateSample('2026-11-19');
    const e = closing(d);
    const edit = { ...editOf(e), storeDiscount: 30_000, refund: 0, brokerage: 17_000, payment: 6_000 };
    d.sales = applySettlementEdits(d, [edit]);
    const once = JSON.stringify(d.sales);
    const sum = computeSummary(d, R).channels.delivery.directProfit;
    d.sales = applySettlementEdits(d, [edit]);
    expect(JSON.stringify(d.sales)).toBe(once);
    expect(computeSummary(d, R).channels.delivery.directProfit).toEqual(sum);
  });
});

describe('④ 배달앱 정산 반영 — 기간 합계', () => {
  const setup = () => {
    const d = generateSample('2026-11-19');
    const a = closing(d, '2026-11-20');
    const b = closing(d, '2026-11-21', 300_000, 15);
    // 할인·환불을 알게 되어 계산 수수료가 들어간 상태
    d.sales = applySettlementEdits(d, [
      { ...editOf(a), storeDiscount: 20_000, refund: 0 },
      { ...editOf(b), storeDiscount: 30_000, refund: 0 },
    ]);
    return { d, ids: [a.id, b.id] };
  };
  const range = { start: '2026-11-20', end: '2026-11-21' };
  const ps = { routeId: 'route_app_a', channel: 'delivery' as const, ...range, amount: 50_000 };
  const feeTotal = (d: AppData) => {
    const c = computeSummary(d, range).channels.delivery.directByCategory;
    return [c.brokerage, c.payment].reduce((s, x) => s + x.actual + x.calculated + x.estimated, 0);
  };
  it('기간 합계는 배달앱·기간 범위를 남기고, 그 범위의 계산 수수료를 대체한다 (두 번 더하지 않음)', () => {
    const { d } = setup();
    const ov = periodOverlap(d, ps);
    expect(ov.calculated.count).toBe(2);
    expect(ov.dailyActual.count).toBe(0);
    const r = applyPeriodSettlement(d, ps, 'keepDaily');
    if ('error' in r) throw new Error(r.error);
    Object.assign(d, r);
    const pc = d.periodCosts.filter((p) => p.routeId === 'route_app_a');
    expect(pc).toHaveLength(1);
    expect(pc[0]).toMatchObject({ start: range.start, end: range.end, amount: 50_000, attribution: 'delivery', source: 'actual' });
    expect(feeTotal(d)).toBe(50_000);
    // 정산서 반영 대기 할 일에서도 빠진다
    expect(pendingEstimates(d, range).some((it) => it.kind === 'fee' && it.routeId === 'route_app_a')).toBe(false);
  });
  it('같은 정산서를 다시 저장해도 기간 합계는 한 번만 반영된다', () => {
    const { d } = setup();
    for (let i = 0; i < 2; i++) {
      const r = applyPeriodSettlement(d, ps, 'keepDaily');
      if ('error' in r) throw new Error(r.error);
      Object.assign(d, r);
    }
    expect(d.periodCosts.filter((p) => p.routeId === 'route_app_a')).toHaveLength(1);
    expect(feeTotal(d)).toBe(50_000);
    expect(periodOverlap(d, ps).replaced).toHaveLength(1); // 저장 전 화면에 '바꿔 넣음'으로 보여줄 기존 합계
  });
  it('일별 실제액과 겹치면: 그대로 두고 나머지만 반영하거나, 기간 합계로 대체한다 — 어느 쪽이든 합계는 정산서 금액', () => {
    const { d, ids } = setup();
    d.sales = applySettlementEdits(d, [{ ...editOf(d.sales.find((s) => s.id === ids[0])!), brokerage: 12_000, payment: 3_000 }]);
    expect(periodOverlap(d, ps).dailyActual).toEqual({ count: 1, amount: 15_000 });
    const keep = applyPeriodSettlement(d, ps, 'keepDaily');
    if ('error' in keep) throw new Error(keep.error);
    expect(keep.periodCosts.find((p) => p.routeId)!.amount).toBe(35_000);
    expect(feeTotal({ ...d, ...keep })).toBe(50_000);
    const rep = applyPeriodSettlement(d, ps, 'replaceDaily');
    if ('error' in rep) throw new Error(rep.error);
    expect(rep.sales.find((s) => s.id === ids[0])!.costs.brokerage.actual).toBeNull();
    expect(feeTotal({ ...d, ...rep })).toBe(50_000);
    expect(applyPeriodSettlement(d, { ...ps, amount: 10_000 }, 'keepDaily')).toHaveProperty('error');
  });
  it('기존 백업의 일반 기간 비용(배달앱 지정 없음)은 일별 수수료를 대체하지 않는다', () => {
    const { d } = setup();
    const before = feeTotal(d);
    d.periodCosts.push({ id: 'old', category: 'channelAd', attribution: 'delivery', nature: 'fixed', start: '2026-11-01', end: '2026-11-30', amount: 300_000, source: 'actual', memo: '' });
    expect(feeTotal(d)).toBe(before);
  });
});

describe('⑤ 무관한 새 계획과 같은 쿠폰 재시험의 조건 승계', () => {
  const reviewed = () => {
    const d = generateSample('2026-11-19');
    const del = d.solutions.find((s) => s.target === 'delivery')!;
    del.review = { ...del.review, nextCouponAmount: 2000, reviewedAt: '2026-11-21T10:00:00.000Z' };
    return { d, del };
  };
  it('일반 새 계획·문제 진단 초안은 빈 쿠폰 조건으로 시작한다 (가게 전체 대상에 2,000원이 채워지지 않음)', () => {
    const { d } = reviewed();
    const empty = newSolution().coupon;
    expect(empty).toEqual({ amount: null, minOrder: null, routeId: null, previousAmount: null, usedCount: null });
    expect(solutionDraft(d, d.problems[0]).coupon).toEqual(empty);
    expect(solutionDraft(d, d.problems[0], 'delivery-unit-profit-down').coupon).toEqual(empty);
    expect(solutionDraft(d, null).coupon).toEqual(empty);
  });
  it('이 조건으로 2주 재시험: 대상 앱·다음 쿠폰액·최소 주문액·핵심 지표를 넘기고, 이번 쿠폰액은 기존 쿠폰액이 된다', () => {
    const { del } = reviewed();
    const r = retestDraft(del, '2026-11-23'); // 월요일 → 다음 주 월요일
    expect(r.id).not.toBe(del.id);
    expect(r.coupon).toEqual({ routeId: 'route_app_a', previousAmount: 3000, amount: 2000, minOrder: 15000, usedCount: null });
    expect([r.target, r.kpi, r.extraKpis]).toEqual([del.target, del.kpi, del.extraKpis]);
    expect([r.start, r.end]).toEqual(['2026-11-30', '2026-12-13']);
    expect(r.review).toEqual(newSolution().review);
    expect(r.name).toContain('쿠폰 2,000원 2주 재시험');
  });
  it('쿠폰 미정과 0원으로 중단을 구분해 넘긴다', () => {
    const { del } = reviewed();
    const undecided = retestDraft({ ...del, review: { ...del.review, nextCouponAmount: null } }, '2026-11-23');
    expect(undecided.coupon.amount).toBeNull();
    expect(undecided.name).toContain('쿠폰 미정');
    const stop = retestDraft({ ...del, review: { ...del.review, nextCouponAmount: 0 } }, '2026-11-23');
    expect(stop.coupon.amount).toBe(0);
    expect(stop.name).toContain('쿠폰 중단');
  });
});

describe('저장 형식 v8 · 대상 배달앱 집계', () => {
  it('v7 백업의 쿠폰 조건은 모르는 값(null)으로 채우고, 계산은 그대로', () => {
    const d = generateSample('2026-11-19');
    const v7 = { ...d, schemaVersion: 7, solutions: d.solutions.map((s) => ({ ...s, coupon: { amount: s.coupon.amount, minOrder: s.coupon.minOrder } })) };
    const p = parseBackup(JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 7, exportedAt: '2026-11-21T00:00:00.000Z', data: v7 }));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.data.solutions[0].coupon).toEqual({ amount: 3000, minOrder: 15000, routeId: null, previousAmount: null, usedCount: null });
    const r = d.problems[0].analysis;
    expect(computeSummary(p.data, r).operatingProfit).toEqual(computeSummary(d, r).operatingProfit);
    expect(parseBackup(serialize(p.data)).ok).toBe(true);
  });
  it('대상 배달앱을 정하면 배달 숫자는 그 앱 주문만, 가게 전체 합계는 그대로', () => {
    const d = generateSample('2026-11-19');
    const r = { start: '2026-11-06', end: '2026-11-19' };
    const full = computeSummary(d, r);
    const merged = withChannelFrom(full, computeSummary(scopeToRoute(d, 'delivery', 'route_app_a'), r), 'delivery');
    const appA = d.sales.filter((e) => e.channel === 'delivery' && e.routeId === 'route_app_a' && e.date >= r.start && e.date <= r.end);
    expect(merged.channels.delivery.orders).toBe(appA.reduce((s, e) => s + e.orders!, 0));
    expect(merged.channels.delivery.netSales).toBe(appA.reduce((s, e) => s + netSales(e)!, 0));
    expect(merged.operatingProfit).toEqual(full.operatingProfit);
    // 배달앱 B를 아직 기록하지 않은 날이 있어도 앱 A 대상 집계는 빠진 기록이 아니다
    d.sales = d.sales.filter((e) => !(e.routeId === 'route_app_b' && e.date === '2026-11-19'));
    expect(computeSummary(scopeToRoute(d, 'delivery', 'route_app_a'), r).channels.delivery.coverage.state).toBe('complete');
  });
});

describe('첫 마감 안내', () => {
  it('신규 가게는 비용 설정 없이 첫 매출·주문 수를 저장할 수 있고, 방금 기록에 관련된 설정 하나만 제안한다', () => {
    const d = registerStoreData({ name: '덮밥집', channels: ['hall', 'delivery', 'takeout'], regularOpenDays: [1, 2, 3, 4, 5, 6], deliveryApps: [{ name: '배달앱 A', brokerageRate: null, paymentRate: null, vatExclusive: false }], directDelivery: false });
    const route = d.routes.find((r) => r.channels.includes('delivery') && r.platformId)!;
    const e = fillEstimates(newSalesEntry({ date: D, channel: 'delivery', routeId: route.id, amountMode: 'net', netInput: 200_000, orders: 10 }), d).entry;
    expect(e.netInput).toBe(200_000);
    expect(setupHint(d, e)).toEqual({ text: '용기 한 개 가격을 알면 다음부터 포장비를 자동 계산해요.', section: 'per-order' });
    d.perOrderCosts.push({ id: 'p', channel: 'delivery', routeId: null, category: 'packaging', amount: 500, effectiveFrom: '2026-01-01' });
    expect(setupHint(d, e)?.section).toBe('per-order'); // 다음은 배달비
    const hall = d.routes.find((r) => r.channels.includes('hall'))!;
    expect(setupHint(d, newSalesEntry({ channel: 'hall', routeId: hall.id }))?.text).toContain('물티슈');
  });
  it('홈 정산 할 일: 할인액·수수료가 빈 배달앱 기록을 경로별로 모은다', () => {
    const d = generateSample('2026-11-19');
    closing(d);
    expect(settlementTodos(d, R)).toEqual([{ routeId: 'route_app_a', channel: 'delivery', start: D, end: D, discountUnknown: 1, feeMissing: 1 }]);
  });
});
