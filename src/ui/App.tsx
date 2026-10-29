import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { DerivedProvider, useDerived } from '../state/derived';
import { useApp } from '../state/store';
import { exportImportFile, exportPendingReport } from './exportActions';
import { plural } from './format';
import { IconAlert, IconCheck, IconX } from './Icons';
import { InputView } from './InputView';
import { MovementsPanel } from './MovementsPanel';
import { SettingsDrawer } from './SettingsDrawer';
import { SourcePanel } from './SourcePanel';
import { SplitView } from './SplitView';
import { TopBar } from './TopBar';

export function App() {
  return (
    <DerivedProvider>
      <Shell />
    </DerivedProvider>
  );
}

function isTyping(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function Shell() {
  const phase = useApp((s) => s.phase);
  const d = useDerived();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const s = useApp.getState();
      if (e.key.toLowerCase() === 'z' && !e.shiftKey && !isTyping(e.target) && s.phase === 'review') {
        e.preventDefault();
        s.undo();
      }
      if (e.key.toLowerCase() === 'e' && s.phase === 'review' && d) {
        e.preventDefault();
        if (d.config.length === 0 && d.rows.some((r) => r.exportable)) {
          setError(null);
          exportImportFile(d).catch((err: Error) => setError(err.message));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d]);

  return (
    <div className="flex h-full min-w-[1100px] flex-col">
      <TopBar onError={setError} />
      {error && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-block/30 bg-block-bg px-3 text-[12px] text-block" role="alert">
          <IconAlert /> {error}
          <div className="flex-1" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setError(null)} aria-label="Fechar">
            <IconX />
          </button>
        </div>
      )}
      {phase === 'review' && d && <ExportStatus />}
      <main className="flex min-h-0 flex-1 flex-col">
        {phase === 'input' || !d ? <InputView /> : <SplitView left={<SourcePanel />} right={<MovementsPanel />} />}
      </main>
      <SettingsDrawer />
    </div>
  );
}

/** Resultado da última exportação: o que foi exportado, o que ficou pendente e se houve alterações depois. */
function ExportStatus() {
  const d = useDerived()!;
  const { exported, version } = useApp(useShallow((s) => ({ exported: s.exported, version: s.version })));
  const setExported = useApp.getState().setExported;
  if (!exported) return null;
  const notExported = d.rows.filter((r) => !exported.ids.has(r.m.id)).length;
  const stale = exported.version !== version;

  return (
    <div
      className={`flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[12px] ${stale ? 'border-warn/30 bg-warn-bg text-slate-700' : 'border-ok/30 bg-ok-bg text-slate-700'}`}
      role="status"
    >
      {stale ? <IconAlert className="text-warn" /> : <IconCheck className="text-ok" />}
      <span>
        <b>{exported.fileName}</b> gerado às {exported.at}: {plural(exported.rows, 'linha', 'linhas')}, estrutura verificada.{' '}
        {plural(notExported, 'lançamento não incluído', 'lançamentos não incluídos')}
        {d.unrecognized.length > 0 && ` · ${plural(d.unrecognized.length, 'linha não processada', 'linhas não processadas')}`}.
      </span>
      {stale && <span className="font-medium text-warn">Houve alterações depois da exportação — exporte novamente.</span>}
      <div className="flex-1" />
      <button type="button" className="btn btn-sm" onClick={() => void exportPendingReport(d)}>
        Baixar relatório de pendências
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExported(null)} aria-label="Fechar">
        <IconX />
      </button>
    </div>
  );
}
