import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PeriodPicker, defaultRanges } from '../components/PeriodPicker';
import { QuickEntry, TodayStatus, type QuickEntryProps } from '../components/QuickEntry';
import {
  Badge,
  BasisBadge,
  BigWon,
  Button,
  MAN_THRESHOLD,
  manText,
  CalcValue,
  MixBadge,
  Card,
  ChannelDot,
  DeltaText,
  EmptyState,
  More,
  Notice,
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
import { UnclosedDays } from '../components/UnclosedDays';
import { calcReasons, reasonLine, recordGaps } from '../domain/review';
import { settlementTodos, setupHint, type SetupHint } from '../domain/settlement';
import { pendingEstimates, type PendingItem } from '../domain/pending';
import { monthOf } from '../domain/months';
import { WEEKDAY_LABELS, formatRange, isFullMonth, isValidRange, shortDate } from '../domain/dates';
import { LENGTH_NOTE, diagnoseSummaries, homeHeadline, perBusinessDay, plainFact, topIssues } from '../domain/diagnosis';
import { ImpactDetail, NeedMoreRecords } from '../components/ChangeFocus';
import { appToday, periodWords, presetRanges, referenceDate, type PeriodPreset } from '../domain/periods';
import type { SalesEntry } from '../domain/types';
import { SalesEditor } from './SalesCosts';
import { fmt, fmtCalc, fmtSigned, type Unit } from '../domain/format';
import { CHANNEL_COLOR, CHANNEL_LABEL } from '../domain/labels';
import { CHANNELS, type Calc, type Channel } from '../domain/types';
import { useApp, useData } from '../state/AppContext';

const man = (n: number) => (Math.abs(n) >= 10000 ? `${Math.round(n / 10000).toLocaleString('ko-KR')}만` : `${Math.round(n).toLocaleString('ko-KR')}`);

type PeriodChoice = PeriodPreset | 'custom';

/** "10.25" */
const dot = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
/** "약 81만 원" (10만 원 이상은 만 원 단위로 줄인 값임을 밝힌다) */
const approx = (n: number) => (Math.abs(n) >= MAN_THRESHOLD ? `약 ${manText(Math.abs(n))}` : fmt(Math.abs(n), 'won'));

export function Dashboard() {
  const data = useData();
  const { period, setPeriod } = useApp();
  // 처음에는 이번 달. 장사 점검에 다녀와도 고른 기간을 유지한다
  const [choice, setChoice] = useState<PeriodChoice>((period?.choice as PeriodChoice | undefined) ?? 'month');
  const ref = referenceDate(data);
  const today = appToday(data);
  const preset = choice === 'custom' ? null : presetRanges(choice, today, ref);
  const init = useMemo(() => (period?.choice === 'custom' ? { cur: period.cur, prev: period.prev } : defaultRanges(data)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [customCur, setCustomCur] = useState(init.cur);
  const [customPrev, setCustomPrev] = useState(init.prev);
  const cur = preset ? preset.cur : customCur;
  const prev = preset ? preset.prev : customPrev;
  const valid = isValidRange(cur) && isValidRange(prev);
  const pair = useMemo(() => (valid ? computeComparison(data, cur, prev) : null), [data, cur.start, cur.end, prev.start, prev.end, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = pair?.s ?? null;
  const p = pair?.p ?? null;
  const words = valid ? periodWords(today, ref, cur, prev) : null;
  useEffect(() => {
    if (valid) setPeriod({ choice, cur, prev });
  }, [choice, cur.start, cur.end, prev.start, prev.end, valid]); // eslint-disable-line react-hooks/exhaustive-deps

  // 첫 매출 기록일 이전은 '입력을 건너뛴 날'이 아니므로 미입력 안내에서 뺀다 (계산에서는 어차피 빠짐)
  const firstDate = useMemo(() => data.sales.reduce((m, e) => (m === '' || e.date < m ? e.date : m), ''), [data.sales]);
  const [statusDate, setStatusDate] = useState(today);
  const [quick, setQuick] = useState<Partial<QuickEntryProps> | null>(null);
  const [detail, setDetail] = useState<SalesEntry | null>(null);
  const [hint, setHint] = useState<SetupHint | null>(null);
  const storeChannels = data.store?.channels ?? [];
  const firstChannel: Channel | null = data.sales.length ? null : storeChannels.includes('delivery') ? 'delivery' : (storeChannels[0] ?? null);
  const startRecord = () => setQuick(firstChannel ? { channel: firstChannel } : {});

  return (
    <>
      <h1 className="sr-only">홈</h1>
      <div className="space-y-3 sm:space-y-4">
        {/* ① 선택한 기간에 얼마 팔고 얼마 남았나 — 기간·비교 기준은 한 번만, 매출과 이익은 연속된 두 줄 */}
        <section aria-label="기간 요약" className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <select
              aria-label="조회 기간"
              value={choice}
              onChange={(e) => setChoice(e.target.value as PeriodChoice)}
              className="rounded-lg border border-slate-300 bg-white py-1.5 pl-2 pr-8 text-base font-semibold text-slate-900"
            >
              <option value="month">이번 달</option>
              <option value="week">이번 주</option>
              <option value="recent28">최근 4주</option>
              <option value="custom">직접 선택</option>
            </select>
            {valid && words && (
              <span className="text-sm text-slate-700" aria-label="집계 기간">
                <span className="tabular">
                  {dot(cur.start)}~{dot(cur.end)}
                </span>{' '}
                · {words.compare}
              </span>
            )}
          </div>
          {choice === 'custom' && (
            <div className="mt-3">
              <PeriodPicker
                data={data}
                cur={customCur}
                prev={customPrev}
                onChange={(c, pr) => {
                  setCustomCur(c);
                  setCustomPrev(pr);
                }}
              />
            </div>
          )}
          {!data.sales.length ? (
            <div className="mt-3">
              <p className="text-sm text-slate-700">아직 계산할 매출 기록이 없어요. 오늘 매출을 적으면 여기에 판 돈과 남은 돈이 나와요.</p>
              <Button variant="primary" className="mt-3 w-full py-3 text-base sm:w-auto sm:px-6" onClick={startRecord}>
                첫 매출 기록하기
              </Button>
            </div>
          ) : s && p ? (
            <>
              <SummaryRows s={s} p={p} />
              <More summary="계산 내역 보기" className="mt-3">
                <div className="space-y-3">
                  <p className="text-sm text-slate-700">{preset ? `${preset.label} · ${preset.compareLabel}` : `${formatRange(cur)} · ${formatRange(prev)}와 비교`}</p>
                  <CalcDetail s={s} p={p} />
                  <UnclosedDays days={s.unrecordedDays.filter((d) => d <= today && d >= firstDate)} onEnter={(d) => setQuick({ date: d })} />
                </div>
              </More>
            </>
          ) : (
            <p className="mt-3 text-sm text-red-700">조회 기간을 올바르게 고르세요.</p>
          )}
        </section>

        {hint && (
          <Notice tone="info">
            <p className="font-medium">첫 기록을 저장했어요</p>
            <p className="mt-0.5 text-sm">{hint.text}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <HintGo section={hint.section} />
              <Button size="sm" onClick={() => setHint(null)}>
                나중에
              </Button>
            </div>
          </Notice>
        )}

        {/* ② 오늘 기록 — 기록할 날짜와 진행 상태 (이익 집계 기간과 따로) */}
        <TodayStatus
          date={statusDate}
          onDateChange={setStatusDate}
          onEnter={(slot) => setQuick({ date: statusDate, channel: slot.channel, routeId: slot.routeId })}
          onEdit={(e) => setDetail(structuredClone(e))}
          onStart={() => (statusDate === today ? startRecord() : setQuick({ date: statusDate }))}
          startLabel={statusDate !== today ? '이 날 매출 기록하기' : firstChannel ? `오늘 ${CHANNEL_LABEL[firstChannel]} 매출 기록하기` : '오늘 매출 기록하기'}
        />

        {/* ③ 같은 기간에서 가장 먼저 살펴볼 변화 한 가지 */}
        {s && p && words && data.sales.length > 0 && <TopIssues s={s} p={p} name={words.name} than={words.than} />}

        {/* ④ 상세 표·차트는 필요할 때 펼친다 */}
        {s && p && data.sales.length > 0 && (
          <section aria-label="상세 표와 차트">
            <More summary="상세 표와 차트 보기">
              <div className="mt-2">
                <DashboardBody s={s} p={p} compareWord={words?.than ?? '비교 기간보다'} />
              </div>
            </More>
          </section>
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

function HintGo({ section }: { section: string }) {
  const { navigate } = useApp();
  return (
    <Button size="sm" variant="primary" onClick={() => navigate('store', { section })}>
      지금 설정하기
    </Button>
  );
}

/**
 * 매출 / (예상) 이익 두 줄: 금액과 비교 기간 대비 변화. 해석을 바꾸는 상태(매출 미입력·비용 누락·추정 비용·비교 자료 부족)는
 * 그 금액 바로 아래에 둔다. 비교할 수 없으면 증감을 만들지 않고 이유만 쓴다.
 */
function SummaryRows({ s, p }: { s: PeriodSummary; p: PeriodSummary }) {
  const data = useData();
  const { navigate } = useApp();
  const missingCosts = missingCostCount(s);
  const gaps = recordGaps(data, s).filter((g) => g.kind === 'sales');
  const gapCount = gaps.reduce((n, g) => n + g.dates.length, 0);
  const months = isFullMonth(s.range) && isFullMonth(p.range);
  const lengthsDiffer = s.calendarDays !== p.calendarDays && !months;
  const why = (c: Calc, pc: Calc) =>
    !p.entryCount ? '비교 자료 없음' : lengthsDiffer ? '기간 길이 다름' : c.salesGap || pc.salesGap ? '비교 보류' : comparableValue(c) === null || comparableValue(pc) === null ? '비교 불가' : null;
  const estNames = s.costBreakdown.filter((r) => r.estimated > 0).sort((a, b) => b.estimated - a.estimated).map((r) => r.label);
  const sales = profitForDisplay(s.totalSales);
  const profit = profitForDisplay(s.operatingProfit);

  const amount = (c: Calc, shown: { amount: number | null; provisional: boolean }) =>
    shown.amount !== null ? (
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span className="whitespace-nowrap">
          {Math.abs(shown.amount) >= MAN_THRESHOLD && <><span className="text-sm font-semibold text-slate-700">약</span> </>}
          <BigWon value={shown.amount} className="text-xl font-bold text-slate-900 sm:text-2xl" />
        </span>
        {shown.provisional && <span className="text-xs font-medium text-slate-600">{c.salesGap ? '일부 확인' : '미확정'}</span>}
      </span>
    ) : (
      <CalcValue calc={c} unit="won" />
    );
  const delta = (c: Calc, pc: Calc) => {
    const r = why(c, pc);
    if (r) return <span className="text-sm text-slate-600">{r}</span>;
    const d = comparableValue(c)! - comparableValue(pc)!;
    return <b className={`text-sm ${d > 0 ? 'text-emerald-800' : d < 0 ? 'text-red-800' : 'text-slate-800'}`}>{d === 0 ? '변화 없음' : `${approx(d)} ${d > 0 ? '증가' : '감소'}`}</b>;
  };
  const row = 'grid grid-cols-[4rem_1fr_auto] items-baseline gap-x-2 sm:grid-cols-[4.5rem_1fr_auto]';
  const note = 'col-start-2 col-span-2 text-sm';
  return (
    <div className="mt-3 space-y-2">
      <div className={row} aria-label="매출">
        <span className="text-sm font-medium text-slate-700">매출</span>
        {amount(s.totalSales, sales)}
        {delta(s.totalSales, p.totalSales)}
        {gapCount > 0 && (
          <p className={`${note} text-amber-900`}>
            ⚠ 기록하지 않은 경로·날 {gapCount}곳 · 입력된 기록만 더한 값{' '}
            <button className="font-medium underline" onClick={() => navigate('sales', gapTarget(gaps[0]))}>
              기록 채우기
            </button>
          </p>
        )}
      </div>
      <div className={row} aria-label="이익">
        <span className="text-sm font-medium text-slate-700">{!profit.provisional && s.operatingProfit.estimated ? '예상 이익' : '이익'}</span>
        {amount(s.operatingProfit, profit)}
        {delta(s.operatingProfit, p.operatingProfit)}
        {profit.provisional && missingCosts > 0 && (
          <p className={`${note} text-amber-900`}>
            ⚠ 비용 {missingCosts}개 미입력 · 실제보다 높게 보일 수 있음{' '}
            <button className="font-medium underline" onClick={() => navigate('sales')}>
              보완하기
            </button>
          </p>
        )}
        {estNames.length > 0 && (
          <p className={`${note} text-slate-700`} title={ESTIMATED_HINT}>
            ≈ {estNames.slice(0, 2).join('·')}
            {estNames.length > 2 ? ' 등' : ''} 추정 포함
          </p>
        )}
        {lengthsDiffer && p.entryCount > 0 && <p className={`${note} text-slate-600`}>{LENGTH_NOTE} · 계산 내역에서 영업일당으로 보세요</p>}
      </div>
    </div>
  );
}

/** 계산 내역: 요약 문장, 정확한 원 단위 금액, 매출·영업일당, 월 비교 표, 채울 할 일 */
function CalcDetail({ s, p }: { s: PeriodSummary; p: PeriodSummary }) {
  const data = useData();
  const shownProfit = profitForDisplay(s.operatingProfit);
  const why = calcReasons(data, s, 'all');
  // 두 기간 길이가 다르면 총액 대신 영업일당으로 (단, 달력 한 달끼리는 월 총액을 비교한다)
  const months = isFullMonth(s.range) && isFullMonth(p.range);
  const lengthsDiffer = s.calendarDays !== p.calendarDays && !months;
  const prevCmp = comparableValue(p.operatingProfit);
  const curCmp = comparableValue(s.operatingProfit);
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-slate-900 px-4 py-3 text-base font-medium text-white">{homeHeadline(p, s)}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg p-3 ring-1 ring-slate-200">
          <div className="text-sm font-medium text-slate-700">{s.operatingProfit.estimated ? '예상 영업이익' : '영업이익'} (원 단위)</div>
          {shownProfit.amount !== null ? (
            <>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className="tabular text-2xl font-bold text-slate-900">{fmt(shownProfit.amount, 'won')}</span>
                {!shownProfit.provisional && <BasisBadge calc={s.operatingProfit} />}
              </div>
              {lengthsDiffer ? (
                <>
                  <DeltaText cmp={{ abs: null, pct: null, note: LENGTH_NOTE }} unit="won" />
                  <p className="text-sm text-slate-700">
                    영업일당 {fmt(perBusinessDay(p.operatingProfit, p), 'won', '계산 불가')} → {fmt(perBusinessDay(s.operatingProfit, s), 'won', '계산 불가')}
                    {perBusinessDay(p.operatingProfit, p) !== null && perBusinessDay(s.operatingProfit, s) !== null && ` (${fmtSigned(perBusinessDay(s.operatingProfit, s)! - perBusinessDay(p.operatingProfit, p)!, 'won')})`}
                  </p>
                </>
              ) : prevCmp === null || curCmp === null ? (
                <DeltaText cmp={{ abs: null, pct: null, note: s.operatingProfit.salesGap || p.operatingProfit.salesGap ? GAP_NOTE : '비교 기간 데이터 필요' }} unit="won" />
              ) : (
                <DeltaText cmp={compareValues(prevCmp, curCmp, 'profit')} unit="won" />
              )}
            </>
          ) : (
            <div className="mt-1">
              <CalcValue calc={s.operatingProfit} unit="won" size="lg" />
            </div>
          )}
          {reasonLine(s.operatingProfit, why) && <p className="mt-1 text-xs text-amber-800">근거: {reasonLine(s.operatingProfit, why)}</p>}
          <p className="mt-1 text-sm text-slate-600">{PROFIT_NOTE}</p>
        </div>
        <div className="rounded-lg p-3 ring-1 ring-slate-200">
          <div className="text-sm font-medium text-slate-700">매출 (순매출 합계)</div>
          <div className="mt-1">
            <CalcValue calc={s.totalSales} unit="won" size="lg" man />
          </div>
          {reasonLine(s.totalSales, why) && <p className="text-xs text-amber-800">근거: {reasonLine(s.totalSales, why)}</p>}
          <DeltaText cmp={lengthsDiffer ? { abs: null, pct: null, note: `${LENGTH_NOTE} · 영업일당 매출로 보세요` } : compareCalc(p.totalSales, s.totalSales)} unit="won" />
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
      {months && <MonthTable s={s} p={p} />}
      <SettlementTodos s={s} />
      {s.status.estimatedAmount > 0 && <PendingEstimates s={s} />}
    </div>
  );
}

const PROFIT_NOTE = '운영으로 남긴 이익입니다. 통장 잔액과는 다를 수 있어요.';

/** 달력 한 달끼리 비교: 9월 실적 / 10월 실적 / 증감액(10월 − 9월) / 증감률(증감액 ÷ 9월 실적). 영업일 수·영업일당 실적도 함께 */
function MonthTable({ s, p }: { s: PeriodSummary; p: PeriodSummary }) {
  const m = (x: PeriodSummary) => `${Number(x.range.start.slice(5, 7))}월`;
  const per = (c: Calc, x: PeriodSummary): Calc => {
    const v = perBusinessDay(c, x);
    return v === null ? { value: null, reason: c.salesGap ? 'incomplete' : 'noData', salesGap: c.salesGap } : { value: v };
  };
  const rows: [string, Calc, Calc, 'normal' | 'profit', Unit][] = [
    ['순매출', p.totalSales, s.totalSales, 'normal', 'won'],
    ['영업이익', p.operatingProfit, s.operatingProfit, 'profit', 'won'],
    ['영업일 수', { value: p.businessDays }, { value: s.businessDays }, 'normal', 'days'],
    ['영업일당 매출', per(p.totalSales, p), per(s.totalSales, s), 'normal', 'won'],
    ['영업일당 영업이익', per(p.operatingProfit, p), per(s.operatingProfit, s), 'profit', 'won'],
  ];
  return (
    <div aria-label="월 실적 비교" className="overflow-hidden rounded-lg ring-1 ring-slate-200">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            <th className="w-[22%] px-2 py-2 text-left font-semibold">지표</th>
            <th className="px-2 py-2 text-right font-semibold">{m(p)} 실적</th>
            <th className="px-2 py-2 text-right font-semibold">{m(s)} 실적</th>
            <th className="px-2 py-2 text-right font-semibold">증감액 · 증감률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b, kind, unit]) => (
            <tr key={label} className="border-t border-slate-100 align-top">
              <td className="px-2 py-2 text-slate-800">{label}</td>
              <td className="break-words px-2 py-2 text-right">
                <CalcValue calc={a} unit={unit} />
              </td>
              <td className="break-words px-2 py-2 text-right">
                <CalcValue calc={b} unit={unit} />
              </td>
              <td className="break-words px-2 py-2 text-right">
                <DeltaText cmp={compareCalc(a, b, kind)} unit={unit} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-2 py-1.5 text-xs text-slate-500">
        증감액 = {m(s)} − {m(p)}, 증감률 = 증감액 ÷ {m(p)} 실적. 달력 일수가 달라도({p.calendarDays}일 / {s.calendarDays}일) 월 총액을 비교하고, 영업일당 실적을 함께 봐요.
      </p>
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

/** 가장 먼저 살펴볼 변화 한 가지. '자세히 보기'는 읽기만 한다 (저장은 진단 화면의 '점검 목록에 저장'에서만) */
function TopIssues({ s, p, name, than }: { s: PeriodSummary; p: PeriodSummary; name: string; than: string }) {
  const data = useData();
  const { navigate } = useApp();
  const dx = useMemo(() => diagnoseSummaries(data, p, s, { channel: 'all', target: { key: 'operatingProfit', channel: 'all' }, targetValue: null }), [data, p, s]);
  const issue = topIssues(dx, 1)[0];
  const saved = data.problems.find((x) => x.analysis.start === s.range.start && x.analysis.end === s.range.end && x.compare.start === p.range.start && x.compare.end === p.range.end && x.channel === 'all');
  const open = (findingId?: string) => {
    const f: Record<string, string> = findingId ? { finding: findingId } : {};
    // 같은 기간에 저장한 점검이 있으면 그대로 열고, 없으면 저장하지 않은 미리 보기로 연다
    if (saved) navigate('diagnosis', { problem: saved.id, ...f });
    else navigate('diagnosis', { from: s.range.start, to: s.range.end, cfrom: p.range.start, cto: p.range.end, ...f });
  };
  return (
    <section aria-label="먼저 살펴볼 변화" className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <h2 className="text-base font-semibold text-slate-900">먼저 살펴볼 변화</h2>
      {!issue ? (
        <div className="mt-1">
          <NeedMoreRecords data={data} s={s} p={p} than={than} />
        </div>
      ) : (
        <div className="mt-1">
          {/* 관찰된 사실만 쉬운 말로. 추정 영향 금액은 접힌 상세에서 실제 이익 차이와 구분해 보여준다 */}
          <p className="text-base font-medium text-slate-900">{plainFact(issue, name, than)}</p>
          <p className="mt-0.5 text-xs text-slate-600">원인으로 확인된 것은 아니에요.</p>
          <ImpactDetail finding={issue} s={s} p={p} />
          <Button size="sm" className="mt-2" onClick={() => open(issue.id)}>
            {saved ? '저장한 점검 열기' : '자세히 보기'}
          </Button>
        </div>
      )}
    </section>
  );
}


function DashboardBody({ s, p, compareWord }: { s: PeriodSummary; p: PeriodSummary; compareWord: string }) {
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

      <ChannelTable s={s} p={p} compareWord={compareWord} />

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
function ChannelCards({ s, p, compareWord }: { s: PeriodSummary; p: PeriodSummary; compareWord: string }) {
  const keyRows = ROWS.filter((r) => ['순매출', '완료 주문 수', '홀 방문 고객 수', '객단가 / 평균 주문금액', '가게 부담 할인액', '판매 방식 비용을 뺀 금액', '주문 1건당 남는 금액'].includes(r.label));
  return (
    <div className="space-y-3 sm:hidden">
      {CHANNELS.map((c) => (
        <div key={c} className="rounded-lg p-3 ring-1 ring-slate-200">
          <h3 className="mb-2 flex items-center gap-1.5 font-semibold">
            <ChannelDot color={CHANNEL_COLOR[c]} />
            {CHANNEL_LABEL[c]}
            <span className="ml-auto text-xs font-normal text-slate-500">오른쪽 아래: {compareWord}</span>
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

function ChannelTable({ s, p, compareWord }: { s: PeriodSummary; p: PeriodSummary; compareWord: string }) {
  return (
    <Card title="판매 방식별 실적">
      <ChannelCards s={s} p={p} compareWord={compareWord} />
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
                <div className="text-xs font-normal text-slate-500">값 · 아래 {compareWord}</div>
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
