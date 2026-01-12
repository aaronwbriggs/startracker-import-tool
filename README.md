# StarTracker → Bravo Import Tool

A web-based tool for classifying and preparing StarTracker export data for import into Bravo.

## What This Tool Does

1. **Upload** a StarTracker CSV export
2. **Classify** each quote as READY, FLAGGED, BLOCKED, or EXCLUDED
3. **Review** classification reasons and vehicle details
4. **Download** filtered CSVs for import or manual review
5. **Track** batch history across sessions

## Classification Rules

| Classification | Conditions |
|----------------|------------|
| **EXCLUDED** | Status = "Other", Customer = "Celebrity Coaches" or "TEST CLIENT" |
| **BLOCKED** | DiscountedDays > 0, Vehicle swap detected, Multiple $0 budget rows |
| **FLAGGED** | $0 BusRate with mileage, Driver days override, Admin fee present |
| **READY** | Passes all checks — can be imported to Bravo |

---

## Local Development

```bash
# Install dependencies
npm install

# Start dev server (opens at http://localhost:5173)
npm run dev
```

---

## Deployment to Netlify

### First-Time Setup

1. Go to [github.com/new](https://github.com/new)
2. Create a new repository named `startracker-import-tool`
3. Keep it **Private** (or Public, your choice)
4. Do NOT initialize with README (we have our own files)
5. Click "Create repository"

### Push Your Code

After creating the repo, GitHub will show you commands. Use these in your terminal:

```bash
# Navigate to this project folder
cd startracker-import-tool

# Initialize git
git init

# Add all files
git add .

# Create first commit
git commit -m "Initial commit - StarTracker import tool"

# Connect to your GitHub repo (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/startracker-import-tool.git

# Push to GitHub
git branch -M main
git push -u origin main
```

### Connect Netlify

1. Go to [app.netlify.com](https://app.netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Choose "GitHub"
4. Select your `startracker-import-tool` repository
5. Configure build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
6. Click "Deploy site"

### Optional: Add Password Protection

1. In Netlify dashboard, go to your site
2. Site settings → Access control → Visitor access
3. Enable password protection
4. Set a password to share with your team

---

## Making Updates

After you make changes to the code:

```bash
# Add your changes
git add .

# Commit with a message
git commit -m "Description of what you changed"

# Push to GitHub (Netlify will auto-deploy)
git push
```

---

## Version History

- **v1.1** - Added batch history tracking, TourID prominence
- **v1.0** - Initial release with classification engine

---

## Questions?

This is a temporary migration tool. When migration is complete, you can delete both the GitHub repo and Netlify site.
