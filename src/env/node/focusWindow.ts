import type { ExecFileException } from 'child_process';
import { execFile } from 'child_process';
import { platform, env as processEnv } from 'process';
import { Logger } from '@gitlens/utils/logger.js';

const maxParentWalkDepth = 10;

export async function focusProcessWindow(pid: number): Promise<boolean> {
	try {
		const strategy = getStrategy();
		if (strategy == null) return false;

		// Try the given PID first, then walk up parent PIDs
		// (the agent process runs inside a terminal, and the terminal owns the window)
		// This will not always work (e.g. when running Claude from `foot tmux`,
		// the process tree stops at tmux)
		let currentPid: number | undefined = pid;
		for (let depth = 0; depth < maxParentWalkDepth && currentPid != null; depth++) {
			if (await strategy(currentPid)) return true;
			currentPid = await getParentPid(currentPid);
		}

		return false;
	} catch (ex) {
		Logger.warn(`focusProcessWindow: failed to focus window for PID ${pid}: ${ex}`);
		return false;
	}
}

type FocusStrategy = (pid: number) => Promise<boolean>;

function getStrategy(): FocusStrategy | undefined {
	switch (platform) {
		case 'linux':
			return getLinuxStrategy();
		case 'darwin':
			return focusMacOS;
		case 'win32':
			return focusWindows;
		default:
			return undefined;
	}
}

function getLinuxStrategy(): FocusStrategy {
	const sessionType = processEnv.XDG_SESSION_TYPE;
	const desktop = processEnv.XDG_CURRENT_DESKTOP?.toLowerCase() ?? '';

	// Wayland compositors (check before X11 since Wayland sessions may also set DISPLAY for XWayland)
	if (sessionType === 'wayland' || processEnv.WAYLAND_DISPLAY != null) {
		if (processEnv.HYPRLAND_INSTANCE_SIGNATURE != null) {
			return focusHyprland;
		}
		if (processEnv.SWAYSOCK != null || desktop.includes('sway')) {
			return focusSway;
		}
		if (desktop.includes('kde')) {
			return focusKde;
		}
	}

	// X11 or fallback — xdotool works on X11 and sometimes under XWayland
	return focusX11;
}

async function focusX11(pid: number): Promise<boolean> {
	return run('xdotool', ['search', '--pid', String(pid), 'windowactivate']);
}

async function focusHyprland(pid: number): Promise<boolean> {
	return run('hyprctl', ['dispatch', 'focuswindow', `pid:${pid}`]);
}

async function focusSway(pid: number): Promise<boolean> {
	return run('swaymsg', [`[pid=${pid}]`, 'focus']);
}

async function focusKde(pid: number): Promise<boolean> {
	return run('kdotool', ['windowactivate', '--pid', String(pid)]);
}

async function focusMacOS(pid: number): Promise<boolean> {
	return run('osascript', [
		'-e',
		`tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
	]);
}

async function focusWindows(pid: number): Promise<boolean> {
	return run('powershell', [
		'-NoProfile',
		'-NonInteractive',
		'-Command',
		`(New-Object -ComObject WScript.Shell).AppActivate(${pid})`,
	]);
}

async function getParentPid(pid: number): Promise<number | undefined> {
	try {
		let stdout: string;
		if (platform === 'win32') {
			stdout = await exec('wmic', ['process', 'where', `(ProcessId=${pid})`, 'get', 'ParentProcessId']);
		} else {
			stdout = await exec('ps', ['-o', 'ppid=', '-p', String(pid)]);
		}

		// wmic outputs a header line ("ParentProcessId") followed by the value;
		// split on whitespace and parse the last non-empty token to skip the header.
		const tokens = stdout.trim().split(/\s+/);
		const parsed = parseInt(tokens.at(-1)!, 10);
		if (isNaN(parsed) || parsed <= 1) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

function run(command: string, args: string[]): Promise<boolean> {
	return new Promise<boolean>(resolve => {
		execFile(command, args, { timeout: 5000 }, (error: ExecFileException | null) => {
			resolve(error == null);
		});
	});
}

function exec(command: string, args: string[]): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		execFile(command, args, { timeout: 5000 }, (error: ExecFileException | null, stdout: string) => {
			if (error != null) {
				reject(error instanceof Error ? error : new Error(`exec failed: ${command}`));
			} else {
				resolve(stdout);
			}
		});
	});
}
