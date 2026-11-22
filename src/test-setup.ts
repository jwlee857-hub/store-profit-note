// 테스트 실행 날짜에 따라 결과가 달라지지 않도록 '오늘'을 고정한다.
// 샘플 가게는 일요일 휴업이라, 실제 날짜로 돌리면 일요일(과 그다음 월요일)에 입력 현황 테스트가 깨진다.
// GitHub Actions(UTC)와 로컬(KST)에서 같은 결과가 나오도록 시간대는 vite.config.ts의 test.env.TZ로 맞춘다.
import { vi } from 'vitest';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-11-26T10:00:00+09:00')); // 목요일 오전
