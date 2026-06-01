import type { Disposable } from 'vscode';

export interface McpHostRegistrationProvider extends Disposable {
	refresh(): void | Promise<void>;
}
