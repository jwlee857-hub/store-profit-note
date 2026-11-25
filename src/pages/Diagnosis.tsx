import { useMemo, useState } from 'react';
import { CheckSteps } from '../components/CheckSteps';
import { ImpactDetail, NeedMoreRecords } from '../components/ChangeFocus';
import { gapTarget } from '../components/RecordGaps';
import { recordGaps } from '../domain/review';
import { MetricPicker } from '../components/MetricPicker';
import { WeekdayPicker } from '../components/WeekdayPicker';
import { appToday, periodWords, presetRanges, referenceDate } from '../domain/periods';
import {
  Badge,
  Button,
  CalcValue,
  Card,
  ChannelDot,
  DeltaText,
  EmptyState,
  Field,
  Modal,
  More,
  Notice,
  NumberInput,
  PageHeader,
  Select,
  TableWrap,
  TextArea,
  TextInput,
  td,
  tdR,
  th,
  thR,
} from '../components/ui';
import { GAP_NOTE, channelSalesCalc, compareValues, expectedProfitChange } from '../domain/calc';
import { RecordGapsNotice } from '../components/RecordGaps';
import { WEEKDAY_LABELS, formatRange, isValidRange, previousRange } from '../domain/dates';
import { ImpactNote, ImpactTag, RelatedCauses } from '../components/RelatedCauses';
import { DiscountEfficiencyNote } from '../components/DiscountEfficiency';
import { discountRow } from '../domain/discount';
import { ASSESSMENT_LABEL, byImpact, diagnose, plainFact, quantityPriceText, rangesOverlapNote, topIssues, type DiagnosisResult, type Finding } from '../domain/diagnosis';
import { newProblem } from '../domain/factory';
import { fmt, fmtPp, fmtSigned, josa, weekdaysText } from '../domain/format';
import { CHANNEL_COLOR, CHANNEL_LABEL, METRIC_META, PROBLEM_TYPE_LABEL, STATUS_LABEL, resultLabel } from '../domain/labels';
import { templateForFinding } from '../domain/templates';
import { CHANNELS, type Calc, type Problem, type Solution } from '../domain/types';
import { useApp, useData } from '../state/AppContext';

