// 핵심 계산 순수 함수. UI·저장소에 의존하지 않는다.
import { addDays, daysInclusive, eachDay, inRange, overlapDays, weekday } from './dates';
import { costKindOf } from './costBasis';
import { CATEGORY_LABEL, CHANNEL_LABEL, DIRECT_LABEL } from './labels';
import {
  CHANNELS,
  COMMON_CATEGORIES,
  DIRECT_CATEGORIES,
  type AppData,
  type Calc,
  type CalcBasis,
  type Channel,
  type CommonCategory,
  type CostCategory,
  type CostValue,
  type DateRange,
  type DateStr,
  type DirectCategory,
  type MetricRef,
  type PeriodCost,
  type SalesEntry,
} from './types';

// ───────────────────────── 기본 단위 계산 ─────────────────────────

/** 금액 계산에 필요한 매출 기록 필드. amountMode가 없으면 기존 기록(할인·환불 전 판매액 기준)으로 본다 */
export type SalesAmounts = Pick<SalesEntry, 'gross' | 'storeDiscount' | 'refund'> & Partial<Pick<SalesEntry, 'amountMode' | 'netInput'>>;

/**
 * 순매출
 * - 판매액 기준(gross): 상품 판매액 − 가게 부담 할인액 − 환불액. 판매액 미입력이면 null
 *   (v2 이전 기록과 계산 결과를 같게 유지하기 위해 할인·환불 빈칸은 차감하지 않는다. 새 입력은 검증에서 빈칸을 막는다)
 * - 순매출 기준(net): 입력한 순매출 그대로. 할인·환불은 상세 정보일 뿐 다시 빼지 않는다
 */
export function netSales(e: SalesAmounts): number | null {
  if (e.amountMode === 'net') return e.netInput ?? null;
  if (e.gross === null) return null;
  return e.gross - (e.storeDiscount ?? 0) - (e.refund ?? 0);
}

/**
 * 할인·환불 전 판매액
 * - 판매액 기준: 입력값
 * - 순매출 기준: 할인·환불 상세가 모두 있을 때만 순매출 + 할인 + 환불로 복원. 하나라도 모르면 null(추가 정보 필요)
 */
export function grossSales(e: SalesAmounts): number | null {
  if (e.amountMode !== 'net') return e.gross;
  if (e.netInput === null || e.netInput === undefined || e.storeDiscount === null || e.refund === null) return null;
  return e.netInput + e.storeDiscount + e.refund;
}

/** 할인·환불 분석에 쓸 상세가 있는가. 순매출 기준 기록에서 할인·환불을 모르면 false */
export function discountDetailKnown(e: SalesAmounts): boolean {
  if (e.amountMode !== 'net') return e.gross !== null;
  return e.storeDiscount !== null && e.refund !== null && e.netInput !== null && e.netInput !== undefined;
}

export type CostStatus = 'actual' | 'estimated' | 'missing';

/** 실제값이 있으면 실제값만, 없으면 추정값, 둘 다 없으면 누락. 두 값을 합산하지 않는다. */
export function effectiveCost(cv: CostValue | undefined): { amount: number | null; status: CostStatus } {
  if (!cv) return { amount: null, status: 'missing' };
  if (cv.actual !== null && cv.actual !== undefined) return { amount: cv.actual, status: 'actual' };
  if (cv.estimated !== null && cv.estimated !== undefined) return { amount: cv.estimated, status: 'estimated' };
  return { amount: null, status: 'missing' };
}

/** 입력 화면에 보여줄 채널별 직접 비용 항목 */
export function applicableCategories(channel: Channel, hasPlatform: boolean): DirectCategory[] {
  switch (channel) {
    case 'hall':
      return ['food', 'payment', 'hallSupplies', 'channelAd', 'otherDirect'];
    case 'delivery':
      return ['food', 'brokerage', 'payment', 'delivery', 'packaging', 'channelAd', 'otherDirect'];
    case 'takeout':
      return hasPlatform
        ? ['food', 'brokerage', 'payment', 'packaging', 'channelAd', 'otherDirect']
        : ['food', 'payment', 'packaging', 'channelAd', 'otherDirect'];
  }
}

/** 값이 없으면 영업이익을 확정할 수 없는 필수 항목. 0원은 입력으로 인정한다. */
export function requiredCategories(channel: Channel, hasPlatform: boolean, bundled: boolean): DirectCategory[] {
  let req: DirectCategory[];
  switch (channel) {
    case 'hall':
      req = ['food', 'payment', 'hallSupplies'];
      break;
    case 'delivery':
      req = ['food', 'brokerage', 'payment', 'delivery', 'packaging'];
      break;
    case 'takeout':
      req = hasPlatform ? ['food', 'brokerage', 'payment', 'packaging'] : ['food', 'payment', 'packaging'];
      break;
  }
  if (bundled) req = req.filter((c) => c !== 'payment');
  return req;
}

