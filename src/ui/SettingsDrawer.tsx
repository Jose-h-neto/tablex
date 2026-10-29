import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ImportSettings } from '../domain/types';
import { categoryUsage, RUBRIC_CODE_RE } from '../engine/RubricMapper';
import { fold } from '../engine/text';
import { TEMPLATE_COLUMNS, TEMPLATE_SHEET } from '../export/template';
import { useDerived } from '../state/derived';
import { CONFIG_FILE_SCHEMA, useApp, type AppState } from '../state/store';
import { IconX } from './Icons';

type Tab = Exclude<AppState['settingsOpen'], false>;

export function SettingsDrawer() {
  const tab = useApp((s) => s.settingsOpen);
  const openSettings = useApp.getState().openSettings;

  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openSettings(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, openSettings]);

  if (!tab) return null;
  const tabs: { key: Tab; label: string }[] = [
    { key: 'importacao', label: 'Importação' },
    { key: 'rubricas', label: 'Dicionário de rubricas' },
    { key: 'modelo', label: 'Modelo e dados' },
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onMouseDown={() => openSettings(false)}>
      <aside
        className="flex h-full w-[620px] max-w-full flex-col border-l border-slate-200 bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Configurações"
      >
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-slate-200 px-4">
          <h2 className="text-[13px] font-semibold text-slate-900">Configurações</h2>
          <nav className="flex gap-0.5" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => openSettings(t.key)}
                className={`h-7 rounded px-2.5 text-[12px] ${tab === t.key ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="flex-1" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openSettings(false)} aria-label="Fechar">
            <IconX />
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto p-4">
          {tab === 'importacao' && <ImportTab />}
          {tab === 'rubricas' && <RubricTab />}
          {tab === 'modelo' && <TemplateTab />}
        </div>
      </aside>
    </div>
  );
}

function Pending({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="rounded bg-ok-bg px-1.5 text-[10.5px] font-medium text-ok">definido</span>
  ) : (
    <span className="rounded bg-block-bg px-1.5 text-[10.5px] font-medium text-block">pendente</span>
  );
}

function Row({ title, ok, hint, children }: { title: string; ok?: boolean; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-4 border-b border-slate-100 py-3">
      <div>
        <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-800">
          {title} {ok !== undefined && <Pending ok={ok} />}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</p>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function ImportTab() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp.getState().setSettings;
  const [sim, setSim] = useState(settings.fixarSim);
  const [nao, setNao] = useState(settings.fixarNao);

  const radio = <K extends keyof ImportSettings>(key: K, value: ImportSettings[K], label: string) => (
    <label className="flex items-center gap-2 text-[12px] text-slate-700">
      <input type="radio" checked={settings[key] === value} onChange={() => setSettings({ [key]: value } as Partial<ImportSettings>)} />
      {label}
    </label>
  );

  return (
    <div>
      <p className="mb-2 rounded border border-warn/30 bg-warn-bg px-3 py-2 text-[12px] leading-snug text-slate-700">
        Os padrões abaixo seguem a planilha real preenchida (09/2026). O que nenhum exemplo documenta — código da empresa,
        valor para “fixo” e formato de horas — <b>não foi presumido</b>: enquanto estiver pendente e for necessário, a
        exportação fica bloqueada.
      </p>

      <Row title="Código da empresa" ok={!!settings.companyCode.trim()} hint="Coluna A. Mesmo valor para todas as linhas.">
        <input
          className="field w-40 font-mono"
          value={settings.companyCode}
          onChange={(e) => setSettings({ companyCode: e.target.value.trim() })}
          placeholder="ex.: 15"
        />
      </Row>

      <Row title="Data do movimento" ok={!!settings.movementDateRule} hint="Coluna E. A planilha real usa o 1º dia da competência. Pode ser ajustada por lançamento na tabela.">
        {radio('movementDateRule', 'inicio', '1º dia da competência (ex.: 01/10/2026)')}
        {radio('movementDateRule', 'fim', 'Último dia da competência (ex.: 31/10/2026)')}
      </Row>

      <Row
        title="Fixar valor?"
        ok={!!settings.fixarSim.trim()}
        hint="Coluna F. Na planilha real fica vazia para lançamentos não fixos. Nenhum exemplo mostra o valor usado para “fixo”: exigido só se houver lançamento fixo a exportar."
      >
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
            Fixo
            <input
              className="field w-16 font-mono"
              value={sim}
              maxLength={10}
              onChange={(e) => setSim(e.target.value)}
              onBlur={() => setSettings({ fixarSim: sim.trim() })}
              placeholder="?"
              aria-label="Valor para lançamento fixo"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
            Não fixo
            <input
              className="field w-20 font-mono"
              value={nao}
              maxLength={10}
              onChange={(e) => setNao(e.target.value)}
              onBlur={() => setSettings({ fixarNao: nao.trim() })}
              placeholder="vazio"
              aria-label="Valor para lançamento não fixo"
            />
          </label>
        </div>
        <span className="text-[11px] text-slate-500">
          Em uso: fixo = {settings.fixarSim ? `“${settings.fixarSim}”` : <b className="text-block">não definido</b>}, não fixo ={' '}
          {settings.fixarNao ? `“${settings.fixarNao}”` : 'célula vazia (como na planilha real)'}.
        </span>
      </Row>

      <Row title="Observação" hint="Coluna G. Na planilha real fica vazia. Ative para gravar a descrição gerada (tipo, datas e meses de referência).">
        <label className="flex items-center gap-2 text-[12px] text-slate-700">
          <input type="checkbox" checked={settings.fillObservation} onChange={(e) => setSettings({ fillObservation: e.target.checked })} />
          Preencher a observação na exportação
        </label>
      </Row>

      <Row title="Formato das horas" ok={!!settings.hourFormat} hint="Como gravar 4h45 na coluna D. Exigido apenas se houver lançamentos em horas.">
        {radio('hourFormat', 'decimal', 'Decimal — 4h45 = 4,75')}
        {radio('hourFormat', 'sexagesimal', 'Horas.minutos — 4h45 = 4,45')}
      </Row>

      <Row title="Consolidar linhas" hint="Soma lançamentos com mesma matrícula, rubrica, data e “fixar” (ex.: vários intervalos de hora extra).">
        <label className="flex items-center gap-2 text-[12px] text-slate-700">
          <input type="checkbox" checked={settings.consolidate} onChange={(e) => setSettings({ consolidate: e.target.checked })} />
          Consolidar na exportação
        </label>
      </Row>
    </div>
  );
}

function RubricTab() {
  const d = useDerived();
  const dictionary = useApp((s) => s.dictionary);
  const { setRubric, replaceConfig } = useApp.getState();
  const settings = useApp((s) => s.settings);
  const [q, setQ] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const usage = useMemo(() => categoryUsage(d?.result.movements ?? [], dictionary), [d, dictionary]);
  const list = usage.filter((u) => !q || fold(`${u.label} ${u.key} ${u.code ?? ''}`).includes(fold(q)));

  const save = (key: string, label: string) => {
    const v = (drafts[key] ?? '').trim();
    if (v && !RUBRIC_CODE_RE.test(v)) return;
    setRubric(key, v, label);
    setDrafts((p) => {
      const n = { ...p };
      delete n[key];
      return n;
    });
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify({ app: 'tablex', version: 1, settings, dictionary }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tablex-configuracao.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const importConfig = async (file: File) => {
    try {
      const parsed = CONFIG_FILE_SCHEMA.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error('Arquivo de configuração inválido.');
      replaceConfig(parsed.data.settings, parsed.data.dictionary);
      setMsg(`Configuração importada: ${Object.keys(parsed.data.dictionary).length} rubrica(s).`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div>
      <p className="mb-3 text-[12px] leading-snug text-slate-600">
        Cada tipo de movimentação reconhecido é associado a um código oficial. O código vale para todos os lançamentos
        equivalentes e fica salvo neste navegador. Códigos citados na própria mensagem (ex.: <span className="font-mono">1005</span>)
        são usados diretamente e não aparecem aqui.
      </p>
      <div className="mb-2 flex items-center gap-2">
        <input className="field w-64" placeholder="Filtrar tipos…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex-1" />
        <button type="button" className="btn btn-sm" onClick={exportConfig}>
          Exportar configuração
        </button>
        <label className="btn btn-sm cursor-pointer">
          Importar…
          <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && void importConfig(e.target.files[0])} />
        </label>
      </div>
      {msg && <div className="mb-2 text-[11px] text-slate-600">{msg}</div>}
      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <thead className="text-left text-[11px] text-slate-500">
          <tr>
            <th className="border-b border-slate-200 py-1 font-semibold">Tipo de movimentação</th>
            <th className="w-16 border-b border-slate-200 py-1 text-right font-semibold">Nesta sessão</th>
            <th className="w-32 border-b border-slate-200 py-1 pl-3 font-semibold">Código</th>
          </tr>
        </thead>
        <tbody>
          {list.map((u) => {
            const draft = drafts[u.key];
            const value = draft ?? u.code ?? '';
            const bad = value.trim() !== '' && !RUBRIC_CODE_RE.test(value.trim());
            return (
              <tr key={u.key} className="hover:bg-slate-50">
                <td className="border-b border-slate-100 py-1 pr-2">
                  <div className="text-slate-800">{u.label}</div>
                  <div className="font-mono text-[10px] text-slate-400">{u.key}</div>
                </td>
                <td className="border-b border-slate-100 py-1 text-right tabular-nums text-slate-500">{u.count || '—'}</td>
                <td className="border-b border-slate-100 py-1 pl-3">
                  <input
                    className={`field h-6 w-28 font-mono ${bad ? 'border-block bg-block-bg' : !u.code && !draft ? 'border-dashed' : ''}`}
                    value={value}
                    placeholder="não definido"
                    onChange={(e) => setDrafts((p) => ({ ...p, [u.key]: e.target.value }))}
                    onBlur={() => draft !== undefined && save(u.key, u.label)}
                    onKeyDown={(e) => e.key === 'Enter' && save(u.key, u.label)}
                    aria-label={`Código para ${u.label}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {list.length === 0 && <div className="py-6 text-center text-[12px] text-slate-500">Processe mensagens para listar os tipos encontrados.</div>}
    </div>
  );
}

