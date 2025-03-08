import type { IncomingMessage, Server, ServerResponse } from 'http';
import { createServer } from 'http';
import type { Disposable } from 'vscode';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { createDisposable } from '../../../../system/unifiedDisposable';

export interface IpcHandler<Request = unknown, Response = void> {
	(request: Request): Promise<Response>;
}

export async function createIpcServer<Request = unknown, Response = void>(): Promise<IpcServer<Request, Response>> {
	const server = createServer();

	return new Promise<IpcServer<Request, Response>>((resolve, reject) => {
		try {
			server.on('error', ex => {
				debugger;
				Logger.error(ex, 'Cli Integration IPC server error');
				reject(ex);
			});

			// Let the OS assign an available port by listening on port 0
			server.listen(0, '127.0.0.1', () => {
				const address = server.address();
				if (address == null || typeof address === 'string') {
					reject(new Error('Failed to get server address'));
					return;
				}

				const serverUrl = `http://127.0.0.1:${address.port}`;
				resolve(new IpcServer(serverUrl, server));
			});
		} catch (ex) {
			// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
			reject(ex);
		}
	});
}

export class IpcServer<Request = unknown, Response = void> implements Disposable {
	private readonly handlers = new Map<string | undefined, IpcHandler<Request, Response>>();

	constructor(
		readonly ipcAddress: string,
		private server: Server,
	) {
		server
			.on('listening', () => {
				Logger.debug(`Cli Integration IPC server listening on ${this.ipcAddress}`);
			})
			.on('request', this.onRequest.bind(this));
	}

	dispose(): void {
		this.handlers.clear();
		this.server.close();
	}

	registerHandler(name: string, handler: IpcHandler<Request, Response>): Disposable {
		this.handlers.set(`/${name}`, handler);
		return createDisposable(() => this.handlers.delete(`/${name}`));
	}

	@log({ args: false })
	private onRequest(req: IncomingMessage, res: ServerResponse): void {
		const scope = getLogScope();

		const handler = this.handlers.get(req.url);
		if (handler == null) {
			Logger.warn(scope, `IPC handler for ${req.url} not found`);
			res.writeHead(404);
			res.end();
			return;
		}

		const chunks: Uint8Array[] = [];
		req.on('data', d => chunks.push(d));
		req.on('end', async () => {
			const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			try {
				const result = await handler(data);
				res.writeHead(200);
				if (result != null && typeof result === 'string') {
					res.end(result);
				} else {
					res.end();
				}
			} catch (ex) {
				Logger.error(ex, 'IPC handler error', data);
				res.writeHead(500);
				res.end();
			}
		});
	}
}
