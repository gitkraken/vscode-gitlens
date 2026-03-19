import type { GitReflog } from '@gitlens/git/models/reflog.js';
import { GitReflogRecord } from '@gitlens/git/models/reflog.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import type { LogParser } from './logParser.js';
import { createLogParser } from './logParser.js';

// Layer 1 — Raw parser: extracts fields using binary separators via createLogParser

const reflogMapping = {
	sha: '%H',
	selector: '%gD',
	subject: '%gs',
};

type ReflogLogParser = LogParser<typeof reflogMapping>;
let _reflogParser: ReflogLogParser | undefined;

export function getReflogParser(): ReflogLogParser {
	_reflogParser ??= createLogParser(reflogMapping);
	return _reflogParser;
}

// Layer 2 — Smart parser: correlates raw entries into GitReflogRecords

function isHEADSelector(selector: string): boolean {
	return selector === 'HEAD' || selector.endsWith('/HEAD');
}

export function parseGitRefLog(
	parser: ReflogLogParser,
	data: string,
	repoPath: string,
	commands: string[],
	limit: number,
	totalLimit: number,
): GitReflog | undefined {
	using sw = maybeStopWatch(`Git.parseRefLog(${repoPath})`, { log: { onlyExit: true, level: 'debug' } });
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return undefined;
	}

	const records: GitReflogRecord[] = [];

	let sha: string;
	let selector: string;
	let date: string;
	let command: string;
	let commandArgs: string | undefined;
	let details: string | undefined;

	let head: string | undefined;
	let headDate: string | undefined;
	let headSha: string | undefined;

	let count = 0;
	let total = 0;
	let recordDate: string | undefined;
	let record: GitReflogRecord | undefined;

	let idx: number;

	for (const entry of parser.parse(data)) {
		// Parse selector: "refs/heads/main@{date}" → selector + date
		idx = entry.selector.indexOf('@{');
		if (idx === -1) continue;

		selector = entry.selector.substring(0, idx);
		date = entry.selector.substring(idx + 2, entry.selector.length - 1);
		sha = entry.sha;

		// Extract command early (everything before the first space or colon)
		// to allow skipping the full subject parse for filtered-out entries
		const subject = entry.subject;
		const spaceIdx = subject.indexOf(' ');
		const colonIdx = subject.indexOf(':');

		if (spaceIdx === -1 && colonIdx === -1) {
			command = subject;
		} else if (colonIdx !== -1 && (spaceIdx === -1 || colonIdx < spaceIdx)) {
			command = subject.substring(0, colonIdx);
		} else {
			command = subject.substring(0, spaceIdx);
		}

		total++;

		if (record !== undefined) {
			// If the next record has the same sha as the previous, use it if it is not pointing to just HEAD and the previous is
			if (
				sha === record.sha &&
				(date !== recordDate || !isHEADSelector(record.selector) || isHEADSelector(selector))
			) {
				continue;
			}

			if (sha !== record.sha) {
				if (
					head != null &&
					headDate === recordDate &&
					headSha === record.sha &&
					isHEADSelector(record.selector)
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
			// Only parse args/details when we're actually creating a record
			if (colonIdx === -1) {
				commandArgs = spaceIdx !== -1 ? subject.substring(spaceIdx + 1) : undefined;
				details = undefined;
			} else {
				const commandAndArgs = subject.substring(0, colonIdx);
				idx = commandAndArgs.indexOf(' ');
				commandArgs = idx !== -1 ? commandAndArgs.substring(idx + 1) : undefined;
				details = colonIdx < subject.length - 1 ? subject.substring(colonIdx + 1).trimStart() : undefined;
			}

			record = new GitReflogRecord(repoPath, sha, selector, new Date(date), command, commandArgs, details);
			recordDate = date;
		}
	}

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
