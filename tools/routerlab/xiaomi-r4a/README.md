# Xiaomi R4A stock management-plane RouterLab

Research tooling for **Xiaomi Mi Router 4A Gigabit Edition (R4A) v1**, stock Global firmware `3.0.24` (`miwifi_r4a_all_03233_3.0.24_INT.bin`).

This is intentionally separate from SIMNET Workbench production runtime. Its job is to answer one narrow question:

> Can we run enough of the original Xiaomi management plane to exercise the stock Web UI/API and persistent configuration without emulating radio/PHY/ASIC hardware?

## Evidence already established

From the exact 3.0.24 rootfs and FirmAE runs:

- MIPSel userspace boots under FirmAE/QEMU.
- Firmware creates `br-lan` with `192.168.31.1` during inference.
- Stock `uhttpd` is disabled by `misc.httpd.uhttpd=0`; Xiaomi replaces it with `sysapihttpd`.
- `sysapihttpd` uses FCGI/LuCI and the stock `/cgi-bin/luci/...` API path.
- The stock frontend contains real routes for login, WAN, PPPoE, Wi-Fi, setup, status and diagnostics.
- `sysapihttpd` was observed binding multiple internal ports, while manual access to `192.168.31.1:80` and FirmAE debug `:31337` through WSL/TAP did not become usable.

That last fact does **not** prove the stock web server is dead. It leaves two hypotheses:

1. stock management stack is alive but WSL/TAP transport is the blocker;
2. a small Xiaomi runtime dependency prevents the front-door listener from staying up.

`management-plane-agent.sh` separates those hypotheses without another open-ended FirmAE session.

## What the agent does

1. Leaves `scratch/<IID>/image.raw` untouched.
2. Makes a sparse lab clone.
3. Runs bounded `e2fsck` only on that disposable clone (the previous FirmAE run showed ext2 inode errors).
4. Injects a diagnostic hook into `/firmadyne/debug.sh` in the clone.
5. Boots the clone with QEMU **SLIRP/user-mode networking**, bypassing WSL TAP.
6. Gives all four emulated NICs distinct localhost forwards for the important stock ports (`80`, `443`, `8190`, `8899`, `8999`, FCGI `8920`, debug `31337`).
7. Captures stock runtime processes, listeners, `sysapihttpd` config-test output, runtime config, error log and statically discovered API paths.
8. Stops after a hard time limit; there is no unbounded polling/retry.
9. Writes a classification and decision into `REPORT.md`.

## One-command Windows entry point

From a local checkout of this branch:

```powershell
.\tools\routerlab\xiaomi-r4a\Run-ManagementPlaneAgent.ps1
```

To throw away the previous disposable lab clone and start clean:

```powershell
.\tools\routerlab\xiaomi-r4a\Run-ManagementPlaneAgent.ps1 -Fresh
```

The wrapper calls WSL. A single `sudo` password prompt may appear.

Default FirmAE path is inferred as:

```text
~/routerlab-xiaomi-r4a/FirmAE
```

## Stop criteria

This research must not turn into full SoC emulation work.

- `STOCK_FRONTDOOR_REACHABLE` → continue with login/read-only API, then WAN/Wi-Fi persistence acceptance.
- `STOCK_MANAGEMENT_BACKEND_ALIVE_FRONTDOOR_MISSING` → stop chasing TAP/hardware; preserve stock frontend/Lua/sysapi and shim only missing runtime dependencies.
- `GUEST_ALIVE_MANAGEMENT_STACK_UNRESOLVED` → one minimal dependency/shim pass, based on captured evidence.
- `FIRMAE_NOT_ECONOMICAL_FOR_WEB` → pivot to management-plane rehost from the exact stock rootfs/API map.

The acceptance target remains:

```text
stock UI action
  → stock API/controller path
  → configuration state changes
  → read-back
  → reboot
  → state persists
```

RF behaviour, Wi-Fi physics, Ethernet PHY, switch ASIC, LEDs and GPIO are out of scope.
