import type { Calc } from './types';

const nf = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export type Unit = 'won' | 'people' | 'orders' | 'pct' | 'days' | 'count';

export const UNIT_SUFFIX: Record<Unit, string> = {
  won: '원',
  people: '명',
  orders: '건',
  pct: '%',
  days: '일',
  count: '개',
};

export function fmtNumber(n: number): string {
  // -0 표시 방지
  const v = Math.round(n);
  return nf.format(v === 0 ? 0 : v);
}

export function fmt(n: number | null | undefined, unit: Unit, emptyText = '미입력'): string {
  if (n === null || n === undefined) return emptyText;
  if (!Number.isFinite(n)) return '계산 불가';
  if (unit === 'pct') return `${nf1.format(n)}%`;
  return `${fmtNumber(n)}${UNIT_SUFFIX[unit]}`;
}

export function fmtSigned(n: number | null | undefined, unit: Unit): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const rounded = unit === 'pct' ? Math.round(n * 10) / 10 : Math.round(n);
  if (rounded === 0) return `±${fmt(0, unit)}`;
  return `${rounded > 0 ? '+' : '−'}${fmt(Math.abs(n), unit)}`;
}

export function calcText(c: Calc): string {
  if (c.value !== null) return '';
  if (c.reason === 'divZero') return '계산 불가';
  if (c.reason === 'incomplete') return '데이터 필요';
  return '데이터 필요';
}

export function fmtCalc(c: Calc, unit: Unit): string {
  if (c.value === null || !Number.isFinite(c.value)) return calcText({ ...c, value: null });
  return fmt(c.value, unit);
}

/**
 * 해결안 목표값 표기 (단위 포함)
 * - total: "150건" / increase: "실행 전보다 30건 증가" / growthRate: "실행 전보다 10.0% 증가" / perBusinessDay: "영업일당 12건"
 */
export function fmtKpiTarget(target: number | null, mode: 'total' | 'increase' | 'growthRate' | 'perBusinessDay', unit: Unit, higherIsBetter: boolean): string {
  if (target === null) return '미설정';
  const dir = higherIsBetter ? '증가' : '감소';
  switch (mode) {
    case 'total':
      return `실행 후 기간 ${fmt(target, unit)}`;
    case 'increase':
      return `실행 전보다 ${unit === 'pct' ? `${nf1.format(target)}%p` : fmt(target, unit)} ${dir}`;
    case 'growthRate':
      return `실행 전보다 ${nf1.format(target)}% ${dir}`;
    case 'perBusinessDay':
      return `영업일당 ${fmt(target, unit)}`;
  }
}

/** 목표 입력칸의 단위 문구 */
export function kpiTargetSuffix(mode: 'total' | 'increase' | 'growthRate' | 'perBusinessDay', unit: Unit): string {
  if (mode === 'growthRate') return '%';
  if (mode === 'increase' && unit === 'pct') return '%p';
  const base = UNIT_SUFFIX[unit];
  return mode === 'perBusinessDay' ? `${base}/일` : base;
}

/**
 * 앞 글자의 받침에 맞는 조사를 붙인다. 예: josa('인건비', '이/가') → '인건비가', josa('원가', '으로/로') → '원가로'
 * 한글이 아닌 끝 글자: 숫자는 읽는 소리 기준, 그 밖(영문·기호)은 받침 없음으로 본다.
 */
export function josa(word: string, pair: '이/가' | '은/는' | '을/를' | '과/와' | '으로/로'): string {
  const [withBatchim, without] = pair.split('/');
  const last = word.trim().replace(/[)\]'"’”\s]+$/, '').slice(-1);
  let batchim: number | null = null; // 0 = 없음, 8 = ㄹ, 그 밖 = 있음
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) batchim = (code - 0xac00) % 28;
  else if (/[0-9]/.test(last)) batchim = { '0': 21, '1': 8, '2': 0, '3': 1, '4': 0, '5': 0, '6': 1, '7': 8, '8': 8, '9': 0 }[last] ?? 0;
  else batchim = 0;
  const has = batchim !== 0;
  if (pair === '으로/로') return word + (has && batchim !== 8 ? withBatchim : without);
  return word + (has ? withBatchim : without);
}

/**
 * 쿠폰 조건 한 줄: "배달앱 A · 쿠폰 1,000원 → 3,000원 · 최소 주문 15,000원". 아무것도 없으면 null.
 * 금액 null = 미정, 0 = 쿠폰 중단(0원)
 */
export function couponText(c: { amount: number | null; minOrder: number | null; previousAmount?: number | null } | null | undefined, routeName?: string | null): string | null {
  if (!c || (c.amount === null && c.minOrder === null && (c.previousAmount ?? null) === null)) return null;
  const amt = (n: number | null) => (n === null ? '미정' : n === 0 ? '0원(중단)' : fmt(n, 'won'));
  const parts = routeName ? [routeName] : [];
  parts.push(c.previousAmount !== null && c.previousAmount !== undefined ? `쿠폰 ${amt(c.previousAmount)} → ${amt(c.amount)}` : c.amount === null ? '쿠폰 금액 미정' : c.amount === 0 ? '쿠폰 0원(중단)' : `쿠폰 ${fmt(c.amount, 'won')}`);
  if (c.minOrder !== null) parts.push(`최소 주문 ${fmt(c.minOrder, 'won')}`);
  return parts.join(' · ');
}

/** %p 차이 표기 (비율 지표 비교용) */
export function fmtPp(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '±0.0%p';
  return `${r > 0 ? '+' : '−'}${nf1.format(Math.abs(r))}%p`;
}
