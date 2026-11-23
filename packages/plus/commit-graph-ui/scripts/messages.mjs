import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCatalog, formatCatalog } from '../../../../scripts/localization.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const catalog = await extractCatalog(['packages/plus/commit-graph/src', 'packages/plus/commit-graph-ui/dist']);
if (Object.keys(catalog).length === 0) throw new Error('No messages found for the commit graph catalog');

await mkdir(join(packageRoot, 'dist', 'l10n'), { recursive: true });
await writeFile(join(packageRoot, 'dist', 'l10n', 'messages.json'), formatCatalog(catalog));
