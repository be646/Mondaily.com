const STORAGE_KEY = "mondaily_workspace_v3";

const $ = (id) => document.getElementById(id);
const localIsoDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const todayIso = () => localIsoDate(new Date());
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function makeWorkspace(profile) {
  return {
  session: profile,
  monthCursor: todayIso().slice(0, 7),
  bannerDismissedFor: "",
  timeLogs: [],
  activeTimerSession: null,
  appointments: [
    { id: uid(), title: "Ecosystem architecture strategy run", date: "2026-05-27", time: "09:00", priority: "top", details: "Platform review and launch checklist.", done: false },
    { id: uid(), title: "Cybersecurity evaluation track", date: "2026-05-28", time: "11:30", priority: "priority", details: "Review exam readiness and notes.", done: false }
  ],
  realestateProjects: [
    { id: uid(), name: "Badr City Premium Housing Block", value: "$450,000", phase: "Construction", status: "Active", priority: "Medium", zoning: "Residential T3", location: "Badr City, Egypt", units: "42", nextMilestone: "Permit review", risk: "Medium" }
  ],
  realestateClients: [
    { id: uid(), name: "Amir Mansour", email: "amir@mansourcorp.eg", phone: "+201002345678", area: "Fifth Settlement", country: "Egypt", budget: "$300k-$500k", intent: "Commercial suite", stage: "Qualified", priority: "High", leadScore: "Warm", nextStep: "Send valuation packet", notes: "Prefers high-floor commercial suites." }
  ],
  realestateReviews: [
    { id: uid(), reviewName: "Badr City viewing round", property: "Badr City Premium Housing Block", client: "Amir Mansour", status: "Pending", priority: "High", reviewDate: "2026-06-03", result: "In review", successRate: "65%", dealValue: "$450,000", notes: "Prepare viewing files and buyer objections list." }
  ],
  patients: [
    { id: uid(), name: "Jane Vance", email: "jane.v@telemetry.net", phone: "+48721993002", age: "34", gender: "F", blood: "O+", allergies: "Penicillin", diagnosis: "Routine evaluation", priority: "Medium", visitStatus: "Waiting", vitals: "120/80 BP, 72 BPM", meds: "Amoxicillin 500mg", nextVisit: "2026-06-05", details: "Routine evaluation.", sessions: [] }
  ],
  partners: [
    { id: uid(), name: "Hassan El-Sayed", email: "hassan@delta-ventures.com", phone: "+201223456789", linkedin: "linkedin.com/in/hassan-ceo", allocation: "18.5% Equity", subsidiary: "Delta Holdings", company: "Delta Ventures", dealStage: "Board review", priority: "High", value: "$2.4M", nextAction: "Monthly cash flow check", details: "Monthly cash flow checks authorized.", sessions: [] }
  ],
  courses: [
    { id: uid(), subject: "Advanced Compiler Systems", teacher: "Prof. Dr. Bassem", room: "Lecture Theatre 4B", hours: "Mon/Wed 10:00", exam: "2026-06-12", cohort: "CS-MSc-2", credits: "6", status: "Active", priority: "Medium", notes: "Compiler optimization and runtime architecture.", sessions: [] }
  ],
  officeRecords: [
    { id: uid(), taskName: "Weekly operations standup", owner: "Office Lead", department: "Operations", status: "Active", priority: "Medium", dueDate: "2026-06-01", country: "Poland", phone: "+48 000 000 000", budget: "$2,000", notes: "Align team workload, blockers, approvals, and follow-up owners.", sessions: [] }
  ],
  officePeople: [
    { id: uid(), name: "Marta Kowalska", roleTitle: "Team Coordinator", department: "Operations", email: "marta@company.com", phone: "+48 111 222 333", country: "Poland", status: "Active", manager: "Office Lead", notes: "Coordinates daily task routing and meeting notes." }
  ],
  officeEvents: [
    { id: uid(), eventName: "Regional industry congress", owner: "Office Lead", eventType: "Congress", date: "2026-06-14", location: "Warsaw Expo", country: "Poland", status: "Planning", attendees: "35", budget: "$8,000", notes: "Track invitations, booth materials, travel, and speaker schedule." }
  ],
  invitedUsers: [],
  chatMessages: [
    { id: uid(), author: "Mondaily AI", text: "Company chat is ready. Invite teammates by email and keep team notes here.", time: todayIso() }
  ],
  notes: [
    { id: uid(), content: "Verify DNS routing hooks before production launch.", task: false, done: false },
    { id: uid(), content: "Finalize monthly transaction ledger statements.", task: true, done: false }
  ]
  };
}

const demoProfile = {
  name: "Bassem Eprahim",
  email: "b.eprahim@mondaily.com",
  company: "Vanguard Properties Sp. z o.o.",
  phone: "+48 573 821 990",
  role: "realestate",
  avatar: "🏢"
};

let accountStore = loadAccountStore();
let pendingLogin = null;
let state = loadState();

let breakTimer = null;
let breakSeconds = 0;
let roleTimer = null;
let roleTimerSeconds = 0;
let breakReminderSeconds = 0;
let animationId = null;
let activeGame = "breakout";
let game = {};
const tetrisPieces = [
  { shape: [[1, 1, 1, 1]], color: "#38bdf8" },
  { shape: [[1, 1], [1, 1]], color: "#fbbf24" },
  { shape: [[1, 1, 1], [0, 1, 0]], color: "#a78bfa" },
  { shape: [[1, 1, 0], [0, 1, 1]], color: "#34d399" },
  { shape: [[0, 1, 1], [1, 1, 0]], color: "#fb7185" },
  { shape: [[1, 0, 0], [1, 1, 1]], color: "#60a5fa" },
  { shape: [[0, 0, 1], [1, 1, 1]], color: "#f472b6" }
];

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function accountKey(email, role) {
  return `${String(email || "").trim().toLowerCase()}::${role}`;
}

function roleAvatar(role) {
  return role === "doctor" ? "⚕" : role === "ceo" ? "💼" : role === "teacher" ? "🎓" : role === "student" ? "📚" : role === "general" ? "⌘" : "🏢";
}

function loadAccountStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.accounts) return stored;
  } catch {}
  return { activeKey: "", accounts: {} };
}

function loadState() {
  const active = accountStore.activeKey && accountStore.accounts[accountStore.activeKey];
  return active ? active : makeWorkspace(null);
}

function saveState() {
  if (state.session) {
    const key = accountKey(state.session.email, state.session.role);
    accountStore.activeKey = key;
    accountStore.accounts[key] = state;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accountStore));
}

function createOrLoadWorkspace(profile) {
  const key = accountKey(profile.email, profile.role);
  if (!accountStore.accounts[key]) {
    accountStore.accounts[key] = makeWorkspace(profile);
  } else {
    accountStore.accounts[key].session = { ...accountStore.accounts[key].session, ...profile };
  }
  accountStore.activeKey = key;
  state = accountStore.accounts[key];
  ensureWorkspaceShape();
  saveState();
}

function toast(title, message = "") {
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<div class="card-meta">${escapeHtml(message)}</div>` : ""}`;
  $("toastHost").appendChild(node);
  setTimeout(() => node.remove(), 3400);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function init() {
  ensureWorkspaceShape();
  initThemeMode();
  bindAuth();
  bindShell();
  if (state.session) showApp();
  else showAuth();
}

function ensureWorkspaceShape() {
  const sample = makeWorkspace(state.session);
  ["realestateReviews", "timeLogs", "officePeople", "officeEvents", "invitedUsers", "chatMessages"].forEach((key) => {
    if (!Array.isArray(state[key])) state[key] = clone(sample[key]);
  });
  if (!("activeTimerSession" in state)) state.activeTimerSession = null;
  if (state.session && state.session.role === "general" && state.session.avatar !== "⌘") state.session.avatar = "⌘";
}

function initThemeMode() {
  const saved = localStorage.getItem("mondaily_theme_mode");
  const automatic = new Date().getHours() >= 7 && new Date().getHours() < 18 ? "morning" : "night";
  document.body.dataset.theme = saved || automatic;
  updateThemeButton();
}

function toggleThemeMode() {
  document.body.dataset.theme = document.body.dataset.theme === "morning" ? "night" : "morning";
  localStorage.setItem("mondaily_theme_mode", document.body.dataset.theme);
  updateThemeButton();
  toast("Theme changed", document.body.dataset.theme === "morning" ? "Morning mode" : "Night mode");
}

function updateThemeButton() {
  const btn = $("themeToggleBtn");
  if (!btn) return;
  const isMorning = document.body.dataset.theme === "morning";
  btn.innerHTML = `<span>${isMorning ? "☀" : "☾"}</span> ${isMorning ? "Morning" : "Night"}`;
}

function bindAuth() {
  $("showRegisterBtn").addEventListener("click", () => setAuthMode("register"));
  $("showLoginBtn").addEventListener("click", () => setAuthMode("login"));

  document.querySelectorAll(".role-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".role-card").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $("authRole").value = btn.dataset.role;
      $("authPhone").required = !["teacher", "student", "general"].includes(btn.dataset.role);
    });
  });

  $("requestCodeBtn").addEventListener("click", requestLoginCode);

  $("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const email = $("loginEmail").value.trim();
    const role = $("loginRole").value;
    const code = $("loginCode").value.trim();
    const key = accountKey(email, role);
    if (!accountStore.accounts[key]) {
      toast("Account not found", "Register this email and account type first.");
      return;
    }
    if (!pendingLogin || pendingLogin.key !== key || pendingLogin.code !== code) {
      toast("Code needed", "Use the one-time code shown after clicking Get login code.");
      return;
    }
    state = accountStore.accounts[key];
    accountStore.activeKey = key;
    saveState();
    showApp();
    toast("Logged in", state.session.email);
  });

  $("authForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const role = $("authRole").value;
    const profile = {
      name: $("authName").value.trim(),
      email: $("authEmail").value.trim(),
      company: $("authCompany").value.trim(),
      phone: $("authPhone").value.trim(),
      role,
      avatar: roleAvatar(role)
    };
    createOrLoadWorkspace(profile);
    showApp();
    toast("Workspace created", `Welcome, ${state.session.name}.`);
  });
}

