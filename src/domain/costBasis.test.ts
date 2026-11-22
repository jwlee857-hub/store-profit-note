// 비용 근거 구분: 실제 / 설정 기준 계산 / 추정. 저장된 금액은 바꾸지 않고 표시 근거만 나눈다.
import { describe, expect, it } from 'vitest';
import { computeSummary, effectiveCost } from './calc';
import { basisMix, costBasisOf, costDetailText, costFlag } from './costBasis';
import { ENTRY_STATUS_LABEL, autoCostPreview, costSourceOf, dayInputStatus, entryStatus, fillEstimates, recalcAuto } from './entry';
import { emptyData, newSalesEntry } from './factory';
import { pendingEstimates } from './pending';
import { migrate, parseBackup, validateData } from '../storage/storage';
import { SCHEMA_VERSION, type AppData, type FeeRule, type SalesEntry } from './types';

const RANGE = { start: '2026-11-02', end: '2026-11-08' };

/** 포장 1경로(전화, 플랫폼 없음). 주문 1건당 포장비 500원, 카드 결제 수수료 1.5% 설정 */
function store(): AppData {
  const d = emptyData();
  d.store = { name: '테스트', channels: ['takeout'], regularOpenDays: [1, 2, 3, 4, 5, 6], openTime: '11:00', closeTime: '21:00', seats: null, commonCostChecklist: [], vatBasis: 'included' };
  d.routes = [{ id: 'r_phone', name: '전화', channels: ['takeout'], platformId: null }];
  d.paymentMethods = [{ id: 'pay_card', name: '카드' }];
  d.perOrderCosts = [{ id: 'po', channel: 'takeout', routeId: null, category: 'packaging', amount: 500, effectiveFrom: '2026-01-01' }];
  const rule: FeeRule = { id: 'f', routeId: 'r_phone', effectiveFrom: '2026-01-01', mode: 'separate', brokerageRate: null, brokerageBase: 'net', paymentRate: 1.5, paymentBase: 'net', bundledRate: null, bundledBase: 'net', perOrderFee: null, vatExclusive: false, note: '' };
  d.feeRules = [rule];
  return d;
}

/** 주문 10건·매출 200,000원 카드 결제 포장 기록을 빠른 입력처럼 자동 계산으로 채운다 */
function quick(d: AppData, patch: Partial<SalesEntry> = {}): SalesEntry {
  const e = newSalesEntry({ date: '2026-11-03', channel: 'takeout', routeId: 'r_phone', paymentMethodId: 'pay_card', orders: 10, amountMode: 'net', netInput: 200_000, ...patch });
  return fillEstimates(e, d).entry;
}

