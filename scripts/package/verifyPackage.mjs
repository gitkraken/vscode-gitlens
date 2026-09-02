import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { extractTarGz } from './extractTarGz.mjs';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

// The repo's tsconfig.base.json targets ES2023; only `lib` (and the odd decorator/class-fields flag) genuinely
// differs per package, so keep those as the sole per-package overrides rather than drifting target/lib apart.
const baseCompilerOptions = {
	module: 'ESNext',
	moduleResolution: 'Bundler',
	noEmit: true,
	skipLibCheck: true,
	strict: true,
	target: 'ES2023',
};

/** Packs `pkg.root` with `pnpm pack` and extracts it into `consumerDir/node_modules/<scope>/<name>`.
 *  @returns {Promise<string>} The tarball's path, for the publish gates below. */
async function packAndExtract(pkg, packDir, consumerDir) {
	const before = new Set(await readdir(packDir));
	execFileSync(pnpm, ['pack', '--pack-destination', packDir], { cwd: pkg.root, stdio: 'inherit' });
	const tarball = (await readdir(packDir)).find(file => file.endsWith('.tgz') && !before.has(file));
	if (tarball == null) throw new Error(`No tarball produced for ${pkg.name}`);

	const scopeDir = join(consumerDir, 'node_modules', pkg.scope);
	await mkdir(scopeDir, { recursive: true });
	await extractTarGz(join(packDir, tarball), scopeDir);
	const packedRoot = join(scopeDir, pkg.name);
	await rename(join(scopeDir, 'package'), packedRoot);
	await assertNoDeclarationMaps(packedRoot, pkg.name);

	return join(packDir, tarball);
}

/** The tarball ships no `src/`, and unlike a JS source map, a declaration map cannot embed its sources —
 *  every `.d.ts.map` in a published package would point a consumer's editor at a file it doesn't have. */
async function assertNoDeclarationMaps(packedRoot, label) {
	const offenders = [];

	for await (const file of walkFiles(packedRoot)) {
		if (file.endsWith('.d.ts.map')) {
			offenders.push(relative(packedRoot, file));
		}
	}

	if (offenders.length > 0) {
		throw new Error(
			`${label} ships ${offenders.length} declaration map(s) with no source to point at, e.g.\n` +
				offenders
					.slice(0, 5)
					.map(f => `  ${f}`)
					.join('\n'),
		);
	}
}

/**
 * Runs publint and attw over the packed tarball — the artifact a consumer installs, not the working
 * tree — for a package that is actually published. Both are devDependencies of the package under test,
 * so resolve their bins there rather than through PATH.
 *
 * attw only analyses wildcard `exports` entries when they are named, and reports a CSS subpath as
 * unresolvable because a stylesheet has no type declarations, so callers pass a representative list of
 * real module entrypoints. `esm-only` drops the node10 and require() rows: these packages are
 * ESM-only browser packages with no CJS story to get wrong.
 *
 * @param {{ root: string, name: string, publishGates: { attwEntrypoints: string[] } }} pkg
 * @param {string} tarball
 */
function runPublishGates(pkg, tarball) {
	const bin = name => join(pkg.root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
	const options = { cwd: pkg.root, stdio: 'inherit', shell: process.platform === 'win32' };

	// `--level error`: suggestions and warnings are advisory, and a gate that fails on them would block
	// on style opinions rather than on a package a consumer cannot use.
	execFileSync(bin('publint'), ['run', tarball, '--level', 'error'], options);
	execFileSync(
		bin('attw'),
		[
			tarball,
			'--profile',
			'esm-only',
			'--format',
			'table-flipped',
			'--entrypoints',
			...pkg.publishGates.attwEntrypoints,
		],
		options,
	);
}

/** Symlinks a hoisted (possibly scoped, e.g. `@lit-labs/virtualizer`) `node_modules` package from `fromDir`
 *  into the consumer, since the packed package resolves its peer/runtime deps from the consumer's own tree.
 *  Most deps are hoisted to the repo root, but pnpm keeps some (e.g. `fast-string-truncated-width`) private
 *  to the workspace package that declares them — pass that package's own root as `fromDir` for those. */
export async function linkNodeModule(fromDir, consumerDir, name) {
	const parts = name.split('/');
	const target = join(consumerDir, 'node_modules', ...parts);
	if (parts.length > 1) await mkdir(dirname(target), { recursive: true });
	await symlink(join(fromDir, 'node_modules', ...parts), target, 'junction');
}

/** Symlinks lit's runtime family (`lit`, `lit-html`, `lit-element`, `@lit/*`) from the store directory pnpm
 *  hoists them into alongside `lit` itself — they aren't reachable as plain top-level `node_modules` entries. */
export async function linkLitFamily(repoRoot, consumerDir) {
	const litRoot = dirname(await realpath(join(repoRoot, 'node_modules', 'lit')));
	await Promise.all([
		linkNodeModule(repoRoot, consumerDir, 'lit'),
		symlink(join(litRoot, 'lit-html'), join(consumerDir, 'node_modules', 'lit-html'), 'junction'),
		symlink(join(litRoot, 'lit-element'), join(consumerDir, 'node_modules', 'lit-element'), 'junction'),
		symlink(join(litRoot, '@lit'), join(consumerDir, 'node_modules', '@lit'), 'junction'),
	]);
}

async function* walkFiles(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkFiles(fullPath);
		} else if (entry.isFile()) {
			yield fullPath;
		}
	}
}

