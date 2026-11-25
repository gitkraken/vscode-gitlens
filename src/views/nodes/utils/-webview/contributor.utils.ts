import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFile } from '@gitlens/git/models/file.js';

export function filterContributorFiles(
	commits: Iterable<GitCommit>,
	files: readonly GitFile[],
	rangeCommits: Iterable<GitCommit>,
	workingFiles?: readonly GitFile[],
): GitFile[] {
	const contributorShas = new Set([...commits].filter(c => !c.isMergeCommit).map(c => c.sha));
	const history = new Map(Array.from(rangeCommits, c => [c.sha, c]));
	const parentShas = new Set([...history.values()].flatMap(c => c.parents));
	const tips = [...history.values()].filter(c => !parentShas.has(c.sha));

	return files.filter(file => {
		let path = file.path;
		const workingChange = workingFiles?.find(f => f.path === file.path);
		if (workingChange?.status === 'R' && workingChange.originalPath != null) {
			path = workingChange.originalPath;
		} else if (workingChange?.status === 'A' || workingChange?.status === 'C' || workingChange?.status === '?') {
			return false;
		}

		const pending = tips.map(commit => ({ commit: commit, path: path }));
		const visited = new Set<string>();
		while (pending.length) {
			const { commit, path: currentPath } = pending.pop()!;
			const key = `${commit.sha}\0${currentPath}`;
			if (visited.has(key)) continue;

			visited.add(key);
			let previousPath = currentPath;
			if (!commit.isMergeCommit) {
				const change = commit.fileset?.files?.find(f => f.path === currentPath);
				if (change != null) {
					if (contributorShas.has(commit.sha)) return true;

					if (change.status === 'R' && change.originalPath != null) {
						previousPath = change.originalPath;
					} else if (change.status === 'A' || change.status === 'C') {
						continue;
					}
				}
			}

			for (const sha of commit.parents) {
				const parent = history.get(sha);
				if (parent != null) {
					pending.push({ commit: parent, path: previousPath });
				}
			}
		}

		return false;
	});
}
