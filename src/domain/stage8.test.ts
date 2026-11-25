// 내장 샘플: 2026년 8~11월 배달앱 A 쿠폰 이야기. 원천 기록 집계로 이야기가 성립하는지 확인한다(화면 숫자 하드코딩 없음).
import { describe, expect, it } from 'vitest';
import { comparableValue, computeComparison, computeSummary, getMetric, netSales, type PeriodSummary } from './calc';
import { diagnose, homeHeadline, perBusinessDay } from './diagnosis';
import { presetRanges, referenceDate } from './periods';
import { newSalesEntry } from './factory';
import { resultLabel } from './labels';
import { scopeToRoute, withChannelFrom } from './review';
import { STORY, STORY_TODAY, storySample } from './sample';
import type { AppData, DateRange, MetricRef } from './types';

/** 성과 화면과 같은 집계: 배달은 계획의 대상 배달앱만, 가게 전체 합계는 그대로 */
const scoped = (d: AppData, r: DateRange, routeId = 'route_app_a') => withChannelFrom(computeSummary(d, r), computeSummary(scopeToRoute(d, 'delivery', routeId), r), 'delivery');
const v = (s: PeriodSummary, ref: MetricRef) => comparableValue(getMetric(s, ref));
const A = {
  orders: { key: 'orders', channel: 'delivery' },
  discount: { key: 'storeDiscount', channel: 'delivery' },
  perOrder: { key: 'directProfitPerOrder', channel: 'delivery' },
  total: { key: 'directProfit', channel: 'delivery' },
} as const satisfies Record<string, MetricRef>;
const OP: MetricRef = { key: 'operatingProfit', channel: 'all' };

describe('샘플 날짜와 쿠폰 일정 (2026년 달력 고정)', () => {
  const d = storySample();
  it('8월 1일부터 11월 22일까지 영업일에만 기록, 기준일 11월 23일 이후는 미입력', () => {
    const dates = d.sales.map((e) => e.date).sort();
    expect(dates[0]).toBe('2026-08-01');
    expect(dates[dates.length - 1]).toBe('2026-11-21'); // 11월 22일은 일요일(정기 휴무)
    expect(d.sampleToday).toBe(STORY_TODAY);
    expect(d.sales.some((e) => e.date >= STORY_TODAY)).toBe(false);
  });
  it('배달앱 A 쿠폰 액면가: 8월 1,000 · 9월 3,000 · 10월 2,000 · 11월 2,500원 — 가게 부담 할인 총액은 쿠폰을 쓴 주문만큼', () => {
    for (const [m, coupon] of [['2026-08', 1000], ['2026-09', 3000], ['2026-10', 2000], ['2026-11', 2500]] as const) {
      const list = d.sales.filter((e) => e.routeId === 'route_app_a' && e.channel === 'delivery' && e.date.startsWith(m));
      expect(list.every((e) => e.storeDiscount! % coupon === 0 && e.storeDiscount! / coupon <= e.orders!)).toBe(true);
      expect(list.some((e) => e.storeDiscount! < e.orders! * coupon)).toBe(true); // 모든 주문이 쿠폰을 쓰지는 않음
    }
  });
  it('9·10월은 정산 완료: 성과 검증에 필요한 기록이 빠지지 않고, 순매출에서 할인을 다시 빼지 않는다', () => {
    for (const r of [STORY.sep, STORY.oct]) {
      const s = computeSummary(d, r);
      expect(s.status.missing).toEqual([]);
      expect(s.status.estimatedAmount).toBe(0);
      expect(s.unrecordedDays).toEqual([]);
      const list = d.sales.filter((e) => e.date >= r.start && e.date <= r.end);
      expect(s.totalSales.value).toBe(list.reduce((t, e) => t + e.gross! - e.storeDiscount! - e.refund!, 0));
      expect(list.every((e) => netSales(e) === e.gross! - e.storeDiscount! - e.refund!)).toBe(true);
    }
  });
  it('같은 이름의 계획을 중복으로 만들지 않는다: 9월에 제안한 계획이 10월에 실행을 마친 그 계획', () => {
    const names = d.solutions.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    const oct = d.solutions.find((s) => s.name === '배달 할인 효율 검토')!;
    expect(oct.problemId).toBe(d.problems[0].id);
    expect([oct.status, oct.start, oct.end, oct.createdAt.slice(0, 7)]).toEqual(['done', '2026-10-01', '2026-10-31', '2026-09']);
    expect(oct.coupon).toEqual({ routeId: 'route_app_a', previousAmount: 3000, amount: 2000, minOrder: 15000, usedCount: null });
    expect(resultLabel(oct)).toBe('10월 실행 결과 보기');
  });
});

