# Character Minds

Character Mind is an experimental managed agent that applies the Karpathy LLM Wiki pattern to one character in one Conversation. It compiles the current Character Card and formed Daily Memories into an interlinked Markdown wiki. This iteration returns standalone query briefings; it does not alter normal character response generation.

## Enable the agent

Open the Conversation's **Agents** settings and enable **Character Mind**. Its active-agent card then exposes **Manage Character Mind**.

The management window selects the connection, builds or syncs each character's mind, shows live status, runs lint, cancels active work, and returns standalone query briefings. The connection choice is global for every Character Mind; the same connection performs ingest, query, and lint. Leaving it empty uses the default agent connection and then the Conversation connection. Character Mind does not run in the normal pre-generation, parallel, or post-generation pipelines.

Build runs one sequential model operation for the Character Card and every formed Daily Memory, so an established Conversation can take time and incur multiple model calls. A partial or cancelled Build remains on disk and is resumed with Sync.

## Files

Each mind lives below:

```text
DATA_DIR/character-minds/<chatId>/<characterId>/
├── SCHEMA.md
├── index.md
├── log.md
├── raw/
│   ├── character-card/
│   └── daily-memories/
└── wiki/
```

- `raw/` contains deterministic, immutable source snapshots written by Marinara. Do not edit them.
- `wiki/` contains the agent-maintained synthesis.
- `SCHEMA.md` defines the wiki rules and may be edited manually.
- `index.md` is the wiki catalog.
- `log.md` is Marinara's append-only operation record and the durable ingest ledger.

The management window can open an initialized mind in the server host's file manager or copy its absolute path. On desktop, open either `character-minds` or an individual mind directory as an Obsidian vault. Docker users must bind-mount `DATA_DIR` to reach the Markdown. Android app storage is generally inaccessible without root access, and no in-app file browser is provided.

## API operations

Replace `<chatId>` and `<characterId>` in these paths:

| Method and path                                                | Operation                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/chats/<chatId>/character-minds/<characterId>/status` | Inspect initialization, pending sources, current operation, and last log result                  |
| `POST .../build`                                               | Create the mind, snapshot current sources, and ingest them in order                              |
| `POST .../sync`                                                | Snapshot changed sources and ingest pending revisions                                            |
| `POST .../query`                                               | Return a detailed briefing grounded in wiki pages and cited raw sources                          |
| `POST .../lint`                                                | Check and repair the wiki using existing evidence                                                |
| `POST .../open-folder`                                         | Open the initialized directory in the server host's file manager; requires loopback/admin access |
| `POST .../cancel`                                              | Abort the active model operation without deleting files                                          |

Sync accepts an optional bounded batch size:

```json
{ "maxSources": 10 }
```

Query accepts up to 32 KiB of caller text:

```json
{ "query": "How does this situation relate to the character's history with Alex?" }
```

Build intentionally fails when the mind directory already exists; use Sync to resume a partial Build. After an existing mind's Daily Memories change, Marinara attempts a one-source Sync in the background. Every seventh successful ingest also queues lint. These background operations never fail the Daily Memory write.

There is no API or in-app UI for browsing, editing, or clearing the Markdown. To clear a mind in this iteration, stop Marinara and deliberately remove that character's mind directory yourself. Normal chat or character deletion removes the associated directory, and normal backups include `character-minds`.
