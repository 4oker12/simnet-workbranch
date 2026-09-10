# Workbench HOME runtime

The HOME launcher only orchestrates the Windows side. It does **not** create, stop, restart, or reconfigure the existing Vast instance.

## One-click commands

After updating the repository:

```powershell
git pull
```

Start:

```text
START-WORKBENCH-HOME.cmd
```

Status:

```text
STATUS-WORKBENCH-HOME.cmd
```

Stop:

```text
STOP-WORKBENCH-HOME.cmd
```

## START contract

`START-WORKBENCH-HOME.cmd` is idempotent and has bounded waits only. It either reaches `WORKBENCH HOME: READY` or exits with `WORKBENCH HOME: ERROR`.

It performs these checks/actions in order:

1. keeps the exact legacy local WireGuard service `WireGuardTunnel$Zyatyev_Andriy-HOME` OFF;
2. starts/reuses the Windows sing-box config `%LOCALAPPDATA%\sing-box-simnet\client.json` and verifies TUN `simnet-uot` is UP;
3. writes and serves the PAC on `127.0.0.1:8765`;
4. starts/reuses one SSH process to the existing Vast endpoint with forwards:
   - `127.0.0.1:25344 -> Vast 127.0.0.1:25344`;
   - `127.0.0.1:8090 -> Vast 127.0.0.1:8000`;
5. verifies Whisper `/health` through `8090`;
6. verifies SIMNET and PBX through SOCKS `25344`;
7. starts a persistent dedicated Chrome profile with the unpacked Workbench extension, selective PAC and QUIC disabled.

PAC routing is deliberately exact. Only these hosts use Vast SOCKS:

- `simnet.kiev.ua`
- `admin.simnet.kiev.ua`
- `userside.simnet.kiev.ua`
- `pbx.simnet.kiev.ua`

Everything else is `DIRECT`.

## STOP safety

STOP reads `%LOCALAPPDATA%\SIMNET-Workbench\runtime\home-state.json` and terminates only processes that START marked as owned by the Workbench launcher. It verifies process command lines before stopping them and never globally kills Chrome, SSH, Python or sing-box.

The legacy HOME WireGuard remains OFF. Vast is untouched.

## Runtime logs

Local launcher logs/state are under:

```text
%LOCALAPPDATA%\SIMNET-Workbench\runtime
```

Typical files:

- `home-state.json`
- `sing-box.out.log` / `sing-box.err.log`
- `pac.out.log` / `pac.err.log`
- `ssh.out.log` / `ssh.err.log`
