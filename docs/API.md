# 📡 API Documentation — Al-Ahram Pay Mobile API

> **Base URL**: `/api/mobile`  
> **Auth**: JWT Bearer Token (unless noted)  
> **Swagger UI**: Available at `/api-docs` when server is running

---

## Authentication

All endpoints (except `POST /login` and `POST /refresh-token`) require:

```
Authorization: Bearer <access_token>
```

---

## Error Codes Reference

| Code | HTTP | Description |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Wrong username or password |
| `ACCOUNT_BANNED` | 403 | Account is suspended/banned |
| `INSUFFICIENT_BALANCE` | 400 | Not enough balance for transfer |
| `SYSTEM_CLOSED` | 403 | System is closed for transfers |
| `EMPLOYEE_NOT_FOUND` | 404 | Executor account not found |
| `TASK_NOT_FOUND` | 404 | Transaction not found |
| `VALIDATION_ERROR` | 422 | Invalid input data |
| `SERVER_ERROR` | 500 | Internal server error |

---

## 🔐 Authentication Endpoints

### POST /login

Login for all account types (executor, company employee, individual user).

**Request Body:**
```json
{
    "username": "01012345678",
    "password": "MyP@ssw0rd"
}
```

**Success Response (200):**
```json
{
    "success": true,
    "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
    "accountType": "client_user",
    "user": {
        "name": "أحمد محمد",
        "balance": 5000.00,
        "tier": 2
    },
    "rate": 6.45
}
```

**Error Response (401):**
```json
{
    "success": false,
    "code": "INVALID_CREDENTIALS",
    "message": "اسم المستخدم أو كلمة المرور غير صحيحة"
}
```

**Login Priority**: Employee → ClientEmployee → User

---

### POST /refresh-token

Renew access token using refresh token.

**Request Body:**
```json
{
    "refreshToken": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**Success Response (200):**
```json
{
    "success": true,
    "accessToken": "eyJhbGciOiJIUzI1NiJ9...(new)"
}
```

---

## 👤 Client Endpoints

### GET /client/home

Get client dashboard data.

**Auth Required**: ✅ Bearer Token  
**Account Types**: `client_user`, `client_company`

**Success Response (200):**
```json
{
    "success": true,
    "balance": 5000.00,
    "rate": 6.45,
    "isOpen": true
}
```

---

### GET /client/exchange-rate

Get current exchange rate for the authenticated user's tier.

**Auth Required**: ✅  

**Success Response (200):**
```json
{
    "success": true,
    "rate": 6.45,
    "balance": 5000.00
}
```

---

### POST /client/new-transfer

Create a new transfer request.

**Auth Required**: ✅  
**Account Types**: `client_user`, `client_company`

**Request Body:**
```json
{
    "amount": 100,
    "number": "01098765432",
    "transferType": "vodafone",
    "name": "علي حسين",
    "notes": "تحويل اختبار"
}
```

**Success Response (200):**
```json
{
    "success": true,
    "code": "SUCCESS",
    "message": "تم إرسال طلبك بنجاح ✅",
    "txId": "ATT-2606-0001",
    "newBalance": 4984.375
}
```

**Error (400 — Insufficient Balance):**
```json
{
    "success": false,
    "code": "INSUFFICIENT_BALANCE",
    "message": "رصيدك غير كافٍ"
}
```

---

### GET /client/transactions

Get client's transaction history.

**Auth Required**: ✅  

**Success Response (200):**
```json
{
    "success": true,
    "transactions": [
        {
            "_id": "...",
            "customId": "ATT-2606-0001",
            "amount": 100,
            "costLYD": 15.625,
            "exchangeRate": 6.40,
            "status": "completed",
            "vodafoneNumber": "01098765432",
            "createdAt": "2026-06-03T10:30:00Z"
        }
    ]
}
```

---

## 🤖 Executor Endpoints

### GET /executor/tasks

Get available tasks for the executor.

**Auth Required**: ✅  
**Account Type**: `executor`

**Success Response (200):**
```json
{
    "success": true,
    "tasks": [
        {
            "_id": "...",
            "customId": "ATT-2606-0001",
            "amount": 100,
            "vodafoneNumber": "01098765432",
            "transferType": "vodafone",
            "status": "processing",
            "employeeName": "أحمد محمد",
            "createdAt": "2026-06-03T10:30:00Z"
        }
    ]
}
```

---

### POST /executor/accept-task/:id

Accept a pending task.

**Auth Required**: ✅  
**Account Type**: `executor`

**Success Response (200):**
```json
{
    "success": true,
    "message": "تم قبول المهمة"
}
```

---

### POST /executor/complete-task/:id

Mark a task as completed with proof.

**Auth Required**: ✅  
**Account Type**: `executor`  
**Content-Type**: `multipart/form-data`

**Form Fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `senderPhone` | string | No | Phone used for sending |
| `proofImage` | file | No | Receipt screenshot |

**Success Response (200):**
```json
{
    "success": true,
    "message": "تم إتمام المهمة بنجاح"
}
```

---

### POST /executor/cancel-task/:id

Cancel an accepted task (refunds client balance).

**Auth Required**: ✅  
**Account Type**: `executor`

**Request Body:**
```json
{
    "reason": "رقم المحفظة غير صحيح"
}
```

**Success Response (200):**
```json
{
    "success": true,
    "message": "تم إلغاء المهمة وإرجاع الرصيد"
}
```

---

## 🏥 Health Check Endpoints

### GET /health

Basic liveness check.

```json
{
    "status": "ok",
    "uptime": 3600.123,
    "timestamp": "2026-06-03T22:30:00Z"
}
```

### GET /health/ready

Readiness check including database connectivity.

```json
{
    "status": "ok",
    "db": "connected",
    "uptime": 3600.123
}
```
