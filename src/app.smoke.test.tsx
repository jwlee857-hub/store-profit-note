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
import { generateSample } from './domain/sample';
import { emptyData } from './domain/factory';
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
  let d = addDays(todayStr(), -70);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 3) d = addDays(d, -1);
  return d;
}
const dayTitle = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 매출 기록`;

function registerStore(name = '테스트 식당') {
  clickButton('등록 시작');
  setInput(document.querySelector('input[placeholder="예: 우리동네 분식"]') as HTMLInputElement, name);
  clickButton('등록하고 시작');
}

beforeEach(() => {
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
});

describe('앱 스모크 테스트', () => {
  it('샘플로 시작해 모든 화면을 렌더링하고, 새로고침 후에도 유지된다', async () => {
    mount();
    expect(text()).toContain('샘플 데이터로 둘러보기');
    clickButton('샘플로 시작');
    expect(text()).toContain('샘플 데이터 사용 중');
    // 홈 순서: 오늘 기록 → 입력 현황 → 기간 요약 → 먼저 확인할 문제 → 상세
    const body = text();
    const order = ['오늘 매출 기록하기', '입력 현황', '주간 점검 · 얼마 남았나', '먼저 확인할 문제', '상세 표와 차트'].map((s) => body.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toContain('운영으로 남긴 이익입니다. 통장 잔액과는 다를 수 있어요.');
    expect(body).toMatch(/매출은 .*영업이익/);
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();

    const pages: [string, string][] = [
      ['store', '수수료 자동 계산 설정'],
      ['menus', '임시 추정값'],
      ['sales', '입력 현황'],
      ['diagnosis', '먼저 확인할 것 3가지'],
      ['solutions', '예상 효과'],
      ['performance', '아직 시작 전인 계획이에요'], // 첫 실행 계획은 상태가 '계획'
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
    expect(text()).toContain('2. 언제부터 언제까지 해볼까요?');
    expect(text()).toContain('3. 무엇이 좋아졌는지 확인할까요?');

    unmount();
    mount();
    expect(text()).toContain('샘플 데이터 사용 중');
    const reactErrors = errors.filter((e) => String(e[0]).includes('Warning') || String(e[0]).includes('Error'));
    expect(reactErrors).toEqual([]);
  });

  it('홈 → 오늘 매출 간편 입력 → 저장 → 입력 현황에 바로 표시되고 새로고침 후에도 유지', async () => {
    mount();
    clickButton('샘플로 시작');
    expect(text()).toMatch(/남은 경로 5곳/);
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    expect(dlg.textContent).toContain('오늘 매출 기록');
    // 금액 기준 선택 탭 없이 매출 금액 칸 하나. 의미와 정산 입금액 안내가 입력 위치에 있음
    expect(findButton('할인·환불 전 판매액', dlg)).toBeUndefined();
    expect(findButton('할인·환불 반영 후 매출', dlg)).toBeUndefined();
    expect(dlg.textContent).toContain('가게 부담 할인·환불 반영 후, 수수료·배달비 차감 전 매출입니다.');
    // 할인·환불 입력칸은 한 세트만, 수수료 계산 여부를 고르는 체크박스는 없음
    expect(Array.from(dlg.querySelectorAll('label')).filter((l) => l.textContent!.replace('*', '').trim() === '가게 부담 할인액')).toHaveLength(1);
    expect(Array.from(dlg.querySelectorAll('label')).filter((l) => l.textContent!.replace('*', '').trim() === '환불액')).toHaveLength(1);
    expect(dlg.querySelector('input[type="checkbox"]')).toBeNull();
    expect(dlg.textContent).toContain('매출 금액과 주문 수를 넣으면 비용이 자동으로 채워져요');
    expect(dlg.textContent).toContain('배달앱 정산 입금액과는 다를 수 있어요');
    // 이전 날짜 값을 복사하지 않음
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('');
    expect(inputByLabel('완료 주문 수', dlg).value).toBe('');
    // 숫자 키패드, 열리면 매출 칸에 포커스
    expect(inputByLabel('오늘 매출', dlg).getAttribute('inputmode')).toBe('numeric');
    expect(document.activeElement).toBe(inputByLabel('오늘 매출', dlg));
    // '저장하고 비용 확인'은 간편 입력에서 빠짐
    expect(findButton('저장하고 비용 확인', dlg)).toBeUndefined();
    setInput(inputByLabel('오늘 매출', dlg), '300000');
    setInput(inputByLabel('완료 주문 수', dlg), '15');
    clickButton('저장하고 닫기', dlg);
    expect(text()).toContain('매출을 저장했습니다');
    expect(text()).toMatch(/소모품비 7,200원/); // 저장 알림에는 계산된 비용을 금액으로 (주문 15건 × 480원)
    expect(text()).not.toContain('설정 기준 계산');
    const hallRow = () => document.querySelector('section[aria-label="입력 현황"] li[data-channel="hall"]')!.textContent!;
    expect(hallRow()).toContain('300,000원');
    expect(hallRow()).toContain('입력 완료');
    expect(text()).toMatch(/남은 경로 4곳/);
    const saved = stored().sales.find((e) => e.date === todayStr() && e.channel === 'hall')!;
    expect(saved.amountMode).toBe('net');
    expect(saved.netInput).toBe(300000);
    expect(saved.storeDiscount).toBeNull(); // 모르는 할인을 0으로 저장하지 않음
    expect(saved.costs.hallSupplies.actual).toBeNull(); // 근거 없는 비용은 빈칸
    expect(stored().prefs.lastEntry).toEqual({ channel: 'hall', routeId: 'route_hall', amountMode: 'net' });

    unmount();
    mount();
    expect(document.querySelector('section[aria-label="입력 현황"] li[data-channel="hall"]')!.textContent).toContain('300,000원');
    expect(text()).toMatch(/남은 경로 4곳/);
  });

  it('입력 현황: 홀·배달·포장 그룹으로 묶고, 펼치기·주요 버튼·날짜 변경·입력/수정 후 합계와 상태를 바로 갱신한다', async () => {
    mount();
    clickButton('샘플로 시작');
    await go('sales');
    const section = () => document.querySelector('section[aria-label="입력 현황"]') as HTMLElement;
    const row = (ch: string) => section().querySelector(`li[data-channel="${ch}"]`) as HTMLElement;
    const before = JSON.stringify(stored().sales);
    // 오늘(기록 없음): 세 그룹 모두 미입력, 금액 —, 세부 경로는 접힘
    expect(section().querySelectorAll('li[data-channel]')).toHaveLength(3);
    expect(section().textContent).toContain('3개 판매 방식 중 0개 완료 · 남은 경로 5곳');
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
    act(() => (row('delivery').querySelector('button[aria-label="배달앱 B · 배달 매출 없음"]') as HTMLButtonElement).click());
    expect(row('delivery').textContent).toContain('일부 입력 · 1/2곳');
    expect(row('delivery').textContent).toContain('0원');
    // 주요 버튼(이어 입력) → 남은 미입력 경로(배달앱 A)로 입력창
    clickButton('이어 입력', row('delivery'));
    let dlg = dialog();
    expect(dlg.querySelector('[aria-label="입력 진행"]')!.textContent).toContain('지금: 배달앱 A · 배달');
    setInput(inputByLabel('오늘 매출', dlg), '770000');
    setInput(inputByLabel('완료 주문 수', dlg), '30');
    clickButton('저장하고 닫기', dlg);
    // 입력 후 복귀: 배달 완료, 합계 770,000원
    expect(row('delivery').textContent).toContain('770,000원');
    expect(row('delivery').textContent).toContain('입력 완료');
    expect(section().textContent).toContain('3개 판매 방식 중 1개 완료 · 남은 경로 3곳');
    // 홀 주요 버튼(입력) → 홀 첫 미입력 경로
    clickButton('입력', row('hall'));
    dlg = dialog();
    expect(dlg.querySelector('[aria-label="입력 진행"]')!.textContent).toContain('지금: 매장 방문 주문 · 홀');
    setInput(inputByLabel('오늘 매출', dlg), '700000');
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
    expect(section().textContent).toContain('3개 판매 방식 중 3개 완료');
    expect(row('hall').textContent).toContain('입력 완료');
    // 샘플(오늘 이전) 기록은 바뀌지 않았다
    const after = stored().sales.filter((e) => JSON.parse(before).some((b: { id: string }) => b.id === e.id));
    expect(JSON.stringify(after)).toBe(before);
  });

  it('3단계: 창을 다시 열지 않고 다섯 경로를 연속 저장한다', async () => {
    mount();
    clickButton('샘플로 시작');
    const date = freeWednesday(); // 샘플 기록이 없는 수요일(영업일)
    clickButton('＋ 오늘 매출 기록하기');
    let dlg = dialog();
    setInput(inputByLabel('날짜', dlg), date);
    // 오늘이 아닌 날짜: 제목과 라벨이 날짜에 맞게 바뀐다
    expect(dlg.textContent).toContain(dayTitle(date));
    expect(dlg.querySelector('[aria-label="입력 진행"]')!.textContent).toContain('입력 경로 5개 중 0개 완료');
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      dlg = dialog();
      const progress = dlg.querySelector('[aria-label="입력 진행"]')!.textContent!;
      expect(progress).toContain(`입력 경로 5개 중 ${i}개 완료`);
      seen.push(progress.match(/지금: (.+?) · (다음|마지막)/)![1]);
      // 다음 경로로 넘어오면 금액·주문 수·할인·환불은 비어 있다 (이전 경로 값 복사 없음)
      expect(numVal(inputByLabel('매출 금액', dlg))).toBe('');
      expect(inputByLabel('완료 주문 수', dlg).value).toBe('');
      if (i === 1) {
        expect(inputByLabel('가게 부담 할인액', dlg).value).toBe('');
        expect(inputByLabel('환불액', dlg).value).toBe('');
      }
      setInput(inputByLabel('매출 금액', dlg), String(100000 * (i + 1)));
      setInput(inputByLabel('완료 주문 수', dlg), String(10 + i));
      if (i === 0) setInput(inputByLabel('가게 부담 할인액', dlg), '7000'); // 첫 경로만 할인 상세
      const label = i < 4 ? '저장하고 다음' : '저장하고 마치기';
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
    clickButton('샘플로 시작');
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    // 할인·환불 칸은 한 세트뿐
    const labelCount = (t: string) => Array.from(dlg.querySelectorAll('label')).filter((l) => l.textContent!.replace('*', '').trim() === t).length;
    // A. 순매출 85,000원 직접 입력 → 상세 추가해도 매출은 그대로 (이중 차감 없음)
    setInput(inputByLabel('오늘 매출', dlg), '85000');
    setInput(inputByLabel('가게 부담 할인액', dlg), '10000');
    setInput(inputByLabel('환불액', dlg), '5000');
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('85000');
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
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('85000');
    // 적용: 100,000 − 10,000 − 5,000 = 85,000 (메인 금액 이미 있으면 변경 전후 표시)
    setInput(inputByLabel('오늘 매출', dlg), '90000');
    clickButton('할인 전 판매액으로 계산', dlg);
    setInput(inputByLabel('할인·환불 전 판매액', dlg), '100000');
    expect(dlg.textContent).toContain('기록할 매출 = 100,000원 − 10,000원 − 5,000원 = 85,000원');
    expect(dlg.textContent).toContain('현재 90,000원 → 적용 후 85,000원');
    clickButton('계산한 금액 적용', dlg);
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('85000');
    expect(dlg.textContent).toContain('계산한 매출 85,000원을 적용했어요');
    // 적용 후 할인을 고치면 매출은 그대로, '계산 결과가 변경됐어요'와 다시 적용
    setInput(inputByLabel('가게 부담 할인액', dlg), '12000');
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('85000');
    expect(dlg.textContent).toContain('계산 결과가 변경됐어요');
    expect(dlg.textContent).toContain('= 83,000원');
    clickButton('다시 적용', dlg);
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('83000');
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
    clickButton('샘플로 시작');
    const before = JSON.stringify(stored().sales);
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    setInput(inputByLabel('오늘 매출', dlg), '85000');
    clickButton('할인 전 판매액으로 계산', dlg);
    setInput(inputByLabel('할인·환불 전 판매액', dlg), '100000');
    clickButton('취소', dlg);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(JSON.stringify(stored().sales)).toBe(before);
  });

  it('판매 방식·경로를 바꿀 때 입력 내용을 보호한다 (옮기기·비우기·취소)', async () => {
    mount();
    clickButton('샘플로 시작');
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    // 입력이 없으면 자유롭게 바꾼다
    clickButton('배달', dlg);
    expect(dlg.querySelector('[role="alertdialog"]')).toBeNull();
    clickButton('홀', dlg);
    setInput(inputByLabel('오늘 매출', dlg), '300000');
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
    expect(dlg.querySelector('[aria-label="입력 진행"]')!.textContent).toContain('지금: 매장 방문 주문 · 홀');
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('300000');
    // 비우고 새로 입력
    clickButton('배달', dlg);
    ask = dlg.querySelector('[role="alertdialog"]') as HTMLElement;
    clickButton('비우고 새로 입력', ask);
    expect(dlg.querySelector('[aria-label="입력 진행"]')!.textContent).toContain('지금: 배달앱 A · 배달');
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('');
    expect(inputByLabel('완료 주문 수', dlg).value).toBe('');
    // 옮기기: 경로만 바꾸고 입력은 유지
    setInput(inputByLabel('오늘 매출', dlg), '410000');
    clickButton('배달앱 B', dlg);
    ask = dlg.querySelector('[role="alertdialog"]') as HTMLElement;
    clickButton(/옮기기$/, ask);
    expect(dlg.querySelector('[aria-label="입력 진행"]')!.textContent).toContain('지금: 배달앱 B · 배달');
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('410000');
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
    clickButton('샘플로 시작');
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    setInput(inputByLabel('오늘 매출', dlg), '300000');
    setInput(inputByLabel('완료 주문 수', dlg), '15');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    clickButton('저장하고 다음', dlg);
    spy.mockRestore();
    expect(text()).toContain('저장하지 못했습니다');
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(numVal(inputByLabel('오늘 매출', dialog()))).toBe('300000');
    expect(stored().sales.some((e) => e.date === todayStr())).toBe(false);
    // 다시 누르면 저장된다. 빠르게 두 번 눌러도 한 번만 저장
    const btn = findButton('저장하고 다음', dialog()) as HTMLButtonElement;
    act(() => {
      btn.click();
      btn.click();
    });
    expect(stored().sales.filter((e) => e.date === todayStr())).toHaveLength(1);
  });

  it('1단계 재현 + 수수료 자동 계산: 정보가 없으면 수수료만 계산하지 않고(0원 아님), 필요한 내역만 물어 바로 채운다', async () => {
    mount();
    clickButton('샘플로 시작');
    // 1) 홀: 결제수단을 모르면 결제 수수료는 계산하지 않는다 (전체를 카드 매출로 보지 않음)
    clickButton('＋ 오늘 매출 기록하기');
    let dlg = dialog();
    setInput(inputByLabel('오늘 매출', dlg), '650000');
    setInput(inputByLabel('완료 주문 수', dlg), '30');
    expect(dlg.textContent).toContain('이 경로의 결제 수수료 계산에는 카드 결제액이 필요해요');
    clickButton('나중에 입력', dlg);
    expect(dlg.textContent).not.toContain('카드 결제액이 필요해요');
    clickButton('저장하고 닫기', dlg); // 정보가 없어도 저장은 된다
    const hall = stored().sales.find((e) => e.date === todayStr() && e.channel === 'hall')!;
    expect(hall.costs.payment.estimated).toBeNull();
    expect(hall.costs.hallSupplies.estimated).toBe(480 * 30);
    expect(text()).toContain('계산에 필요한 정보 없음: 결제 수수료');
    // 2) 배달앱 A: 기준이 '할인 후·환불 전'이라 환불액만 필요 → '필요한 내역 입력'으로 같은 영역의 환불액 칸으로 이동
    clickButton('＋ 오늘 매출 기록하기');
    dlg = dialog();
    expect(dlg.querySelector('[aria-label="입력 진행"]')!.textContent).toContain('지금: 배달앱 A · 배달');
    setInput(inputByLabel('오늘 매출', dlg), '700000');
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
    expect(del.costs.delivery.estimated).toBe(3300 * 36);
    // 홈: 숫자는 보이고, 결제 수수료 정보가 없어 미확정
    const summary = document.querySelector('section[aria-label="기간 요약"]')!.textContent!;
    expect(summary).toMatch(/영업이익[\s\S]*?[\d,]+(만 )?원/);
    expect(summary).not.toContain('데이터 필요');
    expect(summary).toContain('미확정');
  });

  it('홀 결제 구분: 전부 현금이면 결제 수수료 적용 안 함, 섞이면 카드 결제액에만 계산', async () => {
    mount();
    clickButton('샘플로 시작');
    clickButton('＋ 오늘 매출 기록하기');
    let dlg = dialog();
    setInput(inputByLabel('오늘 매출', dlg), '300000');
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
    setInput(inputByLabel('매출 금액', dlg), '100000');
    setInput(inputByLabel('완료 주문 수', dlg), '5');
    clickButton('전부 현금', dlg);
    clickButton('저장하고 닫기', dlg);
    const cash = stored().sales.find((e) => e.date === cashDay && e.channel === 'hall')!;
    expect(cash.costs.payment.estimated).toBe(0);
    expect(cash.costs.payment.estimateBasis).toContain('현금');
  });

  it('빈 값 저장 시 필드 옆 오류와 하단 안내를 보여주고, 기존 기록과 같은 날짜·경로면 수정을 안내한다', async () => {
    mount();
    clickButton('샘플로 시작');
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
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('');
    act(() => (dlg.querySelector('button[aria-label="환불 없음"]') as HTMLButtonElement).click());
    expect(dlg.textContent).toContain('기록할 매출 = 200,000원 − 5,000원 − 0원 = 195,000원');
    clickButton('계산한 금액 적용', dlg);
    expect(dlg.textContent).toContain('계산한 매출 195,000원을 적용했어요');
    expect(numVal(inputByLabel('오늘 매출', dlg))).toBe('195000');
    expect(document.activeElement?.textContent).toBe('할인 전 판매액으로 계산'); // 포커스 복귀
    setInput(inputByLabel('완료 주문 수', dlg), '10');
    clickButton('저장하고 마치기', dlg); // 경로 하나뿐인 가게
    // 알림 첫 줄은 저장 결과만, 비용 상태는 둘째 줄에 작게, '비용 확인' 이동 버튼
    const toastArea = document.querySelector('[data-toast-area]')!;
    expect(toastArea.querySelector('.font-medium')!.textContent).toBe('매출을 저장했습니다');
    expect(toastArea.querySelector('.text-xs')!.textContent).toContain('매출 입력 완료');
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
    clickButton('샘플로 시작');
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
    clickButton('샘플로 시작');
    await go('diagnosis');
    // 상위 3개: 배달 주문 1건당 남는 금액 감소 아래에 원인 후보가 묶여 있다
    const top = text();
    expect(top).toContain('함께 변한 것 (원인 후보)');
    expect(top).toMatch(/가게 부담 할인 비율 \d+\.\d% → \d+\.\d%/);
    expect(top).not.toContain('2. 배달 평균 주문금액 하락');
    expect(top).not.toContain('3. 배달 평균 주문금액 하락');
    const before = stored().solutions.length;
    // 1위 항목(배달, 이익 영향 기준)은 샘플의 '배달 할인 효율 검토'와 같은 예시
    expect(top).toMatch(/1\. 배달 주문 1건당 남는 금액 감소이익 영향 −\d+만 원/);
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
    clickButton('샘플로 시작');
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
    await go('performance', `?solution=${stored().solutions[1].id}`);
    expect(text()).toMatch(/실행 후 기간 \d+건/);
    expect(text()).toContain('영업이익 변화: 예상과 실제');
    // 큰 금액은 만 원 단위로, 누르면 정확한 원 단위
    const exp = findButton('+45만 원')!;
    expect(exp).toBeTruthy();
    act(() => exp.click());
    expect(text()).toContain('+450,000원');
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
    expect(text()).toContain('오늘 매출 기록하기'); // 핵심 기능은 그대로
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
    clickButton('샘플로 시작');
    await go('performance');
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
    clickButton('샘플 종료하고 내 가게 등록');
    await clickLastButton('샘플 종료');
    expect(text()).toContain('내 가게 등록하기');
    expect(document.getElementById('recharts_measurement_span')).toBeNull();
  });

  it('내 가게 등록 후 빈 상태를 안내한다', async () => {
    mount();
    clickButton('등록 시작');
    clickButton('등록하고 시작');
    expect(text()).toContain('가게명을 입력하세요');
    setInput(document.querySelector('input[placeholder="예: 우리동네 분식"]') as HTMLInputElement, '테스트 식당');
    clickButton('등록하고 시작');
    expect(text()).toContain('기본 정보');
    expect(text()).not.toContain('샘플 데이터 사용 중');
    await go('dashboard');
    expect(text()).toContain('아직 매출 기록이 없습니다');
    expect(text()).toContain('1개 판매 방식 중 0개 완료 · 남은 경로 1곳');
    await go('diagnosis');
    expect(text()).toContain('등록된 문제가 없습니다');
    await go('performance');
    expect(text()).toContain('확인할 실행 계획이 없습니다');
  });

  it('4차 1단계: 홀·배달·포장을 모두 고르고 등록하면 배달앱을 묻고, 홈 입력 현황에 세 판매 방식이 모두 보인다', async () => {
    mount();
    clickButton('등록 시작');
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
    expect(text()).toContain('3개 판매 방식 중 0개 완료 · 남은 경로 3곳');
    // 배달 경로에 바로 매출을 넣을 수 있다
    const deliveryRow = document.querySelector('[aria-label="판매 방식별 입력 현황"] > li[data-channel="delivery"]')!;
    clickButton('입력', deliveryRow);
    expect(dialog().textContent).toContain('배달앱 가');
  });

  it('4차 1단계: 성과 확인은 영업일 수 차이와 대상 외 변화를 안내한다 (포장 주문과 픽업 개선)', async () => {
    mount();
    clickButton('샘플로 시작');
    const sol = stored().solutions.find((s) => s.templateId === 'takeout-pickup')!;
    await go('performance', `?solution=${sol.id}`);
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
    clickButton('샘플로 시작');
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
    expect(sol.coupon).toEqual({ amount: 2000, minOrder: 15000 });

    await go('performance', `?solution=${sol.id}`);
    const t = text();
    expect(t).toContain('쿠폰 2,000원 · 최소 주문 15,000원');
    expect(t).toContain('배달 1건당 남은 돈');
    expect(t).toContain('배달 판매 방식 비용을 뺀 금액'); // 정확한 용어는 보조 설명으로
    expect(t).toContain('배달 쿠폰·할인으로 낸 돈');
    expect(t).toContain('함께 보는 지표');
    expect(t).toContain('가게에 남은 돈');
    expect(document.querySelector('[aria-label="할인 1,000원당 효과"]')).toBeTruthy();

    // 결과 판단에 다음 기간 쿠폰 금액을 적으면, 다음 새 계획의 기본값이 된다
    setInput(inputByLabel('다음 기간 쿠폰 금액 (선택)'), '1500');
    clickButton('비교 기간과 판단 저장');
    expect(stored().solutions.find((s) => s.id === sol.id)!.review.nextCouponAmount).toBe(1500);
    await go('solutions');
    clickButton('실행 계획 등록');
    dlg = dialog();
    expect(numVal(inputByLabel('쿠폰 금액', dlg))).toBe('1500');
    expect(dlg.textContent).toContain('결과 판단에서 정한 다음 기간 쿠폰 금액(1,500원)을 불러왔어요');
  });

  it('4차 2단계: 홈에 추정값을 확인할 할 일이 보이고(설정대로 계산한 수수료는 제외), 누르면 그 기록만 모은 입력 화면으로 간다', async () => {
    mount();
    clickButton('샘플로 시작');
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
    expect(window.location.hash).toContain('sales');
    expect(text()).toMatch(/아직 추정값인 기록 \d+건만 보여 줘요/);
    expect(text()).toContain('추정 포함');
    expect(text()).not.toContain('추정 중');
    // 목록(날짜별 기록 묶음)에는 그 경로의 배달 기록만
    const records = Array.from(document.querySelectorAll('section:not([aria-label]) > ul > li'));
    expect(records.length).toBeGreaterThan(0);
    expect(records.map((li) => li.textContent!.match(/^(홀|배달|포장) · [^(순]+/)?.[0].trim())).toEqual(records.map(() => '배달 · 배달앱 A'));
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

  it('3차 1단계: 건너뛴 영업일은 홈에 "미입력 → 입력하기"로 보이고, 진단 기간이 홈과 다르면 맞추기 버튼이 보인다', async () => {
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
    const box = document.querySelector('[aria-label="미입력 영업일"]') as HTMLElement;
    expect(box).not.toBeNull();
    const label = `${gap.slice(5).replace('-', '.')}`;
    expect(box.textContent).toContain(`${label}`);
    expect(box.textContent).toContain('미입력');
    expect(box.textContent).toContain('기간 비용 계산에서 뺐어요');
    act(() => (box.querySelector('button[aria-label$="매출 입력하기"]') as HTMLButtonElement).click());
    const dlg = dialog();
    expect((dlg.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(gap);
    act(() => (dlg.querySelector('button[aria-label="닫기"]') as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
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
    clickButton('샘플로 시작');
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
    setInput(inputByLabel('오늘 매출', dlg), '123000');
    setInput(inputByLabel('완료 주문 수', dlg), '9');
    clickButton('저장하고 닫기', dlg);
    await act(async () => {});
    expect(window.location.hash).toContain(`month=${thisMonth}`);
    expect(document.querySelector('[aria-label="월 선택"]')!.textContent).toContain(monthLabel(thisMonth));
  });

  it('4단계: 화면 어디에도 옛 용어·괄호 조사가 없고, 경로 이름에 판매 방식이 붙고, 매출 목록 요약이 바뀌었다', async () => {
    mount();
    clickButton('샘플로 시작');
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
    clickButton('＋ 오늘 매출 기록하기');
    const dlg = dialog();
    setInput(inputByLabel('오늘 매출', dlg), '500000');
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
    clickButton('＋ 오늘 매출 기록하기');
    let dlg = dialog();
    // 매출만 넣고 주문 수가 없으면 포장비는 구할 수 없으므로 무엇을 넣을지 알려준다
    setInput(inputByLabel('오늘 매출', dlg), '200000');
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
