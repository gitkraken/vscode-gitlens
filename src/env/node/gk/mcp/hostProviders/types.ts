import type { Disposable } from 'vscode';

export type McpHostId = 'vscode' | 'cursor';

export interface McpHostRegistrationProvider extends Disposable {
	readonly id: McpHostId;
	refresh(): void | Promise<void>;
}
