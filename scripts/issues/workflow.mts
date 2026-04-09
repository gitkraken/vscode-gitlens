/**
 * Orchestration script for the issue-to-delivery workflow.
 *
 * Chains pipeline stages as sequential AI CLI invocations (Claude or Auggie).
 * Two pipelines: triage (evaluate → investigate → prioritize → update)
 * and dev (scope → plan → challenge → [implement] → review).
 *
 * Usage:
 *   pnpm workflow triage recent [--since 7d] [--skip-to investigate|prioritize]
 *   pnpm workflow triage audit [--older-than 365d] [--batch-size 50]
 *   pnpm workflow triage single 5096 5084
 *   pnpm workflow dev 5096 [--skip-to plan|challenge|review|commit]
 *   pnpm workflow dev "refactor-caching"
 *
 * Options:
 *   --silent                 Suppress macOS notifications
 *   --agent <claude|auggie>  Primary agent CLI (default: claude)
 *   --model <model>          Model override for primary agent
 *   --duck-model <model>     Override the auto-selected duck model
 *   --dry-run                Show what would run without executing
 *   --rubber-duck, --rd      Second-opinion pass on evaluative stages
 */

import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { readFile, access, mkdir, stat, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ── Constants ────────────────────────────────────────────────────────

const workDir = '.work';
const triageReportsDir = join(workDir, 'triage', 'reports');
const devDir = join(workDir, 'dev');

const triageStages = ['triage', 'investigate', 'prioritize'] as const;
const devPreStages = ['scope', 'plan', 'challenge'] as const;
const devPostStages = ['review', 'ux-review', 'commit'] as const;
const devStages = [...devPreStages, ...devPostStages] as const;

type TriageStage = (typeof triageStages)[number];
type DevStage = (typeof devStages)[number];

type AgentType = 'claude' | 'auggie';
type ModelFamily = 'claude' | 'gemini' | 'gpt';
type RunOpts = { dryRun?: boolean };
type AgentRunner = {
	run(prompt: string, opts: RunOpts): boolean;
	runToFile(prompt: string, outputPath: string, opts: RunOpts): boolean;
};

function detectFamily(agent: AgentType, model?: string): ModelFamily {
	if (agent === 'claude') return 'claude';
	if (!model) return 'claude'; // auggie defaults to Claude models

	const lower = model.toLowerCase();
	if (/^(opus|sonnet|haiku|claude)/.test(lower)) return 'claude';
	if (/^gemini/.test(lower)) return 'gemini';
	if (/^gpt/.test(lower)) return 'gpt';

	log('⚠', `Unknown model family for "${model}" — defaulting to claude`);
	return 'claude';
}

const duckPairingTable: Record<ModelFamily, string> = {
	claude: 'gemini-3.1-pro-preview',
	gemini: 'opus4.6',
	gpt: 'opus4.6',
};

function resolveDuckModel(agent: AgentType, mainModel?: string, duckOverride?: string): string {
	if (duckOverride) {
		const mainFamily = detectFamily(agent, mainModel);
		const duckFamily = detectFamily('auggie', duckOverride);
		if (mainFamily === duckFamily) {
			log(
				'⚠',
				`Duck model "${duckOverride}" is same family as main (${mainFamily}) — second opinion may be less valuable`,
			);
		}
		return duckOverride;
	}
	const family = detectFamily(agent, mainModel);
	return duckPairingTable[family];
}

// ── Helpers ──────────────────────────────────────────────────────────

function notify(title: string, message: string, silent: boolean): void {
	if (silent) return;
	try {
		const escaped = message.replace(/"/g, '\\"');
		execSync(`osascript -e 'display notification "${escaped}" with title "${title}" sound name "Glass"'`, {
			stdio: 'ignore',
		});
	} catch {
		// Notification failure is non-fatal
	}
}

function log(icon: string, message: string): void {
	const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
	console.log(`${icon} [${ts}] ${message}`);
}

function divider(label: string): void {
	console.log(`\n${'─'.repeat(60)}`);
	console.log(`  ${label}`);
	console.log(`${'─'.repeat(60)}\n`);
}

function createRunner(agent: AgentType, opts: { model?: string; capture?: boolean }): AgentRunner {
	const binary = agent === 'claude' ? 'claude' : 'auggie';
	const capture = opts.capture ?? false;

	function buildArgs(prompt: string): string[] {
		if (agent === 'claude') {
			return ['-p', prompt, '--permission-mode', 'bypassPermissions'];
		}
		// Auggie
		if (capture) {
			return ['--print', '--quiet', prompt];
		}
		return ['-p', prompt];
	}

	function run(prompt: string, runOpts: RunOpts): boolean {
		const args = buildArgs(prompt);
		if (opts.model) args.push('--model', opts.model);

		if (runOpts.dryRun) {
			log('🏜️', `[dry-run] ${binary} ${args.join(' ')}`);
			return true;
		}

		const truncated = `${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`;
		log('▶', `Running: ${binary} "${truncated}"`);

		const result = spawnSync(binary, args, {
			stdio: capture ? 'pipe' : 'inherit',
			encoding: capture ? 'utf8' : undefined,
			env: { ...process.env },
		});

		if (result.status !== 0) {
			log('✗', `${binary} exited with code ${result.status}`);
			if (capture && result.stderr?.length) {
				console.error(result.stderr);
			}
			return false;
		}

		log('✓', 'Stage complete');
		return true;
	}

	function runCaptured(prompt: string, runOpts: RunOpts): { ok: boolean; stdout: string } {
		const args = buildArgs(prompt);
		if (opts.model) args.push('--model', opts.model);

		if (runOpts.dryRun) {
			log('🏜️', `[dry-run] ${binary} ${args.join(' ')}`);
			return { ok: true, stdout: '' };
		}

		const truncated = `${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`;
		log('▶', `Running: ${binary} "${truncated}"`);

		const result = spawnSync(binary, args, {
			stdio: 'pipe',
			encoding: 'utf8',
			env: { ...process.env },
		});

		if (result.status !== 0) {
			log('✗', `${binary} exited with code ${result.status}`);
			if (result.stderr?.length) {
				console.error(result.stderr);
			}
			return { ok: false, stdout: '' };
		}

		return { ok: true, stdout: result.stdout ?? '' };
	}

	function runToFile(prompt: string, outputPath: string, runOpts: RunOpts): boolean {
		if (capture) {
			// Capture mode: run and write stdout to file
			const { ok, stdout } = runCaptured(prompt, runOpts);
			if (!ok) return false;
			if (!runOpts.dryRun) {
				writeFileSync(outputPath, stdout, 'utf8');
				log('✓', `Output saved to ${outputPath}`);
			}
			return true;
		}
		// Non-capture mode: append save instruction to prompt
		const savePrompt = `${prompt}\n\nIMPORTANT: After completing the analysis, save the full output to ${outputPath} using the Write tool.`;
		return run(savePrompt, runOpts);
	}

	return { run, runToFile };
}

type RubberDuckStage = 'investigate' | 'prioritize' | 'challenge' | 'review' | 'ux-review';

const rubberDuckPrompts: Record<RubberDuckStage, string> = {
	investigate: [
		'You are a second-opinion reviewer for a bug investigation.',
		'Read the investigation artifact and the triage report.',
		'Surface 3-5 high-value concerns: alternative root causes not explored,',
		'misleading correlations, code paths not traced, or reproduction gaps.',
		'Be specific — reference files and code paths.',
		'Do NOT re-investigate from scratch. Focus only on what the primary missed.',
	].join(' '),
	prioritize: [
		'You are a second-opinion reviewer for a prioritization decision.',
		'Read the prioritization artifact and the investigation reports.',
		'Surface 3-5 high-value concerns: severity miscalibrations, missing user-impact signals,',
		'opportunity costs overlooked, or issues that should move between tiers.',
		'Be specific — reference issue numbers and the reasoning that seems weakest.',
		'Do NOT re-prioritize from scratch. Focus only on what the primary missed.',
	].join(' '),
	challenge: [
		'You are a second-opinion reviewer for a plan challenge analysis.',
		'Read the challenge artifact and the plan + goals it evaluated.',
		'Surface a short list (3-5) of high-value concerns the primary reviewer may have missed:',
		'blind spots in assumptions, architectural risks not covered, pre-mortem scenarios overlooked,',
		'or severity misclassifications. Be specific — reference files, code paths, or constraints.',
		'Do NOT re-review from scratch. Focus only on what the primary missed.',
	].join(' '),
	review: [
		'You are a second-opinion reviewer for a deep code review.',
		'Read the review artifact and the goals document.',
		'Surface a short list (3-5) of high-value concerns the primary reviewer may have missed:',
		'code paths not traced, edge cases overlooked, cross-environment issues (Node vs browser),',
		'decorator interactions missed, or severity misclassifications.',
		'Be specific — reference files, line numbers, and code paths.',
		'Do NOT re-review from scratch. Focus only on what the primary missed.',
	].join(' '),
	'ux-review': [
		'You are a second-opinion reviewer for a UX review.',
		'Read the UX review artifact and the goals document.',
		'Surface a short list (3-5) of high-value concerns the primary reviewer may have missed:',
		'user flows not walked through, accessibility gaps, discoverability issues,',
		'workflow interruptions, or mismatches between the goals UX spec and the actual implementation.',
		'Be specific — reference UI elements, commands, and interaction patterns.',
		'Do NOT re-review from scratch. Focus only on what the primary missed.',
	].join(' '),
};

async function runRubberDuck(
	stage: RubberDuckStage,
	artifactPath: string,
	contextFiles: string[],
	opts: { main: AgentRunner; duck: AgentRunner; scopeFlag: string; dryRun?: boolean },
): Promise<boolean> {
	const rdPath = artifactPath.replace(/\.md$/, '.rd.md');

	// Step 1: Run duck critique
	divider(`Rubber Duck: ${stage}`);

	const contextList = contextFiles.join(', ');
	const duckPrompt = [
		rubberDuckPrompts[stage],
		`\nPrimary artifact: ${artifactPath}`,
		contextList ? `Context files: ${contextList}` : '',
		'\nRead these files and provide your critique.',
	]
		.filter(Boolean)
		.join('\n');

	if (!opts.duck.runToFile(duckPrompt, rdPath, { dryRun: opts.dryRun })) {
		log('⚠', 'Rubber duck failed — continuing with original artifact');
		return true; // Duck is advisory, not blocking
	}

	// Step 2: Have the primary model revise
	divider(`Revision: ${stage}`);

	const revisePrompt = [
		`A second reviewer (different AI model) provided a critique of the ${stage} analysis.`,
		`Read the critique at ${rdPath} and the original artifact at ${artifactPath}.`,
		`Re-evaluate the original analysis incorporating this feedback.`,
		`Update the artifact at ${artifactPath}, noting which concerns you accepted and which you disagree with and why.`,
		`Add a "## Second-Opinion Review" section at the end documenting what changed.`,
		opts.scopeFlag,
	].join(' ');

	if (!opts.main.run(revisePrompt, { dryRun: opts.dryRun })) {
		log('⚠', 'Revision failed — original artifact preserved');
		return true; // Revision failure is non-fatal
	}

	return true;
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function ensureDir(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

async function detectChallengeVerdict(devFolder: string): Promise<'Ready' | 'Needs Revision' | 'Reconsider' | null> {
	const challengePath = join(devFolder, 'challenge.md');
	if (!(await fileExists(challengePath))) return null;

	const content = await readFile(challengePath, 'utf8');

	// Look for the verdict in the ### Verdict section
	const verdictMatch = content.match(/###\s*Verdict\s*\n+\s*(Ready|Needs Revision|Reconsider)/i);
	if (verdictMatch) {
		const raw = verdictMatch[1]!;
		if (/reconsider/i.test(raw)) return 'Reconsider';
		if (/needs revision/i.test(raw)) return 'Needs Revision';
		if (/ready/i.test(raw)) return 'Ready';
	}

	return null;
}

function resolveIdentifier(input: string): { identifier: string; isIssue: boolean } {
	const num = parseInt(input, 10);
	if (!isNaN(num) && num > 0) {
		return { identifier: String(num), isIssue: true };
	}
	// Slug: lowercase, hyphens, max 50 chars
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.slice(0, 50);
	return { identifier: slug, isIssue: false };
}

function printCopyPaste(label: string, command: string): void {
	console.log(`\n  ${label}:`);
	console.log(`  ┌──────────────────────────────────────────────`);
	console.log(`  │ ${command}`);
	console.log(`  └──────────────────────────────────────────────\n`);
}

async function findLatestReport(pattern: RegExp): Promise<string | undefined> {
	try {
		const files = await readdir(triageReportsDir);
		const matches = files.filter((f: string) => pattern.test(f));
		if (matches.length === 0) return undefined;

		// Find most recent by mtime
		let latest: { file: string; mtime: number } | undefined;
		for (const file of matches) {
			const fullPath = join(triageReportsDir, file);
			const s = await stat(fullPath);
			if (!latest || s.mtimeMs > latest.mtime) {
				latest = { file: fullPath, mtime: s.mtimeMs };
			}
		}
		return latest?.file;
	} catch {
		return undefined;
	}
}

// ── Triage Pipeline ──────────────────────────────────────────────────

async function runTriagePipeline(
	rawArgs: string[],
	globalOpts: GlobalOpts,
	main: AgentRunner,
	duck?: AgentRunner,
): Promise<void> {
	const triageCommand = rawArgs[0];
	if (!triageCommand || !['recent', 'audit', 'single'].includes(triageCommand)) {
		console.error('Usage: pnpm workflow triage <recent|audit|single> [options]');
		process.exit(1);
	}

	const restArgs = rawArgs.slice(1);
	const { values } = parseArgs({
		args: restArgs,
		options: {
			since: { type: 'string', default: '7d' },
			'older-than': { type: 'string', default: '180d' },
			'batch-size': { type: 'string', default: '50' },
			label: { type: 'string' },
			batch: { type: 'string', default: '1' },
			'force-refresh': { type: 'boolean', default: false },
			'skip-to': { type: 'string' },
		},
		strict: false,
		allowPositionals: true,
	});

	const skipTo = values['skip-to'] as TriageStage | undefined;
	if (skipTo && !triageStages.includes(skipTo as TriageStage)) {
		console.error(`Invalid --skip-to stage: ${skipTo}. Valid: ${triageStages.join(', ')}`);
		process.exit(1);
	}

	const startIdx = skipTo ? triageStages.indexOf(skipTo as TriageStage) : 0;

	// Stage 0: Build evidence pack (unless skipping past triage)
	let packPath: string | undefined;
	if (startIdx === 0) {
		divider('Stage 0: Building evidence pack');

		const triageArgs = [triageCommand, ...restArgs].join(' ');
		const triageScript = resolve(dirname(fileURLToPath(import.meta.url)), 'triage.mts');
		const triageCmd = `node --experimental-strip-types ${triageScript} ${triageArgs}`;

		if (globalOpts.dryRun) {
			log('🏜️', `[dry-run] ${triageCmd}`);
			packPath = '/tmp/dry-run-pack.json';
		} else {
			log('▶', `Running: ${triageCmd}`);
			try {
				packPath = execSync(triageCmd, { encoding: 'utf8' }).trim();
				log('✓', `Evidence pack: ${packPath}`);
			} catch (err: unknown) {
				log('✗', `Failed to build evidence pack`);
				if (err && typeof err === 'object' && 'stderr' in err) {
					console.error((err as { stderr: string }).stderr);
				}
				process.exit(1);
			}
		}
	}

	// Stage 1: /triage
	if (startIdx <= 0) {
		divider('Stage 1: Triage');
		const prompt = packPath ? `/triage ${packPath}` : `/triage --from-report`;
		if (!main.run(prompt, globalOpts)) {
			log('✗', 'Triage stage failed');
			notify('Workflow', 'Triage stage failed', globalOpts.silent);
			process.exit(1);
		}
	}

	// Stage 2: /investigate --from-report
	if (startIdx <= 1) {
		divider('Stage 2: Investigate');
		if (!main.run('/investigate --from-report', globalOpts)) {
			log('✗', 'Investigation stage failed');
			notify('Workflow', 'Investigation stage failed', globalOpts.silent);
			process.exit(1);
		}

		if (duck) {
			const investigatePath = await findLatestReport(/-INVESTIGATION-REPORT\.md$/);
			if (investigatePath) {
				const triageDecisions = await findLatestReport(/-DECISIONS\.json$/);
				const contextFiles = triageDecisions ? [triageDecisions] : [];
				await runRubberDuck('investigate', investigatePath, contextFiles, {
					main,
					duck,
					scopeFlag: '',
					dryRun: globalOpts.dryRun,
				});
			} else {
				log('⚠', 'No investigation report found for rubber duck — skipping');
			}
		}
	}

	// Stage 3: /prioritize --from-report
	if (startIdx <= 2) {
		divider('Stage 3: Prioritize');
		if (!main.run('/prioritize --from-report', globalOpts)) {
			log('✗', 'Prioritization stage failed');
			notify('Workflow', 'Prioritization stage failed', globalOpts.silent);
			process.exit(1);
		}

		if (duck) {
			const prioritizePath = await findLatestReport(/-RESOLUTION-REPORT\.md$/);
			if (prioritizePath) {
				const investigationReport = await findLatestReport(/-INVESTIGATION-REPORT\.md$/);
				const investigationDecisions = await findLatestReport(/-INVESTIGATION-DECISIONS\.json$/);
				const contextFiles = [investigationReport, investigationDecisions].filter(
					(f): f is string => f != null,
				);
				await runRubberDuck('prioritize', prioritizePath, contextFiles, {
					main,
					duck,
					scopeFlag: '',
					dryRun: globalOpts.dryRun,
				});
			} else {
				log('⚠', 'No prioritization report found for rubber duck — skipping');
			}
		}
	}

	// Done — print update-issues command for human
	divider('Pipeline Complete');
	log('✓', 'Triage pipeline finished. Review the reports, then apply:');
	notify('Workflow', 'Triage pipeline complete — ready for update-issues', globalOpts.silent);

	const bin = globalOpts.agent === 'auggie' ? 'auggie -p' : 'claude -p';
	printCopyPaste('Apply decisions to GitHub', '/update-issues --from-report');
	printCopyPaste('Or run non-interactively', `${bin} "/update-issues --from-report"`);
}

// ── Dev Pipeline ─────────────────────────────────────────────────────

async function runDevPipeline(
	rawArgs: string[],
	globalOpts: GlobalOpts,
	main: AgentRunner,
	duck?: AgentRunner,
): Promise<void> {
	if (rawArgs.length === 0) {
		console.error('Usage: pnpm workflow dev <issue-number|"description"> [options]');
		process.exit(1);
	}

	// First positional is the identifier (could be a number or quoted string)
	const inputIdentifier = rawArgs[0]!;
	const restArgs = rawArgs.slice(1);

	const { values } = parseArgs({
		args: restArgs,
		options: {
			'skip-to': { type: 'string' },
		},
		strict: false,
	});

	const { identifier, isIssue } = resolveIdentifier(inputIdentifier);
	const devFolder = join(devDir, identifier);
	const scopeFlag = `--scope ${devFolder}/`;

	const skipTo = values['skip-to'] as DevStage | undefined;
	if (skipTo && !devStages.includes(skipTo as DevStage)) {
		console.error(`Invalid --skip-to stage: ${skipTo}. Valid: ${devStages.join(', ')}`);
		process.exit(1);
	}

	// Determine which phase we're in
	const isPreImpl = !skipTo || devPreStages.includes(skipTo as (typeof devPreStages)[number]);
	const startPreIdx = skipTo && isPreImpl ? devPreStages.indexOf(skipTo as (typeof devPreStages)[number]) : 0;
	const startPostIdx = skipTo && !isPreImpl ? devPostStages.indexOf(skipTo as (typeof devPostStages)[number]) : 0;

	await ensureDir(devFolder);

	if (isPreImpl) {
		// ── Pre-implementation stages ────────────────────────────

		// Stage 1: /dev-scope
		if (startPreIdx <= 0) {
			divider(`Stage 1: Scope — ${isIssue ? `#${identifier}` : identifier}`);
			const scopeInput = isIssue ? identifier : `"${inputIdentifier}"`;
			if (!main.run(`/dev-scope ${scopeInput}`, globalOpts)) {
				log('✗', 'Scoping stage failed');
				notify('Workflow', 'Dev scoping failed', globalOpts.silent);
				process.exit(1);
			}

			// Verify goals.md was produced
			if (!globalOpts.dryRun && !(await fileExists(join(devFolder, 'goals.md')))) {
				log('✗', `Expected ${devFolder}/goals.md was not created`);
				process.exit(1);
			}
		}

		// Stage 2: /deep-planning
		if (startPreIdx <= 1) {
			divider('Stage 2: Plan');
			if (!main.run(`/deep-planning ${scopeFlag}`, globalOpts)) {
				log('✗', 'Planning stage failed');
				notify('Workflow', 'Dev planning failed', globalOpts.silent);
				process.exit(1);
			}
		}

		// Stage 3: /challenge-plan
		if (startPreIdx <= 2) {
			divider('Stage 3: Challenge');
			const challengePrompt = `/challenge-plan ${scopeFlag}`;
			if (duck) {
				const challengePath = join(devFolder, 'challenge.md');
				if (!main.runToFile(challengePrompt, challengePath, globalOpts)) {
					log('✗', 'Challenge stage failed');
					notify('Workflow', 'Plan challenge failed', globalOpts.silent);
					process.exit(1);
				}
				await runRubberDuck(
					'challenge',
					challengePath,
					[join(devFolder, 'goals.md'), join(devFolder, 'plan.md')],
					{ main, duck, scopeFlag, dryRun: globalOpts.dryRun },
				);
			} else {
				if (!main.run(challengePrompt, globalOpts)) {
					log('✗', 'Challenge stage failed');
					notify('Workflow', 'Plan challenge failed', globalOpts.silent);
					process.exit(1);
				}
			}

			// Check verdict
			if (!globalOpts.dryRun) {
				const verdict = await detectChallengeVerdict(devFolder);
				if (verdict === 'Reconsider') {
					log('⚠', 'Challenge verdict: RECONSIDER — pipeline stopped');
					notify('Workflow', 'Plan challenged — RECONSIDER verdict. Review needed.', globalOpts.silent);
					console.log(`\n  The challenge found issues that need human judgment.`);
					console.log(`  Review: ${devFolder}/challenge.md`);
					console.log(`  Then either revise the plan or override and resume:\n`);
					printCopyPaste(
						'Resume from challenge after revision',
						`pnpm workflow dev ${inputIdentifier} --skip-to challenge`,
					);
					printCopyPaste(
						'Skip to implementation anyway',
						`pnpm workflow dev ${inputIdentifier} --skip-to review`,
					);
					process.exit(0);
				}
				if (verdict === 'Needs Revision') {
					log('⚠', 'Challenge verdict: NEEDS REVISION');
					notify('Workflow', 'Plan needs revision before implementation.', globalOpts.silent);
					console.log(`\n  The plan has issues that should be addressed.`);
					console.log(`  Review: ${devFolder}/challenge.md`);
					console.log(`  Revise the plan, then re-challenge or proceed:\n`);
					printCopyPaste(
						'Re-challenge after revision',
						`pnpm workflow dev ${inputIdentifier} --skip-to challenge`,
					);
					printCopyPaste(
						'Proceed to implementation anyway',
						`pnpm workflow dev ${inputIdentifier} --skip-to review`,
					);
					process.exit(0);
				}
				log('✓', `Challenge verdict: ${verdict ?? 'unknown (check challenge.md)'}`);
			}
		}

		// Pre-implementation complete
		divider('Pre-Implementation Complete');
		log('✓', 'Scope → Plan → Challenge done. Ready to implement.');
		notify('Workflow', 'Pre-implementation pipeline complete — ready to code', globalOpts.silent);

		console.log(`  Artifacts:`);
		console.log(`    ${devFolder}/goals.md`);
		console.log(`    ${devFolder}/plan.md`);
		console.log(`    ${devFolder}/challenge.md\n`);
		console.log(`  Implement the changes, then run reviews:\n`);
		printCopyPaste('Run post-implementation reviews', `pnpm workflow dev ${inputIdentifier} --skip-to review`);
	} else {
		// ── Post-implementation stages ───────────────────────────

		// Verify goals.md exists for review context
		if (!globalOpts.dryRun && !(await fileExists(join(devFolder, 'goals.md')))) {
			log('⚠', `No goals.md found in ${devFolder}. Reviews will run without scope context.`);
		}

		// Stage 4: /deep-review
		if (startPostIdx <= 0) {
			divider('Stage 4: Deep Review');
			const reviewPrompt = `/deep-review branch ${scopeFlag}`;
			if (duck) {
				const reviewPath = join(devFolder, 'review.md');
				if (!main.runToFile(reviewPrompt, reviewPath, globalOpts)) {
					log('✗', 'Deep review stage failed');
					notify('Workflow', 'Deep review failed', globalOpts.silent);
					process.exit(1);
				}
				await runRubberDuck('review', reviewPath, [join(devFolder, 'goals.md')], {
					main,
					duck,
					scopeFlag,
					dryRun: globalOpts.dryRun,
				});
			} else {
				if (!main.run(reviewPrompt, globalOpts)) {
					log('✗', 'Deep review stage failed');
					notify('Workflow', 'Deep review failed', globalOpts.silent);
					process.exit(1);
				}
			}
		}

		// Stage 5: /ux-review
		if (startPostIdx <= 1) {
			divider('Stage 5: UX Review');
			const uxReviewPrompt = `/ux-review branch ${scopeFlag}`;
			if (duck) {
				const uxReviewPath = join(devFolder, 'ux-review.md');
				if (!main.runToFile(uxReviewPrompt, uxReviewPath, globalOpts)) {
					log('✗', 'UX review stage failed');
					notify('Workflow', 'UX review failed', globalOpts.silent);
					process.exit(1);
				}
				await runRubberDuck('ux-review', uxReviewPath, [join(devFolder, 'goals.md')], {
					main,
					duck,
					scopeFlag,
					dryRun: globalOpts.dryRun,
				});
			} else {
				if (!main.run(uxReviewPrompt, globalOpts)) {
					log('✗', 'UX review stage failed');
					notify('Workflow', 'UX review failed', globalOpts.silent);
					process.exit(1);
				}
			}
		}

		// Done — print commit/audit commands
		divider('Reviews Complete');
		log('✓', 'Deep review and UX review finished.');
		notify('Workflow', 'Reviews complete — ready to commit', globalOpts.silent);

		printCopyPaste('Commit changes', '/commit');
		printCopyPaste('Audit commits for issues + CHANGELOG', '/audit-commits');
	}
}

// ── Main ─────────────────────────────────────────────────────────────

interface GlobalOpts {
	silent: boolean;
	agent: AgentType;
	model?: string;
	duckModel?: string;
	dryRun: boolean;
	rubberDuck: boolean;
}

function printUsage(): void {
	console.log(`
Usage: pnpm workflow <pipeline> [options]

Pipelines:
  triage <recent|audit|single> [options]    Run triage pipeline
  dev <issue|"description"> [options]       Run dev pipeline

Global Options:
  --silent                 Suppress macOS notifications
  --agent <claude|auggie>  Primary agent CLI (default: claude)
  --model <model>          Model override for primary agent
  --duck-model <model>     Override the auto-selected duck model
  --dry-run                Show what would run without executing
  --rubber-duck, --rd      Run a second-opinion pass on evaluative stages.
                           Triage: investigate, prioritize. Dev: challenge, review, ux-review.
                           The duck uses a different model family than the primary.

Triage Options:
  --since <duration>       Lookback window for recent (default: 7d)
  --older-than <duration>  Age threshold for audit (default: 180d)
  --batch-size <n>         Issues per batch for audit (default: 50)
  --skip-to <stage>        Resume from stage: triage, investigate, prioritize

Dev Options:
  --skip-to <stage>        Resume from stage: scope, plan, challenge, review, ux-review, commit

Examples:
  pnpm workflow triage recent
  pnpm workflow triage recent --rubber-duck
  pnpm workflow triage recent --agent auggie --model gemini-3.1-pro-preview --rubber-duck
  pnpm workflow triage audit --older-than 365d
  pnpm workflow triage single 5096 5084
  pnpm workflow dev 5096
  pnpm workflow dev 5096 --skip-to plan
  pnpm workflow dev 5096 --skip-to review
  pnpm workflow dev "refactor-caching"
  pnpm workflow dev 5096 --rubber-duck
  pnpm workflow dev 5096 --rubber-duck --duck-model gpt5.4
`);
}

async function main(): Promise<void> {
	const pipeline = process.argv[2];
	if (!pipeline || !['triage', 'dev'].includes(pipeline)) {
		printUsage();
		process.exit(1);
	}

	// Extract global options before passing to sub-pipeline
	const allArgs = process.argv.slice(3);

	// Pull global flags out manually (parseArgs doesn't handle mixed positional + flag well across sub-commands)
	const silent = allArgs.includes('--silent');
	const dryRun = allArgs.includes('--dry-run');
	const rubberDuck = allArgs.includes('--rubber-duck') || allArgs.includes('--rd');

	let model: string | undefined;
	const modelIdx = allArgs.indexOf('--model');
	if (modelIdx !== -1 && allArgs[modelIdx + 1]) {
		model = allArgs[modelIdx + 1];
	}

	let agent: AgentType = 'claude';
	const agentIdx = allArgs.indexOf('--agent');
	if (agentIdx !== -1 && allArgs[agentIdx + 1]) {
		const val = allArgs[agentIdx + 1];
		if (val !== 'claude' && val !== 'auggie') {
			console.error(`Invalid --agent value: ${val}. Valid: claude, auggie`);
			process.exit(1);
		}
		agent = val;
	}

	let duckModel: string | undefined;
	const duckModelIdx = allArgs.indexOf('--duck-model');
	if (duckModelIdx !== -1 && allArgs[duckModelIdx + 1]) {
		duckModel = allArgs[duckModelIdx + 1];
	}

	// Remove global flags from args passed to sub-pipelines
	const subArgs = allArgs.filter((arg: string, idx: number) => {
		if (arg === '--silent' || arg === '--dry-run' || arg === '--rubber-duck' || arg === '--rd') return false;
		if (arg === '--model') return false;
		if (modelIdx !== -1 && idx === modelIdx + 1) return false;
		if (arg === '--agent') return false;
		if (agentIdx !== -1 && idx === agentIdx + 1) return false;
		if (arg === '--duck-model') return false;
		if (duckModelIdx !== -1 && idx === duckModelIdx + 1) return false;
		return true;
	});

	const globalOpts: GlobalOpts = { silent, agent, model, duckModel, dryRun, rubberDuck };

	// Create runners
	const mainRunner = createRunner(globalOpts.agent, { model: globalOpts.model });
	const duckRunner = globalOpts.rubberDuck
		? createRunner('auggie', {
				model: resolveDuckModel(globalOpts.agent, globalOpts.model, globalOpts.duckModel),
				capture: true,
			})
		: undefined;

	if (pipeline === 'triage') {
		await runTriagePipeline(subArgs, globalOpts, mainRunner, duckRunner);
	} else {
		await runDevPipeline(subArgs, globalOpts, mainRunner, duckRunner);
	}
}

main().catch(err => {
	console.error('Fatal error:', err);
	process.exit(1);
});
