import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DateInput,
  Field,
  Modal,
  More,
  NumberInput,
  PageHeader,
  Select,
  TableWrap,
  TextInput,
  td,
  th,
} from '../components/ui';
import { WEEKDAY_LABELS, isValidDate, todayStr, weekday } from '../domain/dates';
import { uid } from '../domain/factory';
import { fmt, josa } from '../domain/format';
import { CHANNEL_LABEL, COMMON_LABEL, DIRECT_LABEL, FEE_BASE_LABEL } from '../domain/labels';
import {
  CHANNELS,
  COMMON_CATEGORIES,
  PER_ORDER_CATEGORIES,
  type Channel,
  type FeeBase,
  type FeeRule,
  type FoodCostRate,
  type OrderRoute,
  type PerOrderCost,
  type StoreSettings,
} from '../domain/types';
import { useApp, useData } from '../state/AppContext';
import { DataManagement } from './DataManagement';

export function StoreSettingsPage() {
  const { route } = useApp();
  // 홈의 '다음부터 자동 계산' 제안에서 넘어오면 그 설정으로 바로 이동
  useEffect(() => {
    const id = route.params.section;
    if (id) document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [route.params.section]);
  return (
    <>
      <PageHeader title="가게 설정" description="설정을 바꿔도 이미 저장된 과거 실적은 자동으로 바뀌지 않습니다." />
      <div className="space-y-4">
        <BasicInfo />
        <DayOverrides />
        <div className="grid gap-4 xl:grid-cols-2">
          <Platforms />
          <PaymentMethods />
        </div>
        <Routes />
        <FeeRules />
        <PerOrderCosts />
        <FoodCostRates />
        <CostSettingsInfo />
        <DataManagement />
      </div>
    </>
  );
}

function BasicInfo() {
  const data = useData();
  const { update } = useApp();
  const [draft, setDraft] = useState<StoreSettings>(data.store!);
  const [err, setErr] = useState<Record<string, string>>({});
  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.store);

  const save = () => {
    const e: Record<string, string> = {};
    if (!draft.name.trim()) e.name = '가게명을 입력하세요.';
    if (!draft.channels.length) e.channels = '판매 방식을 하나 이상 선택하세요.';
    if (draft.seats !== null && (!Number.isInteger(draft.seats) || draft.seats < 0)) e.seats = '좌석 수는 0 이상의 정수입니다.';
    if (!/^\d{2}:\d{2}$/.test(draft.openTime) || !/^\d{2}:\d{2}$/.test(draft.closeTime)) e.time = '영업시간을 입력하세요.';
    setErr(e);
    if (Object.keys(e).length) return;
    update((d) => ({ ...d, store: { ...draft, name: draft.name.trim() } }), '가게 기본 정보를 저장했습니다.');
  };

  return (
    <Card title="기본 정보" actions={<Button variant="primary" onClick={save} disabled={!dirty}>{dirty ? '저장' : '저장됨'}</Button>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="가게명" required error={err.name}>
          {(id) => <TextInput id={id} value={draft.name} onChange={(v) => set('name', v)} invalid={!!err.name} />}
        </Field>
        <Field label="좌석 수" error={err.seats} hint="모르면 비워두세요.">
          {(id) => <NumberInput id={id} value={draft.seats} onChange={(v) => set('seats', v)} suffix="석" />}
        </Field>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-700">판매 방식</p>
          <div className="flex flex-wrap gap-4">
            {CHANNELS.map((c) => (
              <Checkbox key={c} label={CHANNEL_LABEL[c]} checked={draft.channels.includes(c)} onChange={(v) => set('channels', v ? [...draft.channels, c] : draft.channels.filter((x) => x !== c))} />
            ))}
          </div>
          {err.channels && <p className="mt-1 text-xs text-red-700">{err.channels}</p>}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-700">정기 영업요일</p>
          <div className="flex flex-wrap gap-3">
            {WEEKDAY_LABELS.map((w, i) => (
              <Checkbox
                key={w}
                label={w}
                checked={draft.regularOpenDays.includes(i)}
                onChange={(v) => set('regularOpenDays', v ? [...draft.regularOpenDays, i].sort() : draft.regularOpenDays.filter((x) => x !== i))}
              />
            ))}
          </div>
        </div>
        <Field label="영업시간" error={err.time}>
          {() => (
            <div className="flex items-center gap-2">
              <input type="time" aria-label="영업 시작" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={draft.openTime} onChange={(e) => set('openTime', e.target.value)} />
              <span>~</span>
              <input type="time" aria-label="영업 종료" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={draft.closeTime} onChange={(e) => set('closeTime', e.target.value)} />
            </div>
          )}
        </Field>
        <Field label="입력 금액의 부가세 기준" hint="베타 계산에서는 모든 매출·비용 입력의 부가세 포함 여부를 이 기준으로 동일하게 맞춰 입력하세요. 세무 신고용 계산이 아닙니다.">
          {(id) => (
            <Select
              id={id}
              value={draft.vatBasis}
              onChange={(v) => set('vatBasis', v)}
              options={[
                { value: 'included', label: '모든 금액을 부가세 포함으로 입력' },
                { value: 'excluded', label: '모든 금액을 부가세 별도로 입력' },
              ]}
            />
          )}
        </Field>
        <div className="md:col-span-2">
          <p className="mb-1 text-xs font-medium text-slate-700">이 가게에 매 기간 발생하는 공통 운영비 항목</p>
          <p className="mb-2 text-xs text-slate-500">
            체크한 항목이 조회 기간 전체를 덮도록 입력되지 않으면 영업이익을 확정값으로 표시하지 않습니다. 발생하지 않는 항목(예: 자가 건물이라 월세 없음)은 체크하지 마세요.
          </p>
          <div className="flex flex-wrap gap-4">
            {COMMON_CATEGORIES.map((c) => (
              <Checkbox
                key={c}
                label={COMMON_LABEL[c]}
                checked={draft.commonCostChecklist.includes(c)}
                onChange={(v) => set('commonCostChecklist', v ? [...draft.commonCostChecklist, c] : draft.commonCostChecklist.filter((x) => x !== c))}
              />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function DayOverrides() {
  const data = useData();
  const { update, confirm } = useApp();
  const [date, setDate] = useState(todayStr());
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const list = [...data.dayOverrides].sort((a, b) => b.date.localeCompare(a.date));
  const regularOpen = isValidDate(date) && data.store!.regularOpenDays.includes(weekday(date));

  const add = () => {
    if (!isValidDate(date)) return setErr('날짜를 입력하세요.');
    setErr('');
    const exists = data.dayOverrides.some((o) => o.date === date);
    update(
      (d) => ({ ...d, dayOverrides: [...d.dayOverrides.filter((o) => o.date !== date), { date, open, note }] }),
      exists ? '해당 날짜의 영업 여부를 수정했습니다.' : '일자별 영업 여부를 저장했습니다.',
    );
    setNote('');
  };

  return (
    <Card title="일자별 영업·휴업" subtitle="정기 영업요일과 다른 날(임시 휴업, 정기 휴무일 특별 영업)을 등록합니다. 영업일 수 계산에 반영됩니다.">
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_2fr_auto]">
        <Field label="날짜" error={err} hint={isValidDate(date) ? `정기 설정상 ${regularOpen ? '영업일' : '휴무일'}` : undefined}>
          {(id) => <DateInput id={id} value={date} onChange={setDate} />}
        </Field>
        <Field label="구분">
          {(id) => (
            <Select
              id={id}
              value={open ? 'open' : 'closed'}
              onChange={(v) => setOpen(v === 'open')}
              options={[
                { value: 'closed', label: '휴업' },
                { value: 'open', label: '영업' },
              ]}
            />
          )}
        </Field>
        <Field label="메모">{(id) => <TextInput id={id} value={note} onChange={setNote} placeholder="예: 설비 점검" />}</Field>
        <Button variant="primary" onClick={add}>
          추가
        </Button>
      </div>
      {list.length > 0 && (
        <div className="mt-3">
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>날짜</th>
                <th className={th}>구분</th>
                <th className={th}>메모</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.date}>
                  <td className={td}>
                    {o.date} ({WEEKDAY_LABELS[weekday(o.date)]})
                  </td>
                  <td className={td}>{o.open ? <Badge tone="green">영업</Badge> : <Badge>휴업</Badge>}</td>
                  <td className={td}>{o.note}</td>
                  <td className={td}>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (await confirm({ title: '삭제할까요?', message: `${o.date}의 영업 여부 설정을 삭제합니다. 정기 영업요일 설정을 따르게 됩니다.`, confirmText: '삭제' }))
                          update((d) => ({ ...d, dayOverrides: d.dayOverrides.filter((x) => x.date !== o.date) }), '삭제했습니다.');
                      }}
                    >
                      삭제
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}
    </Card>
  );
}

function Platforms() {
  const data = useData();
  const { update, confirm, toast } = useApp();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  return (
    <Card title="이용 플랫폼" subtitle="배달앱 등 주문을 중개하는 서비스입니다.">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <TextInput value={name} onChange={setName} placeholder="플랫폼 이름" invalid={!!err} />
          {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
        </div>
        <Button
          variant="primary"
          onClick={() => {
            if (!name.trim()) return setErr('이름을 입력하세요.');
            setErr('');
            update((d) => ({ ...d, platforms: [...d.platforms, { id: uid('plat'), name: name.trim(), note: '' }] }), '플랫폼을 추가했습니다.');
            setName('');
          }}
        >
          추가
        </Button>
      </div>
      <ul className="mt-3 divide-y divide-slate-100">
        {data.platforms.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <InlineRename value={p.name} onSave={(v) => update((d) => ({ ...d, platforms: d.platforms.map((x) => (x.id === p.id ? { ...x, name: v } : x)) }), '수정했습니다.')} />
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (data.routes.some((r) => r.platformId === p.id)) return toast('이 플랫폼을 쓰는 주문 경로가 있어 삭제할 수 없습니다. 주문 경로를 먼저 수정하세요.', 'error');
                if (await confirm({ title: '플랫폼 삭제', message: `${josa(`"${p.name}"`, '을/를')} 삭제할까요?`, confirmText: '삭제' }))
                  update((d) => ({ ...d, platforms: d.platforms.filter((x) => x.id !== p.id) }), '삭제했습니다.');
              }}
            >
              삭제
            </Button>
          </li>
        ))}
        {!data.platforms.length && <li className="py-2 text-sm text-slate-500">등록된 플랫폼이 없습니다.</li>}
      </ul>
    </Card>
  );
}

