# Cudy WR1200 RouterLab bootstrap target

Target: **Cudy WR1200, HW V2** as an operator-training / RouterLab target.

This milestone intentionally models only the first-run management-plane contract needed to exercise RouterLab without physical hardware:

```text
factory
  -> browser bootstrap
  -> WAN = Dynamic IP (DHCP)
  -> keep Wi-Fi values unchanged
  -> Apply
  -> configured
  -> persistent state survives process restart
  -> factory reset returns to factory state
```

## Fidelity boundary

This target is **synthetic-bootstrap**, not a claim of vendor-firmware emulation.

It does **not** currently claim:

- Cudy's exact HTML/CSS;
- Cudy's real HTTP endpoints, cookies, session or CSRF behavior;
- exact firmware-side validation;
- RF/PHY/switch/LED behavior;
- a live WAN link.

Those items require evidence from a real WR1200 or firmware/HAR capture and can be added later. RouterLab must not invent them.

The current goal is narrower: make the RouterLab bootstrap workflow executable now, without hardware, and keep a clean boundary so a future real Cudy adapter can replace the synthetic transport without rewriting the scenario.

## Run on Windows

From the repository root:

```powershell
.\tools\routerlab\cudy-wr1200\Run-VirtualRouter.ps1 -Action Test
.\tools\routerlab\cudy-wr1200\Run-VirtualRouter.ps1 -Action Start
```

Open:

```text
http://127.0.0.1:18120/
```

Lifecycle:

```powershell
.\tools\routerlab\cudy-wr1200\Run-VirtualRouter.ps1 -Action Status
.\tools\routerlab\cudy-wr1200\Run-VirtualRouter.ps1 -Action Restart
.\tools\routerlab\cudy-wr1200\Run-VirtualRouter.ps1 -Action Reset
.\tools\routerlab\cudy-wr1200\Run-VirtualRouter.ps1 -Action Stop
```

`Restart` preserves state. `Reset` stops the process and deletes the persisted state, so the next `Start` returns to factory bootstrap.

State is stored under:

```text
%USERPROFILE%\.routerlab\cudy-wr1200\state-v1.json
```

## HTTP evidence contract

Read-only:

```text
GET /health
GET /api/state
```

Bootstrap:

```http
POST /api/bootstrap
Content-Type: application/json

{"wanType":"dhcp","wifiAction":"keep"}
```

Factory reset:

```text
POST /api/reset
```

The endpoint names above are **RouterLab lab endpoints**. They are not asserted to be Cudy firmware endpoints.

## Next fidelity step

When physical WR1200 evidence is available:

1. capture the browser first-run flow;
2. record redirects, cookies/session, CSRF behavior and request order;
3. compare the real state machine with this synthetic contract;
4. add a real Cudy adapter/profile without changing the higher-level RouterLab scenario;
5. split HW/firmware profiles only when behavior actually differs.
