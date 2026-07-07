/* =========================================================
   HMSA Sales Activity Dashboard - app.js
   Company-email login + admin approval + password reset
   ========================================================= */
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const TYPE_LABEL = { meeting: "In-person Meeting", vc: "Video Call (VC)", trip: "Business Trip", other: "Other" };
const TYPE_COLOR = { meeting: "#00a651", vc: "#2e7cf6", trip: "#f0a020", other: "#8a99a8" };
const ROLE_LABEL = { member: "Member", leader: "Part Leader", director: "Director" };
const ST_LABEL   = { draft: "Draft", submitted: "Submitted", returned: "Returned", approved: "Approved" };
const SS_LABEL   = { unclaimed: "Unclaimed", pending: "Pending", active: "Active", disabled: "Disabled" };

let ME = null, STAFF = [], currentView = "dashboard", charts = [], openedReportId = null;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtD = (d) => (d ? String(d).slice(0, 10) : "-");
const fmtDT = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
const staffName = (id) => STAFF.find((s) => s.id === id)?.name || `#${id}`;
const idEmail = (id) => `${id.trim().toLowerCase()}@${CONFIG.EMAIL_DOMAIN}`;

function authMsg(text, ok = false) { const el = $("#authMsg"); el.className = "msg " + (ok ? "ok" : "err"); el.textContent = text; }
function clearAuthMsg() { const el = $("#authMsg"); el.className = "msg"; el.textContent = ""; }

/* ---------------- Modal ---------------- */
function openModal(html) { $("#modalBody").innerHTML = html; $("#modalBack").classList.add("open"); }
function closeModal() { $("#modalBack").classList.remove("open"); }
$("#modalBack").addEventListener("click", (e) => { if (e.target.id === "modalBack") closeModal(); });

/* =========================================================
   AUTH FLOW
   ========================================================= */
function showOnly(id) {
  ["loginView", "signupView", "pendingView"].forEach((v) => ($("#" + v).style.display = v === id ? "block" : "none"));
}

async function init() {
  $("#goSignup").onclick = showSignup;
  $("#goLogin").onclick = () => { clearAuthMsg(); showOnly("loginView"); };
  $("#btnLogin").onclick = doLogin;
  $("#btnSignup").onclick = doSignup;
  $("#btnPendingLogout").onclick = doLogout;
  $("#btnLogout").onclick = doLogout;
  $("#btnPw").onclick = pwModal;
  $("#liPw").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  document.querySelectorAll("#nav button").forEach((b) => (b.onclick = () => switchView(b.dataset.view)));

  const { data: { session } } = await sb.auth.getSession();
  if (session) await afterLogin();
}

async function showSignup() {
  clearAuthMsg(); showOnly("signupView");
  const sel = $("#suStaff");
  sel.innerHTML = `<option value="">Loading...</option>`;
  const { data, error } = await sb.from("signup_roster").select("*").order("name");
  if (error || !data?.length) { sel.innerHTML = `<option value="">No names available to claim</option>`; return; }
  sel.innerHTML = `<option value="">-- Select your name --</option>` +
    data.map((s) => `<option value="${s.id}">${esc(s.name)} (${esc(s.part)})</option>`).join("");
}

async function doSignup() {
  clearAuthMsg();
  const staffId = $("#suStaff").value, emp = $("#suEmp").value.trim(),
        id = $("#suId").value.trim(), pw = $("#suPw").value, pw2 = $("#suPw2").value;
  if (!staffId) return authMsg("Select your name.");
  if (!emp) return authMsg("Enter your employee number.");
  if (!/^[a-zA-Z0-9._-]{3,}$/.test(id)) return authMsg("Login ID must be 3+ letters/numbers (e.g. G2000001).");
  if (pw.length < 6) return authMsg("Password must be 6+ characters.");
  if (pw !== pw2) return authMsg("Passwords don't match.");

  const { error: e1 } = await sb.auth.signUp({ email: idEmail(id), password: pw });
  if (e1) return authMsg("That login ID is already taken or the request failed.");

  const { data: r, error: e2 } = await sb.rpc("claim_account", { p_staff_id: Number(staffId), p_emp_no: emp, p_login_id: id.toLowerCase() });
  if (e2) return authMsg("An error occurred while processing your request.");
  const errMap = {
    emp_no_mismatch: "Employee number doesn't match the roster.",
    not_available: "That name is already claimed by another account.",
    already_claimed: "This account is already linked to a name.",
    login_id_taken: "That login ID is already in use.",
  };
  if (r !== "ok") { await sb.auth.signOut(); return authMsg(errMap[r] || "Request failed."); }
  await afterLogin();
}

