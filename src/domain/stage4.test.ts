// 4차 점검(배달 쿠폰 결정 페르소나) 1단계 버그 수정. 격리된 데이터만 사용한다(localStorage 사용 안 함).
// 샘플은 2026-11-19까지 생성(오늘 2026-11-20 상황) — 점검 보고서의 숫자와 같은 데이터.
import { describe, expect, it } from 'vitest';
import { computeSummary } from './calc';
import { byImpact, diagnose, impactText, topIssues } from './diagnosis';
import { registerStoreData } from './factory';
import { reviewUnavailableReason } from './periods';
import { reviewContext } from './review';
import { generateSample } from './sample';

describe('1. 가게 등록 시 판매 방식마다 매출을 넣을 경로를 만든다', () => {
  const base = { name: '덮밥집', channels: ['hall', 'delivery', 'takeout'] as const, regularOpenDays: [1, 2, 3, 4, 5, 6], today: '2026-11-20' };
  it('배달앱 이름을 넣으면 플랫폼과 배달 경로를 함께 만든다 (홀·배달·포장 세 판매 방식 모두 경로 있음)', () => {
    const d = registerStoreData({ ...base, channels: [...base.channels], deliveryApps: [{ name: '배달앱 가', brokerageRate: null, paymentRate: null, vatExclusive: false }] });
    expect(d.platforms.map((p) => p.name)).toEqual(['배달앱 가']);
    const delivery = d.routes.filter((r) => r.channels.includes('delivery'));
    expect(delivery).toHaveLength(1);
    expect(delivery[0].platformId).toBe(d.platforms[0].id);
    for (const ch of ['hall', 'delivery', 'takeout'] as const) expect(d.routes.some((r) => r.channels.includes(ch))).toBe(true);
    // 수수료율을 모르면 수수료 설정을 만들지 않는다(0%로 가정하지 않음)
    expect(d.feeRules).toEqual([]);
  });
  it('수수료율을 입력한 배달앱만 수수료 자동 계산 설정을 만든다', () => {
    const d = registerStoreData({
      ...base,
      channels: [...base.channels],
      deliveryApps: [
        { name: '배달앱 가', brokerageRate: 6.8, paymentRate: 3, vatExclusive: true },
        { name: '배달앱 나', brokerageRate: null, paymentRate: null, vatExclusive: false },
        { name: '  ', brokerageRate: 5, paymentRate: null, vatExclusive: false },
      ],
    });
    expect(d.routes.filter((r) => r.channels.includes('delivery')).map((r) => r.name)).toEqual(['배달앱 가', '배달앱 나']);
    expect(d.feeRules).toHaveLength(1);
    const rule = d.feeRules[0];
    expect(rule.routeId).toBe(d.routes.find((r) => r.name === '배달앱 가')!.id);
    expect(rule).toMatchObject({ brokerageRate: 6.8, paymentRate: 3, vatExclusive: true, mode: 'separate', effectiveFrom: '2025-11-20' });
  });
  it('배달앱을 나중에 등록해도 배달 경로는 만든다 / 직접 배달을 고르면 플랫폼 없는 경로', () => {
    const later = registerStoreData({ ...base, channels: [...base.channels] });
    expect(later.routes.filter((r) => r.channels.includes('delivery')).map((r) => [r.name, r.platformId])).toEqual([['배달 주문', null]]);
    const direct = registerStoreData({ ...base, channels: [...base.channels], deliveryApps: [{ name: '배달앱 가', brokerageRate: null, paymentRate: null, vatExclusive: false }], directDelivery: true });
    expect(direct.routes.filter((r) => r.channels.includes('delivery')).map((r) => r.name)).toEqual(['배달앱 가', '직접 배달 주문']);
  });
  it('배달을 고르지 않으면 배달 경로·플랫폼을 만들지 않는다', () => {
    const d = registerStoreData({ ...base, channels: ['hall', 'takeout'] });
    expect(d.routes.map((r) => r.id)).toEqual(['route_hall', 'route_takeout']);
    expect(d.platforms).toEqual([]);
  });
});

