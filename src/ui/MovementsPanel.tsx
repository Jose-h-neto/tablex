import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatCompetencia, formatIsoBr, parseBrDate } from '../domain/competencia';
import type { Issue, ResolvedRow, Unit } from '../domain/types';
import { ISSUE_LABELS } from '../engine/MovementValidator';
import { RUBRIC_CODE_RE } from '../engine/RubricMapper';
import { fold } from '../engine/text';
import { rowState, useDerived, type Derived, type RowState } from '../state/derived';
import { useApp, type Filter } from '../state/store';
import {
  formatAmount,
  formatAmountInput,
  parseAmountInput,
  plural,
  SEVERITY_DOT,
  SEVERITY_TEXT,
  STATE_BORDER,
  STATE_LABEL,
  STATE_TEXT,
  UNIT_LABEL,
  UNIT_OPTIONS,
} from './format';
import { IconAlert, IconBlock, IconCheck, IconDownload, IconMinus, IconUndo, IconX } from './Icons';
import { IssuePanel } from './IssuePanel';
import { Tip } from './Tooltip';

type ColKey = 'matricula' | 'nome' | 'tipo' | 'rubrica' | 'valor' | 'unidade' | 'data' | 'fixar' | 'obs' | 'issues';

/** Ordem por prioridade de conferência: o que decide a exportação fica visível sem rolagem horizontal. */
const COLS: { key: ColKey; label: string; className: string; editable: boolean }[] = [
  { key: 'matricula', label: 'Matr.', className: 'w-[56px]', editable: true },
  { key: 'nome', label: 'Funcionário', className: 'w-[150px]', editable: false },
  { key: 'tipo', label: 'Tipo de movimentação', className: 'w-[190px]', editable: false },
  { key: 'rubrica', label: 'Rubrica', className: 'w-[78px]', editable: true },
  { key: 'valor', label: 'Qtd/Valor', className: 'w-[78px] text-right', editable: true },
  { key: 'unidade', label: 'Un.', className: 'w-[46px]', editable: true },
  { key: 'issues', label: 'Pontos de atenção', className: 'w-[210px]', editable: false },
  { key: 'data', label: 'Data mov.', className: 'w-[80px]', editable: true },
  { key: 'fixar', label: 'Fixar', className: 'w-[42px] text-center', editable: true },
  { key: 'obs', label: 'Observação', className: 'w-[240px]', editable: true },
];
const COL_KEYS = COLS.map((c) => c.key);

interface EditState {
  id: string;
  col: ColKey;
  draft: string;
  error: string | null;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'valido', label: 'Válidos' },
  { key: 'atencao', label: 'Atenção' },
  { key: 'bloqueado', label: 'Bloqueados' },
  { key: 'excluido', label: 'Excluídos' },
];

