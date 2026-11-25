// 검증용: 홀만 운영하는 대학생협 식당 — 토요일 영업을 11~13시로 줄인 계획 (윤해원 운영위원 사례)
// 실행 전후 각각 4주: 평일 20일 × 하루 120명, 토요일 4회 × (실행 전 40명 / 실행 후 32명). 일요일 휴무.
import { eachDay, weekday } from '../domain/dates';
import { emptyCost, newProblem, newSalesEntry, newSolution, registerStoreData } from '../domain/factory';
import type { AppData, DateRange } from '../domain/types';

export const COOP = {
  before: { start: '2026-09-07', end: '2026-10-04' } as DateRange,
  after: { start: '2026-10-05', end: '2026-11-01' } as DateRange,
  /** 한 끼 가격 */
  price: 5_000,
};

export function coopData(): AppData {
  const d = registerStoreData({ name: '대학생협 학생식당', channels: ['hall'], regularOpenDays: [1, 2, 3, 4, 5, 6], today: '2026-11-02' });
  d.mode = 'user';
  d.sampleToday = '2026-11-02';
  d.store = { ...d.store!, commonCostChecklist: ['labor', 'rent'], weekdayHours: [{ day: 6, openTime: '11:00', closeTime: '13:00' }] };
  for (const [range, sat] of [
    [COOP.before, 40],
    [COOP.after, 32],
  ] as const) {
    for (const date of eachDay(range)) {
      const w = weekday(date);
      if (w === 0) continue;
      const people = w === 6 ? sat : 120;
      const costs = { ...newSalesEntry().costs };
      costs.food = { ...emptyCost(), actual: people * 2_500 };
      costs.payment = { ...emptyCost(), actual: 0 };
      costs.hallSupplies = { ...emptyCost(), actual: people * 100 };
      d.sales.push(newSalesEntry({ id: `coop_${date}`, date, channel: 'hall', routeId: 'route_hall', orders: people, visitors: people, meals: people, amountMode: 'gross', gross: people * COOP.price, storeDiscount: 0, refund: 0, costs }));
    }
  }
  // 월세·인건비: 달마다 기간 비용 (달력 일수로 안분)
  for (const [start, end] of [
    ['2026-09-01', '2026-09-30'],
    ['2026-10-01', '2026-10-31'],
    ['2026-11-01', '2026-11-30'],
  ]) {
    d.periodCosts.push({ id: `rent_${start}`, category: 'rent', attribution: 'common', nature: 'fixed', start, end, amount: 3_000_000, source: 'actual', memo: '' });
    d.periodCosts.push({ id: `labor_${start}`, category: 'labor', attribution: 'common', nature: 'fixed', start, end, amount: 9_000_000, source: 'actual', memo: '' });
  }
  const problem = newProblem({ id: 'coop_problem', name: '토요일 운영 적자', type: 'profitDecline', analysis: COOP.before, compare: COOP.before, channel: 'hall', target: { key: 'visitors', channel: 'hall' }, weekdays: [6] });
  d.problems = [problem];
  d.solutions = [
    newSolution({
      id: 'coop_sat',
      problemId: problem.id,
      name: '토요일 영업 11~13시로 단축',
      target: 'hall',
      direction: 'cost',
      actions: '토요일 영업시간을 11:00~13:00로 줄임',
      start: COOP.after.start,
      end: COOP.after.end,
      kpi: { key: 'visitors', channel: 'hall' },
      extraKpis: [
        { key: 'meals', channel: 'hall' },
        { key: 'operatingProfit', channel: 'all' },
      ],
      weekdays: [6],
      status: 'reviewPending',
    }),
  ];
  return d;
}
