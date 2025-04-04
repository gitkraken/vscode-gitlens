import { iterateByDelimiters } from '../../system/string';
import type { Parser } from './logParser';

type BranchParser = Parser<{
	current: string;
	name: string;
	upstream: string;
	upstreamTracking: string;
	sha: string;
	date: string;
	worktreePath?: string;
}>;

let _branchParser: BranchParser | undefined;
export function getBranchParser(supportsWorktreePath: boolean): BranchParser {
	_branchParser ??= createRefParser({
		current: `%(if)%(HEAD)%(then)*%(else) %(end)`, // HEAD indicator (current branch)
		name: `%(refname)`, // Full reference name
		upstream: `%(upstream)`, // Upstream branch, if any
		upstreamTracking: `%(upstream:track)`, // Tracking status
		sha: `%(objectname)`, // SHA
		date: `%(committerdate:iso8601)`, // Date
		worktreePath: supportsWorktreePath ? '%(worktreepath)' : undefined, // Worktree path
	});
	return _branchParser;
}

type TagParser = Parser<{
	name: string;
	sha: string;
	date: string;
	commitDate: string;
	message: string;
}>;

let _tagParser: TagParser | undefined;
export function getTagParser(): TagParser {
	_tagParser ??= createRefParser({
		name: `%(refname)`, // Full reference name
		sha: `%(if)%(*objectname)%(then)%(*objectname)%(else)%(objectname)%(end)`, // sha of the commit the tag points to or sha of the tag
		date: `%(creatordate:iso8601)`, // date the tag was created
		commitDate: `%(authordate:iso8601)`, // author date of the commit the tag points to
		message: `%(subject)`, // message
	});
	return _tagParser;
}

export function createRefParser<T extends Record<string, unknown>>(
	fieldMapping: ExtractAll<T, string | undefined>,
): Parser<T> {
	let format = '';
	const keys: (keyof ExtractAll<T, string>)[] = [];
	for (const key in fieldMapping) {
		const value = fieldMapping[key];
		if (!value) continue;

		keys.push(key);
		format += `%00${value}`;
	}

	const args = [`--format=${format}`];

	function* parse(data: string | string[]): Generator<T> {
		if (!data) return;

		let entry = {} as unknown as T;
		let fieldCount = 0;
		let field;
		let prop: keyof T;

		const fields = iterateByDelimiters(data, '\0');
		// Skip the first field
		fields.next();

		while (true) {
			field = fields.next();
			if (field.done) break;

			prop = keys[fieldCount++];
			if (fieldCount === keys.length) {
				// Remove the trailing newline from the last field
				entry[prop] = field.value.trim() as T[keyof T];
				fieldCount = 0;
				yield entry;

				entry = {} as unknown as T;
			} else {
				entry[prop] = field.value as T[keyof T];
			}
		}
	}

	return { arguments: args, parse: parse };
}