/** 기간 비용을 대상 기간과 겹치는 달력 일수 비율로 안분 */
export function allocatePeriodCost(pc: Pick<PeriodCost, 'start' | 'end' | 'amount'>, range: DateRange): number {
  const total = daysInclusive(pc.start, pc.end);
  if (total <= 0) return 0;
  const ov = overlapDays({ start: pc.start, end: pc.end }, range);
  return (pc.amount * ov) / total;
}

/**
 * 기간 비용 중 계산에 넣는 날짜만큼의 금액. excluded(미입력 영업일)는 대상 기간에서 뺀다.
 * excluded가 비어 있으면 allocatePeriodCost와 같다.
 */
export function allocatePeriodCostCounted(pc: Pick<PeriodCost, 'start' | 'end' | 'amount'>, range: DateRange, excluded: ReadonlySet<DateStr>): number {
  const total = daysInclusive(pc.start, pc.end);
  if (total <= 0) return 0;
  let ov = overlapDays({ start: pc.start, end: pc.end }, range);
  if (ov === 0) return 0;
  for (const d of excluded) if (d >= pc.start && d <= pc.end && inRange(d, range)) ov--;
  return (pc.amount * ov) / total;
}

/** 해당 날짜·채널에 같은 항목의 기간 비용이 등록되어 있는가 (일별 미입력을 기간 비용이 대신하는지) */
export function coveredByPeriodCost(
  periodCosts: PeriodCost[],
  category: CostCategory,
  channel: Channel,
  date: DateStr,
): boolean {
  return periodCosts.some(
    (pc) =>
      pc.category === category &&
      (pc.attribution === channel || pc.attribution === 'common') &&
      date >= pc.start &&
      date <= pc.end,
  );
}

export function routeHasPlatform(data: Pick<AppData, 'routes'>, routeId: string): boolean {
  return !!data.routes.find((r) => r.id === routeId)?.platformId;
}

// ───────────────────────── 영업일 ─────────────────────────

export function isOpenDay(data: Pick<AppData, 'store' | 'dayOverrides'>, date: DateStr): boolean {
  const ov = data.dayOverrides.find((o) => o.date === date);
  if (ov) return ov.open;
  if (!data.store) return true;
  return data.store.regularOpenDays.includes(weekday(date));
}

/**
 * 미입력 영업일: 영업일인데 그날 매출 기록도 '매출 없음' 확인도 없는 날.
 * 입력을 건너뛴 날을 매출 0원으로 보지 않도록 기간 계산(매출·영업일 수·기간 비용)에서 뺀다.
 */
export function unrecordedDays(data: Pick<AppData, 'store' | 'dayOverrides' | 'sales'> & { salesChecks?: AppData['salesChecks'] }, range: DateRange): DateStr[] {
  const recorded = new Set<DateStr>();
  for (const e of data.sales) if (inRange(e.date, range)) recorded.add(e.date);
  for (const c of data.salesChecks ?? []) if (inRange(c.date, range)) recorded.add(c.date);
  return eachDay(range).filter((d) => !recorded.has(d) && isOpenDay(data, d));
}

// ───────────────────────── 기간 요약 ─────────────────────────

/**
 * 비용 합계를 근거별로 나눠 담는다 (costBasis.ts 참고).
 * - actual: 실제 금액(영수증·정산서 확인)
 * - calculated: 설정 기준 계산액(설정값을 입력값에 그대로 적용, 가정 없음)
 * - estimated: 추정액(모르는 값을 가정했거나 근거가 불분명)
 * 합계는 bucketTotal로 구한다.
 */
export interface CostBucket {
  actual: number;
  calculated: number;
  estimated: number;
  missing: number; // 누락 건수
}

const emptyBucket = (): CostBucket => ({ actual: 0, calculated: 0, estimated: 0, missing: 0 });

/** 실제 + 설정 기준 계산 + 추정 (미입력은 더하지 않음) */
export function bucketTotal(b: Pick<CostBucket, 'actual' | 'calculated' | 'estimated'>): number {
  return b.actual + b.calculated + b.estimated;
}

function addTo(b: CostBucket, kind: 'actual' | 'calculated' | 'estimated', amount: number) {
  b[kind] += amount;
}

export interface MissingItem {
  kind: 'sales' | 'cost' | 'common';
  label: string;
}

