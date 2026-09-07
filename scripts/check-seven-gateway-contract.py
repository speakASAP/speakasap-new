#!/usr/bin/env python3
"""No-write static contract checker for seven-course gateway routing/auth."""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


AUTH_GUARD = Path("api-gateway/src/proxy/gateway-auth.guard.ts")
UPSTREAM_RESOLVE = Path("api-gateway/src/proxy/upstream-resolve.ts")
PROXY_CONTROLLER = Path("api-gateway/src/proxy/gateway-proxy.controller.ts")
FRONTEND_CLIENT = Path("frontend/lib/seven.ts")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def route_entries(text: str) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for prefix, env_key in re.findall(r"\{\s*prefix:\s*'([^']+)'\s*,\s*envKey:\s*'([^']+)'\s*\}", text):
        entries.append({"prefix": prefix, "envKey": env_key})
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description="Check seven gateway routing/auth contract without running gateway")
    parser.add_argument("--json-report", help="write JSON report to path; use - for stdout")
    args = parser.parse_args()

    guard = read(AUTH_GUARD)
    upstream = read(UPSTREAM_RESOLVE)
    controller = read(PROXY_CONTROLLER)
    frontend = read(FRONTEND_CLIENT)
    entries = route_entries(upstream)
    seven_entries = [entry for entry in entries if entry["prefix"] == "/api/v1/seven"]
    prefixes = [entry["prefix"] for entry in entries]
    seven_index = prefixes.index("/api/v1/seven") if "/api/v1/seven" in prefixes else -1
    content_sibling_indexes = [
        prefixes.index(prefix)
        for prefix in ["/api/v1/dictionary", "/api/v1/songs", "/api/v1/phonetics", "/api/v1/grammar", "/api/v1/languages"]
        if prefix in prefixes
    ]
    assertions = {
        "filesExist": all(path.exists() for path in [AUTH_GUARD, UPSTREAM_RESOLVE, PROXY_CONTROLLER, FRONTEND_CLIENT]),
        "proxyControllerUsesGuard": "@UseGuards(GatewayAuthGuard)" in controller and "@All('*')" in controller,
        "sevenRoutesToContentService": len(seven_entries) == 1 and seven_entries[0]["envKey"] == "CONTENT_SERVICE_URL",
        "sevenRoutePrecedesContentSiblings": seven_index >= 0 and all(seven_index < index for index in content_sibling_indexes),
        "sevenAnonymousGetOnly": "(pathname === '/api/v1/seven' || pathname.startsWith('/api/v1/seven/')) && req.method === 'GET'" in guard,
        "sevenNonGetFallsThroughToBearer": "req.headers.authorization" in guard
        and "Missing bearer token" in guard
        and guard.find("req.method === 'GET'") < guard.find("req.headers.authorization"),
        "noBroadSevenAnonymousMethods": not any(snippet in guard for snippet in ["req.method !== 'POST'", "['GET', 'POST']", '["GET", "POST"]']),
        "internalRoutesRequireAuthServiceJwt": "pathname.startsWith('/api/v1/internal')" in guard
        and "activateInternalService" in guard
        and "hasInternalServiceRole" in guard
        and "GATEWAY_INTERNAL_API_TOKEN" not in guard
        and "x-internal-token" not in guard,
        "paymentWebhookExceptionRemainsPostOnly": "pathname.startsWith('/api/v1/webhooks/payments') && req.method === 'POST'" in guard,
        "frontendUsesGatewaySevenEndpoints": all(
            snippet in frontend
            for snippet in [
                "`/api/v1/seven/courses/${code}`",
                "`/api/v1/seven/courses/${code}/lessons`",
                "`/api/v1/seven/courses/${code}/lessons/${lessonOrder}`",
            ]
        ),
    }
    report: dict[str, Any] = {
        "generatedAt": now_iso(),
        "writes": False,
        "files": {
            "authGuard": str(AUTH_GUARD),
            "upstreamResolve": str(UPSTREAM_RESOLVE),
            "proxyController": str(PROXY_CONTROLLER),
            "frontendClient": str(FRONTEND_CLIENT),
        },
        "routeEntries": entries,
        "sevenRouteEntries": seven_entries,
        "assertions": assertions,
        "approvalBoundary": {
            "gatewayDeployStillRequiresOwnerApproval": True,
            "anonymousAccessLimitedToSevenGet": assertions["sevenAnonymousGetOnly"],
            "dataApplyApproved": False,
            "mediaCopyApproved": False,
            "legacyRetirementApproved": False,
        },
        "ok": all(assertions.values()),
    }
    payload = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    if args.json_report and args.json_report != "-":
        Path(args.json_report).write_text(payload + "\n", encoding="utf-8")
        print(f"wrote report to {args.json_report}")
    else:
        print(payload)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
