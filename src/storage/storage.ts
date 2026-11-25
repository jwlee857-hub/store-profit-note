// localStorage 저장·불러오기와 JSON 백업 형식 검증. 외부로 전송하지 않는다.
import { isValidDate } from '../domain/dates';
import { CHANNELS, SCHEMA_VERSION, type AppData } from '../domain/types';

export const STORAGE_KEY = 'restaurant-profit-beta';

export interface StoredEnvelope {
  app: 'restaurant-profit-beta';
  schemaVersion: number;
  exportedAt: string;
  data: AppData;
}

/** 불러오기·변환에 실패한 원본을 지우지 않고 보관하는 키 */
export const RECOVERY_KEY = `${STORAGE_KEY}:recovery`;
/** 이전 스키마 데이터를 변환하기 전 원본을 보관하는 키 접두어 */
export const PRE_MIGRATION_PREFIX = `${STORAGE_KEY}:before-v`;

export type LoadResult = { ok: true; data: AppData | null } | { ok: false; error: string; raw: string | null };

export function loadFromStorage(storage: Storage | undefined = safeStorage()): LoadResult {
  if (!storage) return { ok: true, data: null };
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ok: true, data: null };
    const parsed = parseBackup(raw);
    if (!parsed.ok) {
      preserveRaw(storage, RECOVERY_KEY, raw);
      return { ok: false, error: parsed.error, raw };
    }
    // 이전 버전 데이터를 변환했다면 변환 전 원본을 한 번 보관해 둔다(덮어쓰지 않음)
    const ver = readVersion(raw);
    if (ver !== null && ver < SCHEMA_VERSION) preserveRaw(storage, `${PRE_MIGRATION_PREFIX}${SCHEMA_VERSION}`, raw);
    return { ok: true, data: parsed.data };
  } catch (e) {
    if (raw) preserveRaw(storage, RECOVERY_KEY, raw);
    return { ok: false, error: `저장된 데이터를 읽지 못했습니다: ${(e as Error).message}`, raw };
  }
}

function readVersion(raw: string): number | null {
  try {
    const j = JSON.parse(raw);
    return typeof j?.schemaVersion === 'number' ? j.schemaVersion : null;
  } catch {
    return null;
  }
}

/** 원본 보관. 같은 키에 이미 보관본이 있으면 덮어쓰지 않는다. 저장 공간 부족이면 조용히 건너뛴다. */
function preserveRaw(storage: Storage, key: string, raw: string) {
  try {
    if (!storage.getItem(key)) storage.setItem(key, raw);
  } catch {
    /* 보관 실패는 무시: 원본 키는 그대로 남아 있다 */
  }
}

