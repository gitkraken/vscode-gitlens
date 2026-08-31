import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileString } from 'sass-embedded';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';

await rm(join(packageRoot, 'dist'), { recursive: true, force: true });
execFileSync(tsc, ['-p', 'tsconfig.build.json'], { cwd: packageRoot, stdio: 'inherit' });
const repoRoot = join(packageRoot, '..', '..', '..');
const [engineTheme, hostNeutralTheme, vscodeTheme] = await Promise.all([
	readFile(join(packageRoot, '..', 'commit-graph', 'graph-default-theme.css'), 'utf8'),
	readFile(join(packageRoot, 'src', 'theme.css'), 'utf8'),
	readFile(join(packageRoot, 'src', 'vscode-theme.css'), 'utf8'),
]);
const [surfaceStyles, stickyTimelineStyles, scrollMarkerStyles] = await Promise.all([
	readFile(join(packageRoot, 'src', 'surface.scss'), 'utf8'),
	readFile(join(packageRoot, 'src', 'sticky-timeline.scss'), 'utf8'),
	readFile(join(packageRoot, 'src', 'scroll-markers.scss'), 'utf8'),
]);
const compiledStyles = compileString(`${engineTheme}\n${hostNeutralTheme}\n${surfaceStyles}`, {
	style: 'compressed',
}).css;
const compiledVscodeTheme = compileString(vscodeTheme, { style: 'compressed' }).css;
const compiledStickyTimelineStyles = compileString(stickyTimelineStyles, { style: 'compressed' }).css;
const compiledScrollMarkerStyles = compileString(scrollMarkerStyles, { style: 'compressed' }).css;
await Promise.all([
	writeFile(join(packageRoot, 'surface.css'), `${compiledStyles}\n`),
	writeFile(join(packageRoot, 'vscode-theme.css'), `${compiledVscodeTheme}\n`),
	writeFile(join(packageRoot, 'sticky-timeline.css'), `${compiledStickyTimelineStyles}\n`),
	writeFile(join(packageRoot, 'scroll-markers.css'), `${compiledScrollMarkerStyles}\n`),
	cp(join(repoRoot, 'LICENSE'), join(packageRoot, 'LICENSE')),
	cp(join(repoRoot, 'LICENSE.plus'), join(packageRoot, 'LICENSE.plus')),
]);
