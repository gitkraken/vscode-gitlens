import { mkdir, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ppid } from 'process';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { IpcHandler, IpcServer } from './ipcServer.js';
import { createIpcServer } from './ipcServer.js';

export const agentDiscoveryDir = join(tmpdir(), 'gitkraken', 'gitlens', 'agents');

export interface AgentIpcServerOptions {
	workspacePaths: string[];
}

export class AgentIpcServer implements UnifiedDisposable {
	private _server: IpcServer<unknown, unknown> | undefined;
	private _discoveryFilePath: string | undefined;
	private _workspacePaths: string[] = [];

	async start(options: AgentIpcServerOptions): Promise<void> {
		if (this._server != null) return;

		this._workspacePaths = options.workspacePaths;

		try {
			this._server = await createIpcServer<unknown, unknown>();
			await this.writeDiscoveryFile();
			Logger.debug(`AgentIpcServer listening on ${this._server.ipcAddress}`);
		} catch (ex) {
			Logger.error(ex, 'AgentIpcServer.start');
			this._server?.dispose();
			this._server = undefined;
		}
	}

	get port(): number | undefined {
		return this._server?.ipcPort;
	}

	async updateWorkspacePaths(paths: string[]): Promise<void> {
		this._workspacePaths = paths;
		if (this._server == null) return;
		await this.writeDiscoveryFile();
	}

	registerHandler(name: string, handler: IpcHandler<unknown, unknown>): UnifiedDisposable | undefined {
		return this._server?.registerHandler(name, handler);
	}

	dispose(): void {
		this._server?.dispose();
		this._server = undefined;
		void this.cleanupDiscoveryFile();
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	private getDiscoveryFileName(): string {
		return `gitlens-ipc-server-${ppid}-${this._server?.ipcPort ?? 'none'}.json`;
	}

	private async writeDiscoveryFile(): Promise<void> {
		if (this._server == null) return;

		const filePath = join(agentDiscoveryDir, this.getDiscoveryFileName());

		try {
			await mkdir(agentDiscoveryDir, { recursive: true, mode: 0o700 });

			const discoveryData = {
				token: this._server.ipcToken,
				address: this._server.ipcAddress,
				port: this._server.ipcPort,
				workspacePaths: this._workspacePaths,
				createdAt: new Date().toISOString(),
			};

			await writeFile(filePath, JSON.stringify(discoveryData, null, 2), { mode: 0o600 });
			this._discoveryFilePath = filePath;
		} catch (ex) {
			Logger.error(ex, 'AgentIpcServer.writeDiscoveryFile');
		}
	}

	private async cleanupDiscoveryFile(): Promise<void> {
		if (this._discoveryFilePath == null) return;

		try {
			await unlink(this._discoveryFilePath);
		} catch {
			// Ignore cleanup errors
		}
		this._discoveryFilePath = undefined;
	}
}
