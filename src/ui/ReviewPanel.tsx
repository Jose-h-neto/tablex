import { useEffect, useRef, useState } from 'react';
import { formatCompetencia, formatIsoBr, parseBrDate } from '../domain/competencia';
import type { IssueCode, ResolvedRow, Unit } from '../domain/types';
import { ISSUE_LABELS, pickSuperseded } from '../engine/MovementValidator';
import { RUBRIC_CODE_RE } from '../engine/RubricMapper';
import { rowState, useDerived, type Derived } from '../state/derived';
import { useApp, type ReviewTab } from '../state/store';
import { exportPendingReport } from './exportActions';
import { formatAmount, formatAmountInput, parseAmountInput, plural, UNIT_LABEL, UNIT_OPTIONS } from './format';
import { IconChevron, IconX } from './Icons';

/** Seleciona lançamentos e mostra o trecho de origem no texto. */
function pick(d: Derived, ids: string[]) {
  const s = useApp.getState();
  s.select(ids);
  const first = ids[0] ? d.byId.get(ids[0]) : undefined;
  if (first) s.focusSource(first.m.fragmentSpan.start, first.m.fragmentSpan.end);
}

function focusNextQuestion(root: HTMLElement | null) {
  requestAnimationFrame(() => root?.querySelector<HTMLInputElement>('input[data-q]')?.focus());
}

export function ReviewPanel() {
  const d = useDerived()!;
  const tab = useApp((s) => s.tab);
  const selection = useApp((s) => s.selection);
  const setTab = useApp.getState().setTab;
  const c = d.counters;

  const tabs: { key: ReviewTab; label: string; n: number }[] = [
    { key: 'resolver', label: 'A resolver', n: c.atencao + c.bloqueado + d.questions.length },
    { key: 'prontos', label: 'Prontos', n: c.valido },
    { key: 'fora', label: 'Fora', n: c.excluido },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <nav className="flex h-11 shrink-0 items-end gap-6 border-b border-slate-200 px-6" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 pb-2.5 text-[13px] ${tab === t.key ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t.label} <span className="ml-0.5 text-slate-400 tabular-nums">{t.n}</span>
          </button>
        ))}
      </nav>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        {tab === 'resolver' && <ResolveList d={d} />}
        {tab === 'prontos' && <ReadyList d={d} />}
        {tab === 'fora' && <OutList d={d} />}
      </div>
      {selection.size > 0 && <Detail d={d} ids={[...selection]} />}
    </div>
  );
}

/* ---------- A resolver: uma lista de perguntas ---------- */

/** Frases simples para o que só precisa de confirmação. */
const CONFIRM_TEXT: Partial<Record<IssueCode, string>> = {
  HORA_EXTRA_REGRA: 'Horas extras pela duração do intervalo, sem percentual nem refeição',
  RECORRENCIA: 'Valores fixos: a planilha não tem data final, encerre no sistema',
  CALCULO_EXTERNO: 'Pagamentos proporcionais lançados em dias, sem calcular o valor',
  RUBRICA_DA_MENSAGEM: 'Códigos citados na própria mensagem',
  UNIDADE_INFERIDA: '“Falta” entendida como dia',
  DATA_INCONSISTENTE: 'Datas que não batem com o texto',
  DATA_FORA_COMPETENCIA: 'Datas fora da competência',
  VALOR_MULTIPLO: 'Mais de um valor no mesmo trecho; usado o primeiro',
  NOME_DIVERGENTE: 'Mesma matrícula com nomes diferentes',
};
const FIX_ROW_CODES: IssueCode[] = ['VALOR_AUSENTE', 'UNIDADE_INDEFINIDA', 'MATRICULA_AUSENTE', 'MATRICULA_INVALIDA', 'VALOR_INVALIDO', 'RUBRICA_INVALIDA', 'NAO_INTERPRETADO'];

