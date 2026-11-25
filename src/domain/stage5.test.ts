// 4차 점검(배달 쿠폰 결정 페르소나) 2단계 개선. 격리된 데이터만 사용한다(localStorage 사용 안 함).
// 샘플은 2026-11-19까지 생성(오늘 2026-11-20 상황).
import { describe, expect, it } from 'vitest';
import { migrate, parseBackup, serialize } from '../storage/storage';
import { computeSummary, getMetric } from './calc';
import { diagnose } from './diagnosis';
import { discountEfficiency, discountEfficiencyText, discountRow } from './discount';
import { solutionDraft } from './draft';
import { newSolution } from './factory';
import { couponText } from './format';
import { easyMetricName, metricLabelEasy } from './labels';
import { pendingEntries, pendingEstimates } from './pending';
import { generateSample } from './sample';
import { DELIVERY_KPI_SET, defaultKpisFor } from './templates';
import { SCHEMA_VERSION, type AppData } from './types';

const data = () => generateSample('2026-11-19');

describe('저장 형식 v6 마이그레이션', () => {
  it('v5 실행 계획에 함께 볼 지표·쿠폰 조건·다음 쿠폰 금액을 빈 값으로 채우고 나머지는 그대로 둔다', () => {
    const d = data();
    // v5 모양으로 되돌린다 (v6 필드 제거)
    const v5 = {
      ...d,
      schemaVersion: 5,
      solutions: d.solutions.map(({ extraKpis: _e, coupon: _c, review: { nextCouponAmount: _n, ...review }, ...s }) => ({ ...s, review })),
    };
    const parsed = parseBackup(JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 5, exportedAt: '2026-11-20T00:00:00.000Z', data: v5 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.schemaVersion).toBe(SCHEMA_VERSION);
    for (const s of parsed.data.solutions) {
      expect(s.extraKpis).toEqual([]);
      expect(s.coupon).toEqual({ amount: null, minOrder: null, routeId: null, previousAmount: null, usedCount: null });
      expect(s.review.nextCouponAmount).toBeNull();
    }
    // 주 성과지표·목표·검토 기간과 매출·비용 계산은 바뀌지 않는다
    expect(parsed.data.solutions.map((s) => [s.kpi, s.kpiTarget, s.review.before])).toEqual(d.solutions.map((s) => [s.kpi, s.kpiTarget, s.review.before]));
    const r = d.problems[0].analysis;
    expect(computeSummary(parsed.data, r).operatingProfit).toEqual(computeSummary(d, r).operatingProfit);
  });
  it('원본 객체는 바꾸지 않고, 이상한 값은 빈 값으로 정리한다', () => {
    const raw = { solutions: [{ name: 'x', coupon: { amount: 'abc', minOrder: 12000 }, extraKpis: [{ key: 'orders', channel: 'delivery' }, 7], review: { nextCouponAmount: 2000 } }] };
    const before = JSON.stringify(raw);
    const m = migrate(raw, 5) as { solutions: { coupon: unknown; extraKpis: unknown; review: { nextCouponAmount: unknown } }[] };
    expect(JSON.stringify(raw)).toBe(before);
    expect(m.solutions[0].coupon).toMatchObject({ amount: null, minOrder: 12000 });
    expect(m.solutions[0].extraKpis).toEqual([{ key: 'orders', channel: 'delivery' }]);
    expect(m.solutions[0].review.nextCouponAmount).toBe(2000);
  });
  it('v6 저장·불러오기 왕복', () => {
    const d = data();
    d.solutions[0].review.nextCouponAmount = 2000;
    const p = parseBackup(serialize(d));
    expect(p.ok && p.data.solutions[0].review.nextCouponAmount).toBe(2000);
    expect(p.ok && p.data.solutions[0].coupon).toEqual({ amount: 3000, minOrder: 15000, routeId: 'route_app_a', previousAmount: 1000, usedCount: null });
  });
});

describe('5. 쿠폰 결정용 세 지표', () => {
  it('배달 대상 계획의 기본값: ① 배달 1건당 남는 금액 ② 배달에서 판매 방식 비용을 뺀 금액 ③ 가게 전체 영업이익', () => {
    const k = defaultKpisFor('delivery');
    expect([k.kpi, ...k.extraKpis]).toEqual(DELIVERY_KPI_SET);
    // 주 지표가 셋 중 하나면 그대로 두고 나머지 둘을 함께 본다
    const k2 = defaultKpisFor('delivery', { key: 'directProfit', channel: 'delivery' });
    expect(k2.kpi).toEqual({ key: 'directProfit', channel: 'delivery' });
    expect(k2.extraKpis).toEqual([DELIVERY_KPI_SET[0], DELIVERY_KPI_SET[2]]);
    expect(defaultKpisFor('takeout', { key: 'orders', channel: 'takeout' }).extraKpis).toEqual([]);
  });
  it('진단에서 배달 항목으로 만든 계획 초안에도 세 지표가 모두 들어간다', () => {
    const d = data();
    const s = solutionDraft(d, d.problems[0], 'delivery-unit-profit-down');
    expect(s.target).toBe('delivery');
    expect([s.kpi, ...s.extraKpis]).toEqual(expect.arrayContaining(DELIVERY_KPI_SET));
    expect(s.extraKpis).toHaveLength(2);
  });
  it('샘플 배달 계획도 세 지표를 본다', () => {
    const s = data().solutions.find((x) => x.target === 'delivery')!;
    expect([s.kpi, ...s.extraKpis]).toEqual(expect.arrayContaining(DELIVERY_KPI_SET));
  });
});

