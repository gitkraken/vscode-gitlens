import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { kill, ppid } from 'process';

/**
 * Directory scanned by `gk` binaries (and `@gitkraken/core-gitlens` consumers) for the
 * extension's CLI-capable IPC server discovery file. Anything written here is assumed
 * by older `gk` versions to be a CLI server — do NOT write agent-only files here.
 */
export const cliDiscoveryDir = join(tmpdir(), 'gitkraken', 'gitlens');

/**
 * Directory scanned by peer GitLens windows for agent-session-capable IPC servers.
 * Stable across GitLens versions; older windows still scan it, so don't move it.
 */
export const agentDiscoveryDir = join(tmpdir(), 'gitkraken', 'gitlens', 'agents');

export interface IpcDiscoveryData {
	token: string;
	address: string;
	port: number;
	workspacePaths: string[];
	// Optional fields — present when the writing capability needs them.
	// Old gk binaries ignore unknown fields, so this stays back-compat.
	ideName?: string;
	ideDisplayName?: string;
	scheme?: string;
	pid?: number;
	createdAt: string;
}

export function getDiscoveryFileName(port: number): string {
	return `gitlens-ipc-server-${ppid}-${port}.json`;
}

const discoveryFileNameRegex = /^gitlens-ipc-server-(\d+)-(\d+)\.json$/;

/** Parses a discovery file name back into its `ppid`/`port` parts; returns `undefined` if it doesn't match. */
export function parseDiscoveryFileName(name: string): { ppid: number; port: number } | undefined {
	const match = discoveryFileNameRegex.exec(name);
	if (match == null) return undefined;

	return { ppid: Number(match[1]), port: Number(match[2]) };
}

export function getDiscoveryFilePath(dir: string, port: number): string {
	return join(dir, getDiscoveryFileName(port));
}

export async function writeDiscoveryFile(dir: string, data: IpcDiscoveryData): Promise<string> {
	const filePath = getDiscoveryFilePath(dir, data.port);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
	return filePath;
}

export async function cleanupDiscoveryFile(filePath: string | undefined): Promise<void> {
	if (filePath == null) return;

	try {
		await unlink(filePath);
	} catch {
		// Ignore cleanup errors
	}
}

export interface SweepDiscoveryFilesOptions {
	/** Ports to never touch (e.g. our own live server). */
	excludePorts?: number[];
	/** Absolute file paths to never touch (e.g. our own files). */
	excludePaths?: string[];
}

/**
 * Best-effort sweep of orphaned discovery files left by processes that crashed or were
 * hard-killed without cleaning up. Reachability is the source of truth: a file is removed
 * only when its owning process is provably gone (pid reports `ESRCH`) or its server is
 * unreachable (the probe fails with anything other than a timeout). Anything reachable — or
 * ambiguous (timeouts, parse errors) — is kept, so a live peer's file is never deleted.
 */
export async function sweepStaleDiscoveryFiles(
	dirs: string[],
	options?: SweepDiscoveryFilesOptions,
): Promise<{ scanned: number; pruned: number }> {
	const excludePorts = options?.excludePorts;
	const excludePaths = options?.excludePaths;

	let scanned = 0;
	let pruned = 0;

	for (const dir of dirs) {
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			// Dir doesn't exist yet (nothing ever published here) — nothing to sweep.
			continue;
		}

		const candidates: string[] = [];
		for (const name of names) {
			const parsed = parseDiscoveryFileName(name);
			if (parsed == null) continue;
			if (excludePorts?.includes(parsed.port)) continue;

			const filePath = join(dir, name);
			if (excludePaths?.includes(filePath)) continue;

			candidates.push(filePath);
		}

		scanned += candidates.length;

		const results = await Promise.allSettled(
			candidates.map(async filePath => {
				if (await isDiscoveryFileStale(filePath)) {
					await cleanupDiscoveryFile(filePath);
					return true;
				}
				return false;
			}),
		);

		for (const r of results) {
			if (r.status === 'fulfilled' && r.value) {
				pruned++;
			}
		}
	}

	return { scanned: scanned, pruned: pruned };
}

/** Returns true only when the file's server is provably gone (dead pid or unreachable server). */
async function isDiscoveryFileStale(filePath: string): Promise<boolean> {
	let data: IpcDiscoveryData;
	try {
		data = JSON.parse(await readFile(filePath, 'utf8')) as IpcDiscoveryData;
	} catch {
		// Can't read/parse — don't delete files we don't understand.
		return false;
	}

	// Cheap short-circuit: if the owning process is gone, the file is orphaned.
	if (data.pid != null && !isProcessAlive(data.pid)) return true;

	// Otherwise reachability is the source of truth.
	if (!data.address) return false;

	try {
		await fetch(`${data.address}/ping`, { signal: AbortSignal.timeout(1000) });
		// Any HTTP response (even 401/404) means a server is listening — keep.
		return false;
	} catch (ex) {
		// A timeout is ambiguous — the server may be alive but slow to answer — so keep. Any other
		// failure (connection refused, reset, host unreachable, bad address) means nothing is
		// serving on that localhost port, so the file is stale. A healthy local server always
		// answers near-instantly, so this never deletes a reachable peer.
		return !isTimeoutError(ex);
	}
}

function isProcessAlive(pid: number): boolean {
	// `kill(0, ...)` / `kill(<negative>, ...)` have process-group semantics and don't probe a
	// specific pid, so a malformed pid (from a foreign or corrupt file) can't prove death — treat
	// it as inconclusive so the sweep falls through to the reachability probe rather than deleting
	// on a bad pid. (Note: the agents session-card tracker's `isProcessAlive` biases the opposite
	// way — toward dead — because expiring a live card there is harmless; deleting a live file is
	// not, so this copy intentionally keeps on uncertainty.)
	if (!Number.isInteger(pid) || pid <= 0) return true;

	try {
		kill(pid, 0);
		return true;
	} catch (ex) {
		// ESRCH → no such process (dead). EPERM/EACCES → exists but not ours (alive). Anything
		// else is inconclusive → treat as alive so we never delete a file on uncertainty.
		return (ex as NodeJS.ErrnoException | null)?.code !== 'ESRCH';
	}
}

function isTimeoutError(ex: unknown): boolean {
	// `AbortSignal.timeout` rejects with a `TimeoutError`; a bare abort yields an `AbortError`.
	return ex instanceof Error && (ex.name === 'TimeoutError' || ex.name === 'AbortError');
}
