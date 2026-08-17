import * as sinon from 'sinon';
import type { CancellationToken } from 'vscode';
import { GitSearchError } from '@gitlens/git/errors.js';
import type { GitGraph } from '@gitlens/git/models/graph.js';
import type { GitGraphSearch, GitGraphSearchProgress } from '@gitlens/git/models/graphSearch.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import { getSearchQueryComparisonKey } from '@gitlens/git/utils/search.utils.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { Container } from '../../../../container.js';
import type { GlRepository } from '../../../../git/models/repository.js';
import type { WebviewHost } from '../../../webviewProvider.js';
import type { GraphSearchServiceContext } from '../graphSearchService.js';
import { GraphSearchService } from '../graphSearchService.js';
import type { GraphSearchResponse, GraphSearchState, GraphServices } from '../graphService.js';
import type { SearchParams } from '../protocol.js';

/** Default sha pool for a fresh harness — every scripted `GitGraphSearch.results` sha must also be a
 *  member of `graphIds` or `ensureSearchStartsInRange` fires the real `updateGraphWithMoreRows` page-in
 *  logic instead of the no-op the tests want. */
const defaultGraphIds = ['sha1', 'sha2', 'sha3', 'sha4', 'sha5'];

type SearchStreamBehavior = (
	signal: AbortSignal | undefined,
) => AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>;

// oxlint-disable-next-line require-yield
async function* resultGenerator(search: GitGraphSearch): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
	return search;
}

async function* progressGenerator(
	progress: GitGraphSearchProgress[],
	final: GitGraphSearch,
): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
	for (const p of progress) {
		yield p;
	}

	return final;
}

// oxlint-disable-next-line require-yield
async function* errorGenerator(error: unknown): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
	throw error;
}

function createStreamStub(label: string): { stub: sinon.SinonStub; queue: SearchStreamBehavior[] } {
	const queue: SearchStreamBehavior[] = [];
	const stub = sinon.stub().callsFake((...args: unknown[]) => {
		const behavior = queue.shift();
		if (behavior == null) {
			throw new Error(`${label} queue is empty — no scripted behavior was queued for this call`);
		}

		// The real provider call always ends with the driving `AbortSignal` as its last positional
		// argument (`searchGraph(query, options, signal)` / `continueSearchGraph(cursor, results, options,
		// signal)`) — forward it so a behavior can script a final value that depends on it.
		return behavior(args.at(-1) as AbortSignal | undefined);
	});

	return { stub: stub, queue: queue };
}

/** Loose AI-action fake — the real `generateSearchQuery` signature, kept untyped past `search`/`options`
 *  since the container is cast `as unknown as Container` at the boundary anyway. */
export type AiFn = (
	search: { query: string; context: string | undefined },
	source: unknown,
	options?: { cancellation?: CancellationToken },
) => Promise<unknown>;

type AiCallRecord = { search: { query: string; context: string | undefined }; source: unknown; options: unknown };

function createAiStub(): { stub: sinon.SinonStub; queue: AiFn[]; calls: AiCallRecord[] } {
	const queue: AiFn[] = [];
	const calls: AiCallRecord[] = [];
	const stub = sinon
		.stub()
		.callsFake(
			(
				search: { query: string; context: string | undefined },
				source: unknown,
				options?: { cancellation?: CancellationToken },
			) => {
				calls.push({ search: search, source: source, options: options });

				const behavior = queue.shift();
				if (behavior == null) {
					throw new Error(
						'generateSearchQuery queue is empty — no scripted AI behavior was queued for this call',
					);
				}

				return behavior(search, source, options);
			},
		);

	return { stub: stub, queue: queue, calls: calls };
}

/** Resolves immediately with a successful AI conversion. */
export function aiResult(result: {
	query: string;
	explanation?: string;
	mode?: 'highlight' | 'filter' | 'select';
	alternates?: string[];
}): AiFn {
	return () => Promise.resolve({ result: result });
}

/** Rejects immediately — an AI/network failure, not a cancellation. */
export function aiError(error: Error): AiFn {
	return () => Promise.reject(error);
}

/** Never resolves on its own; rejects with `CancellationError` once (or if already) cancelled. Models a
 *  stuck AI round-trip for the timeout and mid-conversion-cancel flows. */
export function aiHang(): AiFn {
	return (_search, _source, options) => {
		return new Promise((_resolve, reject) => {
			if (options?.cancellation?.isCancellationRequested) {
				reject(new CancellationError());

				return;
			}

			options?.cancellation?.onCancellationRequested(() => reject(new CancellationError()));
		});
	};
}

/** Never settles and never subscribes to its cancellation token — a hang that happens BEFORE the AI
 *  call reaches cooperative-cancellation territory (e.g. blocked model resolution). The timeout must
 *  recover from this shape by racing, not by waiting for the callee to observe its token. */
export function aiHangDeaf(): AiFn {
	return () => new Promise(() => {});
}

