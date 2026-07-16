/* =========================================================
   HMSA Sales Activity Dashboard - app.js
   Company-email login + admin approval + password reset
   ========================================================= */
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true },
});

const TYPE_LABEL = { meeting: "In-person Meeting", vc: "Video Call (VC)", trip: "Business Trip", other: "Other" };
const TYPE_COLOR = { meeting: "#00a651", vc: "#2e7cf6", trip: "#f0a020", other: "#8a99a8" };
const ROLE_LABEL = { member: "Member", leader: "Part Leader", teamlead: "Team Lead", director: "Director" };
const ST_LABEL   = { draft: "Draft", submitted: "Submitted", returned: "Returned", approved: "Approved" };
const SS_LABEL   = { unclaimed: "Unclaimed", pending: "Pending", active: "Active", disabled: "Disabled" };
const ACT_ST     = { pending: "Pending approval", approved: "Approved", canceled: "Canceled" };
const RTYPE_LABEL = { customer: "Customer Meeting", internal: "Internal" };
let TAGS = [];        // tag catalog (created by leaders/director)
let PARTS = [];       // parts catalog (managed by admin) — {id, name, color}
let COMPANIES = [];   // customer catalog — {id, name, part}
let CONTRACTS = [];   // contracts — {id, company_id, name}
const companyName = (id) => COMPANIES.find((c) => c.id === id)?.name || "";
const contractName = (id) => { const c = CONTRACTS.find((x) => x.id === id); return c ? c.name : ""; };
const PART_PALETTE = ["#00a651", "#2e7cf6", "#f0a020", "#9b59d0", "#e5568c", "#12a5a5", "#e2574c", "#5a6b7d"];
const partColor = (name) => PARTS.find((p) => p.name === name)?.color || "#5a6b7d";
const partBadge = (name) => { const c = partColor(name); return `<span class="badge" style="background:${c}1c;color:${c};border:1px solid ${c}44">${esc(name)}</span>`; };
let repTagFilter = 0; // 0 = all
let searchQ = { act: "", rep: "", rev: "" };
let coFilter = { act: 0, rep: 0, rev: 0 }; // 0 = all companies
function searchBarHTML(key) {
  return `<div class="filterbar">
    <input id="sb_${key}" value="${esc(searchQ[key])}" placeholder="🔍 Search title, PIC, author, content..." style="flex:1;min-width:180px;padding:8px 11px;border:1.5px solid var(--line);border-radius:8px" />
    <select id="cf_${key}" style="max-width:190px">
      <option value="0">🏢 All companies</option>
      ${COMPANIES.map((c) => `<option value="${c.id}" ${coFilter[key] == c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
    </select>
  </div>`;
}
function bindSearchBar(key, rerender) {
  const inp = $("#sb_" + key);
  let t = null;
  inp.oninput = () => { clearTimeout(t); t = setTimeout(() => { searchQ[key] = inp.value; rerender(); }, 350); };
  inp.onkeydown = (e) => { if (e.key === "Enter") { clearTimeout(t); searchQ[key] = inp.value; rerender(); } };
  $("#cf_" + key).onchange = (e) => { coFilter[key] = Number(e.target.value); rerender(); };
}
function matchesSearch(q, ...fields) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => String(f || "").toLowerCase().includes(needle));
}
const isManager = () => ME && (ME.role === "leader" || ME.role === "teamlead" || ME.role === "director" || ME.is_admin);
const halfKey = (d = new Date()) => `${d.getFullYear()}-H${d.getMonth() < 6 ? 1 : 2}`;
const fmtT = (t) => { if (!t) return ""; const [H, M] = t.split(":"); const h = Number(H); return `${String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0")}:${M} ${h < 12 ? "AM" : "PM"}`; };
const fmt12 = (t) => { if (!t) return ""; const [H, M] = t.split(":").map(Number); const ap = H >= 12 ? "PM" : "AM"; return `${H % 12 || 12}:${String(M).padStart(2, "0")} ${ap}`; };
function timePickerHTML(idPrefix, cur) { // cur: "HH:MM" 24h or null
  let h12 = 9, mm = "00", ap = "AM";
  if (cur) {
    const [H, M] = cur.split(":").map(Number);
    ap = H >= 12 ? "PM" : "AM"; h12 = H % 12 || 12; mm = String(M).padStart(2, "0");
  }
  return `<div style="display:flex;gap:6px">
    <select id="${idPrefix}H" style="flex:1">${[12,1,2,3,4,5,6,7,8,9,10,11].map((h) => `<option ${h === h12 ? "selected" : ""}>${h}</option>`).join("")}</select>
    <select id="${idPrefix}M" style="flex:1">${["00","15","30","45"].map((m) => `<option ${m === mm ? "selected" : ""}>${m}</option>`).join("")}</select>
    <select id="${idPrefix}AP" style="flex:1">${["AM","PM"].map((a) => `<option ${a === ap ? "selected" : ""}>${a}</option>`).join("")}</select>
  </div>`;
}
function timePickerValue(idPrefix) { // -> "HH:MM" 24h or null
  const hEl = $("#" + idPrefix + "H");
  if (!hEl) return null;
  let h = Number(hEl.value) % 12;
  if ($("#" + idPrefix + "AP").value === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${$("#" + idPrefix + "M").value}`;
}
const halfRange = (key) => { const [y, h] = key.split("-H"); return h === "1" ? { from: `${y}-01-01`, to: `${y}-06-30` } : { from: `${y}-07-01`, to: `${y}-12-31` }; };
const isExec = () => ME && (ME.role === "teamlead" || ME.role === "director");
const canReviewActivity = (a) => (ME.role === "leader" && a.part === ME.part) || isExec() || ME.is_admin;

let ME = null, STAFF = [], currentView = "dashboard", charts = [], openedReportId = null;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtD = (d) => (d ? String(d).slice(0, 10) : "-");
const fmtDT = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
const staffName = (id) => STAFF.find((s) => s.id === id)?.name || `#${id}`;
const idEmail = (id) => `${id.trim().toLowerCase()}@${CONFIG.EMAIL_DOMAIN}`;

/* =========================================================
   COMPANY / CONTRACT TAG PANEL (shared by activity & report modals)
   ========================================================= */
function tagPanelHTML() {
  return `
  <div class="field" style="background:#f7fafc;border:1.5px solid var(--line);border-radius:10px;padding:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <label style="margin:0">🏢 Companies</label>
      <input id="coSearch" placeholder="🔍 Search..." style="width:150px;padding:5px 9px;border:1.5px solid var(--line);border-radius:7px;font-size:12px" />
    </div>
    <div class="chips" id="coPanel" style="max-height:110px;overflow-y:auto"></div>
    <div id="ctWrap" style="display:none;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">
      <label style="display:block;font-size:12.5px;font-weight:600;color:var(--ink-2);margin-bottom:5px">📋 Contracts (optional)</label>
      <div class="chips" id="ctPanel"></div>
    </div>
    <div style="font-size:11px;color:var(--ink-2);margin-top:8px">Missing a company/contract tag? Mention it in the notes — your part leader can add it.</div>
  </div>`;
}

function bindTagPanel(pickedCos, pickedCts) {
  const sortedCos = () => {
    const q = ($("#coSearch")?.value || "").toLowerCase();
    return COMPANIES
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const am = a.part === ME.part ? 0 : 1, bm = b.part === ME.part ? 0 : 1;
        return am - bm || a.name.localeCompare(b.name);
      });
  };
  const chipStyle = (on) => on ? "background:var(--navy);color:#fff;cursor:pointer" : "cursor:pointer";
  const drawCts = () => {
    const avail = CONTRACTS.filter((ct) => pickedCos.has(ct.company_id));
    [...pickedCts].forEach((id) => { if (!avail.some((a) => a.id === id)) pickedCts.delete(id); });
    $("#ctWrap").style.display = avail.length ? "block" : "none";
    $("#ctPanel").innerHTML = avail.map((ct) =>
      `<span class="chip ctpick" data-ct="${ct.id}" style="${chipStyle(pickedCts.has(ct.id))}">${esc(companyName(ct.company_id))} · ${esc(ct.name)}</span>`).join("");
    document.querySelectorAll(".ctpick").forEach((ch) => (ch.onclick = () => {
      const id = Number(ch.dataset.ct);
      pickedCts.has(id) ? pickedCts.delete(id) : pickedCts.add(id);
      drawCts();
    }));
  };
  const drawCos = () => {
    $("#coPanel").innerHTML = sortedCos().map((c) =>
      `<span class="chip copick" data-co="${c.id}" style="${chipStyle(pickedCos.has(c.id))}">${esc(c.name)}${c.part ? ` <span style="font-size:10px;opacity:.7">${esc(c.part)}</span>` : ""}</span>`).join("")
      || `<span style="font-size:12px;color:var(--ink-2)">${COMPANIES.length ? "No match" : "No companies yet — leaders can add them via the Companies button."}</span>`;
    document.querySelectorAll(".copick").forEach((ch) => (ch.onclick = () => {
      const id = Number(ch.dataset.co);
      pickedCos.has(id) ? pickedCos.delete(id) : pickedCos.add(id);
      drawCos(); drawCts();
    }));
  };
  $("#coSearch").oninput = drawCos;
  drawCos(); drawCts();
}

/* ---------- Companies management (leaders / director / admin) ---------- */
function companiesModal() {
  let selCo = null;
  openModal(`
    <h3>🏢 Manage companies & contracts</h3>
    <div class="field" style="display:flex;gap:8px">
      <input id="mcSearch" placeholder="🔍 Search companies..." style="flex:1" />
    </div>
    <div class="chips" id="mcList" style="max-height:130px;overflow-y:auto;margin-bottom:10px"></div>
    <div class="row2">
      <div class="field"><label>New company name</label><input id="mcName" placeholder="e.g. Seaspan" /></div>
      <div class="field"><label>Owning part (optional)</label><select id="mcPart"><option value="">— shared —</option>${PARTS.map((p) => `<option>${esc(p.name)}</option>`).join("")}</select></div>
    </div>
    <button class="btn sm" id="mcAdd">+ Add company</button>
    <div id="mcContracts" style="display:none;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
      <label style="font-weight:700;font-size:13px" id="mcCoTitle"></label>
      <div class="chips" id="mcCtList" style="margin:8px 0"></div>
      <div style="display:flex;gap:8px">
        <input id="mcCtName" placeholder="New contract name (e.g. 7K LTSA)" style="flex:1;padding:8px 10px;border:1.5px solid var(--line);border-radius:7px" />
        <button class="btn sm" id="mcCtAdd">+ Add</button>
      </div>
    </div>
    <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);

  const drawCts = () => {
    if (!selCo) { $("#mcContracts").style.display = "none"; return; }
    $("#mcContracts").style.display = "block";
    $("#mcCoTitle").textContent = `Contracts of ${companyName(selCo)}`;
    const list = CONTRACTS.filter((c) => c.company_id === selCo);
    $("#mcCtList").innerHTML = list.map((c) =>
      `<span class="chip">${esc(c.name)}<button data-mcctdel="${c.id}">×</button></span>`).join("") || `<span style="font-size:12px;color:var(--ink-2)">No contracts yet</span>`;
    document.querySelectorAll("[data-mcctdel]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Delete this contract tag?")) return;
      await sb.from("contracts").delete().eq("id", b.dataset.mcctdel);
      CONTRACTS = CONTRACTS.filter((c) => c.id != b.dataset.mcctdel); drawCts();
    }));
  };
  const drawList = () => {
    const q = ($("#mcSearch").value || "").toLowerCase();
    $("#mcList").innerHTML = COMPANIES.filter((c) => c.name.toLowerCase().includes(q)).map((c) =>
      `<span class="chip" data-mcsel="${c.id}" style="cursor:pointer;${selCo === c.id ? "background:var(--navy);color:#fff" : ""}">${esc(c.name)}${c.part ? ` <span style="font-size:10px;opacity:.7">${esc(c.part)}</span>` : ""}<button data-mcdel="${c.id}">×</button></span>`).join("")
      || `<span style="font-size:12px;color:var(--ink-2)">No companies yet</span>`;
    document.querySelectorAll("[data-mcsel]").forEach((ch) => (ch.onclick = (e) => {
      if (e.target.dataset.mcdel) return;
      selCo = Number(ch.dataset.mcsel); drawList(); drawCts();
    }));
    document.querySelectorAll("[data-mcdel]").forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this company and its contract tags?")) return;
      await sb.from("companies").delete().eq("id", b.dataset.mcdel);
      COMPANIES = COMPANIES.filter((c) => c.id != b.dataset.mcdel);
      CONTRACTS = CONTRACTS.filter((c) => c.company_id != b.dataset.mcdel);
      if (selCo == b.dataset.mcdel) selCo = null;
      drawList(); drawCts();
    }));
  };
  $("#mcSearch").oninput = drawList;
  $("#mcAdd").onclick = async () => {
    const name = $("#mcName").value.trim();
    if (!name) return;
    const { data, error } = await sb.from("companies").insert({ name, part: $("#mcPart").value || null }).select("*").single();
    if (error) return alert("Add failed (duplicate?): " + error.message);
    COMPANIES.push(data); COMPANIES.sort((a, b) => a.name.localeCompare(b.name));
    $("#mcName").value = ""; drawList();
  };
  $("#mcCtAdd").onclick = async () => {
    const name = $("#mcCtName").value.trim();
    if (!name || !selCo) return;
    const { data, error } = await sb.from("contracts").insert({ company_id: selCo, name }).select("*").single();
    if (error) return alert("Add failed (duplicate?): " + error.message);
    CONTRACTS.push(data); $("#mcCtName").value = ""; drawCts();
  };
  drawList();
}

/* =========================================================
   PLAN CALENDAR (v7): leaders confirm member-submitted plans
   ========================================================= */
var planMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();

async function renderPlan() {
  const main = $("#main");
  const y = planMonth.getFullYear(), m = planMonth.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  main.innerHTML = `<div class="page-title">Plan Calendar</div>
    <div class="page-sub">All activities start here. Leaders add scheduled plans (1x) or self-made ones (×2). Members submit plans — accepted member plans count ×2. Confirming a plan creates the activity automatically.</div>
    <div class="filterbar" style="align-items:center">
      <button class="btn ghost sm" id="plPrev">◀</button>
      <b style="font-size:15px;min-width:120px;text-align:center">${y}. ${String(m + 1).padStart(2, "0")}</b>
      <button class="btn ghost sm" id="plNext">▶</button>
      <button class="btn ghost sm" id="plToday">Today</button>
      <button class="btn" id="plNew" style="margin-left:auto">+ New plan</button>
    </div>
    <div id="plPendingWrap"></div>
    <div class="card" style="padding:12px">
      <div class="plan-grid" style="margin-bottom:4px">
        ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => `<div class="plan-dow">${d}</div>`).join("")}
      </div>
      <div class="plan-grid" id="plGrid"><div class="empty" style="grid-column:1/8">Loading...</div></div>
    </div>`;
  $("#plPrev").onclick = () => { planMonth = new Date(y, m - 1, 1); renderPlan(); };
  $("#plNext").onclick = () => { planMonth = new Date(y, m + 1, 1); renderPlan(); };
  $("#plToday").onclick = () => { const d = new Date(); planMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderPlan(); };
  $("#plNew").onclick = () => planModal();

  const { data: plansRaw } = await sb.from("plans")
    .select("*, plan_participants(staff_id), plan_companies(company_id), plan_contracts(contract_id)")
    .gte("plan_date", from).lte("plan_date", to)
    .order("plan_date").order("plan_time");
  const plans = plansRaw || [];
  window.__plans = plans;
  if (!$("#plGrid")) return; // view switched while loading

  // leader/exec: pending confirmation strip
  if (isManager()) {
    const pend = plans.filter((p) => p.status === "pending" && (ME.role !== "leader" || p.part === ME.part));
    if (pend.length) {
      $("#plPendingWrap").innerHTML = `<div class="card" style="margin-bottom:12px;border-left:4px solid var(--amber)">
        <b style="font-size:13.5px">⏳ ${pend.length} plan(s) awaiting your confirmation</b>
        ${pend.map((p) => `<div data-plopen="${p.id}" style="cursor:pointer;font-size:12.5px;padding:4px 0;border-bottom:1px dashed var(--line)">
          ${fmtD(p.plan_date)}${p.plan_time ? " " + fmtT(p.plan_time) : ""} · <b>${esc(p.title)}</b> ${partBadge(p.part)} <span style="color:var(--ink-2)">${esc(staffName(p.created_by))}</span></div>`).join("")}
      </div>`;
    }
  }

  const firstDow = new Date(y, m, 1).getDay();
  const todayStr = new Date().toISOString().slice(0, 10);
  let cells = "";
  for (let i = 0; i < firstDow; i++) cells += `<div class="plan-cell dim"></div>`;
  for (let d = 1; d <= lastDay; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayPlans = plans.filter((p) => p.plan_date === ds);
    cells += `<div class="plan-cell ${ds === todayStr ? "today" : ""}" data-plday="${ds}">
      <div class="plan-day">${d}</div>
      ${dayPlans.map((p) => `<span class="plan-chip ${p.status}" data-plopen="${p.id}" style="border-left-color:${partColor(p.part)}" title="${esc(p.title)}">${p.status === "pending" ? "⏳ " : ""}${p.plan_time ? fmtT(p.plan_time) + " " : ""}${esc(p.title)}</span>`).join("")}
    </div>`;
  }
  $("#plGrid").innerHTML = cells;

  document.querySelectorAll("[data-plday]").forEach((c) => (c.onclick = (e) => {
    if (e.target.closest("[data-plopen]")) return;
    planModal(null, c.dataset.plday);
  }));
  document.querySelectorAll("[data-plopen]").forEach((el) => (el.onclick = (e) => {
    e.stopPropagation();
    planDetailModal(window.__plans.find((p) => p.id == el.dataset.plopen));
  }));
}

