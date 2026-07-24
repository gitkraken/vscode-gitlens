import type { Disposable } from 'vscode';

export interface McpHostRegistrationProvider extends Disposable {
	refresh(): void | Promise<void>;
	/** Whether the 30s IPC-wait timeout should still trigger a host refresh. VS Code suppresses it once it
	 *  has pulled a definition (avoids a spurious pull); other hosts return `true`. */
	shouldFireOnTimeout(): boolean;
}
