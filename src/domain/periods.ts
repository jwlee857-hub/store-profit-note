// 화면 공통 기준일·기본 기간 계산. 대시보드·진단·매출 목록·성과 확인·샘플 생성이 모두 이 함수를 쓴다.
import { addDays, daysInclusive, formatDateStr, isValidRange, parseDate, previousRange, todayStr, weekday } from './dates';
import type { AppData, DateRange, DateStr, KpiTargetMode, MetricKey, SolutionStatus } from './types';

/** 기준일 = 가장 최근 매출 입력일. 입력이 없으면 오늘 */
export function referenceDate(data: Pick<AppData, 'sales'>): DateStr {
  let max = '';
  for (const s of data.sales) if (s.date > max) max = s.date;
  return max || todayStr();
}

/** 기준일로 끝나는 days일 기간과 바로 앞의 같은 길이 기간 */
export function rangesEndingAt(end: DateStr, days = 28): { cur: DateRange; prev: DateRange } {
  const cur = { start: addDays(end, -(days - 1)), end };
  return { cur, prev: previousRange(cur) };
}

export function recentRanges(data: Pick<AppData, 'sales'>, days = 28): { cur: DateRange; prev: DateRange } {
  return rangesEndingAt(referenceDate(data), days);
}

/** 기간에 date가 포함되도록 넓힌 기간. 이미 포함되면 그대로 반환 */
export function expandRangeToInclude(range: DateRange, date: DateStr): DateRange {
  if (!isValidRange(range)) return { start: date, end: date };
  return { start: date < range.start ? date : range.start, end: date > range.end ? date : range.end };
}

// ───────── 홈 기간 버튼 ─────────

export type PeriodPreset = 'week' | 'month' | 'recent28';

export interface PresetRanges {
  cur: DateRange;
  prev: DateRange;
  /** 예: "이번 주 11.16(월) ~ 11.18(수)" */
  label: string;
  /** 예: "지난주 같은 요일까지(11.09 ~ 11.11)와 비교" */
  compareLabel: string;
  /** 진행 중인 기간이라 같은 일수만큼만 비교함 */
  inProgress: boolean;
}

const short = (d: DateStr) => d.slice(5).replace('-', '.');
const W = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 진행 중인 기간의 끝: 오늘과 마지막 매출 입력일 중 빠른 날 (최근 4주와 같은 규칙).
 * 그 기간에 입력이 하나도 없으면(마지막 입력일이 시작일보다 앞) 오늘까지로 둔다.
 */
function inProgressEnd(start: DateStr, today: DateStr, ref: DateStr): DateStr {
  if (ref < start) return today;
  return ref < today ? ref : today;
}

/**
 * 진행 중인 기간(이번 주·이번 달)은 지난 기간 전체가 아니라 같은 일수만큼과 비교한다.
 * 끝 날짜는 마지막 매출 입력일까지로 맞춘다(입력 전 날짜의 월세·인건비가 빠지지 않은 매출과 비교되지 않게).
 * - 이번 주: 월요일 ~ 마지막 입력일, 비교 = 지난주 월요일 ~ 같은 요일
 * - 이번 달: 1일 ~ 마지막 입력일, 비교 = 지난달 1일 ~ 같은 날짜 (지난달이 짧으면 말일까지)
 * - 최근 4주: 마지막 매출 입력일로 끝나는 28일, 비교 = 그 직전 28일
 */