export interface ChannelSummary {
  channel: Channel;
  entryCount: number;
  gross: number;
  discount: number;
  refund: number;
  netSales: number;
  salesMissing: number; // 매출 금액 미입력 건수
  /** 순매출만 입력하고 할인·환불 상세가 없는 건수. gross·discount·refund 합계에서 빠져 있다 */
  detailMissing: number;
  /** 주문 수가 있는 날만 더한 값 (그날 기록 모두에 주문 수가 있는 날). 그런 날이 없으면 null */
  orders: number | null;
  /** 방문 고객 수가 있는 날만 더한 값 (홀만) */
  visitors: number | null;
  /** 매출 기록이 있는 날 수 */
  entryDays: number;
  /** 주문 수·방문 고객 수가 있는 날 수와 그날들의 순매출 (평균 금액·수량 분해는 같은 날짜끼리 계산) */
  ordersDays: number;
  ordersNet: number;
  visitorsDays: number;
  visitorsNet: number;
  directCost: CostBucket;
  directByCategory: Record<DirectCategory | CommonCategory, CostBucket>;
  directCostCalc: Calc;
  directProfit: Calc;
  avgTicket: Calc;
  costPerOrder: Calc;
  directProfitPerOrder: Calc;
  costRate: Calc;
}

export interface CostBreakdownRow {
  category: CostCategory;
  label: string;
  scope: 'direct' | 'common';
  actual: number;
  calculated: number;
  estimated: number;
  total: number;
  missing: number;
}

export interface DailyRow {
  date: DateStr;
  hall: number;
  delivery: number;
  takeout: number;
  total: number;
  open: boolean;
  /** 미입력 영업일 (계산에서 뺌) */
  unrecorded: boolean;
}

export interface PeriodSummary {
  range: DateRange;
  calendarDays: number;
  businessDays: number;
  weekdayCounts: number[];
  entryCount: number;
  channels: Record<Channel, ChannelSummary>;
  totalSales: Calc;
  totalGross: number;
  directProfitTotal: Calc;
  commonCost: CostBucket;
  commonByCategory: Record<CommonCategory, CostBucket>;
  commonMissingDays: Partial<Record<CommonCategory, number>>;
  operatingProfit: Calc;
  operatingMargin: Calc;
  salesPerBusinessDay: Calc;
  costBreakdown: CostBreakdownRow[];
  daily: DailyRow[];
  /** 비용 근거별 합계: 실제 / 설정 기준 계산 / 추정 */
  status: { actualAmount: number; calculatedAmount: number; estimatedAmount: number; missingCount: number; missing: MissingItem[] };
  salesOnClosedDays: number;
  /** 계산에서 뺀 미입력 영업일 (매출 기록도 '매출 없음' 확인도 없는 영업일) */
  unrecordedDays: DateStr[];
  /** 분석 기간의 미입력 영업일과 짝을 맞추려고 비교 기간에서 뺀 날 */
  pairedExcluded: DateStr[];
}

function div(num: number, den: number | null, scale = 1): Calc {
  if (den === null) return { value: null, reason: 'noData' };
  if (den === 0) return { value: null, reason: 'divZero' };
  return { value: (num / den) * scale };
}

/** 합계에 들어간 비용 근거 표시: 추정이 있으면 estimated, 추정 없이 설정 기준 계산액이 있으면 calculated */
function basisFlags(b: Pick<CostBucket, 'calculated' | 'estimated'>): Pick<Calc, 'estimated' | 'calculated'> {
  return { estimated: b.estimated > 0, calculated: b.estimated <= 0 && b.calculated > 0 };
}

/** 금액 계산 결과에 비용 완결성 상태를 붙인다 */
function withCompleteness(amount: number, missing: number, flags: Pick<Calc, 'estimated' | 'calculated'>, hasData: boolean): Calc {
  if (!hasData) return { value: null, reason: 'noData' };
  if (missing > 0) return { value: null, reason: 'incomplete', provisional: amount };
  return { value: amount, ...flags };
}

function divCalc(num: Calc, den: number | null, scale = 1): Calc {
  if (num.value === null) {
    if (num.reason === 'incomplete') {
      const r = div(num.provisional ?? 0, den, scale);
      return { value: null, reason: 'incomplete', provisional: r.value };
    }
    return { value: null, reason: num.reason ?? 'noData' };
  }
  const r = div(num.value, den, scale);
  return { ...r, estimated: num.estimated, calculated: num.calculated };
}

function allCategoryBuckets(): Record<DirectCategory | CommonCategory, CostBucket> {
  const o = {} as Record<DirectCategory | CommonCategory, CostBucket>;
  for (const c of [...DIRECT_CATEGORIES, ...COMMON_CATEGORIES]) o[c] = emptyBucket();
  return o;
}

