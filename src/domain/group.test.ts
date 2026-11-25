import { describe, expect, it } from 'vitest';
import { computeSummary, netSales } from './calc';
import { dayInputStatus, groupDayStatus } from './entry';
import { newSalesEntry } from './factory';
import { generateSample } from './sample';
import type { AppData, Channel } from './types';

// 격리된 샘플 데이터. 2026-11-18(수)은 샘플 기록이 없는 영업일
const D = '2026-11-18';
const sale = (channel: Channel, routeId: string, net: number | null, paymentMethodId: string | null = null) =>
  newSalesEntry({ date: D, channel, routeId, amountMode: 'net', netInput: net, orders: 10, paymentMethodId });
const noSales = (channel: Channel, routeId: string) => ({ date: D, channel, routeId, status: 'noSales' as const, checkedAt: '2026-11-18T12:00:00.000Z' });
const groupsOf = (d: AppData) => Object.fromEntries(groupDayStatus(dayInputStatus(d, D)).map((g) => [g.channel, g]));

describe('입력 현황: 판매 방식별 묶음', () => {
  it('가게의 판매 방식 순서대로 홀·배달·포장 세 그룹, 경로는 그룹 안에', () => {
    const d = generateSample('2026-11-15');
    const gs = groupDayStatus(dayInputStatus(d, D));
    expect(gs.map((g) => g.channel)).toEqual(['hall', 'delivery', 'takeout']);
    expect(gs.map((g) => g.slots.map((s) => s.routeId))).toEqual([['route_hall'], ['route_app_a', 'route_app_b'], ['route_app_a', 'route_phone']]);
  });

  it('전체 미입력: 금액은 — (0원으로 보지 않음), 주요 버튼은 첫 미입력 경로', () => {
    const g = groupsOf(generateSample('2026-11-15'));
    for (const ch of ['hall', 'delivery', 'takeout']) {
      expect(g[ch].state).toBe('missing');
      expect(g[ch].total).toBeNull();
      expect(g[ch].doneCount).toBe(0);
    }
    expect(g.delivery.nextSlot!.routeId).toBe('route_app_a');
  });

  it('일부 입력·완료·매출 없음이 섞인 경우', () => {
    const d = generateSample('2026-11-15');
    const card = d.paymentMethods.find((p) => p.name.includes('카드'))!.id;
    const cash = d.paymentMethods.find((p) => p.name.includes('현금'))!.id;
    // 홀: 같은 경로에 결제수단별 기록 2건 → 경로는 1곳으로 센다
    d.sales.push(sale('hall', 'route_hall', 500_000, card), sale('hall', 'route_hall', 200_000, cash));
    // 배달: A만 입력 → 일부 입력 1/2
    d.sales.push(sale('delivery', 'route_app_a', 300_000));
    // 포장: 두 경로 모두 매출 없음 확인
    d.salesChecks.push(noSales('takeout', 'route_app_a'), noSales('takeout', 'route_phone'));
    const g = groupsOf(d);
    expect(g.hall).toMatchObject({ state: 'done', routeCount: 1, doneCount: 1, total: 700_000 });
    expect(g.delivery).toMatchObject({ state: 'partial', routeCount: 2, doneCount: 1, total: 300_000 });
    expect(g.delivery.nextSlot!.routeId).toBe('route_app_b'); // 이어 입력: 남은 경로
    expect(g.takeout).toMatchObject({ state: 'noSales', doneCount: 2, total: 0 });
    // 그룹 합계는 그날 기록의 매출 합과 같다 (같은 계산 기준, 별도 저장 없음)
    const sum = d.sales.filter((e) => e.date === D).reduce((s, e) => s + (netSales(e) ?? 0), 0);
    expect(g.hall.total! + g.delivery.total! + g.takeout.total!).toBe(sum);
    // 배달앱 B가 미입력이라 총매출은 부분 합계(완전한 실적으로 비교하지 않음)
    expect(computeSummary(d, { start: D, end: D }).totalSales).toMatchObject({ value: null, provisional: sum, salesGap: true });
  });

  it('매출 없음 + 입력이 섞이면 완료(합계는 입력분), 매출 없음 + 미입력은 일부 입력', () => {
    const d = generateSample('2026-11-15');
    d.sales.push(sale('delivery', 'route_app_a', 250_000));
    d.salesChecks.push(noSales('delivery', 'route_app_b'), noSales('takeout', 'route_phone'));
    const g = groupsOf(d);
    expect(g.delivery).toMatchObject({ state: 'done', doneCount: 2, total: 250_000 });
    expect(g.takeout).toMatchObject({ state: 'partial', doneCount: 1, total: 0 });
  });

  it('금액이 빈 기록이 있으면 합계가 불완전함을 표시한다', () => {
    const d = generateSample('2026-11-15');
    d.sales.push(sale('hall', 'route_hall', null));
    expect(groupsOf(d).hall).toMatchObject({ state: 'done', amountMissing: true, total: 0 });
  });

  it('휴업일: 기록이 없으면 휴업, 주요 버튼은 첫 경로', () => {
    const d = generateSample('2026-11-15');
    d.dayOverrides.push({ date: D, open: false, note: '테스트 휴업' });
    const g = groupsOf(d);
    expect(g.hall.state).toBe('closed');
    expect(g.hall.total).toBeNull();
    expect(g.hall.nextSlot!.routeId).toBe('route_hall');
  });

  it('입력 현황 계산은 데이터를 바꾸지 않는다', () => {
    const d = generateSample('2026-11-15');
    const before = JSON.stringify(d);
    groupDayStatus(dayInputStatus(d, '2026-11-14'));
    expect(JSON.stringify(d)).toBe(before);
  });
});
