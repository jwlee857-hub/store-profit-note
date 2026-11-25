import type { DateRange, DateStr } from './types';

// 모든 날짜는 시간대 영향을 피하기 위해 UTC 자정 기준으로 다룬다.

const DAY_MS = 86_400_000;

export function parseDate(d: DateStr): number {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

export function formatDateStr(ms: number): DateStr {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isValidDate(d: unknown): d is DateStr {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return formatDateStr(parseDate(d)) === d;
}

export function addDays(d: DateStr, n: number): DateStr {
  return formatDateStr(parseDate(d) + n * DAY_MS);
}

/** 양 끝 포함 달력 일수 */
export function daysInclusive(start: DateStr, end: DateStr): number {
  return Math.round((parseDate(end) - parseDate(start)) / DAY_MS) + 1;
}

export function eachDay(range: DateRange): DateStr[] {
  const out: DateStr[] = [];
  const n = daysInclusive(range.start, range.end);
  for (let i = 0; i < n; i++) out.push(addDays(range.start, i));
  return out;
}

export function weekday(d: DateStr): number {
  return new Date(parseDate(d)).getUTCDay();
}

export function inRange(d: DateStr, r: DateRange): boolean {
  return d >= r.start && d <= r.end;
}

export function isValidRange(r: DateRange | null | undefined): r is DateRange {
  return !!r && isValidDate(r.start) && isValidDate(r.end) && r.start <= r.end;
}

/** 두 기간이 겹치는 달력 일수 */
export function overlapDays(a: DateRange, b: DateRange): number {
  const s = a.start > b.start ? a.start : b.start;
  const e = a.end < b.end ? a.end : b.end;
  if (s > e) return 0;
  return daysInclusive(s, e);
}

export function todayStr(): DateStr {
  const now = new Date();
  return formatDateStr(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** 바로 앞의 같은 길이 기간 */
export function previousRange(r: DateRange): DateRange {
  const len = daysInclusive(r.start, r.end);
  return { start: addDays(r.start, -len), end: addDays(r.start, -1) };
}

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** "11.16(월)" */
export function shortDate(d: DateStr): string {
  return `${d.slice(5).replace('-', '.')}(${WEEKDAY_LABELS[weekday(d)]})`;
}

export function formatRange(r: DateRange): string {
  return `${r.start.replace(/-/g, '.')} ~ ${r.end.replace(/-/g, '.')}`;
}

/** 다음 주 월요일 (오늘이 월요일이면 7일 뒤) */
export function nextMonday(today: DateStr): DateStr {
  return addDays(today, (8 - weekday(today)) % 7 || 7);
}

/** "10월 1~31일" · 달이 다르면 "10월 19일~11월 1일" */
export function krRange(r: DateRange): string {
  const m = (d: DateStr) => Number(d.slice(5, 7));
  const day = (d: DateStr) => Number(d.slice(8, 10));
  return m(r.start) === m(r.end) && r.start.slice(0, 4) === r.end.slice(0, 4) ? `${m(r.start)}월 ${day(r.start)}~${day(r.end)}일` : `${m(r.start)}월 ${day(r.start)}일~${m(r.end)}월 ${day(r.end)}일`;
}

/** "10월 2일" */
export function krDate(d: DateStr): string {
  return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
}

/** 달력 한 달 전체(1일~말일)인가 */
export function isFullMonth(r: DateRange): boolean {
  return isValidRange(r) && r.start.slice(8) === '01' && r.start.slice(0, 7) === r.end.slice(0, 7) && addDays(r.end, 1).slice(8) === '01';
}

/** r이 시작하는 달의 지난달 전체 (10월 → 9월 1~30일) */
export function previousMonth(r: DateRange): DateRange {
  const end = addDays(`${r.start.slice(0, 7)}-01`, -1);
  return { start: `${end.slice(0, 7)}-01`, end };
}

/** "9.1~9.30" */
export function dotRange(r: DateRange): string {
  const f = (d: DateStr) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
  return `${f(r.start)}~${f(r.end)}`;
}
