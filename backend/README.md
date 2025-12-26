
# EV Charging Platform — Backend (OCPP 1.6)

This service implements an **OCPP 1.6 WebSocket backend** for managing EV chargers, charging sessions, and real-time status updates.

It is designed as a **clean, extensible MVP foundation** for a production EV charging platform.

---

## Responsibilities

The backend is responsible for:

- Managing WebSocket connections from EV chargers
- Handling OCPP 1.6 protocol messages
- Persisting charger and transaction state
- Exposing admin APIs for monitoring
- Providing structured logging and observability

---

## Technology Stack

- Node.js
- NestJS
- WebSockets (`ws`)
- Prisma ORM
- PostgreSQL
- OCPP 1.6
- TypeScript
- `nestjs-pino` (structured logging)

---

## High-Level Architecture

src/
├── app.module.ts
├── main.ts
├── prisma/
│ └── prisma.service.ts
├── common/
│ └── middleware/
│ └── request-id.middleware.ts
└── modules/
├── ocpp/
│ ├── gateway/
│ │ └── ocpp.gateway.ts
│ ├── ocpp-message.router.ts
│ ├── ocpp.state.ts
│ └── ocpp.module.ts
└── admin/
└── admin.controller.ts


---

## OCPP Support

### Implemented Actions (OCPP 1.6)

- BootNotification
- Heartbeat
- StartTransaction
- StopTransaction

Each action:
- Is routed via a central message router
- Persists state where applicable
- Returns protocol-compliant responses

---

## WebSocket Gateway

### Endpoint



ws://localhost:3000/ocpp?chargerId={CHARGER_ID}
ws://localhost:3000/ocpp?chargerId={CHARGER_ID}&token={OCPP_SHARED_SECRET}


### Protocol Negotiation

The backend negotiates protocols via:



Sec-WebSocket-Protocol


Supported:
- `ocpp1.6`

Easee One is supported with OCPP 1.6.

---

## Charger & Transaction State

State is persisted in PostgreSQL using Prisma.

### Charger
- Charger ID
- Protocol
- Registration status
- Last heartbeat timestamp
- Created timestamp

### Transaction
- OCPP transaction ID (unique)
- Charger reference
- RFID / ID tag
- Meter values
- Start & stop timestamps
- Stop reason

---

## Admin API

### Get Connected Chargers



GET /admin/chargers


Response example:

```json
[
  {
    "chargerId": "DEMO-CHARGER-001",
    "connectedAt": "2025-12-22T11:03:45Z",
    "registered": true,
    "lastHeartbeatAt": "2025-12-22T11:47:01Z"
  }
]

Get Transactions
GET /admin/transactions


Response example:

[
  {
    "chargerId": "DEMO-CHARGER-001",
    "ocppTransactionId": 1002,
    "idTag": "RFID-12345",
    "meterStart": 0,
    "meterStop": 12,
    "startedAt": "2025-12-22T11:47:00Z",
    "stoppedAt": "2025-12-22T11:47:03Z",
    "stopReason": "Local"
  }
]
```
Admin APIs are protected by JWT auth with role-based access. Set `JWT_SECRET` and `SUPER_ADMIN_*` in `.env`.

# Environment Configuration

.env.example
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ev_charging
OCPP_SHARED_SECRET=your_charger_secret
THROTTLE_TTL=60
THROTTLE_LIMIT=120
HTTP_BODY_LIMIT=1mb
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
OCPP_ALLOW_UNKNOWN_IDTAG=true
JWT_SECRET=change_me
JWT_EXPIRES_IN=8h
SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PASSWORD=change_me

# Running Locally

## Install Dependencies
npm install

## Run Migrations
npx prisma migrate dev

## Start Development Server
npm run start:dev

Backend will run at:

http://localhost:3000 (or `PORT` from `.env`)

## Health check:
GET /health

## Readiness check:
GET /ready

# Auth & Roles

Login:
POST /auth/login

Current user:
GET /auth/me

Roles:
- ADMIN
- SUPER_ADMIN

Admin users (super admin only):
- GET /admin/users
- POST /admin/users

# Location Onboarding (Tap-like)

Accounts (super admin only):
- GET /admin/accounts
- POST /admin/accounts

Connected accounts (super admin only):
- GET /admin/connected-accounts
- POST /admin/connected-accounts

Locations:
- GET /admin/locations
- POST /admin/locations
- PUT /admin/locations/:id
- POST /admin/chargers/:chargerId/assign-location

Tariffs:
- GET /admin/tariffs
- POST /admin/tariffs

QR codes:
- GET /admin/qr-codes
- POST /admin/qr-codes

Public QR start:
- GET /public/qr/:code
- POST /public/qr/:code/start

# Design Principles

- Protocol correctness first
- Explicit over implicit behaviour
- Simple, inspectable state model
- No premature infrastructure complexity
- Easy to extend for persistence and scaling
- Known Limitations (Intentional)
- Single-instance only
- No billing or tariff logic
- These are intentional for MVP clarity.

# Future Enhancements

- Authentication & RBAC
- Dockerisation & deployment
- Horizontal scaling
- OCPP 2.0.1 support
- Billing, tariffs, and reporting

# Author
Islas Ahmed Nawaz
Cloud Tunnel
EV Charging & Platform Engineering
