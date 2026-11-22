import type { Channel, MetricRef, Solution, SolutionDirection } from './types';

export const sameMetric = (a: MetricRef, b: MetricRef) => a.key === b.key && a.channel === b.channel;

/**
 * 배달 대상 계획의 기본 성과지표 (쿠폰을 계속 걸지·줄일지 정할 때 보는 세 숫자)
 * ① 배달 1건당 남는 금액 ② 배달에서 판매 방식 비용을 뺀 금액 ③ 가게 전체 영업이익
 */
export const DELIVERY_KPI_SET: MetricRef[] = [
  { key: 'directProfitPerOrder', channel: 'delivery' },
  { key: 'directProfit', channel: 'delivery' },
  { key: 'operatingProfit', channel: 'all' },
];

/**
 * 대상에 맞는 기본 성과지표. 배달이면 세 지표를 모두 담는다:
 * 주 지표가 셋 중 하나면 주 지표는 그대로 두고 나머지 둘을 함께 볼 지표로, 아니면 셋 모두를 함께 볼 지표로.
 * 배달이 아니면 주 지표만 (함께 볼 지표 없음).
 */
export function defaultKpisFor(target: Channel | 'common', main?: MetricRef): Pick<Solution, 'kpi' | 'extraKpis'> {
  if (target !== 'delivery') return { kpi: main ?? { key: 'operatingProfit', channel: 'all' }, extraKpis: [] };
  const kpi = main ?? DELIVERY_KPI_SET[0];
  return { kpi, extraKpis: DELIVERY_KPI_SET.filter((m) => !sameMetric(m, kpi)) };
}

/**
 * 새 계획의 쿠폰 금액 기본값: 가장 최근 결과 판단에서 정한 '다음 기간 쿠폰 금액'.
 * 같은 판매 방식 대상 계획을 먼저 보고, 없으면 대상과 관계없이 가장 최근 것. 없으면 null.
 */
export function suggestedCoupon(solutions: Solution[], target: Channel | 'common'): { amount: number; from: Solution } | null {
  const withNext = solutions
    .filter((s) => s.review.nextCouponAmount !== null && s.review.nextCouponAmount !== undefined)
    .sort((a, b) => (b.review.reviewedAt ?? b.createdAt).localeCompare(a.review.reviewedAt ?? a.createdAt));
  const pick = withNext.find((s) => s.target === target) ?? withNext[0];
  return pick ? { amount: pick.review.nextCouponAmount!, from: pick } : null;
}

/** 해결안 작성용 예시 템플릿. 검증된 처방이 아니라 작성 출발점이다. */
export interface SolutionTemplate {
  id: string;
  name: string;
  target: Channel | 'common';
  direction: SolutionDirection;
  hypothesis: string;
  actions: string;
  kpi: MetricRef;
  successCriteria: string;
  stopCriteria: string;
}

