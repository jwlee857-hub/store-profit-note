import { isValidDate, overlapDays } from './dates';
import { josa } from './format';
import { applicableCategories, isOpenDay, routeHasPlatform } from './calc';
import { CATEGORY_LABEL, CHANNEL_LABEL, DIRECT_LABEL } from './labels';
import { DIRECT_CATEGORIES, type AppData, type PeriodCost, type SalesEntry } from './types';

export type FieldErrors = Record<string, string>;

export interface ValidationResult {
  errors: FieldErrors; // 저장 차단
  warnings: FieldErrors; // 저장 가능, 확인 요청
}

const isNonNegInt = (n: number) => Number.isInteger(n) && n >= 0;

export function validateSalesEntry(e: SalesEntry, data: AppData): ValidationResult {
  const errors: FieldErrors = {};
  const warnings: FieldErrors = {};

  if (!isValidDate(e.date)) errors.date = '날짜를 입력하세요.';
  const route = data.routes.find((r) => r.id === e.routeId);
  if (!route) errors.routeId = '주문 경로를 선택하세요.';
  else if (!route.channels.includes(e.channel)) errors.routeId = `이 주문 경로는 ${CHANNEL_LABEL[e.channel]} 판매 방식에 연결되어 있지 않습니다.`;

  if (e.orders === null) errors.orders = '완료 주문 수를 입력하세요. 주문이 없으면 0을 입력합니다.';
  else if (!isNonNegInt(e.orders)) errors.orders = '완료 주문 수는 0 이상의 정수입니다.';

  if (e.storeDiscount !== null && e.storeDiscount < 0) errors.storeDiscount = '할인액은 0 이상으로 입력합니다.';
  if (e.refund !== null && e.refund < 0) errors.refund = '환불액은 0 이상으로 입력합니다.';

  // 금액 칸: 판매액 기준은 gross, 순매출 기준은 netInput
  const amountKey = e.amountMode === 'net' ? 'netInput' : 'gross';
  const amount = e.amountMode === 'net' ? e.netInput : e.gross;
  if (e.amountMode === 'net') {
    if (e.netInput === null) errors.netInput = '매출 금액을 입력하세요. 매출이 없었으면 0을 입력합니다.';
    else if (e.netInput < 0) errors.netInput = '매출 금액은 0 이상입니다.';
  } else {
    if (e.gross === null) errors.gross = '상품 판매액을 입력하세요.';
    else if (e.gross < 0) errors.gross = '상품 판매액은 0 이상입니다.';
    // 판매액 기준에서 할인·환불을 비워 두면 순매출을 확정할 수 없다 (0으로 가정하지 않음)
    if (e.storeDiscount === null && !errors.storeDiscount) errors.storeDiscount = '가게 부담 할인이 없었다면 0을 입력하세요. 모르면 "할인·환불 반영 후 매출" 기준으로 입력하세요.';
    if (e.refund === null && !errors.refund) errors.refund = '환불이 없었다면 0을 입력하세요.';
    if (e.gross !== null && (e.storeDiscount ?? 0) + (e.refund ?? 0) > e.gross)
      errors.refund = '할인액과 환불액의 합이 상품 판매액보다 큽니다. 이미 반영된 금액을 다시 넣지 않았는지 확인하세요.';
  }

  if (e.orders !== null && amount !== null) {
    if (e.orders === 0 && amount > 0) errors.orders = '주문이 0건인데 매출 금액이 있습니다. 수량과 금액을 확인하세요.';
    if (e.orders > 0 && amount === 0) warnings[amountKey] = '주문은 있는데 매출 금액이 0원입니다. 전액 할인이 아니라면 확인하세요.';
    if (e.orders > 0 && amount / e.orders > 1_000_000) warnings[amountKey] = '주문당 금액이 100만 원을 넘습니다. 단위를 확인하세요.';
  }

  if (e.channel === 'hall') {
    if (e.visitors !== null) {
      if (!isNonNegInt(e.visitors)) errors.visitors = '방문 고객 수는 0 이상의 정수입니다.';
      else if (e.visitors === 0 && (e.orders ?? 0) > 0) errors.visitors = '주문이 있는데 방문 고객 수가 0명입니다.';
      else if (e.orders !== null && e.visitors < e.orders) warnings.visitors = '방문 고객 수가 주문 수보다 적습니다. 홀 주문 수(영수증 수)와 고객 수를 확인하세요.';
    } else if ((e.orders ?? 0) > 0) {
      warnings.visitors = '방문 고객 수를 비워두면 이 날은 홀 방문 고객 수·객단가 계산에서만 빠집니다.';
    }
  } else if (e.visitors !== null) {
    errors.visitors = '방문 고객 수는 홀에서만 사용합니다.';
  }

  for (const cat of DIRECT_CATEGORIES) {
    const cv = e.costs[cat];
    if (cv.actual !== null && cv.actual < 0) errors[`cost.${cat}`] = '비용은 0 이상으로 입력합니다.';
    if (cv.estimated !== null && cv.estimated < 0) errors[`cost.${cat}`] = '추정 비용은 0 이상입니다.';
  }
  if (e.bundledFee && (e.costs.payment.actual !== null || e.costs.payment.estimated !== null))
    errors['cost.payment'] = '묶음 수수료를 쓰는 경우 결제 수수료를 따로 입력하지 않습니다(중복 부과 방지).';

  const hasPlatform = route ? routeHasPlatform(data, route.id) : false;
  const appl = new Set(applicableCategories(e.channel, hasPlatform));
  for (const cat of DIRECT_CATEGORIES) {
    const cv = e.costs[cat];
    if (!appl.has(cat) && (cv.actual !== null || cv.estimated !== null))
      warnings[`cost.${cat}`] = `${josa(DIRECT_LABEL[cat], '은/는')} ${CHANNEL_LABEL[e.channel]} 판매 방식의 일반 항목이 아닙니다.`;
  }

  if (amount !== null) {
    const directSum = DIRECT_CATEGORIES.reduce((s, c) => s + (e.costs[c].actual ?? e.costs[c].estimated ?? 0), 0);
    if (directSum > amount * 1.5 && amount > 0) warnings.costs = '판매 방식 비용 합계가 매출 금액보다 크게 높습니다. 금액 단위를 확인하세요.';
  }

  const dup = findDuplicates(e, data);
  if (dup.exact) errors.date = '같은 날짜·판매 방식·주문 경로·결제수단의 입력이 이미 있습니다. 기존 입력을 수정하세요.';
  else if (dup.sameSlot.length)
    warnings.duplicate = `같은 날짜·판매 방식·주문 경로에 결제수단이 다른 기록 ${dup.sameSlot.length}건이 이미 있습니다. 저장하면 합계에 더해집니다.`;

  if (isValidDate(e.date) && !isOpenDay(data, e.date)) warnings.date = '휴업일로 설정된 날짜입니다. 영업일 설정을 확인하세요.';

  // 같은 항목이 기간 비용으로도 등록되어 있는지 (중복 반영 위험)
  for (const cat of DIRECT_CATEGORIES) {
    const cv = e.costs[cat];
    if (cv.actual === null && cv.estimated === null) continue;
    const overlap = data.periodCosts.find(
      (pc) => pc.category === cat && (pc.attribution === e.channel || pc.attribution === 'common') && e.date >= pc.start && e.date <= pc.end,
    );
    if (overlap) warnings[`cost.${cat}`] = `${josa(DIRECT_LABEL[cat], '이/가')} 기간별 비용으로도 등록되어 있습니다. 같은 비용을 두 번 넣지 않았는지 확인하세요.`;
  }

  return { errors, warnings };
}