describe('설정값만 사용한 경우: 설정 기준 계산', () => {
  it('주문 10건 × 건당 포장비 500원 = 5,000원은 설정 기준 계산이고, 상세에 기준이 남는다', () => {
    const d = store();
    const e = quick(d);
    e.costs.food.actual = 60_000; // 식재료비는 영수증으로 확인
    expect(e.costs.packaging.estimated).toBe(5_000);
    const info = costBasisOf('packaging', e.costs.packaging, e);
    expect(info.kind).toBe('calculated');
    expect(costFlag(info)).toBeNull(); // 정상 계산: 배지 없이 금액만
    expect(costDetailText(e.costs.packaging)).toBe('건당 500원 × 10건');
    // 저장되는 근거 문구(데이터)는 이전과 같은 형식
    expect(info.basis).toBe('가게 설정 기본값: 주문 1건당 500원 × 10건 (2026-01-01부터 적용)');
    expect(e.costs.packaging.calc).toEqual({ method: 'perOrder', unitAmount: 500, orders: 10, effectiveFrom: '2026-01-01' });
    expect(info.assumption).toBeNull();
    // 수수료도 설정 요율 × 입력 금액 → 설정 기준 계산
    expect(costBasisOf('payment', e.costs.payment, e).kind).toBe('calculated');
    expect(e.costs.payment.estimated).toBe(3_000);
    // 매출 기록: 계산 방식 설명 없이 '비용 입력 완료'
    d.sales = [e];
    const st = entryStatus(e, d);
    expect(st.status).toBe('calculated');
    expect(ENTRY_STATUS_LABEL[st.status]).toBe('비용 입력 완료');
    expect(st.estimated).toEqual([]);
    // 대시보드: 실제 + 설정 기준 계산만 → 추정 표시 없음
    const s = computeSummary(d, RANGE);
    expect(s.status).toMatchObject({ actualAmount: 60_000, calculatedAmount: 8_000, estimatedAmount: 0 });
    expect(s.operatingProfit).toMatchObject({ value: 200_000 - 68_000, estimated: false, calculated: true });
    expect(s.channels.takeout.directCostCalc).toMatchObject({ estimated: false, calculated: true });
    // 비용 구성: 포장비 줄은 계산액만, 식재료비 줄은 실제만
    const pack = s.costBreakdown.find((r) => r.category === 'packaging')!;
    expect(pack).toMatchObject({ actual: 0, calculated: 5_000, estimated: 0, total: 5_000 });
    expect(basisMix(pack)).toBeNull();
    expect(basisMix({ actual: 60_000, calculated: 5_000, estimated: 0 })).toBeNull();
    expect(basisMix(s.costBreakdown.find((r) => r.category === 'food')!)).toBeNull();
    expect(basisMix({ actual: 60_000, calculated: 5_000, estimated: 1 })!.text).toBe('추정 포함');
  });

  it('직접 정한 원가율을 상품 판매액에 그대로 적용하면 설정 기준 계산, 기준을 순매출로 대신했으면 추정', () => {
    const gross = { actual: null, estimated: 70_000, estimateBasis: '직접 지정 원가율 35% × 상품 판매액' };
    expect(costBasisOf('food', gross).kind).toBe('calculated');
    expect(costSourceOf('food', gross)).toBe('rateCalc');
    // 이전 버전이 붙이던 "(추정)" 표기가 있어도 근거(직접 정한 원가율 × 판매액)는 같다
    expect(costBasisOf('food', { ...gross, estimateBasis: '직접 지정 원가율 35% (추정) × 상품 판매액' }).kind).toBe('calculated');
    const net = costBasisOf('food', { ...gross, estimateBasis: '직접 지정 원가율 35% × 순매출 (할인·환불 상세가 없어 실제보다 낮게 추정될 수 있음)' });
    expect(net.kind).toBe('estimated');
    expect(net.assumption).toContain('순매출');
  });
});