function setAuthMode(mode) {
  const login = mode === "login";
  $("authForm").classList.toggle("hidden", login);
  $("loginForm").classList.toggle("hidden", !login);
  $("showLoginBtn").classList.toggle("active", login);
  $("showRegisterBtn").classList.toggle("active", !login);
}

function requestLoginCode() {
  const email = $("loginEmail").value.trim();
  const role = $("loginRole").value;
  const key = accountKey(email, role);
  if (!email) {
    toast("Email needed", "Enter the email you registered with.");
    return;
  }
  if (!accountStore.accounts[key]) {
    toast("Account not found", "Register this email and account type first.");
    return;
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  pendingLogin = { key, code };
  $("codeField").classList.remove("hidden");
  $("loginCodeHint").classList.remove("hidden");
  $("loginCodeHint").textContent = `Your Mondaily login code is ${code}`;
  $("loginCode").focus();
}

function bindShell() {
  $("logoutBtn").addEventListener("click", logoutWorkspace);
  $("newAppointmentBtn").addEventListener("click", () => openAppointmentDialog());
  $("themeToggleBtn").addEventListener("click", toggleThemeMode);
  $("mobileMenuBtn").addEventListener("click", () => $("mobileSideNav").classList.remove("hidden"));
  $("closeMobileMenuBtn").addEventListener("click", () => $("mobileSideNav").classList.add("hidden"));
  document.querySelectorAll("[data-shell-action]").forEach((btn) => btn.addEventListener("click", handleShellAction));
  $("prevMonth").addEventListener("click", () => shiftMonth(-1));
  $("nextMonth").addEventListener("click", () => shiftMonth(1));
  $("appointmentForm").addEventListener("submit", saveAppointmentFromForm);
  document.querySelectorAll("[data-close-dialog]").forEach((btn) => btn.addEventListener("click", () => $("appointmentDialog").close()));
  $("aiRunBtn").addEventListener("click", runAiCommand);
  $("aiInput").addEventListener("keydown", (event) => { if (event.key === "Enter") runAiCommand(); });
  $("globalSearch").addEventListener("input", () => renderSearch($("globalSearch").value));
  $("dismissBannerBtn").addEventListener("click", () => {
    const next = getNextAppointment();
    state.bannerDismissedFor = next ? next.id : todayIso();
    saveState();
    renderUpcomingBanner();
  });
  $("upcomingBanner").addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    const next = getNextAppointment();
    if (next) openAppointmentDialog(next);
  });
  $("tasksBtn").addEventListener("click", () => $("taskDrawer").classList.remove("hidden"));
  $("chatBtn").addEventListener("click", openCompanyChat);
  $("closeTasksBtn").addEventListener("click", () => $("taskDrawer").classList.add("hidden"));
  $("closeChatBtn").addEventListener("click", () => $("companyChatDrawer").classList.add("hidden"));
  $("inviteUserBtn").addEventListener("click", inviteCompanyUser);
  $("sendChatBtn").addEventListener("click", sendCompanyMessage);
  $("chatMessageInput").addEventListener("keydown", (event) => { if (event.key === "Enter") sendCompanyMessage(); });
  $("aiMobileToggle").addEventListener("click", () => $("aiDock").classList.toggle("open"));
  $("recordDialogCloseBtn").addEventListener("click", () => $("recordDialog").close());
  $("timerStartBtn").addEventListener("click", startRoleTimer);
  $("timerPauseBtn").addEventListener("click", pauseRoleTimer);
  $("timerResetBtn").addEventListener("click", resetRoleTimer);
  $("timerLogsBtn").addEventListener("click", () => openTimeLogDrawer());
  $("closeTimeLogBtn").addEventListener("click", () => $("timeLogDrawer").classList.add("hidden"));
  $("addNoteBtn").addEventListener("click", () => {
    state.notes.unshift({ id: uid(), content: "New note", task: false, done: false });
    saveState();
    renderNotes();
  });
  bindGames();
}

function logoutWorkspace() {
  finishActiveTimer("Logout / break");
  accountStore.activeKey = "";
  state = makeWorkspace(null);
  saveState();
  stopGame();
  $("mobileSideNav").classList.add("hidden");
  $("companyChatDrawer").classList.add("hidden");
  $("taskDrawer").classList.add("hidden");
  $("timeLogDrawer").classList.add("hidden");
  showAuth();
  toast("Logged out", "Your separated workspace data is saved on this device.");
}

function handleShellAction(event) {
  const action = event.currentTarget.dataset.shellAction;
  $("mobileSideNav").classList.add("hidden");
  if (action === "tasks") $("taskDrawer").classList.remove("hidden");
  if (action === "chat") openCompanyChat();
  if (action === "appointment") openAppointmentDialog();
  if (action === "break") openBreak();
  if (action === "theme") toggleThemeMode();
  if (action === "logout") logoutWorkspace();
}

function showAuth() {
  $("authScreen").classList.remove("hidden");
  $("appShell").classList.add("hidden");
}

function showApp() {
  ensureWorkspaceShape();
  $("authScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  renderAll();
}

function renderAll() {
  const s = state.session;
  $("profileAvatar").textContent = s.avatar;
  $("profileName").textContent = greetingName(s.name);
  $("profileMeta").textContent = `${s.email} · ${s.company}`;
  $("roleLabel").textContent = `${roleDisplayName(s.role)} workspace`;
  $("calendarTitle").textContent = ["teacher", "student"].includes(s.role) ? "Class planner" : "Appointments";
  if ($("searchTitle")) $("searchTitle").textContent = `Search ${roleDisplayName(s.role)}`;
  renderCalendar();
  renderAgenda();
  renderUpcomingBanner();
  renderRolePanel();
  renderNotes();
  renderCompanyChat();
  renderRoleTimerLabel();
  renderSearch($("globalSearch").value);
}

function renderRoleTimerLabel() {
  const role = state.session.role;
  $("timerContextLabel").textContent = {
    doctor: "Patient visit timer",
    teacher: "Class session timer",
    student: "Study focus timer",
    realestate: "Client session timer",
    ceo: "Executive focus timer",
    general: "Office work timer"
  }[role] || "Workspace timer";
}

function roleDisplayName(role) {
  return {
    realestate: "Real Estate CRM",
    doctor: "Medical Records",
    ceo: "Executive / Founder",
    teacher: "Teacher",
    student: "Student",
    general: "Office"
  }[role] || "Workspace";
}

function getNextAppointment() {
  const nowKey = `${todayIso()} ${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
  return [...state.appointments]
    .filter((a) => !a.done && `${a.date} ${a.time}` >= nowKey)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0];
}

function renderUpcomingBanner() {
  const banner = $("upcomingBanner");
  const next = getNextAppointment();
  if (!next || state.bannerDismissedFor === next.id) {
    banner.classList.add("hidden");
    return;
  }
  const openCount = state.appointments.filter((a) => !a.done).length;
  banner.classList.remove("multi-reminder", "top-reminder");
  if (openCount > 1) banner.classList.add("multi-reminder");
  if (next.priority === "top") banner.classList.add("top-reminder");
  $("upcomingBannerText").textContent = `${next.title} is coming up on ${next.date} at ${next.time}. Priority: ${next.priority}.`;
  banner.classList.remove("hidden");
}

function greetingName(name) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${hello}, ${name}`;
}

function shiftMonth(delta) {
  const [year, month] = state.monthCursor.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  state.monthCursor = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  saveState();
  renderCalendar();
}

function renderCalendar() {
  const [year, month] = state.monthCursor.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const monthName = first.toLocaleString(undefined, { month: "long", year: "numeric" });
  $("monthLabel").textContent = monthName;
  const grid = $("calendarGrid");
  grid.innerHTML = "";

  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - mondayOffset);
  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const iso = localIsoDate(date);
    const appts = state.appointments.filter((a) => a.date === iso);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `day-cell ${date.getMonth() !== month - 1 ? "outside" : ""} ${iso === todayIso() ? "today" : ""}`;
    btn.innerHTML = `<div class="day-num"><span>${date.getDate()}</span><span>${appts.map((a) => `<i class="dot ${a.priority}"></i>`).join("")}</span></div>${appts.slice(0, 2).map((a) => `<div class="mini-event">${escapeHtml(a.time)} ${escapeHtml(a.title)}</div>`).join("")}`;
    btn.addEventListener("click", () => openAppointmentDialog({ date: iso }));
    grid.appendChild(btn);
  }
}

function renderAgenda() {
  const list = $("agendaList");
  const sorted = [...state.appointments].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  list.innerHTML = sorted.length ? sorted.map((a) => `
    <article class="item-card ${a.done ? "done" : ""}">
      <div class="card-title"><span>${escapeHtml(a.title)}</span><i class="dot ${a.priority}"></i></div>
      <div class="card-meta">${escapeHtml(a.date)} at ${escapeHtml(a.time)}${a.details ? ` · ${escapeHtml(a.details)}` : ""}</div>
      <div class="card-actions">
        <button class="small-btn" data-action="toggle-appointment" data-id="${a.id}">${a.done ? "Mark active" : "Mark done"}</button>
        <button class="small-btn" data-action="edit-appointment" data-id="${a.id}">Edit</button>
        <button class="small-btn" data-action="delete-appointment" data-id="${a.id}">Delete</button>
      </div>
    </article>`).join("") : `<div class="card-meta">No appointments yet.</div>`;

  list.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", handleAgendaAction));
}

function handleAgendaAction(event) {
  const id = event.currentTarget.dataset.id;
  const action = event.currentTarget.dataset.action;
  const item = state.appointments.find((a) => a.id === id);
  if (!item) return;
  if (action === "toggle-appointment") item.done = !item.done;
  if (action === "edit-appointment") return openAppointmentDialog(item);
  if (action === "delete-appointment") state.appointments = state.appointments.filter((a) => a.id !== id);
  saveState();
  renderCalendar();
  renderAgenda();
  renderUpcomingBanner();
}

