import { describe, expect, it } from 'vitest';
import { migrate, parseBackup, serialize } from '../storage/storage';
import { computeSummary, getMetric } from './calc';
import { diagnose, diagnoseSummaries, groupFindings, relatedText, topIssues } from './diagnosis';
import { daysLeft, expandRangeToInclude, judgeKpiTarget, kpiTargetWarning, recentRanges, referenceDate, reviewUnavailableReason } from './periods';
import { generateSample } from './sample';
import { SCHEMA_VERSION } from './types';

describe('상위 문제: 겹치는 항목 묶기', () => {
  it('배달 1건당 남는 금액 감소 아래에 평균 주문금액·할인 비율·순배달비가 원인 후보로 묶인다', () => {
    const data = generateSample('2026-11-15');
    const top = topIssues(diagnose(data, data.problems[0]));
    const ids = top.map((f) => f.id);
    expect(ids).toContain('delivery-unit-profit-down');
    expect(ids).not.toContain('delivery-aov-down');
    expect(ids).not.toContain('delivery-discount-up');
    const g = top.find((f) => f.id === 'delivery-unit-profit-down')!;
    const rel = g.related.map(relatedText);
    expect(rel).toContain('평균 주문금액 22,679원 → 19,852원');
    expect(rel).toContain('가게 부담 할인 비율 4.2% → 11.6%');
    expect(rel).toContain('주문당 가게 부담 순배달비 2,428원 → 3,222원');
    // 다른 판매 방식의 항목은 묶지 않는다
    expect(g.related.every((f) => f.channel === 'delivery')).toBe(true);
    // 묶인 항목 대신 다음 순위 항목이 3위에 온다
    expect(top).toHaveLength(3);
  });
  it('대표 항목이 없으면 평균 주문금액 하락이 비용 비율 상승을 묶는다', () => {
    const f = (id: string, impact: number) => ({ id, channel: 'delivery' as const, tone: 'watch' as const, fact: '', title: id, impact, hypotheses: [], dataNeeded: [] });
    const groups = groupFindings([f('delivery-aov-down', -100), f('delivery-rate-food', -50), f('delivery-discount-up', -70), f('takeout-rate-food', -10)]);
    expect(groups.map((g) => g.id)).toEqual(['delivery-aov-down', 'delivery-discount-up', 'takeout-rate-food']);
    expect(groups[0].related.map((r) => r.id)).toEqual(['delivery-rate-food']);
  });
});

describe('공통 기준일과 기본 기간', () => {
  it('기준일은 가장 최근 매출 입력일', () => {
    expect(referenceDate({ sales: [{ date: '2026-11-10' }, { date: '2026-11-14' }, { date: '2026-11-01' }] as never })).toBe('2026-11-14');
  });
  it('최근 28일과 직전 28일', () => {
    const r = recentRanges({ sales: [{ date: '2026-11-14' }] as never });
    expect(r.cur).toEqual({ start: '2026-10-18', end: '2026-11-14' });
    expect(r.prev).toEqual({ start: '2026-09-20', end: '2026-10-17' });
  });
});

