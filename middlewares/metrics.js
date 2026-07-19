// middlewares/metrics.js
// ===============================================
// 📊 Prometheus Metrics Middleware
// ===============================================
'use strict';

/**
 * وحدة مقاييس بسيطة متوافقة مع Prometheus
 * لا تتطلب مكتبة خارجية — يمكن استبدالها بـ prom-client لاحقاً
 */

// ── مخزن المقاييس ──────────────────────────────────
const metrics = {
    httpRequestsTotal: {},        // { method_path_status: count }
    httpRequestDurationSum: {},   // { method_path: totalMs }
    httpRequestDurationCount: {}, // { method_path: count }
    activeTransfers: 0,
    loginFailures: 0,
    loginSuccesses: 0,
    transfersCreated: 0,
    transfersCompleted: 0,
    transfersCancelled: 0,
    errors: 0
};

/**
 * Middleware لتسجيل مقاييس كل طلب
 */
const metricsMiddleware = (req, res, next) => {
    const startTime = process.hrtime.bigint();

    const originalEnd = res.end;
    res.end = function (...args) {
        const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

        // تجميع حسب method + path مبسط + status
        const path = _normalizePath(req.route?.path || req.path || req.originalUrl);
        const key = `${req.method}_${path}_${res.statusCode}`;

        metrics.httpRequestsTotal[key] = (metrics.httpRequestsTotal[key] || 0) + 1;

        const durationKey = `${req.method}_${path}`;
        metrics.httpRequestDurationSum[durationKey] = (metrics.httpRequestDurationSum[durationKey] || 0) + durationMs;
        metrics.httpRequestDurationCount[durationKey] = (metrics.httpRequestDurationCount[durationKey] || 0) + 1;

        if (res.statusCode >= 500) metrics.errors++;

        originalEnd.apply(res, args);
    };

    next();
};

/**
 * تطبيع المسار (إزالة IDs الديناميكية)
 */
const _normalizePath = (path) => {
    return path
        .replace(/\/[a-f0-9]{24}/g, '/:id')  // MongoDB ObjectId
        .replace(/\/\d+/g, '/:num')           // أرقام
        .replace(/\?.+$/, '')                  // Query string
        .substring(0, 50);                     // تقصير
};

/**
 * تسجيل أحداث مخصصة
 */
const recordEvent = (eventType) => {
    switch (eventType) {
        case 'login_success': metrics.loginSuccesses++; break;
        case 'login_failure': metrics.loginFailures++; break;
        case 'transfer_created': metrics.transfersCreated++; metrics.activeTransfers++; break;
        case 'transfer_completed': metrics.transfersCompleted++; metrics.activeTransfers = Math.max(0, metrics.activeTransfers - 1); break;
        case 'transfer_cancelled': metrics.transfersCancelled++; metrics.activeTransfers = Math.max(0, metrics.activeTransfers - 1); break;
    }
};

/**
 * GET /metrics — endpoint متوافق مع Prometheus
 */
const metricsEndpoint = (req, res) => {
    let output = '';

    // HTTP Requests
    output += '# HELP http_requests_total Total number of HTTP requests\n';
    output += '# TYPE http_requests_total counter\n';
    for (const [key, count] of Object.entries(metrics.httpRequestsTotal)) {
        const [method, path, status] = key.split('_');
        output += `http_requests_total{method="${method}",path="${path || '/'}",status="${status}"} ${count}\n`;
    }

    // HTTP Request Duration
    output += '\n# HELP http_request_duration_ms HTTP request duration in milliseconds\n';
    output += '# TYPE http_request_duration_ms summary\n';
    for (const [key, sum] of Object.entries(metrics.httpRequestDurationSum)) {
        const count = metrics.httpRequestDurationCount[key] || 1;
        const avg = Math.round(sum / count * 100) / 100;
        const [method, path] = key.split('_');
        output += `http_request_duration_ms_avg{method="${method}",path="${path || '/'}"} ${avg}\n`;
        output += `http_request_duration_ms_count{method="${method}",path="${path || '/'}"} ${count}\n`;
    }

    // Business Metrics
    output += '\n# HELP active_transfers_count Number of active (pending/processing) transfers\n';
    output += '# TYPE active_transfers_count gauge\n';
    output += `active_transfers_count ${metrics.activeTransfers}\n`;

    output += '\n# HELP login_successes_total Total successful logins\n';
    output += '# TYPE login_successes_total counter\n';
    output += `login_successes_total ${metrics.loginSuccesses}\n`;

    output += '\n# HELP login_failures_total Total failed logins\n';
    output += '# TYPE login_failures_total counter\n';
    output += `login_failures_total ${metrics.loginFailures}\n`;

    output += '\n# HELP transfers_created_total Total transfers created\n';
    output += '# TYPE transfers_created_total counter\n';
    output += `transfers_created_total ${metrics.transfersCreated}\n`;

    output += '\n# HELP transfers_completed_total Total transfers completed\n';
    output += '# TYPE transfers_completed_total counter\n';
    output += `transfers_completed_total ${metrics.transfersCompleted}\n`;

    output += '\n# HELP transfers_cancelled_total Total transfers cancelled\n';
    output += '# TYPE transfers_cancelled_total counter\n';
    output += `transfers_cancelled_total ${metrics.transfersCancelled}\n`;

    output += '\n# HELP errors_total Total server errors (5xx)\n';
    output += '# TYPE errors_total counter\n';
    output += `errors_total ${metrics.errors}\n`;

    // Process Metrics
    const mem = process.memoryUsage();
    output += '\n# HELP process_memory_rss_bytes Process RSS memory in bytes\n';
    output += '# TYPE process_memory_rss_bytes gauge\n';
    output += `process_memory_rss_bytes ${mem.rss}\n`;

    output += '\n# HELP process_memory_heap_used_bytes Process heap used in bytes\n';
    output += '# TYPE process_memory_heap_used_bytes gauge\n';
    output += `process_memory_heap_used_bytes ${mem.heapUsed}\n`;

    output += '\n# HELP process_uptime_seconds Process uptime in seconds\n';
    output += '# TYPE process_uptime_seconds gauge\n';
    output += `process_uptime_seconds ${Math.floor(process.uptime())}\n`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(output);
};

module.exports = { metricsMiddleware, metricsEndpoint, recordEvent };
