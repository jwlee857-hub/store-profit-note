import { describe, expect, it } from 'vitest';
import { PRE_MIGRATION_PREFIX, RECOVERY_KEY, STORAGE_KEY, loadFromStorage, parseBackup, serialize } from '../storage/storage';
import { computeSummary, effectiveCost, grossSales, missingCostCount, netSales, profitForDisplay } from './calc';
import { diagnose, homeHeadline, topIssues } from './diagnosis';
import { solutionDraft } from './draft';
import { ENTRY_STATUS_LABEL, dayInputStatus, entryStatus, fillEstimates, salesSlots, switchAmountMode } from './entry';
import { estimateFees, feeBaseAmount } from './estimate';
import { emptyData, newSalesEntry, newSolution } from './factory';
import { fmtKpiTarget, josa, kpiTargetSuffix } from './format';
import { judgeKpiTarget, kpiModeAllowed, presetRanges, recentRanges, targetAlreadyMet } from './periods';
import { generateSample } from './sample';
import { SCHEMA_VERSION, type AppData, type FeeRule, type SalesEntry } from './types';
import { findDuplicates, validateSalesEntry } from './validation';

/** 격리된 테스트용 가게: 홀 1경로, 배달앱 1경로 */
function testStore(): AppData {
  const d = emptyData();
  d.store = {
    name: '테스트',
    channels: ['hall', 'delivery'],
    regularOpenDays: [1, 2, 3, 4, 5, 6],
    openTime: '11:00',
    closeTime: '21:00',
    seats: null,
    commonCostChecklist: [],
    vatBasis: 'included',
  };
  d.platforms = [{ id: 'p1', name: '앱', note: '' }];
  d.routes = [
    { id: 'r_hall', name: '매장', channels: ['hall'], platformId: null },
    { id: 'r_app', name: '배달앱', channels: ['delivery'], platformId: 'p1' },
  ];
  return d;
}
/** 기록이 있는 하루 (그 주의 다른 영업일은 마감 미입력이라 부분 합계가 된다) */
const RANGE = { start: '2026-11-03', end: '2026-11-03' };
/** 홀만 운영하는 가게 (배달 경로가 미입력으로 잡히지 않게) */
const hallOnly = () => {
  const d = testStore();
  d.store!.channels = ['hall'];
  return d;
};
/** 그날 기록하지 않은 경로를 '매출 없음'으로 확인 (홈과 같은 입력 현황 기준으로 그날을 다 채운다) */
const checkRest = (d: AppData, date: string) => {
  for (const s of salesSlots(d))
    if (!d.sales.some((e) => e.date === date && e.channel === s.channel && e.routeId === s.routeId))
      d.salesChecks.push({ date, channel: s.channel, routeId: s.routeId, status: 'noSales', checkedAt: '' });
};
const hallCosts = (e: SalesEntry, food: number) => {
  e.costs.food.actual = food;
  e.costs.payment.actual = 0;
  e.costs.hallSupplies.actual = 0;
  return e;
};

describe('매출 금액 기준: 할인 전 판매액 vs 순매출 직접 입력', () => {
  it('같은 매출을 두 방식으로 입력하면 순매출·합계·영업이익이 같다', () => {
    const a = testStore();
    a.sales = [hallCosts(newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 10, amountMode: 'gross', gross: 100_000, storeDiscount: 5_000, refund: 2_000 }), 30_000)];
    const b = testStore();
    b.sales = [hallCosts(newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 10, amountMode: 'net', netInput: 93_000 }), 30_000)];
    expect(netSales(a.sales[0])).toBe(93_000);
    expect(netSales(b.sales[0])).toBe(93_000);
    const sa = computeSummary(a, RANGE);
    const sb = computeSummary(b, RANGE);
    expect(sb.totalSales.value).toBe(sa.totalSales.value);
    expect(sb.operatingProfit.value).toBe(sa.operatingProfit.value);
    expect(sb.channels.hall.avgTicket.value).toBe(sa.channels.hall.avgTicket.value);
  });

  it('순매출 입력 후 할인·환불 상세를 추가해도 다시 빼지 않는다 (이중 차감 없음)', () => {
    const e = newSalesEntry({ channel: 'hall', routeId: 'r_hall', amountMode: 'net', netInput: 93_000 });
    expect(netSales({ ...e, storeDiscount: 5_000, refund: 2_000 })).toBe(93_000);
    // 상세가 모두 있으면 판매액을 복원
    expect(grossSales({ ...e, storeDiscount: 5_000, refund: 2_000 })).toBe(100_000);
    // 하나라도 모르면 복원하지 않음 (0으로 가정하지 않음)
    expect(grossSales({ ...e, storeDiscount: 5_000, refund: null })).toBeNull();
  });

  it('할인 상세가 없는 순매출 기록은 할인 합계에 0으로 섞지 않고 따로 센다', () => {
    const d = testStore();
    d.sales = [newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 5, amountMode: 'net', netInput: 50_000 })];
    const s = computeSummary(d, RANGE);
    expect(s.channels.hall.netSales).toBe(50_000);
    expect(s.channels.hall.detailMissing).toBe(1);
    expect(s.channels.hall.gross).toBe(0); // 판매액 합계에는 넣지 않음
  });
});

