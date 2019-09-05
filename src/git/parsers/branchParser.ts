'use strict';
import { GitBranch } from '../models/branch';
import { debug } from '../../system';

const branchWithTrackingRegex = /^<h>(.+)<n>(.+)<u>(.*)<t>(?:\[(?:ahead ([0-9]+))?[,\s]*(?:behind ([0-9]+))?]|\[gone])?<r>(.*)<d>(.*)$/gm;

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%3c'; // `%${'<'.charCodeAt(0).toString(16)}`;
const rb = '%3e'; // `%${'>'.charCodeAt(0).toString(16)}`;

export class GitBranchParser {
	static defaultFormat = [
		`${lb}h${rb}%(HEAD)`, // HEAD indicator
		`${lb}n${rb}%(refname)`, // branch name
		`${lb}u${rb}%(upstream:short)`, // branch upstream
		`${lb}t${rb}%(upstream:track)`, // branch upstream tracking state
		`${lb}r${rb}%(objectname)`, // ref
		`${lb}d${rb}%(committerdate:unix)` // committer date
	].join('');

	@debug({ args: false, singleLine: true })
	static parse(data: string, repoPath: string): GitBranch[] {
		const branches: GitBranch[] = [];

		if (!data) return branches;

		let current;
		let name;
		let tracking;
		let ahead;
		let behind;
		let ref;
		let date;

		let remote;

		let match: RegExpExecArray | null;
		do {
			match = branchWithTrackingRegex.exec(data);
			if (match == null) break;

			[, current, name, tracking, ahead, behind, ref, date] = match;

			if (name.startsWith('refs/remotes/')) {
				// Strip off refs/remotes/
				name = name.substr(13);
				remote = true;
			} else {
				// Strip off refs/heads/
				name = name.substr(11);
				remote = false;
			}

			branches.push(
				new GitBranch(
					repoPath,
					name,
					remote,
					current.charCodeAt(0) === 42, // '*',
					new Date(Number(date) * 1000),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					ref == null || ref.length === 0 ? undefined : ` ${ref}`.substr(1),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					tracking == null || tracking.length === 0 ? undefined : ` ${tracking}`.substr(1),
					Number(ahead) || 0,
					Number(behind) || 0
				)
			);
		} while (match != null);

		return branches;
	}
}
