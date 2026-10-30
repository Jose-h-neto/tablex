import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { z } from 'zod';
import { currentCompetencia, sameCompetencia } from '../domain/competencia';
import {
  DEFAULT_SETTINGS,
  ImportSettingsSchema,
  RubricDictionarySchema,
  type Competencia,
  type ExclusionReason,
  type ImportSettings,
  type IssueCode,
  type Overrides,
  type ReviewState,
  type RubricDictionary,
} from '../domain/types';
import { detectCompetencia, processText, repeatedMessageExclusions, type ProcessResult } from '../engine/pipeline';
import { DOCUMENTED_RUBRICS, setMapping } from '../engine/RubricMapper';

export type ReviewTab = 'resolver' | 'prontos' | 'fora';

export interface ExportRecord {
  ids: Set<string>;
  fileName: string;
  rows: number;
  verified: boolean;
  errors: string[];
  at: string;
  /** Versão do estado no momento da exportação, para avisar alterações posteriores. */
  version: number;
}

export interface SourceFocus {
  start: number;
  end: number;
  nonce: number;
}

interface PersistedState {
  settings: ImportSettings;
  dictionary: RubricDictionary;
  splitRatio: number;
}

export interface AppState extends PersistedState {
  inputText: string;
  sessionCompetencia: Competencia;
  phase: 'input' | 'review';
  result: ProcessResult | null;
  review: ReviewState;
  history: ReviewState[];
  version: number;
  selection: Set<string>;
  sourceFocus: SourceFocus | null;
  tab: ReviewTab;
  exported: ExportRecord | null;
  customTemplate: { name: string; buffer: ArrayBuffer } | null;
  settingsOpen: false | 'importacao' | 'rubricas' | 'modelo';

  setInputText(text: string): void;
  setSessionCompetencia(c: Competencia): void;
  process(): void;
  backToInput(): void;
  reset(): void;

  editOverride(ids: string[], patch: Overrides): void;
  clearOverride(ids: string[], field: keyof Overrides): void;
  acknowledge(ids: string[], codes: IssueCode[] | 'all-attention', available: Map<string, IssueCode[]>): void;
  exclude(ids: string[], reason: ExclusionReason, note?: string): void;
  restore(ids: string[]): void;
  undo(): void;

  setRubric(key: string, code: string, label: string): void;
  setRubrics(entries: { key: string; code: string; label: string }[]): void;
  setSettings(patch: Partial<ImportSettings>): void;
  replaceConfig(settings: ImportSettings, dictionary: RubricDictionary): void;
  clearStoredConfig(): void;
  setSplitRatio(r: number): void;

  select(ids: string[], mode?: 'replace' | 'add' | 'toggle'): void;
  focusSource(start: number, end: number): void;
  setTab(t: ReviewTab): void;
  setExported(r: ExportRecord | null): void;
  setCustomTemplate(t: AppState['customTemplate']): void;
  openSettings(tab: AppState['settingsOpen']): void;
}

const emptyReview = (): ReviewState => ({ overrides: {}, acknowledged: {}, excluded: {} });
const HISTORY_LIMIT = 50;

const PersistedSchema = z.object({
  settings: ImportSettingsSchema.catch(DEFAULT_SETTINGS),
  dictionary: RubricDictionarySchema.catch({}),
  splitRatio: z.number().min(0.2).max(0.8).catch(0.38),
});