describe('샘플: 대시보드와 문제 진단의 기간·영업이익 일치', () => {
  // 2026-11-15는 일요일(정기 휴무) → 마지막 매출일은 11-14
  for (const end of ['2026-11-15', '2026-11-13']) {
    it(`생성 종료일 ${end}`, () => {
      const data = generateSample(end);
      const dash = recentRanges(data);
      const problem = data.problems[0];
      expect(problem.analysis).toEqual(dash.cur);
      expect(problem.compare).toEqual(dash.prev);
      const a = computeSummary(data, dash.cur).operatingProfit.value;
      const b = computeSummary(data, problem.analysis).operatingProfit.value;
      expect(a).not.toBeNull();
      expect(b).toBe(a);
      // 홈(최근 28일 요약)과 진단의 배달 주문 1건당 남는 금액도 같다
      const home = computeSummary(data, dash.cur).channels.delivery.directProfitPerOrder.value;
      const dx = diagnose(data, problem).cur.channels.delivery.directProfitPerOrder.value;
      expect(home).not.toBeNull();
      expect(dx).toBe(home);
      // 홈 상위 문제와 진단 상위 문제도 같은 항목·순서
      const homeTop = topIssues(diagnoseSummaries(data, computeSummary(data, dash.prev), computeSummary(data, dash.cur), problem)).map((f) => f.id);
      expect(topIssues(diagnose(data, problem)).map((f) => f.id)).toEqual(homeTop);
    });
  }
  it('일요일 종료 샘플의 기준일은 직전 토요일', () => {
    expect(referenceDate(generateSample('2026-11-15'))).toBe('2026-11-14');
  });
  it('해결안 실행·검토 기간도 같은 기준일을 쓴다', () => {
    const data = generateSample('2026-11-15');
    const ref = referenceDate(data);
    const [planned, reviewed] = data.solutions;
    expect(planned.start).toBe('2026-11-15');
    expect(reviewed.end).toBe(ref);
    expect(reviewed.review.after?.end).toBe(ref);
    expect(reviewed.review.before?.start).toBe(data.problems[0].analysis.start);
  });
});

describe('저장 후 목록 기간 넓히기', () => {
  const r = { start: '2026-10-18', end: '2026-11-14' };
  it('기간 밖 이후 날짜면 종료일을 넓힌다', () => {
    expect(expandRangeToInclude(r, '2026-11-15')).toEqual({ start: '2026-10-18', end: '2026-11-15' });
  });
  it('기간 밖 이전 날짜면 시작일을 넓힌다', () => {
    expect(expandRangeToInclude(r, '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-11-14' });
  });
  it('기간 안이면 그대로', () => {
    expect(expandRangeToInclude(r, '2026-11-01')).toEqual(r);
  });
  it('기간이 잘못되어 있으면 그 날짜 하루로', () => {
    expect(expandRangeToInclude({ start: '', end: '' }, '2026-11-01')).toEqual({ start: '2026-11-01', end: '2026-11-01' });
  });
});

describe('성과 목표 판정', () => {
  it('총량 기준: 실행 전이 이미 목표 이상이면 달성 (기존 동작)', () => {
    expect(judgeKpiTarget('total', 150, 215, 230, true).achieved).toBe(true);
  });
  it('증가분 기준: 215 → 230은 증가 15건이라 목표 30건 미달', () => {
    const r = judgeKpiTarget('increase', 30, 215, 230, true);
    expect(r.actual).toBe(15);
    expect(r.achieved).toBe(false);
    expect(judgeKpiTarget('increase', 30, 215, 245, true).achieved).toBe(true);
  });
  it('낮을수록 좋은 지표의 증가분 기준은 감소량으로 본다', () => {
    const r = judgeKpiTarget('increase', 2, 40, 37, false);
    expect(r.actual).toBe(3);
    expect(r.achieved).toBe(true);
  });
  it('값이 없으면 판정하지 않는다', () => {
    expect(judgeKpiTarget('total', null, 1, 2, true).achieved).toBeNull();
    expect(judgeKpiTarget('total', 1, 1, null, true).achieved).toBeNull();
    expect(judgeKpiTarget('increase', 1, null, 2, true).achieved).toBeNull();
  });
});

