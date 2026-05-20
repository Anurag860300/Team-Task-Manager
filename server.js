require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { z } = require("zod");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-deploying";
const isVercel = Boolean(process.env.VERCEL);
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

const pool = hasDatabaseUrl
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
    })
  : null;

let dbInitPromise;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(6).max(128)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const projectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(800).optional().default(""),
  memberIds: z.array(z.number().int().positive()).optional().default([])
});

const taskSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1200).optional().default(""),
  projectId: z.number().int().positive(),
  assigneeId: z.number().int().positive().nullable().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional().default("todo"),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
});

const statusSchema = z.object({
  status: z.enum(["todo", "in_progress", "done"])
});

function sendError(res, status, message, details) {
  return res.status(status).json({ error: message, details });
}

function signUser(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return sendError(res, 401, "Authentication required");

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      "select id, name, email, role from users where id = $1",
      [decoded.id]
    );
    if (!rows[0]) return sendError(res, 401, "User session no longer exists. Please log in again.");
    req.user = rows[0];
    return next();
  } catch {
    return sendError(res, 401, "Invalid or expired token");
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return sendError(res, 403, "Admin access required");
  return next();
}

async function canAccessProject(user, projectId) {
  if (user.role === "admin") return true;
  const { rowCount } = await pool.query(
    "select 1 from project_members where project_id = $1 and user_id = $2",
    [projectId, user.id]
  );
  return rowCount > 0;
}

async function initDb() {
  await pool.query(`
    create table if not exists users (
      id serial primary key,
      name varchar(80) not null,
      email varchar(160) not null unique,
      password_hash text not null,
      role varchar(20) not null check (role in ('admin', 'member')),
      created_at timestamptz not null default now()
    );

    create table if not exists projects (
      id serial primary key,
      name varchar(120) not null,
      description text not null default '',
      owner_id integer not null references users(id) on delete cascade,
      created_at timestamptz not null default now()
    );

    create table if not exists project_members (
      project_id integer not null references projects(id) on delete cascade,
      user_id integer not null references users(id) on delete cascade,
      primary key (project_id, user_id)
    );

    create table if not exists tasks (
      id serial primary key,
      title varchar(160) not null,
      description text not null default '',
      project_id integer not null references projects(id) on delete cascade,
      assignee_id integer references users(id) on delete set null,
      creator_id integer not null references users(id) on delete cascade,
      status varchar(20) not null check (status in ('todo', 'in_progress', 'done')) default 'todo',
      priority varchar(20) not null check (priority in ('low', 'medium', 'high')) default 'medium',
      due_date date,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
}

async function ensureDbReady(req, res, next) {
  if (!pool) {
    return sendError(res, 503, "DATABASE_URL is not configured");
  }

  try {
    dbInitPromise ||= initDb();
    await dbInitPromise;
    return next();
  } catch (error) {
    dbInitPromise = null;
    return next(error);
  }
}

app.use("/api", ensureDbReady);

app.get("/api/health", async (_req, res) => {
  await pool.query("select 1");
  res.json({ ok: true });
});

app.post("/api/auth/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid signup data", parsed.error.flatten());

  const userCount = await pool.query("select count(*)::int as count from users");
  const role = userCount.rows[0].count === 0 ? "admin" : "member";
  const hash = await bcrypt.hash(parsed.data.password, 12);

  try {
    const { rows } = await pool.query(
      `insert into users (name, email, password_hash, role)
       values ($1, lower($2), $3, $4)
       returning id, name, email, role`,
      [parsed.data.name, parsed.data.email, hash, role]
    );
    res.status(201).json({ user: rows[0], token: signUser(rows[0]) });
  } catch (error) {
    if (error.code === "23505") return sendError(res, 409, "Email already registered");
    throw error;
  }
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid login data", parsed.error.flatten());

  const { rows } = await pool.query(
    "select id, name, email, password_hash, role from users where email = lower($1)",
    [parsed.data.email]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
    return sendError(res, 401, "Invalid email or password");
  }
  delete user.password_hash;
  res.json({ user, token: signUser(user) });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/users", auth, async (_req, res) => {
  const { rows } = await pool.query("select id, name, email, role from users order by name");
  res.json({ users: rows });
});

app.get("/api/projects", auth, async (req, res) => {
  const params = req.user.role === "admin" ? [] : [req.user.id];
  const where =
    req.user.role === "admin"
      ? ""
      : `where exists (
           select 1 from project_members access_pm
            where access_pm.project_id = p.id and access_pm.user_id = $1
         )`;
  const { rows } = await pool.query(
    `select p.id, p.name, p.description, p.owner_id as "ownerId",
            (select count(*)::int from project_members pm where pm.project_id = p.id) as "memberCount",
            (select count(*)::int from tasks t where t.project_id = p.id) as "taskCount",
            coalesce((
              select round(100.0 * count(*) filter (where t.status = 'done') / nullif(count(*), 0))::int
                from tasks t
               where t.project_id = p.id
            ), 0) as progress
       from projects p
       ${where}
       order by p.created_at desc`,
    params
  );
  res.json({ projects: rows });
});

app.post("/api/projects", auth, requireAdmin, async (req, res) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid project data", parsed.error.flatten());

  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      "insert into projects (name, description, owner_id) values ($1, $2, $3) returning *",
      [parsed.data.name, parsed.data.description, req.user.id]
    );
    const project = rows[0];
    const memberIds = [...new Set([req.user.id, ...parsed.data.memberIds])];
    for (const userId of memberIds) {
      await client.query(
        "insert into project_members (project_id, user_id) values ($1, $2) on conflict do nothing",
        [project.id, userId]
      );
    }
    await client.query("commit");
    res.status(201).json({ project });
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

app.get("/api/projects/:id/members", auth, async (req, res) => {
  const projectId = Number(req.params.id);
  if (!(await canAccessProject(req.user, projectId))) return sendError(res, 403, "Project access denied");

  const { rows } = await pool.query(
    `select u.id, u.name, u.email, u.role
       from project_members pm
       join users u on u.id = pm.user_id
      where pm.project_id = $1
      order by u.name`,
    [projectId]
  );
  res.json({ members: rows });
});

app.post("/api/tasks", auth, async (req, res) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid task data", parsed.error.flatten());
  if (req.user.role !== "admin" && parsed.data.assigneeId !== req.user.id) {
    return sendError(res, 403, "Members can only create tasks assigned to themselves");
  }
  if (!(await canAccessProject(req.user, parsed.data.projectId))) return sendError(res, 403, "Project access denied");

  const { rows } = await pool.query(
    `insert into tasks (title, description, project_id, assignee_id, creator_id, status, priority, due_date)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      parsed.data.title,
      parsed.data.description,
      parsed.data.projectId,
      parsed.data.assigneeId || null,
      req.user.id,
      parsed.data.status,
      parsed.data.priority,
      parsed.data.dueDate || null
    ]
  );
  res.status(201).json({ task: { id: rows[0].id } });
});

