import { createContext } from '@lit/context';
import type { State } from '../../../plus/composer/protocol';

export const stateContext = createContext<State>('composer-state');
