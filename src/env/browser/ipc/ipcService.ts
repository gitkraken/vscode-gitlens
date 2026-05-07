// Browser/webworker stub — IPC server is not available in the web extension host.
// CLI integration and agent providers are no-ops on the web (see env/browser/providers.ts),
// so this stub never has handlers registered or capabilities published.
import type { Disposable } from 'vscode';
import type { IpcHandler } from '@gitlens/ipc/ipcServer.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { Container } from '../../../container.js';

export class IpcService implements Disposable {
	// eslint-disable-next-line @typescript-eslint/no-useless-constructor
	constructor(_container: Container) {}

	dispose(): void {}

	get port(): number | undefined {
		return undefined;
	}

	get address(): string | undefined {
		return undefined;
	}

	get token(): string | undefined {
		return undefined;
	}

	get cliDiscoveryFilePath(): string | undefined {
		return undefined;
	}

	get agentsDiscoveryFilePath(): string | undefined {
		return undefined;
	}

	registerHandler<Request = unknown, Response = unknown>(
		_name: string,
		_handler: IpcHandler<Request, Response>,
	): UnifiedDisposable {
		return createDisposable(() => {});
	}

	publishCli(_info: { ideName?: string; ideDisplayName: string; scheme: string; pid: number }): Promise<void> {
		return Promise.resolve();
	}

	unpublishCli(): Promise<void> {
		return Promise.resolve();
	}

	publishAgents(_workspacePaths: string[]): Promise<void> {
		return Promise.resolve();
	}

	unpublishAgents(): Promise<void> {
		return Promise.resolve();
	}
}

export function getCliPublishInfo(): Promise<{
	ideName?: string;
	ideDisplayName: string;
	scheme: string;
	pid: number;
}> {
	return Promise.reject(new Error('IPC server is not available in the browser extension host'));
}