/**
 * 두 기간 비교용 요약. 분석 기간의 미입력 영업일과 같은 순서(기간 시작부터 같은 날짜 수)에 있는 비교 기간의 날도 빼서,
 * 입력을 건너뛴 날 때문에 비교 기간보다 하루치가 적게 보이지 않게 한다.
 */
export function computeComparison(data: AppData, cur: DateRange, prev: DateRange): { s: PeriodSummary; p: PeriodSummary } {
  const s = computeSummary(data, cur);
  const paired = s.unrecordedDays.map((d) => addDays(prev.start, daysInclusive(cur.start, d) - 1)).filter((d) => d <= prev.end);
  return { s, p: computeSummary(data, prev, paired) };
}

/**
 * 기간 요약.
 * pairedExcluded: 비교를 맞추기 위해 추가로 뺄 날짜 (computeComparison에서만 사용)
 */
export function computeSummary(data: AppData, range: DateRange, pairedExcluded: readonly DateStr[] = []): PeriodSummary {
  const unrecorded = unrecordedDays(data, range);
  const unrecSet = new Set(unrecorded);
  const paired = pairedExcluded.filter((d) => inRange(d, range) && !unrecSet.has(d));
  const excluded = new Set([...unrecorded, ...paired]);
  const allDays = eachDay(range);
  // 미입력 영업일은 기간 계산(영업일 수·기간 비용·공통비 체크)에서 뺀다
  const days = allDays.filter((d) => !excluded.has(d));
  const entries = data.sales.filter((e) => inRange(e.date, range) && !excluded.has(e.date));
  const missing: MissingItem[] = [];
  let actualAmount = 0;
  let calculatedAmount = 0;
  let estimatedAmount = 0;

  const channels = {} as Record<Channel, ChannelSummary>;
  for (const ch of CHANNELS) {
    const list = entries.filter((e) => e.channel === ch);
    const directByCategory = allCategoryBuckets();
    const bucket = emptyBucket();
    let gross = 0;
    let discount = 0;
    let refund = 0;
    let net = 0;
    let salesMissing = 0;
    let detailMissing = 0;

    // 주문 수·방문 고객 수: 그날 기록 모두에 값이 있는 날만 모아 계산한다(하루 누락이 기간 전체를 지우지 않게)
    const byDay = new Map<DateStr, SalesEntry[]>();
    for (const e of list) {
      const arr = byDay.get(e.date);
      if (arr) arr.push(e);
      else byDay.set(e.date, [e]);
    }
    const coverage = (pick: (e: SalesEntry) => number | null) => {
      let sum = 0;
      let net = 0;
      let n = 0;
      for (const dayEntries of byDay.values()) {
        if (dayEntries.some((e) => pick(e) === null)) continue;
        n++;
        for (const e of dayEntries) {
          sum += pick(e)!;
          net += netSales(e) ?? 0;
        }
      }
      return { sum, net, days: n };
    };
    const oc = coverage((e) => e.orders);
    const vc = ch === 'hall' ? coverage((e) => e.visitors) : { sum: 0, net: 0, days: 0 };
    const entryDays = byDay.size;
    const orders: number | null = oc.days ? oc.sum : null;
    const visitors: number | null = ch === 'hall' && vc.days ? vc.sum : null;
    /** 주문 1건당 비용 등은 비용 합계를 쓰므로 모든 날에 주문 수가 있을 때만 계산 */
    const ordersAll: number | null = oc.days === entryDays ? orders : null;

    for (const e of list) {
      const n = netSales(e);
      if (n === null) {
        salesMissing++;
        missing.push({ kind: 'sales', label: `${e.date} ${CHANNEL_LABEL[ch]} 매출 금액` });
      } else {
        net += n;
        if (e.amountMode === 'net' && !discountDetailKnown(e)) detailMissing++;
        else {
          gross += grossSales(e) ?? 0;
          discount += e.storeDiscount ?? 0;
          refund += e.refund ?? 0;
        }
      }
      const hasPlatform = routeHasPlatform(data, e.routeId);
      const required = new Set(requiredCategories(ch, hasPlatform, e.bundledFee));
      for (const cat of DIRECT_CATEGORIES) {
        if (cat === 'payment' && e.bundledFee) continue; // 묶음 수수료면 결제 수수료를 따로 계산하지 않음
        const { amount } = effectiveCost(e.costs[cat]);
        // 금액은 실제값 우선 규칙 그대로, 근거(실제·설정 기준 계산·추정)는 저장된 근거 문구로 구분한다
        const kind = costKindOf(cat, e.costs[cat], e);
        if (kind !== 'missing') {
          addTo(directByCategory[cat], kind, amount!);
          addTo(bucket, kind, amount!);
        } else if (required.has(cat) && !coveredByPeriodCost(data.periodCosts, cat, ch, e.date)) {
          directByCategory[cat].missing++;
          bucket.missing++;
          missing.push({ kind: 'cost', label: `${e.date} ${CHANNEL_LABEL[ch]} ${DIRECT_LABEL[cat]}` });
        }
      }
    }

    // 채널 귀속 기간 비용 (채널 전용 고정비 등)
    for (const pc of data.periodCosts) {
      if (pc.attribution !== ch) continue;
      const amt = allocatePeriodCostCounted(pc, range, excluded);
      if (amt === 0) continue;
      if (pc.source === 'actual') {
        directByCategory[pc.category].actual += amt;
        bucket.actual += amt;
      } else {
        directByCategory[pc.category].estimated += amt;
        bucket.estimated += amt;
      }
    }

    actualAmount += bucket.actual;
    calculatedAmount += bucket.calculated;
    estimatedAmount += bucket.estimated;

    const hasData = list.length > 0;
    const knownCost = bucketTotal(bucket);
    const directCostCalc = withCompleteness(knownCost, bucket.missing, basisFlags(bucket), hasData);
    const directProfit = withCompleteness(net - knownCost, bucket.missing + salesMissing, basisFlags(bucket), hasData);
    const salesBase: number | null = hasData && salesMissing === 0 ? net : null;

    // 객단가·평균 주문금액: 수량이 있는 날의 매출 ÷ 그날들의 수량
    let avgTicket: Calc;
    const qc = ch === 'hall' ? vc : oc;
    if (!hasData || salesBase === null || qc.days === 0) avgTicket = { value: null, reason: 'noData' };
    else avgTicket = withBasis(div(qc.net, qc.sum), qc.days, entryDays);

    channels[ch] = {
      channel: ch,
      entryCount: list.length,
      gross,
      discount,
      refund,
      netSales: net,
      salesMissing,
      detailMissing,
      orders: hasData ? orders : null,
      visitors: hasData ? visitors : null,
      entryDays,
      ordersDays: oc.days,
      ordersNet: oc.net,
      visitorsDays: vc.days,
      visitorsNet: vc.net,
      directCost: bucket,
      directByCategory,
      directCostCalc,
      directProfit,
      avgTicket,
      costPerOrder: hasData ? divCalc(directCostCalc, ordersAll) : { value: null, reason: 'noData' },
      directProfitPerOrder: hasData ? divCalc(directProfit, ordersAll) : { value: null, reason: 'noData' },
      costRate: hasData ? divCalc(directCostCalc, salesBase, 100) : { value: null, reason: 'noData' },
    };
  }

  // 공통 운영비
  const commonByCategory = {} as Record<CommonCategory, CostBucket>;
  for (const c of COMMON_CATEGORIES) commonByCategory[c] = emptyBucket();
  const commonCost = emptyBucket();
  const commonDirectCats: Partial<Record<CostCategory, CostBucket>> = {};
  for (const pc of data.periodCosts) {
    if (pc.attribution !== 'common') continue;
    const amt = allocatePeriodCostCounted(pc, range, excluded);
    if (amt === 0) continue;
    const target =
      (COMMON_CATEGORIES as string[]).includes(pc.category)
        ? commonByCategory[pc.category as CommonCategory]
        : (commonDirectCats[pc.category] ??= emptyBucket());
    if (pc.source === 'actual') {
      target.actual += amt;
      commonCost.actual += amt;
    } else {
      target.estimated += amt;
      commonCost.estimated += amt;
    }
  }
  actualAmount += commonCost.actual;
  estimatedAmount += commonCost.estimated;

  // 공통비 체크리스트 기간 충족 여부
  const commonMissingDays: Partial<Record<CommonCategory, number>> = {};
  for (const cat of data.store?.commonCostChecklist ?? []) {
    const covering = data.periodCosts.filter((pc) => pc.category === cat);
    const uncovered = days.filter((d) => !covering.some((pc) => d >= pc.start && d <= pc.end)).length;
    if (uncovered > 0) {
      commonMissingDays[cat] = uncovered;
      commonByCategory[cat].missing += 1;
      commonCost.missing += 1;
      missing.push({ kind: 'common', label: `${CATEGORY_LABEL[cat]} ${uncovered}일 미입력` });
    }
  }

  const entryCount = entries.length;
  const hasData = entryCount > 0;
  const salesMissingTotal = CHANNELS.reduce((s, c) => s + channels[c].salesMissing, 0);
  const totalNet = CHANNELS.reduce((s, c) => s + channels[c].netSales, 0);
  const totalGross = CHANNELS.reduce((s, c) => s + channels[c].gross, 0);
  const totalSales: Calc = !hasData
    ? { value: null, reason: 'noData' }
    : salesMissingTotal > 0
      ? { value: null, reason: 'incomplete', provisional: totalNet }
      : { value: totalNet };

  const directMissing = CHANNELS.reduce((s, c) => s + channels[c].directCost.missing, 0);
  const directKnown = CHANNELS.reduce((s, c) => s + bucketTotal(channels[c].directCost), 0);
  // 근거 표시는 기존 규칙과 같이 기간 전체 비용(판매 방식 비용 + 공통 운영비) 기준으로 판단한다
  const allFlags = basisFlags({ calculated: calculatedAmount, estimated: estimatedAmount });
  const directProfitTotal = withCompleteness(totalNet - directKnown, directMissing + salesMissingTotal, allFlags, hasData);
  const commonKnown = bucketTotal(commonCost);
  const operatingProfit = withCompleteness(
    totalNet - directKnown - commonKnown,
    directMissing + salesMissingTotal + commonCost.missing,
    allFlags,
    hasData,
  );
  const operatingMargin = divCalc(operatingProfit, totalSales.value ?? (hasData ? totalNet : null), 100);

  // 영업일
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  let businessDays = 0;
  for (const d of days) {
    if (isOpenDay(data, d)) {
      businessDays++;
      weekdayCounts[weekday(d)]++;
    }
  }
  const salesPerBusinessDay = totalSales.value === null ? { ...totalSales, provisional: null } : div(totalSales.value, businessDays);

  // 일별 추이
  const daily: DailyRow[] = allDays.map((d) => {
    const row: DailyRow = { date: d, hall: 0, delivery: 0, takeout: 0, total: 0, open: isOpenDay(data, d), unrecorded: excluded.has(d) };
    for (const e of entries) {
      if (e.date !== d) continue;
      const n = netSales(e) ?? 0;
      row[e.channel] += n;
      row.total += n;
    }
    return row;
  });
  const salesOnClosedDays = new Set(entries.filter((e) => !isOpenDay(data, e.date)).map((e) => e.date)).size;

  // 비용 구성
  const costBreakdown: CostBreakdownRow[] = [];
  for (const cat of DIRECT_CATEGORIES) {
    const b = CHANNELS.reduce(
      (acc, c) => {
        const x = channels[c].directByCategory[cat];
        return { actual: acc.actual + x.actual, calculated: acc.calculated + x.calculated, estimated: acc.estimated + x.estimated, missing: acc.missing + x.missing };
      },
      emptyBucket(),
    );
    const extra = commonDirectCats[cat];
    if (extra) {
      b.actual += extra.actual;
      b.calculated += extra.calculated;
      b.estimated += extra.estimated;
    }
    if (bucketTotal(b) + b.missing > 0)
      costBreakdown.push({ category: cat, label: DIRECT_LABEL[cat], scope: 'direct', ...b, total: bucketTotal(b) });
  }
  for (const cat of COMMON_CATEGORIES) {
    const b = { ...commonByCategory[cat] };
    for (const c of CHANNELS) {
      // 채널 전용으로 귀속된 공통 성격 항목(예: 배달 전담 인건비)
      b.actual += channels[c].directByCategory[cat].actual;
      b.calculated += channels[c].directByCategory[cat].calculated;
      b.estimated += channels[c].directByCategory[cat].estimated;
    }
    if (bucketTotal(b) + b.missing > 0)
      costBreakdown.push({ category: cat, label: CATEGORY_LABEL[cat], scope: 'common', ...b, total: bucketTotal(b) });
  }

  return {
    range,
    calendarDays: allDays.length,
    businessDays,
    weekdayCounts,
    entryCount,
    channels,
    totalSales,
    totalGross,
    directProfitTotal,
    commonCost,
    commonByCategory,
    commonMissingDays,
    operatingProfit,
    operatingMargin,
    salesPerBusinessDay,
    costBreakdown,
    daily,
    status: { actualAmount, calculatedAmount, estimatedAmount, missingCount: missing.length, missing },
    salesOnClosedDays,
    unrecordedDays: unrecorded,
    pairedExcluded: paired,
  };
}

