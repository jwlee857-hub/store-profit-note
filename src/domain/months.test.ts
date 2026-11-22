// 3차 개선 2단계: 기간별 비용 월 단위 보기. 격리된 샘플 데이터만 사용한다.
import { describe, expect, it } from 'vitest';
import { allocatePeriodCost, computeSummary } from './calc';
import { copyFromPrevMonth, isMonthKey, monthCosts, monthLabel, monthRangeOf, rowChanged, shiftMonth, wonShort } from './months';
import { generateSample } from './sample';
import { parseBackup, serialize } from '../storage/storage';
import type { PeriodCost } from './types';

const sample = () => generateSample('2026-11-15');

describe('월 비용 금액 표기', () => {
  it('만 원 단위로 떨어지거나 10만 원 이상이면 만 원, 그 밖은 원', () => {
    expect(wonShort(50_000, true)).toBe('+5만 원');
    expect(wonShort(15_110_000)).toBe('1,511만 원');
    expect(wonShort(-650_000, true)).toBe('−65만 원');
    expect(wonShort(12_345, true)).toBe('+12,345원');
    expect(wonShort(0)).toBe('0원');
  });
});

describe('달 이동', () => {
  it('이전·다음 달, 연도 넘김, 달 범위', () => {
    expect(shiftMonth('2026-11', -1)).toBe('2026-10');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthRangeOf('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthLabel('2026-11')).toBe('2026년 11월');
    expect(isMonthKey('2026-11')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('abc')).toBe(false);
  });
});

describe('그 달의 기간별 비용', () => {
  it('샘플 11월: 9줄, 합계 1,511만 원, 지난달보다 +5만 원, 공과금만 바뀜(65만 → 70만 원)', () => {
    const mc = monthCosts(sample().periodCosts, '2026-11');
    expect(mc.rows).toHaveLength(9);
    expect(mc.total).toBe(15_110_000);
    expect(mc.prevTotal).toBe(15_060_000);
    const changed = mc.rows.filter(rowChanged);
    expect(changed.map((r) => r.label)).toEqual(['공과금']);
    expect(changed[0]).toMatchObject({ amount: 700_000, prevAmount: 650_000, estimated: true });
    expect(mc.rows.find((r) => r.attribution === 'delivery')!.label).toBe('광고비 · 배달 전용');
    expect(mc.rows.every((r) => !r.spansMonths)).toBe(true);
  });
  it('10월은 10월 기록만 (11월 줄과 섞이지 않음)', () => {
    const mc = monthCosts(sample().periodCosts, '2026-10');
    expect(mc.rows).toHaveLength(9);
    expect(mc.rows.every((r) => r.records.every((x) => x.cost.start === '2026-10-01'))).toBe(true);
  });
  it('여러 달에 걸친 비용은 걸친 달마다 날짜 수만큼 나눈 금액 + 표시 (계산 방식은 그대로)', () => {
    const costs = sample().periodCosts;
    const pc: PeriodCost = { id: 'x', category: 'insurance', attribution: 'common', nature: 'fixed', start: '2026-11-15', end: '2027-01-14', amount: 610_000, source: 'actual', memo: '' };
    costs.push(pc);
    const nov = monthCosts(costs, '2026-11').rows.find((r) => r.category === 'insurance')!;
    expect(nov.spansMonths).toBe(true);
    expect(nov.records.find((x) => x.cost.id === 'x')!.amount).toBeCloseTo(160_000); // 16일/61일
    expect(nov.records.find((x) => x.cost.id === 'x')!.amount).toBe(allocatePeriodCost(pc, monthRangeOf('2026-11')));
    const dec = monthCosts(costs, '2026-12').rows.find((r) => r.category === 'insurance')!;
    expect(dec.amount).toBeCloseTo(310_000); // 31일
    expect(dec.prevAmount).toBeCloseTo(90_000 + 160_000);
  });
  it('지난달에만 있던 항목은 따로 알려준다', () => {
    const costs = sample().periodCosts.filter((p) => !(p.category === 'insurance' && p.start === '2026-11-01'));
    expect(monthCosts(costs, '2026-11').goneRows.map((g) => g.label)).toEqual(['보험료']);
  });
});

describe('지난달 비용 그대로 가져오기', () => {
  it('비용이 없는 12월: 11월 항목 9개를 12월 기간으로 복사, 추정으로 표시', () => {
    const d = sample();
    expect(monthCosts(d.periodCosts, '2026-12').rows).toHaveLength(0);
    let n = 0;
    const items = copyFromPrevMonth(d.periodCosts, '2026-12', () => `c${++n}`);
    expect(items).toHaveLength(9);
    expect(items.every((x) => x.start === '2026-12-01' && x.end === '2026-12-31' && x.source === 'estimated')).toBe(true);
    expect(items.find((x) => x.category === 'rent')!.amount).toBe(2_500_000);
    expect(items.find((x) => x.category === 'utilities')!.memo).toBe('지난달에서 복사 · 고지서 도착 전 추정');
    d.periodCosts.push(...items);
    const dec = monthCosts(d.periodCosts, '2026-12');
    expect(dec.total).toBe(15_110_000);
    expect(dec.rows.every((r) => r.estimated)).toBe(true);
    // 복사한 비용은 기존 계산(날짜 수만큼 나눔)에 그대로 반영된다
    expect(computeSummary(d, { start: '2026-12-01', end: '2026-12-31' }).commonCost.estimated).toBeGreaterThan(0);
    // 다시 복사해도 메모가 겹치지 않는다
    const again = copyFromPrevMonth(d.periodCosts, '2027-01', () => 'z');
    expect(again.find((x) => x.category === 'utilities')!.memo).toBe('지난달에서 복사 · 고지서 도착 전 추정');
  });
  it('복사한 데이터도 백업으로 저장·복원된다 (저장 구조 변경 없음)', () => {
    const d = sample();
    d.periodCosts.push(...copyFromPrevMonth(d.periodCosts, '2026-12', () => 'y' + Math.random()));
    const r = parseBackup(serialize(d));
    expect(r.ok).toBe(true);
  });
});
