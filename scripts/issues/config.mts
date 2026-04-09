export const config = {
	owner: 'gitkraken',
	repo: 'vscode-gitlens',
	cacheDir: '.work/triage/cache',
	packsDir: '.work/triage/packs',
	reportsDir: '.work/triage/reports',
	teamCacheTtlMs: 4 * 60 * 60 * 1000, // 4 hours
	changelogCacheTtlMs: 1 * 60 * 60 * 1000, // 1 hour
	labelsCacheTtlMs: 24 * 60 * 60 * 1000, // 24 hours
	issueCommentLimit: 3,
	duplicateCandidateLimit: 5,
	staleInactivityDays: 365,
	auditBatchSize: 50,
	singleIssueBatchLimit: 10, // Max issues per GraphQL alias query
	graphqlRetryMaxAttempts: 3,
	graphqlRetryBackoffMs: 60_000, // 60 seconds, doubled on each retry
	schemaVersion: '1.0',
} as const;
