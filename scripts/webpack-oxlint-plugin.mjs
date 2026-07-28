import { spawn } from 'child_process';
import { statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OXLINT_PLUGIN = 'OxLintWebpackPlugin';
const CHILD_PROCESS_MAX_FILES = 10;
const BLANK_SPACE = '⠀';

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let counter = 0;

/**
 * The whole-project type-aware pass, shared by every plugin instance in the process. Type diagnostics
 * only surface for the files oxlint is given, so a file-scoped pass can't see the call sites a changed
 * signature just broke — that pass has to cover the whole project. It's expensive, so `startedAt` lets
 * the compilers of one rebuild share a single run while a later rebuild forces a fresh one, and
 * `claimed` keeps that shared result from being reported once per compiler.
 * @type {{ promise: Promise<{ warnings: string[]; errors: string[] }>; startedAt: number; claimed: boolean } | undefined}
 */
let projectRun;

/**
 * When the files that triggered this rebuild were last written, or 0 for the initial build. The
 * compilers of one rebuild start at slightly different times, so comparing a pass against compilation
 * start would make any compiler that started after it spawn a redundant second pass — what matters is
 * whether the pass read the current file contents.
 * @param {import('webpack').Compiler} compiler
 * @returns {number}
 */
function getModifiedAt(compiler) {
	// A deletion has no mtime to compare against, and a rebuild triggered purely by one leaves
	// `modifiedFiles` empty — which would score as "unchanged" and reuse the pre-deletion pass.
	if (compiler.removedFiles?.size) return Date.now();

	let modifiedAt = 0;
	for (const file of compiler.modifiedFiles ?? []) {
		try {
			modifiedAt = Math.max(modifiedAt, statSync(file).mtimeMs);
		} catch {
			// Removed between the watch event and now — force a fresh pass rather than guess.
			return Date.now();
		}
	}
	return modifiedAt;
}

export class OxLintWebpackPlugin {
	constructor({ format = 'default', childProcessMaxFiles = CHILD_PROCESS_MAX_FILES, project = false } = {}) {
		this.key = OXLINT_PLUGIN;
		this.format = format;
		this.childProcessMaxFiles = childProcessMaxFiles;
		this.project = project;
		this.context = undefined;
	}

	apply(compiler) {
		this.key = compiler.name || `${this.key}_${(counter += 1)}`;
		this.context = compiler.options.context;

		// Watch-only: one-shot builds lint via the single standalone `oxlint` pass in build.mjs, so the
		// inline plugin only re-checks changed files incrementally during watch. Tapping `run` here too
		// would double-lint every non-quick one-shot build.
		compiler.hooks.watchRun.tap(this.key, c => this.run(c));
	}

	run(compiler) {
		if (compiler.hooks.thisCompilation.taps.find(({ name }) => name === this.key)) {
			return;
		}

		compiler.hooks.thisCompilation.tap(this.key, compilation => {
			const changedAt = this.project ? getModifiedAt(compiler) : 0;
			const files = [];

			// Only the file-scoped pass needs this list, and a project instance doesn't run one — skip the
			// per-module bookkeeping rather than build a list nothing reads.
			if (!this.project) {
				compilation.hooks.succeedModule.tap(this.key, ({ resource }) => {
					if (resource) {
						const [file] = resource.split('?');
						if ((file.endsWith('.ts') || file.endsWith('.js')) && !file.includes('node_modules')) {
							files.push(file);
						}
					}
				});
			}

			compilation.hooks.finishModules.tapPromise(this.key, async () => {
				try {
					/** @type {{ warnings: string[]; errors: string[] }[]} */
					const results = [];

					// The whole-project pass covers these same files with the same rules (plus type-aware
					// ones), so running both would report every diagnostic twice and double the wait.
					if (!this.project && files.length > 0) {
						const args = files.length > this.childProcessMaxFiles ? [] : files;
						results.push(this.processOutput(await this.executeLinter(args, false)));
					}

					if (this.project) {
						const projectResult = await this.requestProjectRun(changedAt);
						if (projectResult != null) {
							results.push(projectResult);
						}
					}

					for (const { warnings, errors } of results) {
						warnings.forEach(warning => {
							compilation.warnings.push(warning);
						});
						errors.forEach(error => {
							compilation.errors.push(error);
						});
					}
				} catch (err) {
					compilation.errors.push(err);
				}
			});
		});
	}

	/**
	 * Runs the whole-project type-aware pass, shared with every other compiler in this rebuild.
	 * @param {number} changedAt when the files that triggered this rebuild were last written
	 * @returns the pass results, or `undefined` if another compiler already reported them
	 */
	async requestProjectRun(changedAt) {
		// Wait out any pass that started before the edit that triggered this rebuild — it read the
		// previous file contents, so reusing it could report a stale all-clear.
		while (projectRun != null && projectRun.startedAt < changedAt) {
			await projectRun.promise.catch(() => undefined);
			if (projectRun != null && projectRun.startedAt < changedAt) {
				projectRun = undefined;
			}
		}

		if (projectRun == null) {
			const startedAt = Date.now();
			const promise = this.executeLinter([], true).then(result => this.processOutput(result));
			const run = { startedAt: startedAt, claimed: false, promise: promise };
			// A pass that failed outright isn't a result worth caching — drop it so the next rebuild
			// retries rather than replaying the same error until something happens to be edited.
			promise.catch(() => {
				if (projectRun === run) {
					projectRun = undefined;
				}
			});
			projectRun = run;
		}

		const run = projectRun;
		const result = await run.promise;
		// Every compiler of this rebuild awaits the same pass; only the first one there reports it, so
		// whole-project diagnostics aren't repeated under each compiler's heading.
		if (run.claimed) return undefined;

		run.claimed = true;
		return result;
	}

	/**
	 * @param {string[]} args files to lint, or empty for the whole project
	 * @param {boolean} typeAware whether to include type-aware rules and tsgo type diagnostics
	 */
	executeLinter(args, typeAware) {
		return new Promise((resolve, reject) => {
			const lintProcess = spawn(
				'oxlint',
				['-f', this.format, ...(typeAware ? ['--type-aware', '--type-check'] : []), ...args],
				{
					// The project pass has to run from the repo root — a compiler whose context is a
					// subdirectory (the webviews configs) would otherwise lint only that subtree.
					cwd: typeAware ? rootPath : this.context,
					env: {
						FORCE_COLOR: '1',
						...process.env,
					},
				},
			);

			let stdout = '';
			let stderr = '';

			lintProcess.stdout?.on('data', data => {
				stdout += data.toString();
			});

			lintProcess.stderr?.on('data', data => {
				stderr += data.toString();
			});

			lintProcess.on('close', (code, signal) => {
				// oxlint exits 1 whenever it reports diagnostics, so only a signal or an unexpected code
				// means the lint itself failed. Resolving those as empty output would report a dead
				// type-check as a clean build.
				if (signal != null) {
					reject(new Error(`oxlint was terminated by ${signal}${stderr ? `\n${stderr.trim()}` : ''}`));
					return;
				}
				if (code !== 0 && code !== 1) {
					reject(new Error(`oxlint exited with code ${code}\n${(stderr || stdout).trim()}`));
					return;
				}

				resolve({ code: code ?? 0, stdout: stdout, stderr: stderr });
			});

			lintProcess.on('error', err => {
				reject(err);
			});
		});
	}

	/** @param {{ code: number; stdout: string; stderr: string }} output */
	processOutput(output) {
		const groups = [];
		let group = [];
		const lines = output.stdout.split('\n');
		for (let i = 0, n = lines.length; i < n; i += 1) {
			const line = lines[i];
			const isBlankLine = line.trim() === '';
			if (isBlankLine) {
				if (group.length > 0) {
					groups.push(group);
				}
				group = [];
			} else {
				group.push(line);
			}
		}
		if (group.length > 0) {
			groups.push(group);
		}

		const results =
			this.format === 'stylish' ? this.processStylishFormat(groups) : this.processDefaultFormat(groups);

		// A non-zero exit with nothing that parsed as an error means oxlint itself failed rather than
		// finding anything — a missing tsgolint, an unreadable config. That message doesn't look like a
		// diagnostic, so it lands in `warnings` by shape and a dead type-check reads as a clean build.
		if (output.code !== 0 && results.errors.length === 0) {
			const detail = (results.warnings.splice(0).join('\n') || output.stderr).trim();
			results.errors.push(`\noxlint exited with code ${output.code}${detail ? `\n${detail}` : ''}`);
		}

		return results;
	}

	processDefaultFormat(groups) {
		const results = { warnings: [], errors: [] };

		for (let i = 0, n = groups.length; i < n; i += 1) {
			const group = groups[i];
			const groupFirstLine = group[0];
			if (groupFirstLine.includes('Finished in') || groupFirstLine.includes('Found 0 warnings')) {
				continue;
			}
			if (groupFirstLine.includes('⚠') || groupFirstLine.includes('warning')) {
				results.warnings.push(`\n${group.join('\n')}`);
			} else if (groupFirstLine.includes('×') || groupFirstLine.includes('error')) {
				results.errors.push(`\n${group.join('\n')}`);
			} else {
				if (group.join('\n').trim().length > 0) {
					results.warnings.push(`\n${group.join('\n')}`);
				}
			}
		}

		return results;
	}

	processStylishFormat(groups) {
		const results = { warnings: [], errors: [] };
		for (let i = 0, n = groups.length; i < n; i += 1) {
			const group = groups[i];
			if (group[0].includes('Finished in') || group[0].includes('Found 0 warnings')) {
				continue;
			}

			group[0] = group[0].replace(`${this.context}/`, '');

			let groupHasWarnings = false;
			let groupHasErrors = false;

			for (let x = 1, l = group.length; x < l; x += 1) {
				const line = group[x];
				const lineParts = line.split('  ');
				if (lineParts[2]?.includes('warning')) {
					groupHasWarnings = true;
				}
				if (lineParts[2]?.includes('error')) {
					groupHasErrors = true;
				}
			}

			const groupString = `${BLANK_SPACE}\n${group.join('\n')}`;
			if (groupHasErrors) {
				results.errors.push(groupString);
			} else if (groupHasWarnings) {
				results.warnings.push(groupString);
			}
		}

		return results;
	}
}
