// 입력된 숫자에 기반한 규칙 진단. 관찰 사실과 확인할 가설을 분리해서 돌려준다.
// 원인을 단정하는 문구는 만들지 않는다.
import {
  bucketTotal,
  channelQuantity,
  compareCalc,
  computeComparison,
  decompose,
  effectiveCost,
  getMetric,
  missingCostCount,
  profitForDisplay,
  type ChannelSummary,
  type Comparison,
  type Decomposition,
  type PeriodSummary,
} from './calc';
import { repurchaseRate } from './customers';
import { WEEKDAY_LABELS, addDays, daysInclusive, inRange, shortDate as shortDay } from './dates';
import { fmt, fmtSigned, josa } from './format';
import { CATEGORY_LABEL, CHANNEL_LABEL, METRIC_META, metricLabel } from './labels';
import {
  CHANNELS,
  COMMON_CATEGORIES,
  DIRECT_CATEGORIES,
  type AppData,
  type Calc,
  type Channel,
  type CostCategory,
  type DateRange,
  type DirectCategory,
  type PeriodCost,
  type Problem,
} from './types';

export interface ChannelChangeRow {
  channel: Channel;
  prev: number;
  cur: number;
  delta: number;
  share: number | null; // 기여율(%) — 상쇄가 없을 때만
}

export interface QuantityPriceRow {
  channel: Channel;
  quantityLabel: string;
  priceLabel: string;
  prevQ: number | null;
  curQ: number | null;
  prevP: Calc;
  curP: Calc;
  decomposition: Decomposition;
  /** 수량이 일부 날짜에만 입력된 경우 (예: "분석 기간 23일 중 22일 기준") */
  basisNote: string | null;
}

export type CostAssessment = 'rateUp' | 'volume' | 'unitUp' | 'unitDown' | 'stable' | 'new' | 'gone' | 'na' | 'fixedSame';

export interface CostChangeRow {
  scope: Channel | 'common';
  category: CostCategory;
  label: string;
  prevTotal: number;
  curTotal: number;
  prevPerUnit: number | null;
  curPerUnit: number | null;
  prevRate: number | null; // % of 매출
  curRate: number | null;
  assessment: CostAssessment;
}

export interface Finding {
  id: string;
  channel: Channel | 'all';
  tone: 'watch' | 'positive' | 'info';
  fact: string;
  /** 홈 요약용 짧은 제목 (예: 홀 방문 고객 수 감소) */
  title: string;
  /** 이 변화가 준 영향의 추정 금액(원). 순위를 매기기 위한 값이며 원인이 확인된 금액이 아니다. 계산할 수 없으면 null */
  impact: number | null;
  /**
   * 영향 금액의 기준. 순위는 영업이익 기준(profit)으로 매기고, 이익으로 바꿀 수 없는 항목(평균 금액 하락 등)은
   * 매출 기준(sales)으로 따로 표시해 이익 항목 뒤에 둔다. 없으면 profit으로 본다.
   */
  impactBasis?: ImpactBasis;
  /** 영향 금액 계산 근거 (예: 줄어든 고객 281명 × 비교 기간 고객 1명당 남는 금액 7,197원) */
  impactNote?: string;
  hypotheses: string[];
  dataNeeded: string[];
  /** 원인 후보로 묶일 때 보여줄 짧은 변화 문구 (예: 가게 부담 할인 비율 4.2% → 11.6%) */
  change?: string;
}

export type ImpactBasis = 'profit' | 'sales';

/** 상위 문제 목록용: 겹치는 관찰 사실을 대표 항목 하나로 묶고, 나머지는 원인 후보로 붙인다 */
export interface IssueGroup extends Finding {
  related: Finding[];
}

export interface DiagnosisResult {
  prev: PeriodSummary;
  cur: PeriodSummary;
  channelChanges: ChannelChangeRow[];
  totalDelta: number;
  offsetting: boolean;
  channelNote: string;
  quantityPrice: QuantityPriceRow[];
  costChanges: CostChangeRow[];
  findings: Finding[];
  caveats: string[];
  target: { label: string; current: Calc; prevValue: Calc; comparison: Comparison; targetValue: number | null; achieved: boolean | null };
}

const rel = (prev: number, cur: number) => (prev === 0 ? null : (cur - prev) / Math.abs(prev));
const THRESHOLD = 0.05;

export function diagnose(data: AppData, problem: Pick<Problem, 'analysis' | 'compare' | 'channel' | 'target' | 'targetValue'>): DiagnosisResult {
  const { s: cur, p: prev } = computeComparison(data, problem.analysis, problem.compare);
  return diagnoseSummaries(data, prev, cur, problem);
}

