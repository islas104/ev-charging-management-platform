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

-   A **live admin dashboard** for monitoring charger and session state

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

-   In-memory charger and transaction state

-   Admin monitoring API

-   Structured logging

### Frontend

-   Charger simulator with live protocol messages

-   Admin dashboard with real-time charger visibility

-   No build step or framework dependency

* * * * *

Getting Started
---------------

### 1\. Start the Backend

`cd backend
npm install
npm run start:dev`

Backend runs on:

`http://localhost:3000`

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

* * * * *

Current Scope
-------------

This repository intentionally focuses on:

-   Protocol correctness

-   Clear system behaviour

-   Demo and MVP readiness

It does **not** yet include:

-   Persistent storage

-   Authentication

-   Production deployment configuration

* * * * *

Roadmap
-------

Planned enhancements include:

-   Database persistence (PostgreSQL)

-   Authentication and role-based access

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