export function presetRanges(kind: PeriodPreset, today: DateStr, ref: DateStr): PresetRanges {
  if (kind === 'week') {
    const wd = weekday(today);
    const monday = addDays(today, -((wd + 6) % 7));
    const end = inProgressEnd(monday, today, ref);
    const cur = { start: monday, end };
    const prev = { start: addDays(monday, -7), end: addDays(end, -7) };
    return {
      cur,
      prev,
      label: `이번 주 ${short(cur.start)}(${W[weekday(cur.start)]}) ~ ${short(cur.end)}(${W[weekday(cur.end)]})${end < today ? ' (마지막 매출 입력일까지)' : ''}`,
      compareLabel: `지난주 같은 요일까지(${short(prev.start)} ~ ${short(prev.end)})와 비교`,
      inProgress: true,
    };
  }
  if (kind === 'month') {
    const t = new Date(parseDate(today));
    const y = t.getUTCFullYear();
    const m = t.getUTCMonth();
    const start = formatDateStr(Date.UTC(y, m, 1));
    const end = inProgressEnd(start, today, ref);
    const n = daysInclusive(start, end);
    const prevStart = formatDateStr(Date.UTC(y, m - 1, 1));
    const prevMonthEnd = formatDateStr(Date.UTC(y, m, 0));
    const want = addDays(prevStart, n - 1);
    const prevEnd = want > prevMonthEnd ? prevMonthEnd : want;
    const prev = { start: prevStart, end: prevEnd };
    const shorter = daysInclusive(prev.start, prev.end) < n;
    return {
      cur: { start, end },
      prev,
      label: `이번 달 ${short(start)} ~ ${short(end)} (${n}일${end < today ? ' · 마지막 매출 입력일까지' : ''})`,
      compareLabel: `지난달 같은 날짜까지(${short(prev.start)} ~ ${short(prev.end)})와 비교${shorter ? ' · 지난달이 더 짧아 일수가 다릅니다' : ''}`,
      inProgress: true,
    };
  }
  const r = rangesEndingAt(ref, 28);
  return {
    ...r,
    label: `최근 4주 ${short(r.cur.start)} ~ ${short(r.cur.end)} (마지막 매출 입력일까지)`,
    compareLabel: `그 전 4주(${short(r.prev.start)} ~ ${short(r.prev.end)})와 비교`,
    inProgress: false,
  };
}

// ───────── 해결안 목표 ─────────

/** 영업일당 목표를 쓸 수 있는 합계형 지표 (비율·평균 지표는 영업일로 나누는 의미가 없음) */
const ADDITIVE: MetricKey[] = ['totalSales', 'netSales', 'orders', 'visitors', 'directProfit', 'operatingProfit', 'storeDiscount'];

export function kpiModeAllowed(key: MetricKey, unit: string, mode: KpiTargetMode): boolean {
  if (mode === 'perBusinessDay') return ADDITIVE.includes(key);
  if (mode === 'growthRate') return unit !== 'pct';
  return true;
}

export const KPI_MODE_LABEL: Record<KpiTargetMode, string> = {
  total: '실행 후 총량',
  increase: '실행 전보다 늘어난 양',
  growthRate: '증가율',
  perBusinessDay: '영업일당 수치',
};

export interface KpiJudgement {
  achieved: boolean | null;
  /** 목표와 같은 단위로 환산한 실제 값 (총량, 변화량, 증가율 %, 영업일당 값) */
  actual: number | null;
  /** 판정하지 못한 이유 */
  reason: string | null;
}

/**
 * 성과 확인 목표 판정.
 * - total: 실행 후 값 ≥ 목표 (낮을수록 좋은 지표는 ≤)
 * - increase: 변화량 ≥ 목표 (낮을수록 좋은 지표는 감소량 = 실행 전 − 실행 후)
 * - growthRate: 변화율(%) ≥ 목표. 실행 전 값이 0 이하면 계산하지 않음
 * - perBusinessDay: 실행 후 값 ÷ 실행 후 영업일 수 ≥ 목표 (낮을수록 좋은 지표는 ≤)
 */
export function judgeKpiTarget(
  mode: KpiTargetMode,
  target: number | null,
  before: number | null,
  after: number | null,
  higherIsBetter: boolean,
  afterBusinessDays: number | null = null,
): KpiJudgement {
  if (target === null) return { achieved: null, actual: null, reason: '목표 미설정' };
  if (after === null) return { achieved: null, actual: null, reason: '실행 후 데이터 필요' };
  switch (mode) {
    case 'total':
      return { achieved: higherIsBetter ? after >= target : after <= target, actual: after, reason: null };
    case 'increase': {
      if (before === null) return { achieved: null, actual: null, reason: '실행 전 데이터 필요' };
      const change = higherIsBetter ? after - before : before - after;
      return { achieved: change >= target, actual: change, reason: null };
    }
    case 'growthRate': {
      if (before === null) return { achieved: null, actual: null, reason: '실행 전 데이터 필요' };
      if (before <= 0) return { achieved: null, actual: null, reason: '실행 전 값이 0 이하라 증가율을 계산하지 않습니다' };
      const rate = ((higherIsBetter ? after - before : before - after) / before) * 100;
      return { achieved: rate >= target, actual: rate, reason: null };
    }
    case 'perBusinessDay': {
      if (!afterBusinessDays) return { achieved: null, actual: null, reason: '실행 후 기간에 영업일이 없습니다' };
      const per = after / afterBusinessDays;
      return { achieved: higherIsBetter ? per >= target : per <= target, actual: per, reason: null };
    }
  }
}

