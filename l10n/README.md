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

## Terminology conventions

A language pack is only as good as its consistency. Keep a per-language glossary and apply it everywhere, aligning with the VS Code language pack for that locale where one exists. The Chinese catalogs use this baseline:

| English         | zh-cn       | zh-tw       |
| --------------- | ----------- | ----------- |
| commit          | 提交        | 認可        |
| branch          | 分支        | 分支        |
| tag             | 标签        | 標籤        |
| stash           | 贮藏        | 擱置        |
| stage           | 暂存        | 暫存        |
| rebase          | 变基        | 重定基底    |
| cherry-pick     | 拣选        | 挑揀        |
| pull            | 拉取        | 提取        |
| fetch           | 提取        | 擷取        |
| pull request    | 拉取请求    | 提取要求    |
| merge request   | 合并请求    | 合併請求    |
| checkout        | 检出        | 簽出        |
| revert          | 还原        | 還原        |
| discard         | 放弃        | 捨棄        |
| drop            | 丢弃        | 丟棄        |
| undo            | 撤消        | 復原        |
| remote          | 远程        | 遠端        |
| repository      | 仓库        | 儲存庫      |
| worktree        | 工作树      | 工作樹      |
| working tree    | 工作树      | 工作樹      |
| workspace       | 工作区      | 工作區      |
| merge base      | 合并基      | 合併基底    |
| blame           | 追溯        | 追溯        |
| review/reviewer | 审查/审查者 | 審查/審查者 |
| provider        | 提供程序    | 提供者      |
| account         | 帐户        | 帳戶        |
| agent           | 代理        | 代理        |
| output channel  | 输出通道    | 輸出通道    |

_working tree_ (the checkout) and _worktree_ (the git feature) share a word, as they do in VS Code; _workspace_ is the only thing rendered 工作区/工作區. "Working changes" are therefore 工作树更改 / 工作樹變更.

Also hold these invariants across a language's catalogs:

- **GitLens**, **GitKraken**, **Launchpad**, and **Copilot** are opaque brand names and stay untranslated, as do git syntax, git config keys (`blame.ignoreRevsFile`) and git's own `commit-graph` maintenance command. Feature names that are English on the surface but descriptive (Worktrees, Repository Health, Inline Blame) are _not_ brand names: translate them.
- Descriptive GitKraken feature names translate (zh-cn: Commit Graph → 提交图, Visual History → 可视化历史, Visual File History → 可视化文件历史, Cloud Patch → 云补丁, Inspect → 检查器, Compose/Recompose → 撰写/重新撰写, Composer → 撰写器, Focus → 聚焦, Repository Health → 仓库健康状况). Generic references to the graph ("the Graph", lowercase "commit graph", "scope the graph") use the same translation. _Inspect_ as the view is the noun 检查器 ("Inspect Commit Details" → 在检查器中查看提交详情); _inspect_ as a verb stays a verb.
- Command names quoted inside another message (“GitLens: Open Commit Graph”, "Add a Show Commit Graph command", the “Scope to Worktree” setting description) must match that command's **translated title** in `package.nls.<locale>.json` — the user only ever sees the translated title, so an English name points at something that does not exist in their UI. Look the title up; never leave the quoted name in English and never invent a different wording. `command:` URIs and `#setting#` refs stay untouched.
- Untranslated-but-pervasive source words still need consistent treatment: when the English says "Message" but means the commit message, translate it the same way as "Commit Message".
- Punctuation follows the locale, not the source: a colon after Chinese text is full-width （`无法推送：{0}`）, parentheses around Chinese text are full-width, and quotes around names or placeholders are “…” in zh-cn and 「…」 in zh-tw. Keep ASCII punctuation inside code spans, URLs, Markdown link titles and `command:` URIs.

## Deriving zh-tw from zh-cn

For CJK locales that share a character set, a new variant can be derived mechanically instead of retranslated: run the existing catalogs through OpenCC (`s2twp` profile; ASCII, keys, and placeholders are untouched), then apply the target locale's terminology table above. OpenCC is not a repo dependency — install it locally for the one-off run. Two ordering constraints from the zh-tw derivation: convert fetch (提取→擷取) **before** pull (拉取→提取) so mixed sentences like "Confirm Pull{0}Fetching{1}" map correctly, and leave genuinely ambiguous words gated on the English source (zh-cn 提交 means both _commit_ and _submit_; zh-cn 放弃 means both _discard_ and _give up_).

`s2twp` converts characters reliably but only part of the vocabulary. The first zh-tw catalog needed a second pass over these mainland terms, so apply it as part of the derivation (gate the ambiguous ones on the English key):

| zh-cn residue              | zh-tw           |     | zh-cn residue   | zh-tw           |
| -------------------------- | --------------- | --- | --------------- | --------------- |
| 更改                       | 變更            |     | 列表            | 清單            |
| 當前                       | 目前            |     | 詳情 / 詳細資訊 | 詳細資料        |
| 應用 (apply; not 應用程式) | 套用            |     | 令牌            | 權杖            |
| 會話                       | 工作階段        |     | 標籤頁          | 索引標籤        |
| 生成                       | 產生            |     | 響應            | 回應            |
| 訪問                       | 存取            |     | 身份            | 身分            |
| 配置                       | 設定            |     | 高亮            | 醒目提示        |
| 賬戶                       | 帳戶            |     | 佈局            | 版面配置        |
| 釋出 (publish)             | 發佈            |     | 文本            | 文字            |
| 檢測                       | 偵測            |     | 構建            | 建置            |
| 終端                       | 終端機          |     | 後臺            | 背景            |
| 自定義                     | 自訂            |     | 新建            | 新增            |
| 獲取                       | 取得            |     | 證書            | 憑證            |
| 日誌 / 更新日誌            | 記錄 / 變更記錄 |     | 許可權          | 權限            |
| 反饋                       | 意見反應        |     | 工具欄 / 狀態欄 | 工具列 / 狀態列 |
| 瞭解                       | 了解            |     | 批註            | 註釋            |
| 提供程式                   | 提供者          |     | “…”             | 「…」           |

Traps seen in that pass: word-level substitution doubles compounds (文件资源管理器 → 檔案 + 檔案總管 = 檔案檔案總管), catches substrings (迷你图 is the minimap, not "the graph"; `blame.ignoreRevsFile` is a config key), and mis-maps compound glossary terms (拉取请求 must become 提取要求, not 提取請求). Print every changed entry and re-run `pnpm run check:l10n` afterwards — keys and placeholder sets cannot drift because conversion never touches ASCII, but sense can.
