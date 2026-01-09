import { createContext } from '@lit/context';
import type { HostIpc } from '../ipc.js';

export const ipcContext = createContext<HostIpc>('ipc');
