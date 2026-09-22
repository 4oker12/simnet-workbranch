# SIMNET Canonical Domain Graph / Fact Resolver — Handoff

## Branch

Work only in:

`feat/canonical-domain-fact-resolver`

Base branch:

`feat/ai-runtime-efficiency-pass`

Do **not** merge without explicit approval.

## Goal

Evolve the current AI Operator from a source/snapshot/tool-centric runtime into a DDD-inspired canonical domain model with selective fact resolution.

Current direction:

```text
Billing / UserSide / Network
        ↓
large snapshots
        ↓
tools such as customer.snapshot / billing.tariff / billing.balance
        ↓
LLM
```

Target direction:

```text
User message
    ↓
LLM semantic understanding
    ↓
requiredFacts[]
    ↓
Fact Resolver
    ↓
Source Adapters
    ↓
Billing / UserSide / Network / PON / KB
    ↓
Canonical Facts
    ↓
compact projection of only required facts
    ↓
LLM synthesis
```

The LLM must remain the semantic reasoner. SIMNET data sources and KB supplement and verify facts; they do not replace reasoning with rigid phrase/rule matrices.

## Key architectural rule

A source read may be broad. A cache entry may be broad. The domain context may retain many facts. But the LLM should receive only the facts needed for the current semantic request.

Do not optimize by weakening reasoning. Optimize information noise, duplicated reads, repeated broad snapshots and oversized tool payloads.

---

# Canonical Domain Graph

Do not create separate domain models for Billing and UserSide. Billing, UserSide, Network and PON are sources/provenance layers.

Core domain model:

```text
SubscriberContext
│
├── Subscriber
│   ├── billingId
│   ├── userSideCustomerId
│   ├── login
│   ├── fullName
│   └── contacts
│
├── Contract
│   ├── number
│   ├── date
│   ├── subscriberType
│   ├── contractedWith
│   └── status
│
├── ServiceAddress
│   ├── street
│   ├── buildingNumber
│   ├── block
│   ├── entrance
│   ├── floor
│   ├── apartment
│   ├── fullAddress
│   └── buildingRef
│
├── TariffState
│   ├── current
│   │   ├── tariffId
│   │   ├── name
│   │   ├── price
│   │   └── speed
│   └── scheduledChange
│       ├── observed
│       ├── hasChange
│       ├── nextTariff
│       └── effectivePeriod / delay
│
├── Finance
│   ├── Balance
│   │   ├── accountBalance
│   │   ├── totalDue
│   │   ├── balanceAfterTariff
│   │   ├── balanceWithoutTemporary
│   │   └── temporaryPayment
│   └── Payments[]
│
├── NetworkAccess
│   ├── currentIp
│   ├── subscriberMac
│   ├── connectionFamily
│   ├── authorization
│   └── Session
│       ├── status
│       ├── BRAS
│       ├── sessionId
│       ├── authorizationType
│       ├── startTime
│       ├── lastEvent
│       ├── router
│       ├── vendor
│       └── vlan
│
├── AccessConnection
│   ├── Ethernet
│   └── PON
│
└── SubscriberServices[]
```

Independent/shared entities:

```text
Building
Street
OLT
Switch / AccessDevice
TariffDefinition
ServiceDefinition
Promotion
BusinessRule
```

Important relations:

```text
Subscriber → ServiceAddress → Building → Street
Subscriber → NetworkAccess → Session
Subscriber → AccessConnection → PON → ONU → OLT
Subscriber → AccessConnection → Ethernet → AccessDevice → Port
```

`Building` is not a child blob inside Subscriber. It is an independent entity referenced through ServiceAddress.

---

# Lookup vs canonical ownership

Do not duplicate values into Identity just because they can be used as lookup keys.

Canonical ownership:

```text
IP  → Subscriber.NetworkAccess
MAC → Subscriber.NetworkAccess / a concrete device
```

Subscriber lookup should conceptually support:

```text
contract
login
exact service address
IP
MAC
phone
```

If MAC/phone lookup is not implemented yet, mark it as a gap. Do not pretend it exists.

---

# Confirmed source data

## Billing

Identity:

```text
billingId
contract
login
fullName
contractDate
```

Structured ServiceAddress:

```text
dopfield_5  → street
dopfield_6  → building
dopfield_11 → block
dopfield_12 → entrance
dopfield_7  → floor
dopfield_8  → apartment
```

Contacts:

```text
phone
extraPhone
email
```

Tariff:

```text
current tariff / paket
tariffId
price
next_paket
next_paket_delay
```

`nextTariffDate` is not yet confirmed as a source-backed field.

Finance:

```text
accountBalance
totalDue
balanceAfterTariff
balanceWithoutTemporary
temporaryPayment
```