export function MovementsPanel() {
  const d = useDerived()!;
  const { filter, issueFilter, search, selection, focusedId, tableScrollNonce, historyLen, exported } = useApp(
    useShallow((s) => ({
      filter: s.filter,
      issueFilter: s.issueFilter,
      search: s.search,
      selection: s.selection,
      focusedId: s.focusedId,
      tableScrollNonce: s.tableScrollNonce,
      historyLen: s.history.length,
      exported: s.exported,
    })),
  );
  const app = useApp.getState();

  const visible = useMemo(() => {
    const q = fold(search.trim());
    return d.rows.filter((r) => {
      if (filter !== 'todos' && rowState(r) !== filter) return false;
      if (issueFilter && !r.issues.some((i) => i.code === issueFilter && !i.acknowledged)) return false;
      if (q) {
        const hay = fold([r.matricula, r.m.employeeName, r.m.categoryLabel, r.rubricCode, r.m.sourceText, r.observation].join(' '));
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [d.rows, filter, issueFilter, search]);

  const [col, setCol] = useState<ColKey>('rubrica');
  const [edit, setEdit] = useState<EditState | null>(null);
  const anchor = useRef<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  const focusIndex = Math.max(
    0,
    visible.findIndex((r) => r.m.id === focusedId),
  );
  const focusedRow = visible.find((r) => r.m.id === focusedId) ?? null;

  useEffect(() => {
    if (!focusedId) return;
    rowRefs.current.get(focusedId)?.scrollIntoView({ block: tableScrollNonce ? 'nearest' : 'nearest' });
  }, [focusedId]);

  useEffect(() => {
    if (!tableScrollNonce || !focusedId) return;
    rowRefs.current.get(focusedId)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [tableScrollNonce]);

  const moveTo = (index: number, extend = false) => {
    const r = visible[Math.min(Math.max(index, 0), visible.length - 1)];
    if (!r) return;
    app.focus(r.m.id);
    if (extend) {
      const a = visible.findIndex((x) => x.m.id === (anchor.current ?? focusedId));
      const b = visible.indexOf(r);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      app.select(visible.slice(Math.max(lo, 0), hi + 1).map((x) => x.m.id));
    } else anchor.current = r.m.id;
  };

  const targets = (): string[] => (selection.size > 0 ? [...selection] : focusedId ? [focusedId] : []);

  const startEdit = (r: ResolvedRow, c: ColKey, initial?: string) => {
    const def = COLS.find((x) => x.key === c);
    if (!def?.editable) return;
    if (c === 'fixar') {
      app.editOverride([r.m.id], { fixed: !r.fixed });
      return;
    }
    const value =
      initial ??
      (c === 'matricula'
        ? (r.matricula ?? '')
        : c === 'rubrica'
          ? (r.rubricCode ?? '')
          : c === 'valor'
            ? formatAmountInput(r.amount)
            : c === 'unidade'
              ? r.unit
              : c === 'data'
                ? r.movementDate
                  ? formatIsoBr(r.movementDate)
                  : ''
                : r.observation);
    setEdit({ id: r.m.id, col: c, draft: value, error: null });
  };

  const commit = (e: EditState): boolean => {
    const v = e.draft.trim();
    const ids = [e.id];
    const fail = (error: string) => {
      setEdit({ ...e, error });
      return false;
    };
    switch (e.col) {
      case 'matricula':
        if (v && !/^\d{1,10}$/.test(v)) return fail('Somente dígitos.');
        app.editOverride(ids, { matricula: v });
        break;
      case 'rubrica':
        if (!v) app.clearOverride(ids, 'rubricCode');
        else if (!RUBRIC_CODE_RE.test(v)) return fail('Use letras, números, “.”, “_” ou “-”.');
        else app.editOverride(ids, { rubricCode: v });
        break;
      case 'valor': {
        const n = parseAmountInput(v);
        if (n === 'invalid') return fail('Número inválido (ex.: 1.234,56 ou 4h45).');
        app.editOverride(ids, { amount: n });
        break;
      }
      case 'unidade':
        app.editOverride(ids, { unit: v as Unit });
        break;
      case 'data': {
        if (!v) {
          app.clearOverride(ids, 'movementDate');
          break;
        }
        const iso = parseBrDate(v);
        if (!iso) return fail('Use dd/mm/aaaa.');
        app.editOverride(ids, { movementDate: iso });
        break;
      }
      case 'obs':
        app.editOverride(ids, { observation: e.draft.replace(/\s+/g, ' ').trim() });
        break;
      default:
        break;
    }
    setEdit(null);
    wrapper.current?.focus();
    return true;
  };

  const editableAfter = (c: ColKey, dir: 1 | -1): ColKey => {
    const editable = COLS.filter((x) => x.editable && x.key !== 'fixar').map((x) => x.key);
    const i = editable.indexOf(c);
    return editable[(i + dir + editable.length) % editable.length]!;
  };

  const onEditKey = (e: React.KeyboardEvent, st: EditState) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      setEdit(null);
      wrapper.current?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (commit(st)) moveTo(focusIndex + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (commit(st)) {
        const next = editableAfter(st.col, e.shiftKey ? -1 : 1);
        setCol(next);
        const r = d.byId.get(st.id);
        if (r) startEdit(r, next);
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const ci = COL_KEYS.indexOf(col);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveTo(focusIndex + 1, e.shiftKey);
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(focusIndex - 1, e.shiftKey);
        return;
      case 'PageDown':
        e.preventDefault();
        moveTo(focusIndex + 15, e.shiftKey);
        return;
      case 'PageUp':
        e.preventDefault();
        moveTo(focusIndex - 15, e.shiftKey);
        return;
      case 'Home':
        e.preventDefault();
        moveTo(0, e.shiftKey);
        return;
      case 'End':
        e.preventDefault();
        moveTo(visible.length - 1, e.shiftKey);
        return;
      case 'ArrowRight':
        e.preventDefault();
        setCol(COL_KEYS[Math.min(ci + 1, COL_KEYS.length - 1)]!);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        setCol(COL_KEYS[Math.max(ci - 1, 0)]!);
        return;
      case ' ':
        e.preventDefault();
        if (focusedId) app.select([focusedId], 'toggle');
        return;
      case 'Escape':
        app.select([]);
        return;
      case 'Delete':
        e.preventDefault();
        if (targets().length) app.exclude(targets(), 'descartado');
        return;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        if (ctrl) app.acknowledge(targets(), 'all-attention', d.openAttention);
        else if (focusedRow) startEdit(focusedRow, col);
        return;
      default:
        break;
    }
    if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      app.select(visible.map((r) => r.m.id));
      return;
    }
    // Digitação direta inicia a edição (como em planilhas).
    if (!ctrl && !e.altKey && e.key.length === 1 && focusedRow && COLS.find((c) => c.key === col)?.editable && col !== 'fixar' && col !== 'unidade') {
      e.preventDefault();
      startEdit(focusedRow, col, e.key);
    }
  };

  const counts = d.counters;
  const countFor: Record<Filter, number> = {
    todos: counts.total,
    valido: counts.valido,
    atencao: counts.atencao,
    bloqueado: counts.bloqueado,
    excluido: counts.excluido,
  };
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selection.has(r.m.id));

  return (
    <>
      <IssuePanel />

      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <div className="flex items-center rounded border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Filtro por status">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => app.setFilter(f.key)}
              className={`h-6 rounded-[3px] px-2 text-[12px] tabular-nums ${filter === f.key ? 'bg-white font-semibold text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {f.label} <span className="text-slate-400">{countFor[f.key]}</span>
            </button>
          ))}
        </div>
        {issueFilter && (
          <span className="flex h-6 items-center gap-1 rounded bg-sel-bg pr-1 pl-2 text-[11px] font-medium text-sel">
            {ISSUE_LABELS[issueFilter]}
            <button type="button" className="rounded p-0.5 hover:bg-white/60" onClick={() => app.setIssueFilter(null)} aria-label="Remover filtro">
              <IconX width={11} height={11} />
            </button>
          </span>
        )}
        <input
          className="field ml-1 h-7 w-56"
          placeholder="Buscar matrícula, nome, tipo, texto…"
          value={search}
          onChange={(e) => app.setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') app.setSearch('');
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
              e.preventDefault();
              wrapper.current?.focus();
              moveTo(0);
            }
          }}
          aria-label="Buscar"
        />
        <div className="flex-1" />
        <span className="text-[11px] tabular-nums text-slate-500">{plural(visible.length, 'exibido', 'exibidos')}</span>
        <Tip content="Desfazer a última alteração (Ctrl+Z)">
          <button type="button" className="btn btn-sm btn-ghost" onClick={app.undo} disabled={historyLen === 0} aria-label="Desfazer">
            <IconUndo /> Desfazer
          </button>
        </Tip>
      </div>

      {selection.size > 0 && <BulkBar d={d} ids={[...selection]} />}

      <div
        ref={wrapper}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="scroll-thin min-h-0 flex-1 overflow-auto bg-white outline-none focus-visible:outline-none"
        aria-label="Tabela de lançamentos"
      >
        <table className="w-full table-fixed border-separate border-spacing-0 text-[12px]">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold text-slate-500">
            <tr>
              <th className="w-[30px] border-b border-slate-200 px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => app.select(allVisibleSelected ? [] : visible.map((r) => r.m.id))}
                  aria-label="Selecionar todos os exibidos"
                />
              </th>
              <th className="w-[26px] border-b border-slate-200 py-1.5" aria-label="Status" />
              <th className="w-[34px] border-b border-slate-200 px-1 py-1.5">Msg</th>
              {COLS.map((c) => (
                <th key={c.key} className={`${c.className} border-b border-slate-200 px-1.5 py-1.5 font-semibold ${col === c.key ? 'text-slate-800' : ''}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Row
                key={r.m.id}
                r={r}
                d={d}
                focused={r.m.id === focusedId}
                selected={selection.has(r.m.id)}
                exported={exported?.ids.has(r.m.id) ?? false}
                activeCol={r.m.id === focusedId ? col : null}
                edit={edit && edit.id === r.m.id ? edit : null}
                setEdit={setEdit}
                onEditKey={onEditKey}
                commit={commit}
                refCb={(el) => {
                  if (el) rowRefs.current.set(r.m.id, el);
                  else rowRefs.current.delete(r.m.id);
                }}
                onCellClick={(c, ev) => {
                  if (ev.shiftKey) {
                    const a = visible.findIndex((x) => x.m.id === (anchor.current ?? focusedId));
                    const b = visible.indexOf(r);
                    const [lo, hi] = a <= b ? [a, b] : [b, a];
                    app.select(visible.slice(Math.max(lo, 0), hi + 1).map((x) => x.m.id));
                  } else if (ev.ctrlKey || ev.metaKey) app.select([r.m.id], 'toggle');
                  else anchor.current = r.m.id;
                  app.focus(r.m.id);
                  if (c) setCol(c);
                  wrapper.current?.focus();
                }}
                onCellDoubleClick={(c) => startEdit(r, c)}
              />
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <div className="p-6 text-center text-[12px] text-slate-500">Nenhum lançamento para este filtro.</div>}
      </div>

      <footer className="flex h-7 shrink-0 items-center gap-3 overflow-hidden border-t border-slate-200 bg-slate-50 px-3 text-[11px] whitespace-nowrap text-slate-500">
        <span><span className="kbd">↑↓</span> navegar</span>
        <span><span className="kbd">Shift</span>+<span className="kbd">↑↓</span> selecionar faixa</span>
        <span><span className="kbd">Enter</span> editar</span>
        <span><span className="kbd">Espaço</span> marcar</span>
        <span><span className="kbd">Ctrl+A</span> todos</span>
        <span><span className="kbd">Ctrl+Enter</span> confirmar atenção</span>
        <span><span className="kbd">Del</span> excluir</span>
        <span><span className="kbd">Ctrl+Z</span> desfazer</span>
        <span><span className="kbd">Ctrl+E</span> exportar</span>
      </footer>
    </>
  );
}

/* ---------- Barra de ações em lote ---------- */

function BulkBar({ d, ids }: { d: Derived; ids: string[] }) {
  const app = useApp.getState();
  const [code, setCode] = useState('');
  const anyExcluded = ids.some((id) => d.byId.get(id)?.exclusion);
  const attention = ids.filter((id) => d.openAttention.has(id)).length;
  const validCode = RUBRIC_CODE_RE.test(code.trim());

  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-sel/20 bg-sel-bg/50 px-3 text-[12px]">
      <span className="mr-1 font-semibold text-slate-800">{plural(ids.length, 'selecionado', 'selecionados')}</span>
      <input
        className="field h-6 w-20 font-mono"
        placeholder="rubrica"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && validCode) {
            app.editOverride(ids, { rubricCode: code.trim() });
            setCode('');
          }
        }}
        aria-label="Rubrica para os selecionados"
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={!validCode}
        onClick={() => {
          app.editOverride(ids, { rubricCode: code.trim() });
          setCode('');
        }}
      >
        Aplicar rubrica
      </button>
      <select
        className="field h-6 w-[88px] py-0"
        value=""
        onChange={(e) => e.target.value && app.editOverride(ids, { unit: e.target.value as Unit })}
        aria-label="Unidade para os selecionados"
      >
        <option value="">Unidade…</option>
        {UNIT_OPTIONS.filter((u) => u !== 'indefinida').map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-sm" onClick={() => app.editOverride(ids, { fixed: true })}>
        Fixar
      </button>
      <button type="button" className="btn btn-sm" onClick={() => app.editOverride(ids, { fixed: false })}>
        Não fixar
      </button>
      <span className="mx-0.5 h-4 w-px bg-slate-300" />
      <button type="button" className="btn btn-sm" disabled={attention === 0} onClick={() => app.acknowledge(ids, 'all-attention', d.openAttention)}>
        <IconCheck /> Confirmar atenção ({attention})
      </button>
      <button type="button" className="btn btn-sm" onClick={() => app.exclude(ids, 'tratamento_manual')}>
        Tratamento manual
      </button>
      <button type="button" className="btn btn-sm" onClick={() => app.exclude(ids, 'descartado')}>
        Excluir
      </button>
      {anyExcluded && (
        <button type="button" className="btn btn-sm" onClick={() => app.restore(ids)}>
          Restaurar
        </button>
      )}
      <div className="flex-1" />
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => app.select([])}>
        Limpar seleção <span className="kbd">Esc</span>
      </button>
    </div>
  );
}

