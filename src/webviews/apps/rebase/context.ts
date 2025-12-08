import { createContext } from '@lit/context';
import type { State } from '../../rebase/protocol';

export const stateContext = createContext<State>('state');
