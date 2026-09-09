# Translating GitLens

This folder holds GitLens' runtime message catalogs. This guide is for translators and for contributors adding a language. The engineering rules for writing localizable code are in [docs/localization.md](../docs/localization.md).

## Files

| File                           | Contains                                                        | Translation file                 |
| ------------------------------ | --------------------------------------------------------------- | -------------------------------- |
| `package.nls.json` (repo root) | Manifest text: command titles, setting descriptions, view names | `package.nls.<locale>.json`      |
| `l10n/bundle.l10n.json`        | Runtime text: notifications, quick picks, tooltips, webviews    | `l10n/bundle.l10n.<locale>.json` |

Both English files are generated from source — never edit them by hand. Locale ids follow VS Code's language packs (`de`, `es`, `fr`, `it`, `ja`, `ko`, `pt-br`, `ru`, `zh-cn`, `zh-tw`, …). GitLens follows the VS Code display language; there is no separate GitLens language setting.

## Adding or updating a language

1. Copy the English file to the locale file name above and translate the **values** only. Keys must stay byte-identical, including punctuation and trailing spaces.
2. Keep every `{0}` / `{name}` placeholder. You may reorder or repeat placeholders to suit the language, but not drop or rename them.
3. A runtime entry whose value is an object (`{ "message": …, "comment": […] }`) carries a translator note in `comment`. Translate `message`, and store the translation as a **plain string** under the same key — VS Code's extension host reads the locale bundle as-is and does not unwrap objects (only the English source keeps them). `merge` flattens this for you.
4. Partial files are fine. VS Code falls back to English per message, so a new language can land incrementally.
5. Run `pnpm run check:l10n`. It fails on unknown keys, missing or renamed placeholders, and obsolete entries.
6. A count message's key is itself a plural block, written by the engineer who added the message — for example:

   ```
   {count, plural, one{{count} file changed} other{{count} files changed}}
   ```

   Translate it by keeping the part before the first comma (`count` here) exactly as it is — it names the message's own placeholder, not text to translate — and translating each `category{...}` branch already there, the same way you would a plain message, repeating that placeholder (`{count}`) inside it. English only ever writes `one` and `other`, so that is all you will find to translate for most messages. If your language distinguishes more CLDR plural categories than English does — Russian's "few"/"many", Arabic's "zero"/"two", and so on — add the branches your language needs: `zero`, `one`, `two`, `few`, `many`, `other`. An `other` branch is required and must stay; a two-form language (French, German, Chinese, …) needs nothing beyond translating the branches already there. An exact count can also be targeted with `=N` (`=0{no files changed}`) — it wins over whichever CLDR category that count would otherwise fall into. `pnpm run check:l10n` validates every block (an `other` branch, valid branch names, matching placeholders) the same way it validates a plain translation.

   A message can have more than one count in one sentence ("`{0} commit behind, {1} commits ahead`") — you will find two blocks, either side by side or one nested inside a branch of the other. Translate each independently, by the rule above; a block only ever needs the categories for its own count.

   A message that already has a plural block **must** keep one — do not flatten it to plain text, even for a two-form language where every branch would end up saying the same thing for "one" and "other" values you don't have a `zero`/`two`/`few`/`many` category for.

Do not translate: Git syntax and flags (`--force`, `author:`, `HEAD~1`), command and setting ids, `$(icon)` codicon tokens, product names (GitLens, GitKraken, Launchpad, Commit Graph), and anything inside a placeholder. Keep `\n` line breaks and Markdown link syntax intact.

For larger efforts, `@vscode/l10n-dev` can round-trip XLIFF: `pnpm exec vscode-l10n-dev generate-xlf` and `pnpm exec vscode-l10n-dev import-xlf`. After importing, place manifest catalogs at the repo root and runtime catalogs in this folder.

## Seeing it in VS Code

Install Microsoft's language pack for the locale, set **Configure Display Language** to it, and reload. To exercise layout without a real translation, run `pnpm run generate:l10n:pseudo` and use the Pseudo Language Pack (`qps-ploc`); the generated pseudo catalogs are git-ignored and excluded from the VSIX.

## Review

New languages get a human review before they are advertised as supported. Open a pull request with the two locale files; the catalog check runs in CI.

## Chunked translation workflow

For a language with no existing translation (or a large backlog of new messages), `scripts/localization-chunks.mjs` breaks the work into small, independently translatable files:

```bash
node scripts/localization-chunks.mjs split zh-cn        # writes untranslated entries as .work/l10n-chunks/zh-cn/chunk files
node scripts/localization-chunks.mjs merge zh-cn        # merges translated chunks into the two locale files
node scripts/localization-chunks.mjs prune zh-cn        # drops entries whose English message no longer exists
```

`split` writes `<catalog>-NN.json` chunk files (manifest catalog as `manifest-NN.json`, runtime catalog as `bundle-NN.json`), each holding ~600 English entries. Translate the **values** in each chunk — the same rules as above: keys stay byte-identical, placeholders (`{0}`, `{name}`, codicons, brace-wrapped fragments) are preserved, whitespace and Markdown survive, product names stay untranslated. Write the translated chunk to the same file name, then `merge` validates every chunk (reusing the same rules as `pnpm run check:l10n`) and folds the entries into the locale files, preserving any existing translations. `prune` removes entries orphaned when an English message is edited (the old text becomes an unknown key and fails the catalog check).

When the English source changes, rerun `split`: it diffs the fresh catalogs against the locale files and emits chunks containing only the untranslated entries.