export const useApp = create<AppState>()(
  persist(
    (set, get) => {
      /** Toda alteração de revisão passa por aqui: guarda histórico para desfazer. */
      const commitReview = (next: ReviewState) =>
        set((s) => ({ review: next, history: [...s.history, s.review].slice(-HISTORY_LIMIT), version: s.version + 1 }));

      return {
        settings: DEFAULT_SETTINGS,
        dictionary: DOCUMENTED_RUBRICS,
        splitRatio: 0.38,

        inputText: '',
        sessionCompetencia: currentCompetencia(),
        phase: 'input',
        result: null,
        review: emptyReview(),
        history: [],
        version: 0,
        selection: new Set(),
        sourceFocus: null,
        tab: 'resolver',
        exported: null,
        customTemplate: null,
        settingsOpen: false,

        setInputText: (inputText) => set({ inputText }),
        setSessionCompetencia: (sessionCompetencia) => set((s) => ({ sessionCompetencia, version: s.version + 1 })),

        process: () => {
          const { inputText, sessionCompetencia } = get();
          if (!inputText.trim()) return;
          let result = processText(inputText, sessionCompetencia);
          const detected = detectCompetencia(result.messages);
          if (detected && !sameCompetencia(detected, sessionCompetencia)) result = processText(inputText, detected);
          set((s) => ({
            result,
            phase: 'review',
            sessionCompetencia: detected ?? sessionCompetencia,
            review: { ...emptyReview(), excluded: repeatedMessageExclusions(result) },
            history: [],
            selection: new Set(),
            tab: 'resolver',
            exported: null,
            version: s.version + 1,
          }));
        },
        backToInput: () => set({ phase: 'input' }),
        reset: () =>
          set((s) => ({
            inputText: '',
            result: null,
            phase: 'input',
            review: emptyReview(),
            history: [],
            selection: new Set(),
            exported: null,
            version: s.version + 1,
          })),

        editOverride: (ids, patch) => {
          const { review } = get();
          const overrides = { ...review.overrides };
          for (const id of ids) overrides[id] = { ...overrides[id], ...patch };
          commitReview({ ...review, overrides });
        },
        clearOverride: (ids, field) => {
          const { review } = get();
          const overrides = { ...review.overrides };
          for (const id of ids) {
            const o = { ...overrides[id] };
            delete o[field];
            overrides[id] = o;
          }
          commitReview({ ...review, overrides });
        },
        acknowledge: (ids, codes, available) => {
          const { review } = get();
          const acknowledged = { ...review.acknowledged };
          for (const id of ids) {
            const add = codes === 'all-attention' ? (available.get(id) ?? []) : codes.filter((c) => available.get(id)?.includes(c));
            if (add.length === 0) continue;
            acknowledged[id] = [...new Set([...(acknowledged[id] ?? []), ...add])];
          }
          commitReview({ ...review, acknowledged });
        },
        exclude: (ids, reason, note) => {
          const { review } = get();
          const excluded = { ...review.excluded };
          for (const id of ids) excluded[id] = { reason, note: note ?? null };
          commitReview({ ...review, excluded });
        },
        restore: (ids) => {
          const { review } = get();
          const excluded = { ...review.excluded };
          for (const id of ids) delete excluded[id];
          commitReview({ ...review, excluded });
        },
        undo: () => {
          const { history } = get();
          const prev = history[history.length - 1];
          if (!prev) return;
          set((s) => ({ review: prev, history: history.slice(0, -1), version: s.version + 1 }));
        },

        setRubric: (key, code, label) => set((s) => ({ dictionary: setMapping(s.dictionary, key, code, label), version: s.version + 1 })),
        setRubrics: (entries) =>
          set((s) => ({
            dictionary: entries.reduce((d, e) => setMapping(d, e.key, e.code, e.label), s.dictionary),
            version: s.version + 1,
          })),
        setSettings: (patch) => set((s) => ({ settings: ImportSettingsSchema.parse({ ...s.settings, ...patch }), version: s.version + 1 })),
        replaceConfig: (settings, dictionary) => set((s) => ({ settings, dictionary, version: s.version + 1 })),
        clearStoredConfig: () => set((s) => ({ settings: DEFAULT_SETTINGS, dictionary: DOCUMENTED_RUBRICS, version: s.version + 1 })),
        setSplitRatio: (splitRatio) => set({ splitRatio: Math.min(0.75, Math.max(0.2, splitRatio)) }),

        select: (ids, mode = 'replace') =>
          set((s) => {
            if (mode === 'replace') return { selection: new Set(ids) };
            const next = new Set(s.selection);
            if (mode === 'add') ids.forEach((id) => next.add(id));
            else ids.forEach((id) => (next.has(id) ? next.delete(id) : next.add(id)));
            return { selection: next };
          }),
        focusSource: (start, end) => set({ sourceFocus: { start, end, nonce: Date.now() } }),
        setTab: (tab) => set({ tab, selection: new Set() }),
        setExported: (exported) => set({ exported }),
        setCustomTemplate: (customTemplate) => set((s) => ({ customTemplate, version: s.version + 1 })),
        openSettings: (settingsOpen) => set({ settingsOpen }),
      };
    },
    {
      name: 'tablex.config.v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Somente configuração não sensível. Mensagens e lançamentos nunca são persistidos.
      partialize: (s): PersistedState => ({ settings: s.settings, dictionary: s.dictionary, splitRatio: s.splitRatio }),
      merge: (persisted, current) => ({ ...current, ...PersistedSchema.parse(persisted ?? {}) }),
    },
  ),
);

export const CONFIG_FILE_SCHEMA = z.object({
  app: z.literal('tablex'),
  version: z.literal(1),
  settings: ImportSettingsSchema,
  dictionary: RubricDictionarySchema,
});