function PaymentMethods() {
  const data = useData();
  const { update, confirm, toast } = useApp();
  const [name, setName] = useState('');
  return (
    <Card title="결제수단" subtitle="주문 경로와 별개입니다. 예: 전화 주문(경로) 후 매장 카드 결제(결제수단).">
      <div className="flex gap-2">
        <div className="flex-1">
          <TextInput value={name} onChange={setName} placeholder="결제수단 이름 (예: 카드, 현금, 간편결제)" />
        </div>
        <Button
          variant="primary"
          onClick={() => {
            if (!name.trim()) return toast('이름을 입력하세요.', 'error');
            update((d) => ({ ...d, paymentMethods: [...d.paymentMethods, { id: uid('pay'), name: name.trim() }] }), '결제수단을 추가했습니다.');
            setName('');
          }}
        >
          추가
        </Button>
      </div>
      <ul className="mt-3 divide-y divide-slate-100">
        {data.paymentMethods.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <InlineRename value={p.name} onSave={(v) => update((d) => ({ ...d, paymentMethods: d.paymentMethods.map((x) => (x.id === p.id ? { ...x, name: v } : x)) }), '수정했습니다.')} />
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (data.sales.some((s) => s.paymentMethodId === p.id)) return toast('이 결제수단을 쓰는 매출 입력이 있어 삭제할 수 없습니다.', 'error');
                if (await confirm({ title: '결제수단 삭제', message: `${josa(`"${p.name}"`, '을/를')} 삭제할까요?`, confirmText: '삭제' }))
                  update((d) => ({ ...d, paymentMethods: d.paymentMethods.filter((x) => x.id !== p.id) }), '삭제했습니다.');
              }}
            >
              삭제
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function InlineRename({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  if (!edit)
    return (
      <button className="text-left hover:underline" onClick={() => (setV(value), setEdit(true))} title="이름 수정">
        {value}
      </button>
    );
  return (
    <span className="flex flex-1 gap-1">
      <input className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      <Button size="sm" onClick={() => (v.trim() && onSave(v.trim()), setEdit(false))}>
        저장
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>
        취소
      </Button>
    </span>
  );
}

function Routes() {
  const data = useData();
  const { update, confirm, toast } = useApp();
  const [editing, setEditing] = useState<OrderRoute | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const save = () => {
    if (!editing) return;
    const e: Record<string, string> = {};
    if (!editing.name.trim()) e.name = '이름을 입력하세요.';
    if (!editing.channels.length) e.channels = '판매 방식을 하나 이상 선택하세요.';
    const removed = data.routes.find((r) => r.id === editing.id)?.channels.filter((c) => !editing.channels.includes(c)) ?? [];
    if (removed.some((c) => data.sales.some((s) => s.routeId === editing.id && s.channel === c))) e.channels = '이미 이 경로로 입력된 판매 방식은 해제할 수 없습니다.';
    setErr(e);
    if (Object.keys(e).length) return;
    const exists = data.routes.some((r) => r.id === editing.id);
    update(
      (d) => ({ ...d, routes: exists ? d.routes.map((r) => (r.id === editing.id ? editing : r)) : [...d.routes, editing] }),
      exists ? '주문 경로를 수정했습니다.' : '주문 경로를 추가했습니다.',
    );
    setEditing(null);
  };
  return (
    <Card
      title="주문 경로"
      subtitle="주문이 들어온 경로입니다(매장 방문, 전화, 배달앱 등). 매출은 날짜·판매 방식·주문 경로별로 입력합니다."
      actions={
        <Button variant="primary" onClick={() => (setErr({}), setEditing({ id: uid('route'), name: '', channels: [], platformId: null }))}>
          경로 추가
        </Button>
      }
    >
      {!data.routes.length ? (
        <p className="text-sm text-slate-500">주문 경로가 없습니다. 매출을 입력하려면 먼저 추가하세요.</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>이름</th>
              <th className={th}>판매 방식</th>
              <th className={th}>플랫폼</th>
              <th className={th}>매출 입력</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {data.routes.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.name}</td>
                <td className={td}>{r.channels.map((c) => CHANNEL_LABEL[c]).join(', ')}</td>
                <td className={td}>{data.platforms.find((p) => p.id === r.platformId)?.name ?? '없음'}</td>
                <td className={td}>{data.sales.filter((s) => s.routeId === r.id).length}건</td>
                <td className={td}>
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => (setErr({}), setEditing({ ...r }))}>
                      수정
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (data.sales.some((s) => s.routeId === r.id)) return toast('이 경로로 입력된 매출이 있어 삭제할 수 없습니다.', 'error');
                        if (await confirm({ title: '주문 경로 삭제', message: `"${r.name}"과 연결된 수수료 규칙도 함께 삭제됩니다.`, confirmText: '삭제' }))
                          update((d) => ({ ...d, routes: d.routes.filter((x) => x.id !== r.id), feeRules: d.feeRules.filter((f) => f.routeId !== r.id) }), '삭제했습니다.');
                      }}
                    >
                      삭제
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {editing && (
        <Modal
          title={data.routes.some((r) => r.id === editing.id) ? '주문 경로 수정' : '주문 경로 추가'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>취소</Button>
              <Button variant="primary" onClick={save}>
                저장
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            <Field label="이름" required error={err.name}>
              {(id) => <TextInput id={id} value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="예: 전화 주문" />}
            </Field>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">이 경로로 들어오는 판매 방식</p>
              <div className="flex gap-4">
                {CHANNELS.map((c) => (
                  <Checkbox
                    key={c}
                    label={CHANNEL_LABEL[c]}
                    checked={editing.channels.includes(c)}
                    onChange={(v) => setEditing({ ...editing, channels: v ? [...editing.channels, c] : editing.channels.filter((x) => x !== c) })}
                  />
                ))}
              </div>
              {err.channels && <p className="mt-1 text-xs text-red-700">{err.channels}</p>}
            </div>
            <Field label="플랫폼" hint="배달앱 등 중개 플랫폼을 거치는 경로라면 선택하세요. 선택하면 중개 수수료가 필수 비용 항목이 됩니다.">
              {(id) => (
                <Select
                  id={id}
                  value={editing.platformId ?? ''}
                  onChange={(v) => setEditing({ ...editing, platformId: v || null })}
                  options={[{ value: '', label: '없음 (직접 주문)' }, ...data.platforms.map((p) => ({ value: p.id, label: p.name }))]}
                />
              )}
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

const emptyRule = (routeId: string): FeeRule => ({
  id: uid('fee'),
  routeId,
  effectiveFrom: todayStr(),
  mode: 'separate',
  brokerageRate: null,
  brokerageBase: 'net',
  paymentRate: null,
  paymentBase: 'net',
  bundledRate: null,
  bundledBase: 'net',
  perOrderFee: null,
  vatExclusive: false,
  note: '',
});

function FeeRules() {
  const data = useData();
  const { update, confirm } = useApp();
  const [editing, setEditing] = useState<FeeRule | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const baseOptions = (Object.keys(FEE_BASE_LABEL) as FeeBase[]).map((b) => ({ value: b, label: FEE_BASE_LABEL[b] }));

  const save = () => {
    if (!editing) return;
    const e: Record<string, string> = {};
    if (!editing.routeId) e.routeId = '주문 경로를 선택하세요.';
    if (!isValidDate(editing.effectiveFrom)) e.effectiveFrom = '적용 시작일을 입력하세요.';
    const dup = data.feeRules.find((r) => r.id !== editing.id && r.routeId === editing.routeId && r.effectiveFrom === editing.effectiveFrom);
    if (dup) e.effectiveFrom = '같은 경로에 같은 적용 시작일의 규칙이 이미 있습니다.';
    const rates = [editing.brokerageRate, editing.paymentRate, editing.bundledRate];
    if (rates.some((r) => r !== null && (r < 0 || r > 100))) e.rate = '요율은 0~100% 사이로 입력하세요.';
    if (editing.mode === 'bundled' && editing.bundledRate === null) e.rate = '묶음 수수료율을 입력하세요.';
    if (editing.mode === 'separate' && editing.brokerageRate === null && editing.paymentRate === null && editing.perOrderFee === null) e.rate = '요율이나 건당 정액 중 하나 이상을 입력하세요.';
    setErr(e);
    if (Object.keys(e).length) return;
    const exists = data.feeRules.some((r) => r.id === editing.id);
    update((d) => ({ ...d, feeRules: exists ? d.feeRules.map((r) => (r.id === editing.id ? editing : r)) : [...d.feeRules, editing] }), exists ? { text: '수수료 설정을 수정했습니다', detail: '이미 저장된 매출 기록의 비용은 바뀌지 않아요.' } : { text: '수수료 설정을 추가했습니다', detail: '이제 해당 날짜·경로의 매출 기록에 자동 적용돼요.' });
    setEditing(null);
  };

  const routesWithRules = data.routes.map((r) => ({ route: r, rules: data.feeRules.filter((f) => f.routeId === r.id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)) }));

  return (
    <Card
      id="fee-rules"
      title="수수료 자동 계산 설정"
      subtitle="매출 날짜와 주문 경로에 맞는 설정을 자동 적용합니다. 정산서에서 확인한 금액을 입력하면 자동 계산액을 대신합니다."
      actions={
        <Button variant="primary" disabled={!data.routes.length} onClick={() => (setErr({}), setEditing(emptyRule(data.routes[0]?.id ?? '')))}>
          설정 추가
        </Button>
      }
    >
      <More summary="계산 방식 자세히" className="mb-3">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>플랫폼 수수료는 계약·상품마다 달라 앱에 기본 요율이 없습니다. 정산서나 계약서를 보고 입력하세요.</li>
          <li>요율이 바뀌면 기존 설정을 고치기보다 새 적용 시작일로 추가하세요. 이미 저장된 매출 기록은 다시 계산하지 않습니다.</li>
          <li>기준금액에 필요한 정보(할인 전 판매액, 환불액 등)가 없는 기록은 그 수수료만 ‘계산에 필요한 정보 없음’으로 남기고, 0원으로 넣지 않습니다.</li>
          <li>결제 수수료: 배달앱처럼 플랫폼 결제 경로는 기준금액 전체에, 그 밖의 경로는 카드 결제분에만 적용합니다. 현금은 적용하지 않고, 카드·현금이 섞였는데 카드 결제액을 모르면 계산하지 않습니다.</li>
        </ul>
      </More>
      <div className="space-y-3">
        {routesWithRules.map(({ route, rules }) => (
          <div key={route.id} className="rounded-lg ring-1 ring-slate-200">
            <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-sm font-medium">
              <span>
                {route.name} <span className="text-xs font-normal text-slate-500">({route.channels.map((c) => CHANNEL_LABEL[c]).join(', ')})</span>
              </span>
              <Button size="sm" onClick={() => (setErr({}), setEditing(emptyRule(route.id)))}>
                새 버전
              </Button>
            </div>
            {!rules.length ? (
              <p className="px-3 py-2 text-xs text-slate-500">설정 없음 — 이 경로의 수수료는 자동 계산하지 않습니다. 정산서 금액은 매출 기록의 비용 확인에서 직접 넣을 수 있습니다.</p>
            ) : (
              <TableWrap>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td className={td}>{r.effectiveFrom}부터</td>
                      <td className={td + ' whitespace-normal'}>
                        {r.mode === 'bundled'
                          ? `묶음 ${r.bundledRate}% (기준: ${FEE_BASE_LABEL[r.bundledBase]})`
                          : `중개 ${r.brokerageRate ?? '—'}% (기준: ${FEE_BASE_LABEL[r.brokerageBase]}) · 결제 ${r.paymentRate ?? '—'}% (기준: ${FEE_BASE_LABEL[r.paymentBase]})`}
                        {r.perOrderFee ? ` · 건당 ${r.perOrderFee.toLocaleString('ko-KR')}원` : ''}
                        {r.vatExclusive ? ' · 부가세 별도(×1.1)' : ' · 부가세 포함'}
                        {r.note && <div className="text-xs text-slate-500">{r.note}</div>}
                      </td>
                      <td className={td}>
                        <div className="flex gap-1">
                          <Button size="sm" onClick={() => (setErr({}), setEditing({ ...r }))}>
                            수정
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={async () => {
                              if (await confirm({ title: '규칙 삭제', message: '이 규칙을 삭제해도 이미 저장된 실적의 비용은 바뀌지 않습니다.', confirmText: '삭제' }))
                                update((d) => ({ ...d, feeRules: d.feeRules.filter((x) => x.id !== r.id) }), '삭제했습니다.');
                            }}
                          >
                            삭제
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <Modal
          title="수수료 자동 계산 설정"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>취소</Button>
              <Button variant="primary" onClick={save}>
                저장
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="주문 경로" error={err.routeId}>
              {(id) => <Select id={id} value={editing.routeId} onChange={(v) => setEditing({ ...editing, routeId: v })} options={data.routes.map((r) => ({ value: r.id, label: r.name }))} />}
            </Field>
            <Field label="적용 시작일" error={err.effectiveFrom}>
              {(id) => <DateInput id={id} value={editing.effectiveFrom} onChange={(v) => setEditing({ ...editing, effectiveFrom: v })} />}
            </Field>
            <Field label="수수료 방식" className="sm:col-span-2">
              {(id) => (
                <Select
                  id={id}
                  value={editing.mode}
                  onChange={(v) => setEditing({ ...editing, mode: v })}
                  options={[
                    { value: 'separate', label: '중개 수수료와 결제 수수료를 따로 부과' },
                    { value: 'bundled', label: '묶음 수수료 (중개·결제를 합친 하나의 요율)' },
                  ]}
                />
              )}
            </Field>
            {editing.mode === 'separate' ? (
              <>
                <Field label="중개 수수료율">{(id) => <NumberInput id={id} value={editing.brokerageRate} onChange={(v) => setEditing({ ...editing, brokerageRate: v })} suffix="%" allowDecimal />}</Field>
                <Field label="중개 수수료 기준액">
                  {(id) => <Select id={id} value={editing.brokerageBase} onChange={(v) => setEditing({ ...editing, brokerageBase: v })} options={baseOptions} />}
                </Field>
                <Field label="결제 수수료율">{(id) => <NumberInput id={id} value={editing.paymentRate} onChange={(v) => setEditing({ ...editing, paymentRate: v })} suffix="%" allowDecimal />}</Field>
                <Field label="결제 수수료 기준액">
                  {(id) => <Select id={id} value={editing.paymentBase} onChange={(v) => setEditing({ ...editing, paymentBase: v })} options={baseOptions} />}
                </Field>
              </>
            ) : (
              <>
                <Field label="묶음 수수료율" hint="묶음 수수료를 쓰면 결제 수수료를 따로 부과하지 않습니다.">
                  {(id) => <NumberInput id={id} value={editing.bundledRate} onChange={(v) => setEditing({ ...editing, bundledRate: v })} suffix="%" allowDecimal />}
                </Field>
                <Field label="묶음 수수료 기준액">
                  {(id) => <Select id={id} value={editing.bundledBase} onChange={(v) => setEditing({ ...editing, bundledBase: v })} options={baseOptions} />}
                </Field>
              </>
            )}
            <Field label="건당 정액 수수료" hint="완료 주문 1건마다 붙는 금액">
              {(id) => <NumberInput id={id} value={editing.perOrderFee} onChange={(v) => setEditing({ ...editing, perOrderFee: v })} suffix="원" />}
            </Field>
            <Field label="부가세">
              {(id) => (
                <Select
                  id={id}
                  value={editing.vatExclusive ? 'ex' : 'in'}
                  onChange={(v) => setEditing({ ...editing, vatExclusive: v === 'ex' })}
                  options={[
                    { value: 'in', label: '입력한 요율·정액에 부가세 포함' },
                    { value: 'ex', label: '부가세 별도 (계산 시 1.1배)' },
                  ]}
                />
              )}
            </Field>
            <Field label="메모" className="sm:col-span-2">
              {(id) => <TextInput id={id} value={editing.note} onChange={(v) => setEditing({ ...editing, note: v })} placeholder="예: 정산서 기준, 광고 상품 제외" />}
            </Field>
            {err.rate && <p className="text-xs text-red-700 sm:col-span-2">{err.rate}</p>}
          </div>
        </Modal>
      )}
    </Card>
  );
}

function PerOrderCosts() {
  const data = useData();
  const { update, confirm } = useApp();
  const [editing, setEditing] = useState<PerOrderCost | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const channels = (data.store?.channels.length ? data.store.channels : CHANNELS) as Channel[];
  const catsFor = (ch: Channel) => PER_ORDER_CATEGORIES.filter((c) => (c === 'hallSupplies' ? ch === 'hall' : c === 'delivery' ? ch === 'delivery' : c === 'packaging' ? ch !== 'hall' : true));
  const routeName = (id: string | null) => (id ? data.routes.find((r) => r.id === id)?.name ?? '(삭제된 경로)' : '모든 경로');

  const save = () => {
    if (!editing) return;
    const e: Record<string, string> = {};
    if (!Number.isFinite(editing.amount) || editing.amount < 0) e.amount = '0 이상의 금액을 입력하세요.';
    if (!isValidDate(editing.effectiveFrom)) e.effectiveFrom = '적용 시작일을 입력하세요.';
    const dup = data.perOrderCosts.find((c) => c.id !== editing.id && c.channel === editing.channel && c.routeId === editing.routeId && c.category === editing.category && c.effectiveFrom === editing.effectiveFrom);
    if (dup) e.effectiveFrom = '같은 항목·경로에 같은 적용 시작일 값이 이미 있습니다.';
    setErr(e);
    if (Object.keys(e).length) return;
    const exists = data.perOrderCosts.some((c) => c.id === editing.id);
    update(
      (d) => ({ ...d, perOrderCosts: exists ? d.perOrderCosts.map((c) => (c.id === editing.id ? editing : c)) : [...d.perOrderCosts, editing] }),
      exists ? '기본 비용을 수정했습니다. 이미 저장된 기록의 비용은 바뀌지 않습니다.' : '기본 비용을 추가했습니다.',
    );
    setEditing(null);
  };

  const sorted = [...data.perOrderCosts].sort((a, b) => a.channel.localeCompare(b.channel) || a.category.localeCompare(b.category) || b.effectiveFrom.localeCompare(a.effectiveFrom));

  return (
    <Card
      id="per-order"
      title="주문 1건당 기본 비용"
      subtitle="날마다 알기 어려운 비용을 주문 1건당 금액으로 정해 두면, 매출을 입력할 때 주문 수 × 금액으로 채웁니다."
      actions={
        <Button
          variant="primary"
          onClick={() => {
            setErr({});
            const ch = channels[0];
            setEditing({ id: uid('poc'), channel: ch, routeId: null, category: catsFor(ch)[0], amount: NaN, effectiveFrom: todayStr() });
          }}
        >
          기본 비용 추가
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-700">
        예: 홀 소모품비, 가게 부담 순배달비, 포장비. 기록에 실제 금액을 입력하면 그 금액만 씁니다. 값을 바꿔도 이미 저장된 기록은 그대로입니다. 한 달 청구서로 아는 비용은 ‘월세·급여 등 기간별 비용’에 넣어도 됩니다.
      </p>
      {!sorted.length ? (
        <p className="text-sm text-slate-600">아직 없습니다. 정해 두지 않은 항목은 빠른 입력 때 빈칸(미입력)으로 남고, 홈의 영업이익에 ‘미확정’ 표시가 붙습니다.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sorted.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm">
                <b>
                  {CHANNEL_LABEL[c.channel]} · {DIRECT_LABEL[c.category]}
                </b>{' '}
                <span className="text-slate-700">
                  ({routeName(c.routeId)}) 주문 1건당 {fmt(c.amount, 'won')} · {c.effectiveFrom}부터
                </span>
              </span>
              <span className="flex gap-1">
                <Button size="sm" onClick={() => (setErr({}), setEditing({ ...c }))}>
                  수정
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    if (await confirm({ title: '기본 비용 삭제', message: `${CHANNEL_LABEL[c.channel]} ${DIRECT_LABEL[c.category]} 기본값을 삭제할까요? 이미 저장된 기록은 그대로입니다.`, confirmText: '삭제' }))
                      update((d) => ({ ...d, perOrderCosts: d.perOrderCosts.filter((x) => x.id !== c.id) }), '기본 비용을 삭제했습니다.');
                  }}
                >
                  삭제
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <Modal
          title="주문 1건당 기본 비용"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>취소</Button>
              <Button variant="primary" onClick={save}>
                저장
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="판매 방식">
              {(id) => (
                <Select
                  id={id}
                  value={editing.channel}
                  onChange={(ch) => setEditing({ ...editing, channel: ch, routeId: null, category: catsFor(ch).includes(editing.category) ? editing.category : catsFor(ch)[0] })}
                  options={channels.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
                />
              )}
            </Field>
            <Field label="비용 항목">
              {(id) => <Select id={id} value={editing.category} onChange={(v) => setEditing({ ...editing, category: v })} options={catsFor(editing.channel).map((c) => ({ value: c, label: DIRECT_LABEL[c] }))} />}
            </Field>
            <Field label="주문 경로" hint="경로마다 다르면 경로를 고르세요. 경로 지정 값이 우선합니다.">
              {(id) => (
                <Select
                  id={id}
                  value={editing.routeId ?? ''}
                  onChange={(v) => setEditing({ ...editing, routeId: v || null })}
                  options={[{ value: '', label: '이 판매 방식의 모든 경로' }, ...data.routes.filter((r) => r.channels.includes(editing.channel)).map((r) => ({ value: r.id, label: r.name }))]}
                />
              )}
            </Field>
            <Field label="주문 1건당 금액" error={err.amount}>
              {(id) => <NumberInput id={id} value={Number.isFinite(editing.amount) ? editing.amount : null} onChange={(v) => setEditing({ ...editing, amount: v ?? NaN })} suffix="원" />}
            </Field>
            <Field label="적용 시작일" error={err.effectiveFrom}>
              {(id) => <DateInput id={id} value={editing.effectiveFrom} onChange={(v) => setEditing({ ...editing, effectiveFrom: v })} />}
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/** 식재료비 원가율(직접 지정): 매출 입력 때 상품 판매액 × 원가율로 식재료비를 채운다. 정해 두면 메뉴 평균 원가율(추정)보다 우선 */
function FoodCostRates() {
  const data = useData();
  const { update, confirm } = useApp();
  const [editing, setEditing] = useState<FoodCostRate | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const channels = (data.store?.channels.length ? data.store.channels : CHANNELS) as Channel[];
  const list = data.foodCostRates ?? [];

  const save = () => {
    if (!editing) return;
    const e: Record<string, string> = {};
    if (!Number.isFinite(editing.rate) || editing.rate < 0 || editing.rate > 100) e.rate = '0~100% 사이로 입력하세요.';
    if (!isValidDate(editing.effectiveFrom)) e.effectiveFrom = '적용 시작일을 입력하세요.';
    if (list.some((r) => r.id !== editing.id && r.channel === editing.channel && r.effectiveFrom === editing.effectiveFrom)) e.effectiveFrom = '같은 판매 방식에 같은 적용 시작일 값이 이미 있습니다.';
    setErr(e);
    if (Object.keys(e).length) return;
    const exists = list.some((r) => r.id === editing.id);
    update(
      (d) => ({ ...d, foodCostRates: exists ? d.foodCostRates.map((r) => (r.id === editing.id ? editing : r)) : [...d.foodCostRates, editing] }),
      exists ? '원가율을 수정했습니다. 이미 저장된 기록의 비용은 바뀌지 않습니다.' : '원가율을 추가했습니다.',
    );
    setEditing(null);
  };
  const sorted = [...list].sort((a, b) => (a.channel ?? '').localeCompare(b.channel ?? '') || b.effectiveFrom.localeCompare(a.effectiveFrom));
  const chName = (c: Channel | null) => (c ? CHANNEL_LABEL[c] : '모든 판매 방식');

  return (
    <Card
      id="food-rate"
      title="식재료비 원가율"
      subtitle="정해 두면 매출을 입력할 때 상품 판매액 × 원가율로 식재료비를 채웁니다."
      actions={
        <Button
          variant="primary"
          onClick={() => {
            setErr({});
            setEditing({ id: uid('fcr'), channel: null, rate: NaN, effectiveFrom: todayStr() });
          }}
        >
          원가율 추가
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-700">
        정해 두지 않으면 메뉴 원가율의 평균으로 채우고 ‘추정’으로 표시합니다(메뉴별 판매량을 모르기 때문). 할인·환불을 모르는 날은 순매출로 계산하므로 ‘추정’으로 표시됩니다. 값을 바꿔도 이미 저장된 기록은 그대로입니다.
      </p>
      {!sorted.length ? (
        <p className="text-sm text-slate-600">아직 없습니다.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sorted.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm">
                <b>{chName(r.channel)}</b>{' '}
                <span className="text-slate-700">
                  원가율 {r.rate}% · {r.effectiveFrom}부터
                </span>
              </span>
              <span className="flex gap-1">
                <Button size="sm" onClick={() => (setErr({}), setEditing({ ...r }))}>
                  수정
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    if (await confirm({ title: '원가율 삭제', message: `${chName(r.channel)} 원가율 ${r.rate}%를 삭제할까요? 이미 저장된 기록은 그대로입니다.`, confirmText: '삭제' }))
                      update((d) => ({ ...d, foodCostRates: d.foodCostRates.filter((x) => x.id !== r.id) }), '원가율을 삭제했습니다.');
                  }}
                >
                  삭제
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <Modal
          title="식재료비 원가율"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>취소</Button>
              <Button variant="primary" onClick={save}>
                저장
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="판매 방식" hint="판매 방식을 고른 값이 '모든 판매 방식' 값보다 우선합니다.">
              {(id) => (
                <Select
                  id={id}
                  value={editing.channel ?? ''}
                  onChange={(v) => setEditing({ ...editing, channel: (v || null) as Channel | null })}
                  options={[{ value: '', label: '모든 판매 방식' }, ...channels.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))]}
                />
              )}
            </Field>
            <Field label="원가율" error={err.rate} hint="상품 판매액 대비">
              {(id) => <NumberInput id={id} value={Number.isFinite(editing.rate) ? editing.rate : null} onChange={(v) => setEditing({ ...editing, rate: v ?? NaN })} suffix="%" allowDecimal />}
            </Field>
            <Field label="적용 시작일" error={err.effectiveFrom}>
              {(id) => <DateInput id={id} value={editing.effectiveFrom} onChange={(v) => setEditing({ ...editing, effectiveFrom: v })} />}
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function CostSettingsInfo() {
  const { navigate } = useApp();
  return (
    <Card title="비용 설정 기준" subtitle="비용은 두 축을 따로 가집니다.">
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="font-medium">성격</p>
          <p className="mt-1 text-slate-600">고정비 · 변동비 · 혼합비 — 매출 변화에 따라 금액이 움직이는지를 나타냅니다.</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="font-medium">어느 판매 방식에 쓰인 비용인가요?</p>
          <p className="mt-1 text-slate-600">
            {(['hall', 'delivery', 'takeout'] as Channel[]).map((c) => CHANNEL_LABEL[c]).join(' · ')} · 공통 — 한 판매 방식에만 쓰였으면 그 방식의 비용, 여러 방식이 함께 쓰면 공통 운영비로 한 번만 계산됩니다.
          </p>
        </div>
      </div>
      <div className="mt-3">
        <Button onClick={() => navigate('sales', { tab: 'period' })}>월세·급여 등 기간별 비용 입력으로 이동</Button>
      </div>
    </Card>
  );
}
