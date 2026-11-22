// 진단 화면에서 해결안 등록으로 넘어갈 때 미리 채울 초안. 사용자가 확인·수정하는 제안일 뿐이다.
import { formatRange } from './dates';
import { diagnose, groupFindings, impactText, relatedText, type Finding } from './diagnosis';
import { newSolution } from './factory';
import { defaultKpisFor, kpiForFinding, suggestedCoupon, templateForFinding } from './templates';
import type { AppData, Problem, Solution } from './types';

export function solutionDraft(data: AppData, problem: Problem | null, findingId?: string | null): Solution {
  if (!problem) return newSolution();
  const periods = `분석 ${formatRange(problem.analysis)} / 비교 ${formatRange(problem.compare)}`;
  let finding: Finding | undefined;
  let related: Finding[] = [];
  if (findingId) {
    try {
      const findings = diagnose(data, problem).findings;
      finding = findings.find((f) => f.id === findingId);
      related = groupFindings(findings.filter((f) => f.tone === 'watch')).find((g) => g.id === findingId)?.related ?? [];
    } catch {
      finding = undefined;
    }
  }
  if (!finding) {
    const target = problem.channel === 'all' ? 'common' : problem.channel;
    const coupon = suggestedCoupon(data.solutions, target);
    return newSolution({
      problemId: problem.id,
      target,
      ...(target === 'delivery' ? defaultKpisFor(target) : {}),
      coupon: { amount: coupon?.amount ?? null, minOrder: null },
      evidence: `문제 진단 "${problem.name}" (${periods})`,
    });
  }
  const tpl = templateForFinding(finding.id);
  const target = finding.channel === 'all' ? 'common' : finding.channel;
  const kpis = defaultKpisFor(target, kpiForFinding(finding.id, finding.channel));
  const coupon = suggestedCoupon(data.solutions, target);
  return newSolution({
    problemId: problem.id,
    name: tpl ? tpl.name : `${finding.title} 확인·개선`,
    target,
    ...kpis,
    coupon: { amount: coupon?.amount ?? null, minOrder: null },
    direction: tpl?.direction ?? 'mixed',
    // 가설은 진단 화면 문구 그대로 — 원인으로 확정된 것이 아님
    hypothesis: finding.hypotheses.join(' '),
    evidence: `${finding.fact}${impactText(finding) ? ` (${impactText(finding)} 추정)` : ''}${
      related.length ? ` 함께 변한 것(원인 후보): ${related.map(relatedText).join(', ')}.` : ''
    } — ${periods}`,
    actions: tpl ? `${tpl.actions}\n(예시 문구입니다. 가게 상황에 맞게 고쳐 쓰세요.)` : '',
    successCriteria: tpl?.successCriteria ?? '',
    stopCriteria: tpl?.stopCriteria ?? '',
    templateId: tpl?.id ?? null,
  });
}
