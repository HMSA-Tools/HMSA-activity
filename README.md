# HMSA Sales Activity Dashboard

Internal sales activity tracker for HD Hyundai Marine Solution Americas.
Meetings / VCs / business trips, per-employee dashboards, meeting-report approval workflow, role-based access.

**Stack:** GitHub Pages (frontend) + Supabase (auth · DB · row-level security). $0 hosting. No email service needed.

---

## 🚀 Setup (~15 min)

### 1. Create a Supabase project
1. https://supabase.com → New Project (free plan)
2. Open **SQL Editor** → paste the entire `supabase/schema.sql` → **Run**

### 2. Auth setting (one checkbox)
- **Authentication → Sign In / Up → Email → uncheck "Confirm email"**
  (Login IDs are stored internally as `id@hmsa.app` — no real email is ever sent, so confirmation must be off.)

### 3. Paste your keys
- **Settings → API** → copy `Project URL` and `anon public` key into `js/config.js`

### 4. Enter the staff roster
- **Table Editor → staff**: add each person — name, emp_no (employee number), part, role
- role: `member` / `leader` (part leader) / `director`

### 5. Bootstrap your admin account
1. Open the site → "Request an account" → select your name → employee number → choose a login ID + password
2. In Supabase SQL Editor:
```sql
update public.staff set is_admin = true, status = 'active'
  where login_id = 'your-login-id';
```
3. From then on, approve everyone else with one click in **Admin → Pending approval**

### 6. Deploy to GitHub Pages
1. New GitHub repo → upload this whole folder (logo.png included)
2. Settings → Pages → Branch: main → Save
3. Done: `https://yourname.github.io/repo-name/`
   (The anon key in config.js is safe to expose — RLS enforces all permissions server-side.)

---

## 🔑 Sign-in model
- Admin pre-registers the roster (name + employee number + part + role)
- New person: picks their name → verifies with employee number → chooses login ID (guide: e.g. `G2000001`) + password → **Pending** until admin approves
- **Forgot password?** Admin opens **Admin → Reset PW** on that person, sets a temporary password, tells them directly. They sign in and change it themselves (sidebar → Change password).
- No email, no verification codes, nothing to configure.

## 🔐 Permissions (enforced by database RLS, not the UI)

| Role | Own part | Other parts |
|---|---|---|
| Director | Full detail + reports + return history | Same (everything) |
| Part Leader | Detail + report review/approve | Activity detail visible, **reports NOT visible** |
| Member | Own part activity detail + own reports | Aggregate summary only |
| Admin flag | Account approval, roster management, password resets | — |

Note: the admin flag is independent of sales roles — e.g. a director's assistant can be `member` + admin, managing accounts without appearing as a sales lead.

## 📄 Report workflow
Draft → Submitted → Approve ✅ or Return ↩️ (reason required) → author edits → resubmit (version +1) → Approve.
Every step is written to a tamper-proof history timeline.

## 📊 Dashboard counting
- **Hosted**: activities you created (primary metric)
- **Joined**: activities where someone added you as a participant (shown separately to prevent double-counting)

## ⚠️ Ops tips
- Departing employee → **Disable, don't delete** (keeps history and stats)
- If you reject a signup and they need the same login ID again: delete the old auth user in Supabase → Authentication → Users first
- Backups: Supabase → Database → Backups (7-day automatic on free plan)
