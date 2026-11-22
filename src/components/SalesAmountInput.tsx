// 매출 금액 입력 묶음: 매출 금액 하나 + "할인·환불 내역 추가"(접힘) 한 곳.
// - 할인액·환불액 입력칸은 한 세트뿐이다. 할인 전 판매액으로 계산할 때도 같은 칸을 쓴다.
// - 매출 금액의 의미는 항상 "가게 부담 할인·환불 반영 후, 수수료·배달비 차감 전 매출"이다.
// - 할인·환불은 이미 반영된 상세이며 매출에서 다시 빼지 않는다. 상세를 고쳐도 매출 금액은 자동으로 바뀌지 않는다.
// - 판매액은 저장하지 않는다(순매출 + 할인 + 환불로 복원). 그래서 상세를 고친 뒤 판매액과 맞지 않는 값이 '확정'처럼 남지 않는다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { computeHelper, restoredGross, type AmountForm } from '../domain/amountForm';
import { fmt } from '../domain/format';
import { Button, Field, NumberInput } from './ui';

export const AMOUNT_HINT = '가게 부담 할인·환불 반영 후, 수수료·배달비 차감 전 매출입니다.';

export type FocusField = 'discount' | 'refund' | 'gross' | 'card';

function ZeroButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50" onClick={onClick} aria-label={label}>
      없음(0원)
    </button>
  );
}