/** 일부 날짜에만 값이 있으면 '전체 중 며칠 기준'인지 계산 결과에 붙인다 */
function withBasis(c: Calc, used: number, total: number, unit: CalcBasis['unit'] = '일'): Calc {
  return used < total ? { ...c, basis: { used, total, unit } } : c;
}

/** 홀 방문 고객 수·완료 주문 수 표시값 (값이 있는 날만 더한 합계와 기준 일수) */
export function quantityCalc(cs: ChannelSummary, kind: 'orders' | 'visitors'): Calc {
  const v = kind === 'visitors' ? cs.visitors : cs.orders;
  if (v === null) return { value: null, reason: 'noData' };
  return withBasis({ value: v }, kind === 'visitors' ? cs.visitorsDays : cs.ordersDays, cs.entryDays);
}

/** "23일 중 22일 기준" */
export function basisText(b: CalcBasis | undefined | null): string | null {
  return b && b.used < b.total ? `${b.total}${b.unit} 중 ${b.used}${b.unit} 기준` : null;
}

// ───────────────────────── 화면 표시용 ─────────────────────────

/**
 * 영업이익 표시값: 확정값이 있으면 그 값, 비용이 덜 채워졌으면 입력된 비용만 반영한 잠정값(provisional = true).
 * 계산 규칙은 바꾸지 않으며, 잠정값에는 화면에서 '미확정'과 미입력 개수를 함께 표시한다.
 */
