import { describe, expect, it } from 'vitest';
import {
  allocatePeriodCost,
  compareCalc,
  compareValues,
  computeSummary,
  decompose,
  effectiveCost,
  expectedProfitChange,
  netSales,
} from './calc';
import { repurchaseRate } from './customers';
import { diagnose } from './diagnosis';
import { estimateFees, feeRuleFor, pickEffective } from './estimate';
import { emptyCosts, emptyData, newSalesEntry } from './factory';
import { generateSample, samplePeriods } from './sample';
import type { AppData, FeeRule, PeriodCost, SalesEntry } from './types';
import { validateSalesEntry } from './validation';
import { parseBackup, serialize } from '../storage/storage';

function baseData(): AppData {
  const d = emptyData();
  d.store = {
    name: '테스트',
    channels: ['hall', 'delivery', 'takeout'],
    regularOpenDays: [0, 1, 2, 3, 4, 5, 6],
    openTime: '11:00',
    closeTime: '21:00',
    seats: 10,
    commonCostChecklist: [],
    vatBasis: 'included',
  };
  d.routes = [
    { id: 'r_hall', name: '매장', channels: ['hall'], platformId: null },
    { id: 'r_app', name: '앱', channels: ['delivery'], platformId: 'p1' },
    { id: 'r_tk', name: '포장', channels: ['takeout'], platformId: null },
  ];
  d.platforms = [{ id: 'p1', name: '앱', note: '' }];
  return d;
}

function hallEntry(date: string, p: Partial<SalesEntry> = {}): SalesEntry {
  const e = newSalesEntry({ date, channel: 'hall', routeId: 'r_hall', orders: 10, visitors: 20, gross: 200_000, storeDiscount: 0, refund: 0, ...p });
  e.costs = emptyCosts();
  e.costs.food.actual = 60_000;
  e.costs.payment.actual = 3_000;
  e.costs.hallSupplies.actual = 2_000;
  return e;
}

const pc = (p: Partial<PeriodCost>): PeriodCost => ({
  id: Math.random().toString(),
  category: 'rent',
  attribution: 'common',
  nature: 'fixed',
  start: '2026-01-01',
  end: '2026-01-31',
  amount: 3_100_000,
  source: 'actual',
  memo: '',
  ...p,
});

describe('순매출: 할인·환불 반영', () => {
  it('상품 판매액에서 가게 부담 할인액과 환불액을 한 번씩 차감한다', () => {
    expect(netSales({ gross: 100_000, storeDiscount: 5_000, refund: 3_000 })).toBe(92_000);
  });
  it('판매액 미입력은 0이 아니라 null', () => {
    expect(netSales({ gross: null, storeDiscount: 0, refund: 0 })).toBeNull();
    expect(netSales({ gross: 0, storeDiscount: 0, refund: 0 })).toBe(0);
  });
  it('요약의 총매출에도 동일하게 반영된다', () => {
    const d = baseData();
    d.sales = [hallEntry('2026-01-05', { gross: 100_000, storeDiscount: 5_000, refund: 3_000 })];
    const s = computeSummary(d, { start: '2026-01-05', end: '2026-01-05' });
    expect(s.totalSales.value).toBe(92_000);
  });
  it('할인+환불이 판매액보다 크면 검증 오류', () => {
    const d = baseData();
    const e = hallEntry('2026-01-05', { gross: 10_000, storeDiscount: 6_000, refund: 5_000 });
    expect(validateSalesEntry(e, d).errors.refund).toBeTruthy();
  });
  it('주문 0건에 판매액이 있으면 모순 오류', () => {
    const d = baseData();
    const e = hallEntry('2026-01-05', { orders: 0, gross: 10_000 });
    expect(validateSalesEntry(e, d).errors.orders).toBeTruthy();
  });
});