Technical:

```text
subscriberMac
eponOnuMac
gponOntSerial
technologyHint
olt
oltIp
staticIpConfigured
onuWithCableTv
technical comment
```

Payments are also available from Billing.

## Network session

Confirmed fields include:

```text
subscriberIp
subscriberMac
bras
brasIp
sessionSource
sessionId
status
isOnline
isActive
services
username
authorizationType
startTime
bytes
speed
lastEventTime
lastEvent
router
vendor
vlan
```

## UserSide subscriber

Identity:

```text
customerId
contract
login
fullName
```

Address currently returns mainly `full`; structured subscriber address is richer in Billing.

Ethernet/network:

```text
ip
macs[]
connectionFamily
accessDeviceId
accessDeviceName
accessDeviceIp
accessPort
accessInterface
accessLinkState
accessSpeedMbps
```

PON/TMC:

```text
onuDeviceId
onuDeviceName
onuDeviceIp
onuLanPort
onuLanInterface
onuLanLinkState
onuLanSpeed
tmcChecked
tmcFound
onuSerial
onuMac
foundOnOlt
oltName
oltIp
oltDeviceId
port
interface
equipmentName
onuRx
onuTx
oltRx
```

## Building

Confirmed fields include:

```text
building_id
subscriber_count
activity
building_type
entrances
floors
apartments
penetration
coordinates
manager
owner
notes
working_note
management
ktv
keys
gpon
можем_подключать_абонентов
custom/highlight fields
```

---

# Fact Resolver requirements

Create or evolve a runtime API at roughly this abstraction level:

```js
resolveFacts({
  context,
  facts: [
    'subscriber.finance.balance.account',
    'subscriber.tariff.current.price'
  ]
})
```

One canonical fact must **not** imply one HTTP request.

Example:

```text
requiredFacts
  ├── subscriber.tariff.current.name
  ├── subscriber.tariff.current.price
  ├── subscriber.finance.totalDue
  └── subscriber.finance.balance.account
        ↓
group by source
        ↓
Billing main summary read ONCE
        ↓
parse/cache
        ↓
project only requested facts
```

Source Adapters should know:

```text
canonical fact
→ source
→ raw field/path/parser
→ normalization
→ freshness/TTL
→ provenance
```

Examples:

```text
subscriber.serviceAddress.street
→ Billing dopdata tmpl=2
→ address.street / dopfield_5

subscriber.tariff.current.price
→ Billing mainSummary
→ finance.price

subscriber.finance.balance.account
→ Billing mainSummary
→ finance.accountBalance

subscriber.network.session.vlan
→ Billing stat a=252
→ vlan

subscriber.access.pon.onu.serial
→ UserSide/TMC
→ pon.onuSerial

building.gpon
→ UserSide Building snapshot
→ fields.gpon
```

---

# Existing Fact Model

Do not discard these files before studying them:

```text
src/features/ai-operator/fact-catalog.js
src/features/ai-operator/fact-runtime.js
```

They already contain useful ideas: fact-to-source mapping, TTL, source grouping and fact ingestion. Evolve them rather than starting from zero.

Move from flat facts such as:

```text
accountBalance
currentTariff
nextTariff
group
accessState
```

toward canonical paths such as:

```text
subscriber.finance.balance.account
subscriber.finance.totalDue
subscriber.tariff.current.name
subscriber.tariff.current.price
subscriber.tariff.scheduledChange.hasChange
subscriber.tariff.scheduledChange.nextTariff
subscriber.serviceAddress.street
subscriber.serviceAddress.apartment
subscriber.network.currentIp
subscriber.network.session.vlan
subscriber.access.pon.onu.serial
building.gpon
```

Use compatibility aliases if needed.

---

# UNKNOWN != NO

A successful read with an empty field is different from a failed/unobserved read.

Example:

```text
Billing read succeeded + nextTariff empty
→ observed: true
→ hasChange: false
```

Whereas:

```text
field/source could not be read
→ observed: false
→ status: unknown
```

Never convert a read failure into a negative fact.

---

# Domain Context Memory

Add/prepare entity-based context state, while keeping transcript context where useful:

```text
activeSubscriber
activeContract
activeServiceAddress
activeBuilding
activeConnection
currentTopic
```

Example:

```json
{
  "activeSubscriberId": "billing:343753",
  "activeBuildingId": "userside-building:521",
  "currentTopic": "building.connectivity"
}
```

This should enable follow-ups such as:

```text
"На этом доме есть оптика?"
→ resolve active Building

"А КТВ там есть?"
→ "там" = activeBuilding
→ request building.ktv
```

No repeated subscriber/address/building lookup if context is still valid.

---

# AI Lab integration