function openAppointmentDialog(data = {}) {
  $("appointmentDialogTitle").textContent = data.id ? "Edit appointment" : "New appointment";
  $("appointmentId").value = data.id || "";
  $("aptTitle").value = data.title || "";
  $("aptDate").value = data.date || todayIso();
  $("aptTime").value = data.time || "09:00";
  $("aptPriority").value = data.priority || "neutral";
  $("aptDetails").value = data.details || "";
  $("appointmentDialog").showModal();
}

function saveAppointmentFromForm(event) {
  event.preventDefault();
  const payload = {
    id: $("appointmentId").value || uid(),
    title: $("aptTitle").value.trim(),
    date: $("aptDate").value,
    time: $("aptTime").value,
    priority: $("aptPriority").value,
    details: $("aptDetails").value.trim(),
    done: false
  };
  const index = state.appointments.findIndex((a) => a.id === payload.id);
  if (index >= 0) payload.done = state.appointments[index].done;
  if (index >= 0) state.appointments[index] = payload;
  else state.appointments.push(payload);
  state.bannerDismissedFor = "";
  state.monthCursor = payload.date.slice(0, 7);
  saveState();
  $("appointmentDialog").close();
  renderCalendar();
  renderAgenda();
  renderUpcomingBanner();
  toast("Appointment saved", payload.title);
}

function runAiCommand() {
  const text = $("aiInput").value.trim();
  if (!text) return;
  const result = processCommand(text);
  $("aiResult").textContent = "Ready for commands.";
  $("aiInput").value = "";
  saveState();
  if (!result?.skipRender) renderAll();
  if (result) toast(result.title, result.message);
}

function processCommand(text) {
  const lower = text.toLowerCase();
  const crmAction = processCrmAiAction(text);
  if (crmAction) return crmAction;

  if (/(schedule|schaduel|appointment|apointment|apoint|appoint|meeting|meet|call|book)/.test(lower)) {
    const date = parseCommandDate(text) || todayIso();
    const time = parseCommandTime(text) || "09:00";
    const priority = lower.includes("top") || lower.includes("critical") ? "top" : lower.includes("priority") || lower.includes("urgent") ? "priority" : "neutral";
    const title = cleanupTitle(text, ["add", "schedule", "schaduel", "appointment", "apointment", "apoint", "appoint", "meeting", "meet", "call", "book", "on", date, "at", time, "priority", "top", "urgent", "critical"]) || "AI scheduled appointment";
    const item = { id: uid(), title, date, time, priority, details: `Created from AI prompt: ${text}`, done: false };
    state.appointments.push(item);
    state.bannerDismissedFor = "";
    state.monthCursor = date.slice(0, 7);
    return { title: "Appointment scheduled", message: `${title} · ${date} at ${time}` };
  }

  if (/(search|find|lookup|look up)/.test(lower)) {
    const query = text.replace(/search|find|lookup|look up/ig, "").trim();
    $("globalSearch").value = query;
    const matches = collectSearchResults(query);
    return matches.length ? { title: "Search complete", message: `${matches.length} match${matches.length === 1 ? "" : "es"} for ${query}` } : { title: "No matches", message: `No local results for ${query}` };
  }

  if (/(task|todo|note|remember)/.test(lower)) {
    const content = cleanupTitle(text, ["add", "task", "todo", "note", "remember"]) || text;
    state.notes.unshift({ id: uid(), content, task: /(task|todo)/.test(lower), done: false });
    return { title: "Task saved", message: content };
  }

  if (/(client|lead)/.test(lower)) {
    const record = parsePerson(text, "New client");
    state.realestateClients.unshift({ id: uid(), ...record, budget: extractMoney(text) || "Unassigned", intent: "AI generated lead", stage: "New", leadScore: "Warm", source: "AI command", area: "Unassigned", country: "Unassigned", nextStep: "AI follow-up required", notes: `Created from AI prompt: ${text}` });
    return { title: "Client added", message: record.name };
  }

  if (/(patient)/.test(lower)) {
    const record = parsePerson(text, "New patient");
    state.patients.unshift({ id: uid(), ...record, age: "", gender: "", blood: "", allergies: "Pending", diagnosis: "Pending", vitals: "Pending", meds: "Pending", visitStatus: "Waiting", room: "Unassigned", nextVisit: "", details: `Created from AI prompt: ${text}` });
    return { title: "Patient added", message: record.name };
  }

  if (/(partner|investor|executive)/.test(lower)) {
    const record = parsePerson(text, "New partner");
    state.partners.unshift({ id: uid(), ...record, company: "Unassigned", linkedin: "", allocation: "Pending", subsidiary: "", dealStage: "New", value: extractMoney(text) || "Pending", priority: "Medium", nextAction: "AI follow-up required", details: `Created from AI prompt: ${text}` });
    return { title: "Partner added", message: record.name };
  }

  if (/(congress|conference|company event|workshop)/.test(lower)) {
    const date = parseCommandDate(text) || todayIso();
    const name = cleanupTitle(text, ["add", "create", "congress", "conference", "company", "event", "workshop", "on", date]) || "Company event";
    state.officeEvents.unshift({ id: uid(), eventName: name, owner: state.session.name, eventType: lower.includes("congress") ? "Congress" : "Company event", date, location: "Unassigned", country: "Poland", status: "Planning", attendees: "", budget: extractMoney(text) || "", notes: `Created from AI prompt: ${text}` });
    return { title: "Office event added", message: `${name} · ${date}` };
  }

  if (/(employee|teammate|staff|contact)/.test(lower)) {
    const record = parsePerson(text, "New teammate");
    state.officePeople.unshift({ id: uid(), ...record, roleTitle: "Team member", department: "Operations", country: "Poland", status: "Active", manager: state.session.name, notes: `Created from AI prompt: ${text}` });
    return { title: "Team contact added", message: record.name };
  }

  if (/(office|vendor|request|admin|manager|operation|work item)/.test(lower)) {
    const name = cleanupTitle(text, ["add", "office", "vendor", "request", "admin", "manager", "operation"]) || "Office work item";
    state.officeRecords.unshift({ id: uid(), taskName: name, owner: state.session.name, department: "Operations", status: "New", priority: "Medium", dueDate: todayIso(), country: "Poland", phone: "", budget: extractMoney(text) || "", notes: `Created from AI prompt: ${text}` });
    return { title: "Office record added", message: name };
  }

  if (/(course|class|exam)/.test(lower)) {
    const date = (text.match(/\b\d{4}-\d{2}-\d{2}\b/) || [""])[0];
    const subject = cleanupTitle(text, ["add", "course", "class", "exam", "on", date]) || "New course";
    state.courses.unshift({ id: uid(), subject, teacher: state.session.name, cohort: "Unassigned", credits: "", room: "Unassigned", hours: "Unassigned", exam: date || "Unassigned", status: "Active", attendance: "Pending", progress: "Not started", notes: `Created from AI prompt: ${text}` });
    return { title: "Course added", message: subject };
  }

  return { title: "Try another prompt", message: "Use: add appointment on 28/5/2026 at 15:00" };
}

function processCrmAiAction(text) {
  const lower = text.toLowerCase();
  if (/(change|set|update).*(status|stage)/.test(lower)) {
    const status = extractStatusFromCommand(text);
    const query = cleanupTitle(text, ["change", "set", "update", "status", "stage", "of", "for", "to", status]);
    const match = findCrmRecord(query)[0];
    if (!match) return { title: "Record not found", message: `No CRM record matched ${query || "that request"}.` };
    const field = statusFieldFor(match.item);
    match.item[field] = status;
    saveState();
    renderAll();
    showRecordDialog(match.key, match.item.id);
    return { title: "Status updated", message: `${match.title} is now ${status}.`, skipRender: true };
  }

  if (/(change|set|update).*(priority)/.test(lower)) {
    const priority = extractPriorityFromCommand(text);
    const query = cleanupTitle(text, ["change", "set", "update", "priority", "of", "for", "to", priority]);
    const match = findCrmRecord(query)[0];
    if (!match) return { title: "Record not found", message: `No CRM record matched ${query || "that request"}.` };
    match.item.priority = priority;
    saveState();
    renderAll();
    showRecordDialog(match.key, match.item.id);
    return { title: "Priority updated", message: `${match.title} is now ${priority}.`, skipRender: true };
  }

  if (/(open|show).*(card|record|client|patient|partner|course|employee|event|project|review)/.test(lower)) {
    const query = cleanupTitle(text, ["open", "show", "me", "card", "cards", "record", "records", "of", "for", "client", "clients", "patient", "patients", "partner", "partners", "course", "courses", "employee", "employees", "event", "events", "project", "projects", "review", "reviews", "data"]);
    const matches = findCrmRecord(query || inferRecordTypeQuery(lower));
    if (!matches.length) return { title: "Record not found", message: "I could not find a matching card in this account." };
    renderAll();
    showRecordDialog(matches[0].key, matches[0].item.id);
    return { title: "Card opened", message: `${matches[0].type}: ${matches[0].title}`, skipRender: true };
  }

  if (/(find|search|lookup|look up).*(client|patient|phone|name|record|data|project|partner|employee|event|course|review)/.test(lower)) {
    const query = cleanupTitle(text, ["find", "search", "lookup", "look", "up", "me", "client", "clients", "patient", "patients", "phone", "phones", "name", "names", "record", "records", "data", "project", "projects", "partner", "partners", "employee", "employees", "event", "events", "course", "courses", "review", "reviews"]);
    $("globalSearch").value = query || inferRecordTypeQuery(lower);
    renderSearch($("globalSearch").value);
    const matches = collectSearchResults($("globalSearch").value);
    if (matches.length === 1 && /(open|card|show)/.test(lower)) showRecordDialog(matches[0].key, matches[0].id);
    return matches.length ? { title: "Records found", message: `${matches.length} local match${matches.length === 1 ? "" : "es"}.`, skipRender: true } : { title: "No records found", message: "No matching local CRM data in this account.", skipRender: true };
  }

  return null;
}