export const SOLUTION_TEMPLATES: SolutionTemplate[] = [
  {
    id: 'hall-revisit',
    name: '홀 재방문 개선',
    target: 'hall',
    direction: 'revenue',
    hypothesis: '홀 방문 고객 감소가 재방문 감소에서 왔을 수 있다(확인 필요).',
    actions: '재방문 시 사용할 수 있는 다음 방문 혜택 안내, 단골 메뉴 기억·추천 등 응대 방식 정비',
    kpi: { key: 'visitors', channel: 'hall' },
    successCriteria: '실행 기간 홀 방문 고객 수가 목표값 이상이고 전체 영업이익이 줄지 않음',
    stopCriteria: '혜택 비용 대비 방문 고객 증가가 없거나 전체 영업이익이 감소',
  },
  {
    id: 'hall-wait',
    name: '홀 대기시간 단축',
    target: 'hall',
    direction: 'revenue',
    hypothesis: '피크 시간 대기 이탈로 방문 고객이 줄었을 수 있다(대기 기록으로 확인 필요).',
    actions: '피크 시간 사전 주문·준비량 조정, 테이블 정리 순서 개선, 대기 명단 운영',
    kpi: { key: 'visitors', channel: 'hall' },
    successCriteria: '피크 시간 방문 고객 수 증가, 대기 중 이탈 감소',
    stopCriteria: '인력 추가 비용이 늘었는데 방문 고객 변화가 없음',
  },
  {
    id: 'delivery-menu',
    name: '배달 메뉴 구성 개선',
    target: 'delivery',
    direction: 'mixed',
    hypothesis: '평균 주문금액 하락이나 원가가 높은 메뉴 비중이 주문당 이익을 낮췄을 수 있다.',
    actions: '주문당 이익이 높은 메뉴를 묶은 세트 구성, 원가가 높은 저가 단품 가격·구성 재검토',
    kpi: { key: 'directProfitPerOrder', channel: 'delivery' },
    successCriteria: '배달 주문 1건당 남는 금액이 목표값 이상',
    stopCriteria: '주문 수가 크게 줄어 배달에서 판매 방식 비용을 뺀 금액 총액이 감소',
  },
  {
    id: 'delivery-discount',
    name: '배달 할인 효율 검토',
    target: 'delivery',
    direction: 'cost',
    hypothesis: '가게 부담 할인이 늘어난 주문보다 더 큰 비용을 만들었을 수 있다.',
    actions: '할인 금액·조건 단계적 축소, 할인 적용 주문과 미적용 주문의 주문당 이익 비교',
    kpi: { key: 'directProfit', channel: 'delivery' },
    successCriteria: '배달에서 판매 방식 비용을 뺀 금액과 전체 영업이익이 함께 개선',
    stopCriteria: '할인 축소 후 주문 감소로 배달에서 판매 방식 비용을 뺀 금액이 감소',
  },
  {
    id: 'takeout-pickup',
    name: '포장 주문과 픽업 개선',
    target: 'takeout',
    direction: 'revenue',
    hypothesis: '포장 수요가 늘고 있어 픽업 편의를 높이면 주문당 비용이 낮은 주문을 더 받을 수 있다.',
    actions: '포장 주문 안내 강화, 픽업 대기 구역·준비 시간 안내, 포장 전용 메뉴 정비',
    kpi: { key: 'orders', channel: 'takeout' },
    successCriteria: '포장 주문 수 증가와 함께 전체 영업이익 증가(다른 판매 방식 감소분 포함 확인)',
    stopCriteria: '포장 증가가 배달·홀 감소로 상쇄되어 전체 영업이익 변화 없음',
  },
  {
    id: 'food-waste',
    name: '식재료 폐기 감소',
    target: 'common',
    direction: 'cost',
    hypothesis: '폐기량 증가가 식재료비 비율 상승에 영향을 주었을 수 있다(폐기 기록 필요).',
    actions: '요일별 준비량 기준표 작성, 선입선출 점검, 폐기 사유 기록',
    kpi: { key: 'operatingMargin', channel: 'all' },
    successCriteria: '매출 대비 식재료비 비율 하락, 품절 증가 없음',
    stopCriteria: '품절로 인한 매출 감소가 관찰됨',
  },
  {
    id: 'staffing',
    name: '공통 근무 배치 개선',
    target: 'common',
    direction: 'cost',
    hypothesis: '근무 배치가 실제 바쁜 시간과 맞지 않아 인건비 대비 매출이 낮을 수 있다.',
    actions: '시간대별 매출과 근무표 비교 후 근무 시간 재배치',
    kpi: { key: 'operatingProfit', channel: 'all' },
    successCriteria: '매출 유지 상태에서 인건비 비율 하락',
    stopCriteria: '대기시간 증가나 매출 감소가 관찰됨',
  },
];

/** 진단 관찰 사실(id)에 어울리는 예시 템플릿. 없으면 null. 추천이 아니라 작성 출발점 */
export function templateForFinding(findingId: string): SolutionTemplate | null {
  const pick = (id: string) => SOLUTION_TEMPLATES.find((t) => t.id === id) ?? null;
  if (findingId === 'hall-visitors-down') return pick('hall-revisit');
  if (findingId.startsWith('delivery-discount') || findingId === 'delivery-unit-profit-down') return pick('delivery-discount');
  if (findingId === 'delivery-aov-down' || findingId.startsWith('delivery-rate-')) return pick('delivery-menu');
  if (findingId.startsWith('takeout-')) return pick('takeout-pickup');
  if (findingId.endsWith('-cost-food') || findingId.endsWith('-rate-food')) return pick('food-waste');
  if (findingId === 'common-labor') return pick('staffing');
  return null;
}

/** 관찰 사실에 맞는 확인 지표 제안 */
export function kpiForFinding(findingId: string, channel: Channel | 'all'): MetricRef {
  const ch = channel;
  if (findingId === 'hall-visitors-down') return { key: 'visitors', channel: 'hall' };
  if (findingId === 'hall-ticket-down' || findingId.endsWith('-aov-down')) return { key: 'avgTicket', channel: ch };
  if (findingId.endsWith('-orders-down')) return { key: 'orders', channel: ch };
  if (findingId.endsWith('-unit-profit-down') || findingId.includes('-cost-') || findingId.includes('-rate-')) return ch === 'all' ? { key: 'operatingProfit', channel: 'all' } : { key: 'directProfitPerOrder', channel: ch };
  if (findingId.endsWith('-discount-up')) return { key: 'directProfit', channel: ch };
  return { key: 'operatingProfit', channel: 'all' };
}