describe('미입력과 0원 구분', () => {
  it('순매출 빈칸은 미입력, 0은 0원', () => {
    const d = hallOnly();
    d.sales = [newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 0, amountMode: 'net', netInput: null })];
    const s1 = computeSummary(d, RANGE);
    expect(s1.totalSales.value).toBeNull();
    expect(s1.channels.hall.salesMissing).toBe(1);
    d.sales[0].netInput = 0;
    const s2 = computeSummary(d, RANGE);
    expect(s2.totalSales.value).toBe(0);
  });
  it('판매액 기준에서 할인·환불 빈칸은 0으로 가정하지 않고 입력을 요구한다', () => {
    const d = testStore();
    const e = newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 3, amountMode: 'gross', gross: 30_000 });
    const v = validateSalesEntry(e, d);
    expect(v.errors.storeDiscount).toBeTruthy();
    expect(v.errors.refund).toBeTruthy();
    const ok = validateSalesEntry({ ...e, storeDiscount: 0, refund: 0 }, d);
    expect(ok.errors.storeDiscount).toBeUndefined();
  });
  it('순매출 기준에서 할인·환불은 비워도 저장 가능', () => {
    const d = testStore();
    const v = validateSalesEntry(newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 3, amountMode: 'net', netInput: 30_000 }), d);
    expect(Object.keys(v.errors)).toEqual([]);
  });
});

describe('비용 없이 매출만 저장', () => {
  it('비용이 없어도 검증 오류가 없고, 상태는 매출 입력 완료, 영업이익은 확정하지 않는다', () => {
    const d = hallOnly();
    const e = newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 4, amountMode: 'net', netInput: 40_000 });
    expect(Object.keys(validateSalesEntry(e, d).errors)).toEqual([]);
    d.sales = [e];
    expect(entryStatus(e, d).status).toBe('salesOnly');
    const s = computeSummary(d, RANGE);
    expect(s.totalSales.value).toBe(40_000);
    expect(s.operatingProfit.value).toBeNull();
    expect(s.operatingProfit.reason).toBe('incomplete');
  });
  it('일부 비용만 있으면 비용 확인 필요, 근거 없는 추정값이 있으면 추정 포함, 설정대로 계산한 값만 남으면 비용 입력 완료, 모두 실제면 확인 완료', () => {
    const d = testStore();
    const e = newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 4, amountMode: 'net', netInput: 40_000 });
    e.costs.food.estimated = 12_000;
    expect(entryStatus(e, d).status).toBe('needsCheck');
    e.costs.payment.estimated = 600; // 근거 문구 없음 → 실제·설정 기준 계산으로 단정하지 않음
    e.costs.hallSupplies.actual = 0;
    expect(entryStatus(e, d).status).toBe('estimated');
    e.costs.food.actual = 11_000;
    e.costs.payment.estimateBasis = '설정 기준 계산: 결제 수수료 1.5% × 카드 결제액 40,000원 (2026-01-01부터 적용 설정)';
    expect(entryStatus(e, d).status).toBe('calculated');
    expect(ENTRY_STATUS_LABEL[entryStatus(e, d).status]).toBe('비용 입력 완료');
    e.costs.payment.actual = 600;
    expect(entryStatus(e, d).status).toBe('confirmed');
  });
});

