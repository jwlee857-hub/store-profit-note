import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Comparison } from '../domain/calc';
import { ESTIMATED_HINT, basisMix, type BasisAmounts } from '../domain/costBasis';
import { fmt, fmtCalc, fmtPp, fmtSigned, type Unit } from '../domain/format';
import type { Calc } from '../domain/types';

// ───────── 레이아웃 ─────────

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '' }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = 'info', children, className = '' }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode; className?: string }) {
  const cls = {
    info: 'bg-sky-50 text-sky-900 ring-sky-200',
    warn: 'bg-amber-50 text-amber-900 ring-amber-200',
    error: 'bg-red-50 text-red-800 ring-red-200',
    success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  }[tone];
  const icon = { info: 'ℹ', warn: '⚠', error: '⛔', success: '✓' }[tone];
  return (
    <div className={`flex gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${cls} ${className}`}>
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-10 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="tabular w-full min-w-max border-collapse text-sm">{children}</table>
    </div>
  );
}

export const th = 'border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-600 whitespace-nowrap';
export const thR = th + ' text-right';
export const td = 'border-b border-slate-100 px-3 py-2 align-top whitespace-nowrap';
export const tdR = td + ' text-right';

// ───────── 버튼·배지 ─────────

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ variant = 'secondary', size = 'md', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const v = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400',
    secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    danger: 'bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50',
    ghost: 'text-slate-700 hover:bg-slate-100',
  }[variant];
  const s = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm';
  return <button type="button" className={`inline-flex items-center justify-center gap-1 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${v} ${s} ${className}`} {...rest} />;
}