function planModal(edit = null, presetDate = null, fromActivity = null, linkCtx = null) {
  const lk = linkCtx?.task || linkCtx?.todo || null;
  const lkCos = linkCtx?.task ? (linkCtx.task.task_companies || []).map((c) => c.company_id)
    : linkCtx?.todo ? (linkCtx.todo.todo_companies || []).map((c) => c.company_id) : [];
  const lkCts = linkCtx?.task ? (linkCtx.task.task_contracts || []).map((c) => c.contract_id) : [];
  const picked = new Set(edit ? (edit.plan_participants || []).map((p) => p.staff_id)
    : fromActivity ? (fromActivity.activity_participants || []).map((p) => p.staff_id) : [ME.id]);
  const pickedCos = new Set(edit ? (edit.plan_companies || []).map((c) => c.company_id)
    : fromActivity ? (fromActivity.activity_companies || []).map((c) => c.company_id) : lkCos);
  const pickedCts = new Set(edit ? (edit.plan_contracts || []).map((c) => c.contract_id)
    : fromActivity ? (fromActivity.activity_contracts || []).map((c) => c.contract_id) : lkCts);
  const active = STAFF.filter((x) => x.status === "active");
  const autoConfirm = isManager();
  let mult = edit ? edit.multiplier : autoConfirm ? 1 : 2;
  const aType = edit?.a_type || fromActivity?.type || "meeting";
  openModal(`
    <h3>${edit ? "Edit plan" : fromActivity ? "Reschedule as new plan" : lk ? `New plan — linked to: ${esc(lk.title)}` : "New plan"}</h3>
    ${autoConfirm ? "" : `<p style="font-size:12.5px;color:var(--ink-2);margin-bottom:10px">Your plan goes to your part leader. If accepted, it counts as a self-made activity — <b>double score (×2)</b>.</p>`}
    <div class="row2">
      <div class="field"><label>Activity type</label><select id="plType">
        ${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${aType === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>Date${aType === "trip" ? " (start)" : ""}</label><input type="date" id="plDate" value="${edit?.plan_date || presetDate || fromActivity?.activity_date || new Date().toISOString().slice(0, 10)}" /></div>
    </div>
    <div class="field" id="plEndWrap" style="display:${aType === "trip" ? "block" : "none"}">
      <label>Trip end date</label><input type="date" id="plEnd" value="${edit?.end_date || fromActivity?.end_date || edit?.plan_date || new Date().toISOString().slice(0, 10)}" />
    </div>
    <div class="field"><label>Time (optional)</label>${timePickerHTML("plT", edit?.plan_time ? edit.plan_time.slice(0, 5) : null)}
      <div style="font-size:11px;color:var(--ink-2);margin-top:2px"><label style="display:inline;font-weight:400"><input type="checkbox" id="plNoTime" ${edit && !edit.plan_time ? "checked" : !edit ? "checked" : ""} /> No specific time (all-day)</label></div>
    </div>
    ${autoConfirm ? `
    <div class="field"><label>Score multiplier</label>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn ${mult === 1 ? "navy" : "ghost"} sm" id="plM1" style="flex:1">📅 Scheduled (1x)</button>
        <button type="button" class="btn ${mult === 2 ? "navy" : "ghost"} sm" id="plM2" style="flex:1">⚡ Self-made (×2)</button>
      </div>
      <div style="font-size:11px;color:var(--ink-2);margin-top:4px">Regular/scheduled meetings = 1x. Meetings you created through your own initiative = ×2.</div>
    </div>` : ""}
    <div class="field"><label>Title / agenda / goal</label><input id="plTitle" value="${esc(edit?.title || (fromActivity ? fromActivity.title : lk ? lk.title : ""))}" placeholder="e.g. Seaspan 7K LTSA follow-up — align on payment schedule" /></div>
    ${tagPanelHTML()}
    <div class="field"><label>Participants</label>
      <div class="chips" id="plChips"></div>
      <select id="plPick"><option value="">+ Add participant...</option>
        ${active.map((x) => `<option value="${x.id}">${esc(x.name)} (${esc(x.part)})</option>`).join("")}</select>
    </div>
    <div class="field"><label>Notes (optional)</label><textarea id="plNotes">${esc(edit?.notes || (fromActivity?.cancel_reason ? "Rescheduled. Previous cancel reason: " + fromActivity.cancel_reason : ""))}</textarea></div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="plSave">${edit ? (edit.status === "rejected" ? "Save & resubmit" : "Save") : autoConfirm ? "Create (confirmed + activity)" : "Submit for confirmation"}</button>
    </div>`);
  $("#plType").onchange = () => { $("#plEndWrap").style.display = $("#plType").value === "trip" ? "block" : "none"; };
  if (autoConfirm) {
    const paint = () => {
      $("#plM1").className = "btn " + (mult === 1 ? "navy" : "ghost") + " sm";
      $("#plM2").className = "btn " + (mult === 2 ? "navy" : "ghost") + " sm";
    };
    $("#plM1").onclick = () => { mult = 1; paint(); };
    $("#plM2").onclick = () => { mult = 2; paint(); };
  }
  const drawChips = () => {
    $("#plChips").innerHTML = [...picked].map((id) =>
      `<span class="chip">${esc(staffName(id))}${picked.size > 1 || id !== ME.id ? `<button data-rm="${id}">×</button>` : ""}</span>`).join("") || `<span style="font-size:12px;color:var(--ink-2)">No participants</span>`;
    document.querySelectorAll("#plChips [data-rm]").forEach((b) => (b.onclick = () => { picked.delete(Number(b.dataset.rm)); drawChips(); }));
  };
  drawChips();
  bindTagPanel(pickedCos, pickedCts);
  $("#plPick").onchange = (e) => { if (e.target.value) { picked.add(Number(e.target.value)); e.target.value = ""; drawChips(); } };
  $("#plSave").onclick = async () => {
    const isTrip = $("#plType").value === "trip";
    const rec = { title: $("#plTitle").value.trim(), plan_date: $("#plDate").value,
      a_type: $("#plType").value,
      end_date: isTrip ? ($("#plEnd").value || $("#plDate").value) : null,
      plan_time: $("#plNoTime").checked ? null : timePickerValue("plT"),
      multiplier: autoConfirm ? mult : 2,
      notes: $("#plNotes").value.trim() || null };
    if (!rec.title || !rec.plan_date) return alert("Title and date are required.");
    if (isTrip && rec.end_date < rec.plan_date) return alert("Trip end date must be on or after the start date.");
    let planId;
    if (edit) {
      const upd = edit.status === "rejected" ? { ...rec, status: "pending", reject_reason: null } : rec;
      const { error } = await sb.from("plans").update(upd).eq("id", edit.id);
      if (error) return alert("Save failed: " + error.message);
      planId = edit.id;
    } else {
      const { data, error } = await sb.from("plans")
        .insert({ ...rec, part: ME.part, created_by: ME.id, status: "pending",
          task_id: linkCtx?.task?.id || null, todo_id: linkCtx?.todo?.id || null })
        .select("id").single();
      if (error) return alert("Save failed: " + error.message);
      planId = data.id;
      // 연결된 과제/투두에 자동 코멘트 (제출 시점)
      if (linkCtx?.task) await sb.from("task_comments").insert({ task_id: linkCtx.task.id, author_id: ME.id,
        body: `📅 Plan submitted: "${rec.title}" on ${rec.plan_date}${rec.plan_time ? " " + fmt12(rec.plan_time) : ""}` });
      if (linkCtx?.todo) await sb.from("todo_comments").insert({ todo_id: linkCtx.todo.id, author_id: ME.id,
        body: `📅 Plan submitted: "${rec.title}" on ${rec.plan_date}${rec.plan_time ? " " + fmt12(rec.plan_time) : ""}` });
    }
    await sb.from("plan_participants").delete().eq("plan_id", planId);
    if (picked.size) await sb.from("plan_participants").insert([...picked].map((sid) => ({ plan_id: planId, staff_id: sid })));
    await sb.from("plan_companies").delete().eq("plan_id", planId);
    await sb.from("plan_contracts").delete().eq("plan_id", planId);
    if (pickedCos.size) await sb.from("plan_companies").insert([...pickedCos].map((id) => ({ plan_id: planId, company_id: id })));
    if (pickedCts.size) await sb.from("plan_contracts").insert([...pickedCts].map((id) => ({ plan_id: planId, contract_id: id })));
    // 리더급 신규 플랜은 즉시 확정 + 활동 자동 생성
    if (!edit && autoConfirm) {
      const { error } = await sb.rpc("confirm_plan", { p_plan_id: planId });
      if (error) return alert("Plan saved but confirm failed: " + error.message);
    }
    closeModal(); renderPlan();
  };
}

function planDetailModal(p) {
  if (!p) return;
  const canDecide = p.status === "pending" && ((ME.role === "leader" && p.part === ME.part) || isExec() || ME.is_admin);
  const canEdit = (p.created_by === ME.id && p.status !== "confirmed") || (ME.role === "leader" && p.part === ME.part) || isExec() || ME.is_admin;
  const stBadge = p.status === "confirmed" ? `<span class="badge approved">Confirmed</span>`
    : p.status === "rejected" ? `<span class="badge returned">Rejected</span>`
    : `<span class="badge pending">Pending confirmation</span>`;
  openModal(`
    <h3>${p.status === "pending" ? "⏳ " : p.status === "rejected" ? "✖ " : "📅 "}${esc(p.title)}</h3>
    <div style="font-size:13px;color:var(--ink-2);margin-bottom:12px">
      <span class="badge ${p.a_type}">${TYPE_LABEL[p.a_type] || p.a_type}</span>
      ${p.multiplier === 2 ? `<span class="badge pending">⚡ ×2</span>` : `<span class="badge part">1x</span>`}
      ${fmtD(p.plan_date)}${p.a_type === "trip" && p.end_date && p.end_date !== p.plan_date ? " ~ " + fmtD(p.end_date) : ""}${p.plan_time ? " · " + fmt12(p.plan_time) : ""} · ${partBadge(p.part)} · ${stBadge}
    </div>
    ${p.status === "rejected" && p.reject_reason ? `<div class="field"><label>Reject reason</label>
      <div style="white-space:pre-wrap;background:#fff5f5;border:1.5px solid #f3c9c9;border-radius:8px;padding:10px;font-size:13px">${esc(p.reject_reason)}</div></div>` : ""}
    <div class="field"><label>Participants</label>
      <div class="chips">${(p.plan_participants || []).map((x) => `<span class="chip">${esc(staffName(x.staff_id))}</span>`).join("") || "-"}</div></div>
    ${(p.plan_companies || []).length ? `<div class="field"><label>Companies / contracts</label>
      <div class="chips">${(p.plan_companies || []).map((c) => `<span class="chip">${esc(companyName(c.company_id))}</span>`).join("")}${(p.plan_contracts || []).map((c) => `<span class="chip">${esc(contractName(c.contract_id))}</span>`).join("")}</div></div>` : ""}
    ${p.notes ? `<div class="field"><label>Notes</label><div style="white-space:pre-wrap;font-size:13.5px">${esc(p.notes)}</div></div>` : ""}
    <div style="font-size:12px;color:var(--ink-2)">Created by ${esc(staffName(p.created_by))}${p.status === "confirmed" ? " · ✅ Activity created — see Activities" : ""}</div>
    <div class="modal-actions">
      ${canEdit && p.status !== "confirmed" ? `<button class="btn ghost" id="plDel" style="color:var(--red)">Delete</button><button class="btn ghost" id="plEdit">Edit</button>` : ""}
      ${canDecide ? `<button class="btn danger" id="plReject">✖ Reject</button><button class="btn" id="plConfirm">✅ Accept${p.multiplier === 2 ? " (×2)" : " (1x)"}</button>` : ""}
      <button class="btn ${canDecide ? "ghost" : ""}" onclick="closeModal()">Close</button>
    </div>`);
  if ($("#plConfirm")) $("#plConfirm").onclick = async () => {
    const { error } = await sb.rpc("confirm_plan", { p_plan_id: p.id });
    if (error) return alert("Confirm failed: " + error.message);
    closeModal(); renderPlan();
  };
  if ($("#plReject")) $("#plReject").onclick = () => {
    openModal(`
      <h3>Reject plan</h3>
      <div class="field"><label>Reject reason</label><textarea id="rjReason" style="min-height:100px" placeholder="e.g. Overlaps with the quarterly review — propose another week."></textarea></div>
      <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Back</button><button class="btn danger" id="rjGo">Reject</button></div>`);
    $("#rjGo").onclick = async () => {
      const reason = $("#rjReason").value.trim();
      if (!reason) return alert("Enter a reject reason.");
      const { error } = await sb.from("plans").update({ status: "rejected", reject_reason: reason }).eq("id", p.id);
      if (error) return alert("Reject failed: " + error.message);
      if (p.task_id) await sb.from("task_comments").insert({ task_id: p.task_id, author_id: ME.id, body: `✖ Plan rejected: ${reason}` });
      if (p.todo_id) await sb.from("todo_comments").insert({ todo_id: p.todo_id, author_id: ME.id, body: `✖ Plan rejected: ${reason}` });
      closeModal(); renderPlan();
    };
  };
  if ($("#plEdit")) $("#plEdit").onclick = () => planModal(p);
  if ($("#plDel")) $("#plDel").onclick = async () => {
    if (!confirm("Delete this plan?")) return;
    await sb.from("plans").delete().eq("id", p.id);
    closeModal(); renderPlan();
  };
}

/* =========================================================
   WORKBOARD (v10): free-canvas task board + to-do side panel
   ========================================================= */
var boardPart = null;
var boardShow = { done: true, canceled: true };
var boardView = "canvas";      // "canvas" | "list"
var boardCoFilter = 0;         // 0 = all companies
var boardShowOldDone = false;  // show done to-dos from previous days
var boardMyTodos = false;      // "mine only" todo filter
const TASK_ST = { progress: "In Progress", done: "Done", canceled: "Canceled" };
const STAFF_PALETTE = ["#2e7cf6", "#00a651", "#f0a020", "#9b59d0", "#e5568c", "#12a5a5", "#e2574c", "#5a6b7d", "#7cb518", "#ff7f50", "#4a6fa5", "#b8860b"];
const staffColor = (id) => STAFF.find((x) => x.id === id)?.color || "#cfd6dd";
const nameTag = (id) => { const c = staffColor(id); return `<span class="name-tag" style="background:${c}26;border-color:${c}88;color:#1f2937">${esc(staffName(id))}</span>`; };
const agoTxt = (ts) => { const d = Math.floor((Date.now() - new Date(ts)) / 86400000); return d <= 0 ? "today" : d + "d ago"; };
const amountTxt = (a) => (a === null || a === undefined || a === "" ? "" : `$${Number(a)}K`);

function cardBG(t) {
  if (t.status === "canceled") return "#e9ecef";
  const cols = (t.task_assignees || []).map((a) => staffColor(a.staff_id) + "2e");
  if (!cols.length) return "#f4f6f8";
  if (cols.length === 1) return cols[0];
  const step = 100 / cols.length;
  const stops = cols.map((c, i) => `${c} ${i * step}%, ${c} ${(i + 1) * step}%`).join(", ");
  return `linear-gradient(135deg, ${stops})`;
}
function wmHTML(t) {
  const co = (t.task_companies || [])[0];
  if (!co) return "";
  const name = esc(companyName(co.company_id));
  if (t.status === "canceled") return `<div class="tcard-wm"><span style="color:#9aa3ab">${name}</span></div>`;
  if (t.status === "done") return `<div class="tcard-wm"><span style="color:var(--green)">${name}</span></div>`;
  return `<div class="tcard-wm"><span style="background:linear-gradient(to top, var(--green) 50%, #b9c2cb 50%);-webkit-background-clip:text;background-clip:text;color:transparent">${name}</span></div>`;
}

