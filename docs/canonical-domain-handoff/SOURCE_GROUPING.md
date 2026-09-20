# Real Source Grouping Example — Billing main screen

This document replaces the need to commit raw subscriber screenshots with personal data. It describes the same grouping concept in a safe form.

The main Billing screen contains several logical groups at once. They are **not separate HTTP endpoints**. A single source read can populate multiple canonical facts and cache entries.

## Group 1 — Identity / lookup

Typical values present on the main subscriber card:

```text
IP
login
contract number
contract date
full name
```

Canonical direction:

```text
subscriber.billingId
subscriber.login
contract.number
contract.date
subscriber.fullName
subscriber.network.currentIp
```

Important: IP belongs canonically to NetworkAccess even if it is also a lookup key.

Passwords/credentials must never become AI facts.

---

## Group 2 — Internet tariff

Typical values:

```text
current package / paket
next_paket
next_paket_delay
current price
```

Canonical direction:

```text
subscriber.tariff.current.id
subscriber.tariff.current.name
subscriber.tariff.current.price
subscriber.tariff.scheduledChange.observed
subscriber.tariff.scheduledChange.hasChange
subscriber.tariff.scheduledChange.nextTariff
subscriber.tariff.scheduledChange.effectivePeriod
```

Do not invent `nextTariffDate` unless a source is found and verified.

---

## Group 3 — Finance

Typical values:

```text
accountBalance
totalDue
balanceAfterTariff
balanceWithoutTemporary
temporaryPayment
```

Canonical direction:

```text
subscriber.finance.balance.account
subscriber.finance.totalDue
subscriber.finance.balance.afterTariff
subscriber.finance.balance.withoutTemporary
subscriber.finance.temporaryPayment
```

A question such as `Есть ли у меня долг?` should not require the entire Billing snapshot. It should request only the minimum financial facts needed for the semantic answer.

---

## Group 4 — Subscriber services

The screen may list additional active services and their prices.

Canonical direction:

```text
subscriber.services[]
subscriber.services[].definitionRef
subscriber.services[].price
subscriber.services[].status
```

Do not mix these services with the base internet tariff definition.

---

## Group 5 — Service/access state

Typical values include access/service state and related operational status fields.

Canonical direction:

```text
subscriber.service.accessState
subscriber.service.serviceState
subscriber.network.authorization
```

The exact ownership of each current field should be verified against parser semantics before finalizing names.

---

## Group 6 — Payments

Payment history is available from Billing, but should be read/projected only for questions that actually need it.

Canonical direction:

```text
subscriber.finance.payments[]
  ├── date
  ├── amount
  └── description
```

---

## Group 7 — Network/session

The main card can show network-related values, while the detailed session source provides richer fields.

Canonical direction:

```text
subscriber.network.currentIp
subscriber.network.subscriberMac
subscriber.network.session.status
subscriber.network.session.bras
subscriber.network.session.sessionId
subscriber.network.session.authorizationType
subscriber.network.session.startTime
subscriber.network.session.lastEvent
subscriber.network.session.router
subscriber.network.session.vendor
subscriber.network.session.vlan
```

---

# Core grouping principle

```text
ONE Billing HTML/source read
        ↓
local parser
        ↓
source snapshot/cache
        ↓
multiple canonical facts
        ↓
Fact Resolver projects only requested facts
        ↓
LLM receives minimal evidence
```

Not:

```text
one field = one HTTP request
```

And not:

```text
one simple question = entire customer.snapshot sent to LLM
```

The source may remain broad. The AI evidence projection should be narrow.
