import { RequestError } from '@octokit/request-error';
import { RequestNotFoundError } from '@gitlens/git/errors.js';
import type { PullRequestCheckLog, PullRequestCheckLogText } from '@gitlens/git/models/pullRequest.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { mapSettledBounded } from '@gitlens/utils/promise.js';
import type { GitHubCheckRunRef } from '../models.js';
import type { AliasedGraphql } from './aliasedQuery.js';
import { getAliasErrorVerdict } from './aliasedQuery.js';
import { toCancellationError } from './cancellation.js';

export interface GitHubActionsJob {
	readonly owner: string;
	readonly repo: string;
	readonly jobId: number;
}

interface GitHubCheckRunLogClient {
	readonly isWeb: boolean;
	readonly graphql: AliasedGraphql;
	requestJobLogRedirect(job: GitHubActionsJob): Promise<{ status: number; location: string | undefined }>;
	requestJobLogStream(job: GitHubActionsJob): Promise<ReadableStream<Uint8Array> | null>;
	requestJobStatus(job: GitHubActionsJob): Promise<string | undefined>;
	fetchStorage(
		url: string,
		init: { headers: Record<string, string>; signal: AbortSignal | undefined },
	): Promise<Response>;
}

type CheckRunOutput = { title?: string | null; summary?: string | null; text?: string | null };

const checkRunLogTailBytes = 262144;
const actionsJobLogConcurrency = 4;
const wholeJobLogLimitBytes = 20 * 1024 * 1024;

export async function readGitHubCheckRunLogs(
	client: GitHubCheckRunLogClient,
	targets: readonly { owner: string; repo: string; ref: GitHubCheckRunRef }[],
	tailLines: number,
	scope: ScopedLogger | undefined,
	cancellation: AbortSignal | undefined,
): Promise<PromiseSettledResult<PullRequestCheckLog>[]> {
	const slots = new Array<PromiseSettledResult<PullRequestCheckLog>>(targets.length);
	const jobs: { index: number; job: GitHubActionsJob }[] = [];
	const checkRuns: { index: number; nodeId: string }[] = [];
	targets.forEach((target, index) => {
		switch (target.ref.kind) {
			case 'actions-job':
				jobs.push({ index: index, job: { owner: target.owner, repo: target.repo, jobId: target.ref.jobId } });
				break;
			case 'check-run':
				checkRuns.push({ index: index, nodeId: target.ref.nodeId });
				break;
			case 'status':
				slots[index] = { status: 'fulfilled', value: { unavailable: 'no-log' } };
				break;
		}
	});

	const [jobSlots, outputSlots] = await Promise.all([
		mapSettledBounded(jobs, actionsJobLogConcurrency, ({ job }) =>
			client.isWeb
				? readWebJobLog(client, job, tailLines)
				: readStoredJobLog(client, job, tailLines, cancellation),
		),
		readCheckRunOutputs(
			client.graphql,
			checkRuns.map(c => c.nodeId),
			tailLines,
			scope,
		),
	]);
	if (cancellation?.aborted) throw new CancellationError();

	jobs.forEach((job, i) => {
		slots[job.index] = jobSlots[i];
	});
	checkRuns.forEach((checkRun, i) => {
		slots[checkRun.index] = outputSlots[i];
	});
	return slots;
}