describe('① 문제 진단은 8월 대 9월, 성과 확인은 9월 대 10월', () => {
  const d = storySample();
  it('문제 진단: 9월 분석 · 8월 비교, 배달 한 건당 남는 돈 감소와 할인 비율 상승을 찾는다', () => {
    const p = d.problems[0];
    expect([p.analysis, p.compare]).toEqual([STORY.sep, STORY.aug]);
    const dx = diagnose(d, p);
    expect(dx.cur.range).toEqual(STORY.sep);
    expect(dx.prev.range).toEqual(STORY.aug);
    const ids = dx.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['delivery-unit-profit-down', 'delivery-discount-up', 'delivery-orders-up']));
  });
  it('성과 확인: 실행 전 9월 1일~30일, 실행 후 10월 1일~31일로 저장 (8월 31일·11월이 섞이지 않음)', () => {
    const oct = d.solutions.find((s) => s.name === '배달 할인 효율 검토')!;
    expect(oct.review.before).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(oct.review.after).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect([computeSummary(d, STORY.sep).businessDays, computeSummary(d, STORY.oct).businessDays]).toEqual([25, 27]); // 9월: 일요일 4일 + 추석 휴무
  });
});

describe('② 10월 결과: 앱 A 건당 증가 / 앱 A 배달 총액 감소 / 가게 전체 영업이익 증가', () => {
  const d = storySample();
  const sep = scoped(d, STORY.sep);
  const oct = scoped(d, STORY.oct);
  it('쿠폰을 줄이자 앱 A 가게 부담 할인 총액과 완료 주문 수가 줄었다', () => {
    expect(v(oct, A.discount)!).toBeLessThan(v(sep, A.discount)!);
    expect(v(oct, A.orders)!).toBeLessThan(v(sep, A.orders)!);
  });
  it('앱 A 한 건당 남는 돈은 늘었지만 앱 A 배달 전체에서 남긴 돈은 소폭 줄었다', () => {
    expect(v(oct, A.perOrder)!).toBeGreaterThan(v(sep, A.perOrder)!);
    const t0 = v(sep, A.total)!;
    const t1 = v(oct, A.total)!;
    expect(t1).toBeLessThan(t0);
    expect((t0 - t1) / t0).toBeLessThan(0.05); // 소폭
  });
  it('가게 전체 영업이익(모든 판매 방식 + 공통비)은 늘었고, 근처 행사 날짜의 홀 기록·외부 요인 메모가 일치한다', () => {
    expect(v(oct, OP)!).toBeGreaterThan(v(sep, OP)!);
    expect(oct.operatingProfit).toEqual(computeSummary(d, STORY.oct).operatingProfit); // 대상 앱 집계와 무관하게 가게 전체
    const hall = d.sales.filter((e) => e.channel === 'hall' && e.date.startsWith('2026-10'));
    const event = hall.filter((e) => e.date >= STORY.event.start && e.date <= STORY.event.end);
    const avg = (l: typeof hall) => l.reduce((t, e) => t + e.visitors!, 0) / l.length;
    expect(event.every((e) => e.memo.includes('근처 가을 축제'))).toBe(true);
    expect(avg(event)).toBeGreaterThan(avg(hall.filter((e) => !event.includes(e))) * 1.4);
    expect(d.solutions[0].review.externalFactors).toContain('10월 15~17일');
  });
  it('배달앱 A의 배달과 포장은 구분해 집계한다', () => {
    const takeoutA = d.sales.filter((e) => e.routeId === 'route_app_a' && e.channel === 'takeout' && e.date.startsWith('2026-10'));
    expect(takeoutA.length).toBeGreaterThan(0);
    expect(v(oct, A.orders)).toBe(d.sales.filter((e) => e.routeId === 'route_app_a' && e.channel === 'delivery' && e.date.startsWith('2026-10')).reduce((t, e) => t + e.orders!, 0));
  });
});

