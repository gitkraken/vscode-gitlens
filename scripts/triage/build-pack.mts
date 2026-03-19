import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.mts';
import { fetchChangelogLookup } from './fetch-changelog.mts';
import { fetchIssues } from './fetch-issues.mts';
import { fetchLabels } from './fetch-labels.mts';
import { fetchTeamMembers } from './fetch-team.mts';
import type {
	AuditQueryParams,
	ChangelogEntry,
	DuplicateCandidate,
	EnrichedIssue,
	EvidencePack,
	GitHubIssue,
	IssueLabel,
	ReactiveQueryParams,
	RepositoryLabel,
	RunMetadata,
	Workflow,
} from './types.mts';

// Common English stop words excluded from keyword matching
const stopWords = new Set([
	'a',
	'an',
	'the',
	'and',
	'or',
	'but',
	'in',
	'on',
	'at',
	'to',
	'for',
	'of',
	'with',
	'by',
	'is',
	'are',
	'was',
	'were',
	'be',
	'been',
	'being',
	'have',
	'has',
	'had',
	'do',
	'does',
	'did',
	'will',
	'would',
	'could',
	'should',
	'may',
	'might',
	'can',
	'not',
	'no',
	'it',
	'its',
	'this',
	'that',
	'these',
	'those',
	'i',
	'my',
	'me',
	'we',
	'our',
	'you',
	'your',
	'he',
	'she',
	'they',
	'them',
	'their',
	'what',
	'which',
	'who',
	'when',
	'where',
	'how',
	'all',
	'each',
	'every',
	'both',
	'few',
	'more',
	'some',
	'any',
	'if',
	'from',
	'as',
	'so',
	'than',
	'too',
	'very',
	'just',
	'about',
]);

// Phrases that indicate an issue has been superseded
const supersessionPatterns = [
	/\bsuperseded\s+by\b/i,
	/\breplaced\s+by\b/i,
	/\bremoved\s+in\b/i,
	/\bdeprecated\s+in\s+favor\b/i,
	/\bno\s+longer\s+(?:relevant|applicable|needed)\b/i,
	/\brevert(?:ed|s)?\s+(?:in|by)\b/i,
];

export async function buildPack(
	mode: Workflow,
	params: ReactiveQueryParams | AuditQueryParams,
	forceRefresh?: boolean,
): Promise<string> {
	console.error('Fetching team members, labels, changelog, and issues...');

	// Fetch all data in parallel
	const [teamMembers, labels, changelogLookup, rawIssues] = await Promise.all([
		fetchTeamMembers(forceRefresh),
		fetchLabels(forceRefresh),
		fetchChangelogLookup(forceRefresh),
		mode === 'reactive'
			? fetchIssues('reactive', params as ReactiveQueryParams)
			: fetchIssues('audit', params as AuditQueryParams),
	]);

	const labelMap = new Map<string, RepositoryLabel>(labels.map(l => [l.name, l]));
	const teamSet = new Set(teamMembers.map(m => m.toLowerCase()));

	console.error(`Enriching ${rawIssues.length} issues...`);

	// Enrich each issue
	const enrichedIssues: EnrichedIssue[] = rawIssues.map(raw =>
		enrichIssue(raw, teamSet, labelMap, changelogLookup, mode),
	);

	// Add duplicate candidates (requires full list for cross-referencing)
	addDuplicateCandidates(enrichedIssues, rawIssues);

	// Assemble the evidence pack
	const runId = randomUUID();
	const now = new Date().toISOString();

	const meta: RunMetadata = {
		runId,
		timestamp: now,
		schemaVersion: config.schemaVersion,
		workflow: mode,
		queryParams: params,
		teamMembersRefreshedAt: now,
		changelogRefreshedAt: now,
		repo: `${config.owner}/${config.repo}`,
	};

	const pack: EvidencePack = {
		meta,
		teamMembers,
		issues: enrichedIssues,
	};

	// Write pack file
	await mkdir(config.packsDir, { recursive: true });
	const packPath = join(config.packsDir, `${runId}.json`);
	await writeFile(packPath, JSON.stringify(pack, null, '\t'));

	// Write latest symlink (as copy for cross-platform compatibility)
	const latestName =
		mode === 'reactive'
			? 'latest-reactive.json'
			: `latest-audit-batch-${(params as AuditQueryParams).batchNumber}.json`;
	const latestPath = join(config.packsDir, latestName);
	await copyFile(packPath, latestPath);

	console.error(`Evidence pack written: ${packPath}`);
	return packPath;
}

