# Team Task Manager

A full-stack Team Task Manager for creating projects, assigning tasks, tracking status, and enforcing Admin/Member role-based access.

## Features

- Signup and login with JWT authentication
- Admin and Member roles
- Project creation and team member assignment
- Task creation, assignment, priority, due date, and status updates
- Dashboard with totals, status counts, overdue work, and upcoming tasks
- REST API backed by PostgreSQL
- Railway-ready deployment config

## Tech Stack

- Node.js
- Express
- PostgreSQL
- JWT
- bcryptjs
- Zod
- HTML, CSS, JavaScript

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file:

```bash
cp .env.example .env
```

3. Update `DATABASE_URL` and `JWT_SECRET` in `.env`.

4. Start the app:

```bash
npm run dev
```

The app runs at `http://localhost:3000`.

The first signed-up user automatically becomes an admin. Later public signups become members.

## REST API

### Auth

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/me`

### Users

- `GET /api/users`

### Projects

- `GET /api/projects`
- `POST /api/projects` admin only
- `GET /api/projects/:id/members`

### Tasks

- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id/status`

### Dashboard

- `GET /api/dashboard`

## Role Rules

- Admins can create projects, add members, assign tasks to any user, and update any task.
- Members can view assigned/project tasks and update tasks assigned to themselves.
- Members can create tasks only for themselves inside projects they can access.

## Deploy on Railway

1. Push this repository to GitHub.
2. Create a new Railway project from the GitHub repo.
3. Add a PostgreSQL database service in Railway.
4. Set environment variables:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=your-long-random-secret
NODE_ENV=production
```

5. Railway will run `npm install` and `npm start`.
6. Open the generated Railway domain and sign up. The first account is the admin.

## Submission Checklist

- Live URL: add your Railway URL here
- GitHub repo: add your repository URL here
- Demo video: record a 2-5 minute walkthrough showing signup, project creation, task assignment, status updates, dashboard, and role restrictions
