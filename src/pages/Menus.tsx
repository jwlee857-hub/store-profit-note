import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DateInput,
  EmptyState,
  Field,
  Modal,
  Notice,
  NumberInput,
  PageHeader,
  Select,
  TableWrap,
  TextInput,
  td,
  tdR,
  th,
  thR,
} from '../components/ui';
import { isValidDate, todayStr } from '../domain/dates';
import { TEMP_FOOD_RATE, menuCostAmount, menuCostRate, menuVersionAt } from '../domain/estimate';
import { uid } from '../domain/factory';
import { fmt } from '../domain/format';
import { CHANNEL_LABEL } from '../domain/labels';
import { CHANNELS, type Menu, type MenuVersion } from '../domain/types';
import { useApp, useData } from '../state/AppContext';

const newVersion = (): MenuVersion => ({
  id: uid('mv'),
  effectiveFrom: todayStr(),
  prices: { hall: null, delivery: null, takeout: null },
  costMode: 'unknown',
  costAmount: null,
  costRate: null,
  costSource: 'actual',
  note: '',
});

export function Menus() {
  const data = useData();
  const { update, confirm } = useApp();
  const [asOf, setAsOf] = useState(todayStr());
  const [showOff, setShowOff] = useState(false);
  const [editor, setEditor] = useState<{ menu: Menu; version: MenuVersion; isNewMenu: boolean; isNewVersion: boolean } | null>(null);
  const channels = data.store?.channels.length ? CHANNELS.filter((c) => data.store!.channels.includes(c)) : CHANNELS;

  const menus = data.menus.filter((m) => showOff || m.onSale);
  const missingCost = data.menus.filter((m) => {
    if (!m.onSale) return false;
    const v = menuVersionAt(m, asOf);
    return !v || v.costMode === 'unknown';
  }).length;

  return (
    <>
      <PageHeader
        title="메뉴와 원가"
        description="판매 방식별 판매가격과 재료 원가를 적용 시작일과 함께 기록합니다. 정확한 레시피·재고 관리는 이번 버전에 포함되지 않습니다."
        actions={
          <Button variant="primary" onClick={() => setEditor({ menu: { id: uid('menu'), name: '', onSale: true, versions: [] }, version: newVersion(), isNewMenu: true, isNewVersion: true })}>
            메뉴 추가
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="기준일 (이 날짜에 적용되는 가격·원가 표시)">{(id) => <DateInput id={id} value={asOf} onChange={(v) => isValidDate(v) && setAsOf(v)} />}</Field>
          <Checkbox label="판매 중지 메뉴 포함" checked={showOff} onChange={setShowOff} />
          {missingCost > 0 && <Badge tone="red">판매 중 메뉴 {missingCost}개 원가 미입력</Badge>}
        </div>
        <Notice className="mt-3">
          원가 미입력은 0원으로 계산하지 않습니다. 원가율 {TEMP_FOOD_RATE}%는 원가를 모를 때 직접 선택할 수 있는 <b>임시 추정값</b>일 뿐이며, 업종 평균이나 검증된 기본값이 아닙니다.
        </Notice>
      </Card>

      <div className="mt-4">
        {!menus.length ? (
          <EmptyState title="등록된 메뉴가 없습니다" description="메뉴를 등록하면 판매 방식별 원가율과 메뉴당 남는 금액을 볼 수 있습니다. 매출 입력은 메뉴 없이도 가능합니다." />
        ) : (
          <Card title={`메뉴 ${menus.length}개`} subtitle="원가율 = 원가 ÷ 해당 판매 방식 판매가격. 메뉴별 판매량을 받지 않으므로 전체 원가율과 같지 않습니다.">
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>메뉴</th>
                  <th className={th}>적용 시작일</th>
                  {channels.map((c) => (
                    <th key={c} className={thR}>
                      {CHANNEL_LABEL[c]} 가격 / 원가율
                    </th>
                  ))}
                  <th className={thR}>재료 원가</th>
                  <th className={th}>원가 상태</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {menus.map((m) => {
                  const v = menuVersionAt(m, asOf);
                  const future = m.versions.filter((x) => x.effectiveFrom > asOf).length;
                  return (
                    <tr key={m.id} className={m.onSale ? '' : 'text-slate-400'}>
                      <td className={td}>
                        <div className="font-medium">{m.name}</div>
                        <div className="flex gap-1">
                          {!m.onSale && <Badge>판매 중지</Badge>}
                          {m.versions.length > 1 && <Badge tone="violet">버전 {m.versions.length}개</Badge>}
                          {future > 0 && <Badge tone="blue">예정 {future}</Badge>}
                        </div>
                      </td>
                      <td className={td}>{v ? v.effectiveFrom : <span className="text-slate-400">기준일에 적용 버전 없음</span>}</td>
                      {channels.map((c) => {
                        const price = v?.prices[c] ?? null;
                        const rate = v ? menuCostRate(v, c) : null;
                        return (
                          <td key={c} className={tdR}>
                            <div>{price === null ? <span className="text-slate-400">판매 안 함</span> : fmt(price, 'won')}</div>
                            <div className="text-xs text-slate-500">{price !== null ? (rate === null ? '원가율 —' : `원가율 ${rate.toFixed(1)}%`) : ''}</div>
                          </td>
                        );
                      })}
                      <td className={tdR}>
                        {v?.costMode === 'amount' && v.costAmount !== null && fmt(v.costAmount, 'won')}
                        {v?.costMode === 'rate' && `${v.costRate}% (${channels.map((c) => {
                          const a = menuCostAmount(v, c);
                          return a === null ? null : `${CHANNEL_LABEL[c]} ${fmt(a, 'won')}`;
                        }).filter(Boolean).join(', ')})`}
                        {(!v || v.costMode === 'unknown') && <span className="text-slate-400">—</span>}
                      </td>
                      <td className={td}>
                        {!v || v.costMode === 'unknown' ? <Badge tone="red">원가 미입력</Badge> : v.costSource === 'actual' ? <Badge tone="green">실제</Badge> : <Badge tone="amber">추정</Badge>}
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" onClick={() => setEditor({ menu: m, version: { ...newVersion(), prices: { ...(v?.prices ?? newVersion().prices) }, costMode: v?.costMode ?? 'unknown', costAmount: v?.costAmount ?? null, costRate: v?.costRate ?? null, costSource: v?.costSource ?? 'actual' }, isNewMenu: false, isNewVersion: true })}>
                            가격·원가 변경
                          </Button>
                          {v && (
                            <Button size="sm" variant="ghost" onClick={() => setEditor({ menu: m, version: { ...v, prices: { ...v.prices } }, isNewMenu: false, isNewVersion: false })}>
                              버전 정정
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => update((d) => ({ ...d, menus: d.menus.map((x) => (x.id === m.id ? { ...x, onSale: !x.onSale } : x)) }), m.onSale ? '판매 중지로 바꿨습니다.' : '판매 중으로 바꿨습니다.')}>
                            {m.onSale ? '판매 중지' : '판매 재개'}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={async () => {
                              if (await confirm({ title: '메뉴 삭제', message: `"${m.name}"과 모든 가격·원가 버전을 삭제합니다. 이미 저장된 매출·비용 실적은 바뀌지 않습니다.`, confirmText: '삭제' }))
                                update((d) => ({ ...d, menus: d.menus.filter((x) => x.id !== m.id) }), '메뉴를 삭제했습니다.');
                            }}
                          >
                            삭제
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Card>
        )}
      </div>
      {editor && <MenuEditor {...editor} onClose={() => setEditor(null)} />}
    </>
  );
}

function MenuEditor({ menu, version, isNewMenu, isNewVersion, onClose }: { menu: Menu; version: MenuVersion; isNewMenu: boolean; isNewVersion: boolean; onClose: () => void }) {
  const { update } = useApp();
  const data = useData();
  const [name, setName] = useState(menu.name);
  const [v, setV] = useState<MenuVersion>(version);
  const [err, setErr] = useState<Record<string, string>>({});
  const channels = data.store?.channels.length ? CHANNELS.filter((c) => data.store!.channels.includes(c)) : CHANNELS;

  const save = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = '메뉴명을 입력하세요.';
    if (!isValidDate(v.effectiveFrom)) e.effectiveFrom = '적용 시작일을 입력하세요.';
    if (menu.versions.some((x) => x.id !== v.id && x.effectiveFrom === v.effectiveFrom)) e.effectiveFrom = '같은 적용 시작일의 버전이 이미 있습니다. 그 버전을 정정하세요.';
    if (CHANNELS.every((c) => v.prices[c] === null)) e.prices = '판매가격을 하나 이상 입력하세요.';
    if (CHANNELS.some((c) => v.prices[c] !== null && v.prices[c]! < 0)) e.prices = '가격은 0 이상입니다.';
    if (v.costMode === 'amount' && v.costAmount === null) e.cost = '원가 금액을 입력하거나 "모름"을 선택하세요.';
    if (v.costMode === 'rate' && (v.costRate === null || v.costRate < 0 || v.costRate > 100)) e.cost = '원가율은 0~100% 사이로 입력하세요.';
    if (v.costMode === 'amount' && v.costAmount !== null) {
      const over = CHANNELS.find((c) => v.prices[c] !== null && v.prices[c]! > 0 && v.costAmount! > v.prices[c]!);
      if (over) e.costWarn = `원가가 ${CHANNEL_LABEL[over]} 판매가격보다 큽니다. 확인하세요.`;
    }
    setErr(e);
    if (Object.keys(e).some((k) => k !== 'costWarn')) return;
    const clean: MenuVersion = {
      ...v,
      costAmount: v.costMode === 'amount' ? v.costAmount : null,
      costRate: v.costMode === 'rate' ? v.costRate : null,
    };
    update((d) => {
      const exists = d.menus.some((m) => m.id === menu.id);
      const base = exists ? d.menus.find((m) => m.id === menu.id)! : menu;
      const versions = isNewVersion ? [...base.versions, clean] : base.versions.map((x) => (x.id === clean.id ? clean : x));
      const updated: Menu = { ...base, name: name.trim(), versions };
      return { ...d, menus: exists ? d.menus.map((m) => (m.id === menu.id ? updated : m)) : [...d.menus, updated] };
    }, isNewMenu ? '메뉴를 추가했습니다.' : isNewVersion ? '새 가격·원가 버전을 추가했습니다. 적용 시작일 이전에는 기존 버전이 적용됩니다.' : '버전을 정정했습니다.');
    onClose();
  };

  return (
    <Modal
      title={isNewMenu ? '메뉴 추가' : isNewVersion ? `${menu.name} — 가격·원가 변경 (새 버전)` : `${menu.name} — 버전 정정`}
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
        <Field label="메뉴명" required error={err.name}>
          {(id) => <TextInput id={id} value={name} onChange={setName} invalid={!!err.name} />}
        </Field>
        <Field label="적용 시작일" required error={err.effectiveFrom} hint={isNewVersion ? '이 날짜부터 새 가격·원가가 적용됩니다.' : '잘못 입력한 값을 고칠 때만 정정하세요.'}>
          {(id) => <DateInput id={id} value={v.effectiveFrom} onChange={(x) => setV({ ...v, effectiveFrom: x })} />}
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-xs font-medium text-slate-700">판매 방식별 판매가격 (판매하지 않는 방식은 비워두기)</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {channels.map((c) => (
              <Field key={c} label={CHANNEL_LABEL[c]}>
                {(id) => <NumberInput id={id} value={v.prices[c]} onChange={(x) => setV({ ...v, prices: { ...v.prices, [c]: x } })} suffix="원" placeholder="판매 안 함" />}
              </Field>
            ))}
          </div>
          {err.prices && <p className="mt-1 text-xs text-red-700">{err.prices}</p>}
        </div>
        <Field label="재료 원가 입력 방식">
          {(id) => (
            <Select
              id={id}
              value={v.costMode}
              onChange={(x) => setV({ ...v, costMode: x })}
              options={[
                { value: 'amount', label: '원가 금액' },
                { value: 'rate', label: '원가율 (%)' },
                { value: 'unknown', label: '모름 (원가 미입력)' },
              ]}
            />
          )}
        </Field>
        {v.costMode !== 'unknown' && (
          <Field label="값 구분">
            {(id) => (
              <Select
                id={id}
                value={v.costSource}
                onChange={(x) => setV({ ...v, costSource: x })}
                options={[
                  { value: 'actual', label: '실제값 (매입 단가로 계산)' },
                  { value: 'estimated', label: '추정값' },
                ]}
              />
            )}
          </Field>
        )}
        {v.costMode === 'amount' && (
          <Field label="1인분 재료 원가" error={err.cost} warning={err.costWarn}>
            {(id) => <NumberInput id={id} value={v.costAmount} onChange={(x) => setV({ ...v, costAmount: x })} suffix="원" />}
          </Field>
        )}
        {v.costMode === 'rate' && (
          <Field label="재료 원가율" error={err.cost} hint="판매가격 대비 비율">
            {(id) => (
              <div className="flex gap-2">
                <div className="flex-1">
                  <NumberInput id={id} value={v.costRate} onChange={(x) => setV({ ...v, costRate: x })} suffix="%" allowDecimal />
                </div>
                <Button size="sm" onClick={() => setV({ ...v, costRate: TEMP_FOOD_RATE, costSource: 'estimated', note: v.note || '임시 추정 원가율' })} title="검증된 값이 아닌 임시 추정값">
                  임시 {TEMP_FOOD_RATE}% 적용
                </Button>
              </div>
            )}
          </Field>
        )}
        <Field label="메모" className="sm:col-span-2">
          {(id) => <TextInput id={id} value={v.note} onChange={(x) => setV({ ...v, note: x })} />}
        </Field>
        {v.costMode === 'rate' && v.costRate === TEMP_FOOD_RATE && v.costSource === 'estimated' && (
          <Notice tone="warn" className="sm:col-span-2">
            임시 추정값 {TEMP_FOOD_RATE}%입니다. 업종 평균이나 검증된 값이 아니므로, 매입 단가를 확인하면 실제 원가로 바꾸세요.
          </Notice>
        )}
      </div>
    </Modal>
  );
}
