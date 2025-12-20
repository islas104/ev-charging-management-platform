EV Charging Platform -- Backend (OCPP)

This service implements an OCPP 1.6 WebSocket backend for managing EV chargers, charging sessions, and real-time status updates. It is designed as a clean, extensible foundation for a production EV charging platform.

Responsibilities

The backend is responsible for:

Managing WebSocket connections from EV chargers

Handling OCPP 1.6 protocol messages

Tracking charger and transaction state

Exposing admin APIs for monitoring

Providing structured logging and observability

Technology Stack

Node.js

NestJS

WebSockets (ws)

OCPP 1.6

nestjs-pino (structured logging)

TypeScript

High-Level Architecture

src/

├── app.module.ts

├── main.ts

├── common/

│ └── middleware/

│ └── request-id.middleware.ts

└── modules/

├── ocpp/

│ ├── gateway/

│ │ └── ocpp.gateway.ts

│ ├── handlers/

│ │ ├── boot-notification.handler.ts

│ │ ├── heartbeat.handler.ts

│ │ ├── start-transaction.handler.ts

│ │ └── stop-transaction.handler.ts

│ ├── ocpp-message.router.ts

│ ├── ocpp-protocol.resolver.ts

│ ├── ocpp.state.ts

│ └── ocpp.module.ts

└── admin/

└── admin.controller.ts

OCPP Support

Implemented Actions (OCPP 1.6)

BootNotification

Heartbeat

StartTransaction

StopTransaction

Each action:

Is routed via a central message router

Has a dedicated handler

Returns protocol-compliant responses

WebSocket Gateway

Endpoint

ws://localhost:3000/ocpp?chargerId={CHARGER_ID}

Protocol Negotiation

The backend negotiates OCPP protocol versions using the

Sec-WebSocket-Protocol header.

Supported:

ocpp1.6

Charger State Management

Charger and session state is tracked in memory for clarity and speed.

Tracked attributes include:

Charger ID

Connection timestamp

Registration status

Active transaction ID

Last heartbeat timestamp

State is exposed via the admin API.

Admin API

Get Connected Chargers

GET /admin/chargers

Response:

[

{

"chargerId": "DEMO-CHARGER-001",

"connectedAt": "2025-01-01T12:00:00Z",

"registered": true,

"activeTransactionId": 1001,

"lastHeartbeatAt": "2025-01-01T12:05:00Z"

}

]

This endpoint is intentionally unauthenticated for MVP/demo purposes.

Logging & Observability

Structured JSON logs

Request correlation via x-request-id

Human-readable output in development

Clear lifecycle logs for:

Connections

OCPP actions

Transactions

Environment Configuration

.env.example

PORT=3000

Running Locally

Install Dependencies

npm install

Start Development Server

npm run start:dev

The backend will start on:

http://localhost:3000

Health check:

GET /health

Design Principles

Explicit over implicit

Protocol correctness first

Simple state model

Easy to extend for persistence and scaling

No premature infrastructure complexity

Known Limitations

No persistent storage (in-memory only)

No authentication or authorisation

Single-instance only (no clustering)

These are intentional for MVP clarity.

Future Enhancements

PostgreSQL persistence

Authentication for admin APIs

Dockerisation and deployment

Horizontal scaling

OCPP 2.0.1 support

Billing and reporting services

Author

Islas Ahmed Nawaz

Cloud Tunnel

EV Charging & Platform Engineering