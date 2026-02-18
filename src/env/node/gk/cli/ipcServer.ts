import type { IncomingMessage, Server, ServerResponse } from 'http';
import { createServer } from 'http';
import type { Disposable } from 'vscode';
import { uuid } from '@env/crypto.js';
import { debug } from '../../../../system/decorators/log.js';
import { Logger } from '../../../../system/logger.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import { createDisposable } from '../../../../system/unifiedDisposable.js';

export interface IpcHandler<Request = unknown, Response = void> {
	(request: Request | undefined): Promise<Response>;
}

export async function createIpcServer<Request = unknown, Response = void>(): Promise<IpcServer<Request, Response>> {
	const server = createServer();
	const token = uuid();

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

				const port = address.port;
				const serverUrl = `http://127.0.0.1:${port}`;
				resolve(new IpcServer(serverUrl, port, token, server));
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
		readonly ipcPort: number,
		readonly ipcToken: string,
		private server: Server,
	) {
		server
			.on('listening', () => {
				Logger.trace(`Cli Integration IPC server listening on ${this.ipcAddress}`);
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

	@debug({ args: false })
	private onRequest(req: IncomingMessage, res: ServerResponse): void {
		const scope = getScopedLogger();

		// Parse URL to extract pathname for routing, separating from query parameters
		let pathname: string | undefined;
		try {
			pathname = new URL(req.url ?? '', this.ipcAddress).pathname;
		} catch {
			pathname = req.url;
		}

		const handler = this.handlers.get(pathname);
		if (handler == null) {
			scope?.warn(`IPC handler for ${pathname} not found`);
			res.writeHead(404);
			res.end();
			return;
		}

		// Add bearer token authorization
		const authHeader = req.headers['authorization'];
		if (authHeader !== `Bearer ${this.ipcToken}`) {
			Logger.warn(scope, `IPC handler for ${req.url} unauthorized`);
			res.writeHead(401);
			res.end();
			return;
		}

		const chunks: Uint8Array[] = [];
		req.on('data', d => chunks.push(d));
		req.on('end', async () => {
			const body = Buffer.concat(chunks).toString('utf8');
			const data = body ? (JSON.parse(body) as Request) : undefined;
			try {
				const result = await handler(data);
				if (result == null) {
					res.writeHead(200);
					res.end();
					return;
				}

				if (typeof result === 'string') {
					res.writeHead(200);
					res.end(result);
				} else {
					res.writeHead(200);
					res.end(JSON.stringify(result));
				}
			} catch (ex) {
				scope?.error(ex, 'IPC handler error', data);
				res.writeHead(500);
				res.end();
			}
		});
	}
}