describe('6. 쿠폰·할인 비용을 원 단위로', () => {
  const d = data();
  const dx = diagnose(d, d.problems[0]);
  it('가게 부담 할인액 지표 = 할인 상세가 있는 기록의 할인 합계', () => {
    expect(getMetric(dx.prev, { key: 'storeDiscount', channel: 'delivery' }).value).toBe(791_000);
    expect(getMetric(dx.cur, { key: 'storeDiscount', channel: 'delivery' }).value).toBe(2_608_500);
    const all = getMetric(dx.cur, { key: 'storeDiscount', channel: 'all' }).value!;
    expect(all).toBe(dx.cur.channels.hall.discount + dx.cur.channels.delivery.discount + dx.cur.channels.takeout.discount);
  });
  it('주문당 할인액과 비율 (점검 보고서의 4.2% → 11.6%와 같은 데이터)', () => {
    const r = discountRow(dx.prev.channels.delivery, dx.cur.channels.delivery);
    expect(r.prevPerOrder).toBeCloseTo(791_000 / 791, 6);
    expect(r.curPerOrder).toBeCloseTo(2_608_500 / 998, 6);
    expect(r.prevRate!.toFixed(1)).toBe('4.2');
    expect(r.curRate!.toFixed(1)).toBe('11.6');
  });
  it('할인 1,000원당: 주문 변화 ÷ (할인 변화 ÷ 1,000), 남은 금액 변화 ÷ (할인 변화 ÷ 1,000)', () => {
    const e = discountEfficiency(dx.prev, dx.cur, 'delivery');
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.deltaDiscount).toBe(1_817_500);
    expect(e.deltaOrders).toBe(207);
    const dp = dx.cur.channels.delivery.directProfit.value! - dx.prev.channels.delivery.directProfit.value!;
    expect(e.profitPer1000).toBeCloseTo(dp / 1817.5, 6);
    expect(e.ordersPer1000).toBeCloseTo(207 / 1817.5, 9);
    expect(discountEfficiencyText(e)).toBe('할인 1,000원 더 쓸 때마다 주문 +0.11건, 남은 돈 −812원');
  });
  it('데이터가 부족하면 계산하지 않고 이유를 준다', () => {
    expect(discountEfficiency(dx.prev, dx.cur, 'hall')).toEqual({ ok: false, reason: expect.stringContaining('10,000원 미만') });
    const d2 = data();
    const e = d2.sales.find((x) => x.date === '2026-11-13' && x.channel === 'delivery')!;
    Object.assign(e, { amountMode: 'net', netInput: 500_000, storeDiscount: null, refund: null, gross: null });
    const dx2 = diagnose(d2, d2.problems[0]);
    expect(discountEfficiency(dx2.prev, dx2.cur, 'delivery')).toEqual({ ok: false, reason: expect.stringContaining('할인·환불 상세') });
    // 할인액 지표는 "N건 중 M건 기준"을 붙인다 (0원으로 보지 않음)
    expect(getMetric(dx2.cur, { key: 'storeDiscount', channel: 'delivery' }).basis?.unit).toBe('건');
  });
});

describe('7. 쿠폰 조건 기록', () => {
  it('진단에서 만든 새 계획 초안은 다른 계획의 다음 쿠폰 금액을 가져오지 않는다 (재시험에서만 승계 — stage7.test)', () => {
    const d = data();
    const del = d.solutions.find((s) => s.target === 'delivery')!;
    del.review = { ...del.review, nextCouponAmount: 2000, reviewedAt: '2026-11-20T10:00:00.000Z' };
    const draft = solutionDraft(d, d.problems[0], 'delivery-unit-profit-down');
    expect(draft.coupon).toEqual(newSolution().coupon);
  });
  it('쿠폰 조건 한 줄 표시', () => {
    expect(couponText({ amount: 3000, minOrder: 15000 })).toBe('쿠폰 3,000원 · 최소 주문 15,000원');
    expect(couponText({ amount: 0, minOrder: null })).toBe('쿠폰 0원(중단)');
    expect(couponText({ amount: 2000, minOrder: 15000, previousAmount: 3000 }, '배달앱 A')).toBe('배달앱 A · 쿠폰 3,000원 → 2,000원 · 최소 주문 15,000원');
    expect(couponText({ amount: null, minOrder: null, previousAmount: 3000 })).toBe('쿠폰 3,000원 → 미정');
    expect(couponText(newSolution().coupon)).toBeNull();
  });
});

