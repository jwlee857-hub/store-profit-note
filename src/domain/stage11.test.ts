import { describe, expect, it } from 'vitest';
import { coopData, COOP } from '../test/coopFixture';
import { computeSummary, getMetric, netSales } from './calc';
import { STORY, storySample } from './sample';
import { retestDraft } from './draft';
import { hasCoupon, pctChangeText, weekdaysText } from './format';
import { newSolution } from './factory';
import { parseBackup, serialize, validateData } from '../storage/storage';

const sat = [6];
const v = (s: ReturnType<typeof computeSummary>, key: 'visitors' | 'meals') => getMetric(s, { key, channel: 'hall' });

describe('9차: 적용 요일(토요일)만 비교', () => {
  it('전체 영업일 2,560명 → 2,528명(약 1.3% 감소), 토요일 160명 → 128명(20% 감소), 토요일 4회씩', () => {
    const d = coopData();
    const [b, a] = [computeSummary(d, COOP.before), computeSummary(d, COOP.after)];
    expect([v(b, 'visitors').value, v(a, 'visitors').value]).toEqual([2560, 2528]);
    expect(pctChangeText(2560, 2528)).toBe('약 1.3% 감소');
    const [bs, as] = [computeSummary(d, COOP.before, sat), computeSummary(d, COOP.after, sat)];
    expect([v(bs, 'visitors').value, v(as, 'visitors').value]).toEqual([160, 128]);
    expect(pctChangeText(160, 128)).toBe('20% 감소');
    expect([bs.businessDays, as.businessDays, bs.calendarDays, as.calendarDays]).toEqual([4, 4, 4, 4]);
    expect([b.businessDays, a.businessDays]).toEqual([24, 24]);
    expect(weekdaysText(sat)).toBe('토요일');
  });

  it('월세·인건비는 달력 일수 안분 그대로 토요일 날짜 몫만 (10월 토요일 4일 = 월 비용 × 4/31)', () => {
    const d = coopData();
    const as = computeSummary(d, COOP.after, sat);
    // 실행 후 토요일: 10월 10·17·24·31일
    expect(as.commonCost.actual).toBeCloseTo((12_000_000 * 4) / 31, 6);
    const direct = 4 * (32 * 5_000 - 32 * 2_500 - 32 * 100);
    expect(as.operatingProfit.value).toBeCloseTo(direct - (12_000_000 * 4) / 31, 6);
    // 요일을 고르지 않으면 이전과 같은 전체 기간 계산
    expect(computeSummary(d, COOP.after, null).commonCost.actual).toBeCloseTo(computeSummary(d, COOP.after).commonCost.actual, 6);
  });

  it('임시 휴업과 마감 미입력을 구별: 휴업은 영업 횟수에서 빠지고, 미입력은 0명이 아니라 비교 보류', () => {
    const d = coopData();
    d.dayOverrides.push({ date: '2026-10-17', open: false, note: '축제 휴업' });
    d.sales = d.sales.filter((e) => e.date !== '2026-10-17' && e.date !== '2026-10-24');
    const as = computeSummary(d, COOP.after, sat);
    expect(as.calendarDays).toBe(4);
    expect(as.businessDays).toBe(3); // 10/17 휴업
    expect(as.unrecordedDays).toEqual(['2026-10-24']); // 기록 누락
    expect(as.operatingProfit.salesGap).toBe(true);
  });

  it('비용 일부가 빠지면 토요일 손익은 확정값이 아니다 (잠정값 + 미확정)', () => {
    const d = coopData();
    d.periodCosts = d.periodCosts.filter((pc) => !(pc.category === 'labor' && pc.start === '2026-10-01'));
    const as = computeSummary(d, COOP.after, sat);
    expect(as.operatingProfit.value).toBeNull();
    expect(as.operatingProfit.reason).toBe('incomplete');
    expect(typeof as.operatingProfit.provisional).toBe('number');
  });
});

describe('9차: 제공 식수 — 미입력과 0끼 구분', () => {
  it('식수를 넣은 날만 더하고, 아무도 안 넣었으면 0이 아니라 미입력(null)', () => {
    const d = coopData();
    expect(v(computeSummary(d, COOP.after, sat), 'meals').value).toBe(128);
    for (const e of d.sales) e.meals = null;
    expect(v(computeSummary(d, COOP.after, sat), 'meals').value).toBeNull();
    d.sales.find((e) => e.date === '2026-10-10')!.meals = 0;
    const m = v(computeSummary(d, COOP.after, sat), 'meals');
    expect(m.value).toBe(0);
    expect(m.basis).toEqual({ used: 1, total: 4, unit: '일' });
  });
});

