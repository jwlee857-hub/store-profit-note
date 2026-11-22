import { CHANNEL_LABEL, METRIC_META, metricLabelEasy } from '../domain/labels';
import { CHANNELS, type MetricKey, type MetricRef } from '../domain/types';
import { Field, Select } from './ui';

/** 지표 선택 목록용 짧은 쉬운 이름 (판매 방식과 관계없이) */
const EASY_SHORT: Partial<Record<MetricKey, string>> = {
  directProfit: '남은 돈',
  directProfitPerOrder: '1건당 남은 돈',
  directCostPerOrder: '1건당 든 비용',
  operatingProfit: '가게에 남은 돈',
  storeDiscount: '쿠폰·할인으로 낸 돈',
};

export function validMetricRef(ref: MetricRef): MetricRef {
  const m = METRIC_META[ref.key];
  if (!m.channelScoped) return { ...ref, channel: 'all' };
  if (ref.key === 'visitors') return { ...ref, channel: 'hall' };
  if (ref.channel === 'all' && !m.allowAll) return { ...ref, channel: 'hall' };
  return ref;
}

export function MetricPicker({ value, onChange, label = '지표' }: { value: MetricRef; onChange: (r: MetricRef) => void; label?: string }) {
  const meta = METRIC_META[value.key];
  const channelOptions = [
    ...(meta.allowAll ? [{ value: 'all' as const, label: '전체' }] : []),
    ...CHANNELS.filter((c) => value.key !== 'visitors' || c === 'hall').map((c) => ({ value: c, label: CHANNEL_LABEL[c] })),
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={label}>
        {(id) => (
          <Select
            id={id}
            value={value.key}
            onChange={(k: MetricKey) => onChange(validMetricRef({ key: k, channel: value.channel }))}
            // 선택 목록에도 쉬운 이름을 함께 (예: 판매 방식 비용을 뺀 금액 — 남은 돈)
            options={(Object.keys(METRIC_META) as MetricKey[]).map((k) => ({ value: k, label: EASY_SHORT[k] ? `${METRIC_META[k].label} — ${EASY_SHORT[k]}` : METRIC_META[k].label }))}
          />
        )}
      </Field>
      <Field label="대상" hint={metricLabelEasy(value.key, value.channel)}>
        {(id) =>
          meta.channelScoped ? (
            <Select id={id} value={value.channel} onChange={(c) => onChange(validMetricRef({ ...value, channel: c }))} options={channelOptions} />
          ) : (
            <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">가게 전체</div>
          )
        }
      </Field>
    </div>
  );
}
