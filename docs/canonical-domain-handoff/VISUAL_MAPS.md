# Visual Maps — Canonical Domain / Fact Resolver

These diagrams are **conceptual architecture targets**, not proof that every shown field already exists. Confirm concrete fields against repo parsers and real tool evidence.

## 1. Target domain graph

```mermaid
flowchart LR
    S[Subscriber]
    C[Contract]
    A[ServiceAddress]
    B[Building]
    ST[Street]
    T[TariffState]
    F[Finance]
    N[NetworkAccess]
    SS[Session]
    AC[AccessConnection]
    PON[PON]
    ONU[ONU / ONT]
    OLT[OLT]
    ETH[Ethernet]
    DEV[AccessDevice / Switch]
    PORT[Port]
    SV[SubscriberServices]

    S --> C
    S --> A
    A --> B
    B --> ST
    S --> T
    S --> F
    S --> N
    N --> SS
    S --> AC
    AC --> PON
    PON --> ONU
    ONU --> OLT
    AC --> ETH
    ETH --> DEV
    DEV --> PORT
    S --> SV
```

The important semantic point is that `Building`, `Street`, `OLT`, access devices and tariff/service definitions are not just anonymous fields inside one broad subscriber snapshot. They are entities or references with their own ownership and reuse semantics.

---

## 2. Current vs target runtime

```mermaid
flowchart TB
    subgraph CURRENT[Current source/snapshot/tool-oriented path]
        B1[Billing]
        U1[UserSide]
        N1[Network / PON]
        SNAP[Large snapshots]
        TOOL[Tool selection]
        LLM1[LLM]
        B1 --> SNAP
        U1 --> SNAP
        N1 --> SNAP
        SNAP --> TOOL
        TOOL --> LLM1
    end

    subgraph TARGET[Target canonical fact path]
        MSG[User message]
        SEM[LLM semantic understanding]
        NEED[requiredFacts]
        RES[Fact Resolver]
        ADP[Source Adapters]
        SRC[Billing / UserSide / Network / PON / KB]
        CACHE[Source cache]
        FACTS[Canonical facts]
        PROJ[Compact projection]
        LLM2[LLM synthesis]

        MSG --> SEM
        SEM --> NEED
        NEED --> RES
        RES --> ADP
        ADP --> CACHE
        CACHE --> SRC
        SRC --> CACHE
        CACHE --> FACTS
        FACTS --> PROJ
        PROJ --> LLM2
    end
```

Key rule: a source/cache may be broad, while the projection sent to the model should be narrow and request-specific.

---

## 3. Decision chain for subscriber questions

```mermaid
flowchart LR
    Q[Subscriber question]
    I[Understand semantic intent]
    CTX[Resolve active context / identity]
    RF[Select required facts]
    FR[Fact Resolver]
    READ[Grouped source reads / cache]
    CF[Canonical facts]
    RULES[KB / business rules only if needed]
    ANSWER[Concise grounded answer]

    Q --> I
    I --> CTX
    CTX --> RF
    RF --> FR
    FR --> READ
    READ --> CF
    CF --> ANSWER
    RULES --> ANSWER
    RF -. if policy/rule needed .-> RULES
```

Examples:

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
"На этом доме GPON есть?"
→ active Subscriber
→ ServiceAddress
→ Building
→ building.gpon
```

```text
"А КТВ там есть?"
→ reuse activeBuilding
→ building.ktv
```

---

## 4. Source adapters and canonical ownership

```mermaid
flowchart LR
    BILL[Billing HTML / CGI]
    US[UserSide]
    NET[Billing stat / Network]
    TMC[TMC / PON]
    KB[SIMNET KB]

    BA[Billing Adapter]
    UA[UserSide Adapter]
    NA[Network Adapter]
    PA[PON Adapter]
    KA[Knowledge Adapter]

    DOMAIN[Canonical Domain Facts]

    BILL --> BA
    US --> UA
    NET --> NA
    TMC --> PA
    KB --> KA

    BA --> DOMAIN
    UA --> DOMAIN
    NA --> DOMAIN
    PA --> DOMAIN
    KA --> DOMAIN
```

Example mapping:

```text
Billing dopfield_5
→ Billing Adapter
→ subscriber.serviceAddress.street
```

```text
Billing main summary finance.price
→ Billing Adapter
→ subscriber.tariff.current.price
```

```text
UserSide/TMC pon.onuSerial
→ PON Adapter
→ subscriber.access.pon.onu.serial
```

```text
UserSide Building fields.gpon
→ Building Adapter
→ building.gpon
```

---

## 5. Context memory

```mermaid
flowchart TB
    DC[Domain Context Memory]
    AS[activeSubscriber]
    AC[activeContract]
    AA[activeServiceAddress]
    AB[activeBuilding]
    AN[activeConnection]
    TP[currentTopic]

    DC --> AS
    DC --> AC
    DC --> AA
    DC --> AB
    DC --> AN
    DC --> TP
```

This is separate from transcript memory. It lets references like `там`, `на этом доме`, `у него`, `по этому договору` resolve against explicit active entities instead of relying only on replaying a large text history.
