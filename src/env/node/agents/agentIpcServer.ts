import { mkdir, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ppid } from 'process';
import type { Disposable } from 'vscode';
import { Logger } from '../../../system/logger.js';
import type { IpcHandler, IpcServer } from '../gk/cli/ipcServer.js';
import { createIpcServer } from '../gk/cli/ipcServer.js';

export interface AgentIpcServerOptions {
	workspacePaths: string[];
}

export class AgentIpcServer implements Disposable {
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
			this._server = undefined;
		}
	}

	get port(): number | undefined {
		return this._server?.ipcPort;
	}

	registerHandler(name: string, handler: IpcHandler<unknown, unknown>): Disposable | undefined {
		return this._server?.registerHandler(name, handler);
	}

	dispose(): void {
		this._server?.dispose();
		this._server = undefined;
		void this.cleanupDiscoveryFile();
	}

	private getDiscoveryDir(): string {
		return join(tmpdir(), 'gitkraken', 'gitlens', 'agents');
	}

	private getDiscoveryFileName(): string {
		return `gitlens-ipc-server-${ppid}-${this._server?.ipcPort ?? 'none'}.json`;
	}

	private async writeDiscoveryFile(): Promise<void> {
		if (this._server == null) return;

		const discoveryDir = this.getDiscoveryDir();
		const filePath = join(discoveryDir, this.getDiscoveryFileName());

		try {
			await mkdir(discoveryDir, { recursive: true, mode: 0o700 });

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
