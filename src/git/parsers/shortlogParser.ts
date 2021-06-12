'use strict';
import { debug } from '../../system';
import { GitContributor, GitShortLog, GitUser } from '../git';

const shortlogRegex = /^(.*?)\t(.*?) <(.*?)>$/gm;
const shortstatRegex =
	/(?<files>\d+) files? changed(?:, (?<additions>\d+) insertions?\(\+\))?(?:, (?<deletions>\d+) deletions?\(-\))?/;

export class GitShortLogParser {
	@debug({ args: false, singleLine: true })
	static parse(data: string, repoPath: string): GitShortLog | undefined {
		if (!data) return undefined;

		const contributors: GitContributor[] = [];

		let count;
		let name;
		let email;

		let match;
		do {
			match = shortlogRegex.exec(data);
			if (match == null) break;

			[, count, name, email] = match;

			contributors.push(
				new GitContributor(
					repoPath,
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					` ${name}`.substr(1),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					` ${email}`.substr(1),
					Number(count) || 0,
					new Date(),
				),
			);
		} while (true);

		return { repoPath: repoPath, contributors: contributors };
	}

	@debug({ args: false })
	static parseFromLog(data: string, repoPath: string, currentUser?: GitUser): GitShortLog | undefined {
		if (!data) return undefined;

		type Contributor = {
			sha: string;
			name: string;
			email: string;
			count: number;
			timestamp: number;
			stats?: {
				files: number;
				additions: number;
				deletions: number;
			};
		};

		const contributors = new Map<string, Contributor>();

		const lines = data.trim().split('\n');
		for (let i = 0; i < lines.length; i++) {
			const [sha, author, email, date] = lines[i].trim().split('\0');

			let stats:
				| {
						files: number;
						additions: number;
						deletions: number;
				  }
				| undefined;
			if (lines[i + 1] === '') {
				i += 2;
				const match = shortstatRegex.exec(lines[i]);

				if (match?.groups != null) {
					const { files, additions, deletions } = match.groups;
					stats = {
						files: Number(files || 0),
						additions: Number(additions || 0),
						deletions: Number(deletions || 0),
					};
				}
			}

			const timestamp = Number(date);

			const contributor = contributors.get(`${author}${email}`);
			if (contributor == null) {
				contributors.set(`${author}${email}`, {
					sha: sha,
					name: author,
					email: email,
					count: 1,
					timestamp: timestamp,
					stats: stats,
				});
			} else {
				contributor.count++;
				if (stats != null) {
					if (contributor.stats == null) {
						contributor.stats = stats;
					} else {
						contributor.stats.files += stats.files;
						contributor.stats.additions += stats.additions;
						contributor.stats.deletions += stats.deletions;
					}
				}
				if (timestamp > contributor.timestamp) {
					contributor.timestamp = timestamp;
				}
			}
		}

		return {
			repoPath: repoPath,
			contributors:
				contributors.size === 0
					? []
					: Array.from(
							contributors.values(),
							c =>
								new GitContributor(
									repoPath,
									c.name,
									c.email,
									c.count,
									new Date(Number(c.timestamp) * 1000),
									c.stats,
									currentUser != null
										? currentUser.name === c.name && currentUser.email === c.email
										: false,
								),
					  ),
		};
	}
}
