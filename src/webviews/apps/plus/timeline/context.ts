import { createContext } from '@lit/context';
import type { State } from '../../../plus/timeline/protocol';

export const stateContext = createContext<State>('state');
