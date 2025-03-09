import { createContext } from '@lit/context';
import type { State } from '../../../plus/graph/protocol';

export const stateContext = createContext<State>('state');
