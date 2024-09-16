import { maybeStopWatch } from '../../system/stopwatch';
import { GitTag } from '../models/tag';

const tagRegex = /^<n>(.+)<\*r>(.*)<r>(.*)<d>(.*)<ad>(.*)<s>(.*)$/gm;

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%3c'; // `%${'<'.charCodeAt(0).toString(16)}`;
const rb = '%3e'; // `%${'>'.charCodeAt(0).toString(16)}`;

export const parseGitTagsDefaultFormat = [
	`${lb}n${rb}%(refname)`, // tag name
	`${lb}*r${rb}%(*objectname)`, // ref
	`${lb}r${rb}%(objectname)`, // ref
	`${lb}d${rb}%(creatordate:iso8601)`, // created date
	`${lb}ad${rb}%(authordate:iso8601)`, // author date
	`${lb}s${rb}%(subject)`, // message
].join('');

export function parseGitTags(data: string, repoPath: string): GitTag[] {
	using sw = maybeStopWatch(`Git.parseTags(${repoPath})`, { log: false, logLevel: 'debug' });

	const tags: GitTag[] = [];
	if (!data) return tags;

	let name;
	let ref1;
	let ref2;
	let date;
	let commitDate;
	let message;

	let match;
	do {
		match = tagRegex.exec(data);
		if (match == null) break;

		[, name, ref1, ref2, date, commitDate, message] = match;

		// Strip off refs/tags/
		name = name.substring(10);

		tags.push(
			new GitTag(
				repoPath,
				name,
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				` ${ref1 || ref2}`.substring(1),
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				` ${message}`.substring(1),
				date ? new Date(date) : undefined,
				commitDate == null || commitDate.length === 0 ? undefined : new Date(commitDate),
			),
		);
	} while (true);

	sw?.stop({ suffix: ` parsed ${tags.length} tags` });

	return tags;
}
