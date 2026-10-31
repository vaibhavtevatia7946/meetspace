<div align="center">

# 🪐 Meetspace

**A lightweight, zero-dependency full-stack video meeting platform featuring WebRTC P2P media, host waiting rooms, multi-provider OAuth, local recording, and calendar integration.**

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![WebRTC](https://img.shields.io/badge/WebRTC-Peer--to--Peer-333333?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org/)
[![Vercel](https://img.shields.io/badge/Vercel-Deploy%20Ready-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

[Features](#-key-features) • [Quick Start](#-quick-start) • [Architecture](#-architecture--signaling) • [OAuth Configuration](#-oauth--sign-in-setup) • [Vercel Deployment](#-deployment-guide) • [Security & Notes](#-production--security-considerations)

</div>

---

## 🌟 Overview

**Meetspace** is a full-featured video conferencing MVP designed for friction-free communication. Built with native modern Web standards, it combines real-time WebSockets for signaling with peer-to-peer WebRTC mesh for ultra-low latency audio/video streaming and screen sharing.

It includes full session persistence, calendar scheduling (`.ics`), host moderation controls (waiting room, participant muting, kick), in-browser media recording, and seamless authentication (password-authenticated scrypt alongside Google, Microsoft, and Apple sign-in).

---

## ⚡ Key Features

| Category | Capabilities |
| :--- | :--- |
| 🎥 **Video & Audio** | Peer-to-peer WebRTC audio/video mesh, dynamic screen sharing, and automatic STUN-assisted ICE negotiation. |
| 🛡️ **Host Moderation** | Private waiting room with admit/deny controls, active participant eviction, and remote mute requests. |
| 🔐 **Authentication** | Secure email/password login hashed with `scrypt`, plus extensible OAuth 2.0 / OIDC (Google, Microsoft, Apple). |
| 📅 **Calendar & Invites** | Generate instant meeting codes, schedule sessions in advance, and export `.ics` files for Google, Apple, and Outlook calendars. |
| 💬 **Meeting Chat** | Real-time persisted chat feed synchronized across all active participants in the room. |
| ⏺️ **Local Recording** | Client-side recording saved straight to the browser library; exportable as WebM or MP4 without server bandwidth overhead. |
| 🎨 **Executive UI** | Responsive, motion-enhanced dashboard customized and branded for **Vaibhav Tevatia**. |

---

## 🏗️ Architecture & Signaling

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Host (Alice)
    participant Server as Meetspace Server (Node.js / WS)
    actor Bob as Guest (Bob)

    Note over Alice,Bob: Meeting Setup & Waiting Room
    Alice->>Server: Create / Schedule Meeting
    Bob->>Server: Request to Join (Invite Code)
    Server->>Alice: Waiting Room Alert (Admit Bob?)
    Alice->>Server: Admit Participant
    Server->>Bob: Admission Granted

    Note over Alice,Bob: WebRTC Peer Connection (Signaling)
    Alice->>Server: Send SDP Offer via WebSocket
    Server->>Bob: Forward SDP Offer
    Bob->>Server: Send SDP Answer
    Server->>Alice: Forward SDP Answer
    Alice<<-->>Bob: Exchange ICE Candidates (via STUN)

    Note over Alice,Bob: P2P Direct Media Transmission
    Alice<<==>>Bob: Direct Encrypted Audio / Video / Screen Share
```

---

## 🚀 Quick Start

### 📋 Prerequisites
- **Node.js 20.0+** installed on your system.
- Zero external package dependencies required for basic execution.

### 🏃 Running Locally

```bash
# 1. Clone the repository
git clone https://github.com/vaibhavtevatia7946/meetspace.git
cd meetspace

# 2. Run with native Node.js (Zero installation needed)
node app-server.mjs
```

> **Using OAuth Providers?**  
> Copy `.env.example` to `.env` and launch with native environment support:
> ```bash
> cp .env.example .env
> node --env-file=.env app-server.mjs
> ```

Open **`http://localhost:3000`** in your browser to create your account and start your first session.

> [!NOTE]  
> WebRTC camera and microphone access requires a secure origin (`https://`) or `localhost`.

---

## 🔑 OAuth & Sign-in Setup

Meetspace supports one-click authentication across Google, Microsoft, and Apple. Copy `.env.example` to `.env` and fill in the required credentials.

### Required Redirect URIs

Configure the following exact callback URLs in your developer consoles:

| Provider | Redirect / Callback URI |
| :--- | :--- |
| **Google Cloud Console** | `http://localhost:3000/auth/google/callback` |
| **Microsoft Entra ID** | `http://localhost:3000/auth/microsoft/callback` |
| **Apple Developer** | `http://localhost:3000/auth/apple/callback` |

*(In production, replace `http://localhost:3000` with your canonical HTTPS domain, e.g. `https://meetspace.vercel.app`).*

### Provider Configuration Notes

- **Microsoft**: Set `MICROSOFT_TENANT_ID=common` for multi-tenant / personal accounts, or provide your specific Tenant ID.
- **Apple**: Requires a *Sign in with Apple* Service ID and a client-secret JWT generated from your private key (`.p8`). Save the generated secret in `APPLE_CLIENT_SECRET`.
- **Graceful Fallback**: If a provider is unconfigured, its sign-in button remains interactive and displays clear setup guidance when selected.

---

## ☁️ Deployment Guide

### Deploying to Vercel

Vercel automatically detects `server.ts` / server entry points:

1. **Push to GitHub**: Ensure your code is committed to a GitHub repository.
2. **Import Project**: In the [Vercel Dashboard](https://vercel.com/new), select your `meetspace` repository.
3. **Environment Variables**: Configure the following in **Settings → Environment Variables**:
   - `BASE_URL`: The production HTTPS URL (e.g., `https://your-meetspace.vercel.app`)
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (if using Google OAuth)
   - `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` (if using Microsoft OAuth)
   - `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` (if using Apple OAuth)

> [!WARNING]  
> **Serverless File Storage Notice:**  
> The included file store (`data/meetspace.json`) is designed for local prototyping. Because Vercel serverless functions run on ephemeral, stateless compute instances, local JSON files will not persist across invocations.  
> Before running real workloads in production, replace the local JSON adapter with a persistent database (PostgreSQL, Supabase, Neon, or Redis) and configure a shared session store.

---

## 🔒 Production & Security Considerations

- **HTTPS Mandatory**: WebRTC APIs (`getUserMedia`, `RTCPeerConnection`) are restricted to secure contexts (`https://` or `localhost`).
- **NAT Traversal & TURN Relays**: The included default public STUN server connects standard networks. For clients behind symmetric NATs or restrictive corporate firewalls, configure a dedicated **TURN** server (e.g. Coturn, Twilio Network Traversal).
- **Network Topologies**: Direct P2P mesh topology works best for 2–6 participants. For large-scale conferences, consider integrating an SFU (Selective Forwarding Unit) like LiveKit or mediasoup.
- **Client-Side Privacy**: Meeting recordings are handled strictly in-memory / browser-side and are not dispatched to any third-party cloud without explicit user action.

---

## 👨‍💻 Author

**Vaibhav Tevatia**  
- **GitHub:** [@vaibhavtevatia7946](https://github.com/vaibhavtevatia7946)  
- **Email:** [vaibhavtevatia7946@gmail.com](mailto:vaibhavtevatia7946@gmail.com)

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
