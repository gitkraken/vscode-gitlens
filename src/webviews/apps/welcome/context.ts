import { createContext } from '@lit/context';
import type { State } from '../../welcome/protocol';

export const stateContext = createContext<State>('state');