async function renderBoard() {
  if (!boardPart) boardPart = ME.part;
  const main = $("#main");
  main.innerHTML = `<div class="page-title">Workboard</div>
    <div class="page-sub">Drag cards anywhere — the layout is shared. Watermark fill shows status: half = in progress, full green = done, gray = canceled. Card color = assignees' colors.</div>
    <div class="filterbar" style="align-items:center">
      <div class="seg">${PARTS.map((p) => `<button data-bpart="${esc(p.name)}" class="${boardPart === p.name ? "active" : ""}">${esc(p.name)}</button>`).join("")}</div>
      <div class="seg" style="margin-left:10px">
        <button id="bvCanvas" class="${boardView === "canvas" ? "active" : ""}">🗂 Canvas</button>
        <button id="bvList" class="${boardView === "list" ? "active" : ""}">📋 List</button>
      </div>
      <select id="bCoFilter" style="max-width:170px">
        <option value="0">🏢 All companies</option>
        ${COMPANIES.map((c) => `<option value="${c.id}" ${boardCoFilter == c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>
      <label style="font-size:12px"><input type="checkbox" id="bShowDone" ${boardShow.done ? "checked" : ""}/> Done</label>
      <label style="font-size:12px"><input type="checkbox" id="bShowCx" ${boardShow.canceled ? "checked" : ""}/> Canceled</label>
      ${isManager() ? `<button class="btn ghost sm" id="btnColors" style="margin-left:auto">🎨 Member colors</button>` : `<span style="margin-left:auto"></span>`}
      <button class="btn" id="btnNewTask">+ New task</button>
    </div>
    <div class="board-layout">
      <div id="boardCanvas" class="board-canvas"><div class="empty">Loading...</div></div>
      <aside class="todo-aside">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <b style="font-size:13.5px">✅ To-dos — ${esc(boardPart)}</b>
          ${boardPart === ME.part ? `<button class="btn sm" id="btnNewTodo">+ Mine</button>` : ""}
        </div>
        <label style="display:block;font-size:11.5px;color:var(--ink-2);margin-bottom:8px;cursor:pointer">
          <input type="checkbox" id="bMyTodos" ${boardMyTodos ? "checked" : ""}/> Show mine only (incl. tagged to me)</label>
        <div id="todoBody" class="empty" style="padding:10px">Loading...</div>
      </aside>
    </div>`;
  document.querySelectorAll("[data-bpart]").forEach((b) => (b.onclick = () => { boardPart = b.dataset.bpart; renderBoard(); }));
  $("#bShowDone").onchange = (e) => { boardShow.done = e.target.checked; renderBoard(); };
  $("#bShowCx").onchange = (e) => { boardShow.canceled = e.target.checked; renderBoard(); };
  $("#bvCanvas").onclick = () => { boardView = "canvas"; renderBoard(); };
  $("#bvList").onclick = () => { boardView = "list"; renderBoard(); };
  $("#bCoFilter").onchange = (e) => { boardCoFilter = Number(e.target.value); renderBoard(); };
  $("#btnNewTask").onclick = () => taskModal();
  if ($("#btnNewTodo")) $("#btnNewTodo").onclick = () => todoModal();
  $("#bMyTodos").onchange = (e) => { boardMyTodos = e.target.checked; renderBoard(); };
  if ($("#btnColors")) $("#btnColors").onclick = () => memberColorsModal();

  const [{ data: tRaw }, { data: cRaw }, { data: tdRaw }, { data: tdcRaw }, { data: tgRaw }] = await Promise.all([
    sb.from("tasks").select("*, task_assignees(staff_id), task_companies(company_id), task_contracts(contract_id)").eq("part", boardPart),
    sb.from("task_comments")
      .select("id,task_id,body,author_id,created_at,needs_ack,acked_by")
      .order("created_at", { ascending: true }),
    sb.from("todos").select("*, todo_companies(company_id), todo_tags(staff_id)").eq("part", boardPart).order("done").order("due_date", { ascending: true, nullsFirst: false }),
    sb.from("todo_comments").select("id,todo_id,needs_ack,acked_by"),
    sb.from("todos").select("*, todo_companies(company_id), todo_tags!inner(staff_id)").eq("todo_tags.staff_id", ME.id),
  ]);
  let tasks = tRaw || [];
  const cmts = cRaw || [];
  const tdCmts = tdcRaw || [];
  // 파트 투두 + 나를 태그한 투두(타 파트 포함) 병합
  let todos = tdRaw || [];
  (tgRaw || []).forEach((t) => { if (!todos.some((x) => x.id === t.id)) todos.push(t); });
  todos.sort((a, b) => (a.done - b.done) || String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")));
  window.__tasks = tasks; window.__todos = todos;
  if (!$("#boardCanvas")) return;

  tasks = tasks.filter((t) => (t.status !== "done" || boardShow.done) && (t.status !== "canceled" || boardShow.canceled));
  if (boardCoFilter) tasks = tasks.filter((t) => (t.task_companies || []).some((c) => c.company_id === boardCoFilter));
  // 초기 정렬: 금액 큰 순 (위치 미지정 카드의 자동 배치 순서)
  tasks.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));

  if (boardView === "list") {
    // ===== 엑셀형 리스트 뷰 =====
    const stBadge = (t) => `<span class="badge ${t.status === "done" ? "approved" : t.status === "canceled" ? "returned" : "submitted"}">${TASK_ST[t.status]}</span>`;
    $("#boardCanvas").style.minHeight = "0";
    $("#boardCanvas").innerHTML = tasks.length ? `<div class="workboard-table-wrap">
      <table class="workboard-list-table"><thead><tr>
        <th>Company</th><th>Project / Title</th><th>PIC</th><th style="text-align:right">Est. (K$)</th>
        <th>Due</th><th>Status</th><th>Last F/up</th><th>💬</th><th class="wb-detail-head">Detail / Follow-up</th>
      </tr></thead><tbody>
      ${tasks.map((t) => {
        const n = cmts.filter((c) => c.task_id === t.id);
        const pendingAck = n.filter((c) => c.needs_ack && !c.acked_by).length;
        const over = t.due_date && t.status === "progress" && t.due_date < new Date().toISOString().slice(0, 10);
        const detailHTML = [
          t.body ? `<div class="wb-detail-main">${esc(t.body)}</div>` : "",
          ...n.map((c) => `<div class="wb-detail-comment">
            <div class="wb-detail-comment-meta">${esc(staffName(c.author_id))} · ${fmtD(c.created_at)}</div>
            <div>${esc(c.body || "")}</div>
          </div>`)
        ].filter(Boolean).join("") || `<span class="wb-detail-empty">-</span>`;
        return `<tr class="clickable" data-task="${t.id}" style="${t.status === "canceled" ? "opacity:.5;text-decoration:line-through" : ""}">
          <td>${(t.task_companies || []).map((c) => `<span class="badge meeting">${esc(companyName(c.company_id))}</span>`).join(" ") || "-"}</td>
          <td class="wb-title-cell"><b>${esc(t.title)}</b>
            ${(t.task_contracts || []).map((c) => `<span class="badge vc">${esc(contractName(c.contract_id))}</span>`).join(" ")}</td>
          <td style="white-space:nowrap">${(t.task_assignees || []).map((a) => nameTag(a.staff_id)).join("") || "-"}</td>
          <td style="text-align:right;font-weight:700">${t.amount !== null && t.amount !== undefined ? Number(t.amount) : ""}</td>
          <td style="white-space:nowrap">${t.due_date ? `<span class="due-chip ${over ? "over" : ""}">${fmtD(t.due_date).slice(5)}${over ? " ⚠" : ""}</span>` : "-"}</td>
          <td>${stBadge(t)}</td>
          <td style="white-space:nowrap;font-size:12px;color:var(--ink-2)">${agoTxt(t.last_fup)}</td>
          <td style="white-space:nowrap">${pendingAck ? `<span style="color:#b08800;font-weight:800">⏳${pendingAck}</span> ` : ""}${n.length}</td>
          <td class="wb-detail-cell">${detailHTML}</td>
        </tr>`;
      }).join("")}
      </tbody></table></div>` : `<div class="empty" style="padding-top:60px">No tasks match.</div>`;
    document.querySelectorAll("[data-task]").forEach((el) => (el.onclick = () => taskDetail(Number(el.dataset.task))));
    drawTodoPanel(todos, tdCmts);
    return;
  }

  const CW = 250, CH = 165, COLS = 3;
  let autoIdx = 0;
  const cardHTML = (t) => {
    let x = t.pos_x, y = t.pos_y;
    if (x === null || x === undefined || y === null || y === undefined) {
      x = 12 + (autoIdx % COLS) * (CW + 14);
      y = 12 + Math.floor(autoIdx / COLS) * (CH + 14);
      autoIdx++;
    }
    const over = t.due_date && t.status === "progress" && t.due_date < new Date().toISOString().slice(0, 10);
    const n = cmts.filter((c) => c.task_id === t.id);
    const pendingAck = n.filter((c) => c.needs_ack && !c.acked_by).length;
    return `<div class="tcard ${t.status === "canceled" ? "dead" : ""} ${over ? "overdue" : ""}" draggable="true"
      data-task="${t.id}" style="background:${cardBG(t)};position:absolute;left:${x}px;top:${y}px;width:${CW}px">
      ${wmHTML(t)}
      <div class="tcard-top">
        <span style="display:flex;gap:5px;align-items:center">
          ${t.amount !== null && t.amount !== undefined && t.amount !== "" ? `<span class="imp mid" style="background:#e8f5ee;color:var(--green-dark)">${amountTxt(t.amount)}</span>` : ""}
          ${t.status === "done" ? `<span class="imp low" style="background:#d9f7d9;color:var(--green-dark)">✔ DONE</span>` : ""}
        </span>
        ${t.due_date ? `<span class="due-chip ${over ? "over" : ""}">DUE ${fmtD(t.due_date).slice(5)}${over ? " ⚠" : ""}</span>` : ""}
      </div>
      <div class="tcard-title">${esc(t.title)}</div>
      <div style="margin-bottom:6px">${(t.task_assignees || []).map((a) => nameTag(a.staff_id)).join("") || `<span style="font-size:10.5px;color:var(--ink-2)">unassigned</span>`}</div>
      <div class="tcard-foot">
        <span>F/up ${agoTxt(t.last_fup)}</span>
        <span>${pendingAck ? `<span style="color:#b08800;font-weight:800">⏳${pendingAck}</span> ` : ""}💬 ${n.length}</span>
      </div>
    </div>`;
  };

  const canvasH = Math.max(560, (Math.floor((tasks.length - 1) / COLS) + 1) * (CH + 14) + 240);
  $("#boardCanvas").style.minHeight = canvasH + "px";
  $("#boardCanvas").innerHTML = tasks.map(cardHTML).join("") ||
    `<div class="empty" style="padding-top:60px">No tasks in ${esc(boardPart)}. Create the first one!</div>`;

  // click → detail
  document.querySelectorAll("[data-task]").forEach((el) => (el.onclick = () => taskDetail(Number(el.dataset.task))));
  // drag & drop (shared positions)
  const canvas = $("#boardCanvas");
  let dragEl = null, dx = 0, dy = 0;
  document.querySelectorAll("[data-task]").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      dragEl = el;
      const r = el.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      e.dataTransfer.effectAllowed = "move";
    });
  });
  canvas.addEventListener("dragover", (e) => e.preventDefault());
  canvas.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!dragEl) return;
    const cr = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - cr.left - dx));
    const y = Math.max(0, Math.round(e.clientY - cr.top - dy));
    dragEl.style.left = x + "px"; dragEl.style.top = y + "px";
    const id = Number(dragEl.dataset.task);
    dragEl = null;
    const { error } = await sb.from("tasks").update({ pos_x: x, pos_y: y }).eq("id", id);
    if (error) alert("Position not saved (only people involved in a task can move it): " + error.message);
  });

  drawTodoPanel(todos, tdCmts);
}

function drawTodoPanel(todos, tdCmts) {
  if (!$("#todoBody")) return;
  const today = new Date().toISOString().slice(0, 10);
  // 완료 투두 자동 숨김: 오늘 완료한 것만 표시, 이전 날 완료분은 토글 켜야 보임
  const isMineOrTagged = (td) => td.staff_id === ME.id || (td.todo_tags || []).some((t) => t.staff_id === ME.id);
  if (boardMyTodos) todos = todos.filter(isMineOrTagged);
  const oldDone = todos.filter((td) => td.done && td.done_at && td.done_at.slice(0, 10) < today);
  const visible = todos.filter((td) => !(td.done && td.done_at && td.done_at.slice(0, 10) < today) || boardShowOldDone);
  const daysLate = (td) => {
    const base = td.due_date || (td.created_at ? td.created_at.slice(0, 10) : null);
    if (!base || base >= today) return 0;
    return Math.floor((new Date(today) - new Date(base)) / 86400000);
  };
  $("#todoBody").innerHTML = (visible.length ? visible.map((td) => {
    const n = tdCmts.filter((c) => c.todo_id === td.id);
    const pendingAck = n.filter((c) => c.needs_ack && !c.acked_by).length;
    const late = !td.done ? daysLate(td) : 0;
    return `<div class="todo-row ${td.done ? "tdone" : ""}" data-todo="${td.id}">
      <span class="todo-check ${late ? "late" : ""}" data-tdchk="${td.id}" title="${td.done ? "Reopen" : late ? "Carried over " + late + " day(s) — mark done" : "Mark done"}">${td.done ? "✔" : "○"}</span>
      <span style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:600;${td.done ? "text-decoration:line-through;color:var(--ink-2)" : ""};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(td.title)}</div>
        <div style="font-size:10.5px;color:var(--ink-2)">${nameTag(td.staff_id)}${(td.todo_tags || []).filter((t) => t.staff_id !== td.staff_id).map((t) => nameTag(t.staff_id)).join("")}
          ${td.due_date ? ` <span class="due-chip ${late ? "over" : ""}">DUE ${fmtD(td.due_date).slice(5)}</span>` : ""}
          ${late ? ` <span style="color:var(--red);font-weight:800">⏰ +${late}d</span>` : ""}</div>
      </span>
      <span style="font-size:10.5px;color:var(--ink-2);white-space:nowrap">${pendingAck ? `<span style="color:#b08800;font-weight:800">⏳${pendingAck}</span> ` : ""}💬${n.length}</span>
    </div>`;
  }).join("") : `<div style="font-size:12px;color:var(--ink-2)">No to-dos yet.</div>`)
  + (oldDone.length ? `<label style="display:block;font-size:11px;color:var(--ink-2);margin-top:8px;cursor:pointer">
      <input type="checkbox" id="bOldDone" ${boardShowOldDone ? "checked" : ""}/> Show ${oldDone.length} done from previous days</label>` : "");
  if ($("#bOldDone")) $("#bOldDone").onchange = (e) => { boardShowOldDone = e.target.checked; renderBoard(); };
  document.querySelectorAll("[data-todo]").forEach((el) => (el.onclick = (e) => {
    if (e.target.dataset.tdchk) return;
    todoDetail(Number(el.dataset.todo));
  }));
  document.querySelectorAll("[data-tdchk]").forEach((el) => (el.onclick = async () => {
    const td = (window.__todos || []).find((x) => x.id == el.dataset.tdchk);
    if (td.staff_id !== ME.id) return alert("Only the owner can check off a to-do.");
    await sb.from("todos").update({ done: !td.done, done_at: !td.done ? new Date().toISOString() : null }).eq("id", td.id);
    renderBoard();
  }));
}

function memberColorsModal() {
  const list = STAFF.filter((x) => x.status === "active" && (isExec() || ME.is_admin ? true : x.part === ME.part));
  openModal(`
    <h3>🎨 Member colors</h3>
    <p style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">Card backgrounds use assignees' colors. ${isExec() || ME.is_admin ? "" : "You can set colors for your part."}</p>
    <div style="max-height:340px;overflow-y:auto">
    ${list.map((x) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed var(--line)">
      <span style="width:130px;font-size:13px"><b>${esc(x.name)}</b> <span style="font-size:10.5px;color:var(--ink-2)">${esc(x.part)}</span></span>
      <span style="display:flex;gap:5px;flex-wrap:wrap">
        ${STAFF_PALETTE.map((c) => `<span data-setcol="${x.id}|${c}" style="width:20px;height:20px;border-radius:50%;background:${c};cursor:pointer;display:inline-block;border:2.5px solid ${x.color === c ? "var(--navy)" : "transparent"}"></span>`).join("")}
      </span>
    </div>`).join("")}
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Done</button></div>`);
  document.querySelectorAll("[data-setcol]").forEach((sw) => (sw.onclick = async () => {
    const [sid, color] = sw.dataset.setcol.split("|");
    const { error } = await sb.rpc("set_staff_color", { p_staff_id: Number(sid), p_color: color });
    if (error) return alert("Failed: " + error.message);
    const st = STAFF.find((x) => x.id == sid); if (st) st.color = color;
    memberColorsModal();
  }));
}

function taskModal(edit = null) {
  const myPartStaff = STAFF.filter((x) => x.status === "active");
  const picked = new Set(edit ? (edit.task_assignees || []).map((a) => a.staff_id) : []);
  const pickedCos = new Set(edit ? (edit.task_companies || []).map((c) => c.company_id) : []);
  const pickedCts = new Set(edit ? (edit.task_contracts || []).map((c) => c.contract_id) : []);
  openModal(`
    <h3>${edit ? "Edit task" : "New task — " + esc(boardPart)}</h3>
    <div class="field"><label>Title (project / follow-up item)</label><input id="tkTitle" value="${esc(edit?.title || "")}" placeholder="e.g. COSCO Bow Thruster replacement F/up" /></div>
    <div class="row2">
      <div class="field"><label>Amount (K$, optional)</label><input type="number" min="0" step="1" id="tkAmt" value="${edit?.amount ?? ""}" placeholder="e.g. 15 → $15K" /></div>
      <div class="field"><label>Due date (optional)</label><input type="date" id="tkDue" value="${edit?.due_date || ""}" /></div>
    </div>
    ${edit ? `<div class="field"><label>Status</label><select id="tkSt">
      ${Object.entries(TASK_ST).map(([k, v]) => `<option value="${k}" ${edit?.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>` : ""}
    <div class="field"><label>Details</label><textarea id="tkBody" style="min-height:100px">${esc(edit?.body || "")}</textarea></div>
    ${tagPanelHTML()}
    <div class="field"><label>Assignees</label>
      <div class="chips" id="tkChips"></div>
      <select id="tkPick"><option value="">+ Assign...</option>
        ${myPartStaff.map((x) => `<option value="${x.id}">${esc(x.name)} (${esc(x.part)})</option>`).join("")}</select>
    </div>
    <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="tkSave">${edit ? "Save" : "Create"}</button></div>`);
  const drawChips = () => {
    $("#tkChips").innerHTML = [...picked].map((id) => `<span class="chip">${esc(staffName(id))}<button data-rm="${id}">×</button></span>`).join("") || `<span style="font-size:12px;color:var(--ink-2)">Unassigned</span>`;
    document.querySelectorAll("#tkChips [data-rm]").forEach((b) => (b.onclick = () => { picked.delete(Number(b.dataset.rm)); drawChips(); }));
  };
  drawChips();
  bindTagPanel(pickedCos, pickedCts);
  $("#tkPick").onchange = (e) => { if (e.target.value) { picked.add(Number(e.target.value)); e.target.value = ""; drawChips(); } };
  $("#tkSave").onclick = async () => {
    const amt = $("#tkAmt").value;
    const rec = { title: $("#tkTitle").value.trim(), body: $("#tkBody").value.trim() || null,
      amount: amt === "" ? null : Number(amt), due_date: $("#tkDue").value || null };
    if (edit) rec.status = $("#tkSt").value;
    if (!rec.title) return alert("Title is required.");
    let taskId;
    if (edit) {
      const { error } = await sb.from("tasks").update(rec).eq("id", edit.id);
      if (error) return alert("Save failed: " + error.message);
      taskId = edit.id;
    } else {
      const { data, error } = await sb.from("tasks").insert({ ...rec, status: "progress", part: boardPart === ME.part || isExec() || ME.is_admin ? boardPart : ME.part, created_by: ME.id }).select("id").single();
      if (error) return alert("Save failed: " + error.message);
      taskId = data.id;
    }
    await sb.from("task_assignees").delete().eq("task_id", taskId);
    if (picked.size) await sb.from("task_assignees").insert([...picked].map((sid) => ({ task_id: taskId, staff_id: sid })));
    await sb.from("task_companies").delete().eq("task_id", taskId);
    await sb.from("task_contracts").delete().eq("task_id", taskId);
    if (pickedCos.size) await sb.from("task_companies").insert([...pickedCos].map((id) => ({ task_id: taskId, company_id: id })));
    if (pickedCts.size) await sb.from("task_contracts").insert([...pickedCts].map((id) => ({ task_id: taskId, contract_id: id })));
    closeModal(); renderBoard();
  };
}

async function taskDetail(taskId) {
  const t = (window.__tasks || []).find((x) => x.id === taskId);
  if (!t) return;
  const { data: cs } = await sb.from("task_comments").select("*").eq("task_id", taskId).order("created_at");
  const comments = cs || [];
  const amInvolved = t.created_by === ME.id || (t.task_assignees || []).some((a) => a.staff_id === ME.id)
    || (ME.role === "leader" && t.part === ME.part) || isExec() || ME.is_admin;
  const canDelete = (ME.role === "leader" && t.part === ME.part) || isExec() || ME.is_admin;
  const over = t.due_date && t.status === "progress" && t.due_date < new Date().toISOString().slice(0, 10);
  openModal(`
    <h3>${esc(t.title)}</h3>
    <div style="font-size:12.5px;color:var(--ink-2);margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      ${t.amount !== null && t.amount !== undefined ? `<span class="imp mid" style="background:#e8f5ee;color:var(--green-dark)">${amountTxt(t.amount)}</span>` : ""}
      <span class="badge ${t.status === "done" ? "approved" : t.status === "canceled" ? "returned" : "submitted"}">${TASK_ST[t.status]}</span>
      ${t.due_date ? `<span class="due-chip ${over ? "over" : ""}">DUE ${fmtD(t.due_date)}${over ? " ⚠ OVERDUE" : ""}</span>` : ""}
      ${partBadge(t.part)}
      ${(t.task_companies || []).map((c) => `<span class="badge meeting">${esc(companyName(c.company_id))}</span>`).join("")}
      ${(t.task_contracts || []).map((c) => `<span class="badge vc">${esc(contractName(c.contract_id))}</span>`).join("")}
    </div>
    <div style="font-size:12px;color:var(--ink-2);margin-bottom:8px">Assignees: ${(t.task_assignees || []).map((a) => nameTag(a.staff_id)).join("") || "unassigned"} · created by ${esc(staffName(t.created_by))} · last F/up ${agoTxt(t.last_fup)}</div>
    ${t.body ? `<div class="field"><label>Details</label><div style="white-space:pre-wrap;font-size:13.5px;line-height:1.6">${esc(t.body)}</div></div>` : ""}
    <div class="field"><label>Comments (${comments.length})</label>
      <div style="max-height:260px;overflow-y:auto">
      ${comments.map((c) => `<div class="cmt">
        <div class="cmt-meta"><span><b>${esc(staffName(c.author_id))}</b> · ${fmtD(c.created_at.slice(0, 10))} ${fmt12(c.created_at.slice(11, 16))}</span>
        <span>${c.needs_ack ? (c.acked_by ? `<span class="ack-done">✔ Handled by ${esc(staffName(c.acked_by))}</span>` : amInvolved ? `<button class="ack-btn" data-ack="${c.id}">⏳ Action needed — mark handled</button>` : `<span class="ack-btn" style="cursor:default">⏳ Action needed</span>`) : ""}</span></div>
        <div style="white-space:pre-wrap">${esc(c.body)}</div></div>`).join("") || `<div style="font-size:12.5px;color:var(--ink-2)">No comments yet.</div>`}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input id="tkNewCmt" placeholder="Add a comment / F-up note..." style="flex:1;padding:8px 10px;border:1.5px solid var(--line);border-radius:7px" />
        <button class="btn sm" id="tkCmtGo">Post</button>
      </div>
    </div>
    <div class="modal-actions">
      ${canDelete ? `<button class="btn ghost" id="tkDel" style="color:var(--red)">Delete</button>` : ""}
      ${amInvolved ? `<button class="btn ghost" id="tkPlanBtn">📅 Create plan</button><button class="btn ghost" id="tkEdit">Edit</button>
        ${t.status === "progress" ? `<button class="btn navy" id="tkDone">✔ Mark done</button>` : ""}` : ""}
      <button class="btn ${amInvolved ? "ghost" : ""}" onclick="closeModal()">Close</button>
    </div>`);
  document.querySelectorAll("[data-ack]").forEach((b) => (b.onclick = async () => {
    const { error } = await sb.from("task_comments").update({ acked_by: ME.id, acked_at: new Date().toISOString() }).eq("id", b.dataset.ack);
    if (error) return alert("Failed: " + error.message);
    taskDetail(taskId);
  }));
  $("#tkCmtGo").onclick = async () => {
    const body = $("#tkNewCmt").value.trim();
    if (!body) return;
    const needsAck = (ME.role !== "member" || ME.is_admin) && !(t.task_assignees || []).some((a) => a.staff_id === ME.id);
    const { error } = await sb.from("task_comments").insert({ task_id: taskId, author_id: ME.id, body, needs_ack: needsAck });
    if (error) return alert("Failed: " + error.message);
    t.last_fup = new Date().toISOString();
    taskDetail(taskId);
  };
  $("#tkNewCmt").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#tkCmtGo").click(); });
  if ($("#tkEdit")) $("#tkEdit").onclick = () => taskModal(t);
  if ($("#tkDone")) $("#tkDone").onclick = async () => {
    await sb.from("tasks").update({ status: "done" }).eq("id", taskId);
    closeModal(); renderBoard();
  };
  if ($("#tkDel")) $("#tkDel").onclick = async () => {
    if (!confirm("Delete this task and all its comments?")) return;
    await sb.from("tasks").delete().eq("id", taskId);
    closeModal(); renderBoard();
  };
  if ($("#tkPlanBtn")) $("#tkPlanBtn").onclick = () => {
    closeModal(); switchView("plan");
    setTimeout(() => planModal(null, null, null, { task: t }), 300);
  };
}

function todoModal(edit = null) {
  const pickedCos = new Set(edit ? (edit.todo_companies || []).map((c) => c.company_id) : []);
  const pickedCts = new Set();
  const pickedPpl = new Set(edit ? (edit.todo_tags || []).map((t) => t.staff_id).filter((id) => id !== ME.id) : []);
  const activeStaff = STAFF.filter((x) => x.status === "active" && x.id !== ME.id);
  openModal(`
    <h3>${edit ? "Edit to-do" : "New to-do"}</h3>
    <div class="field"><label>Title</label><input id="tdTitle" value="${esc(edit?.title || "")}" placeholder="e.g. Send Woodward LECM inquiry" /></div>
    <div class="row2">
      <div class="field"><label>Due date (optional)</label><input type="date" id="tdDue" value="${edit?.due_date || ""}" /></div>
      <div class="field"><label>&nbsp;</label><div style="font-size:12px;color:var(--ink-2);padding-top:8px">Visible to your part${isExec() || ME.is_admin ? " (and execs)" : ""}.</div></div>
    </div>
    <div class="field"><label>Notes (optional)</label><textarea id="tdBody">${esc(edit?.body || "")}</textarea></div>
    ${tagPanelHTML()}
    <div class="field"><label>Tag people (optional — appears in their to-do list too)</label>
      <div class="chips" id="tdPplChips"></div>
      <select id="tdPplPick"><option value="">+ Tag someone...</option>
        ${activeStaff.map((x) => `<option value="${x.id}">${esc(x.name)} (${esc(x.part)})</option>`).join("")}</select>
    </div>
    <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="tdSave">${edit ? "Save" : "Add"}</button></div>`);
  bindTagPanel(pickedCos, pickedCts);
  $("#ctWrap").style.display = "none";
  const drawPpl = () => {
    $("#tdPplChips").innerHTML = [...pickedPpl].map((id) => `<span class="chip">${esc(staffName(id))}<button data-rmppl="${id}">×</button></span>`).join("") || `<span style="font-size:12px;color:var(--ink-2)">No one tagged</span>`;
    document.querySelectorAll("[data-rmppl]").forEach((b) => (b.onclick = () => { pickedPpl.delete(Number(b.dataset.rmppl)); drawPpl(); }));
  };
  drawPpl();
  $("#tdPplPick").onchange = (e) => { if (e.target.value) { pickedPpl.add(Number(e.target.value)); e.target.value = ""; drawPpl(); } };
  $("#tdSave").onclick = async () => {
    const rec = { title: $("#tdTitle").value.trim(), body: $("#tdBody").value.trim() || null, due_date: $("#tdDue").value || null };
    if (!rec.title) return alert("Title is required.");
    let todoId;
    if (edit) {
      const { error } = await sb.from("todos").update(rec).eq("id", edit.id);
      if (error) return alert("Save failed: " + error.message);
      todoId = edit.id;
    } else {
      const { data, error } = await sb.from("todos").insert({ ...rec, staff_id: ME.id, part: ME.part }).select("id").single();
      if (error) return alert("Save failed: " + error.message);
      todoId = data.id;
    }
    await sb.from("todo_companies").delete().eq("todo_id", todoId);
    if (pickedCos.size) await sb.from("todo_companies").insert([...pickedCos].map((id) => ({ todo_id: todoId, company_id: id })));
    await sb.from("todo_tags").delete().eq("todo_id", todoId);
    if (pickedPpl.size) await sb.from("todo_tags").insert([...pickedPpl].map((sid) => ({ todo_id: todoId, staff_id: sid })));
    closeModal(); renderBoard();
  };
}

async function todoDetail(todoId) {
  const td = (window.__todos || []).find((x) => x.id === todoId);
  if (!td) return;
  const { data: cs } = await sb.from("todo_comments").select("*").eq("todo_id", todoId).order("created_at");
  const comments = cs || [];
  const mine = td.staff_id === ME.id;
  openModal(`
    <h3>${td.done ? "✔ " : ""}${esc(td.title)}</h3>
    <div style="font-size:12.5px;color:var(--ink-2);margin-bottom:10px">
      ${nameTag(td.staff_id)}${(td.todo_tags || []).filter((t) => t.staff_id !== td.staff_id).map((t) => nameTag(t.staff_id)).join("")}
      ${td.due_date ? ` DUE ${fmtD(td.due_date)}` : ""} · last F/up ${agoTxt(td.last_fup)}
      ${(td.todo_companies || []).map((c) => ` <span class="badge meeting">${esc(companyName(c.company_id))}</span>`).join("")}
    </div>
    ${td.body ? `<div class="field"><label>Notes</label><div style="white-space:pre-wrap;font-size:13.5px">${esc(td.body)}</div></div>` : ""}
    <div class="field"><label>Comments (${comments.length})</label>
      ${comments.map((c) => `<div class="cmt">
        <div class="cmt-meta"><span><b>${esc(staffName(c.author_id))}</b> · ${fmtD(c.created_at.slice(0, 10))}</span>
        <span>${c.needs_ack ? (c.acked_by ? `<span class="ack-done">✔ Handled</span>` : mine ? `<button class="ack-btn" data-tdack="${c.id}">⏳ Action needed — mark handled</button>` : `<span class="ack-btn" style="cursor:default">⏳ Action needed</span>`) : ""}</span></div>
        <div style="white-space:pre-wrap">${esc(c.body)}</div></div>`).join("") || `<div style="font-size:12.5px;color:var(--ink-2)">No comments yet.</div>`}
      <div style="display:flex;gap:8px;margin-top:10px">
        <input id="tdNewCmt" placeholder="Comment..." style="flex:1;padding:8px 10px;border:1.5px solid var(--line);border-radius:7px" />
        <button class="btn sm" id="tdCmtGo">Post</button>
      </div>
    </div>
    <div class="modal-actions">
      ${mine ? `<button class="btn ghost" id="tdDel" style="color:var(--red)">Delete</button>
        <button class="btn ghost" id="tdPlanBtn">📅 Create plan</button>
        <button class="btn ghost" id="tdEditBtn">Edit</button>
        <button class="btn ${td.done ? "ghost" : "navy"}" id="tdToggle">${td.done ? "Reopen" : "✔ Mark done"}</button>` : ""}
      <button class="btn ${mine ? "ghost" : ""}" onclick="closeModal()">Close</button>
    </div>`);
  document.querySelectorAll("[data-tdack]").forEach((b) => (b.onclick = async () => {
    await sb.from("todo_comments").update({ acked_by: ME.id, acked_at: new Date().toISOString() }).eq("id", b.dataset.tdack);
    todoDetail(todoId);
  }));
  $("#tdCmtGo").onclick = async () => {
    const body = $("#tdNewCmt").value.trim();
    if (!body) return;
    const needsAck = !mine && (ME.role !== "member" || ME.is_admin);
    const { error } = await sb.from("todo_comments").insert({ todo_id: todoId, author_id: ME.id, body, needs_ack: needsAck });
    if (error) return alert("Failed: " + error.message);
    td.last_fup = new Date().toISOString();
    todoDetail(todoId);
  };
  if ($("#tdToggle")) $("#tdToggle").onclick = async () => {
    await sb.from("todos").update({ done: !td.done, done_at: !td.done ? new Date().toISOString() : null }).eq("id", todoId);
    closeModal(); renderBoard();
  };
  if ($("#tdEditBtn")) $("#tdEditBtn").onclick = () => todoModal(td);
  if ($("#tdDel")) $("#tdDel").onclick = async () => {
    if (!confirm("Delete this to-do?")) return;
    await sb.from("todos").delete().eq("id", todoId);
    closeModal(); renderBoard();
  };
  if ($("#tdPlanBtn")) $("#tdPlanBtn").onclick = () => {
    closeModal(); switchView("plan");
    setTimeout(() => planModal(null, null, null, { todo: td }), 300);
  };
}

/* =========================================================
   IDLE LOCK: 4h of inactivity → soft lock (password re-entry).
   Session lives in sessionStorage → closing the browser/tab = signed out.
   ========================================================= */
const IDLE_LIMIT_MS = 4 * 60 * 60 * 1000; // 4 hours, fixed
let lastActivity = Date.now();
let lockShown = false;
let idleTimer = null;

function noteActivity() {
  if (lockShown) return;
  const now = Date.now();
  if (now - lastActivity > 5000) sessionStorage.setItem("hmsa_last_act", String(now));
  lastActivity = now;
}

function startIdleWatch() {
  const stored = Number(sessionStorage.getItem("hmsa_last_act") || 0);
  if (stored) lastActivity = stored;
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((ev) =>
    document.addEventListener(ev, noteActivity, { passive: true }));
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (ME && !lockShown && Date.now() - lastActivity > IDLE_LIMIT_MS) showLock();
  }, 30000);
  if (ME && Date.now() - lastActivity > IDLE_LIMIT_MS) showLock();
}

function showLock() {
  if (lockShown) return;
  lockShown = true;
  const ov = document.createElement("div");
  ov.id = "lockOverlay";
  ov.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(160deg,#0a2a43 0%,#0e3a5e 55%,#0a4b3a 100%)";
  ov.innerHTML = `
    <div class="auth-card" style="max-width:380px">
      <div style="font-size:34px;margin-bottom:8px">🔒</div>
      <div style="font-weight:800;font-size:17px;margin-bottom:4px">Session locked</div>
      <div style="font-size:13px;color:var(--ink-2);margin-bottom:18px">Locked after 4 hours of inactivity.<br/>Signed in as <b>${esc(ME.name)}</b> — enter your password to continue. Your unsaved work is preserved.</div>
      <div id="lockMsg" class="msg"></div>
      <div class="field"><label>Password</label><input id="lockPw" type="password" autocomplete="current-password" /></div>
      <button class="btn block" id="lockGo">Unlock</button>
      <div class="auth-alt"><a id="lockSwitch">Sign in as a different user</a></div>
    </div>`;
  document.body.appendChild(ov);
  const doUnlock = async () => {
    const pw = document.getElementById("lockPw").value;
    if (!pw) return;
    const { error } = await sb.auth.signInWithPassword({ email: idEmail(ME.login_id), password: pw });
    if (error) {
      const m = document.getElementById("lockMsg");
      m.className = "msg err"; m.textContent = "Wrong password. Try again.";
      return;
    }
    lastActivity = Date.now();
    sessionStorage.setItem("hmsa_last_act", String(lastActivity));
    lockShown = false;
    ov.remove();
  };
  document.getElementById("lockGo").onclick = doUnlock;
  document.getElementById("lockPw").addEventListener("keydown", (e) => { if (e.key === "Enter") doUnlock(); });
  document.getElementById("lockPw").focus();
  document.getElementById("lockSwitch").onclick = async () => { await sb.auth.signOut(); location.reload(); };
}

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

async function doLogin() {
  clearAuthMsg();
  const id = $("#liId").value.trim(), pw = $("#liPw").value;
  if (!id || !pw) return authMsg("Enter your login ID and password.");
  const { error } = await sb.auth.signInWithPassword({ email: idEmail(id), password: pw });
  if (error) return authMsg("Sign-in failed: check your login ID or password.");
  await afterLogin();
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
  const { data: all } = await sb.from("staff").select("id,name,part,role,status,is_admin,color").order("part").order("name");
  STAFF = all || [];
  const { data: tagRows } = await sb.from("tag_defs").select("*").order("name");
  TAGS = tagRows || [];
  const { data: partRowsG } = await sb.from("parts").select("*").order("name");
  PARTS = partRowsG || [];
  const [{ data: coRows }, { data: ctRows }] = await Promise.all([
    sb.from("companies").select("*").order("name"),
    sb.from("contracts").select("*").order("name"),
  ]);
  COMPANIES = coRows || []; CONTRACTS = ctRows || [];

  $("#auth").style.display = "none"; $("#app").style.display = "block";
  $("#meName").textContent = ME.name; $("#mePart").textContent = ME.part;
  $("#meRole").textContent = ROLE_LABEL[ME.role] + (ME.is_admin ? " · Admin" : "");
  if (ME.role === "leader" || ME.role === "teamlead" || ME.role === "director") $("#navReview").style.display = "flex";
  if (ME.is_admin) $("#navAdmin").style.display = "flex";
  noteActivity();
  startIdleWatch();
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
  ({ dashboard: renderDashboard, activities: renderActivities, plan: renderPlan, board: renderBoard, reports: renderReports, review: renderReview, admin: renderAdmin }[v] || renderDashboard)();
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
    <div class="page-sub">Company/part totals: approved activities · Individual counts: activities where your own report is approved · ${esc(CONFIG.COMPANY_NAME)}</div>
    ${periodBarHTML()}<div id="dashBody" class="empty">Loading...</div>`;
  bindPeriodBar(renderDashboard);

  const r = getRange();
  const hk = halfKey(), hr = halfRange(hk);
  const yr = new Date().getFullYear();
  const yFrom = `${yr}-01-01`, yTo = `${yr}-12-31`;
  const wkStart = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); })();
  const wkEnd = (() => { const d = new Date(wkStart); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })();
  const [compQ, partQ, indivQ, targetQ, halfPartQ, scoreQ, pScoreQ, sTgtQ, wkPlanQ, myTaskQ, myTodoQ] = await Promise.all([
    sb.rpc("company_stats", { p_from: r.from, p_to: r.to }),
    sb.rpc("part_stats", { p_from: r.from, p_to: r.to }),
    sb.rpc("activity_stats", { p_from: r.from, p_to: r.to }),
    sb.from("targets").select("*").eq("half", hk),
    sb.rpc("part_stats", { p_from: hr.from, p_to: hr.to }),
    sb.rpc("score_stats", { p_from: yFrom, p_to: yTo }),
    sb.rpc("part_scores", { p_from: yFrom, p_to: yTo }),
    sb.from("score_targets").select("*").eq("year", yr),
    sb.from("plans").select("*, plan_participants(staff_id)").eq("status", "confirmed").gte("plan_date", wkStart).lte("plan_date", wkEnd).order("plan_date").order("plan_time"),
    sb.from("tasks").select("*, task_assignees(staff_id)").eq("status", "progress").order("due_date", { ascending: true, nullsFirst: false }),
    sb.from("todos").select("*, todo_tags(staff_id)").eq("done", false).order("due_date", { ascending: true, nullsFirst: false }),
  ]);
  if (!$("#dashBody")) return; // view switched while loading
  if (compQ.error) { $("#dashBody").innerHTML = `<div class="empty">Failed to load data.</div>`; return; }
  const comp = compQ.data || [], partRows = partQ.data || [], indiv = indivQ.data || [];
  const targets = targetQ.data || [], halfPart = halfPartQ.data || [];
  const scores = scoreQ.data || [], pScores = pScoreQ.data || [], sTgts = sTgtQ.data || [];
  const myWkPlans = (wkPlanQ.data || []).filter((p) => (p.plan_participants || []).some((x) => x.staff_id === ME.id) || p.created_by === ME.id);
  const myTasks = (myTaskQ.data || []).filter((t) => (t.task_assignees || []).some((a) => a.staff_id === ME.id))
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 4);
  const myTodos = (myTodoQ.data || []).filter((td) => td.staff_id === ME.id || (td.todo_tags || []).some((t) => t.staff_id === ME.id)).slice(0, 5);
  const types = ["meeting", "vc", "trip", "other"];

  // ----- company KPI -----
  const cTot = {}; let cTripDays = 0;
  types.forEach((t) => (cTot[t] = 0));
  comp.forEach((row) => { cTot[row.a_type] = Number(row.cnt); if (row.a_type === "trip") cTripDays = Number(row.trip_days); });
  const grand = types.reduce((a, t) => a + cTot[t], 0);

  // ----- part table -----
  const byPart = {};
  partRows.forEach((row) => {
    if (!byPart[row.part]) byPart[row.part] = { meeting: 0, vc: 0, trip: 0, other: 0, trip_days: 0 };
    byPart[row.part][row.a_type] = Number(row.cnt);
    if (row.a_type === "trip") byPart[row.part].trip_days = Number(row.trip_days);
  });
  // half-to-date actuals for target gauges
  const halfActual = {};
  halfPart.forEach((row) => { halfActual[`${row.part}|${row.a_type}`] = Number(row.cnt); });
  const tgt = {};
  targets.forEach((t) => { tgt[`${t.part}|${t.a_type}`] = t.target; });
  const gauge = (part, type) => {
    const target = tgt[`${part}|${type}`];
    if (!target) return "";
    const actual = halfActual[`${part}|${type}`] || 0;
    const pct = Math.min(100, Math.round((actual / target) * 100));
    const col = pct >= 100 ? "var(--green)" : pct >= 60 ? "var(--blue)" : "var(--amber)";
    return `<div style="margin-top:3px"><div style="font-size:10.5px;color:var(--ink-2)">${actual}/${target} (${hk})</div>
      <div style="height:4px;background:#e8edf2;border-radius:2px"><div style="height:4px;width:${pct}%;background:${col};border-radius:2px"></div></div></div>`;
  };

  // ----- individual (may be empty when hidden for members) -----
  const byStaff = {};
  indiv.forEach((row) => {
    if (!byStaff[row.staff_id]) byStaff[row.staff_id] = { name: row.name, part: row.part, role: row.role, c: {}, trip_days: 0, total: 0 };
    byStaff[row.staff_id].c[row.a_type] = Number(row.cnt);
    byStaff[row.staff_id].total += Number(row.cnt);
    if (row.a_type === "trip") byStaff[row.staff_id].trip_days = Number(row.trip_days);
  });
  const people = Object.entries(byStaff).map(([id, v]) => ({ id: Number(id), ...v })).sort((a, b) => b.total - a.total);
  const showIndiv = people.length > 0;

  // ----- review widget data -----
  let reviewHTML = "";
  if (isManager()) {
    const { data: subs } = await sb.from("reports").select("id,title,part,updated_at,author_id").eq("status", "submitted").order("updated_at");
    const list = subs || [];
    const oldest = list.length ? Math.floor((Date.now() - new Date(list[0].updated_at)) / 86400000) : 0;
    reviewHTML = `
      <div style="font-size:26px;font-weight:800">${list.length} <span style="font-size:12.5px;font-weight:600;color:var(--ink-2)">awaiting review${list.length && oldest >= 3 ? ` · oldest ${oldest}d ⚠️` : list.length ? ` · oldest ${oldest}d` : ""}</span></div>
      ${list.slice(0, 3).map((x) => `<div class="rev-item" data-rev="${x.id}" style="cursor:pointer;font-size:12.5px;padding:5px 0;border-bottom:1px dashed var(--line)">
        📄 ${esc(x.title)} ${partBadge(x.part)} <span style="color:var(--ink-2)">${esc(staffName(x.author_id))}</span></div>`).join("")}
      ${list.length > 3 ? `<div style="font-size:11.5px;color:var(--ink-2);margin-top:4px">+${list.length - 3} more in Review Inbox</div>` : ""}`;
  } else {
    const { data: mine } = await sb.from("reports").select("status").eq("author_id", ME.id);
    const cnt = { draft: 0, submitted: 0, returned: 0, approved: 0 };
    (mine || []).forEach((x) => cnt[x.status]++);
    reviewHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap">
      ${Object.entries(cnt).map(([k, v]) => `<span class="badge ${k}">${ST_LABEL[k]}: ${v}</span>`).join("")}
    </div>${cnt.returned ? `<div style="font-size:12px;color:var(--red);margin-top:8px">↩️ You have ${cnt.returned} returned report(s) to fix.</div>` : ""}`;
  }

  if (!$("#dashBody")) return; // view switched while loading
  $("#dashBody").innerHTML = `
    <div class="grid kpi">
      <div class="card kpi-card"><div class="kpi-label">Total activities (company)</div><div class="kpi-num">${grand}</div><div class="kpi-sub">items</div></div>
      ${types.map((tp) => `
        <div class="card kpi-card"><div class="kpi-label"><span class="kpi-dot" style="background:${TYPE_COLOR[tp]}"></span>${TYPE_LABEL[tp]}</div>
        <div class="kpi-num">${cTot[tp]}${tp === "trip" && cTripDays ? `<span style="font-size:14px;font-weight:600;color:var(--ink-2)"> / ${cTripDays}d</span>` : ""}</div>
        <div class="kpi-sub">${tp === "trip" ? "trips / days" : "items"}</div></div>`).join("")}
    </div>
    <div class="two-col">
      <div>
        ${showIndiv ? `
        <div class="card" style="margin-bottom:16px"><h2 style="font-size:15px;margin-bottom:12px">Activities by employee</h2>
          <div class="chart-box" style="height:${Math.max(220, people.length * 34)}px"><canvas id="chStaff"></canvas></div></div>`
        : `<div class="card" style="margin-bottom:16px"><h2 style="font-size:15px;margin-bottom:6px">Activities by employee</h2>
          <div class="empty" style="padding:20px 10px">Individual stats are visible to part leaders and the director.<br/>Part-level results are shown on the right. 👉</div></div>`}
        <div class="card"><h2 style="font-size:15px;margin-bottom:12px">Activity type mix (company)</h2>
          <div class="chart-box" style="height:200px"><canvas id="chType"></canvas></div></div>
      </div>
      <div>
        <div class="card" style="margin-bottom:16px">
          <h2 style="font-size:15px;margin-bottom:8px">✅ My to-dos</h2>
          ${myTodos.length ? myTodos.map((td) => {
            const over = td.due_date && td.due_date < new Date().toISOString().slice(0, 10);
            return `<div data-gotask style="cursor:pointer;font-size:12.5px;padding:5px 0;border-bottom:1px dashed var(--line);display:flex;justify-content:space-between;gap:8px">
              <span>○ ${esc(td.title)}</span>
              ${td.due_date ? `<span class="due-chip ${over ? "over" : ""}" style="white-space:nowrap">DUE ${fmtD(td.due_date).slice(5)}${over ? " ⚠" : ""}</span>` : ""}</div>`;
          }).join("") : `<div style="font-size:12.5px;color:var(--ink-2)">No open to-dos.</div>`}
          ${myTasks.length ? `<div style="font-size:11px;font-weight:800;color:var(--ink-2);margin-top:10px;letter-spacing:.4px">📌 ASSIGNED TASKS</div>
          ${myTasks.map((t) => {
            const over = t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
            return `<div data-gotask style="cursor:pointer;font-size:12.5px;padding:5px 0;border-bottom:1px dashed var(--line);display:flex;justify-content:space-between;gap:8px">
              <span>${t.amount !== null && t.amount !== undefined ? `<span class="imp mid" style="background:#e8f5ee;color:var(--green-dark)">$${Number(t.amount)}K</span> ` : ""}${esc(t.title)}</span>
              ${t.due_date ? `<span class="due-chip ${over ? "over" : ""}" style="white-space:nowrap">DUE ${fmtD(t.due_date).slice(5)}${over ? " ⚠" : ""}</span>` : ""}</div>`;
          }).join("")}` : ""}
        </div>
        <div class="card" style="margin-bottom:16px">
          <h2 style="font-size:15px;margin-bottom:8px">📅 My plans this week</h2>
          ${myWkPlans.length ? myWkPlans.map((p) => `<div data-goplan style="cursor:pointer;font-size:12.5px;padding:5px 0;border-bottom:1px dashed var(--line)">
            <b>${fmtD(p.plan_date).slice(5)}</b>${p.plan_time ? " " + fmtT(p.plan_time) : ""} · ${esc(p.title)} ${partBadge(p.part)}</div>`).join("")
          : `<div style="font-size:12.5px;color:var(--ink-2)">No confirmed plans this week.</div>`}
        </div>
        <div class="card" style="margin-bottom:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h2 style="font-size:15px">🏆 Scores ${yr}</h2>
            ${isManager() ? `<button class="btn ghost sm" id="btnScoreTgt">🎯 Score targets</button>` : ""}
          </div>
          ${(() => {
            const myScore = Number(scores.find((x) => x.staff_id === ME.id)?.score || 0);
            const indivTgt = sTgts.find((t) => !t.part)?.target;
            const myPct = indivTgt ? Math.min(100, Math.round((myScore / indivTgt) * 100)) : 0;
            const partRows2 = pScores.map((ps) => {
              const tgt = sTgts.find((t) => t.part === ps.part)?.target;
              const pct = tgt ? Math.min(100, Math.round((Number(ps.score) / tgt) * 100)) : null;
              return `<tr><td>${partBadge(ps.part)}</td><td><b>${Number(ps.score)}</b>${tgt ? ` / ${tgt}` : ""}</td>
                <td style="width:40%">${tgt ? `<div style="height:5px;background:#e8edf2;border-radius:3px"><div style="height:5px;width:${pct}%;background:${pct >= 100 ? "var(--green)" : pct >= 60 ? "var(--blue)" : "var(--amber)"};border-radius:3px"></div></div>` : `<span style="font-size:11px;color:var(--ink-2)">no target</span>`}</td></tr>`;
            }).join("");
            return `
            <div style="display:flex;align-items:baseline;gap:8px">
              <span style="font-size:26px;font-weight:800">${myScore}</span>
              <span style="font-size:12.5px;color:var(--ink-2)">my score${indivTgt ? ` / target ${indivTgt}` : ""}</span>
            </div>
            ${indivTgt ? `<div style="height:6px;background:#e8edf2;border-radius:3px;margin:6px 0 10px"><div style="height:6px;width:${myPct}%;background:${myPct >= 100 ? "var(--green)" : myPct >= 60 ? "var(--blue)" : "var(--amber)"};border-radius:3px"></div></div>` : `<div style="margin-bottom:8px"></div>`}
            <table><tbody>${partRows2 || `<tr><td class="empty">No data</td></tr>`}</tbody></table>
            <div style="font-size:10.5px;color:var(--ink-2);margin-top:6px">Planned: meeting 2 · VC 1 · trip 3 · other 1 — unplanned ×2. Counted when your report is approved.</div>`;
          })()}
        </div>
        <div class="card" style="margin-bottom:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <h2 style="font-size:15px">Part summary</h2>
            ${isManager() ? `<button class="btn ghost sm" id="btnTargets">🎯 Set targets</button>` : ""}
          </div>
          <table><thead><tr><th>Part</th><th>Meeting</th><th>VC</th><th>Trip</th><th>Other</th></tr></thead><tbody>
          ${Object.entries(byPart).map(([p, v]) => `<tr>
            <td>${partBadge(p)}</td>
            <td>${v.meeting}${gauge(p, "meeting")}</td>
            <td>${v.vc}${gauge(p, "vc")}</td>
            <td>${v.trip}${v.trip_days ? ` <span style="font-size:11px;color:var(--ink-2)">/ ${v.trip_days}d</span>` : ""}${gauge(p, "trip")}</td>
            <td>${v.other}${gauge(p, "other")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No data</td></tr>`}
          </tbody></table>
        </div>
        <div class="card"><h2 style="font-size:15px;margin-bottom:10px">${isExec() || ME.is_admin ? "Approvals overview" : isManager() ? "Review status" : "My reports"}</h2>${reviewHTML}</div>
      </div>
    </div>
    ${showIndiv ? `
    <div class="section-head"><h2>Employee detail</h2></div>
    <div class="card" style="padding:8px 14px">
      <table><thead><tr><th>Name</th><th>Part</th><th>Meeting</th><th>VC</th><th>Trip (count / days)</th><th>Other</th><th>Total</th></tr></thead><tbody>
      ${people.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.role !== "member" ? ` <span style="font-size:11px;color:var(--ink-2)">${ROLE_LABEL[p.role]}</span>` : ""}</td>
        <td>${partBadge(p.part)}</td>
        <td>${p.c.meeting || 0}</td><td>${p.c.vc || 0}</td>
        <td>${p.c.trip || 0}${p.trip_days ? ` <span style="color:var(--ink-2);font-size:11.5px">/ ${p.trip_days}d</span>` : ""}</td>
        <td>${p.c.other || 0}</td>
        <td><b>${p.total}</b></td></tr>`).join("")}
      </tbody></table>
    </div>` : ""}`;

  document.querySelectorAll("[data-rev]").forEach((el) => (el.onclick = () => openReport(Number(el.dataset.rev))));
  document.querySelectorAll("[data-goplan]").forEach((el) => (el.onclick = () => switchView("plan")));
  document.querySelectorAll("[data-gotask]").forEach((el) => (el.onclick = () => switchView("board")));
  if ($("#btnTargets")) $("#btnTargets").onclick = () => targetsModal();
  if ($("#btnScoreTgt")) $("#btnScoreTgt").onclick = () => scoreTargetsModal();

  if (showIndiv) {
    charts.push(new Chart($("#chStaff"), {
      type: "bar",
      data: { labels: people.map((p) => p.name),
        datasets: types.map((tp) => ({ label: TYPE_LABEL[tp], data: people.map((p) => p.c[tp] || 0), backgroundColor: TYPE_COLOR[tp], stack: "s" })) },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false,
        scales: { x: { stacked: true, ticks: { precision: 0 } }, y: { stacked: true } },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } } },
    }));
  }
  charts.push(new Chart($("#chType"), {
    type: "doughnut",
    data: { labels: types.map((tp) => TYPE_LABEL[tp]), datasets: [{ data: types.map((tp) => cTot[tp]), backgroundColor: types.map((tp) => TYPE_COLOR[tp]) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } } } },
  }));
}

