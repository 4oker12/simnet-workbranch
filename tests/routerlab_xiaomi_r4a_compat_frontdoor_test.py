import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "routerlab" / "xiaomi-r4a" / "compat-frontdoor.py"

spec = importlib.util.spec_from_file_location("routerlab_compat_frontdoor", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


class CompatFrontdoorContractTest(unittest.TestCase):
    def test_cgi_response_parser_preserves_status_headers_and_body(self):
        status, headers, body = mod.parse_cgi_response(
            b"Status: 201 Created\r\nContent-Type: application/json\r\nX-Test: yes\r\n\r\n{\"code\":0}"
        )
        self.assertEqual(status, 201)
        self.assertIn(("Content-Type", "application/json"), headers)
        self.assertIn(("X-Test", "yes"), headers)
        self.assertEqual(body, b'{"code":0}')

    def test_cgi_response_parser_does_not_invent_success_without_headers(self):
        status, headers, body = mod.parse_cgi_response(b"raw-no-cgi-headers")
        self.assertEqual(status, 502)
        self.assertEqual(body, b"raw-no-cgi-headers")

    def test_source_is_transport_only_and_local_by_default(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('parser.add_argument("--bind", default="127.0.0.1")', source)
        self.assertIn('"/cgi-bin/luci"', source)
        self.assertNotIn("set_wan_new", source)
        self.assertNotIn("set_wifi", source)
        self.assertNotIn("pppoe_username", source)
        self.assertNotIn("nvram set", source)


if __name__ == "__main__":
    unittest.main()