describe('9차: 쿠폰 없는 계획 · 판단 보류 · 저장 호환', () => {
  it('쿠폰 조건 판별: 0원(중단)은 쿠폰 계획, 모두 비면 아님', () => {
    expect(hasCoupon({ amount: 0, minOrder: null, previousAmount: null })).toBe(true);
    expect(hasCoupon({ amount: null, minOrder: null, previousAmount: null })).toBe(false);
  });

  it('쿠폰 없는 홀 계획의 재시험 초안에는 쿠폰 문구가 없고 적용 요일은 이어진다', () => {
    const prev = coopData().solutions[0];
    const r = retestDraft(prev, '2026-11-02');
    expect(r.name).toBe('토요일 영업 11~13시로 단축 — 2주 재시험');
    expect(r.coupon.amount).toBeNull();
    expect(r.weekdays).toEqual([6]);
    const coupon = retestDraft(newSolution({ name: 'A', coupon: { amount: 2000, minOrder: null, routeId: null, previousAmount: 3000, usedCount: 5 }, review: { ...newSolution().review, nextCouponAmount: 0 } }), '2026-11-02');
    expect(coupon.name).toBe('A — 쿠폰 중단 2주 재시험');
    expect(coupon.coupon).toMatchObject({ amount: 0, previousAmount: 2000 });
  });

  it('새 필드(적용 요일·제공 식수·요일별 영업시간·판단 보류)는 백업으로 그대로 오가고, 없는 이전 데이터도 열린다', () => {
    const d = coopData();
    d.solutions[0].review = { ...d.solutions[0].review, decision: 'hold', reviewedAt: '2026-11-02T00:00:00.000Z' };
    const back = parseBackup(serialize(d));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.data.solutions[0].weekdays).toEqual([6]);
    expect(back.data.solutions[0].review.decision).toBe('hold');
    expect(back.data.problems[0].weekdays).toEqual([6]);
    expect(back.data.store!.weekdayHours).toEqual([{ day: 6, openTime: '11:00', closeTime: '13:00' }]);
    expect(back.data.sales[0].meals).toBe(120);
    // 이전 데이터: 새 필드가 아예 없음
    const old = JSON.parse(JSON.stringify(d));
    delete old.store.weekdayHours;
    for (const e of old.sales) delete e.meals;
    for (const s of old.solutions) delete s.weekdays;
    for (const p of old.problems) delete p.weekdays;
    old.solutions[0].review.decision = null;
    expect(validateData(old)).toBeNull();
    expect(validateData({ ...old, solutions: [{ ...old.solutions[0], weekdays: [7] }] })).toContain('적용 요일');
    expect(validateData({ ...old, solutions: [{ ...old.solutions[0], review: { ...old.solutions[0].review, decision: 'maybe' } }] })).toContain('판단 값');
  });
});

describe('샘플 숫자는 기록이나 설정에서 나온다 (근거 없는 임의 값 없음)', () => {
  const d = storySample();
  const appA = (r: { start: string; end: string }) =>
    d.sales.filter((e) => e.routeId === 'route_app_a' && e.channel === 'delivery' && e.date >= r.start && e.date <= r.end);

  it('고지서 전 11월 공과금 추정 = 지난달까지 실제 금액', () => {
    const util = d.periodCosts.filter((p) => p.category === 'utilities');
    const est = util.filter((p) => p.source === 'estimated');
    expect(est.map((p) => p.start)).toEqual(['2026-11-01']);
    expect(new Set(util.map((p) => p.amount)).size).toBe(1);
  });

  it('건당 기본 배달비 = 마지막 기록의 건당 배달비', () => {
    for (const routeId of ['route_app_a', 'route_app_b']) {
      const last = d.sales.filter((e) => e.routeId === routeId && e.channel === 'delivery').at(-1)!;
      const poc = d.perOrderCosts.find((p) => p.routeId === routeId && p.category === 'delivery')!;
      expect(poc.amount).toBe(last.costs.delivery.actual! / last.orders!);
    }
  });

  it('고객 집계의 주문 수·매출 합계 = 같은 기간 배달앱 A 배달 기록', () => {
    for (const m of d.customerMetrics) {
      const es = appA({ start: m.periodStart!, end: m.periodEnd! });
      expect(m.newOrders! + m.existingOrders!).toBe(es.reduce((s, e) => s + e.orders!, 0));
      expect(m.newSales! + m.existingSales!).toBe(es.reduce((s, e) => s + netSales(e)!, 0));
    }
  });

  it('10월 계획 예상 효과 = 9월 쿠폰 사용 건수 × 1,000원 인하, 수수료는 설정 요율(중개 7% + 결제 3%, 부가세 별도)', () => {
    const oct = d.solutions.find((s) => s.status === 'done')!;
    const used = appA(STORY.sep).reduce((s, e) => s + e.storeDiscount! / 3000, 0);
    expect(oct.expectedRevenueChange).toBe(Math.round(used) * 1000);
    expect(oct.expectedCostChange).toBe(Math.round((oct.expectedRevenueChange! * 0.11) / 1000) * 1000);
    expect(oct.evidence).toContain(`9월 쿠폰 사용 ${Math.round(used).toLocaleString('ko-KR')}건`);
  });

  it('근거 자료가 없는 포장 계획은 예산·예상 효과를 비워 둔다', () => {
    const t = d.solutions.find((s) => s.templateId === 'takeout-pickup')!;
    expect([t.budget, t.expectedRevenueChange, t.expectedCostChange]).toEqual([null, null, null]);
  });
});