export function profitForDisplay(c: Calc): { amount: number | null; provisional: boolean } {
  if (c.value !== null) return { amount: c.value, provisional: false };
  if (c.reason === 'incomplete' && c.provisional !== null && c.provisional !== undefined) return { amount: c.provisional, provisional: true };
  return { amount: null, provisional: false };
}

export function displayValue(c: Calc): number | null {
  return profitForDisplay(c).amount;
}

/** 영업이익을 미확정으로 만드는 미입력 비용 개수 (매출 금액 미입력은 제외) */
export function missingCostCount(s: Pick<PeriodSummary, 'status'>): number {
  return s.status.missing.filter((m) => m.kind !== 'sales').length;
}

// ───────────────────────── 비교 ─────────────────────────

export interface Comparison {
  abs: number | null;
  pct: number | null;
  note: string | null;
}

/**
 * 비교 기간 대비 증감.
 * - 이전 값 0: 증감률 생략, 절대 변화만
 * - kind='profit'에서 이전 값이 음수이거나 부호가 바뀌면: 증감률 대신 흑자·적자 전환 표기
 * - kind='ratio': 차이를 %p로 해석, 증감률 없음
 */
export function compareCalc(prev: Calc, cur: Calc, kind: 'normal' | 'profit' | 'ratio' = 'normal'): Comparison {
  if (prev.value === null || cur.value === null) return { abs: null, pct: null, note: '비교 불가 (데이터 필요)' };
  return compareValues(prev.value, cur.value, kind);
}