describe('실제 비용이 추정 비용을 대체', () => {
  it('실제값이 있으면 추정값을 쓰지 않고 합산하지 않는다', () => {
    expect(effectiveCost({ actual: 9_000, estimated: 12_000, estimateBasis: '' })).toEqual({ amount: 9_000, status: 'actual' });
    const d = hallOnly();
    const e = hallCosts(newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 4, amountMode: 'net', netInput: 40_000 }), 9_000);
    e.costs.food.estimated = 12_000;
    d.sales = [e];
    expect(entryStatus(e, d).knownCost).toBe(9_000);
    expect(computeSummary(d, RANGE).operatingProfit.value).toBe(31_000);
  });
  it('간편 입력의 추정값 채우기는 이미 있는 실제값을 덮어쓰지 않는다', () => {
    const d = testStore();
    d.menus = [{ id: 'm', name: '찌개', onSale: true, versions: [{ id: 'v', effectiveFrom: '2026-01-01', prices: { hall: 10_000, delivery: null, takeout: null }, costMode: 'amount', costAmount: 3_000, costRate: null, costSource: 'actual', note: '' }] }];
    const e = newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 4, amountMode: 'net', netInput: 40_000 });
    e.costs.food.actual = 9_000;
    const r = fillEstimates(e, d);
    expect(r.entry.costs.food).toEqual(e.costs.food);
    const r2 = fillEstimates({ ...e, costs: { ...e.costs, food: { actual: null, estimated: null, estimateBasis: '' } } }, d);
    expect(r2.entry.costs.food.estimated).toBe(12_000); // 순매출 40,000 × 30% (상세 없음 → 순매출 기준)
    expect(r2.entry.costs.food.estimateBasis).toContain('순매출');
  });
});

describe('입력 모드 변경 시 의미 보존', () => {
  const base = newSalesEntry({ channel: 'hall', routeId: 'r_hall', orders: 5 });
  it('판매액 → 순매출: 할인·환불을 알면 계산해 옮기고 상세는 남긴다', () => {
    const r = switchAmountMode({ ...base, amountMode: 'gross', gross: 100_000, storeDiscount: 5_000, refund: 0 }, 'net');
    expect(r.entry.amountMode).toBe('net');
    expect(r.entry.netInput).toBe(95_000);
    expect(r.entry.gross).toBeNull();
    expect(r.entry.storeDiscount).toBe(5_000);
    expect(netSales(r.entry)).toBe(95_000);
    expect(r.notice).toContain('95,000원');
  });
  it('판매액 → 순매출: 할인·환불을 모르면 조용히 바꾸지 않고 비운 뒤 알려준다', () => {
    const r = switchAmountMode({ ...base, amountMode: 'gross', gross: 100_000, storeDiscount: null, refund: null }, 'net');
    expect(r.entry.netInput).toBeNull();
    expect(r.notice).toContain('계산하지 않았습니다');
  });
  it('순매출 → 판매액: 상세가 모두 있으면 복원, 없으면 비우고 알려준다', () => {
    const ok = switchAmountMode({ ...base, amountMode: 'net', netInput: 95_000, storeDiscount: 5_000, refund: 0 }, 'gross');
    expect(ok.entry.gross).toBe(100_000);
    expect(netSales(ok.entry)).toBe(95_000);
    const no = switchAmountMode({ ...base, amountMode: 'net', netInput: 95_000, storeDiscount: null, refund: null }, 'gross');
    expect(no.entry.gross).toBeNull();
    expect(no.notice).toContain('계산할 수 없습니다');
  });
});

describe('수수료 기준 금액: 상세가 없으면 추가 정보 필요', () => {
  const rule: FeeRule = { id: 'f', routeId: 'r_app', effectiveFrom: '2026-01-01', mode: 'separate', brokerageRate: 10, brokerageBase: 'gross', paymentRate: 3, paymentBase: 'net', bundledRate: null, bundledBase: 'gross', perOrderFee: null, vatExclusive: false, note: '' };
  it('순매출 기준 기록: 순매출 기준 수수료는 계산, 판매액 기준 수수료는 추가 정보 필요', () => {
    const e = newSalesEntry({ channel: 'delivery', routeId: 'r_app', orders: 2, amountMode: 'net', netInput: 50_000 });
    expect(feeBaseAmount(e, 'net')).toBe(50_000);
    expect(feeBaseAmount(e, 'gross')).toBeNull();
    const est = estimateFees(e, rule);
    expect(est.payment).toBe(1_500);
    expect(est.brokerage).toBeNull();
    expect(est.needsInfo).toBe(true);
  });
  it('상세가 있으면 판매액 기준도 계산', () => {
    const e = newSalesEntry({ channel: 'delivery', routeId: 'r_app', orders: 2, amountMode: 'net', netInput: 50_000, storeDiscount: 4_000, refund: 0 });
    expect(feeBaseAmount(e, 'gross')).toBe(54_000);
    expect(feeBaseAmount(e, 'afterDiscount')).toBe(50_000);
    expect(estimateFees(e, rule).needsInfo).toBe(false);
  });
  it('기존(판매액 기준) 기록의 수수료 계산은 그대로', () => {
    const e = newSalesEntry({ channel: 'delivery', routeId: 'r_app', orders: 2, amountMode: 'gross', gross: 54_000, storeDiscount: 4_000, refund: 0 });
    expect(estimateFees(e, rule).brokerage).toBe(5_400);
    expect(estimateFees(e, rule).payment).toBe(1_500);
  });
});

