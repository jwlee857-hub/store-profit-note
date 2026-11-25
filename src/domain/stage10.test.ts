// 7차 점검: 정산 표 검증 · 이전 정산 형식 복원 · 조기 종료 기간. 격리된 내장 샘플(가상 데이터)만 사용한다.
import { describe, expect, it } from 'vitest';
import { parseBackup, serialize } from '../storage/storage';
import { computeSummary, netSales } from './calc';
import { rangeProblem } from './periods';
import { scopeToRoute } from './review';
import { STORY, storySample } from './sample';
import { applySettlementEdits, editOf, validateSettlementEdits } from './settlement';
import type { AppData, DateRange, PeriodCost } from './types';

const isA = (e: { routeId: string; channel: string }) => e.routeId === 'route_app_a' && e.channel === 'delivery';
const nov9 = (d: AppData) => d.sales.find((e) => e.date === '2026-11-09' && isA(e))!;

describe('1. 정산 표: 판매액을 넘는 할인·환불은 저장하지 않는다', () => {
  it('11월 9일 판매액 582,000원 기록에 할인 10,000,000원 → 그 행에 오류, 저장 전에 막는다', () => {
    const d = storySample();
    const e = nov9(d);
    expect([e.gross, e.storeDiscount, e.refund, netSales(e)]).toEqual([582_000, 52_500, 0, 529_500]);
    const bad = { ...editOf(e), storeDiscount: 10_000_000 };
    const ok = { ...editOf(d.sales.find((x) => x.date === '2026-11-10' && isA(x))!), storeDiscount: 1_000 };
    const errors = validateSettlementEdits(d, [ok, bad]);
    expect(errors).toEqual({ [e.id]: '할인·환불 합계가 판매액 582,000원을 초과합니다. 이미 반영된 금액을 다시 넣지 않았는지 확인하세요.' });
  });
  it('순매출 직접 입력 기록은 기존 규칙대로: 할인 상세를 나중에 넣어도 순매출에서 다시 빼지 않고 오류도 아니다', () => {
    const d = storySample();
    const e = nov9(d);
    Object.assign(e, { amountMode: 'net', netInput: 529_500, gross: null, storeDiscount: null, refund: null });
    const edit = { ...editOf(e), storeDiscount: 52_500, refund: 0 };
    expect(validateSettlementEdits(d, [edit])).toEqual({});
    expect(netSales(applySettlementEdits(d, [edit]).find((x) => x.id === e.id)!)).toBe(529_500);
  });
});