function TemplateTab() {
  const { customTemplate, dictionaryCount } = useApp(
    useShallow((s) => ({ customTemplate: s.customTemplate, dictionaryCount: Object.keys(s.dictionary).length })),
  );
  const { setCustomTemplate, clearStoredConfig } = useApp.getState();
  const [errors, setErrors] = useState<string[]>([]);

  const load = async (file: File) => {
    const buf = await file.arrayBuffer();
    const { validateTemplate } = await import('../export/ExcelExporter');
    const check = await validateTemplate(buf);
    setErrors(check.errors);
    if (check.ok) setCustomTemplate({ name: file.name, buffer: buf });
  };

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1 text-[12px] font-semibold text-slate-800">Modelo de importação em uso</h3>
        <p className="mb-2 text-[12px] text-slate-600">
          {customTemplate ? (
            <>
              Arquivo carregado: <b>{customTemplate.name}</b> (somente nesta sessão).
            </>
          ) : (
            <>Modelo oficial embutido (movimento_variavel_imp.xlsx).</>
          )}{' '}
          A exportação preenche a aba <span className="font-mono">{TEMPLATE_SHEET}</span> a partir da linha 2, preservando
          cabeçalho, ordem das colunas e formatação.
        </p>
        <ol className="mb-3 grid grid-cols-2 gap-x-4 gap-y-0.5 rounded border border-slate-200 bg-slate-50 p-2.5 text-[11.5px] text-slate-700">
          {TEMPLATE_COLUMNS.map((c, i) => (
            <li key={c} className="flex gap-2">
              <span className="w-4 font-mono text-slate-400">{String.fromCharCode(65 + i)}</span>
              {c}
              {i >= 7 && <span className="text-slate-400">(não utilizado)</span>}
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-2">
          <label className="btn btn-sm cursor-pointer">
            Usar outro modelo (.xlsx)…
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])}
            />
          </label>
          {customTemplate && (
            <button type="button" className="btn btn-sm" onClick={() => setCustomTemplate(null)}>
              Voltar ao modelo embutido
            </button>
          )}
        </div>
        {errors.length > 0 && (
          <div className="mt-2 rounded border border-block/30 bg-block-bg p-2 text-[11.5px] text-block">
            <div className="font-semibold">Modelo rejeitado — estrutura diferente da oficial:</div>
            {errors.map((e) => (
              <div key={e}>• {e}</div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-[12px] font-semibold text-slate-800">Dados armazenados</h3>
        <p className="mb-2 text-[12px] leading-snug text-slate-600">
          Este navegador guarda apenas a configuração (código da empresa, regras de preenchimento e {dictionaryCount} código(s) de
          rubrica). Mensagens, nomes, matrículas e valores ficam somente na memória e são descartados ao fechar a aba.
        </p>
        <button
          type="button"
          className="btn btn-sm"
          onClick={clearStoredConfig}
        >
          Apagar configuração salva
        </button>
      </section>
    </div>
  );
}