/** 같은 날짜·채널·경로의 기존 기록. exact = 결제수단까지 같은 기록(중복) */
export function findDuplicates(e: Pick<SalesEntry, 'id' | 'date' | 'channel' | 'routeId' | 'paymentMethodId'>, data: Pick<AppData, 'sales'>): { exact: SalesEntry | null; sameSlot: SalesEntry[] } {
  const same = data.sales.filter((s) => s.id !== e.id && s.date === e.date && s.channel === e.channel && s.routeId === e.routeId);
  return { exact: same.find((s) => s.paymentMethodId === e.paymentMethodId) ?? null, sameSlot: same.filter((s) => s.paymentMethodId !== e.paymentMethodId) };
}

export function validatePeriodCost(pc: PeriodCost, data: AppData): ValidationResult {
  const errors: FieldErrors = {};
  const warnings: FieldErrors = {};
  if (!isValidDate(pc.start)) errors.start = '시작일을 입력하세요.';
  if (!isValidDate(pc.end)) errors.end = '종료일을 입력하세요.';
  if (isValidDate(pc.start) && isValidDate(pc.end) && pc.start > pc.end) errors.end = '종료일이 시작일보다 빠릅니다.';
  if (!Number.isFinite(pc.amount)) errors.amount = '금액을 입력하세요.';
  else if (pc.amount < 0) errors.amount = '금액은 0 이상입니다.';

  if (!errors.start && !errors.end) {
    const same = data.periodCosts.filter(
      (o) => o.id !== pc.id && o.category === pc.category && overlapDays(o, pc) > 0,
    );
    const conflict = same.find((o) => o.attribution === pc.attribution);
    if (conflict)
      warnings.category = `같은 항목(${CATEGORY_LABEL[pc.category]})·같은 판매 방식의 기간별 비용이 겹칩니다 (${conflict.start}~${conflict.end}). 중복이 아닌지 확인하세요.`;
    else if (same.some((o) => o.attribution === 'common' || pc.attribution === 'common'))
      warnings.attribution = '같은 항목이 공통과 특정 판매 방식으로 겹쳐 등록되어 있습니다. 판매 방식에 직접 반영한 금액을 공통비에서 뺐는지 확인하세요.';

    if ((DIRECT_CATEGORIES as string[]).includes(pc.category)) {
      const inDaily = data.sales.some(
        (s) =>
          s.date >= pc.start &&
          s.date <= pc.end &&
          (pc.attribution === 'common' || s.channel === pc.attribution) &&
          (s.costs[pc.category as keyof SalesEntry['costs']].actual !== null ||
            s.costs[pc.category as keyof SalesEntry['costs']].estimated !== null),
      );
      if (inDaily) warnings.category = `이 기간의 일별 입력에도 ${josa(CATEGORY_LABEL[pc.category], '이/가')} 있습니다. 중복 반영되지 않는지 확인하세요.`;
    }
  }
  return { errors, warnings };
}

export const hasErrors = (r: ValidationResult) => Object.keys(r.errors).length > 0;
