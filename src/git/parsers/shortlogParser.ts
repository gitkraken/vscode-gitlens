'use strict';
import { GitContributor, GitShortLog, GitUser } from '../git';
import { debug } from '../../system';

const shortlogRegex = /^(.*?)\t(.*?) <(.*?)>$/gm;

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
		};

		const contributors = new Map<string, Contributor>();

		for (const line of data.trim().split('\n')) {
			const [sha, author, email, date] = line.trim().split('\0');

			const timestamp = Number(date);

			const contributor = contributors.get(`${author}${email}`);
			if (contributor == null) {
				contributors.set(`${author}${email}`, {
					sha: sha,
					name: author,
					email: email,
					count: 1,
					timestamp: timestamp,
				});
			} else {
				contributor.count++;
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
									currentUser != null
										? currentUser.name === c.name && currentUser.email === c.email
										: false,
								),
					  ),
		};
	}
}