describe('가정이 섞인 경우: 추정', () => {
  it('메뉴 원가율 단순 평균으로 채운 식재료비가 있으면 기록은 추정 포함, 합계도 추정 포함', () => {
    const d = store();
    d.menus = [
      { id: 'm1', name: 'A', onSale: true, versions: [{ id: 'v1', effectiveFrom: '2026-01-01', prices: { hall: null, delivery: null, takeout: 10_000 }, costMode: 'rate', costRate: 30, costAmount: null, costSource: 'actual', note: '' }] },
      { id: 'm2', name: 'B', onSale: true, versions: [{ id: 'v2', effectiveFrom: '2026-01-01', prices: { hall: null, delivery: null, takeout: 10_000 }, costMode: 'rate', costRate: 40, costAmount: null, costSource: 'actual', note: '' }] },
    ];
    const e = quick(d, { storeDiscount: 0, refund: 0 });
    const food = costBasisOf('food', e.costs.food, e);
    expect(food.kind).toBe('estimated');
    expect(food.assumption).toContain('단순 평균');
    expect(costSourceOf('food', e.costs.food, false, e)).toBe('reference');
    d.sales = [e];
    const st = entryStatus(e, d);
    expect(st.status).toBe('estimated');
    expect(ENTRY_STATUS_LABEL[st.status]).toBe('추정 포함');
    expect(st.calculated).toEqual(expect.arrayContaining(['payment', 'packaging']));
    const s = computeSummary(d, RANGE);
    expect(s.status).toMatchObject({ calculatedAmount: 8_000, estimatedAmount: 70_000 });
    expect(s.operatingProfit).toMatchObject({ estimated: true, calculated: false });
  });

  it('설정 요율을 썼더라도 모르는 할인·환불을 0원으로 가정했으면 추정이고, 가정 내용이 보인다', () => {
    const basis = '중개 9% · 결제 3% (2026-01-01 적용 규칙, 부가세 10% 가산) · 할인·환불 금액을 몰라 할인·환불 0원으로 가정 — 실제보다 낮게 추정될 수 있음';
    const info = costBasisOf('brokerage', { actual: null, estimated: 69_300, estimateBasis: basis });
    expect(info.kind).toBe('estimated');
    expect(info.assumption).toBe('할인·환불 금액을 몰라 할인·환불 0원으로 가정 — 실제보다 낮게 추정될 수 있음');
    expect(costBasisOf('brokerage', { actual: null, estimated: 69_300, estimateBasis: '중개 9% · 결제 3% (2026-01-01 적용 규칙)' }).kind).toBe('calculated');
  });

  it('임시 원가율 30%는 사용자가 정한 원가율이 아니므로 추정', () => {
    const info = costBasisOf('food', { actual: null, estimated: 60_000, estimateBasis: '임시 추정 원가율 30% (검증되지 않은 임시값) × 상품 판매액' });
    expect(info.kind).toBe('estimated');
    expect(info.assumption).toContain('임시 원가율');
  });

  it('지난달 청구액을 가져온 기간 비용은 추정으로 합산된다', () => {
    const d = store();
    const e = quick(d);
    e.costs.food.actual = 60_000;
    d.sales = [e];
    // 기록이 있는 날(11/3)만 덮는 비용으로 두어 미입력 영업일 제외(안분)와 섞이지 않게 한다
    d.periodCosts = [{ id: 'pc', category: 'utilities', attribution: 'common', nature: 'variable', start: '2026-11-03', end: '2026-11-03', amount: 70_000, source: 'estimated', memo: '지난달 금액' }];
    const s = computeSummary(d, RANGE);
    expect(s.status).toMatchObject({ actualAmount: 60_000, calculatedAmount: 8_000, estimatedAmount: 70_000 });
    expect(s.operatingProfit).toMatchObject({ estimated: true, calculated: false });
    expect(s.directProfitTotal.estimated).toBe(true); // 기존 규칙: 기간 전체 비용 기준으로 표시
    const items = pendingEstimates(d, RANGE);
    expect(items.find((i) => i.kind === 'period')).toMatchObject({ amount: 70_000 });
    expect(items.find((i) => i.categories.includes('packaging'))).toBeUndefined(); // 설정대로 계산한 포장비는 할 일이 아님
  });
});

describe('실제 정산액으로 대체한 경우', () => {
  it('정산서 금액을 넣으면 그 금액을 우선 쓰고 실제로 표시하며, 저장된 계산값과 근거는 그대로 둔다', () => {
    const d = store();
    const e = quick(d);
    e.costs.food.actual = 60_000;
    const before = structuredClone(e.costs.payment);
    e.costs.payment.actual = 2_800; // 정산서 확인액
    e.costs.packaging.actual = 4_600; // 영수증 확인액
    expect(e.costs.payment.estimated).toBe(before.estimated); // 저장 당시 계산 결과 보존
    expect(e.costs.payment.estimateBasis).toBe(before.estimateBasis);
    expect(effectiveCost(e.costs.payment).amount).toBe(2_800);
    expect(costSourceOf('payment', e.costs.payment, false, e)).toBe('settled');
    expect(costBasisOf('packaging', e.costs.packaging, e).kind).toBe('actual');
    d.sales = [e];
    expect(entryStatus(e, d).status).toBe('confirmed');
    const s = computeSummary(d, RANGE);
    expect(s.status).toMatchObject({ actualAmount: 60_000 + 2_800 + 4_600, calculatedAmount: 0, estimatedAmount: 0 });
    expect(s.operatingProfit).toMatchObject({ value: 200_000 - 67_400, estimated: false, calculated: false });
    expect(pendingEstimates(d, RANGE)).toEqual([]);
  });
});

