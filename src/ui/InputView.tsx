import { useEffect, useRef } from 'react';
import { SAMPLE_TEXT } from '../sample/mensagensAnonimizadas';
import { useApp } from '../state/store';

/** Só uma caixa de texto: colar já processa. */
export function InputView() {
  const text = useApp((s) => s.inputText);
  const hasResult = useApp((s) => s.result !== null);
  const { setInputText } = useApp.getState();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const run = () => {
    const s = useApp.getState();
    if (s.history.length > 0 && !window.confirm('Processar de novo descarta as alterações feitas na conferência. Continuar?')) return;
    s.process();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10">
      <div className="flex h-full max-h-[640px] w-full max-w-3xl flex-col gap-3">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setInputText(e.target.value)}
          onPaste={(e) => {
            if (text.trim()) return;
            const pasted = e.clipboardData.getData('text');
            if (!pasted.trim()) return;
            e.preventDefault();
            setInputText(pasted);
            run();
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              run();
            }
          }}
          spellCheck={false}
          placeholder="Cole aqui as mensagens do cliente"
          aria-label="Mensagens do cliente"
          className="min-h-0 flex-1 resize-none rounded-lg border border-slate-200 bg-white p-5 text-[14px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400"
        />
        <div className="flex h-9 items-center justify-between">
          <div className="flex gap-4 text-[12px] text-slate-400">
            {!text.trim() && (
              <button
                type="button"
                className="hover:text-slate-700"
                onClick={() => {
                  setInputText(SAMPLE_TEXT);
                  run();
                }}
              >
                Ver um exemplo
              </button>
            )}
            {hasResult && (
              <button type="button" className="hover:text-slate-700" onClick={() => useApp.setState({ phase: 'review' })}>
                Voltar à conferência
              </button>
            )}
          </div>
          {text.trim() && (
            <button type="button" className="btn btn-primary h-9 px-5 text-[13px]" onClick={run}>
              Processar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
