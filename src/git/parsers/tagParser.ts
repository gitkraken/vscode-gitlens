'use strict';
import { GitTag } from '../git';
import { debug } from '../../system';

const tagRegex = /^<n>(.+)<r>(.*)<d>(.*)<ad>(.*)<s>(.*)$/gm;

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%3c'; // `%${'<'.charCodeAt(0).toString(16)}`;
const rb = '%3e'; // `%${'>'.charCodeAt(0).toString(16)}`;

export class GitTagParser {
	static defaultFormat = [
		`${lb}n${rb}%(refname)`, // tag name
		`${lb}r${rb}%(if)%(*objectname)%(then)%(*objectname)%(else)%(objectname)%(end)`, // ref
		`${lb}d${rb}%(creatordate:iso8601)`, // created date
		`${lb}ad${rb}%(authordate:iso8601)`, // author date
		`${lb}s${rb}%(subject)`, // message
	].join('');

	@debug({ args: false, singleLine: true })
	static parse(data: string, repoPath: string): GitTag[] | undefined {
		if (!data) return undefined;

		const tags: GitTag[] = [];

		let name;
		let ref;
		let date;
		let commitDate;
		let message;

		let match;
		do {
			match = tagRegex.exec(data);
			if (match == null) break;

			[, name, ref, date, commitDate, message] = match;

			// Strip off refs/tags/
			name = name.substr(10);

			tags.push(
				new GitTag(
					repoPath,
					name,
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					` ${ref}`.substr(1),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					` ${message}`.substr(1),
					new Date(date),
					commitDate == null || commitDate.length === 0 ? undefined : new Date(commitDate),
				),
			);
		} while (true);

		return tags;
	}
}