describe('매출이 미입력인 경우', () => {
  it('기록이 없는 영업일은 평균 매출로 채우지 않고 미입력으로 둔다', () => {
    const d = store();
    const e = quick(d);
    e.costs.food.actual = 60_000;
    d.sales = [e];
    const day = dayInputStatus(d, '2026-11-04');
    expect(day.slots.map((s) => s.state.kind)).toEqual(['missing']);
    const s = computeSummary(d, RANGE);
    expect(s.unrecordedDays).toContain('2026-11-04');
    expect(s.totalSales.value).toBe(200_000); // 미입력일을 추정 매출로 더하지 않음
    expect(s.status.estimatedAmount).toBe(0);
  });
  it('기록은 있는데 매출 금액이 비어 있으면 미확정이며 추정·계산 표시를 붙이지 않는다', () => {
    const d = store();
    const e = quick(d, { netInput: null });
    expect(e.costs.payment.estimated).toBeNull(); // 금액이 없으니 수수료도 계산하지 않음
    d.sales = [e];
    const s = computeSummary(d, RANGE);
    expect(s.totalSales).toMatchObject({ value: null, reason: 'incomplete' });
    expect(s.status.missing.some((m) => m.kind === 'sales')).toBe(true);
  });
});

describe('기존 기록: 근거가 불분명하면 단정하지 않는다', () => {
  it('근거 문구가 없거나 알아볼 수 없는 계산값은 추정(근거 불분명)으로 집계하고 금액은 그대로', () => {
    const blank = { actual: null, estimated: 12_000, estimateBasis: '' };
    const info = costBasisOf('packaging', blank);
    expect(info.kind).toBe('estimated');
    expect(costFlag(info)).toBe('추정 · 근거 불분명');
    expect(costDetailText(blank)).toBe(''); // 계산 내용이 없는 이전 값은 저장된 근거 문구 그대로(여기선 비어 있음)
    expect(costSourceOf('packaging', blank)).toBe('unknownBasis');
    expect(costBasisOf('otherDirect', { actual: null, estimated: 3_000, estimateBasis: '사장님 메모' }).method).toBe('unknown');
    // 수수료 칸이라는 이유만으로 설정 기준 계산으로 보지 않는다
    expect(costBasisOf('brokerage', { actual: null, estimated: 3_000, estimateBasis: '' }).kind).toBe('estimated');
    const d = store();
    const e = newSalesEntry({ date: '2026-11-03', channel: 'takeout', routeId: 'r_phone', orders: 10, amountMode: 'net', netInput: 200_000 });
    e.costs.food.actual = 60_000;
    e.costs.payment.estimated = 3_000;
    e.costs.packaging = blank;
    d.sales = [e];
    const s = computeSummary(d, RANGE);
    expect(s.status).toMatchObject({ actualAmount: 60_000, calculatedAmount: 0, estimatedAmount: 15_000 });
    expect(s.operatingProfit.value).toBe(200_000 - 75_000); // 저장된 금액 그대로
  });

  it('판매액 기준 이전 기록에서 할인·환불이 비어 있으면, 할인·환불이 반영되는 기준의 수수료는 추정으로 본다', () => {
    const legacy = newSalesEntry({ date: '2026-11-03', channel: 'takeout', routeId: 'r_phone', orders: 10, amountMode: 'gross', gross: 200_000, storeDiscount: null, refund: null });
    const old = { actual: null, estimated: 3_000, estimateBasis: '중개 0% · 결제 1.5% (2026-01-01 적용 규칙)' };
    const info = costBasisOf('payment', old, legacy);
    expect(info.kind).toBe('estimated');
    expect(info.assumption).toContain('0원으로 보고');
    // 판매액 기준 수수료는 할인·환불과 무관하므로 설정 기준 계산
    const grossOnly = { actual: null, estimated: 3_000, estimateBasis: '설정 기준 계산: 결제 수수료 1.5% × 할인·환불 전 판매액 200,000원 (2026-01-01부터 적용 설정)' };
    expect(costBasisOf('payment', grossOnly, legacy).kind).toBe('calculated');
    // 할인·환불을 모두 입력한 기록은 가정 없음
    expect(costBasisOf('payment', old, { ...legacy, storeDiscount: 0, refund: 0 }).kind).toBe('calculated');
  });
});

