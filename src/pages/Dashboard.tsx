import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PeriodPicker, defaultRanges } from '../components/PeriodPicker';
import { QuickEntry, TodayStatus, type QuickEntryProps } from '../components/QuickEntry';
import {
  Badge,
  BasisBadge,
  BigWon,
  Button,
  CalcValue,
  MixBadge,
  Card,
  ChannelDot,
  DeltaText,
  EmptyState,
  More,
  Notice,
  PageHeader,
  TableWrap,
  ToggleGroup,
  td,
  tdR,
  th,
  thR,
} from '../components/ui';
import { ESTIMATED_HINT } from '../domain/costBasis';
import { GAP_NOTE, bucketTotal, comparableValue, compareCalc, compareValues, computeComparison, discountCalc, missingCostCount, profitForDisplay, quantityCalc, type ChannelSummary, type PeriodSummary } from '../domain/calc';
import { gapTarget } from '../components/RecordGaps';
import { recordGaps } from '../domain/review';
import { settlementTodos, setupHint, type SetupHint } from '../domain/settlement';
import { pendingEstimates, type PendingItem } from '../domain/pending';
import { monthOf } from '../domain/months';
import { WEEKDAY_LABELS, formatRange, isValidRange, shortDate, todayStr } from '../domain/dates';
import { diagnoseSummaries, homeHeadline, topIssues } from '../domain/diagnosis';
import { ImpactNote, ImpactTag, RelatedCauses } from '../components/RelatedCauses';
import { newProblem } from '../domain/factory';
import { presetRanges, referenceDate, type PeriodPreset } from '../domain/periods';
import type { SalesEntry } from '../domain/types';
import { SalesEditor } from './SalesCosts';
import { fmt, fmtCalc, type Unit } from '../domain/format';
import { CHANNEL_COLOR, CHANNEL_LABEL } from '../domain/labels';
import { CHANNELS, type Calc, type Channel } from '../domain/types';
import { useApp, useData } from '../state/AppContext';

const man = (n: number) => (Math.abs(n) >= 10000 ? `${Math.round(n / 10000).toLocaleString('ko-KR')}만` : `${Math.round(n).toLocaleString('ko-KR')}`);

type PeriodChoice = PeriodPreset | 'custom';

