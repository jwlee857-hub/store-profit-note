// 3차 개선 1단계: 숫자가 틀리게 나오던 오류. 격리된 샘플 데이터만 사용한다(localStorage 사용 안 함).
// 샘플은 2026-11-15(일)까지 생성 → 마지막 매출 입력일 2026-11-14(토), 오늘 2026-11-17(화) 상황을 재현한다.
import { describe, expect, it } from 'vitest';
import { allocatePeriodCost, basisText, computeComparison, computeSummary, getMetric, profitForDisplay, unrecordedDays } from './calc';
import { diagnose, diagnoseSummaries, quantityPriceText, topIssues, type QuantityPriceRow } from './diagnosis';
import { josa } from './format';
import { presetRanges, referenceDate } from './periods';
import { generateSample } from './sample';
import type { AppData, SalesEntry } from './types';

const TODAY = '2026-11-17';
const sample = () => generateSample('2026-11-15');

/** from 날짜의 기록을 to 날짜로 복사 (새 날짜 입력 재현) */
function copyDay(d: AppData, from: string, to: string, filter: (e: SalesEntry) => boolean = () => true, patch: (e: SalesEntry) => SalesEntry = (e) => e) {
  const add = d.sales.filter((e) => e.date === from && filter(e)).map((e, i) => patch({ ...structuredClone(e), id: `t_${to}_${i}`, date: to }));
  d.sales.push(...add);
}

function homeView(d: AppData, kind: 'week' | 'month' | 'recent28') {
  const r = presetRanges(kind, TODAY, referenceDate(d));
  const { s, p } = computeComparison(d, r.cur, r.prev);
  const dx = diagnoseSummaries(d, p, s, { channel: 'all', target: { key: 'operatingProfit', channel: 'all' }, targetValue: null });
  return { r, s, p, dx, issues: topIssues(dx, 3) };
}

describe('1-1 이번 달·이번 주는 마지막 매출 입력일까지', () => {
  it('샘플: 이번 달 11.01~11.14, 비교 10.01~10.14', () => {
    const { r, s, p } = homeView(sample(), 'month');
    expect(r.cur).toEqual({ start: '2026-11-01', end: '2026-11-14' });
    expect(r.prev).toEqual({ start: '2026-10-01', end: '2026-10-14' });
    expect(r.label).toContain('11.01 ~ 11.14');
    // 같은 날짜 수끼리 비교하므로 월세·인건비가 한쪽에만 더 들어가지 않는다 (예전: 매출 −16%, 영업이익 76만 원)
    expect(s.businessDays).toBe(p.businessDays);
    expect(profitForDisplay(s.operatingProfit).amount!).toBeGreaterThan(2_000_000);
  });
  it('이번 주도 같은 규칙: 마지막 입력일이 이번 주 안이면 그날까지', () => {
    const r = presetRanges('week', '2026-11-19', '2026-11-17');
    expect(r.cur).toEqual({ start: '2026-11-16', end: '2026-11-17' });
    expect(r.prev).toEqual({ start: '2026-11-09', end: '2026-11-10' });
  });
  it('마지막 입력일이 오늘보다 늦으면 오늘까지', () => {
    expect(presetRanges('month', '2026-11-10', '2026-11-20').cur.end).toBe('2026-11-10');
  });
});