/* ---------- Linha ---------- */

const EXCLUSION_TEXT = {
  duplicidade: 'Excluído: duplicidade',
  versao_substituida: 'Excluído: versão substituída',
  tratamento_manual: 'Tratamento manual',
  descartado: 'Excluído pelo usuário',
} as const;

function StateIcon({ state }: { state: RowState }) {
  const cls = `${STATE_TEXT[state]} shrink-0`;
  if (state === 'valido') return <IconCheck className={cls} />;
  if (state === 'atencao') return <IconAlert className={cls} />;
  if (state === 'bloqueado') return <IconBlock className={cls} />;
  return <IconMinus className={cls} />;
}

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <div className="space-y-1">
      {issues.map((i, k) => (
        <div key={k} className={i.acknowledged ? 'opacity-60' : ''}>
          <span className={`font-semibold ${i.severity === 'bloqueio' ? 'text-rose-300' : i.severity === 'atencao' ? 'text-amber-300' : 'text-slate-300'}`}>
            {ISSUE_LABELS[i.code]}
            {i.acknowledged ? ' (confirmado)' : ''}:
          </span>{' '}
          {i.message}
        </div>
      ))}
    </div>
  );
}

interface RowProps {
  r: ResolvedRow;
  d: Derived;
  focused: boolean;
  selected: boolean;
  exported: boolean;
  activeCol: ColKey | null;
  edit: EditState | null;
  setEdit: (e: EditState | null) => void;
  onEditKey: (e: React.KeyboardEvent, st: EditState) => void;
  commit: (e: EditState) => boolean;
  refCb: (el: HTMLTableRowElement | null) => void;
  onCellClick: (c: ColKey | null, e: React.MouseEvent) => void;
  onCellDoubleClick: (c: ColKey) => void;
}

