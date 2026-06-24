import { createContext } from '@lit/context';
import type { State } from '../../allowedSigners/protocol.js';

export const stateContext = createContext<State>('allowedSigners-state');
