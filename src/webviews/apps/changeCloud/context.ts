import { createContext } from '@lit/context';
import type { State } from '../../changeCloud/protocol';

export const stateContext = createContext<State>('state');

