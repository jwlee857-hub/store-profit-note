import { CheckSteps } from '../components/CheckSteps';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Badge,
  BigWon,
  Button,
  CalcValue,
  Card,
  DeltaText,
  EmptyState,
  Field,
  More,
  Notice,
  NumberInput,
  PageHeader,
  Select,
  TableWrap,
  TextArea,
  manText,
  td,
  tdR,
  th,
  thR,
} from '../components/ui';
import { GAP_NOTE, allocatePeriodCost, channelSalesCalc, comparableValue, compareCalc, compareValues, computeSummary, isOpenDay, expectedProfitChange, getMetric, profitForDisplay, type PeriodSummary } from '../domain/calc';
import { RecordGapsNotice } from '../components/RecordGaps';
import { addDays, daysInclusive, dotRange, formatRange, inRange, isFullMonth, isValidRange, krDate, krRange, previousMonth, previousRange } from '../domain/dates';
import { couponText, fmt, fmtKpiTarget, fmtPp, fmtSigned, hasCoupon, pctChangeText, weekdaysText, type Unit } from '../domain/format';
import { appToday, KPI_MODE_LABEL, daysLeft, judgeKpiTarget, rangeProblem, referenceDate, reviewUnavailableReason } from '../domain/periods';
import { CHANNEL_LABEL, DECISION_LABEL, METRIC_DEFINITION, METRIC_META, STATUS_LABEL, easyMetricName, metricLabel, metricLabelEasy } from '../domain/labels';
import { DiscountEfficiencyNote } from '../components/DiscountEfficiency';
import { calcReasons, deliveryChangeText, memoRanges, reasonLine, reviewContext, scopeToRoute, withChannelFrom, type ReviewContext } from '../domain/review';
import { CHANNELS, type Calc, type Channel, type DateRange, type Decision, type MetricRef, type Solution, type SolutionStatus } from '../domain/types';
import { useApp, useData } from '../state/AppContext';

/**
 * 원래 비교 기간: 저장된 비교 기간이 있으면 그대로(새 입력이 늘어도 고정), 없으면 실행 기간과 그 앞 기간.
 * 실행 기간이 달력 한 달이면 실행 전은 지난달 전체(10월 → 9월 1~30일), 아니면 직전 같은 일수.
 */
function defaultReviewRanges(s: Solution, latest: string): { before: DateRange; after: DateRange } {
  if (s.review.before && s.review.after) return { before: s.review.before, after: s.review.after };
  let after: DateRange;
  if (s.start) {
    const end = s.end && s.end < latest ? s.end : latest;
    after = { start: s.start, end: end >= s.start ? end : s.start };
  } else after = { start: addDays(latest, -13), end: latest };
  const planned = s.start && s.end ? { start: s.start, end: s.end } : after;
  const whole = isFullMonth(planned) && after.start === planned.start && after.end === planned.end;
  return { before: whole ? previousMonth(planned) : previousRange(after), after };
}


export function Performance() {
  const data = useData();
  const { route, navigate } = useApp();
  const solution = data.solutions.find((s) => s.id === route.params.solution) ?? data.solutions[0] ?? null;

  if (!solution)
    return (
      <>
        <CheckSteps current="performance" />
        <PageHeader title="성과 확인" />
        <EmptyState
          title="확인할 실행 계획이 없습니다"
          description="실행 계획을 등록하고 실행한 뒤, 실행 전후 기간의 실적을 비교합니다."
          action={
            <Button variant="primary" onClick={() => navigate('solutions')}>
              실행 계획 화면으로
            </Button>
          }
        />
      </>
    );

  return (
    <>
      <CheckSteps current="performance" problemId={solution.problemId} solutionId={solution.id} />
      <PageHeader title="성과 확인" />
      <PerformanceBody key={solution.id} solution={solution} />
    </>
  );
}

const periodName = (r: DateRange) => (isFullMonth(r) ? `${Number(r.start.slice(5, 7))}월` : krRange(r));
const couponAmt = (n: number | null) => (n === null ? '모름' : n === 0 ? '0원(없음)' : fmt(n, 'won'));
const sameRef = (x: MetricRef, y: MetricRef) => x.key === y.key && x.channel === y.channel;
/** 지표 짧은 이름: 쉬운 이름이 있으면 그것 (예: 배달에서 남은 돈) */
const shortName = (r: MetricRef) => easyMetricName(r.key, r.channel) ?? metricLabel(r.key, r.channel);
/** 선택 요일 횟수: 토요일 4회 (휴업 1회 · 마감 미입력 1회) — 임시 휴업과 기록 누락을 나눠 센다 */
function occasionText(s: PeriodSummary, wd: readonly number[]): string {
  const closed = s.calendarDays - s.businessDays;
  const extra = [closed > 0 ? `휴업 ${closed}회` : null, s.unrecordedDays.length ? `마감 미입력 ${s.unrecordedDays.length}회` : null].filter(Boolean).join(' · ');
  return `${weekdaysText(wd)} ${s.businessDays}회${extra ? ` (${extra})` : ''}`;
}

/** 주 지표 한 줄: "토요일 홀 방문 고객 수 160명 → 128명, 20% 감소". 미확정·비교 보류는 그대로 밝힌다 */
function kpiSentence(ref: MetricRef, b: PeriodSummary, a: PeriodSummary, prefix = ''): string {
  const unit = METRIC_META[ref.key].unit;
  const x = getMetric(b, ref);
  const y = getMetric(a, ref);
  const cx = comparableValue(x);
  const cy = comparableValue(y);
  const name = `${prefix}${shortName(ref)}`;
  if (cx === null || cy === null) return `${name}: ${compareCalc(x, y).note ?? '비교할 수 없어요'}`;
  const change = unit === 'pct' ? fmtPp(cy - cx) : (pctChangeText(cx, cy) ?? fmtSigned(cy - cx, unit));
  return `${name} ${fmt(cx, unit)} → ${fmt(cy, unit)}, ${change}${x.value === null || y.value === null ? ' · 미확정(비용 일부 미입력)' : ''}`;
}

/**
 * 결과 한 문장 (+ 보조 문장). 배달 계획은 건당·주문 수·대상 앱 남은 돈을 한 문장으로, 그 밖은 사용자가 고른 주 지표.
 * 가게 전체 영업이익은 따로 적고 계획의 성과로 표현하지 않는다.
 */
function resultHead(solution: Solution, b: PeriodSummary, a: PeriodSummary, routeName: string | null, wd: readonly number[] | null, all: { b: PeriodSummary; a: PeriodSummary } | null): { main: string; subs: string[] } {
  const subs: string[] = [];
  const prefix = wd ? `${weekdaysText(wd)} ` : '';
  let main: string | null = null;
  if (solution.target === 'delivery') {
    const span = wd ? `${weekdaysText(wd)} ${a.businessDays}회 동안` : isFullMonth(a.range) ? '한 달간' : `${a.calendarDays}일간`;
    const m = (k: MetricRef['key']) => [getMetric(b, { key: k, channel: 'delivery' }), getMetric(a, { key: k, channel: 'delivery' })] as const;
    const [per, ord, tot] = [m('directProfitPerOrder'), m('orders'), m('directProfit')];
    const nums = [...per, ...ord, ...tot].map(comparableValue);
    if (nums.every((v) => v !== null) && !ord[0].basis && !ord[1].basis) {
      const provisional = [...per, ...tot].some((c) => c.value === null);
      main = deliveryChangeText([nums[0]!, nums[1]!], [nums[2]!, nums[3]!], [nums[4]!, nums[5]!], `${routeName ?? '배달'}에서 ${span}`) + (provisional ? ' (미확정 · 비용 일부 미입력)' : '');
    }
    if (!['directProfitPerOrder', 'orders', 'directProfit'].includes(solution.kpi.key) || solution.kpi.channel !== 'delivery') subs.push(`주 지표: ${kpiSentence(solution.kpi, b, a, prefix)}`);
  }
  if (!main) main = kpiSentence(solution.kpi, b, a, prefix);
  if (wd) {
    subs.push(`실행 전 ${occasionText(b, wd)} / 실행 후 ${occasionText(a, wd)}`);
    if (b.businessDays !== a.businessDays && b.businessDays && a.businessDays && METRIC_META[solution.kpi.key].unit !== 'pct') {
      const x = comparableValue(getMetric(b, solution.kpi));
      const y = comparableValue(getMetric(a, solution.kpi));
      const u = METRIC_META[solution.kpi.key].unit;
      if (x !== null && y !== null) subs.push(`영업 횟수가 달라 1회당으로도 보세요: ${fmt(x / b.businessDays, u)} → ${fmt(y / a.businessDays, u)}`);
    }
    if (all) subs.push(`전체 영업일: ${kpiSentence(solution.kpi, all.b, all.a)}`);
  }
  // 가게 전체 영업이익은 요일 계획이어도 전체 영업일 기준으로 말한다 (선택 요일 손익은 아래 요일 비교에서)
  const whole = all ?? { b, a };
  const op = [comparableValue(whole.b.operatingProfit), comparableValue(whole.a.operatingProfit)];
  if (!sameRef(solution.kpi, { key: 'operatingProfit', channel: 'all' }) && op[0] !== null && op[1] !== null)
    subs.push(`${wd ? '전체 영업일 기준 가게 영업이익' : '가게 전체 영업이익'} ${fmtSigned(op[1] - op[0], 'won')}은 이 계획 밖의 변화(${wd ? '다른 요일·공통비' : solution.target === 'common' ? '날씨·행사 등' : '다른 판매 방식·공통비'})도 섞인 값이라 이 계획의 성과로 보지 않아요.`);
  return { main, subs };
}

