# Xiaomi R4A stock virtual router

Target: **Xiaomi Mi Router 4A Gigabit Edition (R4A) v1**, factory Global firmware **3.0.24** (`miwifi_r4a_all_03233_3.0.24_INT.bin`).

This RouterLab target is a management-plane emulator for the **factory Xiaomi firmware**. It does not require a subscriber to install OpenWrt. Xiaomi's own stock firmware is OpenWrt-derived internally, so its original LuCI/UCI components are part of the vendor firmware.

## What is authentic

The emulator runs from the exact stock 3.0.24 rootfs:

- original Xiaomi `/www` frontend;
- original MIPSel `fcgi-cgi`;
- original LuCI dispatcher/controllers;
- original Xiaomi authentication and real `stok`;
- original WAN/Wi-Fi setter and read APIs;
- original UCI configuration semantics.

`compat-frontdoor.py` replaces **only** the Xiaomi `sysapihttpd` transport/session layer. The stock server reaches its vendor original-destination/session code under qemu-user, receives the sentinel `0.0.0.1:65535`, and aborts the worker. Replacing that transport does not replace router configuration logic.

Not emulated: RF, PHY, switch ASIC, Wi-Fi radio behavior, LEDs/GPIO or a live WAN link.

## Proven stock path

The automated acceptance currently proves:

```text
exact stock 3.0.24
  -> stock login / real stok
  -> POST set_wan wanType=dhcp
  -> POST set_wifi 2.4 GHz
  -> POST set_wifi 5 GHz
  -> stock Wi-Fi read-back
  -> persist UCI state
  -> destroy runtime clone
  -> recreate runtime from immutable stock rootfs
  -> restore persisted state
  -> login again
  -> stock Wi-Fi read-back after cold boot
```

The WAN configured state persists as `network.wan.proto=dhcp`. Live `wan_info` can still fail in the lab because it asks for runtime interface/IP/link/ubus data. That is a live-network-state limitation, not a failure of the stock WAN setter.

PPPoE is not on the current critical path.

## Run the virtual router on Windows

From the repository root:

```powershell
.\tools\routerlab\xiaomi-r4a\Run-VirtualRouter.ps1 -Action Start
```

Then open:

```text
http://127.0.0.1:18090/
```

Lab credentials for the exact factory account fixture:

```text
admin / admin
```

Lifecycle:

```powershell
.\tools\routerlab\xiaomi-r4a\Run-VirtualRouter.ps1 -Action Status
.\tools\routerlab\xiaomi-r4a\Run-VirtualRouter.ps1 -Action Restart
.\tools\routerlab\xiaomi-r4a\Run-VirtualRouter.ps1 -Action Stop
.\tools\routerlab\xiaomi-r4a\Run-VirtualRouter.ps1 -Action Reset
```

`Restart` is a cold management-plane boot: the current UCI state is saved, the runtime rootfs clone is destroyed, a new clone is made from the immutable stock rootfs, persisted state is restored, and stock LuCI/API is started again.

`Reset` deletes the lab's persistent state. The next `Start` creates the initialized factory test fixture again.

## State boundary

Persistent state v1 is deliberately narrow:

```text
exact immutable stock rootfs
        +
persistent /etc/config state
        |
        v
fresh runtime clone
        |
        +-- original fcgi-cgi
        +-- original LuCI/Xiaomi API
        +-- compatibility HTTP front door
```

This is enough for the current DHCP + Wi-Fi configuration acceptance. File-backed NVRAM or selected runtime-state shims should be added only when a concrete stock API requires them.

## Research history

`management-plane-agent.sh` and `management-plane-rehost.sh` remain evidence/research tools. Full-system FirmAE was retired for this target after a bounded run showed that it was not economical for reaching the stock Web UI.

The primary development target is now `virtual-router.sh`, not full SoC emulation.