async function doLogout() { await sb.auth.signOut(); location.reload(); }

async function afterLogin() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data: me } = await sb.from("staff").select("*").eq("user_id", user.id).maybeSingle();
  if (!me) { authMsg("No account found. Contact the administrator."); await sb.auth.signOut(); return; }
  if (me.status === "pending") { showOnly("pendingView"); return; }
  if (me.status === "disabled") { authMsg("This account is disabled. Contact the administrator."); await sb.auth.signOut(); return; }

  ME = me;
  const { data: all } = await sb.from("staff").select("id,name,part,role,status,is_admin").order("part").order("name");
  STAFF = all || [];

  $("#auth").style.display = "none"; $("#app").style.display = "block";
  $("#meName").textContent = ME.name; $("#mePart").textContent = ME.part;
  $("#meRole").textContent = ROLE_LABEL[ME.role] + (ME.is_admin ? " · Admin" : "");
  if (ME.role === "leader" || ME.role === "director") $("#navReview").style.display = "flex";
  if (ME.is_admin) $("#navAdmin").style.display = "flex";
  switchView("dashboard");
}

function pwModal() {
  openModal(`
    <h3>Change password</h3>
    <div class="field"><label>New password (6+ characters)</label><input id="npw" type="password" /></div>
    <div class="field"><label>Confirm new password</label><input id="npw2" type="password" /></div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="npwGo">Change</button>
    </div>`);
  $("#npwGo").onclick = async () => {
    const a = $("#npw").value, b = $("#npw2").value;
    if (a.length < 6) return alert("Password must be 6+ characters.");
    if (a !== b) return alert("Passwords don't match.");
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) return alert("Change failed: " + error.message);
    alert("Password changed.");
    closeModal();
  };
}

/* =========================================================
   VIEW ROUTER
   ========================================================= */
function switchView(v) {
  currentView = v; openedReportId = null;
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  charts.forEach((c) => c.destroy()); charts = [];
  ({ dashboard: renderDashboard, activities: renderActivities, reports: renderReports, review: renderReview, admin: renderAdmin }[v] || renderDashboard)();
}

/* ---------------- Period helpers ---------------- */
let period = { preset: "month" };
function getRange() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (period.preset === "month")   return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (period.preset === "quarter") { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) }; }
  if (period.preset === "year")    return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: period.from || `${y}-01-01`, to: period.to || iso(now) };
}
function periodBarHTML() {
  const r = getRange();
  const names = { month: "This month", quarter: "This quarter", year: "This year", custom: "Custom" };
  return `
  <div class="filterbar">
    <div class="seg period-seg">
      ${["month", "quarter", "year", "custom"].map((p) =>
        `<button data-p="${p}" class="${period.preset === p ? "active" : ""}">${names[p]}</button>`).join("")}
    </div>
    <span style="display:${period.preset === "custom" ? "inline-flex" : "none"};gap:6px;align-items:center">
      <input type="date" id="pFrom" value="${period.from || r.from}" /> ~ <input type="date" id="pTo" value="${period.to || r.to}" />
      <button class="btn sm navy" id="pGo">Apply</button>
    </span>
    <span style="margin-left:auto;font-size:12px;color:var(--ink-2)">${r.from} ~ ${r.to}</span>
  </div>`;
}
function bindPeriodBar(rerender) {
  document.querySelectorAll(".period-seg [data-p]").forEach((b) => (b.onclick = () => { period.preset = b.dataset.p; rerender(); }));
  const go = $("#pGo"); if (go) go.onclick = () => { period.from = $("#pFrom").value; period.to = $("#pTo").value; rerender(); };
}

/* =========================================================
   DASHBOARD
   ========================================================= */
