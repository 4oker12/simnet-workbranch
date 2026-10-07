import importlib.util
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "routerlab" / "cudy-wr1200" / "virtual-router.py"
SPEC = importlib.util.spec_from_file_location("routerlab_cudy_virtual_router", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class CudyBootstrapStateTest(unittest.TestCase):
    def test_factory_to_dhcp_and_persistence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            state = MODULE.RouterState(path)
            self.assertFalse(state.snapshot()["configured"])
            self.assertIsNone(state.snapshot()["wan"]["type"])

            result = state.apply_bootstrap({"wanType": "dhcp", "wifiAction": "keep"})
            self.assertTrue(result["configured"])
            self.assertEqual(result["bootstrap_stage"], "configured")
            self.assertEqual(result["wan"]["type"], "dhcp")
            self.assertEqual(result["wifi"]["action"], "unchanged")

            restored = MODULE.RouterState(path).snapshot()
            self.assertTrue(restored["configured"])
            self.assertEqual(restored["wan"]["type"], "dhcp")

            MODULE.RouterState(path).reset()
            reset = MODULE.RouterState(path).snapshot()
            self.assertFalse(reset["configured"])
            self.assertEqual(reset["bootstrap_stage"], "factory")

    def test_rejects_unproven_pppoe_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = MODULE.RouterState(Path(tmp) / "state.json")
            with self.assertRaisesRegex(ValueError, "dhcp only"):
                state.apply_bootstrap({"wanType": "pppoe", "wifiAction": "keep"})


class CudyBootstrapHttpTest(unittest.TestCase):
    def test_health_and_browser_api(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = MODULE.RouterState(Path(tmp) / "state.json")
            server = MODULE.build_server("127.0.0.1", 0, state)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            port = server.server_address[1]

            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
                    health = json.loads(response.read())
                self.assertTrue(health["ok"])
                self.assertFalse(health["configured"])
                self.assertEqual(health["fidelity"], "synthetic-bootstrap")

                body = json.dumps({"wanType": "dhcp", "wifiAction": "keep"}).encode()
                request = urllib.request.Request(
                    f"http://127.0.0.1:{port}/api/bootstrap",
                    data=body,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(request, timeout=2) as response:
                    configured = json.loads(response.read())
                self.assertTrue(configured["configured"])
                self.assertEqual(configured["wan"]["type"], "dhcp")

                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=2) as response:
                    evidence = json.loads(response.read())
                self.assertEqual(evidence["bootstrap_stage"], "configured")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
