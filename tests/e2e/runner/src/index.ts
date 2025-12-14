/**
 * E2E Test Runner - HTTP Server
 *
 * This runs inside VS Code's Extension Host via --extensionTestsPath.
 * It exposes an HTTP server that allows Playwright tests to execute
 * code with access to the VS Code API.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as process from 'node:process';
import * as vscode from 'vscode';

interface InvokeRequest {
	fn: string;
	params?: unknown[];
}

interface InvokeResponse {
	result?: unknown;
	error?: { message: string; stack?: string };
}

async function handleInvoke(body: InvokeRequest): Promise<InvokeResponse> {
	try {
		// Reconstruct the function from its string representation
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const fn = new Function(`return ${body.fn}`)();
		const result = await fn(vscode, ...(body.params ?? []));
		return { result: result };
	} catch (e) {
		const err = e as Error;
		return {
			error: {
				message: err.message ?? String(e),
				stack: err.stack,
			},
		};
	}
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = '';
		// eslint-disable-next-line @typescript-eslint/restrict-plus-operands
		req.on('data', chunk => (data += chunk));
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
	// CORS headers for local development
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}

	if (req.method === 'POST' && req.url === '/invoke') {
		const body = JSON.parse(await readBody(req)) as InvokeRequest;
		const response = await handleInvoke(body);
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(response));
		return;
	}

	res.writeHead(404);
	res.end('Not Found');
}

export async function run(): Promise<void> {
	const server = createServer((req, res) => {
		handleRequest(req, res).catch((err: unknown) => {
			res.writeHead(500);
			res.end(String(err));
		});
	});

	await new Promise<void>(resolve => server.listen(0, resolve));
	const address = server.address() as AddressInfo;

	// This message is parsed by the Playwright test to get the server URL

	process.stderr.write(`VSCodeTestServer listening on http://localhost:${address.port}\n`);

	// Keep running until process exits (VS Code closes)
	await new Promise<void>(resolve => process.on('exit', resolve));

	server.close();
}
