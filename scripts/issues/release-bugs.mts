import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { config } from './config.mts';
import { fetchTeamMembers } from './fetch-team.mts';
import type {
	BugStatus,
	ChangeFingerprint,
	GhIssue,
	IssueKind,
	IssueRow,
	ReleaseTag,
	TraceClassification,
	TraceConfidence,
	TraceOutcome,
} from './release-bugs-core.mts';
import {
	bugTarget,
	containingAll,
	decide,
	earliestTag,
	fixCommitPattern,
	isSameChange,
	kindFromType,
	parseTags,
	reattribute,
	settleTraces,
	shippedIn,
} from './release-bugs-core.mts';

const execFileAsync = promisify(execFile);
const maxBuffer = 256 * 1024 * 1024;
const defaultWindowStart = '2026-10-26';
const identityFormat = '%H%x00%an%x00%aI%x00%s';
const classifications = new Set<string>(['introduced', 'external', 'not-a-gitlens-bug']);
const confidences = new Set<string>(['high', 'medium', 'low']);

type Write = { doc_id: string; existing: boolean; data: IssueRow };
type NeedsReading = { number: number; url: string; draft: IssueRow; existing: boolean };
type NeedsTrace = {
	number: number;
	url: string;
	title: string;
	fixCommits: string[];
	existing: boolean;
	draft: IssueRow;
};
type Routed = { route: 'write'; row: IssueRow } | { route: 'trace'; draft: IssueRow; fixCommits: string[] };
type Stats = { listed: number; new: number; unsettled: number; settled: number; skippedPrs: number; remapped: number };
type ScanResult = {
	startedAt: string;
	windowStart: string;
	releases: ReleaseTag[];
	writes: Write[];
	needsReading: NeedsReading[];
	needsTrace: NeedsTrace[];
	stats: Stats;
	saved: Map<number, IssueRow>;
};
type Summary = {
	startedAt: string;
	windowStart: string;
	stats: Stats;
	writes: Array<{ number: number; existing: boolean }>;
	needsReading: Array<Omit<NeedsReading, 'draft'>>;
	needsTrace: Array<Omit<NeedsTrace, 'draft'>>;
	releases: string[];
};
type SavedState = { windowStart?: string; lastRefreshAt?: string | null };
type TraceAnswer = { classification?: unknown; introducingCommits?: unknown; confidence?: unknown };

const usage = `Usage (run from the repo root; the org-member cache resolves relative to the cwd):
  node --experimental-strip-types scripts/issues/release-bugs.mts scan --state <dir> --out <dir> [--no-fetch]
  node --experimental-strip-types scripts/issues/release-bugs.mts resolve --issue <n> --kind bug|not-bug --out <dir>
  node --experimental-strip-types scripts/issues/release-bugs.mts tag-for --commit <sha> [--fix <sha>]...
  node --experimental-strip-types scripts/issues/release-bugs.mts settle --issue <n> --out <dir> --trace <file> --trace <file> [--trace <file>]`;

function lines(output: string): string[] {
	return output.split('\n').filter(line => line.trim() !== '');
}

async function git(args: string[], input?: string): Promise<string> {
	const pending = execFileAsync('git', args, { maxBuffer: maxBuffer });
	if (input != null) {
		pending.child.stdin?.end(input);
	}

	return (await pending).stdout;
}

async function readJson<T>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch (ex) {
		if ((ex as NodeJS.ErrnoException).code === 'ENOENT') return undefined;

		throw ex;
	}
}

async function readState(dir: string): Promise<{ windowStart: string; since: string; rows: Map<number, IssueRow> }> {
	const saved = await readJson<SavedState>(join(dir, 'meta', 'state.json'));
	const windowStart = saved?.windowStart ?? defaultWindowStart;

	const rows = new Map<number, IssueRow>();
	let names: string[] = [];
	try {
		names = await readdir(join(dir, 'issues'));
	} catch (ex) {
		if ((ex as NodeJS.ErrnoException).code !== 'ENOENT') throw ex;
	}

	for (const name of names) {
		if (!name.endsWith('.json')) continue;

		const row = await readJson<IssueRow>(join(dir, 'issues', name));
		if (row != null) {
			rows.set(row.number, row);
		}
	}

	return { windowStart: windowStart, since: saved?.lastRefreshAt ?? windowStart, rows: rows };
}

