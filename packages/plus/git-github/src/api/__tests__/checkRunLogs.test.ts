import assert from 'node:assert';
import { suite, test } from 'mocha';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubCheckRunRef } from '../../models.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';

suite('GitHubApi check run logs', () => {
	const provider = {
		id: 'github',
		name: 'GitHub',
		domain: 'github.com',
		icon: 'github',
		getIgnoreSSLErrors: () => false,
		reauthenticate: () => Promise.resolve(),
		trackRequestException: () => {},
	} as unknown as Provider;

	const token: GitHubTokenInfo = {
		providerId: 'github',
		accessToken: 'token',
		microHash: 'hash',
		cloud: true,
		type: undefined,
	};

	const storage = 'https://storage.example/job.log?sig=1';
	const encoder = new TextEncoder();
	const tailBytes = 256 * 1024;

	type Request = {
		url: string;
		range: string | null;
		authorization: string | null;
		redirect: string | undefined;
		body: string | undefined;
	};

	function serve(answer: (request: Request) => Response, isWeb = false): { api: GitHubApi; requests: Request[] } {
		const requests: Request[] = [];
		const config = {
			isWeb: isWeb,
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
			fetch: async (
				url: unknown,
				init?: { headers?: Record<string, string>; redirect?: string; body?: string },
			) => {
				const headers = new Headers(init?.headers);
				const request: Request = {
					url: String(url),
					range: headers.get('range'),
					authorization: headers.get('authorization'),
					redirect: init?.redirect,
					body: init?.body,
				};
				requests.push(request);
				return answer(request);
			},
		} as unknown as GitHubApiConfig;
		return { api: new GitHubApi(config), requests: requests };
	}

	function json(status: number, body: unknown): Response {
		return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
	}

	function redirect(): Response {
		return new Response(null, { status: 302, headers: { location: storage } });
	}

	function ranged(bytes: Uint8Array, range: string | null): Response {
		const match = /^bytes=(\d+)-(\d*)$/.exec(range ?? '');
		assert.ok(match != null, `unexpected range ${range}`);
		const start = Number(match[1]);
		const end = match[2] ? Number(match[2]) : bytes.byteLength - 1;
		return new Response(bytes.slice(start, end + 1), {
			status: 206,
			headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
		});
	}

	function job(jobId: number): { owner: string; repo: string; ref: GitHubCheckRunRef } {
		return { owner: 'o', repo: 'a', ref: { kind: 'actions-job', jobId: jobId } };
	}

	function numberedLines(count: number, eol: string): string {
		return Array.from({ length: count }, (_, i) => `line ${String(i + 1).padStart(6, '0')}`).join(eol) + eol;
	}

	test('reads an Actions log through the API redirect and two ranged storage requests, without the token, keeping whole tail lines', async () => {
		const big = encoder.encode(numberedLines(30000, '\r\n'));
		const small = encoder.encode(`﻿first\r\nsecond\nthird\n`);
		let blob = big;
		const { api, requests } = serve(request =>
			request.url.startsWith('https://api.github.com/') ? redirect() : ranged(blob, request.range),
		);

		const [slot] = await api.getCheckRunLogs(provider, token, [job(7)], { tailLines: 3 });

		assert.deepStrictEqual(
			requests.map(r => ({ url: r.url, range: r.range, redirect: r.redirect, auth: r.authorization != null })),
			[
				{
					url: 'https://api.github.com/repos/o/a/actions/jobs/7/logs',
					range: null,
					redirect: 'manual',
					auth: true,
				},
				{ url: storage, range: 'bytes=0-0', redirect: undefined, auth: false },
				{
					url: storage,
					range: `bytes=${big.byteLength - tailBytes}-`,
					redirect: undefined,
					auth: false,
				},
			],
		);
		assert.deepStrictEqual(slot, {
			status: 'fulfilled',
			value: {
				log: {
					text: 'line 029998\nline 029999\nline 030000',
					lineCount: 3,
					truncated: true,
					source: 'actions-job-log',
				},
			},
		});

		requests.length = 0;
		blob = small;
		const [whole] = await api.getCheckRunLogs(provider, token, [job(8)], { tailLines: 3 });
		assert.strictEqual(requests[2].range, 'bytes=0-');
		assert.deepStrictEqual(whole, {
			status: 'fulfilled',
			value: { log: { text: 'first\nsecond\nthird', lineCount: 3, truncated: false, source: 'actions-job-log' } },
		});
	});

	test('keeps only the tail of a log storage or a web host serves whole', async () => {
		const blob = encoder.encode(numberedLines(40000, '\n'));
		const expected = {
			status: 'fulfilled',
			value: {
				log: { text: 'line 039999\nline 040000', lineCount: 2, truncated: true, source: 'actions-job-log' },
			},
		};

		const node = serve(request =>
			request.url.startsWith('https://api.github.com/') ? redirect() : new Response(blob, { status: 200 }),
		);
		assert.deepStrictEqual(await node.api.getCheckRunLogs(provider, token, [job(7)], { tailLines: 2 }), [expected]);
		assert.deepStrictEqual(
			node.requests.map(r => r.range),
			[null, 'bytes=0-0'],
			'a probe answered whole needs no second request',
		);

		const web = serve(() => new Response(blob, { status: 200 }), true);
		assert.deepStrictEqual(await web.api.getCheckRunLogs(provider, token, [job(7)], { tailLines: 2 }), [expected]);
		assert.strictEqual(web.requests.length, 1);
		assert.notStrictEqual(web.requests[0].redirect, 'manual');
	});

	test('reads an empty log served whole as no log, like an empty ranged one', async () => {
		const node = serve(request =>
			request.url.startsWith('https://api.github.com/')
				? redirect()
				: new Response(new Uint8Array(0), { status: 200 }),
		);
		const web = serve(() => new Response(new Uint8Array(0), { status: 200 }), true);

		for (const { api } of [node, web]) {
			assert.deepStrictEqual(await api.getCheckRunLogs(provider, token, [job(7)], { tailLines: 2 }), [
				{ status: 'fulfilled', value: { unavailable: 'no-log' } },
			]);
		}
	});

	function endless(): ReadableStream<Uint8Array> {
		const chunk = new Uint8Array(1024 * 1024).fill(0x61);
		return new ReadableStream<Uint8Array>({
			pull: controller => {
				controller.enqueue(chunk);
			},
		});
	}

	test('reads a log a web host serves whole past 20 MiB as too large, rather than reading its middle as its tail', async () => {
		const web = serve(() => new Response(endless(), { status: 200 }), true);

		assert.deepStrictEqual(await web.api.getCheckRunLogs(provider, token, [job(7)], { tailLines: 2 }), [
			{ status: 'fulfilled', value: { unavailable: 'log-too-large' } },
		]);
		assert.strictEqual(web.requests.length, 1);
	});

	test('reads a log storage serves whole past 20 MiB, instead of the range asked for, as too large', async () => {
		const node = serve(request =>
			request.url.startsWith('https://api.github.com/') ? redirect() : new Response(endless(), { status: 200 }),
		);

		assert.deepStrictEqual(await node.api.getCheckRunLogs(provider, token, [job(7)], { tailLines: 2 }), [
			{ status: 'fulfilled', value: { unavailable: 'log-too-large' } },
		]);
		assert.deepStrictEqual(
			node.requests.map(r => r.range),
			[null, 'bytes=0-0'],
		);
	});

	test('reads a missing log as unavailable, asking for the job only when the API has none, and reads nothing for a status', async () => {
		const jobs: Record<string, string> = { '/jobs/2': 'in_progress', '/jobs/3': 'completed' };
		const { api, requests } = serve(request => {
			if (request.url === storage) return new Response('BlobNotFound', { status: 404 });
			if (request.url.endsWith('/jobs/1/logs')) return redirect();

			const status = Object.entries(jobs).find(([path]) => request.url.endsWith(path))?.[1];
			if (request.url.endsWith('/logs') || status == null) return json(404, { message: 'Not Found' });

			return json(200, { id: 1, status: status });
		});

		const slots = await api.getCheckRunLogs(
			provider,
			token,
			[job(1), job(2), job(3), job(4), { owner: 'o', repo: 'a', ref: { kind: 'status', nodeId: 'SC_1' } }],
			{ tailLines: 10 },
		);

		assert.deepStrictEqual(
			slots.map((s): unknown => (s.status === 'fulfilled' ? s.value : String(s.reason))),
			[
				{ unavailable: 'no-log' },
				{ unavailable: 'log-not-ready' },
				{ unavailable: 'log-expired' },
				{ unavailable: 'no-log' },
				{ unavailable: 'no-log' },
			],
		);
		assert.strictEqual(requests.length, 2 + 2 + 2 + 2, 'no request for the status');
		assert.ok(requests.every(r => !r.url.includes('SC_1')));
	});

	test('reads other check runs output through one aliased query, declaring only the variables it uses, and fails only the alias that errored', async () => {
		const { api, requests } = serve(request => {
			if (!request.url.endsWith('/graphql')) return json(500, {});

			return json(200, {
				data: {
					c0: { title: 'Lint failed', summary: '', text: '3 errors\r\nfoo.ts:1\nfoo.ts:2\nfoo.ts:3' },
					c1: null,
					c2: { title: null, summary: null, text: null },
					c3: null,
				},
				errors: [{ type: 'FORBIDDEN', path: ['c3'], message: 'Resource protected by SAML enforcement' }],
			});
		});

		const ids = ['CR_lint', 'CR_gone', 'CR_empty', 'CR_saml'];
		const slots = await api.getCheckRunLogs(
			provider,
			token,
			ids.map(id => ({ owner: 'o', repo: 'a', ref: { kind: 'check-run', nodeId: id } })),
			{ tailLines: 3 },
		);

		assert.strictEqual(requests.length, 1);
		const { query, variables } = JSON.parse(requests[0].body ?? '{}') as {
			query: string;
			variables: Record<string, unknown>;
		};
		const header = query.slice(0, query.indexOf(')'));
		const body = query.slice(query.indexOf(')'));
		const declared = Array.from(header.matchAll(/\$(\w+):/g), m => m[1]);
		assert.deepStrictEqual(declared, ['i0', 'i1', 'i2', 'i3']);
		for (const name of declared) {
			assert.match(body, new RegExp(`\\$${name}\\b`), `$${name} is declared but unused`);
		}
		assert.deepStrictEqual(variables, { i0: 'CR_lint', i1: 'CR_gone', i2: 'CR_empty', i3: 'CR_saml' });

		assert.deepStrictEqual(slots.slice(0, 3), [
			{
				status: 'fulfilled',
				value: {
					log: {
						text: 'foo.ts:1\nfoo.ts:2\nfoo.ts:3',
						lineCount: 3,
						truncated: true,
						source: 'check-run-output',
					},
				},
			},
			{ status: 'fulfilled', value: { unavailable: 'no-log' } },
			{ status: 'fulfilled', value: { unavailable: 'no-log' } },
		]);
		assert.strictEqual(slots[3].status, 'rejected');
	});
});
