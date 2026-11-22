import { useId, useMemo, useState } from 'react';
import { EntryStatusBadge, QuickEntry, TodayStatus, type QuickEntryProps } from '../components/QuickEntry';
import { recentRanges } from '../domain/periods';
import { pendingEntries } from '../domain/pending';
import { copyFromPrevMonth, isMonthKey, monthCosts, monthLabel, monthOf, monthRangeOf, monthShort, rowChanged, shiftMonth, wonShort, type MonthKey } from '../domain/months';
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
  SourceBadge,
  TextArea,
  TextInput,
  ToggleGroup,
  type BadgeTone,
} from '../components/ui';
import {
  applicableCategories,
  coveredByPeriodCost,
  computeSummary,
  netSales,
  requiredCategories,
  routeHasPlatform,
} from '../domain/calc';
import { repurchaseRate } from '../domain/customers';
import { WEEKDAY_LABELS, addDays, daysInclusive, formatDateStr, formatRange, isValidDate, parseDate, todayStr, weekday } from '../domain/dates';
import { costBasisOf, costDetailText, costFlag } from '../domain/costBasis';
import { COST_SOURCE_LABEL, NEED_PROMPT, costSourceOf, entryStatus, estimateInputsKey, feeCalcFor, foodRateEstimate, isCostDone, perOrderCostFor, recalcAuto, withEstimate } from '../domain/entry';
import { amountFieldsFromForm, formFromEntry, type AmountForm } from '../domain/amountForm';
import { SalesAmountInput, type FocusField } from '../components/SalesAmountInput';
import { FEE_NEED_TEXT, TEMP_FOOD_RATE, averageMenuCostRate, foodEstimateBase, payKindOf } from '../domain/estimate';
import { emptyCost, newCustomerMetric, newSalesEntry, uid } from '../domain/factory';
import { fmt, josa } from '../domain/format';
import { ATTRIBUTION_LABEL, CATEGORY_LABEL, CHANNEL_LABEL, COMMON_LABEL, DIRECT_LABEL, NATURE_LABEL } from '../domain/labels';
import {
  CHANNELS,
  COMMON_CATEGORIES,
  DIRECT_CATEGORIES,
  PER_ORDER_CATEGORIES,
  type AppData,
  type Attribution,
  type Channel,
  type CostCategory,
  type CustomerMetric,
  type DateRange,
  type DirectCategory,
  type PerOrderCategory,
  type PeriodCost,
  type SalesEntry,
} from '../domain/types';
import { hasErrors, validatePeriodCost, validateSalesEntry, type ValidationResult } from '../domain/validation';
import { useApp, useData } from '../state/AppContext';

type Tab = 'daily' | 'period' | 'customers';

export function SalesCosts() {
  const { route, navigate } = useApp();
  const tab = (['daily', 'period', 'customers'] as Tab[]).includes(route.params.tab as Tab) ? (route.params.tab as Tab) : 'daily';
  // 선택한 달은 주소(?month=2026-11)에 남겨 새로고침해도 유지. 처음 열면 이번 달
  const month: MonthKey = isMonthKey(route.params.month) ? route.params.month : monthOf(todayStr());
  const setMonth = (m: MonthKey) => navigate('sales', { tab, month: m });
  return (
    <>
      <PageHeader title="매출과 비용" description="매출을 먼저 기록하고, 비용은 알게 될 때 보완하세요." />
      <div className="mb-4">
        <ToggleGroup
          value={tab}
          onChange={(t) => navigate('sales', isMonthKey(route.params.month) ? { tab: t, month: route.params.month } : { tab: t })}
          options={[
            { value: 'daily', label: '일별 매출' },
            { value: 'period', label: '월세·급여 등 기간별 비용' },
            { value: 'customers', label: '고객 지표 (선택)' },
          ]}
        />
      </div>
      {tab === 'daily' && <DailySales month={month} onMonth={setMonth} />}
      {tab === 'period' && <PeriodCosts key={month} month={month} onMonth={setMonth} />}
      {tab === 'customers' && <CustomerMetrics />}
    </>
  );
}

/** ◀ 2026년 11월 ▶ (일별 매출·기간별 비용 공통) */
function MonthNav({ month, onChange }: { month: MonthKey; onChange: (m: MonthKey) => void }) {
  const thisMonth = monthOf(todayStr());
  const arrow = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg text-slate-800 ring-1 ring-slate-200 hover:bg-slate-100';
  return (
    <nav aria-label="월 선택" className="flex items-center justify-between gap-2 rounded-xl bg-white p-2 shadow-sm ring-1 ring-slate-200">
      <button type="button" className={arrow} aria-label={`이전 달 (${monthLabel(shiftMonth(month, -1))})`} onClick={() => onChange(shiftMonth(month, -1))}>
        ◀
      </button>
      <div className="flex min-w-0 flex-col items-center">
        <h2 className="text-lg font-semibold text-slate-900" aria-live="polite">
          {monthLabel(month)}
        </h2>
        {month !== thisMonth && (
          <button type="button" className="text-xs font-medium text-slate-600 underline" onClick={() => onChange(thisMonth)}>
            이번 달로
          </button>
        )}
      </div>
      <button type="button" className={arrow} aria-label={`다음 달 (${monthLabel(shiftMonth(month, 1))})`} onClick={() => onChange(shiftMonth(month, 1))}>
        ▶
      </button>
    </nav>
  );
}

// ───────────────────────── 일별 매출 ─────────────────────────