async function renderDashboard() {
  const main = $("#main");
  main.innerHTML = `<div class="page-title">Dashboard</div>
    <div class="page-sub">Sales activity by employee · ${esc(CONFIG.COMPANY_NAME)}</div>
    ${periodBarHTML()}<div id="dashBody" class="empty">Loading...</div>`;
  bindPeriodBar(renderDashboard);

  const r = getRange();
  const { data, error } = await sb.rpc("activity_stats", { p_from: r.from, p_to: r.to });
  if (error) { $("#dashBody").innerHTML = `<div class="empty">Failed to load data.</div>`; return; }

  const byStaff = {}; const totals = { meeting: 0, vc: 0, trip: 0, other: 0 };
  (data || []).forEach((row) => {
    if (!byStaff[row.staff_id]) byStaff[row.staff_id] = { name: row.name, part: row.part, role: row.role, hosted: {}, joined: {}, total: 0 };
    byStaff[row.staff_id].hosted[row.a_type] = Number(row.hosted);
    byStaff[row.staff_id].joined[row.a_type] = Number(row.joined);
    byStaff[row.staff_id].total += Number(row.hosted) + Number(row.joined);
    totals[row.a_type] += Number(row.hosted);
  });
  const people = Object.entries(byStaff).map(([id, v]) => ({ id: Number(id), ...v })).sort((a, b) => b.total - a.total);
  const grand = totals.meeting + totals.vc + totals.trip + totals.other;

  const byPart = {};
  people.forEach((p) => {
    if (!byPart[p.part]) byPart[p.part] = { meeting: 0, vc: 0, trip: 0, other: 0 };
    ["meeting", "vc", "trip", "other"].forEach((tp) => (byPart[p.part][tp] += p.hosted[tp] || 0));
  });

  $("#dashBody").innerHTML = `
    <div class="grid kpi">
      <div class="card kpi-card"><div class="kpi-label">Total activities (hosted)</div><div class="kpi-num">${grand}</div><div class="kpi-sub">items</div></div>
      ${["meeting", "vc", "trip", "other"].map((tp) => `
        <div class="card kpi-card"><div class="kpi-label"><span class="kpi-dot" style="background:${TYPE_COLOR[tp]}"></span>${TYPE_LABEL[tp]}</div>
        <div class="kpi-num">${totals[tp]}</div><div class="kpi-sub">items</div></div>`).join("")}
    </div>
    <div class="two-col">
      <div class="card"><h2 style="font-size:15px;margin-bottom:12px">Activities by employee (hosted)</h2>
        <div class="chart-box" style="height:${Math.max(200, people.length * 34)}px"><canvas id="chStaff"></canvas></div></div>
      <div>
        <div class="card" style="margin-bottom:16px"><h2 style="font-size:15px;margin-bottom:12px">Activity type mix</h2>
          <div class="chart-box" style="height:200px"><canvas id="chType"></canvas></div></div>
        <div class="card"><h2 style="font-size:15px;margin-bottom:10px">Part summary</h2>
          <table><thead><tr><th>Part</th><th>Meeting</th><th>VC</th><th>Trip</th><th>Other</th></tr></thead><tbody>
          ${Object.entries(byPart).map(([p, v]) => `<tr><td><span class="badge part">${esc(p)}</span></td><td>${v.meeting}</td><td>${v.vc}</td><td>${v.trip}</td><td>${v.other}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No data</td></tr>`}
          </tbody></table></div>
      </div>
    </div>
    <div class="section-head"><h2>Employee detail (hosted / joined)</h2></div>
    <div class="card" style="padding:8px 14px">
      <table><thead><tr><th>Name</th><th>Part</th><th>Meeting</th><th>VC</th><th>Trip</th><th>Other</th><th>Total</th></tr></thead><tbody>
      ${people.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.role !== "member" ? ` <span style="font-size:11px;color:var(--ink-2)">${ROLE_LABEL[p.role]}</span>` : ""}</td>
        <td><span class="badge part">${esc(p.part)}</span></td>
        ${["meeting", "vc", "trip", "other"].map((tp) => `<td>${p.hosted[tp] || 0} <span style="color:var(--ink-2);font-size:11.5px">/ ${p.joined[tp] || 0}</span></td>`).join("")}
        <td><b>${p.total}</b></td></tr>`).join("") || `<tr><td colspan="7" class="empty">No data</td></tr>`}
      </tbody></table>
    </div>`;

  const types = ["meeting", "vc", "trip", "other"];
  charts.push(new Chart($("#chStaff"), {
    type: "bar",
    data: { labels: people.map((p) => p.name),
      datasets: types.map((tp) => ({ label: TYPE_LABEL[tp], data: people.map((p) => p.hosted[tp] || 0), backgroundColor: TYPE_COLOR[tp], stack: "s" })) },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true, ticks: { precision: 0 } }, y: { stacked: true } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } } },
  }));
  charts.push(new Chart($("#chType"), {
    type: "doughnut",
    data: { labels: types.map((tp) => TYPE_LABEL[tp]), datasets: [{ data: types.map((tp) => totals[tp]), backgroundColor: types.map((tp) => TYPE_COLOR[tp]) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } } } },
  }));
}

/* =========================================================
   ACTIVITIES
   ========================================================= */
async function renderActivities() {
  const main = $("#main");
  main.innerHTML = `<div class="page-title">Activities</div>
    <div class="page-sub">Log meetings, VCs and business trips (adding participants credits them too)</div>
    ${periodBarHTML()}
    <div class="section-head"><h2>Activity list</h2><button class="btn" id="btnNewAct">+ New activity</button></div>
    <div class="card" style="padding:8px 14px" id="actList"><div class="empty">Loading...</div></div>`;
  bindPeriodBar(renderActivities);
  $("#btnNewAct").onclick = () => activityModal();

  const r = getRange();
  const { data: acts } = await sb.from("activities")
    .select("*, activity_participants(staff_id,p_role)")
    .gte("activity_date", r.from).lte("activity_date", r.to)
    .order("activity_date", { ascending: false });

  const rows = (acts || []).map((a) => {
    const parts = (a.activity_participants || []).filter((p) => p.p_role === "participant").map((p) => staffName(p.staff_id));
    const mine = a.created_by === ME.id;
    return `<tr>
      <td style="white-space:nowrap">${fmtD(a.activity_date)}</td>
      <td><span class="badge ${a.type}">${TYPE_LABEL[a.type]}</span></td>
      <td><b>${esc(a.customer)}</b></td>
      <td>${esc(a.title)}${a.notes ? `<div style="font-size:12px;color:var(--ink-2)">${esc(a.notes)}</div>` : ""}</td>
      <td>${esc(staffName(a.created_by))}</td>
      <td style="font-size:12.5px">${parts.map(esc).join(", ") || "-"}</td>
      <td style="white-space:nowrap">${mine ? `<button class="btn ghost sm" data-edit="${a.id}">Edit</button> <button class="btn ghost sm" data-del="${a.id}">Delete</button>` : ""}</td>
    </tr>`;
  }).join("");
  $("#actList").innerHTML = rows
    ? `<table><thead><tr><th>Date</th><th>Type</th><th>Customer</th><th>Topic</th><th>Host</th><th>Participants</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">No activities in this period. Log your first one!</div>`;

  document.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => activityModal((acts || []).find((a) => a.id == b.dataset.edit))));
  document.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Delete this activity?")) return;
    await sb.from("activities").delete().eq("id", b.dataset.del);
    renderActivities();
  }));
}

