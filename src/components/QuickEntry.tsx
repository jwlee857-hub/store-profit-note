// 오늘 매출 간편 입력과 날짜별 입력 현황. 비용 입력은 별도 단계(상세 입력)로 분리한다.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AmountForm } from '../domain/amountForm';
import { netSales } from '../domain/calc';
import { WEEKDAY_LABELS, isValidDate, todayStr, weekday } from '../domain/dates';
import {
  ENTRY_STATUS_LABEL,
  NEED_PROMPT,
  autoCalcSummary,
  autoCostPreview,
  dayInputStatus,
  entryStatus,
  estimateInputsKey,
  fillEstimates,
  groupDayStatus,
  isCostDone,
  salesSlots,
  type AutoCalcSummary,
  type ChannelGroup,
  type CostPreviewLine,
  type EntryStatus,
  type SalesSlot,
  type SlotState,
} from '../domain/entry';
import { FEE_NEED_TEXT, payKindOf, type PayKind } from '../domain/estimate';
import { newSalesEntry } from '../domain/factory';
import { fmt, josa } from '../domain/format';
import { CHANNEL_LABEL } from '../domain/labels';
import type { Channel, SalesEntry } from '../domain/types';
import { findDuplicates, validateSalesEntry } from '../domain/validation';
import { useApp, useData } from '../state/AppContext';
import { SalesAmountInput, type FocusField } from './SalesAmountInput';
import { Badge, Button, Checkbox, DateInput, Field, Modal, More, Notice, NumberInput, ToggleGroup, type BadgeTone } from './ui';

// 비용이 비어 있는 것은 오류가 아니라 나중에 채울 일이므로 빨간색을 쓰지 않는다
export const STATUS_TONE: Record<EntryStatus, BadgeTone> = { salesOnly: 'gray', estimated: 'amber', calculated: 'green', needsCheck: 'gray', confirmed: 'green' };
const STATUS_ICON: Record<EntryStatus, string> = { salesOnly: '●', estimated: '≈', calculated: '✓', needsCheck: '…', confirmed: '✓' };
const STATUS_TITLE: Partial<Record<EntryStatus, string>> = {
  estimated: '비용 중 모르는 값을 가정해 구한 추정 금액이 있어요. 비용 확인에서 무엇을 가정했는지 볼 수 있어요.',
};

export function EntryStatusBadge({ status }: { status: EntryStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} title={STATUS_TITLE[status]}>
      <span aria-hidden className="mr-1">
        {STATUS_ICON[status]}
      </span>
      {ENTRY_STATUS_LABEL[status]}
    </Badge>
  );
}

// ───────── 간편 입력 ─────────

export interface QuickEntryProps {
  date?: string;
  channel?: Channel;
  routeId?: string;
  onClose: () => void;
  onSaved?: (e: SalesEntry) => void;
  /** 저장 후 비용 확인(상세 입력)으로 이어가기 — 저장 알림의 '비용 확인' 버튼에서 연다 */
  onOpenDetail?: (e: SalesEntry) => void;
}

const EMPTY_FORM: AmountForm = { net: null, discount: null, refund: null };

/** "11월 16일" */
const monthDay = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;

