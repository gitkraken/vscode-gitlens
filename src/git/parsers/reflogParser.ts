import type { Container } from '../../container';
import { maybeStopWatch } from '../../system/stopwatch';
import type { GitReflog } from '../models/reflog';
import { GitReflogRecord } from '../models/reflog';

const reflogRegex = /^<r>(.+)<d>(.+?)@{(.+)}<s>(\w*)(.*?)(?::(.*))?$/gm;
// const reflogRegex = /^<r>(.+)<d>(.+?)@{(.+)}<s>(\w*)(.*?)(?::(.*))?<n>(.*)$/gm;
const reflogHEADRegex = /.*?\/?HEAD$/;

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%x3c'; // `%x${'<'.charCodeAt(0).toString(16)}`;
const rb = '%x3e'; // `%x${'>'.charCodeAt(0).toString(16)}`;

export const parseGitRefLogDefaultFormat = [
	`${lb}r${rb}%H`, // ref
	`${lb}d${rb}%gD`, // reflog selector (with iso8601 timestamp)
	`${lb}s${rb}%gs`, // reflog subject
	// `${lb}n${rb}%D` // ref names
].join('');

export function parseGitRefLog(
	container: Container,
	data: string,
	repoPath: string,
	commands: string[],
	limit: number,
	totalLimit: number,
): GitReflog | undefined {
	using sw = maybeStopWatch(`Git.parseRefLog(${repoPath})`, { log: false, logLevel: 'debug' });
	if (!data) return undefined;

	const records: GitReflogRecord[] = [];

	let sha;
	let selector;
	let date;
	let command;
	let commandArgs;
	let details;

	let head;
	let headDate;
	let headSha;

	let count = 0;
	let total = 0;
	let recordDate;
	let record: GitReflogRecord | undefined;

	let match;
	do {
		match = reflogRegex.exec(data);
		if (match == null) break;

		[, sha, selector, date, command, commandArgs, details] = match;

		total++;

		if (record !== undefined) {
			// If the next record has the same sha as the previous, use it if it is not pointing to just HEAD and the previous is
			if (
				sha === record.sha &&
				(date !== recordDate || !reflogHEADRegex.test(record.selector) || reflogHEADRegex.test(selector))
			) {
				continue;
			}

			if (sha !== record.sha) {
				if (
					head != null &&
					headDate === recordDate &&
					headSha === record.sha &&
					reflogHEADRegex.test(record.selector)
				) {
					record.update(sha, head);
				} else {
					record.update(sha);
				}

				records.push(record);
				record = undefined;
				recordDate = undefined;

				count++;
				if (limit !== 0 && count >= limit) break;
			}
		}

		if (command === 'HEAD') {
			head = selector;
			headDate = date;
			headSha = sha;

			continue;
		}

		if (commands.includes(command)) {
			record = new GitReflogRecord(
				container,
				repoPath,
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				` ${sha}`.substring(1),
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				` ${selector}`.substring(1),
				new Date(date),
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				` ${command}`.substring(1),
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				commandArgs == null || commandArgs.length === 0 ? undefined : commandArgs.substring(1),
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				details == null || details.length === 0 ? undefined : details.substring(1),
			);
			recordDate = date;
		}
	} while (true);

	// Ensure the regex state is reset
	reflogRegex.lastIndex = 0;

	sw?.stop({ suffix: ` parsed ${records.length} records` });

	return {
		repoPath: repoPath,
		records: records,
		count: count,
		total: total,
		limit: limit,
		hasMore: (limit !== 0 && count >= limit) || (totalLimit !== 0 && total >= totalLimit),
	};
}
