import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.mts';
import type { CacheFile, RepositoryLabel } from './types.mts';

const execFileAsync = promisify(execFile);

const cacheFile = join(config.cacheDir, 'labels.json');

export async function fetchLabels(forceRefresh?: boolean): Promise<RepositoryLabel[]> {
	if (!forceRefresh) {
		try {
			const raw = await readFile(cacheFile, 'utf8');
			const cached: CacheFile<RepositoryLabel[]> = JSON.parse(raw);
			const age = Date.now() - new Date(cached.fetchedAt).getTime();
			if (age < config.labelsCacheTtlMs) {
				return cached.data;
			}
		} catch {
			// Cache miss — fetch fresh
		}
	}

	const { stdout } = await execFileAsync('gh', [
		'api',
		`repos/${config.owner}/${config.repo}/labels`,
		'--paginate',
		'--jq',
		'[.[] | {name: .name, description: (.description // "")}]',
	]);

	// gh --paginate with --jq outputs one JSON array per page; merge them
	const labels: RepositoryLabel[] = [];
	for (const line of stdout.trim().split('\n')) {
		if (line) {
			const parsed: RepositoryLabel[] = JSON.parse(line);
			labels.push(...parsed);
		}
	}

	await mkdir(config.cacheDir, { recursive: true });
	const cache: CacheFile<RepositoryLabel[]> = {
		fetchedAt: new Date().toISOString(),
		data: labels,
	};
	await writeFile(cacheFile, JSON.stringify(cache, null, '\t'));

	return labels;
}
