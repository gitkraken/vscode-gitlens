# Library Package Architecture — Creation, Data & Coupling Flow

## 1. Extension Entry Point and Provider Registration

How the extension boots up and connects to the library packages.

```mermaid
flowchart TD
    ACT["<b>Extension activates</b><br/>src/extension.ts"]
    CTR["<b>Container</b><br/>src/container.ts"]
    GPS["<b>GitProviderService</b><br/>src/git/gitProviderService.ts"]

    ACT --> CTR --> GPS

    GPS -->|"constructor line 284"| GS["<b>GitService.createSingleton</b><br/>packages/git/src/service.ts"]
    GPS -->|"registerProviders() line 549"| REG

    subgraph REG["getSupportedGitProviders(container, cache, register)"]
        direction LR
        GL_CLI["<b>GlCliGitProvider</b><br/>Desktop: local repos"]
        GL_VSLS["<b>VslsGitProvider</b><br/>Desktop: Live Share<br/><i>extends GlCliGitProvider</i>"]
        GL_GH["<b>GlGitHubGitProvider</b><br/>Browser + Desktop:<br/>virtual repos"]
    end

    GL_CLI -->|"ensureProvider()"| CLI_P["<b>CliGitProvider</b><br/>@gitlens/git-cli<br/><i>file:, git:, gitlens: schemes</i>"]
    GL_VSLS -->|"ensureProvider()"| VSLS_P["<b>CliGitProvider</b><br/>@gitlens/git-cli<br/><i>with VslsGit executor</i><br/><i>vsls:, vsls-scc: schemes</i>"]
    GL_GH -->|"ensureProvider()"| GH_P["<b>GitHubGitProvider</b><br/>@gitlens/git-github<br/><i>vscode-vfs:, github: schemes</i>"]

    CLI_P & VSLS_P & GH_P -->|"this.register(provider, canHandle)"| GS

    GS --> CORE["<b>@gitlens/git</b><br/>GitProvider interface, RepositoryService,<br/>Cache, Models, Errors, Context"]
    CORE --> UTILS["<b>@gitlens/utils</b><br/>Decorators, Logger, Events,<br/>PromiseCache, Disposables, URI"]

    style ACT fill:#718096,color:#fff
    style CTR fill:#4a5568,color:#fff
    style GPS fill:#4a5568,color:#fff
    style GS fill:#2d3748,color:#fff
    style CORE fill:#1a365d,color:#fff
    style UTILS fill:#1a202c,color:#fff
    style GL_CLI fill:#2c5282,color:#fff
    style GL_VSLS fill:#2c5282,color:#fff
    style GL_GH fill:#2c5282,color:#fff
    style CLI_P fill:#2d3748,color:#fff
    style VSLS_P fill:#2d3748,color:#fff
    style GH_P fill:#2d3748,color:#fff
```

**Key details:**

- **Node.js (desktop):** All 3 Gl\* providers are created. **Browser (vscode.dev):** Only `GlGitHubGitProvider`.
- Each Gl\* provider lazily creates its library-level provider on first access via `ensureProvider()`, then registers it with `GitService` using a constructor-injected `register` callback.
- `VslsGitProvider` extends `GlCliGitProvider` but overrides `getProviderOptions()` to inject `VslsGit` — a custom `Git` subclass that delegates `exec()`/`stream()` to the Live Share guest. This creates a **separate** `CliGitProvider` instance from the local one, registered with `vsls:`/`vsls-scc:` scheme predicates.
- The `register` callback is `(provider, canHandle) => this._gitService.register(provider, canHandle)` — wired in `gitProviderService.ts` line 550.

## 2. Standalone Service Creation (CLI path)

For non-VS Code consumers using `@gitlens/git-cli` directly:

```mermaid
sequenceDiagram
    participant Host as Consumer
    participant Factory as createCliGitService()
    participant GS as GitService
    participant CP as CliGitProvider

    Host->>Factory: createCliGitService(options)

    Factory->>GS: GitService.createSingleton(watchingProvider?)
    activate GS
    GS->>GS: setGlobalRepositoryServiceResolver(forRepo)
    Note over GS: Wires module-level resolver<br/>so models can reach repos
    deactivate GS

    Factory->>CP: new CliGitProvider(options)
    activate CP
    Note over CP: Creates Git executor + Cache<br/>Sub-providers lazy (not yet created)
    deactivate CP

    Factory->>GS: register(provider, () => true)
    Note over GS: Catch-all routing predicate

    Factory-->>Host: return GitService
```

## 3. Consumer Data Flow (per-repository)

What happens when code calls `service.forRepo(path).branches.getBranches()`:

```mermaid
sequenceDiagram
    participant C as Consumer
    participant GS as GitService
    participant RS as RepositoryService
    participant SP as BranchesSubProvider
    participant Git as Git executor

    C->>GS: forRepo("/path/to/repo")
    activate GS
    GS->>GS: check _serviceCache
    alt cache miss
        GS->>GS: match provider via canHandle predicate
        GS->>RS: createRepositoryService(provider, repoPath)
        GS->>GS: cache the RepositoryService
    end
    GS-->>C: RepositoryService
    deactivate GS

    C->>RS: repo.branches.getBranches(options?)
    Note over RS: Lazy getter creates proxy<br/>on first access, caches it
    RS->>SP: getBranches(repoPath, options?)
    Note over RS: repoPath auto-injected<br/>by proxy wrapper
    SP->>Git: exec(cwd: repoPath, "branch", ...)
    Git-->>SP: raw stdout
    SP->>SP: parse output
    SP-->>C: PagedResult of GitBranch
```