describe('실제 비용과 추정 비용의 중복 방지', () => {
  it('실제값이 있으면 추정값을 더하지 않는다', () => {
    expect(effectiveCost({ actual: 1000, estimated: 900, estimateBasis: '' })).toEqual({ amount: 1000, status: 'actual' });
  });
  it('실제값이 없으면 추정값을 사용하고 추정 표시', () => {
    expect(effectiveCost({ actual: null, estimated: 900, estimateBasis: '' })).toEqual({ amount: 900, status: 'estimated' });
  });
  it('요약에서 실제·추정이 둘 다 있으면 실제만 합산', () => {
    const d = baseData();
    const e = hallEntry('2026-01-05');
    e.costs.food = { actual: 60_000, estimated: 55_000, estimateBasis: '' };
    d.sales = [e];
    const s = computeSummary(d, { start: '2026-01-05', end: '2026-01-05' });
    expect(s.channels.hall.directCost.actual).toBe(65_000);
    expect(s.channels.hall.directCost.estimated).toBe(0);
  });
  it('묶음 수수료면 결제 수수료를 따로 부과하지 않는다', () => {
    const rule: FeeRule = {
      id: 'f',
      routeId: 'r_app',
      effectiveFrom: '2026-01-01',
      mode: 'bundled',
      brokerageRate: 10,
      brokerageBase: 'gross',
      paymentRate: 3,
      paymentBase: 'gross',
      bundledRate: 12,
      bundledBase: 'gross',
      perOrderFee: 100,
      vatExclusive: false,
      note: '',
    };
    const est = estimateFees({ gross: 100_000, storeDiscount: 0, refund: 0, orders: 5 }, rule);
    expect(est.brokerage).toBe(12_500);
    expect(est.payment).toBeNull();
  });
  it('수수료 기준액은 규칙에 따라 다르게 적용된다', () => {
    const base: FeeRule = {
      id: 'f',
      routeId: 'r_app',
      effectiveFrom: '2026-01-01',
      mode: 'separate',
      brokerageRate: 10,
      brokerageBase: 'gross',
      paymentRate: 3,
      paymentBase: 'net',
      bundledRate: null,
      bundledBase: 'gross',
      perOrderFee: null,
      vatExclusive: true,
      note: '',
    };
    const est = estimateFees({ gross: 100_000, storeDiscount: 10_000, refund: 0, orders: 5 }, base);
    expect(est.brokerage).toBe(11_000); // 100,000 × 10% × 1.1
    expect(est.payment).toBe(2_970); // 90,000 × 3% × 1.1
  });
});

describe('채널 비용과 공통 비용의 중복 방지', () => {
  it('채널 귀속 기간 비용은 직접 비용에만, 공통 귀속은 공통비에만 들어간다', () => {
    const d = baseData();
    d.sales = [hallEntry('2026-01-10')];
    d.periodCosts = [
      pc({ category: 'channelAd', attribution: 'delivery', amount: 310_000 }),
      pc({ category: 'rent', attribution: 'common', amount: 3_100_000 }),
    ];
    const s = computeSummary(d, { start: '2026-01-10', end: '2026-01-10' });
    expect(s.channels.delivery.directCost.actual).toBeCloseTo(10_000);
    expect(s.commonCost.actual).toBeCloseTo(100_000);
    const hallDirect = 65_000;
    // 영업이익 = (홀 200,000 − 65,000) + (배달 0 − 10,000) − 100,000
    expect(s.operatingProfit.value).toBeCloseTo(200_000 - hallDirect - 10_000 - 100_000);
  });
  it('대출 상환 같은 항목은 비용 범주에 없다', () => {
    const d = baseData();
    expect(Object.keys(computeSummary(d, { start: '2026-01-01', end: '2026-01-01' }).commonByCategory)).not.toContain('loan');
  });
});

describe('기간 비용 안분', () => {
  it('달력 일수 비율로 안분한다', () => {
    const cost = { start: '2026-01-01', end: '2026-01-31', amount: 3_100_000 };
    expect(allocatePeriodCost(cost, { start: '2026-01-01', end: '2026-01-10' })).toBeCloseTo(1_000_000);
    expect(allocatePeriodCost(cost, { start: '2026-01-25', end: '2026-02-10' })).toBeCloseTo(700_000);
    expect(allocatePeriodCost(cost, { start: '2026-02-01', end: '2026-02-10' })).toBe(0);
  });
  it('연속된 기간에 나눈 안분액의 합은 원금액과 같다', () => {
    const cost = { start: '2026-01-01', end: '2026-03-31', amount: 900_000 };
    const a = allocatePeriodCost(cost, { start: '2025-12-01', end: '2026-02-14' });
    const b = allocatePeriodCost(cost, { start: '2026-02-15', end: '2026-04-30' });
    expect(a + b).toBeCloseTo(900_000);
  });
});

