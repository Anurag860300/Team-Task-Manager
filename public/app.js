const state = {
  token: localStorage.getItem("ttm_token"),
  user: JSON.parse(localStorage.getItem("ttm_user") || "null"),
  users: [],
  projects: [],
  tasks: [],
  mode: "login"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && state.token) {
    clearSession();
    showAuth();
    $("#authHint").textContent = data.error || "Please log in again.";
  }
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setMessage(text = "") {
  $("#message").textContent = text;
}

function saveSession({ user, token }) {
  state.user = user;
  state.token = token;
  localStorage.setItem("ttm_user", JSON.stringify(user));
  localStorage.setItem("ttm_token", token);
}

function clearSession() {
  state.user = null;
  state.token = null;
  localStorage.removeItem("ttm_user");
  localStorage.removeItem("ttm_token");
}

function toggleAuthMode(mode) {
  state.mode = mode;
  $("#loginTab").classList.toggle("active", mode === "login");
  $("#signupTab").classList.toggle("active", mode === "signup");
  $("#nameField").classList.toggle("hidden", mode === "login");
  $("#authSubmit").textContent = mode === "login" ? "Login" : "Create Account";
}

function showApp() {
  $("#authView").classList.add("hidden");
  $("#dashboardView").classList.remove("hidden");
  $("#profileName").textContent = state.user.name;
  $("#profileRole").textContent = state.user.role;
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", state.user.role !== "admin"));
}

function showAuth() {
  $("#authView").classList.remove("hidden");
  $("#dashboardView").classList.add("hidden");
}

function renderStats(stats) {
  $("#statTotal").textContent = stats.total || 0;
  $("#statTodo").textContent = stats.todo || 0;
  $("#statProgress").textContent = stats.inProgress || 0;
  $("#statOverdue").textContent = stats.overdue || 0;
}

function statusLabel(status) {
  return status.replace("_", " ");
}

function isOverdue(task) {
  return task.dueDate && task.status !== "done" && new Date(task.dueDate) < new Date(new Date().toDateString());
}

function renderUpcoming(tasks) {
  $("#upcomingRows").innerHTML = tasks.map((task) => `
    <tr>
      <td>${escapeHtml(task.title)}</td>
      <td>${escapeHtml(task.projectName)}</td>
      <td>${escapeHtml(task.assigneeName || "Unassigned")}</td>
      <td><span class="pill">${statusLabel(task.status)}</span></td>
      <td>${task.dueDate || "-"}</td>
    </tr>
  `).join("") || `<tr><td colspan="5">No tasks yet.</td></tr>`;
}

function renderProjects() {
  $("#projectGrid").innerHTML = state.projects.map((project) => `
    <article class="project-card">
      <h3>${escapeHtml(project.name)}</h3>
      <p class="muted">${escapeHtml(project.description || "No description")}</p>
      <div class="progress"><span style="width: ${project.progress}%"></span></div>
      <p><strong>${project.progress}%</strong> complete</p>
      <p class="muted">${project.memberCount} members | ${project.taskCount} tasks</p>
    </article>
  `).join("") || `<p class="muted">No projects yet.</p>`;
}

