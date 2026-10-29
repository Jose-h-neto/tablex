import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { competenciaKey, parseCompetencia } from '../domain/competencia';
import { useDerived } from '../state/derived';
import { useApp, type Filter } from '../state/store';
import { exportImportFile, exportPendingReport } from './exportActions';
import { STATE_DOT } from './format';
import { IconAlert, IconDownload, IconSettings, IconShield } from './Icons';
import { Tip } from './Tooltip';

export function TopBar({ onError }: { onError: (msg: string | null) => void }) {
  const d = useDerived();
  const { settings, sessionCompetencia, phase, filter } = useApp(
    useShallow((s) => ({
      settings: s.settings,
      sessionCompetencia: s.sessionCompetencia,
      phase: s.phase,
      filter: s.filter,
    })),
  );
  const { setSettings, setSessionCompetencia, openSettings, setFilter } = useApp.getState();
  const [busy, setBusy] = useState(false);

  const c = d?.counters;
  const exportable = d ? d.rows.filter((r) => r.exportable).length : 0;
  const configMissing = d ? d.config : [];
  const canExport = !!d && exportable > 0 && configMissing.length === 0 && !busy;
  const pending = c ? c.atencao + c.bloqueado : 0;

  const doExport = async () => {
    if (!d || !canExport) return;
    setBusy(true);
    onError(null);
    try {
      await exportImportFile(d);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const counter = (f: Filter, label: string, n: number, dot?: string) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      className={`flex h-7 items-center gap-1.5 rounded px-2 text-[12px] tabular-nums hover:bg-slate-100 ${filter === f ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600'}`}
    >
      {dot && <span className={`size-2 rounded-full ${dot}`} />}
      <span>{n.toLocaleString('pt-BR')}</span>
      <span className="text-slate-500">{label}</span>
    </button>
  );

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3">
      <div className="flex items-center gap-2 pr-1">
        <div className="grid size-6 place-items-center rounded bg-slate-900 text-[11px] font-bold text-white">Tx</div>
        <span className="text-[13px] font-semibold whitespace-nowrap text-slate-900">Movimentações de Folha</span>
      </div>

      <div className="h-5 w-px bg-slate-200" />

      <label className="flex items-center gap-1.5">
        <span className="label">Empresa</span>
        <input
          className={`field w-20 ${!settings.companyCode.trim() ? 'border-block/50 bg-block-bg' : ''}`}
          value={settings.companyCode}
          placeholder="código"
          onChange={(e) => setSettings({ companyCode: e.target.value.trim() })}
          aria-label="Código da empresa"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="label">Competência</span>
        <input
          type="month"
          className="field w-[132px]"
          value={competenciaKey(sessionCompetencia)}
          onChange={(e) => {
            const comp = parseCompetencia(e.target.value);
            if (comp) setSessionCompetencia(comp);
          }}
          aria-label="Competência da folha"
        />
      </label>

      {phase === 'review' && c && (
        <>
          <div className="h-5 w-px bg-slate-200" />
          <nav className="flex min-w-0 items-center overflow-hidden" aria-label="Contadores">
            {counter('todos', 'lançamentos', c.total)}
            {counter('valido', 'válidos', c.valido, STATE_DOT.valido)}
            {counter('atencao', 'atenção', c.atencao, STATE_DOT.atencao)}
            {counter('bloqueado', 'bloqueados', c.bloqueado, STATE_DOT.bloqueado)}
            {counter('excluido', 'excluídos', c.excluido, STATE_DOT.excluido)}
          </nav>
        </>
      )}

      <div className="flex-1" />

      <Tip content="Processamento 100% local no navegador. Mensagens e lançamentos não são salvos nem enviados para nenhum serviço.">
        <span className="flex items-center text-ok" aria-label="Processamento local">
          <IconShield />
        </span>
      </Tip>

      <button type="button" className="btn relative" onClick={() => openSettings('importacao')}>
        <IconSettings /> Configurações
        {configMissing.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-block text-[10px] font-bold text-white">
            {configMissing.length}
          </span>
        )}
      </button>

      {phase === 'review' && d && (
        <>
          <Tip content="Baixa um XLSX separado (fora do modelo oficial) com tudo que não foi exportado: pendentes, excluídos e linhas não processadas.">
            <button type="button" className="btn" onClick={() => void exportPendingReport(d)} disabled={pending + c!.excluido + d.unrecognized.length === 0}>
              <IconDownload /> Pendências
            </button>
          </Tip>
          <Tip
            content={
              configMissing.length > 0 ? (
                <div>
                  <div className="mb-1 font-semibold">Configuração de importação incompleta:</div>
                  {configMissing.map((m) => (
                    <div key={m.code}>• {m.message}</div>
                  ))}
                </div>
              ) : exportable === 0 ? (
                'Nenhum lançamento válido. Resolva as pendências para exportar.'
              ) : (
                `Gera o XLSX no modelo oficial com ${exportable} lançamento(s) válido(s). ${pending} pendente(s) e ${c!.excluido} excluído(s) não entram. Atalho: Ctrl+E`
              )
            }
          >
            <button type="button" className="btn btn-primary" disabled={!canExport} onClick={() => void doExport()}>
              {configMissing.length > 0 ? <IconAlert /> : <IconDownload />}
              {busy ? 'Gerando…' : `Exportar XLSX (${exportable})`}
            </button>
          </Tip>
        </>
      )}
    </header>
  );
}