export function readRecovery(storage: Storage | undefined = safeStorage()): string | null {
  try {
    return storage?.getItem(RECOVERY_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveToStorage(data: AppData, storage: Storage | undefined = safeStorage()): { ok: boolean; error?: string } {
  if (!storage) return { ok: false, error: '이 브라우저에서는 저장소를 사용할 수 없습니다.' };
  try {
    storage.setItem(STORAGE_KEY, serialize(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `저장하지 못했습니다(저장 공간 부족 등): ${(e as Error).message}` };
  }
}

export function clearStorage(storage: Storage | undefined = safeStorage()) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* 무시 */
  }
}

export function serialize(data: AppData): string {
  const env: StoredEnvelope = { app: 'restaurant-profit-beta', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
  return JSON.stringify(env, null, 2);
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

// ───────────── 형식 검증 ─────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
const isWeekday = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6;
/** 적용 요일: 없음·null·요일 숫자 목록 */
const weekdaysOk = (v: unknown) => v === undefined || v === null || (Array.isArray(v) && v.every(isWeekday));
const isStr = (v: unknown) => typeof v === 'string';

const COLLECTIONS = [
  'platforms',
  'routes',
  'paymentMethods',
  'feeRules',
  'dayOverrides',
  'menus',
  'sales',
  'periodCosts',
  'customerMetrics',
  'problems',
  'solutions',
] as const;

export function parseBackup(text: string): { ok: true; data: AppData } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 형식이 아닙니다.' };
  }
  if (!isObj(json)) return { ok: false, error: '백업 파일 구조가 올바르지 않습니다.' };
  if (json.app !== 'restaurant-profit-beta') return { ok: false, error: '이 앱에서 내보낸 백업 파일이 아닙니다.' };
  if (typeof json.schemaVersion !== 'number') return { ok: false, error: '스키마 버전 정보가 없습니다.' };
  if (json.schemaVersion > SCHEMA_VERSION)
    return { ok: false, error: `더 새로운 버전(v${json.schemaVersion})의 데이터입니다. 앱을 업데이트한 뒤 가져오세요.` };
  let migrated: unknown;
  try {
    migrated = migrate(json.data, json.schemaVersion);
  } catch (e) {
    return { ok: false, error: `이전 버전 데이터를 변환하지 못했습니다: ${(e as Error).message}` };
  }
  const err = validateData(migrated);
  if (err) return { ok: false, error: err };
  return { ok: true, data: migrated as AppData };
}

/**
 * 이전 스키마 데이터를 현재 버전으로 변환한다. 원본 객체는 바꾸지 않는다.
 * v1 → v2: 해결안에 kpiTargetMode 추가. 기존 판정과 같도록 'total'(실행 후 값 기준)로 채운다.
 */
export function migrate(data: unknown, version: number): unknown {
  if (!isObj(data)) return data;
  let d: Record<string, unknown> = data;
  let v = version;
  if (v < 2) {
    d = {
      ...d,
      schemaVersion: 2,
      solutions: Array.isArray(d.solutions)
        ? d.solutions.map((s) => (isObj(s) ? { ...s, kpiTargetMode: s.kpiTargetMode === 'increase' ? 'increase' : 'total' } : s))
        : d.solutions,
    };
    v = 2;
  }
  if (v < 3) {
    // v2 → v3
    // - 매출: 금액 기준(amountMode) 추가. 기존 기록은 모두 "할인·환불 전 판매액" 기준이므로 gross. 금액 값은 그대로 둔다.
    // - 고객 집계: 출처·플랫폼 재주문율 칸 추가(비어 있음)
    // - 매출 없음 확인 기록, 사용자 설정 추가
    const metrics = Array.isArray(d.customerMetrics) ? d.customerMetrics : [];
    d = {
      ...d,
      schemaVersion: 3,
      sales: Array.isArray(d.sales)
        ? d.sales.map((e) => (isObj(e) ? { ...e, amountMode: e.amountMode === 'net' ? 'net' : 'gross', netInput: isNumOrNull(e.netInput) ? (e.netInput ?? null) : null } : e))
        : d.sales,
      customerMetrics: metrics.map((m) =>
        isObj(m) ? { source: '', platformRepeatRate: null, platformRepeatDefinition: '', ...m } : m,
      ),
      salesChecks: Array.isArray(d.salesChecks) ? d.salesChecks : [],
      prefs: isObj(d.prefs) ? d.prefs : { lastEntry: null, customerData: metrics.length ? 'available' : 'unasked' },
    };
    v = 3;
  }
  if (v < 4) {
    // v3 → v4: 주문 1건당 기본 비용 목록 추가(비어 있음). 기존 기록·계산 결과는 바뀌지 않는다.
    d = { ...d, schemaVersion: 4, perOrderCosts: Array.isArray(d.perOrderCosts) ? d.perOrderCosts : [] };
    v = 4;
  }
  if (v < 5) {
    // v4 → v5: 매출 기록에 카드 결제액(cardSales, 결제 수수료 대상) 추가. 모름(null)으로 채운다.
    // 금액·비용·저장된 계산 근거는 바꾸지 않는다(과거 실적 재계산 없음).
    d = {
      ...d,
      schemaVersion: 5,
      sales: Array.isArray(d.sales) ? d.sales.map((e) => (isObj(e) ? { ...e, cardSales: isNumOrNull(e.cardSales) ? (e.cardSales ?? null) : null } : e)) : d.sales,
    };
    v = 5;
  }
  if (v < 6) {
    // v5 → v6: 실행 계획에 함께 볼 성과지표(extraKpis), 쿠폰·할인 조건(coupon), 결과 판단의 다음 기간 쿠폰 금액(review.nextCouponAmount) 추가.
    // 모두 빈 값으로 채운다. 기존 주 성과지표·목표·판정과 매출·비용 계산은 바뀌지 않는다.
    const okNum = (x: unknown) => (isNumOrNull(x) ? ((x as number | null | undefined) ?? null) : null);
    d = {
      ...d,
      schemaVersion: 6,
      solutions: Array.isArray(d.solutions)
        ? d.solutions.map((s) => {
            if (!isObj(s)) return s;
            const coupon = isObj(s.coupon) ? s.coupon : {};
            return {
              ...s,
              extraKpis: Array.isArray(s.extraKpis) ? s.extraKpis.filter((k) => isObj(k) && isStr(k.key) && isStr(k.channel)) : [],
              coupon: { amount: okNum(coupon.amount), minOrder: okNum(coupon.minOrder) },
              review: isObj(s.review) ? { ...s.review, nextCouponAmount: okNum(s.review.nextCouponAmount) } : s.review,
            };
          })
        : d.solutions,
    };
    v = 6;
  }
  if (v < 7) {
    // v6 → v7: 가게 설정의 식재료비 원가율(직접 지정) 목록 추가(비어 있음).
    // 매출 기록의 비용 값에는 손대지 않는다: 저장된 금액·계산 근거 문구(estimateBasis)는 그대로이고,
    // 계산 내용(calc)이 없는 이전 값은 근거 문구로 출처를 판별한다.
    d = { ...d, schemaVersion: 7, foodCostRates: Array.isArray(d.foodCostRates) ? d.foodCostRates : [] };
    v = 7;
  }
  if (v < 8) {
    // v7 → v8: 쿠폰 조건에 대상 배달앱·기존 쿠폰액·쿠폰 사용 건수 추가. 모르는 값이므로 모두 빈 값(null)으로 채운다.
    // 대상 배달앱이 비어 있으면 이전처럼 배달 전체로 집계한다.
    const okNum = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    d = {
      ...d,
      schemaVersion: 8,
      solutions: Array.isArray(d.solutions)
        ? d.solutions.map((s) => {
            if (!isObj(s) || !isObj(s.coupon)) return s;
            const c = s.coupon;
            return { ...s, coupon: { ...c, routeId: isStr(c.routeId) ? c.routeId : null, previousAmount: okNum(c.previousAmount), usedCount: okNum(c.usedCount) } };
          })
        : d.solutions,
    };
    v = 8;
  }
  if (v < 9) {
    // v8 → v9: 배달앱 정산서 기간 합계(경로 지정 기간 비용)에 저장 방식(settlementBasis)을 붙인다.
    // 이전 버전은 '일별 실제액은 그대로 두고 나머지(잔여액)만' 저장할 수 있었고, 현재는 총액을 저장한다.
    // - 메모에 정산서 총액이 적힌 이전 형식 → 총액으로 바꾼다 (일별 실제액은 그 안의 내역)
    // - 현재 형식 메모 → 그대로 총액
    // - 그 밖: 그 기간에 일별 실제 수수료가 없으면 두 해석이 같으므로 총액, 있으면 원본을 보존하고 확인 필요(unverified)
    const sales = Array.isArray(d.sales) ? (d.sales as Record<string, unknown>[]) : [];
    const dailyActual = (pc: Record<string, unknown>) =>
      sales
        .filter((e) => isObj(e) && e.routeId === pc.routeId && e.channel === pc.attribution && isStr(e.date) && (e.date as string) >= (pc.start as string) && (e.date as string) <= (pc.end as string))
        .reduce((t, e) => {
          const costs = isObj(e.costs) ? e.costs : {};
          const v = (c: string) => (isObj(costs[c]) && typeof (costs[c] as Record<string, unknown>).actual === 'number' ? ((costs[c] as Record<string, unknown>).actual as number) : 0);
          return t + v('brokerage') + (e.bundledFee ? 0 : v('payment'));
        }, 0);
    d = {
      ...d,
      schemaVersion: 9,
      periodCosts: Array.isArray(d.periodCosts)
        ? d.periodCosts.map((pc) => {
            if (!isObj(pc) || !isStr(pc.routeId) || pc.settlementBasis) return pc;
            const memo = isStr(pc.memo) ? pc.memo : '';
            const legacy = /^배달앱 정산서 기간 합계 ([\d,]+)원 \(중개·결제 수수료\)/.exec(memo);
            if (legacy) return { ...pc, amount: Number(legacy[1].replace(/,/g, '')), settlementBasis: 'total' };
            if (memo === '배달앱 정산서 기간 합계 (중개·결제 수수료)' || dailyActual(pc) === 0) return { ...pc, settlementBasis: 'total' };
            return { ...pc, settlementBasis: 'unverified' };
          })
        : d.periodCosts,
    };
    v = 9;
  }
  return d;
}

export function validateData(d: unknown): string | null {
  if (!isObj(d)) return '데이터 본문이 없습니다.';
  if (d.schemaVersion !== SCHEMA_VERSION) return '데이터의 스키마 버전이 맞지 않습니다.';
  if (d.mode !== 'sample' && d.mode !== 'user') return 'mode 값이 올바르지 않습니다.';
  for (const c of COLLECTIONS) if (!Array.isArray(d[c])) return `${c} 목록이 없습니다.`;
  if (d.store !== null) {
    const s = d.store;
    if (!isObj(s) || !isStr(s.name) || !Array.isArray(s.channels) || !Array.isArray(s.regularOpenDays))
      return '가게 설정 형식이 올바르지 않습니다.';
    if (!(s.channels as unknown[]).every((c) => CHANNELS.includes(c as never))) return '가게 판매 방식 값이 올바르지 않습니다.';
    if (!Array.isArray(s.commonCostChecklist)) return '공통비 체크리스트 형식이 올바르지 않습니다.';
    // v9 안에서 더한 선택 항목: 없으면 이전 데이터 그대로
    if (s.weekdayHours !== undefined && !(Array.isArray(s.weekdayHours) && s.weekdayHours.every((h) => isObj(h) && isWeekday(h.day) && isStr(h.openTime) && isStr(h.closeTime))))
      return '요일별 영업시간 형식이 올바르지 않습니다.';
  }
  const sales = d.sales as unknown[];
  for (let i = 0; i < sales.length; i++) {
    const e = sales[i];
    if (!isObj(e)) return `매출 ${i + 1}번째 항목 형식 오류`;
    if (!isValidDate(e.date)) return `매출 ${i + 1}번째 항목의 날짜 오류`;
    if (!CHANNELS.includes(e.channel as never)) return `매출 ${i + 1}번째 항목의 판매 방식 오류`;
    if (!isNumOrNull(e.orders) || !isNumOrNull(e.gross) || !isNumOrNull(e.storeDiscount) || !isNumOrNull(e.refund) || !isNumOrNull(e.visitors) || !isNumOrNull(e.netInput) || !isNumOrNull(e.cardSales) || (e.meals !== undefined && !isNumOrNull(e.meals)))
      return `매출 ${i + 1}번째 항목의 숫자 값 오류`;
    if (e.amountMode !== 'gross' && e.amountMode !== 'net') return `매출 ${i + 1}번째 항목의 금액 기준 오류`;
    if (!isObj(e.costs)) return `매출 ${i + 1}번째 항목의 비용 형식 오류`;
    for (const cv of Object.values(e.costs)) {
      if (!isObj(cv) || !isNumOrNull(cv.actual) || !isNumOrNull(cv.estimated)) return `매출 ${i + 1}번째 항목의 비용 값 오류`;
      if (cv.calc !== undefined && (!isObj(cv.calc) || !isStr(cv.calc.method))) return `매출 ${i + 1}번째 항목의 비용 계산 내용 오류`;
    }
  }
  const pcs = d.periodCosts as unknown[];
  for (let i = 0; i < pcs.length; i++) {
    const p = pcs[i];
    if (!isObj(p) || !isValidDate(p.start) || !isValidDate(p.end) || typeof p.amount !== 'number' || !isStr(p.category) || !isStr(p.attribution))
      return `기간별 비용 ${i + 1}번째 항목 형식 오류`;
  }
  for (const m of d.menus as unknown[]) {
    if (!isObj(m) || !isStr(m.name) || !Array.isArray(m.versions)) return '메뉴 형식 오류';
    for (const v of m.versions as unknown[]) if (!isObj(v) || !isValidDate(v.effectiveFrom) || !isObj(v.prices)) return `메뉴 "${m.name}" 버전 형식 오류`;
  }
  for (const f of d.feeRules as unknown[]) {
    if (!isObj(f) || !isStr(f.routeId) || !isValidDate(f.effectiveFrom)) return '수수료 규칙 형식 오류';
  }
  for (const p of d.problems as unknown[]) {
    if (!isObj(p) || !isStr(p.name) || !isObj(p.analysis) || !isObj(p.compare) || !isObj(p.target)) return '문제 항목 형식 오류';
    if (!weekdaysOk(p.weekdays)) return `문제 "${p.name}"의 적용 요일 형식 오류`;
  }
  for (const s of d.solutions as unknown[]) {
    if (!isObj(s) || !isStr(s.name) || !isObj(s.review) || !isObj(s.kpi)) return '실행 계획 항목 형식 오류';
    if (!['total', 'increase', 'growthRate', 'perBusinessDay'].includes(s.kpiTargetMode as string)) return `실행 계획 "${s.name}"의 목표 기준 값 오류`;
    if (!Array.isArray(s.extraKpis) || !s.extraKpis.every((k) => isObj(k) && isStr(k.key) && isStr(k.channel))) return `실행 계획 "${s.name}"의 함께 볼 지표 형식 오류`;
    if (!isObj(s.coupon) || !isNumOrNull(s.coupon.amount) || !isNumOrNull(s.coupon.minOrder) || !isNumOrNull(s.coupon.previousAmount) || !isNumOrNull(s.coupon.usedCount) || !(s.coupon.routeId === null || isStr(s.coupon.routeId)))
      return `실행 계획 "${s.name}"의 쿠폰 조건 형식 오류`;
    if (!isNumOrNull((s.review as Record<string, unknown>).nextCouponAmount)) return `실행 계획 "${s.name}"의 다음 쿠폰 금액 형식 오류`;
    const dec = (s.review as Record<string, unknown>).decision;
    if (!(dec === null || dec === undefined || ['keep', 'revise', 'stop', 'hold'].includes(dec as string))) return `실행 계획 "${s.name}"의 판단 값 오류`;
    if (!weekdaysOk(s.weekdays)) return `실행 계획 "${s.name}"의 적용 요일 형식 오류`;
  }
  if (!Array.isArray(d.perOrderCosts)) return '주문 1건당 기본 비용 형식 오류';
  for (const c of d.perOrderCosts as unknown[]) {
    if (!isObj(c) || !CHANNELS.includes(c.channel as never) || typeof c.amount !== 'number' || !Number.isFinite(c.amount) || !isValidDate(c.effectiveFrom) || !isStr(c.category))
      return '주문 1건당 기본 비용 형식 오류';
  }
  if (!Array.isArray(d.foodCostRates)) return '식재료비 원가율 설정 형식 오류';
  for (const r of d.foodCostRates as unknown[]) {
    if (!isObj(r) || !(r.channel === null || CHANNELS.includes(r.channel as never)) || typeof r.rate !== 'number' || !Number.isFinite(r.rate) || !isValidDate(r.effectiveFrom))
      return '식재료비 원가율 설정 형식 오류';
  }
  if (!Array.isArray(d.salesChecks)) return '매출 확인 기록 형식 오류';
  for (const c of d.salesChecks as unknown[]) {
    if (!isObj(c) || !isValidDate(c.date) || !isStr(c.routeId) || !CHANNELS.includes(c.channel as never)) return '매출 확인 기록 형식 오류';
  }
  if (!isObj(d.prefs) || !['unasked', 'available', 'unavailable'].includes(d.prefs.customerData as string)) return '사용자 설정 형식 오류';
  return null;
}