function renderTasks() {
  const columns = [
    ["todo", "To do"],
    ["in_progress", "In progress"],
    ["done", "Done"]
  ];

  $("#taskBoard").innerHTML = columns.map(([status, title]) => `
    <section class="column">
      <h3>${title}</h3>
      ${state.tasks.filter((task) => task.status === status).map(renderTaskCard).join("") || `<p class="muted">No tasks.</p>`}
    </section>
  `).join("");

  $$(".statusSelect").forEach((select) => {
    select.addEventListener("change", async (event) => {
      try {
        await api(`/api/tasks/${event.target.dataset.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: event.target.value })
        });
        await loadData();
      } catch (error) {
        setMessage(error.message);
      }
    });
  });
}

function renderTaskCard(task) {
  return `
    <article class="task-card">
      <h4>${escapeHtml(task.title)}</h4>
      <p class="muted">${escapeHtml(task.description || "")}</p>
      <div class="task-meta">
        <span class="pill">${task.priority}</span>
        <span>${escapeHtml(task.projectName)}</span>
        <span>${escapeHtml(task.assigneeName || "Unassigned")}</span>
        <span class="${isOverdue(task) ? "pill overdue" : ""}">${task.dueDate || "No due date"}</span>
      </div>
      <select class="statusSelect" data-id="${task.id}">
        <option value="todo" ${task.status === "todo" ? "selected" : ""}>To do</option>
        <option value="in_progress" ${task.status === "in_progress" ? "selected" : ""}>In progress</option>
        <option value="done" ${task.status === "done" ? "selected" : ""}>Done</option>
      </select>
    </article>
  `;
}

function fillSelects() {
  $("#projectMembers").innerHTML = state.users.map((user) => (
    `<option value="${user.id}">${escapeHtml(user.name)} (${user.role})</option>`
  )).join("");

  $("#taskProject").innerHTML = state.projects.map((project) => (
    `<option value="${project.id}">${escapeHtml(project.name)}</option>`
  )).join("");

  const assignees = state.user.role === "admin" ? state.users : [state.user];
  $("#taskAssignee").innerHTML = assignees.map((user) => (
    `<option value="${user.id}">${escapeHtml(user.name)}</option>`
  )).join("");
}

async function loadData() {
  if (!state.token) return;
  setMessage("");
  const [dashboard, users, projects, tasks] = await Promise.all([
    api("/api/dashboard"),
    api("/api/users"),
    api("/api/projects"),
    api("/api/tasks")
  ]);
  state.users = users.users;
  state.projects = projects.projects;
  state.tasks = tasks.tasks;
  renderStats(dashboard.stats);
  renderUpcoming(dashboard.upcoming);
  renderProjects();
  renderTasks();
  fillSelects();
}

function switchPanel(panelId) {
  $$(".panel").forEach((panel) => panel.classList.add("hidden"));
  $(`#${panelId}`).classList.remove("hidden");
  $$(".nav").forEach((nav) => nav.classList.toggle("active", nav.dataset.view === panelId));
  $("#pageTitle").textContent = panelId.replace("Panel", "");
}

$("#loginTab").addEventListener("click", () => toggleAuthMode("login"));
$("#signupTab").addEventListener("click", () => toggleAuthMode("signup"));

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  const endpoint = state.mode === "login" ? "/api/auth/login" : "/api/auth/signup";
  if (state.mode === "login") delete payload.name;

  try {
    const data = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    saveSession(data);
    showApp();
    await loadData();
  } catch (error) {
    $("#authHint").textContent = error.message;
  }
});

$("#logoutBtn").addEventListener("click", () => {
  clearSession();
  showAuth();
});

$$(".nav").forEach((nav) => nav.addEventListener("click", () => switchPanel(nav.dataset.view)));
$("#refreshBtn").addEventListener("click", loadData);
$("#newProjectBtn").addEventListener("click", () => {
  setMessage("");
  $("#projectDialog").showModal();
});

$("#newTaskBtn").addEventListener("click", () => {
  setMessage("");
  if (!state.projects.length) {
    setMessage("Create a project first, then add tasks to it.");
    switchPanel("projectsPanel");
    return;
  }
  $("#taskDialog").showModal();
});
$$("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

$("#projectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const submitButton = formElement.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const form = new FormData(formElement);
    const memberIds = form.getAll("memberIds").map(Number);
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        description: form.get("description"),
        memberIds
      })
    });
    formElement.reset();
    $("#projectDialog").close();
    switchPanel("projectsPanel");
    await loadData();
  } catch (error) {
    setMessage(error.message);
    alert(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

$("#taskForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const submitButton = formElement.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const form = new FormData(formElement);
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: form.get("title"),
        description: form.get("description"),
        projectId: Number(form.get("projectId")),
        assigneeId: Number(form.get("assigneeId")),
        priority: form.get("priority"),
        dueDate: form.get("dueDate") || null
      })
    });
    formElement.reset();
    $("#taskDialog").close();
    switchPanel("tasksPanel");
    await loadData();
  } catch (error) {
    setMessage(error.message);
    alert(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

toggleAuthMode("login");
if (state.token && state.user) {
  showApp();
  loadData().catch((error) => {
    setMessage(error.message);
    clearSession();
    showAuth();
  });
}