function activityModal(edit = null) {
  const picked = new Set(edit ? (edit.activity_participants || []).filter((p) => p.p_role === "participant").map((p) => p.staff_id) : []);
  const options = STAFF.filter((s) => s.status === "active" && s.id !== ME.id);
  openModal(`
    <h3>${edit ? "Edit activity" : "New activity"}</h3>
    <div class="row2">
      <div class="field"><label>Type</label><select id="aType">
        ${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${edit?.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>Date</label><input type="date" id="aDate" value="${edit?.activity_date || new Date().toISOString().slice(0, 10)}" /></div>
    </div>
    <div class="field"><label>Customer</label><input id="aCust" value="${esc(edit?.customer || "")}" placeholder="e.g. Seaspan" /></div>
    <div class="field"><label>Topic / agenda</label><input id="aTitle" value="${esc(edit?.title || "")}" placeholder="e.g. ACONIS server replacement kickoff" /></div>
    <div class="field"><label>Notes (optional)</label><textarea id="aNotes">${esc(edit?.notes || "")}</textarea></div>
    <div class="field"><label>Add participants (you are auto-registered as host)</label>
      <select id="aPickP"><option value="">-- Select participant --</option>
        ${options.map((s) => `<option value="${s.id}">${esc(s.name)} (${esc(s.part)})</option>`).join("")}</select>
      <div class="chips" id="aChips"></div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="aSave">${edit ? "Save" : "Create"}</button>
    </div>`);

  const drawChips = () => {
    $("#aChips").innerHTML = [...picked].map((id) =>
      `<span class="chip">${esc(staffName(id))}<button data-rm="${id}">×</button></span>`).join("");
    document.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { picked.delete(Number(b.dataset.rm)); drawChips(); }));
  };
  drawChips();
  $("#aPickP").onchange = (e) => { if (e.target.value) { picked.add(Number(e.target.value)); e.target.value = ""; drawChips(); } };

  $("#aSave").onclick = async () => {
    const rec = { type: $("#aType").value, activity_date: $("#aDate").value,
      customer: $("#aCust").value.trim(), title: $("#aTitle").value.trim(),
      notes: $("#aNotes").value.trim() || null, part: ME.part, created_by: ME.id };
    if (!rec.customer || !rec.title || !rec.activity_date) return alert("Customer, topic and date are required.");

    let actId;
    if (edit) {
      const { error } = await sb.from("activities").update(rec).eq("id", edit.id);
      if (error) return alert("Save failed: " + error.message);
      actId = edit.id;
      await sb.from("activity_participants").delete().eq("activity_id", actId);
    } else {
      const { data, error } = await sb.from("activities").insert(rec).select("id").single();
      if (error) return alert("Create failed: " + error.message);
      actId = data.id;
    }
    const partRows = [{ activity_id: actId, staff_id: ME.id, p_role: "host" },
      ...[...picked].map((id) => ({ activity_id: actId, staff_id: id, p_role: "participant" }))];
    const { error: e2 } = await sb.from("activity_participants").insert(partRows);
    if (e2) return alert("Failed to save participants: " + e2.message);
    closeModal(); renderActivities();
  };
}

