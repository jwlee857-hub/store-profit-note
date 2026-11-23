import { useMemo, useState } from 'react';
import {
  Badge,
  BigWon,
  Button,
  CalcValue,
  Card,
  DeltaText,
  EmptyState,
  Field,
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
import { GAP_NOTE, channelSalesCalc, comparableValue, compareCalc, compareValues, computeSummary, expectedProfitChange, getMetric, profitForDisplay, type PeriodSummary } from '../domain/calc';
import { RecordGapsNotice } from '../components/RecordGaps';
import { addDays, daysInclusive, formatRange, isValidRange, previousRange, todayStr } from '../domain/dates';
import { couponText, fmt, fmtKpiTarget, fmtPp, fmtSigned, type Unit } from '../domain/format';
import { KPI_MODE_LABEL, daysLeft, judgeKpiTarget, referenceDate, reviewUnavailableReason } from '../domain/periods';
import { CHANNEL_LABEL, DECISION_LABEL, METRIC_DEFINITION, METRIC_META, STATUS_LABEL, easyMetricName, metricLabel, metricLabelEasy } from '../domain/labels';
import { DiscountEfficiencyNote } from '../components/DiscountEfficiency';
import { deliveryChangeText, menuAverageFoodCount, reviewContext, scopeToRoute, withChannelFrom, type ReviewContext } from '../domain/review';
import { CHANNELS, type Calc, type Channel, type DateRange, type Decision, type MetricRef, type Solution, type SolutionStatus } from '../domain/types';
import { useApp, useData } from '../state/AppContext';

function defaultReviewRanges(s: Solution, latest: string): { before: DateRange; after: DateRange } {
  if (s.review.before && s.review.after) return { before: s.review.before, after: s.review.after };
  let after: DateRange;
  if (s.start) {
    const end = s.end && s.end < latest ? s.end : latest;
    after = { start: s.start, end: end >= s.start ? end : s.start };
  } else after = { start: addDays(latest, -13), end: latest };
  return { before: previousRange(after), after };
}

export function Performance() {
  const data = useData();
  const { route, navigate } = useApp();
  const solution = data.solutions.find((s) => s.id === route.params.solution) ?? data.solutions[0] ?? null;

  if (!solution)
    return (
      <>
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
      <PageHeader title="성과 확인" description="실행 계획의 실행 전후 기간을 비교하고 결과 판단을 기록합니다." />
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
      </Card>
      <PerformanceBody key={solution.id} solution={solution} />
    </>
  );
}

function PerformanceBody({ solution }: { solution: Solution }) {
  const data = useData();
  const { update, navigate } = useApp();
  const ref = referenceDate(data);
  const init = useMemo(() => defaultReviewRanges(solution, ref), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [manual, setManual] = useState(false);
  const [before, setBefore] = useState<DateRange>(init.before);
  const [after, setAfter] = useState<DateRange>(init.after);
  const [decision, setDecision] = useState<Decision | null>(solution.review.decision);
  const [judgment, setJudgment] = useState(solution.review.judgment);
  const [external, setExternal] = useState(solution.review.externalFactors);
  const [status, setStatus] = useState<SolutionStatus>(solution.status);
  const [nextCoupon, setNextCoupon] = useState<number | null>(solution.review.nextCouponAmount);
  const valid = isValidRange(before) && isValidRange(after);
  const overlap = valid && before.start <= after.end && after.start <= before.end;
  // 한 배달앱만 대상인 배달 계획: 배달 숫자는 그 배달앱 주문만 집계한다 (화면에 표시한 대상 범위와 같게). 가게 전체 합계는 그대로
  const scopeRoute = solution.target === 'delivery' && solution.coupon.routeId && data.routes.some((r) => r.id === solution.coupon.routeId) ? solution.coupon.routeId : null;
  const summarize = (r: DateRange) => {
    const full = computeSummary(data, r);
    return scopeRoute ? withChannelFrom(full, computeSummary(scopeToRoute(data, 'delivery', scopeRoute), r), 'delivery') : full;
  };
  const b = useMemo(() => (valid ? summarize(before) : null), [data, before, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useMemo(() => (valid ? summarize(after) : null), [data, after, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const routeName = scopeRoute ? data.routes.find((r) => r.id === scopeRoute)!.name : null;
  const coupon = couponText(solution.coupon, routeName);
  const problem = data.problems.find((p) => p.id === solution.problemId);
  // 저장된 비교 기간이 없을 때만 자동 판단: 시작 전이거나 실행 후 기간에 매출 입력이 없으면 비교하지 않는다
  const hasSavedRanges = !!(solution.review.before && solution.review.after);
  const today = todayStr();
  const startReason = hasSavedRanges ? null : reviewUnavailableReason(solution, ref, today);
  const unavailable = !manual && !hasSavedRanges && (startReason !== null || (a !== null && a.entryCount === 0));

  const saveReview = () => {
    if (!valid) return;
    update(
      (d) => ({
        ...d,
        solutions: d.solutions.map((s) =>
          s.id === solution.id
            ? { ...s, status, review: { before, after, decision, judgment, externalFactors: external, reviewedAt: new Date().toISOString(), nextCouponAmount: nextCoupon } }
            : s,
        ),
      }),
      '성과 판단을 저장했습니다.',
    );
  };

  return (
    <div className="mt-4 space-y-4">
      <Card
        title={solution.name}
        subtitle={`${solution.target === 'common' ? '공통 운영' : CHANNEL_LABEL[solution.target]} 대상 · 실행 ${solution.start ?? '미정'} ~ ${solution.end ?? '미정'}${coupon ? ` · ${coupon}` : ''}${problem ? ` · 문제: ${problem.name}` : ''}`}
        actions={
          <>
            {problem && (
              <Button size="sm" onClick={() => navigate('diagnosis', { problem: problem.id })}>
                문제 진단 보기
              </Button>
            )}
            <Button size="sm" onClick={() => navigate('solutions', { solution: solution.id, ...(problem ? { problem: problem.id } : {}) })}>
              실행 계획 보기
            </Button>
          </>
        }
      >
        {unavailable ? (
          <div className="space-y-3">
            <Notice tone="info">
              <p className="font-medium">
                {startReason === 'awaitingData' || startReason === null
                  ? '실행 후 매출을 입력하면 확인할 수 있어요'
                  : startReason === 'planned' || startReason === 'notStarted'
                    ? '아직 시작 전인 계획이에요'
                    : startReason === 'endedEarly'
                      ? '끝낸 날까지로 기간을 지정하면 확인할 수 있어요'
                      : '실행 기간이 끝나면 확인할 수 있어요'}
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
                        ? `상태가 '${STATUS_LABEL[solution.status]}'이지만 계획한 종료일(${solution.end})은 아직 오지 않았어요. 일찍 끝냈다면 끝낸 날까지로 기간을 직접 지정해 비교하세요.`
                    : startReason === 'noEnd'
                      ? '종료일이 정해지지 않았어요. 실행 계획에서 종료일을 정하면 그 기간으로 실행 전후를 비교합니다.'
                      : startReason === 'running'
                        ? '실행 중입니다. 기간이 끝나기 전에 비교하면 일부 기간만 반영돼요.'
                        : startReason === 'awaitingData'
                          ? `실행 기간은 끝났지만 매출이 ${ref}까지만 입력되어 있어요. ${solution.end}까지 입력하면 실행 전후를 비교합니다.`
                          : '실행 후 기간에 입력된 매출이 아직 없어요.'}{' '}
                {startReason !== 'awaitingData' && <>실행 기간: {solution.start ?? '미정'} ~ {solution.end ?? '미정'}</>}
              </p>
            </Notice>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (startReason) {
                  // 실행이 시작됐으면 시작일~최근 입력일, 아니면 최근 14일
                  const r = solution.start && solution.start <= ref ? { start: solution.start, end: ref } : { start: addDays(ref, -13), end: ref };
                  setAfter(r);
                  setBefore(previousRange(r));
                }
                setManual(true);
              }}
            >
              기간을 직접 지정해 비교하기
            </Button>
          </div>
        ) : (
          <>
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
          <RangeEdit label="실행 전 기간" value={before} onChange={setBefore} businessDays={b?.businessDays} />
          <RangeEdit label="실행 후 기간" value={after} onChange={setAfter} businessDays={a?.businessDays} />
          <div className="flex items-end">
            <Button size="sm" onClick={() => isValidRange(after) && setBefore(previousRange(after))}>
              실행 전 = 실행 후 직전 같은 기간
            </Button>
          </div>
        </div>
        {overlap && <p className="mt-2 text-xs text-amber-700">두 기간이 겹칩니다. 겹치지 않게 지정하세요.</p>}
        {!valid && <p className="mt-2 text-xs text-red-700">기간을 올바르게 입력하세요.</p>}
          </>
        )}
      </Card>

      {!unavailable && (
        <>
      {b && a && <Comparisons solution={solution} b={b} a={a} routeName={routeName} />}
        </>
      )}

      {!unavailable && <Card title="결과 판단 기록" id="review-record">
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-700">판단</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(DECISION_LABEL) as Decision[]).map((k) => (
                <label key={k} className={`cursor-pointer rounded-lg px-3 py-2 text-sm ring-1 ${decision === k ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-300'}`}>
                  <input type="radio" className="sr-only" name="decision" checked={decision === k} onChange={() => setDecision(k)} />
                  {DECISION_LABEL[k]}
                </label>
              ))}
              {decision && (
                <Button size="sm" variant="ghost" onClick={() => setDecision(null)}>
                  선택 해제
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="판단 근거">{(id) => <TextArea id={id} rows={3} value={judgment} onChange={setJudgment} placeholder="목표 달성 여부, 전체 영업이익 변화, 다른 판매 방식 영향 등" />}</Field>
            <Field label="외부 요인 메모">{(id) => <TextArea id={id} rows={3} value={external} onChange={setExternal} placeholder="예: 실행 후 기간에 공휴일 2일, 장마, 인근 행사, 동시에 진행한 다른 할인" />}</Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="다음 기간 쿠폰 금액 (선택)"
              hint={`‘이 조건으로 2주 재시험’을 누를 때만 새 계획의 쿠폰 금액으로 넘어가요. 비우면 미정, 쿠폰을 그만 걸기로 했으면 0원(중단).${coupon ? ` 이번 계획: ${coupon}` : ''}`}
            >
              {(id) => <NumberInput id={id} value={nextCoupon} onChange={setNextCoupon} suffix="원" placeholder="미정" />}
            </Field>
            <div className="flex flex-wrap items-end gap-2">
              <Button size="sm" onClick={() => setNextCoupon(null)}>미정</Button>
              <Button size="sm" onClick={() => setNextCoupon(0)}>0원으로 중단</Button>
              <span className="self-center text-sm text-slate-700" aria-live="polite">
                {nextCoupon === null ? '다음 쿠폰: 미정' : nextCoupon === 0 ? '다음 쿠폰: 0원 — 쿠폰 중단' : `다음 쿠폰: ${fmt(nextCoupon, 'won')}`}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="실행 계획 상태">
              {(id) => <Select id={id} value={status} onChange={setStatus} options={(Object.keys(STATUS_LABEL) as SolutionStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }))} />}
            </Field>
            <Button variant="primary" onClick={saveReview} disabled={!valid}>
              비교 기간과 판단 저장
            </Button>
            <Button
              onClick={() => {
                // 판단을 저장한 뒤 그 조건(대상 앱·다음 쿠폰액·최소 주문액·핵심 지표)으로 새 초안을 연다. 저장 전까지 고칠 수 있다
                saveReview();
                navigate('solutions', { retest: solution.id });
              }}
              disabled={!valid}
            >
              이 조건으로 2주 재시험
            </Button>
            {solution.review.reviewedAt && <span className="text-xs text-slate-500">마지막 기록 {new Date(solution.review.reviewedAt).toLocaleString('ko-KR')}</span>}
          </div>
        </div>
      </Card>}
    </div>
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

function Comparisons({ solution, b, a, routeName }: { solution: Solution; b: PeriodSummary; a: PeriodSummary; routeName: string | null }) {
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
      {ch === 'delivery' && <CouponDecisionSummary solution={solution} b={b} a={a} ctx={ctx} routeName={routeName} />}
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
        <Card title={ch === 'all' ? '대상: 가게 전체 운영' : `대상 판매 방식: ${CHANNEL_LABEL[ch]}`}>
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
                  {c === ch && ' (대상)'}
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
    </>
  );
}

/**
 * 배달 대상 계획의 첫 화면: 다음 쿠폰을 정할 때 보는 세 숫자와 해석에 필요한 맥락.
 * 전후 차이일 뿐 쿠폰 효과로 단정하지 않는다.
 */
function CouponDecisionSummary({ solution, b, a, ctx, routeName }: { solution: Solution; b: PeriodSummary; a: PeriodSummary; ctx: ReviewContext; routeName: string | null }) {
  const three: { n: string; label: string; ref: MetricRef; kind: 'normal' | 'profit' }[] = [
    { n: '①', label: routeName ? `${routeName} 배달 한 건당 남은 돈` : '배달 한 건당 남은 돈', ref: { key: 'directProfitPerOrder', channel: 'delivery' }, kind: 'normal' },
    { n: '②', label: routeName ? `${routeName} 배달 전체에서 남은 돈` : '배달 전체에서 남은 돈', ref: { key: 'directProfit', channel: 'delivery' }, kind: 'profit' },
    { n: '③', label: '가게 전체 영업이익', ref: { key: 'operatingProfit', channel: 'all' }, kind: 'profit' },
  ];
  const ordersRef: MetricRef = { key: 'orders', channel: 'delivery' };
  const pair = (r: MetricRef) => [getMetric(b, r), getMetric(a, r)] as const;
  const [perB, perA] = pair(three[0].ref);
  const [totB, totA] = pair(three[1].ref);
  const [ordB, ordA] = pair(ordersRef);
  const nums = [perB, perA, totB, totA, ordB, ordA].map(comparableValue);
  // 주문 수가 모든 날에 있어야(건당 값이 계산된 기준과 같아야) 문장으로 묶는다
  const sentence = nums.every((v) => v !== null) && !ordB.basis && !ordA.basis ? deliveryChangeText([nums[0]!, nums[1]!], [nums[4]!, nums[5]!], [nums[2]!, nums[3]!], routeName ? `${routeName} 배달 전체` : undefined) : null;
  const others = (['hall', 'takeout'] as Channel[]).filter((c) => b.channels[c].entryCount || a.channels[c].entryCount);
  const data = useData();
  const foodB = menuAverageFoodCount(data, b, 'delivery');
  const foodA = menuAverageFoodCount(data, a, 'delivery');
  const goReview = () => {
    const el = document.getElementById('review-record');
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    (el?.querySelector('input,textarea,button') as HTMLElement | null)?.focus();
  };
  const cell = (r: MetricRef, kind: 'normal' | 'profit', unit: Unit) => {
    const [x, y] = pair(r);
    // 비용 일부 미입력(미확정)이어도 입력된 값끼리의 증감은 '미확정'을 붙여 보여준다. 빠진 매출 기록이 있으면 보류(compareCalc)
    const cx = comparableValue(x);
    const cy = comparableValue(y);
    const base = cx !== null && cy !== null ? compareValues(cx, cy, kind) : compareCalc(x, y, kind);
    const cmp = cx !== null && cy !== null && (x.value === null || y.value === null) ? { ...base, note: [base.note, '미확정'].filter(Boolean).join(' · ') } : base;
    return (
      <>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
          <CalcValue calc={x} unit={unit} />
          <span aria-hidden className="text-slate-400">→</span>
          <span className="sr-only">에서</span>
          <CalcValue calc={y} unit={unit} />
        </div>
        <DeltaText cmp={cmp} unit={unit} higherIsBetter={METRIC_META[r.key].higherIsBetter} />
      </>
    );
  };
  return (
    <Card
      title="다음 쿠폰을 정할 때 볼 세 숫자"
      subtitle={`실행 전 ${formatRange(b.range)} → 실행 후 ${formatRange(a.range)}${couponText(solution.coupon, routeName) ? ` · ${couponText(solution.coupon, routeName)}` : ''}`}
      actions={
        <Button size="sm" variant="primary" onClick={goReview}>
          결과 판단 기록하기
        </Button>
      }
    >
      <div aria-label="쿠폰 결정 세 지표" className="grid gap-2 sm:grid-cols-3">
        {three.map((m) => (
          <div key={m.n} className="min-w-0 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="text-sm font-semibold text-slate-900">
              {m.n} {m.label}
            </div>
            {cell(m.ref, m.kind, 'won')}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs font-medium text-slate-700">
        {routeName ? `${routeName} 전체의 전후 변화` : '배달 전체의 전후 변화'} · 쿠폰을 쓴 주문과 안 쓴 주문의 손익은 나누지 않았어요
        {routeName && ' · 배달 전체에 걸친 기간 비용(광고비 등)은 빼고 계산'}
        {solution.coupon.usedCount !== null && ` · 쿠폰 사용 ${solution.coupon.usedCount.toLocaleString('ko-KR')}건(사장님 입력)`}
      </p>
      {sentence && <p className="mt-2 text-base font-medium text-slate-900">{sentence}</p>}
      {foodB + foodA > 0 && (
        <p className="mt-1 text-xs text-amber-800">
          근거: 식재료비는 메뉴 평균 원가율로 추정했어요 (실행 전 {foodB}건 · 실행 후 {foodA}건). 실제 원가율을 넣으면 ①·②·③이 바뀔 수 있어요.
        </p>
      )}
      <p className="mt-1 text-xs text-slate-600">
        ①·②는 배달 매출에서 배달 직접 비용(식재료·수수료·배달비·포장비 등)만 뺀 금액, ③은 월세·인건비 같은 공통비까지 뺀 가게 전체 금액이에요. 실행 전후 차이라 날씨·노출·다른 판매 방식 변화가 섞여 있어 쿠폰 때문이라고 단정할 수 없어요.
      </p>
      <dl aria-label="해석에 필요한 맥락" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="min-w-0 rounded-lg p-2.5 ring-1 ring-slate-200">
          <dt className="text-xs font-medium text-slate-600">배달 완료 주문 수</dt>
          <dd>{cell(ordersRef, 'normal', 'orders')}</dd>
        </div>
        <div className="min-w-0 rounded-lg p-2.5 ring-1 ring-slate-200">
          <dt className="text-xs font-medium text-slate-600">가게 부담 할인액 (배달)</dt>
          <dd>{cell({ key: 'storeDiscount', channel: 'delivery' }, 'normal', 'won')}</dd>
        </div>
        <div className="min-w-0 rounded-lg p-2.5 ring-1 ring-slate-200">
          <dt className="text-xs font-medium text-slate-600">실제 영업일 수</dt>
          <dd className="mt-1 text-sm tabular">
            {b.businessDays}일 → {a.businessDays}일
            {ctx.businessDaysDiffer && <span className="block text-xs text-amber-800">하루 평균으로도 비교하세요</span>}
          </dd>
        </div>
        <div className="min-w-0 rounded-lg p-2.5 ring-1 ring-slate-200">
          <dt className="text-xs font-medium text-slate-600">홀·포장 변화</dt>
          <dd className="mt-1 text-sm">
            {!others.length
              ? '기록 없음'
              : ctx.outweighing.length
                ? <span className="text-amber-800">{ctx.outweighing.map((c) => `${CHANNEL_LABEL[c]} ${manText(ctx.channelDelta[c]!, true)}`).join(', ')} — 배달 변화보다 커요</span>
                : others.some((c) => ctx.gapChannels.includes(c))
                  ? <span className="text-slate-600">{others.filter((c) => ctx.gapChannels.includes(c)).map((c) => CHANNEL_LABEL[c]).join('·')} {GAP_NOTE}</span>
                  : '배달 변화보다 큰 변화 없음'}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
