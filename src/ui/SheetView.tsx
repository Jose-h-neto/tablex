import { memo, useEffect, useState } from 'react';
import templateUrl from '../assets/modelo_movimento_variavel.xlsx?url';
import { competenciaKey, parseCompetencia } from '../domain/competencia';
import { isExportable, type EditableField, type SheetRow } from '../engine/sheet';
import { useApp } from '../state/store';
import { SourcePanel } from './SourcePanel';

/** Colunas preenchíveis do modelo oficial, com os mesmos nomes. As demais saem vazias no arquivo. */
const COLUMNS: { field: EditableField; label: string; width: string; right?: boolean }[] = [
  { field: 'empresa', label: 'Código empresa', width: 'w-[104px]' },
  { field: 'matricula', label: 'Matricula', width: 'w-[80px]' },
  { field: 'rubrica', label: 'Código da Rubrica', width: 'w-[120px]' },
  { field: 'valor', label: 'Quantidade/Valor', width: 'w-[120px]', right: true },
  { field: 'data', label: 'Data do movimento', width: 'w-[124px]' },
  { field: 'fixar', label: 'Fixar valor?', width: 'w-[80px]' },
  { field: 'observacao', label: 'Observação', width: 'w-[170px]' },
];

async function exportRows(rows: SheetRow[], fileMonth: string) {
  const { writeImportWorkbook } = await import('../export/ExcelExporter');
  const template = await (await fetch(templateUrl)).arrayBuffer();
  const bytes = await writeImportWorkbook(template, rows);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `movimento_variavel_imp_${fileMonth}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function SheetView() {
  const rows = useApp((s) => s.rows) ?? [];
  const removed = useApp((s) => s.removed);
  const competencia = useApp((s) => s.competencia);
  const { backToMessage, setCompetencia, restoreRemoved, addRow } = useApp.getState();
  const [error, setError] = useState<string | null>(null);
  const [showMessage, setShowMessage] = useState(true);

  const exportable = rows.filter(isExportable);
  const left = rows.length - exportable.length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
        <button
          type="button"
          className="btn-quiet"
          onClick={() => {
            if (!useApp.getState().dirty || window.confirm('Voltar descarta as edições feitas na planilha. Continuar?')) backToMessage();
          }}
        >
          ← Mensagem
        </button>
        <button type="button" aria-pressed={showMessage} className={`btn-quiet ${showMessage ? 'bg-accent-soft font-medium text-accent hover:bg-accent-soft hover:text-accent' : ''}`} onClick={() => setShowMessage(!showMessage)}>
          {showMessage ? 'Ocultar mensagem' : 'Ver mensagem'}
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
          Folha
          <input
            type="month"
            className="h-8 rounded-md border border-line bg-surface px-2 text-ink outline-none focus:border-accent"
            value={competenciaKey(competencia)}
            onChange={(e) => {
              const c = parseCompetencia(e.target.value);
              if (c) setCompetencia(c);
            }}
          />
        </label>
        <div className="min-w-0 flex-1 truncate px-2 text-right text-[12px] text-ink-faint">
          {error && <span className="text-danger">{error} </span>}
          {left > 0 && <span>{left} sem rubrica e valor não {left === 1 ? 'entra' : 'entram'} no arquivo. </span>}
          {removed.length > 0 && (
            <button type="button" className="underline-offset-2 hover:text-ink hover:underline" onClick={restoreRemoved}>
              {removed.length} {removed.length === 1 ? 'removida' : 'removidas'}: recolocar
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={exportable.length === 0}
          className="btn-primary"
          onClick={() => {
            setError(null);
            exportRows(exportable, competenciaKey(competencia)).catch((e: Error) => setError(e.message));
          }}
        >
          Exportar {exportable.length}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {showMessage && <SourcePanel />}
        <div className="min-w-0 flex-1 overflow-auto bg-surface">
          <table className="w-full min-w-[1000px] table-fixed border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10 bg-canvas text-left text-[12px] text-ink-soft">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.field} className={`${c.width} border-r border-b border-line px-2.5 py-2 font-medium ${c.right ? 'text-right' : ''}`}>
                    {c.label}
                  </th>
                ))}
                <th className="border-b border-line px-3 py-2 font-normal text-ink-faint">Da mensagem</th>
                <th className="w-8 border-b border-line" aria-label="Remover" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} row={r} />
              ))}
            </tbody>
          </table>
          <button type="button" className="btn-quiet m-2" onClick={addRow}>
            + Adicionar linha
          </button>
        </div>
      </div>
    </div>
  );
}

const Row = memo(function Row({ row }: { row: SheetRow }) {
  const removeRow = useApp.getState().removeRow;
  const faded = !isExportable(row);
  return (
    <tr className={`group transition-colors hover:bg-canvas focus-within:bg-accent-soft/50 ${faded ? 'text-ink-faint' : ''}`}>
      {COLUMNS.map((c, col) => (
        <td key={c.field} className="border-r border-b border-line-soft p-0">
          <Cell row={row} field={c.field} col={col} right={c.right} />
        </td>
      ))}
      <td className="truncate border-b border-line-soft px-3 text-[12px] text-ink-faint" title={row.origem}>
        {row.origem}
      </td>
      <td className="border-b border-line-soft text-center">
        <button type="button" onClick={() => removeRow(row.id)} aria-label="Remover linha" className="text-[15px] leading-none text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus:opacity-100">
          ×
        </button>
      </td>
    </tr>
  );
});

/** Célula sempre editável. A alteração vale ao sair do campo; Enter e as setas andam como numa planilha. */
function Cell({ row, field, col, right }: { row: SheetRow; field: EditableField; col: number; right?: boolean }) {
  const edit = useApp.getState().edit;
  const value = row[field];
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) edit(row.id, field, draft.trim());
  };
  const move = (el: HTMLInputElement, dir: 1 | -1) => {
    commit();
    const inputs = [...document.querySelectorAll<HTMLInputElement>(`input[data-col="${col}"]`)];
    inputs[inputs.indexOf(el) + dir]?.focus();
  };

  return (
    <input
      data-col={col}
      value={draft}
      aria-label={field}
      spellCheck={false}
      className={`block h-8 w-full bg-transparent px-2.5 tabular-nums outline-none focus:bg-surface focus:ring-2 focus:ring-accent focus:ring-inset ${right ? 'text-right' : ''}`}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        e.target.select();
        useApp.getState().setActiveLine(row.line);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(e.currentTarget, 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          move(e.currentTarget, -1);
        } else if (e.key === 'Escape') {
          setDraft(value);
        }
      }}
    />
  );
}
