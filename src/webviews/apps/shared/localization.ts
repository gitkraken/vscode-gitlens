import * as l10n from '@vscode/l10n';
import { fromBase64ToString } from '@gitlens/utils/base64.js';
import { setPluralLocale } from '@gitlens/utils/plural.js';

// Webpack runs this entry before importing each app, including modules whose labels are
// initialized at module scope. The host embeds its selected bundle without an extra RPC or fetch.
const contents = document.querySelector<HTMLMetaElement>('meta[name="gitlens-l10n"]')?.content;
l10n.config({ contents: contents ? fromBase64ToString(contents) : {} });
setPluralLocale(document.documentElement.lang || undefined);