export function diagnoseSummaries(
  data: AppData,
  prev: PeriodSummary,
  cur: PeriodSummary,
  problem: Pick<Problem, 'channel' | 'target' | 'targetValue'>,
): DiagnosisResult {
  const focus: Channel[] = problem.channel === 'all' ? CHANNELS : [problem.channel];

  // ① 채널별 매출 변화
  const channelChanges: ChannelChangeRow[] = CHANNELS.map((ch) => ({
    channel: ch,
    prev: prev.channels[ch].netSales,
    cur: cur.channels[ch].netSales,
    delta: cur.channels[ch].netSales - prev.channels[ch].netSales,
    share: null,
  }));
  const totalDelta = channelChanges.reduce((s, r) => s + r.delta, 0);
  const nonZero = channelChanges.filter((r) => Math.round(r.delta) !== 0);
  const offsetting = nonZero.some((r) => r.delta > 0) && nonZero.some((r) => r.delta < 0);
  let channelNote: string;
  if (Math.round(totalDelta) === 0 && nonZero.length === 0) channelNote = '두 기간의 판매 방식별 매출 차이가 없습니다.';
  else if (offsetting)
    channelNote = '늘어난 판매 방식과 줄어든 판매 방식이 서로 상쇄되어, 전체 변화에 대한 기여율(%)은 제시하지 않습니다. 판매 방식별 증감액을 함께 보세요.';
  else {
    for (const r of channelChanges) r.share = totalDelta === 0 ? null : (r.delta / totalDelta) * 100;
    channelNote = '모든 판매 방식이 같은 방향으로 변해 기여율을 함께 표시합니다.';
  }

  // ② 수량 × 평균 금액
  const quantityPrice: QuantityPriceRow[] = focus.map((ch) => {
    const p = prev.channels[ch];
    const c = cur.channels[ch];
    const q0 = p.entryCount ? comparableQuantity(p) : null;
    const q1 = c.entryCount ? comparableQuantity(c) : null;
    return {
      channel: ch,
      quantityLabel: ch === 'hall' ? '방문 고객 수' : '완료 주문 수',
      priceLabel: ch === 'hall' ? '객단가' : '평균 주문금액',
      prevQ: q0,
      curQ: q1,
      prevP: p.avgTicket,
      curP: c.avgTicket,
      decomposition:
        p.salesMissing || c.salesMissing
          ? { ok: false, reason: '판매액 미입력 건이 있어 분해하지 않습니다.' }
          : decompose(p.netSales, q0, c.netSales, q1),
      basisNote: quantityBasisNote(p, c),
    };
  });

  // ③ 비용 변화
  const costChanges: CostChangeRow[] = [];
  for (const ch of focus) {
    const p = prev.channels[ch];
    const c = cur.channels[ch];
    // 비용 합계는 모든 날짜를 포함하므로 주문 수도 모든 날에 있을 때만 주문당 금액을 계산한다
    const q0 = p.ordersDays === p.entryDays ? p.orders : null;
    const q1 = c.ordersDays === c.entryDays ? c.orders : null;
    for (const cat of [...DIRECT_CATEGORIES, ...COMMON_CATEGORIES]) {
      const pb = p.directByCategory[cat];
      const cb = c.directByCategory[cat];
      const prevTotal = bucketTotal(pb);
      const curTotal = bucketTotal(cb);
      if (prevTotal === 0 && curTotal === 0) continue;
      const prevPerUnit = q0 ? prevTotal / q0 : null;
      const curPerUnit = q1 ? curTotal / q1 : null;
      const prevRate = p.netSales ? (prevTotal / p.netSales) * 100 : null;
      const curRate = c.netSales ? (curTotal / c.netSales) * 100 : null;
      costChanges.push({
        scope: ch,
        category: cat,
        label: CATEGORY_LABEL[cat],
        prevTotal,
        curTotal,
        prevPerUnit,
        curPerUnit,
        prevRate,
        curRate,
        assessment: fixedOr(
          periodCostUnchanged(data, cat, ch, prev.range, cur.range),
          assess(prevTotal, curTotal, prevPerUnit, curPerUnit, prevRate, curRate),
        ),
      });
    }
  }
  const prevSales = prev.totalSales.value ?? prev.totalSales.provisional ?? 0;
  const curSales = cur.totalSales.value ?? cur.totalSales.provisional ?? 0;
  for (const cat of COMMON_CATEGORIES) {
    const pb = prev.commonByCategory[cat];
    const cb = cur.commonByCategory[cat];
    const prevTotal = bucketTotal(pb);
    const curTotal = bucketTotal(cb);
    if (prevTotal === 0 && curTotal === 0) continue;
    const prevPerUnit = prev.businessDays ? prevTotal / prev.businessDays : null;
    const curPerUnit = cur.businessDays ? curTotal / cur.businessDays : null;
    costChanges.push({
      scope: 'common',
      category: cat,
      label: CATEGORY_LABEL[cat],
      prevTotal,
      curTotal,
      prevPerUnit,
      curPerUnit,
      prevRate: prevSales ? (prevTotal / prevSales) * 100 : null,
      curRate: curSales ? (curTotal / curSales) * 100 : null,
      assessment: fixedOr(periodCostUnchanged(data, cat, 'common', prev.range, cur.range), assess(prevTotal, curTotal, prevPerUnit, curPerUnit)),
    });
  }

  // ④ 관찰 사실 + 확인할 가설
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  if (prev.businessDays !== cur.businessDays) {
    push({
      id: 'bizdays',
      channel: 'all',
      tone: 'info',
      title: '영업일 수 차이',
      impact: null,
      fact: `영업일 수가 비교 기간 ${prev.businessDays}일에서 분석 기간 ${cur.businessDays}일로 달라졌습니다.${weekdayDiffText(prev, cur)}`,
      hypotheses: ['매출 총액 변화의 일부는 영업일·요일 구성 차이일 수 있습니다. 영업일당 매출도 함께 비교하세요.'],
      dataNeeded: ['휴업 사유와 일자별 영업시간 기록'],
    });
  }

  for (const ch of focus) {
    const p = prev.channels[ch];
    const c = cur.channels[ch];
    if (!p.entryCount || !c.entryCount) {
      if (p.entryCount !== c.entryCount)
        push({
          id: `nodata-${ch}`,
          channel: ch,
          tone: 'info',
          title: `${CHANNEL_LABEL[ch]} 한 기간에만 입력 있음`,
          impact: null,
          fact: `${josa(CHANNEL_LABEL[ch], '은/는')} 한 기간에만 입력이 있습니다.`,
          hypotheses: ['판매 방식 운영 시작·중단 또는 입력 누락인지 확인하세요.'],
          dataNeeded: [`${CHANNEL_LABEL[ch]}의 두 기간 매출 입력`],
        });
      continue;
    }
    const q0 = comparableQuantity(p);
    const q1 = comparableQuantity(c);
    const qr = q0 !== null && q1 !== null ? rel(q0, q1) : null;
    const pr = p.avgTicket.value !== null && c.avgTicket.value !== null ? rel(p.avgTicket.value, c.avgTicket.value) : null;
    const unit = ch === 'hall' ? 'people' : 'orders';
    const dec = quantityPrice.find((r) => r.channel === ch)?.decomposition;
    const vol = dec?.ok ? dec.volumeEffect! : null;
    const price = dec?.ok ? dec.priceEffect! : null;
    const basis = quantityPrice.find((r) => r.channel === ch)?.basisNote;
    const basisTail = basis ? ` (${basis})` : '';
    // 수량 변화의 영업이익 영향 = (Q1 − Q0) × 비교 기간의 단위당 남는 금액(판매 방식 비용 차감 후, 공통 운영비 차감 전).
    // 같은 기준의 단위당 변화(Q1 × Δ단위당 남는 금액)와 더하면 판매 방식 비용을 뺀 금액의 실제 변화와 같다.
    const unitWord = ch === 'hall' ? '고객 1명' : '주문 1건';
    const dpPrevTotal = p.directProfit.value ?? p.directProfit.provisional ?? null;
    const dpUnit0 = dec?.ok && dpPrevTotal !== null ? dpPrevTotal / dec.q0! : null;
    const volImpact: Pick<Finding, 'impact' | 'impactBasis' | 'impactNote'> =
      dpUnit0 !== null
        ? {
            impact: (dec!.q1! - dec!.q0!) * dpUnit0,
            impactBasis: 'profit',
            impactNote: `${dec!.q1! < dec!.q0! ? '줄어든' : '늘어난'} ${ch === 'hall' ? '고객' : '주문'} ${fmt(Math.abs(dec!.q1! - dec!.q0!), unit)} × 비교 기간 ${unitWord}당 남는 금액 ${fmt(dpUnit0, 'won')}`,
          }
        : { impact: vol, impactBasis: 'sales', impactNote: vol !== null ? '판매 방식 비용을 알 수 없어 매출 기준으로 계산' : undefined };
    const priceImpact: Pick<Finding, 'impact' | 'impactBasis' | 'impactNote'> = {
      impact: price,
      impactBasis: 'sales',
      impactNote: price !== null ? `평균 금액 변화 × 분석 기간 ${ch === 'hall' ? '고객 수' : '주문 수'} (매출 기준 — 비용 변화는 따로 봅니다)` : undefined,
    };

    if (ch === 'hall') {
      if (qr !== null && qr <= -THRESHOLD)
        push({
          id: 'hall-visitors-down',
          channel: ch,
          tone: 'watch',
          title: '홀 방문 고객 수 감소',
          ...volImpact,
          fact: `홀 방문 고객 수가 비교 기간보다 ${fmt(Math.abs(q1! - q0!), unit)}(${pctText(qr)}) 감소했습니다.${basisTail}`,
          hypotheses: ['신규 유입, 재방문, 대기 이탈 중 어디서 줄었는지 확인하세요.', '영업시간·요일 구성 변화, 주변 상권 변화도 확인하세요.'],
          dataNeeded: ['방문 시간대별 고객 수', '대기 기록과 대기 중 이탈 수', '재방문 여부(가능한 경우)'],
        });
      else if (qr !== null && qr >= THRESHOLD)
        push({
          id: 'hall-visitors-up',
          channel: ch,
          tone: 'positive',
          title: '홀 방문 고객 수 증가',
          ...volImpact,
          fact: `홀 방문 고객 수가 ${pctText(qr)} 증가했습니다.${basisTail}`,
          hypotheses: ['증가가 특정 요일·시간대·행사에 집중되었는지 확인하세요.'],
          dataNeeded: ['시간대별 방문 기록'],
        });
      if (pr !== null && pr <= -THRESHOLD)
        push({
          id: 'hall-ticket-down',
          channel: ch,
          tone: 'watch',
          title: '홀 객단가 하락',
          ...priceImpact,
          fact: `홀 객단가가 ${fmt(p.avgTicket.value, 'won')}에서 ${fmt(c.avgTicket.value, 'won')}으로 낮아졌습니다.${basisTail}`,
          hypotheses: ['추가 주문(음료·사이드) 감소, 저가 메뉴 비중 증가, 할인 확대 여부를 확인하세요.'],
          dataNeeded: ['메뉴별 판매 수량', '테이블당 인원 구성'],
        });
    } else {
      if (qr !== null && qr >= THRESHOLD)
        push({
          id: `${ch}-orders-up`,
          channel: ch,
          tone: 'positive',
          title: `${CHANNEL_LABEL[ch]} 주문 수 증가`,
          ...volImpact,
          fact: `${CHANNEL_LABEL[ch]} 완료 주문 수가 ${fmt(q0, unit)}에서 ${fmt(q1, unit)}으로 ${pctText(qr)} 증가했습니다.`,
          hypotheses:
            ch === 'takeout'
              ? ['배달이나 홀 고객이 포장으로 옮겨왔는지(판매 방식 이동) 함께 확인하세요.', '포장 증가가 전체 영업이익에 어떻게 반영되는지 확인하세요.']
              : ['할인·광고 등 유입 요인과 주문 증가의 시점이 겹치는지 확인하세요.'],
          dataNeeded: ['주문 경로별 주문 수 추이', '프로모션 실행 기간'],
        });
      else if (qr !== null && qr <= -THRESHOLD)
        push({
          id: `${ch}-orders-down`,
          channel: ch,
          tone: 'watch',
          title: `${CHANNEL_LABEL[ch]} 주문 수 감소`,
          ...volImpact,
          fact: `${CHANNEL_LABEL[ch]} 완료 주문 수가 ${pctText(qr)} 감소했습니다.`,
          hypotheses: ['플랫폼 노출 순위, 영업 노출 시간, 품절·조기 마감 여부를 확인하세요.'],
          dataNeeded: ['플랫폼 노출·클릭 통계(제공되는 경우)', '영업 노출 시간 기록'],
        });
      if (pr !== null && pr <= -THRESHOLD)
        push({
          id: `${ch}-aov-down`,
          channel: ch,
          tone: 'watch',
          title: `${CHANNEL_LABEL[ch]} 평균 주문금액 하락`,
          change: `평균 주문금액 ${fmt(p.avgTicket.value, 'won')} → ${fmt(c.avgTicket.value, 'won')}`,
          ...priceImpact,
          fact: `${CHANNEL_LABEL[ch]} 평균 주문금액이 ${fmt(p.avgTicket.value, 'won')}에서 ${fmt(c.avgTicket.value, 'won')}으로 낮아졌습니다.`,
          hypotheses: ['1인 메뉴 비중 증가, 최소 주문금액 변경, 할인 확대 여부를 확인하세요.'],
          dataNeeded: ['메뉴별 판매 수량', '최소 주문금액 변경 이력'],
        });

      const dp0 = p.directProfitPerOrder.value ?? p.directProfitPerOrder.provisional ?? null;
      const dp1 = c.directProfitPerOrder.value ?? c.directProfitPerOrder.provisional ?? null;
      if (dp0 !== null && dp1 !== null) {
        const r = rel(dp0, dp1);
        if (dp1 < dp0 && (r === null || r <= -THRESHOLD)) {
          push({
            id: `${ch}-unit-profit-down`,
            channel: ch,
            tone: 'watch',
            title: `${CHANNEL_LABEL[ch]} 주문 1건당 남는 금액 감소`,
            impact: c.orders && c.ordersDays === c.entryDays ? (dp1 - dp0) * c.orders : null,
            impactBasis: 'profit',
            impactNote: c.orders && c.ordersDays === c.entryDays ? `분석 기간 주문 ${fmt(c.orders, 'orders')} × 1건당 변화 ${fmtSigned(dp1 - dp0, 'won')}` : undefined,
            fact: `${CHANNEL_LABEL[ch]} 주문 1건당 남는 금액(판매 방식 비용을 뺀 뒤)이 ${fmt(dp0, 'won')}에서 ${fmt(dp1, 'won')}으로 ${fmtSigned(dp1 - dp0, 'won')} 변했습니다.${
              qr !== null && qr > 0 ? ' 주문 수는 늘었지만 주문 1건이 남기는 금액은 줄었습니다.' : ''
            }`,
            hypotheses: ['가게 부담 할인, 수수료 규칙·기준액 변경, 배달비 부담 변화 중 무엇이 커졌는지 아래 비용표에서 확인하세요.'],
            dataNeeded: ['플랫폼 정산서(수수료·배달비 내역)', '쿠폰·할인별 주문 수'],
          });
        }
      }
    }

    // 할인율: 할인·환불 상세가 있는 기록만으로 계산한다(상세 없는 기록은 gross·discount 합계에서 이미 빠져 있음)
    const dr0 = p.gross ? p.discount / p.gross : null;
    const dr1 = c.gross ? c.discount / c.gross : null;
    const detailTail = (() => {
      const one = (label: string, s: ChannelSummary) => {
        const total = s.entryCount - s.salesMissing;
        return s.detailMissing ? `${label} ${total}건 중 ${total - s.detailMissing}건 기준` : null;
      };
      const parts = [one('비교 기간', p), one('분석 기간', c)].filter(Boolean);
      return parts.length ? ` (${parts.join(', ')})` : '';
    })();
    if (dr0 !== null && dr1 !== null && dr1 - dr0 >= 0.01)
      push({
        id: `${ch}-discount-up`,
        channel: ch,
        tone: 'watch',
        title: `${CHANNEL_LABEL[ch]} 가게 부담 할인 비율 상승`,
        change: `가게 부담 할인 비율 ${(dr0 * 100).toFixed(1)}% → ${(dr1 * 100).toFixed(1)}%`,
        impact: -(dr1 - dr0) * c.gross,
        impactBasis: 'profit',
        impactNote: '늘어난 할인 비율 × 분석 기간 판매액 (가게가 더 부담한 할인액)',
        fact: `${CHANNEL_LABEL[ch]} 가게 부담 할인 비율이 ${(dr0 * 100).toFixed(1)}%에서 ${(dr1 * 100).toFixed(1)}%로 높아졌습니다.${detailTail}`,
        hypotheses: ['할인으로 늘어난 주문이 할인 비용을 넘는 이익을 남겼는지 확인하세요.'],
        dataNeeded: ['할인 적용 주문과 미적용 주문의 수·금액'],
      });

    // 비용 단위 변화
    for (const row of costChanges.filter((r) => r.scope === ch)) {
      if (row.assessment === 'unitUp' && row.curTotal - row.prevTotal > 0) {
        const per = '주문당';
        push({
          id: `${ch}-cost-${row.category}`,
          channel: ch,
          tone: 'watch',
          title: `${CHANNEL_LABEL[ch]} 주문당 ${row.label} 증가`,
          change: `주문당 ${row.label} ${fmt(row.prevPerUnit, 'won')} → ${fmt(row.curPerUnit, 'won')}`,
          impact: row.curPerUnit !== null && row.prevPerUnit !== null && c.orders && c.ordersDays === c.entryDays ? -(row.curPerUnit - row.prevPerUnit) * c.orders : null,
          fact: `${CHANNEL_LABEL[ch]} ${josa(row.label, '이/가')} ${per}${fmt(row.prevPerUnit, 'won')}에서 ${fmt(row.curPerUnit, 'won')}으로 늘었고, 매출 대비 비율은 ${rateText(row.prevRate)} → ${rateText(row.curRate)}입니다.`,
          hypotheses: costHypotheses(row.category),
          dataNeeded: costDataNeeded(row.category),
        });
      } else if (row.assessment === 'rateUp') {
        push({
          id: `${ch}-rate-${row.category}`,
          channel: ch,
          tone: 'watch',
          title: `${CHANNEL_LABEL[ch]} 매출 대비 ${row.label} 비율 상승`,
          change: `매출 대비 ${row.label} 비율 ${rateText(row.prevRate)} → ${rateText(row.curRate)}`,
          impact: row.curRate !== null && row.prevRate !== null ? -((row.curRate - row.prevRate) / 100) * c.netSales : null,
          fact: `${CHANNEL_LABEL[ch]} ${row.label}의 주문당 금액은 ${fmt(row.prevPerUnit, 'won')} → ${fmt(row.curPerUnit, 'won')}으로 비슷하지만, 매출 대비 비율은 ${rateText(row.prevRate)} → ${rateText(row.curRate)}로 올랐습니다.`,
          hypotheses: ['평균 주문금액이나 객단가가 낮아져 같은 비용이 매출에서 차지하는 비중이 커졌을 수 있습니다. ②의 평균 금액 변화와 함께 보세요.'],
          dataNeeded: ['메뉴별 판매 수량', '할인 적용 전후 주문금액'],
        });
      }
    }
  }

  for (const row of costChanges.filter((r) => r.scope === 'common')) {
    if (row.assessment === 'unitUp' && row.curTotal > row.prevTotal)
      push({
        id: `common-${row.category}`,
        channel: 'all',
        tone: 'watch',
        title: `${row.label} 증가 (영업일당)`,
        impact: row.curPerUnit !== null && row.prevPerUnit !== null ? -(row.curPerUnit - row.prevPerUnit) * cur.businessDays : null,
        change: `영업일당 ${row.label} ${fmt(row.prevPerUnit, 'won')} → ${fmt(row.curPerUnit, 'won')}`,
        fact: `공통 운영비 중 ${josa(row.label, '이/가')} 영업일당 ${fmt(row.prevPerUnit, 'won')}에서 ${fmt(row.curPerUnit, 'won')}으로 늘었습니다.`,
        hypotheses: costHypotheses(row.category),
        dataNeeded: costDataNeeded(row.category),
      });
  }

  // 고객 집계(선택 입력)
  for (const m of data.customerMetrics) {
    const r = repurchaseRate(m);
    if (r.rate.value === null) continue;
    if (m.channel !== 'all' && !focus.includes(m.channel)) continue;
    push({
      id: `cust-${m.id}`,
      channel: m.channel,
      tone: 'info',
      title: '30일 재구매율 (참고)',
      impact: null,
      fact: `${m.label || '고객 집계'}: 30일 재구매율 ${r.rate.value.toFixed(1)}% (${m.repurchased30}명 / ${m.observedCustomers}명)${
        r.observationComplete ? '' : ' — 관찰 기간이 끝나지 않아 잠정치입니다.'
      }`,
      hypotheses: ['재구매율은 매출 진단의 보조 자료입니다. 비교할 이전 집단과 함께 보세요.'],
      dataNeeded: r.observationComplete ? [] : ['관찰 기준일이 첫 구매 집단 종료일 + 30일 이후가 된 뒤 다시 집계'],
    });
  }

  // 데이터 주의사항
  const caveats: string[] = [];
  for (const [label, s] of [
    ['비교 기간', prev],
    ['분석 기간', cur],
  ] as const) {
    if (s.entryCount === 0) caveats.push(`${label}에 매출 입력이 없습니다.`);
    if (s.status.missingCount) caveats.push(`${label}에 누락된 항목이 ${s.status.missingCount}개 있어 영업이익을 확정할 수 없습니다.`);
    if (s.status.estimatedAmount > 0) caveats.push(`${label} 비용 중 ${fmt(s.status.estimatedAmount, 'won')}은 모르는 값을 가정한 추정값입니다.`);    const detailMissing = CHANNELS.reduce((n, c) => n + s.channels[c].detailMissing, 0);
    if (detailMissing) caveats.push(`${label}에 할인·환불 상세 없이 순매출만 입력한 기록이 ${detailMissing}건 있어, 할인 비율은 상세가 있는 기록만으로 계산합니다.`);
    if (s.pairedExcluded.length)
      caveats.push(`${label}에서도 분석 기간 미입력일과 같은 순서의 날(${s.pairedExcluded.map(shortDay).join(', ')})을 빼고 비교했습니다.`);
    if (s.unrecordedDays.length)
      caveats.push(`${label}의 미입력 영업일 ${s.unrecordedDays.length}일(${s.unrecordedDays.map(shortDay).join(', ')})은 매출·영업일 수·기간 비용 계산에서 뺐습니다.`);
  }

  // 목표 지표
  const current = getMetric(cur, problem.target);
  const prevValue = getMetric(prev, problem.target);
  const meta = METRIC_META[problem.target.key];
  const kind = meta.unit === 'pct' ? 'ratio' : problem.target.key === 'operatingProfit' || problem.target.key === 'directProfit' ? 'profit' : 'normal';
  let achieved: boolean | null = null;
  if (problem.targetValue !== null && current.value !== null)
    achieved = meta.higherIsBetter ? current.value >= problem.targetValue : current.value <= problem.targetValue;

  return {
    prev,
    cur,
    channelChanges,
    totalDelta,
    offsetting,
    channelNote,
    quantityPrice,
    costChanges,
    findings,
    caveats,
    target: {
      label: metricLabel(problem.target.key, problem.target.channel),
      current,
      prevValue,
      comparison: compareCalc(prevValue, current, kind),
      targetValue: problem.targetValue,
      achieved,
    },
  };
}