describe('1-2 선택 항목(홀 방문 고객 수) 하루 누락이 기간 전체를 지우지 않는다', () => {
  it('손님 수가 입력된 날만으로 계산하고 "N일 중 M일 기준"을 붙인다', () => {
    const d = sample();
    copyDay(d, '2026-11-09', '2026-11-16');
    copyDay(d, '2026-11-10', '2026-11-17', () => true, (e) => (e.channel === 'hall' ? { ...e, visitors: null } : e));
    const { s, dx, issues } = homeView(d, 'recent28');
    const v = getMetric(s, { key: 'visitors', channel: 'hall' });
    expect(v.value).toBeGreaterThan(0);
    expect(v.basis).toEqual({ used: 22, total: 23, unit: '일' });
    expect(s.channels.hall.avgTicket.value).toBeGreaterThan(0);
    expect(s.channels.hall.avgTicket.basis?.used).toBe(22);
    // 문제 순위도 같은 값으로: 모든 날에 입력했을 때와 같은 순서이고, 홀 방문 고객 수 감소에 기준 표시가 붙는다
    const full = sample();
    copyDay(full, '2026-11-09', '2026-11-16');
    copyDay(full, '2026-11-10', '2026-11-17');
    expect(issues.map((f) => f.id)).toEqual(homeView(full, 'recent28').issues.map((f) => f.id));
    expect(issues.find((f) => f.id === 'hall-visitors-down')!.fact).toContain('23일 중 22일 입력 기준');
    expect(dx.quantityPrice.find((q) => q.channel === 'hall')!.decomposition.ok).toBe(true);
  });
  it('손님 수가 빠진 날이 있어도 감소율이 부풀지 않는다 (같은 날을 입력했을 때와 같음)', () => {
    const withV = sample();
    copyDay(withV, '2026-11-09', '2026-11-16');
    copyDay(withV, '2026-11-10', '2026-11-17');
    const noV = sample();
    copyDay(noV, '2026-11-09', '2026-11-16');
    copyDay(noV, '2026-11-10', '2026-11-17', () => true, (e) => (e.channel === 'hall' ? { ...e, visitors: null } : e));
    const a = homeView(withV, 'recent28').issues.find((f) => f.id === 'hall-visitors-down')!;
    const b = homeView(noV, 'recent28').issues.find((f) => f.id === 'hall-visitors-down')!;
    expect(Math.abs(b.impact! - a.impact!) / Math.abs(a.impact!)).toBeLessThan(0.05);
  });
  it('모든 날에 입력돼 있으면 결과가 예전과 같다 (기준 표시 없음)', () => {
    const { s, issues } = homeView(sample(), 'recent28');
    expect(getMetric(s, { key: 'visitors', channel: 'hall' }).basis).toBeUndefined();
    // 영업이익 기준 순위: 배달 1건당 남는 금액 감소(−319만) > 홀 방문 고객 수 감소(−214만)
    expect(issues.map((f) => f.id).slice(0, 2)).toEqual(['delivery-unit-profit-down', 'hall-visitors-down']);
    expect(Math.round(issues[1].impact!)).toBe(-2_137_648);
  });
  it('할인·환불 상세가 없는 기록이 있으면 확인된 할인 합계만 보여주고, 할인 비율 변화는 판정하지 않는다', () => {
    const d = sample();
    const e = d.sales.find((x) => x.date === '2026-11-13' && x.channel === 'delivery')!;
    Object.assign(e, { amountMode: 'net', netInput: 500_000, storeDiscount: null, refund: null, gross: null });
    const { dx } = homeView(d, 'recent28');
    expect(dx.findings.find((x) => x.id === 'delivery-discount-up')).toBeUndefined();
    expect(dx.caveats.join(' ')).toContain('할인 비율 변화는 판정하지 않습니다');
    const disc = getMetric(dx.cur, { key: 'storeDiscount', channel: 'delivery' });
    expect(disc).toMatchObject({ value: null, salesGap: true, note: '확인된 할인 합계' });
    expect(basisText(disc.basis)).toMatch(/^매출 기록 \d+건 중 \d+건 확인$/);
  });
});

describe('1-3 입력을 건너뛴 영업일은 0원으로 계산하지 않는다', () => {
  const skipped = () => {
    const d = sample();
    copyDay(d, '2026-11-10', '2026-11-17'); // 11.16(월)은 비움
    return d;
  };
  it('미입력 영업일 = 매출 기록도 매출 없음 확인도 없는 영업일', () => {
    const d = skipped();
    expect(unrecordedDays(d, { start: '2026-11-14', end: '2026-11-17' })).toEqual(['2026-11-16']);
    d.salesChecks.push({ date: '2026-11-16', channel: 'hall', routeId: 'route_hall', status: 'noSales', checkedAt: '2026-11-16T12:00:00.000Z' });
    expect(unrecordedDays(d, { start: '2026-11-14', end: '2026-11-17' })).toEqual([]);
  });
  it('5차 수정: 빼지 않고 부분 합계로 둔다 — 영업일 수·기간 비용은 그대로, 비교 기간 합계는 바뀌지 않고, 증감 판정은 보류', () => {
    const d = skipped();
    const { r, s, p, dx } = homeView(d, 'recent28');
    expect(r.cur).toEqual({ start: '2026-10-21', end: '2026-11-17' });
    expect(s.unrecordedDays).toEqual(['2026-11-16']);
    expect(s.businessDays).toBe(23);
    // 비교 기간은 따로 집계 (분석 기간의 빈 날 때문에 바뀌지 않음)
    expect(p.totalSales).toEqual(computeSummary(d, r.prev).totalSales);
    // 월세는 28일 전체
    const rent = d.periodCosts.filter((x) => x.category === 'rent');
    expect(s.commonByCategory.rent.actual).toBeCloseTo(rent.reduce((a, x) => a + allocatePeriodCost(x, r.cur), 0));
    // 0원으로 보지 않고 부분 합계: 매출 감소·월세 증가를 판정하지 않는다
    expect(s.totalSales).toMatchObject({ value: null, salesGap: true });
    expect(dx.totalDelta).toBeNull();
    expect(dx.findings.some((f) => f.id === 'common-rent' || f.id.endsWith('-orders-down') || f.id === 'hall-visitors-down')).toBe(false);
  });
  it('일별 추이에는 미입력 표시가 남는다', () => {
    const { s } = homeView(skipped(), 'recent28');
    expect(s.daily.find((x) => x.date === '2026-11-16')!.unrecorded).toBe(true);
    expect(s.daily.find((x) => x.date === '2026-11-17')!.unrecorded).toBe(false);
  });
  it('첫 기록 이전 날짜(가게 사용 전)는 미입력이 아니고 기간 계산에서 뺀다', () => {
    const d = sample();
    d.sales = d.sales.filter((e) => e.date >= '2026-11-10');
    const s = computeSummary(d, { start: '2026-11-01', end: '2026-11-14' });
    // 기록 있는 영업일 11.10~11.14(5일)만. 그 전 9일(정기 휴무 포함)은 가게 사용 전 → 월세도 5일치
    expect(s.businessDays).toBe(5);
    expect(s.unrecordedDays).toEqual([]);
    expect(s.totalSales.salesGap).toBeUndefined();
    expect(s.commonByCategory.rent.actual).toBeCloseTo((2_500_000 * 5) / 30);
  });
});

