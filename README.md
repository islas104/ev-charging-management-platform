
---

## Key Capabilities

### Backend
- OCPP 1.6 WebSocket gateway
- Charger identification & protocol negotiation
- Supported actions:
  - BootNotification
  - Heartbeat
  - StartTransaction
  - StopTransaction
- Persistent charger & transaction storage (PostgreSQL)
- Admin monitoring API
- Structured logging

### Frontend
- Charger simulator with live protocol messages
- Admin dashboard with live charger & transaction visibility
- No framework or build step required

---

## Getting Started

### 1. Start the Backend

```bash
cd backend
npm install
npm run start:dev
```

Backend runs at:

`http://localhost:3000`

Health check:

`GET /health`

* * * * *

### 2\. Open the Charger Simulator

Open in a browser:

`frontend/index.html`

Simulates:

-   Charger connection

-   BootNotification

-   Start/Stop transactions

-   Heartbeats

* * * * *

### 3\. Open the Admin Dashboard

Open in a browser:

`frontend/admin.html`

Displays:

-   Connected chargers

-   Registration state

-   Transaction history

-   Heartbeat timestamps

* * * * *

Recommended Demo Flow
---------------------

1.  Start the backend

2.  Open the **Admin Dashboard**

3.  Open the **Charger Simulator**

4.  Click **Connect**

5.  Observe charger appear in admin view

6.  Start and stop a transaction

7.  Watch state update live

This demonstrates a **real OCPP lifecycle end-to-end**.

* * * * *

Current Scope (MVP)
-------------------

This repository intentionally focuses on:

-   Protocol correctness

-   Clear system behaviour

-   End-to-end demonstrability

It **does not** yet include:

-   Authentication

-   Billing or tariffs

-   Multi-site management

-   Production deployment configuration

* * * * *

Roadmap
-------

Planned enhancements:

-   Authentication & RBAC

-   Multi-charger & multi-site support

-   Dockerisation & CI/CD

-   Horizontal scaling

-   OCPP 2.0.1 support

-   Billing & reporting services

* * * * *

License
-------

MIT

* * * * *

Author
------

**Islas Ahmed Nawaz**\
Cloud Tunnel\
EV Charging & Platform Engineering