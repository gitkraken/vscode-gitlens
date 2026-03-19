import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.mts';
import type { CacheFile, ChangelogEntry } from './types.mts';

const cacheFile = join(config.cacheDir, 'changelog-lookup.json');

type ChangeType = ChangelogEntry['changeType'];

const changeTypeMap: Record<string, ChangeType> = {
	added: 'Added',
	changed: 'Changed',
	fixed: 'Fixed',
	deprecated: 'Deprecated',
	removed: 'Removed',
};

export async function fetchChangelogLookup(forceRefresh?: boolean): Promise<Record<string, ChangelogEntry>> {
	if (!forceRefresh) {
		try {
			const raw = await readFile(cacheFile, 'utf8');
			const cached: CacheFile<Record<string, ChangelogEntry>> = JSON.parse(raw);
			const age = Date.now() - new Date(cached.fetchedAt).getTime();
			if (age < config.changelogCacheTtlMs) {
				return cached.data;
			}
		} catch {
			// Cache miss — parse fresh
		}
	}

	const content = await readFile('CHANGELOG.md', 'utf8');
	const lookup = parseChangelog(content);

	await mkdir(config.cacheDir, { recursive: true });
	const cache: CacheFile<Record<string, ChangelogEntry>> = {
		fetchedAt: new Date().toISOString(),
		data: lookup,
	};
	await writeFile(cacheFile, JSON.stringify(cache, null, '\t'));

	return lookup;
}

function parseChangelog(content: string): Record<string, ChangelogEntry> {
	const lookup: Record<string, ChangelogEntry> = {};

	let currentVersion: string | null = null;
	let currentChangeType: ChangeType | null = null;

	for (const line of content.split('\n')) {
		// Version header: ## [x.y.z] or ## [Unreleased]
		const versionMatch = line.match(/^## \[([^\]]+)\]/);
		if (versionMatch) {
			currentVersion = versionMatch[1];
			currentChangeType = null;
			continue;
		}

		// Change type sub-header: ### Added, ### Fixed, etc.
		const typeMatch = line.match(/^### (\w+)/);
		if (typeMatch) {
			const mapped = changeTypeMap[typeMatch[1].toLowerCase()];
			currentChangeType = mapped ?? null;
			continue;
		}

		// List item with issue references
		if (currentVersion != null && currentChangeType != null && line.match(/^\s*-\s/)) {
			const issueRefs = [...line.matchAll(/#(\d+)/g)];
			for (const ref of issueRefs) {
				const key = `#${ref[1]}`;
				// Keep the earliest released version (first occurrence wins
				// since changelog is ordered newest-first, the last write wins
				// for "earliest" — so we always overwrite to get the oldest)
				lookup[key] = {
					version: currentVersion,
					changeType: currentChangeType,
					entry: line.replace(/^\s*-\s*/, '').trim(),
				};
			}
		}
	}

	return lookup;
}
