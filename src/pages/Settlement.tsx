import { useMemo, useState } from 'react';
import { Button, Card, EmptyState, Field, More, Notice, NumberInput, Select, TableWrap, td, tdR, th, thR } from '../components/ui';
import { netSales, settledByPeriod } from '../domain/calc';
import { addDays, isValidDate } from '../domain/dates';
import { fmt } from '../domain/format';
import { CHANNEL_LABEL } from '../domain/labels';
import { referenceDate } from '../domain/periods';
import { applyPeriodSettlement, applySettlementEdits, calculatedFee, editOf, periodOverlap, settlementEntries, type SettleEdit } from '../domain/settlement';
import type { Channel } from '../domain/types';
import { useApp, useData } from '../state/AppContext';

/** 매출과 비용 › 배달앱 정산 반영: 배달앱·기간을 고르면 날짜별 할인·환불·실제 수수료를 한 표에서 보완한다 */
export function Settlement() {
  const data = useData();
  const { route, navigate } = useApp();
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
      <Card title="배달앱 정산 반영" subtitle="정산서를 보면서 여러 날의 가게 부담 할인·환불·실제 수수료를 한 번에 넣어요. 실제 수수료를 넣으면 계산 수수료 대신 그 금액만 합계에 들어가요.">
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
      <SettleTable key={`${app.id}|${channel}|${from}|${to}`} routeId={app.id} routeName={app.name} channel={channel} start={from} end={to} />
    </div>
  );
}