function assess(prevTotal: number, curTotal: number, p0: number | null, p1: number | null, rate0: number | null = null, rate1: number | null = null): CostAssessment {
  if (prevTotal === 0 && curTotal > 0) return 'new';
  if (prevTotal > 0 && curTotal === 0) return 'gone';
  if (p0 === null || p1 === null || p0 === 0) return 'na';
  const r = (p1 - p0) / p0;
  if (r >= THRESHOLD) return 'unitUp';
  if (r <= -THRESHOLD) return 'unitDown';
  if (rate0 !== null && rate1 !== null && rate1 - rate0 >= RATE_PP_THRESHOLD) return 'rateUp';
  if (curTotal > prevTotal) return 'volume';
  return 'stable';
}

/** 단위 비용은 비슷하지만 매출 대비 비율이 이만큼(%p) 오르면 별도로 표시 */
const RATE_PP_THRESHOLD = 1;

export const ASSESSMENT_LABEL: Record<CostAssessment, string> = {
  rateUp: '단위 비용은 비슷하나 매출 대비 비율 상승',
  volume: '수량 증가에 따른 증가(단위 비용 유지)',
  unitUp: '단위당 비용 증가',
  unitDown: '단위당 비용 감소',
  stable: '큰 변화 없음',
  new: '새로 발생',
  gone: '발생 없음',
  na: '비교 불가',
  fixedSame: '월 금액 그대로 (날짜·영업일 수 차이)',
};