function enrichIssue(
	raw: GitHubIssue,
	teamSet: Set<string>,
	labelMap: Map<string, RepositoryLabel>,
	changelogLookup: Record<string, ChangelogEntry>,
	mode: Workflow,
): EnrichedIssue {
	// 1. isTeamMember
	const isTeamMember = teamSet.has(raw.author.toLowerCase());

	// 2. Enrich labels with descriptions
	const labels: IssueLabel[] = raw.labels.map(name => {
		const label = labelMap.get(name);
		return { name, description: label?.description ?? '' };
	});

	// 3. changelogEntry
	const changelogEntry = changelogLookup[`#${raw.number}`] ?? null;

	// 4. lastActivityAt
	const dates = [raw.updatedAt, ...raw.comments.map(c => c.createdAt)];
	const lastActivityAt = dates.reduce((a, b) => (a > b ? a : b));

	// 6. supersessionIndicators (audit mode only)
	const supersessionIndicators: string[] = [];
	if (mode === 'audit') {
		const textToScan = [raw.body, ...raw.comments.map(c => c.body)].join('\n');
		for (const pattern of supersessionPatterns) {
			const match = textToScan.match(pattern);
			if (match) {
				supersessionIndicators.push(match[0]);
			}
		}

		// Check if any linked PR is a revert
		for (const pr of raw.linkedPrs) {
			if (/\brevert\b/i.test(pr.title)) {
				supersessionIndicators.push(`Linked PR #${pr.number} appears to be a revert: "${pr.title}"`);
			}
		}
	}

	return {
		number: raw.number,
		title: raw.title,
		body: raw.body,
		state: raw.state,
		type: raw.type,
		labels,
		author: raw.author,
		authorAssociation: raw.authorAssociation,
		assignees: raw.assignees,
		milestone: raw.milestone,
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
		closedAt: raw.closedAt,
		comments: raw.comments,
		commentCount: raw.commentCount,
		linkedPrs: raw.linkedPrs,
		isTeamMember,
		changelogEntry,
		lastActivityAt,
		duplicateCandidates: [], // Filled in by addDuplicateCandidates
		supersessionIndicators,
	};
}

function addDuplicateCandidates(enriched: EnrichedIssue[], raw: GitHubIssue[]): void {
	const issueMap = new Map<number, EnrichedIssue>(enriched.map(i => [i.number, i]));

	for (const issue of enriched) {
		const candidates: DuplicateCandidate[] = [];
		const seen = new Set<number>();

		// Cross-reference pass: scan body and comments for #NNN patterns
		const textToScan = [issue.body, ...issue.comments.map(c => c.body)].join('\n');
		const refs = [...textToScan.matchAll(/#(\d+)/g)];
		for (const ref of refs) {
			const refNum = parseInt(ref[1], 10);
			if (refNum === issue.number || seen.has(refNum)) continue;
			seen.add(refNum);

			const target = issueMap.get(refNum);
			if (target) {
				candidates.push({
					number: target.number,
					title: target.title,
					state: target.state,
					closedAt: target.closedAt,
					similarityBasis: 'body-cross-reference',
				});
			}

			if (candidates.length >= config.duplicateCandidateLimit) break;
		}

		// Keyword pass: only if no cross-reference candidates found
		if (candidates.length === 0) {
			const issueWords = significantWords(issue.title);
			if (issueWords.size >= 3) {
				for (const other of enriched) {
					if (other.number === issue.number) continue;
					const otherWords = significantWords(other.title);
					const overlap = [...issueWords].filter(w => otherWords.has(w));
					if (overlap.length >= 3) {
						candidates.push({
							number: other.number,
							title: other.title,
							state: other.state,
							closedAt: other.closedAt,
							similarityBasis: `title-keyword-match (${overlap.join(', ')})`,
						});
						if (candidates.length >= config.duplicateCandidateLimit) break;
					}
				}
			}
		}

		issue.duplicateCandidates = candidates;
	}
}

function significantWords(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, '')
			.split(/\s+/)
			.filter(w => w.length > 2 && !stopWords.has(w)),
	);
}
