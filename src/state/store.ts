import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { currentCompetencia, firstDayBr, type Competencia } from '../domain/competencia';
import { applyEdit, blankRow, buildSheet, EMPTY_MEMORY, type EditableField, type Memory, type SheetRow } from '../engine/sheet';

interface AppState {
  /** Só isto é salvo no navegador. Mensagens e lançamentos ficam na memória da aba. */
  memory: Memory;
  text: string;
  rows: SheetRow[] | null;
  removed: SheetRow[];
  competencia: Competencia;
  /** Houve edição na planilha: voltar à mensagem perderia o trabalho. */
  dirty: boolean;
  /** Linha da mensagem correspondente à célula em foco. */
  activeLine: number;

  setText(text: string): void;
  process(): void;
  backToMessage(): void;
  setActiveLine(line: number): void;
  edit(id: string, field: EditableField, value: string): void;
  removeRow(id: string): void;
  restoreRemoved(): void;
  addRow(): void;
  setCompetencia(c: Competencia): void;
}

const MemorySchema = z.object({
  empresa: z.string().catch(''),
  fixarSim: z.string().catch(''),
  rubricas: z.record(z.string(), z.string()).catch(EMPTY_MEMORY.rubricas),
});

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      memory: EMPTY_MEMORY,
      text: '',
      rows: null,
      removed: [],
      competencia: currentCompetencia(),
      dirty: false,
      activeLine: -1,

      setText: (text) => set({ text }),
      process: () => {
        const { text, memory } = get();
        if (!text.trim()) return;
        set({ ...buildSheet(text, memory), dirty: false, activeLine: -1 });
      },
      backToMessage: () => set({ rows: null, removed: [] }),
      setActiveLine: (activeLine) => set({ activeLine }),
      edit: (id, field, value) => {
        const { rows, memory } = get();
        if (rows) set({ ...applyEdit(rows, memory, id, field, value), dirty: true });
      },
      removeRow: (id) => {
        const { rows, removed } = get();
        const row = rows?.find((r) => r.id === id);
        if (rows && row) set({ rows: rows.filter((r) => r !== row), removed: [...removed, row], dirty: true });
      },
      restoreRemoved: () => {
        const { rows, removed } = get();
        set({ rows: [...(rows ?? []), ...removed].sort((a, b) => a.order - b.order), removed: [] });
      },
      addRow: () => {
        const { rows, competencia, memory } = get();
        const list = rows ?? [];
        const order = Math.max(0, ...list.map((r) => r.order)) + 1;
        const row = blankRow(`n${order}`, order);
        row.empresa = memory.empresa;
        row.data = firstDayBr(competencia);
        set({ rows: [...list, row], dirty: true });
      },
      setCompetencia: (competencia) => {
        const data = firstDayBr(competencia);
        set((s) => ({ competencia, rows: s.rows?.map((r) => (r.data ? { ...r, data } : r)) ?? null }));
      },
    }),
    {
      name: 'tablex.memoria.v2',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ memory: s.memory }),
      merge: (persisted, current) => {
        const parsed = MemorySchema.safeParse((persisted as { memory?: unknown } | undefined)?.memory);
        return { ...current, memory: parsed.success ? parsed.data : EMPTY_MEMORY };
      },
    },
  ),
);