/** 기간 비용의 한 달 금액. 달력 월 단위로 등록한 비용은 한 달 금액, 그 밖은 30일 기준으로 환산 */
function monthlyAmount(pc: Pick<PeriodCost, 'start' | 'end' | 'amount'>): number {
  if (pc.start.endsWith('-01') && addDays(pc.end, 1).endsWith('-01')) {
    const months = (Number(pc.end.slice(0, 4)) - Number(pc.start.slice(0, 4))) * 12 + Number(pc.end.slice(5, 7)) - Number(pc.start.slice(5, 7)) + 1;
    return pc.amount / months;
  }
  return (pc.amount / daysInclusive(pc.start, pc.end)) * 30;
}

/**
 * 기간 비용으로만 잡히는 항목(월세 등)의 월 금액이 두 기간에서 같은가.
 * 같으면 기간 길이·영업일 수 차이로 영업일당·주문당 금액이 달라져도 비용이 늘어난 것으로 보지 않는다.
 * 날마다 입력하는 비용이 섞인 항목은 판단하지 않는다(false).
 */
export function periodCostUnchanged(data: Pick<AppData, 'periodCosts' | 'sales'>, cat: CostCategory, scope: Channel | 'common', prevRange: DateRange, curRange: DateRange): boolean {
  if (scope !== 'common') {
    const daily = data.sales.some(
      (e) => e.channel === scope && (inRange(e.date, prevRange) || inRange(e.date, curRange)) && !!effectiveCost(e.costs[cat as DirectCategory]).amount,
    );
    if (daily) return false;
  }
  const amounts = (r: DateRange) => {
    const s = new Set<number>();
    for (const pc of data.periodCosts) if (pc.category === cat && pc.attribution === scope && pc.start <= r.end && pc.end >= r.start) s.add(Math.round(monthlyAmount(pc)));
    return s;
  };
  const a = amounts(prevRange);
  const b = amounts(curRange);
  return a.size > 0 && a.size === b.size && [...a].every((x) => b.has(x));
}

