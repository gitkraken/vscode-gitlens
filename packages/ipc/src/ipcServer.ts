import type { IncomingMessage, Server, ServerResponse } from 'http';
import { createServer } from 'http';
import { uuid } from '@gitlens/utils/crypto.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';

export interface IpcHandler<Request = unknown, Response = void> {
	(request: Request | undefined, searchParams: URLSearchParams): Promise<Response>;
}

export async function createIpcServer<Request = unknown, Response = void>(): Promise<IpcServer<Request, Response>> {
	const server = createServer();
	const token = uuid();

	return new Promise<IpcServer<Request, Response>>((resolve, reject) => {
		try {
			server.on('error', ex => {
				Logger.error(ex, 'IPC server error');
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

export class IpcServer<Request = unknown, Response = void> implements UnifiedDisposable {
	private readonly handlers = new Map<string | undefined, IpcHandler<Request, Response>>();

	constructor(
		readonly ipcAddress: string,
		readonly ipcPort: number,
		readonly ipcToken: string,
		private server: Server,
	) {
		server
			.on('listening', () => {
				Logger.trace(`IPC server listening on ${this.ipcAddress}`);
			})
			.on('request', this.onRequest.bind(this));
	}

	dispose(): void {
		this.handlers.clear();
		this.server.close();
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	// Awaits server close; use only when deterministic teardown is required (e.g., tests).
	// Production callers should use dispose() — UnifiedDisposable contract is sync.
	shutdown(): Promise<void> {
		this.handlers.clear();
		return new Promise<void>(resolve => {
			this.server.close(() => resolve());
		});
	}

	registerHandler(name: string, handler: IpcHandler<Request, Response>): UnifiedDisposable {
		const path = `/${name}`;
		if (this.handlers.has(path)) {
			throw new Error(`IPC handler '${name}' is already registered`);
		}
		this.handlers.set(path, handler);
		return createDisposable(() => this.handlers.delete(path));
	}

	@debug({ args: false })
	private onRequest(req: IncomingMessage, res: ServerResponse): void {
		const scope = getScopedLogger();

		// Parse URL to extract pathname for routing and query parameters
		let pathname: string | undefined;
		let searchParams = new URLSearchParams();
		try {
			const url = new URL(req.url ?? '', this.ipcAddress);
			pathname = url.pathname;
			searchParams = url.searchParams;
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

		const maxBodySize = 10_485_760; // 10 MB
		let bodySize = 0;
		const chunks: Uint8Array[] = [];
		req.on('data', (d: Uint8Array) => {
			bodySize += d.length;
			if (bodySize > maxBodySize) {
				res.writeHead(413);
				res.end();
				req.destroy();
				return;
			}
			chunks.push(d);
		});
		req.on('end', async () => {
			if (bodySize > maxBodySize) return;

			const body = Buffer.concat(chunks).toString('utf8');

			let data: Request | undefined;
			try {
				data = body ? (JSON.parse(body) as Request) : undefined;
			} catch (ex) {
				scope?.error(ex, 'Invalid JSON in IPC request body', { body: body });
				res.writeHead(400);
				res.end('Invalid JSON');
				return;
			}

			try {
				const result = await handler(data, searchParams);
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