export function Diagnosis() {
  const data = useData();
  const { route, navigate, update, confirm } = useApp();
  const [editing, setEditing] = useState<Problem | null>(null);
  // 홈 '자세히 보기': 기간만 받아 저장하지 않은 미리 보기로 연다 (같은 기간의 저장한 점검이 있으면 그것을 연다)
  const q = route.params;
  const draftRanges = !q.problem && q.from && q.to && q.cfrom && q.cto ? { analysis: { start: q.from, end: q.to }, compare: { start: q.cfrom, end: q.cto } } : null;
  const savedSame = draftRanges ? data.problems.find((x) => x.analysis.start === q.from && x.analysis.end === q.to && x.compare.start === q.cfrom && x.compare.end === q.cto && x.channel === 'all') : undefined;
  const draft = useMemo(
    () =>
      draftRanges && !savedSame && isValidRange(draftRanges.analysis) && isValidRange(draftRanges.compare)
        ? newProblem({ name: `${formatRange(draftRanges.analysis)} 영업이익 점검`, type: 'profitDecline', ...draftRanges, channel: 'all', target: { key: 'operatingProfit', channel: 'all' } })
        : null,
    [q.from, q.to, q.cfrom, q.cto, !!savedSame], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const selected = draft ?? savedSame ?? data.problems.find((p) => p.id === q.problem) ?? data.problems[0] ?? null;

  // 새 문제의 기본 기간은 홈 '최근 4주'와 같은 함수로 계산한다
  const create = () => {
    const r = presetRanges('recent28', appToday(data), referenceDate(data));
    setEditing(newProblem({ analysis: r.cur, compare: r.prev }));
  };

  return (
    <>
      <CheckSteps current="diagnosis" problemId={selected && selected !== draft ? selected.id : null} solutionId={selected ? data.solutions.find((s) => s.problemId === selected.id)?.id : null} />
      <PageHeader
        title="문제 진단"
        description="입력된 숫자로 변화를 나눠 봅니다. 원인을 단정하지 않아요."
        actions={
          <Button variant="primary" onClick={create}>
            문제 등록
          </Button>
        }
      />
      {!data.problems.length && !draft ? (
        <EmptyState
          title="등록된 문제가 없습니다"
          description="예: '최근 4주 홀 매출 감소', '배달은 늘었는데 이익이 줄었다'처럼 확인하고 싶은 변화를 분석 기간·비교 기간과 함께 등록하세요."
          action={
            <Button variant="primary" onClick={create}>
              문제 등록
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          {selected && (
            <ProblemView
              key={selected.id}
              problem={selected}
              draft={selected === draft}
              onEdit={() => setEditing({ ...selected })}
              onDelete={async () => {
                const linked = data.solutions.filter((s) => s.problemId === selected.id).length;
                if (
                  await confirm({
                    title: '문제 삭제',
                    message: `${josa(`"${selected.name}"`, '을/를')} 삭제할까요?${linked ? `\n연결된 실행 계획 ${linked}개는 삭제되지 않고 '연결된 문제 없음'으로 남습니다.` : ''}`,
                    confirmText: '삭제',
                  })
                ) {
                  update(
                    (d) => ({ ...d, problems: d.problems.filter((p) => p.id !== selected.id), solutions: d.solutions.map((s) => (s.problemId === selected.id ? { ...s, problemId: null } : s)) }),
                    '문제를 삭제했습니다.',
                  );
                  navigate('diagnosis');
                }
              }}
            />
          )}
          {/* 저장한 점검 목록: 휴대폰에서는 지금 볼 변화 아래, 넓은 화면에서는 왼쪽 칸 */}
          <div className="space-y-2 lg:order-first">
            {data.problems.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate('diagnosis', { problem: p.id })}
                className={`w-full rounded-xl p-3 text-left ring-1 ${selected?.id === p.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className={`mt-0.5 text-xs ${selected?.id === p.id ? 'text-slate-300' : 'text-slate-500'}`}>
                  {PROBLEM_TYPE_LABEL[p.type]} · {p.channel === 'all' ? '전체' : CHANNEL_LABEL[p.channel]} · 실행 계획 {data.solutions.filter((s) => s.problemId === p.id).length}개
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {editing && <ProblemEditor initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProblemEditor({ initial, onClose }: { initial: Problem; onClose: () => void }) {
  const data = useData();
  const { update, navigate } = useApp();
  const [p, setP] = useState<Problem>(initial);
  const [touched, setTouched] = useState(false);
  const isNew = !data.problems.some((x) => x.id === p.id);
  const errs: Record<string, string> = {};
  if (!p.name.trim()) errs.name = '문제명을 입력하세요.';
  if (!isValidRange(p.analysis)) errs.analysis = '분석 기간을 올바르게 입력하세요.';
  if (!isValidRange(p.compare)) errs.compare = '비교 기간을 올바르게 입력하세요.';
  if (!errs.analysis && !errs.compare) {
    const ov = rangesOverlapNote(p.analysis, p.compare);
    if (ov) errs.compare = ov;
  }
  const show = (k: string) => (touched ? errs[k] : undefined);
  const unit = METRIC_META[p.target.key].unit;
  // 비교 기간을 따로 바꾸지 않았으면(직전 같은 길이) 분석 기간을 따라 움직인다
  const setAnalysis = (r: Problem['analysis']) => {
    const follow = isValidRange(p.analysis) && JSON.stringify(p.compare) === JSON.stringify(previousRange(p.analysis));
    setP({ ...p, analysis: r, compare: follow && isValidRange(r) ? previousRange(r) : p.compare });
  };

  const save = () => {
    setTouched(true);
    if (Object.keys(errs).length) return;
    const clean = { ...p, name: p.name.trim() };
    update((d) => ({ ...d, problems: isNew ? [...d.problems, clean] : d.problems.map((x) => (x.id === clean.id ? clean : x)) }), isNew ? '문제를 등록했습니다.' : '문제를 수정했습니다.');
    navigate('diagnosis', { problem: clean.id });
    onClose();
  };

  return (
    <Modal
      title={isNew ? '문제 등록' : '문제 수정'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={save}>
            저장
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="무엇을 점검할까요?" required error={show('name')} className="sm:col-span-2">
          {(id) => <TextInput id={id} value={p.name} onChange={(v) => setP({ ...p, name: v })} placeholder="예: 최근 4주 홀 매출 감소" />}
        </Field>
        <Field label="언제 기간을 볼까요?" error={show('analysis')} hint="비교 기간은 바로 앞 같은 길이로 정해져요. 바꾸려면 상세 옵션에서." className="sm:col-span-2">
          {() => (
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label="분석 시작" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={p.analysis.start} onChange={(e) => setAnalysis({ ...p.analysis, start: e.target.value })} />
              <span>~</span>
              <input type="date" aria-label="분석 종료" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={p.analysis.end} onChange={(e) => setAnalysis({ ...p.analysis, end: e.target.value })} />
            </div>
          )}
        </Field>
        <div className="sm:col-span-2">
          <More summary="상세 옵션 (선택): 비교 기간·대상·적용 요일·목표 지표·메모" defaultOpen={!!show('compare')}>
            <div className="grid gap-3 rounded-lg p-3 ring-1 ring-slate-200 sm:grid-cols-2">
              <Field label="비교 기간" error={show('compare')} className="sm:col-span-2">
                {() => (
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="date" aria-label="비교 시작" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={p.compare.start} onChange={(e) => setP({ ...p, compare: { ...p.compare, start: e.target.value } })} />
                    <span>~</span>
                    <input type="date" aria-label="비교 종료" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={p.compare.end} onChange={(e) => setP({ ...p, compare: { ...p.compare, end: e.target.value } })} />
                    <Button size="sm" onClick={() => isValidRange(p.analysis) && setP({ ...p, compare: previousRange(p.analysis) })}>
                      직전 같은 기간
                    </Button>
                  </div>
                )}
              </Field>
              <Field label="유형">
                {(id) => (
                  <Select
                    id={id}
                    value={p.type}
                    onChange={(v) => setP({ ...p, type: v })}
                    options={[
                      { value: 'salesDecline', label: '매출 감소' },
                      { value: 'profitDecline', label: '영업이익 감소' },
                      { value: 'other', label: '기타' },
                    ]}
                  />
                )}
              </Field>
              <Field label="대상 판매 방식">
                {(id) => <Select id={id} value={p.channel} onChange={(v) => setP({ ...p, channel: v })} options={[{ value: 'all', label: '전체' }, ...CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))]} />}
              </Field>
              <div className="sm:col-span-2">
                <WeekdayPicker value={p.weekdays} onChange={(v) => setP({ ...p, weekdays: v })} hint="고르지 않으면 전체 기간. 고르면 분석·비교 기간의 그 요일만 보고, 여기서 만든 실행 계획에도 이어져요." />
              </div>
              <div className="sm:col-span-2">
                <MetricPicker label="목표 지표" value={p.target} onChange={(t) => setP({ ...p, target: t })} />
              </div>
              <Field label="목표값" hint={unit === 'pct' ? '% 단위' : unit === 'won' ? '원 단위' : undefined}>
                {(id) => <NumberInput id={id} value={p.targetValue} onChange={(v) => setP({ ...p, targetValue: v })} allowNegative allowDecimal={unit === 'pct'} suffix={unit === 'pct' ? '%' : unit === 'won' ? '원' : unit === 'people' ? '명' : '건'} />}
              </Field>
              <Field label="메모" className="sm:col-span-2">
                {(id) => <TextArea id={id} value={p.memo} onChange={(v) => setP({ ...p, memo: v })} />}
              </Field>
            </div>
          </More>
        </div>
      </div>
    </Modal>
  );
}


function ProblemView({ problem, onEdit, onDelete, draft = false }: { problem: Problem; onEdit: () => void; onDelete: () => void; draft?: boolean }) {
  const data = useData();
  const { navigate, route, update } = useApp();
  // 미리 보기에서 사용자가 저장을 누르거나 계획을 만들 때만 점검 목록에 넣는다
  const saveDraft = () => {
    if (!draft) return true;
    return update((d) => ({ ...d, problems: [...d.problems, problem] }), '점검 목록에 저장했어요.');
  };
  const valid = isValidRange(problem.analysis) && isValidRange(problem.compare);
  const dx = useMemo(() => (valid ? diagnose(data, problem) : null), [data, problem, valid]);
  const solutions = data.solutions.filter((s) => s.problemId === problem.id);
  const unit = METRIC_META[problem.target.key].unit;
  // 분석 기간이 마지막 매출 입력일 뒤까지 잡혀 있으면 홈 '최근 4주'와 숫자가 달라진다. 자동으로 바꾸지 않고 맞추기 버튼만 보여준다
  const ref = referenceDate(data);
  const home = presetRanges('recent28', appToday(data), ref);
  const pastRef = valid && problem.analysis.end > ref && !(problem.analysis.start === home.cur.start && problem.analysis.end === home.cur.end);

  return (
    <div className="min-w-0 space-y-4">
      {dx && <FocusCard dx={dx} focus={route.params.finding} problem={problem} />}
      <Card
        title={problem.name}
        subtitle={`${PROBLEM_TYPE_LABEL[problem.type]} · 대상 ${problem.channel === 'all' ? '전체' : CHANNEL_LABEL[problem.channel]} · 분석 ${formatRange(problem.analysis)} / 비교 ${formatRange(problem.compare)}${weekdaysText(problem.weekdays) ? ` · ${weekdaysText(problem.weekdays)}만` : ''}`}
        actions={
          draft ? (
            <Button size="sm" variant="primary" onClick={() => saveDraft() && navigate('diagnosis', { problem: problem.id })}>
              점검 목록에 저장
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={onEdit}>
                수정
              </Button>
              <Button size="sm" variant="danger" onClick={onDelete}>
                삭제
              </Button>
            </>
          )
        }
      >
        {draft && <p className="mb-3 text-sm text-slate-700" aria-label="미리 보기">아직 저장하지 않은 미리 보기예요. 읽기만 해서는 점검 목록에 남지 않아요.</p>}
        {problem.memo && <p className="mb-3 text-sm text-slate-600">{problem.memo}</p>}
        {pastRef && (
          <Notice tone="warn">
            <p>
              분석 기간 끝({problem.analysis.end.replace(/-/g, '.')})이 마지막 매출 입력일({ref.replace(/-/g, '.')})보다 늦어서, 홈 '최근 4주'({formatRange(home.cur)})와 숫자가 다를 수 있어요.
            </p>
            <Button
              size="sm"
              className="mt-2"
              onClick={() =>
                update((d) => ({ ...d, problems: d.problems.map((x) => (x.id === problem.id ? { ...x, analysis: home.cur, compare: home.prev } : x)) }), '분석·비교 기간을 홈 최근 4주와 같게 맞췄습니다.')
              }
            >
              홈과 같은 기간으로 맞추기
            </Button>
          </Notice>
        )}
        {dx && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">목표 지표 · {dx.target.label}</div>
              <div className="mt-1">
                <CalcValue calc={dx.target.current} unit={unit} />
              </div>
              <DeltaText cmp={dx.target.comparison} unit={unit} ratio={unit === 'pct'} higherIsBetter={METRIC_META[problem.target.key].higherIsBetter} />
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">목표값</div>
              <div className="mt-1 font-medium">{problem.targetValue === null ? '미설정' : fmt(problem.targetValue, unit)}</div>
              {dx.target.achieved !== null && (dx.target.achieved ? <Badge tone="green">분석 기간 기준 달성</Badge> : <Badge tone="red">분석 기간 기준 미달</Badge>)}
              {dx.target.achieved === null && problem.targetValue !== null && <span className="text-xs text-slate-400">데이터 필요</span>}
            </div>
            <div className="flex flex-col justify-center gap-2 rounded-lg bg-slate-50 p-3">
              <Button variant="primary" onClick={() => saveDraft() && navigate('solutions', { problem: problem.id, new: '1' })}>
                이 문제의 실행 계획 등록
              </Button>
              <span className="text-xs text-slate-500">연결된 실행 계획 {solutions.length}개</span>
            </div>
          </div>
        )}
      </Card>

      {!dx ? (
        <Notice tone="error">기간 설정이 올바르지 않습니다. 문제를 수정하세요.</Notice>
      ) : (
        <>
          <RecordGapsNotice periods={[['비교 기간', dx.prev], ['분석 기간', dx.cur]]} />
          <TopFindings dx={dx} problem={problem} focus={route.params.finding} onBeforePlan={saveDraft} />
          {dx.caveats.length > 0 && (
            <Notice tone="warn">
              <p className="font-medium">데이터 주의사항</p>
              <ul className="list-disc pl-4">
                {dx.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Notice>
          )}
          <Step1 dx={dx} />
          <Step2 dx={dx} />
          <Step3 dx={dx} />
          <Step4 dx={dx} problem={problem} onBeforePlan={saveDraft} />
          {problem.channel !== 'hall' && (
            <p className="text-sm text-slate-700">
              신규·재주문 고객 수를 배달앱 통계에서 볼 수 있으면 원인을 확인하는 데 도움이 돼요.{' '}
              <button type="button" className="font-medium underline" onClick={() => navigate('sales', { tab: 'customers' })}>
                고객 지표 입력 (선택)
              </button>
            </p>
          )}
          {solutions.length > 0 && (
            <Card title="연결된 실행 계획">
              <ul className="divide-y divide-slate-100">
                {solutions.map((s) => {
                  const ep = expectedProfitChange(s.expectedRevenueChange, s.expectedCostChange, s.budget, s.budgetIncludedInCost);
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        <b>{s.name}</b> <Badge>{STATUS_LABEL[s.status]}</Badge> <span className="text-xs text-slate-500">예상 영업이익 변화 {ep === null ? '미입력' : fmtSigned(ep, 'won')}</span>
                      </span>
                      <span className="flex gap-1">
                        <Button size="sm" onClick={() => navigate('solutions', { problem: problem.id, solution: s.id })}>
                          실행 계획 보기
                        </Button>
                        <Button size="sm" onClick={() => navigate('performance', { solution: s.id })}>
                          {resultLabel(s)}
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 장사 점검 첫 카드: 같은 기간의 먼저 살펴볼 변화 하나를 쉬운 말로, 바로 아래 실제로 열 수 있는 다음 행동 하나.
 * 홈 카드에서 들어오면 그 항목(finding)을 그대로 연다. 추정 영향 금액은 접힌 상세에서 실제 이익 차이와 구분한다.
 */
function FocusCard({ dx, focus, problem }: { dx: DiagnosisResult; focus?: string; problem: Problem }) {
  const data = useData();
  const { navigate } = useApp();
  const w = periodWords(appToday(data), referenceDate(data), problem.analysis, problem.compare);
  const groups = topIssues(dx, 3);
  const f = (focus ? (groups.find((g) => g.id === focus) ?? dx.findings.find((x) => x.id === focus)) : undefined) ?? groups[0];
  const scroll = (id: string) => () => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const action = (x: Finding): { label: string; run: () => void } | null => {
    if (x.id.startsWith('gap-')) {
      const g = recordGaps(data, dx.cur).find((r) => r.kind === 'sales') ?? recordGaps(data, dx.prev).find((r) => r.kind === 'sales');
      return g ? { label: '빠진 매출 기록하기', run: () => navigate('sales', gapTarget(g)) } : null;
    }
    if (x.id.startsWith('nodata-')) return { label: '매출 기록 보기', run: () => navigate('sales') };
    if (x.id.startsWith('cust-')) return { label: '고객 지표 보기', run: () => navigate('sales', { tab: 'customers' }) };
    if (x.id.startsWith('hall-visitors')) return { label: '이전 기간과 방문 수 비교', run: scroll('step-2') };
    if (/-orders-/.test(x.id)) return { label: '이전 기간과 주문 수 비교', run: scroll('step-2') };
    if (/ticket|aov/.test(x.id)) return { label: '이전 기간과 객단가 비교', run: scroll('step-2') };
    if (/-unit-profit-|-discount-|-cost-|-rate-|^common-/.test(x.id)) return { label: '이전 기간과 비용 비교', run: scroll('step-3') };
    if (x.id === 'bizdays') return { label: '판매 방식별 매출 비교', run: scroll('step-1') };
    return null;
  };
  const act = f ? action(f) : null;
  return (
    <section aria-label="먼저 살펴볼 변화" className="rounded-xl bg-white p-4 shadow-sm ring-2 ring-slate-900 sm:p-5">
      <h2 className="text-base font-semibold text-slate-900">먼저 살펴볼 변화</h2>
      <p className="text-xs text-slate-600">
        {w.name} · {w.compare}
      </p>
      {f ? (
        <>
          <p className="mt-2 text-base font-medium text-slate-900">{plainFact(f, w.name, w.than)}</p>
          {act && (
            <Button size="sm" variant="primary" className="mt-2" onClick={act.run}>
              {act.label}
            </Button>
          )}
          <p className="mt-1 text-xs text-slate-600">원인으로 확인된 것은 아니에요.</p>
          <ImpactDetail finding={f} s={dx.cur} p={dx.prev} />
        </>
      ) : (
        <div className="mt-2">
          <NeedMoreRecords data={data} s={dx.cur} p={dx.prev} than={w.than} />
        </div>
      )}
    </section>
  );
}

function Step1({ dx }: { dx: DiagnosisResult }) {
  return (
    <Card id="step-1" title="① 어느 판매 방식의 변화가 전체 매출 변화에 영향을 주었나" subtitle={dx.channelNote}>
      <TableWrap>
        <thead>
          <tr>
            <th className={th}>판매 방식</th>
            <th className={thR}>비교 기간</th>
            <th className={thR}>분석 기간</th>
            <th className={thR}>증감액</th>
            <th className={thR}>증감률</th>
            {!dx.offsetting && <th className={thR}>기여율</th>}
          </tr>
        </thead>
        <tbody>
          {dx.channelChanges.map((r) => {
            const c = compareValues(r.prev, r.cur);
            // 빠진 기록이 있는 판매 방식: 부분 합계와 입력 현황만 보여주고 증감은 계산하지 않는다 (성과 확인과 같은 기준)
            if (r.gap)
              return (
                <tr key={r.channel}>
                  <td className={td}>
                    <span className="inline-flex items-center gap-1.5">
                      <ChannelDot color={CHANNEL_COLOR[r.channel]} />
                      {CHANNEL_LABEL[r.channel]}
                    </span>
                  </td>
                  <td className={tdR}>
                    <CalcValue calc={channelSalesCalc(dx.prev.channels[r.channel])} unit="won" />
                  </td>
                  <td className={tdR}>
                    <CalcValue calc={channelSalesCalc(dx.cur.channels[r.channel])} unit="won" />
                  </td>
                  <td className={tdR} colSpan={dx.offsetting ? 2 : 3}>
                    <span className="text-xs text-slate-500">{GAP_NOTE}</span>
                  </td>
                </tr>
              );
            return (
              <tr key={r.channel}>
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5">
                    <ChannelDot color={CHANNEL_COLOR[r.channel]} />
                    {CHANNEL_LABEL[r.channel]}
                  </span>
                </td>
                <td className={tdR}>{fmt(r.prev, 'won')}</td>
                <td className={tdR}>{fmt(r.cur, 'won')}</td>
                <td className={`${tdR} font-medium ${r.delta > 0 ? 'text-emerald-700' : r.delta < 0 ? 'text-red-700' : ''}`}>{fmtSigned(r.delta, 'won')}</td>
                <td className={tdR}>{c.pct === null ? <span className="text-xs text-slate-400">{c.note}</span> : `${c.pct > 0 ? '+' : ''}${c.pct.toFixed(1)}%`}</td>
                {!dx.offsetting && <td className={tdR}>{r.share === null ? '—' : `${r.share.toFixed(1)}%`}</td>}
              </tr>
            );
          })}
          <tr className="bg-slate-50 font-semibold">
            <td className={td}>전체</td>
            <td className={tdR}>{fmt(dx.channelChanges.reduce((s, r) => s + r.prev, 0), 'won')}</td>
            <td className={tdR}>{fmt(dx.channelChanges.reduce((s, r) => s + r.cur, 0), 'won')}</td>
            <td className={tdR}>{dx.totalDelta === null ? <span className="text-xs font-normal text-slate-500">{GAP_NOTE}</span> : fmtSigned(dx.totalDelta, 'won')}</td>
            <td className={tdR}></td>
            {!dx.offsetting && <td className={tdR}>100%</td>}
          </tr>
        </tbody>
      </TableWrap>
      <p className="mt-2 text-xs text-slate-500">
        영업일 수: 비교 {dx.prev.businessDays}일 → 분석 {dx.cur.businessDays}일. 영업일당 매출: {fmt(dx.prev.salesPerBusinessDay.value, 'won', '데이터 필요')} → {fmt(dx.cur.salesPerBusinessDay.value, 'won', '데이터 필요')}
        {' · '}요일 구성(분석−비교): {WEEKDAY_LABELS.map((w, i) => ({ w, d: dx.cur.weekdayCounts[i] - dx.prev.weekdayCounts[i] })).filter((x) => x.d).map((x) => `${x.w} ${x.d > 0 ? '+' : ''}${x.d}`).join(', ') || '차이 없음'}
      </p>
    </Card>
  );
}

function Step2({ dx }: { dx: DiagnosisResult }) {
  return (
    <Card id="step-2" title="② 손님·주문 수와 객단가 중 무엇이 변했나">
      <ul className="mb-3 space-y-1 text-sm text-slate-800">
        {dx.quantityPrice.map((r) => {
          const text = quantityPriceText(r);
          const name = `${CHANNEL_LABEL[r.channel]}:`;
          return (
            <li key={r.channel}>
              <b>{name}</b>
              {text.slice(name.length)}
            </li>
          );
        })}
      </ul>
      <More summary="계산 방법과 표 자세히 보기">
        <p className="mb-2 text-sm text-slate-700">수량 효과 = (Q1 − Q0) × P0, 평균 금액 효과 = Q1 × (P1 − P0). Q는 수량(손님·주문 수), P는 평균 금액, 0은 비교 기간, 1은 분석 기간입니다. 두 효과의 합은 실제 매출 차이와 같습니다.</p>
      <TableWrap>
        <thead>
          <tr>
            <th className={th}>판매 방식</th>
            <th className={thR}>수량 Q0 → Q1</th>
            <th className={thR}>평균 금액 P0 → P1</th>
            <th className={thR}>수량 효과</th>
            <th className={thR}>평균 금액 효과</th>
            <th className={thR}>합계 = 매출 차이</th>
          </tr>
        </thead>
        <tbody>
          {dx.quantityPrice.map((r) => {
            const d = r.decomposition;
            const unit = r.channel === 'hall' ? 'people' : 'orders';
            return (
              <tr key={r.channel}>
                <td className={td}>
                  <div className="font-medium">{CHANNEL_LABEL[r.channel]}</div>
                  <div className="text-xs text-slate-500">
                    {r.quantityLabel} × {r.priceLabel}
                  </div>
                </td>
                <td className={tdR}>
                  {fmt(r.prevQ, unit, '데이터 필요')} → {fmt(r.curQ, unit, '데이터 필요')}
                </td>
                <td className={tdR}>
                  <CalcValue calc={r.prevP} unit="won" showProvisional={false} /> → <CalcValue calc={r.curP} unit="won" showProvisional={false} />
                </td>
                {d.ok ? (
                  <>
                    <td className={`${tdR} ${d.volumeEffect! < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtSigned(d.volumeEffect!, 'won')}</td>
                    <td className={`${tdR} ${d.priceEffect! < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtSigned(d.priceEffect!, 'won')}</td>
                    <td className={tdR + ' font-medium'}>
                      {fmtSigned(d.volumeEffect! + d.priceEffect!, 'won')}
                      <div className="text-xs text-slate-500">실제 차이 {fmtSigned(d.delta!, 'won')}</div>
                    </td>
                  </>
                ) : (
                  <td className={td + ' text-xs text-slate-500'} colSpan={3}>
                    {d.reason}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      </More>
    </Card>
  );
}

const MINOR: string[] = ['stable', 'volume', 'na', 'gone', 'fixedSame'];

function Step3({ dx }: { dx: DiagnosisResult }) {
  const [showAll, setShowAll] = useState(false);
  const major = dx.costChanges.filter((r) => !MINOR.includes(r.assessment));
  const rows = showAll ? dx.costChanges : major;
  const hidden = dx.costChanges.length - major.length;
  return (
    <Card id="step-3" title="③ 어떤 비용이 변했나" subtitle="판매 방식별 비용은 주문 1건 기준, 공통 운영비는 영업일 1일 기준으로 비교합니다. 주문이 늘어 총액만 늘고 1건당 비용이 같으면 문제로 보지 않습니다.">
      {!dx.costChanges.length ? (
        <p className="text-sm text-slate-600">두 기간 모두 비용 입력이 없습니다.</p>
      ) : (
        <>
        {!major.length && !showAll && <p className="text-sm text-slate-700">1건당 비용이 크게 바뀐 항목이 없습니다.</p>}
        {rows.length > 0 && <TableWrap>
          <thead>
            <tr>
              <th className={th}>구분</th>
              <th className={th}>항목</th>
              <th className={thR}>총액 (비교 → 분석)</th>
              <th className={thR}>단위당 (비교 → 분석)</th>
              <th className={thR}>매출 대비 비율</th>
              <th className={th}>판단</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.scope}-${r.category}`}>
                <td className={td}>{r.scope === 'common' ? '공통' : CHANNEL_LABEL[r.scope]}</td>
                <td className={td}>{r.label}</td>
                <td className={tdR}>
                  {fmt(r.prevTotal, 'won')} → {fmt(r.curTotal, 'won')}
                  <div className="text-xs text-slate-500">{fmtSigned(r.curTotal - r.prevTotal, 'won')}</div>
                </td>
                <td className={tdR}>
                  {fmt(r.prevPerUnit, 'won', '계산 불가')} → {fmt(r.curPerUnit, 'won', '계산 불가')}
                  <div className="text-xs text-slate-500">{r.scope === 'common' ? '영업일당' : '주문당'}</div>
                </td>
                <td className={tdR}>
                  {r.prevRate === null ? '계산 불가' : `${r.prevRate.toFixed(1)}%`} → {r.curRate === null ? '계산 불가' : `${r.curRate.toFixed(1)}%`}
                  <div className="text-xs text-slate-500">{r.prevRate !== null && r.curRate !== null ? fmtPp(r.curRate - r.prevRate) : ''}</div>
                </td>
                <td className={td}>
                  <Badge tone={r.assessment === 'unitUp' || r.assessment === 'rateUp' || r.assessment === 'new' ? 'amber' : r.assessment === 'unitDown' ? 'green' : 'gray'}>{ASSESSMENT_LABEL[r.assessment]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>}
        {hidden > 0 && (
          <Button size="sm" className="mt-2" onClick={() => setShowAll((v) => !v)}>
            {showAll ? '변화가 큰 항목만 보기' : `큰 변화 없는 항목 ${hidden}개 더 보기`}
          </Button>
        )}
        </>
      )}
      <DiscountTable dx={dx} />
    </Card>
  );
}

/** ③ 아래: 쿠폰·할인은 비용이 아니라 매출에서 빠지는 금액이라 따로, 원 단위로 보여준다 */
function DiscountTable({ dx }: { dx: DiagnosisResult }) {
  const channels = dx.quantityPrice.map((q) => q.channel).filter((c) => dx.prev.channels[c].discount > 0 || dx.cur.channels[c].discount > 0);
  if (!channels.length) return null;
  const rows = channels.map((c) => discountRow(dx.prev.channels[c], dx.cur.channels[c]));
  const amount = (c: Calc) => (
    <>
      {fmt(c.value, 'won', '데이터 필요')}
      {c.basis && <span className="ml-1 text-xs text-slate-500">({c.basis.total}건 중 {c.basis.used}건 기준)</span>}
    </>
  );
  return (
    <div className="mt-5" aria-label="쿠폰·할인 비용">
      <h3 className="text-sm font-semibold text-slate-900">쿠폰·할인으로 낸 돈 (가게 부담 할인액)</h3>
      <p className="mb-2 text-xs text-slate-600">순매출에서 이미 빠진 금액이라 위 비용 표에는 없어요. 플랫폼 부담분은 넣지 않습니다.</p>
      <TableWrap>
        <thead>
          <tr>
            <th className={th}>판매 방식</th>
            <th className={thR}>할인액 (비교 → 분석)</th>
            <th className={thR}>주문당 (비교 → 분석)</th>
            <th className={thR}>할인 전 판매액 대비</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.channel}>
              <td className={td}>{CHANNEL_LABEL[r.channel]}</td>
              <td className={tdR}>
                {amount(r.prev)} → {amount(r.cur)}
                {r.prev.value !== null && r.cur.value !== null && <div className="text-xs text-slate-500">{fmtSigned(r.cur.value - r.prev.value, 'won')}</div>}
              </td>
              <td className={tdR}>
                {fmt(r.prevPerOrder, 'won', '계산 불가')} → {fmt(r.curPerOrder, 'won', '계산 불가')}
              </td>
              <td className={tdR}>
                {r.prevRate === null ? '계산 불가' : `${r.prevRate.toFixed(1)}%`} → {r.curRate === null ? '계산 불가' : `${r.curRate.toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {channels
        .filter((c) => c !== 'hall')
        .map((c) => (
          <DiscountEfficiencyNote key={c} b={dx.prev} a={dx.cur} ch={c} labels={['비교 기간', '분석 기간']} />
        ))}
    </div>
  );
}

/**
 * 진단 항목으로 실행 계획을 만들 때, 같은 문제에 같은 예시(템플릿)로 만든 계획이 이미 있으면 먼저 묻는다.
 * 예시가 없는 항목은 미리 채워질 계획 이름이 같은지로 판단한다.
 */
function usePlanFromFinding(problem: Problem, onBeforePlan: () => boolean = () => true) {
  const data = useData();
  const { navigate } = useApp();
  const [dup, setDup] = useState<{ findingId: string; existing: Solution[] } | null>(null);
  const go = (findingId: string) => onBeforePlan() && navigate('solutions', { problem: problem.id, new: '1', finding: findingId });
  const start = (f: Finding) => {
    const tpl = templateForFinding(f.id);
    const draftName = `${f.title} 확인·개선`;
    const existing = data.solutions.filter((s) => s.problemId === problem.id && (tpl ? s.templateId === tpl.id : s.name === draftName));
    if (existing.length) setDup({ findingId: f.id, existing });
    else go(f.id);
  };
  const modal = dup && (
    <Modal
      title="이미 만든 실행 계획이 있어요"
      onClose={() => setDup(null)}
      footer={
        <>
          <Button onClick={() => setDup(null)}>취소</Button>
          <Button onClick={() => navigate('solutions', { problem: problem.id, solution: dup.existing[0].id })}>기존 계획 보기</Button>
          <Button variant="primary" onClick={() => go(dup.findingId)}>
            새로 만들기
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-800">이 문제에 같은 예시로 만든 실행 계획이 이미 있습니다.</p>
      <ul className="mt-2 space-y-1 text-sm">
        {dup.existing.map((s) => (
          <li key={s.id} className="rounded-md bg-slate-50 px-3 py-2">
            <b>{s.name}</b> <Badge>{STATUS_LABEL[s.status]}</Badge>
            <div className="text-xs text-slate-600">
              실행 {s.start ?? '미정'} ~ {s.end ?? '미정'}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-slate-700">같은 계획을 두 번 만들면 성과를 확인할 때 헷갈릴 수 있어요. 기존 계획을 고쳐 쓰거나, 다른 방법을 시도할 때만 새로 만드세요.</p>
    </Modal>
  );
  return { start, modal };
}

/** 문제 화면 상단: 영향 금액이 큰 확인 항목 3개와 실행 계획 버튼 */
function TopFindings({ dx, problem, focus, onBeforePlan }: { dx: DiagnosisResult; problem: Problem; focus?: string; onBeforePlan?: () => boolean }) {
  const plan = usePlanFromFinding(problem, onBeforePlan);
  const top = topIssues(dx, 3);
  if (!top.length) return null;
  return (
    <Card title="먼저 확인할 것 3가지" subtitle="영업이익 영향(추정)이 큰 순서입니다. 매출 영향만 계산되는 항목은 이익 항목 뒤에 따로 둡니다. 원인으로 확인된 것은 아닙니다.">
      {plan.modal}
      <ol className="space-y-2">
        {top.map((f, i) => (
          <li key={f.id} className={`rounded-lg p-3 ring-1 ${focus === f.id ? 'ring-2 ring-slate-900' : 'ring-slate-200'}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">
                {i + 1}. {f.title}
              </span>
              <ImpactTag finding={f} />
            </div>
            <p className="mt-1 text-sm text-slate-700">{f.fact}</p>
            <ImpactNote finding={f} />
            <RelatedCauses issue={f} />
            <Button size="sm" variant="primary" className="mt-2" onClick={() => plan.start(f)}>
              이 항목으로 실행 계획 만들기
            </Button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Step4({ dx, problem, onBeforePlan }: { dx: DiagnosisResult; problem: Problem; onBeforePlan?: () => boolean }) {
  const plan = usePlanFromFinding(problem, onBeforePlan);
  const [showAll, setShowAll] = useState(false);
  // 상위 목록과 같은 기준: 영업이익 영향이 큰 순서 → 매출 영향만 있는 항목 → 계산할 수 없는 항목
  const sorted = byImpact(dx.findings);
  const list = showAll ? sorted : sorted.slice(0, 3);
  return (
    <Card title="④ 확인할 원인 가설" subtitle="관찰 사실은 입력된 숫자에서 계산한 것이고, 가설은 확인이 필요한 후보입니다. 어떤 가설도 검증된 원인이 아닙니다.">
      {!dx.findings.length ? (
        <p className="text-sm text-slate-600">설정된 기준(±5%) 이상의 뚜렷한 변화가 관찰되지 않았습니다. 위 표에서 세부 수치를 확인하세요.</p>
      ) : (
        <div className="space-y-3">
          {plan.modal}
          {list.map((f) => (
            <div key={f.id} className="rounded-lg p-3 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={f.tone === 'watch' ? 'amber' : f.tone === 'positive' ? 'green' : 'gray'}>{f.tone === 'watch' ? '확인 필요' : f.tone === 'positive' ? '증가' : '참고'}</Badge>
                <span className="text-sm text-slate-600">{f.channel === 'all' ? '전체' : CHANNEL_LABEL[f.channel]}</span>
                <ImpactTag finding={f} className="text-sm text-slate-600" />
              </div>
              <p className="mt-2 text-sm">
                <span className="font-semibold">관찰 사실:</span> {f.fact}
              </p>
              <ImpactNote finding={f} />
              {f.hypotheses.length > 0 && (
                <div className="mt-1 text-sm text-slate-700">
                  <span className="font-semibold">확인할 가설:</span>
                  <ul className="list-disc pl-5">
                    {f.hypotheses.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}
              {f.dataNeeded.length > 0 && (
                <p className="mt-1 text-sm text-slate-600">
                  <span className="font-semibold">추가 데이터:</span> {f.dataNeeded.join(', ')}
                </p>
              )}
              {f.tone === 'watch' && (
                <Button size="sm" className="mt-2" onClick={() => plan.start(f)}>
                  이 가설로 실행 계획 만들기
                </Button>
              )}
            </div>
          ))}
          {sorted.length > 3 && (
            <Button size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? '접기' : `나머지 ${sorted.length - 3}개 더 보기`}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
