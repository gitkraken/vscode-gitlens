import { iterateByDelimiter } from '../../system/string';
import { GitContributor } from '../models/contributor';
import type { GitShortLog } from '../models/shortlog';
import type { GitUser } from '../models/user';
import { isUserMatch } from '../utils/user.utils';

export function parseShortlog(data: string, repoPath: string, currentUser: GitUser | undefined): GitShortLog {
	if (!data) return { repoPath: repoPath, contributors: [] };

	// Format: [count] [name] [<email>]

	const contributors = new Map<string, GitContributor>();

	for (let line of iterateByDelimiter(data, '\n')) {
		line = line.trim();
		if (!line) continue;

		// Find the first tab to separate the count from the rest
		let index = line.indexOf('\t');
		if (index === -1) continue;

		// Extract the count portion and the rest of the line
		const count = parseInt(line.substring(0, index), 10);
		if (isNaN(count)) continue;

		// Skip any additional spaces between count and name
		index++;
		while (index < line.length && line[index] === ' ') {
			index++;
		}

		// Look for email enclosed in angle brackets
		let name: string;
		let email: string | undefined;

		const emailStartIndex = line.lastIndexOf(' <');
		const emailEndIndex = line.lastIndexOf('>');

		if (emailStartIndex !== -1 && emailEndIndex !== -1 && emailEndIndex > emailStartIndex) {
			name = line.substring(index, emailStartIndex);
			email = line.substring(emailStartIndex + 2, emailEndIndex); // +2 to skip ' <'
		} else {
			name = line.substring(index);
			email = undefined;
		}

		const key = `${name}|${email ?? ''}`;
		let contributor = contributors.get(key);
		if (contributor == null) {
			contributor = new GitContributor(repoPath, name, email, isUserMatch(currentUser, name, email), count);
			contributors.set(key, contributor);
		} else {
			(contributor as Mutable<GitContributor>).contributionCount += count;
		}
	}

	return { repoPath: repoPath, contributors: [...contributors.values()] };
}