/* =========================================================
   MEETING REPORTS
   ========================================================= */
async function renderReports() {
  const main = $("#main");
  main.innerHTML = `<div class="page-title">Meeting Reports</div>
    <div class="page-sub">Draft → submit to part leader → approve/return, all in one place</div>
    <div class="section-head"><h2>Report list</h2><button class="btn" id="btnNewRep">+ New report</button></div>
    <div class="card" style="padding:8px 14px" id="repList"><div class="empty">Loading...</div></div>`;
  $("#btnNewRep").onclick = () => reportModal();
  await drawReportList("#repList");
}

async function drawReportList(sel, onlySubmitted = false) {
  let q = sb.from("reports").select("*").order("updated_at", { ascending: false });
  if (onlySubmitted) q = q.eq("status", "submitted");
  const { data: reps } = await q;
  const rows = (reps || []).map((r) => `
    <tr class="clickable" data-open="${r.id}">
      <td style="white-space:nowrap">${fmtD(r.meeting_date)}</td>
      <td><b>${esc(r.customer)}</b></td>
      <td>${esc(r.title)}</td>
      <td>${esc(staffName(r.author_id))} <span class="badge part">${esc(r.part)}</span></td>
      <td>v${r.version}</td>
      <td><span class="badge ${r.status}">${ST_LABEL[r.status]}</span></td>
    </tr>`).join("");
  $(sel).innerHTML = rows
    ? `<table><thead><tr><th>Meeting date</th><th>Customer</th><th>Title</th><th>Author</th><th>Ver.</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">${onlySubmitted ? "No reports awaiting review." : "No reports yet. Write your first one!"}</div>`;
  document.querySelectorAll("[data-open]").forEach((tr) => (tr.onclick = () => openReport(Number(tr.dataset.open))));
}

