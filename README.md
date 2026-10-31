<div align="center">

# Meetspace

### Meetings made human.

A lightweight video meeting app with peer-to-peer calls, meeting rooms, and a polished workspace.

[Open Meetspace](https://meetspace-vaibhav.vercel.app/) · [View the source](https://github.com/vaibhavtevatia7946/meetspace)

</div>

---

## What you can do

- Start a meeting or join one with an invite code.
- Schedule meetings and export calendar invites (`.ics`).
- Meet over peer-to-peer audio and video, share your screen, and chat during a call.
- Use a waiting room and host controls to admit, mute, or remove participants.
- Record calls in your browser and play or download them later.
- Browse meetings, contacts, and recordings in a responsive dashboard with light and dark themes.
- Sign in with email and password, or configure Google, Microsoft, and Apple sign-in.

## Run locally

**Requirements:** Node.js 20 or newer. No package installation is needed.

```bash
git clone https://github.com/vaibhavtevatia7946/meetspace.git
cd meetspace
node app-server.mjs
```

Open [http://localhost:3000](http://localhost:3000), create an account, and start a meeting. Camera and microphone access work on `localhost` and HTTPS.

## Optional sign-in providers

Email and password sign-in works without extra configuration. To enable OAuth, copy `.env.example` to `.env`, add credentials from the provider console, and start the server with:

```bash
node --env-file=.env app-server.mjs
```

Register these callback URLs with the matching provider:

| Provider | Local callback URL |
| --- | --- |
| Google | `http://localhost:3000/auth/google/callback` |
| Microsoft | `http://localhost:3000/auth/microsoft/callback` |
| Apple | `http://localhost:3000/auth/apple/callback` |

For a deployed app, use its HTTPS origin and set `BASE_URL` to that same origin. Never commit `.env` or publish client secrets.

## Deploying to Vercel

The repository includes a `server.ts` entry point and `vercel.json` asset configuration. Import the GitHub repository in Vercel or deploy with the Vercel CLI. Set OAuth environment variables in Vercel if you use those providers.

**Storage limitation:** the included JSON database is intended for local prototyping. Vercel’s filesystem is ephemeral, so accounts, meetings, and profile changes are not durable across deployments or instances. Connect a persistent database and shared session storage before relying on real user data. Recordings stay in each user’s browser and are not uploaded.

## How it works

Meetspace uses a small Node.js HTTP server for accounts, scheduling, and meeting data. WebSockets carry call signaling and chat; audio and video travel directly between browsers using WebRTC. The included STUN service helps browsers establish peer connections. Calls work best with small groups; restrictive networks may need a TURN relay.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | Meetspace interface and styles |
| `client.js` | Dashboard, calendar, profile, auth, and call interactions |
| `app-server.mjs` | HTTP API, authentication, meeting storage, and WebSocket signaling |
| `server.ts` | Vercel Node server entry point |
| `vercel.json` | Includes frontend assets in the server deployment |
| `.env.example` | Optional OAuth configuration template |

---

Built by **Vaibhav Tevatia** · [GitHub](https://github.com/vaibhavtevatia7946)
