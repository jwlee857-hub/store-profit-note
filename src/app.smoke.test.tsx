// @vitest-environment jsdom
// 실제 React 앱을 jsdom에서 렌더링해 주요 흐름이 오류 없이 동작하는지 확인하는 스모크 테스트.
// 격리된 jsdom localStorage만 사용하며 실제 사용자 데이터에는 접근하지 않는다.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { AppProvider } from './state/AppContext';
import { STORAGE_KEY, serialize } from './storage/storage';
import type { AppData } from './domain/types';
import { addDays, todayStr } from './domain/dates';
import { computeSummary, netSales } from './domain/calc';
import { reviewContext } from './domain/review';
import { generateSample, storySample } from './domain/sample';
import { emptyData } from './domain/factory';
import { coopData } from './test/coopFixture';
import { monthCosts, monthLabel, monthOf, monthRangeOf, monthShort, shiftMonth } from './domain/months';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = RO;
window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

let root: Root;
let container: HTMLDivElement;
let errors: unknown[][];

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <AppProvider>
        <App />
      </AppProvider>,
    );
  });
}
function unmount() {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
}
/** 숫자 칸 값 (입력 중에는 쉼표 없이, 입력 후에는 쉼표로 보이므로 숫자만 비교) */
const numVal = (el: HTMLInputElement) => el.value.replace(/,/g, '');
const text = () => document.body.textContent ?? '';
const stored = (): AppData => JSON.parse(localStorage.getItem(STORAGE_KEY)!).data;
function findButton(label: string | RegExp, scope: ParentNode = document) {
  return Array.from(scope.querySelectorAll('button')).find((b) => (typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.textContent ?? '')));
}
function clickButton(label: string | RegExp, scope: ParentNode = document) {
  const btn = findButton(label, scope);
  if (!btn) throw new Error(`버튼 없음: ${label}`);
  act(() => btn.click());
}
async function clickLastButton(label: string) {
  const all = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.trim() === label);
  if (!all.length) throw new Error(`버튼 없음: ${label}`);
  await act(async () => all[all.length - 1].click());
}
/** 매출 금액 칸: 배달은 '할인·환불을 뺀 매출', 그 밖은 주어진 이름 */
function amountIn(label: string, scope: ParentNode = document): HTMLInputElement {
  // 판매액으로 계산 중이면 이름 뒤에 '(아래 판매액으로 계산 중)'이 붙는다
  const names = [label, '할인·환불을 뺀 매출'];
  const l = Array.from(scope.querySelectorAll('label')).find((x) => names.some((n) => x.textContent?.replace('*', '').trim().startsWith(n)));
  if (!l) throw new Error(`라벨 없음: ${label}`);
  return document.getElementById(l.htmlFor) as HTMLInputElement;
}
function inputByLabel(label: string, scope: ParentNode = document): HTMLInputElement {
  const l = Array.from(scope.querySelectorAll('label')).find((x) => x.textContent?.replace('*', '').trim() === label);
  if (!l) throw new Error(`라벨 없음: ${label}`);
  return document.getElementById(l.htmlFor) as HTMLInputElement;
}
const dialog = () => {
  const all = document.querySelectorAll('[role="dialog"]');
  return all[all.length - 1] as HTMLElement;
};
async function go(page: string, qs = '') {
  await act(async () => {
    window.location.hash = `/${page}${qs}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
function setSelect(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
/** textarea 값 넣기 */
/** '바꾸기 전과 후'의 한 지표 행: [바꾸기 전, 바꾼 후, 증감] 글자 (막대·기간 라벨 제외) */
function baRow(label: string): [string, string, string] {
  const row = document.querySelector(`[aria-label="바꾸기 전과 후"] [aria-label="${label}"]`);
  if (!row) throw new Error(`행 없음: ${label}`);
  const cell = (k: string) => {
    const el = row.querySelector(`[data-cell="${k}"]`)!;
    const v = el.querySelector('.min-w-0') ?? el;
    return v.textContent!.trim();
  };
  return [cell('before'), cell('after'), cell('delta')];
}
/** 최종 판단의 유지·수정·중단·보류 중 하나를 고른다 */
function pickDecision(label: string) {
  const l = Array.from(document.querySelectorAll('#review-record label')).find((x) => x.textContent === label);
  if (!l) throw new Error(`판단 없음: ${label}`);
  act(() => (l.querySelector('input') as HTMLInputElement).click());
}
function setText(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/**
 * 샘플 기록이 없는 과거 수요일(영업일). 샘플은 어제까지 56일을 만들므로 그보다 앞 날짜를 쓴다.
 * (예전에는 '2026-11-18'로 고정해 두어, 실행 날짜가 지나 샘플 기간에 들어가면 테스트가 깨졌다)
 */
function freeWednesday(): string {
  // 내장 샘플은 2026-08-01부터 기록이 있어 그보다 앞 날짜를 쓴다
  let d = addDays(todayStr(), -120);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 3) d = addDays(d, -1);
  return d;
}
const dayTitle = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 매출 기록`;

function registerStore(name = '테스트 식당') {
  clickButton('내 가게 시작');
  setInput(document.querySelector('input[placeholder="예: 우리동네 분식"]') as HTMLInputElement, name);
  clickButton('등록하고 시작');
}

beforeEach(() => {
  // 내장 샘플은 2026-11-23 기준으로 고정이라, 날짜를 계산하는 테스트도 같은 날로 맞춘다 (타이머는 실제 그대로)
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 23, 12, 0, 0));
  localStorage.clear();
  window.location.hash = '';
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  unmount();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('앱 스모크 테스트', () => {
  it('샘플로 시작해 모든 화면을 렌더링하고, 새로고침 후에도 유지된다', async () => {
    mount();
    expect(findButton('샘플 둘러보기')).toBeTruthy();
    expect(findButton('내 가게 시작')).toBeTruthy();
    clickButton('샘플 둘러보기');
    expect(text()).toContain('샘플 데이터 사용 중');
    // 10차 홈 순서: 최근 기간의 이익 → 오늘 기록(날짜·진행·버튼) → 먼저 살펴볼 변화 하나 → 상세(접힘)
    const body = text();
    // 11차: 기간 선택은 요약 맨 위(처음엔 이번 달), 매출·이익 두 줄 → 계산 내역(접힘)
    const sum = document.querySelector('section[aria-label="기간 요약"]')!;
    expect((sum.querySelector('select[aria-label="조회 기간"]') as HTMLSelectElement).value).toBe('month');
    expect(sum.querySelector('[aria-label="집계 기간"]')!.textContent).toBe('11.1~11.21 · 지난달 같은 날짜까지와 비교');
    expect(sum.querySelector('[aria-label="매출"]')!.textContent).toMatch(/^매출약 [\d,]+만 원약 [\d,]+만 원 (증가|감소)/);
    expect(sum.querySelector('[aria-label="이익"]')!.textContent).toMatch(/^예상 이익약 [\d,]+만 원약 [\d,]+만 원 (증가|감소)≈ 공과금/);
    const order = ['계산 내역 보기', '오늘 기록 · 11월 23일', '오늘 매출 기록하기', '먼저 살펴볼 변화', '상세 표와 차트 보기'].map((s) => body.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toContain('운영으로 남긴 이익입니다. 통장 잔액과는 다를 수 있어요.');
    expect(body).toMatch(/매출은 .*영업이익/);
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();

    const pages: [string, string][] = [
      ['store', '수수료 자동 계산 설정'],
      ['menus', '임시 추정값'],
      ['sales', '기록할 곳'],
      ['diagnosis', '먼저 확인할 것 3가지'],
      ['solutions', '예상 효과'],
      ['performance', '배달앱 A · 9월 쿠폰 3,000원 → 10월 쿠폰 2,000원 · 최소 주문 15,000원'], // 첫 실행 계획: 10월에 마친 배달 할인 효율 검토
      ['dashboard', '판매 방식별 실적'],
    ];
    for (const [p, expected] of pages) {
      await go(p);
      expect(text(), p).toContain(expected);
    }
    await go('sales', '?tab=period');
    expect(text()).toContain('날짜 수만큼 나눈 금액');
    await go('sales', '?tab=customers');
    expect(text()).toContain('30일 재구매율');
    expect(text()).toContain('정의가 달라');

    await go('diagnosis');
    clickButton('이 문제의 실행 계획 등록');
    expect(text()).toContain('1. 무엇을 바꿀까요?');
    expect(text()).toContain('2. 언제 결과를 볼까요?');
    // 목표 지표·적용 요일·예상 효과는 상세 옵션(접힘) 안에
    const opt = Array.from(dialog().querySelectorAll('details')).find((d) => d.querySelector('summary')?.textContent?.includes('상세 옵션'))!;
    expect(opt.open).toBe(false);
    expect(opt.textContent).toContain('무엇으로 확인할까요?');
    expect(opt.textContent).toContain('적용 요일');

    unmount();
    mount();
    expect(text()).toContain('샘플 데이터 사용 중');
    const reactErrors = errors.filter((e) => String(e[0]).includes('Warning') || String(e[0]).includes('Error'));
    expect(reactErrors).toEqual([]);
  });

  it('홈 → 오늘 매출 간편 입력 → 저장 → 입력 현황에 바로 표시되고 새로고침 후에도 유지', async () => {
    mount();
    clickButton('샘플 둘러보기');
    expect(text()).toContain('오늘 기록할 곳 5곳 중 0곳 완료');
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    expect(dlg.textContent).toContain('오늘 매출 기록');
    // 금액 기준 선택 탭 없이 매출 금액 칸 하나. 의미와 정산 입금액 안내가 입력 위치에 있음
    expect(findButton('할인·환불 전 판매액', dlg)).toBeUndefined();
    expect(findButton('할인·환불 반영 후 매출', dlg)).toBeUndefined();
    expect(dlg.textContent).toContain('매출 기준: 가게 부담 할인·환불 반영 후, 수수료 차감 전 금액이에요');
    // 할인·환불 입력칸은 한 세트만, 수수료 계산 여부를 고르는 체크박스는 없음
    expect(Array.from(dlg.querySelectorAll('label')).filter((l) => l.textContent!.replace('*', '').trim() === '가게 부담 할인액')).toHaveLength(1);
    expect(Array.from(dlg.querySelectorAll('label')).filter((l) => l.textContent!.replace('*', '').trim() === '환불액')).toHaveLength(1);
    expect(dlg.querySelector('input[type="checkbox"]')).toBeNull();
    expect(dlg.textContent).toContain('매출 금액과 주문 수를 넣으면 비용이 자동으로 채워져요');
    expect(dlg.textContent).toContain('배달앱 정산 입금액과는 다를 수 있어요');
    // 이전 날짜 값을 복사하지 않음
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('');
    expect(inputByLabel('완료 주문 수', dlg).value).toBe('');
    // 숫자 키패드, 열리면 매출 칸에 포커스
    expect(amountIn('오늘 매출', dlg).getAttribute('inputmode')).toBe('numeric');
    expect(document.activeElement).toBe(amountIn('오늘 매출', dlg));
    // '저장하고 비용 확인'은 간편 입력에서 빠짐
    expect(findButton('저장하고 비용 확인', dlg)).toBeUndefined();
    setInput(amountIn('오늘 매출', dlg), '300000');
    setInput(inputByLabel('완료 주문 수', dlg), '15');
    clickButton('저장하고 닫기', dlg);
    expect(text()).toContain('매출을 저장했습니다');
    expect(text()).toMatch(/소모품비 7,200원/); // 저장 알림에는 계산된 비용을 금액으로 (주문 15건 × 480원)
    expect(text()).not.toContain('설정 기준 계산');
    const hallRow = () => document.querySelector('section[aria-label="입력 현황"] li[data-channel="hall"]')!.textContent!;
    expect(hallRow()).toContain('300,000원');
    expect(hallRow()).toContain('입력 완료');
    expect(text()).toContain('오늘 기록할 곳 5곳 중 1곳 완료');
    const saved = stored().sales.find((e) => e.date === todayStr() && e.channel === 'hall')!;
    expect(saved.amountMode).toBe('net');
    expect(saved.netInput).toBe(300000);
    expect(saved.storeDiscount).toBeNull(); // 모르는 할인을 0으로 저장하지 않음
    expect(saved.costs.hallSupplies.actual).toBeNull(); // 근거 없는 비용은 빈칸
    expect(stored().prefs.lastEntry).toEqual({ channel: 'hall', routeId: 'route_hall', amountMode: 'net' });

    unmount();
    mount();
    expect(document.querySelector('section[aria-label="입력 현황"] li[data-channel="hall"]')!.textContent).toContain('300,000원');
    expect(text()).toContain('오늘 기록할 곳 5곳 중 1곳 완료');
  });

  it('입력 현황: 홀·배달·포장 그룹으로 묶고, 펼치기·주요 버튼·날짜 변경·입력/수정 후 합계와 상태를 바로 갱신한다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    await go('sales');
    const section = () => document.querySelector('section[aria-label="입력 현황"]') as HTMLElement;
    const row = (ch: string) => section().querySelector(`li[data-channel="${ch}"]`) as HTMLElement;
    const before = JSON.stringify(stored().sales);
    // 오늘(기록 없음): 세 그룹 모두 미입력, 금액 —, 세부 경로는 접힘
    expect(section().querySelectorAll('li[data-channel]')).toHaveLength(3);
    expect(section().textContent).toContain('오늘 기록할 곳 5곳 중 0곳 완료');
    for (const ch of ['hall', 'delivery', 'takeout']) {
      expect(row(ch).textContent).toContain('—');
      expect(row(ch).textContent).toContain('미입력');
      expect(row(ch).querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false');
      expect(row(ch).querySelector('ul')).toBeNull();
    }
    // 펼치기 (키보드로도 누를 수 있는 버튼, aria-expanded로 상태 전달)
    const toggle = row('delivery').querySelector('button[aria-expanded]') as HTMLButtonElement;
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)!.textContent).toContain('배달앱 B');
    // 경로별 '매출 없음' 기능 유지: 배달앱 B 매출 없음
    act(() => (row('delivery').querySelector('button[aria-label="배달앱 B · 배달 주문 없음"]') as HTMLButtonElement).click());
    expect(row('delivery').textContent).toContain('일부 입력 · 1/2곳');
    expect(row('delivery').textContent).toContain('0원');
    // 주요 버튼(이어 입력) → 남은 미입력 경로(배달앱 A)로 입력창
    clickButton('이어 입력', row('delivery'));
    let dlg = dialog();
    expect(dlg.querySelector('[aria-label="기록할 날짜와 경로"] summary')!.textContent).toContain('배달앱 A · 배달');
    setInput(amountIn('오늘 매출', dlg), '770000');
    setInput(inputByLabel('완료 주문 수', dlg), '30');
    clickButton('저장하고 닫기', dlg);
    // 입력 후 복귀: 배달 완료, 합계 770,000원
    expect(row('delivery').textContent).toContain('770,000원');
    expect(row('delivery').textContent).toContain('입력 완료');
    expect(section().textContent).toContain('오늘 기록할 곳 5곳 중 2곳 완료');
    // 홀 주요 버튼(입력) → 홀 첫 미입력 경로
    clickButton('입력', row('hall'));
    dlg = dialog();
    expect(dlg.querySelector('[aria-label="기록할 날짜와 경로"] summary')!.textContent).toContain('매장 방문 주문');
    setInput(amountIn('오늘 매출', dlg), '700000');
    setInput(inputByLabel('완료 주문 수', dlg), '40');
    clickButton('저장하고 닫기', dlg);
    expect(row('hall').textContent).toContain('700,000원');
    // 완료 그룹의 '수정' → 펼쳐서 경로 선택 (첫 경로 버튼으로 포커스)
    clickButton('수정', row('hall'));
    expect(row('hall').querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^매장 방문 주문 · 홀 /);
    // 기존 기록 수정 후 합계 갱신
    act(() => (document.activeElement as HTMLButtonElement).click());
    const det = dialog();
    setInput(inputByLabel('매출 금액', det), '650000');
    clickButton('저장', det);
    expect(row('hall').textContent).toContain('650,000원');
    // 날짜 변경: 샘플 기록이 있는 날은 바로 다른 합계·상태
    const last = JSON.parse(before).reduce((m: string, e: { date: string }) => (e.date > m ? e.date : m), '');
    const dateInput = section().querySelector('input[type="date"]') as HTMLInputElement;
    setInput(dateInput, last);
    expect(section().textContent).toContain('이 날 기록할 곳 5곳 중 5곳 완료');
    expect(row('hall').textContent).toContain('입력 완료');
    // 샘플(오늘 이전) 기록은 바뀌지 않았다
    const after = stored().sales.filter((e) => JSON.parse(before).some((b: { id: string }) => b.id === e.id));
    expect(JSON.stringify(after)).toBe(before);
  });

  it('3단계: 창을 다시 열지 않고 다섯 경로를 연속 저장한다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const date = freeWednesday(); // 샘플 기록이 없는 수요일(영업일)
    clickButton('＋ 오늘 매출 기록하기');
    let dlg = dialog();
    setInput(inputByLabel('날짜', dlg), date);
    // 오늘이 아닌 날짜: 제목과 라벨이 날짜에 맞게 바뀐다
    expect(dlg.textContent).toContain(dayTitle(date));
    expect(dlg.querySelector('[aria-label="입력 진행"]')!.textContent).toContain('기록할 곳 5곳 중 0곳 완료');
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      dlg = dialog();
      const progress = dlg.querySelector('[aria-label="입력 진행"]')!.textContent!;
      expect(progress).toContain(`기록할 곳 5곳 중 ${i}곳 완료`);
      seen.push(dlg.querySelector('[aria-label="기록할 날짜와 경로"] summary')!.textContent!.replace(/^.+? · /, '').replace(/변경$|닫기$/, '').trim());
      // 다음 경로로 넘어오면 금액·주문 수·할인·환불은 비어 있다 (이전 경로 값 복사 없음)
      expect(numVal(amountIn('매출 금액', dlg))).toBe('');
      expect(inputByLabel('완료 주문 수', dlg).value).toBe('');
      if (i === 1) {
        expect(inputByLabel('가게 부담 할인액', dlg).value).toBe('');
        expect(inputByLabel('환불액', dlg).value).toBe('');
      }
      setInput(amountIn('매출 금액', dlg), String(100000 * (i + 1)));
      setInput(inputByLabel('완료 주문 수', dlg), String(10 + i));
      if (i === 0) setInput(inputByLabel('가게 부담 할인액', dlg), '7000'); // 첫 경로만 할인 상세
      const label = i < 4 ? /^저장하고 .+ 입력$/ : '저장하고 마치기';
      expect(findButton(label, dlg)).toBeTruthy();
      clickButton(label, dlg);
      if (i < 4) expect(document.querySelectorAll('[role="dialog"]').length).toBe(1); // 창은 열린 채
    }
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(0);
    expect(text()).toContain('이 날짜의 모든 경로를 입력했어요');
    const saved = stored().sales.filter((e) => e.date === date);
    expect(saved).toHaveLength(5);
    expect(new Set(saved.map((e) => `${e.channel}-${e.routeId}`)).size).toBe(5);
    expect(new Set(seen).size).toBe(5);
    expect(saved.map((e) => e.netInput).sort((a, b) => a! - b!)).toEqual([100000, 200000, 300000, 400000, 500000]);
    expect(saved.filter((e) => e.storeDiscount !== null)).toHaveLength(1); // 할인 상세가 다음 경로로 복사되지 않음
  });

  it('할인·환불 통합 영역: 순매출 직접 입력 후 상세 추가는 이중 차감 없음, 판매액 계산은 같은 칸을 쓰고 적용할 때만 바뀐다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    // 할인·환불 칸은 한 세트뿐
    const labelCount = (t: string) => Array.from(dlg.querySelectorAll('label')).filter((l) => l.textContent!.replace('*', '').trim() === t).length;
    // A. 순매출 85,000원 직접 입력 → 상세 추가해도 매출은 그대로 (이중 차감 없음)
    setInput(amountIn('오늘 매출', dlg), '85000');
    setInput(inputByLabel('가게 부담 할인액', dlg), '10000');
    setInput(inputByLabel('환불액', dlg), '5000');
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('85000');
    expect(dlg.textContent).toContain('할인·환불 전 판매액(복원): 100,000원');
    // B. 판매액으로 계산: 판매액 칸만 추가되고 할인·환불은 같은 칸을 쓴다
    clickButton('할인 전 판매액으로 계산', dlg);
    expect(labelCount('가게 부담 할인액')).toBe(1);
    expect(labelCount('환불액')).toBe(1);
    expect(labelCount('할인·환불 전 판매액')).toBe(1);
    expect(numVal(inputByLabel('할인·환불 전 판매액', dlg))).toBe('100000'); // 다시 열면 맞는 값
    // 계산 닫기 → 메인 금액 유지
    setInput(inputByLabel('할인·환불 전 판매액', dlg), '90000');
    expect(dlg.textContent).toContain('현재 85,000원 → 적용 후 75,000원');
    clickButton('계산 닫기', dlg);
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('85000');
    // 적용: 100,000 − 10,000 − 5,000 = 85,000 (메인 금액 이미 있으면 변경 전후 표시)
    setInput(amountIn('오늘 매출', dlg), '90000');
    clickButton('할인 전 판매액으로 계산', dlg);
    setInput(inputByLabel('할인·환불 전 판매액', dlg), '100000');
    expect(dlg.textContent).toContain('기록할 매출 = 100,000원 − 10,000원 − 5,000원 = 85,000원');
    expect(dlg.textContent).toContain('현재 90,000원 → 적용 후 85,000원');
    clickButton('계산한 금액 적용', dlg);
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('85000');
    expect(dlg.textContent).toContain('계산한 매출 85,000원을 적용했어요');
    // 적용 후 할인을 고치면 매출은 그대로, '계산 결과가 변경됐어요'와 다시 적용
    setInput(inputByLabel('가게 부담 할인액', dlg), '12000');
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('85000');
    expect(dlg.textContent).toContain('계산 결과가 변경됐어요');
    expect(dlg.textContent).toContain('= 83,000원');
    clickButton('다시 적용', dlg);
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('83000');
    expect(dlg.textContent).not.toContain('계산 결과가 변경됐어요');
    // Esc는 계산만 닫는다
    clickButton('할인 전 판매액으로 계산', dlg);
    act(() => {
      inputByLabel('할인·환불 전 판매액', dlg).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dlg.querySelector('[aria-label="할인 전 판매액으로 계산"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    setInput(inputByLabel('완료 주문 수', dlg), '5');
    clickButton('저장하고 닫기', dlg);
    const saved = stored().sales.find((e) => e.date === todayStr() && e.channel === 'hall')!;
    // 판매액은 따로 저장하지 않고 순매출 + 상세로 복원 → 서로 맞지 않는 값이 확정처럼 남지 않음
    expect(saved).toMatchObject({ amountMode: 'net', gross: null, netInput: 83000, storeDiscount: 12000, refund: 5000 });
    unmount();
    mount(); // 새로고침 후에도 유지
    expect(stored().sales.find((e) => e.id === saved.id)).toMatchObject({ netInput: 83000, storeDiscount: 12000, refund: 5000 });
  });

  it('전체 기록을 취소하면 저장 데이터가 바뀌지 않는다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const before = JSON.stringify(stored().sales);
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    setInput(amountIn('오늘 매출', dlg), '85000');
    clickButton('할인 전 판매액으로 계산', dlg);
    setInput(inputByLabel('할인·환불 전 판매액', dlg), '100000');
    clickButton('취소', dlg);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(JSON.stringify(stored().sales)).toBe(before);
  });

  it('판매 방식·경로를 바꿀 때 입력 내용을 보호한다 (옮기기·비우기·취소)', async () => {
    mount();
    clickButton('샘플 둘러보기');
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    // 입력이 없으면 자유롭게 바꾼다
    clickButton('배달', dlg);
    expect(dlg.querySelector('[role="alertdialog"]')).toBeNull();
    clickButton('홀', dlg);
    setInput(amountIn('오늘 매출', dlg), '300000');
    setInput(inputByLabel('완료 주문 수', dlg), '15');
    // 입력이 있으면 묻는다
    clickButton('배달', dlg);
    let ask = dlg.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(ask.textContent).toContain('매장 방문 주문 · 홀');
    expect(ask.textContent).toContain('매출 300,000원 · 주문 15건');
    expect(ask.textContent).toContain('배달앱 A · 배달');
    // 저장도 막힌다 (선택 전)
    clickButton('저장하고 닫기', dlg);
    expect(stored().sales.some((e) => e.date === todayStr())).toBe(false);
    // 취소: 그대로
    clickButton('취소 (그대로 두기)', ask);
    expect(dlg.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dlg.querySelector('[aria-label="기록할 날짜와 경로"] summary')!.textContent).toContain('매장 방문 주문');
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('300000');
    // 비우고 새로 입력
    clickButton('배달', dlg);
    ask = dlg.querySelector('[role="alertdialog"]') as HTMLElement;
    clickButton('비우고 새로 입력', ask);
    expect(dlg.querySelector('[aria-label="기록할 날짜와 경로"] summary')!.textContent).toContain('배달앱 A · 배달');
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('');
    expect(inputByLabel('완료 주문 수', dlg).value).toBe('');
    // 옮기기: 경로만 바꾸고 입력은 유지
    setInput(amountIn('오늘 매출', dlg), '410000');
    clickButton('배달앱 B', dlg);
    ask = dlg.querySelector('[role="alertdialog"]') as HTMLElement;
    clickButton(/옮기기$/, ask);
    expect(dlg.querySelector('[aria-label="기록할 날짜와 경로"] summary')!.textContent).toContain('배달앱 B');
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('410000');
  });

  it('기존 판매액 기준 기록을 상세 화면에서 열고 그대로 저장하면 기록이 바뀌지 않고, 금액을 고치면 추정값을 다시 계산한다', async () => {
    // 격리된 샘플 데이터: 가장 최근 날짜의 기록을 판매액 기준(할인·환불 포함)으로 만든다
    const data = generateSample(addDays(todayStr(), -1));
    const last = data.sales.reduce((m, e) => (e.date > m ? e.date : m), '');
    data.sales = data.sales.map((e) =>
      e.date === last ? { ...e, amountMode: 'gross' as const, gross: (netSales(e) ?? 0) + 12000, netInput: null, storeDiscount: 10000, refund: 2000 } : e,
    );
    localStorage.setItem(STORAGE_KEY, serialize(data));
    const original = JSON.parse(JSON.stringify(stored().sales));
    mount();
    await go('sales');
    const firstEdit = Array.from(document.querySelectorAll('section ul li button')).find((b) => ['비용 확인', '수정'].includes(b.textContent!.trim())) as HTMLButtonElement;
    act(() => firstEdit.click());
    let det = dialog();
    const target = original.find((e: { amountMode: string; date: string }) => e.date === last && e.amountMode === 'gross');
    // 매출 금액에는 계산된 순매출을 보여준다 (판매액이 아니라)
    const shown = inputByLabel('매출 금액', det).value.replace(/,/g, '');
    expect(original.some((e: { date: string; gross: number }) => e.date === last && e.gross - 12000 === Number(shown))).toBe(true);
    expect(det.textContent).toContain('할인·환불 전 판매액(복원)');
    expect(target).toBeTruthy();
    clickButton('저장', det);
    expect(stored().sales).toEqual(original); // 아무것도 고치지 않으면 기록·합계 동일
    // 금액을 고치면 순매출 기준으로 저장하고, 상세는 남기고, 추정값은 다시 계산 (실제 비용 보존)
    act(() => (Array.from(document.querySelectorAll('section ul li button')).find((b) => ['비용 확인', '수정'].includes(b.textContent!.trim())) as HTMLButtonElement).click());
    det = dialog();
    const before = Number(inputByLabel('매출 금액', det).value.replace(/,/g, ''));
    setInput(inputByLabel('매출 금액', det), String(before + 50000));
    const editedId = stored().sales.find((e) => e.date === last && netSales(e) === before)!.id;
    const prev = stored().sales.find((e) => e.id === editedId)!;
    const hadEstimates = Object.values(prev.costs).some((c) => c.actual === null && c.estimated !== null);
    if (hadEstimates) expect(det.textContent).toContain('자동 계산액을 현재 기준으로 다시 계산했어요');
    clickButton('저장', det);
    const after = stored().sales.find((e) => e.id === editedId)!;
    expect(after).toMatchObject({ amountMode: 'net', netInput: before + 50000, gross: null, storeDiscount: 10000, refund: 2000 });
    for (const [k, c] of Object.entries(prev.costs)) if (c.actual !== null) expect(after.costs[k as keyof typeof after.costs].actual).toBe(c.actual);
    if (hadEstimates) expect(after.costs).not.toEqual(prev.costs);
  });

  it('저장에 실패하면 입력 내용을 그대로 두고 알린다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    setInput(amountIn('오늘 매출', dlg), '300000');
    setInput(inputByLabel('완료 주문 수', dlg), '15');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    clickButton(/^저장하고 .+ 입력$/, dlg);
    spy.mockRestore();
    expect(text()).toContain('저장하지 못했습니다');
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(numVal(amountIn('오늘 매출', dialog()))).toBe('300000');
    expect(stored().sales.some((e) => e.date === todayStr())).toBe(false);
    // 다시 누르면 저장된다. 빠르게 두 번 눌러도 한 번만 저장
    const btn = findButton(/^저장하고 .+ 입력$/, dialog()) as HTMLButtonElement;
    act(() => {
      btn.click();
      btn.click();
    });
    expect(stored().sales.filter((e) => e.date === todayStr())).toHaveLength(1);
  });

  it('1단계 재현 + 수수료 자동 계산: 정보가 없으면 수수료만 계산하지 않고(0원 아님), 필요한 내역만 물어 바로 채운다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    // 1) 홀: 결제수단을 모르면 결제 수수료는 계산하지 않는다 (전체를 카드 매출로 보지 않음)
    clickButton('＋ 오늘 매출 기록하기');
    let dlg = dialog();
    setInput(amountIn('오늘 매출', dlg), '650000');
    setInput(inputByLabel('완료 주문 수', dlg), '30');
    expect(dlg.textContent).toContain('이 경로의 결제 수수료 계산에는 카드 결제액이 필요해요');
    clickButton('나중에 입력', dlg);
    expect(dlg.textContent).not.toContain('카드 결제액이 필요해요');
    clickButton('저장하고 닫기', dlg); // 정보가 없어도 저장은 된다
    const hall = stored().sales.find((e) => e.date === todayStr() && e.channel === 'hall')!;
    expect(hall.costs.payment.estimated).toBeNull();
    expect(hall.costs.hallSupplies.estimated).toBe(480 * 30);
    // 저장 후 알림: 오늘 아직 입력할 경로와 정산일에 보완할 비용을 나눠 알린다
    expect(text()).toContain('오늘 아직 입력할 경로:');
    expect(text()).toMatch(/정산일에 보완할 비용: [^가-힣]*[가-힣·]*결제 수수료/);
    // 2) 배달앱 A: 기준이 '할인 후·환불 전'이라 환불액만 필요 → '필요한 내역 입력'으로 같은 영역의 환불액 칸으로 이동
    clickButton('＋ 오늘 매출 기록하기');
    dlg = dialog();
    expect(dlg.querySelector('[aria-label="기록할 날짜와 경로"] summary')!.textContent).toContain('배달앱 A · 배달');
    setInput(amountIn('오늘 매출', dlg), '700000');
    setInput(inputByLabel('완료 주문 수', dlg), '36');
    expect(dlg.textContent).toContain('이 경로의 중개 수수료·결제 수수료 계산에는 환불액(없으면 0원)이 필요해요');
    expect(dlg.textContent).not.toContain('할인 전 판매액(가게 부담 할인액과 환불액)이 필요'); // 불필요한 정보는 묻지 않음
    clickButton('필요한 내역 입력', dlg);
    expect(document.activeElement).toBe(inputByLabel('환불액', dlg));
    act(() => (dlg.querySelector('button[aria-label="환불 없음"]') as HTMLButtonElement).click());
    expect(dlg.textContent).not.toContain('환불액(없으면 0원)이 필요해요');
    // 기본 화면: 계산된 비용은 금액만, 메뉴 평균 원가율 식재료비만 '추정'
    const list = dlg.querySelector('[aria-label="자동 계산된 비용"]')!;
    expect(list.querySelector('[data-cost="packaging"]')!.textContent).toBe(`포장비${(700 * 36).toLocaleString('ko-KR')}원`);
    expect(list.querySelector('[data-cost="food"]')!.textContent).toMatch(/^식재료비[\d,]+원추정$/);
    expect(dlg.textContent).not.toContain('설정 기준 계산');
    // 상세 보기: 적용 설정·기준금액·요율·부가세·결과
    clickButton('상세 보기', dlg);
    const detail = dlg.querySelector('[aria-label="자동 계산 상세"]')!.textContent!;
    expect(detail).toMatch(/수수료 설정: \d{4}-\d{2}-\d{2}부터/);
    expect(detail).toContain('부가세 별도');
    expect(detail).toMatch(/할인 후·환불 전 금액 700,000원 × \d+%/);
    expect(detail).toContain('추정: 메뉴'); // 메뉴 평균 원가율 식재료비는 추정
    expect(detail).toContain('포장비: 건당 700원 × 36건'); // 건당 기준 비용은 계산식만
    clickButton('저장하고 닫기', dlg);
    const del = stored().sales.find((e) => e.date === todayStr() && e.channel === 'delivery')!;
    expect(del.refund).toBe(0);
    expect(del.storeDiscount).toBeNull(); // 할인은 모르는 채로 (0으로 가정하지 않음)
    expect(del.costs.brokerage.estimated).not.toBeNull();
    expect(del.costs.brokerage.estimateBasis).toContain('설정 기준 계산');
    expect(del.costs.brokerage.estimateBasis).not.toContain('가정');
    expect(del.costs.delivery.estimated).toBe(3100 * 36); // 샘플 기록과 같은 건당 배달비
    // 홈: 숫자는 보이고, 오늘 배달앱 B·포장을 아직 기록하지 않아 부분 합계(일부 확인) — 증감은 보류, 결제 수수료 미입력도 함께 알린다
    const summary = document.querySelector('section[aria-label="기간 요약"]')!.textContent!;
    expect(summary).toMatch(/영업이익[\s\S]*?[\d,]+(만 )?원/);
    expect(summary).not.toContain('데이터 필요');
    expect(summary).toContain('일부 확인');
    expect(summary).toContain('기록하지 않은 경로·날 3곳');
    expect(summary).toContain('비용 1개 미입력');
    expect(summary).not.toMatch(/영업이익[\d,만 원]+일부 확인[▲▼]/);
  });

  it('홀 결제 구분: 전부 현금이면 결제 수수료 적용 안 함, 섞이면 카드 결제액에만 계산', async () => {
    mount();
    clickButton('샘플 둘러보기');
    clickButton('＋ 오늘 매출 기록하기');
    let dlg = dialog();
    setInput(amountIn('오늘 매출', dlg), '300000');
    setInput(inputByLabel('완료 주문 수', dlg), '15');
    clickButton('필요한 내역 입력', dlg);
    expect(document.activeElement).toBe(inputByLabel('카드 결제액', dlg));
    setInput(inputByLabel('카드 결제액', dlg), '200000');
    expect(dlg.textContent).not.toContain('카드 결제액이 필요해요');
    clickButton('저장하고 닫기', dlg);
    const mixed = stored().sales.find((e) => e.date === todayStr() && e.channel === 'hall')!;
    expect(mixed.cardSales).toBe(200000);
    expect(mixed.costs.payment.estimated).toBe(3000);
    // 다른 날짜: 전부 현금
    clickButton('＋ 오늘 매출 기록하기');
    dlg = dialog();
    const cashDay = freeWednesday();
    setInput(inputByLabel('날짜', dlg), cashDay);
    // 배달앱(플랫폼 결제)에서는 결제 구분을 묻지 않는다
    expect(findButton('전부 현금', dlg)).toBeUndefined();
    clickButton('홀', dlg);
    setInput(amountIn('매출 금액', dlg), '100000');
    setInput(inputByLabel('완료 주문 수', dlg), '5');
    clickButton('전부 현금', dlg);
    clickButton('저장하고 닫기', dlg);
    const cash = stored().sales.find((e) => e.date === cashDay && e.channel === 'hall')!;
    expect(cash.costs.payment.estimated).toBe(0);
    expect(cash.costs.payment.estimateBasis).toContain('현금');
  });

  it('빈 값 저장 시 필드 옆 오류와 하단 안내를 보여주고, 기존 기록과 같은 날짜·경로면 수정을 안내한다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    clickButton('＋ 오늘 매출 기록하기');
    let dlg = dialog();
    clickButton('저장하고 닫기', dlg);
    expect(dlg.textContent).toContain('매출 금액을 입력하세요');
    expect(dlg.textContent).toContain('완료 주문 수를 입력하세요');
    expect(dlg.querySelectorAll('[role="alert"]').length).toBeGreaterThanOrEqual(2);
    expect(dlg.textContent).toContain('위에 표시된 칸을 확인하세요');
    expect(document.body.style.overflow).toBe('hidden'); // 배경 스크롤 잠금
    // 마지막 매출일(샘플)은 이미 기록이 있음
    const last = stored().sales.reduce((m, e) => (e.date > m ? e.date : m), '');
    setInput(inputByLabel('날짜', dlg), last);
    expect(dlg.textContent).toContain('이 날짜·경로에 이미 기록이 있어요');
    // 모든 경로가 이미 입력된 날짜라 버튼은 '저장하고 마치기' 하나이고, 중복이라 누를 수 없다
    expect((findButton('저장하고 마치기', dlg) as HTMLButtonElement).disabled).toBe(true);
    // Esc로 닫으면 스크롤 잠금 해제
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    dlg = dialog();
    expect(dlg).toBeUndefined();
  });

  it('내 가게: 할인 전 판매액으로 계산해 넣고(같은 할인·환불 칸 사용), 비용 없이 저장하면 이익을 확정하지 않는다', async () => {
    mount();
    registerStore();
    await go('sales');
    clickButton('＋ 오늘 매출 기록');
    const dlg = dialog();
    clickButton('할인 전 판매액으로 계산', dlg);
    expect(document.activeElement).toBe(inputByLabel('할인·환불 전 판매액', dlg)); // 판매액 칸으로 포커스
    setInput(inputByLabel('할인·환불 전 판매액', dlg), '200000');
    setInput(inputByLabel('가게 부담 할인액', dlg), '5000');
    // 환불을 비워 두면 0으로 확정하지 않고 적용을 막는다
    clickButton('계산한 금액 적용', dlg);
    expect(dlg.textContent).toContain("환불이 없었다면 0을 넣거나 '없음'을 누르세요");
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('');
    act(() => (dlg.querySelector('button[aria-label="환불 없음"]') as HTMLButtonElement).click());
    expect(dlg.textContent).toContain('기록할 매출 = 200,000원 − 5,000원 − 0원 = 195,000원');
    clickButton('계산한 금액 적용', dlg);
    expect(dlg.textContent).toContain('계산한 매출 195,000원을 적용했어요');
    expect(numVal(amountIn('오늘 매출', dlg))).toBe('195000');
    expect(document.activeElement?.textContent).toBe('할인 전 판매액으로 계산'); // 포커스 복귀
    setInput(inputByLabel('완료 주문 수', dlg), '10');
    clickButton('저장하고 마치기', dlg); // 경로 하나뿐인 가게
    // 알림 첫 줄은 저장 결과만, 비용 상태는 둘째 줄에 작게, '비용 확인' 이동 버튼
    const toastArea = document.querySelector('[data-toast-area]')!;
    expect(toastArea.querySelector('.font-medium')!.textContent).toBe('매출을 저장했습니다');
    expect(toastArea.querySelector('.text-xs')!.textContent).toContain('정산일에 보완할 비용: 식재료비');
    expect(findButton('비용 확인', toastArea)).toBeTruthy();
    // 알림은 화면 아래에 뜬다 (위쪽 가게 이름·메뉴 버튼을 가리지 않음)
    const area = document.querySelector('[data-toast-area]') as HTMLElement;
    expect(area.style.bottom).toContain('px');
    expect(area.className).not.toContain('top-');
    const e = stored().sales[0];
    expect(e.netInput).toBe(195000);
    expect(e.amountMode).toBe('net');
    expect(e.storeDiscount).toBe(5000); // 상세는 남지만 다시 빼지 않음
    expect(e.refund).toBe(0); // '없음'을 눌러 0으로 확인

    await go('dashboard');
    // 비용 미입력: 숫자는 크게(입력된 비용만 반영), 미확정·미입력 개수는 작게
    const summary = document.querySelector('section[aria-label="기간 요약"]')!.textContent!;
    // 큰 금액은 만 원 단위로, 누르면 정확한 원 단위
    expect(summary).toContain('20만 원');
    act(() => findButton('20만 원')!.click());
    expect(document.querySelector('section[aria-label="기간 요약"]')!.textContent).toContain('195,000원');
    expect(summary).toContain('미확정');
    expect(summary).toMatch(/비용 \d+개 미입력 · 실제보다 높게 보일 수 있음/);

    // 비용 확인 단계(상세)로 이동해 실제 비용 입력
    await go('sales');
    clickButton('비용 확인');
    const det = dialog();
    expect(det.textContent).toContain('② 비용 확인');
    expect(det.textContent).not.toContain('NaN');
    clickButton('취소', det);

    clickButton('삭제');
    await clickLastButton('삭제');
    expect(text()).toContain('매출 입력을 삭제했습니다');
  });

  it('진단 → 실행 계획 간편 등록(초안 자동 채움) → 성과 확인 안내', async () => {
    mount();
    clickButton('샘플 둘러보기');
    await go('diagnosis');
    // 1위(배달)는 샘플에 같은 예시 계획이 있어 중복 확인이 먼저 뜨므로 2위(홀) 항목으로 만든다
    act(() => Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === '이 항목으로 실행 계획 만들기')[1].click());
    const dlg = dialog();
    expect(dlg.textContent).toContain('연결된 문제');
    expect(dlg.textContent).toContain('근거:');
    expect(dlg.textContent).toMatch(/분석 \d{4}\./);
    // 상세 옵션은 접혀 있음
    const details = dlg.querySelector('details')!;
    expect(details.open).toBe(false);
    clickButton('다음 주 월요일부터 2주', dlg);
    clickButton('저장', dlg);
    expect(text()).toContain('실행 계획을 저장했습니다');
    const sol = stored().solutions[stored().solutions.length - 1];
    expect(sol.problemId).toBe(stored().problems[0].id);
    expect(sol.expectedRevenueChange).toBeNull();
    expect(sol.owner).toBe('');
    await go('performance', `?solution=${sol.id}`);
    // 새 계획은 상태 '계획' + 다음 주 시작: 실행 중이라고 하지 않는다
    expect(text()).toContain('아직 시작 전인 계획이에요');
    expect(text()).toMatch(/실행 시작일\(.+?\)까지 \d+일 남았어요/);
    expect(text()).not.toContain('실행 중입니다');
  });

  it('같은 문제·같은 예시로 만든 계획이 있으면 먼저 묻는다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    await go('diagnosis');
    // 상위 3개: 배달 주문 1건당 남는 금액 감소 아래에 원인 후보가 묶여 있다
    const top = text();
    expect(top).toContain('함께 변한 것 (원인 후보)');
    expect(top).toMatch(/가게 부담 할인 비율 \d+\.\d% → \d+\.\d%/);
    expect(top).not.toContain('2. 배달 평균 주문금액 하락');
    expect(top).not.toContain('3. 배달 평균 주문금액 하락');
    const before = stored().solutions.length;
    // 1위 항목(배달, 이익 영향 기준)은 샘플의 '배달 할인 효율 검토'와 같은 예시
    expect(top).toMatch(/1\. 배달 주문 1건당 남는 금액 감소추정 이익 영향 −\d+만 원/);
    const buttons = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === '이 항목으로 실행 계획 만들기');
    act(() => buttons[0].click());
    expect(text()).toContain('이미 만든 실행 계획이 있어요');
    expect(text()).toContain('배달 할인 효율 검토');
    clickButton('기존 계획 보기');
    expect(window.location.hash).toContain('solutions');
    expect(stored().solutions.length).toBe(before);
    await go('diagnosis');
    act(() => Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === '이 항목으로 실행 계획 만들기')[0].click());
    clickButton('새로 만들기');
    expect(dialog().textContent).toContain('1. 무엇을 바꿀까요?');
  });

  it('선택 항목을 비워도 실행 계획을 저장하고, 목표 기준별 단위를 표시한다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    await go('solutions');
    clickButton('실행 계획 등록');
    const dlg = dialog();
    clickButton('저장', dlg);
    expect(dlg.textContent).toContain('무엇을 바꿀지 한 줄로 적어 주세요');
    setInput(inputByLabel('한 줄 요약', dlg), '포장 안내 문구 바꾸기');
    clickButton('증가율', dlg);
    expect(dlg.textContent).toContain('목표값 (선택, %)');
    clickButton('실행 후 총량', dlg);
    clickButton('저장', dlg);
    expect(text()).toContain('실행 계획을 저장했습니다');
    const sol = stored().solutions.find((s) => s.name === '포장 안내 문구 바꾸기')!;
    expect(sol.kpiTarget).toBeNull();
    expect(sol.budget).toBeNull();
    expect(sol.expectedCostChange).toBeNull();
    // 기존 포장 계획: 실행 후 총량 기준, 예상과 실제 영업이익 변화를 함께 보여준다
    await go('performance', `?solution=${stored().solutions.find((s) => s.templateId === 'takeout-pickup')!.id}`);
    expect(text()).toMatch(/실행 후 기간 \d+건/);
    expect(text()).toContain('영업이익 변화: 예상과 실제');
    // 근거 자료가 없는 샘플 계획이라 예상은 비워 둔다 (임의 숫자 없음)
    expect(text()).toContain('예상 (계획)미입력');
    // 큰 금액은 만 원 단위로, 누르면 정확한 원 단위
    const exp = Array.from(document.querySelectorAll('button')).find((b) => b.title.startsWith('정확한 금액') && /만 원$/.test(b.textContent ?? ''))!;
    expect(exp).toBeTruthy();
    const full = exp.title.replace('정확한 금액: ', '');
    act(() => exp.click());
    expect(exp.textContent).toBe(full);
    // 경고는 한 줄, 나머지는 접혀 있음
    expect(text()).toContain('단순 전후 비교라');
    const fold = Array.from(document.querySelectorAll('details')).find((d) => d.textContent?.includes('주의할 점'))!;
    expect(fold.open).toBe(false);
  });

  it('고객 지표: 데이터 확보가 어렵다고 고르면 건너뛰고, 재주문율을 0%로 표시하지 않는다', async () => {
    mount();
    registerStore();
    await go('sales', '?tab=customers');
    expect(text()).toContain('확인할 수 있나요?');
    clickButton('지금은 확인하기 어려워요');
    expect(text()).toContain('재주문율은 데이터가 없어 표시하지 않습니다(0%가 아님)');
    expect(text()).not.toMatch(/재구매율\s*0(\.0)?%/);
    expect(stored().prefs.customerData).toBe('unavailable');
    await go('dashboard');
    expect(text()).toMatch(/오늘 (홀 |배달 |포장 )?매출 기록하기/); // 핵심 기능은 그대로
  });

  it('백업 파일 불러오기: 바뀌는 범위를 보여주고 확인 후 덮어쓴다 (이전 버전 파일 포함)', async () => {
    mount();
    registerStore('지금 가게');
    await go('store');
    // v2 형식 백업 파일 (금액 기준·확인 기록 필드 없음)
    const v2 = {
      app: 'restaurant-profit-beta',
      schemaVersion: 2,
      exportedAt: '2026-11-01T00:00:00.000Z',
      data: { ...stored(), schemaVersion: 2, store: { ...stored().store!, name: '백업 가게' }, salesChecks: undefined, prefs: undefined },
    };
    const json = JSON.stringify(v2);
    const file = new File([json], 'backup.json', { type: 'application/json' });
    // jsdom의 File에는 text()가 없어 테스트에서만 보충 (실제 브라우저는 지원)
    Object.defineProperty(file, 'text', { value: async () => json });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(text()).toContain('백업 파일로 바꿀까요?');
    expect(text()).toContain('지금 이 브라우저의 데이터(지금 가게)는 모두 파일 내용으로 바뀝니다');
    expect(text()).toContain('합치지 않습니다');
    await clickLastButton('지금 데이터를 바꾸고 불러오기');
    expect(text()).toContain('백업 파일을 불러왔습니다');
    expect(stored().store!.name).toBe('백업 가게');
    expect(stored().salesChecks).toEqual([]);
  });

  it('시작 전 실행 계획은 성과 확인에서 안내만 보여주고, 샘플 종료 시 차트 측정 글자를 지운다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    // 시작일은 지났지만 상태를 '계획'으로 둔 계획
    await go('solutions');
    clickButton('실행 계획 등록');
    const dlg = dialog();
    setInput(inputByLabel('한 줄 요약', dlg), '시작 전 계획');
    setInput(inputByLabel('시작일', dlg), addDays(todayStr(), -7));
    setInput(inputByLabel('종료일', dlg), addDays(todayStr(), 7));
    clickButton('저장', dlg);
    await go('performance', `?solution=${stored().solutions.find((s) => s.name === '시작 전 계획')!.id}`);
    expect(text()).toContain('아직 시작 전인 계획이에요');
    expect(text()).toContain("상태가 '계획'으로 기록돼 있어");
    expect(text()).not.toContain('실행 중입니다');
    expect(text()).not.toContain('단순 전후 비교라');
    clickButton('기간을 직접 지정해 비교하기');
    expect(text()).toContain('단순 전후 비교라');

    const span = document.createElement('span');
    span.id = 'recharts_measurement_span';
    span.textContent = '11/09';
    document.body.appendChild(span);
    clickButton('샘플 종료');
    await clickLastButton('샘플 종료');
    expect(findButton('내 가게 시작')).toBeTruthy();
    expect(document.getElementById('recharts_measurement_span')).toBeNull();
  });

  it('내 가게 등록 후 빈 상태를 안내한다', async () => {
    mount();
    clickButton('내 가게 시작');
    clickButton('등록하고 시작');
    expect(text()).toContain('가게명을 입력하세요');
    setInput(document.querySelector('input[placeholder="예: 우리동네 분식"]') as HTMLInputElement, '테스트 식당');
    clickButton('등록하고 시작');
    // 등록 직후 설정 화면이 아니라 홈: 운영하는 판매 방식(홀만)의 첫 마감 버튼을 바로 누를 수 있다
    expect(window.location.hash).toContain('dashboard');
    expect(findButton('＋ 오늘 홀 매출 기록하기')).toBeTruthy();
    expect(findButton('첫 매출 기록하기')).toBeTruthy(); // 계산할 자료가 없으면 0원 대신 첫 기록으로
    expect(document.querySelector('section[aria-label="기간 요약"]')!.textContent).not.toMatch(/\d원/);
    expect(text()).not.toContain('샘플 데이터 사용 중');
    expect(text()).toContain('아직 계산할 매출 기록이 없어요');
    expect(text()).toContain('오늘 기록할 곳 1곳 중 0곳 완료');
    await go('diagnosis');
    expect(text()).toContain('등록된 문제가 없습니다');
    await go('performance');
    expect(text()).toContain('확인할 실행 계획이 없습니다');
  });

  it('4차 1단계: 홀·배달·포장을 모두 고르고 등록하면 배달앱을 묻고, 홈 입력 현황에 세 판매 방식이 모두 보인다', async () => {
    mount();
    clickButton('내 가게 시작');
    setInput(document.querySelector('input[placeholder="예: 우리동네 분식"]') as HTMLInputElement, '덮밥집');
    const box = (label: string) => Array.from(document.querySelectorAll('label')).find((l) => l.textContent?.trim() === label)!.querySelector('input')!;
    act(() => box('배달').click());
    act(() => box('포장').click());
    clickButton('등록하고 시작');
    // 배달을 골랐으므로 저장 전에 배달앱 단계를 보여준다
    expect(text()).toContain('어떤 배달앱을 쓰세요?');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    clickButton('배달 경로 만들고 시작');
    expect(text()).toContain('배달앱 이름을 입력하거나');
    setInput(inputByLabel('배달앱 1 이름'), '배달앱 가');
    clickButton('수수료율 알면 입력하기 (모르면 나중에)');
    clickButton('배달 경로 만들고 시작');
    const d = stored();
    expect(d.store!.channels).toEqual(['hall', 'delivery', 'takeout']);
    expect(d.platforms.map((p) => p.name)).toEqual(['배달앱 가']);
    expect(d.routes.map((r) => [r.name, r.channels.join()])).toEqual([
      ['매장 방문 주문', 'hall'],
      ['배달앱 가', 'delivery'],
      ['매장 포장 주문', 'takeout'],
    ]);
    expect(d.feeRules).toEqual([]); // 수수료율은 비워 둠 = 나중에
    await go('dashboard');
    const rows = Array.from(document.querySelectorAll('[aria-label="판매 방식별 입력 현황"] > li')).map((li) => li.getAttribute('data-channel'));
    expect(rows).toEqual(['hall', 'delivery', 'takeout']);
    expect(text()).toContain('오늘 기록할 곳 3곳 중 0곳 완료');
    // 배달 경로에 바로 매출을 넣을 수 있다
    const deliveryRow = document.querySelector('[aria-label="판매 방식별 입력 현황"] > li[data-channel="delivery"]')!;
    clickButton('입력', deliveryRow);
    expect(dialog().textContent).toContain('배달앱 가');
  });

  it('4차 1단계: 성과 확인은 영업일 수 차이와 대상 외 변화를 안내한다 (포장 주문과 픽업 개선)', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const sol = stored().solutions.find((s) => s.templateId === 'takeout-pickup')!;
    await go('performance', `?solution=${sol.id}`);
    clickButton('비교 기간 수정'); // 완료된 계획은 비교 기간을 한 줄로 접어 둔다
    const t = text();
    // 샘플은 실행 날짜(어제) 기준으로 만들어지므로 기대값도 같은 데이터로 계산한다
    const d = stored();
    const ctx = reviewContext(computeSummary(d, sol.review.before!), computeSummary(d, sol.review.after!), 'takeout');
    expect(t).toContain(`영업일 ${ctx.beforeDays}일`);
    expect(t).toContain(`영업일 ${ctx.afterDays}일`);
    if (ctx.businessDaysDiffer) {
      expect(t).toContain(`영업일 수가 달라요: 실행 전 ${ctx.beforeDays}일, 실행 후 ${ctx.afterDays}일`);
      expect(t).toContain('영업일당 영업이익');
      expect(t).toContain('그대로 성과로 보기는 어려워요');
      expect(t).not.toMatch(/실제 변화가 예상보다 [^.]*(많아요|적어요)\./);
    } else expect(t).not.toContain('영업일 수가 달라요');
    if (ctx.outweighing.length) expect(t).toContain('대상 외 변화가 더 커서 이 실행의 효과로 보기 어렵습니다.');
    else expect(t).not.toContain('대상 외 변화가 더 커서');
  });

  it('4차 2단계: 배달 대상 계획을 직접 만들면 세 지표가 기본으로 잡히고, 성과 확인에 1건당 남은 돈·할인액·할인 1,000원당이 보인다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    await go('solutions');
    clickButton('실행 계획 등록');
    let dlg = dialog();
    setInput(inputByLabel('한 줄 요약', dlg), '배달 쿠폰 3,000원 → 2,000원');
    setSelect(inputByLabel('어디에 적용하나요?', dlg) as unknown as HTMLSelectElement, 'delivery');
    // 배달로 바꾸면 쿠폰 결정용 세 지표를 제안한다
    expect(dlg.textContent).toContain('쿠폰 결정용 세 지표(배달 1건당 남은 돈 · 배달에서 남은 돈 · 가게에 남은 돈)를 모두 봐요');
    setInput(inputByLabel('쿠폰 금액', dlg), '2000');
    setInput(inputByLabel('최소 주문금액', dlg), '15000');
    const ref = addDays(todayStr(), -1);
    setInput(inputByLabel('시작일', dlg), addDays(ref, -13));
    setInput(inputByLabel('종료일', dlg), ref);
    clickButton('저장', dlg);
    const sol = stored().solutions.find((s) => s.name === '배달 쿠폰 3,000원 → 2,000원')!;
    expect(sol.target).toBe('delivery');
    expect(sol.kpi).toEqual({ key: 'directProfitPerOrder', channel: 'delivery' });
    expect(sol.extraKpis).toEqual([
      { key: 'directProfit', channel: 'delivery' },
      { key: 'operatingProfit', channel: 'all' },
    ]);
    expect(sol.coupon).toEqual({ amount: 2000, minOrder: 15000, routeId: null, previousAmount: null, usedCount: null });

    await go('performance', `?solution=${sol.id}`);
    const t = text();
    expect(t).toContain('쿠폰 2,000원 · 최소 주문 15,000원');
    expect(t).toContain('배달 1건당 남은 돈');
    expect(t).toContain('배달 판매 방식 비용을 뺀 금액'); // 정확한 용어는 보조 설명으로
    expect(t).toContain('배달 쿠폰·할인으로 낸 돈');
    expect(t).toContain('함께 보는 지표');
    expect(t).toContain('가게에 남은 돈');
    expect(document.querySelector('[aria-label="할인 1,000원당 효과"]')).toBeTruthy();

    // 결과 판단의 다음 쿠폰 금액은 저장되지만, 무관한 일반 새 계획에는 채우지 않는다 (재시험에서만 승계 — 5차 2단계 테스트)
    setInput(inputByLabel('다음 기간 쿠폰 금액 (선택)'), '1500');
    clickButton('최종 판단 저장');
    expect(stored().solutions.find((s) => s.id === sol.id)!.review.reviewedAt).toBeNull(); // 판단을 고르지 않으면 저장하지 않는다
    expect(text()).toContain('하나를 골라야 저장할 수 있어요');
    pickDecision('유지·확대');
    clickButton('최종 판단 저장');
    expect(stored().solutions.find((s) => s.id === sol.id)!.review.nextCouponAmount).toBe(1500);
    await go('solutions');
    clickButton('실행 계획 등록');
    dlg = dialog();
    // 배달이 아닌 일반 새 계획에는 쿠폰 칸이 없다 (쿠폰 관련 계획에서만 펼친다)
    expect(dlg.querySelector('[aria-label="쿠폰·할인 조건"]')).toBeNull();
  });

  it('5차 1단계: 배달 계획 성과 맨 위에 세 숫자·문장·맥락이 보이고, 빠진 기록은 0원으로 비교하지 않고 채우러 갈 수 있다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    await go('solutions');
    clickButton('실행 계획 등록');
    const dlg = dialog();
    setInput(inputByLabel('한 줄 요약', dlg), '배달 쿠폰 2주 시험');
    setSelect(inputByLabel('어디에 적용하나요?', dlg) as unknown as HTMLSelectElement, 'delivery');
    const ref = addDays(todayStr(), -1);
    setInput(inputByLabel('시작일', dlg), addDays(ref, -13));
    setInput(inputByLabel('종료일', dlg), ref);
    clickButton('저장', dlg);
    const sol = stored().solutions.find((s) => s.name === '배달 쿠폰 2주 시험')!;
    await go('performance', `?solution=${sol.id}`);
    const per = baRow('주문 한 건당 남은 돈');
    expect(per[0]).toMatch(/^[\d,]+원/);
    expect(per[2]).toMatch(/^[+−][\d,]+원|^변화 없음/);
    baRow('배달에서 14일간 남은 돈'); // 임의 기간이면 '한 달간' 대신 그 일수 (11.9~11.22 — 마지막 날 일요일은 휴무라 입력이 끝난 것으로 봄)
    baRow('가게 전체 영업이익');
    expect(document.querySelector('[aria-label="결과 한 문장"]')!.textContent).toMatch(/주문 한 건당 [\d,]+원 (덜|더) 남았(지만|고) 주문이 [\d,]+건 (늘어|줄어) 배달에서 14일간 남은 돈은 (약 )?[\d,]+(만( \d천)? 원|원) (늘었|줄었)어요\./);
    expect(text()).toContain('공통비까지 뺀 금액이에요');
    const ctx = document.querySelector('[aria-label="해석에 필요한 맥락"]')!.textContent!;
    expect(ctx).toContain('배달 완료 주문 수');
    expect(ctx).toContain('가게 부담 할인 총액 (배달)');
    expect(ctx).toMatch(/실제 영업일 수\d+일 → \d+일/);
    expect(ctx).toContain('홀·포장 변화');
    expect(findButton('결과 판단 기록하기')).toBeTruthy();
    expect(document.getElementById('review-record')).toBeTruthy();
    expect(text()).not.toContain('빠진 기록이 있어');

    // 실행 후 마지막 날 홀 기록을 지우면: 홀은 0원이 아니라 미입력, 증감·대상 외 경고는 보류
    const data = stored();
    // 마지막 매출 기록일(어제가 휴무일이면 그 전 영업일)의 홀 기록을 지운다
    const last = data.sales.reduce((m, e) => (e.date > m ? e.date : m), '');
    data.sales = data.sales.filter((e) => !(e.date === last && e.channel === 'hall'));
    unmount();
    localStorage.setItem(STORAGE_KEY, serialize(data));
    mount();
    await go('performance', `?solution=${sol.id}`);
    expect(text()).toContain('빠진 기록이 있어 일부 비교를 보류했어요');
    expect(text()).toContain('매장 방문 주문(홀) · 매출 미입력 1일');
    expect(text()).toContain('비교 보류 · 빠진 기록 있음');
    // 홀(부분 합계)은 대상 외 변화 판정에서 빠지고, 다 입력된 배달·포장은 계속 비교한다
    expect(text()).not.toMatch(/대상 외 판매 방식은[^.]*홀/);
    expect(text()).toMatch(/배달 \(대상\)[\d,]+원[\d,]+원▲/);
    expect(text()).toMatch(/실제 \(실행 후 − 실행 전\)비교 보류/);
    clickButton('빠진 기록 채우기');
    expect(window.location.hash).toContain('sales');
    expect(window.location.hash).toContain(`date=${last}`);
    expect(dialog().textContent).toContain('매장 방문 주문');
  });

  it('5차 2단계 흐름: 신규 등록 → 배달 20만 원·10건 → 실제 수수료 반영 → 2주 성과 → 다음 쿠폰 2,000원 → 재시험 계획', async () => {
    mount();
    clickButton('내 가게 시작');
    setInput(document.querySelector('input[placeholder="예: 우리동네 분식"]') as HTMLInputElement, '덮밥집');
    const box = (label: string) => Array.from(document.querySelectorAll('label')).find((l) => l.textContent?.trim() === label)!.querySelector('input')!;
    act(() => box('배달').click());
    act(() => box('포장').click());
    clickButton('등록하고 시작');
    clickButton('배달 경로 만들고 시작');
    setInput(inputByLabel('배달앱 1 이름'), '배달앱 가');
    clickButton('배달 경로 만들고 시작');
    // 등록 직후 홈에서 바로 배달 첫 마감 (수수료율·원가율 없이)
    expect(window.location.hash).toContain('dashboard');
    clickButton('＋ 오늘 배달 매출 기록하기');
    let dlg = dialog();
    expect(dlg.textContent).toContain('배달앱 가');
    setInput(amountIn('오늘 매출', dlg), '200000');
    setInput(inputByLabel('완료 주문 수', dlg), '10');
    clickButton('저장하고 닫기', dlg);
    const today = todayStr();
    const first = stored().sales.find((e) => e.date === today && e.channel === 'delivery')!;
    expect([netSales(first), first.orders, first.storeDiscount]).toEqual([200_000, 10, null]);
    // 방금 기록에 관련된 설정 하나만 제안
    expect(text()).toContain('첫 기록을 저장했어요');
    expect(text()).toContain('용기 한 개 가격을 알면 다음부터 포장비를 자동 계산해요.');
    // 홈의 정산 할 일 → 배달앱 정산 반영 화면에서 할인·실제 수수료 보완
    const todo = document.querySelector('[aria-label="정산 반영할 것"]') as HTMLElement;
    expect(todo.textContent).toMatch(/배달앱 가\(배달\).*할인액 미입력 1건.*수수료 미입력 1건/);
    await act(async () => todo.querySelector('button')!.click());
    expect(window.location.hash).toContain('tab=settle');
    const md = `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))}`;
    const byAria = (l: string) => document.querySelector(`input[aria-label="${md} ${l}"]`) as HTMLInputElement;
    setInput(byAria('가게 부담 할인'), '0');
    setInput(byAria('환불'), '0');
    setInput(byAria('실제 중개 수수료'), '15000');
    setInput(byAria('실제 결제 수수료'), '5000');
    clickButton(/^정산 반영 저장/);
    const settled = stored().sales.find((e) => e.id === first.id)!;
    expect([netSales(settled), settled.storeDiscount, settled.costs.brokerage.actual, settled.costs.payment.actual]).toEqual([200_000, 0, 15_000, 5_000]);

    // 2주 성과를 보려고 지난 27일치 가상 기록을 넣는다 (배달앱 가 기록 + 홀·포장은 매출 없음 확인)
    const data = stored();
    const app = data.routes.find((r) => r.name === '배달앱 가')!;
    for (let i = 1; i <= 27; i++) {
      const date = addDays(today, -i);
      const e = structuredClone(settled);
      Object.assign(e, { id: `v${i}`, date, netInput: 180_000 + (i % 5) * 10_000, orders: 9 + (i % 4), storeDiscount: i <= 13 ? 20_000 : 10_000 });
      data.sales.push(e);
      for (const r of data.routes.filter((x) => x.id !== app.id))
        for (const ch of r.channels) data.salesChecks.push({ date, channel: ch, routeId: r.id, status: 'noSales', checkedAt: '' });
    }
    for (const r of data.routes.filter((x) => x.id !== app.id)) for (const ch of r.channels) data.salesChecks.push({ date: today, channel: ch, routeId: r.id, status: 'noSales', checkedAt: '' });
    unmount();
    localStorage.setItem(STORAGE_KEY, serialize(data));
    mount();
    // 배달 쿠폰 계획: 대상 배달앱·기존/시험 쿠폰액·최소 주문액·적용 기간
    await go('solutions');
    clickButton('실행 계획 등록');
    dlg = dialog();
    setInput(inputByLabel('한 줄 요약', dlg), '배달앱 가 쿠폰 2주 시험');
    setSelect(inputByLabel('어디에 적용하나요?', dlg) as unknown as HTMLSelectElement, 'delivery');
    setSelect(inputByLabel('대상 배달앱', dlg) as unknown as HTMLSelectElement, app.id);
    setInput(inputByLabel('기존 쿠폰 금액', dlg), '1000');
    setInput(inputByLabel('쿠폰 금액', dlg), '3000');
    setInput(inputByLabel('최소 주문금액', dlg), '15000');
    // 2주 실행이 어제 끝난 상황 (오늘은 결과를 보는 날)
    setInput(inputByLabel('시작일', dlg), addDays(today, -14));
    setInput(inputByLabel('종료일', dlg), addDays(today, -1));
    clickButton('저장', dlg);
    const plan = stored().solutions.find((s) => s.name === '배달앱 가 쿠폰 2주 시험')!;
    expect(plan.coupon).toEqual({ routeId: app.id, previousAmount: 1000, amount: 3000, minOrder: 15000, usedCount: null });
    await go('performance', `?solution=${plan.id}`);
    expect(baRow('주문 한 건당 남은 돈')[1]).toMatch(/^[\d,]+원/);
    expect(document.querySelector('[aria-label="실행 조건"]')!.textContent).toContain('쿠폰 1,000원 →');
    baRow('배달앱 가 완료 주문');
    expect(text()).toContain('배달앱 가 · 쿠폰 1,000원 → 3,000원 · 최소 주문 15,000원');
    expect(text()).toContain('배달앱 가 전체의 전후 변화');
    expect(text()).not.toContain('빠진 기록이 있어');
    // 다음 쿠폰 2,000원 → 이 조건으로 재시험 만들기 (저장 전 수정 가능)
    setInput(inputByLabel('다음 기간 쿠폰 금액 (선택)'), '2000');
    expect(text()).toContain('다음 쿠폰: 2,000원');
    pickDecision('수정 후 재시험');
    await clickLastButton('이 조건으로 재시험 만들기');
    expect(stored().solutions.find((s) => s.id === plan.id)!.review.nextCouponAmount).toBe(2000);
    dlg = dialog();
    expect(numVal(inputByLabel('쿠폰 금액', dlg))).toBe('2000');
    expect(numVal(inputByLabel('기존 쿠폰 금액', dlg))).toBe('3000');
    expect(numVal(inputByLabel('최소 주문금액', dlg))).toBe('15000');
    expect((inputByLabel('대상 배달앱', dlg) as unknown as HTMLSelectElement).value).toBe(app.id);
    setInput(inputByLabel('최소 주문금액', dlg), '17000'); // 저장 전에 고칠 수 있다
    clickButton('저장', dlg);
    const retest = stored().solutions.find((s) => s.id !== plan.id && s.name.includes('2주 재시험'))!;
    expect(retest.coupon).toEqual({ routeId: app.id, previousAmount: 3000, amount: 2000, minOrder: 17000, usedCount: null });
    expect(retest.extraKpis).toEqual(plan.extraKpis);
    // 무관한 일반 새 계획에는 쿠폰 조건 칸이 없다
    clickButton('실행 계획 등록');
    dlg = dialog();
    expect(dlg.querySelector('[aria-label="쿠폰·할인 조건"]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('내장 샘플: 문제 진단(8월 대 9월) → 연결된 배달 할인 효율 검토 → 10월 실행 결과(9월 대 10월) → 11월 재시험 실행 중', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const counts = () => {
      const d = stored();
      return [d.sales.length, d.periodCosts.length, d.solutions.length, d.problems.length];
    };
    const initial = counts();
    await go('diagnosis');
    expect(text()).toContain('9월 배달 수익성 점검');
    expect(text()).toContain('분석 2026.09.01 ~ 2026.09.30');
    expect(text()).toContain('배달 주문 1건당 남는 금액 감소');
    const linked = Array.from(document.querySelectorAll('section')).find((s) => s.textContent?.startsWith('연결된 실행 계획'))!;
    expect(linked.textContent).toContain('배달 할인 효율 검토');
    expect(linked.textContent).toContain('배달앱 A 쿠폰 2,500원 재시험');
    // 결과를 저장한 계획은 '10월 실행 결과 보기' — 이미 저장된 결과를 여는 이동일 뿐
    await act(async () => findButton('10월 실행 결과 보기', linked)!.click());
    await act(async () => findButton('10월 실행 결과 보기', linked)?.click());
    const oct = stored().solutions.find((s) => s.name === '배달 할인 효율 검토')!;
    expect(window.location.hash).toContain(`solution=${oct.id}`);
    const t = text();
    expect(t).toContain('배달앱 A · 9월 쿠폰 3,000원 → 10월 쿠폰 2,000원 · 최소 주문 15,000원');
    expect(t).toContain('비교 기간: 9월 1~30일 → 10월 1~31일');
    const box = document.querySelector('[aria-label="바꾸기 전과 후"]')!.textContent!;
    expect(baRow('주문 한 건당 남은 돈')[2]).toMatch(/^\+[\d,]+원$/);
    expect(baRow('배달앱 A에서 한 달간 남은 돈')[2]).toMatch(/^−[\d,]+원$/);
    expect(baRow('가게 전체 영업이익')[2]).toMatch(/^\+[\d,]+원$/);
    expect(t).toMatch(/주문 한 건당 [\d,]+원 더 남았지만 주문이 [\d,]+건 줄어 배달앱 A에서 한 달간 남은 돈은 약 [\d,]+만 \d천 원 줄었어요\./);
    const ctx = document.querySelector('[aria-label="해석에 필요한 맥락"]')!.textContent!;
    expect(ctx).toMatch(/배달앱 A 완료 주문 수[\d,]+건→(에서)?[\d,]+건▼/);
    expect(ctx).toMatch(/가게 부담 할인 총액 \(배달앱 A\)[\d,]+원→(에서)?[\d,]+원▼/);
    expect(ctx).toContain('실제 영업일 수25일 → 27일');
    expect(ctx).toMatch(/영업일당 배달앱 A 주문[\d.]+건 → [\d.]+건/);
    expect(ctx).toMatch(/영업일당 영업이익[\d,]+원 → [\d,]+원/);
    expect(t).toContain('예상 (계획)+57만 원'); // 계획 당시 예상은 그대로, 실제 변화와 따로
    expect(t).toContain('목표 미설정');
    expect(t).not.toContain('✓ 달성');
    // 저장된 판단
    expect((inputByLabel('판단 근거') as unknown as HTMLTextAreaElement).value).toContain('다음 달에는 2,500원으로 시험해 보자');
    expect((inputByLabel('외부 요인 메모') as unknown as HTMLTextAreaElement).value).toContain('근처 행사 기간');
    expect(text()).toContain('다음 쿠폰: 2,500원');
    // 새로고침해도 같은 결과, 기록·계획은 늘지 않는다
    unmount();
    mount();
    await go('performance', `?solution=${oct.id}`);
    expect(document.querySelector('[aria-label="바꾸기 전과 후"]')!.textContent).toBe(box);
    expect(counts()).toEqual(initial);
    // 11월 재시험: 실행 중, 지금까지의 기록만
    const nov = stored().solutions.find((s) => s.name === '배달앱 A 쿠폰 2,500원 재시험')!;
    await go('performance', `?solution=${nov.id}`);
    expect(text()).toContain('실행 기간이 끝나면 최종 판단을 저장할 수 있어요');
    expect(text()).toContain('종료일까지 7일 남았어요');
    const prog = document.querySelector('[aria-label="지금까지의 기록"]')!.textContent!;
    expect(prog).toMatch(/지금까지의 기록 · 11월 1~21일 \(영업일 18일\)/);
    expect(prog).toContain('배달앱 A · 쿠폰 2,000원 → 2,500원 · 최소 주문 15,000원');
    expect(prog).toMatch(/배달앱 A 완료 주문 수[\d,]+건/);
    expect(text()).not.toContain('결과 판단 기록');
  });

  it('홈 직접 선택: 길이가 다른 두 기간은 총액 증감 대신 영업일당으로 비교하고, 같은 길이로 맞출 수 있다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    setSelect(document.querySelector('select[aria-label="조회 기간"]') as HTMLSelectElement, 'custom');
    setInput(document.querySelector('input[aria-label="조회 기간 시작일"]') as HTMLInputElement, '2026-10-01');
    setInput(document.querySelector('input[aria-label="조회 기간 종료일"]') as HTMLInputElement, '2026-11-21');
    setInput(document.querySelector('input[aria-label="비교 기간 시작일"]') as HTMLInputElement, '2026-09-01');
    setInput(document.querySelector('input[aria-label="비교 기간 종료일"]') as HTMLInputElement, '2026-09-30');
    const summary = () => document.querySelector('section[aria-label="기간 요약"]')!.textContent!;
    expect(summary()).toContain('조회 기간(52일)과 비교 기간(30일)의 길이가 달라요');
    expect(summary()).toMatch(/조회 기간\(52일\)과 비교 기간\(30일\)의 길이가 달라 영업일당으로 비교했어요: 영업일당 매출 [+−][\d.]+%/);
    expect(summary()).toContain('기간 길이가 달라 총액은 비교하지 않아요');
    expect(summary()).toMatch(/영업일당 [\d,]+원 → [\d,]+원 \([+−][\d,]+원\)/);
    expect(summary()).not.toMatch(/매출은 \d+% 늘었/);
    expect(summary()).not.toContain('(+80.8%)');
    clickButton('같은 길이로 맞추기');
    expect((document.querySelector('input[aria-label="비교 기간 시작일"]') as HTMLInputElement).value).toBe('2026-08-10');
    expect(summary()).not.toContain('길이가 달라');
  });

  it('6차: 10월 성과 화면 순서·저장된 판단·11월 재시험 연결, 잘못된 비교 기간은 저장을 막고 원래 기간으로 복원', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const [oct, nov] = stored().solutions;
    await go('performance', `?solution=${oct.id}`);
    // 9차 순서: 계획·조건 → 결과 한 문장 → 저장된 판단 → 상세 수치 → 해석 근거
    const order = ['실행 조건', '결과 한 문장', '저장된 판단 요약', '바꾸기 전과 후', '해석에 필요한 맥락'].map((l) => document.querySelector(`[aria-label="${l}"]`)!);
    expect(order.every(Boolean)).toBe(true);
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[0].textContent).toBe('배달앱 A · 9월 쿠폰 3,000원 → 10월 쿠폰 2,000원 · 최소 주문 15,000원');
    expect(order[3].textContent).toContain('주문 한 건당 남은 돈');
    expect(order[3].textContent).toContain('배달앱 A에서 한 달간 남은 돈');
    expect(order[3].parentElement!.textContent).toContain('쿠폰만의 효과가 아니에요');
    expect(document.querySelector('[aria-label="기록 메모"]')!.textContent).toContain('10월 15~17일 근처 가을 축제로 홀 손님 증가');
    expect(order[2].textContent).toBe('수정 후 재시험');
    expect(document.querySelector('[aria-label="다음 쿠폰"]')!.textContent).toContain('내가 정한 다음 쿠폰 2,500원');
    // 상세 분석은 접혀 있다 (예상 +57만 원, 할인 1,000원당, 목표, 상세 표)
    const detail = Array.from(document.querySelectorAll('details')).find((x) => x.querySelector('summary')!.textContent!.includes('상세 분석'))!;
    expect(detail.open).toBe(false);
    expect(detail.textContent).toContain('예상 (계획)+57만 원');
    expect(detail.querySelector('[aria-label="할인 1,000원당 효과"]')).toBeTruthy();
    // 모든 배달앱 합계 보기 · 집계 기준
    clickButton('모든 배달앱 합계 보기');
    expect(document.querySelector('[aria-label="모든 배달앱 합계"]')!.textContent).toContain('배달 완료 주문 수');
    expect(text()).toMatch(/배달앱 A를 통한 포장 주문\(실행 전 [\d,]+건 · 실행 후 [\d,]+건\)은 포장으로 따로 집계/);
    // 이미 이어진 재시험: 새로 만들지 않고 그 계획으로
    expect(findButton('이 조건으로 재시험 만들기')).toBeUndefined();
    const count = stored().solutions.length;
    clickButton('11월 재시험 진행 상황 보기');
    expect(window.location.hash).toContain(`solution=${nov.id}`);
    await go('solutions', `?retest=${oct.id}`);
    expect(window.location.hash).toContain(`performance?solution=${nov.id}`);
    expect(stored().solutions.length).toBe(count);
    // 잘못된 기간: 이유를 보이고 저장·재시험을 막는다 → 원래 기간으로 복원
    await go('performance', `?solution=${oct.id}`);
    clickButton('비교 기간 수정');
    setInput(document.querySelector('input[aria-label="실행 전 기간 종료"]') as HTMLInputElement, '2026-10-03');
    expect(text()).toContain('실행 전 기간(9월 1일~10월 3일)과 실행 후 기간(10월 1~31일)이 겹쳐요');
    expect(findButton('최종 판단 저장')!.disabled).toBe(true);
    clickButton(/^원래 비교 기간으로 복원/);
    expect((document.querySelector('input[aria-label="실행 전 기간 종료"]') as HTMLInputElement).value).toBe('2026-09-30');
    expect(findButton('최종 판단 저장')!.disabled).toBe(false);
  });

  it('6차: 11월 실행 중 계획은 기간을 직접 지정해 메모를 저장해도 실행 중, 새 매출은 지금까지의 기록에 반영, 조기 종료 후 최종 검토', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const nov = stored().solutions[1];
    await go('performance', `?solution=${nov.id}`);
    const orders = () => Number(document.querySelector('[aria-label="지금까지의 기록"]')!.textContent!.match(/배달앱 A 완료 주문 수([\d,]+)건/)![1].replace(/,/g, ''));
    const before = orders();
    clickButton('기간을 직접 지정해 비교하기');
    expect(findButton('최종 판단 저장')).toBeUndefined();
    setText(inputByLabel('지금까지 본 것') as unknown as HTMLTextAreaElement, '1~3주차 주문은 10월보다 많음');
    clickButton('중간 메모 저장');
    const saved = stored().solutions.find((s) => s.id === nov.id)!;
    expect(saved.status).toBe('running');
    expect(saved.review).toMatchObject({ before: null, after: null, reviewedAt: null, decision: null, judgment: '1~3주차 주문은 10월보다 많음' });
    // 새 매출(11월 21일 배달앱 A 추가 기록) → 지금까지의 기록 갱신
    const data = stored();
    const last = data.sales.find((e) => e.date === '2026-11-21' && e.routeId === 'route_app_a' && e.channel === 'delivery')!;
    data.sales.push({ ...structuredClone(last), id: 'extra_nov', paymentMethodId: 'pay_card', orders: 7 });
    unmount();
    localStorage.setItem(STORAGE_KEY, serialize(data));
    mount();
    await go('performance', `?solution=${nov.id}`);
    expect(text()).toContain('실행 기간이 끝나면 최종 판단을 저장할 수 있어요');
    expect(orders()).toBe(before + 7);
    // 조기 종료 → 실제 종료일 지정 → 최종 검토
    clickButton('조기 종료하고 최종 검토');
    clickButton('이 날 끝낸 것으로 하고 최종 검토');
    expect(stored().solutions.find((s) => s.id === nov.id)).toMatchObject({ end: '2026-11-21', status: 'reviewPending' });
    expect(findButton('최종 판단 저장')).toBeTruthy();
  });

  it('6차: 정산 표를 고친 채 기간을 바꾸면 "저장하지 않은 N건"을 묻고, 겹치는 기간 합계는 저장하지 않는다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    // 샘플 11월 16일 이후는 정산 전(계산 수수료)
    await go('sales', '?tab=settle&route=route_app_a&channel=delivery&from=2026-11-16&to=2026-11-21');
    setInput(document.querySelector('input[aria-label="11/16 실제 중개 수수료"]') as HTMLInputElement, '10000');
    setInput(document.querySelector('input[aria-label="11/17 실제 중개 수수료"]') as HTMLInputElement, '11000');
    const end = inputByLabel('정산 종료일');
    setInput(end, '2026-11-20');
    expect(dialog().textContent).toContain('수정한 2건이 있어요');
    clickButton('계속 입력', dialog());
    expect(window.location.hash).toContain('to=2026-11-21');
    expect((document.querySelector('input[aria-label="11/16 실제 중개 수수료"]') as HTMLInputElement).value.replace(/,/g, '')).toBe('10000');
    setInput(end, '2026-11-20');
    await act(async () => findButton('저장하고 이동', dialog())!.click());
    expect(window.location.hash).toContain('to=2026-11-20');
    expect(stored().sales.find((e) => e.date === '2026-11-16' && e.routeId === 'route_app_a' && e.channel === 'delivery')!.costs.brokerage.actual).toBe(10000);
    // 기간 합계 200,000원 저장: 일별 확인 21,000원 / 나머지 179,000원
    await go('sales', '?tab=settle&route=route_app_a&channel=delivery&from=2026-11-16&to=2026-11-21');
    setInput(inputByLabel('11월 16~21일 수수료 합계 (중개·결제)'), '200000');
    expect(text()).toContain('일별 확인 21,000원 / 나머지 179,000원');
    clickButton('기간 합계 저장');
    expect(text()).toContain('11월 16~21일 정산서 기간 합계 200,000원 = 일별 확인 21,000원(2일) / 나머지 179,000원');
    // 일부만 겹치는 기간 합계는 저장하지 않는다 (기존 11월 16~21일 보존)
    await go('sales', '?tab=settle&route=route_app_a&channel=delivery&from=2026-11-19&to=2026-11-21');
    setInput(inputByLabel('11월 19~21일 수수료 합계 (중개·결제)'), '60000');
    expect(text()).toContain('11월 19~21일이 이미 저장한 정산 11월 16~21일 200,000원과 겹쳐요');
    expect(findButton('기간 합계 저장')!.disabled).toBe(true);
    expect(stored().periodCosts.filter((p) => p.routeId).map((p) => [p.start, p.end])).toEqual([['2026-11-16', '2026-11-21']]);
  });

  it('6차: 홈에서 10월 대 9월을 고르면 월 실적 표(9월 / 10월 / 증감액·증감률)와 영업일당 실적, 비교 기간 버튼에 적용 날짜', async () => {
    mount();
    clickButton('샘플 둘러보기');
    setSelect(document.querySelector('select[aria-label="조회 기간"]') as HTMLSelectElement, 'custom');
    setInput(document.querySelector('input[aria-label="조회 기간 시작일"]') as HTMLInputElement, '2026-10-01');
    setInput(document.querySelector('input[aria-label="조회 기간 종료일"]') as HTMLInputElement, '2026-10-31');
    expect(findButton('비교 = 지난달 전체 (9.1~9.30)')).toBeTruthy();
    expect(findButton('비교 = 직전 같은 일수 (8.31~9.30)')).toBeTruthy();
    clickButton('비교 = 지난달 전체 (9.1~9.30)');
    const table = document.querySelector('[aria-label="월 실적 비교"]')!.textContent!;
    expect(table).toContain('9월 실적10월 실적증감액 · 증감률');
    expect(table).toContain('순매출42,527,200원46,123,000원▲ +3,595,800원 (+8.5%)');
    expect(table).toMatch(/영업일 수25일27일▲ \+2일/);
    expect(table).toContain('영업일당 매출');
    expect(table).toContain('증감액 = 10월 − 9월');
    expect(text()).not.toContain('길이가 달라');
    // 같은 반올림: 요약 문장의 % 와 카드 증감률이 같다
    const pct = document.querySelector('section[aria-label="기간 요약"]')!.textContent!.match(/매출은 ([\d.]+)%/)?.[1];
    expect(pct).toBe('8.5');
  });

  it('6차: 백업 화면은 기기에 마지막으로 저장한 시각과 백업 파일을 마지막으로 내보낸 시각을 구분한다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    await go('store');
    expect(text()).toContain('기기에 마지막으로 저장한 시각');
    expect(text()).toContain('마지막 백업 아직 없음');
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => {};
    clickButton('백업 파일 저장');
    expect(text()).not.toContain('내보낸 시각 아직 없음');
    expect(text()).toContain('다른 기기로 옮기려면');
  });

  it('7차: 11월 10일 조기 종료 → 실행 후 기간이 바로 11월 1~10일, 최종 판단 저장 → 다시 열어도 11~21일 매출 제외', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const nov = stored().solutions[1];
    await go('performance', `?solution=${nov.id}`);
    clickButton('조기 종료하고 최종 검토');
    setInput(inputByLabel('실제로 끝낸 날'), '2026-11-10');
    clickButton('이 날 끝낸 것으로 하고 최종 검토');
    expect(stored().solutions.find((s) => s.id === nov.id)!.end).toBe('2026-11-10');
    // 화면의 실행 후 기간과 핵심 지표가 곧바로 11월 1~10일
    expect(text()).toContain('비교 기간: 10월 22~31일 → 11월 1~10일');
    const orders = (x: AppData, r: { start: string; end: string }) => x.sales.filter((e) => e.routeId === 'route_app_a' && e.channel === 'delivery' && e.date >= r.start && e.date <= r.end).reduce((t, e) => t + e.orders!, 0);
    const want = orders(stored(), { start: '2026-11-01', end: '2026-11-10' });
    expect(document.querySelector('[aria-label="해석에 필요한 맥락"]')!.textContent).toContain(`→에서${want.toLocaleString('ko-KR')}건`);
    pickDecision('판단 보류');
    clickButton('최종 판단 저장');
    expect(stored().solutions.find((s) => s.id === nov.id)!.review.decision).toBe('hold');
    expect(stored().solutions.find((s) => s.id === nov.id)!.review.after).toEqual({ start: '2026-11-01', end: '2026-11-10' });
    unmount();
    mount();
    await go('performance', `?solution=${nov.id}`);
    expect(text()).toContain('비교 기간: 10월 22~31일 → 11월 1~10일');
    expect(document.querySelector('[aria-label="해석에 필요한 맥락"]')!.textContent).toContain(`→에서${want.toLocaleString('ko-KR')}건`);
  });

  it('7차: 정산 표에서 판매액을 넘는 할인은 그 행에 오류를 보이고 저장·이동을 막는다 (일부만 반영되지 않음)', async () => {
    mount();
    clickButton('샘플 둘러보기');
    await go('sales', '?tab=settle&route=route_app_a&channel=delivery&from=2026-11-09&to=2026-11-14');
    const before = JSON.stringify(stored().sales);
    setInput(document.querySelector('input[aria-label="11/10 가게 부담 할인"]') as HTMLInputElement, '1000');
    setInput(document.querySelector('input[aria-label="11/9 가게 부담 할인"]') as HTMLInputElement, '10000000');
    expect(text()).toContain('할인·환불 합계가 판매액 582,000원을 초과합니다');
    expect(findButton(/^정산 반영 저장/)!.disabled).toBe(true);
    // 다른 탭으로 가려 해도 저장하고 이동은 막히고, 입력 중인 값은 그대로
    clickButton('매출 기록');
    await act(async () => findButton('저장하고 이동', dialog())!.click());
    expect(window.location.hash).toContain('tab=settle');
    expect(text()).toContain('오류가 있는 행을 고친 뒤 저장할 수 있어요');
    clickButton('계속 입력', dialog());
    expect((document.querySelector('input[aria-label="11/9 가게 부담 할인"]') as HTMLInputElement).value.replace(/,/g, '')).toBe('10000000');
    expect(JSON.stringify(stored().sales)).toBe(before);
  });

  it('7차: 정산 표를 고친 채 다른 탭·다른 메뉴로 가면 "수정한 1건이 있어요" — 계속 입력하면 값이 남고, 저장하고 이동하면 저장 후 이동, 고친 게 없으면 바로 이동', async () => {
    mount();
    clickButton('샘플 둘러보기');
    await go('sales', '?tab=settle&route=route_app_a&channel=delivery&from=2026-11-16&to=2026-11-21');
    setInput(document.querySelector('input[aria-label="11/16 가게 부담 할인"]') as HTMLInputElement, '12345');
    clickButton('매출 기록');
    expect(dialog().textContent).toContain('수정한 1건이 있어요');
    clickButton('계속 입력', dialog());
    expect(window.location.hash).toContain('tab=settle');
    expect((document.querySelector('input[aria-label="11/16 가게 부담 할인"]') as HTMLInputElement).value.replace(/,/g, '')).toBe('12345');
    // 앱 메뉴(홈)로 가려 해도 같은 확인
    clickButton('홈');
    expect(dialog().textContent).toContain('수정한 1건이 있어요');
    await act(async () => findButton('저장하고 이동', dialog())!.click());
    expect(window.location.hash).toContain('dashboard');
    expect(stored().sales.find((e) => e.date === '2026-11-16' && e.routeId === 'route_app_a' && e.channel === 'delivery')!.storeDiscount).toBe(12345);
    // 고친 게 없으면 바로 이동
    await go('sales', '?tab=settle&route=route_app_a&channel=delivery&from=2026-11-16&to=2026-11-21');
    clickButton('매출 기록');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(window.location.hash).toContain('tab=daily');
  });

  it('7차: 완료된 성과는 비교 기간을 한 줄로 접고 맨 위에 세 지표 변화와 다음 쿠폰, 바로 아래 저장된 판단 · 휴대폰 정산은 날짜별로 펼쳐 입력', async () => {
    mount();
    expect(text()).toContain('가상 식당이 배달 쿠폰을 바꾸고 결과를 확인한 사례예요.');
    expect(text()).not.toContain('28일 기간');
    clickButton('샘플 둘러보기');
    const oct = stored().solutions[0];
    await go('performance', `?solution=${oct.id}`);
    const cond = document.querySelector('[aria-label="실행 조건"]')!.parentElement!;
    expect(cond.textContent).toContain('비교 기간: 9월 1~30일 → 10월 1~31일');
    expect(cond.querySelector('input[type="date"]')).toBeNull();
    expect(document.querySelector('[aria-label="한눈에"]')).toBeNull(); // 같은 숫자를 반복하던 한 줄 요약은 '바꾸기 전과 후'로 합침
    expect(baRow('주문 한 건당 남은 돈')[2]).toBe('+935원');
    clickButton('비교 기간 수정');
    expect(cond.querySelectorAll('input[type="date"]')).toHaveLength(4);
    expect(findButton(/^원래 비교 기간으로 복원/)).toBeTruthy();
    // 9차: 저장된 판단은 결과 문장 바로 다음, 상세 수치보다 위
    const metrics = document.querySelector('[aria-label="바꾸기 전과 후"]')!;
    const saved = document.querySelector('[aria-label="저장된 판단 요약"]')!;
    expect(saved.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 휴대폰 정산 입력: 날짜·순매출 행을 펼치면 필드 이름이 붙은 네 칸
    await go('sales', '?tab=settle&route=route_app_a&channel=delivery&from=2026-11-09&to=2026-11-14');
    const row = document.querySelector('[aria-label="11/9 정산 입력"]') as HTMLDetailsElement;
    expect(row.querySelector('summary')!.textContent).toMatch(/11\/9.*순매출 529,500원/);
    expect(Array.from(row.querySelectorAll('label')).map((l) => l.textContent!.trim())).toEqual(['가게 부담 할인', '환불', '실제 중개 수수료', '실제 결제 수수료']);
  });

  it('8차: 10월 완료 계획은 "바꾸기 전과 후" 한 영역 — 바꾼 조건, 네 지표의 전·후·증감, 같은 눈금의 회색·파란 막대, 바로 아래 내가 정한 다음 쿠폰', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const [oct, nov] = stored().solutions;
    await go('performance', `?solution=${oct.id}`);
    const area = document.querySelector('[aria-label="바꾸기 전과 후"]')!;
    expect(text()).toContain('비교 기간: 9월 1~30일 → 10월 1~31일');
    expect(document.querySelector('[aria-label="실행 조건"]')!.textContent).toBe('배달앱 A · 9월 쿠폰 3,000원 → 10월 쿠폰 2,000원 · 최소 주문 15,000원');
    // 지표 순서: 한 건당 → 완료 주문 → 앱 A 기간 이익 → (구분선) 가게 전체
    const labels = Array.from(area.querySelectorAll(':scope > [aria-label]')).map((r) => r.getAttribute('aria-label'));
    expect(labels).toEqual(['주문 한 건당 남은 돈', '배달앱 A 완료 주문', '배달앱 A에서 한 달간 남은 돈', '가게 전체 영업이익']);
    expect(baRow('주문 한 건당 남은 돈')).toEqual(['6,218원', '7,153원', '+935원']);
    expect(baRow('배달앱 A 완료 주문')).toEqual(['785건', '665건', '−120건']);
    expect(baRow('배달앱 A에서 한 달간 남은 돈')).toEqual(['4,881,520원', '4,757,049원', '−124,471원']);
    expect(baRow('가게 전체 영업이익')).toEqual(['4,994,423원', '7,950,942원', '+2,956,519원']);
    expect(area.querySelector('[aria-label="가게 전체 영업이익"]')!.className).toContain('border-t-2');
    // 막대: 실행 전 회색, 실행 후 진한 파란색, 같은 지표는 같은 눈금 (큰 쪽이 100%)
    const bars = (label: string) => Array.from(area.querySelectorAll(`[aria-label="${label}"] [aria-hidden] > div`)) as HTMLElement[];
    const [before, after] = bars('배달앱 A 완료 주문');
    expect(before.className).toContain('bg-slate-400');
    expect(after.className).toContain('bg-blue-700');
    expect(before.style.width).toBe('100%');
    expect(parseFloat(after.style.width)).toBeCloseTo((665 / 785) * 100, 1);
    // 결과 문장 바로 아래 저장된 판단: 내가 정한 다음 쿠폰 → 11월 재시험 (상세 수치보다 위)
    const next = document.querySelector('[aria-label="다음 쿠폰"]')!;
    expect(next.textContent).toContain('내가 정한 다음 쿠폰 2,500원');
    expect(next.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[aria-label="결과 한 문장"]')!.textContent).toContain('주문 한 건당 935원 더 남았지만 주문이 120건 줄어 배달앱 A에서 한 달간 남은 돈은 약 12만 4천 원 줄었어요.');
    clickButton('11월 재시험 진행 상황 보기');
    expect(window.location.hash).toContain(`solution=${nov.id}`);
    // 11월 진행 중: 실행 중·마지막 입력일, 직접 비교해도 10월 한 달 전체와 나란히 두지 않음
    expect(document.querySelector('[aria-label="지금까지의 기록"] [role="status"]')!.textContent).toBe('실행 중 · 마지막 매출 입력 11월 21일');
    expect(document.querySelector('[aria-label="바꾸기 전과 후"]')).toBeNull();
    clickButton('기간을 직접 지정해 비교하기');
    expect(text()).toContain('실행 중 · 마지막 매출 입력 11월 21일 — 바꾼 후 값은 11월 1~21일 누적이라 확정 성과가 아니에요.');
    expect((document.querySelector('input[aria-label="실행 전 기간 시작"]') as HTMLInputElement).value).toBe('2026-10-11');
    expect((document.querySelector('input[aria-label="실행 후 기간 종료"]') as HTMLInputElement).value).toBe('2026-11-21');
    // 실행 중 직접 비교: 최종 판단 버튼 대신 '중간 메모 쓰기' → 실제 입력란으로 포커스
    expect(findButton('결과 판단 기록하기')).toBeUndefined();
    expect(findButton('최종 판단 저장')).toBeUndefined();
    clickButton('중간 메모 쓰기');
    expect(document.activeElement).toBe(inputByLabel('지금까지 본 것'));
  });

  it('8차: 판단 전이면 같은 자리에 "다음 쿠폰 정하기", 음수는 0 기준선, 비교할 수 없는 값은 막대 대신 사유', async () => {
    const d = storySample();
    const oct = d.solutions[0];
    oct.review = { ...oct.review, decision: null, judgment: '', externalFactors: '', reviewedAt: null, nextCouponAmount: null };
    d.solutions = d.solutions.filter((s) => s.retestOf !== oct.id);
    // 9월에 큰 일회성 비용 → 9월 가게 전체 영업이익이 적자
    d.periodCosts.push({ id: 'big', category: 'otherOperating', attribution: 'common', nature: 'fixed', start: '2026-09-01', end: '2026-09-30', amount: 10_000_000, source: 'actual', memo: '' });
    // 10월 2일 홀 기록이 빠짐 → 가게 전체는 비교 보류
    d.sales = d.sales.filter((e) => !(e.date === '2026-10-02' && e.channel === 'hall'));
    localStorage.setItem(STORAGE_KEY, serialize(d));
    mount();
    await go('performance', `?solution=${oct.id}`);
    // 판단 전: 저장된 판단 자리(결과 문장 바로 아래, 상세 수치보다 위)에 '다음 쿠폰 정하기'
    const prompt = findButton('다음 쿠폰 정하기')!;
    expect(prompt).toBeTruthy();
    expect(prompt.compareDocumentPosition(document.querySelector('[aria-label="바꾸기 전과 후"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const total = document.querySelector('[aria-label="바꾸기 전과 후"] [aria-label="가게 전체 영업이익"]')!;
    const [before, after, delta] = baRow('가게 전체 영업이익');
    expect(before).toMatch(/^[\d,]+원|^−[\d,]+원|^-[\d,]+원/);
    expect(after).toContain('10월 2일 매장 방문 주문 홀 매출 입력 필요');
    expect(delta).toBe('비교 보류 · 빠진 기록 있음');
    // 실행 후 칸에는 막대가 없다 (미입력을 길이 0 막대로 그리지 않음)
    expect(total.querySelector('[data-cell="after"] [aria-hidden]')).toBeNull();
    // 9월만 있는 막대도 음수면 0 기준선에서 왼쪽으로
    const bar = total.querySelector('[data-cell="before"] [aria-hidden]')!;
    expect(bar.querySelector('.left-1\\/2')).toBeTruthy();
    expect((bar.querySelector('.bg-slate-400') as HTMLElement).style.right).toBe('50%');
  });

  it('9차: 해원(홀만·토요일 계획) — 주 지표(토요일 방문객)가 맨 위, 전체 영업일과 함께, 쿠폰 문구 없음, 판단 보류만 명시적으로 저장', async () => {
    localStorage.setItem(STORAGE_KEY, serialize(coopData()));
    mount();
    await go('performance', '?solution=coop_sat');
    const head = document.querySelector('[aria-label="결과 한 문장"]')!;
    expect(head.textContent).toContain('토요일 홀 방문 고객 수 160명 → 128명, 20% 감소');
    expect(head.textContent).toContain('실행 전 토요일 4회 / 실행 후 토요일 4회');
    expect(head.textContent).toContain('전체 영업일: 홀 방문 고객 수 2,560명 → 2,528명, 약 1.3% 감소');
    expect(head.textContent).toContain('이 계획의 성과로 보지 않아요');
    expect(document.querySelector('[aria-label="실행 조건"]')!.textContent).toBe('홀 · 토요일만 적용');
    // 주 지표가 상세 수치·예상 영업이익보다 먼저
    const board = document.querySelector('[aria-label="바꾸기 전과 후"]')!;
    expect(head.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = Array.from(board.querySelectorAll(':scope > [aria-label]')).map((r) => r.getAttribute('aria-label'));
    expect(rows).toEqual(['홀 방문 고객 수', '홀 제공 식수', '토요일 가게 영업이익']);
    expect(head.textContent).toContain('전체 영업일 기준 가게 영업이익 +');
    expect(baRow('홀 방문 고객 수')).toEqual(['160명', '128명', '−32명']);
    expect(baRow('홀 제공 식수')).toEqual(['160끼', '128끼', '−32끼']);
    // 토요일만 · 전체 영업일 · 1회당 · 지원 필요액 (기간 비용 배분 기준 설명)
    const cmp = document.querySelector('[aria-label="요일 비교"]')!.textContent!;
    expect(cmp).toContain('토요일 합계 160명 → 128명 (20% 감소)');
    expect(cmp).toContain('토요일 1회당 40명 → 32명 (20% 감소)');
    expect(cmp).toContain('전체 영업일 2,560명 → 2,528명 (약 1.3% 감소)');
    const occ = document.querySelector('[aria-label="1회 운영 손익"]')!.textContent!;
    expect(occ).toContain('실행 후 토요일 1회 운영 손익: −310,297원');
    expect(occ).toContain('토요일 한 번 여는 데 부족한 돈(지원이 필요한 금액) 310,297원이에요.');
    expect(occ).toContain('달력 일수로 하루 몫을 나눈 뒤 토요일 날짜 수만큼');
    // 쿠폰 조건이 없는 계획: 쿠폰 관련 칸·문구 없음
    expect(text()).not.toContain('다음 기간 쿠폰 금액');
    expect(findButton('0원으로 중단')).toBeUndefined();
    expect(text()).not.toContain('내가 정한 다음 쿠폰');
    expect(findButton('다음 쿠폰 정하기')).toBeUndefined();
    expect(findButton('결과 판단 기록하기')).toBeTruthy();
    // 회의용 요약 (인쇄 전용)
    const print = document.querySelector('[aria-label="회의용 요약"]')!;
    expect(print.className).toContain('print-only');
    expect(print.textContent).toContain('토요일만 (실행 전 토요일 4회 / 실행 후 토요일 4회)');
    expect(print.textContent).toContain('아직 기록하지 않음');
    expect(findButton('회의용 요약 인쇄')).toBeTruthy();
    // 판단을 고르지 않으면 저장하지 않고, 판단 보류는 명시적으로 고를 수 있다
    clickButton('최종 판단 저장');
    expect(stored().solutions[0].review.reviewedAt).toBeNull();
    pickDecision('판단 보류');
    clickButton('최종 판단 저장');
    expect(stored().solutions[0].review.decision).toBe('hold');
    expect(document.querySelector('[aria-label="저장된 판단 요약"]')!.textContent).toBe('판단 보류');
    expect(document.querySelector('[aria-label="다음 쿠폰"]')).toBeNull();
    expect(document.querySelector('[aria-label="회의용 요약"]')!.textContent).toContain('판단: 판단 보류');
    expect(errors).toEqual([]);
  });

  it('9차: 이전에 판단 없이 저장된 기록은 "보류"로 바꾸지 않고 판단 미선택으로 둔다', async () => {
    const d = coopData();
    d.solutions[0].review = { ...d.solutions[0].review, decision: null, reviewedAt: '2026-11-02T00:00:00.000Z' };
    localStorage.setItem(STORAGE_KEY, serialize(d));
    mount();
    await go('performance', '?solution=coop_sat');
    expect(document.querySelector('[aria-label="저장된 판단 요약"]')!.textContent).toBe('판단 미선택');
    expect(stored().solutions[0].review.decision).toBeNull();
  });

  it('9차: 홀만 운영하면 정산 탭이 없고, 실행 중 계획의 주 지표가 방문객이면 홀 마감에 방문객 칸이 처음부터 보이며 제공 식수는 따로 저장', async () => {
    const d = coopData();
    d.solutions[0].status = 'running';
    localStorage.setItem(STORAGE_KEY, serialize(d));
    mount();
    await go('sales');
    expect(findButton('배달앱 정산 반영')).toBeUndefined();
    expect(findButton('매출 기록')).toBeTruthy();
    await go('dashboard');
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    const visitors = inputByLabel('홀 방문 고객 수', dlg);
    expect(visitors.closest('details')).toBeNull(); // 접혀 있지 않음
    setInput(amountIn('오늘 매출', dlg), '600000');
    setInput(inputByLabel('완료 주문 수', dlg), '120');
    setInput(visitors, '118');
    setInput(inputByLabel('제공 식수', dlg), '0');
    clickButton('저장하고 마치기', dlg);
    const saved = stored().sales.find((e) => e.date === '2026-11-02')!;
    expect([saved.orders, saved.visitors, saved.meals]).toEqual([120, 118, 0]);
  });

  it('10차: 홈 "자세히 보기"는 읽기만 하고, 점검 목록에 저장을 눌러야 저장 — 다시 열면 저장한 점검을 연다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const before = stored().problems.length;
    clickButton('자세히 보기');
    expect(window.location.hash).toContain('diagnosis');
    expect(document.querySelector('[aria-label="미리 보기"]')).toBeTruthy();
    expect(stored().problems.length).toBe(before); // 읽기만 해서는 저장하지 않음
    await go('dashboard');
    clickButton('자세히 보기');
    expect(stored().problems.length).toBe(before); // 여러 번 봐도 늘지 않음
    clickButton('점검 목록에 저장');
    expect(stored().problems.length).toBe(before + 1);
    const saved = stored().problems[before];
    await go('dashboard');
    expect(findButton('자세히 보기')).toBeUndefined();
    clickButton('저장한 점검 열기');
    expect(stored().problems.length).toBe(before + 1);
    expect(window.location.hash).toContain(`problem=${saved.id}`);
    expect(errors).toEqual([]);
  });

  it('10차: 여러 경로 연속 입력 — 버튼에 다음 경로 이름, 주문 없음은 확인된 0원(기록 아님), 비워 둔 경로는 미입력으로 남는다', async () => {
    const d = emptyData();
    d.mode = 'user';
    d.store = { name: '배달 가게', channels: ['delivery'], regularOpenDays: [0, 1, 2, 3, 4, 5, 6], openTime: '11:00', closeTime: '21:00', seats: null, commonCostChecklist: [], vatBasis: 'included' };
    d.platforms = [
      { id: 'pa', name: '배달앱 A', note: '' },
      { id: 'pb', name: '배달앱 B', note: '' },
    ];
    d.routes = [
      { id: 'ra', name: '배달앱 A', channels: ['delivery'], platformId: 'pa' },
      { id: 'rb', name: '배달앱 B', channels: ['delivery'], platformId: 'pb' },
      { id: 'rc', name: '전화 배달', channels: ['delivery'], platformId: null },
    ];
    localStorage.setItem(STORAGE_KEY, serialize(d));
    mount();
    // 신규 가게: 이익 카드에 0원 대신 첫 기록
    expect(document.querySelector('section[aria-label="기간 요약"]')!.textContent).not.toMatch(/\d원/);
    clickButton('첫 매출 기록하기');
    let dlg = dialog();
    expect(dlg.querySelector('[aria-label="기록할 날짜와 경로"] summary')!.textContent).toMatch(/^\d+월 \d+일\(.\) · 배달앱 A변경$/);
    expect(dlg.textContent).toContain('수수료와 배달비를 빼기 전 금액이에요');
    clickButton('정산 입금액만 알고 있어요', dlg);
    expect(dlg.textContent).toContain('주문 금액 − 가게 부담 할인');
    setInput(amountIn('오늘 매출', dlg), '200000');
    setInput(inputByLabel('완료 주문 수', dlg), '10');
    clickButton('저장하고 배달앱 B 입력', dlg);
    dlg = dialog();
    expect(dlg.querySelector('[aria-label="기록할 날짜와 경로"] summary')!.textContent).toContain('배달앱 B');
    clickButton('주문 없음', dlg);
    expect(dlg.textContent).toContain('주문 없음(0원)으로 기록해요');
    clickButton('저장하고 전화 배달 입력', dlg);
    dlg = dialog();
    expect(findButton('저장하고 마치기', dlg)).toBeTruthy(); // 마지막 경로
    clickButton('취소', dlg); // 전화 배달은 비워 둔다 → 미입력
    const s = stored();
    expect(s.sales.map((e) => e.routeId)).toEqual(['ra']); // 주문 없음은 0원 매출 기록을 만들지 않는다
    expect(s.salesChecks).toEqual([expect.objectContaining({ routeId: 'rb', channel: 'delivery', status: 'noSales', date: s.sales[0].date })]);
    expect(document.querySelector('section[aria-label="입력 현황"]')!.textContent).toContain('오늘 기록할 곳 3곳 중 2곳 완료');
    // 계산: 배달앱 B는 확인된 0원이라 빠진 곳이 아니고, 전화 배달만 미입력(0원으로 보지 않음)
    const summary = document.querySelector('section[aria-label="기간 요약"]')!.textContent!;
    expect(summary).toContain('기록하지 않은 경로·날 1곳');
    expect(summary).toContain('일부 확인');
    expect(errors).toEqual([]);
  });

  it('10차: 기존 쿠폰 계획을 열면 저장된 쿠폰 조건이 펼쳐져 있고, 결과 문장 바로 아래 다음 행동 — 단계 표시로 같은 계획을 오간다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const oct = stored().solutions[0];
    await go('solutions');
    clickButton('수정', document.getElementById(`sol-${oct.id}`)!);
    const dlg = dialog();
    const coupon = Array.from(dlg.querySelectorAll('details')).find((x) => x.querySelector('summary')?.textContent?.includes('쿠폰·할인 조건'))!;
    expect(coupon.open).toBe(true);
    expect(numVal(inputByLabel('쿠폰 금액', dlg))).toBe('2000');
    expect(numVal(inputByLabel('최소 주문금액', dlg))).toBe('15000');
    clickButton('취소', dlg);
    await go('performance', `?solution=${oct.id}`);
    const head = document.querySelector('[aria-label="결과 한 문장"]')!;
    expect(head.textContent).toContain('남은 돈은 약 12만 4천 원 줄었어요');
    const judged = document.querySelector('[aria-label="저장된 판단"]')!;
    expect(head.compareDocumentPosition(judged) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(judged.textContent).toContain('내가 정한 다음 쿠폰 2,500원');
    clickButton(/2\. 해볼 일/);
    expect(window.location.hash).toContain(`solution=${oct.id}`);
    clickButton(/1\. 발견한 변화/);
    expect(window.location.hash).toContain(`problem=${oct.problemId}`);
    expect(errors).toEqual([]);
  });

  it('11차: 기간을 바꾸면 매출·이익·비교 문구·먼저 살펴볼 변화가 같은 기간을 가리키고, 추정 영향은 상세에서 실제 이익 차이와 구분', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const sum = () => document.querySelector('section[aria-label="기간 요약"]')!;
    const issue = () => document.querySelector('section[aria-label="먼저 살펴볼 변화"]')!;
    expect(sum().querySelector('[aria-label="집계 기간"]')!.textContent).toBe('11.1~11.21 · 지난달 같은 날짜까지와 비교');
    expect(issue().textContent).toMatch(/^먼저 살펴볼 변화이번 달 /);
    setSelect(sum().querySelector('select[aria-label="조회 기간"]') as HTMLSelectElement, 'recent28');
    expect(sum().querySelector('[aria-label="집계 기간"]')!.textContent).toBe('10.25~11.21 · 직전 4주와 비교');
    expect(sum().querySelector('[aria-label="매출"]')!.textContent).toMatch(/^매출약 [\d,]+만 원약 [\d,]+만 원 (증가|감소)/);
    expect(sum().querySelector('[aria-label="이익"]')!.textContent).toMatch(/^예상 이익약 588만 원약 81만 원 감소/);
    // 관찰된 사실만 쉬운 말로, 추정 영향 금액은 접힌 상세에서 이름·근거·실제 이익 차이와 함께
    expect(issue().querySelector('p')!.textContent).toBe('최근 4주 홀 손님이 직전 4주보다 170명 줄었어요.');
    const visible = Array.from(issue().children).filter((c) => c.tagName !== 'DETAILS').map((c) => c.textContent).join('');
    expect(visible).not.toContain('이익 영향');
    const why = issue().querySelector('[aria-label="추정 영향 근거"]')!.textContent!;
    expect(why).toMatch(/줄어든 손님 수로 추정한 금액: −124만 원/);
    expect(why).toContain('줄어든 고객 170명 ×');
    expect(why).toMatch(/가게 전체 이익의 실제 전후 차이: −[\d,]+원/);
    expect(errors).toEqual([]);
  });

  it('11차: 하단 장사 점검은 홈 조회 기간의 먼저 살펴볼 변화로 열리고, 홈 카드에서 들어가도 같은 항목 — 열람만으로 점검이 저장되지 않는다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    setSelect(document.querySelector('select[aria-label="조회 기간"]') as HTMLSelectElement, 'recent28');
    const before = stored().problems.length;
    clickButton('장사 점검', document.querySelector('nav[aria-label="휴대폰 주 메뉴"]')!);
    expect(window.location.hash).toContain('diagnosis?from=2026-10-25&to=2026-11-21');
    const focus = () => document.querySelector('section[aria-label="먼저 살펴볼 변화"]')!;
    expect(focus().textContent).toContain('최근 4주 · 직전 4주와 비교');
    expect(focus().textContent).toContain('최근 4주 홀 손님이 직전 4주보다 170명 줄었어요.');
    expect(findButton('이전 기간과 방문 수 비교', focus())).toBeTruthy(); // 실제로 열 수 있는 다음 행동 하나
    // 첫 카드가 화면 맨 위 (저장한 점검 목록·문제 카드보다 앞)
    const card = document.querySelector('section[aria-label="먼저 살펴볼 변화"]')!;
    const saved = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('9월 배달 수익성 점검'))!;
    expect(card.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stored().problems.length).toBe(before);
    await go('dashboard');
    clickButton('자세히 보기');
    expect(window.location.hash).toContain('finding=hall-visitors-down');
    expect(focus().textContent).toContain('최근 4주 홀 손님이 직전 4주보다 170명 줄었어요.');
    expect(stored().problems.length).toBe(before);
    // 기존 계획·결과 링크는 원래 목적지로
    clickButton(/^3\. 결과/);
    expect(window.location.hash).toContain('performance');
    expect(errors).toEqual([]);
  });

  it('11차: 정산 입금액만 알면 나중에 기록 — 적어 둔 값이 저장되지 않는다고 미리 알리고 미입력으로 남김, 주문 없음만 완료로 센다', async () => {
    const d = emptyData();
    d.mode = 'user';
    d.store = { name: '배달 가게', channels: ['delivery'], regularOpenDays: [0, 1, 2, 3, 4, 5, 6], openTime: '11:00', closeTime: '21:00', seats: null, commonCostChecklist: [], vatBasis: 'included' };
    d.platforms = [
      { id: 'pa', name: '배달앱 A', note: '' },
      { id: 'pb', name: '배달앱 B', note: '' },
    ];
    d.routes = [
      { id: 'ra', name: '배달앱 A', channels: ['delivery'], platformId: 'pa' },
      { id: 'rb', name: '배달앱 B', channels: ['delivery'], platformId: 'pb' },
    ];
    localStorage.setItem(STORAGE_KEY, serialize(d));
    mount();
    clickButton('첫 매출 기록하기');
    let dlg = dialog();
    setInput(inputByLabel('완료 주문 수', dlg), '3');
    clickButton('정산 입금액만 알고 있어요', dlg);
    const help = dlg.querySelector('[role="note"]')!.textContent!;
    expect(help).toContain('입금액에는 수수료와 배달비가 이미 빠져 있어요. 지금은 이 경로를 미입력으로 두고, 주문 내역에서 매출을 확인한 뒤 기록하세요.');
    expect(help).toContain('적어 둔 주문 3건은 저장되지 않아요.');
    expect(help).not.toMatch(/0원|주문 없음/); // 0원 입력을 유도하지 않는다
    clickButton('나중에 기록', dlg);
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // 입력 현황으로
    expect(stored().sales).toEqual([]);
    expect(stored().salesChecks).toEqual([]);
    expect(document.querySelector('section[aria-label="입력 현황"]')!.textContent).toContain('오늘 기록할 곳 2곳 중 0곳 완료');
    // 배달앱 B만 주문 없음 → 그 경로만 완료
    clickButton('입력', document.querySelector('section[aria-label="입력 현황"] li[data-channel="delivery"]')!);
    dlg = dialog();
    expect(dlg.querySelector('[aria-label="기록할 날짜와 경로"] summary')!.textContent).toContain('배달앱 A'); // 미입력으로 남은 첫 경로
    clickButton('배달앱 B', dlg); // '변경'에서 경로 바꾸기
    clickButton('주문 없음', dlg);
    clickButton('저장하고 닫기', dlg);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(stored().sales).toEqual([]);
    expect(stored().salesChecks.map((c) => c.routeId)).toEqual(['rb']);
    expect(document.querySelector('section[aria-label="입력 현황"]')!.textContent).toContain('오늘 기록할 곳 2곳 중 1곳 완료');
    expect(errors).toEqual([]);
  });

  it('이전 버전 샘플은 자동으로 바꾸지 않고, 누를 때만 새 샘플로 바꾼다', async () => {
    const old = generateSample('2026-11-19');
    old.solutions[0].name = '내가 고친 계획';
    localStorage.setItem(STORAGE_KEY, serialize(old));
    mount();
    expect(stored().solutions[0].name).toBe('내가 고친 계획');
    clickButton('새 샘플 열기');
    await clickLastButton('새 샘플 열기');
    expect(stored().sampleToday).toBe('2026-11-23');
    expect(stored().solutions.map((s) => s.name)).toContain('배달앱 A 쿠폰 2,500원 재시험');
    expect(findButton('새 샘플 열기')).toBeUndefined();
  });

  it('4차 2단계: 홈에 추정값을 확인할 할 일이 보이고(설정대로 계산한 수수료는 제외), 누르면 그 기록만 모은 입력 화면으로 간다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    // 샘플의 정산 전 수수료는 설정 요율대로 계산한 값이라 할 일이 아니다. 지난달 금액을 가져온 공과금(추정)만
    let box = document.querySelector('[aria-label="추정값 확인하기"]') as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.textContent).toMatch(/청구서 반영 대기: .*공과금 \(공통\)추정 [\d,]+원/);
    expect(box.textContent).not.toContain('정산서 반영 대기');
    expect(text()).not.toContain('설정 기준 계산');
    // 이전 버전에서 모르는 할인·환불을 0원으로 가정해 계산한 수수료(추정)가 있으면 정산서 대기로 보인다
    const data = stored();
    for (const e of data.sales)
      for (const c of ['brokerage', 'payment'] as const)
        if (e.costs[c].actual === null && e.costs[c].estimated !== null) e.costs[c].estimateBasis += ' · 할인·환불 금액을 몰라 환불 0원으로 가정 — 실제보다 낮게 추정될 수 있음';
    unmount();
    localStorage.setItem(STORAGE_KEY, serialize(data));
    mount();
    await go('dashboard');
    box = document.querySelector('[aria-label="추정값 확인하기"]') as HTMLElement;
    expect(box.textContent).toMatch(/정산서 반영 대기: \d+\/\d+~\d+\/\d+ 배달앱 A\(배달\) 중개·결제 수수료기록 \d+건 · 추정 [\d,]+원/);
    const btn = Array.from(box.querySelectorAll('button')).find((b) => b.textContent!.includes('배달앱 A(배달)'))!;
    await act(async () => btn.click());
    // 수수료는 정산서로 여러 날을 한 번에 채우는 '배달앱 정산 반영' 화면으로 (그 배달앱·판매 방식·기간)
    expect(window.location.hash).toContain('tab=settle');
    expect(window.location.hash).toContain('route=route_app_a');
    expect(text()).toContain('배달앱 A · 배달 날짜별 정산');
    expect(document.querySelectorAll('input[aria-label$="실제 중개 수수료"]').length).toBeGreaterThan(0);
    expect(text()).not.toContain('추정 중');
    // 홈 상세 표에도 가게 부담 할인액(원)과 쉬운 이름
    await go('dashboard');
    expect(text()).toContain('쿠폰·할인으로 낸 돈');
    expect(text()).toContain('가게 부담 할인액');
    expect(text()).toContain('판매 방식별 남은 돈');
    // 진단 ③에 할인액 표와 할인 1,000원당
    await go('diagnosis');
    expect(document.querySelector('[aria-label="쿠폰·할인 비용"]')!.textContent).toContain('할인액 (비교 → 분석)');
    expect(text()).toMatch(/할인 1,000원 더 쓸 때마다 주문 [+−]\d/);
  });

  it('3차 1단계 → 5차: 건너뛴 영업일은 홈에 "N월 N일 마감 미입력"으로 보이고 매출 입력·매출 없음 확인·임시 휴업을 고를 수 있다', async () => {
    const today = todayStr();
    const gap = addDays(today, -1);
    const data = generateSample(addDays(today, -2));
    data.dayOverrides.push({ date: gap, open: true, note: '테스트: 영업일로 지정' });
    // 오늘 기록: 가장 최근 기록일의 기록을 복사 (어제는 비움)
    const last = data.sales.reduce((m, e) => (e.date > m ? e.date : m), '');
    data.sales.push(...data.sales.filter((e) => e.date === last).map((e, i) => ({ ...structuredClone(e), id: `t_today_${i}`, date: today })));
    // 진단 문제 기간을 마지막 입력일 뒤까지 잡아 둔다 (예전 샘플처럼)
    data.problems[0] = { ...data.problems[0], analysis: { start: addDays(today, -26), end: addDays(today, 1) }, compare: { start: addDays(today, -54), end: addDays(today, -27) } };
    localStorage.setItem(STORAGE_KEY, serialize(data));
    mount();
    await go('dashboard');
    const box = document.querySelector('[aria-label="마감 미입력"]') as HTMLElement;
    expect(box).not.toBeNull();
    const kr = `${Number(gap.slice(5, 7))}월 ${Number(gap.slice(8, 10))}일`;
    expect(box.textContent).toContain(`${kr} 마감 미입력`);
    expect(box.textContent).toContain('0원으로 보지 않아요');
    expect(findButton('매출 없음 확인', box)).toBeTruthy();
    clickButton('매출 입력', box);
    const dlg = dialog();
    expect((dlg.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(gap);
    act(() => (dlg.querySelector('button[aria-label="닫기"]') as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // 임시 휴업으로 정리하면 그날은 미입력이 아니다
    clickButton('임시 휴업', document.querySelector('[aria-label="마감 미입력"]') as HTMLElement);
    expect(stored().dayOverrides.find((o) => o.date === gap)).toMatchObject({ open: false, note: '임시 휴업' });
    expect(document.querySelector('[aria-label="마감 미입력"]')?.textContent ?? '').not.toContain(`${kr} 마감 미입력`);
    // 진단: 기간 맞추기
    await go('diagnosis');
    expect(text()).toContain('홈과 같은 기간으로 맞추기');
    clickButton('홈과 같은 기간으로 맞추기');
    const p = stored().problems[0];
    expect(p.analysis).toEqual({ start: addDays(today, -27), end: today });
    expect(text()).not.toContain('홈과 같은 기간으로 맞추기');
  });

  it('3차 2단계: 기간별 비용·일별 매출을 한 달씩 보고, 화살표로 넘기고, 빈 달은 지난달 비용을 가져온다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const thisMonth = monthOf(todayStr());
    const prevM = shiftMonth(thisMonth, -1);
    const nextM = shiftMonth(thisMonth, 1);
    await go('sales', '?tab=period');
    const list = () => document.querySelector('[aria-label="월 비용 목록"]') as HTMLElement | null;
    const expected = monthCosts(stored().periodCosts, thisMonth);
    expect(document.querySelector('[aria-label="월 선택"]')!.textContent).toContain(monthLabel(thisMonth));
    expect(list()!.querySelectorAll('li[data-cost-row]')).toHaveLength(expected.rows.length);
    expect(document.querySelector('[aria-label="월 비용 합계"]')!.textContent).toContain(`${monthShort(thisMonth)} 합계`);
    expect(text()).not.toContain('조회 시작일');
    expect(text()).not.toContain('다음 달 복사');
    expect(text()).not.toContain('어디에 쓰인 비용'); // 세부 내용은 접혀 있음
    // 줄을 누르면 세부 내용·수정·삭제가 펼쳐진다
    const firstRow = list()!.querySelector('li[data-cost-row] button[aria-expanded]') as HTMLButtonElement;
    act(() => firstRow.click());
    expect(firstRow.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(firstRow.getAttribute('aria-controls')!)!;
    expect(panel.textContent).toContain('어디에 쓰인 비용');
    expect(panel.textContent).toContain('일만큼 반영');
    expect(findButton('수정', panel)).toBeTruthy();
    expect(findButton('삭제', panel)).toBeTruthy();
    // 이전 달 화살표 → 주소에 남음
    act(() => (document.querySelector(`button[aria-label^="이전 달"]`) as HTMLButtonElement).click());
    await go('sales', `?tab=period&month=${prevM}`);
    expect(window.location.hash).toContain(`month=${prevM}`);
    expect(document.querySelector('[aria-label="월 선택"]')!.textContent).toContain(monthLabel(prevM));
    // 다음 달(비용 없음) → 지난달 비용 그대로 가져오기
    await go('sales', `?tab=period&month=${nextM}`);
    expect(list()).toBeNull();
    const before = stored().periodCosts.length;
    clickButton('지난달 비용 그대로 가져오기');
    expect(stored().periodCosts.length).toBe(before + expected.rows.length);
    expect(list()!.querySelectorAll('li[data-cost-row]')).toHaveLength(expected.rows.length);
    expect(list()!.textContent).toContain('추정');
    // 금액 확인 → 실제
    const row = list()!.querySelector('li[data-cost-row] button[aria-expanded]') as HTMLButtonElement;
    act(() => row.click());
    clickButton('금액 확인 · 실제로 표시', document.getElementById(row.getAttribute('aria-controls')!)!);
    expect(stored().periodCosts.filter((p) => p.start === monthRangeOf(nextM).start && p.source === 'actual')).toHaveLength(1);
    // 새로고침 후에도 선택한 달 유지
    unmount();
    mount();
    expect(document.querySelector('[aria-label="월 선택"]')!.textContent).toContain(monthLabel(nextM));

    // 일별 매출: 같은 월 선택, 시작·종료일 없음, 월 합계
    await go('sales', `?tab=daily&month=${prevM}`);
    expect(text()).not.toContain('종료일');
    const sum = document.querySelector('[aria-label="월 합계"]')!.textContent!;
    expect(sum).toContain(`${monthShort(prevM)} 합계`);
    const r = monthRangeOf(prevM);
    const prevNet = stored().sales.filter((e) => e.date >= r.start && e.date <= r.end).reduce((s, e) => s + (netSales(e) ?? 0), 0);
    expect(sum).toContain(prevNet.toLocaleString('ko-KR'));
    // 다른 달을 보다가 오늘 매출을 저장하면 이번 달로 이동
    clickButton('＋ 오늘 매출 기록');
    const dlg = dialog();
    setInput(amountIn('오늘 매출', dlg), '123000');
    setInput(inputByLabel('완료 주문 수', dlg), '9');
    clickButton('저장하고 닫기', dlg);
    await act(async () => {});
    expect(window.location.hash).toContain(`month=${thisMonth}`);
    expect(document.querySelector('[aria-label="월 선택"]')!.textContent).toContain(monthLabel(thisMonth));
  });

  it('4단계: 화면 어디에도 옛 용어·괄호 조사가 없고, 경로 이름에 판매 방식이 붙고, 매출 목록 요약이 바뀌었다', async () => {
    mount();
    clickButton('샘플 둘러보기');
    const banned = ['해결안', '직접 비용', '차감액', '이(가)', '은(는)', '을(를)', '(으)로', '과(와)', '채널'];
    const pages: [string, string][] = [
      ['dashboard', ''],
      ['sales', ''],
      ['sales', '?tab=period'],
      ['sales', '?tab=customers'],
      ['diagnosis', ''],
      ['solutions', ''],
      ['performance', ''],
      ['store', ''],
      ['menus', ''],
    ];
    for (const sol of [0, 1]) pages.push(['performance', `?solution=${stored().solutions[sol].id}`]);
    for (const [p, qs] of pages) {
      await go(p, qs);
      // 접힌 내용도 검사
      document.querySelectorAll('details').forEach((d) => (d.open = true));
      const t = text() + Array.from(document.querySelectorAll('option')).map((o) => o.textContent).join(' ');
      for (const w of banned) expect(t, `${p}${qs}: ${w}`).not.toContain(w);
    }
    await go('dashboard');
    // 입력 현황: 판매 방식 그룹 아래에 주문 경로 (펼쳐서 확인)
    for (const ch of ['홀', '배달', '포장']) clickButton(new RegExp(`^▸${ch} 세부 주문 경로`));
    const status = document.querySelector('section[aria-label="입력 현황"]')!;
    expect(status.querySelector('[aria-label="홀 주문 경로"]')!.textContent).toContain('매장 방문 주문');
    expect(status.querySelector('[aria-label="배달 주문 경로"]')!.textContent).toContain('배달앱 B');
    expect(status.querySelector('[aria-label="포장 주문 경로"]')!.textContent).toContain('전화 주문');
    await go('sales');
    expect(document.querySelector('[aria-label="월 합계"]')!.textContent).toMatch(/\d+월 합계순매출[\d,]+원주문 수[\d,]+건/);
  });

  it('4단계: 비용 일부만 있는 기록은 회색 "비용은 나중에 보완"으로, 미확정 이익은 숫자를 크게 보여준다', async () => {
    mount();
    registerStore();
    await go('dashboard');
    clickButton(/^＋ 오늘 (홀 |배달 |포장 )?매출 기록하기$/); // 첫 기록 전에는 운영하는 판매 방식 이름이 붙는다
    const dlg = dialog();
    setInput(amountIn('오늘 매출', dlg), '500000');
    setInput(inputByLabel('완료 주문 수', dlg), '20');
    clickButton('저장하고 마치기', dlg);
    // 비용이 하나도 없으면 '매출 입력 완료'. 일부(식재료비)만 넣으면 '비용은 나중에 보완'(회색)
    const e = stored().sales[0];
    const withOne = { ...e, costs: { ...e.costs, food: { ...e.costs.food, actual: 1000 } } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(STORAGE_KEY)!), data: { ...stored(), sales: [withOne] } }));
    unmount();
    mount();
    await go('sales');
    const badge = Array.from(document.querySelectorAll('span')).find((s) => s.textContent?.includes('비용은 나중에 보완') && s.className.includes('rounded-full'))!;
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('slate');
    expect(badge.className).not.toContain('red');
    expect(text()).not.toContain('비용 확인 필요');
    // 홈 영업이익: 숫자가 크게, 미확정은 작게
    await go('dashboard');
    const summary = document.querySelector('section[aria-label="기간 요약"]')!;
    expect(summary.textContent).toContain('미확정');
    expect(summary.querySelector('.text-2xl')!.textContent).toMatch(/[\d,]+(만 )?원/);
  });

  it('가게 설정 반영: 건당 포장비 500원 × 주문 10건 → 기본 화면은 "포장비 5,000원", 상세는 "건당 500원 × 10건", 설정을 바꿔도 과거 기록 유지, 정산 금액만 합계에 반영', async () => {
    // 매일 영업하는 포장 전용 가게 (요일과 무관하게 오늘 입력). 메뉴 원가율만 있어 식재료비는 메뉴 평균(추정)
    const d = emptyData();
    d.mode = 'user';
    d.store = { name: '포장 가게', channels: ['takeout'], regularOpenDays: [0, 1, 2, 3, 4, 5, 6], openTime: '11:00', closeTime: '21:00', seats: null, commonCostChecklist: [], vatBasis: 'included' };
    d.routes = [{ id: 'r_phone', name: '전화 주문', channels: ['takeout'], platformId: null }];
    d.perOrderCosts = [{ id: 'po', channel: 'takeout', routeId: null, category: 'packaging', amount: 500, effectiveFrom: '2026-01-01' }];
    d.menus = [{ id: 'm', name: '김밥', onSale: true, versions: [{ id: 'v', effectiveFrom: '2026-01-01', prices: { hall: null, delivery: null, takeout: 5_000 }, costMode: 'rate', costRate: 30, costAmount: null, costSource: 'actual', note: '' }] }];
    localStorage.setItem(STORAGE_KEY, serialize(d));
    mount();
    clickButton(/^＋ 오늘 (홀 |배달 |포장 )?매출 기록하기$/);
    let dlg = dialog();
    // 매출만 넣고 주문 수가 없으면 포장비는 구할 수 없으므로 무엇을 넣을지 알려준다
    setInput(amountIn('오늘 매출', dlg), '200000');
    const preview = () => dlg.querySelector('[aria-label="자동 계산된 비용"]')!;
    expect(preview().querySelector('[data-cost="packaging"]')!.textContent).toBe('포장비주문 수를 입력해 주세요');
    setInput(inputByLabel('완료 주문 수', dlg), '10');
    // 정상 계산은 금액만, 메뉴 평균 원가율 식재료비는 '추정'
    expect(preview().querySelector('[data-cost="packaging"]')!.textContent).toBe('포장비5,000원');
    expect(preview().querySelector('[data-cost="food"]')!.textContent).toBe('식재료비60,000원추정');
    expect(dlg.textContent).not.toContain('설정 기준 계산');
    clickButton('상세 보기', dlg);
    const detail = dlg.querySelector('[aria-label="자동 계산 상세"]')!.textContent!;
    expect(detail).toContain('포장비: 건당 500원 × 10건 = 5,000원');
    expect(detail).toContain('추정: 메뉴별 판매 비중을 몰라');
    clickButton('저장하고 마치기', dlg);
    expect(text()).toContain('포장비 5,000원');
    expect(text()).toContain('식재료비 60,000원(추정)');
    // 미리보기 금액 = 저장된 금액
    let rec = stored().sales[0];
    expect(rec.costs.packaging).toMatchObject({ actual: null, estimated: 5_000, calc: { method: 'perOrder', unitAmount: 500, orders: 10 } });
    expect(rec.costs.food.estimated).toBe(60_000);

    // 설정을 700원으로 바꿔도 이미 저장한 기록의 금액과 계산 근거는 그대로
    const changed = stored();
    changed.perOrderCosts[0].amount = 700;
    unmount();
    localStorage.setItem(STORAGE_KEY, serialize(changed));
    mount();
    await go('sales');
    expect(text()).not.toContain('설정 기준 계산');
    clickButton('비용 확인');
    dlg = dialog();
    const card = (cat: string) => dlg.querySelector(`[data-cost-card="${cat}"]`) as HTMLElement;
    const pack = card('packaging');
    expect(pack.querySelector('.rounded-full')).toBeNull(); // 배지 없이 금액만
    const packBox = pack.querySelector('[data-cost-basis]')!;
    expect(packBox.querySelector('.tabular')!.textContent).toBe('5,000원');
    expect(packBox.textContent).toContain('건당 500원 × 10건');
    expect(card('food').querySelector('.rounded-full')!.textContent).toBe('추정');
    expect(card('food').textContent).toContain('가정: 메뉴별 판매 비중을 몰라');
    expect(dlg.textContent).not.toContain('설정 기준 계산');
    // 나중에 포장비 정산 금액을 넣으면 그 금액만 합계에 반영 (저장된 계산값·근거는 남김)
    setInput(inputByLabel('실제 금액', pack), '4600');
    expect(pack.textContent).toContain('실제 금액만 합계에 반영돼요');
    clickButton('저장', dlg);
    rec = stored().sales[0];
    expect(rec.costs.packaging).toMatchObject({ actual: 4_600, estimated: 5_000, calc: { unitAmount: 500, orders: 10 } });

    // 대시보드 비용 구성: 포장비 합계는 정산 금액 4,600원, 식재료비는 추정
    await go('dashboard');
    expect(text()).not.toContain('설정 기준 계산');
    const costCard = Array.from(document.querySelectorAll('section')).find((s) => s.querySelector('h2')?.textContent === '비용 항목별 구성 (조회 기간)')!;
    clickButton('표', costCard);
    const row = (label: string) => Array.from(costCard.querySelectorAll('tbody tr')).find((tr) => tr.firstElementChild?.textContent === label)!.textContent!;
    expect(row('포장비')).toContain('4,600원');
    expect(row('포장비')).not.toContain('5,000원');
    expect(row('식재료비')).toContain('추정');
  });
});
