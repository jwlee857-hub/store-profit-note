import { addDays } from './dates';
import type { Calc, CustomerMetric } from './types';

export interface RepurchaseResult {
  rate: Calc;
  /** 관찰 기준일이 코호트 종료일 + 30일 이후인가 */
  observationComplete: boolean;
  errors: string[];
}

/**
 * 30일 재구매율 = 30일 이내 재구매 고객 수 / 30일 관찰이 완료된 첫 구매 고객 수.
 * 전체 주문 수에 곱하거나 매출에 더하지 않는 보조 지표다.
 */
export function repurchaseRate(m: Pick<CustomerMetric, 'cohortStart' | 'cohortEnd' | 'observationDate' | 'observedCustomers' | 'repurchased30'>): RepurchaseResult {
  const errors: string[] = [];
  const { observedCustomers: den, repurchased30: num } = m;
  if (den !== null && den < 0) errors.push('관찰 완료 고객 수는 0 이상이어야 합니다.');
  if (num !== null && num < 0) errors.push('재구매 고객 수는 0 이상이어야 합니다.');
  if (den !== null && num !== null && num > den) errors.push('재구매 고객 수가 관찰 완료 고객 수보다 많을 수 없습니다.');
  if (m.cohortStart && m.cohortEnd && m.cohortStart > m.cohortEnd) errors.push('첫 구매 집단 시작일이 종료일보다 늦습니다.');

  const observationComplete = !!(m.cohortEnd && m.observationDate && m.observationDate >= addDays(m.cohortEnd, 30));

  let rate: Calc;
  if (num === null || den === null || !m.cohortStart || !m.cohortEnd || !m.observationDate) rate = { value: null, reason: 'noData' };
  else if (errors.length) rate = { value: null, reason: 'noData' };
  else if (den === 0) rate = { value: null, reason: 'divZero' };
  else rate = { value: (num / den) * 100, estimated: !observationComplete };
  return { rate, observationComplete, errors };
}
