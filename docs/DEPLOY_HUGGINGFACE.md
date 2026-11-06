# Deploy ZERO ROT on Hugging Face Spaces (free)

Every push to `master` on GitHub runs the tests and, if they pass, updates the Space automatically
(`.github/workflows/deploy-hf.yml`).

**Free Space:** 2 vCPU, 16 GB RAM, HTTPS address `https://<owner>-zerorot.hf.space`. Everything runs, including the
offline Kannada voice.
**Limits:** the Space sleeps after 48 hours with no visitors (the next visit wakes it in about a minute), and its storage
is reset whenever it restarts or redeploys, so lots and history start empty after each deploy. The admin login is
recreated automatically from the secrets below.

## 1. Create the Space
1. Sign up at https://huggingface.co (free).
2. **New → Space**:
   - Space name: `zerorot`
   - License: your choice (e.g. MIT)
   - **SDK: Docker**, template **Blank**
   - Hardware: **CPU basic (free)**
   - Visibility: **Public** (phones must open it without a Hugging Face login)
3. Click **Create Space**. Leave it empty; GitHub fills it.

Your app address is `https://<owner>-zerorot.hf.space` (lower case; `<owner>` is your Hugging Face username).

## 2. Add the Space's settings and secrets
Space page → **Settings → Variables and secrets**.

**Secrets** (hidden):

| Name | Value |
|---|---|
| `JWT_SECRET` | a long random string: `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | your login password (pick a strong one: the site is public) |
| `DATA_GOV_API_KEY` | your data.gov.in key |
| `GROQ_API_KEY_1` … `GROQ_API_KEY_5` | your Groq keys (as many as you have) |

**Variables** (visible):

| Name | Value |
|---|---|
| `PUBLIC_BASE_URL` | `https://<owner>-zerorot.hf.space` (used in the phone QR codes) |
| `CORS_ORIGINS` | `https://<owner>-zerorot.hf.space` |

## 3. Create a Hugging Face write token
Your avatar → **Settings → Access Tokens → Create new token**:
- Type **Write** (or fine-grained with write access to the `zerorot` Space)
- Name `github-deploy`
- Copy the token (starts with `hf_`). Never commit it or paste it in chat.

## 4. Connect GitHub to the Space
GitHub repo → **Settings → Secrets and variables → Actions**:
- **Secrets** tab → **New repository secret**: `HF_TOKEN` = the token from step 3
- **Variables** tab → **New repository variable**: `HF_SPACE` = `<owner>/zerorot`

## 5. Deploy
- Push any commit to `master`, or GitHub → **Actions → Test and deploy to Hugging Face → Run workflow**.
- The workflow tests the code (about 3 minutes), then pushes it to the Space.
- The Space builds the Docker image. The first build takes about 10–15 minutes (PyTorch and the voice model);
  later builds are faster. Watch it on the Space page → **Logs**.
- When the status turns **Running**, open **`https://<owner>-zerorot.hf.space`** (use this direct address, not the
  huggingface.co/spaces page: the embedded view blocks the phone microphone).
- Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`, open `/world`, scan the QR code with a phone.

## After that
Change code → push to `master` → tests run → the Space rebuilds and restarts with the new version (a few minutes).
If the tests fail, nothing is deployed and the live Space keeps the previous version.

## Troubleshooting
- **Deploy job skipped:** the `HF_SPACE` variable is missing (step 4).
- **Push rejected / 401:** the token is not a write token, or `HF_SPACE` has a typo.
- **Space stuck "Building" or "Runtime error":** open **Logs** on the Space page.
- **Prices say "data unavailable":** `DATA_GOV_API_KEY` secret missing.
- **Assistant says it is unavailable:** Groq secrets missing.
- **QR code opens the wrong address:** `PUBLIC_BASE_URL` must be the exact `https://<owner>-zerorot.hf.space` address.