async function scoreTargetsModal() {
  const yr = new Date().getFullYear();
  const parts = PARTS.length ? PARTS.map((p) => p.name) : [...new Set(STAFF.map((x) => x.part))];
  const canIndiv = isExec() || ME.is_admin;
  const myParts = ME.role === "leader" && !canIndiv ? [ME.part] : parts;
  const { data: rows } = await sb.from("score_targets").select("*").eq("year", yr);
  const cur = rows || [];
  openModal(`
    <h3>🎯 Score targets — ${yr}</h3>
    <p style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">Individual target applies equally to every employee. Part targets are team totals for the year.</p>
    <div class="field"><label>Individual target (everyone)</label>
      <input type="number" min="0" id="stIndiv" placeholder="e.g. 100" value="${cur.find((t) => !t.part)?.target ?? ""}" ${canIndiv ? "" : "disabled"} />
      ${canIndiv ? "" : `<div style="font-size:11px;color:var(--ink-2);margin-top:2px">Set by Team Lead / Director.</div>`}</div>
    ${myParts.map((p) => `<div class="field"><label>${esc(p)} team target</label>
      <input type="number" min="0" data-stpart="${esc(p)}" placeholder="e.g. 500" value="${cur.find((t) => t.part === p)?.target ?? ""}" /></div>`).join("")}
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="stSave">Save</button>
    </div>`);
  $("#stSave").onclick = async () => {
    const jobs = [];
    if (canIndiv) {
      const v = $("#stIndiv").value;
      if (v === "" || Number(v) === 0) jobs.push(sb.from("score_targets").delete().eq("year", yr).is("part", null));
      else jobs.push(sb.from("score_targets").upsert({ year: yr, part: null, target: Number(v) }, { onConflict: "year,part" }));
    }
    document.querySelectorAll("[data-stpart]").forEach((inp) => {
      const p = inp.dataset.stpart, v = inp.value;
      if (v === "" || Number(v) === 0) jobs.push(sb.from("score_targets").delete().eq("year", yr).eq("part", p));
      else jobs.push(sb.from("score_targets").upsert({ year: yr, part: p, target: Number(v) }, { onConflict: "year,part" }));
    });
    const res = await Promise.all(jobs);
    const bad = res.find((x) => x.error);
    if (bad) return alert("Save failed: " + bad.error.message);
    closeModal(); renderDashboard();
  };
}

