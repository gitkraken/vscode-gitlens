import type { FilteredGitFeatures } from '../../features';
import { maybeStopWatch } from '../../system/stopwatch';
import { iterateByDelimiter } from '../../system/string';
import type { Parser } from './logParser';

const branchMapping = {
	current: `%(HEAD)`, // HEAD indicator (current branch)
	name: `%(refname)`, // Full reference name
	upstream: `%(upstream)`, // Upstream branch, if any
	upstreamTracking: `%(upstream:track)`, // Tracking status
	sha: `%(objectname)`, // SHA
	date: `%(committerdate:iso8601)`, // Date
	worktreePath: undefined,
};

const branchMappingSupportsWorktreePath = {
	...branchMapping,
	worktreePath: '%(worktreepath)', // Worktree path
};

type BranchParser = Parser<typeof branchMapping> | Parser<typeof branchMappingSupportsWorktreePath>;

let _branchParser: BranchParser | undefined;
export function getBranchParser(supportedFeatures: FilteredGitFeatures<'git:for-each-ref'>[]): BranchParser {
	_branchParser ??= supportedFeatures.includes('git:for-each-ref:worktreePath')
		? createRefParser(branchMappingSupportsWorktreePath)
		: createRefParser(branchMapping);
	return _branchParser;
}

const tagMapping = {
	name: `%(refname)`, // Full reference name
	tagSha: `%(objectname)`, // sha of the tag
	sha: `%(*objectname)`, // sha of the commit the tag points to, if any
	date: `%(creatordate:iso8601)`, // date the tag was created
	commitDate: `%(authordate:iso8601)`, // author date of the commit the tag points to
	message: `%(subject)`, // message
};

type TagParser = Parser<typeof tagMapping>;
let _tagParser: TagParser | undefined;

export function getTagParser(): TagParser {
	_tagParser ??= createRefParser(tagMapping);
	return _tagParser;
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
		using sw = maybeStopWatch('Git.RefParser.parse', { log: false, logLevel: 'debug' });

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