async function readCheckRunOutputs(
	graphql: AliasedGraphql,
	nodeIds: readonly string[],
	tailLines: number,
	scope: ScopedLogger | undefined,
): Promise<PromiseSettledResult<PullRequestCheckLog>[]> {
	if (nodeIds.length === 0) return [];

	const variables: Record<string, unknown> = {};
	nodeIds.forEach((nodeId, i) => {
		variables[`i${i}`] = nodeId;
	});

	try {
		const rsp = await graphql<Record<string, CheckRunOutput | null | undefined>>(
			checkRunOutputsQuery(nodeIds.length),
			variables,
		);
		if (rsp?.data == null) throw new Error('GitHub returned no data for the check run outputs');

		const { data, errors } = rsp;
		return nodeIds.map((_, i): PromiseSettledResult<PullRequestCheckLog> => {
			const alias = `c${i}`;
			const node = data[alias];
			const verdict = getAliasErrorVerdict(errors, alias, node);
			if (verdict != null && verdict !== 'absent') return verdict;

			const text = checkRunOutputText(node);
			return {
				status: 'fulfilled',
				value:
					text != null
						? {
								log: tailLogText(text, {
									partialFirstLine: false,
									tailLines: tailLines,
									source: 'check-run-output',
								}),
							}
						: { unavailable: 'no-log' },
			};
		});
	} catch (ex) {
		if (isCancellationError(ex)) throw ex;

		scope?.warn(`failed to read check run outputs; ex=${ex}`);
		return nodeIds.map((): PromiseRejectedResult => ({ status: 'rejected', reason: ex }));
	}
}

function checkRunOutputsQuery(count: number): string {
	const params = Array.from({ length: count }, (_, i) => `$i${i}: ID!`).join('\n\t\t\t\t');
	const fields = Array.from(
		{ length: count },
		(_, i) => `c${i}: node(id: $i${i}) { ... on CheckRun { title summary text } }`,
	).join('\n\t\t\t\t');
	return `query getCheckRunOutputs(
				${params}
			) {
				${fields}
			}`;
}

function checkRunOutputText(output: CheckRunOutput | null | undefined): string | undefined {
	const parts = [output?.title, output?.summary, output?.text].filter(
		(part): part is string => part != null && part.trim().length !== 0,
	);
	return parts.length !== 0 ? parts.join('\n\n') : undefined;
}

async function readWebJobLog(
	client: GitHubCheckRunLogClient,
	job: GitHubActionsJob,
	tailLines: number,
): Promise<PullRequestCheckLog> {
	let stream: ReadableStream<Uint8Array> | null;
	try {
		stream = await client.requestJobLogStream(job);
	} catch (ex) {
		return readMissingJobLog(client, job, ex);
	}

	return readWholeJobLog(stream, tailLines);
}

async function readStoredJobLog(
	client: GitHubCheckRunLogClient,
	job: GitHubActionsJob,
	tailLines: number,
	cancellation: AbortSignal | undefined,
): Promise<PullRequestCheckLog> {
	let redirect: { status: number; location: string | undefined };
	try {
		redirect = await client.requestJobLogRedirect(job);
	} catch (ex) {
		return readMissingJobLog(client, job, ex);
	}
	if (redirect.status !== 302 || !redirect.location) {
		throw new Error(`GitHub answered ${redirect.status} without a job log location`);
	}

	const url = redirect.location;
	const probe = await fetchStorage(client, url, 'bytes=0-0', cancellation);
	if (probe.status === 200) return readWholeJobLog(probe.body, tailLines);

	if (probe.status !== 206) {
		await discardBody(probe);
		if (probe.status === 404 || probe.status === 416) return { unavailable: 'no-log' };

		throw new Error(`GitHub job log storage answered ${probe.status}`);
	}

	const total = parseContentRangeTotal(probe.headers.get('content-range'));
	await discardBody(probe);
	if (total == null) throw new Error('GitHub job log storage answered without the log size');
	if (total === 0) return { unavailable: 'no-log' };

	const start = Math.max(0, total - checkRunLogTailBytes);
	const tail = await fetchStorage(client, url, `bytes=${start}-`, cancellation);
	if (tail.status === 200) return readWholeJobLog(tail.body, tailLines);

	if (tail.status !== 206) {
		await discardBody(tail);
		if (tail.status === 404 || tail.status === 416) return { unavailable: 'no-log' };

		throw new Error(`GitHub job log storage answered ${tail.status}`);
	}

	const bytes = new Uint8Array(await readBody(tail));
	return { log: toJobLogText(bytes, start > 0, tailLines) };
}

