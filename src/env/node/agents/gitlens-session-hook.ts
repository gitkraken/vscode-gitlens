import { randomBytes } from 'crypto';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// eslint-disable-next-line no-restricted-globals
const _logDir = process.env.GITLENS_HOOK_LOG;
// eslint-disable-next-line no-restricted-globals
const _ppid = process.ppid;
const _logFile =
	_logDir != null ? join(_logDir, `hook-${_ppid}-${Date.now()}-${randomBytes(4).toString('hex')}.log`) : undefined;
function log(message: string): void {
	if (_logFile == null) return;
	try {
		appendFileSync(_logFile, `[${new Date().toISOString()}] ${message}\n`);
	} catch {
		// Logging must never interfere with hook execution
	}
}

// Read session context from Claude Code via stdin
let input: Record<string, unknown>;
try {
	input = JSON.parse(readFileSync(0, 'utf8')) as Record<string, unknown>;
} catch {
	// eslint-disable-next-line no-restricted-globals
	process.exit(0);
}

const cwd = (input.cwd as string) ?? '';
// eslint-disable-next-line no-restricted-globals
const pid = process.ppid;
const hookEvent = input.hook_event_name as string | undefined;

log(`Hook fired: event=${hookEvent} session=${String(input.session_id)} cwd=${cwd} pid=${pid}`);

if (!cwd) {
	log('No cwd — exiting');
	// eslint-disable-next-line no-restricted-globals
	process.exit(0);
}

const discoveryDir = join(tmpdir(), 'gitkraken', 'gitlens', 'agents');

interface DiscoveryFile {
	token: string;
	address: string;
	workspacePaths?: string[];
}