function ResolveList({ d }: { d: Derived }) {
  const app = useApp.getState();
  const sessionCompetencia = useApp((s) => s.sessionCompetencia);
  const root = useRef<HTMLDivElement>(null);
  const group = (code: IssueCode) => d.groups.find((g) => g.code === code);

  useEffect(() => focusNextQuestion(root.current), []);

  const rubricas = group('RUBRICA_NAO_CONFIGURADA')?.categories ?? [];
  const fixes = d.rows.filter((r) => !r.exclusion && r.issues.some((i) => FIX_ROW_CODES.includes(i.code)));
  const repeated = (['DUPLICADO', 'CONFLITO'] as const).map(group).filter((g) => !!g);
  const outside = group('NAO_IMPORTAVEL');
  const divergent = group('COMPETENCIA_DIVERGENTE');
  const confirmables = d.groups.filter((g) => CONFIRM_TEXT[g.code]);
  const confirmMap = new Map<string, IssueCode[]>();
  for (const [id, codes] of d.openAttention) {
    const list = codes.filter((code) => CONFIRM_TEXT[code]);
    if (list.length) confirmMap.set(id, list);
  }

  const has = d.questions.length + rubricas.length + fixes.length + repeated.length + confirmables.length + d.unrecognized.length + (outside ? 1 : 0) + (divergent ? 1 : 0) > 0;
  if (!has) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-[14px] font-medium text-slate-800">Tudo resolvido</p>
        <p className="text-[13px] text-slate-500">Pode exportar.</p>
      </div>
    );
  }

  return (
    <div ref={root} className="pb-6">
      {d.questions.map((q) => {
        if (q.code === 'EMPRESA') {
          return (
            <Q key={q.code} title="Código da empresa">
              <Ask placeholder="código" hint="Fica salvo" onSubmit={(v) => { app.setSettings({ companyCode: v }); focusNextQuestion(root.current); }} />
            </Q>
          );
        }
        if (q.code === 'FIXAR') {
          return (
            <Q key={q.code} title="O que gravar em “Fixar valor?” nos lançamentos fixos?">
              <Ask placeholder="ex.: S" onSubmit={(v) => { app.setSettings({ fixarSim: v }); focusNextQuestion(root.current); }} />
            </Q>
          );
        }
        if (q.code === 'HORAS') {
          return (
            <Q key={q.code} title="Como gravar 4h45?">
              <button type="button" className="btn" onClick={() => app.setSettings({ hourFormat: 'decimal' })}>4,75</button>
              <button type="button" className="btn" onClick={() => app.setSettings({ hourFormat: 'sexagesimal' })}>4,45</button>
            </Q>
          );
        }
        return (
          <Q key={q.code} title="Data do movimento">
            <button type="button" className="btn" onClick={() => app.setSettings({ movementDateRule: 'inicio' })}>1º dia</button>
            <button type="button" className="btn" onClick={() => app.setSettings({ movementDateRule: 'fim' })}>Último dia</button>
          </Q>
        );
      })}

      {rubricas.length > 0 && <Heading>Códigos de rubrica</Heading>}
      {rubricas.map((c) => (
        <Q key={c.key} title={c.label} count={c.count}>
          <Ask
            placeholder="código"
            validate={(v) => RUBRIC_CODE_RE.test(v)}
            onSubmit={(v) => {
              app.setRubric(c.key, v, c.label);
              focusNextQuestion(root.current);
            }}
          />
        </Q>
      ))}

      {fixes.length > 0 && <Heading>Faltam dados</Heading>}
      {fixes.map((r) => (
        <FixRow key={r.m.id} r={r} d={d} root={root} />
      ))}

      {(repeated.length > 0 || outside || divergent) && <Heading>Decisões</Heading>}
      {repeated.map((g) => {
        const drop = pickSuperseded(d.rows, g.code as 'DUPLICADO' | 'CONFLITO', d.result.messages);
        return (
          <Q key={g.code} title={g.code === 'DUPLICADO' ? 'Repetidos entre mensagens' : 'Valores diferentes entre mensagens'} count={g.rowIds.length} ids={g.rowIds} d={d}>
            <button type="button" className="btn" disabled={drop.length === 0} onClick={() => app.exclude(drop, g.code === 'DUPLICADO' ? 'duplicidade' : 'versao_substituida')}>
              Manter o mais recente
            </button>
          </Q>
        );
      })}
      {divergent && (
        <Q title="De outra competência" count={divergent.rowIds.length} ids={divergent.rowIds} d={d}>
          <button type="button" className="btn" onClick={() => app.editOverride(divergent.rowIds, { competencia: sessionCompetencia })}>
            Usar {formatCompetencia(sessionCompetencia)}
          </button>
          <button type="button" className="btn" onClick={() => app.acknowledge(divergent.rowIds, ['COMPETENCIA_DIVERGENTE'], d.openAttention)}>
            Manter
          </button>
        </Q>
      )}
      {outside && (
        <Q title="Não cabem na planilha (cadastro, conferência, dados externos)" count={outside.rowIds.length} ids={outside.rowIds} d={d}>
          <button type="button" className="btn" onClick={() => app.exclude(outside.rowIds, 'tratamento_manual')}>
            Tratar fora
          </button>
        </Q>
      )}
      {d.unrecognized.length > 0 && (
        <Q title={plural(d.unrecognized.length, 'linha não entendida', 'linhas não entendidas')}>
          <button type="button" className="btn" onClick={() => app.focusSource(d.unrecognized[0]!.span.start, d.unrecognized[0]!.span.end)}>
            Ver no texto
          </button>
        </Q>
      )}

      {confirmables.length > 0 && (
        <Heading
          action={
            <button type="button" className="text-[12px] font-medium text-slate-700 hover:text-slate-950" onClick={() => app.acknowledge([...confirmMap.keys()], 'all-attention', confirmMap)}>
              Confirmar tudo
            </button>
          }
        >
          Confira
        </Heading>
      )}
      {confirmables.map((g) => (
        <Q key={g.code} title={CONFIRM_TEXT[g.code]!} count={g.rowIds.length} ids={g.rowIds} d={d}>
          <button type="button" className="btn" onClick={() => app.acknowledge(g.rowIds, [g.code], d.openAttention)}>
            Confirmar
          </button>
        </Q>
      ))}
    </div>
  );
}

