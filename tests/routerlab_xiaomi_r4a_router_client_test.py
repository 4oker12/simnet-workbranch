import importlib.util
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CLIENT_PATH = ROOT / "tools" / "routerlab" / "xiaomi-r4a" / "router-client.py"

spec = importlib.util.spec_from_file_location("router_client", CLIENT_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules["router_client"] = module
assert spec.loader is not None
spec.loader.exec_module(module)


class RouterClientTests(unittest.TestCase):
    def test_loopback_write_guard(self):
        self.assertTrue(module._is_loopback_host("127.0.0.1"))
        self.assertTrue(module._is_loopback_host("localhost"))
        self.assertTrue(module._is_loopback_host("::1"))
        self.assertFalse(module._is_loopback_host("192.168.31.1"))
        self.assertFalse(module._is_loopback_host("router.miwifi.com"))

    def test_identity_is_evidence_only(self):
        identity = module.RouterIdentity.from_init_info(
            {
                "hardware": "R4A",
                "romversion": "3.0.24",
                "inited": 1,
                "routername": "Lab",
                "language": "en",
            }
        )
        self.assertEqual(identity.hardware, "R4A")
        self.assertEqual(identity.romversion, "3.0.24")
        self.assertEqual(identity.inited, 1)

    def test_wifi_summary_drops_passwords(self):
        summary = module._wifi_summary(
            {
                "info": [
                    {
                        "ifname": "wl1",
                        "device": "mt7603e.network1",
                        "ssid": "RouterLab24",
                        "password": "secret",
                        "status": "1",
                        "encryption": "psk2",
                        "hidden": "0",
                    }
                ]
            }
        )
        encoded = json.dumps(summary)
        self.assertIn("RouterLab24", encoded)
        self.assertNotIn("secret", encoded)
        self.assertNotIn("password", encoded)


    def test_pppoe_payload_matches_stock_contract_without_logging_secret(self):
        calls = []

        class Probe(module.XiaomiR4AClient):
            def _request_json(self, path, *, data=None):
                calls.append((path, dict(data or {})))
                return {"code": 0}

        client = Probe("http://127.0.0.1:18090")
        result = client.set_wan_pppoe(
            "0123456789abcdef0123456789abcdef",
            username="lab-user",
            password="lab-secret",
        )
        self.assertEqual(result["code"], 0)
        self.assertEqual(len(calls), 1)
        path, payload = calls[0]
        self.assertIn("/api/xqnetwork/set_wan", path)
        self.assertEqual(payload["wanType"], "pppoe")
        self.assertEqual(payload["pppoeName"], "lab-user")
        self.assertEqual(payload["pppoePwd"], "lab-secret")
        self.assertEqual(payload["client"], "web")

    def test_pppoe_requires_both_credentials(self):
        client = module.XiaomiR4AClient("http://127.0.0.1:18090")
        with self.assertRaises(module.RouterClientError):
            client.set_wan_pppoe(
                "0123456789abcdef0123456789abcdef",
                username="",
                password="x",
            )

    def test_stok_route_is_constrained_to_stock_api(self):
        path = module.XiaomiR4AClient._stok_path(
            "0123456789abcdef0123456789abcdef",
            "/api/xqnetwork/wifi_detail_all",
        )
        self.assertTrue(path.startswith("/cgi-bin/luci/;stok="))
        with self.assertRaises(module.RouterClientError):
            module.XiaomiR4AClient._stok_path("abc", "/etc/passwd")


if __name__ == "__main__":
    unittest.main()
