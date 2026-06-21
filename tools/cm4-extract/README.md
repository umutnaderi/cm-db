# CM 03-04 cache extractor

The native CM database loader resolves the variable-length player and
non-player records into a stable in-memory model. This tool reads that model
once and writes the compact `cm4-cache.json` consumed by the web app.

The web app now runs this automatically the first time you select a CM4
database, but the matching native loader must still be open because this
database family resolves its records into memory.

- For original CM4 / 02-03, open `cm4.exe` and load or start a game.
- For CM 03-04, open `cm data editor.exe` and load the season's
  `server_db.dat`.
- Select the matching database in the web app.

Manual fallback from the repo root:

`npm run cm4:cache -- "03-04 dat"`

The loader and extractor must run on the same Windows machine.