describe('성과 확인 가능 여부', () => {
  it('시작일 없음 / 시작 전 / 확인 가능', () => {
    const today = '2026-11-16';
    expect(reviewUnavailableReason({ start: null, end: null }, '2026-11-14', today)).toBe('noStart');
    expect(reviewUnavailableReason({ start: '2026-11-23', end: '2026-12-06' }, '2026-11-14', today)).toBe('notStarted');
    expect(reviewUnavailableReason({ start: '2026-11-01', end: null }, '2026-11-14', today)).toBe('noEnd');
    // 실행 중: 시작은 했지만 종료일이 오늘이거나 아직 오지 않음
    expect(reviewUnavailableReason({ start: '2026-11-15', end: '2026-12-12' }, '2026-11-14', today)).toBe('running');
    expect(reviewUnavailableReason({ start: '2026-11-01', end: '2026-11-16' }, '2026-11-16', today)).toBe('running');
    // 기간은 끝났지만 종료일까지 매출이 입력되지 않음
    expect(reviewUnavailableReason({ start: '2026-11-01', end: '2026-11-15' }, '2026-11-12', today)).toBe('awaitingData');
    expect(reviewUnavailableReason({ start: '2026-11-01', end: '2026-11-14' }, '2026-11-14', today)).toBeNull();
  });
  it('남은 일수', () => {
    expect(daysLeft('2026-11-16', '2026-12-12')).toBe(26);
    expect(daysLeft('2026-11-16', '2026-11-16')).toBe(0);
    expect(daysLeft('2026-11-16', '2026-11-10')).toBe(0);
  });
  it('목표값이 실행 전 실적보다 낫지 않으면 경고', () => {
    expect(kpiTargetWarning('total', 200, 215, 12, true)).toBe('notBetter');
    expect(kpiTargetWarning('total', 215, 215, 12, true)).toBe('notBetter');
    expect(kpiTargetWarning('total', 240, 215, 12, true)).toBeNull();
    expect(kpiTargetWarning('total', 30, 40, 12, false)).toBeNull(); // 낮을수록 좋은 지표
    expect(kpiTargetWarning('total', 50, 40, 12, false)).toBe('notBetter');
    expect(kpiTargetWarning('perBusinessDay', 15, 215, 12, true)).toBe('notBetter'); // 215/12 ≈ 17.9
    expect(kpiTargetWarning('perBusinessDay', 20, 215, 12, true)).toBeNull();
    expect(kpiTargetWarning('increase', 0, 215, 12, true)).toBe('noImprovement');
    expect(kpiTargetWarning('increase', 30, 215, 12, true)).toBeNull();
    expect(kpiTargetWarning('total', null, 215, 12, true)).toBeNull();
    expect(kpiTargetWarning('total', 100, null, 12, true)).toBeNull();
  });
  it('샘플 포장 계획 목표는 실행 전 실적보다 높다', () => {
    const data = generateSample('2026-11-15');
    const sol = data.solutions.find((s) => s.templateId === 'takeout-pickup')!;
    const before = getMetric(computeSummary(data, sol.review.before!), sol.kpi).value!;
    expect(sol.kpiTargetMode).toBe('total');
    expect(sol.kpiTarget!).toBeGreaterThan(before);
    expect(kpiTargetWarning(sol.kpiTargetMode, sol.kpiTarget, before, 12, true)).toBeNull();
  });
});

describe('스키마 v1 → v2 마이그레이션', () => {
  const v1Backup = () => {
    const data = generateSample('2026-11-15') as unknown as Record<string, unknown>;
    const solutions = (data.solutions as Record<string, unknown>[]).map(({ kpiTargetMode: _drop, ...s }) => s);
    return JSON.stringify({ app: 'restaurant-profit-beta', schemaVersion: 1, exportedAt: '2026-11-15T00:00:00.000Z', data: { ...data, schemaVersion: 1, solutions } });
  };
  it('v1 백업을 오류 없이 열고 목표 기준은 기존 동작(total)으로 채운다', () => {
    const parsed = parseBackup(v1Backup());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.data.solutions.every((s) => s.kpiTargetMode === 'total')).toBe(true);
  });
  it('마이그레이션은 계산 결과를 바꾸지 않는다', () => {
    const original = generateSample('2026-11-15');
    const parsed = parseBackup(v1Backup());
    if (!parsed.ok) throw new Error(parsed.error);
    const range = recentRanges(original).cur;
    expect(computeSummary(parsed.data, range).operatingProfit.value).toBe(computeSummary(original, range).operatingProfit.value);
  });
  it('원본 객체를 바꾸지 않는다', () => {
    const raw = { schemaVersion: 1, solutions: [{ name: 'a' }] };
    migrate(raw, 1);
    expect(raw.solutions[0]).toEqual({ name: 'a' });
  });
  it('현재 버전 백업은 그대로 왕복된다', () => {
    const data = generateSample('2026-11-15');
    const parsed = parseBackup(serialize(data));
    expect(parsed.ok).toBe(true);
  });
});
