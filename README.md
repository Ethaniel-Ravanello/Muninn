# Muninn

The raven of memory. A personal Life OS: React + Vite frontend, PocketBase backend.

## Run it (two terminals)

```powershell
# 1. backend (schema is created automatically from backend/pb_migrations)
cd backend
.\pocketbase.exe serve

# 2. frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and use "Create an account". Data lives in `backend/pb_data` (back this folder up).
The PocketBase admin UI is at http://127.0.0.1:8090/_/ (create a superuser when it asks).

After you have created your account, lock down sign-ups: in the admin UI open the `users` collection,
API Rules, and set the Create rule to locked. Build the frontend with `VITE_ALLOW_SIGNUP=false` to hide the button.

## Config

- `VITE_PB_URL` points the frontend at your PocketBase server (default `http://127.0.0.1:8090`).
- `npm run build` outputs a static site (hash routing, relative paths) that works on GitHub Pages / Cloudflare Pages.

## Modules

Dashboard + Quick Inbox, Tasks (Kanban, sub-tasks, projects), Calendar, Goals, Reminders (central engine),
Habits & Routines, Journal, Health, Expenses & Budget, Subscriptions, Net Worth, Wishlist, Notes, Bookmarks,
Watch/Read/Play backlog, People, Document Vault, Review. Global search with `Ctrl+K` (`#tag` works across modules),
quick capture with `Alt+I`.

## Next steps

- Desktop: wrap `frontend/dist` with Tauri.
- Mobile: wrap it with Capacitor (the app is already responsive and has a web manifest).

## Notes editor

Click a note to open its own page. `Ctrl+E` (or the View / Edit tabs) switches modes and your choice is remembered.

- **View**: rendered Markdown (headings, lists, tables, code, quotes). Task checkboxes are clickable and write back to the note.
  `[[wikilinks]]` open the note (a dashed link creates it on click), `#tags` search your notes, and "Linked mentions" lists backlinks.
- **Edit**: Markdown editor with live preview (marks like `**` and `#` hide on lines you are not editing), `[[` autocomplete,
  `Ctrl+B` / `Ctrl+I`, automatic list continuation, `Ctrl+click` on a wikilink to follow it, and autosave (about 1 s after you stop typing).
- Not there yet: `![[embeds]]`, callouts, a graph view, and image attachments from the vault.

## Obsidian sync (two-way)

`sync/sync.mjs` keeps your Obsidian vault folder and the Muninn **Notes** in step. It needs Node 20+ and no `npm install`.
It runs on the PC that has Google Drive for desktop, and talks to PocketBase over its API, so it works against the
local PocketBase and against the one on your server alike.

Setup:

1. Restart PocketBase once so the new migration (`path` and `fm` fields on notes) is applied.
2. In Google Drive for desktop choose **Mirror files** (not Stream) so the vault is really on disk.
3. `cd sync`, copy `config.example.json` to `config.json`, then fill in your Muninn email and password, the
   PocketBase URL and `vaultPath` (forward slashes are fine, e.g. `G:/My Drive/Obsidian/MyVault`).
4. Preview first: `node sync.mjs --dry-run` prints what would happen and changes nothing.
5. Run for real: `node sync.mjs` (loops every 30 s) or `node sync.mjs --once`.
   To keep it running, add a Windows Task Scheduler task "At log on" that runs `node C:\path\to\Muninn\sync\sync.mjs`.

How notes map to files:

| Muninn note | Vault file |
| --- | --- |
| title | file name (`Title.md`) |
| category | folder (`Work/Deep` is a nested folder) |
| content | text after the frontmatter |
| tags | `tags:` in the YAML frontmatter |

Rules worth knowing:

- Other frontmatter (aliases, dates, ...) is stored and written back untouched. `.obsidian/`, `.trash/` and any dot-folder are ignored.
- Edit on one side and the other follows. Rename or move a file in Obsidian and the same note is renamed, not duplicated.
- If both sides changed since the last sync, the vault version wins and Muninn's version is saved next to it as
  `Title (Muninn conflict <date>).md`. Nothing is overwritten silently.
- Deleting a file in Obsidian deletes the note. Deleting a note in Muninn moves its file to the vault's `.trash/`.
- Safety stops: it refuses to run if the vault or server looks empty while notes are tracked (unmounted drive, wrong server),
  and it will not delete more than 30% of tracked notes (min. 3) in one pass.
- Run **one** agent per vault. Pointing agents for both a local and a server PocketBase at the same vault also works
  (the vault acts as the hub), but expect more conflict files if you edit in both places at once.
- `config.json` holds your password in plain text. Keep it out of git (already ignored), or use the env vars
  `MUNINN_URL`, `MUNINN_EMAIL`, `MUNINN_PASSWORD`, `MUNINN_VAULT` instead.
- Back up the vault before the very first run (Google Drive keeps version history, which also helps).