describe('빠른 입력: 모르는 할인·환불을 0원으로 가정하지 않는다 (수수료는 필요한 정보가 있을 때만 계산)', () => {
  // 샘플 배달앱 A 규칙: 중개 9%·결제 3%, 기준 = 할인 후·환불 전 금액(순매출 + 환불), 부가세 별도
  // 이전 버전(1단계)은 모르는 할인·환불을 0원으로 가정해 계산했으나, 이제는 계산 불가로 남기고 필요한 정보(환불액)만 묻는다.
  const data = generateSample('2026-11-15');
  const e = newSalesEntry({ date: '2026-11-16', channel: 'delivery', routeId: 'route_app_a', orders: 36, amountMode: 'net', netInput: 700_000 });
  it('환불액을 모르면 수수료는 계산하지 않고(0원 아님) 다른 비용은 계산한다', () => {
    const r = fillEstimates(e, data);
    expect(r.entry.costs.brokerage.estimated).toBeNull();
    expect(r.entry.costs.payment.estimated).toBeNull();
    expect(r.needsInfo).toEqual(['중개 수수료', '결제 수수료']);
    expect(r.applied).toEqual(expect.arrayContaining(['가게 부담 순배달비', '포장비', '식재료비']));
    expect(r.assumptions).toEqual([]);
    expect(r.entry.storeDiscount).toBeNull(); // 저장된 할인·환불은 여전히 '모름'
  });
  it('환불액만 알면 계산한다 (할인액은 이 기준에 필요 없음)', () => {
    const r = fillEstimates({ ...e, refund: 0 }, data);
    expect(r.entry.costs.brokerage.estimated).toBe(Math.round(700_000 * 0.09 * 1.1));
    expect(r.entry.costs.payment.estimated).toBe(Math.round(700_000 * 0.03 * 1.1));
    expect(r.entry.costs.brokerage.estimateBasis).not.toContain('가정');
    expect(r.entry.costs.brokerage.actual).toBeNull(); // 정산 확인액 칸은 비워 둔다
  });
  it('상세 입력 화면의 수수료 추정은 가정 없이 추가 정보 필요로 남는다', () => {
    const rule = data.feeRules.find((f) => f.routeId === 'route_app_a' && f.effectiveFrom <= '2026-11-16' && f.brokerageRate === 9)!;
    expect(estimateFees(e, rule).needsInfo).toBe(true);
    expect(estimateFees(e, rule).brokerage).toBeNull();
  });
});

