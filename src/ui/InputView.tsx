import { useApp } from '../state/store';

/** Só uma caixa de texto e o botão que gera a planilha. */
export function InputView() {
  const text = useApp((s) => s.text);
  const { setText, process } = useApp.getState();

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="flex h-full max-h-[660px] w-full max-w-3xl flex-col gap-4">
        <h1 className="text-[20px] font-semibold tracking-tight">Mensagens do cliente</h1>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              process();
            }
          }}
          spellCheck={false}
          placeholder="Cole aqui uma ou mais mensagens"
          aria-label="Mensagens do cliente"
          className="min-h-0 flex-1 resize-none rounded-xl border border-line bg-surface p-5 text-[14px] leading-relaxed shadow-sm transition-shadow outline-none placeholder:text-ink-faint focus:border-accent focus:ring-3 focus:ring-accent-soft"
        />
        <div className="flex justify-end">
          <button type="button" className="btn-primary" disabled={!text.trim()} onClick={process}>
            Gerar planilha
          </button>
        </div>
      </div>
    </div>
  );
}
