# Steam Deck Plugin: Anonymous Voting System Plan

## 1. Architecture Overview

The system uses a **Blind-ID** approach. We generate a unique identifier on the Steam Deck, hash it to ensure anonymity, and store the vote in a cloud database.

- **Frontend**: Decky Plugin (React/TS)
- **Database**: Supabase (PostgreSQL) — Handles real-time increments and duplicate prevention
- **Backup**: GitHub Actions — Daily "snapshot" of total votes saved to the repo as JSON
- **Anonymity**: SHA-256 Hashing of the Deck's Machine ID

## 2. Supabase Setup (The "Live" DB)

- **Create a Project**: Sign up at supabase.com
- **SQL Table**: Run this in the SQL Editor:

```sql
-- Create a table for unique votes
CREATE TABLE plugin_votes (
    hashed_id TEXT PRIMARY KEY, -- Prevents double voting
    voted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a view to easily fetch the total count
CREATE VIEW total_votes AS
SELECT count(*) as count FROM plugin_votes;
```

- **Enable RLS**: Set Row Level Security to allow INSERT only.

## 3. Decky Plugin Logic (The "Send" System)

In your plugin's Python backend (`main.py`), generate the anonymous ID so the user doesn't have to log in.

### Python (Backend)

```python
import hashlib
import subprocess

def get_anonymous_id():
    # Grabs the unique hardware ID of the Steam Deck
    raw_id = subprocess.check_output(['cat', '/etc/machine-id']).decode().strip()
    # Hash it so you (the dev) never see the real ID
    return hashlib.sha256(raw_id.encode()).hexdigest()
```

### Frontend (TypeScript)

```typescript
const handleVote = async () => {
  const hashedId = await serverApi.callPluginMethod("get_anonymous_id", {});

  const { error } = await supabase
    .from('plugin_votes')
    .insert([{ hashed_id: hashedId }]);

  if (error?.code === '23505') {
    console.log("User already voted!");
  }
};
```

## 4. GitHub Actions "Backfill" (The "Storage" System)

Create a file at `.github/workflows/sync-votes.yml`:

```yaml
name: Daily Vote Sync
on:
  schedule:
    - cron: '0 0 * * *' # Once a day at midnight
  workflow_dispatch: # Allows manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Fetch Votes from Supabase
        run: |
          curl -X GET "${{ secrets.SUPABASE_URL }}/rest/v1/total_votes" \
          -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" \
          -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}" \
          -o votes.json
      - name: Commit and Push
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add votes.json
          git commit -m "Update vote backfill" || exit 0
          git push
```

## 5. Security & Privacy Checklist

- [ ] **Anonymity**: The machine-id is never sent in plain text. Only the SHA-256 hash leaves the device
- [ ] **Spam Protection**: The PRIMARY KEY on hashed_id in Supabase automatically rejects multiple votes from the same device
- [ ] **Reliability**: If the Supabase API fails, the plugin can fetch `https://raw.githubusercontent.com/[USER]/[REPO]/main/votes.json` to show the last known count

## Why This Works

- **No Cost**: Both Supabase and GitHub Actions are free for this scale
- **No Login**: Users just click a button. They don't have to sign into GitHub on their Deck
- **Data Ownership**: You have the live data in Supabase and a version-controlled history in GitHub
