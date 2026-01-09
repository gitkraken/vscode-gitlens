import { createContext } from '@lit/context';
import type { State } from '../../home/protocol.js';

export const stateContext = createContext<State>('state');
