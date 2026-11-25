import { useEffect, useMemo, useState } from 'react';
import { CheckSteps } from '../components/CheckSteps';
import { MetricPicker, validMetricRef } from '../components/MetricPicker';
import { WeekdayPicker } from '../components/WeekdayPicker';
import {
  Badge,
  Button,
  CalcValue,
  Card,
  Checkbox,
  DateInput,
  EmptyState,
  Field,
  Modal,
  More,
  Notice,
  NumberInput,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  ToggleGroup,
  type BadgeTone,
} from '../components/ui';
import { computeSummary, expectedProfitChange, getMetric } from '../domain/calc';
import { addDays, daysInclusive, formatRange, isValidDate, isValidRange, nextMonday as nextMondayOf, previousRange } from '../domain/dates';
import { retestDraft, solutionDraft } from '../domain/draft';
import { newSolution } from '../domain/factory';
import { couponText, fmt, fmtKpiTarget, fmtSigned, hasCoupon, josa, kpiTargetSuffix, weekdaysText } from '../domain/format';
import { CHANNEL_LABEL, DECISION_LABEL, DIRECTION_LABEL, METRIC_META, STATUS_LABEL, metricLabelEasy, resultLabel } from '../domain/labels';
import { appToday, KPI_MODE_LABEL, kpiModeAllowed, kpiTargetWarning, recentRanges } from '../domain/periods';
import { DELIVERY_KPI_SET, SOLUTION_TEMPLATES, defaultKpisFor, sameMetric } from '../domain/templates';
import { CHANNELS, type KpiTargetMode, type MetricRef, type Solution, type SolutionStatus } from '../domain/types';
import { useApp, useData } from '../state/AppContext';

const STATUS_TONE: Record<SolutionStatus, BadgeTone> = { planned: 'gray', running: 'blue', reviewPending: 'amber', done: 'green', stopped: 'red' };

