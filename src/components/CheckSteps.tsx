// 장사 점검의 세 단계: 발견한 변화(문제 진단) → 해볼 일(실행 계획) → 결과(성과 확인).
// 한 가지 일을 연 상태면 같은 문제·계획으로 이어서 연다.
import { useApp } from '../state/AppContext';

type Step = 'diagnosis' | 'solutions' | 'performance';

export function CheckSteps({ current, problemId, solutionId }: { current: Step; problemId?: string | null; solutionId?: string | null }) {
  const { navigate } = useApp();
  const steps: { key: Step; label: string; sub: string; go: () => void }[] = [
    { key: 'diagnosis', label: '발견한 변화', sub: '문제 진단', go: () => navigate('diagnosis', problemId ? { problem: problemId } : {}) },
    {
      key: 'solutions',
      label: '해볼 일',
      sub: '실행 계획',
      go: () => navigate('solutions', { ...(problemId ? { problem: problemId } : {}), ...(solutionId ? { solution: solutionId } : {}) }),
    },
    { key: 'performance', label: '결과', sub: '성과 확인', go: () => navigate('performance', solutionId ? { solution: solutionId } : {}) },
  ];
  return (
    <nav aria-label="장사 점검 단계" className="mb-4">
      <ol className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {steps.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              aria-current={current === s.key ? 'step' : undefined}
              onClick={s.go}
              className={`flex w-full flex-col items-center rounded-lg px-1 py-1.5 text-center ${current === s.key ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <span className="text-sm">
                {i + 1}. {s.label}
              </span>
              <span className="text-xs font-normal text-slate-500">{s.sub}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
