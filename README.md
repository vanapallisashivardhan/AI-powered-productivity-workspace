# AI Productivity Workspace

A full-stack productivity dashboard with secure account login, MongoDB-backed tasks and meetings, profile persistence, and an AI-powered continuous voice assistant.

## Features

- Email/password registration and login with bcrypt password hashing and JWT sessions
- Session validation against the backend on every workspace load
- User-isolated task, meeting, and profile records in MongoDB
- Database-first loading so your data is restored when you sign in from another device
- Task and meeting create, update, complete, and delete operations
- Continuous browser voice recognition with automatic restart, microphone permission handling, duplicate-transcript protection, and spoken responses
- AI voice intent routing through OpenRouter
- Responsive dashboard, profile, settings, and theme controls
- Same-origin API requests so localhost, LAN, and deployed URLs do not need hardcoded hostnames

## Requirements

- Node.js 20.19 or later
- MongoDB Atlas or a reachable MongoDB server
- An OpenRouter API key for AI voice commands
- Google Chrome or Microsoft Edge for the best browser speech-recognition support

## Setup

1. Extract the project.
2. Open a terminal in the project folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Create your environment file:

   ```bash
   copy .env.example .env
   ```

5. Edit `.env` and set:
   - `MONGO_URI`: your MongoDB connection string
   - `JWT_SECRET`: a private random string of at least 32 characters
   - `OPENROUTER_API_KEY`: your OpenRouter API key
   - `PORT`: optional; defaults to `3000`

6. In MongoDB Atlas, allow network access from the machine or hosting service that runs the server, and ensure the database user has read/write permissions.

7. Start the application:

   ```bash
   npm start
   ```

8. Open `http://localhost:3000/login.html`.

## Voice assistant

1. Sign in and open the workspace.
2. Click the microphone button once and allow microphone access.
3. Keep the dashboard tab open while using voice commands.
4. Click the microphone again to stop listening.

Voice recognition is provided by the browser and is best supported in Chrome/Edge. Browsers generally require HTTPS for microphone access on deployed websites; `localhost` is treated as a secure development origin. The browser may pause recognition when the tab is backgrounded or the device sleeps, but the app automatically attempts to restart it while the assistant is enabled.

Example commands:
- "Create a task to submit my assignment tomorrow"
- "Show my meetings"
- "Mark the database assignment as complete"
- "Switch to light mode"
- "How many pending tasks do I have?"

AI voice commands require a valid `OPENROUTER_API_KEY`. The normal workspace, login, tasks, and meetings do not depend on that key.

## Multi-device access

Run the server on a machine reachable by your other device and open:

`http://SERVER_IP:3000/login.html`

Do not open HTML files using `file://`. Do not use `localhost` from a second device; it refers to that second device. For public deployment, use HTTPS and configure MongoDB network access and hosting environment variables.

## Health check

Open `http://localhost:3000/api/health`. A healthy response reports:

```json
{"status":"ok","database":"connected"}
```

## Security notes

- The real `.env` file and VAPID private-key file are intentionally excluded from the source package. Never upload API keys, MongoDB credentials, JWT secrets, or VAPID private keys to GitHub. If the removed VAPID key was already deployed or shared, generate and deploy a replacement.
- Environment and credential files are also blocked from static HTTP serving.
- Passwords are stored as bcrypt hashes, not plaintext.
- API routes require a valid JWT and database records are scoped to the authenticated user.
- Static file serving ignores dotfiles.