app.get("/api/tasks", auth, async (req, res) => {
  const { projectId, status, assigneeId } = req.query;
  const values = [];
  const filters = [];

  if (req.user.role !== "admin") {
    values.push(req.user.id);
    filters.push(`(t.assignee_id = $${values.length} or pm.user_id = $${values.length})`);
  }
  if (projectId) {
    values.push(Number(projectId));
    filters.push(`t.project_id = $${values.length}`);
  }
  if (status) {
    values.push(status);
    filters.push(`t.status = $${values.length}`);
  }
  if (assigneeId) {
    values.push(Number(assigneeId));
    filters.push(`t.assignee_id = $${values.length}`);
  }

  const where = filters.length ? `where ${filters.join(" and ")}` : "";
  const { rows } = await pool.query(
    `select t.id, t.title, t.description, t.status, t.priority,
            to_char(t.due_date, 'YYYY-MM-DD') as "dueDate",
            p.id as "projectId", p.name as "projectName",
            u.id as "assigneeId", u.name as "assigneeName",
            t.created_at as "createdAt", t.updated_at as "updatedAt"
       from tasks t
       join projects p on p.id = t.project_id
       left join users u on u.id = t.assignee_id
       left join project_members pm on pm.project_id = p.id
       ${where}
       group by t.id, p.id, u.id
       order by t.due_date nulls last, t.created_at desc`,
    values
  );
  res.json({ tasks: rows });
});

app.patch("/api/tasks/:id/status", auth, async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid status", parsed.error.flatten());

  const taskResult = await pool.query("select project_id, assignee_id from tasks where id = $1", [req.params.id]);
  const task = taskResult.rows[0];
  if (!task) return sendError(res, 404, "Task not found");
  if (req.user.role !== "admin" && task.assignee_id !== req.user.id) {
    return sendError(res, 403, "Only admins or assigned members can update this task");
  }
  if (!(await canAccessProject(req.user, task.project_id))) return sendError(res, 403, "Project access denied");

  const { rows } = await pool.query(
    "update tasks set status = $1, updated_at = now() where id = $2 returning id, status",
    [parsed.data.status, req.params.id]
  );
  res.json({ task: rows[0] });
});

app.get("/api/dashboard", auth, async (req, res) => {
  const params = req.user.role === "admin" ? [] : [req.user.id];
  const userFilter =
    req.user.role === "admin"
      ? ""
      : `where (
           t.assignee_id = $1
           or exists (
             select 1 from project_members pm
              where pm.project_id = t.project_id and pm.user_id = $1
           )
         )`;

  const totals = await pool.query(
    `select
       count(*)::int as total,
       count(*) filter (where status = 'todo')::int as todo,
       count(*) filter (where status = 'in_progress')::int as "inProgress",
       count(*) filter (where status = 'done')::int as done,
       count(*) filter (where due_date < current_date and status <> 'done')::int as overdue
     from tasks t
     ${userFilter}`,
    params
  );

  const upcoming = await pool.query(
    `select t.id, t.title, t.status, t.priority, to_char(t.due_date, 'YYYY-MM-DD') as "dueDate",
            p.name as "projectName", u.name as "assigneeName"
       from tasks t
       join projects p on p.id = t.project_id
       left join users u on u.id = t.assignee_id
       ${userFilter}
      order by t.due_date nulls last, t.created_at desc
      limit 8`,
    params
  );

  res.json({ stats: totals.rows[0], upcoming: upcoming.rows });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  sendError(res, 500, "Something went wrong");
});

if (!isVercel) {
  initDb()
    .then(() => {
      app.listen(PORT, () => console.log(`Team Task Manager running on port ${PORT}`));
    })
    .catch((error) => {
      console.error("Database startup failed:", error);
      process.exit(1);
    });
}

module.exports = app;