export function Dashboard() {
  const data = useData();
  const { navigate } = useApp();
  const [choice, setChoice] = useState<PeriodChoice>('recent28');
  const ref = referenceDate(data);
  const today = todayStr();
  const preset = choice === 'custom' ? null : presetRanges(choice, today, ref);
  const init = useMemo(() => defaultRanges(data), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [customCur, setCustomCur] = useState(init.cur);
  const [customPrev, setCustomPrev] = useState(init.prev);
  const cur = preset ? preset.cur : customCur;
  const prev = preset ? preset.prev : customPrev;
  const valid = isValidRange(cur) && isValidRange(prev);
  const pair = useMemo(() => (valid ? computeComparison(data, cur, prev) : null), [data, cur.start, cur.end, prev.start, prev.end, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = pair?.s ?? null;
  const p = pair?.p ?? null;

  // 첫 매출 기록일 이전은 '입력을 건너뛴 날'이 아니므로 미입력 안내에서 뺀다 (계산에서는 어차피 빠짐)
  const firstDate = useMemo(() => data.sales.reduce((m, e) => (m === '' || e.date < m ? e.date : m), ''), [data.sales]);
  const [statusDate, setStatusDate] = useState(today);
  const [quick, setQuick] = useState<Partial<QuickEntryProps> | null>(null);
  const [detail, setDetail] = useState<SalesEntry | null>(null);
  const [hint, setHint] = useState<SetupHint | null>(null);
  const storeChannels = data.store?.channels ?? [];
  const firstChannel: Channel | null = data.sales.length ? null : storeChannels.includes('delivery') ? 'delivery' : (storeChannels[0] ?? null);

  return (
    <>
      <PageHeader title="홈" description="오늘 기록하고, 주 1회 남은 돈과 먼저 볼 문제를 확인하세요." />
      <div className="space-y-4">
        {/* ① 오늘 매출 기록하기 — 첫 기록 전에는 운영하는 판매 방식(배달 우선)으로 바로 연다 */}
        <Button variant="primary" className="w-full py-3 text-base sm:w-auto sm:px-6" onClick={() => setQuick(firstChannel ? { channel: firstChannel } : {})}>
          ＋ {firstChannel ? `오늘 ${CHANNEL_LABEL[firstChannel]} 매출 기록하기` : '오늘 매출 기록하기'}
        </Button>
        {!data.sales.length && <p className="-mt-2 text-sm text-slate-600">수수료율이나 원가율을 몰라도 매출과 주문 수만 먼저 저장할 수 있어요.</p>}
        {hint && (
          <Notice tone="info">
            <p className="font-medium">첫 기록을 저장했어요</p>
            <p className="mt-0.5 text-sm">{hint.text}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => navigate('store', { section: hint.section })}>
                지금 설정하기
              </Button>
              <Button size="sm" onClick={() => setHint(null)}>
                나중에
              </Button>
            </div>
          </Notice>
        )}

        {/* ② 오늘 입력 현황 */}
        <TodayStatus
          date={statusDate}
          onDateChange={setStatusDate}
          onEnter={(slot) => setQuick({ date: statusDate, channel: slot.channel, routeId: slot.routeId })}
          onEdit={(e) => setDetail(structuredClone(e))}
        />

        {!data.sales.length ? (
          <EmptyState
            title="아직 매출 기록이 없습니다"
            description="오늘 매출을 기록하면 이곳에 기간별 영업이익과 먼저 확인할 문제가 표시됩니다."
            action={<Button onClick={() => navigate('store')}>가게 설정 확인</Button>}
          />
        ) : (
          <>
            {/* ③ 선택 기간의 예상 영업이익과 변화 */}
            <section aria-label="기간 요약" className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
              <h2 className="text-base font-semibold text-slate-900">주간 점검 · 얼마 남았나</h2>
              <div className="mt-2">
                <ToggleGroup
                  value={choice}
                  onChange={setChoice}
                  options={[
                    { value: 'week', label: '이번 주' },
                    { value: 'month', label: '이번 달' },
                    { value: 'recent28', label: '최근 4주' },
                    { value: 'custom', label: '직접 선택' },
                  ]}
                />
              </div>
              <p className="mt-2 text-sm text-slate-800">
                <b>{preset ? preset.label : `직접 선택 ${isValidRange(cur) ? formatRange(cur) : ''}`}</b>
                <br />
                <span className="text-slate-700">{preset ? preset.compareLabel : isValidRange(prev) ? `${formatRange(prev)}와 비교` : ''}</span>
              </p>
              {choice === 'custom' && (
                <More summary="조회·비교 기간 조정" defaultOpen className="mt-2">
                  <PeriodPicker
                    data={data}
                    cur={customCur}
                    prev={customPrev}
                    onChange={(c, pr) => {
                      setCustomCur(c);
                      setCustomPrev(pr);
                    }}
                  />
                </More>
              )}
              {s && p && <PeriodHeadline s={s} p={p} />}
              {s && p && <UnrecordedDays days={s.unrecordedDays.filter((d) => d <= today && d >= firstDate)} paired={p.pairedExcluded} onEnter={(d) => setQuick({ date: d })} />}
            </section>

            {/* ④ 먼저 확인할 문제 */}
            {s && p && <TopIssues s={s} p={p} />}

            {/* ⑤ 상세 표와 차트 */}
            {s && p && (
              <section aria-label="상세 표와 차트" className="space-y-4">
                <h2 className="pt-2 text-lg font-semibold text-slate-900">상세 표와 차트</h2>
                <DashboardBody s={s} p={p} />
              </section>
            )}
          </>
        )}
      </div>
      {quick && (
        <QuickEntry
          {...quick}
          onClose={() => setQuick(null)}
          onSaved={(e) => {
            setStatusDate(e.date);
            // 첫 기록이면 방금 입력한 기록에 관련된 설정 하나만 제안
            if (!data.sales.length) setHint(setupHint(data, e));
          }}
          onOpenDetail={(e) => setDetail(structuredClone(data.sales.find((x) => x.id === e.id) ?? e))}
        />
      )}
      {detail && <SalesEditor initial={detail} onClose={() => setDetail(null)} onSaved={(e) => setStatusDate(e.date)} />}
    </>
  );
}

/** 홈 요약 아래: 계산에서 뺀 미입력 영업일과 바로 입력하기 */
function UnrecordedDays({ days, paired, onEnter }: { days: string[]; paired: string[]; onEnter: (d: string) => void }) {
  if (!days.length) return null;
  const shown = days.slice(-3).reverse();
  return (
    <div aria-label="미입력 영업일" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
      <ul className="space-y-1">
        {shown.map((d) => (
          <li key={d} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <span aria-hidden>⚠ </span>
              <b>{shortDate(d)} 미입력</b>
            </span>
            <button type="button" className="font-medium underline" aria-label={`${shortDate(d)} 매출 입력하기`} onClick={() => onEnter(d)}>
              → 입력하기
            </button>
          </li>
        ))}
      </ul>
      {days.length > shown.length && <p className="mt-1">외 {days.length - shown.length}일 더 있어요.</p>}
      <p className="mt-1 text-xs text-amber-800">
        매출 기록도 '매출 없음' 확인도 없는 영업일은 0원으로 보지 않고 매출·영업일 수·월세 등 기간 비용 계산에서 뺐어요.
        {paired.length > 0 && ` 비교 기간에서도 같은 순서의 날(${paired.map(shortDate).join(', ')})을 빼고 비교해요.`}
      </p>
    </div>
  );
}

const PROFIT_NOTE ='운영으로 남긴 이익입니다. 통장 잔액과는 다를 수 있어요.';

function PeriodHeadline({ s, p }: { s: PeriodSummary; p: PeriodSummary }) {
  const { navigate } = useApp();
  const estimated = !!s.operatingProfit.estimated;
  const shownProfit = profitForDisplay(s.operatingProfit);
  const missingCosts = missingCostCount(s);
  const data = useData();
  // 성과 확인과 같은 기준: 기록하지 않은 경로·날이 있으면 부분 합계라 이전 기간과 빼지 않는다
  const gaps = recordGaps(data, s).filter((g) => g.kind === 'sales');
  const gapCount = gaps.reduce((n, g) => n + g.dates.length, 0);
  const prevCmp = comparableValue(p.operatingProfit);
  const curCmp = comparableValue(s.operatingProfit);
  return (
    <div className="mt-3 space-y-3">
      <p className="rounded-lg bg-slate-900 px-4 py-3 text-base font-medium text-white">{homeHeadline(p, s)}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg p-3 ring-1 ring-slate-200">
          <div className="text-sm font-medium text-slate-700">{estimated ? '예상 영업이익' : '영업이익'}</div>
          {shownProfit.amount !== null ? (
            <>
              {/* 비용이 덜 채워져도 숫자는 크게, 미확정 표시는 작게 (입력된 비용만 반영한 값) */}
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <BigWon value={shownProfit.amount} className="text-2xl font-bold text-slate-900" />
                {shownProfit.provisional && <span className="text-xs font-medium text-slate-500">{s.operatingProfit.salesGap ? '일부 확인' : '미확정'}</span>}
                {!shownProfit.provisional && <BasisBadge calc={s.operatingProfit} />}
              </div>
              {prevCmp === null || curCmp === null ? (
                <DeltaText cmp={{ abs: null, pct: null, note: s.operatingProfit.salesGap || p.operatingProfit.salesGap ? GAP_NOTE : '비교 기간 데이터 필요' }} unit="won" />
              ) : (
                <DeltaText cmp={compareValues(prevCmp, curCmp, 'profit')} unit="won" />
              )}
              {gapCount > 0 && (
                <p className="mt-1 text-sm text-amber-800">
                  ⚠ 기록하지 않은 경로·날 {gapCount}곳 · 입력된 기록만 더한 값{' '}
                  <button className="font-medium underline" onClick={() => navigate('sales', gapTarget(gaps[0]))}>
                    기록 채우기
                  </button>
                </p>
              )}
              {shownProfit.provisional && missingCosts > 0 && (
                <p className="mt-1 text-sm text-amber-800">
                  ⚠ 비용 {missingCosts}개 미입력 · 실제보다 높게 보일 수 있음{' '}
                  <button className="font-medium underline" onClick={() => navigate('sales')}>
                    보완하기
                  </button>
                </p>
              )}
            </>
          ) : (
            <div className="mt-1">
              <CalcValue calc={s.operatingProfit} unit="won" size="lg" man />
            </div>
          )}
          <p className="mt-1 text-sm text-slate-600">{PROFIT_NOTE}</p>
        </div>
        <div className="rounded-lg p-3 ring-1 ring-slate-200">
          <div className="text-sm font-medium text-slate-700">매출 (순매출 합계)</div>
          <div className="mt-1">
            <CalcValue calc={s.totalSales} unit="won" size="lg" man />
          </div>
          <DeltaText cmp={compareCalc(p.totalSales, s.totalSales)} unit="won" />
        </div>
        <div className="rounded-lg p-3 ring-1 ring-slate-200">
          <div className="text-sm font-medium text-slate-700">영업일당 매출</div>
          <div className="mt-1">
            <CalcValue calc={s.salesPerBusinessDay} unit="won" size="lg" man />
          </div>
          <DeltaText cmp={compareCalc(p.salesPerBusinessDay, s.salesPerBusinessDay)} unit="won" />
          <p className="mt-1 text-sm text-slate-600">
            영업일 {s.businessDays}일 (비교 {p.businessDays}일)
          </p>
        </div>
      </div>
      <SettlementTodos s={s} />
      {s.status.estimatedAmount > 0 && <PendingEstimates s={s} />}
    </div>
  );
}

/** 쿠폰 판단에 필요한데 비어 있는 할인·수수료: 배달앱별로 묶어 정산 반영 화면으로 */
function SettlementTodos({ s }: { s: PeriodSummary }) {
  const data = useData();
  const { navigate } = useApp();
  const todos = useMemo(() => settlementTodos(data, s.range), [data, s.range]);
  if (!todos.length) return null;
  const name = (id: string) => data.routes.find((r) => r.id === id)?.name ?? '(삭제된 경로)';
  return (
    <div aria-label="정산 반영할 것" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
      <p className="font-medium">쿠폰 판단에 필요한 할인·수수료가 비어 있어요</p>
      <ul className="mt-1 space-y-1">
        {todos.map((t) => (
          <li key={`${t.routeId}|${t.channel}`}>
            <button type="button" className="text-left underline" onClick={() => navigate('sales', { tab: 'settle', route: t.routeId, channel: t.channel, from: t.start, to: t.end })}>
              {name(t.routeId)}({CHANNEL_LABEL[t.channel]}) {shortDate(t.start)}{t.end !== t.start ? `~${shortDate(t.end)}` : ''}
              {t.discountUnknown > 0 && ` · 할인액 미입력 ${t.discountUnknown}건`}
              {t.feeMissing > 0 && ` · 수수료 미입력 ${t.feeMissing}건`} → 정산 반영하기
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 추정값을 정산서·영수증 금액으로 바꿀 할 일: 기간·경로·비용 항목별. 누르면 그 기록만 모아 둔 입력 화면으로 (설정대로 계산한 값은 넣지 않음) */
function PendingEstimates({ s }: { s: PeriodSummary }) {
  const data = useData();
  const { navigate } = useApp();
  const [all, setAll] = useState(false);
  const items = useMemo(() => pendingEstimates(data, s.range), [data, s.range]);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 4);
  const go = (it: PendingItem) => {
    if (it.kind === 'period') return navigate('sales', { tab: 'period', month: monthOf(it.start) });
    // 수수료는 정산서로 여러 날을 한 번에 채우는 정산 반영 화면으로, 그 밖의 비용은 그 기록만 모은 목록으로
    if (it.kind === 'fee' && data.routes.find((r) => r.id === it.routeId)?.platformId) return navigate('sales', { tab: 'settle', route: it.routeId!, channel: it.channel!, from: it.start, to: it.end });
    navigate('sales', { tab: 'daily', month: monthOf(it.end), from: it.start, to: it.end, route: it.routeId!, channel: it.channel!, cats: it.categories.join(',') });
  };
  return (
    <div aria-label="추정값 확인하기" className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-amber-950">추정값 확인하기 · {items.length}건</h3>
        <span className="text-xs text-amber-900">비용 중 {fmt(s.status.estimatedAmount, 'won')}이 추정값이에요. 정산서·영수증 금액을 넣으면 그 금액만 반영해요.</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {shown.map((it) => (
          <li key={it.id}>
            <button type="button" onClick={() => go(it)} className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md bg-white px-3 py-2 text-left text-sm ring-1 ring-amber-200 hover:bg-amber-100">
              <span className="min-w-0">
                <b className="text-amber-950">{it.title}:</b> <span className="text-slate-900">{it.label}</span>
              </span>
              <span className="text-xs text-slate-600 tabular">
                {it.kind === 'period' ? '' : `기록 ${it.count}건 · `}추정 {fmt(it.amount, 'won')} →
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > 4 && (
        <button type="button" className="mt-2 text-xs font-medium text-amber-900 underline" onClick={() => setAll((v) => !v)}>
          {all ? '접기' : `${items.length - 4}건 더 보기`}
        </button>
      )}
    </div>
  );
}

function TopIssues({ s, p }: { s: PeriodSummary; p: PeriodSummary }) {
  const data = useData();
  const { navigate, update } = useApp();
  const dx = useMemo(() => diagnoseSummaries(data, p, s, { channel: 'all', target: { key: 'operatingProfit', channel: 'all' }, targetValue: null }), [data, p, s]);
  const issues = topIssues(dx, 3);
  // 같은 기간의 문제가 이미 있으면 그 문제로, 없으면 이 기간으로 문제를 등록하고 진단 화면으로 이동
  const openDiagnosis = (findingId?: string) => {
    const found = data.problems.find((x) => x.analysis.start === s.range.start && x.analysis.end === s.range.end && x.compare.start === p.range.start && x.compare.end === p.range.end && x.channel === 'all');
    if (found) {
      navigate('diagnosis', { problem: found.id, ...(findingId ? { finding: findingId } : {}) });
      return;
    }
    const prob = newProblem({ name: `${formatRange(s.range)} 영업이익 점검`, type: 'profitDecline', analysis: s.range, compare: p.range, channel: 'all', target: { key: 'operatingProfit', channel: 'all' } });
    update((d) => ({ ...d, problems: [...d.problems, prob] }), '이 기간을 문제 진단에 등록했습니다.');
    navigate('diagnosis', { problem: prob.id, ...(findingId ? { finding: findingId } : {}) });
  };
  return (
    <section aria-label="먼저 확인할 문제" className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">먼저 확인할 문제</h2>
        <span className="text-sm text-slate-600">영업이익 영향이 큰 순서 · 최대 3개</span>
      </div>
      {!issues.length ? (
        <p className="text-sm text-slate-700">기준(±5%) 이상으로 나빠진 항목이 없습니다. 상세 표에서 세부 수치를 확인하세요.</p>
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-800">원인으로 확인된 것은 아니에요. 아래 항목부터 살펴보세요.</p>
          <ol className="space-y-2">
            {issues.map((f, i) => (
              <li key={f.id} className="rounded-lg p-3 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {i + 1}. {f.title}
                  </span>
                  <ImpactTag finding={f} />
                </div>
                <p className="mt-1 text-sm text-slate-700">{f.fact}</p>
                <ImpactNote finding={f} />
                <RelatedCauses issue={f} />
                <Button size="sm" className="mt-2" onClick={() => openDiagnosis(f.id)}>
                  진단에서 자세히 보기
                </Button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function DashboardBody({ s, p }: { s: PeriodSummary; p: PeriodSummary }) {
  const { navigate } = useApp();
  const weekdayDiff = WEEKDAY_LABELS.map((w, i) => ({ w, d: s.weekdayCounts[i] - p.weekdayCounts[i] })).filter((x) => x.d !== 0);
  return (
    <div className="space-y-4">
      {s.entryCount === 0 && <Notice tone="warn">조회 기간에 매출 입력이 없습니다. 기간을 바꾸거나 매출을 입력하세요.</Notice>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white px-4 py-2 text-sm ring-1 ring-slate-200">
        <span>
          영업일 수: 조회 <b>{s.businessDays}일</b> / 비교 <b>{p.businessDays}일</b>
          {s.businessDays !== p.businessDays && <span className="ml-1 text-amber-700">({s.businessDays - p.businessDays > 0 ? '+' : ''}{s.businessDays - p.businessDays}일)</span>}
        </span>
        <span className="text-slate-500">
          요일 구성 차이: {weekdayDiff.length ? weekdayDiff.map((x) => `${x.w} ${x.d > 0 ? '+' : ''}${x.d}`).join(', ') : '없음'}
        </span>
        {s.salesOnClosedDays > 0 && <span className="text-amber-700">휴업일로 설정된 날짜에 매출 입력 {s.salesOnClosedDays}일</span>}
      </div>

      {/* 매출·영업이익·영업일당 매출은 위 기간 요약에 있으므로 여기서는 영업이익률만 */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-white px-4 py-3 ring-1 ring-slate-200">
        <span className="text-sm font-medium text-slate-700">영업이익률 (영업이익 ÷ 매출)</span>
        <CalcValue calc={s.operatingMargin} unit="pct" />
        <DeltaText cmp={compareCalc(p.operatingMargin, s.operatingMargin, 'ratio')} unit="pct" ratio />
      </div>

      <DataStatusCard s={s} onFix={() => navigate('sales')} />

      <ChannelTable s={s} p={p} />

      <div className="grid gap-4 xl:grid-cols-2">
        <ChannelChart s={s} p={p} />
        <CostBreakdown s={s} />
      </div>

      <DailyTrend s={s} />
    </div>
  );
}

function DataStatusCard({ s, onFix }: { s: PeriodSummary; onFix: () => void }) {
  const [open, setOpen] = useState(false);
  const total = s.status.actualAmount + s.status.calculatedAmount + s.status.estimatedAmount;
  const share = (n: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : '—');
  return (
    <Card
      title="데이터 상태 (조회 기간)"
      subtitle="같은 항목에 정산서·영수증 금액을 넣으면 그 금액만 씁니다. 모르는 값을 가정한 비용은 추정으로 따로 보여줍니다."
      actions={
        s.status.missingCount > 0 ? (
          <Button size="sm" onClick={onFix}>
            누락 입력하러 가기
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-xs text-slate-700">비용</div>
          <div className="tabular font-semibold">{fmt(s.status.actualAmount + s.status.calculatedAmount, 'won')}</div>
          <div className="text-xs text-slate-600">{share(s.status.actualAmount + s.status.calculatedAmount)}</div>
        </div>
        <div className="rounded-lg bg-amber-50 px-3 py-2" title={ESTIMATED_HINT}>
          <div className="text-xs text-amber-800">추정 비용</div>
          <div className="tabular font-semibold">{fmt(s.status.estimatedAmount, 'won')}</div>
          <div className="text-xs text-amber-700">{share(s.status.estimatedAmount)}</div>
        </div>
        <div className={`rounded-lg px-3 py-2 ${s.status.missingCount ? 'bg-red-50' : 'bg-slate-50'}`}>
          <div className="text-xs text-slate-700">누락 항목</div>
          <div className="tabular font-semibold">{fmt(s.status.missingCount, 'count')}</div>
          <div className="text-xs text-slate-600">{s.status.missingCount ? '영업이익은 확정되지 않습니다' : '필수 항목이 모두 입력됨'}</div>
        </div>
      </div>
      {s.status.missingCount > 0 && (
        <div className="mt-3">
          <button className="text-xs font-medium text-slate-700 underline" onClick={() => setOpen((v) => !v)}>
            {open ? '누락 목록 접기' : '누락 목록 보기'}
          </button>
          {open && (
            <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-5 text-xs text-slate-600">
              {s.status.missing.slice(0, 200).map((m, i) => (
                <li key={i}>{m.label}</li>
              ))}
              {s.status.missing.length > 200 && <li>외 {s.status.missing.length - 200}건</li>}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

interface RowDef {
  label: string;
  unit: Unit;
  get: (c: ChannelSummary) => Calc;
  kind?: 'normal' | 'profit' | 'ratio';
  higherIsBetter?: boolean;
  note?: string;
  /** 쉬운 이름 (정확한 용어 label은 보조 설명으로 함께 보여준다). 판매 방식을 넘기면 그 판매 방식용 이름 */
  easy?: (c: Channel | null) => string;
}

const ROWS: RowDef[] = [
  { label: '순매출', unit: 'won', get: (c) => (c.entryCount ? { value: c.netSales } : { value: null, reason: 'noData' }) },
  { label: '완료 주문 수', unit: 'orders', get: (c) => quantityCalc(c, 'orders') },
  { label: '홀 방문 고객 수', unit: 'people', get: (c) => (c.channel === 'hall' ? quantityCalc(c, 'visitors') : { value: null }) },
  { label: '객단가 / 평균 주문금액', unit: 'won', get: (c) => c.avgTicket, note: '홀: 순매출 ÷ 방문 고객 수, 배달·포장: 순매출 ÷ 완료 주문 수' },
  {
    label: '가게 부담 할인액',
    unit: 'won',
    get: (c) => discountCalc(c),
    higherIsBetter: false,
    easy: (c) => (c ? `${CHANNEL_LABEL[c]} 쿠폰·할인으로 낸 돈` : '쿠폰·할인으로 낸 돈'),
    note: '가게가 부담한 쿠폰·할인 금액(플랫폼 부담분 제외). 순매출에서 이미 빠진 금액',
  },
  { label: '판매 방식 비용', unit: 'won', get: (c) => c.directCostCalc, higherIsBetter: false, note: '식재료·수수료·배달비·포장비 등 그 판매 방식에 쓰인 비용' },
  {
    label: '판매 방식 비용을 뺀 금액',
    unit: 'won',
    get: (c) => c.directProfit,
    kind: 'profit',
    easy: (c) => (c ? `${CHANNEL_LABEL[c]}에서 남은 돈` : '판매 방식별 남은 돈'),
    note: '공통 운영비 빼기 전 (순매출 − 판매 방식 비용)',
  },
  { label: '주문 1건당 판매 방식 비용', unit: 'won', get: (c) => c.costPerOrder, higherIsBetter: false, easy: (c) => (c ? `${CHANNEL_LABEL[c]} 1건당 든 비용` : '1건당 든 비용') },
  {
    label: '주문 1건당 남는 금액',
    unit: 'won',
    get: (c) => c.directProfitPerOrder,
    kind: 'profit',
    easy: (c) => (c ? `${CHANNEL_LABEL[c]} 1건당 남은 돈` : '1건당 남은 돈'),
    note: '해당 판매 방식 비용을 뺀 뒤, 공통 운영비 빼기 전',
  },
  { label: '판매 방식 비용률', unit: 'pct', get: (c) => c.costRate, kind: 'ratio', higherIsBetter: false, note: '판매 방식 비용 ÷ 순매출' },
];

/** 휴대폰: 판매 방식별 카드 */
function ChannelCards({ s, p }: { s: PeriodSummary; p: PeriodSummary }) {
  const keyRows = ROWS.filter((r) => ['순매출', '완료 주문 수', '홀 방문 고객 수', '객단가 / 평균 주문금액', '가게 부담 할인액', '판매 방식 비용을 뺀 금액', '주문 1건당 남는 금액'].includes(r.label));
  return (
    <div className="space-y-3 sm:hidden">
      {CHANNELS.map((c) => (
        <div key={c} className="rounded-lg p-3 ring-1 ring-slate-200">
          <h3 className="mb-2 flex items-center gap-1.5 font-semibold">
            <ChannelDot color={CHANNEL_COLOR[c]} />
            {CHANNEL_LABEL[c]}
          </h3>
          <dl className="space-y-2">
            {keyRows
              .filter((r) => !(r.label === '홀 방문 고객 수' && c !== 'hall'))
              .map((r) => {
                const cv = r.get(s.channels[c]);
                const pv = r.get(p.channels[c]);
                return (
                  <div key={r.label} className="flex items-start justify-between gap-3">
                    <dt className="min-w-0 text-sm text-slate-700">
                      {r.label === '객단가 / 평균 주문금액' ? (c === 'hall' ? '객단가' : '평균 주문금액') : r.easy ? r.easy(c) : r.label}
                      {r.easy && <div className="text-xs text-slate-500">{r.label}</div>}
                      {r.note && r.label.includes('남는') && <div className="text-xs text-slate-600">{r.note}</div>}
                    </dt>
                    <dd className="text-right">
                      <CalcValue calc={cv} unit={r.unit} />
                      <div>
                        <DeltaText cmp={compareCalc(pv, cv, r.kind ?? 'normal')} unit={r.unit} ratio={r.kind === 'ratio'} higherIsBetter={r.higherIsBetter ?? true} />
                      </div>
                    </dd>
                  </div>
                );
              })}
          </dl>
        </div>
      ))}
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between">
          <span>공통 운영비 (월세·급여 등)</span>
          <b className="tabular">{fmt(bucketTotal(s.commonCost), 'won')}</b>
        </div>
        <div className="mt-1 flex justify-between">
          <span>{s.operatingProfit.estimated ? '예상 영업이익' : '영업이익'}</span>
          <CalcValue calc={s.operatingProfit} unit="won" />
        </div>
      </div>
    </div>
  );
}

function ChannelTable({ s, p }: { s: PeriodSummary; p: PeriodSummary }) {
  return (
    <Card title="판매 방식별 실적" subtitle="각 값 아래는 비교 기간 대비 변화입니다.">
      <ChannelCards s={s} p={p} />
      <div className="hidden sm:block">
      <TableWrap>
        <thead>
          <tr>
            <th className={th}>지표</th>
            {CHANNELS.map((c) => (
              <th key={c} className={thR}>
                <span className="inline-flex items-center gap-1.5">
                  <ChannelDot color={CHANNEL_COLOR[c]} />
                  {CHANNEL_LABEL[c]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.label}>
              <td className={td}>
                <div className="font-medium text-slate-800">{r.easy ? r.easy(null) : r.label}</div>
                {r.easy && <div className="text-xs text-slate-600">{r.label}</div>}
                {r.note && <div className="text-xs text-slate-500">{r.note}</div>}
              </td>
              {CHANNELS.map((c) => {
                if (r.label === '홀 방문 고객 수' && c !== 'hall')
                  return (
                    <td key={c} className={tdR + ' text-slate-300'}>
                      해당 없음
                    </td>
                  );
                const cv = r.get(s.channels[c]);
                const pv = r.get(p.channels[c]);
                return (
                  <td key={c} className={tdR}>
                    <div>
                      <CalcValue calc={cv} unit={r.unit} />
                    </div>
                    <DeltaText cmp={compareCalc(pv, cv, r.kind ?? 'normal')} unit={r.unit} ratio={r.kind === 'ratio'} higherIsBetter={r.higherIsBetter ?? true} />
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="bg-slate-50">
            <td className={td + ' font-semibold'}>공통 운영비</td>
            <td className={tdR} colSpan={3}>
              <span className="font-medium">{fmt(bucketTotal(s.commonCost), 'won')}</span>
              {s.commonCost.estimated > 0 && (
                <span className="ml-2">
                  <Badge tone="amber" title={ESTIMATED_HINT}>추정 {fmt(s.commonCost.estimated, 'won')} 포함</Badge>
                </span>
              )}
              {s.commonCost.missing > 0 && (
                <span className="ml-2">
                  <Badge tone="red">미입력 항목 있음</Badge>
                </span>
              )}
              <div>
                <DeltaText
                  cmp={compareValues(bucketTotal(p.commonCost), bucketTotal(s.commonCost))}
                  unit="won"
                  higherIsBetter={false}
                />
              </div>
            </td>
          </tr>
          <tr className="bg-slate-50">
            <td className={td}>
              <div className="font-semibold">가게에 남은 돈 (영업이익)</div>
              <div className="text-xs text-slate-600">= 판매 방식 비용을 뺀 금액 합계 − 공통 운영비</div>
            </td>
            <td className={tdR} colSpan={3}>
              <CalcValue calc={s.operatingProfit} unit="won" />
              <div>
                <DeltaText cmp={compareCalc(p.operatingProfit, s.operatingProfit, 'profit')} unit="won" />
              </div>
            </td>
          </tr>
        </tbody>
      </TableWrap>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        월세·급여 등 기간별 비용은 조회 기간의 날짜 수만큼 나눠 반영합니다. 대출 이자·원금 상환은 영업이익에 넣지 않습니다. 세무 신고용 계산이 아닙니다.
      </p>
    </Card>
  );
}

function ChannelChart({ s, p }: { s: PeriodSummary; p: PeriodSummary }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rows = CHANNELS.map((c) => ({
    name: CHANNEL_LABEL[c],
    channel: c,
    비교: p.channels[c].netSales,
    조회: s.channels[c].netSales,
  }));
  return (
    <Card
      title="판매 방식별 순매출 비교"
      subtitle="연한 막대 = 비교 기간, 진한 막대 = 조회 기간"
      actions={<ToggleGroup value={view} onChange={setView} options={[{ value: 'chart', label: '차트' }, { value: 'table', label: '표' }]} />}
    >
      {view === 'chart' ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e7e5e4" />
              <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: '#d6d3d1' }} fontSize={12} />
              <YAxis tickFormatter={man} tickLine={false} axisLine={false} fontSize={12} width={52} />
              <Tooltip formatter={(v: number, k: string) => [fmt(v, 'won'), k === '비교' ? '비교 기간' : '조회 기간']} cursor={{ fill: '#f5f5f4' }} />
              <Bar dataKey="비교" radius={[4, 4, 0, 0]} maxBarSize={36} shape={(props: any) => <rect {...rectProps(props)} fill={CHANNEL_COLOR[props.payload.channel as Channel]} fillOpacity={0.35} />} />
              <Bar dataKey="조회" radius={[4, 4, 0, 0]} maxBarSize={36} shape={(props: any) => <rect {...rectProps(props)} fill={CHANNEL_COLOR[props.payload.channel as Channel]} />} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>판매 방식</th>
              <th className={thR}>비교 기간</th>
              <th className={thR}>조회 기간</th>
              <th className={thR}>증감</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className={td}>{r.name}</td>
                <td className={tdR}>{fmt(r.비교, 'won')}</td>
                <td className={tdR}>{fmt(r.조회, 'won')}</td>
                <td className={tdR}>
                  <DeltaText cmp={compareValues(r.비교, r.조회)} unit="won" />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}

/** 둥근 위쪽 모서리 막대 (Recharts custom shape) */
function rectProps(props: any) {
  const { x, y, width, height } = props;
  const h = Math.max(0, height);
  const r = Math.min(4, width / 2, h);
  return {
    x,
    y,
    width,
    height: h,
    rx: r,
    ry: r,
  };
}

function CostBreakdown({ s }: { s: PeriodSummary }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rows = [...s.costBreakdown].sort((a, b) => b.total - a.total);
  // 정산 금액과 설정대로 계산한 금액은 같은 '비용' 막대로, 가정한 금액만 '추정'으로 나눈다
  const chartRows = rows.map((r) => ({ name: r.label, 비용: Math.round(r.actual + r.calculated), 추정: Math.round(r.estimated) }));
  const total = rows.reduce((a, r) => a + r.total, 0);
  return (
    <Card
      title="비용 항목별 구성 (조회 기간)"
      subtitle="판매 방식 비용과 공통 운영비를 함께 표시합니다. 월세·급여 등 기간별 비용은 날짜 수만큼 나눈 금액입니다."
      actions={<ToggleGroup value={view} onChange={setView} options={[{ value: 'chart', label: '차트' }, { value: 'table', label: '표' }]} />}
    >
      {!rows.length ? (
        <EmptyState title="비용 입력이 없습니다" />
      ) : view === 'chart' ? (
        <div style={{ height: Math.max(220, rows.length * 30 + 50) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke="#e7e5e4" />
              <XAxis type="number" tickFormatter={man} fontSize={12} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={110} fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: number, k: string) => [fmt(v, 'won'), k]} cursor={{ fill: '#f5f5f4' }} />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              <Bar dataKey="비용" stackId="a" fill="#52514e" stroke="#fff" strokeWidth={1} />
              <Bar dataKey="추정" stackId="a" fill="#eda100" stroke="#fff" strokeWidth={1} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>항목</th>
              <th className={th}>구분</th>
              <th className={thR}>합계</th>
              <th className={thR}>그중 추정</th>
              <th className={thR}>비중</th>
              <th className={th}>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category}>
                <td className={td}>{r.label}</td>
                <td className={td}>{r.scope === 'direct' ? '직접' : '공통 성격'}</td>
                <td className={tdR + ' font-medium'}>{fmt(r.total, 'won')}</td>
                <td className={tdR}>{r.estimated > 0 ? fmt(r.estimated, 'won') : '—'}</td>
                <td className={tdR}>{total ? fmt((r.total / total) * 100, 'pct') : '—'}</td>
                <td className={td}>{r.missing > 0 ? <Badge tone="red">누락 {r.missing}</Badge> : <MixBadge amounts={r} />}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}

function DailyTrend({ s }: { s: PeriodSummary }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rows = s.daily.map((d) => ({ ...d, label: `${d.date.slice(5).replace('-', '/')}` }));
  return (
    <Card
      title="일별 순매출 추이 (조회 기간)"
      subtitle="판매 방식별로 쌓은 막대입니다. 휴업일은 표에서 확인할 수 있습니다."
      actions={<ToggleGroup value={view} onChange={setView} options={[{ value: 'chart', label: '차트' }, { value: 'table', label: '표' }]} />}
    >
      {view === 'chart' ? (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="#e7e5e4" />
              <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={{ stroke: '#d6d3d1' }} interval="preserveStartEnd" minTickGap={12} />
              <YAxis tickFormatter={man} fontSize={12} tickLine={false} axisLine={false} width={52} />
              <Tooltip
                cursor={{ fill: '#f5f5f4' }}
                formatter={(v: number, k: string) => [fmt(v, 'won'), CHANNEL_LABEL[k as Channel] ?? k]}
                labelFormatter={(_, payload) => {
                  const d = payload?.[0]?.payload;
                  return d ? `${d.date} (${WEEKDAY_LABELS[new Date(d.date).getUTCDay()]})${d.open ? '' : ' 휴업'} · 합계 ${fmt(d.total, 'won')}` : '';
                }}
              />
              <Legend formatter={(v) => CHANNEL_LABEL[v as Channel] ?? v} wrapperStyle={{ fontSize: 13 }} />
              {CHANNELS.map((c, i) => (
                <Bar key={c} dataKey={c} stackId="d" fill={CHANNEL_COLOR[c]} stroke="#fff" strokeWidth={1} radius={i === CHANNELS.length - 1 ? [3, 3, 0, 0] : undefined} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <TableWrap>
            <thead className="sticky top-0">
              <tr>
                <th className={th}>날짜</th>
                <th className={th}>영업</th>
                {CHANNELS.map((c) => (
                  <th key={c} className={thR}>
                    {CHANNEL_LABEL[c]}
                  </th>
                ))}
                <th className={thR}>합계</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <td className={td}>
                    {r.date} ({WEEKDAY_LABELS[new Date(r.date).getUTCDay()]})
                  </td>
                  <td className={td}>{r.open ? '영업' : <Badge>휴업</Badge>}</td>
                  {CHANNELS.map((c) => (
                    <td key={c} className={tdR}>
                      {fmt(r[c], 'won')}
                    </td>
                  ))}
                  <td className={tdR + ' font-medium'}>{fmt(r.total, 'won')}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className={td} colSpan={2}>
                  합계
                </td>
                {CHANNELS.map((c) => (
                  <td key={c} className={tdR}>
                    {fmt(s.channels[c].netSales, 'won')}
                  </td>
                ))}
                <td className={tdR}>{fmtCalc(s.totalSales, 'won')}</td>
              </tr>
            </tbody>
          </TableWrap>
        </div>
      )}
    </Card>
  );
}