describe('2. 이전 정산 형식(잔여액 저장)과 현재 형식(총액 저장) 구별', () => {
  const WEEK: DateRange = { start: '2026-10-01', end: '2026-10-07' };
  /** 10월 1~7일 배달앱 A: 1일만 일별 실제 수수료 10,000원, 나머지는 정산 전 */
  const base = () => {
    const d = storySample();
    for (const e of d.sales)
      if (isA(e) && e.date >= WEEK.start && e.date <= WEEK.end)
        for (const c of ['brokerage', 'payment'] as const)
          e.costs[c] = e.date === WEEK.start ? { actual: c === 'brokerage' ? 10_000 : 0, estimated: null, estimateBasis: '' } : { actual: null, estimated: 5_000, estimateBasis: '설정 기준 계산: 테스트' };
    return d;
  };
  const pc = (amount: number, memo: string, extra: Partial<PeriodCost> = {}): PeriodCost => ({ id: 'pc_settle', category: 'brokerage', attribution: 'delivery', nature: 'variable', ...WEEK, amount, source: 'actual', memo, routeId: 'route_app_a', ...extra });
  /** 이전 버전(v8)으로 저장된 백업 JSON */
  const v8 = (d: AppData) => {
    const { settlementBasis: _s, ...rest } = d.periodCosts[d.periodCosts.length - 1] as PeriodCost & { settlementBasis?: string };
    d.periodCosts[d.periodCosts.length - 1] = rest;
    return JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 8, exportedAt: '2026-11-23T00:00:00.000Z', data: { ...d, schemaVersion: 8 } });
  };
  const feeA = (d: AppData) => {
    const c = computeSummary(scopeToRoute(d, 'delivery', 'route_app_a'), WEEK).channels.delivery.directByCategory;
    return [c.brokerage, c.payment].reduce((t, x) => t + x.actual + x.calculated + x.estimated, 0);
  };
  const restore = (json: string) => {
    const p = parseBackup(json);
    if (!p.ok) throw new Error(p.error);
    return p.data;
  };
  const LEGACY_MEMO = '배달앱 정산서 기간 합계 70,000원 (중개·결제 수수료) − 일별 실제액 1건 10,000원';
  const CURRENT_MEMO = '배달앱 정산서 기간 합계 (중개·결제 수수료)';

  it('이전 형식(잔여액 60,000원 + 일별 10,000원) 복원: 총액 70,000원으로 바꿔 최종 수수료 70,000원', () => {
    const d = base();
    d.periodCosts.push(pc(60_000, LEGACY_MEMO));
    const r = restore(v8(d));
    const s = r.periodCosts.find((p) => p.routeId)!;
    expect(s).toMatchObject({ amount: 70_000, settlementBasis: 'total' });
    expect(feeA(r)).toBe(70_000);
  });
  it('현재 형식(총액 70,000원) 복원: 일별 수수료를 다시 더하지 않고 70,000원', () => {
    const d = base();
    d.periodCosts.push(pc(70_000, CURRENT_MEMO));
    const r = restore(v8(d));
    expect(r.periodCosts.find((p) => p.routeId)).toMatchObject({ amount: 70_000, settlementBasis: 'total' });
    expect(feeA(r)).toBe(70_000);
  });
  it('변환 뒤 다시 백업·복원을 반복해도 수수료 70,000원, 영업이익 그대로', () => {
    const d = base();
    d.periodCosts.push(pc(60_000, LEGACY_MEMO));
    let r = restore(v8(d));
    const op = JSON.stringify(computeSummary(r, STORY.oct).operatingProfit);
    for (let i = 0; i < 3; i++) r = restore(serialize(r));
    expect(feeA(r)).toBe(70_000);
    expect(JSON.stringify(computeSummary(r, STORY.oct).operatingProfit)).toBe(op);
  });
  it('판별 근거가 부족하면(메모를 고침 + 일별 실제액 있음) 원본을 보존하고 확인 필요로 표시 — 이전 방식대로 일별 실제액을 더해 70,000원', () => {
    const d = base();
    d.periodCosts.push(pc(60_000, '정산서'));
    const r = restore(v8(d));
    expect(r.periodCosts.find((p) => p.routeId)).toMatchObject({ amount: 60_000, memo: '정산서', settlementBasis: 'unverified' });
    expect(feeA(r)).toBe(70_000);
  });
  it('일별 실제액이 없으면 두 해석의 결과가 같아 총액으로 확정한다', () => {
    const d = base();
    for (const e of d.sales) if (isA(e) && e.date === WEEK.start) for (const c of ['brokerage', 'payment'] as const) e.costs[c] = { actual: null, estimated: 5_000, estimateBasis: '설정 기준 계산: 테스트' };
    d.periodCosts.push(pc(70_000, '정산서'));
    const r = restore(v8(d));
    expect(r.periodCosts.find((p) => p.routeId)).toMatchObject({ amount: 70_000, settlementBasis: 'total' });
    expect(feeA(r)).toBe(70_000);
  });
  it('기본 샘플의 9월 → 10월 순매출·영업이익은 그대로', () => {
    const d = storySample();
    expect([computeSummary(d, STORY.sep).totalSales.value, computeSummary(d, STORY.oct).totalSales.value]).toEqual([42_527_200, 46_123_000]);
    expect([computeSummary(d, STORY.sep).operatingProfit.value, computeSummary(d, STORY.oct).operatingProfit.value].map((x) => Math.round(x!))).toEqual([4_994_423, 7_950_942]);
  });
});

describe('3. 조기 종료일과 성과 집계 종료일', () => {
  it('실행 후 기간이 실제 종료일(11월 10일)을 넘으면 저장하지 않는다', () => {
    expect(rangeProblem(STORY.oct, { start: '2026-11-01', end: '2026-11-21' }, '2026-11-10')).toBe('실행 후 기간(11월 1~21일)이 실제 종료일(11월 10일)을 넘어요. 실행 후 기간을 11월 10일까지로 지정하세요.');
    expect(rangeProblem(STORY.oct, { start: '2026-11-01', end: '2026-11-10' }, '2026-11-10')).toBeNull();
  });
});
