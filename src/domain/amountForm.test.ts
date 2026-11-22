import { describe, expect, it } from 'vitest';
import { parseBackup } from '../storage/storage';
import { amountFieldsFromForm, applyHelper, computeHelper, formFromEntry, helperChanges, helperPrefill, restoredGross } from './amountForm';
import { computeSummary, netSales } from './calc';
import { autoCalcSummary, costSourceOf, entryStatus, estimateInputsKey, feeCalcFor, fillEstimates, recalcAuto, refreshEstimates } from './entry';
import { CASH_FEE_BASIS } from './estimate';
import { addDays } from './dates';
import { newSalesEntry } from './factory';
import { recentRanges } from './periods';
import { generateSample } from './sample';
import { SCHEMA_VERSION, type SalesEntry } from './types';

const sample = () => generateSample('2026-11-15');
const entryWith = (patch: Partial<SalesEntry>) => ({ ...newSalesEntry({ date: '2026-11-18', channel: 'hall', routeId: 'route_hall', amountMode: 'net' }), ...patch });

describe('매출 금액 하나로 입력', () => {
  it('순매출 85,000원 직접 입력', () => {
    const blank = formFromEntry(entryWith({}));
    const f = amountFieldsFromForm(entryWith({}), blank, { net: 85000, discount: null, refund: null });
    expect(netSales(f)).toBe(85000);
    expect(f.storeDiscount).toBeNull(); // 모르는 할인을 0으로 확정하지 않음
    expect(f.refund).toBeNull();
  });

  it('도우미: 판매액 100,000 · 할인 10,000 · 환불 5,000 → 85,000 (직접 입력과 같은 순매출)', () => {
    const r = applyHelper({ gross: 100000, discount: 10000, refund: 5000 })!;
    expect(r.form).toEqual({ net: 85000, discount: 10000, refund: 5000 });
    expect(r.message).toBe('계산한 매출 85,000원을 적용했어요');
    const f = amountFieldsFromForm(entryWith({}), formFromEntry(entryWith({})), r.form);
    expect(netSales(f)).toBe(85000); // 할인·환불을 다시 빼지 않음
    expect(restoredGross(r.form)).toBe(100000);
  });

  it('도우미를 다시 열면 서로 맞는 값을 보여주고, 다시 적용해도 중복 차감하지 않는다', () => {
    const first = applyHelper({ gross: 100000, discount: 10000, refund: 5000 })!.form;
    const pre = helperPrefill(first);
    expect(pre).toEqual({ gross: 100000, discount: 10000, refund: 5000 });
    const again = applyHelper(pre)!.form;
    expect(again).toEqual(first);
    expect(helperChanges(first, pre, 85000)).toEqual([]); // 바뀌는 것 없음
  });

  it('기존 값이 있으면 도우미 적용 전 바뀌는 범위를 알려준다', () => {
    const changes = helperChanges({ net: 120000, discount: 3000, refund: null }, { gross: 100000, discount: 10000, refund: 5000 }, 85000);
    expect(changes).toEqual([
      { label: '매출 금액', from: '120,000원', to: '85,000원' },
      { label: '가게 부담 할인액', from: '3,000원', to: '10,000원' },
    ]);
  });

  it('도우미 입력 검증: 누락·음수·초과는 적용하지 않는다 (모르는 값을 0으로 두지 않음)', () => {
    const missing = computeHelper({ gross: 100000, discount: null, refund: 0 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.discount).toContain('없음');
    expect(computeHelper({ gross: null, discount: 0, refund: 0 }).ok).toBe(false);
    expect(computeHelper({ gross: 100000, discount: -1, refund: 0 }).ok).toBe(false);
    const over = computeHelper({ gross: 10000, discount: 8000, refund: 5000 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.discount).toContain('판매액');
    expect(computeHelper({ gross: 50000, discount: 0, refund: 0 })).toEqual({ ok: true, net: 50000 });
    expect(applyHelper({ gross: 100000, discount: null, refund: 0 })).toBeNull();
  });

  it('상세(할인·환불)만 고쳐도 매출 금액은 그대로이고, 판매액 복원 값만 달라진다', () => {
    const base = { net: 85000, discount: 10000, refund: 5000 };
    const edited = { ...base, discount: 12000 };
    const f = amountFieldsFromForm(entryWith({}), base, edited);
    expect(netSales(f)).toBe(85000);
    expect(restoredGross(edited)).toBe(102000);
  });

  it('0과 미입력을 구분한다', () => {
    const zero = { net: 85000, discount: 0, refund: 0 };
    const unknown = { net: 85000, discount: null, refund: null };
    expect(restoredGross(zero)).toBe(85000);
    expect(restoredGross(unknown)).toBeNull(); // 상세를 모르면 판매액 복원 안 함
    const f = amountFieldsFromForm(entryWith({}), formFromEntry(entryWith({})), unknown);
    expect(f.storeDiscount).toBeNull();
    expect(amountFieldsFromForm(entryWith({}), formFromEntry(entryWith({})), zero).storeDiscount).toBe(0);
  });
});

describe('기존 기록 보존', () => {
  it('판매액 기준 기록: 매출 금액에는 계산된 순매출을 보여주고, 고치지 않고 저장하면 원래 필드를 그대로 둔다', () => {
    const g = entryWith({ amountMode: 'gross', gross: 100000, netInput: null, storeDiscount: 10000, refund: 5000 });
    const shown = formFromEntry(g);
    expect(shown).toEqual({ net: 85000, discount: 10000, refund: 5000 });
    const kept = amountFieldsFromForm(g, shown, { ...shown });
    expect(kept).toEqual({ amountMode: 'gross', gross: 100000, netInput: null, storeDiscount: 10000, refund: 5000 });
  });

  it('판매액 기준 기록의 매출 금액을 고치면 순매출 기준으로 저장하고 상세는 남긴다 (판매액=순매출·할인=0 일괄 변환 없음)', () => {
    const g = entryWith({ amountMode: 'gross', gross: 100000, netInput: null, storeDiscount: 10000, refund: 5000 });
    const shown = formFromEntry(g);
    const f = amountFieldsFromForm(g, shown, { ...shown, net: 90000 });
    expect(f).toEqual({ amountMode: 'net', gross: null, netInput: 90000, storeDiscount: 10000, refund: 5000 });
  });

  it('샘플의 모든 기록을 화면 값으로 열었다가 그대로 저장해도 기간 합계가 같다', () => {
    const data = sample();
    const range = recentRanges(data).cur;
    const before = computeSummary(data, range);
    const resaved = {
      ...data,
      sales: data.sales.map((e) => {
        const shown = formFromEntry(e);
        return { ...e, ...amountFieldsFromForm(e, shown, { ...shown }) };
      }),
    };
    expect(resaved.sales).toEqual(data.sales);
    const after = computeSummary(resaved, range);
    expect(after.totalSales.value).toBe(before.totalSales.value);
    expect(after.operatingProfit.value).toBe(before.operatingProfit.value);
  });

  it('이전 버전 백업(v3, 판매액 기준 기록 포함)을 열 수 있고 합계가 같다', () => {
    const data = sample();
    const backup = JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 3, exportedAt: '2026-11-15T00:00:00.000Z', data: { ...data, schemaVersion: 3, perOrderCosts: undefined } });
    const parsed = parseBackup(backup);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.sales.some((e) => e.amountMode === 'gross')).toBe(true);
    const r = recentRanges(data).cur;
    expect(computeSummary(parsed.data, r).totalSales.value).toBe(computeSummary(data, r).totalSales.value);
  });
});

