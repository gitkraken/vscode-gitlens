import { createContext } from '@lit/context';
import type { State } from '../../mergeConflict/protocol.js';

export const stateContext = createContext<State>('state');
