# Local Development Setup

## First Time Setup

### 1. Open the project in Cursor
File → Open Folder → select `startracker-import-tool`

### 2. Open Terminal
View → Terminal (or press `` Ctrl+` ``)

### 3. Install dependencies
```bash
npm install
```

This downloads all the required packages. Takes about 30-60 seconds.
You'll see a `node_modules` folder appear — this is normal (and ignored by git).

### 4. Start the dev server
```bash
npm run dev
```

You'll see output like:
```
  VITE v4.4.5  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h to show help
```

### 5. Open in browser
Click the `http://localhost:5173/` link or copy it to your browser.

---

## Daily Workflow

### Starting work
```bash
npm run dev
```

### Stopping the server
Press `Ctrl+C` in the terminal

### After making changes
- Code changes auto-refresh in the browser (hot reload)
- No need to restart the server

---

## Making Changes

### Edit code
1. Open `src/App.jsx` in Cursor
2. Make changes
3. Save the file
4. Browser auto-refreshes

### Commit and deploy
```bash
git add .
git commit -m "Description of changes"
git push
```

Netlify auto-deploys within ~1 minute.

---

## Useful Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start local dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build locally |

---

## Troubleshooting

### "command not found: npm"
You need Node.js installed. Download from https://nodejs.org/

### "EACCES permission denied"
Try: `sudo npm install` (Mac/Linux)

### Port 5173 already in use
Another dev server is running. Either:
- Find and stop it, OR
- Use a different port: `npm run dev -- --port 3000`

### Changes not showing in browser
1. Hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
2. Check terminal for errors
3. Make sure file is saved

### Build fails
Check terminal output for specific error. Common issues:
- Syntax error in JSX
- Missing import
- Typo in component name

---

## File Structure Reminder

```
startracker-import-tool/
├── src/
│   ├── App.jsx          ← Main application code
│   ├── main.jsx         ← Entry point (don't edit)
│   └── index.css        ← Tailwind directives (don't edit)
├── test-data/           ← Test CSV files
├── CONTEXT.md           ← Business rules & requirements
├── TEST_CHECKLIST.md    ← Testing guide
├── CHANGELOG.md         ← Version history
├── .cursorrules         ← AI agent instructions
└── ... (config files)
```

Most of your work will be in `src/App.jsx`.