export function compareValues(prev: number, cur: number, kind: 'normal' | 'profit' | 'ratio' = 'normal'): Comparison {
  const abs = cur - prev;
  if (kind === 'ratio') return { abs, pct: null, note: null };
  if (kind === 'profit') {
    if (prev < 0 && cur > 0) return { abs, pct: null, note: '흑자 전환' };
    if (prev > 0 && cur < 0) return { abs, pct: null, note: '적자 전환' };
    if (prev < 0 && cur < 0) return { abs, pct: null, note: abs > 0 ? '적자 축소' : abs < 0 ? '적자 확대' : '적자 지속' };
    if (prev < 0 && cur === 0) return { abs, pct: null, note: '손익분기 도달' };
  }
  if (prev === 0) return { abs, pct: null, note: '이전 값이 0이라 증감률 생략' };
  if (prev < 0) return { abs, pct: null, note: '이전 값이 음수라 증감률 생략' };
  return { abs, pct: (abs / prev) * 100, note: null };
}

// ───────────────────────── 지표 조회 ─────────────────────────

export function getMetric(s: PeriodSummary, ref: MetricRef): Calc {
  const ch = ref.channel;
  const allOrders = (): number | null => {
    let sum = 0;
    for (const c of CHANNELS) {
      const cs = s.channels[c];
      if (cs.entryCount === 0) continue;
      if (cs.orders === null || cs.ordersDays < cs.entryDays) return null;
      sum += cs.orders;
    }
    return s.entryCount ? sum : null;
  };
  switch (ref.key) {
    case 'totalSales':
      return s.totalSales;
    case 'operatingProfit':
      return s.operatingProfit;
    case 'operatingMargin':
      return s.operatingMargin;
    case 'salesPerBusinessDay':
      return s.salesPerBusinessDay;
    case 'netSales':
      if (ch === 'all') return s.totalSales;
      return s.channels[ch].entryCount ? { value: s.channels[ch].netSales } : { value: null, reason: 'noData' };
    case 'orders': {
      if (ch !== 'all') return quantityCalc(s.channels[ch], 'orders');
      const v = allOrders();
      return v === null ? { value: null, reason: 'noData' } : { value: v };
    }
    case 'visitors':
      return quantityCalc(s.channels.hall, 'visitors');
    case 'avgTicket':
      if (ch === 'all') return divCalc(s.totalSales, allOrders());
      return s.channels[ch].avgTicket;
    case 'directProfit':
      return ch === 'all' ? s.directProfitTotal : s.channels[ch].directProfit;
    case 'directCostPerOrder':
      if (ch === 'all') return { value: null, reason: 'noData' };
      return s.channels[ch].costPerOrder;
    case 'directProfitPerOrder':
      if (ch === 'all') return divCalc(s.directProfitTotal, allOrders());
      return s.channels[ch].directProfitPerOrder;
    case 'storeDiscount': {
      if (ch !== 'all') return discountCalc(s.channels[ch]);
      const parts = CHANNELS.map((c) => s.channels[c]).filter((c) => c.entryCount > 0);
      if (!parts.length) return { value: null, reason: 'noData' };
      const used = parts.reduce((n, c) => n + c.entryCount - c.salesMissing - c.detailMissing, 0);
      const total = parts.reduce((n, c) => n + c.entryCount - c.salesMissing, 0);
      return withBasis({ value: parts.reduce((n, c) => n + c.discount, 0) }, used, total, '건');
    }
  }
}