async function listTags(): Promise<ReleaseTag[]> {
	const stdout = await git(['for-each-ref', '--format=%(refname:short) %(creatordate:iso-strict)', 'refs/tags/v*']);
	return parseTags(stdout);
}

async function listFixRefs(): Promise<string[]> {
	const stdout = await git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/release/*']);
	return ['origin/main', ...lines(stdout)];
}

async function listIssues(since: string): Promise<GhIssue[]> {
	const { stdout } = await execFileAsync(
		'gh',
		[
			'api',
			'--paginate',
			`repos/${config.owner}/${config.repo}/issues?state=all&per_page=100&since=${since}`,
			'--jq',
			'.[]',
		],
		{ maxBuffer: maxBuffer },
	);

	return lines(stdout).map(line => JSON.parse(line) as GhIssue);
}

async function resolveCommit(commit: string): Promise<string | undefined> {
	try {
		return (await git(['rev-parse', '--verify', '--quiet', `${commit}^{commit}`])).trim() || undefined;
	} catch {
		return undefined;
	}
}

async function findFixCommits(issueNumber: number, refs: string[], useTimeline: boolean): Promise<string[]> {
	const logged = await git([
		'log',
		...refs,
		'--reverse',
		'-E',
		'-i',
		`--grep=${fixCommitPattern(issueNumber)}`,
		'--format=%H',
	]);
	const commits = lines(logged);
	if (commits.length > 0 || !useTimeline) return commits;

	const { stdout } = await execFileAsync(
		'gh',
		[
			'api',
			'--paginate',
			`repos/${config.owner}/${config.repo}/issues/${issueNumber}/timeline`,
			'--jq',
			'.[] | select(.event=="closed" and .commit_id!=null) | .commit_id',
		],
		{ maxBuffer: maxBuffer },
	);

	const local: string[] = [];
	for (const id of lines(stdout)) {
		if ((await resolveCommit(id)) != null) {
			local.push(id);
		}
	}

	return local;
}

async function routeDraft(draft: IssueRow, refs: string[]): Promise<Routed> {
	const target = bugTarget({ state: draft.state, state_reason: draft.stateReason }, draft.kind);
	if (target === 'excluded') return { route: 'write', row: draft };

	if (target === 'open') return { route: 'write', row: { ...draft, status: 'not-yet-fixed' } };

	const fixCommits = await findFixCommits(draft.number, refs, true);
	if (fixCommits.length === 0) return { route: 'write', row: { ...draft, status: 'needs-review' } };

	return { route: 'trace', draft: { ...draft, fixCommit: fixCommits.at(-1) ?? null }, fixCommits: fixCommits };
}

function buildDraft(
	issue: GhIssue,
	existing: IssueRow | undefined,
	isOrg: boolean,
	refreshedAt: string,
): { draft: IssueRow; needsKind: boolean } {
	let needsKind = false;
	const issueType = issue.type?.name ?? null;

	let kind: IssueKind;
	let kindSource: IssueRow['kindSource'] = 'type';
	const fromType = kindFromType(issueType, isOrg);
	if (fromType !== 'needs-reading') {
		kind = fromType;
	} else if (existing?.kindSource === 'investigated' && existing.issueType == null) {
		kind = existing.kind;
		kindSource = existing.kindSource;
	} else {
		kind = 'unclassified';
		needsKind = true;
	}

	return {
		draft: {
			number: issue.number,
			title: issue.title,
			url: issue.html_url,
			author: issue.user.login,
			isOrg: isOrg,
			createdAt: issue.created_at,
			state: issue.state,
			stateReason: issue.state_reason,
			closedAt: issue.closed_at,
			issueType: issueType,
			kind: kind,
			kindSource: kindSource,
			status: null,
			introducedIn: null,
			fixedIn: null,
			introducingCommit: null,
			fixCommit: null,
			traces: 0,
			refreshedAt: refreshedAt,
		},
		needsKind: needsKind,
	};
}

async function scan(stateDir: string, fetchRemote: boolean): Promise<ScanResult> {
	const startedAt = new Date().toISOString();
	const { windowStart, since, rows } = await readState(stateDir);
	if (fetchRemote) {
		await git(['fetch', 'origin', '--tags', '--prune']);
	}

	const tags = await listTags();
	const refs = await listFixRefs();
	const members = new Set(await fetchTeamMembers());
	const listing = await listIssues(since);

	const stats: Stats = { listed: 0, new: 0, unsettled: 0, settled: 0, skippedPrs: 0, remapped: 0 };
	const result: ScanResult = {
		startedAt: startedAt,
		windowStart: windowStart,
		releases: tags,
		writes: [],
		needsReading: [],
		needsTrace: [],
		stats: stats,
		saved: rows,
	};
	const windowStartMs = Date.parse(windowStart);
	const processed = new Set<number>();

	for (const issue of listing) {
		if (issue.pull_request != null) {
			stats.skippedPrs++;
			continue;
		}

		if (Date.parse(issue.created_at) < windowStartMs) continue;

		stats.listed++;
		const existing = rows.get(issue.number);
		const decision = decide(issue, existing);
		stats[decision]++;
		if (decision === 'settled') continue;

		processed.add(issue.number);
		const { draft, needsKind } = buildDraft(issue, existing, members.has(issue.user.login), startedAt);
		await collect(result, draft, needsKind, existing != null, refs);
	}

	await recheck(result, processed, tags, refs);
	return result;
}

async function recheck(result: ScanResult, processed: Set<number>, tags: ReleaseTag[], refs: string[]): Promise<void> {
	for (const saved of result.saved.values()) {
		if (processed.has(saved.number)) continue;

		if (saved.status === 'needs-review' && saved.fixCommit == null) {
			const fixCommits = await findFixCommits(saved.number, refs, false);
			if (fixCommits.length === 0) continue;

			result.needsTrace.push({
				number: saved.number,
				url: saved.url,
				title: saved.title,
				fixCommits: fixCommits,
				existing: true,
				draft: { ...saved, fixCommit: fixCommits.at(-1) ?? null, refreshedAt: result.startedAt },
			});
			continue;
		}

		if (saved.status !== 'never-shipped' || saved.fixedIn != null || saved.introducingCommit == null) continue;

		let fixCommits = await findFixCommits(saved.number, refs, false);
		if (fixCommits.length === 0 && saved.fixCommit != null) {
			fixCommits = [saved.fixCommit];
		}
		if (fixCommits.length === 0) continue;

		const introContaining = await tagsContaining(saved.introducingCommit, tags);
		const fixedContaining = await tagsContainingAll(fixCommits, tags);
		const updated = reattribute(saved, introContaining, fixedContaining, tags);
		if (updated == null) continue;

		result.stats.remapped++;
		result.writes.push({
			doc_id: String(saved.number),
			existing: true,
			data: { ...updated, refreshedAt: result.startedAt },
		});
	}
}

async function collect(
	result: ScanResult,
	draft: IssueRow,
	needsKind: boolean,
	existing: boolean,
	refs: string[],
): Promise<void> {
	if (needsKind) {
		result.needsReading.push({
			number: draft.number,
			url: draft.url,
			draft: draft,
			existing: existing,
		});
		return;
	}

	const routed = await routeDraft(draft, refs);
	if (routed.route === 'write') {
		result.writes.push({ doc_id: String(draft.number), existing: existing, data: routed.row });
		return;
	}

	result.needsTrace.push({
		number: draft.number,
		url: draft.url,
		title: draft.title,
		fixCommits: routed.fixCommits,
		existing: existing,
		draft: routed.draft,
	});
}

async function writeJson(path: string, data: unknown): Promise<void> {
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, `${JSON.stringify(data, null, '\t')}\n`);
}

async function writeOutput(outDir: string, result: ScanResult): Promise<Summary> {
	for (const dir of ['issues', 'drafts', 'releases', 'meta']) {
		await rm(join(outDir, dir), { recursive: true, force: true });
	}

	for (const write of result.writes) {
		await writeJson(join(outDir, 'issues', `${write.doc_id}.json`), write.data);
	}

	for (const item of [...result.needsReading, ...result.needsTrace]) {
		await writeJson(join(outDir, 'drafts', `${item.number}.json`), item.draft);
	}

	const referenced = new Set<string>();
	for (const row of [...result.saved.values(), ...result.writes.map(w => w.data)]) {
		if (row.introducedIn != null) {
			referenced.add(row.introducedIn);
		}
	}

	const windowStartMs = Date.parse(result.windowStart);
	const releases: string[] = [];
	for (const tag of result.releases) {
		if (!referenced.has(tag.tag) && Date.parse(tag.date) < windowStartMs) continue;

		releases.push(tag.tag);
		await writeJson(join(outDir, 'releases', `${tag.tag}.json`), { tag: tag.tag, date: tag.date });
	}

	await writeJson(join(outDir, 'meta', 'state.json'), {
		windowStart: result.windowStart,
		lastRefreshAt: result.startedAt,
	});

	return {
		startedAt: result.startedAt,
		windowStart: result.windowStart,
		stats: result.stats,
		writes: result.writes.map(w => ({ number: w.data.number, existing: w.existing })),
		needsReading: result.needsReading.map(n => ({
			number: n.number,
			url: n.url,
			existing: n.existing,
		})),
		needsTrace: result.needsTrace.map(n => ({
			number: n.number,
			url: n.url,
			title: n.title,
			fixCommits: n.fixCommits,
			existing: n.existing,
		})),
		releases: releases,
	};
}

async function resolveKind(issueNumber: number, kind: 'bug' | 'not-bug', outDir: string): Promise<object> {
	const draftPath = join(outDir, 'drafts', `${issueNumber}.json`);
	const draft = await readJson<IssueRow>(draftPath);
	if (draft == null) return fail(`No draft for #${issueNumber} in ${outDir}`);

	const routed = await routeDraft({ ...draft, kind: kind, kindSource: 'investigated' }, await listFixRefs());
	if (routed.route === 'trace') {
		await writeJson(draftPath, routed.draft);
		return {
			number: issueNumber,
			route: 'trace',
			title: routed.draft.title,
			url: routed.draft.url,
			fixCommits: routed.fixCommits,
		};
	}

	await writeJson(join(outDir, 'issues', `${issueNumber}.json`), routed.row);
	await rm(draftPath);
	return { number: issueNumber, route: 'write' };
}

let copyIndex: Promise<Map<string, string[]>> | undefined;
const containingCache = new Map<string, Promise<string[]>>();
const fingerprintCache = new Map<string, Promise<ChangeFingerprint>>();

function fingerprint(sha: string): Promise<ChangeFingerprint> {
	let pending = fingerprintCache.get(sha);
	if (pending == null) {
		pending = (async () => {
			const patchId = (await git(['patch-id', '--stable'], await git(['show', sha]))).split(' ')[0].trim();
			const files = lines(await git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]));
			return { patchId: patchId || undefined, files: files };
		})();
		fingerprintCache.set(sha, pending);
	}

	return pending;
}

function parseIdentity(line: string): { sha: string; key: string } {
	const [sha, author, authorDate, subject] = line.split('\0');
	return { sha: sha, key: [author, authorDate, subject].join('\0') };
}

function loadCopyIndex(tags: ReleaseTag[]): Promise<Map<string, string[]>> {
	copyIndex ??= (async () => {
		const refs = [...(await listFixRefs()), ...tags.map(tag => `refs/tags/${tag.tag}`)];
		const index = new Map<string, string[]>();
		for (const line of lines(await git(['log', ...refs, `--format=${identityFormat}`]))) {
			const { sha, key } = parseIdentity(line);
			index.set(key, [...(index.get(key) ?? []), sha]);
		}

		return index;
	})();
	return copyIndex;
}

async function findCopies(sha: string, tags: ReleaseTag[]): Promise<string[]> {
	const { key } = parseIdentity((await git(['log', '-1', `--format=${identityFormat}`, sha])).split('\n')[0]);
	const copies = [sha];
	for (const candidate of (await loadCopyIndex(tags)).get(key) ?? []) {
		if (candidate === sha) continue;

		if (isSameChange(await fingerprint(sha), await fingerprint(candidate))) {
			copies.push(candidate);
		}
	}

	return copies;
}

function tagsContaining(commit: string, tags: ReleaseTag[]): Promise<string[]> {
	let pending = containingCache.get(commit);
	if (pending == null) {
		pending = (async () => {
			const sha = await resolveCommit(commit);
			if (sha == null) throw new Error(`Unknown commit ${commit}`);

			const copies = await findCopies(sha, tags);
			const stable = new Set(tags.map(tag => tag.tag));
			const contains = copies.flatMap(copy => ['--contains', copy]);
			return lines(await git(['tag', '--list', 'v*', ...contains])).filter(tag => stable.has(tag));
		})();
		containingCache.set(commit, pending);
	}

	return pending;
}

async function tagsContainingAll(commits: string[], tags: ReleaseTag[]): Promise<string[]> {
	const containingEach: string[][] = [];
	for (const commit of commits) {
		containingEach.push(await tagsContaining(commit, tags));
	}

	return containingAll(containingEach);
}

async function tagFor(commit: string, fixes: string[]): Promise<object> {
	const tags = await listTags();
	const introContaining = await tagsContaining(commit, tags);
	const fixedContaining = await tagsContainingAll(fixes, tags);
	const introducedIn = earliestTag(introContaining, tags);
	return {
		commit: commit,
		introducedIn: introducedIn,
		date: tags.find(tag => tag.tag === introducedIn)?.date ?? null,
		fixedIn: earliestTag(fixedContaining, tags),
		shipped: shippedIn(introContaining, fixedContaining, tags),
	};
}

function parseTrace(
	answer: TraceAnswer | undefined,
	path: string,
): {
	classification: TraceClassification;
	confidence: TraceConfidence;
	introducingCommits: string[];
} {
	const commits = answer?.introducingCommits ?? [];
	if (
		typeof answer?.classification !== 'string' ||
		!classifications.has(answer.classification) ||
		typeof answer.confidence !== 'string' ||
		!confidences.has(answer.confidence) ||
		!Array.isArray(commits) ||
		!commits.every(c => typeof c === 'string')
	) {
		throw new Error(`Invalid trace answer in ${path}`);
	}

	return {
		classification: answer.classification as TraceClassification,
		confidence: answer.confidence as TraceConfidence,
		introducingCommits: commits as string[],
	};
}

async function traceOutcome(path: string, fixedContaining: string[], tags: ReleaseTag[]): Promise<TraceOutcome> {
	const trace = parseTrace(await readJson<TraceAnswer>(path), path);
	const outcome: TraceOutcome = {
		classification: trace.classification,
		confidence: trace.confidence,
		commit: null,
		introducedIn: null,
		shipped: null,
	};
	if (trace.classification !== 'introduced') return outcome;

	let best: { sha: string; containing: string[]; introducedIn: string | null } | undefined;
	for (const commit of trace.introducingCommits) {
		const sha = await resolveCommit(commit);
		if (sha == null) continue;

		const containing = await tagsContaining(sha, tags);
		const introducedIn = earliestTag(containing, tags);
		if (best == null || isEarlier(introducedIn, best.introducedIn, tags)) {
			best = { sha: sha, containing: containing, introducedIn: introducedIn };
		}
	}

	if (best == null) return outcome;

	return {
		...outcome,
		commit: best.sha,
		introducedIn: best.introducedIn,
		shipped: shippedIn(best.containing, fixedContaining, tags),
	};
}

function isEarlier(tag: string | null, than: string | null, tags: ReleaseTag[]): boolean {
	if (tag == null) return false;
	if (than == null) return true;

	return earliestTag([tag, than], tags) === tag && tag !== than;
}

async function settle(issueNumber: number, outDir: string, tracePaths: string[]): Promise<object> {
	if (tracePaths.length < 2 || tracePaths.length > 3) return fail(`settle takes 2 or 3 --trace files\n${usage}`);

	const draftPath = join(outDir, 'drafts', `${issueNumber}.json`);
	const draft = await readJson<IssueRow>(draftPath);
	if (draft == null) return fail(`No draft for #${issueNumber} in ${outDir}`);

	const tags = await listTags();
	const fixCommits = await findFixCommits(issueNumber, await listFixRefs(), true);
	if (fixCommits.length === 0) return fail(`No fix commit found for #${issueNumber}`);

	const fixedContaining = await tagsContainingAll(fixCommits, tags);
	const outcomes: TraceOutcome[] = [];
	for (const path of tracePaths) {
		outcomes.push(await traceOutcome(path, fixedContaining, tags));
	}

	const settlement = settleTraces(outcomes);
	if (settlement.outcome === 'tie-break') return { needsTieBreak: true };

	let status: BugStatus = 'needs-review';
	let introducedIn: string | null = null;
	let introducingCommit: string | null = null;
	if (settlement.outcome === 'settled') {
		({ status, introducedIn, introducingCommit } = settlement);
	}

	await writeJson(draftPath, {
		...draft,
		status: status,
		introducedIn: introducedIn,
		introducingCommit: introducingCommit,
		fixCommit: fixCommits.at(-1) ?? null,
		fixedIn: earliestTag(fixedContaining, tags),
		traces: outcomes.length,
	} satisfies IssueRow);

	const release = tags.find(tag => tag.tag === introducedIn);
	if (release != null) {
		await writeJson(join(outDir, 'releases', `${release.tag}.json`), { tag: release.tag, date: release.date });
	}

	return { number: issueNumber, status: status, introducedIn: introducedIn };
}

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function requireOption(value: string | undefined, name: string): string {
	return value ?? fail(`Missing --${name}\n${usage}`);
}

async function main(): Promise<void> {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			state: { type: 'string' },
			out: { type: 'string' },
			'no-fetch': { type: 'boolean' },
			issue: { type: 'string' },
			kind: { type: 'string' },
			commit: { type: 'string' },
			fix: { type: 'string', multiple: true },
			trace: { type: 'string', multiple: true },
		},
	});

	const command = positionals[0];
	if (command === 'scan') {
		const state = requireOption(values.state, 'state');
		const out = requireOption(values.out, 'out');
		if (resolve(out) === resolve(state)) return fail('--out must differ from --state');

		const result = await scan(state, values['no-fetch'] !== true);
		console.log(JSON.stringify(await writeOutput(out, result)));
	} else if (command === 'resolve') {
		const issueNumber = Number(requireOption(values.issue, 'issue'));
		const kind = requireOption(values.kind, 'kind');
		if (!Number.isInteger(issueNumber) || (kind !== 'bug' && kind !== 'not-bug')) {
			return fail(`--issue must be a number and --kind bug or not-bug\n${usage}`);
		}

		console.log(JSON.stringify(await resolveKind(issueNumber, kind, requireOption(values.out, 'out'))));
	} else if (command === 'tag-for') {
		console.log(JSON.stringify(await tagFor(requireOption(values.commit, 'commit'), values.fix ?? [])));
	} else if (command === 'settle') {
		const issueNumber = Number(requireOption(values.issue, 'issue'));
		if (!Number.isInteger(issueNumber)) return fail(`--issue must be a number\n${usage}`);

		const out = requireOption(values.out, 'out');
		console.log(JSON.stringify(await settle(issueNumber, out, values.trace ?? [])));
	} else {
		fail(usage);
	}
}

main().catch((ex: unknown) => fail(ex instanceof Error ? ex.message : String(ex)));