/** Caller-controlled AI response, for scripting a supersede race against an in-flight round-trip. */
export function aiDeferred(): {
	fn: AiFn;
	resolve: (result: { query: string }) => void;
	reject: (error: Error) => void;
} {
	let resolveFn!: (value: unknown) => void;
	let rejectFn!: (reason?: unknown) => void;
	const promise = new Promise<unknown>((resolve, reject) => {
		resolveFn = resolve;
		rejectFn = reject;
	});
	const fn: AiFn = () => promise;

	return {
		fn: fn,
		resolve: result => resolveFn({ result: result }),
		reject: error => rejectFn(error),
	};
}

/** Builds a settled `GitGraphSearch`, filling the fields every flow test needs so callers only spell out
 *  what's distinctive about their scenario. `overrides` is spread last so `paging`/`comparisonKey`/etc. can
 *  be replaced wholesale. */
export function buildGitGraphSearch(
	query: SearchQuery,
	resultsEntries: Array<[string, { date: number; i: number }]>,
	overrides?: Partial<GitGraphSearch>,
): GitGraphSearch {
	return {
		repoPath: '/repo',
		query: query,
		queryFilters: { files: false, refs: false },
		comparisonKey: getSearchQueryComparisonKey(query),
		hasMore: false,
		results: new Map(resultsEntries),
		...overrides,
	};
}

/** Builds a classified `GitSearchError` the way the real provider throws one. */
export function buildGitSearchError(reason: 'invalidPattern' | 'invalidRef', detail?: string): GitSearchError {
	return new GitSearchError(new Error(detail ?? reason), reason, detail);
}

export interface SearchHarnessOptions {
	nlConversionTimeoutMs?: number;
	graphIds?: string[];
	repoPath?: string;
}

export interface SearchHarness {
	service: GraphSearchService;
	graphIds: Set<string>;
	host: { id: string; sendTelemetryEvent: sinon.SinonStub };
	/** The RPC-shaped surface (`service.createServices().search`) — history/mode/repair/getState/clear
	 *  flows that don't go through `search()` drive it directly. */
	rpc: Pick<GraphServices, 'search'>['search'];
	/** Drives a search through the RPC surface the way the app will — resolves `undefined` when the
	 *  operation was superseded or aborted. */
	search: (params: SearchParams, signal?: AbortSignal) => Promise<GraphSearchResponse | undefined>;
	/** Every search state fired on `onDidChange`, in emission order. */
	states: () => Array<GraphSearchState | undefined>;
	telemetryEvents: () => Array<{ name: string; data: unknown }>;
	graph: { searchGraph: sinon.SinonStub; continueSearchGraph: sinon.SinonStub; countSearchResults: sinon.SinonStub };
	contributors: { getContributorsLite: sinon.SinonStub };
	ai: { generateSearchQuery: sinon.SinonStub; queue: (fn: AiFn) => void; calls: AiCallRecord[] };
	queueSearchGraphResult: (search: GitGraphSearch) => void;
	queueSearchGraphProgress: (progress: GitGraphSearchProgress[], final: GitGraphSearch) => void;
	queueSearchGraphError: (error: unknown) => void;
	/** Queues a `searchGraph` stream built from `factory`, which receives the live `AbortSignal` the call
	 *  was made with — for scripting a stream whose FINAL value depends on whether/how it was cancelled.
	 *  `queueSearchGraphProgress`'s final value is fixed regardless of abort, which can't express that. */
	queueSearchGraphStream: (
		factory: (signal: AbortSignal | undefined) => AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>,
	) => void;
	queueContinueSearchGraphResult: (search: GitGraphSearch) => void;
	queueContinueSearchGraphError: (error: unknown) => void;
	/** `queueSearchGraphStream`'s counterpart for `continueSearchGraph` — for scripting a continuation
	 *  whose behavior depends on the live `AbortSignal` (e.g. a background continuation a pause aborts). */
	queueContinueSearchGraphStream: (
		factory: (signal: AbortSignal | undefined) => AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>,
	) => void;
	/** Changes the active repo's path after the harness is built, for exercising repo-switch flows. */
	setRepositoryPath: (path: string) => void;
	/** The fake workspace-storage stubs backing {@link SearchHistory}, for asserting on the keys/values
	 *  written by search-history read/write flows. */
	storage: { getWorkspace: sinon.SinonStub; storeWorkspace: sinon.SinonStub };
	/** The selection/rows-plane context stubs, for asserting that a search reveals its first match
	 *  through the rows plane. */
	context: { setSelectedRows: sinon.SinonStub; notifyDidChangeRows: sinon.SinonStub };
}

/** Assembles a `GraphSearchService` against fakes for every collaborator its context reaches, scripted via
 *  FIFO queues so each flow test spells out exactly what each git/AI call returns, in call order. */
