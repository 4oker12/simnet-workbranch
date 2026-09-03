# Terminal Interpretation Layer

## Boundary

Operational Guide ends its current episode when the operator performs the real OLT/ONU poll action. Terminal interpretation begins only when equipment output is present. It is a read-only visualization/analysis layer and cannot navigate, submit, reload, fetch, poll or create a Guide step.

The real Billing result may be one flat `font[face="Lucida Console"]` node. The layer divides it as `<b>command</b> → output nodes → <hr>` and annotates those ranges in place. Continuous unrelated DOM mutations cannot postpone this scan indefinitely.

## Vendor parsers

- `a=310` → BDCOM EPON
- `a=311` → BDCOM GPON
- `a=312` → GCOM
- `a=313` → Huawei

Each parser recognizes vendor command vocabulary and emits common semantic families:

- `ont_info` — current ONU state / identity / lifecycle
- `history` — registration/deregistration/log history
- `optical` — subscriber-specific PON optical values
- `optical_overview` — port-wide optical context, not a substitute for the subscriber value
- `ont_port_state` — ONU↔router Ethernet link
- `mac_address` — learned client/device MAC
- `service_port` — service/VLAN when exposed
- `ont_traffic` — current traffic when exposed
- `eth_statistics` — Ethernet counters when exposed
- `ont_config` — configuration/reference evidence

## Evidence precedence

Interpret the set of command results together; do not classify every command independently.

1. Current ONU state is primary for dependent live commands. If `ont_info` says OFFLINE, per-ONU optics, Ethernet state, traffic and statistics may be unavailable simply because the ONU is offline. Those blocks are `dependent`, not four new faults.
2. A MAC row can outlive the current session/state. MAC present + current ONU OFFLINE is `context`: it proves the MAC has been learned, not that the ONU or Ethernet link is currently up.
3. When ONU is not known offline, MAC + Ethernet can be combined normally:
   - expected MAC found → normal evidence;
   - MAC absent + ETH DOWN → link-level attention;
   - MAC absent + ETH UP → physical link exists, expected MAC is not currently learned;
   - learned MAC differs from expected → identity conflict.
4. Missing/unavailable observation is not automatically a mismatch.

## Visual evidence order

The interface is optimized for a novice operator and does not give every command equal visual weight:

1. `mac_address` — decisive evidence: whether a subscriber/router/device MAC is actually learned, and whether it matches the expected MAC.
2. `ont_port_state` — decisive evidence: current ONU-to-client Ethernet `LINK UP/DOWN`, negotiated speed and duplex.
3. `history` or lifecycle history embedded in `ont_info` — diagnostic evidence when recent events repeat.
4. current ONU state and subscriber optics — supporting evidence.
5. service/VLAN, configuration, traffic and port-wide tables — context unless their own result needs attention.

Decisive blocks use a stronger whole-card outline and a text-plus-symbol status. Color never carries the verdict alone: `✓` confirms usable evidence and `!` marks missing, conflicting, down or otherwise attention-worthy evidence.

## History causes

History is normalized into categories so different vendors can be compared without pretending their raw text is identical:

- optical loss: `LOS`, `LOSI`, `wire-down`
- power: `dying-gasp`, `POWER_OFF`
- reset/admin: `reset`, `reboot`, administrative reset
- other/unknown: preserved without forced interpretation

Recent optical-loss events can raise attention because they directly indicate loss of the PON path. A repeated-history signal is also raised at two or more events in 24 hours or three or more events in 7 days. Older or isolated power/reset events remain context and are not presented as a current access-network fault.

### Time semantics (binding rule)

- Huawei `UpTime` and `DownTime` are timestamps with timezone, never durations.
- `events7d` means only «number of history events whose timestamp is inside the last 7 days».
- If the current `ont_info` block says ONU is offline, the duration is calculated as `observation time − latest DownTime` and rendered separately as `OFFLINE …`.
- If current ONU state is online or unknown, a historical `DownTime` must not be shown as an active offline duration.
- A valid live OLT/ONU response outranks Juniper/Billing metadata for physical ONU state. Once that exact PollAttempt is confirmed, acquisition Guide ends; Juniper, Technical Data and UserSide must not be requested again merely to satisfy the old order.

## Vendor-specific examples covered

- Huawei: `display ont info ...`, `display ont register-info ...`, Ethernet, MAC, service-port, optics, traffic/statistics.
- GCOM: MAC table, `brief/info`, per-ONU optics, Ethernet port-status, port-wide optical overview, profile, statistics and `ont-logging buffer`.
- BDCOM GPON: active/inactive ONU, MAC table, optical diagnosis, UNI state, basic-info lifecycle/config.
- BDCOM EPON: active/inactive ONU, MAC table, CTC optics, ONU port state, basic-info/config.

## Evidence relations and health states

All blocks are marked automatically. Visual strength follows evidence priority; normal/warning meaning is always duplicated by `✓`/`!` text symbols so it does not depend on color.

Relation answers how the fact participates in the diagnosis:

- `PRIMARY` — determining evidence for the current conclusion
- `DEPENDENT` — availability/meaning depends on an already-established upstream fact
- `CONTEXT` — useful history/reference, but not proof of the current state
- `CONFLICT` — observed identity contradicts expected identity

Health answers whether the available fact itself is normal:

- `normal` — current evidence is consistent
- `attention` — current evidence needs operator attention
- `neutral` — no independent health verdict is justified

No blinking, animation, CTA buttons or automatic terminal actions are used.
