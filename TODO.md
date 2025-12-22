# EV Charging Management Platform – Development TODO

This document tracks all functional and non-functional requirements for the UK MVP, broken down into implementable tasks.  
Items are grouped by domain and can be promoted directly into Jira tickets or GitHub issues.

---

## 1. Platform Foundations

- [ ] Define overall system architecture (API, WebSocket, frontend, data layer)
- [ ] Multi-tenant data model (CPO / Fleet isolation)
- [ ] Environment configuration (local / dev / prod)
- [ ] Centralised logging and request correlation
- [ ] Error handling and observability strategy

---

## 2. OCPP & Charger Integration

### Core Protocol Support
- [x] OCPP 1.6 WebSocket gateway
- [ ] OCPP 2.0.1 gateway (post-1.6 parity)
- [ ] Protocol version negotiation
- [ ] Charger identity and lifecycle management

### Charger Actions
- [x] BootNotification
- [x] Heartbeat
- [x] StartTransaction
- [x] StopTransaction
- [ ] StatusNotification
- [ ] MeterValues
- [ ] Authorize
- [ ] RemoteStartTransaction
- [ ] RemoteStopTransaction

### Charger Support
- [ ] AC chargers only (initial scope)
- [ ] Rolec charger validation
- [ ] Project EV charger validation

---

## 3. Charger & Site Management

- [ ] Create / update / delete sites
- [ ] Assign chargers to sites
- [ ] Logical grouping by site and CPO
- [ ] Charger status monitoring (Available / Charging / Faulted)
- [ ] Fault and offline detection

---

## 4. User Roles & Access Control

- [ ] Platform Admin role (full access)
- [ ] CPO / Fleet Owner role
- [ ] Site Manager role (restricted visibility)
- [ ] End Driver role
- [ ] Role-based access control (RBAC)

---

## 5. Charging Access Methods

- [ ] RFID authorisation flow
- [ ] QR code charging (mobile web)
- [ ] Wallet-based charging
- [ ] Account-based charging

---

## 6. Smart Charging Features

- [ ] Remote start / stop from admin portal
- [ ] Live session monitoring
- [ ] Power throttling / load control
- [ ] Basic load balancing per site
- [ ] Fault alerts and notifications

---

## 7. Payments & Wallet

- [ ] Stripe integration
- [ ] Wallet balance management
- [ ] Payment capture per session
- [ ] VAT handling (UK)
- [ ] Monthly invoicing (GBP)
- [ ] Payout calculations

---

## 8. Pricing & Tariffs

- [ ] Per kWh pricing
- [ ] Per minute pricing
- [ ] Session fees
- [ ] Idle fees
- [ ] Time-based pricing rules
- [ ] Assign tariffs per site / charger

---

## 9. Billing & Revenue

- [ ] Fleet subscription billing (per socket / month)
- [ ] Public charging commission model
- [ ] Automated monthly invoices
- [ ] Revenue reporting per CPO

---

## 10. Reporting & Data Export

- [ ] Live operational dashboards
- [ ] Charging session history
- [ ] CSV exports
- [ ] PDF exports
- [ ] 7-year data retention policy

---

## 11. Admin Portal

- [x] Live charger visibility
- [x] Session state display
- [ ] User management UI
- [ ] Site and charger management UI
- [ ] Pricing and tariff management UI
- [ ] Reporting UI

---

## 12. End Driver Interface

- [ ] Mobile-friendly web UI
- [ ] Start / stop charging via QR
- [ ] Wallet balance view
- [ ] Charging history
- [ ] Receipts and invoices

---

## 13. Compliance & Security

- [ ] GDPR compliance
- [ ] Data minimisation and retention rules
- [ ] Secure secrets management
- [ ] Audit logging
- [ ] Admin authentication

---

## 14. Deployment & Operations

- [ ] Dockerise backend
- [ ] Serve frontend statically
- [ ] CI/CD pipeline (GitHub)
- [ ] Environment-specific configuration
- [ ] Deployment documentation

---

## 15. Documentation & Handover

- [ ] Technical architecture documentation
- [ ] API documentation
- [ ] Admin user guide
- [ ] Deployment guide
- [ ] Knowledge transfer

---

## 16. Explicitly Out of Scope (MVP)

- [ ] Native mobile applications
- [ ] OCPI roaming
- [ ] Firmware updates
- [ ] DSR execution
- [ ] International deployment

---

**Status:** UK MVP – In Progress

This TODO represents the authoritative scope baseline and should be updated as features are completed or reprioritised.
