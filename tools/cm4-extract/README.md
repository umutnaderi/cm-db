# CM 03-04 cache extractor

The CM 03-04 editor resolves the variable-length player and non-player records
into a stable in-memory model. This tool reads that model once and writes the
compact `cm4-cache.json` consumed by the web app.

The web app now runs this automatically the first time you select a CM4
database, but the editor must still be open because CM4 resolves the database
into memory.

1. Open `cm data editor.exe`.
2. Load the season's `server_db.dat`.
3. Select the database in the web app.

Manual fallback from the repo root:

`npm run cm4:cache -- "03-04 dat"`

The editor and extractor must run on the same Windows machine.