describe('1단계 재현: 빠른 저장 뒤에도 홈 영업이익 숫자가 보인다', () => {
  function quickSave(data: AppData, partial: Partial<SalesEntry>) {
    const e = newSalesEntry({ date: '2026-11-16', amountMode: 'net', ...partial });
    data.sales = [...data.sales, fillEstimates(e, data).entry];
  }
  it('샘플: 홀 650,000원/30건 + 배달앱 A 700,000원/36건 저장 후에도 최근 4주 영업이익 숫자가 보이고, 수수료 정보가 없으면 미확정으로 알린다', () => {
    const data = generateSample('2026-11-15');
    quickSave(data, { channel: 'hall', routeId: 'route_hall', netInput: 650_000, orders: 30 });
    quickSave(data, { channel: 'delivery', routeId: 'route_app_a', netInput: 700_000, orders: 36 });
    const r = recentRanges(data);
    expect(r.cur.end).toBe('2026-11-16');
    const s = computeSummary(data, r.cur);
    // 결제수단·환불을 모르면 수수료만 계산하지 않는다 → 숫자는 보이되(잠정) 미확정
    expect(profitForDisplay(s.operatingProfit).amount).not.toBeNull();
    expect(profitForDisplay(s.operatingProfit).provisional).toBe(true);
    // 필요한 정보(카드 결제액, 환불액)를 넣으면 확정(추정 포함)으로 계산된다
    const data2 = generateSample('2026-11-15');
    quickSave(data2, { channel: 'hall', routeId: 'route_hall', netInput: 650_000, orders: 30, cardSales: 500_000 });
    quickSave(data2, { channel: 'delivery', routeId: 'route_app_a', netInput: 700_000, orders: 36, refund: 0 });
    checkRest(data2, '2026-11-16'); // 배달앱 B·포장은 그날 매출 없음으로 확인 (빠진 경로가 있으면 부분 합계라 확정하지 않는다)
    const s2 = computeSummary(data2, recentRanges(data2).cur);
    expect(s2.status.missing.filter((m) => m.kind === 'cost')).toEqual([]);
    expect(s2.operatingProfit.value).not.toBeNull();
    expect(s2.operatingProfit.estimated).toBe(true);
    // 주문 1건당 기본 비용으로 채운 값
    const hall = data2.sales.find((x) => x.date === '2026-11-16' && x.channel === 'hall')!;
    expect(hall.costs.hallSupplies.estimated).toBe(480 * 30);
    expect(hall.costs.hallSupplies.estimateBasis).toContain('주문 1건당');
    expect(hall.costs.payment.estimated).toBe(Math.round(500_000 * 0.015)); // 카드 결제분에만
    const del = data2.sales.find((x) => x.date === '2026-11-16' && x.channel === 'delivery')!;
    expect(del.costs.delivery.estimated).toBe(3300 * 36);
    expect(del.costs.packaging.estimated).toBe(700 * 36);
    // 수수료·배달비·포장비는 설정 기준 계산이지만, 식재료비는 메뉴 원가율 단순 평균(판매 비중 가정)이라 추정 포함
    expect(entryStatus(del, data2).calculated).toEqual(expect.arrayContaining(['brokerage', 'payment', 'delivery', 'packaging']));
    expect(entryStatus(del, data2).estimated).toEqual(['food']);
    expect(entryStatus(del, data2).status).toBe('estimated');
  });
  it('경로 지정 기본값이 판매 방식 공통 값보다 우선하고, 실제값이 있으면 채우지 않는다', () => {
    const data = generateSample('2026-11-15');
    data.perOrderCosts.push({ id: 'x', channel: 'delivery', routeId: 'route_app_a', category: 'packaging', amount: 900, effectiveFrom: '2026-01-01' });
    const e = newSalesEntry({ date: '2026-11-16', channel: 'delivery', routeId: 'route_app_a', orders: 10, amountMode: 'net', netInput: 200_000 });
    expect(fillEstimates(e, data).entry.costs.packaging.estimated).toBe(9_000);
    e.costs.delivery.actual = 25_000;
    expect(fillEstimates(e, data).entry.costs.delivery).toEqual(e.costs.delivery);
  });
  it('기본값이 없는 가게: 숫자는 입력된 비용만 반영한 잠정값으로 보이고, 미확정·미입력 개수를 함께 알린다', () => {
    const d = hallOnly();
    d.sales = [
      hallCosts(newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 10, amountMode: 'net', netInput: 100_000 }), 30_000),
      newSalesEntry({ date: '2026-11-10', channel: 'hall', routeId: 'r_hall', orders: 10, amountMode: 'net', netInput: 120_000 }),
    ];
    const cur = computeSummary(d, { start: '2026-11-10', end: '2026-11-10' });
    const prev = computeSummary(d, RANGE);
    expect(cur.operatingProfit.value).toBeNull();
    expect(profitForDisplay(cur.operatingProfit)).toEqual({ amount: 120_000, provisional: true });
    expect(missingCostCount(cur)).toBe(3);
    const text = homeHeadline(prev, cur);
    expect(text).toContain('영업이익(미확정)');
    expect(text).toContain('비용 3개가 아직 입력되지 않아 실제보다 높게 보일 수 있어요');
  });
});

describe('조사 고르기', () => {
  it('받침에 따라 이/가, 은/는, 을/를, 으로/로', () => {
    expect(josa('인건비', '이/가')).toBe('인건비가');
    expect(josa('식재료비', '이/가')).toBe('식재료비가');
    expect(josa('평균 주문금액', '이/가')).toBe('평균 주문금액이');
    expect(josa('손님 수', '이/가')).toBe('손님 수가');
    expect(josa('객단가', '이/가')).toBe('객단가가');
    expect(josa('120,000원', '은/는')).toBe('120,000원은');
    expect(josa('메뉴 원가', '으로/로')).toBe('메뉴 원가로');
    expect(josa('수수료 규칙', '으로/로')).toBe('수수료 규칙으로');
    expect(josa('주문 1건당 기본 비용', '으로/로')).toBe('주문 1건당 기본 비용으로');
    expect(josa('포장재', '을/를')).toBe('포장재를');
    expect(josa('3', '이/가')).toBe('3이');
    expect(josa('2', '이/가')).toBe('2가');
  });
});

