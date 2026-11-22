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
import { compareCalc, computeSummary, expectedProfitChange, getMetric, profitForDisplay, type PeriodSummary } from '../domain/calc';
import { addDays, daysInclusive, formatRange, isValidRange, previousRange, todayStr } from '../domain/dates';
import { couponText, fmt, fmtKpiTarget, fmtPp, fmtSigned, type Unit } from '../domain/format';
import { KPI_MODE_LABEL, daysLeft, judgeKpiTarget, referenceDate, reviewUnavailableReason } from '../domain/periods';
import { CHANNEL_LABEL, DECISION_LABEL, METRIC_DEFINITION, METRIC_META, STATUS_LABEL, easyMetricName, metricLabel, metricLabelEasy } from '../domain/labels';
import { DiscountEfficiencyNote } from '../components/DiscountEfficiency';
import { reviewContext } from '../domain/review';
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
  const b = useMemo(() => (valid ? computeSummary(data, before) : null), [data, before, valid]);
  const a = useMemo(() => (valid ? computeSummary(data, after) : null), [data, after, valid]);
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
        subtitle={`${solution.target === 'common' ? '공통 운영' : CHANNEL_LABEL[solution.target]} 대상 · 실행 ${solution.start ?? '미정'} ~ ${solution.end ?? '미정'}${couponText(solution.coupon) ? ` · ${couponText(solution.coupon)}` : ''}${problem ? ` · 문제: ${problem.name}` : ''}`}
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
      {b && a && <Comparisons solution={solution} b={b} a={a} />}
        </>
      )}

      {!unavailable && <Card title="결과 판단 기록">
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
              hint={`다음 실행 계획을 만들 때 쿠폰 금액 기본값으로 불러와요. 쿠폰을 안 걸기로 했으면 0을 넣으세요.${couponText(solution.coupon) ? ` 이번 계획: ${couponText(solution.coupon)}` : ''}`}
            >
              {(id) => <NumberInput id={id} value={nextCoupon} onChange={setNextCoupon} suffix="원" placeholder="미정" />}
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="실행 계획 상태">
              {(id) => <Select id={id} value={status} onChange={setStatus} options={(Object.keys(STATUS_LABEL) as SolutionStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }))} />}
            </Field>
            <Button variant="primary" onClick={saveReview} disabled={!valid}>
              비교 기간과 판단 저장
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

function Comparisons({ solution, b, a }: { solution: Solution; b: PeriodSummary; a: PeriodSummary }) {
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
  const judged = judgeKpiTarget(solution.kpiTargetMode, solution.kpiTarget, kpiBefore.value, kpiAfter.value, kpiMeta.higherIsBetter, a.businessDays);
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
  const scopeSalesUp = ch !== 'all' && a.channels[ch].netSales > b.channels[ch].netSales;
  const otherDown = ch !== 'all' ? CHANNELS.filter((c) => c !== ch && a.channels[c].netSales < b.channels[c].netSales) : [];
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
  const actual = dB.amount !== null && dA.amount !== null ? dA.amount - dB.amount : null;
  const actualProvisional = dB.provisional || dA.provisional;
  const planDays = solution.start && solution.end && solution.start <= solution.end ? daysInclusive(solution.start, solution.end) : null;
  const ctx = reviewContext(b, a, ch);

  return (
    <>
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
                {actual === null ? '계산 불가' : <BigWon value={actual} signed />}
              </span>
              {actual !== null && actualProvisional && <span className="text-xs font-medium text-slate-500">미확정</span>}
            </div>
            <div className="text-xs text-slate-600">
              실행 전 {b.calendarDays}일(영업 {b.businessDays}일) · 실행 후 {a.calendarDays}일(영업 {a.businessDays}일)
            </div>
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
                      {fmt(v.before, 'won', '계산 불가')}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs text-slate-600">실행 후</span>
                      {fmt(v.after, 'won', '계산 불가')}
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
                <td className={tdR}>{fmt(b.channels[c].netSales, 'won')}</td>
                <td className={tdR}>{fmt(a.channels[c].netSales, 'won')}</td>
                <td className={tdR}>{fmtSigned(a.channels[c].netSales - b.channels[c].netSales, 'won')}</td>
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