function fixedOr(unchanged: boolean, a: CostAssessment): CostAssessment {
  return unchanged && (a === 'unitUp' || a === 'unitDown' || a === 'rateUp' || a === 'volume') ? 'fixedSame' : a;
}

/**
 * 두 기간을 비교할 수량(홀 방문 고객 수·완료 주문 수).
 * 모든 날에 입력돼 있으면 입력값 합계 그대로. 일부 날짜에만 있으면 평균 금액(입력된 날의 매출 ÷ 수량)은 그대로 두고,
 * 기간 매출 전체를 그 평균 금액으로 나눠 환산한다(빠진 날의 수량 추정). 하루 누락으로 수량이 줄어든 것처럼 보이지 않게 하기 위함.
 */
function comparableQuantity(s: ChannelSummary): number | null {
  const q = channelQuantity(s);
  if (q === null) return null;
  const hall = s.channel === 'hall';
  if ((hall ? s.visitorsDays : s.ordersDays) >= s.entryDays) return q;
  const qNet = hall ? s.visitorsNet : s.ordersNet;
  if (qNet <= 0) return null;
  return (q * s.netSales) / qNet;
}

/** 분석·비교 기간 중 수량(방문 고객 수·주문 수)이 일부 날짜에만 있으면 "분석 기간 23일 중 22일 입력 기준" */
function quantityBasisNote(p: ChannelSummary, c: ChannelSummary): string | null {
  const one = (label: string, s: ChannelSummary) => {
    const used = s.channel === 'hall' ? s.visitorsDays : s.ordersDays;
    return s.entryCount && used < s.entryDays ? `${label} ${s.entryDays}일 중 ${used}일 입력 기준` : null;
  };
  const parts = [one('비교 기간', p), one('분석 기간', c)].filter(Boolean);
  if (!parts.length) return null;
  const what = p.channel === 'hall' ? '손님 수' : '주문 수';
  return `${parts.join(', ')} · 빠진 날의 ${what}는 평균 금액으로 환산한 추정`;
}

