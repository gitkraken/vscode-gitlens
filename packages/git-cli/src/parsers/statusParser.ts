import { GitStatus } from '@gitlens/git/models/status.js';
import { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import type { Uri } from '@gitlens/utils/uri.js';

const aheadStatusV1Regex = /(?:ahead ([0-9]+))/;
const behindStatusV1Regex = /(?:behind ([0-9]+))/;
const quoteRegex = /"/g;
const submoduleCharCode = 'S'.charCodeAt(0);

/** Returns the index just after the `n`th space, or -1 if the line has fewer than `n` spaces. */
function indexAfterNthSpace(line: string, n: number): number {
	let index = -1;
	for (let i = 0; i < n; i++) {
		index = line.indexOf(' ', index + 1);
		if (index === -1) return -1;
	}

	return index + 1;
}

/** Without `getUri`, each file builds its uri on first read rather than during the parse */
export function parseGitStatus(
	data: string,
	repoPath: string,
	porcelainVersion: number,
	getUri?: (path: string) => Uri,
): GitStatus | undefined {
	using sw = maybeStopWatch(`Git.parseStatus(${repoPath}, v=${porcelainVersion})`, {
		log: { onlyExit: true, level: 'debug' },
	});
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return undefined;
	}

	const lines = data.split('\n').filter(<T>(i?: T): i is T => Boolean(i));
	if (lines.length === 0) {
		sw?.stop({ suffix: ` parsed no files` });
		return undefined;
	}

	const status =
		porcelainVersion < 2 ? parseStatusV1(lines, repoPath, getUri) : parseStatusV2(lines, repoPath, getUri);

	sw?.stop({ suffix: ` parsed ${status.files.length} files` });

	return status;
}

function parseStatusV1(lines: string[], repoPath: string, getUri: ((path: string) => Uri) | undefined): GitStatus {
	let branch: string | undefined;
	const files = [];
	const state = {
		ahead: 0,
		behind: 0,
	};
	let upstream;
	let missing = false;

	let position = -1;
	while (++position < lines.length) {
		const line = lines[position];
		// Header
		if (line.startsWith('##')) {
			const lineParts = line.split(' ');
			[branch, upstream] = lineParts[1].split('...');
			if (lineParts.length > 2) {
				const upstreamStatus = lineParts.slice(2).join(' ');
				if (upstreamStatus === '[gone]') {
					missing = true;
					state.ahead = 0;
					state.behind = 0;
				} else {
					const aheadStatus = aheadStatusV1Regex.exec(upstreamStatus);
					state.ahead = aheadStatus == null ? 0 : Number(aheadStatus[1]) || 0;

					const behindStatus = behindStatusV1Regex.exec(upstreamStatus);
					state.behind = behindStatus == null ? 0 : Number(behindStatus[1]) || 0;
				}
			}
		} else {
			const rawStatus = line.substring(0, 2);
			const fileName = line.substring(3);
			if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
				const [file1, file2] = fileName.replace(quoteRegex, '').split(' -> ');
				files.push(parseStatusFile(repoPath, rawStatus, file2.trim(), getUri, file1.trim()));
			} else {
				files.push(parseStatusFile(repoPath, rawStatus, fileName, getUri));
			}
		}
	}

	return new GitStatus(
		normalizePath(repoPath),
		branch ?? '',
		'',
		files,
		upstream ? { name: upstream, missing: missing, state: state } : undefined,
	);
}

function parseStatusV2(lines: string[], repoPath: string, getUri: ((path: string) => Uri) | undefined): GitStatus {
	let branch: string | undefined;
	const files = [];
	let sha: string | undefined;
	const state = {
		ahead: 0,
		behind: 0,
	};
	let missing = true;
	let upstream;

	let position = -1;
	while (++position < lines.length) {
		const line = lines[position];
		// Headers
		if (line.startsWith('#')) {
			const lineParts = line.split(' ');
			switch (lineParts[1]) {
				case 'branch.oid':
					sha = lineParts[2];
					break;
				case 'branch.head':
					branch = lineParts[2];
					break;
				case 'branch.upstream':
					upstream = lineParts[2];
					break;
				case 'branch.ab':
					missing = false;
					state.ahead = Number(lineParts[2].substring(1));
					state.behind = Number(lineParts[3].substring(1));
					break;
			}
		} else {
			switch (line[0]) {
				case '1': {
					// normal: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
					const pathStart = indexAfterNthSpace(line, 8);
					if (pathStart === -1) break;

					// <sub> starts with 'S' if submodule, 'N' if not
					let submodule;
					if (line.charCodeAt(5) === submoduleCharCode) {
						const parts = line.split(' ');
						submodule = { oid: parts[7], previousOid: parts[6] };
					}

					files.push(
						parseStatusFile(
							repoPath,
							line.substring(2, 4),
							line.substring(pathStart),
							getUri,
							undefined,
							submodule,
						),
					);
					break;
				}
				case '2': {
					// rename: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
					const pathStart = indexAfterNthSpace(line, 9);
					if (pathStart === -1) break;

					let submodule;
					if (line.charCodeAt(5) === submoduleCharCode) {
						const parts = line.split(' ');
						submodule = { oid: parts[7], previousOid: parts[6] };
					}

					const tab = line.indexOf('\t', pathStart);
					files.push(
						parseStatusFile(
							repoPath,
							line.substring(2, 4),
							tab === -1 ? line.substring(pathStart) : line.substring(pathStart, tab),
							getUri,
							tab === -1 ? undefined : line.substring(tab + 1),
							submodule,
						),
					);
					break;
				}
				case 'u': {
					// unmerged: u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
					const pathStart = indexAfterNthSpace(line, 10);
					if (pathStart === -1) break;

					let submodule;
					if (line.charCodeAt(5) === submoduleCharCode) {
						const parts = line.split(' ');
						submodule = { oid: parts[9], previousOid: parts[7] };
					}

					files.push(
						parseStatusFile(
							repoPath,
							line.substring(2, 4),
							line.substring(pathStart),
							getUri,
							undefined,
							submodule,
						),
					);
					break;
				}
				case '?': // untracked
					files.push(parseStatusFile(repoPath, '??', line.substring(2), getUri));
					break;
			}
		}
	}

	return new GitStatus(
		normalizePath(repoPath),
		branch ?? '',
		sha ?? '',
		files,
		upstream ? { name: upstream, missing: missing, state: state } : undefined,
	);
}

function parseStatusFile(
	repoPath: string,
	rawStatus: string,
	fileName: string,
	getUri: ((path: string) => Uri) | undefined,
	originalFileName?: string,
	submodule?: { readonly oid: string; readonly previousOid?: string },
): GitStatusFile {
	let x = !rawStatus.startsWith('.') ? rawStatus[0].trim() : undefined;
	if (x == null || x.length === 0) {
		x = undefined;
	}

	let y = undefined;
	if (rawStatus.length > 1) {
		y = rawStatus[1] !== '.' ? rawStatus[1].trim() : undefined;
		if (y == null || y.length === 0) {
			y = undefined;
		}
	}

	return new GitStatusFile(repoPath, x, y, fileName, getUri?.(fileName), originalFileName, submodule);
}