async function targetsModal() {
  const parts = PARTS.length ? PARTS.map((p) => p.name) : [...new Set(STAFF.map((x) => x.part))];
  const myParts = ME.role === "leader" && !ME.is_admin ? [ME.part] : parts;
  const y = new Date().getFullYear();
  const halves = [`${y}-H1`, `${y}-H2`, `${y + 1}-H1`];
  openModal(`
    <h3>🎯 Set half-year targets</h3>
    <div class="row2">
      <div class="field"><label>Part</label><select id="tgPart">${myParts.map((p) => `<option>${esc(p)}</option>`).join("")}</select></div>
      <div class="field"><label>Period</label><select id="tgHalf">${halves.map((h) => `<option ${h === halfKey() ? "selected" : ""}>${h}</option>`).join("")}</select></div>
    </div>
    <div class="row2">
      ${["meeting", "vc", "trip", "other"].map((t) => `<div class="field"><label>${TYPE_LABEL[t]} target</label><input type="number" min="0" id="tg_${t}" placeholder="none" /></div>`).join("")}
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="tgSave">Save targets</button>
    </div>`);
  const loadExisting = async () => {
    const { data } = await sb.from("targets").select("*").eq("part", $("#tgPart").value).eq("half", $("#tgHalf").value);
    ["meeting", "vc", "trip", "other"].forEach((t) => { $("#tg_" + t).value = (data || []).find((x) => x.a_type === t)?.target ?? ""; });
  };
  $("#tgPart").onchange = loadExisting; $("#tgHalf").onchange = loadExisting;
  await loadExisting();
  $("#tgSave").onclick = async () => {
    const part = $("#tgPart").value, half = $("#tgHalf").value;
    for (const t of ["meeting", "vc", "trip", "other"]) {
      const v = $("#tg_" + t).value;
      if (v === "" || Number(v) === 0) {
        await sb.from("targets").delete().eq("part", part).eq("half", half).eq("a_type", t);
      } else {
        const { error } = await sb.from("targets").upsert({ part, half, a_type: t, target: Number(v) }, { onConflict: "part,half,a_type" });
        if (error) return alert("Save failed: " + error.message);
      }
    }
    closeModal(); renderDashboard();
  };
}

