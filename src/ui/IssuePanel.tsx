import { useState } from 'react';
import { formatCompetencia } from '../domain/competencia';
import type { IssueCode, Unit } from '../domain/types';
import { isAcknowledgeable, pickSuperseded, type IssueGroup } from '../engine/MovementValidator';
import { RUBRIC_CODE_RE } from '../engine/RubricMapper';
import { useDerived } from '../state/derived';
import { useApp } from '../state/store';
import { SEVERITY_DOT, plural } from './format';
import { IconChevron, IconFilter, IconSettings } from './Icons';
import { Tip } from './Tooltip';

const MANUAL_CODES = new Set<IssueCode>(['NAO_IMPORTAVEL', 'NAO_INTERPRETADO', 'VALOR_AUSENTE', 'MATRICULA_AUSENTE']);

export function IssuePanel() {
  const d = useDerived()!;
  const issueFilter = useApp((s) => s.issueFilter);
  const sessionCompetencia = useApp((s) => s.sessionCompetencia);
  const { setIssueFilter, select, acknowledge, exclude, editOverride, openSettings } = useApp.getState();
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<IssueCode | null>('RUBRICA_NAO_CONFIGURADA');

  const total = d.groups.reduce((n, g) => n + g.rowIds.length, 0);
  if (d.groups.length === 0 && d.config.length === 0) {
    return (
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-slate-200 bg-ok-bg px-3 text-[12px] text-ok">
        Nenhuma pendência. Todos os lançamentos ativos estão válidos.
      </div>
    );
  }

  const filterBy = (g: IssueGroup) => {
    const on = issueFilter !== g.code;
    setIssueFilter(on ? g.code : null);
    if (on) select(g.rowIds);
  };

  const actions = (g: IssueGroup) => {
    const ids = g.rowIds;
    const out: React.ReactNode[] = [];
    if (g.code === 'RUBRICA_NAO_CONFIGURADA') {
      out.push(
        <button key="cfg" type="button" className="btn btn-sm" onClick={() => setExpanded(expanded === g.code ? null : g.code)}>
          {expanded === g.code ? 'Ocultar' : `Configurar ${plural(g.categories.length, 'tipo', 'tipos')}`}
        </button>,
      );
    }
    if (g.code === 'DUPLICADO' || g.code === 'CONFLITO') {
      const drop = pickSuperseded(d.rows, g.code, d.result.messages);
      out.push(
        <Tip
          key="sup"
          content={
            g.code === 'DUPLICADO'
              ? 'Mantém a ocorrência da mensagem mais recente (correções têm prioridade) e exclui as repetições. Pode ser desfeito (Ctrl+Z).'
              : 'Mantém o valor da versão mais recente (correções têm prioridade) e exclui as versões anteriores. Pode ser desfeito (Ctrl+Z).'
          }
        >
          <button
            type="button"
            className="btn btn-sm"
            disabled={drop.length === 0}
            onClick={() => exclude(drop, g.code === 'DUPLICADO' ? 'duplicidade' : 'versao_substituida')}
          >
            Manter mais recente (excluir {drop.length})
          </button>
        </Tip>,
      );
    }
    if (g.code === 'UNIDADE_INDEFINIDA') {
      for (const u of ['aulas', 'horas', 'dias'] as Unit[]) {
        out.push(
          <button key={u} type="button" className="btn btn-sm" onClick={() => editOverride(ids, { unit: u })}>
            Tudo em {u}
          </button>,
        );
      }
    }
    if (g.code === 'COMPETENCIA_DIVERGENTE') {
      out.push(
        <Tip key="comp" content="Lança estes itens na competência selecionada no topo (a data do movimento é recalculada).">
          <button type="button" className="btn btn-sm" onClick={() => editOverride(ids, { competencia: sessionCompetencia })}>
            Usar {formatCompetencia(sessionCompetencia)}
          </button>
        </Tip>,
      );
    }
    if (MANUAL_CODES.has(g.code)) {
      out.push(
        <Tip key="man" content="Retira da exportação e registra no relatório de pendências como “tratamento manual”.">
          <button type="button" className="btn btn-sm" onClick={() => exclude(ids, 'tratamento_manual')}>
            Tratamento manual
          </button>
        </Tip>,
      );
    }
    if (isAcknowledgeable(g.code) && g.code !== 'DUPLICADO' && g.code !== 'CONFLITO') {
      out.push(
        <Tip key="ack" content="Confirma esta pendência em todos os lançamentos do grupo. Os dados não são alterados.">
          <button type="button" className="btn btn-sm" onClick={() => acknowledge(ids, [g.code], d.openAttention)}>
            Confirmar {ids.length}
          </button>
        </Tip>,
      );
    }
    return out;
  };

  return (
    <div className="flex max-h-[42%] shrink-0 flex-col border-b border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex h-8 shrink-0 items-center gap-2 px-3 text-left text-[12px] hover:bg-slate-50"
        aria-expanded={!collapsed}
      >
        <IconChevron className={`text-slate-400 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        <span className="font-semibold text-slate-800">Pendências</span>
        <span className="text-slate-500">
          {plural(d.groups.length, 'tipo', 'tipos')} · {plural(total, 'ocorrência', 'ocorrências')}
        </span>
        {d.config.length > 0 && <span className="rounded bg-block-bg px-1.5 text-[11px] font-medium text-block">configuração incompleta</span>}
      </button>

      {!collapsed && (
        <div className="scroll-thin min-h-0 overflow-auto pb-1">
          {d.config.length > 0 && (
            <div className="mx-2 mb-1 flex items-center gap-2 rounded border border-block/25 bg-block-bg px-2.5 py-1.5 text-[12px]">
              <span className={`size-2 shrink-0 rounded-full ${SEVERITY_DOT.bloqueio}`} />
              <span className="font-medium text-block">Exportação bloqueada:</span>
              <span className="min-w-0 flex-1 truncate text-slate-700">{d.config.map((c) => c.message).join(' ')}</span>
              <button type="button" className="btn btn-sm" onClick={() => openSettings('importacao')}>
                <IconSettings /> Configurar
              </button>
            </div>
          )}
          {d.groups.map((g) => (
            <div key={g.code}>
              <div className={`group mx-2 flex items-center gap-2 rounded px-2.5 py-1 text-[12px] hover:bg-slate-50 ${issueFilter === g.code ? 'bg-sel-bg/60' : ''}`}>
                <span className={`size-2 shrink-0 rounded-full ${SEVERITY_DOT[g.severity]}`} />
                <span className="w-56 shrink-0 truncate font-medium text-slate-800">{g.label}</span>
                <span className="w-24 shrink-0 tabular-nums text-slate-500">{plural(g.rowIds.length, 'lançamento', 'lançamentos')}</span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{actions(g)}</div>
                <button
                  type="button"
                  className={`btn btn-sm btn-ghost ${issueFilter === g.code ? 'text-sel' : 'text-slate-500'}`}
                  onClick={() => filterBy(g)}
                  aria-pressed={issueFilter === g.code}
                >
                  <IconFilter /> {issueFilter === g.code ? 'Filtrando' : 'Filtrar'}
                </button>
              </div>
              {g.code === 'RUBRICA_NAO_CONFIGURADA' && expanded === g.code && <RubricQuickConfig group={g} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Configuração em lote: um código por tipo de movimentação, aplicado a todos os equivalentes. */
function RubricQuickConfig({ group }: { group: IssueGroup }) {
  const setRubrics = useApp.getState().setRubrics;
  const [codes, setCodes] = useState<Record<string, string>>({});
  const filled = group.categories.filter((c) => codes[c.key]?.trim());
  const invalid = filled.filter((c) => !RUBRIC_CODE_RE.test(codes[c.key]!.trim()));

  const save = (keys?: string[]) => {
    const list = (keys ? group.categories.filter((c) => keys.includes(c.key)) : filled).filter((c) =>
      RUBRIC_CODE_RE.test(codes[c.key]?.trim() ?? ''),
    );
    if (!list.length) return;
    setRubrics(list.map((c) => ({ key: c.key, code: codes[c.key]!.trim(), label: c.label })));
    setCodes((prev) => {
      const next = { ...prev };
      list.forEach((c) => delete next[c.key]);
      return next;
    });
  };

  return (
    <div className="mx-2 mb-1.5 ml-7 rounded border border-slate-200 bg-slate-50 p-2">
      <div className="mb-1.5 text-[11px] text-slate-500">
        Informe o código oficial de cada tipo. Ele fica salvo no dicionário e é aplicado automaticamente aos lançamentos
        equivalentes, agora e em processamentos futuros. <b>Enter</b> salva a linha.
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_7rem] items-center gap-x-3 gap-y-1">
        {group.categories.map((c) => {
          const v = codes[c.key] ?? '';
          const bad = v.trim() !== '' && !RUBRIC_CODE_RE.test(v.trim());
          return (
            <div key={c.key} className="contents">
              <span className="truncate text-[12px] text-slate-700" title={c.key}>
                {c.label}
              </span>
              <span className="text-right text-[11px] tabular-nums text-slate-500">{c.count}×</span>
              <input
                className={`field h-6 font-mono ${bad ? 'border-block bg-block-bg' : ''}`}
                placeholder="código"
                value={v}
                onChange={(e) => setCodes((p) => ({ ...p, [c.key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    save([c.key]);
                  }
                }}
                aria-label={`Código de rubrica para ${c.label}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {invalid.length > 0 && <span className="text-[11px] text-block">Use só letras, números, “.”, “_” ou “-”.</span>}
        <button type="button" className="btn btn-sm btn-primary" disabled={filled.length === 0} onClick={() => save()}>
          Salvar {filled.length || ''} no dicionário
        </button>
      </div>
    </div>
  );
}
