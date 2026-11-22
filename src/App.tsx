import { useEffect, useState } from 'react';
import { Logo } from './components/Logo';
import { Button } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Diagnosis } from './pages/Diagnosis';
import { Menus } from './pages/Menus';
import { Onboarding } from './pages/Onboarding';
import { Performance } from './pages/Performance';
import { SalesCosts } from './pages/SalesCosts';
import { Solutions } from './pages/Solutions';
import { StoreSettingsPage } from './pages/StoreSettings';
import { useApp, type PageKey } from './state/AppContext';

const NAV_GROUPS: { title: string; items: { key: PageKey; label: string }[] }[] = [
  {
    title: '매일 기록',
    items: [
      { key: 'dashboard', label: '홈' },
      { key: 'sales', label: '매출과 비용' },
    ],
  },
  {
    title: '주간 점검',
    items: [
      { key: 'diagnosis', label: '문제 진단' },
      { key: 'solutions', label: '실행 계획' },
      { key: 'performance', label: '성과 확인' },
    ],
  },
  {
    title: '설정',
    items: [
      { key: 'store', label: '가게 설정·백업' },
      { key: 'menus', label: '메뉴와 원가' },
    ],
  },
];

export default function App() {
  const { data, route, navigate, confirm, replaceAll } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  // Recharts는 글자 폭 측정용 숨김 span(마지막 축 눈금·툴팁 글자)을 body에 남긴다.
  // 화면 전환·샘플 종료 때 지워 이전 화면의 글자가 본문에 남지 않게 한다. 필요하면 Recharts가 다시 만든다.
  useEffect(() => {
    document.getElementById('recharts_measurement_span')?.remove();
  }, [route.page, data === null, data?.mode]);

  if (!data) return <Onboarding />;

  const page = (() => {
    switch (route.page) {
      case 'dashboard':
        return <Dashboard />;
      case 'store':
        return <StoreSettingsPage />;
      case 'menus':
        return <Menus />;
      case 'sales':
        return <SalesCosts />;
      case 'diagnosis':
        return <Diagnosis />;
      case 'solutions':
        return <Solutions />;
      case 'performance':
        return <Performance />;
    }
  })();

  const leaveSample = async () => {
    const ok = await confirm({
      title: '샘플을 종료할까요?',
      message: '샘플 데이터가 삭제되고 첫 화면으로 돌아갑니다. 이후 내 가게를 등록할 수 있습니다.',
      confirmText: '샘플 종료',
    });
    if (ok) replaceAll(null, '샘플 데이터를 삭제했습니다.');
  };

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 z-30 border-b border-slate-200 bg-white lg:h-screen lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-3 lg:block lg:py-5">
          <div>
            <Logo />
            <div className="mt-0.5 max-w-[60vw] truncate text-xs text-slate-500 lg:max-w-none">{data.store?.name ?? '가게 미등록'} · 베타</div>
          </div>
          <button className="rounded-lg px-3 py-1.5 text-sm ring-1 ring-slate-300 lg:hidden" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            메뉴
          </button>
        </div>
        <nav aria-label="주 메뉴" className={`${menuOpen ? 'block' : 'hidden'} border-t border-slate-100 px-2 pb-3 lg:block lg:border-0`}>
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="mt-2">
              <div className="px-3 pb-1 pt-2 text-xs font-semibold text-slate-600">{g.title}</div>
              {g.items.map((n) => (
                <button
                  key={n.key}
                  aria-current={route.page === n.key ? 'page' : undefined}
                  onClick={() => {
                    navigate(n.key);
                    setMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm ${
                    route.page === n.key ? 'bg-slate-900 font-medium text-white' : 'text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  {n.label}
                </button>
              ))}
            </div>
          ))}
          <p className="mt-4 px-3 text-xs leading-relaxed text-slate-600">데이터는 이 기기의 이 브라우저에만 저장되고 다른 기기와 자동 공유되지 않습니다. ‘가게 설정·백업’에서 백업 파일을 저장하세요.</p>
        </nav>
      </aside>
      <main className="min-w-0 flex-1">
        {data.mode === 'sample' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6">
            <span>
              <b>샘플 데이터 사용 중</b> — 가상의 식당·플랫폼·요율입니다. 실제 가게의 수치가 아닙니다.
            </span>
            <Button size="sm" onClick={leaveSample}>
              샘플 종료하고 내 가게 등록
            </Button>
          </div>
        )}
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">{page}</div>
      </main>
    </div>
  );
}
