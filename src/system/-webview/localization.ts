import * as sharedL10n from '@vscode/l10n';
import { env, l10n } from 'vscode';
import { setPluralLocale } from '@gitlens/utils/plural.js';

// Runs before extension modules so shared package constants use VS Code's selected bundle.
sharedL10n.config({ contents: l10n.bundle ?? {} });
setPluralLocale(env.language);
