import { createContext } from '@lit/context';
import type { State } from '../../rebase/protocol.js';

export const stateContext = createContext<State>('state');