/**
 * 가게 부담 할인액(원). 할인·환불 상세가 있는 기록만 더한 값이며,
 * 상세 없이 순매출만 입력한 기록이 있으면 "N건 중 M건 기준"을 붙인다(그 기록의 할인은 알 수 없음, 0원으로 보지 않음).
 */
export function discountCalc(cs: ChannelSummary): Calc {
  if (!cs.entryCount) return { value: null, reason: 'noData' };
  const total = cs.entryCount - cs.salesMissing;
  return withBasis({ value: cs.discount }, total - cs.detailMissing, total, '건');
}

/** 채널의 수량 지표: 홀은 방문 고객 수, 배달·포장은 완료 주문 수 */
export function channelQuantity(cs: ChannelSummary): number | null {
  return cs.channel === 'hall' ? cs.visitors : cs.orders;
}

// ───────────────────────── 수량·평균 금액 분해 ─────────────────────────

export interface Decomposition {
  ok: boolean;
  reason?: string;
  volumeEffect?: number;
  priceEffect?: number;
  delta?: number;
  q0?: number;
  q1?: number;
  p0?: number;
  p1?: number;
}

/**
 * 수량 효과 = (Q1 − Q0) × P0, 평균 금액 효과 = Q1 × (P1 − P0).
 * 두 효과의 합은 R1 − R0과 일치한다. P0 또는 P1이 정의되지 않으면(수량 0·미입력) 분해하지 않는다.
 */
export function decompose(r0: number, q0: number | null, r1: number, q1: number | null): Decomposition {
  if (q0 === null || q1 === null) return { ok: false, reason: '수량 데이터가 없어 분해하지 않습니다.' };
  if (q0 <= 0 || q1 <= 0) return { ok: false, reason: '한 기간의 수량이 0이라 평균 금액이 정의되지 않아 분해하지 않습니다.' };
  const p0 = r0 / q0;
  const p1 = r1 / q1;
  const volumeEffect = (q1 - q0) * p0;
  const priceEffect = q1 * (p1 - p0);
  return { ok: true, volumeEffect, priceEffect, delta: r1 - r0, q0, q1, p0, p1 };
}

// ───────────────────────── 해결안 ─────────────────────────

/** 예상 영업이익 변화 = 예상 매출 변화 − 예상 비용 변화. 예산이 비용에 포함되지 않았다면 예산을 비용에 더한다(한 번만). */
export function expectedProfitChange(
  revenue: number | null,
  costChange: number | null,
  budget: number | null,
  budgetIncluded: boolean,
): number | null {
  if (revenue === null && costChange === null) return null;
  const cost = (costChange ?? 0) + (budgetIncluded ? 0 : budget ?? 0);
  return (revenue ?? 0) - cost;
}

export function sumDirectCategoryAcrossChannels(s: PeriodSummary, cat: DirectCategory | CommonCategory): number {
  return CHANNELS.reduce((acc, c) => acc + bucketTotal(s.channels[c].directByCategory[cat]), 0);
}
