# webrtc-chess-arena

A real-time multiplayer chess application with peer-to-peer video and audio communication built on WebRTC. Two players can play chess while seeing and hearing each other live — no third-party video service involved.

> **Hosting note:** The app is not currently deployed. WebRTC media transport requires a raw UDP port range (40000–41000) to be open on the server. Most PaaS platforms (Vercel, Render, Railway, Fly.io) do not support this. The correct deployment target is a VPS or an AWS EC2 instance where port ranges can be fully controlled. Deployment is planned.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, TypeScript |
| Backend | Node.js, Express 5, TypeScript |
| Real-time | Socket.IO 4 |
| Video/Audio | MediaSoup 3 (WebRTC SFU) |
| Chess logic | chess.js |
| Containerisation | Docker, Docker Compose |

---

## Architecture

```
Browser (Player 1)                    Browser (Player 2)
       │                                      │
       │  WebSocket (chess moves)             │
       │◄────────────────────────────────────►│
       │                                      │
       │  WebRTC signalling (via Socket.IO)   │
       │◄────────────────────────────────────►│
       │                                      │
       └──────────────┐   ┌───────────────────┘
                      │   │
              ┌───────▼───▼────────┐
              │   Node.js :8080    │
              │                    │
              │  ┌──────────────┐  │
              │  │ In-memory Map│  │
              │  │ gameId→ FEN  │  │
              │  └──────────────┘  │
              │                    │
              │  ┌──────────────┐  │
              │  │   MediaSoup  │  │
              │  │  SFU Worker  │  │
              │  └──────────────┘  │
              └────────────────────┘
                      │   │
          UDP/TCP 40000–41000 (RTP/RTCP)
                      │   │
               Media packets routed
               between players via SFU
```

### Why MediaSoup over simple peer-to-peer WebRTC

A basic WebRTC setup connects browsers directly to each other (P2P). This works for 2 people but breaks for any spectator or group feature — every new participant multiplies the upload bandwidth required from each browser.

MediaSoup acts as an **SFU (Selective Forwarding Unit)** — each browser sends one media stream to the server, and the server forwards it to all other participants. This is how production video apps (Discord, Whereby) work. It makes the planned 10-person spectator feature feasible without destroying anyone's upload bandwidth.

### Game state — in-memory vs database

During a live game, state lives in a **Node.js in-memory Map**:

```
gameId → { fen: string, moves: Move[], players: string[] }
```

This keeps move validation and broadcast latency under 5ms — no database round trip on the hot path. When Postgres is added (planned), moves will be written asynchronously using `setImmediate` so the database write never blocks the game:

```typescript
// move is processed and broadcast first (sync)
broadcastMove(gameId, move);

// then written to DB async — does not block above
setImmediate(() => db.saveMove(gameId, move));
```

---

## Running Locally (without Docker)

Recommended for development and two-player testing. WebRTC on the same machine works cleanly without Docker's extra network layer.

```bash
# Terminal 1 — backend
cd server
npm install
npm run dev

# Terminal 2 — frontend
cd client
npm install
npm run dev
```

Open `http://localhost:3000` in two separate browser tabs.

---

## Running with Docker

Docker is provided for deployment purposes. For local two-tab testing, use the method above — MediaSoup inside Docker on the same machine has ICE candidate issues with loopback addresses that make same-device testing unreliable.

### Prerequisites

- Docker Desktop installed and running
- `.env` file at the project root (see below)

### Environment variables

Create a `.env` file at the root of the project:

```env
PORT=8080
NODE_ENV=production
MEDIASOUP_ANNOUNCED_IP=127.0.0.1   # replace with your VPS/EC2 public IP when deploying
CORS_ORIGIN=http://localhost:3000  # replace with your frontend URL when deploying
```

### Start

```bash
docker compose up --build
```

### Port ranges — local vs production

| Environment | Compose port mapping | MediaSoup config |
|---|---|---|
| Local / Docker Desktop (Windows) | `40000-40010` | `minPort: 40000, maxPort: 40010` |
| Linux VPS / EC2 | `40000-41000` | `minPort: 40000, maxPort: 41000` |

**Why the difference:** Docker Desktop on Windows uses WSL2/Hyper-V underneath. Mapping a large UDP port range (40000–41000) causes bind errors because Windows quietly reserves random ports in that range for its own networking stack. A small range of 10 ports is enough for local testing (each MediaSoup transport uses 2 ports = 5 concurrent video connections).

On a Linux VPS or EC2 instance, there is no Hyper-V layer — the full 1000-port range works without issues and supports a production load of concurrent games.

To switch to production range, update `docker-compose.yml`:
```yaml
- "40000-41000:40000-41000/udp"
- "40000-41000:40000-41000/tcp"
```

And in your MediaSoup worker config:
```typescript
minPort: 40000,
maxPort: 41000,
```

---

## Planned Features

- [ ] Postgres integration — async move history persistence
- [ ] Redis Pub/Sub — stateless horizontal scaling
- [ ] Spectator mode — up to 10 viewers via MediaSoup SFU
- [ ] CI/CD pipeline — GitHub Actions → Docker Hub → VPS
- [ ] Live deployment on VPS with permanent domain + SSL
