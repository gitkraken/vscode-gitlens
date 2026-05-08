import { ppid } from 'process';
import type { Disposable } from 'vscode';
import { env, workspace } from 'vscode';
import {
	agentDiscoveryDir,
	cleanupDiscoveryFile,
	cliDiscoveryDir,
	writeDiscoveryFile,
} from '@gitlens/ipc/discovery.js';
import type { IpcHandler, IpcServer } from '@gitlens/ipc/ipcServer.js';
import { createIpcServer } from '@gitlens/ipc/ipcServer.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatLoggableScopeBlock } from '@gitlens/utils/logger.scoped.js';
import type { Container } from '../../../container.js';
import { getHostAppName } from '../../../system/-webview/vscode.js';

interface CliPublishInfo {
	ideName?: string;
	ideDisplayName: string;
	scheme: string;
	pid: number;
}

/**
 * Owns the single HTTP IPC server for the extension host. CLI and agent capabilities
 * register their handlers here and publish their own discovery file. Both capabilities
 * share the same server (one port, one token); the discovery files live in distinct
 * directories so out-of-process readers (older `gk` binaries; peer GitLens windows)
 * keep working unchanged.
 */
export class IpcService implements Disposable {
	readonly agentDiscoveryDir = agentDiscoveryDir;

	private _server: IpcServer<unknown, unknown> | undefined;
	private _serverPromise: Promise<IpcServer<unknown, unknown> | undefined> | undefined;

	private _cliPublished = false;
	private _cliInfo: CliPublishInfo | undefined;
	private _cliDiscoveryFilePath: string | undefined;
	// Serializes CLI publish/unpublish/refresh so a late `unlink` from teardown
	// can't clobber a newly-written discovery file (port is stable).
	private _cliQueue: Promise<unknown> = Promise.resolve();

	private _agentsDiscoveryFilePath: string | undefined;
	private _agentsWorkspacePaths: string[] = [];
	private _agentsQueue: Promise<unknown> = Promise.resolve();

	private readonly _disposable: Disposable;

	constructor(private readonly container: Container) {
		this._disposable = workspace.onDidChangeWorkspaceFolders(() => void this.refreshDiscoveryFiles());
	}

	dispose(): void {
		this._disposable.dispose();
		// Best-effort sync cleanup (UnifiedDisposable.dispose is sync by contract).
		void cleanupDiscoveryFile(this._cliDiscoveryFilePath);
		void cleanupDiscoveryFile(this._agentsDiscoveryFilePath);
		this._cliDiscoveryFilePath = undefined;
		this._agentsDiscoveryFilePath = undefined;
		this._cliPublished = false;
		this._agentsWorkspacePaths = [];
		this._server?.dispose();
		this._server = undefined;
		this._serverPromise = undefined;
	}

	get port(): number | undefined {
		return this._server?.ipcPort;
	}

	get address(): string | undefined {
		return this._server?.ipcAddress;
	}

	get token(): string | undefined {
		return this._server?.ipcToken;
	}

	get cliDiscoveryFilePath(): string | undefined {
		return this._cliDiscoveryFilePath;
	}

	get agentsDiscoveryFilePath(): string | undefined {
		return this._agentsDiscoveryFilePath;
	}

	/**
	 * Registers a handler under `/{name}`. Returns a disposable immediately; the
	 * registration completes asynchronously once the server is running. Disposing
	 * before the server starts cancels the pending registration.
	 */
	registerHandler<Request = unknown, Response = unknown>(
		name: string,
		handler: IpcHandler<Request, Response>,
	): UnifiedDisposable {
		let inner: UnifiedDisposable | undefined;
		let disposed = false;

		void this.ensureServer().then(server => {
			if (disposed || server == null) return;
			try {
				// Cast through unknown — the underlying server uses unknown/unknown but each
				// handler typically narrows its own request/response shape.
				inner = server.registerHandler(name, handler as unknown as IpcHandler<unknown, unknown>);
			} catch (ex) {
				// e.g., a duplicate handler name from a partial start retry.
				Logger.error(ex, `${formatLoggableScopeBlock('IPC')} Failed to register handler '${name}'`);
			}
		});

		return createDisposable(() => {
			disposed = true;
			inner?.dispose();
			inner = undefined;
		});
	}

