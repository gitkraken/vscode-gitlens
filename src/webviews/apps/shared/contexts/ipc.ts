import { createContext } from '@lit/context';
import type { HostIpc } from '../ipc';

export const ipcContext = createContext<HostIpc>('ipc');