describe('중복 입력 안내', () => {
  it('같은 날짜·경로·결제수단은 중복(저장 차단), 결제수단만 다르면 안내', () => {
    const d = testStore();
    d.sales = [newSalesEntry({ id: 's1', date: '2026-11-03', channel: 'hall', routeId: 'r_hall', paymentMethodId: null, orders: 1, amountMode: 'net', netInput: 1 })];
    const same = newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', paymentMethodId: null, orders: 1, amountMode: 'net', netInput: 1 });
    expect(findDuplicates(same, d).exact?.id).toBe('s1');
    expect(validateSalesEntry(same, d).errors.date).toContain('이미 있습니다');
    const card = { ...same, paymentMethodId: 'card' };
    expect(findDuplicates(card, d).exact).toBeNull();
    expect(findDuplicates(card, d).sameSlot).toHaveLength(1);
    expect(validateSalesEntry(card, d).warnings.duplicate).toBeTruthy();
    // 자기 자신을 수정할 때는 중복 아님
    expect(findDuplicates(d.sales[0], d).exact).toBeNull();
  });
});

describe('날짜별 입력 현황', () => {
  it('미입력·매출 없음(확인)·휴업일·입력 완료를 구분하고, 기록이 없다고 0원으로 보지 않는다', () => {
    const d = testStore();
    // 2026-11-03(화) 영업일
    let st = dayInputStatus(d, '2026-11-03');
    expect(st.slots.map((s) => s.state.kind)).toEqual(['missing', 'missing']);
    d.sales = [newSalesEntry({ date: '2026-11-03', channel: 'hall', routeId: 'r_hall', orders: 2, amountMode: 'net', netInput: 20_000 })];
    d.salesChecks = [{ date: '2026-11-03', channel: 'delivery', routeId: 'r_app', status: 'noSales', checkedAt: '' }];
    st = dayInputStatus(d, '2026-11-03');
    expect(st.slots[0].state).toMatchObject({ kind: 'entered', status: 'salesOnly', net: 20_000 });
    expect(st.slots[1].state.kind).toBe('noSales');
    expect(st.missingCount).toBe(0);
    // 2026-11-08(일) 정기 휴무
    expect(dayInputStatus(d, '2026-11-08').slots.every((s) => s.state.kind === 'closed')).toBe(true);
    // 매출 없음 확인은 매출 합계·영업이익 계산에 영향을 주지 않는다
    expect(computeSummary(d, RANGE).entryCount).toBe(1);
  });
});

describe('홈 기간 버튼: 진행 중 기간은 같은 일수끼리 비교', () => {
  it('이번 주 (수요일 기준)', () => {
    const r = presetRanges('week', '2026-11-18', '2026-11-18');
    expect(r.cur).toEqual({ start: '2026-11-16', end: '2026-11-18' });
    expect(r.prev).toEqual({ start: '2026-11-09', end: '2026-11-11' });
    expect(r.inProgress).toBe(true);
  });
  it('이번 달은 마지막 매출 입력일(14일)까지 vs 지난달 14일까지', () => {
    const r = presetRanges('month', '2026-11-16', '2026-11-14');
    expect(r.cur).toEqual({ start: '2026-11-01', end: '2026-11-14' });
    expect(r.prev).toEqual({ start: '2026-10-01', end: '2026-10-14' });
  });
  it('지난달이 더 짧으면 말일까지만', () => {
    const r = presetRanges('month', '2026-03-31', '2026-03-31');
    expect(r.prev).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(r.compareLabel).toContain('일수가 다릅니다');
  });
  it('최근 4주는 마지막 매출 입력일 기준', () => {
    const r = presetRanges('recent28', '2026-11-16', '2026-11-14');
    expect(r.cur).toEqual({ start: '2026-10-18', end: '2026-11-14' });
    expect(r.inProgress).toBe(false);
  });
});

