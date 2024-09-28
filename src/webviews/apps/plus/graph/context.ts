import { createContext } from '@lit/context';
import type { State } from '../../graph/protocol';

export const stateContext = createContext<State>('state');