/** 진단 ② 한 줄 요약. 예: "손님 수가 줄어 −338만 원, 객단가가 늘어 +56만 원 → 매출 …" */
export function quantityPriceText(r: QuantityPriceRow): string {
  const d = r.decomposition;
  if (!d.ok) return `${CHANNEL_LABEL[r.channel]}: ${d.reason}`;
  const q = r.channel === 'hall' ? '손님 수' : '주문 수';
  const pz = r.channel === 'hall' ? '객단가' : '평균 주문금액';
  const part = (v: number, what: string) => `${josa(what, '이/가')} ${v >= 0 ? '늘어' : '줄어'} ${v >= 0 ? '+' : '−'}${fmtMan(v)}`;
  return `${CHANNEL_LABEL[r.channel]}: ${part(d.volumeEffect!, q)}, ${part(d.priceEffect!, pz)} → 매출 ${fmtSigned(d.delta!, 'won')}${r.basisNote ? ` (${r.basisNote})` : ''}`;
}

function pctText(r: number): string {
  return `${(Math.abs(r) * 100).toFixed(1)}%`;
}
function rateText(r: number | null) {
  return r === null ? '계산 불가' : `${r.toFixed(1)}%`;
}

function weekdayDiffText(prev: PeriodSummary, cur: PeriodSummary): string {
  const diffs: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = cur.weekdayCounts[i] - prev.weekdayCounts[i];
    if (d !== 0) diffs.push(`${WEEKDAY_LABELS[i]}요일 ${d > 0 ? '+' : ''}${d}일`);
  }
  return diffs.length ? ` (요일 구성: ${diffs.join(', ')})` : '';
}

