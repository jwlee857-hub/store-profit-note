import type {
  Attribution,
  Channel,
  CommonCategory,
  CostCategory,
  CostNature,
  Decision,
  DirectCategory,
  FeeBase,
  MetricKey,
  ProblemType,
  SolutionDirection,
  SolutionStatus,
} from './types';
import type { Unit } from './format';

export const CHANNEL_LABEL: Record<Channel, string> = {
  hall: '홀',
  delivery: '배달',
  takeout: '포장',
};

/** 검증된 범주형 팔레트의 고정 순서 1~3번 슬롯. 채널 색은 항상 이 매핑을 따른다. */
export const CHANNEL_COLOR: Record<Channel, string> = {
  hall: '#2a78d6',
  delivery: '#eb6834',
  takeout: '#1baf7a',
};

export const ATTRIBUTION_LABEL: Record<Attribution, string> = {
  ...CHANNEL_LABEL,
  common: '공통',
};

export const NATURE_LABEL: Record<CostNature, string> = {
  fixed: '고정비',
  variable: '변동비',
  mixed: '혼합비',
};

export const DIRECT_LABEL: Record<DirectCategory, string> = {
  food: '식재료비',
  brokerage: '중개 수수료',
  payment: '결제 수수료',
  delivery: '가게 부담 순배달비',
  packaging: '포장비',
  hallSupplies: '홀 전용 소모품비',
  channelAd: '판매 방식 전용 광고비',
  otherDirect: '기타 판매 방식 비용',
};

export const COMMON_LABEL: Record<CommonCategory, string> = {
  labor: '인건비',
  rent: '월세',
  maintenance: '관리비',
  utilities: '공과금',
  rental: '렌탈료',
  insurance: '보험료',
  commonAd: '공통 광고비',
  depreciation: '감가상각비',
  otherOperating: '기타 운영비',
};

export const CATEGORY_LABEL: Record<CostCategory, string> = { ...DIRECT_LABEL, ...COMMON_LABEL };

export const FEE_BASE_LABEL: Record<FeeBase, string> = {
  gross: '상품 판매액(할인·환불 전)',
  afterDiscount: '가게 부담 할인 차감 후 금액',
  net: '순매출(할인·환불 차감 후)',
};

export const PROBLEM_TYPE_LABEL: Record<ProblemType, string> = {
  salesDecline: '매출 감소',
  profitDecline: '영업이익 감소',
  other: '기타',
};

export const STATUS_LABEL: Record<SolutionStatus, string> = {
  planned: '계획',
  running: '실행 중',
  reviewPending: '검증 대기',
  done: '완료',
  stopped: '중단',
};

export const DIRECTION_LABEL: Record<SolutionDirection, string> = {
  revenue: '매출 증가',
  cost: '비용 개선',
  mixed: '복합',
};

export const DECISION_LABEL: Record<Decision, string> = {
  keep: '유지·확대',
  revise: '수정 후 재시험',
  stop: '중단',
};

export interface MetricMeta {
  label: string;
  unit: Unit;
  /** 채널 지정이 가능한가 */
  channelScoped: boolean;
  /** 전체 기준이 가능한가 */
  allowAll: boolean;
  higherIsBetter: boolean;
}

