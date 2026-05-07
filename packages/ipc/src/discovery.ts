import { mkdir, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ppid } from 'process';

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
