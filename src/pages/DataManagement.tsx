import { useRef } from 'react';
import { Button, Card, More, Notice } from '../components/ui';
import { todayStr } from '../domain/dates';
import type { AppData } from '../domain/types';
import { parseBackup, serialize } from '../storage/storage';
import { useApp } from '../state/AppContext';

export function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJson(data: AppData) {
  downloadText(serialize(data), `가게이익노트-백업-${todayStr()}.json`);
}

function counts(d: AppData) {
  return [
    ['매출 기록', d.sales.length, '건'],
    ['기간별 비용', d.periodCosts.length, '건'],
    ['메뉴', d.menus.length, '개'],
    ['문제', d.problems.length, '건'],
    ['실행 계획', d.solutions.length, '건'],
    ['고객 지표', d.customerMetrics.length, '건'],
  ] as const;
}

/** 불러오기 확인 문구: 지금 데이터와 파일 데이터를 나란히 보여 주고 무엇이 바뀌는지 알려준다 */
export function importSummary(current: AppData | null, incoming: AppData): string {
  const inc = counts(incoming);
  const cur = current ? counts(current) : null;
  const lines = inc.map(([label, n, unit], i) => `· ${label}: ${cur ? `지금 ${cur[i][1]}${unit} → ` : ''}파일 ${n}${unit}`);
  const head = `파일: ${incoming.store?.name ?? '가게 미등록'} (${incoming.mode === 'sample' ? '샘플 데이터' : '내 가게 데이터'})`;
  const scope = current
    ? `\n\n지금 이 브라우저의 데이터(${current.store?.name ?? '가게 미등록'}${current.mode === 'sample' ? ', 샘플' : ''})는 모두 파일 내용으로 바뀝니다. 두 데이터를 합치지 않습니다. 필요하면 먼저 '백업 파일 저장'을 하세요.`
    : '';
  return `${head}\n${lines.join('\n')}${scope}`;
}

export function ImportButton({ label = '백업 파일 불러오기' }: { label?: string }) {
  const { data, replaceAll, toast, confirm, navigate } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  const onFile = async (file: File) => {
    const text = await file.text();
    const res = parseBackup(text);
    if (!res.ok) {
      toast(`불러오기 실패: ${res.error} 지금 데이터는 바뀌지 않았습니다.`, 'error');
      return;
    }
    const ok = await confirm({
      title: data ? '백업 파일로 바꿀까요?' : '백업 파일을 불러올까요?',
      message: importSummary(data, res.data),
      confirmText: data ? '지금 데이터를 바꾸고 불러오기' : '불러오기',
    });
    if (!ok) return;
    replaceAll(res.data, '백업 파일을 불러왔습니다.');
    navigate('dashboard');
  };
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = '';
        }}
      />
      <Button onClick={() => ref.current?.click()}>{label}</Button>
    </>
  );
}

export function StorageGuide() {
  return (
    <div className="space-y-1 text-sm text-slate-800">
      <p>
        <b>데이터는 이 기기의 이 브라우저에만 저장됩니다.</b> 스마트폰과 노트북 사이에 자동으로 공유되지 않아요.
      </p>
      <p>베타에서는 주로 쓸 기기 한 대를 정해 두는 것을 권해요.</p>
      <More summary="다른 기기로 옮기려면">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>지금 기기에서 ‘백업 파일 저장’을 누릅니다.</li>
          <li>저장된 파일을 다른 기기로 옮깁니다 (메일, 메신저 나에게 보내기 등).</li>
          <li>다른 기기에서 ‘백업 파일 불러오기’를 누릅니다.</li>
        </ol>
        <p className="mt-1 text-sm text-slate-700">자동 동기화나 합치기가 아닙니다. 불러오면 그 기기의 데이터가 파일 내용으로 통째로 바뀝니다. 브라우저 기록을 지우거나 시크릿 창을 닫으면 데이터가 사라질 수 있으니 주기적으로 백업하세요.</p>
      </More>
    </div>
  );
}

const BACKUP_GUIDED_KEY = 'restaurant-profit-beta:backup-guided';

export function DataManagement() {
  const { data, replaceAll, confirm, navigate, toast } = useApp();
  if (!data) return null;
  return (
    <Card title="저장과 백업" subtitle={`저장 형식 v${data.schemaVersion} · 마지막 저장 ${new Date(data.updatedAt).toLocaleString('ko-KR')}`}>
      <Notice className="mb-3">
        <StorageGuide />
      </Notice>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => {
            exportJson(data);
            // 첫 백업이면 다른 기기로 옮기는 방법을 함께 알려준다 (이 기기에서 한 번만)
            let first = false;
            try {
              first = !localStorage.getItem(BACKUP_GUIDED_KEY);
              localStorage.setItem(BACKUP_GUIDED_KEY, '1');
            } catch {
              first = false;
            }
            if (first)
              toast({ text: '백업 파일을 저장했어요', detail: '다른 기기로 옮기려면: 파일을 메일·메신저 ‘나에게 보내기’로 보낸 뒤, 그 기기에서 ‘백업 파일 불러오기’를 누르세요. 그 기기의 데이터는 파일 내용으로 바뀌어요.' }, 'info');
          }}
        >
          백업 파일 저장
        </Button>
        <ImportButton />
        <Button
          variant="danger"
          onClick={async () => {
            const ok = await confirm({
              title: '모든 데이터를 삭제할까요?',
              message: '이 브라우저에 저장된 가게 설정, 매출, 비용, 문제, 실행 계획이 모두 삭제되며 되돌릴 수 없습니다. 필요하면 먼저 백업 파일을 저장하세요.',
              confirmText: '모두 삭제',
            });
            if (!ok) return;
            replaceAll(null, '모든 데이터를 삭제했습니다.');
            navigate('dashboard');
          }}
        >
          전체 삭제하고 처음으로
        </Button>
      </div>
    </Card>
  );
}
