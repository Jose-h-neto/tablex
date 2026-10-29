import { useEffect, useRef } from 'react';
import { useApp } from '../state/store';
import { SAMPLE_TEXT } from '../sample/mensagensAnonimizadas';
import { IconShield } from './Icons';

export function InputView() {
  const text = useApp((s) => s.inputText);
  const hasResult = useApp((s) => s.result !== null);
  const { setInputText, process } = useApp.getState();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const lines = text ? text.split('\n').filter((l) => l.trim()).length : 0;

  const onDrop = (e: React.DragEvent) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    if (!/\.(txt|md)$/i.test(file.name)) return;
    void file.text().then((t) => setInputText(text ? `${text}\n\n${t}` : t));
  };

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-auto p-4">
      <div className="flex w-full max-w-5xl min-h-0 flex-col rounded-md border border-slate-200 bg-white shadow-xs">
        <div className="flex items-baseline justify-between border-b border-slate-200 px-4 py-2.5">
          <div>
            <h1 className="text-[14px] font-semibold text-slate-900">Mensagens do cliente</h1>
            <p className="text-[12px] text-slate-500">
              Cole uma ou várias mensagens de uma vez. Destinatário, competência, seções e funcionários são identificados
              automaticamente.
            </p>
          </div>
          <span className="text-[11px] tabular-nums text-slate-400">{lines} linhas com conteúdo</span>
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setInputText(e.target.value)}
          onDrop={onDrop}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              process();
            }
          }}
          spellCheck={false}
          placeholder={'Carla\nbom dia,\n\nDescontos:\n999 - NOME DO FUNCIONÁRIO - R$ 705,10 - desconto material didático\n…'}
          className="min-h-[360px] flex-1 resize-none px-4 py-3 font-mono text-[12.5px] leading-[1.6] text-slate-800 outline-none placeholder:text-slate-300"
          aria-label="Texto das mensagens"
        />
        <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2">
          <button type="button" className="btn btn-primary" onClick={process} disabled={!text.trim()}>
            Processar <span className="kbd border-slate-600 bg-slate-800 text-slate-300">Ctrl+Enter</span>
          </button>
          {hasResult && (
            <button type="button" className="btn" onClick={() => useApp.setState({ phase: 'review' })}>
              Voltar à conferência sem reprocessar
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setInputText(SAMPLE_TEXT)}>
            Carregar exemplo anonimizado
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setInputText('')} disabled={!text}>
            Limpar
          </button>
          <div className="flex-1" />
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <IconShield className="text-ok" />
            Processamento local. O texto não é salvo nem enviado.
          </span>
        </div>
      </div>
    </div>
  );
}