function costHypotheses(cat: CostCategory): string[] {
  switch (cat) {
    case 'food':
      return ['식재료 매입 단가 상승, 폐기 증가, 원가가 높은 메뉴 비중 증가 가능성을 확인하세요.'];
    case 'brokerage':
    case 'payment':
      return ['수수료 규칙(요율·기준액·정액) 변경 시점과 일치하는지 확인하세요.', '광고형 상품이나 부가 서비스 이용 여부도 확인하세요.'];
    case 'delivery':
      return ['배달 거리·배달비 정책, 고객 부담 배달비 설정 변경을 확인하세요.'];
    case 'packaging':
      return ['포장재 단가 변경이나 주문당 포장재 사용량 변화를 확인하세요.'];
    case 'channelAd':
    case 'commonAd':
      return ['광고비 증가가 주문 증가로 이어졌는지 광고 기간과 주문 추이를 맞춰 보세요.'];
    case 'labor':
      return ['근무 시간·인원 배치가 매출이 낮은 시간대에 몰려 있지 않은지 확인하세요.'];
    default:
      return ['금액 변화의 내역(청구서·영수증)을 확인하세요.'];
  }
}

function costDataNeeded(cat: CostCategory): string[] {
  switch (cat) {
    case 'food':
      return ['주요 식재료 매입 단가 기록', '폐기 기록'];
    case 'brokerage':
    case 'payment':
    case 'delivery':
      return ['플랫폼·카드사 정산서'];
    case 'labor':
      return ['시간대별 근무표', '시간대별 매출'];
    default:
      return ['해당 비용 청구 내역'];
  }
}

/**
 * 먼저 확인할 문제: '확인 필요' 관찰 사실 중 영업이익 영향 금액이 큰 순서로 최대 n개.
 * 매출 기준 금액만 있는 항목은 이익 기준 항목 뒤에, 영향 금액을 계산할 수 없는 항목은 맨 뒤로 보낸다. 원인이 확인된 순위가 아니다.
 */
export function topIssues(dx: Pick<DiagnosisResult, 'findings'>, n = 3): IssueGroup[] {
  return groupFindings(dx.findings.filter((f) => f.tone === 'watch')).slice(0, n);
}

/** 순위 단계: 0 = 영업이익 기준 금액, 1 = 매출 기준 금액(이익과 직접 비교하지 않음), 2 = 금액 없음 */
const impactTier = (f: Finding) => (f.impact === null ? 2 : f.impactBasis === 'sales' ? 1 : 0);

/**
 * 영향 금액이 큰 순서. 영업이익 기준 금액끼리 먼저 비교하고, 매출 기준 금액은 그 뒤에 따로 비교한다
 * (매출 영향과 이익 영향을 한 줄로 세우지 않는다). 금액이 없는 항목은 맨 뒤.
 */
export const byImpact = <T extends Finding>(list: T[]): T[] =>
  list
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const ta = impactTier(a.f);
      const tb = impactTier(b.f);
      if (ta !== tb) return ta - tb;
      const ia = a.f.impact === null ? -1 : Math.abs(a.f.impact);
      const ib = b.f.impact === null ? -1 : Math.abs(b.f.impact);
      return ib - ia || a.i - b.i;
    })
    .map((x) => x.f);

/** "이익 영향 −317만 원" / "매출 영향 −28만 원". 금액이 없으면 null */
export function impactText(f: Pick<Finding, 'impact' | 'impactBasis'>): string | null {
  if (f.impact === null) return null;
  return `${f.impactBasis === 'sales' ? '매출 영향' : '이익 영향'} ${f.impact < 0 ? '−' : '+'}${fmtMan(f.impact)}`;
}

