import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.mts';
import type { CacheFile } from './types.mts';

const execFileAsync = promisify(execFile);

const cacheFile = join(config.cacheDir, 'team-members.json');

export async function fetchTeamMembers(forceRefresh?: boolean): Promise<string[]> {
	if (!forceRefresh) {
		try {
			const raw = await readFile(cacheFile, 'utf8');
			const cached: CacheFile<string[]> = JSON.parse(raw);
			const age = Date.now() - new Date(cached.fetchedAt).getTime();
			if (age < config.teamCacheTtlMs) {
				return cached.data;
			}
		} catch {
			// Cache miss — fetch fresh
		}
	}

	const { stdout } = await execFileAsync('gh', [
		'api',
		`/orgs/${config.owner}/members`,
		'--paginate',
		'--jq',
		'[.[].login]',
	]);

	// gh --paginate with --jq outputs one JSON array per page; merge them
	const members: string[] = [];
	for (const line of stdout.trim().split('\n')) {
		if (line) {
			const parsed: string[] = JSON.parse(line);
			members.push(...parsed);
		}
	}

	await mkdir(config.cacheDir, { recursive: true });
	const cache: CacheFile<string[]> = {
		fetchedAt: new Date().toISOString(),
		data: members,
	};
	await writeFile(cacheFile, JSON.stringify(cache, null, '\t'));

	return members;
}
