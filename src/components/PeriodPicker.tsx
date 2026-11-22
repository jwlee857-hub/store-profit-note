import { daysInclusive, formatRange, isValidRange, previousRange } from '../domain/dates';
import { rangesEndingAt, recentRanges, referenceDate } from '../domain/periods';
import type { AppData, DateRange } from '../domain/types';
import { Button } from './ui';

/** 기준일·기본 기간은 domain/periods.ts 한 곳에서 계산한다 */
export const latestDataDate = referenceDate;
export const defaultRanges = recentRanges;

function RangeInputs({ label, value, onChange }: { label: string; value: DateRange; onChange: (r: DateRange) => void }) {
  const valid = isValidRange(value);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          aria-label={`${label} 시작일`}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
          value={value.start}
          onChange={(e) => onChange({ ...value, start: e.target.value })}
        />
        <span className="text-slate-400">~</span>
        <input
          type="date"
          aria-label={`${label} 종료일`}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
          value={value.end}
          onChange={(e) => onChange({ ...value, end: e.target.value })}
        />
        {valid && <span className="text-xs text-slate-500">{daysInclusive(value.start, value.end)}일</span>}
      </div>
      {!valid && <span className="text-xs text-red-700">시작일이 종료일보다 늦거나 날짜가 비어 있습니다.</span>}
    </div>
  );
}

export function PeriodPicker({
  data,
  cur,
  prev,
  onChange,
}: {
  data: AppData;
  cur: DateRange;
  prev: DateRange;
  onChange: (cur: DateRange, prev: DateRange) => void;
}) {
  const end = referenceDate(data);
  const preset = (days: number) => {
    const r = rangesEndingAt(end, days);
    onChange(r.cur, r.prev);
  };
  const overlap = isValidRange(cur) && isValidRange(prev) && cur.start <= prev.end && prev.start <= cur.end;
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
          <RangeInputs label="조회 기간" value={cur} onChange={(r) => onChange(r, prev)} />
          <RangeInputs label="비교 기간" value={prev} onChange={(r) => onChange(cur, r)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => preset(7)}>
            최근 7일
          </Button>
          <Button size="sm" onClick={() => preset(28)}>
            최근 28일
          </Button>
          <Button
            size="sm"
            onClick={() => isValidRange(cur) && onChange(cur, previousRange(cur))}
            title="조회 기간과 같은 길이의 직전 기간"
          >
            비교 = 직전 같은 기간
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        기준일은 가장 최근 매출 입력일({end.replace(/-/g, '.')})입니다.
        {isValidRange(cur) && isValidRange(prev) && ` 조회 ${formatRange(cur)} / 비교 ${formatRange(prev)}`}
      </p>
      {overlap && <p className="mt-1 text-xs text-amber-700">조회 기간과 비교 기간이 겹칩니다.</p>}
    </div>
  );
}