export function createSearchHarness(options?: SearchHarnessOptions): SearchHarness {
	const graphIds = new Set<string>(options?.graphIds ?? defaultGraphIds);
	const repoPath = options?.repoPath ?? '/repo';

	const { stub: searchGraphStub, queue: searchGraphQueue } = createStreamStub('searchGraph');
	const { stub: continueSearchGraphStub, queue: continueSearchGraphQueue } = createStreamStub('continueSearchGraph');
	const countSearchResultsStub = sinon.stub().resolves(0);
	const contributorsGetContributorsLiteStub = sinon.stub().resolves([]);

	const repository = {
		path: repoPath,
		etag: 1,
		git: {
			graph: {
				searchGraph: searchGraphStub,
				continueSearchGraph: continueSearchGraphStub,
				countSearchResults: countSearchResultsStub,
			},
			branches: {
				getBranches: sinon.stub().resolves({ values: [] }),
				getBranch: sinon.stub().resolves(undefined),
				getDefaultBranchName: sinon.stub().resolves(undefined),
			},
			worktrees: { getWorktrees: sinon.stub().resolves([]) },
			contributors: { getContributorsLite: contributorsGetContributorsLiteStub },
			tags: { getTags: sinon.stub().resolves({ values: [] }) },
		},
	};

	const session = {
		current: { repoPath: repoPath, ids: graphIds } as unknown as GitGraph,
	} as unknown as GitGraphSession;

	const hostSendTelemetryEvent = sinon.stub();
	const host = { id: 'gitlens.graph', sendTelemetryEvent: hostSendTelemetryEvent };

	const { stub: aiStub, queue: aiQueue, calls: aiCalls } = createAiStub();

	const workspaceStorage = new Map<string, unknown>();
	const storageGetWorkspaceStub = sinon.stub().callsFake((key: string) => workspaceStorage.get(key));
	const storageStoreWorkspaceStub = sinon.stub().callsFake((key: string, value: unknown) => {
		workspaceStorage.set(key, value);
		return Promise.resolve();
	});

	const container = {
		ai: { actions: { generateSearchQuery: aiStub } },
		storage: {
			get: sinon.stub().callsFake((_key: string, def: unknown) => def),
			store: sinon.stub().resolves(),
			getWorkspace: storageGetWorkspaceStub,
			storeWorkspace: storageStoreWorkspaceStub,
		},
	} as unknown as Container;

	const setSelectedRowsStub = sinon.stub();
	const notifyDidChangeRowsStub = sinon.stub();

	const context: GraphSearchServiceContext = {
		container: container,
		host: host as unknown as WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>,
		getRepository: () => repository as unknown as GlRepository,
		getSession: () => session,
		getSelectedId: () => undefined,
		getSelectedRows: () => undefined,
		getEtagRepository: () => repository.etag,
		setSelectedRows: setSelectedRowsStub,
		updateState: sinon.stub(),
		updateGraphWithMoreRows: sinon.stub().resolves(undefined),
		notifyDidChangeRows: notifyDidChangeRowsStub,
		getWipRows: () => Promise.resolve({}),
		nlConversionTimeoutMs: options?.nlConversionTimeoutMs,
	};

	const service = new GraphSearchService(context);
	const rpc = service.createServices().search;

	const states: Array<GraphSearchState | undefined> = [];
	rpc.onDidChange(s => states.push(s));

	return {
		service: service,
		graphIds: graphIds,
		host: { id: host.id, sendTelemetryEvent: hostSendTelemetryEvent },
		rpc: rpc,
		search: (params, signal) => rpc.search(params, signal),
		states: () => [...states],
		telemetryEvents: () =>
			hostSendTelemetryEvent.getCalls().map(call => ({ name: call.args[0] as string, data: call.args[1] })),
		graph: {
			searchGraph: searchGraphStub,
			continueSearchGraph: continueSearchGraphStub,
			countSearchResults: countSearchResultsStub,
		},
		contributors: { getContributorsLite: contributorsGetContributorsLiteStub },
		ai: {
			generateSearchQuery: aiStub,
			queue: (fn: AiFn) => aiQueue.push(fn),
			calls: aiCalls,
		},
		queueSearchGraphResult: (search: GitGraphSearch) => searchGraphQueue.push(() => resultGenerator(search)),
		queueSearchGraphProgress: (progress: GitGraphSearchProgress[], final: GitGraphSearch) =>
			searchGraphQueue.push(() => progressGenerator(progress, final)),
		queueSearchGraphError: (error: unknown) => searchGraphQueue.push(() => errorGenerator(error)),
		queueSearchGraphStream: factory => searchGraphQueue.push(factory),
		queueContinueSearchGraphResult: (search: GitGraphSearch) =>
			continueSearchGraphQueue.push(() => resultGenerator(search)),
		queueContinueSearchGraphError: (error: unknown) => continueSearchGraphQueue.push(() => errorGenerator(error)),
		queueContinueSearchGraphStream: factory => continueSearchGraphQueue.push(factory),
		setRepositoryPath: (path: string) => {
			repository.path = path;
		},
		storage: { getWorkspace: storageGetWorkspaceStub, storeWorkspace: storageStoreWorkspaceStub },
		context: { setSelectedRows: setSelectedRowsStub, notifyDidChangeRows: notifyDidChangeRowsStub },
	};
}
