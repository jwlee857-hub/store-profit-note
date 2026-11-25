import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Field, Modal, More, Notice, NumberInput, Select, TableWrap, td, tdR, th, thR } from '../components/ui';
import { netSales, settledByPeriod } from '../domain/calc';
import { WEEKDAY_LABELS, addDays, isValidDate, krRange, weekday } from '../domain/dates';
import { fmt } from '../domain/format';
import { CHANNEL_LABEL } from '../domain/labels';
import { referenceDate } from '../domain/periods';
import { applyPeriodSettlement, applySettlementEdits, calculatedFee, editOf, periodOverlap, settlementBreakdown, settlementEntries, validateSettlementEdits, type SettleEdit } from '../domain/settlement';
import type { Channel, SalesEntry } from '../domain/types';
import { useApp, useData } from '../state/AppContext';

/** 표에서 고쳤지만 아직 저장하지 않은 내용 (화면을 떠나기 전에 묻는다) */
interface Unsaved {
  count: number;
  save: () => boolean;
}

/** 매출과 비용 › 배달앱 정산 반영: 배달앱·기간을 고르면 날짜별 할인·환불·실제 수수료를 한 표에서 보완한다 */
export function Settlement() {
  const data = useData();
  const { route, navigate, setLeaveGuard } = useApp();
  const unsaved = useRef<Unsaved>({ count: 0, save: () => true });
  const [leaving, setLeaving] = useState<{ proceed: () => void; blocked: boolean } | null>(null);
  // 배달앱·판매 방식·기간을 바꾸거나 다른 탭·메뉴로 갈 때: 고친 내용이 있으면 먼저 묻는다 (없으면 바로 이동)
  useEffect(() => {
    setLeaveGuard((proceed) => {
      if (!unsaved.current.count) return false;
      setLeaving({ proceed, blocked: false });
      return true;
    });
    return () => setLeaveGuard(null);
  }, [setLeaveGuard]);
  const apps = data.routes.filter((r) => r.platformId);
  if (!apps.length)
    return (
      <EmptyState
        title="배달앱 주문 경로가 없어요"
        description="가게 설정에서 배달앱(플랫폼)과 연결된 주문 경로를 추가하면 정산서 금액을 한 번에 넣을 수 있어요."
        action={<Button onClick={() => navigate('store')}>가게 설정으로</Button>}
      />
    );
  const p = route.params;
  const app = apps.find((r) => r.id === p.route) ?? apps[0];
  const chans = app.channels;
  const channel: Channel = chans.includes(p.channel as Channel) ? (p.channel as Channel) : chans.includes('delivery') ? 'delivery' : chans[0];
  const ref = referenceDate(data);
  const from = isValidDate(p.from ?? '') ? p.from : addDays(ref, -13);
  const to = isValidDate(p.to ?? '') && p.to >= from ? p.to : ref >= from ? ref : from;
  const go = (patch: Record<string, string>) => navigate('sales', { tab: 'settle', route: app.id, channel, from, to, ...patch });
  return (
    <div className="space-y-4">
      <Card title="정산서 반영" subtitle="정산서를 보면서 여러 날의 가게 부담 할인·환불·실제 수수료를 한 번에 넣어요. 실제 수수료를 넣으면 계산 수수료 대신 그 금액만 합계에 들어가요.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="배달앱">{(id) => <Select id={id} value={app.id} onChange={(v) => go({ route: v, channel: '' })} options={apps.map((r) => ({ value: r.id, label: r.name }))} />}</Field>
          {chans.length > 1 && (
            <Field label="판매 방식">{(id) => <Select id={id} value={channel} onChange={(v) => go({ channel: v })} options={chans.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} />}</Field>
          )}
          <Field label="정산 시작일">
            {(id) => <input id={id} type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={from} onChange={(e) => isValidDate(e.target.value) && go({ from: e.target.value })} />}
          </Field>
          <Field label="정산 종료일">
            {(id) => <input id={id} type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={to} onChange={(e) => isValidDate(e.target.value) && go({ to: e.target.value })} />}
          </Field>
        </div>
      </Card>
      <SettleTable key={`${app.id}|${channel}|${from}|${to}`} routeId={app.id} routeName={app.name} channel={channel} start={from} end={to} onUnsaved={(u) => (unsaved.current = u)} />
      {leaving && (
        <Modal
          title={`수정한 ${unsaved.current.count}건이 있어요`}
          onClose={() => setLeaving(null)}
          footer={
            <>
              <Button onClick={() => setLeaving(null)}>계속 입력</Button>
              <Button
                variant="primary"
                onClick={() => {
                  // 저장에 실패하거나(오류 있는 행) 저장하지 못하면 이동하지 않는다
                  if (!unsaved.current.save()) return setLeaving({ ...leaving, blocked: true });
                  setLeaving(null);
                  leaving.proceed();
                }}
              >
                저장하고 이동
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-800">아직 저장하지 않았어요. 이동하면 표에 고친 내용이 사라져요. 저장한 뒤 이동하거나, 지금 화면에서 계속 입력하세요.</p>
          {leaving.blocked && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              ⛔ 오류가 있는 행을 고친 뒤 저장할 수 있어요. 입력한 값은 그대로 남아 있어요.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

function SettleTable({ routeId, routeName, channel, start, end, onUnsaved }: { routeId: string; routeName: string; channel: Channel; start: string; end: string; onUnsaved: (u: Unsaved) => void }) {
  const data = useData();
  const { update } = useApp();
  const rows = useMemo(() => settlementEntries(data, routeId, channel, { start, end }), [data, routeId, channel, start, end]);
  const [edits, setEdits] = useState<Record<string, SettleEdit>>(() => Object.fromEntries(rows.map((e) => [e.id, editOf(e)])));
  const editFor = (id: string) => edits[id] ?? editOf(rows.find((e) => e.id === id)!);
  const changed = rows.filter((e) => JSON.stringify(editFor(e.id)) !== JSON.stringify(editOf(e)));
  const set = (id: string, patch: Partial<SettleEdit>) => setEdits((m) => ({ ...m, [id]: { ...editFor(id), ...patch } }));
  const settlements = data.periodCosts.filter((pc) => pc.routeId === routeId && pc.attribution === channel && pc.start <= end && start <= pc.end);
  // 매출 상세 입력과 같은 검증 (판매액을 넘는 할인·환불 등). 하나라도 있으면 표 전체를 저장하지 않는다
  const errors = validateSettlementEdits(data, changed.map((e) => editFor(e.id)));
  const hasErrors = Object.keys(errors).length > 0;

  const save = () => {
    if (hasErrors) return false;
    const list = changed.map((e) => editFor(e.id));
    const ok = update((d) => ({ ...d, sales: applySettlementEdits(d, list) }), { text: `정산 반영: 기록 ${list.length}건을 고쳤어요`, detail: '실제 수수료를 넣은 날은 계산 수수료 대신 그 금액만 합계에 들어가요.' });
    // 저장 후 새 값 기준으로 다시 비교 (같은 값을 다시 저장해도 바뀌는 것 없음)
    if (ok) setEdits({});
    return ok;
  };
  onUnsaved({ count: changed.length, save });

  const label = (e: SalesEntry) => `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8, 10))}`;
  // 저장 전에 무엇이 바뀌는지: 날짜와 바뀌는 칸 수 (빈칸→0원도 바뀐 칸으로 센다)
  const changedFields = changed.reduce((n, e) => {
    const a = editFor(e.id) as unknown as Record<string, unknown>;
    const b = editOf(e) as unknown as Record<string, unknown>;
    return n + Object.keys(a).filter((k) => a[k] !== b[k]).length;
  }, 0);
  const changedDates = Array.from(new Set(changed.map(label)));
  const feeCell = (e: SalesEntry) => (settledByPeriod(data.periodCosts, e) ? '기간 합계로 대체' : fmt(calculatedFee(e), 'won'));
  return (
    <>
      <Card title={`${routeName} · ${CHANNEL_LABEL[channel]} 날짜별 정산`} subtitle="빈칸은 모르는 값이에요(0원으로 보지 않음). 할인·환불이 없으면 0을 넣으세요. 순매출로 입력한 기록에 할인을 넣어도 순매출에서 다시 빼지 않아요.">
        {settlements.map((pc) => {
          const b = settlementBreakdown(data, pc);
          return (
            <Notice key={pc.id} tone={b.rest < 0 || b.unverified ? 'warn' : 'info'} className="mb-3">
              <p>
                <b>
                  {krRange(pc)} 정산서 기간 합계 {fmt(b.total, 'won')}
                </b>{' '}
                = 일별 확인 {fmt(b.daily, 'won')}
                {b.dailyCount ? `(${b.dailyCount}일)` : ''} / 나머지 {fmt(b.rest, 'won')}
              </p>
              {b.unverified ? (
                <p className="text-sm">
                  ⚠ 확인 필요: 이전 버전에서 저장한 기간 합계예요. 저장된 {fmt(pc.amount, 'won')}이 정산서 총액인지 나머지 금액인지 알 수 없어, 이전 방식대로 일별 실제액을 더해 {fmt(b.total, 'won')}으로 계산하고 있어요. 정산서 총액과 다르면 아래 ‘정산서에 기간 합계만 있어요’에서 총액으로 다시 저장하세요.
                </p>
              ) : (
                <p className="text-xs">이 기간 수수료는 기간 합계만 합계에 들어가요. 일별 실제 수수료는 그 안의 내역으로 보고 따로 더하지 않아요.</p>
              )}
              {b.rest < 0 && <p className="text-sm">일별로 넣은 금액이 기간 합계보다 커요. 정산서 금액을 다시 확인하세요.</p>}
            </Notice>
          );
        })}
        {!rows.length ? (
          <p className="text-sm text-slate-600">이 기간에 {routeName}({CHANNEL_LABEL[channel]}) 매출 기록이 없어요.</p>
        ) : (
          <>
            {/* 데스크톱: 한 표 */}
            <div className="hidden sm:block">
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>날짜</th>
                    <th className={thR}>순매출</th>
                    <th className={thR}>가게 부담 할인</th>
                    <th className={thR}>환불</th>
                    <th className={thR}>계산 수수료</th>
                    <th className={thR}>
                      정산서 실제 수수료
                      <div className="text-xs font-normal text-slate-500">중개 / 결제</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const x = editFor(e.id);
                    const md = label(e);
                    return (
                      <tr key={e.id} className={errors[e.id] ? 'bg-red-50' : changed.includes(e) ? 'bg-amber-50' : ''}>
                        <td className={td + ' whitespace-normal'}>
                          {md}
                          {errors[e.id] && (
                            <p role="alert" className="mt-1 max-w-[12rem] text-xs text-red-700">
                              {errors[e.id]}
                            </p>
                          )}
                        </td>
                        <td className={tdR}>{fmt(netSales(e), 'won', '금액 필요')}</td>
                        <td className={tdR}>
                          <div className="ml-auto w-28">
                            <NumberInput ariaLabel={`${md} 가게 부담 할인`} value={x.storeDiscount} onChange={(v) => set(e.id, { storeDiscount: v })} suffix="원" invalid={!!errors[e.id]} />
                          </div>
                        </td>
                        <td className={tdR}>
                          <div className="ml-auto w-24">
                            <NumberInput ariaLabel={`${md} 환불`} value={x.refund} onChange={(v) => set(e.id, { refund: v })} suffix="원" invalid={!!errors[e.id]} />
                          </div>
                        </td>
                        <td className={tdR}>{settledByPeriod(data.periodCosts, e) ? <span className="text-xs text-slate-500">기간 합계로 대체</span> : feeCell(e)}</td>
                        <td className={tdR}>
                          <div className="ml-auto flex w-56 gap-1">
                            <NumberInput ariaLabel={`${md} 실제 ${e.bundledFee ? '묶음' : '중개'} 수수료`} value={x.brokerage} onChange={(v) => set(e.id, { brokerage: v })} suffix="원" />
                            {e.bundledFee ? <span className="self-center text-xs text-slate-500">묶음</span> : <NumberInput ariaLabel={`${md} 실제 결제 수수료`} value={x.payment} onChange={(v) => set(e.id, { payment: v })} suffix="원" />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            </div>
            {/* 휴대폰: 날짜·순매출 줄을 펼쳐 네 칸 입력 (입력 중에도 날짜와 칸 이름이 함께 보인다) */}
            <ul className="space-y-2 sm:hidden">
              {rows.map((e) => {
                const x = editFor(e.id);
                const md = label(e);
                return (
                  <li key={e.id}>
                    <details aria-label={`${md} 정산 입력`} className={`rounded-lg ring-1 ${errors[e.id] ? 'bg-red-50 ring-red-300' : changed.includes(e) ? 'bg-amber-50 ring-amber-300' : 'ring-slate-200'}`} open={!!errors[e.id] || undefined}>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm">
                        <span className="font-semibold text-slate-900">
                          {md}({WEEKDAY_LABELS[weekday(e.date)]})
                        </span>
                        <span className="text-slate-700">
                          순매출 {fmt(netSales(e), 'won', '금액 필요')}
                          {changed.includes(e) && <span className="ml-1 text-xs text-amber-800">· 수정함</span>}
                        </span>
                      </summary>
                      <div className="grid grid-cols-2 gap-2 border-t border-slate-200 px-3 py-2.5">
                        <Field label="가게 부담 할인">{(id) => <NumberInput id={id} value={x.storeDiscount} onChange={(v) => set(e.id, { storeDiscount: v })} suffix="원" invalid={!!errors[e.id]} />}</Field>
                        <Field label="환불">{(id) => <NumberInput id={id} value={x.refund} onChange={(v) => set(e.id, { refund: v })} suffix="원" invalid={!!errors[e.id]} />}</Field>
                        <Field label={e.bundledFee ? '실제 묶음 수수료' : '실제 중개 수수료'}>{(id) => <NumberInput id={id} value={x.brokerage} onChange={(v) => set(e.id, { brokerage: v })} suffix="원" />}</Field>
                        {!e.bundledFee && <Field label="실제 결제 수수료">{(id) => <NumberInput id={id} value={x.payment} onChange={(v) => set(e.id, { payment: v })} suffix="원" />}</Field>}
                        <p className="col-span-2 text-xs text-slate-600">계산 수수료: {feeCell(e)}</p>
                        {errors[e.id] && (
                          <p role="alert" className="col-span-2 text-xs text-red-700">
                            {errors[e.id]}
                          </p>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
            {changed.length > 0 && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-200" aria-label="저장하면 바뀌는 내용">
                저장하면 바뀌어요: {changedDates.slice(0, 6).join(', ')}
                {changedDates.length > 6 ? ` 외 ${changedDates.length - 6}일` : ''} · {changedDates.length}일 · 항목 {changedFields}개
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={save} disabled={!changed.length || hasErrors}>
                정산 반영 저장{changed.length ? ` (${changed.length}건)` : ''}
              </Button>
              {hasErrors ? (
                <span className="text-sm text-red-700">오류가 있는 행 {Object.keys(errors).length}건을 고치면 저장할 수 있어요. 입력한 값은 그대로 남아 있어요.</span>
              ) : (
                <span className="text-xs text-slate-600">식재료비처럼 아직 추정인 다른 비용은 그대로 둬요.</span>
              )}
            </div>
          </>
        )}
      </Card>
      <PeriodTotal routeId={routeId} channel={channel} start={start} end={end} />
    </>
  );
}

/** 정산서에 기간 합계만 있을 때: 배달앱·기간 범위를 그대로 남기고, 겹치는 금액은 저장 전에 보여준다 */
function PeriodTotal({ routeId, channel, start, end }: { routeId: string; channel: Channel; start: string; end: string }) {
  const data = useData();
  const { update, confirm } = useApp();
  const [amount, setAmount] = useState<number | null>(null);
  const ps = { routeId, channel, start, end, amount: amount ?? 0 };
  const ov = periodOverlap(data, ps);
  const result = amount === null ? null : applyPeriodSettlement(data, ps);
  const save = () => {
    if (!result || 'error' in result) return;
    update((d) => ({ ...d, ...result }), { text: '정산서 기간 합계를 반영했어요', detail: `${krRange(ps)} 수수료는 이 합계만 비용에 들어가요.` });
    setAmount(null);
  };
  const remove = async (id: string, label: string) => {
    if (await confirm({ title: '기간 합계를 지울까요?', message: `${label} 기간 합계를 지우면 그 기간 수수료는 일별 금액(실제·계산)으로 돌아가요.`, confirmText: '지우기' }))
      update((d) => ({ ...d, periodCosts: d.periodCosts.filter((p) => p.id !== id) }), '기간 합계를 지웠어요.');
  };
  return (
    <More summary="정산서에 기간 합계만 있어요" defaultOpen={ov.replaced.length + ov.conflicts.length > 0}>
      <div className="mt-2 space-y-3 rounded-lg p-3 ring-1 ring-slate-200">
        {[...ov.replaced, ...ov.conflicts.map((c) => c.cost)].map((pc) => (
          <p key={pc.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
            저장된 기간 합계: {krRange(pc)} {fmt(pc.amount, 'won')}
            <Button size="sm" variant="ghost" onClick={() => remove(pc.id, `${krRange(pc)} ${fmt(pc.amount, 'won')}`)}>
              지우기
            </Button>
          </p>
        ))}
        <Field label={`${krRange(ps)} 수수료 합계 (중개·결제)`}>{(id) => <NumberInput id={id} value={amount} onChange={setAmount} suffix="원" />}</Field>
        {amount !== null && (
          <Notice tone={result && 'error' in result ? 'error' : ov.dailyActual.count || ov.replaced.length ? 'warn' : 'info'}>
            <p className="font-medium">저장하기 전에 확인하세요</p>
            {result && 'error' in result ? (
              <p className="mt-1 text-sm">{result.error}</p>
            ) : (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                <li>이 기간 수수료는 {fmt(amount, 'won')}만 비용에 들어가요.</li>
                {ov.dailyActual.count > 0 && (
                  <li>
                    일별로 넣은 실제 수수료 {ov.dailyActual.count}일 {fmt(ov.dailyActual.amount, 'won')}은 이 합계에 포함된 것으로 봐요: 일별 확인 {fmt(ov.dailyActual.amount, 'won')} / 나머지 {fmt(amount - ov.dailyActual.amount, 'won')}
                  </li>
                )}
                {ov.calculated.count > 0 && <li>계산 수수료 {ov.calculated.count}건 {fmt(ov.calculated.amount, 'won')}은 합계에서 빠져요.</li>}
                {ov.replaced.length > 0 && <li>같은 기간의 기존 합계 {fmt(ov.replaced.reduce((s, p) => s + p.amount, 0), 'won')}는 이 금액으로 바꿔 넣어요. 두 번 더하지 않아요.</li>}
                {amount < ov.dailyActual.amount && <li>일별로 넣은 금액이 이 합계보다 커요. 정산서 금액을 다시 확인하세요.</li>}
              </ul>
            )}
          </Notice>
        )}
        <Button variant="primary" onClick={save} disabled={!result || 'error' in result}>
          기간 합계 저장
        </Button>
      </div>
    </More>
  );
}