// Quoted, so this matches a module specifier (`import`, `export … from`, `import()`, a `types=`
// reference) and not an incidental mention of the name in prose.
const workspaceSpecifierRegex = /(['"])(?:@gitlens\/|#env\/)[^'"]+\1/;

/** `@gitlens/*` packages are workspace-internal and never published, so a published `@gitkraken/*` tarball
 *  that still imports one is unresolvable for every consumer — npm has nothing to install under that name.
 *  `#env/*` is @gitlens/utils' own node/browser subpath-imports shim: it resolves through *that* package's
 *  manifest, so once its sources are compiled in here the specifier has to be gone too.
 *  Catches both a missed specifier rewrite and a dependency that was never compiled in. */
export async function assertNoWorkspaceSpecifiers(packedRoot, label) {
	const offenders = [];

	for await (const file of walkFiles(packedRoot)) {
		if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue;

		const content = await readFile(file, 'utf8');
		if (workspaceSpecifierRegex.test(content)) {
			offenders.push(relative(packedRoot, file));
		}
	}

	if (offenders.length > 0) {
		throw new Error(
			`${label} ships ${offenders.length} file(s) still referencing an unpublished @gitlens/* package or its #env/* shim:\n${offenders.join('\n')}`,
		);
	}
}

/** Bundles `entry` for the browser the same way every packed-package consumer does, so a real host bundler
 *  (not just tsc) proves the package tree-shakes and carries no Node-only imports. */
export function bundleForBrowser(repoRoot, consumerDir, entry, outfile, { treeShaking = true, metafile } = {}) {
	const args = [entry, '--bundle', '--platform=browser', '--format=esm', `--outfile=${outfile}`];
	if (treeShaking) args.push('--tree-shaking=true');
	if (metafile != null) args.push(`--metafile=${metafile}`);

	execFileSync(join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'), args, {
		cwd: consumerDir,
		stdio: 'inherit',
	});
}

/**
 * Packs one or more workspace packages, assembles a throwaway consumer importing from their packed output,
 * type-checks it, then runs the caller's package-specific bundle/content/runtime checks.
 *
 * Shared mechanics: pack → extract → publish gates → symlink peer deps → write tsconfig + sources → tsc →
 * cleanup. Callers
 * supply what genuinely differs: which packages to pack (self plus any workspace deps, each optionally
 * carrying `publishGates` to run publint/attw over its tarball), extra symlinked
 * deps (a bare name resolves from `repoRoot`; `{ from, name }` resolves from a package-private `node_modules`
 * for deps pnpm doesn't hoist to the root), compiler-option overrides, the consumer source files, and a
 * `verify` callback for bundling/content/runtime assertions (e.g. commit-graph-ui's bundle-composition
 * checks, commit-graph's runtime execution).
 */
export async function verifyPackedPackage({
	tempPrefix,
	repoRoot,
	packages,
	symlinks = [],
	compilerOptions,
	sources,
	beforeTsc,
	verify,
	successMessage,
}) {
	const tempRoot = await mkdtemp(join(tmpdir(), tempPrefix));
	try {
		const packDir = join(tempRoot, 'pack');
		const consumerDir = join(tempRoot, 'consumer');
		await Promise.all([mkdir(packDir, { recursive: true }), mkdir(join(consumerDir, 'src'), { recursive: true })]);

		for (const pkg of packages) {
			const tarball = await packAndExtract(pkg, packDir, consumerDir);
			if (pkg.publishGates != null) {
				runPublishGates(pkg, tarball);
			}
		}

		const ctx = { repoRoot, tempRoot, packDir, consumerDir };

		if (beforeTsc != null) {
			await beforeTsc(ctx);
		}

		await Promise.all(
			symlinks.map(entry => {
				const { from, name } = typeof entry === 'string' ? { from: repoRoot, name: entry } : entry;
				return linkNodeModule(from, consumerDir, name);
			}),
		);

		await writeFile(
			join(consumerDir, 'tsconfig.json'),
			`${JSON.stringify(
				{ compilerOptions: { ...baseCompilerOptions, ...compilerOptions }, include: ['src/**/*'] },
				null,
				2,
			)}\n`,
		);
		for (const [relativePath, content] of Object.entries(sources)) {
			await mkdir(dirname(join(consumerDir, relativePath)), { recursive: true });
			await writeFile(join(consumerDir, relativePath), content);
		}

		execFileSync(
			process.execPath,
			[join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'],
			{
				cwd: consumerDir,
				stdio: 'inherit',
			},
		);

		await verify(ctx);

		console.log(successMessage);
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
}
