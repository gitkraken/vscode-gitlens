import type { Container } from '../../container';
import { debug } from '../../system/decorators/log';
import { GitBranch } from '../models/branch';

const branchWithTrackingRegex =
	/^<h>(.+)<n>(.+)<u>(.*)<t>(?:\[(?:ahead ([0-9]+))?[,\s]*(?:behind ([0-9]+))?]|\[(gone)])?<r>(.*)<d>(.*)$/gm;

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%3c'; // `%${'<'.charCodeAt(0).toString(16)}`;
const rb = '%3e'; // `%${'>'.charCodeAt(0).toString(16)}`;

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class GitBranchParser {
	static defaultFormat = [
		`${lb}h${rb}%(HEAD)`, // HEAD indicator
		`${lb}n${rb}%(refname)`, // branch name
		`${lb}u${rb}%(upstream:short)`, // branch upstream
		`${lb}t${rb}%(upstream:track)`, // branch upstream tracking state
		`${lb}r${rb}%(objectname)`, // ref
		`${lb}d${rb}%(committerdate:iso8601)`, // committer date
	].join('');

	@debug({ args: false, singleLine: true })
	static parse(container: Container, data: string, repoPath: string): GitBranch[] {
		const branches: GitBranch[] = [];

		if (!data) return branches;

		let current;
		let name;
		let upstream;
		let ahead;
		let behind;
		let missing;
		let ref;
		let date;

		let remote;

		let match;
		do {
			match = branchWithTrackingRegex.exec(data);
			if (match == null) break;

			[, current, name, upstream, ahead, behind, missing, ref, date] = match;

			if (name.startsWith('refs/remotes/')) {
				// Strip off refs/remotes/
				name = name.substr(13);
				if (name.endsWith('/HEAD')) continue;

				remote = true;
			} else {
				// Strip off refs/heads/
				name = name.substr(11);
				remote = false;
			}

			branches.push(
				new GitBranch(
					container,
					repoPath,
					name,
					remote,
					current.charCodeAt(0) === 42, // '*',
					date ? new Date(date) : undefined,
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					ref == null || ref.length === 0 ? undefined : ` ${ref}`.substr(1),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					upstream == null || upstream.length === 0
						? undefined
						: { name: ` ${upstream}`.substr(1), missing: Boolean(missing) },
					Number(ahead) || 0,
					Number(behind) || 0,
				),
			);
		} while (true);

		return branches;
	}
}
