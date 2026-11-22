import { impactText, relatedText, type Finding, type IssueGroup } from '../domain/diagnosis';

/** 대표 문제 아래에 붙는 원인 후보 목록. 확인이 필요한 후보일 뿐 원인으로 확정된 것이 아니다. */
export function RelatedCauses({ issue }: { issue: IssueGroup }) {
  if (!issue.related.length) return null;
  return (
    <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">
      <div className="text-xs font-medium text-slate-600">함께 변한 것 (원인 후보)</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {issue.related.map((r) => (
          <li key={r.id}>{relatedText(r)}</li>
        ))}
      </ul>
    </div>
  );
}

/** 영향 금액 표시: 기준(이익/매출)을 함께 적는다. 매출 기준은 이익 순위와 따로 본다는 뜻으로 회색 배지 */
export function ImpactTag({ finding, className = 'text-sm text-slate-700' }: { finding: Pick<Finding, 'impact' | 'impactBasis' | 'impactNote'>; className?: string }) {
  const t = impactText(finding);
  if (!t) return null;
  return (
    <span className={className} title={finding.impactNote}>
      {t}
      {finding.impactBasis === 'sales' && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">이익 순위와 별도</span>}
    </span>
  );
}

/** 영향 금액 계산 근거 한 줄 */
export function ImpactNote({ finding }: { finding: Pick<Finding, 'impact' | 'impactNote'> }) {
  if (finding.impact === null || !finding.impactNote) return null;
  return <p className="mt-0.5 text-xs text-slate-500">영향 계산: {finding.impactNote}</p>;
}
