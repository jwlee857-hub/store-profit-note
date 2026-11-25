import { WEEKDAY_LABELS } from '../domain/dates';

/** 적용 요일 (선택): 아무것도 고르지 않으면 전체 기간. 월~일 순서로 보여준다 */
export function WeekdayPicker({ value, onChange, label = '적용 요일 (선택)', hint = '고르지 않으면 전체 기간으로 비교해요. 고르면 실행 전후의 같은 요일끼리 비교해요.' }: { value: number[] | null | undefined; onChange: (v: number[] | null) => void; label?: string; hint?: string }) {
  const set = new Set(value ?? []);
  const toggle = (d: number) => {
    const next = new Set(set);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onChange(next.size ? [...next].sort((a, b) => a - b) : null);
  };
  return (
    <fieldset aria-label={label}>
      <legend className="mb-1 text-sm font-medium text-slate-800">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={set.has(d)}
            onClick={() => toggle(d)}
            className={`min-w-10 rounded-lg px-2.5 py-1.5 text-sm font-medium ring-1 ${set.has(d) ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300'}`}
          >
            {WEEKDAY_LABELS[d]}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </fieldset>
  );
}
