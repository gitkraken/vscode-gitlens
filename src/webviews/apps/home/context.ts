import { createContext } from '@lit/context';
import type { State } from '../../home/protocol';

export const stateContext = createContext<State>('state');