## 4. Sub-Provider Constructor Injection

Each sub-provider in `CliGitProvider` is a lazy getter that receives up to 4 shared dependencies:

```mermaid
flowchart TD
    subgraph owner["CliGitProvider (shared state)"]
        CTX["GitServiceContext<br/><i>config, fs, hooks, remotes, workspace</i>"]
        GIT["Git executor<br/><i>command queue + version detection</i>"]
        CACHE["Cache<br/><i>worktree-aware, multi-type</i>"]
        SELF["self as CliGitProviderInternal<br/><i>for cross-sub-provider calls</i>"]
    end

    subgraph required["Required (11)"]
        direction LR
        R1["Branches"] --- R2["Commits"] --- R3["Config"] --- R4["Contributors"]
        R5["Diff"] --- R6["Graph"] --- R7["Refs"] --- R8["Remotes"]
        R9["Revision"] --- R10["Status"] --- R11["Tags"]
    end

    subgraph optional["Optional (7) — CLI implements all, GitHub omits these"]
        direction LR
        O1["Blame"] --- O2["Operations"] --- O3["Patch"] --- O4["PausedOps"]
        O5["Staging"] --- O6["Stash"] --- O7["Worktrees"]
    end

    owner -->|"new XxxSubProvider(context, git, cache, self)"| required
    owner -->|"same pattern"| optional

    style optional stroke-dasharray: 5 5
```

> **Exception:** `BlameGitSubProvider` omits `context` — constructor is `(git, cache, self)`.

## 5. GitServiceContext — Host-to-Library Boundary

The context object is how the host (VS Code extension) provides configuration and hooks to the library without the library depending on VS Code:

```mermaid
flowchart LR
    subgraph host["Host (VS Code Extension)"]
        direction TB
        H1["VS Code Settings"]
        H2["workspace.fs"]
        H3["Container events"]
        H4["IntegrationService"]
        H5["Workspace API"]
        H6["AI / Search"]
    end

    subgraph ctx["GitServiceContext"]
        direction TB
        C1["config?"]
        C2["fs"]
        C3["hooks?"]
        C4["remotes?"]
        C5["workspace?"]
        C6["searchQuery?"]
    end

    subgraph lib["What the library uses it for"]
        direction TB
        L1["Default options when<br/>callers omit them"]
        L2["Read gitignore,<br/>FETCH_HEAD, etc."]
        L3["Cache invalidation,<br/>repo change events"]
        L4["Custom remote providers,<br/>sorting, repo info"]
        L5["Trust-gated ops,<br/>worktree default paths"]
        L6["NLP to structured<br/>search conversion"]
    end

    H1 --> C1 --> L1
    H2 --> C2 --> L2
    H3 --> C3 --> L3
    H4 --> C4 --> L4
    H5 --> C5 --> L5
    H6 --> C6 --> L6
```

## 6. RepositoryService Proxy Mechanism

Multiple repositories share a single provider — each `RepositoryService` is just a proxy that binds `repoPath` as the first argument to every sub-provider method:

```mermaid
flowchart TD
    GS["GitService._serviceCache"]

    GS --> RSA["RepositoryService<br/>path: /repo/a"]
    GS --> RSB["RepositoryService<br/>path: /repo/b"]

    RSA --> PA["branches proxy<br/><i>repoPath=/repo/a bound</i>"]
    RSA --> PB["commits proxy<br/><i>repoPath=/repo/a bound</i>"]
    RSA --> PC["status proxy<br/><i>repoPath=/repo/a bound</i>"]

    RSB --> PD["branches proxy<br/><i>repoPath=/repo/b bound</i>"]
    RSB --> PE["commits proxy<br/><i>repoPath=/repo/b bound</i>"]
    RSB --> PF["status proxy<br/><i>repoPath=/repo/b bound</i>"]

    PA & PD --> BR["provider.branches"]
    PB & PE --> CM["provider.commits"]
    PC & PF --> ST["provider.status"]

    subgraph shared["Single CliGitProvider instance"]
        BR
        CM
        ST
    end

    style PA fill:#e8f4e8
    style PB fill:#e8f4e8
    style PC fill:#e8f4e8
    style PD fill:#dbeafe
    style PE fill:#dbeafe
    style PF fill:#dbeafe
```

> `createSubProviderProxyForRepo(target, repoPath)` walks the prototype chain and creates a bound wrapper for every method, prepending `repoPath` as the first argument. Proxies are cached per sub-provider per `RepositoryService`.

## 7. Global Module-Level Resolver

How models (plain data objects in `@gitlens/git`) reach back into the service layer:

```mermaid
flowchart LR
    SET["<b>GitService constructor</b><br/>setGlobalRepositoryServiceResolver(<br/>  repoPath => this.forRepo(repoPath)<br/>)"]
    RESOLVER["_repositoryServiceResolver<br/><i>module-level variable in<br/>repositoryService.ts</i>"]
    GET["<b>getRepositoryService(repoPath)</b><br/><i>public API for models</i>"]
    MODEL["<b>Model layer</b><br/>e.g. worktree.hasWorkingChanges()<br/>calls getRepositoryService()"]

    SET -->|"wires at startup"| RESOLVER
    MODEL -->|"calls"| GET
    GET -->|"reads"| RESOLVER

    style RESOLVER fill:#fff3cd,color:#000
```

> The resolver is set once during `GitService` construction and cleared on `dispose()`. If called before construction, `getRepositoryService()` returns `undefined` (safe — uses optional chaining internally).