export type BadgeTone = 'gray' | 'blue' | 'amber' | 'red' | 'green' | 'violet';
export function Badge({ tone = 'gray', children, title }: { tone?: BadgeTone; children: ReactNode; title?: string }) {
  const cls = {
    gray: 'bg-slate-100 text-slate-700',
    blue: 'bg-sky-100 text-sky-800',
    amber: 'bg-amber-100 text-amber-900',
    red: 'bg-red-100 text-red-800',
    green: 'bg-emerald-100 text-emerald-800',
    violet: 'bg-violet-100 text-violet-800',
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function SourceBadge({ status }: { status: 'actual' | 'estimated' | 'missing' | 'period' | 'na' }) {
  if (status === 'actual') return <Badge tone="green">실제</Badge>;
  if (status === 'estimated') return <Badge tone="amber">추정</Badge>;
  if (status === 'period') return <Badge tone="blue">기간별 비용</Badge>;
  if (status === 'na') return <Badge>해당 없음</Badge>;
  return <Badge tone="red">미입력</Badge>;
}

// ───────── 값 표시 ─────────

/** 이 금액 이상이면 "365만 원"처럼 만 원 단위로 줄여 보여준다 (누르면 원 단위) */
export const MAN_THRESHOLD = 100_000;

/** "365만 원" / "+89만 원" (만 원 단위 반올림). 작은 금액은 원 단위 그대로 */
export function manText(value: number, signed = false): string {
  const sign = value < 0 ? '−' : signed && value > 0 ? '+' : '';
  const a = Math.abs(value);
  if (a < MAN_THRESHOLD) return signed ? fmtSigned(value, 'won') : fmt(value, 'won');
  return `${sign}${Math.round(a / 10000).toLocaleString('ko-KR')}만 원`;
}

/**
 * 큰 금액을 만 원 단위로 보여주고, 누르면 정확한 원 단위로 바꾼다.
 * 작은 금액(10만 원 미만)은 처음부터 원 단위로 보여준다.
 */
export function BigWon({ value, signed = false, className = '' }: { value: number; signed?: boolean; className?: string }) {
  const [exact, setExact] = useState(false);
  const full = signed ? fmtSigned(value, 'won') : fmt(value, 'won');
  if (Math.abs(value) < MAN_THRESHOLD) return <span className={`tabular ${className}`}>{full}</span>;
  return (
    <button
      type="button"
      className={`tabular underline decoration-slate-300 decoration-dotted underline-offset-4 ${className}`}
      title={`정확한 금액: ${full}`}
      aria-label={exact ? `${full} (눌러서 만 원 단위로 보기)` : `${manText(value, signed)}, 정확히 ${full} (눌러서 원 단위로 보기)`}
      onClick={() => setExact((v) => !v)}
    >
      {exact ? full : manText(value, signed)}
    </button>
  );
}

/**
 * 계산 결과 표시: 확정값, 추정 포함, 미확정(비용 일부 미입력 — 입력된 값만 반영한 숫자를 크게, '미확정'은 작게), 계산 불가.
 * man: 원 단위 큰 금액을 "365만 원"으로 줄여 보여줌 (홈·성과 카드)
 */
export function CalcValue({
  calc,
  unit,
  size = 'md',
  man = false,
}: {
  calc: Calc;
  unit: Unit;
  size?: 'md' | 'lg';
  /** @deprecated 미확정 숫자는 항상 보여준다. 기존 호출 호환용 */
  showProvisional?: boolean;
  man?: boolean;
}) {
  const big = size === 'lg' ? 'text-2xl font-bold' : 'font-medium';
  const num = (v: number) => (man && unit === 'won' ? <BigWon value={v} className={`${big} text-slate-900`} /> : <span className={`${big} tabular text-slate-900`}>{fmt(v, unit)}</span>);
  if (calc.value === null) {
    // 비용이 덜 채워졌어도 입력된 값만 반영한 숫자가 있으면 크게 보여주고 '미확정'을 작게 붙인다
    if (calc.reason === 'incomplete' && calc.provisional !== null && calc.provisional !== undefined)
      return (
        <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {num(calc.provisional)}
          <span className="text-xs font-medium text-slate-500" title="비용 일부가 아직 입력되지 않아 입력된 값만 반영한 숫자입니다">
            미확정
          </span>
        </span>
      );
    return <span className={`${size === 'lg' ? 'text-xl font-semibold' : 'font-medium'} text-slate-400`}>{fmtCalc(calc, unit)}</span>;
  }
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {num(calc.value)}
      <BasisBadge calc={calc} />
      {calc.basis && calc.basis.used < calc.basis.total && (
        <span className="text-xs font-medium text-slate-500" title="값이 입력된 날만으로 계산했습니다">
          {calc.basis.total}
          {calc.basis.unit} 중 {calc.basis.used}
          {calc.basis.unit} 기준
        </span>
      )}
    </span>
  );
}

/**
 * 합계에 가정한 값(추정)이 들어 있으면 '추정 포함'. 실제 금액이나 설정값대로 계산한 금액만 있으면 정상이므로 표시하지 않는다.
 */
export function BasisBadge({ calc }: { calc: Pick<Calc, 'estimated'> }) {
  if (!calc.estimated) return null;
  return (
    <Badge tone="amber" title={ESTIMATED_HINT}>
      추정 포함
    </Badge>
  );
}

/** 비용 합계에 추정이 있을 때만 '추정' / '추정 포함' */
export function MixBadge({ amounts }: { amounts: BasisAmounts }) {
  const m = basisMix(amounts);
  if (!m) return null;
  return (
    <Badge tone={m.tone} title={ESTIMATED_HINT}>
      {m.text}
    </Badge>
  );
}

export function DeltaText({ cmp, unit, ratio = false, higherIsBetter = true }: { cmp: Comparison; unit: Unit; ratio?: boolean; higherIsBetter?: boolean }) {
  if (cmp.abs === null) return <span className="text-xs text-slate-400">{cmp.note ?? '비교 불가'}</span>;
  const r = Math.round(cmp.abs * (unit === 'pct' ? 10 : 1));
  const good = r === 0 ? null : (r > 0) === higherIsBetter;
  const color = good === null ? 'text-slate-500' : good ? 'text-emerald-700' : 'text-red-700';
  const arrow = r === 0 ? '' : r > 0 ? '▲ ' : '▼ ';
  return (
    <span className={`text-sm ${color}`}>
      {arrow}
      {ratio ? fmtPp(cmp.abs) : fmtSigned(cmp.abs, unit)}
      {cmp.pct !== null && ` (${cmp.pct > 0 ? '+' : ''}${cmp.pct.toFixed(1)}%)`}
      {cmp.note && <span className="ml-1 font-medium">· {cmp.note}</span>}
    </span>
  );
}

// ───────── 입력 ─────────

export function Field({
  label,
  error,
  warning,
  hint,
  children,
  className = '',
  required,
}: {
  label: ReactNode;
  error?: string;
  warning?: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children(id)}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          ⛔ {error}
        </p>
      )}
      {!error && warning && <p className="text-sm text-amber-800">⚠ {warning}</p>}
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

// 모바일 Safari가 16px 미만 입력칸에서 화면을 확대하지 않도록 기본 16px(text-base), 넓은 화면은 14px
export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100';