const Row = memo(function Row({ r, d, focused, selected, exported, activeCol, edit, setEdit, onEditKey, commit, refCb, onCellClick, onCellDoubleClick }: RowProps) {
  const app = useApp.getState();
  const state = rowState(r);
  const excluded = !!r.exclusion;
  const open = r.issues
    .filter((i) => i.severity !== 'info' && !i.acknowledged)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'bloqueio' ? -1 : 1));
  const msgNo = d.msgNumber.get(r.m.messageId) ?? 0;
  const msg = d.result.messages[msgNo - 1];
  const strike = excluded ? 'line-through decoration-slate-400' : '';

  const cell = (c: ColKey, content: React.ReactNode, extra = '') => {
    const def = COLS.find((x) => x.key === c)!;
    const isActive = activeCol === c;
    const editing = edit?.col === c;
    return (
      <td
        className={`truncate border-b border-slate-100 px-1.5 py-0 ${def.className} ${isActive && !editing ? 'outline-2 -outline-offset-2 outline-sel/70' : ''} ${extra}`}
        onClick={(e) => onCellClick(c, e)}
        onDoubleClick={() => onCellDoubleClick(c)}
      >
        {editing && edit ? <Editor st={edit} setEdit={setEdit} onKey={onEditKey} commit={commit} /> : content}
      </td>
    );
  };

  return (
    <tr
      ref={refCb}
      aria-selected={selected}
      className={`h-[26px] ${focused ? 'bg-sel-bg/70' : selected ? 'bg-sel-bg/35' : 'hover:bg-slate-50'} ${excluded ? 'text-slate-400' : 'text-slate-800'}`}
    >
      <td className={`border-b border-l-[3px] border-b-slate-100 px-2 ${STATE_BORDER[state]}`} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={() => app.select([r.m.id], 'toggle')} aria-label={`Selecionar lançamento ${r.m.id}`} />
      </td>
      <td className="border-b border-slate-100" onClick={(e) => onCellClick(null, e)}>
        <Tip
          content={
            <div>
              <div className="font-semibold">{excluded ? EXCLUSION_TEXT[r.exclusion!.reason] : STATE_LABEL[state]}</div>
              {exported && <div>Incluído no último arquivo exportado.</div>}
              {!r.m.importable && <div>Não importável pela planilha de movimento variável.</div>}
            </div>
          }
          className="relative flex items-center justify-center"
        >
          <StateIcon state={state} />
          {exported && <IconDownload width={9} height={9} className="absolute -right-1 -bottom-1 text-sel" />}
        </Tip>
      </td>
      <td className="border-b border-slate-100 px-1 text-[11px] tabular-nums text-slate-500" onClick={(e) => onCellClick(null, e)}>
        <Tip
          content={
            msg ? (
              <span>
                Mensagem {msgNo}
                {msg.recipient ? ` para ${msg.recipient}` : ''} · competência {formatCompetencia(r.competencia)}
                {msg.isCorrection ? ' · correção' : ''}
              </span>
            ) : (
              ''
            )
          }
        >
          #{msgNo}
        </Tip>
      </td>
      {cell('matricula', <span className={`font-mono tabular-nums ${strike}`}>{r.matricula ?? <span className="text-block">—</span>}</span>)}
      {cell('nome', <span className={strike} title={r.m.employeeName ?? ''}>{r.m.employeeName ?? '—'}</span>)}
      {cell(
        'tipo',
        <span className={`flex items-center gap-1 ${strike}`} title={r.m.categoryLabel}>
          <span className="w-2 shrink-0 font-mono text-[11px] text-slate-400">{r.m.nature === 'desconto' ? '−' : r.m.nature === 'provento' ? '+' : ''}</span>
          <span className="truncate">{r.m.categoryLabel}</span>
        </span>,
      )}
      {cell(
        'rubrica',
        r.m.importable ? (
          r.rubricCode ? (
            <span className="flex items-center gap-1">
              <span className="font-mono">{r.rubricCode}</span>
              {r.rubricSource !== 'dicionario' && (
                <span className="rounded bg-slate-100 px-1 text-[9.5px] font-medium text-slate-500 uppercase">{r.rubricSource === 'manual' ? 'man' : 'msg'}</span>
              )}
            </span>
          ) : (
            <span className="text-[11px] text-block">definir</span>
          )
        ) : (
          <span className="text-slate-300">n/a</span>
        ),
      )}
      {cell(
        'valor',
        <span className={`font-mono tabular-nums ${r.amount === null && r.m.importable ? 'text-block' : ''} ${strike}`}>
          {formatAmount(r.amount, r.unit)}
        </span>,
        'text-right',
      )}
      {cell('unidade', <span className={r.unit === 'indefinida' && r.amount !== null ? 'font-semibold text-block' : 'text-slate-500'}>{UNIT_LABEL[r.unit]}</span>)}
      {cell(
        'issues',
        excluded ? (
          <span className="flex items-center gap-1.5">
            <span className="text-[11px]">{EXCLUSION_TEXT[r.exclusion!.reason]}</span>
            <button
              type="button"
              className="rounded px-1 text-[11px] text-sel hover:bg-sel-bg"
              onClick={(e) => {
                e.stopPropagation();
                app.restore([r.m.id]);
              }}
            >
              restaurar
            </button>
          </span>
        ) : open.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Tip content={<IssueList issues={r.issues} />} className="flex min-w-0 items-center gap-1.5">
              <span className={`size-1.5 shrink-0 rounded-full ${SEVERITY_DOT[open[0]!.severity]}`} />
              <span className={`truncate ${SEVERITY_TEXT[open[0]!.severity]}`}>{ISSUE_LABELS[open[0]!.code]}</span>
              {open.length > 1 && <span className="shrink-0 text-[11px] text-slate-400">+{open.length - 1}</span>}
            </Tip>
            {d.openAttention.has(r.m.id) && (
              <Tip content="Confirmar as pendências de atenção deste lançamento (Ctrl+Enter)">
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-ok-bg hover:text-ok"
                  onClick={(e) => {
                    e.stopPropagation();
                    app.acknowledge([r.m.id], 'all-attention', d.openAttention);
                  }}
                  aria-label="Confirmar pendências de atenção"
                >
                  <IconCheck width={12} height={12} />
                </button>
              </Tip>
            )}
          </span>
        ) : r.issues.length > 0 ? (
          <Tip content={<IssueList issues={r.issues} />}>
            <span className="text-[11px] text-slate-400">{r.issues.some((i) => i.acknowledged) ? 'confirmado' : 'observação'}</span>
          </Tip>
        ) : (
          <span className="text-slate-300">—</span>
        ),
      )}
      {cell(
        'data',
        r.movementDate ? (
          <span className={`tabular-nums ${r.dateOverridden ? '' : 'text-slate-500'}`}>{formatIsoBr(r.movementDate)}</span>
        ) : (
          <span className="text-[11px] text-slate-400">regra?</span>
        ),
      )}
      {cell('fixar', r.fixed ? <span className="font-medium text-slate-800">Sim</span> : <span className="text-slate-300">Não</span>, 'text-center')}
      {cell('obs', <span className="text-slate-600" title={r.observation}>{r.observation}</span>)}
    </tr>
  );
});

