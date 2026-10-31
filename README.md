# Meetspace

Meetspace is a full-stack video-meeting MVP with account sign-in, scheduled meetings, invite codes, WebRTC calls, meeting chat, a host-controlled waiting room, participant controls, local recording, and calendar invite export.

## Run locally

Requires Node.js 20 or newer. No package installation is needed.

```sh
node app-server.mjs
```

For email/password only, no setup file is required. To enable OAuth providers, copy `.env.example` to `.env` and start with `node --env-file=.env app-server.mjs`. Open http://localhost:3000, create an account, then start or schedule a meeting. Invite others with its code. Camera and microphone work on localhost and HTTPS.

## Deploy to Vercel

Vercel detects `server.ts` as the Node server entry point. Add the OAuth values from `.env.example` in the Vercel project's Environment Variables, and set `BASE_URL` to the deployed HTTPS origin. Register provider callback URLs with that same origin, for example `https://your-domain.vercel.app/auth/google/callback`.

The included JSON file store is for local development and is intentionally excluded from Git. Vercel instances do not provide durable shared storage for user accounts, sessions, photos, or meeting records. Connect a persistent database and shared session store before using a deployment for real accounts or meetings; the local JSON store is not production storage.

## Sign-in providers

Copy `.env.example` to `.env`, then add credentials from the providers you want to enable. Register these exact redirect URIs in each provider console:

- Google: `http://localhost:3000/auth/google/callback`
- Microsoft: `http://localhost:3000/auth/microsoft/callback`
- Apple: `http://localhost:3000/auth/apple/callback`

Set `BASE_URL` to the public HTTPS origin in production. Microsoft can use `MICROSOFT_TENANT_ID=common` or a specific tenant. Apple needs a Sign in with Apple Service ID and a client-secret JWT generated from the Apple private key; store that generated secret in `APPLE_CLIENT_SECRET`. Restart the server after changing `.env`. The buttons remain visible when a provider is not configured and display a setup message when clicked.

## Features

- Email/password account creation and sign-in with scrypt password hashing
- Configurable Google, Microsoft, and Apple OAuth/OIDC sign-in
- Persistent users, meetings, and meeting chat in `data/meetspace.json`
- Schedule meetings and join them with a code; download `.ics` invites for Google Calendar, Apple Calendar, and Outlook
- WebSocket signaling and peer-to-peer WebRTC video/audio and screen sharing
- Host waiting room, admit/deny, remove participants, and request participant mute
- Browser-side recordings are saved in this browser’s local library and can be played or downloaded as WebM/MP4 where supported
- Responsive dashboard branded for Vaibhav Tevatia, with calendar, recordings, contacts, and subtle motion effects

## Deployment notes

Run behind HTTPS and set `BASE_URL` to the public HTTPS origin. The included STUN server connects common networks; restrictive NATs/firewalls may require a TURN relay. Calls use peer-to-peer mesh and are best for small groups. Recordings are created in the recording user's browser and are not uploaded. For production, move JSON storage to a database, add rate limits, account recovery, backups, and a private TURN service.
