import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable } from 'vscode';
import type { Container } from '../../../../container';
import { configuration } from '../../../../system/-webview/configuration';
import { CliCommandHandlers } from './commands';
import type { IpcServer } from './server';
import { createIpcServer } from './server';

export interface CliCommandRequest {
	cwd?: string;
	args?: string[];
}
export type CliCommandResponse = string | void;
export type CliIpcServer = IpcServer<CliCommandRequest, CliCommandResponse>;

export class GkCliIntegrationProvider implements Disposable {
	private readonly _disposable: Disposable;
	private _runningDisposable: Disposable | undefined;

	constructor(private readonly container: Container) {
		this._disposable = configuration.onDidChange(e => this.onConfigurationChanged(e));

		this.onConfigurationChanged();
	}

	dispose(): void {
		this.stop();
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent): void {
		if (e == null || configuration.changed(e, 'gitKraken.cli.integration.enabled')) {
			if (!configuration.get('gitKraken.cli.integration.enabled')) {
				this.stop();
			} else {
				void this.start();
			}
		}
	}

	private async start() {
		const server = await createIpcServer<CliCommandRequest, CliCommandResponse>();

		const { environmentVariableCollection: envVars } = this.container.context;

		envVars.clear();
		envVars.persistent = false;
		envVars.replace('GK_GL_ADDR', server.ipcAddress);
		envVars.description = 'Enables GK CLI integration';

		this._runningDisposable = Disposable.from(new CliCommandHandlers(this.container, server), server);
	}

	private stop() {
		this.container.context.environmentVariableCollection.clear();
		this._runningDisposable?.dispose();
		this._runningDisposable = undefined;
	}
}
