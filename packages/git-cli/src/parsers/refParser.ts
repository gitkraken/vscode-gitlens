import type { FilteredGitFeatures } from '@gitlens/git/features.js';
import type { RefRecord } from '@gitlens/git/models/reference.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { iterateByDelimiter } from '@gitlens/utils/string.js';
import type { ExtractAll } from '@gitlens/utils/types.js';
import type { Parser } from './logParser.js';

/**
 * Unified `for-each-ref` mapping covering branches, remotes, and tags in a single pass.
 * Fields inapplicable to a given ref-type come back as empty strings from git.
 *
 * NOTE: When adding a new field that is gated on a git feature flag, mirror the entry in
 * `refMappingSupportsWorktreePath` (and any future variants) — both maps MUST stay aligned
 * so callers can switch parsers based on `git.supported('git:for-each-ref')` without losing
 * field positions.
 */
const refMapping = {
	current: `%(HEAD)`,
	name: `%(refname)`,
	objectname: `%(objectname)`,
	peeledObjectname: `%(*objectname)`,
	upstream: `%(upstream)`,
	upstreamTracking: `%(upstream:track)`,
	committerDate: `%(committerdate:iso8601)`,
	creatorDate: `%(creatordate:iso8601)`,
	authorDate: `%(authordate:iso8601)`,
	subject: `%(subject)`,
	worktreePath: undefined,
};

const refMappingSupportsWorktreePath = {
	...refMapping,
	worktreePath: '%(worktreepath)',
};

type RefParser = Parser<RefRecord>;

let _refParser: RefParser | undefined;
let _refParserWithWorktree: RefParser | undefined;

export function getRefParser(supportedFeatures: FilteredGitFeatures<'git:for-each-ref'>[]): RefParser {
	if (supportedFeatures.includes('git:for-each-ref:worktreePath')) {
		_refParserWithWorktree ??= createRefParser(refMappingSupportsWorktreePath);
		return _refParserWithWorktree;
	}

	_refParser ??= createRefParser(refMapping);
	return _refParser;
}

const recordSep = '\x1E'; // ASCII Record Separator character
const recordFormatSep = '%1E';
const fieldSep = '\x1D'; // ASCII Group Separator character
const fieldFormatSep = '%1D';

function createRefParser<T extends Record<string, string | undefined>>(
	mapping: ExtractAll<T, string | undefined>,
): Parser<T> {
	let format = recordFormatSep;
	const keys: (keyof ExtractAll<T, string>)[] = [];
	for (const key in mapping) {
		const value = mapping[key];
		if (!value) continue;

		keys.push(key);
		format += `${mapping[key]}${fieldFormatSep}`;
	}

	const args = [`--format=${format}`];

	function* parse(data: string | Iterable<string> | undefined): Generator<T> {
		using sw = maybeStopWatch('Git.RefParser.parse', { log: { onlyExit: true, level: 'debug' } });

		if (!data) {
			sw?.stop({ suffix: ` no data` });
			return;
		}

		const records = iterateByDelimiter(data, recordSep);

		let count = 0;
		let entry: T;
		let fields: IterableIterator<string>;

		for (const record of records) {
			if (!record.length) continue;

			count++;
			entry = {} as unknown as T;
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;

			while (true) {
				field = fields.next();
				if (field.done) break;
				if (fieldCount >= keys.length) continue; // Handle extra newlines at the end

				entry[keys[fieldCount++]] = field.value as T[keyof T];
			}

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

	return { arguments: args, separators: { record: recordSep, field: fieldSep }, parse: parse };
}
