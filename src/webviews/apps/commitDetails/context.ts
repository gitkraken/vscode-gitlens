import { createContext } from '@lit/context';
import type { IpcSerialized } from '../../../system/ipcSerialize.js';
import type { State } from '../../commitDetails/protocol.js';

export const stateContext = createContext<IpcSerialized<State>>('state');