try {
	const files = readdirSync(discoveryDir).filter(f => f.endsWith('.json'));
	log(`Discovery dir: ${discoveryDir} — found ${files.length} file(s): ${files.join(', ')}`);

	const discoveries: { discovery: DiscoveryFile; file: string }[] = [];
	let matchedWorkspacePath: string | undefined;
	let matchedDiscovery: { discovery: DiscoveryFile; file: string } | undefined;

	// Phase 1: Parse all discovery files and find the matching workspace
	for (const file of files) {
		let discovery: DiscoveryFile;
		try {
			discovery = JSON.parse(readFileSync(join(discoveryDir, file), 'utf8')) as DiscoveryFile;
		} catch (ex: unknown) {
			log(`Failed to parse discovery file ${file}: ${String(ex)}`);
			continue;
		}

		discoveries.push({ discovery: discovery, file: file });
		log(
			`Discovery ${file}: address=${discovery.address} workspacePaths=${JSON.stringify(discovery.workspacePaths)}`,
		);

		if (matchedWorkspacePath == null) {
			const matched = discovery.workspacePaths?.find(
				(p: string) => cwd === p || cwd.startsWith(`${p}/`) || p.startsWith(`${cwd}/`),
			);
			if (matched != null) {
				matchedWorkspacePath = matched;
				matchedDiscovery = { discovery: discovery, file: file };
				log(`Matched workspace: ${matched} (from ${file})`);
			}
		}
	}

	if (matchedWorkspacePath == null) {
		log(`No workspace match found for cwd=${cwd}`);
	}

	// Phase 2: Dispatch events

	// PermissionRequest uses a separate endpoint and blocking flow — only send to the matched instance
	if (hookEvent === 'PermissionRequest') {
		if (matchedDiscovery != null) {
			const permUrl = `${matchedDiscovery.discovery.address}/agents/permission`;
			log(`PermissionRequest: POSTing to ${permUrl} (tool=${String(input.tool_name)})`);
			try {
				const response = await fetch(permUrl, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${matchedDiscovery.discovery.token}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						sessionId: input.session_id,
						pid: pid,
						toolName: input.tool_name,
						toolInput: input.tool_input ?? {},
						permissionSuggestions: input.permission_suggestions,
					}),
					signal: AbortSignal.timeout(5 * 60 * 1000),
				});

				log(`PermissionRequest: response status=${response.status}`);

				const result = (await response.json()) as {
					decision?: string;
					updatedPermissions?: unknown[];
				};
				const decision = result.decision === 'allow' ? 'allow' : 'deny';
				log(`PermissionRequest: decision=${decision}`);

				const decisionPayload: Record<string, unknown> = { behavior: decision };
				if (decision === 'allow' && result.updatedPermissions != null) {
					decisionPayload.updatedPermissions = result.updatedPermissions;
				}

				// Write hookSpecificOutput to stdout so Claude Code receives the decision
				// eslint-disable-next-line no-restricted-globals
				process.stdout.write(
					JSON.stringify({
						hookSpecificOutput: {
							hookEventName: 'PermissionRequest',
							decision: decisionPayload,
						},
					}),
				);
			} catch (ex: unknown) {
				log(`PermissionRequest: error — ${String(ex)}`);
				// Timeout or error — exit silently so Claude Code shows its normal dialog
			}
		} else {
			log('PermissionRequest: no matched discovery — skipping');
		}
	} else {
		const eventMap: Record<string, string> = {
			SessionStart: 'session-start',
			SessionEnd: 'session-end',
			UserPromptSubmit: 'user-prompt',
			PreToolUse: 'pre-tool-use',
			PostToolUse: 'post-tool-use',
			PostToolUseFailure: 'post-tool-use-failure',
			Stop: 'stop',
			SubagentStart: 'subagent-start',
			SubagentStop: 'subagent-stop',
			PreCompact: 'pre-compact',
			Notification: 'notification',
		};
		const event = hookEvent != null ? eventMap[hookEvent] : undefined;

		if (event != null) {
			log(
				`Broadcast: event=${event} to ${discoveries.length} instance(s) matchedWorkspacePath=${matchedWorkspacePath}`,
			);
			// Broadcast to ALL GitLens instances with the matched workspace path
			const body = JSON.stringify({
				event: event,
				sessionId: input.session_id,
				cwd: cwd,
				pid: pid,
				source: input.source,
				model: input.model,
				reason: input.reason,
				toolName: input.tool_name,
				agentId: input.agent_id,
				agentType: input.agent_type,
				matchedWorkspacePath: matchedWorkspacePath,
			});

			const results = await Promise.allSettled(
				discoveries.map(({ discovery }) =>
					fetch(`${discovery.address}/agents/session`, {
						method: 'POST',
						headers: {
							Authorization: `Bearer ${discovery.token}`,
							'Content-Type': 'application/json',
						},
						body: body,
						signal: AbortSignal.timeout(1000),
					}).then(
						r => {
							log(`Broadcast to ${discovery.address}: status=${r.status}`);
							return r;
						},
						(ex: unknown) => {
							log(`Broadcast to ${discovery.address}: error — ${String(ex)}`);
						},
					),
				),
			);
			log(`Broadcast complete: ${results.map(r => r.status).join(', ')}`);

			// Persist session state to disk for recovery after workspace switches / restarts
			try {
				const sessionsDir = join(discoveryDir, 'sessions');
				const sanitizedId = String(input.session_id).replace(/[^a-zA-Z0-9_-]/g, '');
				if (!sanitizedId) {
					log('Session file: invalid session_id — skipping');
				} else {
					const sessionFile = join(sessionsDir, `${sanitizedId}.json`);
					const resolvedPath = resolve(sessionFile);
					const resolvedDir = resolve(sessionsDir);
					if (!resolvedPath.startsWith(`${resolvedDir}/`)) {
						log('Session file: path traversal detected — skipping');
					} else if (event === 'session-end') {
						log(`Session file: deleting ${sessionFile}`);
						try {
							unlinkSync(sessionFile);
						} catch {
							// File may not exist
						}
					} else {
						mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });

						// For subagent events, read-modify-write the subagents array
						// For other events, preserve the existing subagents array
						let subagents: { agentId: string; agentType: string }[] = [];
						try {
							const existing = JSON.parse(readFileSync(sessionFile, 'utf8')) as {
								subagents?: { agentId: string; agentType: string }[];
							};
							subagents = existing.subagents ?? [];
						} catch {
							// File doesn't exist yet
						}

						if (event === 'subagent-start' && input.agent_id) {
							if (!subagents.some(s => s.agentId === input.agent_id)) {
								subagents.push({
									agentId: input.agent_id as string,
									agentType: (input.agent_type as string) ?? 'Subagent',
								});
							}
						} else if (event === 'subagent-stop' && input.agent_id) {
							subagents = subagents.filter(s => s.agentId !== input.agent_id);
						}

						const sessionData = {
							sessionId: input.session_id,
							event: event,
							cwd: cwd,
							pid: pid,
							matchedWorkspacePath: matchedWorkspacePath,
							toolName: input.tool_name ?? null,
							agentId: input.agent_id ?? null,
							agentType: input.agent_type ?? null,
							source: input.source ?? null,
							model: input.model ?? null,
							updatedAt: new Date().toISOString(),
							subagents: subagents,
						};

						writeFileSync(sessionFile, JSON.stringify(sessionData), { mode: 0o600 });
						log(`Session file: wrote ${sessionFile}`);
					}
				}
			} catch (ex: unknown) {
				log(`Session file: error — ${String(ex)}`);
				// Session file write must never block Claude Code
			}
		}
	}
} catch (ex: unknown) {
	log(`Top-level error: ${String(ex)}`);
	// Fail silently — hook must not block Claude Code
}
log('Hook exiting');
// eslint-disable-next-line no-restricted-globals
process.exit(0);
