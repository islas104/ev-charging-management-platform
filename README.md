EV Charging Management Platform
===============================

A lightweight EV charging platform implementing **OCPP 1.6**, featuring a real-time backend, a charger simulator, and an admin dashboard.\
Designed for demonstrations, pilots, and as a foundation for a production-grade EV charging system.

* * * * *

What This Project Is
--------------------

This repository contains a **full end-to-end OCPP implementation**:

-   A **NestJS backend** handling OCPP 1.6 over WebSockets

-   A **browser-based charger simulator** to emulate real chargers

-   A **live admin dashboard** for monitoring chargers, locations, tariffs, and QR onboarding (JWT login)

The platform demonstrates the **complete EV charging lifecycle** in a clear, inspectable way.

* * * * *

Repository Structure
--------------------

`.
├── backend/            # OCPP backend service (NestJS)
│   └── README.md
├── frontend/           # Static frontend UIs
│   ├── index.html      # Charger simulator
│   └── admin.html      # Admin dashboard
├── README.md           # You are here`

* * * * *

Key Capabilities
----------------

### Backend

-   OCPP 1.6 WebSocket gateway

-   Charger identification and protocol negotiation

-   Supported actions:

    -   BootNotification

    -   Heartbeat

    -   StartTransaction

    -   StopTransaction

-   PostgreSQL-backed charger and transaction state (Prisma)

-   Admin monitoring API + JWT auth + role-based access
-   Admin user management (super admin only)
-   Accounts, locations, tariffs, and QR onboarding
-   Driver analytics (top drivers by energy)

-   Structured logging

### Frontend

-   Charger simulator with live protocol messages

-   Admin dashboard with real-time charger visibility

-   No build step or framework dependency

* * * * *

Getting Started
---------------

### 1\. Configure and Start the Backend

`cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run start:dev`

Backend runs on:

`http://localhost:3000` (or `PORT` from `.env`)

Health check:

`GET /health`

* * * * *

### 2\. Open the Charger Simulator

Open in a browser:

`frontend/index.html`

Simulates:

-   Charger connection

-   Boot notification

-   Charging session start / stop

-   Heartbeats

* * * * *

### 3\. Open the Admin Dashboard

Open in a browser:

`frontend/admin.html`

Shows:

-   Connected chargers

-   Registration status

-   Active transactions

-   Heartbeat timestamps
-   Pricing, revenue, and driver analytics
-   Accounts, locations, tariffs, QR codes
-   Admin users (super admin only)

Login:
- `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from `backend/.env`

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

This demonstrates a **real OCPP lifecycle** end-to-end.

Tap-like Onboarding Flow
------------------------

1. Create an **Account** (owner/operator)
2. Create a **Tariff** (start, energy, idle fees)
3. Create a **Location** with GPS + assign the tariff
4. Assign a **Charger** to the location
5. Create a **QR code** linked to the charger

* * * * *

Current Scope
-------------

This repository intentionally focuses on:

-   Protocol correctness

-   Clear system behaviour

-   Demo and MVP readiness

It does **not** yet include:

-   Production deployment configuration

* * * * *

Roadmap
-------

Planned enhancements include:

-   Dockerisation and CI/CD

-   Multi-charger scaling

-   OCPP 2.0.1 support

-   Billing and reporting services

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