describe('0과 미입력 처리', () => {
  it('필수 비용 미입력이면 영업이익을 확정하지 않는다', () => {
    const d = baseData();
    const e = hallEntry('2026-01-05');
    e.costs.food = { actual: null, estimated: null, estimateBasis: '' };
    d.sales = [e];
    const s = computeSummary(d, { start: '2026-01-05', end: '2026-01-05' });
    expect(s.operatingProfit.value).toBeNull();
    expect(s.operatingProfit.reason).toBe('incomplete');
    expect(s.operatingProfit.provisional).toBe(200_000 - 5_000);
  });
  it('0원 입력은 입력으로 인정되어 영업이익이 확정된다', () => {
    const d = baseData();
    const e = hallEntry('2026-01-05');
    e.costs.hallSupplies.actual = 0;
    d.sales = [e];
    const s = computeSummary(d, { start: '2026-01-05', end: '2026-01-05' });
    expect(s.operatingProfit.value).toBe(200_000 - 63_000);
  });
  it('방문 고객 수 미입력이면 객단가는 데이터 필요, 0이면 계산 불가', () => {
    const d = baseData();
    d.sales = [hallEntry('2026-01-05', { visitors: null })];
    expect(computeSummary(d, { start: '2026-01-05', end: '2026-01-05' }).channels.hall.avgTicket).toEqual({ value: null, reason: 'noData' });
    d.sales = [hallEntry('2026-01-05', { visitors: 0, orders: 0, gross: 0 })];
    expect(computeSummary(d, { start: '2026-01-05', end: '2026-01-05' }).channels.hall.avgTicket.reason).toBe('divZero');
  });
  it('매출이 없으면 영업이익률은 NaN이 아니라 데이터 필요', () => {
    const d = baseData();
    const s = computeSummary(d, { start: '2026-01-05', end: '2026-01-05' });
    expect(s.operatingMargin.value).toBeNull();
    expect(s.operatingMargin.reason).toBe('noData');
  });
  it('공통비 체크리스트 항목이 기간을 덮지 않으면 미확정', () => {
    const d = baseData();
    d.store!.commonCostChecklist = ['labor'];
    d.sales = [hallEntry('2026-01-05')];
    const s = computeSummary(d, { start: '2026-01-05', end: '2026-01-05' });
    expect(s.operatingProfit.reason).toBe('incomplete');
    d.periodCosts = [pc({ category: 'labor', amount: 3_100_000 })];
    expect(computeSummary(d, { start: '2026-01-05', end: '2026-01-05' }).operatingProfit.value).toBeCloseTo(200_000 - 65_000 - 100_000);
  });
});

describe('비교 증감액 계산', () => {
  it('일반 증감액과 증감률', () => {
    expect(compareValues(100, 120)).toEqual({ abs: 20, pct: 20, note: null });
  });
  it('이전 값이 0이면 증감률 생략', () => {
    const c = compareValues(0, 50);
    expect(c.abs).toBe(50);
    expect(c.pct).toBeNull();
  });
  it('이전 영업이익이 음수면 증감률 대신 전환 표시', () => {
    expect(compareValues(-100, 50, 'profit')).toMatchObject({ abs: 150, pct: null, note: '흑자 전환' });
    expect(compareValues(100, -50, 'profit')).toMatchObject({ abs: -150, pct: null, note: '적자 전환' });
    expect(compareValues(-100, -50, 'profit')).toMatchObject({ pct: null, note: '적자 축소' });
  });
  it('한쪽 값이 없으면 비교하지 않는다', () => {
    expect(compareCalc({ value: null, reason: 'noData' }, { value: 10 }).abs).toBeNull();
  });
});

describe('수량 효과와 평균 금액 효과', () => {
  it('두 효과의 합이 실제 매출 차이와 일치한다', () => {
    const r = decompose(1_000_000, 100, 1_150_000, 90);
    expect(r.ok).toBe(true);
    expect(r.volumeEffect! + r.priceEffect!).toBeCloseTo(150_000, 6);
    expect(r.volumeEffect).toBeCloseTo(-100_000);
  });
  it('수량이 0이면 분해하지 않는다', () => {
    expect(decompose(0, 0, 100, 10).ok).toBe(false);
    expect(decompose(100, 10, 0, 0).ok).toBe(false);
    expect(decompose(100, null, 100, 10).ok).toBe(false);
  });
  it('샘플 데이터의 모든 채널 분해 합이 실제 차이와 일치한다', () => {
    const end = '2026-11-15';
    const data = generateSample(end);
    const { prev, cur } = samplePeriods(end);
    const dx = diagnose(data, { analysis: cur, compare: prev, channel: 'all', target: { key: 'totalSales', channel: 'all' }, targetValue: null });
    for (const row of dx.quantityPrice) {
      expect(row.decomposition.ok).toBe(true);
      expect(row.decomposition.volumeEffect! + row.decomposition.priceEffect!).toBeCloseTo(row.decomposition.delta!, 4);
    }
  });
});

