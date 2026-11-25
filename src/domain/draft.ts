// 진단 화면에서 해결안 등록으로 넘어갈 때 미리 채울 초안. 사용자가 확인·수정하는 제안일 뿐이다.
import { formatRange } from './dates';
import { diagnose, groupFindings, impactText, relatedText, type Finding } from './diagnosis';
import { newSolution } from './factory';
import { hasCoupon } from './format';
import { addDays, nextMonday } from './dates';
import { defaultKpisFor, kpiForFinding, templateForFinding } from './templates';
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
    // 쿠폰 조건은 빈 값으로 시작한다 (다른 계획의 다음 쿠폰 금액은 '이 조건으로 재시험'에서만 넘긴다)
    return newSolution({
      problemId: problem.id,
      target,
      ...(target === 'delivery' ? defaultKpisFor(target) : {}),
      weekdays: problem.weekdays ?? null,
      evidence: `문제 진단 "${problem.name}" (${periods})`,
    });
  }
  const tpl = templateForFinding(finding.id);
  const target = finding.channel === 'all' ? 'common' : finding.channel;
  const kpis = defaultKpisFor(target, kpiForFinding(finding.id, finding.channel));
  return newSolution({
    problemId: problem.id,
    name: tpl ? tpl.name : `${finding.title} 확인·개선`,
    target,
    ...kpis,
    weekdays: problem.weekdays ?? null,
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

/**
 * '이 조건으로 2주 재시험': 같은 실험을 이어갈 때만 조건을 넘긴다. 저장 전에 고칠 수 있는 초안이다.
 * - 대상 배달앱·최소 주문액·핵심 지표는 그대로, 시험 쿠폰액 = 결과 판단의 다음 쿠폰 금액(null = 미정, 0 = 쿠폰 중단), 기존 쿠폰액 = 이번 시험 쿠폰액
 * - 실행 기간은 다음 주 월요일부터 2주. 결과 판단·쿠폰 사용 건수·목표값은 새로 정한다
 */
export function retestDraft(prev: Solution, today: string): Solution {
  const start = nextMonday(today);
  const next = prev.review.nextCouponAmount;
  // 쿠폰 조건이 없는 계획(예: 홀 영업시간)은 쿠폰 문구·금액을 넘기지 않는다
  const coupon = hasCoupon(prev.coupon);
  return newSolution({
    problemId: prev.problemId,
    name: `${prev.name} — ${!coupon ? '' : next === null ? '쿠폰 미정 ' : next === 0 ? '쿠폰 중단 ' : `쿠폰 ${next.toLocaleString('ko-KR')}원 `}2주 재시험`,
    target: prev.target,
    direction: prev.direction,
    hypothesis: prev.hypothesis,
    evidence: `‘${prev.name}’ 결과 판단에서 이어서 시험${prev.review.judgment ? ` — ${prev.review.judgment}` : ''}`,
    actions: prev.actions,
    owner: prev.owner,
    start,
    end: addDays(start, 13),
    kpi: prev.kpi,
    extraKpis: prev.extraKpis,
    kpiTargetMode: prev.kpiTargetMode,
    coupon: coupon ? { routeId: prev.coupon.routeId, previousAmount: prev.coupon.amount, amount: next, minOrder: prev.coupon.minOrder, usedCount: null } : { ...prev.coupon, usedCount: null },
    weekdays: prev.weekdays ?? null,
    successCriteria: prev.successCriteria,
    stopCriteria: prev.stopCriteria,
    templateId: prev.templateId,
    retestOf: prev.id,
  });
}