function reportModal(edit = null) {
  openModal(`
    <h3>${edit ? `Edit report (v${edit.version})` : "New meeting report"}</h3>
    <div class="row2">
      <div class="field"><label>Customer</label><input id="rCust" value="${esc(edit?.customer || "")}" /></div>
      <div class="field"><label>Meeting date</label><input type="date" id="rDate" value="${edit?.meeting_date || new Date().toISOString().slice(0, 10)}" /></div>
    </div>
    <div class="field"><label>Title</label><input id="rTitle" value="${esc(edit?.title || "")}" placeholder="e.g. Seaspan 14K ACONIS replacement discussion" /></div>
    <div class="field"><label>Discussion</label><textarea id="rContent" style="min-height:160px">${esc(edit?.content || "")}</textarea></div>
    <div class="field"><label>Follow-up (action items)</label><textarea id="rFollow">${esc(edit?.followup || "")}</textarea></div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="rSave">${edit ? "Save" : "Create (saved as draft)"}</button>
    </div>`);
  $("#rSave").onclick = async () => {
    const rec = { customer: $("#rCust").value.trim(), meeting_date: $("#rDate").value,
      title: $("#rTitle").value.trim(), content: $("#rContent").value,
      followup: $("#rFollow").value, updated_at: new Date().toISOString() };
    if (!rec.customer || !rec.title) return alert("Customer and title are required.");
    if (edit) {
      const { error } = await sb.from("reports").update(rec).eq("id", edit.id);
      if (error) return alert("Save failed: " + error.message);
      await logEvent(edit.id, "edit", null, edit.version);
      closeModal(); openReport(edit.id);
    } else {
      const { data, error } = await sb.from("reports").insert({ ...rec, author_id: ME.id, part: ME.part }).select("id").single();
      if (error) return alert("Save failed: " + error.message);
      await logEvent(data.id, "create", null, 1);
      closeModal(); openReport(data.id);
    }
  };
}

async function logEvent(reportId, action, comment = null, version = 1) {
  await sb.from("report_events").insert({ report_id: reportId, actor_id: ME.id, action, comment, version });
}

