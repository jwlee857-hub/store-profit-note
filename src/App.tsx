import { useEffect } from 'react';
import { Logo } from './components/Logo';
import { Dashboard } from './pages/Dashboard';
import { Diagnosis } from './pages/Diagnosis';
import { Menus } from './pages/Menus';
import { Onboarding } from './pages/Onboarding';
import { Performance } from './pages/Performance';
import { SalesCosts } from './pages/SalesCosts';
import { Solutions } from './pages/Solutions';
import { StoreSettingsPage } from './pages/StoreSettings';
import { useApp, type PageKey } from './state/AppContext';
import { storySample } from './domain/sample';
import { appToday, presetRanges, referenceDate } from './domain/periods';

/** 주 메뉴 네 곳. 기존 주소(#/diagnosis 등)는 그대로 열리고, 어느 메뉴 아래인지만 묶는다 */
const NAV: { label: string; to: PageKey; pages: PageKey[]; sub?: { key: PageKey; label: string }[] }[] = [
  { label: '홈', to: 'dashboard', pages: ['dashboard'] },
  { label: '기록', to: 'sales', pages: ['sales'] },
  {
    label: '장사 점검',
    to: 'diagnosis',
    pages: ['diagnosis', 'solutions', 'performance'],
    sub: [
      { key: 'diagnosis', label: '문제 진단' },
      { key: 'solutions', label: '실행 계획' },
      { key: 'performance', label: '성과 확인' },
    ],
  },
  {
    label: '설정',
    to: 'store',
    pages: ['store', 'menus'],
    sub: [
      { key: 'store', label: '가게 설정·백업' },
      { key: 'menus', label: '메뉴와 원가' },
    ],
  },
];

export default function App() {
  const { data, route, navigate, confirm, replaceAll, period } = useApp();

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
  // 이전 버전에서 연 샘플은 자동으로 바꾸지 않는다. 사용자가 누를 때만 새 샘플(2026년 8~11월 쿠폰 이야기)로 바꾼다
  const openNewSample = async () => {
    const ok = await confirm({
      title: '새 샘플을 열까요?',
      message: '지금 샘플(고친 내용 포함)은 지워지고, 2026년 8~11월 배달 쿠폰 시험 과정을 담은 새 샘플로 바뀝니다. 내 가게 데이터·백업 파일에는 영향이 없습니다.',
      confirmText: '새 샘플 열기',
    });
    if (ok) {
      replaceAll(storySample(), '새 샘플을 불러왔습니다.');
      navigate('dashboard');
    }
  };

  const active = NAV.find((n) => n.pages.includes(route.page));
  // 장사 점검(문제 진단)은 홈에서 고른 조회 기간(처음엔 이번 달)의 '먼저 살펴볼 변화'로 연다. 열기만 해서는 저장하지 않는다
  const go = (page: PageKey) => {
    if (page !== 'diagnosis') return navigate(page);
    const r = period ?? presetRanges('month', appToday(data), referenceDate(data));
    navigate('diagnosis', { from: r.cur.start, to: r.cur.end, cfrom: r.prev.start, cto: r.prev.end });
  };
  const navBtn = (on: boolean) => `flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm ${on ? 'bg-slate-900 font-medium text-white' : 'text-slate-800 hover:bg-slate-100'}`;

  return (
    <div className="min-h-screen pb-16 lg:flex lg:pb-0">
      <aside className="sticky top-0 z-30 border-b border-slate-200 bg-white lg:h-screen lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 lg:block lg:py-5">
          <Logo />
          <div className="max-w-[55vw] truncate text-xs text-slate-500 lg:mt-0.5 lg:max-w-none">{data.store?.name ?? '가게 미등록'} · 베타</div>
        </div>
        {/* 넓은 화면: 왼쪽 메뉴 (장사 점검·설정은 하위 화면까지) */}
        <nav aria-label="주 메뉴" className="hidden px-2 pb-3 lg:block">
          {NAV.map((n) => (
            <div key={n.label} className="mt-1">
              {n.sub ? (
                <>
                  <div className="px-3 pb-1 pt-3 text-xs font-semibold text-slate-600">{n.label}</div>
                  {n.sub.map((s) => (
                    <button key={s.key} aria-current={route.page === s.key ? 'page' : undefined} onClick={() => go(s.key)} className={navBtn(route.page === s.key)}>
                      {s.label}
                    </button>
                  ))}
                </>
              ) : (
                <button aria-current={route.page === n.to ? 'page' : undefined} onClick={() => go(n.to)} className={navBtn(route.page === n.to)}>
                  {n.label}
                </button>
              )}
            </div>
          ))}
          <p className="mt-4 px-3 text-xs leading-relaxed text-slate-600">데이터는 이 기기의 이 브라우저에만 저장돼요. 기기를 옮기려면 ‘설정 › 백업·복원’을 쓰세요.</p>
        </nav>
      </aside>
      <main className="min-w-0 flex-1">
        {data.mode === 'sample' && (
          <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 sm:px-6 sm:text-sm">
            <span className="min-w-0 truncate">
              <b>샘플 데이터 사용 중</b> · 가상 식당
            </span>
            <span className="flex shrink-0 gap-1.5">
              {!data.sampleToday && (
                <button type="button" className="rounded-md bg-amber-900 px-2 py-1 font-medium text-white" onClick={openNewSample}>
                  새 샘플 열기
                </button>
              )}
              <button type="button" className="rounded-md bg-white px-2 py-1 font-medium ring-1 ring-amber-300" onClick={leaveSample}>
                샘플 종료
              </button>
            </span>
          </div>
        )}
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">{page}</div>
      </main>
      {/* 휴대폰: 아래 고정 메뉴 네 곳 */}
      <nav aria-label="휴대폰 주 메뉴" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {NAV.map((n) => (
          <button
            key={n.label}
            aria-current={active === n ? 'page' : undefined}
            onClick={() => go(n.to)}
            className={`flex h-14 flex-col items-center justify-center text-sm ${active === n ? 'font-semibold text-slate-900' : 'text-slate-500'}`}
          >
            <span aria-hidden className={`mb-1 h-1 w-6 rounded-full ${active === n ? 'bg-slate-900' : 'bg-transparent'}`} />
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