/**
 * 현재 실적이 이미 목표 이상인지 (총량·영업일당 기준만 의미가 있음).
 * 막지 않고 안내만 한다.
 */
export function targetAlreadyMet(
  mode: KpiTargetMode,
  target: number | null,
  current: number | null,
  currentBusinessDays: number | null,
  higherIsBetter: boolean,
): boolean {
  if (target === null || current === null) return false;
  if (mode === 'total') return higherIsBetter ? current >= target : current <= target;
  if (mode === 'perBusinessDay') {
    if (!currentBusinessDays) return false;
    const per = current / currentBusinessDays;
    return higherIsBetter ? per >= target : per <= target;
  }
  return false;
}

export type ReviewWait = 'noStart' | 'notStarted' | 'planned' | 'noEnd' | 'running' | 'endedEarly' | 'awaitingData';

/**
 * 실행 계획의 성과를 아직 확인할 수 없는 이유. 확인 가능하면 null.
 * 날짜와 함께 사용자가 기록한 상태값을 본다(날짜상 실행 기간이어도 상태가 '계획'이면 실행 중으로 말하지 않는다).
 * - planned: 시작일은 지났지만 상태가 '계획' (아직 시작 전으로 기록됨)
 * - running: 종료일이 오늘이거나 아직 오지 않음 (실행 중)
 * - endedEarly: 종료일 전인데 상태가 중단·완료·검증 대기 (계획보다 일찍 끝냄)
 * - awaitingData: 실행 기간은 끝났지만 매출이 종료일까지 입력되지 않음 (refDate = 가장 최근 매출 입력일)
 */
export function reviewUnavailableReason(
  solution: { start: DateStr | null; end: DateStr | null; status?: SolutionStatus },
  refDate: DateStr,
  today: DateStr = todayStr(),
): ReviewWait | null {
  if (!solution.start) return 'noStart';
  if (solution.start > today) return 'notStarted';
  if (solution.status === 'planned' && (!solution.end || solution.end >= today)) return 'planned';
  if (!solution.end) return 'noEnd';
  if (solution.end >= today) return solution.status === 'stopped' || solution.status === 'done' || solution.status === 'reviewPending' ? 'endedEarly' : 'running';
  if (refDate < solution.end) return 'awaitingData';
  return null;
}

/** from 다음 날부터 to까지 남은 일수 (같은 날이면 0) */
export function daysLeft(from: DateStr, to: DateStr): number {
  return to <= from ? 0 : daysInclusive(from, to) - 1;
}

/**
 * 목표값이 실행 전 실적으로 이미 달성되는 수준인지 확인한다.
 * - total / perBusinessDay: 목표가 실행 전 실적보다 낫지 않으면 'notBetter'
 * - increase / growthRate: 개선 폭 목표가 0 이하이면 'noImprovement'
 */
export function kpiTargetWarning(
  mode: KpiTargetMode,
  target: number | null,
  before: number | null,
  beforeBusinessDays: number,
  higherIsBetter: boolean,
): 'notBetter' | 'noImprovement' | null {
  if (target === null) return null;
  if (mode === 'increase' || mode === 'growthRate') return target <= 0 ? 'noImprovement' : null;
  if (before === null) return null;
  let base = before;
  if (mode === 'perBusinessDay') {
    if (!beforeBusinessDays) return null;
    base = before / beforeBusinessDays;
  }
  const better = higherIsBetter ? target > base : target < base;
  return better ? null : 'notBetter';
}
