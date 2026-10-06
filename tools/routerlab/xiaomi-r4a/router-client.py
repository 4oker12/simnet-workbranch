#!/usr/bin/env python3
"""RouterLab client for the Xiaomi R4A stock management plane.

This is a development client, not a production subscriber-router controller.

Safety boundary:
- inspect is read-only;
- configure is allowed only against loopback hosts;
- router state comes from the exact stock Xiaomi API;
- no live WAN/link facts are invented when the emulator has no PHY/netifd state.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


class RouterClientError(RuntimeError):
    pass


@dataclass(frozen=True)
class RouterIdentity:
    hardware: str
    romversion: str
    inited: int
    routername: str
    language: str

    @classmethod
    def from_init_info(cls, data: dict[str, Any]) -> "RouterIdentity":
        return cls(
            hardware=str(data.get("hardware", "")),
            romversion=str(data.get("romversion", "")),
            inited=int(data.get("inited", 0)),
            routername=str(data.get("routername", "")),
            language=str(data.get("language", "")),
        )


class XiaomiR4AClient:
    def __init__(self, base_url: str, timeout: float = 15.0) -> None:
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise RouterClientError(f"invalid base URL: {base_url}")
        self.base_url = base_url.rstrip("/")
        self.parsed = parsed
        self.timeout = timeout
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )

    def _request_json(
        self,
        path: str,
        *,
        data: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        body = None
        headers = {"Host": self.parsed.netloc}
        if data is not None:
            body = urllib.parse.urlencode(data).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(
            self.base_url + path,
            data=body,
            headers=headers,
            method="POST" if body is not None else "GET",
        )
        try:
            with self.opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read()
                status = resp.status
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            raise RouterClientError(
                f"HTTP {exc.code} for {path}: {raw[:300].decode('utf-8', 'replace')}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RouterClientError(f"request failed for {path}: {exc}") from exc

        if status != 200:
            raise RouterClientError(f"HTTP {status} for {path}")
        try:
            value = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise RouterClientError(
                f"non-JSON response for {path}: {raw[:300]!r}"
            ) from exc
        if not isinstance(value, dict):
            raise RouterClientError(f"unexpected JSON shape for {path}")
        return value

    def init_info(self) -> dict[str, Any]:
        return self._request_json("/cgi-bin/luci/api/xqsystem/init_info")

    def identity(self) -> RouterIdentity:
        data = self.init_info()
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"init_info failed: {data}")
        return RouterIdentity.from_init_info(data)

    def login(self, password: str) -> str:
        data = self._request_json(
            "/cgi-bin/luci/api/xqsystem/login",
            data={"username": "admin", "password": password, "logtype": "2"},
        )
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"login rejected: code={data.get('code')}")
        token = str(data.get("token", ""))
        if len(token) != 32:
            raise RouterClientError("stock login did not return a 32-character stok")
        return token

    @staticmethod
    def _stok_path(token: str, route: str) -> str:
        if not route.startswith("/api/"):
            raise RouterClientError(f"invalid stock API route: {route}")
        return f"/cgi-bin/luci/;stok={urllib.parse.quote(token, safe='')}{route}"

    def stock_get(self, token: str, route: str) -> dict[str, Any]:
        return self._request_json(self._stok_path(token, route))

    def stock_post(
        self, token: str, route: str, data: dict[str, str]
    ) -> dict[str, Any]:
        return self._request_json(self._stok_path(token, route), data=data)

    def wifi_detail_all(self, token: str) -> dict[str, Any]:
        data = self.stock_get(token, "/api/xqnetwork/wifi_detail_all")
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"wifi_detail_all failed: {data}")
        return data

    def set_wan_dhcp(self, token: str) -> dict[str, Any]:
        data = self.stock_post(
            token,
            "/api/xqnetwork/set_wan",
            {"wanType": "dhcp", "client": "web"},
        )
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"set_wan DHCP failed: {data}")
        return data

    def set_wan_pppoe(
        self,
        token: str,
        *,
        username: str,
        password: str,
    ) -> dict[str, Any]:
        if not username or not password:
            raise RouterClientError("PPPoE username and password are required")
        data = self.stock_post(
            token,
            "/api/xqnetwork/set_wan",
            {
                "wanType": "pppoe",
                "pppoeName": username,
                "pppoePwd": password,
                "client": "web",
            },
        )
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"set_wan PPPoE failed: code={data.get('code')}")
        return data

    def set_wifi(
        self,
        token: str,
        *,
        index: int,
        ssid: str,
        password: str,
    ) -> dict[str, Any]:
        if index not in {1, 2}:
            raise RouterClientError("wifi index must be 1 or 2")
        data = self.stock_post(
            token,
            "/api/xqnetwork/set_wifi",
            {
                "wifiIndex": str(index),
                "on": "1",
                "ssid": ssid,
                "pwd": password,
                "encryption": "psk2",
                "channel": "0",
                "bandwidth": "0",
                "hidden": "0",
                "txpwr": "max",
            },
        )
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"set_wifi index={index} failed: {data}")
        return data


def _is_loopback_host(hostname: str | None) -> bool:
    if hostname is None:
        return False
    return hostname.lower() in {"localhost", "127.0.0.1", "::1"}


def _wifi_summary(data: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for item in data.get("info", []):
        if not isinstance(item, dict):
            continue
        result.append(
            {
                "ifname": item.get("ifname"),
                "device": item.get("device"),
                "ssid": item.get("ssid"),
                "status": item.get("status"),
                "encryption": item.get("encryption"),
                "hidden": item.get("hidden"),
            }
        )
    return result


def _expected_wifi_map(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in data.get("info", []):
        if not isinstance(item, dict):
            continue
        ifname = str(item.get("ifname", ""))
        if ifname:
            result[ifname] = item
    return result


def command_inspect(args: argparse.Namespace) -> dict[str, Any]:
    client = XiaomiR4AClient(args.base_url, args.timeout)
    identity = client.identity()
    result: dict[str, Any] = {
        "operation": "inspect",
        "identity": {
            "hardware": identity.hardware,
            "romversion": identity.romversion,
            "inited": identity.inited,
            "routername": identity.routername,
            "language": identity.language,
        },
    }

    if args.admin_password:
        if identity.inited != 1:
            result["authenticated_read"] = {
                "status": "not_attempted",
                "reason": "router is not initialized",
            }
        else:
            token = client.login(args.admin_password)
            wifi = client.wifi_detail_all(token)
            result["authenticated_read"] = {
                "status": "confirmed",
                "stok_length": len(token),
                "wifi": _wifi_summary(wifi),
            }
    return result


def command_configure(args: argparse.Namespace) -> dict[str, Any]:
    client = XiaomiR4AClient(args.base_url, args.timeout)
    if not _is_loopback_host(client.parsed.hostname):
        raise RouterClientError(
            "configure is intentionally restricted to localhost in RouterLab v1"
        )

    identity = client.identity()
    if identity.hardware != "R4A":
        raise RouterClientError(
            f"unsupported hardware for this adapter: {identity.hardware or 'unknown'}"
        )
    if identity.inited != 1:
        raise RouterClientError(
            "configure v1 expects an initialized router; use the stock factory wizard first"
        )

    token = client.login(args.admin_password)
    before = client.wifi_detail_all(token)

    if args.wan_type == "dhcp":
        wan_ack = client.set_wan_dhcp(token)
        wan_action = "wan_dhcp"
    else:
        if not args.pppoe_username or not args.pppoe_password:
            raise RouterClientError(
                "configure --wan-type pppoe requires --pppoe-username and --pppoe-password"
            )
        wan_ack = client.set_wan_pppoe(
            token,
            username=args.pppoe_username,
            password=args.pppoe_password,
        )
        wan_action = "wan_pppoe"

    wifi24_ack = client.set_wifi(
        token,
        index=1,
        ssid=args.ssid_24,
        password=args.wifi_password,
    )
    wifi5_ack = client.set_wifi(
        token,
        index=2,
        ssid=args.ssid_5,
        password=args.wifi_password,
    )
    after = client.wifi_detail_all(token)

    radios = _expected_wifi_map(after)
    wl1 = radios.get("wl1", {})
    wl0 = radios.get("wl0", {})
    wifi_verified = (
        wl1.get("ssid") == args.ssid_24
        and wl1.get("password") == args.wifi_password
        and wl0.get("ssid") == args.ssid_5
        and wl0.get("password") == args.wifi_password
    )
    if not wifi_verified:
        raise RouterClientError("stock Wi-Fi read-back does not match requested state")

    return {
        "operation": "configure",
        "identity": {
            "hardware": identity.hardware,
            "romversion": identity.romversion,
            "inited": identity.inited,
        },
        "login": {"status": "confirmed", "stok_length": len(token)},
        "before_wifi": _wifi_summary(before),
        "actions": {
            wan_action: {
                "acknowledged": int(wan_ack.get("code", -1)) == 0,
                "configured_type": args.wan_type,
                "credentials_supplied": args.wan_type == "pppoe",
                "live_link_state": "unknown_not_emulated",
            },
            "wifi_24": {"acknowledged": int(wifi24_ack.get("code", -1)) == 0},
            "wifi_5": {"acknowledged": int(wifi5_ack.get("code", -1)) == 0},
        },
        "verification": {
            "wifi_readback": "confirmed",
            "wifi": _wifi_summary(after),
            "wan_live_readback": "not_claimed",
        },
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="RouterLab client for Xiaomi R4A stock firmware"
    )
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:18090",
        help="virtual router URL",
    )
    parser.add_argument("--timeout", type=float, default=15.0)

    sub = parser.add_subparsers(dest="command", required=True)

    inspect_p = sub.add_parser("inspect", help="read stock identity/state")
    inspect_p.add_argument(
        "--admin-password",
        default=None,
        help="optional lab password for authenticated Wi-Fi read-back",
    )
    inspect_p.set_defaults(handler=command_inspect)

    configure_p = sub.add_parser(
        "configure",
        help="configure the local virtual router through exact stock API",
    )
    configure_p.add_argument("--admin-password", required=True)
    configure_p.add_argument(
        "--wan-type",
        choices=("dhcp", "pppoe"),
        default="dhcp",
        help="stock WAN mode to configure",
    )
    configure_p.add_argument("--pppoe-username")
    configure_p.add_argument("--pppoe-password")
    configure_p.add_argument("--ssid-24", required=True)
    configure_p.add_argument("--ssid-5", required=True)
    configure_p.add_argument("--wifi-password", required=True)
    configure_p.set_defaults(handler=command_configure)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        result = args.handler(args)
    except RouterClientError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