Critical: recent AI Lab tests do **not** use legacy `fact-runtime` as the main pipeline.

Current Lab path is approximately:

```text
semantic-probe
→ planLiveDataNeeds
→ semantic-tool-broker
→ live-tool-runtime
→ tool results
→ final synthesis
```

Do not replace modern semantic reasoning with old deterministic planning.

Target integration:

```text
semantic-probe / LLM
        ↓
understands request
        ↓
requiredFacts[]
        ↓
Fact Resolver
        ↓
Source Adapters / existing live tools
        ↓
compact fact evidence
        ↓
grounding + final LLM reply
```

Existing tools may remain internal adapter mechanisms. The upper-level AI should think in terms of **needed facts**, not broad tools such as `customer.snapshot`.

Keep `customer.snapshot` as recovery/debug/operator-wide fallback, not as the default answer path.

---

# Examples

```text
"Какой у меня тариф?"
→ subscriber.tariff.current.name
```

```text
"Есть ли долг?"
→ subscriber.finance.balance.account
→ subscriber.finance.totalDue
```

```text
"Сколько платить со следующего месяца?"
→ subscriber.tariff.current.price
→ subscriber.tariff.scheduledChange.hasChange
→ subscriber.tariff.scheduledChange.nextTariff
```

```text
"Как оплатить?"
→ PaymentInstructions / KB
→ no subscriber snapshot unless the wording requires subscriber-specific data
```

```text
"На этом доме GPON есть?"
→ Subscriber → ServiceAddress → Building
→ building.gpon
```

```text
"А КТВ там есть?"
→ reuse activeBuilding
→ building.ktv
```

---

# Cache model

Use entity/source-scoped caches, not one global subscriber blob:

```text
billing:<billingId>:mainSummary
billing:<billingId>:customer
billing:<billingId>:address
billing:<billingId>:technical
userside:<customerId>:subscriber
network:<billingId>:session
building:<buildingId>
```

Shared caches may include:

```text
tariffDefinition:<tariffId>
serviceDefinition:<id>
knowledge/rules
```

Each source/cache should carry `observedAt`, freshness/TTL and provenance.

---

# Diagnostics / token economy

For each turn expose enough diagnostics to compare old vs new behavior:

```text
requestedFacts
sourceReads
cacheHits
returnedFacts
evidence size/chars
tool/source calls
```

If practical, compare broad payload size vs compact projection size.

Do not reduce semantic reasoning simply to save tokens.

---

# Files to audit first

```text
src/features/ai-operator/fact-catalog.js
src/features/ai-operator/fact-runtime.js
src/features/ai-operator/lab-background.js
src/features/ai-operator/lab-batch-background.js
src/features/ai-operator/replay-background.js
src/features/ai-operator/background.js
src/features/ai-operator/semantic-probe.js
src/features/ai-operator/semantic-tool-broker.js
src/features/ai-operator/semantic-tool-broker-core.js
src/features/ai-operator/semantic-tool-broker-impl.js
src/features/ai-operator/live-tool-runtime.js
src/features/ai-operator/live-tool-runtime-core.js
src/features/ai-operator/tool-runtime.js
src/features/ai-operator/billing-live-search.js
src/features/ai-operator/billing-summary-live.js
src/features/ai-operator/billing-snapshot-capture.js
src/features/ai-operator/billing-login-live.js
src/features/ai-operator/userside-live-search.js
src/features/ai-operator/building-snapshot-tool.js
src/features/ai-operator/network-live-search.js
src/features/ai-operator/subscriber-identity.js
src/features/ai-operator/dialogue-state.js
src/features/ai-operator/knowledge/*
```

Audit dependencies beyond this list as needed.

---

# Tests

Add regression coverage at least for:

```text
current tariff only
balance
total due
next tariff absent
next tariff present
successful empty value != source failure
Building GPON
Building context reuse
PON vs Ethernet
IP ownership / lookup
customer.snapshot remains available as fallback
multiple facts from one source → one source read
cache hit avoids repeated source read
compact projection excludes unrelated fields
```

Run existing AI/operator tests as well.

---

# Deliverables

Provide at completion:

1. Current architecture summary.
2. New architecture summary.
3. Changed/new files.
4. Canonical Fact Catalog v1.
5. Mapping table: canonical fact → source → raw field/path → parser/tool → TTL → status.
6. Runtime diagram: semantic intent → required facts → resolver → adapter → cache/source → canonical facts → LLM.
7. 5–10 real request examples and selected facts.
8. Broad payload vs compact projection comparison.
9. Test results.
10. Gaps / needs_verification list.
11. Commit hashes.
12. No merge.

See `VISUAL_MAPS.md` in this folder for the target architecture and decision-flow diagrams.
