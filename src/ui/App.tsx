import { useEffect } from 'react';
import { DerivedProvider, useDerived } from '../state/derived';
import { useApp } from '../state/store';
import { exportImportFile } from './exportActions';
import { InputView } from './InputView';
import { ReviewPanel } from './ReviewPanel';
import { SettingsDrawer } from './SettingsDrawer';
import { SourcePanel } from './SourcePanel';
import { SplitView } from './SplitView';
import { TopBar } from './TopBar';

export function App() {
  return (
    <DerivedProvider>
      <Shell />
    </DerivedProvider>
  );
}

function isTyping(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function Shell() {
  const phase = useApp((s) => s.phase);
  const d = useDerived();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if (s.phase !== 'review' || s.settingsOpen) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey && !isTyping(e.target)) {
        e.preventDefault();
        s.undo();
      } else if (ctrl && e.key.toLowerCase() === 'e' && d) {
        e.preventDefault();
        if (d.config.length === 0 && d.rows.some((r) => r.exportable)) void exportImportFile(d);
      } else if (e.key === 'Escape') {
        s.select([]);
      } else if (e.key === 'Delete' && !isTyping(e.target) && s.selection.size > 0) {
        s.exclude([...s.selection], 'descartado');
        s.select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d]);

  return (
    <div className="flex h-full min-w-[900px] flex-col">
      <TopBar />
      <main className="flex min-h-0 flex-1 flex-col">
        {phase === 'input' || !d ? <InputView /> : <SplitView left={<SourcePanel />} right={<ReviewPanel />} />}
      </main>
      <SettingsDrawer />
    </div>
  );
}