describe('수수료 자동 계산', () => {
  // 샘플 설정: 홀 결제 1.5%(순매출), 배달앱 A 중개 7%→(분석 기간부터) 9% · 결제 3% (할인 후·환불 전, 부가세 별도),
  // 배달앱 B 묶음 11%(할인 전 판매액) + 건당 300원(부가세 별도)
  const data = sample();
  const cardId = data.paymentMethods.find((p) => p.name.includes('카드'))!.id;
  const cashId = data.paymentMethods.find((p) => p.name.includes('현금'))!.id;
  const appA = (patch: Partial<SalesEntry>) => entryWith({ channel: 'delivery', routeId: 'route_app_a', netInput: 700000, orders: 36, ...patch });

  it('설정된 수수료는 체크나 버튼 없이 저장할 때 적용된다 (순매출 기준은 상세 없이 계산)', () => {
    const r = fillEstimates(entryWith({ netInput: 300000, orders: 15, paymentMethodId: cardId }), data);
    expect(r.entry.costs.payment.estimated).toBe(4500); // 300,000 × 1.5%
    expect(r.entry.costs.payment.estimateBasis).toContain('설정 기준 계산');
    expect(r.entry.costs.payment.estimateBasis).toMatch(/부터 적용 설정/); // 적용한 설정을 근거로 남김
    expect(r.needsInfo).toEqual([]);
  });

  it('날짜에 맞는 설정을 고른다 (적용 시작일 이전·이후 요율이 다름)', () => {
    const rules = data.feeRules.filter((f) => f.routeId === 'route_app_a').sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const before = feeCalcFor(appA({ date: addDays(rules[1].effectiveFrom, -1), refund: 0 }), data)!;
    const after = feeCalcFor(appA({ date: rules[1].effectiveFrom, refund: 0 }), data)!;
    expect(before.items[0].rate).toBe(7);
    expect(after.items[0].rate).toBe(9);
  });

  it('결제수단별: 현금은 적용 안 함, 카드는 전체, 섞임·모름은 카드 결제액이 있어야 계산 (전체를 카드로 보지 않음)', () => {
    const cash = fillEstimates(entryWith({ netInput: 300000, orders: 15, paymentMethodId: cashId }), data);
    expect(cash.entry.costs.payment.estimated).toBe(0);
    expect(cash.entry.costs.payment.estimateBasis).toBe(CASH_FEE_BASIS);
    const mixed = fillEstimates(entryWith({ netInput: 300000, orders: 15, paymentMethodId: null }), data);
    expect(mixed.entry.costs.payment.estimated).toBeNull(); // 0원 아님, 계산 불가
    expect(mixed.needsInfo).toEqual(['결제 수수료']);
    expect(autoCalcSummary(entryWith({ netInput: 300000, orders: 15 }), data).needs).toEqual([{ need: 'cardSales', labels: ['결제 수수료'] }]);
    const split = fillEstimates(entryWith({ netInput: 300000, orders: 15, paymentMethodId: null, cardSales: 200000 }), data);
    expect(split.entry.costs.payment.estimated).toBe(3000); // 카드 결제분 200,000 × 1.5%
  });

  it('플랫폼 결제 경로는 결제수단을 묻지 않고 규칙 기준금액 전체에 적용한다', () => {
    const s = autoCalcSummary(appA({ refund: 0 }), data);
    expect(s.needs).toEqual([]);
    const pay = s.fee!.items.find((i) => i.category === 'payment')!;
    expect(pay.amount).toBe(Math.round(700000 * 0.03 * 1.1));
  });

  it('기준금액에 필요한 정보만 요구한다: 할인 후·환불 전 기준은 환불액만, 할인 전 기준은 할인·환불 모두', () => {
    // 배달앱 A(할인 후·환불 전): 환불을 모르면 계산 불가, 할인은 몰라도 됨
    const a = autoCalcSummary(appA({}), data);
    expect(a.needs).toEqual([{ need: 'refund', labels: ['중개 수수료', '결제 수수료'] }]);
    expect(autoCalcSummary(appA({ refund: 0 }), data).needs).toEqual([]);
    // 배달앱 B(묶음, 할인 전 판매액): 할인·환불 모두 필요
    const b = (patch: Partial<SalesEntry>) => entryWith({ channel: 'delivery', routeId: 'route_app_b', netInput: 400000, orders: 20, ...patch });
    expect(autoCalcSummary(b({ refund: 0 }), data).needs).toEqual([{ need: 'discountRefund', labels: ['묶음 수수료'] }]);
    const ok = feeCalcFor(b({ storeDiscount: 10000, refund: 0 }), data)!;
    expect(ok.bundled).toBe(true);
    expect(ok.items).toHaveLength(1); // 묶음이면 결제 수수료를 따로 계산하지 않음
    expect(ok.items[0].amount).toBe(Math.round((410000 * 0.11 + 300 * 20) * 1.1));
  });

  it('기준금액이 없으면 0원이 아니라 계산 불가로 남고, 다른 항목과 저장은 막지 않는다', () => {
    const r = fillEstimates(appA({}), data);
    expect(r.entry.costs.brokerage.estimated).toBeNull();
    expect(r.entry.costs.payment.estimated).toBeNull();
    expect(r.entry.costs.delivery.estimated).toBe(3300 * 36); // 건당 기준 비용은 계산
    expect(r.needsInfo).toEqual(['중개 수수료', '결제 수수료']);
    expect(costSourceOf('brokerage', r.entry.costs.brokerage, true)).toBe('needsInfo');
  });

  it('매출이 바뀌면 계산액을 갱신하고, 정산 확인액(실제)은 덮어쓰지 않으며 두 값을 더하지 않는다', () => {
    const saved = fillEstimates(appA({ refund: 0 }), data).entry;
    const settled = { ...saved, costs: { ...saved.costs, payment: { ...saved.costs.payment, actual: 25000 } } };
    const changed = { ...settled, netInput: 800000, orders: 40 };
    expect(estimateInputsKey(changed)).not.toBe(estimateInputsKey(settled));
    const r = recalcAuto(changed, data);
    expect(r.entry.costs.brokerage.estimated).toBeGreaterThan(saved.costs.brokerage.estimated!);
    expect(r.entry.costs.delivery.estimated).toBe(3300 * 40);
    expect(r.entry.costs.payment.actual).toBe(25000);
    expect(costSourceOf('payment', r.entry.costs.payment)).toBe('settled');
    expect(entryStatus(r.entry, data).knownCost).toBe(
      (Object.keys(r.entry.costs) as (keyof typeof r.entry.costs)[]).reduce((s, c) => s + (r.entry.costs[c].actual ?? r.entry.costs[c].estimated ?? 0), 0),
    );
  });

  it('비용 출처를 구분한다: 설정 기준 계산액 · 건당 기준 계산액 · 참고 추정 · 미입력', () => {
    const r = fillEstimates(appA({ refund: 0 }), data).entry;
    expect(costSourceOf('brokerage', r.costs.brokerage)).toBe('feeCalc');
    expect(costSourceOf('delivery', r.costs.delivery)).toBe('perOrderCalc');
    if (r.costs.food.estimated !== null) expect(costSourceOf('food', r.costs.food)).toBe('reference');
    expect(costSourceOf('channelAd', r.costs.channelAd)).toBe('missing');
  });

  it('설정이 없으면 수수료만 계산하지 않는다 (임의 요율·0원 없음)', () => {
    const none = { ...data, feeRules: [] };
    const r = fillEstimates(entryWith({ netInput: 300000, orders: 15 }), none);
    expect(r.entry.costs.payment.estimated).toBeNull();
    expect(autoCalcSummary(entryWith({ netInput: 300000, orders: 15 }), none).fee).toBeNull();
  });

  it('설정을 바꿔도 이미 저장된 기록의 계산값은 그대로다 (조용한 재계산 없음)', () => {
    const before = computeSummary(data, recentRanges(data).cur).operatingProfit.value;
    const changed = { ...data, feeRules: data.feeRules.map((f) => ({ ...f, paymentRate: f.paymentRate === null ? null : f.paymentRate + 5 })) };
    expect(computeSummary(changed, recentRanges(data).cur).operatingProfit.value).toBe(before);
  });

  it('직접 지정한 원가율 추정은 같은 원가율로 다시 계산하고, 근거가 사라진 계산값은 지운다', () => {
    const d2 = { ...data, feeRules: [], perOrderCosts: [] };
    const e = entryWith({ netInput: 100000, orders: 5 });
    const manual = { ...e, costs: { ...e.costs, food: { actual: null, estimated: 35000, estimateBasis: '직접 지정 원가율 35% (추정) × 순매출 (할인·환불 상세가 없어 실제보다 낮게 추정될 수 있음)' }, hallSupplies: { actual: null, estimated: 999, estimateBasis: '가게 설정 기본값: 주문 1건당 …' } } };
    const r = refreshEstimates({ ...manual, netInput: 200000 }, d2);
    expect(r.entry.costs.food.estimated).toBe(70000);
    expect(r.entry.costs.hallSupplies.estimated).toBeNull();
    expect(r.removed).toContain('홀 전용 소모품비');
  });
});