async function readMissingJobLog(
	client: GitHubCheckRunLogClient,
	job: GitHubActionsJob,
	ex: unknown,
): Promise<PullRequestCheckLog> {
	if (!isNotFoundStatus(ex, 404, 410)) throw ex;

	try {
		const status = await client.requestJobStatus(job);
		return { unavailable: status === 'completed' ? 'log-expired' : 'log-not-ready' };
	} catch (statusEx) {
		if (isNotFoundStatus(statusEx, 404)) return { unavailable: 'no-log' };

		throw statusEx;
	}
}

async function fetchStorage(
	client: GitHubCheckRunLogClient,
	url: string,
	range: string,
	cancellation: AbortSignal | undefined,
): Promise<Response> {
	if (cancellation?.aborted) throw new CancellationError();

	try {
		return await client.fetchStorage(url, { headers: { Range: range }, signal: cancellation });
	} catch (ex) {
		throw toCancellationError(ex);
	}
}

async function readWholeJobLog(
	stream: ReadableStream<Uint8Array> | null,
	tailLines: number,
): Promise<PullRequestCheckLog> {
	const tail = await readStreamTail(stream, checkRunLogTailBytes, wholeJobLogLimitBytes);
	if (tail == null) return { unavailable: 'log-too-large' };
	if (tail.bytes.byteLength === 0) return { unavailable: 'no-log' };

	return { log: toJobLogText(tail.bytes, tail.skipped, tailLines) };
}

async function readStreamTail(
	stream: ReadableStream<Uint8Array> | null,
	keepBytes: number,
	limitBytes: number,
): Promise<{ bytes: Uint8Array; skipped: boolean } | undefined> {
	if (stream == null) return { bytes: new Uint8Array(0), skipped: false };

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let kept = 0;
	let read = 0;
	let skipped = false;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;

			read += value.byteLength;
			if (read > limitBytes) {
				await reader.cancel();
				return undefined;
			}

			chunks.push(value);
			kept += value.byteLength;
			while (chunks.length > 1 && kept - chunks[0].byteLength >= keepBytes) {
				kept -= chunks[0].byteLength;
				chunks.shift();
				skipped = true;
			}
		}
	} catch (ex) {
		throw toCancellationError(ex);
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(kept);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	const start = Math.max(0, bytes.byteLength - keepBytes);
	return { bytes: bytes.subarray(start), skipped: skipped || start > 0 };
}

function parseContentRangeTotal(header: string | null): number | undefined {
	const match = header != null ? /^bytes \d+-\d+\/(\d+)$/i.exec(header.trim()) : null;
	if (match == null) return undefined;

	const total = Number(match[1]);
	return Number.isSafeInteger(total) ? total : undefined;
}

function toJobLogText(bytes: Uint8Array, skipped: boolean, tailLines: number): PullRequestCheckLogText {
	return tailLogText(new TextDecoder('utf-8').decode(bytes), {
		partialFirstLine: skipped,
		tailLines: tailLines,
		source: 'actions-job-log',
	});
}

function tailLogText(
	text: string,
	options: { partialFirstLine: boolean; tailLines: number; source: PullRequestCheckLogText['source'] },
): PullRequestCheckLogText {
	let normalized = text.replace(/\r\n/g, '\n');
	if (options.partialFirstLine) {
		const newline = normalized.indexOf('\n');
		normalized = newline === -1 ? '' : normalized.slice(newline + 1);
	}

	const lines = normalized.length !== 0 ? normalized.split('\n') : [];
	if (lines.at(-1) === '') {
		lines.pop();
	}

	const kept = lines.length > options.tailLines ? lines.slice(-options.tailLines) : lines;
	return {
		text: kept.join('\n'),
		lineCount: kept.length,
		truncated: options.partialFirstLine || lines.length > kept.length,
		source: options.source,
	};
}

async function readBody(rsp: Response): Promise<ArrayBuffer> {
	try {
		return await rsp.arrayBuffer();
	} catch (ex) {
		throw toCancellationError(ex);
	}
}

async function discardBody(rsp: Response): Promise<void> {
	await readBody(rsp);
}

function isNotFoundStatus(ex: unknown, ...statuses: number[]): boolean {
	return RequestNotFoundError.is(ex) && ex.original instanceof RequestError && statuses.includes(ex.original.status);
}
