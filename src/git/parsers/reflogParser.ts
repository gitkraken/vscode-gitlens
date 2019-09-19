'use strict';
import { debug } from '../../system';
import { GitReflog, GitReflogRecord } from '../models/reflog';

const reflogRegex = /^<r>(.+)<d>(.+?)@{(.+)}<s>(\w*)(.*?)(?::(.*))?$/gm;
// const reflogRegex = /^<r>(.+)<d>(.+?)@{(.+)}<s>(\w*)(.*?)(?::(.*))?<n>(.*)$/gm;
const reflogHEADRegex = /.*?\/?HEAD$/;

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%x3c'; // `%x${'<'.charCodeAt(0).toString(16)}`;
const rb = '%x3e'; // `%x${'>'.charCodeAt(0).toString(16)}`;

export class GitReflogParser {
	static defaultFormat = [
		`${lb}r${rb}%H`, // ref
		`${lb}d${rb}%gD`, // reflog selector (with UNIX timestamp)
		`${lb}s${rb}%gs` // reflog subject
		// `${lb}n${rb}%D` // ref names
	].join('');

	@debug({ args: false })
	static parse(data: string, repoPath: string, commands: string[], maxCount: number): GitReflog | undefined {
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
		let recordDate;
		let record: GitReflogRecord | undefined;
		let truncated = false;

		let match;
		do {
			match = reflogRegex.exec(data);
			if (match == null) break;

			[, sha, selector, date, command, commandArgs, details] = match;

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
						headSha == record.sha &&
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
					if (maxCount !== 0 && count >= maxCount) {
						truncated = true;
						break;
					}
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
					repoPath,
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					` ${sha}`.substr(1),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					` ${selector}`.substr(1),
					new Date(Number(date) * 1000),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					` ${command}`.substr(1),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					commandArgs == null || commandArgs.length === 0 ? undefined : commandArgs.substr(1),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					details == null || details.length === 0 ? undefined : details.substr(1)
				);
				recordDate = date;
			}
		} while (true);

		// Ensure the regex state is reset
		reflogRegex.lastIndex = 0;

		return {
			repoPath: repoPath,
			records: records,
			count: count,
			maxCount: maxCount,
			truncated: truncated
		};
	}
}