export const METRIC_META: Record<MetricKey, MetricMeta> = {
  totalSales: { label: '총매출', unit: 'won', channelScoped: false, allowAll: true, higherIsBetter: true },
  operatingProfit: { label: '영업이익', unit: 'won', channelScoped: false, allowAll: true, higherIsBetter: true },
  operatingMargin: { label: '영업이익률', unit: 'pct', channelScoped: false, allowAll: true, higherIsBetter: true },
  salesPerBusinessDay: { label: '영업일당 매출', unit: 'won', channelScoped: false, allowAll: true, higherIsBetter: true },
  netSales: { label: '판매 방식 순매출', unit: 'won', channelScoped: true, allowAll: false, higherIsBetter: true },
  orders: { label: '완료 주문 수', unit: 'orders', channelScoped: true, allowAll: true, higherIsBetter: true },
  visitors: { label: '홀 방문 고객 수', unit: 'people', channelScoped: true, allowAll: false, higherIsBetter: true },
  avgTicket: { label: '객단가·평균 주문금액', unit: 'won', channelScoped: true, allowAll: false, higherIsBetter: true },
  directProfit: { label: '판매 방식 비용을 뺀 금액', unit: 'won', channelScoped: true, allowAll: true, higherIsBetter: true },
  directCostPerOrder: { label: '주문당 판매 방식 비용', unit: 'won', channelScoped: true, allowAll: false, higherIsBetter: false },
  directProfitPerOrder: { label: '주문 1건당 남는 금액', unit: 'won', channelScoped: true, allowAll: false, higherIsBetter: true },
  storeDiscount: { label: '가게 부담 할인액', unit: 'won', channelScoped: true, allowAll: true, higherIsBetter: false },
};

export function metricLabel(key: MetricKey, channel: Channel | 'all'): string {
  const m = METRIC_META[key];
  if (key === 'avgTicket' && channel === 'hall') return '홀 객단가';
  if (key === 'avgTicket' && channel !== 'all') return `${CHANNEL_LABEL[channel]} 평균 주문금액`;
  if (!m.channelScoped || channel === 'all') return channel === 'all' && m.channelScoped ? `전체 ${m.label}` : m.label;
  return `${CHANNEL_LABEL[channel]} ${m.label}`;
}

/**
 * 쉬운 이름. 정확한 용어(metricLabel) 옆에 함께 보여준다. 쉬운 이름이 따로 없는 지표는 null.
 * 예: 판매 방식 비용을 뺀 금액(배달) → "배달에서 남은 돈"
 */
export function easyMetricName(key: MetricKey, channel: Channel | 'all'): string | null {
  const ch = channel === 'all' ? null : CHANNEL_LABEL[channel];
  switch (key) {
    case 'directProfit':
      return ch ? `${ch}에서 남은 돈` : '판매 방식별 남은 돈 합계';
    case 'directProfitPerOrder':
      return ch ? `${ch} 1건당 남은 돈` : '주문 1건당 남은 돈';
    case 'directCostPerOrder':
      return ch ? `${ch} 1건당 든 비용` : '주문 1건당 든 비용';
    case 'operatingProfit':
      return '가게에 남은 돈';
    case 'storeDiscount':
      return ch ? `${ch} 쿠폰·할인으로 낸 돈` : '쿠폰·할인으로 낸 돈';
    default:
      return null;
  }
}

/** 정확한 정의 (보조 설명) */
export const METRIC_DEFINITION: Partial<Record<MetricKey, string>> = {
  directProfit: '순매출 − 그 판매 방식 비용(식재료·수수료·배달비·포장비 등). 공통 운영비 빼기 전',
  directProfitPerOrder: '판매 방식 비용을 뺀 금액 ÷ 완료 주문 수. 공통 운영비 빼기 전',
  directCostPerOrder: '판매 방식 비용 ÷ 완료 주문 수',
  operatingProfit: '판매 방식 비용을 뺀 금액 합계 − 공통 운영비(인건비·월세 등)',
  storeDiscount: '가게가 부담한 쿠폰·할인 금액(플랫폼 부담분 제외). 할인·환불 상세를 입력한 기록만 더합니다',
};

/** "배달에서 남은 돈 (배달 판매 방식 비용을 뺀 금액)" — 쉬운 이름이 없으면 정확한 용어만 */
export function metricLabelEasy(key: MetricKey, channel: Channel | 'all'): string {
  const easy = easyMetricName(key, channel);
  const exact = metricLabel(key, channel);
  return easy ? `${easy} (${exact})` : exact;
}
