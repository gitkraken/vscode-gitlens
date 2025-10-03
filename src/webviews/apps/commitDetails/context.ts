import { createContext } from '@lit/context';
import type { Serialized } from '../../../system/serialize';
import type { State } from '../../commitDetails/protocol';

export const stateContext = createContext<Serialized<State>>('state');
