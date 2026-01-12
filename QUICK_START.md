# QUICK START — Get This Live in 10 Minutes

## Step 1: Download and Unzip
Download the `startracker-import-tool.zip` file and unzip it to a folder on your computer.

## Step 2: Create GitHub Repo
1. Go to https://github.com/new
2. Name it: `startracker-import-tool`
3. Make it Private
4. Do NOT check any boxes (no README, no .gitignore)
5. Click "Create repository"
6. **Keep this page open** — you'll need the URL

## Step 3: Open Terminal in the Project Folder

**On Mac:**
- Open Finder, navigate to the unzipped `startracker-import-tool` folder
- Right-click the folder → Services → "New Terminal at Folder"
- OR open Terminal and type `cd ` (with a space), then drag the folder into Terminal and press Enter

**In Cursor:**
- File → Open Folder → select `startracker-import-tool`
- Then open the integrated terminal (View → Terminal)

## Step 4: Run These Commands (Copy/Paste One at a Time)

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Initial commit"
```

**Now replace YOUR_GITHUB_USERNAME below with your actual GitHub username:**

```bash
git remote add origin https://github.com/aaronwbriggs/startracker-import-tool.git
```

```bash
git branch -M main
```

```bash
git push -u origin main
```

If prompted for credentials, enter your GitHub username and a Personal Access Token (not your password).

## Step 5: Deploy on Netlify
1. Go to https://app.netlify.com
2. Click "Add new site" → "Import an existing project"
3. Click "GitHub" and authorize if needed
4. Find and select `startracker-import-tool`
5. Leave all settings as-is (netlify.toml handles it)
6. Click "Deploy site"
7. Wait ~1 minute for build to complete
8. Click the generated URL — your tool is live!

## Step 6 (Optional): Add Password
1. In Netlify: Site configuration → Access & security → Visitor access
2. Click "Set password"
3. Enter a password to share with Page

---

## Done! 🎉

Your URL will be something like: `https://random-name-12345.netlify.app`

You can change this in Site configuration → Domain management → Edit site name

---

## Making Future Updates

After changing any code:

```bash
git add .
git commit -m "What you changed"
git push
```

Netlify auto-deploys within ~30 seconds.
