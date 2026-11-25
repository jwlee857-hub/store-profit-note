import { krDate } from '../domain/dates';
import { markDayClosed, markDayNoSales } from '../domain/entry';
import { useApp } from '../state/AppContext';
import { Button } from './ui';

/**
 * 마감 미입력 영업일(기록도 '매출 없음' 확인도 없는 날): 0원으로 보지 않고 부분 합계로 둔다.
 * 세 가지 중 하나로 정리한다 — 매출 입력 / 매출 없음 확인(0원 확인) / 임시 휴업
 */
export function UnclosedDays({ days, onEnter, max = 3 }: { days: string[]; onEnter: (d: string) => void; max?: number }) {
  const { update } = useApp();
  if (!days.length) return null;
  const shown = days.slice(-max).reverse();
  return (
    <div aria-label="마감 미입력" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
      <ul className="space-y-1.5">
        {shown.map((d) => (
          <li key={d} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <b>
              <span aria-hidden>⚠ </span>
              {krDate(d)} 마감 미입력
            </b>
            <Button size="sm" onClick={() => onEnter(d)}>
              매출 입력
            </Button>
            <Button size="sm" onClick={() => update((x) => markDayNoSales(x, d), `${krDate(d)}을 매출 없음(0원)으로 확인했어요.`)}>
              매출 없음 확인
            </Button>
            <Button size="sm" onClick={() => update((x) => markDayClosed(x, d), `${krDate(d)}을 임시 휴업으로 바꿨어요.`)}>
              임시 휴업
            </Button>
          </li>
        ))}
      </ul>
      {days.length > shown.length && <p className="mt-1">외 {days.length - shown.length}일 더 있어요.</p>}
      <p className="mt-1 text-xs text-amber-800">기록이 없는 영업일은 0원으로 보지 않아요. 그 기간 합계는 입력된 기록만 더한 부분 합계이고, 영향을 받는 증감·목표 판정은 보류해요.</p>
    </div>
  );
}
