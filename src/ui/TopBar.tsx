import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { competenciaKey, parseCompetencia } from '../domain/competencia';
import { useDerived } from '../state/derived';
import { useApp } from '../state/store';
import { exportImportFile } from './exportActions';
import { IconSettings, IconUndo } from './Icons';

/** Leva o usuário à pergunta que falta responder, em vez de deixar o botão sem saída. */
export function goToQuestions() {
  useApp.getState().setTab('resolver');
  setTimeout(() => document.querySelector<HTMLInputElement>('input[data-q]')?.focus(), 0);
}

export function TopBar() {
  const d = useDerived();
  const { sessionCompetencia, phase, exported, version, canUndo } = useApp(
    useShallow((s) => ({
      sessionCompetencia: s.sessionCompetencia,
      phase: s.phase,
      exported: s.exported,
      version: s.version,
      canUndo: s.history.length > 0,
    })),
  );
  const { setSessionCompetencia, openSettings, backToInput, undo } = useApp.getState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gear = (
    <button type="button" className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => openSettings('rubricas')} aria-label="Configurações" title="Configurações">
      <IconSettings width={16} height={16} />
    </button>
  );

  if (phase === 'input' || !d) {
    return <header className="flex h-12 shrink-0 items-center justify-end px-3">{gear}</header>;
  }

  const exportable = d.rows.filter((r) => r.exportable).length;

  const doExport = async () => {
    if (d.config.length > 0) {
      goToQuestions();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await exportImportFile(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
      <button type="button" className="text-[13px] text-slate-500 hover:text-slate-900" onClick={backToInput}>
        ← Mensagens
      </button>
      <label className="ml-2 flex items-center gap-1.5 text-[13px] text-slate-500">
        Folha
        <input
          type="month"
          className="rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] text-slate-800 outline-none hover:border-slate-200 focus:border-slate-400"
          value={competenciaKey(sessionCompetencia)}
          onChange={(e) => {
            const comp = parseCompetencia(e.target.value);
            if (comp) setSessionCompetencia(comp);
          }}
        />
      </label>

      <div className="min-w-0 flex-1 truncate text-right text-[12px]">
        {error ? (
          <span className="text-block" role="alert">{error}</span>
        ) : exported ? (
          exported.version === version ? (
            <span className="text-ok" role="status">✓ {exported.rows} lançamentos em {exported.fileName}</span>
          ) : (
            <span className="text-warn" role="status">Houve alterações depois de exportar</span>
          )
        ) : null}
      </div>

      {canUndo && (
        <button type="button" className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={undo} aria-label="Desfazer" title="Desfazer (Ctrl+Z)">
          <IconUndo width={16} height={16} />
        </button>
      )}
      {gear}
      <button type="button" className="btn btn-primary h-8 px-4 text-[13px]" disabled={exportable === 0 || busy} onClick={() => void doExport()}>
        {busy ? 'Gerando…' : `Exportar ${exportable}`}
      </button>
    </header>
  );
}