async function openReport(id) {
  const { data: r } = await sb.from("reports").select("*").eq("id", id).single();
  if (!r) return alert("Can't open this report (no permission).");
  openedReportId = id;
  const { data: events } = await sb.from("report_events").select("*").eq("report_id", id).order("created_at", { ascending: false });

  const isAuthor = r.author_id === ME.id;
  const canReview = (ME.role === "leader" && ME.part === r.part && !isAuthor) || ME.role === "director" || ME.is_admin;
  const canEdit = isAuthor && (r.status === "draft" || r.status === "returned");
  const canSubmit = isAuthor && (r.status === "draft" || r.status === "returned");
  const evLabel = { create: "created", edit: "edited", submit: "submitted", return: "returned", approve: "approved", comment: "commented" };
  const dotCls = { submit: "submit", return: "return", approve: "approve" };

  const main = $("#main");
  main.innerHTML = `
    <button class="btn ghost sm" id="backBtn">← Back to list</button>
    <div style="display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap">
      <div class="page-title">${esc(r.title)}</div>
      <span class="badge ${r.status}">${ST_LABEL[r.status]}</span>
      <span class="badge part">v${r.version}</span>
    </div>
    <div class="page-sub">${esc(r.customer)} · Meeting date ${fmtD(r.meeting_date)} · Author ${esc(staffName(r.author_id))} (${esc(r.part)})</div>

    <div class="two-col">
      <div>
        <div class="card" style="margin-bottom:14px">
          <h2 style="font-size:14px;margin-bottom:8px">Discussion</h2>
          <div class="report-content">${esc(r.content) || "-"}</div>
          <h2 style="font-size:14px;margin:14px 0 8px">Follow-up (action items)</h2>
          <div class="report-content">${esc(r.followup) || "-"}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${canEdit ? `<button class="btn ghost" id="repEdit">✏️ Edit</button>` : ""}
          ${canSubmit ? `<button class="btn navy" id="repSubmit">📤 Submit to part leader</button>` : ""}
          ${canReview && r.status === "submitted" ? `
            <button class="btn" id="repApprove">✅ Approve</button>
            <button class="btn danger" id="repReturn">↩️ Return (with reason)</button>` : ""}
          ${isAuthor && r.status === "draft" ? `<button class="btn ghost sm" id="repDel" style="color:var(--red)">Delete</button>` : ""}
        </div>
      </div>
      <div class="card">
        <h2 style="font-size:14px;margin-bottom:6px">History</h2>
        <div class="timeline">
          ${(events || []).map((e) => `
            <div class="tl-item">
              <div class="tl-dot ${dotCls[e.action] || ""}"></div>
              <div class="tl-body">
                <div class="tl-head">${esc(staffName(e.actor_id))} · ${evLabel[e.action]} <span style="color:var(--ink-2);font-weight:400">(v${e.version})</span></div>
                <div class="tl-time">${fmtDT(e.created_at)}</div>
                ${e.comment ? `<div class="tl-comment">${esc(e.comment)}</div>` : ""}
              </div>
            </div>`).join("") || `<div class="empty">No history</div>`}
        </div>
      </div>
    </div>`;

  $("#backBtn").onclick = () => switchView(currentView === "review" ? "review" : "reports");
  if ($("#repEdit")) $("#repEdit").onclick = () => reportModal(r);
  if ($("#repDel")) $("#repDel").onclick = async () => {
    if (!confirm("Delete this draft report?")) return;
    await sb.from("reports").delete().eq("id", r.id); switchView("reports");
  };
  if ($("#repSubmit")) $("#repSubmit").onclick = async () => {
    const newVer = r.status === "returned" ? r.version + 1 : r.version;
    const { error } = await sb.from("reports").update({ status: "submitted", version: newVer, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) return alert("Submit failed: " + error.message);
    await logEvent(r.id, "submit", null, newVer); openReport(r.id);
  };
  if ($("#repApprove")) $("#repApprove").onclick = async () => {
    if (!confirm("Approve this report?")) return;
    await sb.from("reports").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", r.id);
    await logEvent(r.id, "approve", null, r.version); openReport(r.id);
  };
  if ($("#repReturn")) $("#repReturn").onclick = () => {
    openModal(`
      <h3>Return report</h3>
      <div class="field"><label>Return reason / requested changes</label><textarea id="retReason" style="min-height:120px" placeholder="e.g. Please add owner and due date to the action items."></textarea></div>
      <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn danger" id="retGo">Return</button></div>`);
    $("#retGo").onclick = async () => {
      const reason = $("#retReason").value.trim();
      if (!reason) return alert("Enter a return reason.");
      await sb.from("reports").update({ status: "returned", updated_at: new Date().toISOString() }).eq("id", r.id);
      await logEvent(r.id, "return", reason, r.version);
      closeModal(); openReport(r.id);
    };
  };
}

/* =========================================================
   REVIEW INBOX
   ========================================================= */
async function renderReview() {
  const main = $("#main");
  const sub = ME.role === "director" ? "Submitted reports from all parts" : `${ME.part} — submitted reports`;
  main.innerHTML = `<div class="page-title">Review Inbox</div>
    <div class="page-sub">${esc(sub)}</div>
    <div class="card" style="padding:8px 14px" id="revList"><div class="empty">Loading...</div></div>`;
  await drawReportList("#revList", true);
}

/* =========================================================
   ADMIN
   ========================================================= */
async function renderAdmin() {
  const main = $("#main");
  const { data: staff } = await sb.from("staff").select("*").order("part").order("name");
  const pending = (staff || []).filter((s) => s.status === "pending");
  const rest = (staff || []).filter((s) => s.status !== "pending");

  main.innerHTML = `<div class="page-title">Admin</div>
    <div class="page-sub">Roster · account approval · permissions</div>

    ${pending.length ? `
    <div class="section-head"><h2>🔔 Pending approval (${pending.length})</h2></div>
    <div class="card" style="padding:8px 14px;margin-bottom:8px">
      <table><thead><tr><th>Name</th><th>Part</th><th>Login ID</th><th></th></tr></thead><tbody>
      ${pending.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.part)}</td><td>${esc(s.login_id)}</td>
        <td><button class="btn sm" data-appr="${s.id}">Approve</button> <button class="btn ghost sm" data-rej="${s.id}">Reject</button></td></tr>`).join("")}
      </tbody></table></div>` : ""}

    <div class="section-head"><h2>Staff roster</h2><button class="btn" id="btnAddStaff">+ Add staff</button></div>
    <div class="card" style="padding:8px 14px">
      <table><thead><tr><th>Name</th><th>Emp. No.</th><th>Part</th><th>Role</th><th>Status</th><th>Login ID</th><th></th></tr></thead><tbody>
      ${rest.map((s) => `<tr>
        <td><b>${esc(s.name)}</b>${s.is_admin ? ' <span style="font-size:11px;color:var(--green-dark)">Admin</span>' : ""}</td>
        <td>${esc(s.emp_no)}</td><td><span class="badge part">${esc(s.part)}</span></td>
        <td>${ROLE_LABEL[s.role]}</td>
        <td><span class="badge ${s.status}">${SS_LABEL[s.status]}</span></td>
        <td>${esc(s.login_id || "-")}</td>
        <td style="white-space:nowrap">
          <button class="btn ghost sm" data-editStaff="${s.id}">Edit</button>
          ${s.status === "active" && s.id !== ME.id ? `<button class="btn ghost sm" data-disable="${s.id}" style="color:var(--red)">Disable</button>` : ""}
          ${s.status === "disabled" ? `<button class="btn ghost sm" data-enable="${s.id}">Enable</button>` : ""}
          ${s.user_id ? `<button class="btn ghost sm" data-resetpw="${s.id}">Reset PW</button>` : ""}
          ${s.status === "unclaimed" ? `<button class="btn ghost sm" data-delStaff="${s.id}" style="color:var(--red)">Delete</button>` : ""}
        </td></tr>`).join("")}
      </tbody></table></div>`;

  $("#btnAddStaff").onclick = () => staffModal();
  document.querySelectorAll("[data-appr]").forEach((b) => (b.onclick = async () => {
    await sb.from("staff").update({ status: "active" }).eq("id", b.dataset.appr); renderAdmin(); }));
  document.querySelectorAll("[data-rej]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Reject this request? (The name returns to unclaimed so they can re-apply.)")) return;
    await sb.from("staff").update({ status: "unclaimed", user_id: null, login_id: null }).eq("id", b.dataset.rej); renderAdmin(); }));
  document.querySelectorAll("[data-disable]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Disable this account? (Records are kept.)")) return;
    await sb.from("staff").update({ status: "disabled" }).eq("id", b.dataset.disable); renderAdmin(); }));
  document.querySelectorAll("[data-enable]").forEach((b) => (b.onclick = async () => {
    await sb.from("staff").update({ status: "active" }).eq("id", b.dataset.enable); renderAdmin(); }));
  document.querySelectorAll("[data-resetpw]").forEach((b) => (b.onclick = () => {
    const s2 = staff.find((x) => x.id == b.dataset.resetpw); resetPwModal(s2); }));
  document.querySelectorAll("[data-delStaff]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Delete this roster entry?")) return;
    await sb.from("staff").delete().eq("id", b.dataset.delStaff); renderAdmin(); }));
  document.querySelectorAll("[data-editStaff]").forEach((b) => (b.onclick = () => {
    const s = staff.find((x) => x.id == b.dataset.editStaff); staffModal(s); }));
}

function resetPwModal(s2) {
  openModal(`
    <h3>Reset password: ${esc(s2.name)}</h3>
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">
      Login ID: <b>${esc(s2.login_id)}</b><br/>
      Set a temporary password and share it with them directly. Ask them to change it after signing in.</p>
    <div class="field"><label>Temporary password (6+ characters)</label><input id="rpw" type="text" placeholder="e.g. Hmsa2026!" /></div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn danger" id="rpwGo">Reset password</button>
    </div>`);
  $("#rpwGo").onclick = async () => {
    const pw = $("#rpw").value;
    if (pw.length < 6) return alert("Password must be 6+ characters.");
    const { data: r, error } = await sb.rpc("admin_reset_password", { p_staff_id: s2.id, p_new_password: pw });
    if (error || r !== "ok") return alert("Reset failed: " + (error?.message || r));
    alert(`Password reset. Share the temporary password with ${s2.name} directly.`);
    closeModal();
  };
}

function staffModal(edit = null) {
  openModal(`
    <h3>${edit ? "Edit staff" : "Add staff"}</h3>
    <div class="row2">
      <div class="field"><label>Name</label><input id="stName" value="${esc(edit?.name || "")}" /></div>
      <div class="field"><label>Employee No.</label><input id="stEmp" value="${esc(edit?.emp_no || "")}" /></div>
    </div>
    <div class="row2">
      <div class="field"><label>Part</label><input id="stPart" value="${esc(edit?.part || "")}" placeholder="e.g. Parts Sales" /></div>
      <div class="field"><label>Role</label><select id="stRole">
        ${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${edit?.role === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="stSave">${edit ? "Save" : "Add"}</button>
    </div>`);
  $("#stSave").onclick = async () => {
    const rec = { name: $("#stName").value.trim(), emp_no: $("#stEmp").value.trim(),
      part: $("#stPart").value.trim() || "Unassigned", role: $("#stRole").value };
    if (!rec.name || !rec.emp_no) return alert("Name and employee number are required.");
    const { error } = edit
      ? await sb.from("staff").update(rec).eq("id", edit.id)
      : await sb.from("staff").insert(rec);
    if (error) return alert("Save failed: " + error.message);
    closeModal(); renderAdmin();
  };
}

init();