function PerformanceBody({ solution }: { solution: Solution }) {
  const data = useData();
  const { update, navigate } = useApp();
  const ref = referenceDate(data);
  // 마지막 입력일 뒤가 종료일까지 모두 휴업일(예: 일요일 종료)이면 입력은 끝난 것이다 — 비교 기간도 종료일까지 (실행 전 기간이 하루 밀리지 않게)
  let coveredTo = ref;
  while (solution.end && coveredTo < solution.end && !isOpenDay(data, addDays(coveredTo, 1))) coveredTo = addDays(coveredTo, 1);
  const original = useMemo(() => defaultReviewRanges(solution, solution.end && coveredTo >= solution.end ? coveredTo : ref), [solution.review.before, solution.review.after, solution.start, solution.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const [manual, setManual] = useState(false);
  const [before, setBefore] = useState<DateRange>(original.before);
  const [after, setAfter] = useState<DateRange>(original.after);
  const [decision, setDecision] = useState<Decision | null>(solution.review.decision);
  const [decisionMissing, setDecisionMissing] = useState(false);
  const [judgment, setJudgment] = useState(solution.review.judgment);
  const [external, setExternal] = useState(solution.review.externalFactors);
  const [status, setStatus] = useState<SolutionStatus>(solution.status === 'running' || solution.status === 'reviewPending' ? 'done' : solution.status);
  const [nextCoupon, setNextCoupon] = useState<number | null>(solution.review.nextCouponAmount);
  const finalNow = !!solution.review.reviewedAt || reviewUnavailableReason(solution, ref, appToday(data)) === null;
  const problemText = rangeProblem(before, after, finalNow ? solution.end : null);
  // 완료된 계획은 비교 기간을 한 줄로 접어 두고, '비교 기간 수정'을 눌렀을 때만 날짜 칸을 보인다
  const [editRange, setEditRange] = useState(false);
  const valid = isValidRange(before) && isValidRange(after);
  const wd = solution.weekdays?.length ? solution.weekdays : null;
  const couponPlan = hasCoupon(solution.coupon);
  // 한 배달앱만 대상인 배달 계획: 배달 숫자는 그 배달앱 주문만 집계한다 (화면에 표시한 대상 범위와 같게). 가게 전체 합계는 그대로
  const scopeRoute = solution.target === 'delivery' && solution.coupon.routeId && data.routes.some((r) => r.id === solution.coupon.routeId) ? solution.coupon.routeId : null;
  // 적용 요일이 있으면 그 요일 날짜만 (없으면 전체 기간)
  const summarize = (r: DateRange, days: readonly number[] | null = wd) => {
    const full = computeSummary(data, r, days);
    return scopeRoute ? withChannelFrom(full, computeSummary(scopeToRoute(data, 'delivery', scopeRoute), r, days), 'delivery') : full;
  };
  const b = useMemo(() => (valid ? summarize(before) : null), [data, before, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useMemo(() => (valid ? summarize(after) : null), [data, after, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  // 요일 계획: 같은 기간의 전체 영업일 (선택 요일 옆에 함께)
  const all = useMemo(() => (valid && wd ? { b: summarize(before, null), a: summarize(after, null) } : null), [data, before, after, valid, wd]); // eslint-disable-line react-hooks/exhaustive-deps
  const routeName = scopeRoute ? data.routes.find((r) => r.id === scopeRoute)!.name : null;
  const coupon = couponText(solution.coupon, routeName);
  const problem = data.problems.find((p) => p.id === solution.problemId);
  const today = appToday(data);
  const startReason = reviewUnavailableReason(solution, coveredTo, today);
  // 최종 판단: 실행 기간이 끝났거나 이미 판단을 저장한 계획. 실행 중이면 중간 메모만 (저장된 비교 기간이 있다는 이유로 바꾸지 않는다)
  const final = startReason === null || !!solution.review.reviewedAt;
  const inProgress = !final && startReason === 'running';
  const unavailable = !manual && !final;
  // 이미 이어진 재시험 (있으면 새로 만들지 않고 그 계획으로)
  const retest = data.solutions.find((s) => s.retestOf === solution.id) ?? null;
  // 실행 중 진행 상황: 시작일부터 마지막 입력일까지 (새 매출을 넣으면 바로 갱신)
  const progress = useMemo(
    () => (inProgress && solution.start && solution.start <= ref ? summarize({ start: solution.start, end: solution.end && solution.end < ref ? solution.end : ref }) : null),
    [data, inProgress], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const saveFinal = () => {
    if (problemText) return false;
    // 유지·수정·중단·보류 중 하나를 골라야 최종 판단으로 저장한다 (미선택을 결정으로 남기지 않음)
    if (decision === null) {
      setDecisionMissing(true);
      return false;
    }
    return update(
      (d) => ({
        ...d,
        solutions: d.solutions.map((s) =>
          s.id === solution.id
            ? { ...s, status, review: { before, after, decision, judgment, externalFactors: external, reviewedAt: new Date().toISOString(), nextCouponAmount: couponPlan ? nextCoupon : s.review.nextCouponAmount } }
            : s,
        ),
      }),
      '최종 판단을 저장했습니다.',
    );
  };
  // 실행 중 메모: 상태·비교 기간·판단은 그대로 두고 메모만 남긴다
  const saveMemo = () =>
    update((d) => ({ ...d, solutions: d.solutions.map((s) => (s.id === solution.id ? { ...s, review: { ...s.review, judgment, externalFactors: external } } : s)) }), '중간 메모를 저장했습니다. 계획은 계속 실행 중이에요.');
  const [earlyEnd, setEarlyEnd] = useState<string | null>(null);
  const earlyOk = !!earlyEnd && !!solution.start && earlyEnd >= solution.start && earlyEnd <= coveredTo;
  // 조기 종료 직후 최종 판단 칸으로 바로 이동
  const [jumpToReview, setJumpToReview] = useState(false);
  useEffect(() => {
    if (jumpToReview && final) {
      setJumpToReview(false);
      goReview();
    }
  }, [jumpToReview, final]);
  const finishEarly = () => {
    if (!earlyOk) return;
    update(
      (d) => ({ ...d, solutions: d.solutions.map((s) => (s.id === solution.id ? { ...s, end: earlyEnd, status: 'reviewPending' } : s)) }),
      `${krDate(earlyEnd!)}에 끝낸 것으로 바꿨어요. 이제 최종 판단을 저장할 수 있어요.`,
    );
    const r = { start: solution.start!, end: earlyEnd! };
    setAfter(r);
    setBefore(isFullMonth(r) ? previousMonth(r) : previousRange(r));
    setManual(false);
    setEarlyEnd(null);
    setJumpToReview(true);
  };
  const decided = final && !!solution.review.reviewedAt;
  const nextMonth = retest?.start ? Number(retest.start.slice(5, 7)) : Number(addDays(original.after.end, 1).slice(5, 7));
  const showResult = !unavailable && !!b && !!a && !problemText;
  const head = showResult && final ? resultHead(solution, b!, a!, routeName, wd, all) : null;
  const canFinishEarly = (startReason === 'running' || startReason === 'endedEarly') && !!solution.start && solution.start <= coveredTo && earlyEnd === null;
  const c = solution.coupon;
  // 적용 조건 한 줄 (계획 선택 목록에 이름·상태가 있으므로 여기서는 조건만): 비교 중이면 기간 이름을 붙인 쿠폰 변화
  const condition = [
    routeName ? null : solution.target === 'common' ? '공통 운영' : CHANNEL_LABEL[solution.target],
    couponPlan && showResult && final && c.previousAmount !== null && isFullMonth(before) && isFullMonth(after)
      ? `${routeName ? `${routeName} · ` : ''}${periodName(before)} 쿠폰 ${couponAmt(c.previousAmount)} → ${periodName(after)} 쿠폰 ${couponAmt(c.amount)}${c.minOrder !== null ? ` · 최소 주문 ${fmt(c.minOrder, 'won')}` : ''}`
      : coupon,
    wd ? `${weekdaysText(wd)}만 적용` : null,
    showResult && final ? null : solution.start && solution.end ? `실행 ${krRange({ start: solution.start, end: solution.end })}` : '실행 기간 미정',
  ]
    .filter(Boolean)
    .join(' · ');
  const earlyButton = canFinishEarly && (
    <Button size="sm" onClick={() => setEarlyEnd(ref >= (solution.start ?? ref) ? ref : coveredTo)}>
      조기 종료하고 최종 검토
    </Button>
  );
  const memo = inProgress && <InterimMemo judgment={judgment} external={external} onJudgment={setJudgment} onExternal={setExternal} onSave={saveMemo} />;

  return (
    <div className="mt-3 space-y-4">
      {/* 1. 계획·상태 → 결과 한 문장 → 저장된 판단 또는 지금 할 일 */}
      <Card>
        <Field label="실행 계획 선택">
          {(id) => (
            <Select
              id={id}
              value={solution.id}
              onChange={(v) => navigate('performance', { solution: v })}
              options={data.solutions.map((s) => ({ value: s.id, label: `${s.name} (${STATUS_LABEL[s.status]})` }))}
            />
          )}
        </Field>
        <p aria-label="실행 조건" className="mt-2 text-sm font-semibold text-slate-900">
          {condition}
        </p>
        {unavailable ? (
          <div className="mt-3 space-y-3">
            {startReason === 'running' && progress && progress.entryCount > 0 ? (
              <ProgressSoFar solution={solution} a={progress} routeName={routeName} daysLeftText={solution.end ? (daysLeft(today, solution.end) === 0 ? '오늘 실행 기간이 끝나요' : `종료일까지 ${daysLeft(today, solution.end)}일 남았어요`) : null} />
            ) : (
              <Notice tone="info">
                <p className="font-medium">
                  {startReason === 'awaitingData' || startReason === null
                    ? '실행 후 매출을 입력하면 확인할 수 있어요'
                    : startReason === 'planned' || startReason === 'notStarted'
                      ? '아직 시작 전인 계획이에요'
                      : startReason === 'endedEarly'
                        ? '끝낸 날을 지정하면 최종 검토할 수 있어요'
                        : '실행 기간이 끝나면 최종 판단을 저장할 수 있어요'}
                </p>
                {startReason === 'running' && solution.end && (
                  <p className="mt-1 text-lg font-semibold tabular text-slate-900">
                    {daysLeft(today, solution.end) === 0 ? '오늘 실행 기간이 끝나요' : `종료일까지 ${daysLeft(today, solution.end)}일 남았어요`}
                  </p>
                )}
                <p className="mt-1">
                  {startReason === 'noStart'
                    ? '실행 시작일이 정해지지 않았어요. 실행 계획에서 실행 기간을 입력하세요.'
                    : startReason === 'notStarted'
                      ? `상태: ${STATUS_LABEL[solution.status]}. 실행 시작일(${solution.start})까지 ${daysLeft(today, solution.start!)}일 남았어요.`
                      : startReason === 'planned'
                        ? `상태가 '${STATUS_LABEL.planned}'으로 기록돼 있어 시작 전으로 봅니다. 실행을 시작했다면 실행 계획에서 상태를 '${STATUS_LABEL.running}'으로 바꾸세요.`
                        : startReason === 'endedEarly'
                          ? `상태가 '${STATUS_LABEL[solution.status]}'이지만 계획한 종료일(${solution.end})은 아직 오지 않았어요. 실제로 끝낸 날을 지정하세요.`
                          : startReason === 'noEnd'
                            ? '종료일이 정해지지 않았어요. 실행 계획에서 종료일을 정하면 그 기간으로 실행 전후를 비교합니다.'
                            : startReason === 'running'
                              ? '실행 중이에요. 지금까지의 기록만 보여 드려요.'
                              : startReason === 'awaitingData'
                                ? `실행 기간은 끝났지만 매출이 ${ref}까지만 입력되어 있어요. ${solution.end}까지 입력하면 실행 전후를 비교합니다.`
                                : '실행 후 기간에 입력된 매출이 아직 없어요.'}
                </p>
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              {inProgress && (
                <Button size="sm" variant="primary" onClick={goMemo}>
                  중간 메모 쓰기
                </Button>
              )}
              {earlyButton}
              <Button size="sm" variant="ghost" onClick={() => setManual(true)}>
                기간을 직접 지정해 비교하기
              </Button>
            </div>
            {startReason === 'running' && <p className="text-xs text-slate-600">실행 기간이 끝나면 최종 판단을 저장할 수 있어요. 중간에 비교해 보거나 메모를 남겨도 계획은 계속 실행 중이에요.</p>}
          </div>
        ) : final && !editRange && !problemText ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700">
            <span>
              비교 기간: {krRange(before)} → {krRange(after)}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setEditRange(true)}>
              비교 기간 수정
            </Button>
          </p>
        ) : (
          <div className="mt-3">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-8">
              <RangeEdit label="실행 전 기간" value={before} onChange={setBefore} businessDays={b?.businessDays} />
              <RangeEdit label="실행 후 기간" value={after} onChange={setAfter} businessDays={a?.businessDays} />
              <div className="flex items-end">
                <Button
                  size="sm"
                  onClick={() => {
                    setBefore(original.before);
                    setAfter(original.after);
                  }}
                  disabled={JSON.stringify([before, after]) === JSON.stringify([original.before, original.after])}
                >
                  원래 비교 기간으로 복원 ({dotRange(original.before)} / {dotRange(original.after)})
                </Button>
              </div>
            </div>
            {problemText && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                ⛔ {problemText}
              </p>
            )}
            {!final && <p className="mt-2 text-xs text-slate-500">실행 중에 직접 지정한 비교예요. 아래 메모를 저장해도 계획은 계속 실행 중이에요.</p>}
            {!final && inProgress && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={goMemo}>
                  중간 메모 쓰기
                </Button>
                {earlyButton}
              </div>
            )}
          </div>
        )}
        {earlyEnd !== null && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <Field label="실제로 끝낸 날" hint={`${solution.start} ~ ${coveredTo} 사이 (마지막 입력일까지)`}>
              {(id) => <input id={id} type="date" min={solution.start ?? undefined} max={coveredTo} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={earlyEnd} onChange={(e) => setEarlyEnd(e.target.value)} />}
            </Field>
            <Button variant="primary" onClick={finishEarly} disabled={!earlyOk}>
              이 날 끝낸 것으로 하고 최종 검토
            </Button>
            <Button onClick={() => setEarlyEnd(null)}>취소</Button>
          </div>
        )}
        {head && (
          <div aria-label="결과 한 문장" className="mt-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-base font-bold leading-snug text-slate-900 sm:text-lg">{head.main}</p>
            {head.subs.map((t) => (
              <p key={t} className="mt-1 text-sm text-slate-700">
                {t}
              </p>
            ))}
          </div>
        )}
        {decided ? (
          <SavedJudgment solution={solution} couponPlan={couponPlan} nextMonth={nextMonth} retest={retest} onOpenRetest={() => retest && navigate('performance', { solution: retest.id })} />
        ) : (
          final &&
          showResult && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-blue-50 p-3 ring-1 ring-blue-200">
              <p className="min-w-0 flex-1 text-sm text-slate-800">{couponPlan ? '결과를 보고 유지·수정·중단·보류와 다음 쿠폰 금액을 정하세요.' : '결과를 보고 유지·수정·중단·보류 중 하나를 정해 기록하세요.'}</p>
              <Button variant="primary" onClick={goReview}>
                {couponPlan ? '다음 쿠폰 정하기' : '결과 판단 기록하기'}
              </Button>
            </div>
          )
        )}
        {memo && <div className="mt-3">{memo}</div>}
        <div className="mt-3 flex flex-wrap gap-2">
          {problem && (
            <Button size="sm" variant="ghost" onClick={() => navigate('diagnosis', { problem: problem.id })}>
              문제 진단 보기
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => navigate('solutions', { solution: solution.id, ...(problem ? { problem: problem.id } : {}) })}>
            실행 계획 보기
          </Button>
          {showResult && (
            <Button size="sm" variant="ghost" onClick={() => window.print()}>
              회의용 요약 인쇄
            </Button>
          )}
        </div>
      </Card>

      {showResult && <Comparisons solution={solution} b={b!} a={a!} all={all} routeName={routeName} lastEntry={final ? null : ref} />}

      {showResult && (
        <MeetingSummary
          solution={solution}
          b={b!}
          a={a!}
          all={all}
          head={head ?? resultHead(solution, b!, a!, routeName, wd, all)}
          condition={condition}
          final={final}
          routeName={routeName}
          problemName={problem?.name ?? null}
        />
      )}

      {!unavailable && final && (
        <Card title={decided ? '판단 수정' : '최종 판단 기록'} id="review-record">
          <More summary={decided ? '저장된 판단 고치기' : '판단 적기'} defaultOpen={!decided}>
            <div className="mt-2 space-y-3">
              <fieldset>
                <legend className="mb-1 text-xs font-medium text-slate-700">판단 (하나를 고르세요)</legend>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(DECISION_LABEL) as Decision[]).map((k) => (
                    <label key={k} className={`cursor-pointer rounded-lg px-3 py-2 text-sm ring-1 ${decision === k ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-300'}`}>
                      <input
                        type="radio"
                        className="sr-only"
                        name="decision"
                        checked={decision === k}
                        onChange={() => {
                          setDecision(k);
                          setDecisionMissing(false);
                        }}
                      />
                      {DECISION_LABEL[k]}
                    </label>
                  ))}
                </div>
                {decisionMissing && decision === null && (
                  <p role="alert" className="mt-1 text-sm text-red-700">
                    유지·확대, 수정 후 재시험, 중단, 판단 보류 중 하나를 골라야 저장할 수 있어요.
                  </p>
                )}
                {decision === null && solution.review.reviewedAt && <p className="mt-1 text-xs text-slate-500">이전에 판단을 고르지 않고 저장한 기록이에요. 다시 저장하려면 하나를 고르세요.</p>}
              </fieldset>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="판단 근거">{(id) => <TextArea id={id} rows={3} value={judgment} onChange={setJudgment} placeholder="목표 달성 여부, 전체 영업이익 변화, 다른 판매 방식 영향 등" />}</Field>
                <Field label="외부 요인 메모">{(id) => <TextArea id={id} rows={3} value={external} onChange={setExternal} placeholder="예: 실행 후 기간에 공휴일 2일, 장마, 인근 행사, 동시에 진행한 다른 할인" />}</Field>
              </div>
              {couponPlan && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field
                    label="다음 기간 쿠폰 금액 (선택)"
                    hint={`재시험을 만들 때만 새 계획의 쿠폰 금액으로 넘어가요. 비우면 미정, 쿠폰을 그만 걸기로 했으면 0원(중단).${coupon ? ` 이번 계획: ${coupon}` : ''}`}
                  >
                    {(id) => <NumberInput id={id} value={nextCoupon} onChange={setNextCoupon} suffix="원" placeholder="미정" />}
                  </Field>
                  <div className="flex flex-wrap items-end gap-2">
                    <Button size="sm" onClick={() => setNextCoupon(null)}>
                      미정
                    </Button>
                    <Button size="sm" onClick={() => setNextCoupon(0)}>
                      0원으로 중단
                    </Button>
                    <span className="self-center text-sm text-slate-700" aria-live="polite">
                      {nextCoupon === null ? '다음 쿠폰: 미정' : nextCoupon === 0 ? '다음 쿠폰: 0원 — 쿠폰 중단' : `다음 쿠폰: ${fmt(nextCoupon, 'won')}`}
                    </span>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <Field label="실행 계획 상태">
                  {(id) => <Select id={id} value={status} onChange={setStatus} options={(Object.keys(STATUS_LABEL) as SolutionStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }))} />}
                </Field>
                <Button variant="primary" onClick={saveFinal} disabled={!!problemText}>
                  최종 판단 저장
                </Button>
                {!retest && (
                  <Button
                    onClick={() => {
                      // 판단을 저장한 뒤 그 조건(대상 앱·다음 쿠폰액·최소 주문액·핵심 지표·적용 요일)으로 새 초안을 연다. 저장 전까지 고칠 수 있다
                      if (saveFinal()) navigate('solutions', { retest: solution.id });
                    }}
                    disabled={!!problemText}
                  >
                    이 조건으로 재시험 만들기
                  </Button>
                )}
                {solution.review.reviewedAt && <span className="text-xs text-slate-500">마지막 기록 {new Date(solution.review.reviewedAt).toLocaleString('ko-KR')}</span>}
              </div>
              {problemText && <p className="text-sm text-red-700">비교 기간을 고치기 전에는 저장하거나 재시험을 만들 수 없어요.</p>}
            </div>
          </More>
        </Card>
      )}
    </div>
  );
}

/** 결과 판단 기록 칸으로 이동해 펼친다 */
function goReview() {
  const el = document.getElementById('review-record');
  el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  el?.querySelector('details')?.setAttribute('open', '');
  (el?.querySelector('input,textarea,button') as HTMLElement | null)?.focus();
}

/** 실행 중 계획: 중간 메모 입력란으로 이동해 포커스 */
function goMemo() {
  const el = document.getElementById('interim-memo');
  el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  el?.querySelector('textarea')?.focus();
}

/** 증감을 글자로: +935원 · −120건 · 변화 없음 (부호로도 증감을 구분). 비교할 수 없으면 사유 */
function changeOf(x: Calc, y: Calc, unit: Unit, kind: 'normal' | 'profit', higherIsBetter: boolean): { text: string; tone: 'good' | 'bad' | 'none' } {
  const cx = comparableValue(x);
  const cy = comparableValue(y);
  if (cx === null || cy === null) return { text: compareCalc(x, y, kind).note ?? '비교 불가', tone: 'none' };
  const d = unit === 'pct' ? Math.round((cy - cx) * 10) / 10 : Math.round(cy - cx);
  const turn = kind === 'profit' ? compareValues(cx, cy, 'profit').note : null;
  const tail = [turn && /전환|적자|손익/.test(turn) ? turn : null, x.value === null || y.value === null ? '미확정' : null].filter(Boolean).join(' · ');
  const text = (d === 0 ? '변화 없음' : unit === 'pct' ? fmtPp(d) : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d), unit)}`) + (tail ? ` · ${tail}` : '');
  return { text, tone: d === 0 ? 'none' : (d > 0) === higherIsBetter ? 'good' : 'bad' };
}

/**
 * 같은 지표의 두 막대는 같은 눈금. 음수가 있으면 가운데 0 기준선에서 왼쪽(음수)·오른쪽(양수)으로.
 * 실행 전은 회색, 실행 후는 진한 파란색. 값이 없으면(미입력·비교 불가) 막대를 그리지 않는다.
 */
function Bar({ v, max, signed, after }: { v: number; max: number; signed: boolean; after: boolean }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(v) / max) * 100) : 0;
  const color = after ? 'bg-blue-700' : 'bg-slate-400';
  if (!signed)
    return (
      <div aria-hidden className="mt-1 h-2 w-full rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    );
  return (
    <div aria-hidden className="relative mt-1 h-2 w-full rounded-full bg-slate-100">
      <div className="absolute -top-0.5 left-1/2 h-3 w-px bg-slate-500" />
      <div className={`absolute top-0 h-2 ${color} ${v < 0 ? 'rounded-l-full' : 'rounded-r-full'}`} style={v < 0 ? { right: '50%', width: `${pct / 2}%` } : { left: '50%', width: `${pct / 2}%` }} />
    </div>
  );
}

interface BoardRow {
  label: string;
  ref: MetricRef;
  /** 가게 전체 영업이익: 맨 아래 따로 (이 계획만의 효과가 아님) */
  total?: boolean;
  main?: boolean;
}

/** 지표 표의 행: 배달은 건당·주문 수·대상 앱 남은 돈, 그 밖은 주 지표와 함께 보는 지표. 가게 전체 영업이익은 맨 아래 따로 */
function boardRows(s: Solution, scope: string, span: string): BoardRow[] {
  // 요일 계획은 선택 요일만 집계한 영업이익 (월세·급여는 그 요일 날짜 몫) — 전체 영업일 값과 헷갈리지 않게 이름을 붙인다
  const total: BoardRow = { label: s.weekdays?.length ? `${weekdaysText(s.weekdays)} 가게 영업이익` : '가게 전체 영업이익', ref: { key: 'operatingProfit', channel: 'all' }, total: true };
  let rows: BoardRow[];
  if (s.target === 'delivery') {
    rows = [
      { label: '주문 한 건당 남은 돈', ref: { key: 'directProfitPerOrder', channel: 'delivery' } },
      { label: `${scope} 완료 주문`, ref: { key: 'orders', channel: 'delivery' } },
      { label: `${scope}에서 ${span} 남은 돈`, ref: { key: 'directProfit', channel: 'delivery' } },
    ];
    if (!rows.some((r) => sameRef(r.ref, s.kpi)) && !sameRef(s.kpi, total.ref)) rows.unshift({ label: shortName(s.kpi), ref: s.kpi });
  } else {
    rows = [s.kpi, ...s.extraKpis].filter((k, i, list) => list.findIndex((x) => sameRef(x, k)) === i && !sameRef(k, total.ref)).map((k) => ({ label: shortName(k), ref: k }));
    if (sameRef(s.kpi, total.ref)) return [{ ...total, main: true }, ...rows];
  }
  return [...rows.map((r) => ({ ...r, main: sameRef(r.ref, s.kpi) })), { ...total, main: false }];
}

/**
 * 상세 수치: 바꾸기 전과 후.
 * 데스크톱은 '지표 | 바꾸기 전 · 기간 | 바꾼 후 · 기간 | 증감' 한 행에 막대, 휴대폰은 첫 줄 '지표  +935원', 다음 줄 '6,218원 → 7,153원'.
 */
function BeforeAfter({ solution, b, a, routeName, lastEntry }: { solution: Solution; b: PeriodSummary; a: PeriodSummary; routeName: string | null; lastEntry: string | null }) {
  const data = useData();
  const wd = solution.weekdays?.length ? solution.weekdays : null;
  const scope = routeName ?? '배달';
  const span = wd ? `${weekdaysText(wd)} ${a.businessDays}회 동안` : isFullMonth(a.range) ? '한 달간' : `${a.calendarDays}일간`;
  const pb = wd ? `${periodName(b.range)} ${weekdaysText(wd)} ${b.businessDays}회` : periodName(b.range);
  const pa = wd ? `${periodName(a.range)} ${weekdaysText(wd)} ${a.businessDays}회` : periodName(a.range);
  const rows = boardRows(solution, scope, span);
  const cols = 'sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.85fr)]';
  const reasons = (s: PeriodSummary, ch: MetricRef['channel']) => calcReasons(data, s, ch);
  return (
    <Card title="바꾸기 전과 후" subtitle={wd ? `${weekdaysText(wd)}끼리 비교 · 실행 전 ${occasionText(b, wd)} / 실행 후 ${occasionText(a, wd)}` : undefined}>
      {lastEntry && (
        <p role="status" className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900">
          실행 중 · 마지막 매출 입력 {krDate(lastEntry)} — 바꾼 후 값은 {krRange(a.range)} 누적이라 확정 성과가 아니에요.
        </p>
      )}
      <div aria-label="바꾸기 전과 후">
        <div className={`hidden gap-4 border-b border-slate-200 pb-1 text-xs font-semibold text-slate-600 sm:grid ${cols}`}>
          <span>지표</span>
          <span>바꾸기 전 · {pb}</span>
          <span>바꾼 후 · {pa}</span>
          <span>증감</span>
        </div>
        {rows.map((r) => {
          const meta = METRIC_META[r.ref.key];
          const kind = r.ref.key === 'operatingProfit' || r.ref.key === 'directProfit' ? 'profit' : 'normal';
          const x = getMetric(b, r.ref);
          const y = getMetric(a, r.ref);
          const vals = [comparableValue(x), comparableValue(y)].filter((v): v is number => v !== null);
          const max = Math.max(0, ...vals.map(Math.abs));
          const signed = vals.some((v) => v < 0);
          const ch = changeOf(x, y, meta.unit, kind, meta.higherIsBetter);
          const cell = (calc: Calc, s: PeriodSummary, after: boolean) => {
            const v = comparableValue(calc);
            return (
              <div data-cell={after ? 'after' : 'before'} className={`min-w-0 sm:row-start-1 ${after ? 'sm:col-start-3' : 'sm:col-start-2'}`}>
                <div className="min-w-0 break-words">
                  <CalcValue calc={calc} unit={meta.unit} />
                  {v !== null ? (
                    <div className="hidden sm:block">
                      <Bar v={v} max={max} signed={signed} after={after} />
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs text-amber-800">{reasonLine(calc, reasons(s, r.ref.channel)) ?? '값이 없어 비교할 수 없어요'}</p>
                  )}
                </div>
              </div>
            );
          };
          return (
            <div
              key={r.label}
              aria-label={r.label}
              className={`mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-lg p-3 ring-1 ring-slate-200 sm:mt-0 sm:items-start sm:gap-4 sm:rounded-none sm:px-0 sm:ring-0 ${cols} ${r.total ? 'mt-4 ring-2 ring-slate-400 sm:mt-0 sm:border-t-2 sm:border-slate-400' : 'sm:border-t sm:border-slate-100'}`}
            >
              <div className="col-start-1 row-start-1 min-w-0 text-sm font-semibold text-slate-900">
                {r.label}
                {r.main && <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">주 지표</span>}
                {r.total && wd && <span className="block text-xs font-normal text-slate-500">{weekdaysText(wd)} 날짜만 · 월세·급여는 그 날짜 몫 — 전체 영업일 값은 아래에서</span>}
                {r.total && !wd && <span className="block text-xs font-normal text-slate-500">{solution.target === 'common' ? '공통비 포함 — 이 계획만의 효과가 아니에요' : `홀·포장·${solution.target === 'delivery' ? '다른 배달앱·' : ''}공통비 포함 — ${hasCoupon(solution.coupon) ? '쿠폰' : '이 계획'}만의 효과가 아니에요`}</span>}
              </div>
              <div data-cell="delta" className={`col-start-2 row-start-1 whitespace-nowrap text-right text-sm font-bold sm:col-start-4 sm:whitespace-normal sm:text-left ${ch.tone === 'good' ? 'text-emerald-700' : ch.tone === 'bad' ? 'text-red-700' : 'text-slate-600'}`}>
                {ch.text}
              </div>
              <div className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm sm:contents">
                {cell(x, b, false)}
                <span aria-hidden className="text-slate-400 sm:hidden">
                  →
                </span>
                {cell(y, a, true)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-600">
        {solution.target === 'delivery' && <>남은 돈은 {routeName ? `${routeName} 배달 주문의` : '배달'} 매출에서 배달에 드는 비용(식재료·수수료·배달비·포장비 등)만 뺀 금액이고, </>}
        가게 전체 영업이익은 월세·인건비 같은 공통비까지 뺀 금액이에요. 실행 전후 차이라 날씨·노출·다른 판매 방식 변화가 섞여 있어 이 계획 때문이라고 단정할 수 없어요.
        {solution.coupon.usedCount !== null && ` 쿠폰 사용 ${solution.coupon.usedCount.toLocaleString('ko-KR')}건(사장님 입력).`}
      </p>
    </Card>
  );
}

/**
 * 적용 요일 계획: 선택 요일과 전체 영업일을 나란히, 영업 횟수가 다르면 1회당 값도.
 * 기간 비용(월세·급여)은 달력 일수로 하루 몫을 나눠 선택 요일 날짜만큼 넣는다 — 그 기준을 함께 적는다.
 */
function WeekdayCompare({ solution, b, a, all }: { solution: Solution; b: PeriodSummary; a: PeriodSummary; all: { b: PeriodSummary; a: PeriodSummary } }) {
  const wd = solution.weekdays!;
  const wn = weekdaysText(wd)!;
  const refs: MetricRef[] = [solution.kpi, ...(sameRef(solution.kpi, { key: 'operatingProfit', channel: 'all' }) ? [] : [{ key: 'operatingProfit', channel: 'all' } as MetricRef])];
  const pair = (x: PeriodSummary, y: PeriodSummary, r: MetricRef, perDay = false) => {
    const unit = METRIC_META[r.key].unit;
    const cx = comparableValue(getMetric(x, r));
    const cy = comparableValue(getMetric(y, r));
    if (cx === null || cy === null) return compareCalc(getMetric(x, r), getMetric(y, r)).note ?? '비교할 수 없어요';
    const [px, py] = perDay ? [x.businessDays ? cx / x.businessDays : null, y.businessDays ? cy / y.businessDays : null] : [cx, cy];
    if (px === null || py === null) return '영업 0회';
    const tail = getMetric(x, r).value === null || getMetric(y, r).value === null ? ' · 미확정' : '';
    return `${fmt(px, unit)} → ${fmt(py, unit)} (${unit === 'pct' ? fmtPp(py - px) : (pctChangeText(px, py) ?? fmtSigned(py - px, unit))})${tail}`;
  };
  // 생협 등 운영 지원 판단용: 선택 요일 1회 운영 손익 (비용이 빠졌으면 확정값으로 보이지 않는다)
  const op = a.operatingProfit;
  const opv = comparableValue(op);
  const perOcc = opv !== null && a.businessDays ? opv / a.businessDays : null;
  const opPartial = op.value === null;
  const allocDays = a.calendarDays;
  return (
    <Card title={`${wn}만 · 전체 영업일과 함께 보기`} subtitle={`실행 전 ${occasionText(b, wd)} / 실행 후 ${occasionText(a, wd)}`}>
      <dl aria-label="요일 비교" className="grid gap-2 sm:grid-cols-2">
        {refs.map((r) => (
          <div key={r.key} className="min-w-0 rounded-lg p-3 ring-1 ring-slate-200">
            <dt className="text-sm font-semibold text-slate-900">{shortName(r)}</dt>
            <dd className="mt-1 space-y-0.5 text-sm tabular text-slate-800">
              <p>
                <span className="text-xs font-medium text-blue-800">{wn} 합계 </span>
                {pair(b, a, r)}
              </p>
              {METRIC_META[r.key].unit !== 'pct' && (
                <p>
                  <span className="text-xs font-medium text-blue-800">{wn} 1회당 </span>
                  {pair(b, a, r, true)}
                </p>
              )}
              <p>
                <span className="text-xs font-medium text-slate-500">전체 영업일 </span>
                {pair(all.b, all.a, r)}
              </p>
            </dd>
          </div>
        ))}
      </dl>
      <div aria-label="1회 운영 손익" className="mt-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
        <p className="text-sm font-semibold text-slate-900">
          실행 후 {wn} 1회 운영 손익:{' '}
          {perOcc === null ? (
            <span className="text-amber-800">{op.salesGap ? GAP_NOTE : '계산할 수 없어요'}</span>
          ) : (
            <>
              {fmtSigned(perOcc, 'won')}
              {opPartial && <span className="ml-1 text-xs font-medium text-amber-800">미확정</span>}
            </>
          )}
        </p>
        {perOcc !== null && perOcc < 0 && (
          <p className="mt-0.5 text-sm text-slate-800">
            {wn} 한 번 여는 데 부족한 돈(지원이 필요한 금액){opPartial ? '은 최소 ' : ' '}
            <b>{fmt(-perOcc, 'won')}</b>
            {opPartial ? '이에요. 빠진 비용이 있어 확정값이 아니에요 — 비용을 채우면 늘어날 수 있어요.' : '이에요.'}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-600">
          월세·급여 같은 기간 비용은 기간 전체의 달력 일수로 하루 몫을 나눈 뒤 {wn} 날짜 수만큼만 넣었어요 (실행 후 {allocDays}일분). {wn}에만 드는 비용(예: {wn} 근무 수당)은 그 날짜로 기간 비용을 등록해야 정확해요.
        </p>
      </div>
    </Card>
  );
}

/** 실행 중 계획의 중간 메모 (최종 판단·상태·비교 기간은 바꾸지 않는다) */
function InterimMemo({ judgment, external, onJudgment, onExternal, onSave }: { judgment: string; external: string; onJudgment: (v: string) => void; onExternal: (v: string) => void; onSave: () => void }) {
  return (
    <div id="interim-memo" className="space-y-2 rounded-lg p-3 ring-1 ring-slate-200">
      <p className="text-sm font-semibold text-slate-900">중간 메모</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="지금까지 본 것">{(id) => <TextArea id={id} rows={2} value={judgment} onChange={onJudgment} placeholder="예: 1~3주차 주문은 10월보다 많음" />}</Field>
        <Field label="외부 요인 메모">{(id) => <TextArea id={id} rows={2} value={external} onChange={onExternal} placeholder="예: 11월 둘째 주 비 오는 날 많음" />}</Field>
      </div>
      <Button onClick={onSave}>중간 메모 저장</Button>
      <p className="text-xs text-slate-500">메모만 저장해요. 계획은 계속 '실행 중'이고, 최종 판단은 기간이 끝난 뒤(또는 조기 종료 후)에 저장해요.</p>
    </div>
  );
}

/** 저장된 판단: 판단 · (쿠폰 계획이면) 내가 정한 다음 쿠폰 · 이어진 재시험 · 판단 근거 */
function SavedJudgment({ solution, couponPlan, nextMonth, retest, onOpenRetest }: { solution: Solution; couponPlan: boolean; nextMonth: number; retest: Solution | null; onOpenRetest: () => void }) {
  const r = solution.review;
  const next = r.nextCouponAmount === null ? '미정' : r.nextCouponAmount === 0 ? '0원(쿠폰 중단)' : fmt(r.nextCouponAmount, 'won');
  return (
    <div aria-label="저장된 판단" className="mt-3 rounded-lg p-3 ring-1 ring-slate-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          저장된 판단 ·{' '}
          <b aria-label="저장된 판단 요약" className="font-semibold text-slate-900">
            {r.decision ? DECISION_LABEL[r.decision] : '판단 미선택'}
          </b>
        </p>
        <Button size="sm" variant="ghost" onClick={goReview}>
          판단 고치기
        </Button>
      </div>
      {(couponPlan || r.nextCouponAmount !== null) && (
        <p aria-label="다음 쿠폰" className="mt-1 text-xl font-bold text-slate-900">
          내가 정한 다음 쿠폰 {next}
          {r.nextCouponAmount !== null && <span className="ml-2 text-sm font-medium text-slate-600">({nextMonth}월부터)</span>}
        </p>
      )}
      {retest && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={onOpenRetest}>
            {retest.start ? `${Number(retest.start.slice(5, 7))}월 ` : ''}재시험 진행 상황 보기
          </Button>
          <span className="text-xs text-slate-600">
            {retest.name} ({STATUS_LABEL[retest.status]})
          </span>
        </div>
      )}
      {r.judgment && <p className="mt-2 text-sm text-slate-800">{r.judgment}</p>}
      {r.externalFactors && <p className="mt-1 text-sm text-slate-600">외부 요인: {r.externalFactors}</p>}
    </div>
  );
}

/** 회의용 요약: 화면에는 숨기고 인쇄할 때만 한 장으로 (계획·비교 기간과 요일·주 지표·손익·판단 근거·외부 요인·미확정 여부) */
function MeetingSummary({ solution, b, a, all, head, condition, final, routeName, problemName }: {
  solution: Solution;
  b: PeriodSummary;
  a: PeriodSummary;
  all: { b: PeriodSummary; a: PeriodSummary } | null;
  head: { main: string; subs: string[] };
  condition: string;
  final: boolean;
  routeName: string | null;
  problemName: string | null;
}) {
  const r = solution.review;
  const rows = boardRows(solution, routeName ?? '배달', isFullMonth(a.range) ? '한 달간' : `${a.calendarDays}일간`);
  const unsure = [b, a].some((s) => s.operatingProfit.value === null) ? '영업이익 미확정 — 비용 일부 미입력 또는 빠진 매출 기록이 있어요.' : '영업이익 확정 (빠진 비용·기록 없음)';
  const v = (c: Calc, unit: Unit) => (comparableValue(c) === null ? (c.salesGap ? '비교 보류' : '데이터 필요') : `${fmt(comparableValue(c), unit)}${c.value === null ? ' (미확정)' : ''}`);
  return (
    <section aria-label="회의용 요약" className="print-only hidden">
      <h1 className="text-xl font-bold">{solution.name} — 회의용 요약</h1>
      <p className="mt-1 text-sm">
        {STATUS_LABEL[solution.status]} · {condition}
        {problemName ? ` · 문제: ${problemName}` : ''}
      </p>
      <p className="text-sm">
        비교 기간: {krRange(b.range)} → {krRange(a.range)}
        {solution.weekdays?.length ? ` · ${weekdaysText(solution.weekdays)}만 (실행 전 ${occasionText(b, solution.weekdays)} / 실행 후 ${occasionText(a, solution.weekdays)})` : ' · 전체 영업일'}
        {!final ? ' · 실행 중 (누적값, 확정 성과 아님)' : ''}
      </p>
      <p className="mt-2 font-semibold">{head.main}</p>
      {head.subs.map((t) => (
        <p key={t} className="text-sm">
          {t}
        </p>
      ))}
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border px-2 py-1 text-left">지표</th>
            <th className="border px-2 py-1 text-right">바꾸기 전</th>
            <th className="border px-2 py-1 text-right">바꾼 후</th>
            <th className="border px-2 py-1 text-right">증감</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const meta = METRIC_META[row.ref.key];
            const x = getMetric(b, row.ref);
            const y = getMetric(a, row.ref);
            return (
              <tr key={row.label}>
                <td className="border px-2 py-1">
                  {row.label}
                  {row.main ? ' (주 지표)' : ''}
                </td>
                <td className="border px-2 py-1 text-right">{v(x, meta.unit)}</td>
                <td className="border px-2 py-1 text-right">{v(y, meta.unit)}</td>
                <td className="border px-2 py-1 text-right">{changeOf(x, y, meta.unit, row.ref.key === 'operatingProfit' || row.ref.key === 'directProfit' ? 'profit' : 'normal', meta.higherIsBetter).text}</td>
              </tr>
            );
          })}
          {all && (
            <tr>
              <td className="border px-2 py-1">전체 영업일 가게 영업이익</td>
              <td className="border px-2 py-1 text-right">{v(all.b.operatingProfit, 'won')}</td>
              <td className="border px-2 py-1 text-right">{v(all.a.operatingProfit, 'won')}</td>
              <td className="border px-2 py-1 text-right">{changeOf(all.b.operatingProfit, all.a.operatingProfit, 'won', 'profit', true).text}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-2 text-sm">{unsure}</p>
      <p className="mt-2 text-sm">
        판단: {r.reviewedAt ? (r.decision ? DECISION_LABEL[r.decision] : '판단 미선택') : '아직 기록하지 않음'}
        {hasCoupon(solution.coupon) && r.reviewedAt ? ` · 다음 쿠폰 ${r.nextCouponAmount === null ? '미정' : r.nextCouponAmount === 0 ? '0원(중단)' : fmt(r.nextCouponAmount, 'won')}` : ''}
      </p>
      <p className="text-sm">판단 근거: {r.judgment || '없음'}</p>
      <p className="text-sm">외부 요인: {r.externalFactors || '없음'}</p>
      <p className="mt-2 text-xs">실행 전후 단순 비교라 날씨·행사 등 다른 요인이 섞여 있어요. 가게 전체 영업이익은 이 계획만의 효과가 아니에요.</p>
    </section>
  );
}

/** 배달 쿠폰 계획은 요약·근거·저장된 판단을 먼저 보이고, 예상과 실제·할인 1,000원당·목표·상세 표는 필요할 때 펼친다 */
function DetailWrap({ collapse, children }: { collapse: boolean; children: ReactNode }) {
  if (!collapse) return <>{children}</>;
  return (
    <More summary="상세 분석 · 계획 당시 예상과 실제 가게 전체 변화, 할인 1,000원당 변화, 목표, 상세 표">
      <div className="mt-3 space-y-4">{children}</div>
    </More>
  );
}

function RangeEdit({ label, value, onChange, businessDays }: { label: string; value: DateRange; onChange: (r: DateRange) => void; businessDays?: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <input type="date" aria-label={`${label} 시작`} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} />
        <span>~</span>
        <input type="date" aria-label={`${label} 종료`} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} />
        {isValidRange(value) && (
          <span className="text-xs text-slate-600">
            {daysInclusive(value.start, value.end)}일{businessDays !== undefined && <> · 영업일 <b className="font-semibold text-slate-800">{businessDays}일</b></>}
          </span>
        )}
      </div>
    </div>
  );
}

interface CmpRow {
  label: string;
  /** 정확한 용어·정의 (보조 설명) */
  sub?: string;
  unit: Unit;
  ref: MetricRef;
  kind?: 'normal' | 'profit' | 'ratio';
  higherIsBetter?: boolean;
}

/** 쉬운 이름을 앞에, 정확한 용어와 정의를 보조 설명으로 */
function easyRow(ref: MetricRef, kind?: CmpRow['kind']): CmpRow {
  const easy = easyMetricName(ref.key, ref.channel);
  const exact = metricLabel(ref.key, ref.channel);
  const def = METRIC_DEFINITION[ref.key];
  return {
    label: easy ?? exact,
    sub: easy ? `${exact}${def ? ` · ${def}` : ''}` : def,
    unit: METRIC_META[ref.key].unit,
    ref,
    kind: kind ?? (ref.key === 'operatingProfit' || ref.key === 'directProfit' ? 'profit' : METRIC_META[ref.key].unit === 'pct' ? 'ratio' : 'normal'),
    higherIsBetter: METRIC_META[ref.key].higherIsBetter,
  };
}

function Comparisons({ solution, b, a, all, routeName, lastEntry }: { solution: Solution; b: PeriodSummary; a: PeriodSummary; all: { b: PeriodSummary; a: PeriodSummary } | null; routeName: string | null; lastEntry: string | null }) {
  const ch: Channel | 'all' = solution.target === 'common' ? 'all' : solution.target;
  const scopeRows: CmpRow[] =
    ch === 'all'
      ? [
          { label: '매출 (총매출)', unit: 'won', ref: { key: 'totalSales', channel: 'all' } },
          { label: '완료 주문 수 (전체)', unit: 'orders', ref: { key: 'orders', channel: 'all' } },
          { label: '평균 결제액 (전체 순매출 ÷ 주문 수)', unit: 'won', ref: { key: 'avgTicket', channel: 'all' } },
          easyRow({ key: 'directProfit', channel: 'all' }),
          easyRow({ key: 'storeDiscount', channel: 'all' }),
        ]
      : [
          { label: `${CHANNEL_LABEL[ch]} 매출`, unit: 'won', ref: { key: 'netSales', channel: ch } },
          ch === 'hall'
            ? { label: '홀 방문 고객 수', unit: 'people', ref: { key: 'visitors', channel: 'hall' } }
            : { label: `${CHANNEL_LABEL[ch]} 완료 주문 수`, unit: 'orders', ref: { key: 'orders', channel: ch } },
          { label: ch === 'hall' ? '홀 객단가' : `${CHANNEL_LABEL[ch]} 평균 주문금액`, unit: 'won', ref: { key: 'avgTicket', channel: ch } },
          easyRow({ key: 'storeDiscount', channel: ch }),
          easyRow({ key: 'directProfit', channel: ch }),
          easyRow({ key: 'directProfitPerOrder', channel: ch }, 'normal'),
        ];
  const totalRows: CmpRow[] = [
    { label: '총매출', unit: 'won', ref: { key: 'totalSales', channel: 'all' } },
    { ...easyRow({ key: 'operatingProfit', channel: 'all' }), label: '가게에 남은 돈 (전체 영업이익)' },
    { label: '영업이익률', unit: 'pct', ref: { key: 'operatingMargin', channel: 'all' }, kind: 'ratio' },
    { label: '영업일당 매출', unit: 'won', ref: { key: 'salesPerBusinessDay', channel: 'all' } },
  ];

  const kpiMeta = METRIC_META[solution.kpi.key];
  const kpiAfter = getMetric(a, solution.kpi);
  const kpiBefore = getMetric(b, solution.kpi);
  const kpiGap = !!(kpiBefore.salesGap || kpiAfter.salesGap);
  const judgedRaw = judgeKpiTarget(solution.kpiTargetMode, solution.kpiTarget, kpiBefore.value, kpiAfter.value, kpiMeta.higherIsBetter, a.businessDays);
  // 빠진 기록이 있는 부분 합계로는 목표 달성을 판정하지 않는다
  const judged = kpiGap && solution.kpiTarget !== null ? { achieved: null, actual: null, reason: '판정 보류 · 빠진 기록 있음' } : judgedRaw;
  const achieved = judged.achieved;
  const actualText =
    judged.actual === null
      ? null
      : solution.kpiTargetMode === 'increase'
        ? kpiMeta.unit === 'pct'
          ? fmtPp(judged.actual)
          : fmtSigned(judged.actual, kpiMeta.unit)
        : solution.kpiTargetMode === 'growthRate'
          ? `${judged.actual >= 0 ? '+' : '−'}${Math.abs(judged.actual).toFixed(1)}%`
          : solution.kpiTargetMode === 'perBusinessDay'
            ? `영업일당 ${fmt(judged.actual, kpiMeta.unit)} (${a.businessDays}일)`
            : fmt(judged.actual, kpiMeta.unit);

  const opB = b.operatingProfit;
  const opA = a.operatingProfit;
  // 매출 비교는 빠진 기록이 없는 판매 방식끼리만
  const salesOf = (x: PeriodSummary, c: Channel) => channelSalesCalc(x.channels[c]).value;
  const salesUp = (c: Channel) => salesOf(a, c) !== null && salesOf(b, c) !== null && salesOf(a, c)! > salesOf(b, c)!;
  const salesDown = (c: Channel) => salesOf(a, c) !== null && salesOf(b, c) !== null && salesOf(a, c)! < salesOf(b, c)!;
  const scopeSalesUp = ch !== 'all' && salesUp(ch);
  const otherDown = ch !== 'all' ? CHANNELS.filter((c) => c !== ch && salesDown(c)) : [];
  const opDown = opB.value !== null && opA.value !== null && opA.value < opB.value;

  const caveats: string[] = [];
  if (b.businessDays !== a.businessDays) caveats.push(`영업일 수가 다릅니다 (실행 전 ${b.businessDays}일, 실행 후 ${a.businessDays}일). 영업일당 매출도 함께 보세요.`);
  if (b.calendarDays !== a.calendarDays) caveats.push(`두 기간의 길이가 다릅니다 (${b.calendarDays}일 / ${a.calendarDays}일). 총액 비교에 주의하세요.`);
  for (const [n, s] of [
    ['실행 전', b],
    ['실행 후', a],
  ] as const) {
    if (!s.entryCount) caveats.push(`${n} 기간에 매출 입력이 없습니다.`);
    if (s.status.missingCount) caveats.push(`${n} 기간에 누락 항목 ${s.status.missingCount}개가 있어 영업이익이 확정되지 않았습니다.`);
    if (s.status.estimatedAmount) caveats.push(`${n} 기간의 비용 중 ${fmt(s.status.estimatedAmount, 'won')}은 모르는 값을 가정한 추정값입니다.`);  }

  const table = (rows: CmpRow[], showRange = true) => (
    <>
    {showRange && (
      <p className="mb-2 text-sm text-slate-700">
        실행 전 {formatRange(b.range)} · 실행 후 {formatRange(a.range)}
      </p>
    )}
    {/* 휴대폰: 지표별 세로 배치 */}
    <dl className="space-y-2 sm:hidden">
      {rows.map((r) => {
        const pv: Calc = getMetric(b, r.ref);
        const cv: Calc = getMetric(a, r.ref);
        return (
          <div key={r.label} className="rounded-lg p-2.5 ring-1 ring-slate-200">
            <dt className="text-sm font-medium text-slate-900">
              {r.label}
              {r.sub && <span className="block text-xs font-normal text-slate-500">{r.sub}</span>}
            </dt>
            <dd className="mt-1 grid grid-cols-3 gap-1 text-sm">
              <span className="min-w-0">
                <span className="block text-xs text-slate-600">실행 전</span>
                <CalcValue calc={pv} unit={r.unit} showProvisional={false} />
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-slate-600">실행 후</span>
                <CalcValue calc={cv} unit={r.unit} showProvisional={false} />
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-slate-600">변화</span>
                <DeltaText cmp={compareCalc(pv, cv, r.kind ?? 'normal')} unit={r.unit} ratio={r.kind === 'ratio'} higherIsBetter={r.higherIsBetter ?? true} />
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
    <div className="hidden sm:block">
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>지표</th>
          <th className={thR}>실행 전</th>
          <th className={thR}>실행 후</th>
          <th className={thR}>변화</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const pv: Calc = getMetric(b, r.ref);
          const cv: Calc = getMetric(a, r.ref);
          return (
            <tr key={r.label}>
              <td className={td + ' whitespace-normal'}>
                {r.label}
                {r.sub && <div className="max-w-xs text-xs text-slate-500">{r.sub}</div>}
              </td>
              <td className={tdR}>
                <CalcValue calc={pv} unit={r.unit} />
              </td>
              <td className={tdR}>
                <CalcValue calc={cv} unit={r.unit} />
              </td>
              <td className={tdR}>
                <DeltaText cmp={compareCalc(pv, cv, r.kind ?? 'normal')} unit={r.unit} ratio={r.kind === 'ratio'} higherIsBetter={r.higherIsBetter ?? true} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
    </div>
    </>
  );

  // 예상 vs 실제 영업이익 변화. 실제는 입력된 비용만 반영한 잠정값일 수 있다(미확정 표시)
  const expected = expectedProfitChange(solution.expectedRevenueChange, solution.expectedCostChange, solution.budget, solution.budgetIncludedInCost);
  const dB = profitForDisplay(opB);
  const dA = profitForDisplay(opA);
  const cB = comparableValue(opB);
  const cA = comparableValue(opA);
  const actual = cB !== null && cA !== null ? cA - cB : null;
  const actualGap = !!(opB.salesGap || opA.salesGap);
  const actualProvisional = dB.provisional || dA.provisional;
  const planDays = solution.start && solution.end && solution.start <= solution.end ? daysInclusive(solution.start, solution.end) : null;
  const ctx = reviewContext(b, a, ch);

  return (
    <>
      <RecordGapsNotice periods={[['실행 전', b], ['실행 후', a]]} />
      <BeforeAfter solution={solution} b={b} a={a} routeName={routeName} lastEntry={lastEntry} />
      {all && solution.weekdays?.length ? <WeekdayCompare solution={solution} b={b} a={a} all={all} /> : null}
      {ch === 'delivery' && <DeliveryEvidence solution={solution} b={b} a={a} ctx={ctx} routeName={routeName} />}
      <DetailWrap collapse>
      <Card title="영업이익 변화: 예상과 실제" subtitle="예상은 계획할 때 적은 값, 실제는 실행 후 기간 − 실행 전 기간의 가게 전체 영업이익입니다.">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-sm text-slate-600">예상 (계획)</div>
            <div className={`mt-1 text-xl font-bold ${expected === null ? 'text-slate-500' : ''}`}>{expected === null ? '미입력' : <BigWon value={expected} signed />}</div>
            {planDays !== null && expected !== null && <div className="text-xs text-slate-600">실행 기간 {planDays}일 기준</div>}
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-sm text-slate-600">실제 (실행 후 − 실행 전)</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className={`text-xl font-bold ${actual === null ? 'text-slate-500' : actual >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {actual === null ? (actualGap ? '비교 보류' : '계산 불가') : <BigWon value={actual} signed />}
              </span>
              {actual !== null && actualProvisional && <span className="text-xs font-medium text-slate-500">미확정</span>}
            </div>
            <div className="text-xs text-slate-600">
              실행 전 {b.calendarDays}일(영업 {b.businessDays}일) · 실행 후 {a.calendarDays}일(영업 {a.businessDays}일)
            </div>
            {actualGap && <div className="text-xs text-amber-800">빠진 매출 기록이 있어 부분 합계끼리 빼지 않았어요.</div>}
          </div>
        </div>
        {ctx.businessDaysDiffer && (
          <Notice tone="warn" className="mt-3">
            <p className="font-medium">
              영업일 수가 달라요: 실행 전 {ctx.beforeDays}일, 실행 후 {ctx.afterDays}일
            </p>
            <p className="mt-0.5 text-sm">총액 차이에는 영업일 {Math.abs(ctx.afterDays - ctx.beforeDays)}일 차이가 섞여 있어요. 영업일당 금액으로도 비교하세요.</p>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['영업일당 영업이익', ctx.opPerDay],
                  ['영업일당 매출', ctx.salesPerDay],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="rounded-md bg-white/70 p-2 ring-1 ring-amber-200">
                  <dt className="text-xs font-medium text-slate-700">{label}</dt>
                  <dd className="mt-0.5 grid grid-cols-3 gap-1 text-sm tabular">
                    <span className="min-w-0">
                      <span className="block text-xs text-slate-600">실행 전</span>
                      {fmt(v.before, 'won', b.totalSales.salesGap ? '비교 보류' : '계산 불가')}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs text-slate-600">실행 후</span>
                      {fmt(v.after, 'won', a.totalSales.salesGap ? '비교 보류' : '계산 불가')}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs text-slate-600">하루 변화</span>
                      {fmtSigned(v.delta, 'won')}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </Notice>
        )}
        {expected !== null && actual !== null && (
          <p className="mt-2 text-sm text-slate-700">
            {ctx.businessDaysDiffer ? (
              <>
                단순 전후 차이로는 실제 변화가 예상보다 {manText(Math.abs(actual - expected))} {actual >= expected ? '많지만' : '적지만'}, 영업일 수가 달라({ctx.beforeDays}일 → {ctx.afterDays}일) 이 차이를 그대로 성과로 보기는 어려워요.
                {ctx.opPerDay.delta !== null && <> 영업일당 영업이익은 하루 {fmtSigned(ctx.opPerDay.delta, 'won')} 변했어요.</>}
              </>
            ) : (
              <>
                단순 전후 차이로는 실제 변화가 예상보다 {manText(Math.abs(actual - expected))} {actual >= expected ? '많아요' : '적어요'}.
              </>
            )}
          </p>
        )}
        {ctx.outweighing.length > 0 && ctx.targetDelta !== null && ch !== 'all' && (
          <Notice tone="warn" className="mt-3">
            <p className="font-medium">대상 외 변화가 더 커서 이 실행의 효과로 보기 어렵습니다.</p>
            <p className="mt-0.5 text-sm">
              {ctx.opDelta !== null && <>가게 전체 영업이익 변화 {manText(ctx.opDelta, true)} 가운데 </>}
              대상인 {CHANNEL_LABEL[ch]}의 변화(판매 방식 비용을 뺀 금액)는 {manText(ctx.targetDelta, true)}이고, 대상 외 판매 방식은{' '}
              {ctx.outweighing.map((c) => `${CHANNEL_LABEL[c]} ${manText(ctx.channelDelta[c]!, true)}`).join(', ')}으로 더 커요. 대상 외 판매 방식이 달라진 이유(날씨·행사·다른 할인 등)를 먼저 확인하세요.
            </p>
          </Notice>
        )}
        {planDays !== null && planDays !== a.calendarDays && expected !== null && (
          <p className="mt-1 text-xs text-slate-600">
            실행 후 비교 기간({a.calendarDays}일)이 계획한 실행 기간({planDays}일)과 달라 예상과 바로 비교하기 어려워요.
          </p>
        )}
      </Card>
      {/* 경고는 한 줄만 보이고, 나머지 주의 사항은 접어 둔다 */}
      <Notice tone="warn">
        <p className="font-medium">단순 전후 비교라 날씨·행사·다른 할인 같은 요인이 섞여 있어요.</p>
        <details className="mt-1">
          <summary className="cursor-pointer text-sm underline">주의할 점 {caveats.length + 1}개 더 보기</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
            <li>이 차이를 실행 계획의 효과로 단정하지 마세요. 아래 외부 요인 메모에 함께 기록하세요.</li>
            {caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
      </Notice>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={ch === 'all' ? '대상: 가게 전체 운영' : `대상 판매 방식: ${CHANNEL_LABEL[ch]}${ch === 'delivery' && routeName ? ` (${routeName}만 집계)` : ''}`}>
          {table(scopeRows)}
          {ch !== 'all' && <DiscountEfficiencyNote b={b} a={a} ch={ch} />}
        </Card>
        <Card title="가게 전체" subtitle="판매 방식 성과가 좋아도 전체 영업이익이 함께 나아졌는지 확인하세요.">
          {table(totalRows)}
        </Card>
      </div>

      <Card title="핵심 성과지표와 목표">
        <p className="mb-2 text-xs font-medium text-slate-600">주 지표 (목표 판정 기준)</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">{metricLabelEasy(solution.kpi.key, solution.kpi.channel)} · 실행 전</div>
            <CalcValue calc={kpiBefore} unit={kpiMeta.unit} />
          </div>
          <div>
            <div className="text-xs text-slate-500">실행 후</div>
            <CalcValue calc={kpiAfter} unit={kpiMeta.unit} />
            <div>
              <DeltaText cmp={compareCalc(kpiBefore, kpiAfter, kpiMeta.unit === 'pct' ? 'ratio' : 'normal')} unit={kpiMeta.unit} ratio={kpiMeta.unit === 'pct'} higherIsBetter={kpiMeta.higherIsBetter} />
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-600">목표 ({solution.kpiTargetMode === 'increase' ? '실행 전 대비 변화량 기준' : `${KPI_MODE_LABEL[solution.kpiTargetMode]} 기준`})</div>
            <div className="font-medium">{fmtKpiTarget(solution.kpiTarget, solution.kpiTargetMode, kpiMeta.unit, kpiMeta.higherIsBetter)}</div>
            {solution.kpiTargetMode === 'increase' && judged.actual !== null ? (
              <div className="text-sm text-slate-700">
                실제 {kpiMeta.higherIsBetter ? '증가' : '감소'}분 {actualText}
              </div>
            ) : (
              solution.kpiTargetMode !== 'total' && actualText && <div className="text-sm text-slate-700">실제 {actualText}</div>
            )}
          </div>
          <div>
            <div className="text-sm text-slate-600">목표 달성 여부 (실행 후 기간)</div>
            {achieved === null ? (
              <span className="text-sm text-slate-600">{judged.reason ?? '데이터 필요'}</span>
            ) : achieved ? (
              <Badge tone="green">✓ 달성</Badge>
            ) : (
              <Badge tone="red">✗ 미달</Badge>
            )}
          </div>
        </div>
        {solution.extraKpis.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-slate-600">함께 보는 지표 (목표 없이 실행 전후 비교)</p>
            {table(solution.extraKpis.map((k) => easyRow(k)), false)}
          </div>
        )}
        {(solution.successCriteria || solution.stopCriteria) && (
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            {solution.successCriteria && <p className="rounded bg-emerald-50 p-2 text-emerald-900">성공 기준: {solution.successCriteria}</p>}
            {solution.stopCriteria && <p className="rounded bg-red-50 p-2 text-red-900">중단 기준: {solution.stopCriteria}</p>}
          </div>
        )}
      </Card>

      <Card title="판매 방식별 매출 변화" subtitle="한 판매 방식의 증가가 다른 판매 방식에서 옮겨온 것인지 확인합니다.">
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>판매 방식</th>
              <th className={thR}>실행 전</th>
              <th className={thR}>실행 후</th>
              <th className={thR}>증감</th>
              <th className={thR}>
                남은 돈 변화
                <div className="text-xs font-normal text-slate-500">판매 방식 비용을 뺀 금액</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {CHANNELS.map((c) => (
              <tr key={c} className={c === ch ? 'bg-slate-50 font-medium' : ''}>
                <td className={td}>
                  {CHANNEL_LABEL[c]}
                  {c === ch && (c === 'delivery' && routeName ? ` (대상: ${routeName}만)` : ' (대상)')}
                </td>
                <td className={tdR}>
                  <CalcValue calc={channelSalesCalc(b.channels[c])} unit="won" />
                </td>
                <td className={tdR}>
                  <CalcValue calc={channelSalesCalc(a.channels[c])} unit="won" />
                </td>
                <td className={tdR}>
                  <DeltaText cmp={compareCalc(channelSalesCalc(b.channels[c]), channelSalesCalc(a.channels[c]))} unit="won" />
                </td>
                <td className={tdR}>
                  <DeltaText cmp={compareCalc(b.channels[c].directProfit, a.channels[c].directProfit, 'profit')} unit="won" />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        {scopeSalesUp && otherDown.length > 0 && (
          <Notice tone="warn" className="mt-3">
            대상 판매 방식 매출은 늘었지만 {otherDown.map((c) => CHANNEL_LABEL[c]).join('·')} 매출은 줄었습니다. 다른 판매 방식의 고객을 옮겨온 것일 수 있으니 가게 전체 매출과 영업이익을 함께 판단하세요.
          </Notice>
        )}
        {opDown && (
          <Notice tone="warn" className="mt-3">
            전체 영업이익은 실행 전보다 {fmt(Math.abs(opA.value! - opB.value!), 'won')} 줄었습니다. 대상 지표가 좋아졌더라도 전체 실적을 함께 보세요.
          </Notice>
        )}
      </Card>
      </DetailWrap>
    </>
  );
}

/** 배달 대상 계획: 해석에 필요한 근거 (대상 앱 실적과 가게 전체를 나눠 보고, 전후 차이를 쿠폰 효과로 단정하지 않는다) */
function DeliveryEvidence({ solution, b, a, ctx, routeName }: { solution: Solution; b: PeriodSummary; a: PeriodSummary; ctx: ReviewContext; routeName: string | null }) {
  const data = useData();
  const [allApps, setAllApps] = useState(false);
  const scope = routeName ?? '배달';
  // '한 달간'은 실행 후 기간이 달력 한 달일 때만. 임의 기간이면 그 일수로
  const span = isFullMonth(a.range) ? '한 달간' : `${a.calendarDays}일간`;
  const ordersRef: MetricRef = { key: 'orders', channel: 'delivery' };
  const pairOf = (x: PeriodSummary, y: PeriodSummary, r: MetricRef) => [getMetric(x, r), getMetric(y, r)] as const;
  const pair = (r: MetricRef) => pairOf(b, a, r);
  const others = (['hall', 'takeout'] as Channel[]).filter((c) => b.channels[c].entryCount || a.channels[c].entryCount);
  // 지표별 구체적인 이유 (예: 10월 2일 마감 입력 필요, 식재료비 3건은 메뉴 평균으로 계산)
  const why = { b: { d: calcReasons(data, b, 'delivery'), all: calcReasons(data, b, 'all') }, a: { d: calcReasons(data, a, 'delivery'), all: calcReasons(data, a, 'all') } };
  const reasonsFor = (r: MetricRef, x: Calc, y: Calc) => {
    const key = r.channel === 'all' ? 'all' : 'd';
    return [
      ['실행 전', reasonLine(x, why.b[key])],
      ['실행 후', reasonLine(y, why.a[key])],
    ].filter(([, t]) => t) as [string, string][];
  };
  const cell = (r: MetricRef, kind: 'normal' | 'profit', unit: Unit, x0?: PeriodSummary, y0?: PeriodSummary) => {
    const [x, y] = x0 && y0 ? pairOf(x0, y0, r) : pair(r);
    // 비용 일부 미입력(미확정)이어도 입력된 값끼리의 증감은 '미확정'을 붙여 보여준다. 빠진 매출 기록이 있으면 보류(compareCalc)
    const cx = comparableValue(x);
    const cy = comparableValue(y);
    const base = cx !== null && cy !== null ? compareValues(cx, cy, kind) : compareCalc(x, y, kind);
    const cmp = cx !== null && cy !== null && (x.value === null || y.value === null) ? { ...base, note: [base.note, '미확정'].filter(Boolean).join(' · ') } : base;
    const reasons = reasonsFor(r, x, y);
    return (
      <>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
          <CalcValue calc={x} unit={unit} />
          <span aria-hidden className="text-slate-400">→</span>
          <span className="sr-only">에서</span>
          <CalcValue calc={y} unit={unit} />
        </div>
        <DeltaText cmp={cmp} unit={unit} higherIsBetter={METRIC_META[r.key].higherIsBetter} />
        {reasons.map(([w, t]) => (
          <p key={w} className="mt-0.5 break-words text-xs text-amber-800">
            {w}: {t}
          </p>
        ))}
      </>
    );
  };
  // 모든 배달앱 합계 (대상 앱만 집계하지 않은 원래 요약)
  const fullB = useMemo(() => (routeName && allApps ? computeSummary(data, b.range) : null), [data, b.range, routeName, allApps]);
  const fullA = useMemo(() => (routeName && allApps ? computeSummary(data, a.range) : null), [data, a.range, routeName, allApps]);
  // 집계 기준: 대상 앱을 통한 포장 주문, 앱별로 나눌 수 없는 배달 기간 비용(광고비 등)
  const takeoutOrders = (r: DateRange) => data.sales.filter((e) => e.routeId === solution.coupon.routeId && e.channel === 'takeout' && inRange(e.date, r)).reduce((t, e) => t + (e.orders ?? 0), 0);
  const sharedCost = (r: DateRange) => data.periodCosts.filter((pc) => pc.attribution === 'delivery' && !pc.routeId).reduce((t, pc) => t + allocatePeriodCost(pc, r), 0);
  const memos = memoRanges(data, a.range);
  const perDay = (c: Calc, days: number) => (comparableValue(c) === null || !days ? null : comparableValue(c)! / days);
  return (
    <>
      <Card title="해석에 필요한 근거" subtitle={`${routeName ? `${routeName} 전체의 전후 변화` : '배달 전체의 전후 변화'} · 쿠폰을 쓴 주문과 안 쓴 주문의 손익은 나누지 않았어요`}>
        <dl aria-label="해석에 필요한 맥락" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="min-w-0 rounded-lg p-2.5 ring-1 ring-slate-200">
            <dt className="text-xs font-medium text-slate-600">{scope} 완료 주문 수</dt>
            <dd>{cell(ordersRef, 'normal', 'orders')}</dd>
          </div>
          <div className="min-w-0 rounded-lg p-2.5 ring-1 ring-slate-200">
            <dt className="text-xs font-medium text-slate-600">가게 부담 할인 총액 ({scope})</dt>
            <dd>{cell({ key: 'storeDiscount', channel: 'delivery' }, 'normal', 'won')}</dd>
          </div>
          <div className="min-w-0 rounded-lg p-2.5 ring-1 ring-slate-200">
            <dt className="text-xs font-medium text-slate-600">실제 영업일 수</dt>
            <dd className="mt-1 text-sm tabular">
              {b.businessDays}일 → {a.businessDays}일
              {ctx.businessDaysDiffer && <span className="block text-xs text-amber-800">하루 평균으로도 비교하세요</span>}
            </dd>
          </div>
          {(
            [
              [`영업일당 ${scope} 주문`, ordersRef, 'orders', 1],
              ['영업일당 영업이익', { key: 'operatingProfit', channel: 'all' }, 'won', 0],
            ] as const
          ).map(([label, r, unit, digits]) => {
            const [x, y] = pair(r);
            const px = perDay(x, b.businessDays);
            const py = perDay(y, a.businessDays);
            const t = (v: number | null) => (v === null ? '계산 불가' : `${v.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit === 'won' ? '원' : '건'}`);
            return (
              <div key={label} className="min-w-0 rounded-lg p-2.5 ring-1 ring-slate-200">
                <dt className="text-xs font-medium text-slate-600">{label}</dt>
                <dd className="mt-1 text-sm tabular">
                  {t(px)} → {t(py)}
                  {px !== null && py !== null && (
                    <span className={`block text-xs ${py >= px ? 'text-emerald-700' : 'text-red-700'}`}>
                      {py >= px ? '▲ +' : '▼ −'}
                      {t(Math.abs(py - px))}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
          <div className="min-w-0 rounded-lg p-2.5 ring-1 ring-slate-200">
            <dt className="text-xs font-medium text-slate-600">홀·포장 변화</dt>
            <dd className="mt-1 text-sm">
              {!others.length ? (
                '기록 없음'
              ) : ctx.outweighing.length ? (
                <span className="text-amber-800">{ctx.outweighing.map((c) => `${CHANNEL_LABEL[c]} ${manText(ctx.channelDelta[c]!, true)}`).join(', ')} — 배달 변화보다 커요</span>
              ) : others.some((c) => ctx.gapChannels.includes(c)) ? (
                <span className="text-slate-600">
                  {others.filter((c) => ctx.gapChannels.includes(c)).map((c) => CHANNEL_LABEL[c]).join('·')} {GAP_NOTE}
                </span>
              ) : (
                '배달 변화보다 큰 변화 없음'
              )}
            </dd>
          </div>
        </dl>
        {memos.length > 0 && (
          <ul aria-label="기록 메모" className="mt-3 space-y-1 text-sm text-slate-800">
            {memos.map((m) => (
              <li key={m.memo}>
                📝 {krRange(m.range)} {m.memo}
              </li>
            ))}
          </ul>
        )}
        {routeName && (
          <div className="mt-3">
            <Button size="sm" onClick={() => setAllApps((v) => !v)}>
              {allApps ? '모든 배달앱 합계 닫기' : '모든 배달앱 합계 보기'}
            </Button>
            {allApps && fullB && fullA && (
              <dl aria-label="모든 배달앱 합계" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ['배달 완료 주문 수', ordersRef, 'normal', 'orders'],
                    ['가게 부담 할인 총액 (배달 전체)', { key: 'storeDiscount', channel: 'delivery' }, 'normal', 'won'],
                    ['배달 주문 한 건당 남은 돈', { key: 'directProfitPerOrder', channel: 'delivery' }, 'normal', 'won'],
                    [`배달 전체에서 ${span} 남은 돈`, { key: 'directProfit', channel: 'delivery' }, 'profit', 'won'],
                  ] as const
                ).map(([label, r, kind, unit]) => (
                  <div key={label} className="min-w-0 rounded-lg p-2.5 ring-1 ring-slate-200">
                    <dt className="text-xs font-medium text-slate-600">{label}</dt>
                    <dd>{cell(r, kind, unit, fullB, fullA)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
        {routeName && (
          <More summary="집계 기준 보기 (포장 주문·광고비)" className="mt-2">
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>
                {routeName}를 통한 포장 주문(실행 전 {takeoutOrders(b.range).toLocaleString('ko-KR')}건 · 실행 후 {takeoutOrders(a.range).toLocaleString('ko-KR')}건)은 포장으로 따로 집계해 ①·②에 넣지 않아요. ③에는 들어가요.
              </li>
              <li>
                배달 전체에 걸친 기간 비용(광고비 등, 실행 전 {fmt(sharedCost(b.range), 'won')} · 실행 후 {fmt(sharedCost(a.range), 'won')})은 앱별로 나눌 수 없어 ①·②에서 빼고 ③에만 넣어요.
              </li>
            </ul>
          </More>
        )}
      </Card>
    </>
  );
}

/** 실행 중인 계획: 아직 판단하지 않고, 시작일부터 마지막 입력일까지 쌓인 기록만 보여준다 */
function ProgressSoFar({ solution, a, routeName, daysLeftText }: { solution: Solution; a: PeriodSummary; routeName: string | null; daysLeftText: string | null }) {
  const ch: Channel | 'all' = solution.target === 'common' ? 'all' : solution.target;
  const scope = ch === 'all' ? '가게 전체' : ch === 'delivery' && routeName ? routeName : CHANNEL_LABEL[ch];
  const base: [string, MetricRef, Unit][] =
    ch === 'all'
      ? [['총매출', { key: 'totalSales', channel: 'all' }, 'won'], ['가게 전체 영업이익', { key: 'operatingProfit', channel: 'all' }, 'won']]
      : [
          [`${scope} 완료 주문 수`, { key: 'orders', channel: ch }, 'orders'],
          [`가게 부담 할인 총액 (${scope})`, { key: 'storeDiscount', channel: ch }, 'won'],
          [`${scope} 한 건당 남은 돈`, { key: 'directProfitPerOrder', channel: ch }, 'won'],
          [`${scope}에서 남은 돈`, { key: 'directProfit', channel: ch }, 'won'],
        ];
  // 사용자가 고른 주 지표를 맨 앞에
  const main = base.find(([, r]) => sameRef(r, solution.kpi));
  const rows: [string, MetricRef, Unit][] = main ? [main, ...base.filter((x) => x !== main)] : [[shortName(solution.kpi), solution.kpi, METRIC_META[solution.kpi.key].unit], ...base];
  return (
    <section aria-label="지금까지의 기록" className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <p role="status" className="mb-2 inline-flex flex-wrap items-center gap-2 rounded-md bg-blue-700 px-2.5 py-1 text-sm font-bold text-white">
        실행 중 · 마지막 매출 입력 {krDate(a.range.end)}
      </p>
      {daysLeftText && <span className="mb-2 ml-2 inline-block text-sm font-semibold tabular text-slate-900">{daysLeftText}</span>}
      <p className="text-sm font-semibold text-slate-900">
        지금까지의 기록 · {krRange(a.range)} (영업일 {a.businessDays}일)
      </p>
      <p className="text-xs text-slate-600">실행 중이라 결과 판단은 하지 않아요. 기간이 끝나면 실행 전 기간과 비교합니다.{couponText(solution.coupon, routeName) ? ` · ${couponText(solution.coupon, routeName)}` : ''}</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map(([label, r, unit]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-slate-600">
              {label}
              {sameRef(r, solution.kpi) && <span className="ml-1 rounded bg-blue-100 px-1 text-[11px] font-medium text-blue-800">주 지표</span>}
            </dt>
            <dd className="text-sm">
              <CalcValue calc={getMetric(a, r)} unit={unit} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