function Editor({
  st,
  setEdit,
  onKey,
  commit,
}: {
  st: EditState;
  setEdit: (e: EditState | null) => void;
  onKey: (e: React.KeyboardEvent, st: EditState) => void;
  commit: (e: EditState) => boolean;
}) {
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (ref.current instanceof HTMLInputElement && st.draft.length > 1) ref.current.select();
  }, []);

  const cls = `h-[22px] w-full rounded-[3px] border bg-white px-1 text-[12px] outline-none ${st.error ? 'border-block ring-2 ring-block/20' : 'border-sel ring-2 ring-sel/20'}`;

  if (st.col === 'unidade') {
    return (
      <select
        ref={ref}
        className={cls}
        value={st.draft}
        onChange={(e) => commit({ ...st, draft: e.target.value })}
        onKeyDown={(e) => onKey(e, st)}
        onBlur={() => setEdit(null)}
        onClick={(e) => e.stopPropagation()}
      >
        {UNIT_OPTIONS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Tip content={st.error ?? ''} className="block">
      <input
        ref={ref}
        className={`${cls} ${st.col === 'valor' ? 'text-right font-mono' : st.col === 'matricula' || st.col === 'rubrica' ? 'font-mono' : ''}`}
        value={st.draft}
        onChange={(e) => setEdit({ ...st, draft: e.target.value, error: null })}
        onKeyDown={(e) => onKey(e, st)}
        onBlur={() => {
          if (!commit(st)) setEdit(null);
        }}
        onClick={(e) => e.stopPropagation()}
        aria-invalid={!!st.error}
        title={st.error ?? undefined}
      />
    </Tip>
  );
}
