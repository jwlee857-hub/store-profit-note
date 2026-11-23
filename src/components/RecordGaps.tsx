import type { PeriodSummary } from '../domain/calc';
import { shortDate } from '../domain/dates';
import { CHANNEL_LABEL } from '../domain/labels';
import { monthOf } from '../domain/months';
import { recordGaps, type RecordGap } from '../domain/review';
import { useApp, useData } from '../state/AppContext';
import { Button, Notice } from './ui';

/** 빠진 기록으로 이동: 매출 미입력은 그 날·경로의 간편 입력, 할인 미입력은 그 기간·경로의 기록 목록 */
export function gapTarget(g: RecordGap): Record<string, string> {
  const first = g.dates[0];
  const last = g.dates[g.dates.length - 1];
  if (g.kind === 'sales') return { tab: 'daily', month: monthOf(first), quick: '1', date: first, channel: g.channel, route: g.routeId };
  return { tab: 'daily', month: monthOf(last), from: first, to: last, route: g.routeId, channel: g.channel, need: 'discount' };
}

/**
 * 성과 확인·문제 진단 공통: 비교 판정을 보류하게 만든 빠진 기록과 '빠진 기록 채우기'.
 * 부분 합계는 화면에 그대로 보이고, 이 목록을 채우면 증감·판정이 계산된다.
 */
export function RecordGapsNotice({ periods }: { periods: [string, PeriodSummary][] }) {
  const data = useData();
  const { navigate } = useApp();
  const rows = periods.flatMap(([label, s]) => recordGaps(data, s).map((g) => ({ label, g })));
  if (!rows.length) return null;
  const routeName = (id: string) => data.routes.find((r) => r.id === id)?.name ?? '(삭제된 경로)';
  const when = (g: RecordGap) => (g.dates.length === 1 ? shortDate(g.dates[0]) : `${shortDate(g.dates[0])}~${shortDate(g.dates[g.dates.length - 1])}`);
  return (
    <Notice tone="warn">
      <p className="font-medium">빠진 기록이 있어 일부 비교를 보류했어요</p>
      <p className="mt-0.5 text-sm">입력된 기록만 더한 값은 보여 주지만, 그 값으로 증감·경고·목표 달성은 판정하지 않아요. 다 입력된 지표는 그대로 비교해요.</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map(({ label, g }) => (
          <li key={`${label}|${g.kind}|${g.channel}|${g.routeId}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {label} · {routeName(g.routeId)}({CHANNEL_LABEL[g.channel]}) ·{' '}
              {g.kind === 'sales' ? `매출 미입력 ${g.dates.length}일 (${when(g)})` : `할인액 미입력 매출 기록 ${g.dates.length}일치 (${when(g)})`}
            </span>
            <Button size="sm" onClick={() => navigate('sales', gapTarget(g))}>
              {g.kind === 'sales' ? '빠진 기록 채우기' : '할인액 채우기'}
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-amber-800">실제로 팔지 않은 날·경로는 기록 화면에서 ‘매출 없음’으로 확인하면 0원으로 집계해요. 휴업일은 채우지 않아도 돼요.</p>
    </Notice>
  );
}