describe('스키마 v5: 카드 결제액 추가', () => {
  it('v4 백업을 열면 카드 결제액은 모름(null)으로 채우고 금액·비용·합계는 그대로다', () => {
    const d = sample();
    const v4 = { ...d, schemaVersion: 4, sales: d.sales.map(({ cardSales: _c, ...s }) => s) };
    const parsed = parseBackup(JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 4, exportedAt: '2026-11-15T00:00:00.000Z', data: v4 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.schemaVersion).toBe(SCHEMA_VERSION); // v4 → v5 → 현재 버전까지 차례로 변환
    expect(parsed.data.sales.every((s) => s.cardSales === null)).toBe(true);
    expect(parsed.data.sales.map((s) => s.costs)).toEqual(d.sales.map((s) => s.costs));
    const r = recentRanges(d).cur;
    expect(computeSummary(parsed.data, r).operatingProfit.value).toBe(computeSummary(d, r).operatingProfit.value);
  });
  it('형식이 잘못된 카드 결제액은 거부한다 (원본은 보존 로직이 처리)', () => {
    const d = sample();
    const bad = { ...d, sales: d.sales.map((s, i) => (i === 0 ? { ...s, cardSales: '많음' } : s)) };
    expect(parseBackup(JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 5, exportedAt: 'x', data: bad })).ok).toBe(false);
  });
});
