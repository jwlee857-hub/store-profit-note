// '먼저 살펴볼 변화' 공통 조각 (홈 카드 · 장사 점검 첫 카드).
// - 추정 영향 금액은 순위를 정하려고 계산한 값이라, 가게 전체 이익의 실제 전후 차이와 나란히 두고 이름을 붙인다.
// - 변화가 없거나 자료가 모자라면 어떤 기록이 더 필요한지만 알려 주고 변화를 지어내지 않는다.
import { comparableValue, type PeriodSummary } from '../domain/calc';
import { impactName, type Finding } from '../domain/diagnosis';
import { fmtSigned } from '../domain/format';
import { CHANNEL_LABEL } from '../domain/labels';
import { recordGaps } from '../domain/review';
import type { AppData } from '../domain/types';
import { useApp } from '../state/AppContext';
import { gapTarget } from './RecordGaps';
import { More, manText } from './ui';

const signedMan = (n: number) => `${n < 0 ? '−' : '+'}${manText(Math.abs(n))}`;

/** 접힌 상세: '줄어든 손님 수로 추정한 금액 −124만 원 = 줄어든 손님 170명 × …' + 가게 전체 이익의 실제 전후 차이 */
export function ImpactDetail({ finding, s, p }: { finding: Pick<Finding, 'id' | 'impact' | 'impactBasis' | 'impactNote'>; s: PeriodSummary; p: PeriodSummary }) {
  if (finding.impact === null) return null;
  const o0 = comparableValue(p.operatingProfit);
  const o1 = comparableValue(s.operatingProfit);
  return (
    <More summary="추정 금액과 계산 근거" className="mt-2">
      <div className="space-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800" aria-label="추정 영향 근거">
        <p>
          {impactName(finding)}
          {finding.impactBasis === 'sales' ? '(매출 기준)' : ''}: <b className="tabular">{signedMan(finding.impact)}</b>
        </p>
        {finding.impactNote && <p className="text-xs text-slate-600">계산: {finding.impactNote}</p>}
        <p className="text-xs text-slate-700">
          가게 전체 이익의 실제 전후 차이: <span className="tabular">{o0 !== null && o1 !== null ? fmtSigned(o1 - o0, 'won') : '지금은 비교할 수 없음'}</span>
          {' — '}위 추정 금액은 무엇부터 볼지 정하려고 계산한 값이라 실제로 줄어든 이익과 달라요.
        </p>
      </div>
    </More>
  );
}

/** 살펴볼 변화가 없을 때: 자료가 모자라면 무엇을 더 기록해야 하는지, 충분하면 '기준 이상 변화 없음' */
export function NeedMoreRecords({ data, s, p, than }: { data: AppData; s: PeriodSummary; p: PeriodSummary; than: string }) {
  const { navigate } = useApp();
  const gaps = [...recordGaps(data, s), ...recordGaps(data, p)].filter((g) => g.kind === 'sales');
  const routeName = (id: string) => data.routes.find((r) => r.id === id)?.name ?? '(삭제된 경로)';
  if (!s.entryCount || !p.entryCount)
    return (
      <p className="text-sm text-slate-700">
        {!s.entryCount ? '이 기간' : `비교 기간(${than.replace(/보다$/, '')})`}의 매출 기록이 없어 변화를 찾을 수 없어요. 그 기간 매출을 기록하면 무엇이 달라졌는지 보여 드려요.
      </p>
    );
  if (gaps.length) {
    const g = gaps[0];
    const n = gaps.reduce((k, x) => k + x.dates.length, 0);
    return (
      <div className="text-sm text-slate-700">
        <p>
          매출 기록이 빠진 곳이 {n}곳 있어 증감을 판단하지 않았어요. 예: {Number(g.dates[0].slice(5, 7))}월 {Number(g.dates[0].slice(8, 10))}일 {routeName(g.routeId)}({CHANNEL_LABEL[g.channel]}).
        </p>
        <button type="button" className="mt-1 font-medium underline" onClick={() => navigate('sales', gapTarget(g))}>
          빠진 매출 기록하기
        </button>
      </div>
    );
  }
  return <p className="text-sm text-slate-700">기준(±5%) 이상으로 나빠진 항목이 없어요.</p>;
}
