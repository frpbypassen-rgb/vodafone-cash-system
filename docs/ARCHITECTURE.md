# 🏗️ Architecture Documentation — Al-Ahram Pay

> **Version**: 2.0 | **Last Updated**: 2026-06-04 | **Author**: Eng. Mohamed Ali

---

## Table of Contents

1. [System Overview](#system-overview)
2. [C4 Architecture Diagrams](#c4-architecture-diagrams)
3. [Component Architecture](#component-architecture)
4. [Transfer Flow (End-to-End)](#transfer-flow-end-to-end)
5. [Financial Engine (Double-Entry Ledger)](#financial-engine-double-entry-ledger)
6. [Authentication Architecture](#authentication-architecture)
7. [Real-time Communication](#real-time-communication)
8. [Technology Stack](#technology-stack)
9. [Deployment Architecture](#deployment-architecture)
10. [Security Architecture](#security-architecture)
11. [Scalability & Performance](#scalability--performance)
12. [Design Decisions & Trade-offs](#design-decisions--trade-offs)
13. [Directory Structure](#directory-structure)

---

## System Overview

Al-Ahram Pay is an **enterprise-grade financial transfer system** designed for international money transfers between Egypt (EGP) and Libya (LYD). The system implements a **double-entry accounting ledger**, supports multiple client types (individuals, companies, sub-accounts), and integrates with Telegram bots for operations management.

### Key Capabilities

| Capability | Description |
|---|---|
| **Multi-channel Access** | Mobile App (REST API), Web Portals (3), Telegram Bots (3) |
| **Financial Engine** | Double-entry ledger with atomic transactions |
| **Real-time Operations** | WebSocket-based live updates via Socket.IO |
| **Multi-tier Pricing** | 3-tier exchange rate system per client |
| **Automated Execution** | API integration for automated transfers |
| **Enterprise Security** | JWT + Session auth, Helmet, Rate Limiting, Audit Trail |
| **Multi-Tenant Ready** | Tenant isolation support for multiple organizations |

---

## C4 Architecture Diagrams

### Level 1: System Context Diagram

```mermaid
graph TB
    subgraph External ["External Systems"]
        TG["Telegram API<br/>(Bot Platform)"]
        VF["Mobile Network APIs<br/>(Vodafone, Orange, etc.)"]
        SMTP["Email/SMS Gateway<br/>(Notifications)"]
    end

    subgraph Users ["User Groups"]
        CU["👤 Individual Clients<br/>(Mobile App / Telegram)"]
        CC["🏢 Company Clients<br/>(Web Portal / Telegram)"]
        EX["👷 Executors<br/>(Mobile App / Telegram)"]
        AD["🔑 Administrators<br/>(Web Panel / Telegram)"]
        MC["🏪 Merchants<br/>(API Integration)"]
    end

    AP["🏛️ Al-Ahram Pay<br/>Financial Transfer System"]

    CU -->|"Create transfers,<br/>check balance"| AP
    CC -->|"Manage transfers,<br/>view reports"| AP
    EX -->|"Accept & execute<br/>transfers"| AP
    AD -->|"Manage system,<br/>approve operations"| AP
    MC -->|"Merchant API<br/>operations"| AP

    AP -->|"Send notifications,<br/>receive commands"| TG
    AP -->|"Execute transfers<br/>via API"| VF
    AP -.->|"Alert notifications"| SMTP

    style AP fill:#1a73e8,stroke:#0d47a1,color:white,stroke-width:3px
```

### Level 2: Container Diagram

```mermaid
graph TB
    subgraph ClientLayer ["📱 Client Applications"]
        MA["Mobile App<br/>(Flutter)<br/>REST API + JWT"]
        CP["Client Web Portal<br/>(EJS + Bootstrap)<br/>Session Auth"]
        EP["Executor Web Portal<br/>(EJS + Bootstrap)<br/>Session Auth"]
        APL["Admin Panel<br/>(EJS + Bootstrap)<br/>Session Auth"]
    end

    subgraph AppServer ["⚙️ Application Server (Node.js + Express 5)"]
        direction TB
        GW["API Gateway Layer<br/>/api/mobile • /api/bot • /api/v1/merchant"]
        MW["Security Middleware<br/>Helmet • Rate Limit • JWT • Sanitize"]
        
        subgraph Controllers ["Controllers"]
            AC["Auth Controller"]
            CC2["Client Controller"]
            EC["Executor Controller"]
            AMC["Admin Controller"]
            MRC["Merchant Controller"]
        end
        
        subgraph Services ["Core Services"]
            AS["Auth Service"]
            TS["Transfer Service"]
            WS["Wallet Service<br/>(Double-Entry)"]
            QS["Queue Service<br/>(Task Distribution)"]
            AUS["Audit Service"]
            NS["Notification Service"]
            SS["Security Service"]
            STS["Settlement Service"]
            RS["Reconciliation Service"]
            CS["Cache Service"]
        end

        subgraph Repos ["Repositories"]
            UR["User Repository"]
            TR["Transaction Repository"]
            LR["Ledger Repository"]
            SR["Settings Repository"]
        end
    end

    subgraph BotLayer ["🤖 Telegram Bots"]
        AB["Admin Bot<br/>(Telegraf)"]
        CB["Client Bots<br/>(Multi-instance)"]
        EB["Executor Bots<br/>(Multi-instance)"]
    end

    subgraph DataLayer ["💾 Data Layer"]
        MDB[("MongoDB<br/>(Mongoose 9)<br/>18 Collections")]
        RD[("Redis<br/>Cache + Sessions<br/>+ Rate Limit")]
        FS["File System<br/>(Proof Images)"]
    end

    subgraph Monitoring ["📊 Monitoring"]
        WN["Winston Logs<br/>(Structured JSON)"]
        PM["Prometheus Metrics<br/>(/metrics)"]
        HC["Health Checks<br/>(/health, /health/ready)"]
    end

    subgraph RealTime ["🔄 Real-time"]
        WS_IO["WebSocket Server<br/>(Socket.IO 4)"]
    end

    MA --> GW
    CP --> GW
    EP --> GW
    APL --> GW

    GW --> MW --> Controllers
    Controllers --> Services
    Services --> Repos
    Repos --> MDB

    Services --> RD
    Services --> FS

    AB --> GW
    CB --> GW
    EB --> GW

    AppServer --> WN
    AppServer --> PM
    AppServer --> HC

    WS_IO -.->|"Live updates"| ClientLayer

    style AppServer fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style DataLayer fill:#fff3e0,stroke:#e65100,stroke-width:2px
```

### Level 3: Component Diagram (Core Services)

```mermaid
graph LR
    subgraph Routes ["Routes Layer (18 files)"]
        R1["mobileApi.js<br/>(Mobile REST)"]
        R2["clientPortal.js<br/>(Client Web)"]
        R3["executorPortal.js<br/>(Executor Web)"]
        R4["adminTransactions.js<br/>(Admin Panel)"]
        R5["botApi.js<br/>(Bot Endpoints)"]
        R6["merchantApi.js<br/>(Merchant)"]
    end

    subgraph Controllers ["Controllers Layer"]
        C1["authController"]
        C2["clientController"]
        C3["executorController"]
        C4["adminController"]
        C5["merchantController"]
    end

    subgraph Services ["Services Layer (12+ files)"]
        S1["authService"]
        S2["transferService"]
        S3["walletService<br/>(Double-Entry)"]
        S4["auditService"]
        S5["queueService"]
        S6["notificationService"]
        S7["securityService"]
        S8["settlementService"]
        S9["reconciliationService"]
        S10["cacheService"]
    end

    subgraph Repositories ["Repository Layer"]
        RP1["userRepository"]
        RP2["transactionRepository"]
        RP3["ledgerRepository"]
        RP4["settingsRepository"]
    end

    subgraph Models ["Models Layer (18+ models)"]
        M1["Transaction"]
        M2["Ledger"]
        M3["User"]
        M4["ClientBot"]
        M5["Employee"]
        M6["ExecutorBot"]
        M7["AuditLog"]
        M8["Settings"]
        M9["Settlement"]
        M10["Reconciliation"]
        M11["Tenant"]
    end

    Routes --> Controllers
    Controllers --> Services
    Services --> Repositories
    Repositories --> Models
    Models --> DB[("MongoDB")]
```

---

## Transfer Flow (End-to-End)

### Happy Path: Client → Transfer → Executor → Complete

```mermaid
sequenceDiagram
    participant C as 📱 Client App
    participant GW as 🔌 API Gateway
    participant MW as 🛡️ Security Layer
    participant TS as 💼 Transfer Service
    participant WS as 💰 Wallet Service
    participant DB as 💾 MongoDB
    participant L as 📒 Ledger
    participant Q as 📋 Queue Service
    participant E as 👷 Executor
    participant TB as 🤖 Telegram Bot
    participant AU as 📋 Audit Log
    participant CA as 🗄️ Cache

    Note over C,CA: Phase 1: Authentication
    C->>GW: POST /api/mobile/login
    GW->>MW: JWT Auth + Rate Limit Check
    MW->>CA: Check rate limit counter
    MW->>DB: Verify credentials (bcrypt)
    DB-->>MW: Account found
    MW-->>C: { accessToken, refreshToken, user }
    MW->>AU: Log LOGIN_SUCCESS

    Note over C,CA: Phase 2: Create Transfer
    C->>GW: POST /api/mobile/client/new-transfer
    GW->>MW: Validate JWT + Rate Limit + Input Validation
    MW->>TS: createTransfer(userId, data)
    
    TS->>DB: START TRANSACTION (atomic)
    TS->>DB: Check system status (isManualClosed?)
    TS->>DB: Check idempotency key
    TS->>WS: deductBalance(clientId, costLYD)
    WS->>DB: findOneAndUpdate({ balance >= required })
    WS->>L: Create DEBIT entry
    TS->>DB: Generate customId (Counter)
    TS->>DB: Create Transaction (status: pending)
    TS->>DB: COMMIT TRANSACTION
    
    TS-->>C: { success, txId, newBalance }
    TS->>AU: Log TRANSFER_CREATED
    TS->>TB: Notify admins (async)

    Note over C,CA: Phase 3: Route to Executor
    Q->>DB: Find available executor bot
    Q->>DB: Update status → processing
    Q->>TB: Broadcast to executor group
    TB-->>E: "New task available"

    Note over C,CA: Phase 4: Execute Transfer
    E->>GW: POST /executor/accept-task/:id
    GW->>DB: Update status → accepted (atomic)
    GW->>TB: Update broadcast messages
    GW->>AU: Log TASK_ACCEPTED

    E->>GW: POST /executor/complete-task/:id
    GW->>DB: Update status → completed
    GW->>WS: Deduct executor bot balance
    GW->>L: Create CREDIT entry
    GW->>TB: Send proof to client + admins
    GW->>AU: Log TRANSFER_COMPLETED
    GW-->>E: { success }
```

### Cancel/Rollback Flow

```mermaid
sequenceDiagram
    participant E as 👷 Executor
    participant API as 🔌 API Server
    participant DB as 💾 MongoDB
    participant WS as 💰 Wallet Service
    participant L as 📒 Ledger
    participant TB as 🤖 Telegram Bot

    E->>API: POST /executor/cancel-task/:id
    API->>DB: START TRANSACTION
    API->>DB: Verify task status = accepted
    API->>WS: refundBalance(clientId, costLYD)
    WS->>DB: findOneAndUpdate({ $inc: balance })
    WS->>L: Create REFUND entry
    API->>DB: Update status → rejected
    API->>DB: COMMIT TRANSACTION
    API-->>E: { success, message }
    API->>TB: Notify client (refund)
    API->>TB: Notify admins (cancellation)
```

### API Auto-Execution Flow

```mermaid
sequenceDiagram
    participant Q as 📋 Queue Service
    participant API as 🌐 External API
    participant DB as 💾 MongoDB
    participant WS as 💰 Wallet Service
    participant TB as 🤖 Telegram Bot

    Q->>Q: Dequeue job
    Q->>API: Execute transfer via external API
    
    alt Success (RefNumber contains *)
        Q->>DB: Update status → completed
        Q->>WS: Deduct executor balance
        Q->>Q: Generate receipt image
        Q->>TB: Send proof to all parties
    else Pending (network delay)
        Q->>DB: Update status → pending (review)
        Q->>TB: Notify admins
    else Failure
        Q->>DB: Reset status → pending (unassign)
        Q->>TB: Notify executor team
    end
```

---

## Financial Engine (Double-Entry Ledger)

The system implements a **Double-Entry Bookkeeping** model. Every financial movement creates balanced debit and credit entries.

### Accounting Principles

```mermaid
graph TD
    subgraph Transfer ["💸 Transfer Operation (100 EGP at rate 6.40)"]
        T1["Client requests transfer"]
        T2["📕 DEBIT: Client Account<br/>-15.625 LYD"]
        T3["📗 CREDIT: System Revenue<br/>+15.625 LYD"]
        T4["📕 DEBIT: Executor Custody<br/>-100 EGP"]
    end

    subgraph Deposit ["💰 Deposit Operation"]
        D1["Admin adds balance"]
        D2["📗 CREDIT: Client Account<br/>+X LYD"]
    end

    subgraph Deduction ["➖ Deduction Operation"]
        DD1["Admin deducts balance"]
        DD2["📕 DEBIT: Client Account<br/>-X LYD"]
    end

    subgraph Rollback ["🔄 Cancel/Rollback"]
        R1["Executor cancels task"]
        R2["📗 CREDIT: Client Account<br/>+15.625 LYD (refund)"]
        R3["📕 DEBIT: System Revenue<br/>-15.625 LYD"]
    end

    T1 --> T2 & T3 & T4
    D1 --> D2
    DD1 --> DD2
    R1 --> R2 & R3
```

### Balance Calculation Formula

```
Client Balance = Initial Deposit
                 + Sum(Deposits)
                 - Sum(Transfer Costs in LYD)
                 - Sum(Deductions)
                 + Sum(Refunds from Cancelled Transfers)
```

### Ledger Entry Types

| Type | Direction | When |
|---|---|---|
| `DEPOSIT` | + (Credit) | Admin adds funds to client |
| `DEDUCTION` | - (Debit) | Admin deducts from client |
| `TRANSFER` | - (Debit) | Client creates transfer |
| `REFUND` | + (Credit) | Transfer cancelled, balance restored |
| `COMMISSION` | - (Debit) | System commission on operations |

### Atomicity Guarantees

1. **MongoDB Transactions**: All balance changes use `startSession()` + `startTransaction()`
2. **Atomic Updates**: `findOneAndUpdate` with balance check in the filter (`balance >= required`)
3. **Fallback Mode**: For standalone MongoDB (no replica set), uses atomic `findOneAndUpdate` without sessions
4. **Ledger Integrity**: Every `$inc` on balance creates a corresponding Ledger entry within the same session

---

## Authentication Architecture

### Dual Authentication System

```mermaid
graph TB
    subgraph WebAuth ["🌐 Web Authentication (Session-Based)"]
        W1["Browser Request"] -->|"POST /login"| W2["Express Session Middleware"]
        W2 -->|"Verify credentials<br/>(bcrypt.compare)"| W3["Create Session"]
        W3 -->|"Set-Cookie: sid=..."| W4["Session Store<br/>(MongoDB / Memory)"]
        W4 -->|"requireAuth middleware"| W5["Protected Routes"]
    end

    subgraph MobileAuth ["📱 Mobile Authentication (JWT)"]
        M1["Mobile App"] -->|"POST /api/mobile/login"| M2["Validate Credentials"]
        M2 -->|"jwt.sign()"| M3["Generate Tokens"]
        M3 -->|"accessToken (1h)<br/>refreshToken (30d)"| M1
        M1 -->|"Authorization: Bearer ..."| M4["authenticateJWT Middleware"]
        M4 -->|"jwt.verify()"| M5["req.user = decoded"]
        M5 --> M6["Protected Endpoints"]
    end

    subgraph BotAuth ["🤖 Telegram Bot Authentication"]
        B1["Telegram Message"] -->|"ctx.from.id"| B2["Lookup telegramId"]
        B2 -->|"Employee / User / Admin"| B3["Bot Command Handler"]
    end
```

### JWT Token Lifecycle

```mermaid
sequenceDiagram
    participant App as 📱 Mobile App
    participant API as 🔌 API Server

    App->>API: POST /login { username, password }
    API-->>App: { accessToken (1h), refreshToken (30d) }

    Note over App: Use accessToken for all requests

    App->>API: GET /client/home (Authorization: Bearer <accessToken>)
    API-->>App: { balance, rate, isOpen }

    Note over App: After 1 hour, accessToken expires

    App->>API: GET /client/home (expired token)
    API-->>App: 401 { code: TOKEN_EXPIRED }

    App->>API: POST /refresh-token { refreshToken }
    API-->>App: { accessToken (new, 1h) }

    Note over App: After 30 days, refreshToken expires → re-login
```

### Account Types & Login Priority

| Priority | Account Type | Model | Search Fields |
|---|---|---|---|
| 1 | Executor | `Employee` | `webUsername`, `phone` |
| 2 | Company Staff | `ClientEmployee` | `webUsername`, `phone` |
| 3 | Individual | `User` | `webUsername`, `phone` |

---

## Real-time Communication

### Socket.IO Architecture

```mermaid
graph LR
    subgraph Server ["Server"]
        APP["Express App"] --> IO["Socket.IO Server"]
        MG["Mongoose Plugin"] -->|"post save/update/delete"| IO
    end

    subgraph Clients ["Connected Clients"]
        C1["Admin Panel"]
        C2["Client Portal"]
        C3["Executor Portal"]
    end

    IO -->|"emit('update_data')"| C1
    IO -->|"emit('update_data')"| C2
    IO -->|"emit('update_data')"| C3
```

### Events

| Event | Direction | Description |
|---|---|---|
| `update_data` | Server → Client | Any data change in MongoDB |
| `connection` | Client → Server | New WebSocket connection |
| `disconnect` | Client → Server | Client disconnected |

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Runtime** | Node.js | 18+ | Server-side JavaScript |
| **Framework** | Express.js | 5.x | HTTP routing & middleware |
| **Database** | MongoDB | 7+ | Document store (primary) |
| **Cache** | Redis | 7+ | Sessions, cache, rate limiting |
| **ODM** | Mongoose | 9.x | Schema validation & queries |
| **Auth (Web)** | express-session | 1.19 | Cookie-based sessions |
| **Auth (Mobile)** | jsonwebtoken | 9.x | Stateless JWT auth |
| **Real-time** | Socket.IO | 4.x | WebSocket events |
| **Bots** | Telegraf | 4.x | Telegram Bot API |
| **Security** | Helmet | 8.x | HTTP security headers |
| **Rate Limit** | express-rate-limit | 8.x | DDoS protection |
| **Validation** | express-validator | 7.x | Input sanitization |
| **Hashing** | bcryptjs | 3.x | Password hashing (12 rounds) |
| **Encryption** | crypto (AES-256-GCM) | native | Sensitive data encryption |
| **Reports** | ExcelJS | 4.x | Excel generation |
| **PDF** | Puppeteer | 24.x | Receipt rendering |
| **Logging** | Winston | 3.x | Structured JSON logging |
| **Metrics** | prom-client | 15.x | Prometheus metrics |
| **Testing** | Jest + Supertest | 29.x | Unit & integration tests |
| **CI/CD** | GitHub Actions | — | Automated pipeline |
| **Container** | Docker + Compose | — | Deployment |

---

## Deployment Architecture

### Production Topology

```mermaid
graph TB
    subgraph Internet ["🌐 Internet"]
        CF["Cloudflare<br/>(CDN + DDoS Protection)"]
    end

    subgraph Server ["🖥️ Production Server"]
        NG["Nginx<br/>(Reverse Proxy + SSL)"]
        
        subgraph Docker ["Docker Environment"]
            APP["Node.js App<br/>(PM2 / Docker)<br/>Port 3000"]
            RD["Redis 7<br/>Port 6379"]
            MDB["MongoDB 7<br/>(Replica Set)<br/>Port 27017"]
        end

        subgraph Monitoring_Stack ["Monitoring Stack"]
            PROM["Prometheus<br/>Port 9090"]
            GRAF["Grafana<br/>Port 3001"]
            APP_METRICS["/metrics endpoint"]
        end
    end

    subgraph Backup ["💾 Backup"]
        S3["Cloud Storage<br/>(Daily Backups)"]
    end

    CF --> NG
    NG --> APP
    APP --> RD
    APP --> MDB
    APP --> APP_METRICS
    PROM --> APP_METRICS
    GRAF --> PROM
    MDB -->|"mongodump (daily)"| S3

    style APP fill:#1a73e8,stroke:#0d47a1,color:white
    style Docker fill:#e3f2fd,stroke:#1565c0
```

---

## Security Architecture

### Defense-in-Depth Model

```mermaid
graph TB
    subgraph Layer1 ["Layer 1: Network"]
        L1A["Cloudflare DDoS Protection"]
        L1B["Nginx SSL Termination"]
        L1C["CORS Origin Whitelisting"]
    end

    subgraph Layer2 ["Layer 2: Application"]
        L2A["Helmet Security Headers"]
        L2B["Rate Limiting (Global + Per-Route)"]
        L2C["Input Sanitization"]
        L2D["CSRF Protection (Sessions)"]
    end

    subgraph Layer3 ["Layer 3: Authentication"]
        L3A["JWT (Mobile) + Sessions (Web)"]
        L3B["bcrypt Password Hashing (12 rounds)"]
        L3C["Account Lock (5 failed attempts)"]
        L3D["Refresh Token Rotation"]
    end

    subgraph Layer4 ["Layer 4: Authorization"]
        L4A["Role-Based Access Control"]
        L4B["Resource-Level Permissions"]
        L4C["Tenant Isolation"]
    end

    subgraph Layer5 ["Layer 5: Data"]
        L5A["AES-256-GCM Encryption (at rest)"]
        L5B["TLS 1.2+ (in transit)"]
        L5C["Sensitive Field Redaction"]
    end

    subgraph Layer6 ["Layer 6: Audit"]
        L6A["Immutable Audit Log"]
        L6B["IP + UserAgent Tracking"]
        L6C["Anomaly Detection"]
    end

    Layer1 --> Layer2 --> Layer3 --> Layer4 --> Layer5 --> Layer6
```

> 📖 For detailed security documentation, see [SECURITY.md](SECURITY.md)

---

## Scalability & Performance

### Current Architecture Limits

| Resource | Current Capacity | Bottleneck |
|---|---|---|
| **Concurrent Users** | ~500 | Single Node.js process |
| **Transfers/min** | ~1,000 | MongoDB write throughput |
| **WebSocket Connections** | ~10,000 | Socket.IO memory |

### Scaling Strategy

```mermaid
graph LR
    subgraph Phase1 ["Phase 1: Vertical"]
        V1["Increase server RAM/CPU"]
        V2["MongoDB indexes optimization"]
        V3["Redis caching"]
    end

    subgraph Phase2 ["Phase 2: Horizontal"]
        H1["Load balancer (Nginx)"]
        H2["Redis for shared sessions"]
        H3["MongoDB Replica Set"]
    end

    subgraph Phase3 ["Phase 3: Distributed"]
        D1["Microservices extraction"]
        D2["Message queue (RabbitMQ)"]
        D3["MongoDB Sharding"]
    end

    Phase1 --> Phase2 --> Phase3
```

### Performance Optimization Checklist

- [x] Compound indexes on all frequent queries
- [x] Atomic `findOneAndUpdate` (no race conditions)
- [x] Mongoose `lean()` for read-only queries
- [x] Redis caching for settings and exchange rates
- [x] Connection pooling (Mongoose default: 100)
- [x] Rate limiting to prevent abuse
- [ ] Read replicas for reporting queries
- [ ] CDN for static assets

---

## Design Decisions & Trade-offs

### 1. Monolithic vs Microservices

**Decision**: Monolithic with modular internal architecture (Controllers → Services → Repositories).

**Rationale**:
- Simpler deployment and debugging for a financial system
- MongoDB transactions work best within a single process
- Modular design allows future extraction to microservices
- Team size (1-3 developers) favors monolith

### 2. MongoDB vs PostgreSQL

**Decision**: MongoDB (document store)

**Rationale**:
- Flexible schema for varying transaction types
- Native JSON for API responses
- Mongoose provides schema validation
- Double-entry ledger works well with document model
- **Trade-off**: No native JOIN support → denormalized data

### 3. JWT + Sessions (Dual Auth)

**Decision**: JWT for mobile, Sessions for web

**Rationale**:
- Mobile apps need stateless auth (JWT)
- Web portals benefit from server-side sessions (CSRF protection)
- Different security models for different attack surfaces

### 4. Single Instance for Financial Operations

**Decision**: `instances: 1` in PM2 config

**Rationale**:
- Financial atomicity requires single-writer
- MongoDB sessions + transactions handle concurrent requests
- Scaling via vertical scaling first, then distributed locking
- **Trade-off**: Single point of failure → mitigated by health checks + auto-restart

### 5. Telegram as Primary Notification Channel

**Decision**: Telegram bots for client/executor/admin communication

**Rationale**:
- Target market (Libya) has high Telegram adoption
- Real-time bidirectional communication
- File sharing (proof images) built-in
- No SMS costs

---

## Directory Structure

```
vodafone-cash-system/
├── app.js                        # Entry point + middleware + route mounting
├── config/
│   ├── database.js               # MongoDB connection
│   ├── redis.js                  # Redis connection + fallback
│   ├── swagger.js                # OpenAPI/Swagger configuration
│   └── env.js                    # Environment validation
├── controllers/                  # Request handlers (thin layer)
│   ├── auth/
│   │   └── authController.js
│   ├── client/
│   │   └── clientController.js
│   └── executor/
│       └── executorController.js
├── services/                     # Business logic
│   ├── authService.js            # Authentication & token management
│   ├── transferService.js        # Transfer creation, cancel, complete
│   ├── walletService.js          # Double-entry ledger operations
│   ├── auditService.js           # Audit trail management
│   ├── securityService.js        # IP tracking, anomaly detection
│   ├── queueService.js           # API transfer queue
│   ├── notificationService.js    # Telegram notifications
│   ├── settlementService.js      # Financial settlements
│   ├── reconciliationService.js  # Balance reconciliation
│   ├── cacheService.js           # Redis/memory caching
│   └── passwordService.js        # Password hashing & migration
├── repositories/                 # Data access layer
│   ├── userRepository.js
│   ├── transactionRepository.js
│   ├── ledgerRepository.js
│   └── settingsRepository.js
├── models/                       # 18+ Mongoose schemas
│   ├── Transaction.js
│   ├── Ledger.js
│   ├── User.js
│   ├── ClientBot.js
│   ├── ExecutorBot.js
│   ├── Employee.js
│   ├── ClientEmployee.js
│   ├── AuditLog.js
│   ├── Settings.js
│   ├── Settlement.js
│   ├── Reconciliation.js
│   ├── Tenant.js
│   └── ...
├── routes/                       # Express routers (thin routing)
│   ├── mobileApi.js
│   ├── clientPortal.js
│   ├── executorPortal.js
│   ├── botApi.js
│   ├── merchantApi.js
│   └── ...
├── middlewares/
│   ├── auth.js                   # Session authentication
│   ├── jwtAuth.js                # JWT authentication
│   ├── errorHandler.js           # Global error handler
│   ├── sanitize.js               # Input sanitization
│   ├── accountLock.js            # Account locking after failures
│   ├── requestLogger.js          # HTTP request logging
│   ├── metrics.js                # Prometheus metrics
│   └── tenantResolver.js         # Multi-tenant resolution
├── validators/                   # Input validation rules
│   └── mobileValidators.js
├── bots/                         # Telegram bots
│   ├── admin/
│   ├── client/
│   └── executor/
├── cron/                         # Scheduled tasks
│   └── closing.js
├── utils/                        # Utilities
│   ├── encryption.js             # AES-256-GCM
│   ├── logger.js                 # Winston logger
│   ├── helpers.js
│   └── rateHelper.js
├── monitoring/                   # Monitoring configs
│   ├── grafana-dashboard.json
│   └── docker-compose.monitoring.yml
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── stress/
│   └── ...
├── docs/
│   ├── ARCHITECTURE.md           # (this file)
│   ├── API.md
│   ├── DATABASE.md
│   ├── SECURITY.md
│   └── DEPLOYMENT.md
├── .github/workflows/
│   └── ci-cd.yml
├── Dockerfile
├── docker-compose.yml
└── package.json
```