function DailySales({ month, onMonth }: { month: MonthKey; onMonth: (m: MonthKey) => void }) {
  const data = useData();
  const { update, confirm, navigate, route } = useApp();
  const range = monthRangeOf(month);
  const [channel, setChannel] = useState<Channel | 'all'>('all');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [editing, setEditing] = useState<SalesEntry | null>(null);
  const [quick, setQuick] = useState<QuickEntryProps | null>(route.params.quick === '1' ? { onClose: () => undefined } : null);
  const [statusDate, setStatusDate] = useState(todayStr());
  // 보여줄 날짜 수는 달마다 7일부터 시작
  const [shown, setShown] = useState({ month, n: 7 });
  const shownDays = shown.month === month ? shown.n : 7;
  const setShownDays = (f: number | ((n: number) => number)) => setShown((s) => ({ month, n: typeof f === 'function' ? f(s.month === month ? s.n : 7) : f }));

  if (!data.routes.length)
    return (
      <EmptyState
        title="주문 경로가 없습니다"
        description="매출은 날짜·판매 방식·주문 경로별로 기록합니다. 가게 설정에서 주문 경로를 먼저 추가하세요."
        action={<Button variant="primary" onClick={() => navigate('store')}>가게 설정으로</Button>}
      />
    );

  // 홈 '추정값 확정하기'에서 넘어온 경우: 그 기간·경로·비용 항목이 아직 추정값인 기록만 보여준다
  const pending = (() => {
    const p = route.params;
    if (!p.from || !p.to || !p.route || !p.channel || !p.cats || !isValidDate(p.from) || !isValidDate(p.to) || !CHANNELS.includes(p.channel as Channel)) return null;
    const categories = p.cats.split(',').filter((c): c is DirectCategory => (DIRECT_CATEGORIES as string[]).includes(c));
    if (!categories.length) return null;
    return { start: p.from, end: p.to, routeId: p.route, channel: p.channel as Channel, categories };
  })();
  const pendingList = pending ? pendingEntries(data, pending) : null;
  const rows = (pendingList ?? data.sales.filter((e) => e.date >= range.start && e.date <= range.end && (channel === 'all' || e.channel === channel)))
    .map((e) => ({ e, st: entryStatus(e, data), net: netSales(e) }))
    .filter((r) => pendingList || !onlyIssues || !isCostDone(r.st.status))
    .sort((a, b) => b.e.date.localeCompare(a.e.date) || a.e.channel.localeCompare(b.e.channel));
  const filtered = !!pendingList || channel !== 'all' || onlyIssues;
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) byDate.set(r.e.date, [...(byDate.get(r.e.date) ?? []), r]);
  const dates = Array.from(byDate.keys());
  const totals = rows.reduce((a, r) => ({ orders: a.orders + (r.e.orders ?? 0), net: a.net + (r.net ?? 0), cost: a.cost + r.st.knownCost }), { orders: 0, net: 0, cost: 0 });
  const routeName = (id: string) => data.routes.find((r) => r.id === id)?.name ?? '(삭제된 경로)';
  const payName = (id: string | null) => (id ? data.paymentMethods.find((p) => p.id === id)?.name ?? '—' : null);

  const afterSave = (saved: SalesEntry) => {
    // 확정 대기 목록에서 채우는 중이면 목록을 유지한다 (채운 기록은 목록에서 빠짐)
    if (pending) return;
    // 저장한 입력이 목록에서 바로 보이도록: 다른 달이면 그 달로 이동하고 필터를 푼다
    const m = monthOf(saved.date);
    if (m !== month) onMonth(m);
    if (channel !== 'all' && channel !== saved.channel) setChannel('all');
    if (onlyIssues) setOnlyIssues(false);
    const idx = Array.from(new Set([...data.sales.map((s) => s.date), saved.date].filter((d) => monthOf(d) === m)))
      .sort()
      .reverse()
      .indexOf(saved.date);
    if (idx >= (m === month ? shownDays : 7)) setShown({ month: m, n: idx + 1 });
  };
  const openQuick = (p: Partial<QuickEntryProps> = {}) => setQuick({ onClose: () => undefined, ...p });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" className="flex-1 py-3 text-base sm:flex-none" onClick={() => openQuick()}>
          ＋ 오늘 매출 기록
        </Button>
        <Button
          className="sm:flex-none"
          onClick={() => {
            const ch = (data.prefs.lastEntry?.channel ?? data.store?.channels[0] ?? 'hall') as Channel;
            const rid = data.prefs.lastEntry?.routeId ?? data.routes.find((r) => r.channels.includes(ch))?.id ?? '';
            setEditing(newSalesEntry({ channel: ch, routeId: rid, date: todayStr(), amountMode: 'net' }));
          }}
        >
          상세 입력 (결제수단·비용 포함)
        </Button>
      </div>

      <TodayStatus
        date={statusDate}
        onDateChange={setStatusDate}
        onEnter={(slot) => openQuick({ date: statusDate, channel: slot.channel, routeId: slot.routeId })}
        onEdit={(e) => setEditing(structuredClone(e))}
      />

      <Card title="매출 기록" subtitle="날짜별로 묶어 보여줍니다. 비용 상태를 눌러 비용을 확인·보완하세요.">
        {pending && (
          <Notice tone="warn" className="mb-3">
            <p className="font-medium">
              {pending.categories.some((c) => c === 'brokerage' || c === 'payment') ? '정산서 반영 대기' : '실제 금액 반영 대기'}: {pending.start.slice(5).replace('-', '/')}~{pending.end.slice(5).replace('-', '/')}{' '}
              {routeName(pending.routeId)}({CHANNEL_LABEL[pending.channel]}) {pending.categories.map((c) => DIRECT_LABEL[c]).join('·')}
            </p>
            <p className="mt-0.5 text-sm">
              {pendingList!.length
                ? `아직 추정값인 기록 ${pendingList!.length}건만 보여 줘요. 각 기록의 '비용 확인'을 눌러 정산서(영수증)에서 확인한 금액을 넣으면 목록에서 빠져요.`
                : '이 기간의 추정값을 모두 실제 금액으로 바꿨어요.'}
            </p>
            <Button size="sm" className="mt-2" onClick={() => navigate('sales', { tab: 'daily', month })}>
              전체 기록 보기
            </Button>
          </Notice>
        )}
        <MonthNav month={month} onChange={onMonth} />
        <div aria-label="월 합계" className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
          <div className="col-span-2 font-semibold text-slate-900 sm:col-span-4">
            {monthShort(month)} 합계{filtered && <span className="ml-1 text-xs font-normal text-slate-600">(아래 조건 적용)</span>}
          </div>
          <div>
            <div className="text-slate-600">순매출</div>
            <div className="font-semibold tabular">{fmt(totals.net, 'won')}</div>
          </div>
          <div>
            <div className="text-slate-600">주문 수</div>
            <div className="font-semibold tabular">{fmt(totals.orders, 'orders')}</div>
          </div>
          <div>
            <div className="text-slate-600">기록 · 날짜</div>
            <div className="font-semibold tabular">
              {rows.length.toLocaleString('ko-KR')}개 · {dates.length}일
            </div>
          </div>
          <div>
            <div className="text-slate-600">입력된 판매 방식 비용</div>
            <div className="font-semibold tabular">{fmt(totals.cost, 'won')}</div>
          </div>
        </div>
        <div className="my-3 flex flex-wrap items-end gap-3">
          <Field label="판매 방식">
            {(id) => (
              <Select id={id} value={channel} onChange={setChannel} options={[{ value: 'all', label: '전체' }, ...CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))]} />
            )}
          </Field>
          <Checkbox label="비용을 보완할 기록만" checked={onlyIssues} onChange={setOnlyIssues} />
        </div>
        {!rows.length ? (
          <EmptyState title={`${monthLabel(month)}에 이 조건의 매출 입력이 없습니다`} description="달·판매 방식을 바꾸거나 새로 기록하세요." />
        ) : (
          <>
            <div className="space-y-3">
              {dates.slice(0, shownDays).map((d) => {
                const list = byDate.get(d)!;
                const dayNet = list.reduce((s, r) => s + (r.net ?? 0), 0);
                return (
                  <section key={d} className="rounded-lg ring-1 ring-slate-200">
                    <header className="flex flex-wrap items-baseline justify-between gap-2 rounded-t-lg bg-slate-50 px-3 py-2">
                      <h3 className="font-semibold text-slate-900">
                        {d.replace(/-/g, '.')} ({WEEKDAY_LABELS[weekday(d)]})
                      </h3>
                      <span className="text-sm text-slate-700">
                        일 합계 <b className="tabular text-slate-900">{fmt(dayNet, 'won')}</b> · 기록 {list.length}개
                      </span>
                    </header>
                    <ul className="divide-y divide-slate-100">
                      {list.map(({ e, st, net }) => (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900">
                              {CHANNEL_LABEL[e.channel]} · {routeName(e.routeId)}
                              {payName(e.paymentMethodId) && <span className="ml-1 text-sm font-normal text-slate-600">({payName(e.paymentMethodId)})</span>}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
                              <span className="tabular">순매출 {fmt(net, 'won', '금액 필요')}</span>
                              <span className="tabular">{fmt(e.orders, 'orders')}</span>
                              {e.channel === 'hall' && e.visitors !== null && <span className="tabular">{fmt(e.visitors, 'people')}</span>}
                              {e.amountMode === 'net' && <span className="text-slate-600">{e.storeDiscount === null || e.refund === null ? '할인·환불 상세 없음' : '순매출 기준 입력'}</span>}
                              <EntryStatusBadge status={st.status} />
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => setEditing(structuredClone(e))}>
                              {isCostDone(st.status) ? '수정' : '비용 확인'}
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              aria-label={`${e.date} ${CHANNEL_LABEL[e.channel]} ${routeName(e.routeId)} 기록 삭제`}
                              onClick={async () => {
                                if (await confirm({ title: '매출 입력 삭제', message: `${e.date} ${CHANNEL_LABEL[e.channel]} · ${routeName(e.routeId)} 입력을 삭제할까요? 되돌릴 수 없습니다.`, confirmText: '삭제' }))
                                  update((dd) => ({ ...dd, sales: dd.sales.filter((x) => x.id !== e.id) }), '매출 입력을 삭제했습니다.');
                              }}
                            >
                              삭제
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
            {dates.length > shownDays && (
              <div className="mt-3 text-center">
                <Button onClick={() => setShownDays((n) => n + 7)}>
                  이전 날짜 더 보기 ({dates.length - shownDays}일 남음)
                </Button>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-600">월세·급여 같은 기간별 비용과 판매 방식 전용 광고비는 여기 합계에 포함되지 않습니다.</p>
          </>
        )}
      </Card>
      {quick && (
        <QuickEntry
          {...quick}
          onClose={() => setQuick(null)}
          onSaved={afterSave}
          onOpenDetail={(e) => {
            const fresh = data.sales.find((s) => s.id === e.id);
            setEditing(structuredClone(fresh ?? e));
          }}
        />
      )}
      {editing && <SalesEditor initial={editing} onClose={() => setEditing(null)} onSaved={afterSave} />}
    </div>
  );
}

export function SalesEditor({ initial, onClose, onSaved }: { initial: SalesEntry; onClose: () => void; onSaved?: (e: SalesEntry) => void }) {
  const data = useData();
  const { update } = useApp();
  const [base, setE] = useState<SalesEntry>(initial);
  // 매출 금액은 하나(순매출)로 보여준다. 기존 판매액 기준 기록도 고치지 않으면 원래 필드를 그대로 저장한다
  const initForm = useMemo(() => formFromEntry(initial), [initial]);
  const [form, setForm] = useState<AmountForm>(initForm);
  const [applied, setApplied] = useState<string | null>(null);
  const raw: SalesEntry = { ...base, ...amountFieldsFromForm(initial, initForm, form) };
  const [touched, setTouched] = useState(false);
  const [foodRate, setFoodRate] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: FocusField; n: number } | null>(null);
  const isNew = !data.sales.some((s) => s.id === raw.id);
  // 새 기록이거나 계산 근거(금액·상세·주문 수·날짜·경로·결제 정보)가 바뀐 기록은 설정으로 자동 계산한다.
  // 그대로 연 과거 기록은 저장 당시 계산값과 근거를 유지한다(설정이 바뀌어도 조용히 재계산하지 않음).
  const autoOn = isNew || estimateInputsKey(raw) !== estimateInputsKey(initial);
  const rawKey = JSON.stringify(raw);
  const recalc = useMemo(() => (autoOn ? recalcAuto(raw, data) : null), [autoOn, data, rawKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const e: SalesEntry = recalc ? recalc.entry : raw;
  const fee = feeCalcFor(e, data);
  const feeNeeds = new Set((fee?.items ?? []).filter((it) => it.status === 'needsInfo').map((it) => it.category));
  const firstNeed = fee?.items.find((it) => it.status === 'needsInfo' && it.need && it.need !== 'amount' && it.need !== 'orders');
  const askCard = !!fee && !fee.bundled && fee.rule.paymentRate !== null && !routeHasPlatform(data, raw.routeId) && payKindOf(data, raw.paymentMethodId) === 'unknown';
  const storeChannels = data.store?.channels.length ? CHANNELS.filter((c) => data.store!.channels.includes(c)) : CHANNELS;
  const routes = data.routes.filter((r) => r.channels.includes(e.channel));
  const hasPlatform = routeHasPlatform(data, e.routeId);
  const applicable = applicableCategories(e.channel, hasPlatform);
  const required = requiredCategories(e.channel, hasPlatform, e.bundledFee);
  const extraCats = DIRECT_CATEGORIES.filter((c) => !applicable.includes(c) && (e.costs[c].actual !== null || e.costs[c].estimated !== null));
  const cats = [...applicable, ...extraCats];
  const rule = fee?.rule ?? null;
  const menuAvg = isValidDate(e.date) ? averageMenuCostRate(data.menus, e.channel, e.date) : { rate: null, count: 0 };
  const v: ValidationResult = validateSalesEntry(e, data);
  const showErr = (k: string) => (touched ? v.errors[k] : undefined);
  const foodBase = foodEstimateBase(e);
  const st = entryStatus(e, data);

  const set = <K extends keyof SalesEntry>(k: K, val: SalesEntry[K]) => setE((x) => ({ ...x, [k]: val }));
  const setCost = (cat: DirectCategory, patch: Partial<SalesEntry['costs'][DirectCategory]>) =>
    setE((x) => ({ ...x, costs: { ...x.costs, [cat]: { ...x.costs[cat], ...patch } } }));

  const applyFood = (rate: number, label: string, source: 'entry' | 'temp' | 'menuAverage', menuCount?: number) => {
    const f = foodRateEstimate(e, rate, source, { label, menuCount });
    if (f) setCost('food', withEstimate(e.costs.food, f.amount, f.basis, f.calc));
  };

  const save = () => {
    setTouched(true);
    if (hasErrors(v)) return;
    // 자동 계산값은 화면에 보이는 그대로(현재 입력값 기준) 저장한다. 실제 금액(정산 확인액)은 그대로
    const clean: SalesEntry = { ...e, visitors: e.channel === 'hall' ? e.visitors : null };
    const note =
      !isNew && recalc
        ? [recalc.updated.length ? `자동 계산 갱신: ${recalc.updated.join('·')}` : '', recalc.removed.length ? `근거가 없어 지운 계산값: ${recalc.removed.join('·')}` : ''].filter(Boolean).join(' · ')
        : '';
    const ok = update(
      (d) => ({
        ...d,
        sales: isNew ? [...d.sales, clean] : d.sales.map((s) => (s.id === clean.id ? clean : s)),
        salesChecks: d.salesChecks.filter((c) => !(c.date === clean.date && c.channel === clean.channel && c.routeId === clean.routeId)),
      }),
      { text: isNew ? '매출을 저장했습니다' : '매출 기록을 수정했습니다', detail: note || undefined },
    );
    if (!ok) return; // 저장 실패: 입력 내용 유지
    onSaved?.(clean);
    onClose();
  };

  return (
    <Modal
      wide
      title={isNew ? '매출 상세 입력' : '매출 상세·비용 확인'}
      onClose={onClose}
      footer={
        <>
          {touched && hasErrors(v) && (
            <span className="mr-auto w-full text-sm text-red-700 sm:w-auto" role="alert">
              ⛔ 입력 오류를 확인하세요.
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="날짜" required error={showErr('date')} warning={v.warnings.date ?? v.warnings.duplicate}>
            {(id) => <DateInput id={id} value={e.date} onChange={(x) => set('date', x)} invalid={!!showErr('date')} />}
          </Field>
          <Field label="판매 방식" required>
            {(id) => (
              <Select
                id={id}
                value={e.channel}
                onChange={(ch) => setE((x) => ({ ...x, channel: ch, routeId: data.routes.find((r) => r.channels.includes(ch))?.id ?? '', visitors: ch === 'hall' ? x.visitors : null }))}
                options={storeChannels.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
              />
            )}
          </Field>
          <Field label="주문 경로" required error={showErr('routeId')} hint={!routes.length ? '이 판매 방식에 연결된 주문 경로가 없습니다. 가게 설정에서 추가하세요.' : undefined}>
            {(id) => (
              <Select
                id={id}
                value={e.routeId}
                onChange={(x) => set('routeId', x)}
                options={[{ value: '', label: '선택' }, ...routes.map((r) => ({ value: r.id, label: r.name + (r.platformId ? ` (${data.platforms.find((p) => p.id === r.platformId)?.name ?? '플랫폼'})` : '') }))]}
                invalid={!!showErr('routeId')}
              />
            )}
          </Field>
          <Field label="결제수단" hint="주문 경로와 별개입니다.">
            {(id) => (
              <Select
                id={id}
                value={e.paymentMethodId ?? ''}
                onChange={(x) => set('paymentMethodId', x || null)}
                options={[{ value: '', label: '혼합·미지정' }, ...data.paymentMethods.map((p) => ({ value: p.id, label: p.name }))]}
              />
            )}
          </Field>
        </div>

        <section>
          <h3 className="mb-2 text-base font-semibold">① 매출</h3>
          <div className="mb-3 max-w-xl">
            <SalesAmountInput
              form={form}
              onChange={(f) => {
                setForm(f);
                if (f.net !== form.net) setApplied(null);
              }}
              label="매출 금액"
              error={showErr('netInput') ?? showErr('gross')}
              warning={v.warnings.netInput ?? v.warnings.gross}
              initial={isNew ? undefined : initForm}
              onApplied={setApplied}
              focusRequest={focusRequest}
              extra={
                askCard ? (
                  <div className="border-t border-slate-200 pt-3">
                    <Field
                      label="카드 결제액 (결제 수수료 계산용)"
                      hint="결제수단이 섞였거나 미지정이면 카드 결제분에만 결제 수수료를 계산해요. 모르면 비워 두세요."
                      warning={raw.cardSales !== null && form.net !== null && raw.cardSales > form.net ? '카드 결제액이 매출 금액보다 커요. 금액을 확인하세요.' : undefined}
                    >
                      {(id) => (
                        <div data-field="card" className="max-w-xs">
                          <NumberInput id={id} value={raw.cardSales} onChange={(x) => set('cardSales', x)} suffix="원" />
                        </div>
                      )}
                    </Field>
                  </div>
                ) : undefined
              }
            />
            {applied && (
              <p className="mt-1 text-sm text-emerald-800" role="status">
                ✓ {applied}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Field label="완료 주문 수" required error={showErr('orders')} hint={e.channel === 'hall' ? '영수증(테이블) 건수' : '전액 취소 제외'}>
              {(id) => <NumberInput id={id} value={e.orders} onChange={(x) => set('orders', x)} suffix="건" invalid={!!showErr('orders')} />}
            </Field>
            {e.channel === 'hall' && (
              <Field label="홀 방문 고객 수" error={showErr('visitors')} warning={v.warnings.visitors}>
                {(id) => <NumberInput id={id} value={e.visitors} onChange={(x) => set('visitors', x)} suffix="명" invalid={!!showErr('visitors')} />}
              </Field>
            )}
          </div>
          {(showErr('storeDiscount') || showErr('refund')) && <p className="mt-1 text-sm text-red-700">⛔ {showErr('storeDiscount') ?? showErr('refund')}</p>}
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">② 비용 확인</h3>
            <EntryStatusBadge status={st.status} />
          </div>
          <p className="mb-2 text-sm text-slate-700">가게 설정의 수수료율·주문 1건당 금액·원가율은 자동으로 채워져요. 정산서·영수증 금액을 넣으면 그 금액만 합계에 반영해요(두 값을 더하지 않음).</p>
          <More summary="비용 입력 기준 자세히" className="mb-3">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>추정: 계산에 필요한 값 중 모르는 값을 가정한 금액입니다. 예: 메뉴별 판매 비중을 몰라 메뉴 원가율의 단순 평균을 쓴 식재료비, 임시 원가율 {TEMP_FOOD_RATE}%. 무엇을 가정했는지 함께 보여줍니다.</li>
              <li>추정 · 근거 불분명: 이전에 저장된 값 중 어떻게 구했는지 기록이 없는 값입니다.</li>
              <li>가게 부담 순배달비 = 가게가 지급한 배달비 − 가게에 귀속되는 고객 부담 배달비 (고객 부담 배달비를 매출에 다시 더하지 않습니다)</li>
              <li>묶음 수수료는 중개 수수료 칸에 합친 금액을 넣고, 결제 수수료는 따로 넣지 않습니다.</li>
              <li>월세·급여처럼 기간에 걸친 비용은 ‘월세·급여 등 기간별 비용’ 탭에서 입력합니다.</li>
            </ul>
          </More>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
            {!autoOn && <span>저장 당시 계산한 금액을 그대로 보여줘요. 금액·주문 수 등을 고치면 지금 설정으로 다시 계산해요.</span>}
            {!rule && (hasPlatform || e.bundledFee) && (
              <Checkbox
                checked={e.bundledFee}
                onChange={(b) => setE((x) => ({ ...x, bundledFee: b, costs: b ? { ...x.costs, payment: emptyCost() } : x.costs }))}
                label="묶음 수수료"
              />
            )}
          </div>
          {firstNeed && (
            <Notice tone="warn" className="mb-3">
              <p>
                이 경로의 {firstNeed.label} 계산에는 {josa(FEE_NEED_TEXT[firstNeed.need!], '이/가')} 필요해요.
              </p>
              <Button size="sm" className="mt-1" onClick={() => setFocusRequest({ field: firstNeed.need === 'cardSales' ? 'card' : firstNeed.need === 'refund' ? 'refund' : 'discount', n: (focusRequest?.n ?? 0) + 1 })}>
                필요한 내역 입력
              </Button>
            </Notice>
          )}
          {!isNew && recalc && (recalc.updated.length > 0 || recalc.removed.length > 0) && (
            <p className="mb-3 text-sm text-slate-700" role="status">
              입력값이 바뀌어 자동 계산액을 현재 기준으로 다시 계산했어요{recalc.updated.length ? `: ${recalc.updated.join('·')}` : ''}
              {recalc.removed.length ? ` · 근거가 없어 지움: ${recalc.removed.join('·')}` : ''}. 정산 확인액은 그대로예요.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {cats.map((cat) => {
              const cv = e.costs[cat];
              const disabled = cat === 'payment' && e.bundledFee;
              const isReq = required.includes(cat);
              const covered = cv.actual === null && cv.estimated === null && isValidDate(e.date) && coveredByPeriodCost(data.periodCosts, cat, e.channel, e.date);
              const isFee = cat === 'brokerage' || cat === 'payment';
              const src = costSourceOf(cat, cv, feeNeeds.has(cat as 'brokerage' | 'payment'), e);
              const missing = cv.actual === null && cv.estimated === null;
              const label = cat === 'brokerage' && e.bundledFee ? '묶음 수수료' : DIRECT_LABEL[cat];
              const err = touched ? v.errors[`cost.${cat}`] : undefined;
              const warn = v.warnings[`cost.${cat}`];
              // 계산·추정 금액의 근거: 실제 금액이 있어도 저장된 계산값의 근거를 그대로 보여준다(금액은 실제 금액만 씀)
              const estInfo = cv.estimated !== null ? costBasisOf(cat, { ...cv, actual: null }, e) : null;
              const flag = estInfo && cv.actual === null ? costFlag(estInfo) : null;
              // 입력이 더 필요해 계산하지 못한 항목: 무엇을 넣어야 하는지 그대로 알려준다
              const feeNeed = missing ? fee?.items.find((it) => it.category === cat && it.status === 'needsInfo')?.need : undefined;
              const perOrderNeedsOrders =
                missing && e.orders === null && (PER_ORDER_CATEGORIES as string[]).includes(cat) && isValidDate(e.date) && !!perOrderCostFor(data.perOrderCosts, e.channel, e.routeId, cat as PerOrderCategory, e.date);
              const prompt = feeNeed ? NEED_PROMPT[feeNeed] : perOrderNeedsOrders ? NEED_PROMPT.orders : null;
              // 정상 계산·실제 금액은 배지 없이 금액만. 사용자가 알아야 하는 상태만 표시한다
              const badge: { text: string; tone: BadgeTone } | null = disabled
                ? { text: '묶음에 포함', tone: 'gray' }
                : missing && covered
                  ? { text: '기간별 비용', tone: 'gray' }
                  : flag
                    ? { text: flag, tone: 'amber' }
                    : prompt
                      ? { text: '입력 필요', tone: 'amber' }
                      : missing
                        ? { text: COST_SOURCE_LABEL[src], tone: isReq ? 'red' : 'gray' }
                        : null;
              // 자동 계산값(수수료·건당 기준·원가율)은 입력값에 따라 다시 계산되므로 지우기 대신 정산 금액을 넣는다
              const autoValue = src === 'feeCalc' || src === 'perOrderCalc' || src === 'rateCalc' || src === 'reference' || src === 'notApplicable';
              return (
                <div key={cat} data-cost-card={cat} className={`rounded-lg p-3 ring-1 ${missing && !covered && isReq ? 'ring-red-200' : 'ring-slate-200'}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">
                      {label}
                      {isReq && !disabled && <span className="ml-1 text-xs font-normal text-slate-600">(필수)</span>}
                    </span>
                    {badge && (
                      <Badge tone={badge.tone} title={flag ? estInfo?.assumption ?? undefined : undefined}>
                        {badge.text}
                      </Badge>
                    )}
                  </div>
                  <Field label={isFee ? '정산서 확인 금액' : '실제 금액'} error={err} warning={warn}>
                    {(id) => <NumberInput id={id} value={cv.actual} onChange={(x) => setCost(cat, { actual: x })} suffix="원" disabled={disabled} placeholder={disabled ? '묶음에 포함' : '모르면 비워 두기'} />}
                  </Field>
                  {cv.estimated !== null && estInfo && (
                    <div className={`mt-2 rounded px-2 py-1.5 text-sm ${flag ? 'bg-amber-50' : 'bg-slate-50'}`} data-cost-basis={estInfo.kind}>
                      <div className="flex items-start justify-between gap-2">
                        <span className={`tabular font-medium ${cv.actual !== null ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{fmt(cv.estimated, 'won')}</span>
                        {!(autoOn && autoValue) && (
                          <button className="text-sm text-slate-600 underline" onClick={() => setCost(cat, withEstimate(cv, null, ''))}>
                            지우기
                          </button>
                        )}
                      </div>
                      <div className="text-xs text-slate-700">{costDetailText(cv) || estInfo.basis}</div>
                      {estInfo.assumption && <div className="text-xs font-medium text-amber-900">가정: {estInfo.assumption}</div>}
                      {cv.actual !== null && <div className="text-xs text-slate-700">{isFee ? '정산 금액' : '실제 금액'}만 합계에 반영돼요.</div>}
                    </div>
                  )}
                  {prompt && <p className="mt-1 text-sm font-medium text-amber-900">{prompt}</p>}
                  {missing && covered && <p className="mt-1 text-xs text-slate-700">기간별 비용으로 등록되어 있어 비워 둬도 됩니다.</p>}
                  {cat === 'food' && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {menuAvg.rate !== null && (
                        <Button size="sm" variant="ghost" disabled={foodBase.amount === null} onClick={() => applyFood(menuAvg.rate!, `메뉴 ${menuAvg.count}개 단순 평균 원가율 ${menuAvg.rate!.toFixed(1)}% (판매량 미반영 추정)`, 'menuAverage', menuAvg.count)}>
                          메뉴 평균 {menuAvg.rate.toFixed(1)}%로 추정
                        </Button>
                      )}
                      <span className="w-24">
                        <NumberInput value={foodRate} onChange={setFoodRate} suffix="%" allowDecimal placeholder="원가율" ariaLabel="직접 지정 원가율" />
                      </span>
                      <Button size="sm" variant="ghost" disabled={foodRate === null || foodBase.amount === null} onClick={() => foodRate !== null && applyFood(foodRate, `직접 지정 원가율 ${foodRate}%`, 'entry')}>
                        적용
                      </Button>
                      <Button size="sm" variant="ghost" disabled={foodBase.amount === null} onClick={() => applyFood(TEMP_FOOD_RATE, `임시 추정 원가율 ${TEMP_FOOD_RATE}% (검증되지 않은 임시값)`, 'temp')} title="업종 평균이나 검증된 값이 아닌 임시 추정값">
                        임시 {TEMP_FOOD_RATE}%
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {v.warnings.costs && <p className="mt-2 text-sm text-amber-800">⚠ {v.warnings.costs}</p>}
        </section>

        <Field label="메모">{(id) => <TextInput id={id} value={e.memo} onChange={(x) => set('memo', x)} placeholder="예: 우천, 단체 예약" />}</Field>
      </div>
    </Modal>
  );
}

// ───────────────────────── 기간 비용 ─────────────────────────

const CATEGORY_OPTIONS: { value: CostCategory; label: string; group: string }[] = [
  ...COMMON_CATEGORIES.map((c) => ({ value: c as CostCategory, label: COMMON_LABEL[c], group: '공통 운영비 항목' })),
  ...DIRECT_CATEGORIES.map((c) => ({ value: c as CostCategory, label: DIRECT_LABEL[c], group: '판매 방식 비용 항목 (기간 단위로 입력할 때)' })),
];

function monthRange(d: string): DateRange {
  const dt = new Date(parseDate(d));
  const start = formatDateStr(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
  const end = formatDateStr(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
  return { start, end };
}

function PeriodCosts({ month, onMonth }: { month: MonthKey; onMonth: (m: MonthKey) => void }) {
  const data = useData();
  const { update, confirm } = useApp();
  const [editing, setEditing] = useState<PeriodCost | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const mc = useMemo(() => monthCosts(data.periodCosts, month), [data.periodCosts, month]);
  const prevMonth = shiftMonth(month, -1);
  const prevCount = useMemo(() => monthCosts(data.periodCosts, prevMonth).rows.length, [data.periodCosts, prevMonth]);
  const range = monthRangeOf(month);
  const diff = mc.prevTotal === null ? null : mc.total - mc.prevTotal;
  const baseId = useId();

  const copyPrev = () => {
    const items = copyFromPrevMonth(data.periodCosts, month, () => uid('pc'));
    if (!items.length) return;
    update((d) => ({ ...d, periodCosts: [...d.periodCosts, ...items] }), `지난달 비용 ${items.length}개를 ${monthShort(month)} 비용으로 가져왔어요. '추정'으로 표시했으니 금액을 확인해 주세요.`);
  };
  const markActual = (p: PeriodCost) => update((d) => ({ ...d, periodCosts: d.periodCosts.map((x) => (x.id === p.id ? { ...x, source: 'actual' } : x)) }), `${CATEGORY_LABEL[p.category]} 금액을 실제 금액으로 표시했습니다.`);
  const remove = async (p: PeriodCost) => {
    if (await confirm({ title: '기간별 비용 삭제', message: `${CATEGORY_LABEL[p.category]} (${p.start}~${p.end}, ${fmt(p.amount, 'won')})을 삭제할까요?`, confirmText: '삭제' }))
      update((d) => ({ ...d, periodCosts: d.periodCosts.filter((x) => x.id !== p.id) }), '기간별 비용을 삭제했습니다.');
  };

  return (
    <div className="space-y-4">
      <MonthNav month={month} onChange={onMonth} />
      <section aria-label="월 비용 합계" className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-base text-slate-900">
            <b>
              {monthShort(month)} 합계 {wonShort(mc.total)}
            </b>
            <span className="text-slate-700">
              {' · '}
              <span className="whitespace-nowrap">{diff === null ? '지난달 비용 기록 없음' : Math.round(diff) === 0 ? '지난달과 같음' : `지난달보다 ${wonShort(diff, true)}`}</span>
            </span>
          </p>
          <Button
            variant="primary"
            onClick={() => setEditing({ id: uid('pc'), category: 'labor', attribution: 'common', nature: 'fixed', start: range.start, end: range.end, amount: NaN, source: 'actual', memo: '' })}
          >
            기간별 비용 추가
          </Button>
        </div>
        <p className="mt-1 text-sm text-slate-600">여러 달에 걸친 비용은 그 달 날짜 수만큼 나눈 금액으로 보여요. 줄을 누르면 자세한 내용과 수정·삭제가 나옵니다.</p>
      </section>

      {!mc.rows.length ? (
        <section aria-label="비용 없는 달" className="rounded-xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200">
          <p className="font-semibold text-slate-900">{monthLabel(month)}에 등록된 기간별 비용이 없어요</p>
          {prevCount > 0 ? (
            <>
              <p className="mt-1 text-sm text-slate-700">
                지난달({monthShort(prevMonth)}) 항목 {prevCount}개를 이 달 기간으로 복사하고 '추정'으로 표시해요. 금액을 확인하면 '실제'로 바꿀 수 있어요.
              </p>
              <Button variant="primary" className="mt-3" onClick={copyPrev}>
                지난달 비용 그대로 가져오기
              </Button>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-700">인건비·월세 등 공통 운영비를 입력해야 영업이익을 확정할 수 있어요.</p>
          )}
        </section>
      ) : (
        <section aria-label="월 비용 목록" className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="hidden grid-cols-[minmax(0,1fr)_9rem_13rem_5rem] gap-3 border-b border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 sm:grid" aria-hidden>
            <span>항목</span>
            <span className="text-right">{monthShort(month)} 금액</span>
            <span className="text-right">지난달 대비</span>
            <span className="text-right">구분</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {mc.rows.map((r) => {
              const changed = rowChanged(r);
              const isOpen = open === r.key;
              const panelId = `${baseId}-${r.key}`;
              return (
                <li key={r.key} data-cost-row={r.key} className={changed ? 'bg-amber-50' : ''}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpen(isOpen ? null : r.key)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_9rem_13rem_5rem]"
                  >
                    <span className="min-w-0">
                      <span className="flex items-start gap-1.5 font-medium text-slate-900">
                        <span aria-hidden className="text-slate-500">
                          {isOpen ? '▾' : '▸'}
                        </span>
                        <span className="min-w-0 break-keep">{r.label}</span>
                      </span>
                      {r.spansMonths && <span className="ml-5 text-xs text-slate-600">여러 달에 걸친 비용</span>}
                    </span>
                    <span className="text-right font-semibold tabular text-slate-900">{fmt(r.amount, 'won')}</span>
                    <span className={`col-start-1 pl-5 text-sm sm:col-start-auto sm:pl-0 sm:text-right ${changed ? 'font-semibold text-amber-900' : 'text-slate-600'}`}>
                      {r.prevAmount === null ? '새 항목' : changed ? `${r.amount > r.prevAmount ? '▲' : '▼'} ${wonShort(r.amount - r.prevAmount, true)} (지난달 ${wonShort(r.prevAmount)})` : '변화 없음'}
                    </span>
                    <span className="text-right">
                      <SourceBadge status={r.estimated ? 'estimated' : 'actual'} />
                    </span>
                  </button>
                  {isOpen && (
                    <div id={panelId} className="space-y-2 px-4 pb-3">
                      {r.records.map(({ cost: p, amount, overlapDays: ov, totalDays }) => (
                        <div key={p.id} className="rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200">
                          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                            <dt className="text-slate-600">어디에 쓰인 비용</dt>
                            <dd>{p.attribution === 'common' ? '공통 (여러 판매 방식이 함께 씀)' : `${ATTRIBUTION_LABEL[p.attribution]} 전용`}</dd>
                            <dt className="text-slate-600">성격</dt>
                            <dd>{NATURE_LABEL[p.nature]}</dd>
                            <dt className="text-slate-600">비용 기간</dt>
                            <dd className="tabular">
                              {p.start} ~ {p.end} ({totalDays}일) · {fmt(p.amount, 'won')}
                            </dd>
                            <dt className="text-slate-600">이 달 반영</dt>
                            <dd className="tabular">
                              {fmt(amount, 'won')} ({ov}/{totalDays}일만큼 반영)
                            </dd>
                            <dt className="text-slate-600">구분</dt>
                            <dd>
                              <SourceBadge status={p.source} />
                            </dd>
                            {p.memo && (
                              <>
                                <dt className="text-slate-600">메모</dt>
                                <dd className="break-words">{p.memo}</dd>
                              </>
                            )}
                          </dl>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Button size="sm" onClick={() => setEditing({ ...p })}>
                              수정
                            </Button>
                            {p.source === 'estimated' && (
                              <Button size="sm" onClick={() => markActual(p)}>
                                금액 확인 · 실제로 표시
                              </Button>
                            )}
                            <Button size="sm" variant="danger" onClick={() => remove(p)}>
                              삭제
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {mc.goneRows.length > 0 && (
            <p className="border-t border-slate-200 px-4 py-2 text-sm text-slate-700">
              지난달에만 있던 항목: {mc.goneRows.map((g) => `${g.label} ${wonShort(g.prevAmount)}`).join(', ')}
            </p>
          )}
        </section>
      )}

      <More summary="기간별 비용 입력 안내">
        <p className="text-sm text-slate-700">
          월세·급여처럼 여러 날에 걸친 비용은 해당 기간과 함께 입력합니다. 조회하는 기간에는 <b>날짜 수만큼 나눈 금액</b>을 반영합니다. 한 판매 방식에만 쓰인 비용은 그 방식의 비용으로, 여러 방식이 함께 쓰면 공통
          운영비로 한 번만 계산됩니다. 일별 입력에 이미 넣은 비용은 여기 다시 넣지 마세요. <b>대출 이자와 원금 상환은 영업이익 계산에 넣지 않으므로 입력하지 않습니다.</b>
        </p>
      </More>
      {editing && (
        <PeriodCostEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            // 저장한 비용이 지금 보는 달에 없으면 그 비용이 시작하는 달로 이동
            if (!(saved.start <= range.end && saved.end >= range.start)) onMonth(monthOf(saved.start));
          }}
        />
      )}
    </div>
  );
}

function PeriodCostEditor({ initial, onClose, onSaved }: { initial: PeriodCost; onClose: () => void; onSaved?: (p: PeriodCost) => void }) {
  const data = useData();
  const { update } = useApp();
  const [p, setP] = useState<PeriodCost>(initial);
  const [touched, setTouched] = useState(false);
  const isNew = !data.periodCosts.some((x) => x.id === p.id);
  const v = validatePeriodCost(p, data);
  const err = (k: string) => (touched ? v.errors[k] : undefined);
  const days = isValidDate(p.start) && isValidDate(p.end) && p.start <= p.end ? daysInclusive(p.start, p.end) : null;

  const save = () => {
    setTouched(true);
    if (hasErrors(v)) return;
    update((d) => ({ ...d, periodCosts: isNew ? [...d.periodCosts, p] : d.periodCosts.map((x) => (x.id === p.id ? p : x)) }), isNew ? '기간별 비용을 저장했습니다.' : '기간별 비용을 수정했습니다.');
    onSaved?.(p);
    onClose();
  };

  return (
    <Modal
      title={isNew ? '기간별 비용 추가' : '기간별 비용 수정'}
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
        <Field label="항목" warning={v.warnings.category}>
          {(id) => <Select id={id} value={p.category} onChange={(c) => setP({ ...p, category: c })} options={CATEGORY_OPTIONS} />}
        </Field>
        <Field label="어느 판매 방식에 쓰인 비용인가요?" warning={v.warnings.attribution} hint="한 방식 전용이면 그 방식, 여러 방식이 함께 쓰면 공통">
          {(id) => (
            <Select
              id={id}
              value={p.attribution}
              onChange={(a: Attribution) => setP({ ...p, attribution: a })}
              options={[{ value: 'common' as Attribution, label: '공통' }, ...CHANNELS.map((c) => ({ value: c as Attribution, label: `${CHANNEL_LABEL[c]} 전용 비용` }))]}
            />
          )}
        </Field>
        <Field label="성격">
          {(id) => (
            <Select
              id={id}
              value={p.nature}
              onChange={(n) => setP({ ...p, nature: n })}
              options={[
                { value: 'fixed', label: '고정비' },
                { value: 'variable', label: '변동비' },
                { value: 'mixed', label: '혼합비' },
              ]}
            />
          )}
        </Field>
        <Field label="구분">
          {(id) => (
            <Select
              id={id}
              value={p.source}
              onChange={(s) => setP({ ...p, source: s })}
              options={[
                { value: 'actual', label: '실제 금액' },
                { value: 'estimated', label: '추정 금액 (청구 전 등)' },
              ]}
            />
          )}
        </Field>
        <Field label="비용 기간 시작일" error={err('start')}>
          {(id) => <DateInput id={id} value={p.start} onChange={(x) => setP({ ...p, start: x })} />}
        </Field>
        <Field label="비용 기간 종료일" error={err('end')} hint={days ? `${days}일 · 일평균 ${Number.isFinite(p.amount) ? fmt(p.amount / days, 'won') : '—'}` : undefined}>
          {(id) => <DateInput id={id} value={p.end} onChange={(x) => setP({ ...p, end: x })} />}
        </Field>
        <Field label="금액" error={err('amount')}>
          {(id) => <NumberInput id={id} value={Number.isFinite(p.amount) ? p.amount : null} onChange={(x) => setP({ ...p, amount: x ?? NaN })} suffix="원" />}
        </Field>
        <div className="flex items-end gap-1">
          <Button size="sm" onClick={() => setP({ ...p, ...monthRange(isValidDate(p.start) ? p.start : todayStr()) })}>
            시작일이 속한 달 전체
          </Button>
        </div>
        <Field label="메모" className="sm:col-span-2">
          {(id) => <TextArea id={id} value={p.memo} onChange={(x) => setP({ ...p, memo: x })} />}
        </Field>
      </div>
    </Modal>
  );
}

// ───────────────────────── 고객 집계 ─────────────────────────

function CustomerMetrics() {
  const data = useData();
  const { update, confirm } = useApp();
  const [editing, setEditing] = useState<CustomerMetric | null>(null);
  const availability = data.prefs.customerData;
  const setAvailability = (v: AppData['prefs']['customerData']) => update((d) => ({ ...d, prefs: { ...d.prefs, customerData: v } }));

  if (availability === 'unasked')
    return (
      <Card title="고객 지표는 선택 기능이에요">
        <p className="text-base text-slate-800">신규·기존 고객 수와 재구매 고객 수를 배달앱 통계나 POS에서 확인할 수 있나요?</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" className="py-3" onClick={() => setAvailability('available')}>
            네, 확인할 수 있어요
          </Button>
          <Button className="py-3" onClick={() => setAvailability('unavailable')}>
            지금은 확인하기 어려워요
          </Button>
        </div>
        <p className="mt-3 text-sm text-slate-700">확인하기 어려워도 매출 기록·문제 확인·실행 계획·성과 확인은 모두 그대로 쓸 수 있습니다. 개인정보는 입력받지 않습니다.</p>
      </Card>
    );

  if (availability === 'unavailable') return <CustomerFallback onChange={() => setAvailability('available')} />;

  return (
    <div className="space-y-4">
      <Notice>
        플랫폼 통계·POS에서 확인한 <b>기간별 집계값</b>만 옮겨 적습니다. 개인정보는 입력하지 마세요. 고객 지표 매출은 매출 합계에 더하지 않습니다.
      </Notice>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={() => setAvailability('unavailable')}>
          고객 데이터 없이 보기
        </Button>
        <Button variant="primary" onClick={() => setEditing(newCustomerMetric())}>
          고객 지표 추가
        </Button>
      </div>
      {!data.customerMetrics.length ? (
        <EmptyState title="고객 지표가 없습니다" description="입력하지 않아도 다른 기능은 모두 사용할 수 있습니다." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.customerMetrics.map((m) => {
            const r = repurchaseRate(m);
            return (
              <Card
                key={m.id}
                title={m.label || '(이름 없음)'}
                subtitle={`${m.channel === 'all' ? '전체' : CHANNEL_LABEL[m.channel]} · ${m.periodStart} ~ ${m.periodEnd}${m.source ? ` · 출처: ${m.source}` : ''}`}
                actions={
                  <>
                    <Button size="sm" onClick={() => setEditing({ ...m })}>
                      수정
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (await confirm({ title: '고객 지표 삭제', message: `${josa(`"${m.label || '이름 없음'}"`, '을/를')} 삭제할까요?`, confirmText: '삭제' }))
                          update((d) => ({ ...d, customerMetrics: d.customerMetrics.filter((x) => x.id !== m.id) }), '삭제했습니다.');
                      }}
                    >
                      삭제
                    </Button>
                  </>
                }
              >
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-slate-600">신규 구매 고객</dt>
                    <dd className="font-medium tabular">{fmt(m.newCustomers, 'people', '미입력')}</dd>
                    <dd className="text-slate-700">{fmt(m.newOrders, 'orders', '주문 미입력')}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-600">구매한 기존 고객</dt>
                    <dd className="font-medium tabular">{fmt(m.existingCustomers, 'people', '미입력')}</dd>
                    <dd className="text-slate-700">{fmt(m.existingOrders, 'orders', '주문 미입력')}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-600">30일 재구매율 (이 앱 정의)</dt>
                    <dd className="font-medium">
                      {r.rate.value !== null ? `${r.rate.value.toFixed(1)}%` : r.rate.reason === 'divZero' ? '계산 불가' : r.errors.length ? '입력 오류' : '데이터 없음'}
                    </dd>
                    {r.rate.value !== null && (
                      <dd className="text-slate-700">
                        {m.repurchased30}명 / {m.observedCustomers}명 {!r.observationComplete && <Badge tone="amber">관찰 미완료 · 잠정</Badge>}
                      </dd>
                    )}
                  </div>
                  <div>
                    <dt className="text-slate-600">플랫폼 재주문율 (플랫폼 정의)</dt>
                    <dd className="font-medium">{m.platformRepeatRate === null ? '데이터 없음' : `${m.platformRepeatRate}%`}</dd>
                    {m.platformRepeatDefinition && <dd className="text-xs text-slate-700">{m.platformRepeatDefinition}</dd>}
                  </div>
                </dl>
                {r.rate.value !== null && m.platformRepeatRate !== null && (
                  <p className="mt-2 text-sm text-amber-800">⚠ 두 비율은 정의가 달라 서로 비교하거나 차이를 계산하지 않습니다.</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {editing && <CustomerEditor initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** 고객 데이터를 확인하기 어려울 때: 주문 수와 평균 주문금액으로 볼 수 있는 것 */
function CustomerFallback({ onChange }: { onChange: () => void }) {
  const data = useData();
  const r = recentRanges(data);
  const s = useMemo(() => computeSummary(data, r.cur), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = useMemo(() => computeSummary(data, r.prev), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const chans = (data.store?.channels ?? CHANNELS).filter((c) => s.channels[c].entryCount || p.channels[c].entryCount);
  return (
    <div className="space-y-4">
      <Card title="고객 데이터 없이 볼 수 있는 것" subtitle={`최근 4주 ${formatRange(r.cur)}와 그 전 4주 비교`}>
        <p className="mb-3 text-sm text-slate-800">재주문율은 데이터가 없어 표시하지 않습니다(0%가 아님). 대신 주문 수와 평균 주문금액 변화로 손님 흐름을 가늠해 보세요.</p>
        {!chans.length ? (
          <p className="text-sm text-slate-600">매출 기록이 쌓이면 여기에 표시됩니다.</p>
        ) : (
          <ul className="space-y-2">
            {chans.map((c) => {
              const q = c === 'hall' ? '방문 고객 수' : '주문 수';
              const unit = c === 'hall' ? 'people' : 'orders';
              const q0 = c === 'hall' ? p.channels[c].visitors : p.channels[c].orders;
              const q1 = c === 'hall' ? s.channels[c].visitors : s.channels[c].orders;
              return (
                <li key={c} className="rounded-lg p-3 ring-1 ring-slate-200">
                  <div className="font-medium">{CHANNEL_LABEL[c]}</div>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-slate-600">{q}</div>
                      <div className="tabular">
                        {fmt(q0, unit, '데이터 필요')} → <b>{fmt(q1, unit, '데이터 필요')}</b>
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-600">{c === 'hall' ? '객단가' : '평균 주문금액'}</div>
                      <div className="tabular">
                        <CalcValue calc={p.channels[c].avgTicket} unit="won" showProvisional={false} /> → <CalcValue calc={s.channels[c].avgTicket} unit="won" showProvisional={false} />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Button onClick={onChange}>고객 데이터를 확인할 수 있게 됐어요</Button>
    </div>
  );
}

function CustomerEditor({ initial, onClose }: { initial: CustomerMetric; onClose: () => void }) {
  const data = useData();
  const { update } = useApp();
  const [m, setM] = useState<CustomerMetric>(initial);
  const [touched, setTouched] = useState(false);
  const isNew = !data.customerMetrics.some((x) => x.id === m.id);
  const r = repurchaseRate(m);
  const errs: string[] = [...r.errors];
  if (!isValidDate(m.periodStart) || !isValidDate(m.periodEnd) || m.periodStart > m.periodEnd) errs.push('집계 기간을 올바르게 입력하세요.');
  for (const [k, label] of [
    ['newCustomers', '신규 고객 수'],
    ['existingCustomers', '기존 고객 수'],
    ['newOrders', '신규 주문 수'],
    ['existingOrders', '기존 주문 수'],
  ] as const) {
    const val = m[k];
    if (val !== null && (!Number.isInteger(val) || val < 0)) errs.push(`${label}는 0 이상의 정수입니다.`);
  }
  if (m.newCustomers !== null && m.newOrders !== null && m.newOrders < m.newCustomers) errs.push('신규 고객의 주문 수가 신규 고객 수보다 적습니다. 구매 고객은 최소 1건 주문합니다.');
  if (m.existingCustomers !== null && m.existingOrders !== null && m.existingOrders < m.existingCustomers) errs.push('기존 고객의 주문 수가 구매한 기존 고객 수보다 적습니다.');
  if (m.platformRepeatRate !== null && (m.platformRepeatRate < 0 || m.platformRepeatRate > 100)) errs.push('플랫폼 재주문율은 0~100% 사이입니다.');
  const set = <K extends keyof CustomerMetric>(k: K, v: CustomerMetric[K]) => setM((x) => ({ ...x, [k]: v }));

  return (
    <Modal
      wide
      title={isNew ? '고객 지표 추가' : '고객 지표 수정'}
      onClose={onClose}
      footer={
        <>
          {touched && errs.length > 0 && (
            <span className="mr-auto w-full text-sm text-red-700 sm:w-auto" role="alert">
              ⛔ 아래 오류를 확인하세요.
            </span>
          )}
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (errs.length) return;
              update((d) => ({ ...d, customerMetrics: isNew ? [...d.customerMetrics, m] : d.customerMetrics.map((x) => (x.id === m.id ? m : x)) }), '고객 지표를 저장했습니다.');
              onClose();
            }}
          >
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-base font-semibold">1. 출처</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="어디서 본 숫자인가요?" className="sm:col-span-2">
              {(id) => <TextInput id={id} value={m.source} onChange={(v) => set('source', v)} placeholder="예: 배달앱 A 사장님 통계 > 고객 분석" />}
            </Field>
            <Field label="판매 방식">
              {(id) => <Select id={id} value={m.channel} onChange={(v) => set('channel', v)} options={[{ value: 'all', label: '전체' }, ...CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))]} />}
            </Field>
            <Field label="이름" className="sm:col-span-3">
              {(id) => <TextInput id={id} value={m.label} onChange={(v) => set('label', v)} placeholder="예: 배달앱 A 10월" />}
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-base font-semibold">2. 집계 기간</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="시작일">{(id) => <DateInput id={id} value={m.periodStart} onChange={(v) => set('periodStart', v)} />}</Field>
            <Field label="종료일">{(id) => <DateInput id={id} value={m.periodEnd} onChange={(v) => set('periodEnd', v)} />}</Field>
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-base font-semibold">3. 신규·기존 고객 (아는 칸만)</h3>
          <p className="mb-2 text-sm text-slate-700">
            정의: 신규·기존은 <b>집계 시작일 전 구매 이력</b>으로 나눕니다. 기존 고객 수는 누적 고객 수가 아니라 <b>이 기간에 실제 구매한</b> 기존 고객 수입니다.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="신규 구매 고객 수">{(id) => <NumberInput id={id} value={m.newCustomers} onChange={(v) => set('newCustomers', v)} suffix="명" />}</Field>
            <Field label="신규 고객 주문 수">{(id) => <NumberInput id={id} value={m.newOrders} onChange={(v) => set('newOrders', v)} suffix="건" />}</Field>
            <Field label="신규 고객 매출" hint="매출 합계에 더하지 않음">
              {(id) => <NumberInput id={id} value={m.newSales} onChange={(v) => set('newSales', v)} suffix="원" />}
            </Field>
            <Field label="구매한 기존 고객 수">{(id) => <NumberInput id={id} value={m.existingCustomers} onChange={(v) => set('existingCustomers', v)} suffix="명" />}</Field>
            <Field label="기존 고객 주문 수">{(id) => <NumberInput id={id} value={m.existingOrders} onChange={(v) => set('existingOrders', v)} suffix="건" />}</Field>
            <Field label="기존 고객 매출" hint="매출 합계에 더하지 않음">
              {(id) => <NumberInput id={id} value={m.existingSales} onChange={(v) => set('existingSales', v)} suffix="원" />}
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-base font-semibold">4. 30일 재구매율 (이 앱의 정의)</h3>
          <p className="mb-2 text-sm text-slate-700">
            30일 재구매율 = 30일 안에 다시 구매한 고객 수(분자) ÷ 첫 구매 후 30일 관찰이 끝난 고객 수(분모). 모르면 비워 두세요. 비우면 0%가 아니라 ‘데이터 없음’으로 표시합니다.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="첫 구매 집단 시작일">{(id) => <DateInput id={id} value={m.cohortStart} onChange={(v) => set('cohortStart', v || null)} />}</Field>
            <Field label="첫 구매 집단 종료일">{(id) => <DateInput id={id} value={m.cohortEnd} onChange={(v) => set('cohortEnd', v || null)} />}</Field>
            <Field label="관찰 기준일" hint={m.cohortEnd ? `${addDays(m.cohortEnd, 30)} 이후여야 관찰 완료` : '집계를 확인한 날'}>
              {(id) => <DateInput id={id} value={m.observationDate} onChange={(v) => set('observationDate', v || null)} />}
            </Field>
            <Field label="분모: 30일 관찰 완료 고객 수">{(id) => <NumberInput id={id} value={m.observedCustomers} onChange={(v) => set('observedCustomers', v)} suffix="명" />}</Field>
            <Field label="분자: 그중 30일 안에 재구매">{(id) => <NumberInput id={id} value={m.repurchased30} onChange={(v) => set('repurchased30', v)} suffix="명" />}</Field>
            <div className="flex flex-col justify-end">
              <span className="text-sm font-medium text-slate-800">계산 결과</span>
              <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm">
                {r.rate.value !== null ? `${r.rate.value.toFixed(1)}%${r.observationComplete ? '' : ' (관찰 미완료 · 잠정)'}` : r.rate.reason === 'divZero' ? '계산 불가 (분모 0)' : '데이터 없음'}
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-base font-semibold">5. 플랫폼이 보여주는 재주문율 (선택)</h3>
          <p className="mb-2 text-sm text-slate-700">플랫폼마다 정의가 달라 위의 30일 재구매율과 같은 지표로 보지 않고, 서로 비교하지 않습니다. 플랫폼의 정의 문구를 함께 적어 두세요.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="플랫폼 재주문율">
              {(id) => <NumberInput id={id} value={m.platformRepeatRate} onChange={(v) => set('platformRepeatRate', v)} suffix="%" allowDecimal />}
            </Field>
            <Field label="플랫폼의 정의" className="sm:col-span-2">
              {(id) => <TextInput id={id} value={m.platformRepeatDefinition} onChange={(v) => set('platformRepeatDefinition', v)} placeholder="예: 최근 3개월 내 2회 이상 주문한 고객 비율" />}
            </Field>
          </div>
        </section>

        <Field label="메모">{(id) => <TextInput id={id} value={m.memo} onChange={(v) => set('memo', v)} />}</Field>
        {(touched || r.errors.length > 0) && errs.length > 0 && (
          <Notice tone="error">
            <ul className="list-disc pl-4">
              {errs.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
    </Modal>
  );
}