/** 숫자 입력: 빈칸 = null(미입력), 0 = 0. 포커스가 없을 때 천 단위 구분 표시 */
export function NumberInput({
  id,
  value,
  onChange,
  placeholder = '미입력',
  suffix,
  allowNegative = false,
  allowDecimal = false,
  disabled,
  invalid,
  autoFocusMark,
  ariaLabel,
}: {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  suffix?: string;
  allowNegative?: boolean;
  allowDecimal?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** 모달이 열릴 때 이 칸에 포커스 */
  autoFocusMark?: boolean;
  ariaLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    if (!focused) {
      setText(value === null ? '' : String(value));
      return;
    }
    // 입력 중이라도 바깥에서 값이 바뀌면(예: 계산 도우미 적용·'없음' 버튼) 새 값을 보여준다.
    // 직접 입력해 생긴 변화는 입력 글자와 값이 같으므로 건드리지 않아 커서가 튀지 않는다.
    const t = text.replace(/\.$/, '');
    const parsed = t === '' || t === '-' ? null : Number(t);
    if (parsed !== value) setText(value === null ? '' : String(value));
  }, [value, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  const display = focused ? text : value === null ? '' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value);
  return (
    <div className="relative">
      <input
        id={id}
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        autoComplete="off"
        data-autofocus={autoFocusMark ? '' : undefined}
        aria-label={ariaLabel}
        className={`${inputCls} tabular text-right ${suffix ? 'pr-12' : ''} ${invalid ? 'border-red-400' : ''}`}
        value={display}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid}
        onFocus={() => {
          setFocused(true);
          setText(value === null ? '' : String(value));
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          let raw = e.target.value.replace(/,/g, '').replace(/\s/g, '');
          const re = allowDecimal ? (allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/) : allowNegative ? /^-?\d*$/ : /^\d*$/;
          if (!re.test(raw)) return;
          // 포커스 이벤트를 놓친 경우에도 입력 중에는 쉼표 없이 원값을 보여 커서가 튀지 않게 한다
          if (!focused) setFocused(true);
          setText(raw);
          if (raw === '' || raw === '-' || raw === '.' || raw === '-.') onChange(null);
          else {
            if (raw.endsWith('.')) raw = raw.slice(0, -1);
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(n);
          }
        }}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-500">{suffix}</span>}
    </div>
  );
}

export function TextInput({ id, value, onChange, placeholder, invalid, type = 'text' }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean; type?: string }) {
  return (
    <input
      id={id}
      type={type}
      className={`${inputCls} ${invalid ? 'border-red-400' : ''}`}
      value={value}
      placeholder={placeholder}
      aria-invalid={invalid}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextArea({ id, value, onChange, placeholder, rows = 2 }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea id={id} rows={rows} className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function DateInput({ id, value, onChange, invalid }: { id?: string; value: string | null; onChange: (v: string) => void; invalid?: boolean }) {
  return <input id={id} type="date" className={`${inputCls} ${invalid ? 'border-red-400' : ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

export function Select<T extends string>({
  id,
  value,
  onChange,
  options,
  invalid,
}: {
  id?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; group?: string }[];
  invalid?: boolean;
}) {
  const groups = Array.from(new Set(options.map((o) => o.group ?? '')));
  return (
    <select id={id} className={`${inputCls} ${invalid ? 'border-red-400' : ''}`} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {groups.map((g) =>
        g ? (
          <optgroup key={g} label={g}>
            {options
              .filter((o) => o.group === g)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ) : (
          options
            .filter((o) => !o.group)
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
        ),
      )}
    </select>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-800">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-slate-900" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function ToggleGroup<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * 모달. 휴대폰에서는 화면 전체를 쓰는 시트, 넓은 화면에서는 가운데 창.
 * - 본문만 스크롤(중첩 스크롤 없음), 아래 버튼 영역은 항상 보임
 * - 열려 있는 동안 배경 페이지 스크롤 잠금
 * - 처음 입력칸에 포커스, Tab 순환, Esc로 닫기, 닫으면 원래 버튼으로 포커스 복귀
 */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(`.modal-body ${FOCUSABLE}`);
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        ref={panelRef}
        className={`flex h-[100dvh] w-full flex-col bg-white shadow-xl sm:h-auto sm:max-h-[92vh] sm:rounded-xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-xl'}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button className="rounded p-2 text-slate-600 hover:bg-slate-100" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="modal-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-4 sm:px-5">{children}</div>
        {footer && (
          <div className="modal-footer flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** 접었다 펼치는 보조 정보. 중요한 조건은 여기 숨기지 말고 본문에 둔다 */
export function More({ summary, children, defaultOpen = false, className = '' }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  return (
    <details className={`group ${className}`} open={defaultOpen}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function Stat({ label, children, sub }: { label: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1">{children}</div>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  );
}

export function ChannelDot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />;
}
