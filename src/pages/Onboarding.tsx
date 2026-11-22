import { useState } from 'react';
import { Logo } from '../components/Logo';
import { Button, Card, Checkbox, Field, NumberInput, Notice, TextInput } from '../components/ui';
import { WEEKDAY_LABELS, addDays, todayStr } from '../domain/dates';
import { registerStoreData, type DeliveryAppInput } from '../domain/factory';
import { CHANNEL_LABEL } from '../domain/labels';
import { generateSample } from '../domain/sample';
import { CHANNELS, type Channel } from '../domain/types';
import { useApp } from '../state/AppContext';
import { readRecovery } from '../storage/storage';
import { ImportButton, StorageGuide, downloadText } from './DataManagement';

export function Onboarding() {
  const { replaceAll, navigate, loadError } = useApp();
  const [mode, setMode] = useState<'choose' | 'register' | 'delivery'>('choose');
  const [name, setName] = useState('');
  const [channels, setChannels] = useState<Channel[]>(['hall']);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [err, setErr] = useState<Record<string, string>>({});
  const recovery = loadError ? readRecovery() : null;

  const startSample = () => {
    replaceAll(generateSample(addDays(todayStr(), -1)), '샘플 데이터를 불러왔습니다.');
    navigate('dashboard');
  };

  const finish = (apps: DeliveryAppInput[], directDelivery: boolean) => {
    const d = registerStoreData({ name, channels: CHANNELS.filter((c) => channels.includes(c)), regularOpenDays: days, deliveryApps: apps, directDelivery });
    replaceAll(d, '가게를 등록했습니다. 필요한 설정을 이어서 입력하세요.');
    navigate('store');
  };

  const register = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = '가게명을 입력하세요.';
    if (!channels.length) e.channels = '판매 방식을 하나 이상 선택하세요.';
    setErr(e);
    if (Object.keys(e).length) return;
    // 배달은 매출을 넣을 주문 경로가 배달앱별로 필요해서, 쓰는 배달앱을 한 단계 더 묻는다
    if (channels.includes('delivery')) setMode('delivery');
    else finish([], false);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8 text-center">
        <p className="text-sm font-medium text-slate-500">베타</p>
        <div className="mt-2">
          <Logo size="lg" as="h1" />
        </div>
        <p className="mt-2 text-slate-600">
          홀·배달·포장 매출과 비용을 기록하고, 변화의 원인을 확인하고, 실행 계획을 해본 뒤 <b>가게 전체 영업이익</b>이 나아졌는지 확인합니다.
        </p>
      </div>

      {loadError && (
        <Notice tone="error" className="mb-6">
          <p>저장된 데이터를 불러오지 못했습니다: {loadError}</p>
          <p className="mt-1">원본 데이터는 지우지 않고 이 브라우저에 따로 보관해 두었습니다. 먼저 원본 파일을 저장해 두세요. 백업 파일이 있으면 불러와서 복원할 수 있습니다.</p>
          {recovery && (
            <Button size="sm" className="mt-2" onClick={() => downloadText(recovery, `가게이익노트-원본보관-${todayStr()}.json`)}>
              원본 데이터 파일로 저장
            </Button>
          )}
        </Notice>
      )}

      {mode === 'choose' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h2 className="text-lg font-semibold">샘플 데이터로 둘러보기</h2>
            <p className="mt-2 text-sm text-slate-600">
              가상의 식당 데이터로 연속된 두 개의 28일 기간을 비교합니다. 홀 매출 감소, 배달 주문 증가와 주문당 이익 악화, 포장 증가가 함께 나타나는 상황입니다.
            </p>
            <Button variant="primary" className="mt-4 w-full" onClick={startSample}>
              샘플로 시작
            </Button>
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">내 가게 등록하기</h2>
            <p className="mt-2 text-sm text-slate-600">가게명과 판매 방식만 입력하면 시작할 수 있습니다. 나머지는 나중에 채워도 됩니다.</p>
            <Button variant="primary" className="mt-4 w-full" onClick={() => setMode('register')}>
              등록 시작
            </Button>
          </Card>
        </div>
      ) : mode === 'delivery' ? (
        <DeliveryAppsStep onBack={() => setMode('register')} onDone={finish} />
      ) : (
        <Card title="내 가게 등록" subtitle="최소 정보만 입력합니다. 개인정보는 입력하지 않아도 됩니다.">
          <div className="grid gap-4">
            <Field label="가게명" required error={err.name}>
              {(id) => <TextInput id={id} value={name} onChange={setName} placeholder="예: 우리동네 분식" invalid={!!err.name} />}
            </Field>
            <div>
              <p className="mb-1 text-sm font-medium text-slate-800">판매 방식 (홀·배달·포장)</p>
              <div className="flex flex-wrap gap-4">
                {CHANNELS.map((c) => (
                  <Checkbox
                    key={c}
                    label={CHANNEL_LABEL[c]}
                    checked={channels.includes(c)}
                    onChange={(v) => setChannels(v ? [...channels, c] : channels.filter((x) => x !== c))}
                  />
                ))}
              </div>
              {err.channels && <p className="mt-1 text-xs text-red-700">{err.channels}</p>}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-slate-800">정기 영업요일</p>
              <div className="flex flex-wrap gap-3">
                {WEEKDAY_LABELS.map((w, i) => (
                  <Checkbox key={w} label={w} checked={days.includes(i)} onChange={(v) => setDays(v ? [...days, i].sort() : days.filter((x) => x !== i))} />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setMode('choose')}>뒤로</Button>
              <Button variant="primary" onClick={register}>
                등록하고 시작
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="mx-auto mt-8 max-w-xl space-y-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <StorageGuide />
        <div className="flex justify-center">
          <ImportButton label="백업 파일에서 복원" />
        </div>
      </div>
    </div>
  );
}

const blankApp = (): DeliveryAppInput & { key: number; showFee: boolean } => ({ key: Math.random(), name: '', brokerageRate: null, paymentRate: null, vatExclusive: false, showFee: false });

/** 등록 2단계: 배달을 고른 경우 쓰는 배달앱을 묻고, 배달앱마다 배달 주문 경로를 만든다. 수수료는 모르면 건너뛴다. */
function DeliveryAppsStep({ onBack, onDone }: { onBack: () => void; onDone: (apps: DeliveryAppInput[], directDelivery: boolean) => void }) {
  const [apps, setApps] = useState([blankApp()]);
  const [direct, setDirect] = useState(false);
  const [err, setErr] = useState('');
  const set = (key: number, patch: Partial<DeliveryAppInput & { showFee: boolean }>) => setApps((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  const submit = () => {
    const named = apps.filter((a) => a.name.trim());
    const names = named.map((a) => a.name.trim());
    if (new Set(names).size !== names.length) return setErr('같은 이름의 배달앱이 두 번 들어갔어요.');
    if (named.some((a) => [a.brokerageRate, a.paymentRate].some((r) => r !== null && (r < 0 || r > 100)))) return setErr('수수료율은 0~100% 사이로 입력하세요.');
    if (!named.length && !direct) return setErr("배달앱 이름을 입력하거나 '배달앱 없이 직접 배달' 또는 '나중에 등록'을 고르세요.");
    setErr('');
    onDone(named, direct);
  };
  return (
    <Card title="어떤 배달앱을 쓰세요?" subtitle="배달 매출은 배달앱별로 기록합니다. 배달앱마다 매출을 넣을 주문 경로를 만들어 드려요.">
      <div className="grid gap-4">
        {apps.map((a, i) => (
          <div key={a.key} className="rounded-lg p-3 ring-1 ring-slate-200">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label={`배달앱 ${i + 1} 이름`}>{(id) => <TextInput id={id} value={a.name} onChange={(v) => set(a.key, { name: v })} placeholder="예: 쓰고 있는 배달앱 이름" />}</Field>
              </div>
              {apps.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => setApps((list) => list.filter((x) => x.key !== a.key))}>
                  빼기
                </Button>
              )}
            </div>
            {!a.showFee ? (
              <button type="button" className="mt-2 text-sm text-slate-600 underline" onClick={() => set(a.key, { showFee: true })}>
                수수료율 알면 입력하기 (모르면 나중에)
              </button>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="중개 수수료율" hint="모르면 비워 두세요. 가게 설정에서 언제든 입력할 수 있어요.">
                  {(id) => <NumberInput id={id} value={a.brokerageRate} onChange={(v) => set(a.key, { brokerageRate: v })} allowDecimal suffix="%" placeholder="모름" />}
                </Field>
                <Field label="결제 수수료율">{(id) => <NumberInput id={id} value={a.paymentRate} onChange={(v) => set(a.key, { paymentRate: v })} allowDecimal suffix="%" placeholder="모름" />}</Field>
                <div className="sm:col-span-2">
                  <Checkbox label="요율이 부가세 별도예요 (×1.1로 계산)" checked={a.vatExclusive} onChange={(v) => set(a.key, { vatExclusive: v })} />
                  <p className="mt-1 text-xs text-slate-600">순매출 기준으로 계산합니다. 기준 금액·건당 정액은 가게 설정 → 수수료 자동 계산 설정에서 바꿀 수 있어요.</p>
                </div>
              </div>
            )}
          </div>
        ))}
        <div>
          <Button size="sm" onClick={() => setApps((list) => [...list, blankApp()])}>
            + 배달앱 추가
          </Button>
        </div>
        <Checkbox label="배달앱 없이 직접 배달도 해요 (전화 주문 등)" checked={direct} onChange={setDirect} />
        {err && (
          <p className="text-sm text-red-700" role="alert">
            ⛔ {err}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onBack}>뒤로</Button>
          <Button variant="ghost" onClick={() => onDone([], false)}>
            배달앱은 나중에 등록
          </Button>
          <Button variant="primary" onClick={submit}>
            배달 경로 만들고 시작
          </Button>
        </div>
      </div>
    </Card>
  );
}
