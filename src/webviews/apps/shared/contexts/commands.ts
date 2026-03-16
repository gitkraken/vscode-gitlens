import { createContext } from '@lit/context';

/** Structural interface for the commands service — not coupled to a specific RPC type. */
export interface CommandsService {
	executeScoped(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface CommandsState {
	service: CommandsService | undefined;
}

export const commandsContext = createContext<CommandsState>('commands');