describe('③ 10월 판단은 11월 재시험으로 이어지고, 11월 기록이 늘어도 10월 성과는 그대로', () => {
  it('10월: 수정 후 재시험 · 다음 쿠폰 2,500원 / 11월: 별도 재시험 계획, 실행 중', () => {
    const d = storySample();
    const [oct, nov] = d.solutions;
    expect(oct.review).toMatchObject({ decision: 'revise', nextCouponAmount: 2500 });
    expect(oct.review.judgment).toBe('쿠폰을 줄이니 한 건에서는 더 남았지만, 주문이 줄어서 배달앱 A에서 한 달 동안 남긴 돈은 오히려 줄었다. 다음 달에는 2,500원으로 시험해 보자.');
    expect(nov).toMatchObject({ name: '배달앱 A 쿠폰 2,500원 재시험', status: 'running', start: '2026-11-01', end: '2026-11-30' });
    expect(nov.coupon).toEqual({ routeId: 'route_app_a', previousAmount: 2000, amount: 2500, minOrder: 15000, usedCount: null });
    expect(nov.review.reviewedAt).toBeNull();
  });
  it('11월 매출을 추가해도 10월 성과표와 저장된 판단은 바뀌지 않는다', () => {
    const d = storySample();
    const oct = d.solutions[0];
    const table = () => {
      const b = scoped(d, oct.review.before!);
      const a = scoped(d, oct.review.after!);
      return [A.orders, A.discount, A.perOrder, A.total, OP].map((r) => [v(b, r), v(a, r)]).concat([[b.businessDays, a.businessDays]]);
    };
    const before = JSON.stringify(table());
    const review = JSON.stringify(oct.review);
    d.sales.push(newSalesEntry({ date: '2026-11-23', channel: 'delivery', routeId: 'route_app_a', amountMode: 'net', netInput: 300_000, orders: 14, storeDiscount: 25_000, refund: 0 }));
    expect(JSON.stringify(table())).toBe(before);
    expect(JSON.stringify(d.solutions[0].review)).toBe(review);
  });
  it('같은 시드로 다시 만들면 같은 샘플 (여러 번 열어도 숫자가 같다)', () => {
    const strip = (x: AppData) => JSON.stringify({ ...x, updatedAt: '' });
    expect(strip(storySample())).toBe(strip(storySample()));
  });
});

describe('홈: 길이가 다른 기간은 총액 대신 영업일당으로 비교', () => {
  const d = storySample();
  it('직접 선택 10월 1일~11월 30일(61일)은 11월 23일 이후가 마감 전이라 부분 합계로 비교 보류', () => {
    const { s, p } = computeComparison(d, { start: '2026-10-01', end: '2026-11-30' }, STORY.sep);
    expect(s.totalSales).toMatchObject({ value: null, provisional: 46_123_000 + 30_780_900, salesGap: true });
    expect(homeHeadline(p, s)).toContain('아직 기록하지 않은');
  });
  it('직접 선택 10월 1일~11월 21일(52일) 대 9월(30일): 총액 증감률을 말하지 않고 영업일당으로 비교한다', () => {
    const { s, p } = computeComparison(d, { start: '2026-10-01', end: '2026-11-21' }, STORY.sep);
    expect([s.calendarDays, p.calendarDays]).toEqual([52, 30]);
    const text = homeHeadline(p, s);
    expect(text).toMatch(/^조회 기간\(52일\)과 비교 기간\(30일\)의 길이가 달라 영업일당으로 비교했어요: 영업일당 매출 [+−][\d.]+%, 영업일당 (예상 )?영업이익(\(미확정\))? [+−±][\d,]+원\.$/);
    expect(text).not.toMatch(/매출은 \d+% (늘었|줄었)/);
    const per = (x: PeriodSummary) => perBusinessDay(x.totalSales, x)!;
    expect(text).toContain(`${(((per(s) - per(p)) / per(p)) * 100).toFixed(1)}%`);
  });
  it("'이번 달'은 11월 1~21일 대 10월 1~21일: 홈 매출이 매출 기록의 11월 합계와 같고 총액으로 비교한다", () => {
    const r = presetRanges('month', STORY_TODAY, referenceDate(d));
    expect([r.cur, r.prev]).toEqual([{ start: '2026-11-01', end: '2026-11-21' }, { start: '2026-10-01', end: '2026-10-21' }]);
    const { s, p } = computeComparison(d, r.cur, r.prev);
    const nov = d.sales.filter((e) => e.date.startsWith('2026-11')).reduce((t, e) => t + netSales(e)!, 0);
    expect(s.totalSales.value).toBe(nov);
    expect(homeHeadline(p, s)).not.toContain('길이가 달라');
  });
});