describe('2. 먼저 확인할 문제: 영향 금액을 영업이익 기준으로 통일', () => {
  const data = generateSample('2026-11-19');
  const dx = diagnose(data, data.problems[0]);
  const find = (id: string) => dx.findings.find((f) => f.id === id)!;
  const dp = (s: typeof dx.prev, ch: 'hall' | 'delivery' | 'takeout') => s.channels[ch].directProfit.value!;

  it('홀 고객 수 감소 = 줄어든 고객 수 × 비교 기간 고객 1명당 남는 금액 (매출 기준 −319만이 아님)', () => {
    const f = find('hall-visitors-down');
    const q0 = dx.prev.channels.hall.visitors!;
    const q1 = dx.cur.channels.hall.visitors!;
    expect(q0 - q1).toBe(281);
    expect(f.impactBasis).toBe('profit');
    expect(f.impact!).toBeCloseTo((q1 - q0) * (dp(dx.prev, 'hall') / q0), 6);
    expect(Math.round(f.impact! / 10000)).toBe(-202);
    expect(f.impactNote).toBe('줄어든 고객 281명 × 비교 기간 고객 1명당 남는 금액 7,197원');
  });
  it('수량 효과 + 단위당 효과 = 판매 방식 비용을 뺀 금액의 실제 변화 (홀 약 −182만)', () => {
    const q0 = dx.prev.channels.hall.visitors!;
    const q1 = dx.cur.channels.hall.visitors!;
    const unit = q1 * (dp(dx.cur, 'hall') / q1 - dp(dx.prev, 'hall') / q0);
    expect(find('hall-visitors-down').impact! + unit).toBeCloseTo(dp(dx.cur, 'hall') - dp(dx.prev, 'hall'), 4);
    expect(Math.round((dp(dx.cur, 'hall') - dp(dx.prev, 'hall')) / 10000)).toBe(-182);
  });
  it('순위: 배달 1건당 남는 금액 감소(−317만)가 1위, 홀 고객 수 감소(−202만)가 2위', () => {
    const top = topIssues(dx, 3);
    expect(top.map((f) => f.id).slice(0, 2)).toEqual(['delivery-unit-profit-down', 'hall-visitors-down']);
    expect(Math.round(top[0].impact! / 10000)).toBe(-317);
    expect(top.every((f) => f.impactBasis !== 'sales')).toBe(true);
    expect(impactText(top[0])).toBe('이익 영향 −317만 원');
  });
  it('진단 ④의 주문 수 증가도 같은 기준: 배달 +469만(매출) → 늘어난 주문 × 비교 기간 1건당 남는 금액', () => {
    const f = find('delivery-orders-up');
    const q0 = dx.prev.channels.delivery.orders!;
    const q1 = dx.cur.channels.delivery.orders!;
    expect(f.impactBasis).toBe('profit');
    expect(f.impact!).toBeCloseTo((q1 - q0) * (dp(dx.prev, 'delivery') / q0), 6);
    expect(Math.round(f.impact! / 10000)).toBe(169);
  });
  it('이익으로 바꿀 수 없는 평균 주문금액 하락은 "매출 영향"으로 표시하고 이익 항목 뒤에 둔다', () => {
    const f = find('delivery-aov-down');
    expect(f.impactBasis).toBe('sales');
    expect(impactText(f)).toMatch(/^매출 영향 −/);
    const sorted = byImpact(dx.findings);
    const firstSales = sorted.findIndex((x) => x.impactBasis === 'sales');
    const lastProfit = sorted.map((x) => x.impact !== null && x.impactBasis !== 'sales').lastIndexOf(true);
    expect(firstSales).toBeGreaterThan(lastProfit);
    // 배달 대표 항목 아래 원인 후보에는 그대로 묶인다
    expect(topIssues(dx, 3)[0].related.map((r) => r.id)).toContain('delivery-aov-down');
  });
});

describe('3. 성과 확인: 영업일 수 차이와 대상 외 판매 방식 변화', () => {
  const data = generateSample('2026-11-19');
  const sol = data.solutions.find((s) => s.templateId === 'takeout-pickup')!;
  const b = computeSummary(data, sol.review.before!);
  const a = computeSummary(data, sol.review.after!);
  const ctx = reviewContext(b, a, 'takeout');
  it('두 기간 모두 14일이지만 영업일은 11일 / 12일', () => {
    expect([b.calendarDays, a.calendarDays]).toEqual([14, 14]);
    expect([ctx.beforeDays, ctx.afterDays]).toEqual([11, 12]);
    expect(ctx.businessDaysDiffer).toBe(true);
    expect(ctx.opPerDay.before).toBeCloseTo(b.operatingProfit.value! / 11, 6);
    expect(ctx.opPerDay.after).toBeCloseTo(a.operatingProfit.value! / 12, 6);
  });
  it('전체 영업이익 +73만 중 대상 포장 +23만, 홀 +44만 → 대상 외 변화가 더 큼', () => {
    expect(Math.round(ctx.opDelta! / 10000)).toBe(73);
    expect(Math.round(ctx.targetDelta! / 10000)).toBe(23);
    expect(Math.round(ctx.channelDelta.hall! / 10000)).toBe(44);
    expect(ctx.outweighing).toEqual(['hall']);
  });
  it('가게 전체 대상 계획은 대상 외 비교를 하지 않는다', () => {
    expect(reviewContext(b, a, 'all').outweighing).toEqual([]);
  });
});

describe('4. 성과 확인 안내는 상태값을 따른다', () => {
  const today = '2026-11-20';
  it("상태가 '계획'이면 날짜상 실행 기간이어도 '실행 중'이 아니라 시작 전", () => {
    expect(reviewUnavailableReason({ start: '2026-11-20', end: '2026-12-17', status: 'planned' }, '2026-11-19', today)).toBe('planned');
    expect(reviewUnavailableReason({ start: '2026-11-20', end: '2026-12-17', status: 'running' }, '2026-11-19', today)).toBe('running');
    expect(reviewUnavailableReason({ start: '2026-11-25', end: '2026-12-17', status: 'planned' }, '2026-11-19', today)).toBe('notStarted');
  });
  it('종료일 전에 중단·완료로 바꾸면 일찍 끝낸 것으로 안내', () => {
    expect(reviewUnavailableReason({ start: '2026-11-01', end: '2026-12-17', status: 'stopped' }, '2026-11-19', today)).toBe('endedEarly');
    expect(reviewUnavailableReason({ start: '2026-11-01', end: '2026-12-17', status: 'done' }, '2026-11-19', today)).toBe('endedEarly');
  });
  it('샘플의 배달 할인 효율 검토(상태: 계획)', () => {
    const data = generateSample('2026-11-19');
    const s = data.solutions.find((x) => x.templateId === 'delivery-discount')!;
    expect(s.status).toBe('planned');
    expect(reviewUnavailableReason(s, '2026-11-19', today)).toBe('planned');
  });
});
