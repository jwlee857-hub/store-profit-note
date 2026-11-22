// 가게 이익 노트 로고: 영수증 마크 + 글자. 마크는 SVG로 그려 어느 크기에서도 선명하게 보이게 한다.
// 글자는 앱 글꼴(Pretendard)의 가장 굵은 두께로 쓴다 (이미지로 넣지 않아 화면 읽기 프로그램도 읽을 수 있음).

/** 가로형 로고의 영수증 마크: 얇은 테두리, 연한 회색 품목 줄, 합계 줄과 굵은 합계 막대, 톱니 모양 아래쪽 */
export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 34 41" className={className} aria-hidden focusable="false">
      <path
        d="M1 39.5V3.5Q1 1 3.5 1H30.5Q33 1 33 3.5V39.5L29.8 36L26.6 39.5L23.4 36L20.2 39.5L17 36L13.8 39.5L10.6 36L7.4 39.5L4.2 36L1 39.5Z"
        fill="#fff"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="miter"
      />
      <g stroke="#cfcdc8" strokeWidth="0.6" strokeLinecap="round">
        <path d="M4.8 8H21M24.4 8H29M4.8 12.3H21M24.4 12.3H29M4.8 16.8H21M24.4 16.8H29" />
      </g>
      <path d="M4.8 23.2H29" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" />
      <rect x="4.8" y="26.4" width="24.2" height="4.3" rx="0.6" fill="currentColor" />
    </svg>
  );
}

/** 가로형 로고. size: sm = 메뉴 머리글, lg = 첫 화면 */
export function Logo({ size = 'sm', as: Tag = 'div' }: { size?: 'sm' | 'lg'; as?: 'div' | 'h1' }) {
  const lg = size === 'lg';
  return (
    <Tag className={`inline-flex items-center text-[#171412] ${lg ? 'gap-3' : 'gap-2'}`}>
      <LogoMark className={lg ? 'h-12 w-auto sm:h-14' : 'h-6 w-auto'} />
      <span className={`font-black tracking-tight ${lg ? 'text-3xl sm:text-4xl' : 'text-base'}`}>가게 이익 노트</span>
    </Tag>
  );
}