describe('가게 설정 원가율(직접 지정) 자동 적용', () => {
  const withMenus = (d: AppData) => {
    d.menus = [
      { id: 'm1', name: 'A', onSale: true, versions: [{ id: 'v1', effectiveFrom: '2026-01-01', prices: { hall: null, delivery: null, takeout: 10_000 }, costMode: 'rate', costRate: 50, costAmount: null, costSource: 'actual', note: '' }] },
    ];
    return d;
  };
  it('할인·환불을 알면 상품 판매액 × 설정 원가율로 채우고 메뉴 평균보다 우선한다', () => {
    const d = withMenus(store());
    d.foodCostRates = [
      { id: 'all', channel: null, rate: 30, effectiveFrom: '2026-01-01' },
      { id: 'to', channel: 'takeout', rate: 32, effectiveFrom: '2026-01-01' },
    ];
    const e = quick(d, { storeDiscount: 0, refund: 0 });
    expect(e.costs.food.estimated).toBe(64_000); // 판매 방식 지정 값(32%) 우선, 메뉴 평균(50%) 아님
    expect(e.costs.food.calc).toMatchObject({ method: 'foodRate', source: 'store', rate: 32, base: 200_000, baseKind: 'gross' });
    expect(costBasisOf('food', e.costs.food, e).kind).toBe('calculated');
    expect(costDetailText(e.costs.food)).toBe('상품 판매액 200,000원 × 원가율 32%');
    // 근거 문구는 이전 판별 규칙으로도 같은 출처(직접 지정한 원가율)로 읽힌다
    expect(costBasisOf('food', { ...e.costs.food, calc: undefined }, e).kind).toBe('calculated');
    d.sales = [e];
    expect(entryStatus(e, d).status).toBe('calculated');
  });
  it('할인·환불을 모르면 순매출로 대신 계산하므로 추정', () => {
    const d = store();
    d.foodCostRates = [{ id: 'all', channel: null, rate: 30, effectiveFrom: '2026-01-01' }];
    const e = quick(d);
    expect(e.costs.food.estimated).toBe(60_000);
    const info = costBasisOf('food', e.costs.food, e);
    expect(info.kind).toBe('estimated');
    expect(costFlag(info)).toBe('추정');
    expect(info.assumption).toContain('순매출');
  });
  it('설정이 없으면 메뉴 평균 원가율로 채우고 추정으로 표시한다', () => {
    const d = withMenus(store());
    const e = quick(d, { storeDiscount: 0, refund: 0 });
    expect(e.costs.food.calc).toMatchObject({ method: 'foodRate', source: 'menuAverage' });
    expect(costFlag(costBasisOf('food', e.costs.food, e))).toBe('추정');
  });
});

describe('빠른 입력 미리보기 = 저장 값 = 대시보드 합계', () => {
  it('미리보기 금액은 저장되는 계산값과 같고, 대시보드 비용 구성에 같은 금액이 들어간다', () => {
    const d = store();
    const e = newSalesEntry({ date: '2026-11-03', channel: 'takeout', routeId: 'r_phone', paymentMethodId: 'pay_card', orders: 10, amountMode: 'net', netInput: 200_000 });
    const lines = autoCostPreview(e, d);
    expect(lines.map((l) => [l.label, l.amount, l.state, l.detail])).toEqual([
      ['결제 수수료', 3_000, 'ok', '매출 금액(순매출) 200,000원 × 1.5%'],
      ['포장비', 5_000, 'ok', '건당 500원 × 10건'],
    ]);
    const saved = fillEstimates(e, d).entry;
    for (const l of lines) expect(saved.costs[l.category].estimated).toBe(l.amount);
    saved.costs.food.actual = 60_000;
    d.sales = [saved];
    const s = computeSummary(d, RANGE);
    expect(s.costBreakdown.find((r) => r.category === 'packaging')!.total).toBe(5_000);
    expect(s.costBreakdown.find((r) => r.category === 'payment')!.total).toBe(3_000);
  });
  it('주문 수가 없으면 포장비는 계산하지 않고 "주문 수를 입력해 주세요"', () => {
    const d = store();
    const e = newSalesEntry({ date: '2026-11-03', channel: 'takeout', routeId: 'r_phone', paymentMethodId: 'pay_card', orders: null, amountMode: 'net', netInput: 200_000 });
    const pack = autoCostPreview(e, d).find((l) => l.category === 'packaging')!;
    expect(pack).toMatchObject({ state: 'needsInput', amount: null, prompt: '주문 수를 입력해 주세요' });
    expect(fillEstimates(e, d).entry.costs.packaging.estimated).toBeNull();
  });
});