function extractStatusFromCommand(text) {
  const options = ["Closed", "Complete", "Successful", "Signed", "Qualified", "Active", "Pending", "Waiting", "In room", "Planning", "Board review", "New", "Revision", "Studying"];
  const lower = text.toLowerCase();
  return options.find((option) => lower.includes(option.toLowerCase())) || (text.match(/\bto\s+([a-z ]+)$/i)?.[1] || "Active").trim().replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractPriorityFromCommand(text) {
  const lower = text.toLowerCase();
  if (/\btop\b/.test(lower)) return "Top";
  if (/\bhigh\b/.test(lower)) return "High";
  if (/\bmedium\b/.test(lower)) return "Medium";
  if (/\blow\b/.test(lower)) return "Low";
  return "Medium";
}

function statusFieldFor(item) {
  if ("stage" in item) return "stage";
  if ("dealStage" in item) return "dealStage";
  if ("visitStatus" in item) return "visitStatus";
  return "status";
}

function inferRecordTypeQuery(lower) {
  if (/client|lead/.test(lower)) return "client";
  if (/patient/.test(lower)) return "patient";
  if (/partner|investor/.test(lower)) return "partner";
  if (/employee|staff/.test(lower)) return "employee";
  if (/event|congress/.test(lower)) return "event";
  if (/project|property/.test(lower)) return "project";
  if (/review|viewing/.test(lower)) return "review";
  if (/course|class/.test(lower)) return "course";
  return "";
}

function parseCommandDate(text) {
  const iso = text.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/);
  if (iso) {
    const [year, month, day] = iso[0].split("-").map(Number);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const slash = text.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const rawYear = Number(slash[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return "";
}

function parseCommandTime(text) {
  const match = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  return match ? `${String(Number(match[1])).padStart(2, "0")}:${match[2]}` : "";
}

function extractMoney(text) {
  const match = text.match(/(?:\$|€|£)\s?[\d,.]+(?:\s?(?:k|m|million|thousand))?/i);
  return match ? match[0] : "";
}

function cleanupTitle(text, words) {
  let out = text;
  words.filter(Boolean).forEach((word) => {
    out = out.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ");
  });
  out = out.replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, " ").replace(/\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/g, " ").replace(/\b([01]?\d|2[0-3])[:.][0-5]\d\b/g, " ");
  return out.replace(/\s+/g, " ").replace(/^[,:\-\s]+|[,:\-\s]+$/g, "").trim();
}

function parsePerson(text, fallback) {
  const cleaned = text.replace(/add|create|new|client|lead|patient|partner|investor|executive/ig, "").trim();
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  return {
    name: parts[0] || fallback,
    email: parts.find((p) => /@/.test(p)) || "",
    phone: parts.find((p) => /\+?\d[\d\s-]{6,}/.test(p)) || ""
  };
}

function renderRolePanel() {
  const role = state.session.role;
  if (role === "realestate") renderCollectionPanel("Portfolio Architecture & Real Estate CRM", [
    { title: "Projects & Developers", key: "realestateProjects", fields: [["name", "Project name", "", "Badr City Tower A"], ["developer", "Developer", "", "Vanguard Properties"], ["value", "Valuation", "", "$450,000"], ["location", "Location", "", "Badr City, Egypt"], ["units", "Units", "", "42"], ["phase", "Phase", "select", "Construction"], ["status", "Status", "select", "Active"], ["priority", "Priority", "select", "Medium"], ["zoning", "Zoning", "", "Residential T3"], ["nextMilestone", "Next milestone", "", "Permit review"], ["risk", "Risk profile", "select", "Medium"]] },
    { title: "Clients & Buyers", key: "realestateClients", fields: [["name", "Client full name", "", "Amir Mansour"], ["email", "Email", "", "client@email.com"], ["phone", "Phone", "", "+48 111 222 333"], ["budget", "Budget", "", "$300k-$500k"], ["intent", "Buying intent", "", "Commercial suite"], ["stage", "Pipeline status", "select", "Qualified"], ["priority", "Priority", "select", "High"], ["leadScore", "Lead score", "select", "Warm"], ["source", "Lead source", "", "Referral / Website"], ["area", "Target area", "", "Fifth Settlement"], ["country", "Country", "", "Egypt"], ["nextStep", "Next step", "", "Send valuation packet"], ["notes", "CRM notes", "textarea", "Preference, objections, payment terms..."]] },
    { title: "Property Reviews & Deal Success", key: "realestateReviews", fields: [["reviewName", "Review / viewing name", "", "Badr City viewing round"], ["property", "Property", "", "Badr City Tower A"], ["client", "Client", "", "Amir Mansour"], ["status", "Review status", "select", "Pending"], ["priority", "Priority", "select", "High"], ["reviewDate", "Review date", "", "2026-06-03"], ["result", "Result", "select", "In review"], ["successRate", "Success rate", "", "65%"], ["dealValue", "Deal value", "", "$450,000"], ["notes", "Review notes", "textarea", "Pending reviews, completed reviews, closed deal reasons..."]] }
  ]);
  else if (role === "doctor") renderCollectionPanel("Clinical Desk & Patient Records", [
    { title: "Patient Medical Records", key: "patients", fields: [["name", "Patient full name", "", "Jane Vance"], ["email", "Email", "", "patient@email.com"], ["phone", "Phone", "phone", "+48 111 222 333"], ["country", "Country", "country", "Poland"], ["age", "Age", "", "34"], ["gender", "Gender", "select", "Female"], ["blood", "Blood group", "select", "O+"], ["allergies", "Allergies", "", "Penicillin"], ["diagnosis", "Current diagnosis", "", "Routine evaluation"], ["visitStatus", "Visit status", "select", "Waiting"], ["priority", "Priority", "select", "Medium"], ["room", "Room / bed", "", "Clinic room 2"], ["lastVisit", "Last visit date", "", "2026-05-20"], ["nextVisit", "Next visit", "", "2026-06-05"], ["vitals", "Vitals", "", "120/80 BP, 72 BPM"], ["tests", "Lab / imaging tests", "", "CBC, X-ray, MRI"], ["meds", "Medication", "", "Amoxicillin 500mg"], ["treatmentPlan", "Treatment plan", "textarea", "Treatment steps, medication changes, follow-up plan..."], ["visitHistory", "Visit history", "textarea", "Visit 1: symptoms, diagnosis, treatment. Visit 2: progress and changes..."], ["progress", "Progress notes", "textarea", "Pain reduced, blood pressure improved, new symptoms..."], ["details", "Clinical notes", "textarea", "Symptoms, plan, risk factors, doctor notes..."]] }
  ]);
  else if (role === "ceo") renderCollectionPanel("Executive Ventures & Partners", [
    { title: "Partners / Ventures", key: "partners", fields: [["name", "Partner full name", "", "Hassan El-Sayed"], ["company", "Company", "", "Delta Ventures"], ["email", "Email", "", "partner@company.com"], ["phone", "Phone", "", "+48 111 222 333"], ["linkedin", "LinkedIn", "", "linkedin.com/in/name"], ["allocation", "Allocation", "", "18.5% equity"], ["subsidiary", "Subsidiary", "", "Delta Holdings"], ["dealStage", "Deal status", "select", "Board review"], ["priority", "Priority", "select", "High"], ["value", "Deal value", "", "$2.4M"], ["nextAction", "Next action", "", "Cash flow review"], ["details", "Executive notes", "textarea", "Decision notes, risks, stakeholders..."]] }
  ]);
  else if (role === "teacher") renderCollectionPanel("Teacher Class & Exam Control", [
    { title: "Teaching Schedule", key: "courses", fields: [["subject", "Class / subject", "", "Advanced Compilers"], ["teacher", "Instructor", "", "Prof. Bassem"], ["cohort", "Class group", "", "CS-MSc-2"], ["credits", "Credits", "", "6"], ["room", "Room", "", "Lab 4B"], ["hours", "Class time", "", "Mon/Wed 10:00"], ["exam", "Exam date", "", "2026-06-12"], ["status", "Teaching status", "select", "Active"], ["priority", "Priority", "select", "Medium"], ["attendance", "Attendance status", "select", "Pending"], ["progress", "Class progress", "", "Week 4 / 12"], ["notes", "Lesson plan notes", "textarea", "Objectives, materials, homework..."]] }
  ]);
  else if (role === "student") renderCollectionPanel("Student Study Dashboard", [
    { title: "Enrolled Courses", key: "courses", fields: [["subject", "Course", "", "Advanced Compilers"], ["teacher", "Teacher", "", "Prof. Bassem"], ["cohort", "Group", "", "CS-MSc-2"], ["credits", "Credits", "", "6"], ["room", "Room", "", "Lecture 4B"], ["hours", "Class time", "", "Mon/Wed 10:00"], ["exam", "Exam date", "", "2026-06-12"], ["status", "Study status", "select", "Studying"], ["priority", "Priority", "select", "Medium"], ["attendance", "Attendance", "select", "Present"], ["progress", "Study progress", "", "40%"], ["notes", "Study notes", "textarea", "Exam topics, weak areas, reminders..."]] }
  ]);
  else if (role === "general") renderCollectionPanel("Office Team Workspace", [
    { title: "Daily Work & Requests", key: "officeRecords", fields: [["taskName", "Work item / request", "", "Prepare weekly operations report"], ["owner", "Owner", "", "Marta Kowalska"], ["department", "Department", "select", "Operations"], ["status", "Status", "select", "Active"], ["priority", "Priority", "select", "Medium"], ["dueDate", "Due date", "", "2026-06-01"], ["country", "Country", "country", "Poland"], ["phone", "Contact phone", "phone", "+48 111 222 333"], ["budget", "Budget / cost", "", "$2,000"], ["notes", "Work notes", "textarea", "Requirements, approvals, files, blockers, follow-up..."]] },
    { title: "Employees & Company Contacts", key: "officePeople", fields: [["name", "Full name", "", "Marta Kowalska"], ["roleTitle", "Role / position", "select", "Team Coordinator"], ["department", "Department", "select", "Operations"], ["email", "Email", "", "marta@company.com"], ["phone", "Phone", "phone", "+48 111 222 333"], ["country", "Country", "country", "Poland"], ["status", "Work status", "select", "Active"], ["manager", "Manager / reports to", "", "Office Lead"], ["notes", "Team notes", "textarea", "Skills, schedule, responsibilities, access notes..."]] },
    { title: "Meetings, Congress & Company Events", key: "officeEvents", fields: [["eventName", "Event / meeting name", "", "Regional industry congress"], ["owner", "Owner", "", "Office Lead"], ["eventType", "Event type", "select", "Congress"], ["date", "Date", "", "2026-06-14"], ["location", "Location", "", "Warsaw Expo"], ["country", "Country", "country", "Poland"], ["status", "Event status", "select", "Planning"], ["attendees", "Attendees", "", "35"], ["budget", "Budget", "", "$8,000"], ["notes", "Event notes", "textarea", "Agenda, speakers, travel, materials, invitations..."]] }
  ]);
}

function renderCollectionPanel(title, sections) {
  $("rolePanel").innerHTML = `<div class="panel-head"><div><p class="eyebrow">AI structured CRM</p><h2>${escapeHtml(title)}</h2></div><span class="record-chip">${escapeHtml(roleDisplayName(state.session.role))}</span></div>${sections.map(sectionTemplate).join("")}`;
  $("recordsPanel").innerHTML = `<div class="panel-head"><div><p class="eyebrow">Saved database</p><h2>${escapeHtml(roleDisplayName(state.session.role))} records</h2></div></div>${realEstateReviewSummary()}${sections.map(recordsSectionTemplate).join("")}`;
  $("rolePanel").querySelectorAll("form").forEach((form) => form.addEventListener("submit", saveCollectionRecord));
  $("recordsPanel").querySelectorAll("[data-record-open]").forEach((btn) => btn.addEventListener("click", openRecordDialog));
  $("recordsPanel").querySelectorAll("[data-record-filter]").forEach((input) => input.addEventListener("input", filterRecordSection));
  colorizeCrmSelects();
}

function realEstateReviewSummary() {
  if (state.session.role !== "realestate") return "";
  const items = state.realestateReviews || [];
  const pending = items.filter((item) => /pending|review|planning/i.test(`${item.status} ${item.result}`)).length;
  const done = items.filter((item) => /complete|done|successful|closed|rejected/i.test(`${item.status} ${item.result}`)).length;
  const closed = items.filter((item) => /closed deal|signed|successful/i.test(`${item.result} ${item.status}`)).length;
  return `<section class="review-summary">
    <div><span>Reviews pending</span><strong>${pending}</strong></div>
    <div><span>Reviews done</span><strong>${done}</strong></div>
    <div><span>Closed deals</span><strong>${closed}</strong></div>
  </section>`;
}

function colorizeCrmSelects(root = document) {
  root.querySelectorAll("#rolePanel select, #recordDialog select").forEach((select) => {
    const apply = () => {
      select.classList.remove("select-high", "select-medium", "select-low", "select-normal");
      const raw = select.value.toLowerCase();
      if (/hot|top|high|urgent|waiting|new|pending/.test(raw)) select.classList.add("select-high");
      else if (/qualified|active|medium|warm|board|room|planning|studying|revision|review/.test(raw)) select.classList.add("select-medium");
      else if (/closed|complete|signed|successful|low|done|recorded/.test(raw)) select.classList.add("select-low");
      else select.classList.add("select-normal");
    };
    apply();
    select.addEventListener("change", apply);
  });
}

function sectionTemplate(section) {
  return `<section class="collection" data-key="${section.key}" data-fields="${section.fields.map(([k]) => k).join(",")}" data-types="${section.fields.map(([, , type]) => type || "").join("|")}" data-labels="${escapeHtml(section.fields.map(([, label]) => label).join("|"))}">
    <h3>${escapeHtml(section.title)}</h3>
    <form class="form-grid collection-form">
      <input type="hidden" name="id">
      ${section.fields.map(([key, label, type, placeholder]) => fieldTemplate(key, label, type, placeholder)).join("")}
      <div class="form-submit-row"><button class="save-action" type="submit">Save record</button></div>
    </form>
  </section>`;
}

function recordsSectionTemplate(section) {
  const sortedRecords = [...state[section.key]].sort((a, b) => recordPriorityScore(b) - recordPriorityScore(a));
  return `<section class="collection records-section" data-key="${section.key}" data-fields="${section.fields.map(([k]) => k).join(",")}" data-types="${section.fields.map(([, , type]) => type || "").join("|")}" data-labels="${escapeHtml(section.fields.map(([, label]) => label).join("|"))}">
    <div class="records-section-head">
      <h3>${escapeHtml(section.title)}</h3>
      <input data-record-filter placeholder="Filter name, phone, status, notes...">
    </div>
    <div class="collection-grid wide-record-grid">${sortedRecords.map((item) => recordTemplate(section, item)).join("") || `<div class="empty-state">No records yet. Add the first row above or ask Mondaily AI.</div>`}</div>
  </section>`;
}

function filterRecordSection(event) {
  const query = event.currentTarget.value.trim().toLowerCase();
  const section = event.currentTarget.closest(".records-section");
  section.querySelectorAll("[data-record-open]").forEach((row) => {
    row.classList.toggle("hidden", query && !row.dataset.search.includes(query));
  });
}

function fieldTemplate(key, label, type, placeholder) {
  const wide = type === "textarea" || /notes|details|nextStep|nextAction|nextMilestone/i.test(key) ? "wide-field" : "";
  if (type === "select") {
    return `<label class="${wide}">${escapeHtml(label)}<select name="${key}">${selectOptionsFor(key, placeholder).map((option) => `<option value="${escapeHtml(option)}" ${option === placeholder ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
  }
  if (type === "country") {
    return `<label class="${wide}">${escapeHtml(label)}<select name="${key}">${["Poland", "Egypt", "United States", "United Kingdom", "Germany", "France", "Italy", "Spain", "United Arab Emirates", "Saudi Arabia", "Canada"].map((option) => `<option value="${option}">${option}</option>`).join("")}</select></label>`;
  }
  if (type === "phone") {
    return `<label class="${wide}">${escapeHtml(label)}<div class="phone-field"><select name="${key}Code"><option value="+48">+48 PL</option><option value="+20">+20 EG</option><option value="+1">+1 US</option><option value="+44">+44 UK</option><option value="+49">+49 DE</option><option value="+33">+33 FR</option><option value="+39">+39 IT</option><option value="+971">+971 UAE</option><option value="+966">+966 SA</option></select><input name="${key}" placeholder="${escapeHtml(placeholder || label)}"></div></label>`;
  }
  if (type === "textarea") {
    return `<label class="extra-wide-field">${escapeHtml(label)}<textarea name="${key}" placeholder="${escapeHtml(placeholder || label)}"></textarea></label>`;
  }
  return `<label class="${wide}">${escapeHtml(label)}<input name="${key}" placeholder="${escapeHtml(placeholder || label)}"></label>`;
}

function selectOptionsFor(key, placeholder) {
  if (/gender/i.test(key)) return ["Female", "Male", "Other"];
  if (/blood/i.test(key)) return ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];
  if (/department/i.test(key)) return ["Operations", "Finance", "HR", "Sales", "Admin", "Legal", "Support"];
  if (/roleTitle/i.test(key)) return ["Team Coordinator", "Manager", "Employee", "Assistant", "Project Lead", "Finance Officer", "HR Specialist", "Support Agent"];
  if (/eventType/i.test(key)) return ["Congress", "Meeting", "Workshop", "Training", "Client visit", "Company event"];
  if (/leadScore/i.test(key)) return ["Hot", "Warm", "Cold"];
  if (/risk/i.test(key)) return ["Low", "Medium", "High"];
  if (/phase/i.test(key)) return ["Planning", "Permit review", "Construction", "Handover", "Complete"];
  if (/result/i.test(key)) return ["In review", "Successful", "Closed deal", "Rejected", "Follow up"];
  if (/attendance/i.test(key)) return ["Pending", "Present", "Missing", "Recorded"];
  if (/priority/i.test(key)) return ["Low", "Medium", "High", "Top"];
  if (/status|stage/i.test(key)) return ["New", "Active", "Planning", "Pending", "Waiting", "In room", "Qualified", "Board review", "Studying", "Revision", "Signed", "Successful", "Complete", "Closed"];
  return [placeholder || "Active", "New", "In progress", "Complete"];
}

function recordTemplate(section, item) {
  const mainKey = section.fields[0][0];
  const meta = section.fields.slice(1, 5).map(([key]) => item[key]).filter(Boolean).join(" · ");
  const level = recordStatusLevel(item);
  const searchable = section.fields.map(([key]) => item[key]).filter(Boolean).join(" ").toLowerCase();
  return `<button class="record-row ${recordStatusClass(item)}" type="button" data-record-open="${item.id}" data-key="${section.key}" data-search="${escapeHtml(searchable)}">
    <span class="record-colorbar"></span>
    <span class="record-main">
      <strong>${escapeHtml(item[mainKey])}</strong>
      <em class="record-level ${level.className}">${escapeHtml(level.label)}</em>
    </span>
    <span class="record-row-meta">${escapeHtml(meta || "Open full data")}</span>
  </button>`;
}

function recordStatusLevel(item) {
  const raw = `${item.stage || item.status || item.dealStage || item.visitStatus || item.risk || item.priority || item.leadScore || ""}`.toLowerCase();
  const display = item.stage || item.status || item.dealStage || item.visitStatus || item.priority || item.leadScore || "Normal";
  const exactClass = `status-${String(display).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "normal"}`;
  if (/hot|top|high|urgent|waiting|new|pending/.test(raw)) return { label: display, className: `level-high ${exactClass}` };
  if (/qualified|active|medium|warm|board|room|planning|studying|revision|review/.test(raw)) return { label: display, className: `level-medium ${exactClass}` };
  if (/closed|complete|signed|successful|low|done|recorded/.test(raw)) return { label: display, className: `level-low ${exactClass}` };
  return { label: "Normal record", className: "level-normal status-normal" };
}

function recordStatusClass(item) {
  const raw = `${item.stage || item.status || item.dealStage || item.visitStatus || item.risk || item.priority || item.leadScore || ""}`.toLowerCase();
  if (/hot|top|high|urgent|waiting|new|pending/.test(raw)) return "status-hot";
  if (/qualified|active|medium|warm|board|room|planning|studying|revision|review/.test(raw)) return "status-warm";
  if (/closed|complete|signed|successful|low|done|recorded/.test(raw)) return "status-cool";
  return "status-neutral";
}

function recordPriorityScore(item) {
  const raw = `${item.stage || item.status || item.dealStage || item.visitStatus || item.risk || item.priority || item.leadScore || ""}`.toLowerCase();
  if (/hot|top|high|urgent|waiting|new|pending/.test(raw)) return 4;
  if (/qualified|active|medium|warm|board|room|planning|studying|revision|review/.test(raw)) return 3;
  if (/normal/.test(raw)) return 2;
  if (/closed|complete|signed|successful|low|done|recorded/.test(raw)) return 1;
  return 2;
}

function saveCollectionRecord(event) {
  event.preventDefault();
  const section = event.currentTarget.closest(".collection");
  const key = section.dataset.key;
  const fields = section.dataset.fields.split(",");
  const form = event.currentTarget;
  const payload = { id: form.elements.id.value || uid() };
  fields.forEach((field) => {
    const code = form[`${field}Code`]?.value;
    payload[field] = code ? `${code} ${form[field].value.trim()}`.trim() : form[field].value.trim();
  });
  const index = state[key].findIndex((item) => item.id === payload.id);
  if (index >= 0) state[key][index] = payload;
  else state[key].unshift(payload);
  saveState();
  renderRolePanel();
  toast("Record saved", payload[fields[0]]);
}

function editCollectionRecord(event) {
  const key = event.currentTarget.dataset.key;
  const item = state[key].find((x) => x.id === event.currentTarget.dataset.edit);
  const section = event.currentTarget.closest(".collection");
  const form = section.querySelector("form");
  form.elements.id.value = item.id;
  section.dataset.fields.split(",").forEach((field) => form[field].value = item[field] || "");
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function openRecordDialog(event) {
  const key = event.currentTarget.dataset.key;
  const id = event.currentTarget.dataset.recordOpen;
  showRecordDialog(key, id);
}

function showRecordDialog(key, id) {
  const item = state[key].find((x) => x.id === id);
  const section = $(`recordsPanel`).querySelector(`.records-section[data-key="${key}"]`);
  const fields = section.dataset.fields.split(",");
  const labels = section.dataset.labels ? section.dataset.labels.split("|") : [...section.querySelectorAll("form label")].map((label) => label.childNodes[0].textContent.trim());
  const types = section.dataset.types ? section.dataset.types.split("|") : fields.map(() => "");
  if (!item) return;
  if (!Array.isArray(item.sessions)) item.sessions = [];
  $("recordDialogType").textContent = key.replace(/([A-Z])/g, " $1");
  $("recordDialogTitle").textContent = item[fields[0]] || "Record";
  $("recordDialogBody").innerHTML = fields.map((field, index) => `
    <div class="record-detail">
      <span>${escapeHtml(labels[index] || field)}</span>
      ${dialogFieldTemplate(field, labels[index] || field, types[index], item[field] || "")}
    </div>
  `).join("") + recordSessionTemplate(item, key);
  const startBtn = $("recordDialogBody").querySelector("[data-record-session-start]");
  const endBtn = $("recordDialogBody").querySelector("[data-record-session-end]");
  const logsBtn = $("recordDialogBody").querySelector("[data-record-session-logs]");
  if (startBtn) startBtn.addEventListener("click", () => startRecordSession(item, fields[0], key));
  if (endBtn) endBtn.addEventListener("click", () => endRecordSession(item, fields[0], key));
  if (logsBtn) logsBtn.addEventListener("click", () => openTimeLogDrawer(item.sessions, `${item[fields[0]] || "Record"} sessions`));
  colorizeCrmSelects($("recordDialog"));
  $("recordDialogEditBtn").onclick = () => {
  $("recordDialogBody").querySelectorAll("[data-dialog-field]").forEach((input) => {
      item[input.dataset.dialogField] = input.value.trim();
    });
    saveState();
    $("recordDialog").close();
    renderRolePanel();
    toast("Record updated", item[fields[0]] || "Saved");
  };
  $("recordDialogDeleteBtn").onclick = () => {
    state[key] = state[key].filter((x) => x.id !== id);
    saveState();
    $("recordDialog").close();
    renderRolePanel();
  };
  $("recordDialog").showModal();
}

function dialogFieldTemplate(field, label, type, value) {
  if (type === "select") {
    const options = selectOptionsFor(field, value || label);
    return `<select data-dialog-field="${field}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
  }
  if (type === "textarea") return `<textarea data-dialog-field="${field}" placeholder="${escapeHtml(label)}">${escapeHtml(value)}</textarea>`;
  return `<input data-dialog-field="${field}" value="${escapeHtml(value)}" placeholder="${escapeHtml(label)}">`;
}

function recordSessionTemplate(item, key) {
  const active = item.activeSession;
  const total = item.sessions.reduce((sum, log) => sum + (log.durationSeconds || 0), 0);
  const label = key === "patients" ? "Patient visit timer" : "Record session timer";
  const sessionFields = active ? sessionFieldsTemplate(key, active) : "";
  return `
    <div class="record-detail record-session-panel">
      <span>${label}</span>
      <strong>${active ? `Started ${escapeHtml(formatDateTime(active.startedAt))}` : `${item.sessions.length} sessions · ${formatDuration(total)}`}</strong>
      ${sessionFields}
      <div class="record-session-actions">
        <button class="small-btn" type="button" data-record-session-start ${active ? "disabled" : ""}>Start</button>
        <button class="small-btn" type="button" data-record-session-end ${active ? "" : "disabled"}>End</button>
        <button class="small-btn" type="button" data-record-session-logs>Stats</button>
      </div>
    </div>
  `;
}

function sessionFieldsTemplate(key, active) {
  if (key === "patients") {
    return `<div class="session-form">
      <input data-session-field="reason" value="${escapeHtml(active.reason || "")}" placeholder="Visit reason / complaint">
      <input data-session-field="vitals" value="${escapeHtml(active.vitals || "")}" placeholder="Vitals during visit">
      <input data-session-field="diagnosis" value="${escapeHtml(active.diagnosis || "")}" placeholder="Diagnosis / finding">
      <textarea data-session-field="treatment" placeholder="Treatment, prescription, follow-up">${escapeHtml(active.treatment || "")}</textarea>
      <textarea data-session-field="notes" placeholder="Doctor visit notes">${escapeHtml(active.notes || "")}</textarea>
    </div>`;
  }
  return `<div class="session-form">
    <input data-session-field="status" value="${escapeHtml(active.status || "")}" placeholder="Session result / status">
    <textarea data-session-field="notes" placeholder="Session notes and next action">${escapeHtml(active.notes || "")}</textarea>
  </div>`;
}

function startRecordSession(item, mainKey, key) {
  if (item.activeSession) return;
  item.activeSession = { id: uid(), user: state.session.name, startedAt: new Date().toISOString(), context: item[mainKey] || "CRM record" };
  saveState();
  renderRolePanel();
  showRecordDialog(key, item.id);
  toast("Session started", `${item[mainKey] || "Record"} · ${formatDateTime(item.activeSession.startedAt)}`);
}

function endRecordSession(item, mainKey, key) {
  if (!item.activeSession) return;
  $("recordDialogBody").querySelectorAll("[data-session-field]").forEach((field) => {
    item.activeSession[field.dataset.sessionField] = field.value.trim();
  });
  const endedAt = new Date().toISOString();
  const log = {
    ...item.activeSession,
    endedAt,
    durationSeconds: secondsBetween(item.activeSession.startedAt, endedAt)
  };
  item.sessions.unshift(log);
  if (key === "patients") {
    item.lastVisit = todayIso();
    item.visitHistory = `${item.visitHistory || ""}\n${formatDateTime(log.startedAt)} - ${formatDateTime(log.endedAt)} (${formatDuration(log.durationSeconds)}): ${log.reason || log.diagnosis || log.notes || "Visit recorded."}`.trim();
    if (log.vitals) item.vitals = log.vitals;
    if (log.diagnosis) item.diagnosis = log.diagnosis;
    if (log.treatment) item.treatmentPlan = log.treatment;
  }
  item.activeSession = null;
  saveState();
  renderRolePanel();
  showRecordDialog(key, item.id);
  toast("Session recorded", `${item[mainKey] || "Record"} · ${formatDuration(log.durationSeconds)}`);
}

function deleteCollectionRecord(event) {
  const key = event.currentTarget.dataset.key;
  state[key] = state[key].filter((x) => x.id !== event.currentTarget.dataset.delete);
  saveState();
  renderRolePanel();
}

function startRoleTimer() {
  if (roleTimer) return;
  if (!state.activeTimerSession) {
    const startedAt = new Date().toISOString();
    state.activeTimerSession = { id: uid(), context: roleDisplayName(state.session.role), user: state.session.name, startedAt };
    roleTimerSeconds = 0;
    renderRoleTimer();
    saveState();
    toast("Timer started", formatDateTime(startedAt));
  }
  roleTimer = setInterval(() => {
    roleTimerSeconds++;
    breakReminderSeconds++;
    renderRoleTimer();
    if (breakReminderSeconds >= 7200) {
      breakReminderSeconds = 0;
      toast("Break reminder", "You have been focused for 2 hours. Take a short coffee break.");
    }
  }, 1000);
}

function pauseRoleTimer() {
  clearInterval(roleTimer);
  roleTimer = null;
  finishActiveTimer("Paused");
}

function finishActiveTimer(reason) {
  if (state.activeTimerSession) {
    const endedAt = new Date().toISOString();
    const log = {
      ...state.activeTimerSession,
      reason,
      endedAt,
      durationSeconds: secondsBetween(state.activeTimerSession.startedAt, endedAt)
    };
    state.timeLogs.unshift(log);
    state.activeTimerSession = null;
    saveState();
    if (reason !== "Logout / break") toast("Timer recorded", `${formatDuration(log.durationSeconds)} saved.`);
    if (!$("timeLogDrawer").classList.contains("hidden")) openTimeLogDrawer();
  }
}

function resetRoleTimer() {
  pauseRoleTimer();
  roleTimerSeconds = 0;
  renderRoleTimer();
}

function renderRoleTimer() {
  const h = Math.floor(roleTimerSeconds / 3600);
  const m = Math.floor((roleTimerSeconds % 3600) / 60);
  const s = roleTimerSeconds % 60;
  $("roleTimerDisplay").textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function secondsBetween(start, end) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function openTimeLogDrawer(logs = state.timeLogs, title = "Work statistics") {
  $("timeLogTitle").textContent = title;
  const total = logs.reduce((sum, item) => sum + (item.durationSeconds || 0), 0);
  const active = title === "Work statistics" && state.activeTimerSession ? state.activeTimerSession : null;
  $("timeLogStats").innerHTML = `
    <div><span>Total work time</span><strong>${formatDuration(total)}</strong></div>
    <div><span>Sessions logged</span><strong>${logs.length}</strong></div>
    <div><span>Average session</span><strong>${logs.length ? formatDuration(Math.round(total / logs.length)) : "0m 0s"}</strong></div>
  `;
  $("timeLogList").innerHTML = `${active ? `<article class="time-log-item active"><strong>Active now</strong><span>${escapeHtml(active.user || state.session.name)} · started ${formatDateTime(active.startedAt)}</span><em>Running</em></article>` : ""}${logs.length ? logs.map((log) => `
    <article class="time-log-item">
      <strong>${escapeHtml(log.context || "Workspace session")}</strong>
      <span>${escapeHtml(log.user || state.session.name)} · ${formatDateTime(log.startedAt)} → ${formatDateTime(log.endedAt)}${log.reason ? ` · ${escapeHtml(log.reason)}` : ""}</span>
      <em>${formatDuration(log.durationSeconds || 0)}</em>
    </article>
  `).join("") : `<div class="card-meta">No time records yet. Start and pause the timer to save one.</div>`}`;
  $("timeLogDrawer").classList.remove("hidden");
}

function renderNotes() {
  const active = state.notes.filter((note) => !note.done);
  const done = state.notes.filter((note) => note.done);
  $("activeTasksList").innerHTML = active.length ? active.map(noteTemplate).join("") : `<div class="card-meta">No open tasks.</div>`;
  $("doneTasksList").innerHTML = done.length ? done.map(noteTemplate).join("") : `<div class="card-meta">No closed tasks.</div>`;
  document.querySelectorAll("[data-note-edit]").forEach((el) => el.addEventListener("blur", (event) => {
    const note = state.notes.find((n) => n.id === event.currentTarget.dataset.noteEdit);
    if (note) note.content = event.currentTarget.textContent.trim();
    saveState();
  }));
  document.querySelectorAll("[data-note-toggle], [data-note-kind], [data-note-delete]").forEach((btn) => btn.addEventListener("click", handleNoteAction));
}

function noteTemplate(note) {
  return `<article class="task-item ${note.done ? "done" : ""}">
    <div class="card-title"><span>${note.task ? "Task" : "Note"}</span><span>${note.done ? "Closed" : "Open"}</span></div>
    <div class="card-meta" contenteditable="true" data-note-edit="${note.id}">${escapeHtml(note.content)}</div>
    <div class="card-actions">
      <button class="small-btn" data-note-toggle="${note.id}">${note.done ? "Reopen" : "Done"}</button>
      <button class="small-btn" data-note-kind="${note.id}">${note.task ? "Note" : "Task"}</button>
      <button class="small-btn" data-note-delete="${note.id}">Delete</button>
    </div>
  </article>`;
}

function handleNoteAction(event) {
  const btn = event.currentTarget;
  const id = btn.dataset.noteToggle || btn.dataset.noteKind || btn.dataset.noteDelete;
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  if (btn.dataset.noteToggle) note.done = !note.done;
  if (btn.dataset.noteKind) note.task = !note.task;
  if (btn.dataset.noteDelete) state.notes = state.notes.filter((n) => n.id !== id);
  saveState();
  renderNotes();
}

function openCompanyChat() {
  renderCompanyChat();
  $("companyChatDrawer").classList.remove("hidden");
}

function renderCompanyChat() {
  if (!$("invitedUsersList")) return;
  const users = state.invitedUsers || [];
  $("invitedUsersList").innerHTML = users.length
    ? users.map((user) => `<span class="team-pill">${escapeHtml(user.email)}</span>`).join("")
    : `<span class="card-meta">No invited teammates yet.</span>`;
  const messages = state.chatMessages || [];
  $("chatMessagesList").innerHTML = messages.length
    ? messages.map((msg) => `
      <article class="chat-message ${msg.author === state.session?.name ? "mine" : ""}">
        <strong>${escapeHtml(msg.author)}</strong>
        <p>${escapeHtml(msg.text)}</p>
        <span>${escapeHtml(msg.time)}</span>
      </article>
    `).join("")
    : `<div class="card-meta">No messages yet.</div>`;
  $("chatMessagesList").scrollTop = $("chatMessagesList").scrollHeight;
}

function inviteCompanyUser() {
  const email = $("inviteEmailInput").value.trim().toLowerCase();
  if (!email || !/@/.test(email)) {
    toast("Invite needs email", "Add a valid teammate email.");
    return;
  }
  if (!state.invitedUsers.some((user) => user.email === email)) {
    state.invitedUsers.push({ id: uid(), email, invitedAt: todayIso() });
    state.chatMessages.push({ id: uid(), author: "Mondaily AI", text: `${email} was invited to ${state.session.company}.`, time: todayIso() });
  }
  $("inviteEmailInput").value = "";
  saveState();
  renderCompanyChat();
  toast("Invite saved", email);
}

function sendCompanyMessage() {
  const text = $("chatMessageInput").value.trim();
  if (!text) return;
  state.chatMessages.push({ id: uid(), author: state.session.name, text, time: todayIso() });
  $("chatMessageInput").value = "";
  saveState();
  renderCompanyChat();
}

function crmSearchBuckets() {
  const role = state.session?.role || "realestate";
  const common = [
    ["Appointment", "appointments", state.appointments, ["title", "date", "time", "priority", "details"]],
    ["Note", "notes", state.notes, ["content"]]
  ];
  const roleBuckets = {
    realestate: [
      ["Project", "realestateProjects", state.realestateProjects, ["name", "value", "location", "units", "phase", "status", "priority", "zoning", "nextMilestone", "risk"]],
      ["Client", "realestateClients", state.realestateClients, ["name", "email", "phone", "budget", "intent", "stage", "priority", "leadScore", "area", "country", "nextStep", "notes"]],
      ["Review", "realestateReviews", state.realestateReviews, ["reviewName", "property", "client", "status", "priority", "reviewDate", "result", "successRate", "dealValue", "notes"]]
    ],
    doctor: [["Patient", "patients", state.patients, ["name", "email", "phone", "country", "age", "gender", "blood", "allergies", "diagnosis", "visitStatus", "priority", "room", "lastVisit", "nextVisit", "vitals", "tests", "meds", "treatmentPlan", "visitHistory", "progress", "details"]]],
    ceo: [["Partner", "partners", state.partners, ["name", "company", "email", "phone", "linkedin", "allocation", "subsidiary", "dealStage", "priority", "value", "nextAction", "details"]]],
    teacher: [["Class", "courses", state.courses, ["subject", "teacher", "cohort", "credits", "room", "hours", "exam", "status", "priority", "notes"]]],
    student: [["Course", "courses", state.courses, ["subject", "teacher", "cohort", "credits", "room", "hours", "exam", "status", "priority", "notes"]]],
    general: [
      ["Office work", "officeRecords", state.officeRecords, ["taskName", "owner", "department", "status", "priority", "dueDate", "country", "phone", "budget", "notes"]],
      ["Employee", "officePeople", state.officePeople, ["name", "roleTitle", "department", "email", "phone", "country", "status", "manager", "notes"]],
      ["Event", "officeEvents", state.officeEvents, ["eventName", "owner", "eventType", "date", "location", "country", "status", "attendees", "budget", "notes"]]
    ]
  };
  return [...common, ...(roleBuckets[role] || [])];
}

function findCrmRecord(query) {
  const q = query.trim().toLowerCase();
  return crmSearchBuckets()
    .filter(([, key]) => !["appointments", "notes"].includes(key))
    .flatMap(([type, key, items, fields]) => items
      .filter((item) => !q || type.toLowerCase().includes(q) || fields.some((field) => String(item[field] || "").toLowerCase().includes(q)))
      .map((item) => ({ type, key, item, id: item.id, title: item[fields[0]], meta: fields.slice(1).map((f) => item[f]).filter(Boolean).join(" · ") })));
}

function collectSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return crmSearchBuckets().flatMap(([type, key, items, fields]) => items
    .filter((item) => type.toLowerCase().includes(q) || fields.some((field) => String(item[field] || "").toLowerCase().includes(q)))
    .map((item) => ({ type, key, id: item.id, title: item[fields[0]], meta: fields.slice(1).map((f) => item[f]).filter(Boolean).join(" · ") })));
}

function renderSearch(query) {
  const host = $("searchResults");
  const results = collectSearchResults(query);
  host.classList.toggle("hidden", !query.trim());
  host.innerHTML = results.length ? results.map((r) => `
    <button class="search-hit" type="button" data-search-open="${escapeHtml(r.id)}" data-key="${escapeHtml(r.key)}"><strong>${escapeHtml(r.type)}: ${escapeHtml(r.title)}</strong><span>${escapeHtml(r.meta)}</span></button>
  `).join("") : `<div class="search-hit"><span>No local matches.</span></div>`;
  host.querySelectorAll("[data-search-open]").forEach((btn) => btn.addEventListener("click", () => {
    if (["appointments", "notes"].includes(btn.dataset.key)) return;
    showRecordDialog(btn.dataset.key, btn.dataset.searchOpen);
  }));
}

function bindGames() {
  $("breakBtn").addEventListener("click", openBreak);
  $("exitBreakBtn").addEventListener("click", closeBreak);
  $("gameExitBtn").addEventListener("click", closeBreak);
  $("gameBackBtn").addEventListener("click", showGameMenu);
  document.querySelectorAll(".game-choice").forEach((btn) => btn.addEventListener("click", () => startGame(btn.dataset.game)));
  window.addEventListener("keydown", handleGameKeys);
  $("gameCanvas").addEventListener("mousemove", (event) => {
    if (activeGame !== "breakout") return;
    const rect = $("gameCanvas").getBoundingClientRect();
    const scale = $("gameCanvas").width / rect.width;
    game.paddleX = Math.max(0, Math.min($("gameCanvas").width - game.paddleW, (event.clientX - rect.left) * scale - game.paddleW / 2));
  });
}

function openBreak() {
  $("breakOverlay").classList.remove("hidden");
  breakSeconds = 0;
  clearInterval(breakTimer);
  breakTimer = setInterval(() => {
    breakSeconds++;
    $("breakTimer").textContent = `${String(Math.floor(breakSeconds / 60)).padStart(2, "0")}:${String(breakSeconds % 60).padStart(2, "0")}`;
  }, 1000);
  showGameMenu();
}

function closeBreak() {
  $("breakOverlay").classList.add("hidden");
  clearInterval(breakTimer);
  stopGame();
}

function showGameMenu() {
  stopGame();
  $("gameMenu").classList.remove("hidden");
  $("gameStage").classList.add("hidden");
}

function startGame(name) {
  activeGame = name;
  $("gameMenu").classList.add("hidden");
  $("gameStage").classList.remove("hidden");
  $("gameName").textContent = name === "breakout" ? "Chronos Strike" : name === "snake" ? "Retro Snake" : "Matrix Block Fall";
  $("gameScore").textContent = "0";
  initGameState();
  stopGame();
  animationId = requestAnimationFrame(gameLoop);
}

function stopGame() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
}

function initGameState() {
  const c = $("gameCanvas");
  game = { score: 0, tick: 0, dir: { x: 1, y: 0 }, nextDir: { x: 1, y: 0 } };
  if (activeGame === "breakout") {
    game = { ...game, ballX: c.width / 2, ballY: c.height - 60, ballDX: 4, ballDY: -4, ballR: 8, paddleW: 110, paddleH: 13, paddleX: c.width / 2 - 55, bricks: [] };
    for (let r = 0; r < 5; r++) for (let col = 0; col < 9; col++) game.bricks.push({ x: 44 + col * 72, y: 42 + r * 28, w: 58, h: 16, alive: true });
  } else if (activeGame === "snake") {
    game.snake = [{ x: 10, y: 10 }];
    game.food = { x: 22, y: 11 };
  } else {
    game.grid = Array.from({ length: 20 }, () => Array(10).fill(""));
    game.dropCounter = 0;
    game.dropSpeed = 26;
    spawnBlock();
  }
}

function spawnBlock() {
  const piece = clone(tetrisPieces[Math.floor(Math.random() * tetrisPieces.length)]);
  game.block = { x: 3, y: 0, shape: piece.shape, color: piece.color };
  if (collides(game.block.x, game.block.y, game.block.shape)) {
    game.grid = Array.from({ length: 20 }, () => Array(10).fill(""));
    game.score = 0;
  }
}

function gameLoop() {
  const c = $("gameCanvas");
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  if (activeGame === "breakout") drawBreakout(ctx, c);
  if (activeGame === "snake") drawSnake(ctx, c);
  if (activeGame === "blocks") drawBlocks(ctx, c);
  $("gameScore").textContent = game.score;
  animationId = requestAnimationFrame(gameLoop);
}

function drawBreakout(ctx, c) {
  game.bricks.forEach((b) => {
    if (!b.alive) return;
    ctx.fillStyle = b.y < 70 ? "#fb7185" : b.y < 100 ? "#a78bfa" : "#38bdf8";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    if (game.ballX > b.x && game.ballX < b.x + b.w && game.ballY > b.y && game.ballY < b.y + b.h) {
      b.alive = false; game.ballDY *= -1; game.score += 5;
    }
  });
  ctx.fillStyle = "#e5eefb";
  ctx.beginPath(); ctx.arc(game.ballX, game.ballY, game.ballR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#38bdf8"; ctx.fillRect(game.paddleX, c.height - 30, game.paddleW, game.paddleH);
  if (game.ballX + game.ballDX < game.ballR || game.ballX + game.ballDX > c.width - game.ballR) game.ballDX *= -1;
  if (game.ballY + game.ballDY < game.ballR) game.ballDY *= -1;
  if (game.ballY + game.ballDY > c.height - 38 && game.ballX > game.paddleX && game.ballX < game.paddleX + game.paddleW) game.ballDY = -Math.abs(game.ballDY);
  if (game.ballY > c.height + 20 || game.bricks.every((b) => !b.alive)) initGameState();
  game.ballX += game.ballDX; game.ballY += game.ballDY;
}

function drawSnake(ctx) {
  game.tick++;
  const size = 21;
  if (game.tick % 7 === 0) {
    game.dir = game.nextDir;
    const head = { x: game.snake[0].x + game.dir.x, y: game.snake[0].y + game.dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= 34 || head.y >= 20 || game.snake.some((s) => s.x === head.x && s.y === head.y)) initGameState();
    else {
      game.snake.unshift(head);
      if (head.x === game.food.x && head.y === game.food.y) {
        game.score += 10;
        game.food = { x: Math.floor(Math.random() * 34), y: Math.floor(Math.random() * 20) };
      } else game.snake.pop();
    }
  }
  ctx.fillStyle = "#fb7185"; ctx.fillRect(game.food.x * size + 4, game.food.y * size + 4, 13, 13);
  ctx.fillStyle = "#34d399"; game.snake.forEach((s) => ctx.fillRect(s.x * size + 2, s.y * size + 2, 17, 17));
}

function drawBlocks(ctx) {
  const size = 21;
  game.dropCounter++;
  if (game.dropCounter % game.dropSpeed === 0) moveBlock(0, 1);
  ctx.strokeStyle = "rgba(148,163,184,.18)";
  for (let x = 0; x <= 10; x++) { ctx.beginPath(); ctx.moveTo(250 + x * size, 0); ctx.lineTo(250 + x * size, 420); ctx.stroke(); }
  for (let y = 0; y <= 20; y++) { ctx.beginPath(); ctx.moveTo(250, y * size); ctx.lineTo(460, y * size); ctx.stroke(); }
  game.grid.forEach((row, y) => row.forEach((color, x) => {
    if (!color) return;
    ctx.fillStyle = color;
    ctx.fillRect(250 + x * size + 1, y * size + 1, size - 2, size - 2);
  }));
  drawPiece(ctx, game.block, size);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "15px system-ui";
  ctx.fillText("Use arrows to move. Up rotates.", 28, 52);
}

function drawPiece(ctx, piece, size) {
  ctx.fillStyle = piece.color;
  piece.shape.forEach((row, y) => row.forEach((v, x) => {
    if (v) ctx.fillRect(250 + (piece.x + x) * size + 1, (piece.y + y) * size + 1, size - 2, size - 2);
  }));
}

function collides(px, py, shape) {
  return shape.some((row, y) => row.some((value, x) => {
    if (!value) return false;
    const gx = px + x;
    const gy = py + y;
    return gx < 0 || gx >= 10 || gy >= 20 || (gy >= 0 && game.grid[gy][gx]);
  }));
}

function moveBlock(dx, dy) {
  const b = game.block;
  if (!collides(b.x + dx, b.y + dy, b.shape)) {
    b.x += dx;
    b.y += dy;
    return true;
  }
  if (dy > 0) {
    mergeBlock();
    clearRows();
    spawnBlock();
  }
  return false;
}

function mergeBlock() {
  const b = game.block;
  b.shape.forEach((row, y) => row.forEach((value, x) => {
    if (value && b.y + y >= 0) game.grid[b.y + y][b.x + x] = b.color;
  }));
}

function clearRows() {
  let cleared = 0;
  game.grid = game.grid.filter((row) => {
    const full = row.every(Boolean);
    if (full) cleared++;
    return !full;
  });
  while (game.grid.length < 20) game.grid.unshift(Array(10).fill(""));
  if (cleared) {
    game.score += cleared * 100;
    game.dropSpeed = Math.max(10, game.dropSpeed - cleared);
  }
}

function rotateBlock() {
  const b = game.block;
  const rotated = b.shape[0].map((_, i) => b.shape.map((row) => row[i]).reverse());
  if (!collides(b.x, b.y, rotated)) b.shape = rotated;
}

function handleGameKeys(event) {
  if ($("breakOverlay").classList.contains("hidden")) return;
  if (activeGame === "snake") {
    if (event.key === "ArrowUp" && game.dir.y !== 1) game.nextDir = { x: 0, y: -1 };
    if (event.key === "ArrowDown" && game.dir.y !== -1) game.nextDir = { x: 0, y: 1 };
    if (event.key === "ArrowLeft" && game.dir.x !== 1) game.nextDir = { x: -1, y: 0 };
    if (event.key === "ArrowRight" && game.dir.x !== -1) game.nextDir = { x: 1, y: 0 };
  }
  if (activeGame === "blocks" && game.block) {
    if (event.key === "ArrowLeft") moveBlock(-1, 0);
    if (event.key === "ArrowRight") moveBlock(1, 0);
    if (event.key === "ArrowDown") moveBlock(0, 1);
    if (event.key === "ArrowUp") rotateBlock();
  }
  if (activeGame === "breakout") {
    if (event.key === "ArrowLeft") game.paddleX = Math.max(0, game.paddleX - 34);
    if (event.key === "ArrowRight") game.paddleX = Math.min($("gameCanvas").width - game.paddleW, game.paddleX + 34);
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
}

document.addEventListener("DOMContentLoaded", init);