export function SalesAmountInput({
  form,
  onChange,
  label,
  error,
  warning,
  initial,
  autoFocus,
  onApplied,
  focusRequest,
  extra,
}: {
  form: AmountForm;
  onChange: (f: AmountForm) => void;
  label: string;
  error?: string;
  warning?: string;
  /** 기존 기록을 열었을 때의 값 (상세 수정으로 복원 판매액이 바뀌면 알려주기 위함) */
  initial?: AmountForm;
  autoFocus?: boolean;
  /** 계산 적용 결과 안내 */
  onApplied?: (message: string) => void;
  /** '필요한 내역 입력'에서 이 영역을 열고 해당 칸으로 이동 (n이 바뀔 때마다 실행) */
  focusRequest?: { field: FocusField; n: number } | null;
  /** 같은 영역 안에 붙일 추가 칸 (예: 결제 수수료 계산용 카드 결제액). data-field 속성으로 이동 대상 지정 */
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(form.discount !== null || form.refund !== null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [gross, setGross] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  /** 마지막으로 적용한 계산 (판매액과 그때 넣은 매출). 상세가 바뀌어 결과가 달라지면 다시 적용을 권한다 */
  const [appliedFrom, setAppliedFrom] = useState<{ gross: number; net: number } | null>(null);
  const [pendingFocus, setPendingFocus] = useState<FocusField | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const calcBtnRef = useRef<HTMLButtonElement>(null);
  const wasCalcOpen = useRef(false);

  const restored = restoredGross(form);
  const initialRestored = initial ? restoredGross(initial) : null;
  const result = computeHelper({ gross, discount: form.discount, refund: form.refund });
  const err = (k: 'gross' | 'discount' | 'refund') => (calcOpen && tried && !result.ok ? result.errors[k] : undefined);

  // 상세를 고쳐 계산 결과가 달라졌는가 (매출 금액은 그대로 두고 알리기만)
  const recomputed = appliedFrom && form.net === appliedFrom.net && form.discount !== null && form.refund !== null ? appliedFrom.gross - form.discount - form.refund : null;
  const changedAfterApply = appliedFrom !== null && form.net === appliedFrom.net && recomputed !== appliedFrom.net;

  useEffect(() => {
    if (focusRequest) {
      setOpen(true);
      if (focusRequest.field === 'gross') openCalc();
      setPendingFocus(focusRequest.field);
    }
  }, [focusRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pendingFocus) return;
    const el = areaRef.current?.querySelector<HTMLInputElement>(`[data-field="${pendingFocus}"] input`);
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: 'center' });
      setPendingFocus(null);
    }
  });
  // 계산을 열면 판매액 칸으로, 닫으면(적용·닫기·Esc) 여는 버튼으로 포커스를 돌려준다
  useEffect(() => {
    if (calcOpen) areaRef.current?.querySelector<HTMLInputElement>('[data-field="gross"] input')?.focus();
    else if (wasCalcOpen.current) calcBtnRef.current?.focus();
    wasCalcOpen.current = calcOpen;
  }, [calcOpen]);

  function openCalc() {
    setGross(restored ?? appliedFrom?.gross ?? gross);
    setTried(false);
    setCalcOpen(true);
  }
  const apply = () => {
    setTried(true);
    if (!result.ok) return;
    onChange({ net: result.net, discount: form.discount, refund: form.refund });
    setAppliedFrom({ gross: gross!, net: result.net });
    onApplied?.(`계산한 매출 ${fmt(result.net, 'won')}을 적용했어요`);
    setCalcOpen(false);
  };
  const reapply = () => {
    if (recomputed === null) return;
    onChange({ ...form, net: recomputed });
    setAppliedFrom({ gross: appliedFrom!.gross, net: recomputed });
    onApplied?.(`다시 계산한 매출 ${fmt(recomputed, 'won')}을 적용했어요`);
  };

  const detailSummary = [form.discount !== null ? `할인 ${fmt(form.discount, 'won')}` : null, form.refund !== null ? `환불 ${fmt(form.refund, 'won')}` : null].filter(Boolean).join(' · ');

  return (
    <div className="space-y-2" ref={areaRef}>
      <Field label={label} required error={error} warning={warning} hint={`${AMOUNT_HINT} 배달앱 정산 입금액과는 다를 수 있어요.`}>
        {(id) => (
          <NumberInput
            id={id}
            value={form.net}
            onChange={(v) => {
              onChange({ ...form, net: v });
              if (appliedFrom && v !== appliedFrom.net) setAppliedFrom(null); // 직접 고치면 이전 계산과의 연결을 끊는다
            }}
            suffix="원"
            invalid={!!error}
            autoFocusMark={autoFocus}
          />
        )}
      </Field>

      <details className="group" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ▸
          </span>
          할인·환불 내역 추가 — 선택
          {detailSummary && <span className="font-normal text-slate-600">({detailSummary})</span>}
        </summary>
        <div className="mt-2 space-y-3 rounded-lg p-3 ring-1 ring-slate-200">
          <p className="text-sm text-slate-700">위 매출에 이미 반영된 내역입니다. 다시 차감하지 않아요. 모르면 비워 두세요(0원과 달라요).</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="가게 부담 할인액" hint="플랫폼 부담 할인은 넣지 마세요" error={err('discount')}>
              {(id) => (
                <div className="flex items-center gap-1.5" data-field="discount">
                  <div className="min-w-0 flex-1">
                    <NumberInput id={id} value={form.discount} onChange={(v) => onChange({ ...form, discount: v })} suffix="원" invalid={!!err('discount')} />
                  </div>
                  <ZeroButton label="가게 부담 할인 없음" onClick={() => onChange({ ...form, discount: 0 })} />
                </div>
              )}
            </Field>
            <Field label="환불액" error={err('refund')}>
              {(id) => (
                <div className="flex items-center gap-1.5" data-field="refund">
                  <div className="min-w-0 flex-1">
                    <NumberInput id={id} value={form.refund} onChange={(v) => onChange({ ...form, refund: v })} suffix="원" invalid={!!err('refund')} />
                  </div>
                  <ZeroButton label="환불 없음" onClick={() => onChange({ ...form, refund: 0 })} />
                </div>
              )}
            </Field>
          </div>

          {!calcOpen ? (
            <button ref={calcBtnRef} type="button" className="text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900" onClick={openCalc}>
              할인 전 판매액으로 계산
            </button>
          ) : (
            <div
              role="group"
              aria-label="할인 전 판매액으로 계산"
              className="space-y-2 rounded-md bg-slate-50 p-3"
              onKeyDown={(e) => {
                // Esc는 계산만 닫는다 (입력 창 전체를 닫지 않음)
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setCalcOpen(false);
                }
              }}
            >
              <Field label="할인·환불 전 판매액" error={err('gross')} hint="위의 할인액·환불액을 그대로 사용해요">
                {(id) => (
                  <div data-field="gross" className="max-w-xs">
                    <NumberInput id={id} value={gross} onChange={setGross} suffix="원" invalid={!!err('gross')} />
                  </div>
                )}
              </Field>
              <p className="text-sm text-slate-800" aria-live="polite">
                {result.ok ? (
                  <>
                    기록할 매출 = {fmt(gross, 'won')} − {fmt(form.discount, 'won')} − {fmt(form.refund, 'won')} = <b className="tabular">{fmt(result.net, 'won')}</b>
                    {form.net !== null && form.net !== result.net && (
                      <span className="block text-amber-900">
                        현재 {fmt(form.net, 'won')} → 적용 후 {fmt(result.net, 'won')}
                      </span>
                    )}
                  </>
                ) : (
                  '판매액·할인액·환불액을 모두 넣으면 계산해요. 할인·환불이 없었다면 ‘없음’을 누르세요.'
                )}
              </p>
              {tried && !result.ok && (
                <p className="text-sm text-red-700" role="alert">
                  ⛔ 표시된 칸을 확인하세요. 모르는 금액을 0원으로 채우지 않아요.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" onClick={() => setCalcOpen(false)}>
                  계산 닫기
                </Button>
                <Button size="sm" variant="primary" onClick={apply}>
                  계산한 금액 적용
                </Button>
              </div>
            </div>
          )}

          {changedAfterApply && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
              <p className="font-medium">계산 결과가 변경됐어요</p>
              {recomputed !== null ? (
                <>
                  <p>
                    판매액 {fmt(appliedFrom!.gross, 'won')} − 할인 {fmt(form.discount, 'won')} − 환불 {fmt(form.refund, 'won')} = {fmt(recomputed, 'won')} (지금 매출 {fmt(form.net, 'won')}은 그대로예요)
                  </p>
                  <Button size="sm" className="mt-1" onClick={reapply}>
                    다시 적용
                  </Button>
                </>
              ) : (
                <p>할인·환불 중 비어 있는 칸이 있어 다시 계산할 수 없어요. 매출 금액은 그대로예요.</p>
              )}
            </div>
          )}

          {!calcOpen && (
            <p className="text-sm text-slate-700" aria-live="polite">
              {restored !== null ? (
                <>
                  할인·환불 전 판매액(복원): <b className="tabular">{fmt(restored, 'won')}</b>
                  {initial && initialRestored !== restored && <span className="text-amber-800"> · 이전 {initialRestored === null ? '복원 불가' : fmt(initialRestored, 'won')}에서 바뀜</span>}
                </>
              ) : (
                '할인·환불을 모두 알면 판매액을 복원해 할인 분석에 써요.'
              )}
            </p>
          )}
          {extra}
        </div>
      </details>
    </div>
  );
}
