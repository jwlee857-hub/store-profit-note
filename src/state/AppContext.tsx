import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppData } from '../domain/types';
import { clearStorage, loadFromStorage, saveToStorage } from '../storage/storage';

export type PageKey = 'dashboard' | 'store' | 'menus' | 'sales' | 'diagnosis' | 'solutions' | 'performance';

export interface Route {
  page: PageKey;
  params: Record<string, string>;
}

export interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
  /** 둘째 줄에 작게 보여줄 보조 설명 (예: 비용 상태·추정 내용) */
  detail?: string;
  /** 알림 안의 이동 버튼 (예: 비용 확인) */
  action?: { label: string; run: () => void };
}

/** 결과 안내 문구. 문자열이면 한 줄, detail이 있으면 둘째 줄에 작게 */
export type ToastMessage = string | { text: string; detail?: string; action?: { label: string; run: () => void } };

interface ConfirmRequest {
  title: string;
  message: string;
  confirmText: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

interface Ctx {
  data: AppData | null;
  loadError: string | null;
  /** 데이터를 변경하고 저장한다. message가 있으면 결과 안내를 띄운다. 저장에 실패하면 화면 데이터도 바꾸지 않고 false */
  update: (fn: (d: AppData) => AppData, message?: ToastMessage) => boolean;
  replaceAll: (d: AppData | null, message?: ToastMessage) => void;
  route: Route;
  navigate: (page: PageKey, params?: Record<string, string>) => void;
  toast: (message: ToastMessage, tone?: Toast['tone']) => void;
  confirm: (opts: { title: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
}

const AppCtx = createContext<Ctx | null>(null);

const PAGES: PageKey[] = ['dashboard', 'store', 'menus', 'sales', 'diagnosis', 'solutions', 'performance'];

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const page = (PAGES as string[]).includes(path) ? (path as PageKey) : 'dashboard';
  const params: Record<string, string> = {};
  new URLSearchParams(qs ?? '').forEach((v, k) => (params[k] = v));
  return { page, params };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadFromStorage(), []);
  const [data, setData] = useState<AppData | null>(initial.ok ? initial.data : null);
  const [loadError, setLoadError] = useState<string | null>(initial.ok ? null : initial.error);
  const [route, setRoute] = useState<Route>(parseHash);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const toastId = useRef(0);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const [toastBottom, setToastBottom] = useState(16);
  const toast = useCallback((message: ToastMessage, tone: Toast['tone'] = 'success') => {
    const id = ++toastId.current;
    const m = typeof message === 'string' ? { text: message } : message;
    // 연속 저장 때 알림이 쌓여 입력 칸을 가리지 않도록, 오류가 아닌 알림은 가장 최근 것 하나만 남긴다
    setToasts((t) => [...t.filter((x) => x.tone === 'error'), { id, tone, text: m.text, detail: m.detail || undefined, action: m.action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : m.action ? 6000 : 3500);
  }, []);

  // 알림은 화면 아래에 띄워 위쪽 가게 이름·메뉴 버튼을 가리지 않는다.
  // 입력 창이 열려 있으면 창의 버튼 줄 바로 위에 띄워 저장 버튼도 가리지 않는다.
  useEffect(() => {
    if (!toasts.length) return;
    const place = () => {
      const footer = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] .modal-footer')).pop();
      const top = footer?.getBoundingClientRect().top;
      setToastBottom(top !== undefined && top > 0 ? Math.max(16, Math.round(window.innerHeight - top + 8)) : 16);
    };
    place();
    // 알림이 떠 있는 동안 입력 창이 열리거나 닫힐 수 있으므로 위치를 계속 맞춘다 (버튼 줄을 가리지 않게)
    const t = setInterval(place, 200);
    return () => clearInterval(t);
  }, [toasts]);

  const dataRef = useRef<AppData | null>(data);

  const persist = useCallback(
    (next: AppData | null, message?: ToastMessage): boolean => {
      if (next === null) {
        dataRef.current = null;
        clearStorage();
        setData(null);
        if (message) toast(message, 'info');
        return true;
      }
      const res = saveToStorage(next);
      if (!res.ok) {
        // 저장되지 않은 내용을 저장된 것처럼 보여주지 않는다. 입력 화면은 내용을 그대로 유지한다
        toast({ text: '저장하지 못했습니다', detail: `${res.error ?? '브라우저 저장소에 쓰지 못했습니다.'} 입력한 내용은 그대로 남아 있어요.` }, 'error');
        return false;
      }
      dataRef.current = next;
      setData(next);
      if (message) toast(message);
      return true;
    },
    [toast],
  );

  const update = useCallback(
    (fn: (d: AppData) => AppData, message?: ToastMessage) => {
      const cur = dataRef.current;
      if (!cur) return false;
      return persist({ ...fn(cur), updatedAt: new Date().toISOString() }, message);
    },
    [persist],
  );

  const replaceAll = useCallback(
    (d: AppData | null, message?: ToastMessage) => {
      setLoadError(null);
      persist(d, message);
    },
    [persist],
  );

  const navigate = useCallback((page: PageKey, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    setRoute({ page, params });
    window.location.hash = `/${page}${qs ? `?${qs}` : ''}`;
    window.scrollTo({ top: 0 });
  }, []);

  const confirm = useCallback(
    (opts: { title: string; message: string; confirmText?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) =>
        setConfirmReq({ title: opts.title, message: opts.message, confirmText: opts.confirmText ?? '확인', danger: opts.danger ?? true, resolve }),
      ),
    [],
  );

  const value: Ctx = { data, loadError, update, replaceAll, route, navigate, toast, confirm };

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed left-4 right-4 z-50 flex flex-col gap-2 sm:left-auto sm:max-w-md"
        style={{ bottom: `calc(${toastBottom}px + env(safe-area-inset-bottom, 0px))` }}
        aria-live="polite"
        data-toast-area
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-2.5 text-sm shadow-lg ring-1 ${
              t.tone === 'error'
                ? 'bg-red-50 text-red-800 ring-red-200'
                : t.tone === 'info'
                  ? 'bg-slate-800 text-white ring-slate-700'
                  : 'bg-emerald-50 text-emerald-900 ring-emerald-200'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{t.text}</div>
                {t.detail && <div className={`mt-0.5 text-xs ${t.tone === 'info' ? 'text-slate-300' : 'text-slate-600'}`}>{t.detail}</div>}
              </div>
              {t.action && (
                <button
                  type="button"
                  className="pointer-events-auto shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50"
                  onClick={() => {
                    setToasts((x) => x.filter((y) => y.id !== t.id));
                    t.action!.run();
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {confirmReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{confirmReq.title}</h2>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{confirmReq.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                onClick={() => {
                  confirmReq.resolve(false);
                  setConfirmReq(null);
                }}
              >
                취소
              </button>
              <button
                autoFocus
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${confirmReq.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-800'}`}
                onClick={() => {
                  confirmReq.resolve(true);
                  setConfirmReq(null);
                }}
              >
                {confirmReq.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider가 필요합니다.');
  return c;
}

/** data가 존재하는 화면에서만 사용 */
export function useData(): AppData {
  const { data } = useApp();
  if (!data) throw new Error('데이터가 없습니다.');
  return data;
}
