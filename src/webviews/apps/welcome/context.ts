import { createContext } from '@lit/context';
import type { State } from '../../welcome/protocol.js';

export const stateContext = createContext<State>('welcome-state');