export function Solutions() {
  const data = useData();
  const { route, navigate, update, confirm } = useApp();
  const problemFilter = route.params.problem ?? 'all';
  const [editing, setEditing] = useState<Solution | null>(null);

  useEffect(() => {
    const prev = route.params.retest ? data.solutions.find((x) => x.id === route.params.retest) : undefined;
    const existing = prev ? data.solutions.find((s) => s.retestOf === prev.id) : undefined;
    if (existing) {
      // 이미 이어진 재시험이 있으면 새로 만들지 않고 그 계획을 보여준다 (반복 클릭·새로고침으로 중복 생성 방지)
      navigate('performance', { solution: existing.id });
    } else if (prev) {
      // 성과 확인의 '이 조건으로 재시험 만들기'에서만 이전 계획의 조건을 넘긴다
      setEditing(retestDraft(prev, appToday(data)));
      navigate('solutions', prev.problemId ? { problem: prev.problemId } : {});
    } else if (route.params.new === '1') {
      const problem = data.problems.find((p) => p.id === route.params.problem) ?? null;
      setEditing(solutionDraft(data, problem, route.params.finding ?? null));
      navigate('solutions', route.params.problem ? { problem: route.params.problem } : {});
    } else if (route.params.solution) {
      document.getElementById(`sol-${route.params.solution}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [route.params.new, route.params.solution, route.params.retest]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = data.solutions.filter((s) => problemFilter === 'all' || (problemFilter === 'none' ? s.problemId === null : s.problemId === problemFilter));

  const focusSol = data.solutions.find((s) => s.id === route.params.solution);
  return (
    <>
      <CheckSteps current="solutions" problemId={focusSol?.problemId ?? (problemFilter !== 'all' && problemFilter !== 'none' ? problemFilter : null)} solutionId={focusSol?.id} />
      <PageHeader
        title="실행 계획"
        description="무엇을 바꿔 보고, 언제 결과를 볼지 정해요."
        actions={
          <Button variant="primary" onClick={() => setEditing(newSolution({ problemId: problemFilter !== 'all' && problemFilter !== 'none' ? problemFilter : null }))}>
            실행 계획 등록
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="문제별 보기">
            {(id) => (
              <Select
                id={id}
                value={problemFilter}
                onChange={(v) => navigate('solutions', v === 'all' ? {} : { problem: v })}
                options={[{ value: 'all', label: '전체' }, ...data.problems.map((p) => ({ value: p.id, label: p.name })), { value: 'none', label: '연결된 문제 없음' }]}
              />
            )}
          </Field>
          <span className="text-sm text-slate-500">{list.length}개</span>
        </div>
      </Card>

      <div className="mt-4 space-y-3">
        {!list.length ? (
          <EmptyState
            title="실행 계획이 없습니다"
            description="문제 진단 화면에서 확인할 항목을 고른 뒤 ‘실행 계획 만들기’를 누르면 내용이 미리 채워집니다."
            action={
              <Button variant="primary" onClick={() => setEditing(newSolution({ problemId: problemFilter !== 'all' && problemFilter !== 'none' ? problemFilter : null }))}>
                실행 계획 등록
              </Button>
            }
          />
        ) : (
          list.map((s) => {
            const problem = data.problems.find((p) => p.id === s.problemId);
            const ep = expectedProfitChange(s.expectedRevenueChange, s.expectedCostChange, s.budget, s.budgetIncludedInCost);
            const kpiUnit = METRIC_META[s.kpi.key].unit;
            return (
              <div key={s.id} id={`sol-${s.id}`} className={`rounded-xl bg-white p-4 shadow-sm ring-1 ${route.params.solution === s.id ? 'ring-2 ring-slate-900' : 'ring-slate-200'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{s.name}</h3>
                      <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                      <Badge>{s.target === 'common' ? '공통 운영' : CHANNEL_LABEL[s.target]}</Badge>
                      <Badge tone="violet">{DIRECTION_LABEL[s.direction]}</Badge>
                      {s.review.decision && <Badge tone="green">판단: {DECISION_LABEL[s.review.decision]}</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {problem ? (
                        <button className="underline" onClick={() => navigate('diagnosis', { problem: problem.id })}>
                          문제: {problem.name}
                        </button>
                      ) : (
                        '연결된 문제 없음'
                      )}
                      {' · '}
                      {s.start ?? '시작일 미정'} ~ {s.end ?? '종료일 미정'} · 담당 {s.owner || '미정'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Select
                      value={s.status}
                      onChange={(v) => update((d) => ({ ...d, solutions: d.solutions.map((x) => (x.id === s.id ? { ...x, status: v } : x)) }), `상태를 ${josa(`'${STATUS_LABEL[v]}'`, '으로/로')} 바꿨습니다.`)}
                      options={(Object.keys(STATUS_LABEL) as SolutionStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }))}
                    />
                    <Button size="sm" onClick={() => setEditing(structuredClone(s))}>
                      수정
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => navigate('performance', { solution: s.id })}>
                      {resultLabel(s)}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (await confirm({ title: '실행 계획 삭제', message: `${josa(`"${s.name}"`, '과/와')} 기록된 성과 판단을 삭제할까요? 되돌릴 수 없습니다.`, confirmText: '삭제' }))
                          update((d) => ({ ...d, solutions: d.solutions.filter((x) => x.id !== s.id) }), '실행 계획을 삭제했습니다.');
                      }}
                    >
                      삭제
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <div className="text-xs text-slate-500">원인 가설</div>
                    <p>{s.hypothesis || '—'}</p>
                    {s.evidence && <p className="mt-1 text-xs text-slate-500">근거: {s.evidence}</p>}
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">실행 내용</div>
                    <p className="whitespace-pre-line">{s.actions || '—'}</p>
                  </div>
                  <div className="tabular">
                    <div className="text-xs text-slate-500">예상 효과 (실행 기간 기준)</div>
                    <p>매출 변화 {s.expectedRevenueChange === null ? '미입력' : fmtSigned(s.expectedRevenueChange, 'won')}</p>
                    <p>
                      비용 변화 {s.expectedCostChange === null ? '미입력' : fmtSigned(s.expectedCostChange, 'won')}
                      {!s.budgetIncludedInCost && s.budget ? ` + 예산 ${fmt(s.budget, 'won')}` : ''}
                    </p>
                    <p className="font-semibold">영업이익 변화 {ep === null ? '미입력' : fmtSigned(ep, 'won')}</p>
                    <p className="text-xs text-slate-500">예산 {fmt(s.budget, 'won')}{s.budgetIncludedInCost ? ' (비용 변화에 포함)' : ''}</p>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">핵심 성과지표</div>
                    <p>
                      {metricLabelEasy(s.kpi.key, s.kpi.channel)} 목표 {fmtKpiTarget(s.kpiTarget, s.kpiTargetMode, kpiUnit, METRIC_META[s.kpi.key].higherIsBetter)}
                    </p>
                    {s.extraKpis.length > 0 && <p className="mt-1 text-xs text-slate-600">함께 보기: {s.extraKpis.map((k) => metricLabelEasy(k.key, k.channel)).join(', ')}</p>}
                    {weekdaysText(s.weekdays) && <p className="mt-1 text-xs text-slate-700">적용 요일: {weekdaysText(s.weekdays)}</p>}
                    {couponText(s.coupon, data.routes.find((r) => r.id === s.coupon.routeId)?.name) && <p className="mt-1 text-xs text-slate-700">{couponText(s.coupon, data.routes.find((r) => r.id === s.coupon.routeId)?.name)}</p>}
                    {s.review.nextCouponAmount !== null && <p className="text-xs text-slate-700">결과 판단: 다음 기간 쿠폰 {s.review.nextCouponAmount === 0 ? '없음' : fmt(s.review.nextCouponAmount, 'won')}</p>}
                    {s.successCriteria && <p className="mt-1 text-xs text-emerald-800">성공: {s.successCriteria}</p>}
                    {s.stopCriteria && <p className="text-xs text-red-800">중단: {s.stopCriteria}</p>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {editing && <SolutionEditor initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SolutionEditor({ initial, onClose }: { initial: Solution; onClose: () => void }) {
  const data = useData();
  const { update, navigate } = useApp();
  // 쿠폰 조건은 받은 초안 그대로 (일반 새 계획은 빈 조건, 재시험 초안은 이전 계획의 조건)
  const [s, setS] = useState<Solution>(initial);
  const deliveryApps = data.routes.filter((r) => r.platformId && r.channels.includes('delivery'));
  const setCoupon = (patch: Partial<Solution['coupon']>) => setS((x) => ({ ...x, coupon: { ...x.coupon, ...patch } }));
  const [touched, setTouched] = useState(false);
  const isNew = !data.solutions.some((x) => x.id === s.id);
  const set = <K extends keyof Solution>(k: K, v: Solution[K]) => setS((x) => ({ ...x, [k]: v }));
  const ep = expectedProfitChange(s.expectedRevenueChange, s.expectedCostChange, s.budget, s.budgetIncludedInCost);
  const meta = METRIC_META[s.kpi.key];
  const kpiUnit = meta.unit;
  const problem = data.problems.find((p) => p.id === s.problemId) ?? null;

  // 비교 기준 실적: 실행 기간이 정해졌으면 그 직전 같은 길이 기간(실행 전),
  // 아니면 연결된 문제의 분석 기간, 그것도 없으면 최근 4주
  const datesOk = !!(s.start && s.end && isValidDate(s.start) && isValidDate(s.end) && s.start <= s.end);
  const fallbackRange = problem && isValidRange(problem.analysis) ? problem.analysis : recentRanges(data).cur;
  const beforeRange = datesOk ? previousRange({ start: s.start!, end: s.end! }) : null;
  const beforeSummary = useMemo(() => (beforeRange ? computeSummary(data, beforeRange, s.weekdays) : null), [data, beforeRange?.start, beforeRange?.end, s.weekdays]); // eslint-disable-line react-hooks/exhaustive-deps
  const fallbackSummary = useMemo(() => computeSummary(data, fallbackRange, s.weekdays), [data, fallbackRange.start, fallbackRange.end, s.weekdays]); // eslint-disable-line react-hooks/exhaustive-deps
  const useBefore = !!beforeSummary && beforeSummary.entryCount > 0;
  const baseRange = useBefore ? beforeRange! : fallbackRange;
  const baseSummary = useBefore ? beforeSummary! : fallbackSummary;
  const baseLabel = useBefore ? '실행 전 실적' : '현재 실적';
  const current = getMetric(baseSummary, s.kpi);
  const targetWarn = kpiTargetWarning(s.kpiTargetMode, s.kpiTarget, current.value, baseSummary.businessDays, meta.higherIsBetter);
  const modes = (Object.keys(KPI_MODE_LABEL) as KpiTargetMode[]).filter((m) => kpiModeAllowed(s.kpi.key, kpiUnit, m) || m === s.kpiTargetMode);

  const errs: Record<string, string> = {};
  if (!s.name.trim()) errs.name = '무엇을 바꿀지 한 줄로 적어 주세요.';
  if (s.start && !isValidDate(s.start)) errs.start = '날짜 형식 오류';
  if (s.end && !isValidDate(s.end)) errs.end = '날짜 형식 오류';
  if (s.start && s.end && s.start > s.end) errs.end = '종료일이 시작일보다 빠릅니다.';
  if (s.budget !== null && s.budget < 0) errs.budget = '예산은 0 이상입니다.';
  if (!kpiModeAllowed(s.kpi.key, kpiUnit, s.kpiTargetMode)) errs.kpiTarget = `이 지표에는 '${KPI_MODE_LABEL[s.kpiTargetMode]}' 기준을 쓸 수 없습니다. 다른 기준을 고르세요.`;
  const show = (k: string) => (touched ? errs[k] : undefined);
  const days = s.start && s.end && isValidDate(s.start) && isValidDate(s.end) && s.start <= s.end ? daysInclusive(s.start, s.end) : null;

  const applyTemplate = (tid: string) => {
    const t = SOLUTION_TEMPLATES.find((x) => x.id === tid);
    if (!t) return;
    setS((x) => ({
      ...x,
      templateId: t.id,
      name: x.name.trim() ? x.name : t.name,
      target: t.target,
      direction: t.direction,
      // 진단에서 가져온 가설·근거가 있으면 덮어쓰지 않는다
      hypothesis: x.hypothesis.trim() ? x.hypothesis : t.hypothesis,
      actions: `${t.actions}\n(예시 문구입니다. 가게 상황에 맞게 고쳐 쓰세요.)`,
      ...defaultKpisFor(t.target, validMetricRef(t.kpi)),
      kpiTargetMode: 'total',
      successCriteria: t.successCriteria,
      stopCriteria: t.stopCriteria,
    }));
  };

  const save = () => {
    setTouched(true);
    if (Object.keys(errs).length) return;
    const clean = { ...s, name: s.name.trim() };
    update((d) => ({ ...d, solutions: isNew ? [...d.solutions, clean] : d.solutions.map((x) => (x.id === clean.id ? clean : x)) }), isNew ? '실행 계획을 저장했습니다.' : '실행 계획을 수정했습니다.');
    navigate('solutions', { ...(clean.problemId ? { problem: clean.problemId } : {}), solution: clean.id });
    onClose();
  };

  const nextMonday = nextMondayOf(appToday(data));

  return (
    <Modal
      wide
      title={isNew ? '실행 계획 등록' : '실행 계획 수정'}
      onClose={onClose}
      footer={
        <>
          {touched && Object.keys(errs).length > 0 && (
            <span className="mr-auto w-full text-sm text-red-700 sm:w-auto" role="alert">
              ⛔ 표시된 칸을 확인하세요.
            </span>
          )}
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={save}>
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {problem && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800 ring-1 ring-slate-200">
            <div>
              연결된 문제: <b>{problem.name}</b>
            </div>
            <div className="text-slate-700">
              분석 {formatRange(problem.analysis)} · 비교 {formatRange(problem.compare)}
            </div>
            {s.evidence && <div className="mt-1">근거: {s.evidence}</div>}
          </div>
        )}

        <section className="space-y-3">
          <h3 className="text-base font-semibold">1. 무엇을 바꿀까요?</h3>
          <Field label="한 줄 요약" required error={show('name')}>
            {(id) => <TextInput id={id} value={s.name} onChange={(v) => set('name', v)} placeholder="예: 배달 할인 쿠폰 금액 줄여 보기" />}
          </Field>
          <Field label="실행 내용" hint="누가 언제 무엇을 하는지 적으면 실행하기 쉽습니다.">
            {(id) => <TextArea id={id} rows={3} value={s.actions} onChange={(v) => set('actions', v)} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="어디에 적용하나요?">
              {(id) => (
                <Select
                  id={id}
                  value={s.target}
                  onChange={(v) =>
                    setS((x) => {
                      // 배달로 바꾸고 함께 볼 지표를 아직 고르지 않았으면 쿠폰 결정용 세 지표를 제안한다
                      if (v === 'delivery' && x.target !== 'delivery' && !x.extraKpis.length) {
                        const main = x.kpi.channel === 'delivery' ? x.kpi : undefined;
                        const k = defaultKpisFor('delivery', main);
                        return { ...x, target: v, ...k, kpiTargetMode: kpiModeAllowed(k.kpi.key, METRIC_META[k.kpi.key].unit, x.kpiTargetMode) ? x.kpiTargetMode : 'total' };
                      }
                      return { ...x, target: v };
                    })
                  }
                  options={[...CHANNELS.map((c) => ({ value: c as Solution['target'], label: CHANNEL_LABEL[c] })), { value: 'common', label: '가게 전체(공통 운영)' }]}
                />
              )}
            </Field>
            <Field label="예시에서 시작 (선택)" hint="검증된 처방이 아닌 작성 예시입니다. 고쳐 쓰세요.">
              {(id) => (
                <Select
                  id={id}
                  value={s.templateId ?? ''}
                  onChange={(v) => v && applyTemplate(v)}
                  options={[{ value: '', label: '예시 쓰지 않음' }, ...SOLUTION_TEMPLATES.map((t) => ({ value: t.id, label: t.name }))]}
                />
              )}
            </Field>
          </div>
          {/* 쿠폰 조건은 배달 계획이거나 이미 쿠폰 조건이 있는 계획에서만. 쿠폰 계획(저장된 조건·쿠폰 예시)은 펼쳐서 바로 보인다 */}
          {(s.target === 'delivery' || hasCoupon(initial.coupon)) && (
          <More summary="쿠폰·할인 조건" defaultOpen={hasCoupon(initial.coupon) || initial.templateId === 'delivery-discount'}>
          <fieldset aria-label="쿠폰·할인 조건" className="rounded-lg p-3 ring-1 ring-slate-200">
            <legend className="px-1 text-sm font-medium text-slate-800">쿠폰·할인 조건 (선택)</legend>
            {s.target === 'delivery' && deliveryApps.length > 0 && (
              <Field label="대상 배달앱" hint="고르면 성과 확인의 배달 숫자도 이 배달앱 주문만 집계해요.">
                {(id) => (
                  <Select
                    id={id}
                    value={s.coupon.routeId ?? ''}
                    onChange={(v) => setCoupon({ routeId: v || null })}
                    options={[{ value: '', label: '배달 전체' }, ...deliveryApps.map((r) => ({ value: r.id, label: r.name }))]}
                  />
                )}
              </Field>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="기존 쿠폰 금액">
                {(id) => <NumberInput id={id} value={s.coupon.previousAmount} onChange={(v) => setCoupon({ previousAmount: v })} suffix="원" placeholder="모름" />}
              </Field>
              <Field label="쿠폰 금액" hint="시험할 금액. 비우면 미정, 0이면 쿠폰 중단">
                {(id) => <NumberInput id={id} value={s.coupon.amount} onChange={(v) => setCoupon({ amount: v })} suffix="원" placeholder="미정" />}
              </Field>
              <Field label="최소 주문금액">
                {(id) => <NumberInput id={id} value={s.coupon.minOrder} onChange={(v) => setCoupon({ minOrder: v })} suffix="원" placeholder="미정" />}
              </Field>
              <Field label="쿠폰 사용 건수 (아는 경우만)" hint="배달앱 통계에서 확인한 경우에만 넣으세요.">
                {(id) => <NumberInput id={id} value={s.coupon.usedCount} onChange={(v) => setCoupon({ usedCount: v })} suffix="건" placeholder="모름" />}
              </Field>
            </div>
            <p className="mt-2 text-sm text-slate-700" aria-live="polite">
              {s.coupon.amount === null ? '시험 쿠폰: 미정' : s.coupon.amount === 0 ? '시험 쿠폰: 0원 — 쿠폰 중단' : `시험 쿠폰: ${fmt(s.coupon.amount, 'won')}`}
              {s.start && s.end ? ` · 적용 기간 ${s.start} ~ ${s.end}` : ' · 적용 기간은 아래 실행 기간'}
            </p>
            <p className="mt-1 text-xs text-slate-500">조건을 적어 두면 성과 확인에서 어떤 쿠폰으로 낸 결과인지 함께 보여 줘요. 비워 둬도 됩니다.</p>
          </fieldset>
          </More>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-semibold">2. 언제 결과를 볼까요?</h3>
          <p className="-mt-2 text-sm text-slate-700">해볼 기간을 정하면 끝난 뒤 그 직전 같은 길이 기간과 비교해요.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="시작일" error={show('start')}>
              {(id) => <DateInput id={id} value={s.start} onChange={(v) => set('start', v || null)} />}
            </Field>
            <Field label="종료일" error={show('end')}>
              {(id) => <DateInput id={id} value={s.end} onChange={(v) => set('end', v || null)} />}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setS((x) => ({ ...x, start: nextMonday, end: addDays(nextMonday, 13) }))}>
              다음 주 월요일부터 2주
            </Button>
            <Button size="sm" onClick={() => setS((x) => ({ ...x, start: nextMonday, end: addDays(nextMonday, 27) }))}>
              다음 주 월요일부터 4주
            </Button>
            <span className="text-sm text-slate-700">{days ? `실행 기간 ${days}일` : '날짜는 나중에 정해도 저장할 수 있어요.'}</span>
          </div>
        </section>

        <More summary="상세 옵션 (선택): 목표 지표·적용 요일·예상 효과·담당자·성공/중단 기준">
        <div className="space-y-5 rounded-lg p-3 ring-1 ring-slate-200">
        <section className="space-y-3">
          <h3 className="text-base font-semibold">무엇으로 확인할까요?</h3>
          <MetricPicker
            label="주 지표 (목표를 정할 지표)"
            value={s.kpi}
            onChange={(k) =>
              setS((x) => ({
                ...x,
                kpi: k,
                // 주 지표로 올린 지표는 함께 볼 지표에서 뺀다 (두 번 보이지 않게)
                extraKpis: x.extraKpis.filter((m) => !sameMetric(m, k)),
                kpiTargetMode: kpiModeAllowed(k.key, METRIC_META[k.key].unit, x.kpiTargetMode) ? x.kpiTargetMode : 'total',
              }))
            }
          />
          <ExtraKpiPicker
            target={s.target}
            main={s.kpi}
            value={s.extraKpis}
            onChange={(v) => set('extraKpis', v)}
            onDeliveryDefaults={() => setS((x) => ({ ...x, ...defaultKpisFor('delivery', DELIVERY_KPI_SET.some((m) => sameMetric(m, x.kpi)) ? x.kpi : undefined) }))}
          />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-800">목표 기준</span>
            <ToggleGroup value={s.kpiTargetMode} onChange={(v) => set('kpiTargetMode', v)} options={modes.map((m) => ({ value: m, label: KPI_MODE_LABEL[m] }))} />
            <p className="text-sm text-slate-700">{modeExplain(s.kpiTargetMode, meta.higherIsBetter)}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`목표값 (선택, ${kpiTargetSuffix(s.kpiTargetMode, kpiUnit)})`} error={show('kpiTarget')}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={s.kpiTarget}
                  onChange={(v) => set('kpiTarget', v)}
                  allowNegative
                  allowDecimal={kpiUnit === 'pct' || s.kpiTargetMode === 'growthRate'}
                  suffix={kpiTargetSuffix(s.kpiTargetMode, kpiUnit)}
                  placeholder="미입력"
                />
              )}
            </Field>
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
              <div>
                {baseLabel} ({formatRange(baseRange)}): <CalcValue calc={current} unit={kpiUnit} showProvisional={false} />
                {s.kpiTargetMode === 'perBusinessDay' && current.value !== null && baseSummary.businessDays > 0 && (
                  <span> · 영업일당 {fmt(current.value / baseSummary.businessDays, kpiUnit)}</span>
                )}
              </div>
              <div className="mt-1 text-slate-700">
                목표 기간: {s.start && s.end ? `실행 기간 ${s.start} ~ ${s.end}${days ? ` (${days}일)` : ''}` : '실행 기간을 정하면 그 기간으로 판정합니다'}
              </div>
              {s.kpiTarget !== null && <div className="mt-1">목표: {metricLabelEasy(s.kpi.key, s.kpi.channel)} {fmtKpiTarget(s.kpiTarget, s.kpiTargetMode, kpiUnit, meta.higherIsBetter)}</div>}
            </div>
          </div>
          {targetWarn === 'notBetter' && current.value !== null && (
            <Notice tone="warn">
              목표값({fmtKpiTarget(s.kpiTarget, s.kpiTargetMode, kpiUnit, meta.higherIsBetter)})이 {baseLabel}(
              {s.kpiTargetMode === 'perBusinessDay' && baseSummary.businessDays > 0 ? `영업일당 ${fmt(current.value / baseSummary.businessDays, kpiUnit)}` : fmt(current.value, kpiUnit)}
              )보다 {meta.higherIsBetter ? '높지 않아요' : '낮지 않아요'}. 아무것도 바꾸지 않아도 달성으로 보일 수 있어요. {baseLabel}보다{' '}
              {meta.higherIsBetter ? '높은' : '낮은'} 값으로 정하거나 ‘실행 전보다 늘어난 양’ 기준을 쓰세요. 그대로 저장할 수도 있어요.
            </Notice>
          )}
          {targetWarn === 'noImprovement' && (
            <Notice tone="warn">목표가 0 이하라서 실행 전보다 나아지지 않아도 달성으로 보일 수 있어요. 0보다 큰 값으로 정하세요.</Notice>
          )}
        </section>
        <WeekdayPicker value={s.weekdays} onChange={(v) => setS((x) => ({ ...x, weekdays: v }))} hint="예: 토요일 영업시간만 바꿨다면 토요일. 고르지 않으면 전체 기간으로 비교해요." />
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="담당자" hint="이름 대신 역할로 적어도 됩니다.">
                {(id) => <TextInput id={id} value={s.owner} onChange={(v) => set('owner', v)} placeholder="예: 점장" />}
              </Field>
              <Field label="상태">
                {(id) => <Select id={id} value={s.status} onChange={(v) => set('status', v)} options={(Object.keys(STATUS_LABEL) as SolutionStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }))} />}
              </Field>
              <Field label="연결된 문제">
                {(id) => (
                  <Select id={id} value={s.problemId ?? ''} onChange={(v) => set('problemId', v || null)} options={[{ value: '', label: '연결 안 함' }, ...data.problems.map((p) => ({ value: p.id, label: p.name }))]} />
                )}
              </Field>
              <Field label="방향">
                {(id) => (
                  <Select
                    id={id}
                    value={s.direction}
                    onChange={(v) => set('direction', v)}
                    options={[
                      { value: 'revenue', label: '매출 증가' },
                      { value: 'cost', label: '비용 개선' },
                      { value: 'mixed', label: '복합' },
                    ]}
                  />
                )}
              </Field>
              <Field label="원인 가설" className="sm:col-span-2" hint="확인이 필요한 후보입니다. 원인으로 단정하지 않습니다.">
                {(id) => <TextArea id={id} value={s.hypothesis} onChange={(v) => set('hypothesis', v)} />}
              </Field>
              <Field label="근거" className="sm:col-span-2">
                {(id) => <TextArea id={id} value={s.evidence} onChange={(v) => set('evidence', v)} placeholder="진단 화면의 관찰 사실, 추가 확인한 데이터" />}
              </Field>
            </div>
            <div>
              <h4 className="text-sm font-semibold">예상 효과 (실행 기간 전체, 모르면 비워 두기)</h4>
              <p className="mb-2 text-sm text-slate-700">예상 영업이익 변화 = 예상 매출 변화 − 예상 비용 변화. 비용이 늘면 +, 줄면 −. 계획값이며 실제 실적에 더하지 않습니다.</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="예산" error={show('budget')}>
                  {(id) => <NumberInput id={id} value={s.budget} onChange={(v) => set('budget', v)} suffix="원" />}
                </Field>
                <Field label="예상 매출 변화">{(id) => <NumberInput id={id} value={s.expectedRevenueChange} onChange={(v) => set('expectedRevenueChange', v)} suffix="원" allowNegative />}</Field>
                <Field label="예상 비용 변화" hint="증가 +, 감소 −">
                  {(id) => <NumberInput id={id} value={s.expectedCostChange} onChange={(v) => set('expectedCostChange', v)} suffix="원" allowNegative />}
                </Field>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-slate-800">예상 영업이익 변화</span>
                  <div className={`rounded-lg px-3 py-2 text-right text-sm font-semibold tabular ${ep === null ? 'bg-slate-100 text-slate-600' : ep >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                    {ep === null ? '미입력' : fmtSigned(ep, 'won')}
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <Checkbox checked={s.budgetIncludedInCost} onChange={(v) => set('budgetIncludedInCost', v)} label="예산을 예상 비용 변화에 이미 포함했음 (다시 빼지 않음)" />
                {!s.budgetIncludedInCost && s.budget ? <p className="mt-1 text-sm text-slate-700">예산 {fmt(s.budget, 'won')}을 비용 변화에 한 번 더해 계산합니다.</p> : null}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="성공 기준">{(id) => <TextArea id={id} value={s.successCriteria} onChange={(v) => set('successCriteria', v)} />}</Field>
              <Field label="중단 기준">{(id) => <TextArea id={id} value={s.stopCriteria} onChange={(v) => set('stopCriteria', v)} />}</Field>
            </div>
          </div>
        </div>
        </More>
      </div>
    </Modal>
  );
}

/** 대상에 맞는 함께 볼 지표 후보 */
function extraCandidates(target: Solution['target']): MetricRef[] {
  if (target === 'common')
    return [
      { key: 'operatingProfit', channel: 'all' },
      { key: 'operatingMargin', channel: 'all' },
      { key: 'totalSales', channel: 'all' },
      { key: 'salesPerBusinessDay', channel: 'all' },
      { key: 'directProfit', channel: 'all' },
      { key: 'storeDiscount', channel: 'all' },
    ];
  const ch = target;
  return [
    { key: 'directProfitPerOrder', channel: ch },
    { key: 'directProfit', channel: ch },
    { key: 'operatingProfit', channel: 'all' },
    { key: 'storeDiscount', channel: ch },
    ch === 'hall' ? { key: 'visitors', channel: 'hall' } : { key: 'orders', channel: ch },
    ...(ch === 'hall' ? [{ key: 'meals', channel: 'hall' } as MetricRef] : []),
    { key: 'avgTicket', channel: ch },
    { key: 'netSales', channel: ch },
    { key: 'totalSales', channel: 'all' },
  ];
}

/** 함께 볼 지표: 여러 개 선택. 목표 없이 성과 확인에서 실행 전후를 나란히 보여준다 */
function ExtraKpiPicker({
  target,
  main,
  value,
  onChange,
  onDeliveryDefaults,
}: {
  target: Solution['target'];
  main: MetricRef;
  value: MetricRef[];
  onChange: (v: MetricRef[]) => void;
  onDeliveryDefaults: () => void;
}) {
  const cands = extraCandidates(target);
  // 대상을 바꿔도 이미 고른 지표는 목록에 남겨 둔다(해제할 수 있게)
  const list = [...cands, ...value.filter((v) => !cands.some((c) => sameMetric(c, v)))].filter((m) => !sameMetric(m, main));
  const isDeliverySet = target === 'delivery' && DELIVERY_KPI_SET.every((m) => sameMetric(m, main) || value.some((v) => sameMetric(v, m)));
  return (
    <fieldset aria-label="함께 볼 지표" className="rounded-lg p-3 ring-1 ring-slate-200">
      <legend className="px-1 text-sm font-medium text-slate-800">함께 볼 지표 (여러 개 선택)</legend>
      <p className="mb-2 text-xs text-slate-600">목표 없이 성과 확인에서 실행 전후를 나란히 보여줘요.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((m) => (
          <Checkbox
            key={`${m.key}-${m.channel}`}
            label={metricLabelEasy(m.key, m.channel)}
            checked={value.some((v) => sameMetric(v, m))}
            onChange={(on) => onChange(on ? [...value, m] : value.filter((v) => !sameMetric(v, m)))}
          />
        ))}
      </div>
      {target === 'delivery' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-700">
          {isDeliverySet ? (
            <span>✓ 쿠폰 결정용 세 지표(배달 1건당 남은 돈 · 배달에서 남은 돈 · 가게에 남은 돈)를 모두 봐요.</span>
          ) : (
            <Button size="sm" onClick={onDeliveryDefaults}>
              쿠폰 결정용 세 지표로 맞추기
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );
}

function modeExplain(mode: KpiTargetMode, higherIsBetter: boolean): string {
  const dir = higherIsBetter ? '늘었는지' : '줄었는지';
  switch (mode) {
    case 'total':
      return '실행 기간 동안의 값이 목표에 도달했는지 봅니다.';
    case 'increase':
      return `실행 전 같은 길이 기간보다 얼마나 ${dir} 봅니다. 지금 실적이 이미 높을 때 알맞습니다.`;
    case 'growthRate':
      return `실행 전보다 몇 % ${dir} 봅니다. 실행 전 값이 0이면 계산하지 않습니다.`;
    case 'perBusinessDay':
      return '실행 기간 값을 영업일 수로 나눠 봅니다. 휴업일이 섞여도 비교하기 쉽습니다.';
  }
}