describe('재구매율 분자·분모 검증', () => {
  it('재구매 고객 / 관찰 완료 고객', () => {
    const r = repurchaseRate({ cohortStart: '2026-01-01', cohortEnd: '2026-01-14', observationDate: '2026-02-20', observedCustomers: 200, repurchased30: 50 });
    expect(r.rate.value).toBe(25);
    expect(r.observationComplete).toBe(true);
    expect(r.rate.estimated).toBe(false);
  });
  it('분자가 분모보다 크면 오류', () => {
    const r = repurchaseRate({ cohortStart: '2026-01-01', cohortEnd: '2026-01-14', observationDate: '2026-02-20', observedCustomers: 10, repurchased30: 11 });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.rate.value).toBeNull();
  });
  it('관찰 기간 부족이면 잠정 표시', () => {
    const r = repurchaseRate({ cohortStart: '2026-01-01', cohortEnd: '2026-01-14', observationDate: '2026-02-01', observedCustomers: 100, repurchased30: 10 });
    expect(r.observationComplete).toBe(false);
    expect(r.rate.estimated).toBe(true);
  });
  it('분모 0이면 계산 불가', () => {
    const r = repurchaseRate({ cohortStart: '2026-01-01', cohortEnd: '2026-01-14', observationDate: '2026-02-20', observedCustomers: 0, repurchased30: 0 });
    expect(r.rate.reason).toBe('divZero');
  });
});

describe('설정 변경의 비소급', () => {
  it('적용 시작일 기준으로 규칙을 고른다', () => {
    const items = [{ effectiveFrom: '2026-01-01', v: 1 }, { effectiveFrom: '2026-02-01', v: 2 }];
    expect(pickEffective(items, '2026-01-31')?.v).toBe(1);
    expect(pickEffective(items, '2026-02-01')?.v).toBe(2);
    expect(pickEffective(items, '2025-12-31')).toBeNull();
  });
  it('새 수수료 규칙을 추가해도 이미 저장된 실적의 비용과 요약은 바뀌지 않는다', () => {
    const end = '2026-11-15';
    const data = generateSample(end);
    const { prev } = samplePeriods(end);
    const before = computeSummary(data, prev);
    const snapshot = JSON.stringify(data.sales);
    data.feeRules.push({ ...data.feeRules[2], id: 'new', effectiveFrom: prev.start, brokerageRate: 50 });
    // 규칙 조회는 바뀌지만
    expect(feeRuleFor(data, 'route_app_a', prev.start)?.brokerageRate).toBe(50);
    // 저장된 실적·요약은 그대로
    expect(JSON.stringify(data.sales)).toBe(snapshot);
    const after = computeSummary(data, prev);
    expect(after.operatingProfit.value).toBe(before.operatingProfit.value);
  });
});

describe('샘플 데이터 일관성', () => {
  const end = '2026-11-15';
  const data = generateSample(end);
  const { prev, cur } = samplePeriods(end);
  const p = computeSummary(data, prev);
  const c = computeSummary(data, cur);
  it('홀 매출 감소, 배달 주문 증가와 주문당 이익 악화, 포장 증가', () => {
    expect(c.channels.hall.netSales).toBeLessThan(p.channels.hall.netSales);
    expect(c.channels.delivery.orders!).toBeGreaterThan(p.channels.delivery.orders!);
    const dp0 = p.channels.delivery.directProfitPerOrder;
    const dp1 = c.channels.delivery.directProfitPerOrder;
    expect((dp1.value ?? dp1.provisional)!).toBeLessThan((dp0.value ?? dp0.provisional)!);
    expect(c.channels.takeout.netSales).toBeGreaterThan(p.channels.takeout.netSales);
  });
  it('채널 합계와 총매출, 일별 합계가 일치한다', () => {
    const chSum = c.channels.hall.netSales + c.channels.delivery.netSales + c.channels.takeout.netSales;
    expect(c.totalSales.value).toBeCloseTo(chSum);
    expect(c.daily.reduce((s, r) => s + r.total, 0)).toBeCloseTo(chSum);
  });
  it('영업일 수 차이가 반영된다', () => {
    expect(p.businessDays).toBe(24);
    expect(c.businessDays).toBe(23);
  });
  it('백업 직렬화·복원 후 동일', () => {
    const parsed = parseBackup(serialize(data));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(computeSummary(parsed.data, cur).totalSales.value).toBe(c.totalSales.value);
  });
  it('잘못된 백업은 거부한다', () => {
    expect(parseBackup('{"foo":1}').ok).toBe(false);
    expect(parseBackup('not json').ok).toBe(false);
  });
});

describe('해결안 예상 영업이익', () => {
  it('예상 매출 변화 − 예상 비용 변화 (비용 감소는 음수)', () => {
    expect(expectedProfitChange(-400_000, -1_000_000, 0, true)).toBe(600_000);
  });
  it('예산이 비용에 포함되면 다시 차감하지 않는다', () => {
    expect(expectedProfitChange(1_000_000, 300_000, 100_000, true)).toBe(700_000);
    expect(expectedProfitChange(1_000_000, 300_000, 100_000, false)).toBe(600_000);
  });
});