	/**
	 * Publish the CLI discovery file (read by `gk` binaries and `@gitkraken/core-gitlens`
	 * consumers). The `gk:cli:ipc:started` event is fired by the caller so consumers are
	 * notified even when the discovery-file write fails (server is still up).
	 */
	publishCli(info: CliPublishInfo): Promise<void> {
		return this.enqueueCli(async () => {
			const server = await this.ensureServer();
			if (server == null) return;

			this._cliPublished = true;
			this._cliInfo = info;
			this._cliDiscoveryFilePath = await this.writeCliDiscoveryFile(server, info);

			Logger.info(`${formatLoggableScopeBlock('IPC')} CLI capability published on ${server.ipcAddress}`);
		});
	}

	unpublishCli(): Promise<void> {
		return this.enqueueCli(async () => {
			this._cliPublished = false;
			this._cliInfo = undefined;
			const filePath = this._cliDiscoveryFilePath;
			this._cliDiscoveryFilePath = undefined;
			await cleanupDiscoveryFile(filePath);
		});
	}

	/**
	 * Publish the agents discovery file (read by peer GitLens windows looking for
	 * sibling agent sessions). The agents package owns workspacePaths and re-publishes
	 * when its paths change.
	 */
	publishAgents(workspacePaths: string[]): Promise<void> {
		return this.enqueueAgents(async () => {
			const server = await this.ensureServer();
			if (server == null) return;

			this._agentsWorkspacePaths = workspacePaths;
			this._agentsDiscoveryFilePath = await this.writeAgentsDiscoveryFile(server);
		});
	}

	unpublishAgents(): Promise<void> {
		return this.enqueueAgents(async () => {
			this._agentsWorkspacePaths = [];
			const filePath = this._agentsDiscoveryFilePath;
			this._agentsDiscoveryFilePath = undefined;
			await cleanupDiscoveryFile(filePath);
		});
	}

	private enqueueCli<T>(op: () => Promise<T>): Promise<T> {
		const next = this._cliQueue.then(op, op);
		this._cliQueue = next.catch(() => undefined);
		return next;
	}

	private enqueueAgents<T>(op: () => Promise<T>): Promise<T> {
		const next = this._agentsQueue.then(op, op);
		this._agentsQueue = next.catch(() => undefined);
		return next;
	}

	private ensureServer(): Promise<IpcServer<unknown, unknown> | undefined> {
		if (this._server != null) return Promise.resolve(this._server);
		this._serverPromise ??= createIpcServer<unknown, unknown>().then(
			server => {
				this._server = server;
				return server;
			},
			(ex: unknown) => {
				Logger.error(ex, `${formatLoggableScopeBlock('IPC')} Failed to start IPC server`);
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent('cli/ipc/failed', {
						'error.message': ex instanceof Error ? ex.message : 'Unknown error',
					});
				}
				this._serverPromise = undefined;
				return undefined;
			},
		);
		return this._serverPromise;
	}

	private refreshDiscoveryFiles(): Promise<void> {
		// Only the CLI discovery file is refreshed here; the agents discovery file is
		// owned by the agents package, which re-calls `publishAgents` whenever its
		// workspacePaths change.
		return this.enqueueCli(async () => {
			const server = this._server;
			if (server == null) return;
			if (!this._cliPublished || this._cliInfo == null) return;

			try {
				this._cliDiscoveryFilePath = await this.writeCliDiscoveryFile(server, this._cliInfo);
			} catch (ex) {
				Logger.warn(`${formatLoggableScopeBlock('IPC')} Failed to refresh CLI discovery file: ${ex}`);
			}
		});
	}

	private writeCliDiscoveryFile(server: IpcServer<unknown, unknown>, info: CliPublishInfo): Promise<string> {
		return writeDiscoveryFile(cliDiscoveryDir, {
			token: server.ipcToken,
			address: server.ipcAddress,
			port: server.ipcPort,
			workspacePaths: getWorkspacePaths(),
			ideName: info.ideName,
			ideDisplayName: info.ideDisplayName,
			scheme: info.scheme,
			pid: info.pid,
			createdAt: new Date().toISOString(),
		});
	}

	private writeAgentsDiscoveryFile(server: IpcServer<unknown, unknown>): Promise<string> {
		return writeDiscoveryFile(agentDiscoveryDir, {
			token: server.ipcToken,
			address: server.ipcAddress,
			port: server.ipcPort,
			workspacePaths: this._agentsWorkspacePaths,
			createdAt: new Date().toISOString(),
		});
	}
}

function getWorkspacePaths(): string[] {
	return workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
}

/** Build the host-derived CLI publish info from VS Code APIs. */
export async function getCliPublishInfo(): Promise<CliPublishInfo> {
	return {
		ideName: await getHostAppName(),
		ideDisplayName: env.appName,
		scheme: env.uriScheme,
		pid: ppid,
	};
}