describe('1-4 금액이 그대로인 고정비는 증가 문제로 잡지 않는다', () => {
  it('11.16을 비운 상태에서도 월세 증가가 문제·가설에 없다. 비용 표에는 "월 금액 그대로"', () => {
    const d = sample();
    copyDay(d, '2026-11-10', '2026-11-17');
    const r = presetRanges('recent28', TODAY, referenceDate(d));
    // 짝 맞추기 없이 비교해도(직접 선택 등) 월세 증가로 나오지 않아야 한다
    const s = computeSummary(d, r.cur);
    const p = computeSummary(d, r.prev);
    const dx = diagnoseSummaries(d, p, s, { channel: 'all', target: { key: 'operatingProfit', channel: 'all' }, targetValue: null });
    expect(dx.findings.some((f) => f.id === 'common-rent')).toBe(false);
    expect(dx.costChanges.find((c) => c.scope === 'common' && c.category === 'rent')!.assessment).toBe('fixedSame');
  });
  it('월 금액이 바뀐 항목(인건비 980만 → 1,020만 원)은 그대로 판단한다', () => {
    const { dx } = homeView(sample(), 'recent28');
    expect(dx.costChanges.find((c) => c.scope === 'common' && c.category === 'labor')!.assessment).not.toBe('fixedSame');
    expect(dx.findings.some((f) => f.id === 'common-labor')).toBe(true);
  });
});

describe('1-5 홈과 문제 진단의 기간·영업이익이 같다', () => {
  it.each(['2026-11-15', '2026-11-16', '2026-11-14'])('샘플(%s까지 생성)의 문제 기간 = 홈 최근 4주', (end) => {
    const d = generateSample(end);
    const home = homeView(d, 'recent28');
    const prob = d.problems[0];
    expect(prob.analysis).toEqual(home.r.cur);
    expect(prob.compare).toEqual(home.r.prev);
    const dx = diagnose(d, prob);
    expect(profitForDisplay(dx.cur.operatingProfit).amount).toBe(profitForDisplay(home.s.operatingProfit).amount);
  });
  it('샘플: 10.18~11.14, 영업이익 3,677,486원', () => {
    const d = sample();
    expect(d.problems[0].analysis).toEqual({ start: '2026-10-18', end: '2026-11-14' });
    expect(Math.round(profitForDisplay(diagnose(d, d.problems[0]).cur.operatingProfit).amount!)).toBe(3_677_486);
  });
});

describe('1-6 진단 ② 문장의 조사', () => {
  it('평균 주문금액이 / 객단가가 / 주문 수가 / 손님 수가', () => {
    expect(josa('평균 주문금액', '이/가')).toBe('평균 주문금액이');
    const row = (channel: 'hall' | 'delivery'): QuantityPriceRow => ({
      channel,
      quantityLabel: '',
      priceLabel: '',
      prevQ: 1,
      curQ: 1,
      prevP: { value: 1 },
      curP: { value: 1 },
      decomposition: { ok: true, volumeEffect: 120_000, priceEffect: -50_000, delta: 70_000 },
      basisNote: null,
    });
    expect(quantityPriceText(row('delivery'))).toBe('배달: 주문 수가 늘어 +12만 원, 평균 주문금액이 줄어 −5만 원 → 매출 +70,000원');
    expect(quantityPriceText(row('hall'))).toContain('손님 수가 늘어');
    expect(quantityPriceText(row('hall'))).toContain('객단가가 줄어');
  });
});
