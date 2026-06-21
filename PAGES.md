# GitHub Pages deployment

The generated static website is in `docs/`.

## Rebuild the package

```powershell
npm run pages:build
```

This recreates `docs/` from the working frontend and copies only the database
files required by the browser. The `docs/03-04 dat/` directory contains only
`cm4-cache.json`.

## Publish

1. Commit and push the `docs/` directory.
2. Open the repository's **Settings → Pages**.
3. Choose **Deploy from a branch**.
4. Select the default branch and the `/docs` folder.
5. Save.

The project site will be available at:

`https://umutnaderi.github.io/cm-db/`

## Local check

While the normal development server is running, open:

`http://localhost:5173/docs/index.html`
