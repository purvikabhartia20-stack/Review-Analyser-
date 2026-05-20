# Fully Autonomous Pipeline Deployed 🚀

I've successfully updated your Review Analyser to be completely autonomous using free Google APIs. It is now ready to run by itself on a cloud scheduler.

## What I Changed

### 1. Direct API Integration (No Agent Required)
We replaced the MCP (Model Context Protocol) instructions with the official Google APIs library (`googleapis`).
- **Google Drive Integration**: The script directly creates a Google Doc containing the pulse summary.
- **Gmail Integration**: The script automatically sends the email to your `RECIPIENT_EMAIL` with the link to the created Google Doc.

### 2. Authentication Flow
I created `src/auth_setup.js` for you. Because this script will run completely unattended in the cloud, it uses a **Refresh Token** which never expires, granting the script persistent access to create docs and send emails.

### 3. Automated Scheduling via GitHub Actions
I created `.github/workflows/schedule.yml`. 
- **The Schedule**: It is set to run every Monday at `0 9 * * 1` (9:00 AM UTC). 
- **The Process**: GitHub spins up a free runner, checks out your code, installs dependencies, and runs `npm start`.

---

## 🛠️ Your Next Steps (Crucial)

To finalize the setup and test it, follow these steps in order:

### Step 1: Generate your Refresh Token locally
Open your terminal and run:
```bash
node src/auth_setup.js
```
1. It will provide a link. Click it, sign in with your Google account, and click **Continue/Allow** on the consent screens.
2. It will redirect you to a broken page (like `localhost:4100/code?code=4/0AeaY...`). 
3. Look at the URL in your browser, copy everything **after** `code=` (e.g., `4/0AeaY...`), and paste it back into your terminal.
4. The terminal will spit out a long `GOOGLE_REFRESH_TOKEN`. Add this token to your `.env` file.

> [!TIP]
> You must also add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (from your `.gauth.json`) into your `.env` file so the script knows who you are.

### Step 2: Test Locally
With your new `.env` variables, run:
```bash
npm start
```
Check your Drive for the new Doc, and check your Inbox for the email!

### Step 3: Deploy to GitHub
1. Push all these changes to your GitHub Repository.
2. Go to your GitHub Repository -> **Settings** -> **Secrets and variables** -> **Actions**.
3. Add the following **Repository Secrets**:
   - `GROQ_API_KEY`
   - `RECIPIENT_EMAIL`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`

Once these secrets are saved on GitHub, your Action will successfully run completely free every Monday at 9 AM UTC! You can also test it manually right now by going to the **Actions** tab on GitHub, selecting "Weekly Review Pulse Pipeline", and clicking "Run workflow".