describe('해결안 목표: 총량·증가분·증가율·영업일당', () => {
  it('증가율: (실행 후 − 실행 전) ÷ 실행 전 × 100', () => {
    const r = judgeKpiTarget('growthRate', 10, 200, 230, true);
    expect(r.actual).toBeCloseTo(15);
    expect(r.achieved).toBe(true);
    expect(judgeKpiTarget('growthRate', 20, 200, 230, true).achieved).toBe(false);
  });
  it('증가율: 실행 전 0이면 계산하지 않음', () => {
    const r = judgeKpiTarget('growthRate', 10, 0, 30, true);
    expect(r.achieved).toBeNull();
    expect(r.reason).toContain('0 이하');
  });
  it('영업일당: 실행 후 값 ÷ 영업일', () => {
    const r = judgeKpiTarget('perBusinessDay', 10, null, 260, true, 24);
    expect(r.actual).toBeCloseTo(260 / 24);
    expect(r.achieved).toBe(true);
    expect(judgeKpiTarget('perBusinessDay', 10, null, 260, true, 0).achieved).toBeNull();
  });
  it('단위 표기: 총량 건, 증가분 건, 증가율 %, 영업일당 건/일, 비율 지표 증가분 %p', () => {
    expect(kpiTargetSuffix('total', 'orders')).toBe('건');
    expect(kpiTargetSuffix('increase', 'orders')).toBe('건');
    expect(kpiTargetSuffix('growthRate', 'orders')).toBe('%');
    expect(kpiTargetSuffix('perBusinessDay', 'orders')).toBe('건/일');
    expect(kpiTargetSuffix('increase', 'pct')).toBe('%p');
    expect(fmtKpiTarget(150, 'total', 'orders', true)).toBe('실행 후 기간 150건');
    expect(fmtKpiTarget(30, 'increase', 'orders', true)).toBe('실행 전보다 30건 증가');
    expect(fmtKpiTarget(10, 'growthRate', 'orders', true)).toBe('실행 전보다 10.0% 증가');
    expect(fmtKpiTarget(12, 'perBusinessDay', 'orders', true)).toBe('영업일당 12건');
  });
  it('영업일당 기준은 합계형 지표에만, 증가율은 비율 지표에 쓰지 않음', () => {
    expect(kpiModeAllowed('orders', 'orders', 'perBusinessDay')).toBe(true);
    expect(kpiModeAllowed('avgTicket', 'won', 'perBusinessDay')).toBe(false);
    expect(kpiModeAllowed('operatingMargin', 'pct', 'growthRate')).toBe(false);
  });
  it('현재 실적이 이미 목표 이상이면 안내 대상 (막지 않음)', () => {
    expect(targetAlreadyMet('total', 150, 215, 24, true)).toBe(true);
    expect(targetAlreadyMet('perBusinessDay', 8, 215, 24, true)).toBe(true);
    expect(targetAlreadyMet('increase', 30, 215, 24, true)).toBe(false);
  });
  it('선택 항목을 비운 해결안도 형식 검증을 통과해 저장·복원된다', () => {
    const d = testStore();
    d.solutions = [newSolution({ name: '포장 안내 강화' })];
    const s = d.solutions[0];
    expect(s.expectedRevenueChange).toBeNull(); // 미입력 유지 (0원 아님)
    expect(s.budget).toBeNull();
    const parsed = parseBackup(serialize(d));
    expect(parsed.ok).toBe(true);
  });
});

describe('진단 → 실행 계획 초안', () => {
  const data = generateSample('2026-11-15');
  const problem = data.problems[0];
  const dx = diagnose(data, problem);
  it('먼저 확인할 문제는 영향 금액이 큰 순서로 최대 3개', () => {
    const top = topIssues(dx, 3);
    expect(top.length).toBeLessThanOrEqual(3);
    expect(top.length).toBeGreaterThan(0);
    for (let i = 1; i < top.length; i++) expect(Math.abs(top[i - 1].impact ?? 0)).toBeGreaterThanOrEqual(Math.abs(top[i].impact ?? 0));
    expect(top.every((f) => f.tone === 'watch')).toBe(true);
  });
  it('초안에 연결된 문제·대상·근거(수치·기간)가 들어가고 예상 효과는 미입력으로 남는다', () => {
    const f = topIssues(dx, 1)[0];
    const s = solutionDraft(data, problem, f.id);
    expect(s.problemId).toBe(problem.id);
    expect(s.target).toBe(f.channel === 'all' ? 'common' : f.channel);
    expect(s.evidence).toContain(f.fact);
    expect(s.evidence).toContain('분석');
    expect(s.hypothesis.length).toBeGreaterThan(0);
    expect(s.expectedRevenueChange).toBeNull();
    expect(s.expectedCostChange).toBeNull();
  });
  it('홈 한 줄 요약은 실제 계산에서 만든다', () => {
    const r = recentRanges(data);
    const text = homeHeadline(computeSummary(data, r.prev), computeSummary(data, r.cur));
    expect(text).toMatch(/영업이익/);
    expect(text).toMatch(/줄었어요|늘었어요|비슷해요|확정할 수 없어요/);
  });
});

