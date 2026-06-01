import { spawn } from 'child_process';
import path from 'path';

const OXLINT_PLUGIN = 'OxLintWebpackPlugin';
const CHILD_PROCESS_MAX_FILES = 10;
const BLANK_SPACE = '⠀';

let counter = 0;

export class OxLintWebpackPlugin {
	constructor({ format = 'default', childProcessMaxFiles = CHILD_PROCESS_MAX_FILES } = {}) {
		this.key = OXLINT_PLUGIN;
		this.format = format;
		this.childProcessMaxFiles = childProcessMaxFiles;
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
			const files = [];

			compilation.hooks.succeedModule.tap(this.key, ({ resource }) => {
				if (resource) {
					const [file] = resource.split('?');
					if (
						(file.endsWith('.ts') ||
							file.endsWith('.tsx') ||
							file.endsWith('.js') ||
							file.endsWith('.jsx')) &&
						!file.includes('node_modules')
					) {
						files.push(file);
					}
				}
			});

			compilation.hooks.finishModules.tapPromise(this.key, async () => {
				if (files.length > 0) {
					const args = files.length > this.childProcessMaxFiles ? [] : files;
					try {
						const linterOutput = await this.executeLinter(args);
						if (linterOutput) {
							const { warnings, errors } = this.processOutput(linterOutput);
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
				}
			});
		});
	}

	executeLinter(args) {
		return new Promise((resolve, reject) => {
			// Run with type-aware checks enabled natively
			const lintProcess = spawn('oxlint', ['-f', this.format, '--type-aware', '--type-check', ...args], {
				cwd: this.context,
				env: {
					FORCE_COLOR: '1',
					...process.env,
				},
			});

			let stdout = '';

			lintProcess.stdout?.on('data', data => {
				stdout += data.toString();
			});

			lintProcess.on('close', () => {
				resolve(stdout);
			});

			lintProcess.on('error', err => {
				reject(err);
			});
		});
	}

	processOutput(output) {
		const groups = [];
		let group = [];
		const lines = output.split('\n');
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

		return this.format === 'stylish' ? this.processStylishFormat(groups) : this.processDefaultFormat(groups);
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
