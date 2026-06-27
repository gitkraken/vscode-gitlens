import { createContext } from '@lit/context';
import type { State } from '../../styleguide/protocol.js';

export const stateContext = createContext<State>('styleguide-state');