describe('저장 데이터 호환', () => {
  /** v2 형식으로 되돌린 백업 (v3 필드 제거) */
  function v2Backup(): string {
    const d = generateSample('2026-11-15') as unknown as Record<string, unknown>;
    const sales = (d.sales as Record<string, unknown>[]).map(({ amountMode: _a, netInput: _n, ...rest }) => rest);
    const customerMetrics = (d.customerMetrics as Record<string, unknown>[]).map(({ source: _s, platformRepeatRate: _p, platformRepeatDefinition: _q, ...rest }) => rest);
    const { salesChecks: _c, prefs: _p, ...restData } = d;
    return JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 2, exportedAt: '2026-11-15T00:00:00.000Z', data: { ...restData, schemaVersion: 2, sales, customerMetrics } });
  }
  it('v2 백업을 열면 금액 기준은 기존 의미(할인 전 판매액)로, 새 항목은 빈 값으로 채워진다', () => {
    const parsed = parseBackup(v2Backup());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.sales.every((e) => e.amountMode === 'gross' && e.netInput === null)).toBe(true);
    expect(parsed.data.salesChecks).toEqual([]);
    expect(parsed.data.prefs.customerData).toBe('available'); // 기존 고객 지표가 있으므로
    expect(parsed.data.customerMetrics.every((m) => m.platformRepeatRate === null)).toBe(true);
  });
  it('v3 백업(주문 1건당 기본 비용 없음)도 열리고 계산 결과가 같다', () => {
    const d = generateSample('2026-11-15') as unknown as Record<string, unknown>;
    const { perOrderCosts: _x, ...rest } = d;
    const raw = JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 3, exportedAt: '2026-11-15T00:00:00.000Z', data: { ...rest, schemaVersion: 3 } });
    const parsed = parseBackup(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.data.perOrderCosts).toEqual([]);
    const original = generateSample('2026-11-15');
    const r = recentRanges(original).cur;
    expect(computeSummary(parsed.data, r).operatingProfit.value).toBe(computeSummary(original, r).operatingProfit.value);
  });
  it('v2 → v3 변환 후 영업이익·매출 계산 결과가 같다', () => {
    const original = generateSample('2026-11-15');
    const parsed = parseBackup(v2Backup());
    if (!parsed.ok) throw new Error(parsed.error);
    const r = recentRanges(original);
    for (const range of [r.cur, r.prev]) {
      const a = computeSummary(original, range);
      const b = computeSummary(parsed.data, range);
      expect(b.totalSales.value).toBe(a.totalSales.value);
      expect(b.operatingProfit.value).toBe(a.operatingProfit.value);
    }
  });
  it('저장소의 이전 버전 데이터를 불러오면 변환 전 원본을 따로 보관한다', () => {
    const raw = v2Backup();
    const store = memoryStorage({ [STORAGE_KEY]: raw });
    const res = loadFromStorage(store);
    expect(res.ok).toBe(true);
    expect(store.getItem(`${PRE_MIGRATION_PREFIX}${SCHEMA_VERSION}`)).toBe(raw);
    expect(store.getItem(STORAGE_KEY)).toBe(raw); // 원본 키는 그대로
  });
  it('불러오기·변환에 실패해도 원본을 지우거나 덮어쓰지 않고 복구용으로 보관한다', () => {
    const broken = JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 2, data: { mode: 'user' } });
    const store = memoryStorage({ [STORAGE_KEY]: broken });
    const res = loadFromStorage(store);
    expect(res.ok).toBe(false);
    expect(store.getItem(STORAGE_KEY)).toBe(broken);
    expect(store.getItem(RECOVERY_KEY)).toBe(broken);
  });
  it('샘플 데이터와 사용자 데이터를 섞지 않는다: 불러온 데이터의 mode를 그대로 유지', () => {
    const sample = generateSample('2026-11-15');
    const parsed = parseBackup(serialize(sample));
    expect(parsed.ok && parsed.data.mode).toBe('sample');
    const user = testStore();
    const p2 = parseBackup(serialize(user));
    expect(p2.ok && p2.data.mode).toBe('user');
  });
});

function memoryStorage(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}
