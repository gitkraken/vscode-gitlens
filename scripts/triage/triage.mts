import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from './config.mts';
import { buildPack } from './build-pack.mts';
import type { AuditQueryParams, EvidencePack, ReactiveQueryParams, SingleQueryParams } from './types.mts';

const oneHourMs = 60 * 60 * 1000;

async function main(): Promise<void> {
	const command = process.argv[2];
	if (!command || !['recent', 'audit', 'single'].includes(command)) {
		printUsage();
		process.exit(1);
	}

	// Parse args after the command
	const rawArgs = process.argv.slice(3);

	if (command === 'recent') {
		await runRecent(rawArgs);
	} else if (command === 'audit') {
		await runAudit(rawArgs);
	} else {
		await runSingle(rawArgs);
	}
}

function printUsage(): void {
	console.error(`Usage: pnpm triage:<command> -- [options]

Commands:
  recent    Reactive triage of recently opened issues
  audit     Retroactive audit of historical backlog
  single    Fetch specific issues by number

Options (recent):
  --since <duration>     Lookback window, e.g. 7d, 14d (default: 7d)
  --force-refresh        Bypass cache for all fetch steps

Options (audit):
  --older-than <duration>  Age threshold, e.g. 180d (default: 180d)
  --batch-size <n>         Issues per batch (default: 50)
  --label <label>          Filter by label (optional)
  --batch <n>              Resume at batch number N (default: 1)
  --force-refresh          Bypass cache for all fetch steps

Options (single):
  <number> [number...]   One or more issue numbers (required)
  --force-refresh        Bypass cache for all fetch steps`);
}

async function runRecent(rawArgs: string[]): Promise<void> {
	const { values } = parseArgs({
		args: rawArgs,
		options: {
			since: { type: 'string', default: '7d' },
			'force-refresh': { type: 'boolean', default: false },
		},
		strict: false,
	});

	const params: ReactiveQueryParams = {
		since: values.since as string,
	};
	const forceRefresh = values['force-refresh'] as boolean;

	// Check for a fresh existing pack
	if (!forceRefresh) {
		const existingPath = await findFreshPack('reactive');
		if (existingPath) {
			console.log(resolve(existingPath));
			return;
		}
	}

	const packPath = await buildPack('reactive', params, forceRefresh);
	console.log(resolve(packPath));
}

async function runAudit(rawArgs: string[]): Promise<void> {
	const { values } = parseArgs({
		args: rawArgs,
		options: {
			'older-than': { type: 'string', default: '180d' },
			'batch-size': { type: 'string', default: String(config.auditBatchSize) },
			label: { type: 'string' },
			batch: { type: 'string', default: '1' },
			'force-refresh': { type: 'boolean', default: false },
		},
		strict: false,
	});

	const params: AuditQueryParams = {
		olderThan: values['older-than'] as string,
		batchSize: parseInt(values['batch-size'] as string, 10),
		labelFilter: (values.label as string) ?? null,
		batchNumber: parseInt(values.batch as string, 10),
	};
	const forceRefresh = values['force-refresh'] as boolean;

	// Check for a fresh existing pack for this batch
	if (!forceRefresh) {
		const existingPath = await findFreshPack('audit', params.batchNumber);
		if (existingPath) {
			console.log(resolve(existingPath));
			return;
		}
	}

	const packPath = await buildPack('audit', params, forceRefresh);
	console.log(resolve(packPath));
}

async function runSingle(rawArgs: string[]): Promise<void> {
	// Single mode always fetches fresh data (no cache check) since the user
	// is requesting specific issues and likely wants current state.
	// Parse issue numbers from positional args and flags
	const { values, positionals } = parseArgs({
		args: rawArgs,
		options: {
			'force-refresh': { type: 'boolean', default: false },
		},
		strict: false,
		allowPositionals: true,
	});

	const issueNumbers = positionals.map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0);

	if (issueNumbers.length === 0) {
		console.error('Error: at least one issue number is required for single mode');
		printUsage();
		process.exit(1);
	}

	const forceRefresh = values['force-refresh'] as boolean;

	const params: SingleQueryParams = { issueNumbers };
	const packPath = await buildPack('single', params, forceRefresh);
	console.log(resolve(packPath));
}

async function findFreshPack(mode: 'reactive' | 'audit', batchNumber?: number): Promise<string | null> {
	const latestName = mode === 'reactive' ? 'latest-reactive.json' : `latest-audit-batch-${batchNumber}.json`;
	const latestPath = join(config.packsDir, latestName);

	try {
		const info = await stat(latestPath);
		const ageMs = Date.now() - info.mtimeMs;

		// "Fresh" means created within the last hour for reactive
		if (mode === 'reactive' && ageMs < oneHourMs) {
			// Verify pack can be read and has matching params
			const raw = await readFile(latestPath, 'utf8');
			const pack: EvidencePack = JSON.parse(raw);
			if (pack.meta.workflow === 'reactive') {
				return latestPath;
			}
		}

		// For audit, check that batch number matches
		if (mode === 'audit' && ageMs < oneHourMs) {
			const raw = await readFile(latestPath, 'utf8');
			const pack: EvidencePack = JSON.parse(raw);
			if (
				pack.meta.workflow === 'audit' &&
				'batchNumber' in pack.meta.queryParams &&
				pack.meta.queryParams.batchNumber === batchNumber
			) {
				return latestPath;
			}
		}
	} catch {
		// No existing pack
	}

	return null;
}

main().catch(err => {
	console.error('Fatal error:', err);
	process.exit(1);
});
