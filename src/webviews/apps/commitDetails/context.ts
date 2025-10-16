import { createContext } from '@lit/context';
import type { IpcSerialized } from '../../../system/ipcSerialize';
import type { State } from '../../commitDetails/protocol';

export const stateContext = createContext<IpcSerialized<State>>('state');