function SettleTable({ routeId, routeName, channel, start, end }: { routeId: string; routeName: string; channel: Channel; start: string; end: string }) {
  const data = useData();
  const { update } = useApp();
  const rows = useMemo(() => settlementEntries(data, routeId, channel, { start, end }), [data, routeId, channel, start, end]);
  const [edits, setEdits] = useState<Record<string, SettleEdit>>(() => Object.fromEntries(rows.map((e) => [e.id, editOf(e)])));
  const editFor = (id: string) => edits[id] ?? editOf(rows.find((e) => e.id === id)!);
  const changed = rows.filter((e) => JSON.stringify(editFor(e.id)) !== JSON.stringify(editOf(e)));
  const set = (id: string, patch: Partial<SettleEdit>) => setEdits((m) => ({ ...m, [id]: { ...editFor(id), ...patch } }));

  const save = () => {
    const list = changed.map((e) => editFor(e.id));
    const ok = update((d) => ({ ...d, sales: applySettlementEdits(d, list) }), { text: `정산 반영: 기록 ${list.length}건을 고쳤어요`, detail: '실제 수수료를 넣은 날은 계산 수수료 대신 그 금액만 합계에 들어가요.' });
    // 저장 후 새 값 기준으로 다시 비교 (같은 값을 다시 저장해도 바뀌는 것 없음)
    if (ok) setEdits({});
  };

  return (
    <>
      <Card title={`${routeName} · ${CHANNEL_LABEL[channel]} 날짜별 정산`} subtitle="빈칸은 모르는 값이에요(0원으로 보지 않음). 할인·환불이 없으면 0을 넣으세요. 순매출로 입력한 기록에 할인을 넣어도 순매출에서 다시 빼지 않아요.">
        {!rows.length ? (
          <p className="text-sm text-slate-600">이 기간에 {routeName}({CHANNEL_LABEL[channel]}) 매출 기록이 없어요.</p>
        ) : (
          <>
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
                  const md = `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8, 10))}`;
                  const calc = calculatedFee(e);
                  return (
                    <tr key={e.id} className={changed.includes(e) ? 'bg-amber-50' : ''}>
                      <td className={td}>{md}</td>
                      <td className={tdR}>{fmt(netSales(e), 'won', '금액 필요')}</td>
                      <td className={tdR}>
                        <div className="ml-auto w-28">
                          <NumberInput ariaLabel={`${md} 가게 부담 할인`} value={x.storeDiscount} onChange={(v) => set(e.id, { storeDiscount: v })} suffix="원" />
                        </div>
                      </td>
                      <td className={tdR}>
                        <div className="ml-auto w-24">
                          <NumberInput ariaLabel={`${md} 환불`} value={x.refund} onChange={(v) => set(e.id, { refund: v })} suffix="원" />
                        </div>
                      </td>
                      <td className={tdR}>
                        {settledByPeriod(data.periodCosts, e) ? <span className="text-xs text-slate-500">기간 합계로 대체</span> : fmt(calc, 'won')}
                      </td>
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
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={save} disabled={!changed.length}>
                정산 반영 저장{changed.length ? ` (${changed.length}건)` : ''}
              </Button>
              <span className="text-xs text-slate-600">식재료비처럼 아직 추정인 다른 비용은 그대로 둬요.</span>
            </div>
          </>
        )}
      </Card>
      <PeriodTotal routeId={routeId} channel={channel} start={start} end={end} />
    </>
  );
}

/** 정산서에 기간 합계만 있을 때: 기간·배달앱 범위를 그대로 남기고, 겹치는 금액은 저장 전에 보여준다 */
function PeriodTotal({ routeId, channel, start, end }: { routeId: string; channel: Channel; start: string; end: string }) {
  const data = useData();
  const { update } = useApp();
  const [amount, setAmount] = useState<number | null>(null);
  const [mode, setMode] = useState<'keepDaily' | 'replaceDaily'>('keepDaily');
  const ps = { routeId, channel, start, end, amount: amount ?? 0 };
  const ov = periodOverlap(data, ps);
  const save = () => {
    if (amount === null) return;
    const r = applyPeriodSettlement(data, ps, mode);
    if ('error' in r) return;
    update((d) => ({ ...d, ...r }), { text: '정산서 기간 합계를 반영했어요', detail: `${start}~${end} 수수료 합계. 이 범위의 계산 수수료는 기간 합계로 대체돼요.` });
    setAmount(null);
  };
  const result = amount === null ? null : applyPeriodSettlement(data, ps, mode);
  return (
    <More summary="정산서에 기간 합계만 있어요" defaultOpen={ov.replaced.length > 0}>
      <div className="mt-2 space-y-3 rounded-lg p-3 ring-1 ring-slate-200">
        {ov.replaced.map((pc) => (
          <p key={pc.id} className="text-sm text-slate-700">
            저장된 기간 합계: {pc.start}~{pc.end} {fmt(pc.amount, 'won')} ({pc.memo})
          </p>
        ))}
        <Field label={`${start}~${end} 수수료 합계 (중개·결제)`}>{(id) => <NumberInput id={id} value={amount} onChange={setAmount} suffix="원" />}</Field>
        {amount !== null && (
          <Notice tone={ov.dailyActual.count || ov.replaced.length ? 'warn' : 'info'}>
            <p className="font-medium">저장하기 전에 확인하세요</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
              {ov.calculated.count > 0 && <li>계산 수수료 {ov.calculated.count}건 {fmt(ov.calculated.amount, 'won')}은 합계에서 빠지고 이 기간 합계로 대체돼요.</li>}
              {ov.replaced.length > 0 && <li>같은 배달앱의 겹치는 기간 합계 {ov.replaced.length}건({fmt(ov.replaced.reduce((s, p) => s + p.amount, 0), 'won')})은 이 금액으로 바꿔 넣어요. 두 번 더하지 않아요.</li>}
              {ov.dailyActual.count > 0 && <li>이 기간에 일별로 넣은 실제 수수료 {ov.dailyActual.count}건 {fmt(ov.dailyActual.amount, 'won')}이 기간 합계와 겹쳐요. 처리 방법을 고르세요.</li>}
            </ul>
            {ov.dailyActual.count > 0 && (
              <fieldset className="mt-2 space-y-1 text-sm">
                <legend className="sr-only">겹치는 일별 실제 수수료 처리</legend>
                <label className="flex items-start gap-2">
                  <input type="radio" name="overlap" checked={mode === 'keepDaily'} onChange={() => setMode('keepDaily')} />
                  <span>일별 실제액은 그대로 두고 나머지만 반영 (기간 합계 − {fmt(ov.dailyActual.amount, 'won')} = {fmt(amount - ov.dailyActual.amount, 'won')})</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="overlap" checked={mode === 'replaceDaily'} onChange={() => setMode('replaceDaily')} />
                  <span>기간 합계로 대체 (일별 실제 수수료 {ov.dailyActual.count}건을 지우고 {fmt(amount, 'won')} 전체 반영)</span>
                </label>
              </fieldset>
            )}
            {result && 'error' in result && <p className="mt-1 text-sm text-red-700">{result.error}</p>}
          </Notice>
        )}
        <Button variant="primary" onClick={save} disabled={amount === null || (!!result && 'error' in result)}>
          기간 합계 저장
        </Button>
      </div>
    </More>
  );
}
