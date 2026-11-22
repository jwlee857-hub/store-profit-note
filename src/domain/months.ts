// 월 단위 보기: 달 이동과 그 달의 기간별 비용 행. 계산 방식(날짜 수만큼 나누기)은 allocatePeriodCost 그대로 쓴다.
import { allocatePeriodCost } from './calc';
import { formatDateStr, overlapDays, parseDate } from './dates';
import { CATEGORY_LABEL, CHANNEL_LABEL } from './labels';
import type { Attribution, CostCategory, DateRange, DateStr, PeriodCost } from './types';

/** "2026-11" */
export type MonthKey = string;

export const isMonthKey = (v: unknown): v is MonthKey => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const monthOf = (d: DateStr): MonthKey => d.slice(0, 7);

export function monthRangeOf(key: MonthKey): DateRange {
  const [y, m] = key.split('-').map(Number);
  return { start: formatDateStr(Date.UTC(y, m - 1, 1)), end: formatDateStr(Date.UTC(y, m, 0)) };
}

export function shiftMonth(key: MonthKey, n: number): MonthKey {
  const [y, m] = key.split('-').map(Number);
  return formatDateStr(Date.UTC(y, m - 1 + n, 1)).slice(0, 7);
}

/** "2026년 11월" */
export function monthLabel(key: MonthKey): string {
  const [y, m] = key.split('-').map(Number);
  return `${y}년 ${m}월`;
}
/** "11월" */
export const monthShort = (key: MonthKey) => `${Number(key.slice(5))}월`;

export interface MonthCostRow {
  /** 항목·귀속 조합 (같은 항목이라도 공통과 배달 전용은 다른 줄) */
  key: string;
  category: CostCategory;
  attribution: Attribution;
  label: string;
  /** 그 달 금액 (여러 달에 걸친 비용은 그 달 날짜 수만큼 나눈 금액) */
  amount: number;
  /** 지난달 같은 항목 금액. 지난달에 없으면 null */
  prevAmount: number | null;
  /** 그 달 금액에 추정값이 들어 있는가 */
  estimated: boolean;
  /** 한 달에 딱 맞지 않는 비용(여러 달에 걸치거나 달 중간 시작)이 들어 있는가 */
  spansMonths: boolean;
  /** 이 줄을 이루는 기록 */
  records: { cost: PeriodCost; amount: number; overlapDays: number; totalDays: number }[];
}

const rowKey = (p: Pick<PeriodCost, 'category' | 'attribution'>) => `${p.category}|${p.attribution}`;

export function costRowLabel(category: CostCategory, attribution: Attribution): string {
  return attribution === 'common' ? CATEGORY_LABEL[category] : `${CATEGORY_LABEL[category].replace(/^판매 방식 (전용 )?/, '')} · ${CHANNEL_LABEL[attribution]} 전용`;
}

function groupMonth(costs: PeriodCost[], key: MonthKey) {
  const range = monthRangeOf(key);
  const groups = new Map<string, MonthCostRow>();
  for (const pc of costs) {
    const ov = overlapDays({ start: pc.start, end: pc.end }, range);
    if (ov === 0) continue;
    const amount = allocatePeriodCost(pc, range);
    const k = rowKey(pc);
    let g = groups.get(k);
    if (!g) {
      g = { key: k, category: pc.category, attribution: pc.attribution, label: costRowLabel(pc.category, pc.attribution), amount: 0, prevAmount: null, estimated: false, spansMonths: false, records: [] };
      groups.set(k, g);
    }
    g.amount += amount;
    if (pc.source === 'estimated' && amount > 0) g.estimated = true;
    if (pc.start !== range.start || pc.end !== range.end) g.spansMonths = true;
    g.records.push({ cost: pc, amount, overlapDays: ov, totalDays: Math.round((parseDate(pc.end) - parseDate(pc.start)) / 86_400_000) + 1 });
  }
  return groups;
}

export interface MonthCosts {
  month: MonthKey;
  rows: MonthCostRow[];
  total: number;
  /** 지난달 합계. 지난달 비용이 하나도 없으면 null */
  prevTotal: number | null;
  /** 지난달에만 있던 항목 (이번 달에 없음) */
  goneRows: { key: string; label: string; prevAmount: number }[];
}

/** 그 달의 기간별 비용을 항목별로 묶고 지난달과 비교한다 */
export function monthCosts(costs: PeriodCost[], month: MonthKey): MonthCosts {
  const cur = groupMonth(costs, month);
  const prev = groupMonth(costs, shiftMonth(month, -1));
  const rows = [...cur.values()];
  for (const r of rows) r.prevAmount = prev.get(r.key)?.amount ?? null;
  const order = (r: MonthCostRow) => (r.attribution === 'common' ? 0 : 1);
  rows.sort((a, b) => order(a) - order(b) || b.amount - a.amount);
  const prevTotal = prev.size ? [...prev.values()].reduce((s, r) => s + r.amount, 0) : null;
  const goneRows = [...prev.values()].filter((r) => !cur.has(r.key)).map((r) => ({ key: r.key, label: r.label, prevAmount: r.amount }));
  return { month, rows, total: rows.reduce((s, r) => s + r.amount, 0), prevTotal, goneRows };
}

/**
 * 월 비용 요약용 금액: 만 원 단위로 딱 떨어지거나 10만 원 이상이면 "5만 원"·"1,511만 원", 그 밖은 원 단위.
 * signed면 +/− 부호를 붙인다.
 */
export function wonShort(n: number, signed = false): string {
  const v = Math.round(n);
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : '';
  if (a >= 10_000 && (a % 10_000 === 0 || a >= 100_000)) return `${sign}${Math.round(a / 10_000).toLocaleString('ko-KR')}만 원`;
  return `${sign}${a.toLocaleString('ko-KR')}원`;
}

/** 금액 변화가 있는가 (원 단위 반올림 기준) */
export const rowChanged = (r: Pick<MonthCostRow, 'amount' | 'prevAmount'>) => r.prevAmount !== null && Math.round(r.amount) !== Math.round(r.prevAmount);

/**
 * "지난달 비용 그대로 가져오기": 지난달 항목마다 그 달 전체 기간으로 하나씩 만든다.
 * 금액은 지난달 화면에 보이던 금액(날짜 수만큼 나눈 금액, 원 단위 반올림), 구분은 '추정'.
 */
export function copyFromPrevMonth(costs: PeriodCost[], month: MonthKey, newId: () => string): PeriodCost[] {
  const prev = groupMonth(costs, shiftMonth(month, -1));
  const range = monthRangeOf(month);
  return [...prev.values()].map((g) => {
    const base = g.records[g.records.length - 1].cost;
    const memo = base.memo.replace(/^지난달에서 복사( · )?/, '');
    return {
      id: newId(),
      category: g.category,
      attribution: g.attribution,
      nature: base.nature,
      start: range.start,
      end: range.end,
      amount: Math.round(g.amount),
      source: 'estimated',
      memo: memo ? `지난달에서 복사 · ${memo}` : '지난달에서 복사',
    };
  });
}
