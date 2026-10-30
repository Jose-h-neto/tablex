import { useApp } from '../state/store';
import { InputView } from './InputView';
import { SheetView } from './SheetView';

export function App() {
  const hasSheet = useApp((s) => s.rows !== null);
  return hasSheet ? <SheetView /> : <InputView />;
}