/* =========================================================
   ACTIVITIES
   ========================================================= */
let actFilter = { status: "", type: "", part: "" };
let repFilter = { status: "", rtype: "", part: "" };

function filterRowHTML(view) {
  const parts = PARTS.map((p) => p.name);
  if (view === "act") return `
    <div class="filterbar">
      <select id="af_status" style="max-width:150px"><option value="">All status</option>
        ${Object.entries(ACT_ST).map(([k, v]) => `<option value="${k}" ${actFilter.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="af_type" style="max-width:150px"><option value="">All types</option>
        ${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${actFilter.type === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="af_part" style="max-width:130px"><option value="">All parts</option>
        ${parts.map((p) => `<option ${actFilter.part === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
    </div>`;
  return `
    <div class="filterbar">
      <select id="rf_status" style="max-width:150px"><option value="">All status</option>
        ${Object.entries(ST_LABEL).map(([k, v]) => `<option value="${k}" ${repFilter.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="rf_rtype" style="max-width:160px"><option value="">All types</option>
        ${Object.entries(RTYPE_LABEL).map(([k, v]) => `<option value="${k}" ${repFilter.rtype === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="rf_part" style="max-width:130px"><option value="">All parts</option>
        ${parts.map((p) => `<option ${repFilter.part === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
      <select id="rf_tag" style="max-width:140px"><option value="0">All tags</option>
        ${TAGS.map((t) => `<option value="${t.id}" ${repTagFilter == t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
    </div>`;
}

async function renderActivities() {
  const main = $("#main");
  main.innerHTML = `<div class="page-title">Activities</div>
    <div class="page-sub">Status board — activities are created from the Plan Calendar. Track reports (📝), edit, cancel. Scores count per person once their own report is approved.</div>
    ${periodBarHTML()}
    ${searchBarHTML("act")}
    ${filterRowHTML("act")}
    <div class="section-head"><h2>Activity list</h2><div style="display:flex;gap:8px">
      ${isManager() ? `<button class="btn ghost" id="btnCompanies">🏢 Companies</button>` : ""}
      <button class="btn" id="btnGoPlan">📅 New? → Plan Calendar</button></div></div>
    <div class="card" style="padding:8px 14px" id="actList"><div class="empty">Loading...</div></div>`;
  bindPeriodBar(renderActivities);
  bindSearchBar("act", renderActivities);
  $("#af_status").onchange = (e) => { actFilter.status = e.target.value; renderActivities(); };
  $("#af_type").onchange = (e) => { actFilter.type = e.target.value; renderActivities(); };
  $("#af_part").onchange = (e) => { actFilter.part = e.target.value; renderActivities(); };
  $("#btnGoPlan").onclick = () => switchView("plan");
  if ($("#btnCompanies")) $("#btnCompanies").onclick = companiesModal;

  const r = getRange();
  const { data: actsRaw } = await sb.from("activities")
    .select("*, activity_participants(staff_id,p_role), activity_companies(company_id), activity_contracts(contract_id)")
    .gte("activity_date", r.from).lte("activity_date", r.to)
    .order("activity_date", { ascending: false });
  let acts = actsRaw || [];

  const ids = acts.map((a) => a.id);
  let linked = [];
  if (ids.length) {
    const { data: lr } = await sb.from("reports").select("id,activity_id,author_id,status").in("activity_id", ids);
    linked = lr || [];
  }
  window.__actLinked = linked; window.__acts = acts;

  acts = acts.filter((a) => {
    if (actFilter.status && a.status !== actFilter.status) return false;
    if (actFilter.type && a.type !== actFilter.type) return false;
    if (actFilter.part && a.part !== actFilter.part) return false;
    if (coFilter.act && !(a.activity_companies || []).some((c) => c.company_id === coFilter.act)) return false;
    const coNames = (a.activity_companies || []).map((c) => companyName(c.company_id)).join(" ");
    return matchesSearch(searchQ.act, a.title, a.customer, a.notes, staffName(a.created_by), coNames);
  });

  if (!$("#actList")) return;
  const rows = acts.map((a) => {
    const partIds = (a.activity_participants || []).map((p) => p.staff_id);
    const partNames = (a.activity_participants || []).filter((p) => p.p_role === "participant").map((p) => staffName(p.staff_id));
    const mine = a.created_by === ME.id;
    const iAmIn = partIds.includes(ME.id);
    const reviewer = canReviewActivity(a);
    const reps = linked.filter((x) => x.activity_id === a.id);
    const done = reps.filter((x) => x.status === "approved").length;
    const subm = reps.filter((x) => x.status === "submitted").length;
    const days = a.type === "trip" ? Math.round((new Date(a.end_date || a.activity_date) - new Date(a.activity_date)) / 86400000) + 1 : 1;
    const dateTxt = a.type === "trip" && a.end_date && a.end_date !== a.activity_date
      ? `${fmtD(a.activity_date)}<div style="font-size:11.5px;color:var(--ink-2);white-space:nowrap">~ ${fmtD(a.end_date)} <b>(${days}d)</b></div>`
      : fmtD(a.activity_date);
    return `<tr style="${a.status === "canceled" ? "opacity:.55" : ""}">
      <td style="white-space:nowrap">${dateTxt}</td>
      <td><span class="badge ${a.type}">${TYPE_LABEL[a.type]}</span>${a.planned === false ? `<div style="margin-top:2px"><span class="badge pending" title="Self-made activity — double score">⚡ ×2</span></div>` : ""}</td>
      <td style="vertical-align:top">
        ${(a.activity_companies || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:3px">${(a.activity_companies || []).map((c) => `<span class="badge meeting">${esc(companyName(c.company_id))}</span>`).join("")}</div>` : `<span style="color:var(--ink-2)">-</span>`}
      </td>
      <td style="vertical-align:top">${a.customer && a.customer !== "Other" ? esc(a.customer) : `<span style="color:var(--ink-2)">-</span>`}</td>
      <td>${esc(a.title)}
        ${(a.activity_contracts || []).length ? `<div style="margin-top:2px">${(a.activity_contracts || []).map((c) => `<span class="badge other">${esc(contractName(c.contract_id))}</span>`).join(" ")}</div>` : ""}
        ${a.notes ? `<div style="font-size:12px;color:var(--ink-2)">${esc(a.notes)}</div>` : ""}
        ${a.status === "canceled" && a.cancel_reason ? `<div style="font-size:12px;color:var(--red);cursor:pointer" data-cxview="${a.id}" title="Click to read the full cancel remark">✖ ${esc(a.cancel_reason.length > 28 ? a.cancel_reason.slice(0, 28) + "…" : a.cancel_reason)} ${a.cancel_reason.length > 28 ? "<u>more</u>" : ""}</div>` : ""}</td>
      <td>${esc(staffName(a.created_by))}</td>
      <td style="font-size:12.5px">${partNames.map(esc).join(", ") || "-"}</td>
      <td><button class="btn ghost sm" data-repstat="${a.id}" style="white-space:nowrap">📝 ${done + subm}/${partIds.length}</button></td>
      <td>${partBadge(a.part)}</td>
      <td style="vertical-align:top"><div style="display:flex;flex-wrap:wrap;gap:4px;max-width:150px;justify-content:flex-end">
        ${iAmIn && a.status !== "canceled" ? `<button class="btn ghost sm" data-myrep="${a.id}">My report</button>` : ""}
        ${(mine || reviewer) && a.status !== "canceled" ? `<button class="btn ghost sm" data-edit="${a.id}">Edit</button><button class="btn ghost sm" data-cancel="${a.id}" style="color:var(--amber)">Cancel</button>` : ""}
        ${reviewer ? `<button class="btn ghost sm" data-del="${a.id}" style="color:var(--red)">Delete</button>` : ""}
        ${mine && a.status === "canceled" ? `<button class="btn ghost sm" data-resched="${a.id}">Reschedule</button>` : ""}
      </div></td>
    </tr>`;
  }).join("");
  $("#actList").innerHTML = rows
    ? `<table><thead><tr><th>Date</th><th>Type</th><th>Company</th><th>Customer PIC</th><th>Topic</th><th>Host</th><th>Participants</th><th>Reports</th><th>Part</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">No activities match. New activities are created by confirming plans in the 📅 Plan Calendar.</div>`;

  document.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => activityModal(window.__acts.find((a) => a.id == b.dataset.edit))));
  document.querySelectorAll("[data-resched]").forEach((b) => (b.onclick = () => {
    const src = window.__acts.find((a) => a.id == b.dataset.resched);
    switchView("plan");
    setTimeout(() => planModal(null, null, src), 300); // prefill new plan from canceled activity
  }));
  document.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Delete this activity? (Use Cancel instead if it was called off — that keeps the record.)")) return;
    await sb.from("activities").delete().eq("id", b.dataset.del);
    renderActivities();
  }));
  document.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => cancelActivityModal(Number(b.dataset.cancel))));
  document.querySelectorAll("[data-cxview]").forEach((el) => (el.onclick = () => {
    const a = window.__acts.find((x) => x.id == el.dataset.cxview);
    openModal(`
      <h3>✖ Canceled — ${esc(a.title)}</h3>
      <div style="font-size:12.5px;color:var(--ink-2);margin-bottom:10px">${fmtD(a.activity_date)} · ${esc(staffName(a.created_by))}</div>
      <div class="field"><label>Cancel remark</label>
        <div style="white-space:pre-wrap;background:#fff5f5;border:1.5px solid #f3c9c9;border-radius:8px;padding:12px;font-size:13.5px;line-height:1.6">${esc(a.cancel_reason || "")}</div></div>
      <div class="modal-actions">
        ${a.created_by === ME.id ? `<button class="btn ghost" id="cxResched">Reschedule this</button>` : ""}
        <button class="btn" onclick="closeModal()">Close</button></div>`);
    if ($("#cxResched")) $("#cxResched").onclick = () => {
      closeModal(); switchView("plan");
      setTimeout(() => planModal(null, null, a), 300);
    };
  }));
  document.querySelectorAll("[data-repstat]").forEach((b) => (b.onclick = () => reportStatusModal(Number(b.dataset.repstat))));
  document.querySelectorAll("[data-myrep]").forEach((b) => (b.onclick = () => openMyReportFor(Number(b.dataset.myrep))));
}

function cancelActivityModal(actId) {
  openModal(`
    <h3>Cancel activity</h3>
    <p style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">Canceling keeps the record (excluded from stats) so it can be rescheduled later. Deleting removes it entirely.</p>
    <div class="field"><label>Cancel reason (remark)</label><textarea id="cxReason" style="min-height:100px" placeholder="e.g. Customer postponed to August — reschedule needed."></textarea></div>
    <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Back</button><button class="btn danger" id="cxGo">Cancel activity</button></div>`);
  $("#cxGo").onclick = async () => {
    const reason = $("#cxReason").value.trim();
    if (!reason) return alert("Enter a cancel reason.");
    const { error } = await sb.from("activities").update({ status: "canceled", cancel_reason: reason }).eq("id", actId);
    if (error) return alert("Cancel failed: " + error.message);
    closeModal(); renderActivities();
  };
}

function reportStatusModal(actId) {
  const a = window.__acts.find((x) => x.id === actId);
  const reps = (window.__actLinked || []).filter((x) => x.activity_id === actId);
  const partIds = (a.activity_participants || []).map((p) => p.staff_id);
  openModal(`
    <h3>📝 Report status — ${esc(a.title)}</h3>
    <p style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">Every participant writes their own report for this activity.</p>
    <table><thead><tr><th>Participant</th><th>Report</th><th></th></tr></thead><tbody>
    ${partIds.map((sid) => {
      const rep = reps.find((x) => x.author_id === sid);
      return `<tr>
        <td><b>${esc(staffName(sid))}</b>${sid === ME.id ? ' <span style="font-size:11px;color:var(--green-dark)">you</span>' : ""}</td>
        <td>${rep ? `<span class="badge ${rep.status}">${ST_LABEL[rep.status]}</span>` : `<span class="badge returned">Not written</span>`}</td>
        <td>${rep ? `<button class="btn ghost sm" data-openrep="${rep.id}">Open</button>` : sid === ME.id ? `<button class="btn sm" data-writerep="${actId}">Write mine</button>` : ""}</td>
      </tr>`;
    }).join("")}
    </tbody></table>
    <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
  document.querySelectorAll("[data-openrep]").forEach((b) => (b.onclick = () => { closeModal(); openReport(Number(b.dataset.openrep)); }));
  document.querySelectorAll("[data-writerep]").forEach((b) => (b.onclick = () => { closeModal(); openMyReportFor(Number(b.dataset.writerep)); }));
}

async function openMyReportFor(actId) {
  const { data: existing } = await sb.from("reports").select("id").eq("activity_id", actId).eq("author_id", ME.id).maybeSingle();
  if (existing) return openReport(existing.id);
  const a = window.__acts.find((x) => x.id === actId);
  reportModal(null, a); // prefilled from activity
}

function activityModal(edit = null) {
  const picked = new Set(edit ? (edit.activity_participants || []).filter((p) => p.p_role === "participant").map((p) => p.staff_id) : []);
  const pickedCos = new Set(edit ? (edit.activity_companies || []).map((c) => c.company_id) : []);
  const pickedCts = new Set(edit ? (edit.activity_contracts || []).map((c) => c.contract_id) : []);
  const options = STAFF.filter((s) => s.status === "active" && s.id !== ME.id);
  openModal(`
    <h3>Edit activity</h3>
    <div class="row2">
      <div class="field"><label>Type</label><select id="aType">
        ${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${edit?.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>Date${edit?.type === "trip" ? " (start)" : ""}</label><input type="date" id="aDate" value="${edit?.activity_date || new Date().toISOString().slice(0, 10)}" /></div>
    </div>
    <div class="field" id="aEndWrap" style="display:${edit?.type === "trip" ? "block" : "none"}">
      <label>Trip end date</label><input type="date" id="aEnd" value="${edit?.end_date || edit?.activity_date || new Date().toISOString().slice(0, 10)}" />
    </div>

    ${tagPanelHTML()}
    <div class="field"><label>Customer PIC (optional, free text)</label><input id="aCust" value="${esc(edit?.customer === "Other" ? "" : edit?.customer || "")}" placeholder="e.g. Capt. Kim, Mr. Zaidi — anything" /></div>
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
  bindTagPanel(pickedCos, pickedCts);
  $("#aPickP").onchange = (e) => { if (e.target.value) { picked.add(Number(e.target.value)); e.target.value = ""; drawChips(); } };
  $("#aType").onchange = () => { $("#aEndWrap").style.display = $("#aType").value === "trip" ? "block" : "none"; };

  $("#aSave").onclick = async () => {
    const isTrip = $("#aType").value === "trip";
    const rec = { type: $("#aType").value, activity_date: $("#aDate").value,
      end_date: isTrip ? ($("#aEnd").value || $("#aDate").value) : null,
      customer: $("#aCust").value.trim(), title: $("#aTitle").value.trim(),
      notes: $("#aNotes").value.trim() || null };
    if (!rec.title || !rec.activity_date) return alert("Topic and date are required.");
    if (isTrip && rec.end_date < rec.activity_date) return alert("Trip end date must be on or after the start date.");

    let actId;
    if (edit && edit.id) {
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
    await sb.from("activity_companies").delete().eq("activity_id", actId);
    await sb.from("activity_contracts").delete().eq("activity_id", actId);
    if (pickedCos.size) await sb.from("activity_companies").insert([...pickedCos].map((id) => ({ activity_id: actId, company_id: id })));
    if (pickedCts.size) await sb.from("activity_contracts").insert([...pickedCts].map((id) => ({ activity_id: actId, contract_id: id })));
    closeModal(); renderActivities();
  };
}

/* =========================================================
   MEETING REPORTS
   ========================================================= */
async function renderReports() {
  const main = $("#main");
  main.innerHTML = `<div class="page-title">Reports</div>
    <div class="page-sub">Counsel & internal reports. Submitting is one step — write and it goes straight to your part leader. Everyone can read final reports; edit history is visible to reviewers.</div>
    ${searchBarHTML("rep")}
    ${filterRowHTML("rep")}
    <div class="section-head"><h2>Report list</h2><div style="display:flex;gap:8px">
      ${isManager() ? `<button class="btn ghost" id="btnTags">🏷️ Tags</button><button class="btn ghost" id="btnCompanies2">🏢 Companies</button>` : ""}
      <button class="btn" id="btnNewRep">+ New report</button></div></div>
    <div class="card" style="padding:8px 14px" id="repList"><div class="empty">Loading...</div></div>`;
  bindSearchBar("rep", renderReports);
  $("#rf_status").onchange = (e) => { repFilter.status = e.target.value; renderReports(); };
  $("#rf_rtype").onchange = (e) => { repFilter.rtype = e.target.value; renderReports(); };
  $("#rf_part").onchange = (e) => { repFilter.part = e.target.value; renderReports(); };
  $("#rf_tag").onchange = (e) => { repTagFilter = Number(e.target.value); renderReports(); };
  $("#btnNewRep").onclick = () => reportModal();
  if ($("#btnCompanies2")) $("#btnCompanies2").onclick = companiesModal;
  if ($("#btnTags")) $("#btnTags").onclick = tagsModal;
  await drawReportList("#repList");
}

async function drawReportList(sel, onlySubmitted = false) {
  const key = onlySubmitted ? "rev" : "rep";
  let q = sb.from("reports").select("*, report_tags(tag_id), report_companies(company_id), report_contracts(contract_id)").order("updated_at", { ascending: false });
  if (onlySubmitted) q = q.eq("status", "submitted");
  const { data } = await q;
  let reps = data || [];
  if (!onlySubmitted && repTagFilter) reps = reps.filter((r) => (r.report_tags || []).some((t) => t.tag_id === repTagFilter));
  if (!onlySubmitted) {
    if (repFilter.status) reps = reps.filter((r) => r.status === repFilter.status);
    if (repFilter.rtype) reps = reps.filter((r) => r.report_type === repFilter.rtype);
    if (repFilter.part) reps = reps.filter((r) => r.part === repFilter.part);
  }
  if (coFilter[key]) reps = reps.filter((r) => (r.report_companies || []).some((c) => c.company_id === coFilter[key]));
  if (searchQ[key]) reps = reps.filter((r) => matchesSearch(searchQ[key], r.title, r.customer, r.content, r.followup, staffName(r.author_id),
    (r.report_companies || []).map((c) => companyName(c.company_id)).join(" ")));
  const tagName = (id) => TAGS.find((t) => t.id === id)?.name || "";
  const rows = reps.map((r) => `
    <tr class="clickable" data-open="${r.id}">
      <td style="white-space:nowrap">${fmtD(r.meeting_date)}</td>
      <td style="vertical-align:top"><div style="display:flex;flex-wrap:wrap;gap:3px">
        <span class="badge part">${RTYPE_LABEL[r.report_type] || "Customer Meeting"}</span>
        ${(r.report_companies || []).map((c) => `<span class="badge meeting">${esc(companyName(c.company_id))}</span>`).join("")}
        ${(r.report_contracts || []).map((c) => `<span class="badge vc">${esc(contractName(c.contract_id))}</span>`).join("")}
        ${(r.report_tags || []).map((t) => `<span class="badge other">${esc(tagName(t.tag_id))}</span>`).join("")}
      </div></td>
      <td style="vertical-align:top">${r.customer && r.customer !== "Other" ? `<b>${esc(r.customer)}</b>` : `<span style="color:var(--ink-2)">-</span>`}</td>
      <td>${esc(r.title)}</td>
      <td>${esc(staffName(r.author_id))} ${partBadge(r.part)}</td>
      <td>v${r.version}</td>
      <td><span class="badge ${r.status}">${ST_LABEL[r.status]}</span></td>
    </tr>`).join("");
  const listEl = $(sel);
  if (!listEl) return; // view switched while loading
  listEl.innerHTML = rows
    ? `<table><thead><tr><th>Date</th><th>Type / Tags</th><th>Counterpart</th><th>Title</th><th>Author</th><th>Ver.</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">${onlySubmitted ? "No reports awaiting review." : "No reports match. Write your first one!"}</div>`;
  document.querySelectorAll("[data-open]").forEach((tr) => (tr.onclick = () => openReport(Number(tr.dataset.open))));
}

async function tagsModal() {
  openModal(`
    <h3>🏷️ Manage tags</h3>
    <p style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">Leaders and the director create tags; everyone can attach them to reports (e.g. Weekly, Monthly, Annual).</p>
    <div class="chips" id="tagList" style="margin-bottom:14px"></div>
    <div class="field" style="display:flex;gap:8px">
      <input id="newTag" placeholder="New tag name" style="flex:1" />
      <button class="btn sm" id="addTag">Add</button>
    </div>
    <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
  const draw = () => {
    $("#tagList").innerHTML = TAGS.map((t) => `<span class="chip">${esc(t.name)}<button data-deltag="${t.id}">×</button></span>`).join("") || `<span style="font-size:12.5px;color:var(--ink-2)">No tags yet</span>`;
    document.querySelectorAll("[data-deltag]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Delete this tag? It will be removed from all reports.")) return;
      await sb.from("tag_defs").delete().eq("id", b.dataset.deltag);
      TAGS = TAGS.filter((t) => t.id != b.dataset.deltag); draw();
    }));
  };
  draw();
  $("#addTag").onclick = async () => {
    const name = $("#newTag").value.trim();
    if (!name) return;
    const { data, error } = await sb.from("tag_defs").insert({ name, created_by: ME.id }).select("*").single();
    if (error) return alert("Add failed (duplicate name?): " + error.message);
    TAGS.push(data); TAGS.sort((a, b) => a.name.localeCompare(b.name));
    $("#newTag").value = ""; draw();
  };
}

function reportModal(edit = null, fromActivity = null) {
  const pickedTags = new Set(edit ? (edit.report_tags || []).map((t) => t.tag_id) : []);
  const pickedCos = new Set(edit ? (edit.report_companies || []).map((c) => c.company_id)
    : fromActivity ? (fromActivity.activity_companies || []).map((c) => c.company_id) : []);
  const pickedCts = new Set(edit ? (edit.report_contracts || []).map((c) => c.contract_id)
    : fromActivity ? (fromActivity.activity_contracts || []).map((c) => c.contract_id) : []);
  openModal(`
    <h3>${edit ? `Edit report (v${edit.version})` : fromActivity ? `Report for: ${esc(fromActivity.title)}` : "New report"}</h3>
    <div class="row2">
      <div class="field"><label>Report type</label><select id="rType">
        ${Object.entries(RTYPE_LABEL).map(([k, v]) => `<option value="${k}" ${edit?.report_type === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>Meeting date</label><input type="date" id="rDate" value="${edit?.meeting_date || fromActivity?.activity_date || new Date().toISOString().slice(0, 10)}" /></div>
    </div>
    ${TAGS.length ? `<div class="field"><label>Tags (optional, multiple)</label>
      <div class="chips">${TAGS.map((t) => `<span class="chip tagpick" data-tid="${t.id}" style="cursor:pointer;${pickedTags.has(t.id) ? "background:var(--navy);color:#fff" : ""}">${esc(t.name)}</span>`).join("")}</div>
    </div>` : ""}
    ${tagPanelHTML()}
    <div class="field"><label>Customer PIC (optional, free text)</label><input id="rCust" value="${esc(edit?.customer === "Other" ? "" : edit?.customer || fromActivity?.customer || "")}" placeholder="e.g. Capt. Kim — or team name for internal reports" /></div>
    <div class="field"><label>Title</label><input id="rTitle" value="${esc(edit?.title || fromActivity?.title || "")}" placeholder="e.g. Seaspan 14K ACONIS replacement discussion" /></div>
    <div class="field"><label>Discussion</label><textarea id="rContent" style="min-height:160px">${esc(edit?.content || "")}</textarea></div>
    <div class="field"><label>Follow-up (action items)</label><textarea id="rFollow">${esc(edit?.followup || "")}</textarea></div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="rSave">${edit ? (edit.status === "returned" ? "Save & resubmit" : "Save") : "Submit report"}</button>
    </div>`);
  bindTagPanel(pickedCos, pickedCts);
  document.querySelectorAll(".tagpick").forEach((c) => (c.onclick = () => {
    const id = Number(c.dataset.tid);
    if (pickedTags.has(id)) { pickedTags.delete(id); c.style.background = ""; c.style.color = ""; }
    else { pickedTags.add(id); c.style.background = "var(--navy)"; c.style.color = "#fff"; }
  }));
  $("#rSave").onclick = async () => {
    const rec = { customer: $("#rCust").value.trim(), meeting_date: $("#rDate").value,
      report_type: $("#rType").value,
      title: $("#rTitle").value.trim(), content: $("#rContent").value,
      followup: $("#rFollow").value, updated_at: new Date().toISOString() };
    if (!rec.title) return alert("Title is required.");
    let repId;
    if (edit) {
      // 반송 상태에서 저장하면 자동 재제출 (버전 +1)
      const resubmit = edit.status === "returned";
      const upd = resubmit ? { ...rec, status: "submitted", version: edit.version + 1 } : rec;
      const { error } = await sb.from("reports").update(upd).eq("id", edit.id);
      if (error) return alert("Save failed: " + error.message);
      repId = edit.id;
      await logEvent(repId, "edit", null, resubmit ? edit.version + 1 : edit.version, rec.content, rec.followup);
      if (resubmit) await logEvent(repId, "submit", null, edit.version + 1, rec.content, rec.followup);
    } else {
      // 등록 = 즉시 제출 (별도 Submit 단계 없음)
      const { data, error } = await sb.from("reports").insert({ ...rec, status: "submitted", author_id: ME.id, part: ME.part, activity_id: fromActivity?.id || null }).select("id").single();
      if (error) return alert("Save failed: " + error.message);
      repId = data.id;
      if (fromActivity?.plan_id) {
        const { data: pl } = await sb.from("plans").select("task_id,todo_id").eq("id", fromActivity.plan_id).maybeSingle();
        if (pl?.task_id) await sb.from("task_comments").insert({ task_id: pl.task_id, author_id: ME.id, body: `📝 Report submitted for "${fromActivity.title}"` });
        if (pl?.todo_id) await sb.from("todo_comments").insert({ todo_id: pl.todo_id, author_id: ME.id, body: `📝 Report submitted for "${fromActivity.title}"` });
      }
      await logEvent(repId, "create", null, 1, rec.content, rec.followup);
      await logEvent(repId, "submit", null, 1, rec.content, rec.followup);
    }
    await sb.from("report_tags").delete().eq("report_id", repId);
    if (pickedTags.size) await sb.from("report_tags").insert([...pickedTags].map((tid) => ({ report_id: repId, tag_id: tid })));
    await sb.from("report_companies").delete().eq("report_id", repId);
    await sb.from("report_contracts").delete().eq("report_id", repId);
    if (pickedCos.size) await sb.from("report_companies").insert([...pickedCos].map((id) => ({ report_id: repId, company_id: id })));
    if (pickedCts.size) await sb.from("report_contracts").insert([...pickedCts].map((id) => ({ report_id: repId, contract_id: id })));
    closeModal(); openReport(repId);
  };
}

async function logEvent(reportId, action, comment = null, version = 1, content = null, followup = null) {
  await sb.from("report_events").insert({ report_id: reportId, actor_id: ME.id, action, comment, version,
    content_snapshot: content, followup_snapshot: followup });
}

/* Word-level diff: deletions red strikethrough, additions blue */
function diffWords(oldStr, newStr) {
  const tok = (x) => String(x ?? "").split(/(\s+)/).filter((t) => t !== "");
  const A = tok(oldStr), B = tok(newStr);
  if (A.length * B.length > 400000) return null; // too large, skip diff
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const DEL = (t) => `<span style="color:#b3261e;background:#fdecec;text-decoration:line-through">${esc(t)}</span>`;
  const INS = (t) => `<span style="color:#1d4fb8;background:#e8f0fe;font-weight:600">${esc(t)}</span>`;
  let i = 0, j = 0; const out = [];
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(esc(A[i])); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { if (A[i].trim()) out.push(DEL(A[i])); i++; }
    else { out.push(B[j].trim() ? INS(B[j]) : esc(B[j])); j++; }
  }
  while (i < n) { if (A[i].trim()) out.push(DEL(A[i])); i++; }
  while (j < m) { out.push(B[j].trim() ? INS(B[j]) : esc(B[j])); j++; }
  return out.join("");
}

async function openReport(id) {
  const { data: r } = await sb.from("reports").select("*, report_tags(tag_id), report_companies(company_id), report_contracts(contract_id)").eq("id", id).single();
  if (!r) return alert("Can't open this report (no permission).");
  openedReportId = id;
  const { data: events } = await sb.from("report_events").select("*").eq("report_id", id).order("created_at", { ascending: false });

  const isAuthor = r.author_id === ME.id;
  const canReview = (ME.role === "leader" && ME.part === r.part && !isAuthor) || isExec() || ME.is_admin;
  const canEdit = (isAuthor && (r.status === "submitted" || r.status === "returned")) || (canReview && (r.status === "submitted" || r.status === "returned"));
  const canRevoke = (isExec() || ME.is_admin) && r.status === "approved";
  const canSeeHistory = isAuthor || (ME.role === "leader" && ME.part === r.part) || isExec() || ME.is_admin;
  const evLabel = { create: "created", edit: "edited", submit: "submitted", return: "returned", approve: "approved", comment: "commented", revoke: "revoked approval" };
  const dotCls = { submit: "submit", return: "return", approve: "approve", revoke: "return" };

  // Build diffs: for each edit event, compare with the previous snapshot (chronological)
  const asc = [...(events || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const diffs = {};
  let prevSnap = null;
  asc.forEach((e) => {
    if (e.content_snapshot !== null && e.content_snapshot !== undefined) {
      if (e.action === "edit" && prevSnap) {
        const dc = diffWords(prevSnap.c, e.content_snapshot);
        const df = diffWords(prevSnap.f, e.followup_snapshot);
        if ((dc && dc !== esc(e.content_snapshot)) || (df && df !== esc(e.followup_snapshot ?? "")))
          diffs[e.id] = { dc, df };
      }
      prevSnap = { c: e.content_snapshot, f: e.followup_snapshot };
    }
  });

  const main = $("#main");
  main.innerHTML = `
    <button class="btn ghost sm" id="backBtn">← Back to list</button>
    <div style="display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap">
      <div class="page-title">${esc(r.title)}</div>
      <span class="badge part">${RTYPE_LABEL[r.report_type] || "Customer Meeting"}</span>
      ${(r.report_companies || []).map((c) => `<span class="badge meeting">${esc(companyName(c.company_id))}</span>`).join(" ")}
      ${(r.report_contracts || []).map((c) => `<span class="badge vc">${esc(contractName(c.contract_id))}</span>`).join(" ")}
      ${(r.report_tags || []).map((t) => `<span class="badge other">${esc(TAGS.find((x) => x.id === t.tag_id)?.name || "")}</span>`).join(" ")}
      <span class="badge ${r.status}">${ST_LABEL[r.status]}</span>
      <span class="badge part">v${r.version}</span>
    </div>
    <div class="page-sub">${r.customer && r.customer !== "Other" ? "PIC: " + esc(r.customer) + " · " : ""}Meeting date ${fmtD(r.meeting_date)} · Author ${esc(staffName(r.author_id))} (${esc(r.part)})${r.activity_id ? " · 🔗 linked to activity" : ""}</div>

    <div class="two-col">
      <div>
        <div class="card" style="margin-bottom:14px">
          <h2 style="font-size:14px;margin-bottom:8px">Discussion</h2>
          <div class="report-content">${esc(r.content) || "-"}</div>
          <h2 style="font-size:14px;margin:14px 0 8px">Follow-up (action items)</h2>
          <div class="report-content">${esc(r.followup) || "-"}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${canEdit ? `<button class="btn ghost" id="repEdit">✏️ Edit${canReview && !isAuthor ? " (as reviewer)" : ""}${isAuthor && r.status === "returned" ? " & resubmit" : ""}</button>` : ""}
          ${canReview && (r.status === "submitted" || r.status === "returned") ? `
            <button class="btn" id="repApprove">✅ Approve</button>` : ""}
          ${canReview && r.status === "submitted" ? `
            <button class="btn danger" id="repReturn">↩️ Return (with reason)</button>` : ""}
          ${canRevoke ? `<button class="btn danger" id="repRevoke">🚫 Revoke approval (with remark)</button>` : ""}

        </div>
      </div>
      <div class="card">
        <h2 style="font-size:14px;margin-bottom:6px">History</h2>
        ${canSeeHistory ? "" : `<div class="empty" style="padding:14px 6px">Edit history and review comments are visible to the author and reviewers only.</div>`}
        <div class="timeline" style="${canSeeHistory ? "" : "display:none"}">
          ${(events || []).map((e) => `
            <div class="tl-item">
              <div class="tl-dot ${dotCls[e.action] || ""}"></div>
              <div class="tl-body">
                <div class="tl-head">${esc(staffName(e.actor_id))}${e.actor_id !== r.author_id ? ` <span style="font-size:10.5px;color:var(--blue);font-weight:700">REVIEWER</span>` : ""} · ${evLabel[e.action]} <span style="color:var(--ink-2);font-weight:400">(v${e.version})</span></div>
                <div class="tl-time">${fmtDT(e.created_at)}</div>
                ${e.comment ? `<div class="tl-comment">${esc(e.comment)}</div>` : ""}
                ${diffs[e.id] ? `<div class="tl-comment" style="background:#fff">
                  <div style="font-size:11px;font-weight:700;color:var(--ink-2);margin-bottom:4px">CHANGES (<span style="color:#b3261e;text-decoration:line-through">removed</span> / <span style="color:#1d4fb8;font-weight:700">added</span>)</div>
                  ${diffs[e.id].dc ? `<div style="white-space:pre-wrap">${diffs[e.id].dc}</div>` : ""}
                  ${diffs[e.id].df && diffs[e.id].df !== esc("") ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);white-space:pre-wrap"><span style="font-size:11px;font-weight:700;color:var(--ink-2)">Follow-up: </span>${diffs[e.id].df}</div>` : ""}
                </div>` : ""}
              </div>
            </div>`).join("") || `<div class="empty">No history</div>`}
        </div>
      </div>
    </div>`;

  $("#backBtn").onclick = () => switchView(currentView === "review" ? "review" : "reports");
  if ($("#repEdit")) $("#repEdit").onclick = () => reportModal(r);
  if ($("#repApprove")) $("#repApprove").onclick = async () => {
    if (!confirm("Approve this report?")) return;
    await sb.from("reports").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", r.id);
    await logEvent(r.id, "approve", null, r.version); openReport(r.id);
  };
  if ($("#repRevoke")) $("#repRevoke").onclick = () => {
    openModal(`
      <h3>Revoke approval</h3>
      <p style="font-size:12.5px;color:var(--ink-2);margin-bottom:10px">Team Lead / Director only. The report returns to the author for revision, and the revoke appears on the dashboard.</p>
      <div class="field"><label>Remark (why is the approval revoked?)</label><textarea id="rvReason" style="min-height:110px"></textarea></div>
      <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Back</button><button class="btn danger" id="rvGo">Revoke</button></div>`);
    $("#rvGo").onclick = async () => {
      const reason = $("#rvReason").value.trim();
      if (!reason) return alert("Enter a remark.");
      await sb.from("reports").update({ status: "returned", updated_at: new Date().toISOString() }).eq("id", r.id);
      await logEvent(r.id, "revoke", reason, r.version);
      closeModal(); openReport(r.id);
    };
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
  const sub = isExec() ? "Submitted reports from all parts" : `${ME.part} — submitted reports`;
  main.innerHTML = `<div class="page-title">Pending Approvals</div>
    <div class="page-sub">${esc(sub)}</div>
    ${searchBarHTML("rev")}
    <div class="card" style="padding:8px 14px" id="revList"><div class="empty">Loading...</div></div>`;
  bindSearchBar("rev", renderReview);
  await drawReportList("#revList", true);
}

/* =========================================================
   ADMIN
   ========================================================= */
async function renderAdmin() {
  const main = $("#main");
  const [{ data: staff }, { data: settingRows }] = await Promise.all([
    sb.from("staff").select("*").order("part").order("name"),
    sb.from("app_settings").select("*"),
  ]);
  const settings = settingRows || [];
  const getSet = (k, dflt) => settings.find((x) => x.key === k)?.value ?? dflt;
  const showIndiv = getSet("show_individual_stats", "false") === "true";
  const pending = (staff || []).filter((s) => s.status === "pending");
  const rest = (staff || []).filter((s) => s.status !== "pending");

  main.innerHTML = `<div class="page-title">Admin</div>
    <div class="page-sub">Roster · account approval · permissions · dashboard settings</div>

    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <b style="font-size:14px">📊 Individual stats visibility</b>
        <div style="font-size:12.5px;color:var(--ink-2)">Currently ${showIndiv
          ? "<b style='color:var(--green-dark)'>everyone</b> can see per-employee stats on the dashboard."
          : "only <b>part leaders & the director</b> can see per-employee stats. Members see company & part totals."}</div>
      </div>
      <button class="btn ${showIndiv ? "danger" : "navy"}" id="btnToggleIndiv">${showIndiv ? "Hide from members" : "Show to everyone"}</button>
    </div>

    <div class="card" style="margin-bottom:16px">
      <b style="font-size:14px">🏆 Score settings</b>
      <div style="font-size:12px;color:var(--ink-2);margin-bottom:8px">Points per planned activity — unplanned activities get the multiplier. Changing values re-scores everything instantly.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        ${[["score_meeting","Meeting","2"],["score_vc","VC","1"],["score_trip","Trip","3"],["score_other","Other","1"],["score_unplanned_mult","Unplanned ×","2"]].map(([k, lbl, d]) => `
          <div class="field" style="margin:0"><label>${lbl}</label><input type="number" min="0" step="0.5" style="width:90px" data-scoreset="${k}" value="${esc(getSet(k, d))}" /></div>`).join("")}
        <button class="btn sm" id="btnSaveScores">Save</button>
      </div>
    </div>

    ${pending.length ? `
    <div class="section-head"><h2>🔔 Pending approval (${pending.length})</h2></div>
    <div class="card" style="padding:8px 14px;margin-bottom:8px">
      <table><thead><tr><th>Name</th><th>Part</th><th>Login ID</th><th></th></tr></thead><tbody>
      ${pending.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.part)}</td><td>${esc(s.login_id)}</td>
        <td><button class="btn sm" data-appr="${s.id}">Approve</button> <button class="btn ghost sm" data-rej="${s.id}">Reject</button></td></tr>`).join("")}
      </tbody></table></div>` : ""}

    <div class="section-head"><h2>🎨 Parts</h2><button class="btn" id="btnAddPart">+ New part</button></div>
    <div class="card" style="margin-bottom:8px;padding:12px 14px">
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${PARTS.map((p) => `
          <span class="chip" style="background:${p.color}1c;color:${p.color};border:1px solid ${p.color}44">
            ● ${esc(p.name)}
            <button data-editpart="${p.id}" title="Edit" style="color:${p.color}">✎</button>
            ${!STAFF.some((x) => x.part === p.name) ? `<button data-delpart="${p.id}" title="Delete" style="color:${p.color}">×</button>` : ""}
          </span>`).join("") || `<span style="font-size:12.5px;color:var(--ink-2)">No parts yet — create one to use in the roster.</span>`}
      </div>
      <div style="font-size:11px;color:var(--ink-2);margin-top:8px">Parts with assigned staff can't be deleted. Renaming a part updates all staff and history automatically.</div>
    </div>

    <div class="section-head"><h2>Staff roster</h2><button class="btn" id="btnAddStaff">+ Add staff</button></div>
    <div class="card" style="padding:8px 14px">
      <table><thead><tr><th>Name</th><th>Emp. No.</th><th>Part</th><th>Role</th><th>Status</th><th>Login ID</th><th></th></tr></thead><tbody>
      ${rest.map((s) => `<tr>
        <td><b>${esc(s.name)}</b>${s.is_admin ? ' <span style="font-size:11px;color:var(--green-dark)">Admin</span>' : ""}</td>
        <td>${esc(s.emp_no)}</td><td>${partBadge(s.part)}</td>
        <td>${ROLE_LABEL[s.role]}</td>
        <td><span class="badge ${s.status}">${SS_LABEL[s.status]}</span></td>
        <td>${esc(s.login_id || "-")}</td>
        <td style="white-space:nowrap">
          <button class="btn ghost sm" data-editstaff="${s.id}">Edit</button>
          ${s.status === "active" && s.id !== ME.id ? `<button class="btn ghost sm" data-disable="${s.id}" style="color:var(--red)">Disable</button>` : ""}
          ${s.status === "disabled" ? `<button class="btn ghost sm" data-enable="${s.id}">Enable</button>` : ""}
          ${s.user_id ? `<button class="btn ghost sm" data-resetpw="${s.id}">Reset PW</button>` : ""}
          ${s.status === "unclaimed" ? `<button class="btn ghost sm" data-delstaff="${s.id}" style="color:var(--red)">Delete</button>` : ""}
        </td></tr>`).join("")}
      </tbody></table></div>`;

  $("#btnAddStaff").onclick = () => staffModal();
  $("#btnSaveScores").onclick = async () => {
    const jobs = [...document.querySelectorAll("[data-scoreset]")].map((inp) =>
      sb.from("app_settings").upsert({ key: inp.dataset.scoreset, value: String(Number(inp.value) || 0) }, { onConflict: "key" }));
    const res = await Promise.all(jobs);
    const bad = res.find((x) => x.error);
    if (bad) return alert("Save failed: " + bad.error.message);
    alert("Score settings saved.");
  };
  $("#btnAddPart").onclick = () => partModal();
  document.querySelectorAll("[data-editpart]").forEach((b) => (b.onclick = () => partModal(PARTS.find((p) => p.id == b.dataset.editpart))));
  document.querySelectorAll("[data-delpart]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Delete this part?")) return;
    await sb.from("parts").delete().eq("id", b.dataset.delpart);
    PARTS = PARTS.filter((p) => p.id != b.dataset.delpart);
    renderAdmin();
  }));
  $("#btnToggleIndiv").onclick = async () => {
    const { error } = await sb.from("app_settings").update({ value: showIndiv ? "false" : "true" }).eq("key", "show_individual_stats");
    if (error) return alert("Failed to update setting: " + error.message);
    renderAdmin();
  };
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
  document.querySelectorAll("[data-delstaff]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Delete this roster entry?")) return;
    await sb.from("staff").delete().eq("id", b.dataset.delstaff); renderAdmin(); }));
  document.querySelectorAll("[data-editstaff]").forEach((b) => (b.onclick = () => {
    const s2 = staff.find((x) => x.id == b.dataset.editstaff); staffModal(s2); }));
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

function partModal(edit = null) {
  let chosen = edit?.color || PART_PALETTE[PARTS.length % PART_PALETTE.length];
  openModal(`
    <h3>${edit ? "Edit part" : "New part"}</h3>
    <div class="field"><label>Part name</label><input id="ptName" value="${esc(edit?.name || "")}" placeholder="e.g. Parts Sales" /></div>
    <div class="field"><label>Color</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap" id="ptSwatches">
        ${PART_PALETTE.map((c) => `<span data-c="${c}" style="width:30px;height:30px;border-radius:50%;background:${c};cursor:pointer;display:inline-block;border:3px solid ${c === chosen ? "var(--navy)" : "transparent"}"></span>`).join("")}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="ptSave">${edit ? "Save" : "Create"}</button>
    </div>`);
  document.querySelectorAll("#ptSwatches [data-c]").forEach((sw) => (sw.onclick = () => {
    chosen = sw.dataset.c;
    document.querySelectorAll("#ptSwatches [data-c]").forEach((x) => (x.style.border = "3px solid transparent"));
    sw.style.border = "3px solid var(--navy)";
  }));
  $("#ptSave").onclick = async () => {
    const name = $("#ptName").value.trim();
    if (!name) return alert("Enter a part name.");
    if (edit) {
      const { error } = await sb.from("parts").update({ name, color: chosen }).eq("id", edit.id);
      if (error) return alert("Save failed (duplicate name?): " + error.message);
      if (name !== edit.name) {
        // rename cascade: staff + history + targets
        await sb.from("staff").update({ part: name }).eq("part", edit.name);
        await sb.from("activities").update({ part: name }).eq("part", edit.name);
        await sb.from("reports").update({ part: name }).eq("part", edit.name);
        await sb.from("targets").update({ part: name }).eq("part", edit.name);
        const { data: all } = await sb.from("staff").select("id,name,part,role,status,is_admin,color").order("part").order("name");
        STAFF = all || [];
        if (ME.part === edit.name) ME.part = name;
      }
      const i = PARTS.findIndex((p) => p.id === edit.id);
      PARTS[i] = { ...PARTS[i], name, color: chosen };
    } else {
      const { data, error } = await sb.from("parts").insert({ name, color: chosen }).select("*").single();
      if (error) return alert("Create failed (duplicate name?): " + error.message);
      PARTS.push(data); PARTS.sort((a, b) => a.name.localeCompare(b.name));
    }
    closeModal(); renderAdmin();
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
      <div class="field"><label>Part</label><select id="stPart">
        ${PARTS.map((p) => `<option value="${esc(p.name)}" ${edit?.part === p.name ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
        ${edit?.part && !PARTS.some((p) => p.name === edit.part) ? `<option selected>${esc(edit.part)}</option>` : ""}
      </select>
      <div style="font-size:11px;color:var(--ink-2);margin-top:3px">Need a new part? Create it in Admin → Parts first.</div></div>
      <div class="field"><label>Role</label><select id="stRole">
        ${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${edit?.role === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="stSave">${edit ? "Save" : "Add"}</button>
    </div>`);
  $("#stSave").onclick = async () => {
    const rec = { name: $("#stName").value.trim(), emp_no: $("#stEmp").value.trim(),
      part: $("#stPart").value || "Unassigned", role: $("#stRole").value };
    if (!rec.name || !rec.emp_no) return alert("Name and employee number are required.");
    const { error } = edit
      ? await sb.from("staff").update(rec).eq("id", edit.id)
      : await sb.from("staff").insert(rec);
    if (error) return alert("Save failed: " + error.message);
    closeModal(); renderAdmin();
  };
}

init();