export function QuickEntry({ date, channel, routeId, onClose, onSaved, onOpenDetail }: QuickEntryProps) {
  const data = useData();
  const { update } = useApp();
  const slots = useMemo(() => salesSlots(data), [data]);
  const storeChannels = Array.from(new Set(slots.map((s) => s.channel)));

  const initial = useMemo<SalesEntry>(() => {
    // 지정한 경로가 없으면 그 날짜에서 아직 입력하지 않은 첫 경로로 연다 (이미 입력한 경로로 열어 중복 경고부터 보이지 않게).
    // 이전 날짜의 금액·주문 수는 복사하지 않는다.
    const d = date ?? todayStr();
    const last = data.prefs.lastEntry;
    const firstMissing = isValidDate(d) ? dayInputStatus(data, d).slots.find((s) => s.state.kind === 'missing') : undefined;
    const pick: SalesSlot | undefined =
      (channel && routeId && slots.find((s) => s.channel === channel && s.routeId === routeId)) ||
      (channel && slots.find((s) => s.channel === channel)) ||
      firstMissing ||
      (last && slots.find((s) => s.channel === last.channel && s.routeId === last.routeId)) ||
      slots[0];
    return newSalesEntry({ date: d, channel: pick?.channel ?? 'hall', routeId: pick?.routeId ?? '', amountMode: 'net' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [e, setE] = useState<SalesEntry>(initial);
  const [form, setForm] = useState<AmountForm>(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  /** 결제 수수료 계산용 결제 구분 (현금·카드가 섞였는데 카드 결제액을 모르면 계산하지 않음) */
  const [pay, setPay] = useState<PayKind>('unknown');
  const [focusRequest, setFocusRequest] = useState<{ field: FocusField; n: number } | null>(null);
  const [laterNeeds, setLaterNeeds] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [allowExtra, setAllowExtra] = useState(false);
  const [pending, setPending] = useState<SalesSlot | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [formKey, setFormKey] = useState(0);
  const pendingRef = useRef<HTMLDivElement>(null);

  // 결제 구분 → 저장 필드. 가게에 카드·현금 결제수단이 있으면 그 결제수단으로, 없으면 카드 결제액으로 나타낸다
  const cardMethod = data.paymentMethods.find((p) => payKindOf(data, p.id) === 'card' && p.name.includes('카드'));
  const cashMethod = data.paymentMethods.find((p) => payKindOf(data, p.id) === 'cash');
  const payFields: Pick<SalesEntry, 'paymentMethodId' | 'cardSales'> =
    pay === 'card'
      ? { paymentMethodId: cardMethod?.id ?? null, cardSales: cardMethod ? null : form.net }
      : pay === 'cash'
        ? { paymentMethodId: cashMethod?.id ?? null, cardSales: cashMethod ? null : 0 }
        : { paymentMethodId: null, cardSales: e.cardSales };
  // 화면 값은 언제나 '매출 금액(순매출)' 하나. 저장 형식은 순매출 기준 + 알고 있는 할인·환불 상세
  const current: SalesEntry = { ...e, ...payFields, amountMode: 'net', gross: null, netInput: form.net, storeDiscount: form.discount, refund: form.refund };
  const routesForChannel = slots.filter((s) => s.channel === e.channel);
  const v = validateSalesEntry(current, data);
  // 간편 입력에서는 비용 관련 오류를 다루지 않는다 (비용 확인 단계에서 처리)
  const fieldErrors = Object.fromEntries(Object.entries(v.errors).filter(([k]) => !k.startsWith('cost.')));
  const dup = findDuplicates(current, data);
  const blockingDup = !!dup.exact;
  const needsExtraConfirm = !dup.exact && dup.sameSlot.length > 0 && !allowExtra;
  const err = (k: string) => (touched ? fieldErrors[k] : undefined);
  const isToday = e.date === todayStr();
  // 자동 계산 상태: 입력값이 바뀔 때마다 다시 계산 (저장할 때도 같은 값으로 계산)
  const auto = useMemo(() => autoCalcSummary(current, data), [data, estimateInputsKey(current)]); // eslint-disable-line react-hooks/exhaustive-deps
  // 비용 미리보기: 저장 때와 같은 계산(fillEstimates)이라 보이는 금액 = 저장되는 금액
  const preview = useMemo(() => autoCostPreview(current, data), [data, estimateInputsKey(current)]); // eslint-disable-line react-hooks/exhaustive-deps
  // 입력을 시작한 뒤에만 보여준다. 수수료에 필요한 할인·환불·카드 결제액은 아래 '필요한 내역 입력' 안내로 묻고, 여기서는 주문 수 안내만
  const started = form.net !== null || e.orders !== null;
  const shownPreview = started ? preview.filter((l) => l.state !== 'needsInput' || l.prompt === NEED_PROMPT.orders) : [];
  const hasPlatform = !!data.routes.find((r) => r.id === e.routeId)?.platformId;
  // 결제 수수료가 결제수단에 따라 달라지는 경로(플랫폼 결제가 아닌 경로)에서만 결제 구분을 묻는다
  const askPayment = !!auto.fee && !auto.fee.bundled && auto.fee.rule.paymentRate !== null && !hasPlatform;
  const needs = auto.needs;
  const needFocus: Record<string, FocusField> = { refund: 'refund', discountRefund: 'discount', cardSales: 'card' };

  // 같은 날짜의 입력 진행 상황과 다음 미입력 경로
  const day = isValidDate(e.date) ? dayInputStatus(data, e.date) : null;
  const isCur = (s: SalesSlot) => s.channel === e.channel && s.routeId === e.routeId;
  const curIdx = day ? day.slots.findIndex(isCur) : -1;
  const nextSlot = day ? [...day.slots.slice(curIdx + 1), ...day.slots.slice(0, Math.max(curIdx, 0))].find((s) => (s.state.kind === 'missing' || s.state.kind === 'closed') && !isCur(s)) : undefined;
  const curWasMissing = !!day && curIdx >= 0 && day.slots[curIdx].state.kind === 'missing';
  const multi = !!day && day.slots.length > 1;

  // ── 판매 방식·경로 바꾸기: 입력 중인 내용이 있으면 옮길지·비울지·취소할지 묻는다 ──
  const dirty = form.net !== null || form.discount !== null || form.refund !== null || e.orders !== null || e.visitors !== null || e.cardSales !== null || pay !== 'unknown';
  const slotFor = (ch: Channel, rid?: string) => slots.find((s) => s.channel === ch && (rid ? s.routeId === rid : true));
  const moveTo = (s: SalesSlot, keep: boolean) => {
    setE((x) =>
      keep
        ? { ...x, channel: s.channel, routeId: s.routeId, visitors: s.channel === 'hall' ? x.visitors : null }
        : newSalesEntry({ date: x.date, channel: s.channel, routeId: s.routeId, amountMode: 'net' }),
    );
    if (!keep) {
      setForm(EMPTY_FORM);
      setApplied(null);
      setPay('unknown');
      setLaterNeeds(false);
      setTouched(false);
      setFormKey((k) => k + 1);
    }
    setAllowExtra(false);
    setPending(null);
  };
  const requestSlot = (ch: Channel, rid?: string) => {
    const s = slotFor(ch, rid);
    if (!s || isCur(s)) return;
    if (!dirty) moveTo(s, true);
    else setPending(s);
  };
  useEffect(() => {
    if (pending) pendingRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [pending]);
  useEffect(() => {
    savingRef.current = false;
  }, [data]);

  const save = (mode: 'close' | 'next') => {
    if (savingRef.current) return; // 중복 클릭 방지
    setTouched(true);
    if (Object.keys(fieldErrors).length || blockingDup || needsExtraConfirm || pending) return;
    savingRef.current = true;
    setSaving(true);
    // 설정한 것은 자동으로 적용: 수수료·건당 기준 비용(설정 기준 계산)·식재료비(메뉴 평균 원가율 추정)
    const toSave: SalesEntry = { ...current, visitors: current.channel === 'hall' ? current.visitors : null };
    const filled = fillEstimates(toSave, data);
    const entry: SalesEntry = filled.entry;
    const st = entryStatus(entry, data).status;
    // 저장 알림: 계산된 비용은 금액만("포장비 5,000원"), 추정은 '(추정)'
    const costText = autoCostPreview(toSave, data)
      .filter((l) => l.amount !== null)
      .map((l) => `${l.label} ${fmt(l.amount, 'won')}${l.state === 'estimated' ? '(추정)' : ''}`)
      .join(' · ');
    const goNext = mode === 'next' && !!nextSlot;
    const allDone = multi && day!.missingCount - (curWasMissing ? 1 : 0) === 0;
    const ok = update(
      (d) => ({
        ...d,
        sales: [...d.sales, entry],
        // 기록이 생기면 같은 칸의 '매출 없음' 확인은 지운다
        salesChecks: d.salesChecks.filter((c) => !(c.date === entry.date && c.channel === entry.channel && c.routeId === entry.routeId)),
        prefs: { ...d.prefs, lastEntry: { channel: entry.channel, routeId: entry.routeId, amountMode: 'net' } },
      }),
      {
        text: '매출을 저장했습니다',
        detail: [
          allDone ? '이 날짜의 모든 경로를 입력했어요' : null,
          costText || null,
          filled.needsInfo.length ? `계산에 필요한 정보 없음: ${filled.needsInfo.join('·')}` : null,
          isCostDone(st) ? null : ENTRY_STATUS_LABEL[st],
        ]
          .filter(Boolean)
          .join(' · '),
        // 다음 경로를 이어서 입력할 때는 창 위에 다른 창을 겹쳐 열지 않도록 이동 버튼을 붙이지 않는다
        action: !goNext && onOpenDetail && !isCostDone(st) ? { label: '비용 확인', run: () => onOpenDetail(entry) } : undefined,
      },
    );
    setSaving(false);
    if (!ok) {
      savingRef.current = false; // 저장 실패: 입력 내용을 그대로 두고 다시 누를 수 있게
      return;
    }
    // 성공: 화면이 새 상태로 다시 그려진 뒤에 잠금을 푼다(빠른 두 번 누름이 이전 값으로 또 저장하지 않게)
    onSaved?.(entry);
    if (goNext) {
      // 같은 날짜의 다음 미입력 경로로. 이전 경로의 매출·주문 수·할인·환불은 복사하지 않는다
      setE(newSalesEntry({ date: entry.date, channel: nextSlot!.channel, routeId: nextSlot!.routeId, amountMode: 'net' }));
      setForm(EMPTY_FORM);
      setApplied(null);
      setPay('unknown');
      setLaterNeeds(false);
      setTouched(false);
      setAllowExtra(false);
      setFormKey((k) => k + 1);
      setTimeout(() => {
        const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
        dlg?.querySelector('.modal-body')?.scrollTo?.({ top: 0 });
        dlg?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
      }, 0);
      return;
    }
    onClose();
  };

  const existingList = [...(dup.exact ? [dup.exact] : []), ...dup.sameSlot];
  const routeName = (id: string) => data.routes.find((r) => r.id === id)?.name ?? '(삭제된 경로)';
  const payName = (id: string | null) => (id ? data.paymentMethods.find((p) => p.id === id)?.name ?? '결제수단' : '결제수단 구분 없음');
  const hasErrors = touched && (Object.keys(fieldErrors).length > 0 || blockingDup || needsExtraConfirm);
  const dirtySummary = [form.net !== null ? `매출 ${fmt(form.net, 'won')}` : null, e.orders !== null ? `주문 ${fmt(e.orders, 'orders')}` : null, e.visitors !== null ? `방문 ${fmt(e.visitors, 'people')}` : null, form.discount !== null || form.refund !== null ? '할인·환불 상세' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal
      title={isToday ? '오늘 매출 기록' : isValidDate(e.date) ? `${monthDay(e.date)} 매출 기록` : '매출 기록'}
      onClose={onClose}
      footer={
        <>
          {hasErrors && (
            <span className="mr-auto w-full text-sm text-red-700 sm:w-auto" role="alert">
              ⛔ 위에 표시된 칸을 확인하세요.
            </span>
          )}
          <Button onClick={onClose}>취소</Button>
          {nextSlot && (
            <Button onClick={() => save('close')} disabled={blockingDup || saving}>
              저장하고 닫기
            </Button>
          )}
          <Button variant="primary" onClick={() => save('next')} disabled={blockingDup || saving}>
            {nextSlot ? '저장하고 다음' : '저장하고 마치기'}
          </Button>
        </>
      }
    >
      <div key={formKey} className="space-y-4">
        {multi && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200" aria-label="입력 진행">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-sm font-semibold text-slate-900">
                {e.date.slice(5).replace('-', '.')}({WEEKDAY_LABELS[weekday(e.date)]}) · 입력 경로 {day!.slots.length}개 중 {day!.enteredCount}개 완료
              </span>
              {!day!.open && <span className="text-xs text-slate-600">휴업일</span>}
            </div>
            <div className="mt-1.5 flex gap-1" aria-hidden>
              {day!.slots.map((s) => (
                <span
                  key={`${s.channel}-${s.routeId}`}
                  className={`h-1.5 flex-1 rounded-full ${isCur(s) ? 'bg-blue-600' : s.state.kind === 'entered' || s.state.kind === 'noSales' ? 'bg-emerald-600' : 'bg-slate-300'}`}
                />
              ))}
            </div>
            <p className="mt-1.5 text-sm text-slate-700">
              지금: <b>{day!.slots[curIdx]?.label ?? routeName(e.routeId)}</b>
              {nextSlot ? <> · 다음: {nextSlot.label}</> : <> · 마지막 경로</>}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="날짜" required error={err('date') && !blockingDup ? err('date') : undefined} warning={v.warnings.date}>
            {(id) => <DateInput id={id} value={e.date} onChange={(x) => setE((y) => ({ ...y, date: x }))} invalid={!!err('date') && !blockingDup} />}
          </Field>
          {storeChannels.length > 1 && (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-slate-800">판매 방식</span>
              <ToggleGroup value={e.channel} onChange={(c) => requestSlot(c)} options={storeChannels.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} />
            </div>
          )}
        </div>

        {routesForChannel.length > 1 ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-800">주문 경로</span>
            <ToggleGroup value={e.routeId} onChange={(r) => requestSlot(e.channel, r)} options={routesForChannel.map((s) => ({ value: s.routeId, label: routeName(s.routeId) }))} />
          </div>
        ) : routesForChannel.length === 1 ? (
          <p className="text-sm text-slate-700">
            주문 경로: <b>{routeName(e.routeId)}</b>
          </p>
        ) : (
          <Notice tone="warn">이 판매 방식에 연결된 주문 경로가 없습니다. 가게 설정에서 주문 경로를 추가하세요.</Notice>
        )}
        {err('routeId') && <p className="text-sm text-red-700">⛔ {err('routeId')}</p>}

        {pending && (
          <div ref={pendingRef} role="alertdialog" aria-label="입력 대상 바꾸기" className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200">
            <p>
              <b>{day?.slots[curIdx]?.label ?? routeName(e.routeId)}</b>에 입력 중인 내용이 있어요 ({dirtySummary}). <b>{pending.label}</b>
              {josa(pending.label, '으로/로').slice(pending.label.length)} 바꾸면 어떻게 할까요?
            </p>
            {e.channel === 'hall' && pending.channel !== 'hall' && e.visitors !== null && <p className="text-xs">홀 방문 고객 수는 홀에만 있어 옮기지 않아요.</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => moveTo(pending, true)}>
                입력한 내용을 {josa(pending.label, '으로/로')} 옮기기
              </Button>
              <Button size="sm" onClick={() => moveTo(pending, false)}>
                비우고 새로 입력
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                취소 (그대로 두기)
              </Button>
            </div>
          </div>
        )}

        {existingList.length > 0 && (
          <Notice tone={blockingDup ? 'error' : 'warn'}>
            <p className="font-medium">이 날짜·경로에 이미 기록이 있어요.</p>
            <ul className="mt-1 space-y-1">
              {existingList.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {payName(x.paymentMethodId)} · 매출 {fmt(netSales(x), 'won')} · {fmt(x.orders, 'orders')}
                  </span>
                  <Button size="sm" onClick={() => (onOpenDetail ? (onClose(), onOpenDetail(x)) : undefined)}>
                    이 기록 수정
                  </Button>
                </li>
              ))}
            </ul>
            {blockingDup ? (
              <p className="mt-1">같은 기록을 두 번 저장하지 않도록 새로 저장할 수 없습니다. 위 기록을 수정하세요.</p>
            ) : (
              <div className="mt-2">
                <p>결제수단별로 나눠 기록되어 있습니다. 새로 저장하면 합계에 더해집니다.</p>
                <Checkbox checked={allowExtra} onChange={setAllowExtra} label="중복이 아닙니다. 추가 기록으로 저장" />
                {touched && needsExtraConfirm && <p className="text-sm text-red-700">⛔ 중복이 아닌지 확인해 주세요.</p>}
              </div>
            )}
          </Notice>
        )}

        <SalesAmountInput
          form={form}
          onChange={(f) => {
            setForm(f);
            if (f.net !== form.net) setApplied(null);
          }}
          label={isToday ? '오늘 매출' : '매출 금액'}
          error={err('netInput')}
          warning={v.warnings.netInput}
          autoFocus
          onApplied={setApplied}
          focusRequest={focusRequest}
          extra={
            askPayment ? (
              <div className="space-y-2 border-t border-slate-200 pt-3">
                <p className="text-sm font-medium text-slate-800">결제 수단 (결제 수수료 계산용)</p>
                <ToggleGroup
                  value={pay}
                  onChange={setPay}
                  options={[
                    { value: 'unknown', label: '카드·현금 섞임/모름' },
                    { value: 'card', label: '전부 카드' },
                    { value: 'cash', label: '전부 현금' },
                  ]}
                />
                {pay === 'unknown' && (
                  <Field
                    label="카드 결제액"
                    hint="현금 결제분에는 카드 수수료를 적용하지 않아요. 모르면 비워 두세요."
                    warning={e.cardSales !== null && form.net !== null && e.cardSales > form.net ? '카드 결제액이 매출 금액보다 커요. 금액을 확인하세요.' : undefined}
                  >
                    {(id) => (
                      <div data-field="card" className="max-w-xs">
                        <NumberInput id={id} value={e.cardSales} onChange={(x) => setE((y) => ({ ...y, cardSales: x }))} suffix="원" />
                      </div>
                    )}
                  </Field>
                )}
              </div>
            ) : undefined
          }
        />
        {applied && (
          <p className="text-sm text-emerald-800" role="status">
            ✓ {applied}
          </p>
        )}

        <Field label="완료 주문 수" required error={err('orders')} hint={e.channel === 'hall' ? '영수증(테이블) 건수' : '전액 취소 제외'}>
          {(id) => (
            <div className="max-w-xs">
              <NumberInput id={id} value={e.orders} onChange={(x) => setE((y) => ({ ...y, orders: x }))} suffix="건" invalid={!!err('orders')} />
            </div>
          )}
        </Field>
        {e.channel === 'hall' && (
          <More summary="홀 방문 고객 수 — 선택" defaultOpen={e.visitors !== null}>
            <Field label="홀 방문 고객 수" error={err('visitors')} hint="비우면 객단가는 ‘데이터 필요’로 표시돼요">
              {(id) => (
                <div className="max-w-xs">
                  <NumberInput id={id} value={e.visitors} onChange={(x) => setE((y) => ({ ...y, visitors: x }))} suffix="명" invalid={!!err('visitors')} />
                </div>
              )}
            </Field>
          </More>
        )}

        <section aria-label="자동 계산 상태" className="space-y-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 text-sm">
            <CostPreviewList lines={shownPreview} />
            {(shownPreview.length > 0 || !!auto.fee) && (
              <button type="button" className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900" aria-expanded={showCalc} onClick={() => setShowCalc((x) => !x)}>
                {showCalc ? '상세 닫기' : '상세 보기'}
              </button>
            )}
          </div>
          {needs.length > 0 && !laterNeeds && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-200" role="status">
              {needs.map((n) => (
                <p key={n.need}>
                  이 경로의 {n.labels.join('·')} 계산에는 {josa(FEE_NEED_TEXT[n.need], '이/가')} 필요해요.
                </p>
              ))}
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setFocusRequest({ field: needFocus[needs[0].need], n: (focusRequest?.n ?? 0) + 1 })}>
                  필요한 내역 입력
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLaterNeeds(true)}>
                  나중에 입력
                </Button>
              </div>
            </div>
          )}
          {showCalc && <AutoCalcDetail auto={auto} lines={shownPreview} />}
        </section>
      </div>
    </Modal>
  );
}

/**
 * 자동 계산된 비용: 계산된 항목은 금액만("포장비 5,000원"), 추정은 '추정', 입력이 더 필요하면 무엇을 넣을지.
 */
function CostPreviewList({ lines }: { lines: CostPreviewLine[] }) {
  if (!lines.length) return <span className="text-slate-600">매출 금액과 주문 수를 넣으면 비용이 자동으로 채워져요.</span>;
  return (
    <ul className="min-w-0 space-y-0.5" aria-label="자동 계산된 비용">
      {lines.map((l) => (
        <li key={l.category} className="flex flex-wrap items-center gap-x-1.5" data-cost={l.category}>
          <span className="text-slate-800">{l.label}</span>
          {l.state === 'needsInput' ? (
            <span className="font-medium text-amber-900">{l.prompt}</span>
          ) : (
            <>
              <b className="tabular text-slate-900">{fmt(l.amount, 'won')}</b>
              {l.state === 'estimated' && (
                <Badge tone="amber" title={l.assumption ?? undefined}>
                  추정
                </Badge>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 자동 계산 상세: 항목별 계산식("건당 500원 × 10건")과 추정이면 가정한 내용 */
function AutoCalcDetail({ auto, lines }: { auto: AutoCalcSummary; lines: CostPreviewLine[] }) {
  const calculated = lines.filter((l) => l.state !== 'needsInput');
  return (
    <div className="space-y-2 border-t border-slate-200 pt-2 text-sm" aria-label="자동 계산 상세">
      {auto.fee ? (
        <p className="text-slate-600">
          수수료 설정: {auto.fee.rule.effectiveFrom}부터 · {auto.fee.bundled ? '묶음 수수료' : '중개·결제 수수료 별도'} · {auto.fee.rule.vatExclusive ? '부가세 별도' : '부가세 포함'}
        </p>
      ) : (
        <p className="text-slate-600">이 날짜·주문 경로에 적용할 수수료 설정이 없어요. 가게 설정에서 등록할 수 있어요.</p>
      )}
      {calculated.length > 0 && (
        <ul className="space-y-0.5">
          {calculated.map((l) => (
            <li key={l.category}>
              <b className="font-medium text-slate-900">{l.label}</b>: <span className="text-slate-800">{l.detail}</span>
              {l.amount !== null && <span className="tabular text-slate-800"> = {fmt(l.amount, 'won')}</span>}
              {l.assumption && <div className="text-xs text-amber-900">추정: {l.assumption}</div>}
            </li>
          ))}
          {auto.fee?.bundled && <li className="text-slate-600">결제 수수료: 묶음 수수료에 포함</li>}
        </ul>
      )}
      <p className="text-xs text-slate-600">정산서·영수증 금액은 저장 후 ‘비용 확인’에서 넣으면 그 금액만 반영해요.</p>
    </div>
  );
}

// ───────── 날짜별 입력 현황 ─────────

function slotText(state: SlotState): { text: string; tone: BadgeTone; icon: string } {
  switch (state.kind) {
    case 'entered':
      return { text: ENTRY_STATUS_LABEL[state.status], tone: STATUS_TONE[state.status], icon: STATUS_ICON[state.status] };
    case 'noSales':
      return { text: '매출 없음 (확인함)', tone: 'gray', icon: '–' };
    case 'closed':
      return { text: '휴업일', tone: 'gray', icon: '◌' };
    case 'missing':
      return { text: '미입력', tone: 'gray', icon: '○' };
  }
}

/** 그룹 상태: 색만으로 구분하지 않도록 아이콘과 글자를 함께 쓴다 */
function groupText(g: ChannelGroup): { text: string; tone: BadgeTone; icon: string } {
  switch (g.state) {
    case 'missing':
      return { text: '미입력', tone: 'gray', icon: '○' };
    case 'partial':
      return { text: `일부 입력 · ${g.doneCount}/${g.routeCount}곳`, tone: 'amber', icon: '◐' };
    case 'done':
      return { text: '입력 완료', tone: 'green', icon: '✓' };
    case 'noSales':
      return { text: '매출 없음 확인', tone: 'gray', icon: '✓' };
    case 'closed':
      return { text: '휴업일', tone: 'gray', icon: '◌' };
  }
}

/**
 * 날짜별 입력 현황 (홈·매출과 비용 공통).
 * 판매 방식(홀/배달/포장)별로 묶어 합계·상태·주요 버튼을 보여주고, 세부 주문 경로는 펼쳐서 본다.
 * 합계는 화면 표시용이며 저장하지 않는다. 경로별 입력·수정·매출 없음 기능은 펼친 목록에서 그대로 쓴다.
 */
export function TodayStatus({
  date,
  onDateChange,
  onEnter,
  onEdit,
  compact = false,
}: {
  date: string;
  onDateChange: (d: string) => void;
  onEnter: (slot: SalesSlot) => void;
  onEdit: (e: SalesEntry) => void;
  compact?: boolean;
}) {
  const data = useData();
  const { update, navigate } = useApp();
  const st = isValidDate(date) ? dayInputStatus(data, date) : null;
  const groups = st ? groupDayStatus(st) : [];
  const isToday = date === todayStr();
  const [open, setOpen] = useState<Channel[]>([]);
  const [focusGroup, setFocusGroup] = useState<Channel | null>(null);
  const listRefs = useRef<Partial<Record<Channel, HTMLUListElement | null>>>({});
  const baseId = useId();

  // '수정'으로 펼치면 첫 경로의 버튼으로 포커스를 옮겨 바로 고를 수 있게 한다
  useEffect(() => {
    if (!focusGroup) return;
    listRefs.current[focusGroup]?.querySelector<HTMLButtonElement>('button')?.focus();
    setFocusGroup(null);
  }, [focusGroup]);

  if (!salesSlots(data).length)
    return (
      <Notice tone="warn">
        주문 경로가 없어 입력 현황을 만들 수 없습니다.{' '}
        <button className="font-medium underline" onClick={() => navigate('store')}>
          가게 설정에서 주문 경로 추가
        </button>
      </Notice>
    );

  const toggle = (ch: Channel) => setOpen((o) => (o.includes(ch) ? o.filter((x) => x !== ch) : [...o, ch]));
  const routeName = (id: string) => data.routes.find((r) => r.id === id)?.name ?? '(삭제된 경로)';
  const markNoSales = (slot: SalesSlot, on: boolean) =>
    update(
      (d) => ({
        ...d,
        salesChecks: on
          ? [...d.salesChecks.filter((c) => !(c.date === date && c.channel === slot.channel && c.routeId === slot.routeId)), { date, channel: slot.channel, routeId: slot.routeId, status: 'noSales', checkedAt: new Date().toISOString() }]
          : d.salesChecks.filter((c) => !(c.date === date && c.channel === slot.channel && c.routeId === slot.routeId)),
      }),
      on ? `${slot.label}: 매출 없음으로 확인했습니다.` : '매출 없음 표시를 취소했습니다.',
    );
  const completeGroups = groups.filter((g) => g.state === 'done' || g.state === 'noSales').length;

  return (
    <section aria-label="입력 현황" className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {isToday ? '오늘' : ''} 입력 현황 · {isValidDate(date) ? `${date.slice(5).replace('-', '.')}(${WEEKDAY_LABELS[weekday(date)]})` : '날짜 선택'}
          </h2>
          {st && (
            <p className="text-sm text-slate-600" aria-live="polite">
              {!st.open ? '휴업일로 설정된 날입니다. ' : ''}
              {groups.length}개 판매 방식 중 {completeGroups}개 완료
              {st.missingCount ? ` · 남은 경로 ${st.missingCount}곳` : ''}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          날짜
          <input type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-base sm:text-sm" value={date} onChange={(ev) => onDateChange(ev.target.value)} />
        </label>
      </div>
      {st && (
        <ul className="divide-y divide-slate-100" aria-label="판매 방식별 입력 현황">
          {groups.map((g) => {
            const t = groupText(g);
            const isOpen = open.includes(g.channel);
            const listId = `${baseId}-${g.channel}`;
            const amount = g.total === null ? '—' : fmt(g.total, 'won');
            const action =
              g.state === 'missing' || g.state === 'closed'
                ? { label: '입력', primary: g.state === 'missing', run: () => g.nextSlot && onEnter(g.nextSlot) }
                : g.state === 'partial'
                  ? { label: '이어 입력', primary: true, run: () => g.nextSlot && onEnter(g.nextSlot) }
                  : {
                      label: '수정',
                      primary: false,
                      run: () => {
                        if (!isOpen) toggle(g.channel);
                        setFocusGroup(g.channel);
                      },
                    };
            return (
              <li key={g.channel} data-channel={g.channel}>
                <div className="grid grid-cols-[minmax(4.75rem,auto)_1fr_auto] items-center gap-x-3 py-2.5">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded text-left font-semibold text-slate-900 hover:text-slate-700"
                    aria-expanded={isOpen}
                    aria-controls={listId}
                    onClick={() => toggle(g.channel)}
                  >
                    <span aria-hidden className={`inline-block text-xs text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                      ▸
                    </span>
                    {CHANNEL_LABEL[g.channel]}
                    <span className="sr-only"> 세부 주문 경로 {isOpen ? '접기' : '펼치기'}</span>
                  </button>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className={`tabular font-medium ${g.total === null ? 'text-slate-400' : 'text-slate-900'}`} aria-label={g.total === null ? '합계 없음' : undefined}>
                      {amount}
                      {g.amountMissing && <span className="ml-1 text-xs font-normal text-slate-600">(금액 빈 기록 있음)</span>}
                    </span>
                    <Badge tone={t.tone}>
                      <span aria-hidden className="mr-1">
                        {t.icon}
                      </span>
                      {t.text}
                    </Badge>
                  </div>
                  <Button size="sm" variant={action.primary ? 'primary' : 'secondary'} onClick={action.run} aria-label={`${CHANNEL_LABEL[g.channel]} ${action.label}`}>
                    {action.label}
                  </Button>
                </div>
                {isOpen && (
                  <ul
                    id={listId}
                    ref={(el) => {
                      listRefs.current[g.channel] = el;
                    }}
                    aria-label={`${CHANNEL_LABEL[g.channel]} 주문 경로`}
                    className="mb-2.5 divide-y divide-slate-200 rounded-lg bg-slate-50 px-3"
                  >
                    {g.slots.map((s) => {
                      const st2 = slotText(s.state);
                      return (
                        <li key={`${s.channel}-${s.routeId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900">{routeName(s.routeId)}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                              {s.state.kind === 'entered' && (
                                <span className="tabular">
                                  {s.state.net === null ? '금액 필요' : fmt(s.state.net, 'won')}
                                  {s.state.entries.length > 1 && ` · 기록 ${s.state.entries.length}건`}
                                </span>
                              )}
                              <Badge tone={st2.tone}>
                                <span aria-hidden className="mr-1">
                                  {st2.icon}
                                </span>
                                {st2.text}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {s.state.kind === 'entered' ? (
                              <Button size="sm" onClick={() => onEdit((s.state as Extract<SlotState, { kind: 'entered' }>).entries[0])} aria-label={`${s.label} ${isCostDone(s.state.status) ? '보기·수정' : '수정·비용 확인'}`}>
                                {isCostDone(s.state.status) ? '보기·수정' : '수정'}
                              </Button>
                            ) : s.state.kind === 'noSales' ? (
                              <Button size="sm" variant="ghost" onClick={() => markNoSales(s, false)} aria-label={`${s.label} 매출 없음 표시 취소`}>
                                표시 취소
                              </Button>
                            ) : (
                              <>
                                <Button size="sm" variant="primary" onClick={() => onEnter(s)} aria-label={`${s.label} 입력`}>
                                  입력
                                </Button>
                                {!compact && (
                                  <Button size="sm" variant="ghost" onClick={() => markNoSales(s, true)} title="이 날 이 경로로 들어온 주문이 없었음을 확인" aria-label={`${s.label} 매출 없음`}>
                                    매출 없음
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-600">합계는 입력된 경로만 더한 값이며, 미입력은 0원으로 보지 않아요. 주문이 없었던 경로는 펼쳐서 ‘매출 없음’을 눌러 주세요.</p>
    </section>
  );
}
