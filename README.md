# AI Productivity Workspace

## Run

1. Keep your existing `.env` file in this project folder.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000/login.html` on the server computer.

## Multi-device login

The application now treats MongoDB as the source of truth for tasks and meetings. After login, the browser fetches the authenticated user's tasks and meetings from `/api/tasks` and `/api/meetings` and restores them into the current device's local state.

To use another device on the same network, run the server on the computer that has MongoDB/network access and open:

`http://SERVER_IP:3000/login.html`

Do not open the HTML files directly with `file://` and do not use `localhost` on a different device. `localhost` always means the device currently running the browser.

The backend listens on `0.0.0.0` so it can accept LAN connections. Make sure Windows Firewall or the hosting provider allows TCP port 3000 when using a local network.

## Environment

Keep API keys and database credentials in `.env`. Never commit the real `.env` file to GitHub.