function Heading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mt-5 flex items-center justify-between px-6 pb-1">
      <h3 className="text-[12px] text-slate-400">{children}</h3>
      {action}
    </div>
  );
}

/** Uma pergunta. Quando há lançamentos, o título abre a lista deles. */
function Q({ title, count, ids, d, children }: { title: string; count?: number; ids?: string[]; d?: Derived; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const expandable = !!ids && !!d;
  return (
    <div>
      <div className="flex min-h-11 items-center gap-4 px-6 py-1.5 hover:bg-slate-50">
        <button type="button" disabled={!expandable} onClick={() => setOpen(!open)} aria-expanded={expandable ? open : undefined} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] text-slate-800">
          {expandable && <IconChevron width={11} height={11} className={`shrink-0 text-slate-400 ${open ? 'rotate-90' : ''}`} />}
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="shrink-0 text-slate-400 tabular-nums">{count}</span>}
        </button>
        <div className="flex shrink-0 items-center gap-1.5">{children}</div>
      </div>
      {open && expandable && (
        <div className="pb-1 pl-10">
          {ids.map((id) => {
            const r = d.byId.get(id);
            return r ? <MiniRow key={id} r={r} d={d} /> : null;
          })}
        </div>
      )}
    </div>
  );
}

function MiniRow({ r, d }: { r: ResolvedRow; d: Derived }) {
  const selected = useApp((s) => s.selection.has(r.m.id));
  return (
    <button type="button" onClick={() => pick(d, [r.m.id])} className={`flex w-full items-baseline gap-2 px-2 py-0.5 pr-6 text-left text-[12px] ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
      <span className="w-9 shrink-0 text-slate-400 tabular-nums">{r.matricula}</span>
      <span className="min-w-0 flex-1 truncate text-slate-700">{r.m.employeeName}</span>
      <span className="min-w-0 flex-1 truncate text-slate-500">{r.m.categoryLabel}</span>
      <span className="shrink-0 text-slate-700 tabular-nums">{formatAmount(r.amount, r.unit)}</span>
    </button>
  );
}

/** Lançamento que só avança com um dado: pergunta o dado ali mesmo. */
function FixRow({ r, d, root }: { r: ResolvedRow; d: Derived; root: React.RefObject<HTMLDivElement | null> }) {
  const app = useApp.getState();
  const codes = r.issues.map((i) => i.code);
  const title = `${r.m.employeeName ?? `Matrícula ${r.matricula ?? '?'}`} · ${r.m.categoryKey === 'NAO_INTERPRETADO' ? `“${r.m.sourceText}”` : r.m.categoryLabel}`;
  return (
    <Q title={title}>
      {codes.includes('VALOR_AUSENTE') && r.m.importable && (
        <Ask
          placeholder="valor"
          validate={(v) => { const n = parseAmountInput(v); return n !== 'invalid' && n !== null; }}
          onSubmit={(v) => {
            const n = parseAmountInput(v);
            if (typeof n === 'number') app.editOverride([r.m.id], { amount: n });
            focusNextQuestion(root.current);
          }}
        />
      )}
      {codes.includes('UNIDADE_INDEFINIDA') &&
        (['aulas', 'horas', 'dias'] as Unit[]).map((u) => (
          <button key={u} type="button" className="btn" onClick={() => app.editOverride([r.m.id], { unit: u })}>
            {formatAmount(r.amount, r.unit)} {u}
          </button>
        ))}
      {(codes.includes('NAO_INTERPRETADO') || codes.includes('MATRICULA_AUSENTE') || codes.includes('MATRICULA_INVALIDA') || codes.includes('VALOR_INVALIDO') || codes.includes('RUBRICA_INVALIDA')) && (
        <button type="button" className="btn" onClick={() => pick(d, [r.m.id])}>
          Corrigir
        </button>
      )}
      <button type="button" className="btn btn-ghost text-slate-500" onClick={() => app.exclude([r.m.id], 'tratamento_manual')}>
        Tratar fora
      </button>
    </Q>
  );
}

/** Campo de resposta curta: Enter responde e o foco segue para a próxima pergunta. */
function Ask({ placeholder, hint, validate, onSubmit }: { placeholder: string; hint?: string; validate?: (v: string) => boolean; onSubmit: (v: string) => void }) {
  const [v, setV] = useState('');
  const value = v.trim();
  const bad = value !== '' && validate ? !validate(value) : false;
  const send = () => {
    if (value && !bad) onSubmit(value);
  };
  return (
    <>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      <input
        data-q
        className={`h-8 w-24 rounded border bg-slate-50 px-2 text-[13px] outline-none focus:bg-white ${bad ? 'border-block' : 'border-transparent hover:border-slate-200 focus:border-slate-500'}`}
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey && value)) {
            e.preventDefault();
            send();
          }
        }}
        aria-label={placeholder}
        aria-invalid={bad}
      />
    </>
  );
}

/* ---------- Prontos e Fora ---------- */

const GRID = 'grid grid-cols-[48px_minmax(0,1.2fr)_minmax(0,1.3fr)_84px_64px] items-center gap-3';

function ReadyList({ d }: { d: Derived }) {
  const selection = useApp((s) => s.selection);
  const exported = useApp((s) => s.exported);
  const rows = d.rows.filter((r) => rowState(r) === 'valido');
  const anchor = useRef<string | null>(null);

  if (rows.length === 0) {
    return <p className="p-10 text-center text-[13px] text-slate-500">Nenhum lançamento pronto ainda.</p>;
  }

  const click = (r: ResolvedRow, e: React.MouseEvent) => {
    const s = useApp.getState();
    if (e.shiftKey && anchor.current) {
      const a = rows.findIndex((x) => x.m.id === anchor.current);
      const b = rows.indexOf(r);
      s.select(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.m.id));
    } else if (e.ctrlKey || e.metaKey) {
      s.select([r.m.id], 'toggle');
      anchor.current = r.m.id;
    } else {
      pick(d, [r.m.id]);
      anchor.current = r.m.id;
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const current = rows.findIndex((r) => selection.has(r.m.id));
    const next = rows[Math.min(Math.max(current + (e.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1)];
    if (next) {
      pick(d, [next.m.id]);
      document.getElementById(`row-${next.m.id}`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  return (
    <div tabIndex={0} onKeyDown={onKey} className="outline-none">
      <div className={`${GRID} sticky top-0 border-b border-slate-100 bg-white px-6 py-2 text-[11px] text-slate-400`}>
        <span>Matr.</span>
        <span>Funcionário</span>
        <span>Movimentação</span>
        <span className="text-right">Valor</span>
        <span>Rubrica</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.m.id}
          id={`row-${r.m.id}`}
          onClick={(e) => click(r, e)}
          className={`${GRID} cursor-pointer px-6 py-1.5 text-[13px] select-none ${selection.has(r.m.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
          aria-selected={selection.has(r.m.id)}
        >
          <span className="text-slate-400 tabular-nums">{r.matricula}</span>
          <span className="truncate text-slate-800">{r.m.employeeName}</span>
          <span className="truncate text-slate-500">{r.m.categoryLabel}</span>
          <span className="text-right text-slate-800 tabular-nums">
            {formatAmount(r.amount, r.unit)}
            {r.unit !== 'valor' && <span className="ml-1 text-[11px] text-slate-400">{UNIT_LABEL[r.unit]}</span>}
          </span>
          <span className="truncate text-slate-500 tabular-nums">
            {r.rubricCode}
            {exported?.ids.has(r.m.id) && <span className="ml-1.5 text-ok" title="Incluído no arquivo exportado">✓</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

const OUT_REASON = {
  duplicidade: 'Repetido',
  versao_substituida: 'Versão antiga',
  tratamento_manual: 'Tratar fora',
  descartado: 'Excluído',
} as const;

function OutList({ d }: { d: Derived }) {
  const app = useApp.getState();
  const rows = d.rows.filter((r) => r.exclusion);
  return (
    <div>
      <div className="flex justify-end px-6 py-2">
        <button type="button" className="text-[12px] text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline" onClick={() => void exportPendingReport(d)}>
          Baixar relatório do que não foi exportado
        </button>
      </div>
      {rows.length === 0 && <p className="p-10 text-center text-[13px] text-slate-500">Nada ficou de fora.</p>}
      {rows.map((r) => (
        <div key={r.m.id} className="flex items-center gap-3 px-6 py-1.5 text-[13px] hover:bg-slate-50">
          <button type="button" onClick={() => pick(d, [r.m.id])} className="flex min-w-0 flex-1 items-baseline gap-3 text-left">
            <span className="w-9 shrink-0 text-slate-400 tabular-nums">{r.matricula}</span>
            <span className="min-w-0 flex-1 truncate text-slate-700">{r.m.employeeName}</span>
            <span className="min-w-0 flex-1 truncate text-slate-500">{r.m.categoryLabel}</span>
          </button>
          <span className="w-24 shrink-0 text-[12px] text-slate-400">{r.exclusion?.note ?? OUT_REASON[r.exclusion!.reason]}</span>
          <button type="button" className="shrink-0 text-[12px] text-slate-500 hover:text-slate-900" onClick={() => app.restore([r.m.id])}>
            Recolocar
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Detalhe: o único lugar com campos de edição ---------- */

function Detail({ d, ids }: { d: Derived; ids: string[] }) {
  const app = useApp.getState();
  const rows = ids.map((id) => d.byId.get(id)).filter((r): r is ResolvedRow => !!r);
  const [code, setCode] = useState('');
  if (rows.length === 0) return null;
  const many = rows.length > 4;

  return (
    <div className="scroll-thin relative max-h-[45%] shrink-0 overflow-auto border-t border-slate-200 bg-slate-50 px-6 py-3">
      <button type="button" className="absolute top-2 right-3 rounded p-1 text-slate-400 hover:text-slate-700" onClick={() => app.select([])} aria-label="Fechar">
        <IconX />
      </button>
      {many ? (
        <div className="flex items-center gap-2 pr-8 text-[13px]">
          <span className="mr-2 text-slate-700">{rows.length} selecionados</span>
          <input className="h-8 w-24 rounded border border-slate-300 bg-white px-2 outline-none focus:border-slate-500" placeholder="rubrica" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Rubrica para os selecionados" />
          <button type="button" className="btn" disabled={!RUBRIC_CODE_RE.test(code.trim())} onClick={() => { app.editOverride(ids, { rubricCode: code.trim() }); setCode(''); }}>
            Aplicar
          </button>
          <button type="button" className="btn btn-ghost text-slate-500" onClick={() => { app.exclude(ids, 'descartado'); app.select([]); }}>
            Tirar da planilha
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <DetailRow key={r.m.id} r={r} d={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onCommit, validate, className = 'w-24' }: { label: string; value: string; onCommit: (v: string) => void; validate?: (v: string) => boolean; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const bad = validate ? !validate(v.trim()) : false;
  return (
    <label className={`flex flex-col gap-0.5 text-[11px] text-slate-400 ${className}`}>
      {label}
      <input
        className={`h-7 w-full rounded border bg-white px-1.5 text-[12px] text-slate-800 outline-none ${bad ? 'border-block' : 'border-slate-200 focus:border-slate-500'}`}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={() => {
          if (!bad && v.trim() !== value) onCommit(v.trim());
        }}
        aria-invalid={bad}
      />
    </label>
  );
}

function DetailRow({ r, d }: { r: ResolvedRow; d: Derived }) {
  const app = useApp.getState();
  const id = r.m.id;
  const ids = [id];
  const editable = r.m.importable || r.m.categoryKey === 'NAO_INTERPRETADO';
  const open = r.issues.filter((i) => i.severity !== 'info' && !i.acknowledged);
  const canConfirm = d.openAttention.has(id);

  return (
    <div className="pr-8">
      <div className="flex items-baseline gap-2 text-[13px]">
        <span className="font-medium text-slate-800">{r.m.employeeName ?? 'Sem nome'}</span>
        <span className="truncate text-slate-500">{r.m.categoryLabel}</span>
        <span className="flex-1" />
        {canConfirm && (
          <button type="button" className="shrink-0 text-[12px] font-medium text-slate-700 hover:text-slate-950" onClick={() => app.acknowledge(ids, 'all-attention', d.openAttention)}>
            Confirmar
          </button>
        )}
        {r.exclusion ? (
          <button type="button" className="shrink-0 text-[12px] text-slate-500 hover:text-slate-900" onClick={() => app.restore(ids)}>
            Recolocar
          </button>
        ) : (
          <button type="button" className="shrink-0 text-[12px] text-slate-500 hover:text-slate-900" onClick={() => { app.exclude(ids, 'descartado'); app.select([]); }}>
            Tirar da planilha
          </button>
        )}
      </div>

      {editable && (
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          <Field label="Matrícula" className="w-16" value={r.matricula ?? ''} validate={(v) => /^\d{0,10}$/.test(v)} onCommit={(v) => app.editOverride(ids, { matricula: v })} />
          <Field label="Rubrica" className="w-20" value={r.rubricCode ?? ''} validate={(v) => !v || RUBRIC_CODE_RE.test(v)} onCommit={(v) => (v ? app.editOverride(ids, { rubricCode: v }) : app.clearOverride(ids, 'rubricCode'))} />
          <Field label="Valor" className="w-20" value={formatAmountInput(r.amount)} validate={(v) => parseAmountInput(v) !== 'invalid'} onCommit={(v) => { const n = parseAmountInput(v); if (n !== 'invalid') app.editOverride(ids, { amount: n }); }} />
          <label className="flex w-20 flex-col gap-0.5 text-[11px] text-slate-400">
            Unidade
            <select className="h-7 rounded border border-slate-200 bg-white px-1 text-[12px] text-slate-800 outline-none focus:border-slate-500" value={r.unit} onChange={(e) => app.editOverride(ids, { unit: e.target.value as Unit })}>
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>{u === 'indefinida' ? '?' : u}</option>
              ))}
            </select>
          </label>
          <Field label="Data" value={r.movementDate ? formatIsoBr(r.movementDate) : ''} validate={(v) => !v || parseBrDate(v) !== null} onCommit={(v) => { const iso = parseBrDate(v); if (iso) app.editOverride(ids, { movementDate: iso }); else app.clearOverride(ids, 'movementDate'); }} />
          <label className="flex h-7 items-center gap-1.5 text-[12px] text-slate-600">
            <input type="checkbox" checked={r.fixed} onChange={() => app.editOverride(ids, { fixed: !r.fixed })} />
            Fixo
          </label>
          <Field label="Observação" className="min-w-40 flex-1" value={r.observation} onCommit={(v) => app.editOverride(ids, { observation: v })} />
        </div>
      )}

      {open.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[12px] leading-snug text-slate-500">
          {open.map((i, k) => (
            <li key={k} title={ISSUE_LABELS[i.code]}>{i.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
