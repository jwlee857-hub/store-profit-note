// 추정값 확인 할 일: 추정값(모르는 값을 가정한 금액)으로 들어간 비용 중 어떤 기간의 어떤 비용을
// 정산서·영수증 금액으로 채우면 '추정 포함'이 사라지는지 목록으로 만든다.
// 설정값을 그대로 적용해 계산한 금액(수수료율·건당 금액·직접 지정 원가율)은 정상 계산이므로 할 일에 넣지 않는다.
// (정산 금액을 따로 넣고 싶으면 기록의 상세 화면에서 넣을 수 있고, 넣으면 그 금액만 합계에 반영된다)
import { effectiveCost, settledByPeriod } from './calc';
import { costKindOf } from './costBasis';
import { inRange } from './dates';
import { ATTRIBUTION_LABEL, CATEGORY_LABEL, CHANNEL_LABEL, DIRECT_LABEL } from './labels';
import type { AppData, Attribution, Channel, CostCategory, DateRange, DateStr, DirectCategory, SalesEntry } from './types';

export type PendingKind = 'fee' | 'direct' | 'period';

export interface PendingItem {
  id: string;
  kind: PendingKind;
  /** 정산서 반영 대기 / 실제 금액 반영 대기 / 청구서 반영 대기 */
  title: string;
  /** 11/01~11/14 배달앱 A(배달) 중개·결제 수수료 */
  label: string;
  start: DateStr;
  end: DateStr;
  categories: CostCategory[];
  /** 매출 기록 기반: 경로·판매 방식 */
  routeId?: string;
  channel?: Channel;
  /** 기간 비용 기반: 귀속 */
  attribution?: Attribution;
  /** 채우면 확정되는 기록 수 */
  count: number;
  /** 지금 들어가 있는 추정 금액 합계 */
  amount: number;
}

const FEE: DirectCategory[] = ['brokerage', 'payment'];

/** 이 기록의 이 항목이 추정값(가정 포함·근거 불분명)인가. 실제값이 있거나 설정값으로 계산한 값이면 아니다 */
function isEstimated(e: SalesEntry, cat: DirectCategory, periodCosts: AppData['periodCosts'] = []): boolean {
  if (cat === 'payment' && e.bundledFee) return false;
  // 정산서 기간 합계로 대체된 수수료는 확인할 일이 아니다
  if ((cat === 'brokerage' || cat === 'payment') && settledByPeriod(periodCosts, e)) return false;
  return costKindOf(cat, e.costs[cat], e) === 'estimated';
}

/** 11/1, 11/14 */
const md = (d: DateStr) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const fmtRange = (a: DateStr, b: DateStr) => (a === b ? md(a) : `${md(a)}~${md(b)}`);

/**
 * 조회 기간의 추정 비용을 확정할 할 일 목록.
 * - 매출 기록의 수수료(중개·결제)는 경로·판매 방식별로 묶어 '정산서 반영 대기'
 * - 그 밖의 판매 방식 비용(식재료·배달비·포장비 등)은 항목별로 '실제 금액 반영 대기'
 * - 기간별 비용(공과금 등)의 추정값은 '청구서 반영 대기'
 * 같은 경로·항목이라도 중간에 실제값이 들어간 기록이 있으면 기간을 나눈다. 금액이 큰 순서.
 */
export function pendingEstimates(data: Pick<AppData, 'sales' | 'routes' | 'periodCosts'>, range: DateRange): PendingItem[] {
  const items: PendingItem[] = [];
  const routeName = (id: string) => data.routes.find((r) => r.id === id)?.name ?? '(삭제된 경로)';
  const byKey = new Map<string, SalesEntry[]>();
  for (const e of data.sales) {
    if (!inRange(e.date, range)) continue;
    const k = `${e.routeId}|${e.channel}`;
    const arr = byKey.get(k);
    if (arr) arr.push(e);
    else byKey.set(k, [e]);
  }
  for (const [k, list] of byKey) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const [routeId, channel] = k.split('|') as [string, Channel];
    const groups: { kind: 'fee' | 'direct'; cats: DirectCategory[] }[] = [
      { kind: 'fee', cats: FEE },
      ...(['food', 'delivery', 'packaging', 'hallSupplies', 'channelAd', 'otherDirect'] as DirectCategory[]).map((c) => ({ kind: 'direct' as const, cats: [c] })),
    ];
    for (const g of groups) {
      let run: { start: DateStr; end: DateStr; count: number; amount: number; cats: Set<DirectCategory> } | null = null;
      const flush = () => {
        if (!run) return;
        const cats = g.cats.filter((c) => run!.cats.has(c));
        const what = g.kind === 'fee' ? (cats.length > 1 ? '중개·결제 수수료' : DIRECT_LABEL[cats[0]]) : DIRECT_LABEL[cats[0]];
        items.push({
          id: `${k}|${g.cats.join('+')}|${run.start}`,
          kind: g.kind,
          title: g.kind === 'fee' ? '정산서 반영 대기' : '실제 금액 반영 대기',
          label: `${fmtRange(run.start, run.end)} ${routeName(routeId)}(${CHANNEL_LABEL[channel]}) ${what}`,
          start: run.start,
          end: run.end,
          categories: cats,
          routeId,
          channel,
          count: run.count,
          amount: run.amount,
        });
        run = null;
      };
      for (const e of list) {
        const est = g.cats.filter((c) => isEstimated(e, c, data.periodCosts));
        if (!est.length) {
          // 이 항목에 실제값이나 설정값으로 계산한 값이 있는 기록은 확인할 것이 없는 날이므로 기간을 끊는다 (해당 항목이 없는 기록은 건너뜀)
          if (g.cats.some((c) => effectiveCost(e.costs[c]).status !== 'missing')) flush();
          continue;
        }
        if (!run) run = { start: e.date, end: e.date, count: 0, amount: 0, cats: new Set() };
        run.amount += est.reduce((s, c) => s + (effectiveCost(e.costs[c]).amount ?? 0), 0);
        run.end = e.date;
        run.count++;
        est.forEach((c) => run!.cats.add(c));
      }
      flush();
    }
  }
  for (const pc of data.periodCosts) {
    if (pc.source !== 'estimated' || pc.start > range.end || pc.end < range.start) continue;
    items.push({
      id: `period|${pc.id}`,
      kind: 'period',
      title: '청구서 반영 대기',
      label: `${fmtRange(pc.start, pc.end)} ${CATEGORY_LABEL[pc.category]} (${ATTRIBUTION_LABEL[pc.attribution]})`,
      start: pc.start,
      end: pc.end,
      categories: [pc.category],
      attribution: pc.attribution,
      count: 1,
      amount: pc.amount,
    });
  }
  return items.sort((a, b) => b.amount - a.amount || a.start.localeCompare(b.start));
}

/** 매출 화면의 '확정 대기' 필터: 이 할 일에 해당하는 매출 기록 (아직 추정값인 것만) */
export function pendingEntries(data: Pick<AppData, 'sales'>, f: { start: DateStr; end: DateStr; routeId: string; channel: Channel; categories: DirectCategory[] }): SalesEntry[] {
  return data.sales
    .filter((e) => e.routeId === f.routeId && e.channel === f.channel && inRange(e.date, { start: f.start, end: f.end }) && f.categories.some((c) => isEstimated(e, c)))
    .sort((a, b) => b.date.localeCompare(a.date));
}