describe('설정을 바꿔도 저장된 기록은 그대로', () => {
  it('건당 포장비를 바꿔도 저장된 금액·근거·계산 내용이 유지되고, 입력값을 고칠 때만 지금 설정으로 다시 계산한다', () => {
    const d = store();
    const saved = quick(d);
    const before = structuredClone(saved.costs.packaging);
    d.sales = [saved];
    d.perOrderCosts = [{ ...d.perOrderCosts[0], amount: 700 }];
    // 그대로 둔 기록: 합계도 저장 당시 금액(5,000원)
    expect(d.sales[0].costs.packaging).toEqual(before);
    saved.costs.food.actual = 60_000;
    expect(computeSummary(d, RANGE).costBreakdown.find((r) => r.category === 'packaging')!.total).toBe(5_000);
    expect(costDetailText(d.sales[0].costs.packaging)).toBe('건당 500원 × 10건');
    // 주문 수를 고치면(상세 화면의 recalcAuto) 지금 설정으로 다시 계산
    const edited = recalcAuto({ ...saved, orders: 12 }, d).entry;
    expect(edited.costs.packaging.estimated).toBe(8_400);
    expect(costDetailText(edited.costs.packaging)).toBe('건당 700원 × 12건');
  });
  it('기록에서 직접 고른 원가율은 입력값을 고쳐도 같은 원가율로, 가게 설정 원가율은 지금 설정으로 다시 계산한다', () => {
    const d = store();
    d.foodCostRates = [{ id: 'all', channel: null, rate: 30, effectiveFrom: '2026-01-01' }];
    const e = quick(d, { storeDiscount: 0, refund: 0 });
    d.foodCostRates = [{ id: 'all', channel: null, rate: 40, effectiveFrom: '2026-01-01' }];
    expect(recalcAuto({ ...e, netInput: 100_000 }, d).entry.costs.food.estimated).toBe(40_000);
    const manual = { ...e, costs: { ...e.costs, food: { actual: null, estimated: 70_000, estimateBasis: '직접 지정 원가율 35% × 상품 판매액' } } };
    const r = recalcAuto({ ...manual, netInput: 100_000 }, d).entry.costs.food;
    expect(r.estimated).toBe(35_000);
    expect(r.calc).toMatchObject({ source: 'entry', rate: 35 });
  });
});

describe('v6 → v7 변환', () => {
  it('기존 비용 값(금액·근거 문구)은 그대로 두고 원가율 설정 목록만 추가한다', () => {
    const d = store();
    const e = newSalesEntry({ date: '2026-11-03', channel: 'takeout', routeId: 'r_phone', orders: 10, amountMode: 'net', netInput: 200_000 });
    e.costs.packaging = { actual: null, estimated: 5_000, estimateBasis: '가게 설정 기본값: 주문 1건당 500원 × 10건 (2026-01-01부터 적용)' };
    e.costs.food = { actual: null, estimated: 12_000, estimateBasis: '' };
    d.sales = [e];
    const v6: Record<string, unknown> = { ...structuredClone(d), schemaVersion: 6 };
    delete v6.foodCostRates;
    const out = migrate(v6, 6) as AppData;
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.foodCostRates).toEqual([]);
    expect(out.sales[0].costs).toEqual(e.costs);
    expect(validateData(out)).toBeNull();
    // 계산 내용이 없는 이전 값: 판별은 근거 문구로, 상세에는 저장된 근거 문구 그대로
    expect(costBasisOf('packaging', out.sales[0].costs.packaging, out.sales[0]).kind).toBe('calculated');
    expect(costDetailText(out.sales[0].costs.packaging)).toBe('가게 설정 기본값: 주문 1건당 500원 × 10건 (2026-01-01부터 적용)');
    expect(costFlag(costBasisOf('food', out.sales[0].costs.food))).toBe('추정 · 근거 불분명');
    const env = JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 6, exportedAt: '', data: v6 });
    expect(parseBackup(env).ok).toBe(true);
  });
});