/** 같은 판매 방식의 주문 단위 변화(평균 주문금액·할인 비율·주문당 비용·비용 비율)가 원인 후보인 관찰 사실 */
const isUnitCause = (id: string, ch: string) =>
  id === `${ch}-aov-down` || id === `${ch}-discount-up` || id.startsWith(`${ch}-cost-`) || id.startsWith(`${ch}-rate-`);

/**
 * 겹치는 관찰 사실을 묶는다. 결과(주문 1건당 남는 금액 감소)와 그 원인 후보(평균 주문금액 하락, 할인 비율 상승,
 * 주문당 비용 증가)가 따로 순위에 오르면 같은 이야기를 여러 번 하게 되므로, 대표 항목 아래에 원인 후보로 붙인다.
 * 대표 항목이 없으면 평균 주문금액 하락이 매출 대비 비용 비율 상승을 묶는다. 원인을 확정하는 것이 아니다.
 */
export function groupFindings(findings: Finding[]): IssueGroup[] {
  const used = new Set<string>();
  const groups: IssueGroup[] = [];
  for (const f of findings) {
    const ch = f.channel;
    if (ch === 'all' || ch === 'hall') continue;
    let parentId: string | null = null;
    if (f.id === `${ch}-unit-profit-down`) parentId = f.id;
    else if (f.id === `${ch}-aov-down` && !findings.some((x) => x.id === `${ch}-unit-profit-down`)) parentId = f.id;
    if (!parentId) continue;
    const related = byImpact(
      findings.filter((x) => x.id !== f.id && x.channel === ch && (parentId === `${ch}-unit-profit-down` ? isUnitCause(x.id, ch) : x.id.startsWith(`${ch}-rate-`))),
    );
    related.forEach((x) => used.add(x.id));
    used.add(f.id);
    groups.push({ ...f, related });
  }
  for (const f of findings) if (!used.has(f.id)) groups.push({ ...f, related: [] });
  return byImpact(groups);
}

/** 원인 후보 한 줄 (change가 없으면 제목) */
export function relatedText(f: Finding): string {
  return f.change ?? f.title;
}

/** 큰 금액을 "289만 원"처럼 표기 */
export function fmtMan(n: number): string {
  const a = Math.abs(n);
  if (a < 10000) return fmt(a, 'won');
  return `${Math.round(a / 10000).toLocaleString('ko-KR')}만 원`;
}

/**
 * 홈 상단 한 줄 요약. 실제 계산 결과로 만들고 원인을 단정하지 않는다.
 * 예: "매출은 비슷하지만 예상 영업이익이 289만 원 줄었어요."
 */
export function homeHeadline(prev: PeriodSummary, cur: PeriodSummary): string {
  if (!cur.entryCount) return '선택한 기간에 매출 기록이 아직 없어요.';
  if (!prev.entryCount) return '비교할 이전 기간의 매출 기록이 없어 변화는 아직 계산하지 않아요.';
  const s0 = prev.totalSales.value ?? prev.totalSales.provisional ?? null;
  const s1 = cur.totalSales.value ?? cur.totalSales.provisional ?? null;
  const rs = s0 !== null && s1 !== null ? rel(s0, s1) : null;
  const salesDir = rs === null ? null : Math.abs(rs) < 0.03 ? 0 : rs > 0 ? 1 : -1;
  const salesText =
    salesDir === null ? '매출 변화는 계산할 수 없고' : salesDir === 0 ? '매출은 비슷하' : `매출은 ${(Math.abs(rs!) * 100).toFixed(0)}% ${salesDir > 0 ? '늘었' : '줄었'}`;
  // 비용이 덜 채워진 기간도 입력된 비용만 반영한 잠정값으로 요약하고, 미확정임을 덧붙인다
  const d0 = profitForDisplay(prev.operatingProfit);
  const d1 = profitForDisplay(cur.operatingProfit);
  const p0 = d0.amount;
  const p1 = d1.amount;
  if (p0 === null || p1 === null) {
    const tail = '영업이익은 필요한 비용이 아직 다 입력되지 않아 확정할 수 없어요.';
    return salesDir === null ? `${salesText} ${tail}` : `${salesText}고, ${tail}`;
  }
  const provisional = d0.provisional || d1.provisional;
  const word = provisional ? '영업이익(미확정)' : cur.operatingProfit.estimated || prev.operatingProfit.estimated ? '예상 영업이익' : '영업이익';
  const diff = p1 - p0;
  const profitDir = Math.abs(diff) < Math.max(10000, Math.abs(p0) * 0.03) ? 0 : diff > 0 ? 1 : -1;
  const profitText = profitDir === 0 ? `${word}도 비슷해요.` : `${word}${salesDir !== null && salesDir !== profitDir ? '이' : '도'} ${fmtMan(diff)} ${profitDir > 0 ? '늘었어요' : '줄었어요'}.`;
  if (salesDir === null) return `${salesText} ${profitText}`;
  const join = profitDir !== 0 && salesDir !== profitDir ? '지만' : '고';
  const tail = provisional ? ` 비용 ${missingCostCount(cur) + missingCostCount(prev)}개가 아직 입력되지 않아 실제보다 높게 보일 수 있어요.` : '';
  return `${salesText}${join} ${profitText}${tail}`;
}

export function rangesOverlapNote(a: DateRange, b: DateRange): string | null {
  if (a.start <= b.end && b.start <= a.end) return '분석 기간과 비교 기간이 겹칩니다. 서로 겹치지 않는 기간을 선택하세요.';
  return null;
}