describe('8. 쉬운 이름', () => {
  it('정확한 용어 옆에 쉬운 이름', () => {
    expect(easyMetricName('directProfit', 'delivery')).toBe('배달에서 남은 돈');
    expect(easyMetricName('directProfitPerOrder', 'delivery')).toBe('배달 1건당 남은 돈');
    expect(metricLabelEasy('directProfit', 'delivery')).toBe('배달에서 남은 돈 (배달 판매 방식 비용을 뺀 금액)');
    expect(metricLabelEasy('orders', 'delivery')).toBe('배달 완료 주문 수');
  });
});

/** 정산 전 수수료를 '모르는 할인·환불을 0원으로 가정한' 이전 버전 계산값으로 바꾼다 (추정값 할 일 검증용) */
function markFeesAssumed(d: AppData) {
  for (const e of d.sales)
    for (const c of ['brokerage', 'payment'] as const)
      if (e.costs[c].actual === null && e.costs[c].estimated !== null) e.costs[c].estimateBasis += ' · 할인·환불 금액을 몰라 환불 0원으로 가정 — 실제보다 낮게 추정될 수 있음';
}

describe('9. 추정값을 확정하는 할 일', () => {
  const d = data();
  const range = d.problems[0].analysis;
  it('설정 요율대로 계산한 정산 전 수수료는 할 일이 아니고, 지난달 금액을 가져온 공과금(추정)만 청구서 대기로', () => {
    const items = pendingEstimates(d, range);
    expect(items.map((i) => `${i.title}: ${i.label}`)).toEqual(['청구서 반영 대기: 11/1~11/30 공과금 (공통)']);
    const s = computeSummary(d, range);
    expect(s.status.calculatedAmount).toBeGreaterThan(0); // 수수료는 정상 계산으로 합계에 들어 있음
    expect(s.status.estimatedAmount).toBeCloseTo(s.commonByCategory.utilities.estimated, 4);
  });
  it('가정이 들어간 수수료는 경로·판매 방식별로 묶어 정산서 대기로, 할 일 합계 = 요약의 추정 비용', () => {
    const d2 = data();
    markFeesAssumed(d2);
    const items = pendingEstimates(d2, range);
    expect(items.map((i) => `${i.title}: ${i.label}`)).toEqual([
      '청구서 반영 대기: 11/1~11/30 공과금 (공통)',
      '정산서 반영 대기: 11/13~11/19 배달앱 A(배달) 중개·결제 수수료',
      '정산서 반영 대기: 11/13~11/19 배달앱 B(배달) 중개 수수료',
      '정산서 반영 대기: 11/13~11/19 배달앱 A(포장) 중개·결제 수수료',
      '정산서 반영 대기: 11/13~11/19 매장 방문 주문(홀) 결제 수수료',
      '정산서 반영 대기: 11/13~11/19 전화 주문(포장) 결제 수수료',
    ]);
    // 공과금은 조회 기간에 안분된 금액만 요약에 들어감
    const s = computeSummary(d2, range);
    const entrySum = items.filter((i) => i.kind !== 'period').reduce((n, i) => n + i.amount, 0);
    expect(entrySum + s.commonByCategory.utilities.estimated).toBeCloseTo(s.status.estimatedAmount, 4);
    expect(s.status.calculatedAmount).toBe(0);
  });
  it('정산서 금액을 넣은 기록은 빠지고, 중간 날짜를 채우면 기간이 나뉜다', () => {
    const d2 = data();
    markFeesAssumed(d2);
    const item = pendingEstimates(d2, range).find((i) => i.label.includes('배달앱 A(배달)'))!;
    const list = pendingEntries(d2, { start: item.start, end: item.end, routeId: item.routeId!, channel: item.channel!, categories: item.categories as never });
    expect(list).toHaveLength(6);
    // 11/17 기록에 정산서 금액 입력
    const mid = d2.sales.find((e) => e.date === '2026-11-17' && e.routeId === 'route_app_a' && e.channel === 'delivery')!;
    mid.costs.brokerage.actual = 50_000;
    mid.costs.payment.actual = 20_000;
    const after = pendingEstimates(d2, range).filter((i) => i.label.includes('배달앱 A(배달)')).map((i) => i.label);
    expect(after).toEqual(['11/13~11/16 배달앱 A(배달) 중개·결제 수수료', '11/18~11/19 배달앱 A(배달) 중개·결제 수수료']);
  });
});
