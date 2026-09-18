# SIMNET Autonomous AI Operator — Live READ API

Это не внешний HTTP API. Это внутренний набор READ-инструментов, которыми AI-оператор получает подтверждённые данные из Billing, UserSide и накопленного Workbench-контекста.

Главный принцип: **LLM решает, какая информация нужна; tool broker выбирает READ-инструмент; runtime получает факт из CRM; только после этого LLM формирует ответ.**

Все live-инструменты работают в браузере оператора через уже открытые и авторизованные вкладки. Пароли, `pp`, cookie и другие session-секреты в AI-контекст не передаются и в storage специально не сохраняются.

## Поток одного запроса

```text
Сообщение клиента
  ↓
Semantic understanding
  ↓
Каких фактов не хватает?
  ↓
customer.lookup (если абонент ещё не привязан)
  ↓
confirmedSubscriber удерживается между сообщениями
  ↓
Billing / UserSide / Network READ tool
  ↓
tool evidence: source + observedAt + реальные поля
  ↓
финальный ответ клиенту
```

## Команды

### `customer.lookup`

**Назначение:** найти и привязать конкретного абонента.

**Основной источник:** Billing live.

**Принимает:**

```js
{ contract: '470642' }
{ login: 'abon470642' }
{ ip: '10.8.2.45' }
{ address: 'вул. Метрологічна 44 кв 9' }
```

**Как ищет:**

- договор/login/IP: штатный Billing `a=listuser`, `f=n`, `what_search=<mode>`, `name=<value>`;
- адрес: штатный Billing `a=listuser`, `f=d` + `dopfield_5/6/11/8`;
- найденный Billing ID затем читается через `a=user&id=<billingId>`;
- адрес и дополнительные данные дочитываются через `a=dopdata`.

**Возвращает кандидата:**

- `billingId`;
- `contract`;
- `login`;
- `fullName`;
- `address`;
- `ip`;
- `connectionFamily`/technology hint, если доступен.

**Правило идентификации:** точный договор/login/IP может сразу подтвердить абонента. По адресу кандидат остаётся pending, пока не подтверждено нужное подключение.

---

### `customer.snapshot`

**Назначение:** дать общий live-снимок подтверждённого абонента из Billing.

**Источник:** `billing-live-read-only`.

**Основные секции:**

- `identity`;
- `address`;
- `contacts`;
- `customer`;
- `service`;
- `finance`;
- `network`;
- `payments`;
- `technical` (накоплен в Billing snapshot и доступен runtime при необходимости).

Используется, когда запрос клиента широкий: «что у меня по договору», «какие данные по подключению» и т.п.

---

### `billing.balance`

**Назначение:** ответить на вопросы о балансе, долге, состоянии счёта и текущем списании.

**Источник:** Billing live.

**Читаемые поля:**

| Поле API | Откуда берётся в Billing |
|---|---|
| `accountBalance` | строка `На счету, грн / На рахунку, грн` |
| `balanceAfterTariff` | `На счете с учетом стоимости тарифного плана` |
| `balanceWithoutTemporary` | `На счете без учета временных платежей` |
| `temporaryPayment` | текст про временный платёж |
| `price` | строка `Цена / Ціна, грн` |
| `totalDue` | `Итого к оплате / Разом до сплати` |
| `currentTariff` | `select[name=paket]` |
| `accessState` | `select[name=state]` |
| `serviceState` | `select[name=cstate]` |

**Важно:** `price` не считается автоматически «ценой интернета» — Billing может показывать общий/контекстный price row. `totalDue` — текущее Billing-значение, не прогноз будущего списания.

---

### `billing.tariff`

**Назначение:** текущий тариф, следующий тариф, состояние услуги.

**Читаемые поля:**

| Поле API | Billing DOM |
|---|---|
| `currentTariff` | `paket` |
| `nextTariff` | `next_paket` |
| `nextTariffDelay` | `next_paket_delay` |
| `group` | `grp` |
| `accessState` | `state` |
| `serviceState` | `cstate` |
| `startDay` | `start_day` |
| `activeServices[]` | checked `input[name^=sr]` |
| `activeServicesTotal` | сумма реально прочитанных активных услуг |

Для вопроса «какая у меня скорость по тарифу?» сначала определяется тариф через этот tool, а уже его свойства/правила трактуются с помощью внутренней базы знаний — не по случайному числу со страницы.

---

### `billing.payments`

**Назначение:** последние платежи.

**Источник:** Billing live.

**Читает таблицу:** `#my_x_16`.

До 6 последних строк:

```js
{
  date: '...',
  description: '...',
  amount: '...'
}
```

Если таблица не отрисована/не доступна в Billing-ответе, tool возвращает `DATA_NOT_AVAILABLE`, а не придумывает отсутствие платежей.

---

### Billing live: дополнительные поля общего snapshot

Помимо balance/tariff/payments live-поиск читает:

**Авторизация и сеть**

- IP (`input[name=ip]` или таблица авторизации);
- статус авторизации (`table.usrlist`, title и строки);
- доступ разрешён/не разрешён;
- последняя активность;
- входящий/исходящий traffic counters.

**Технические допданные `dopdata tmpl=1`**

- subscriber MAC — `dopfield_4`;
- EPON ONU MAC — `dopfield_19`;
- GPON ONT serial — `dopfield_38`;
- OLT — `dopfield_29`;
- OLT IP, извлечённый из поля OLT;
- static IP configured — `dopfield_44`;
- ONU with cable TV — `dopfield_37`;
- technical comment — `dopfield_34`.

**Адрес/контакты `dopdata tmpl=2`**

- street — `dopfield_5`;
- building — `dopfield_6`;
- block — `dopfield_11`;
- entrance — `dopfield_12`;
- floor — `dopfield_7`;
- apartment — `dopfield_8`;
- phone — `dopfield_9`;
- extra phone — `dopfield_22`;
- email — `dopfield_14`;
- subscriber type — `dopfield_31`;
- contracted with — `dopfield_32`;
- EDRPOU — `dopfield_33`;
- manager — `dopfield_43`;
- connected by — `dopfield_25`.

---

### `userside.snapshot`

**Назначение:** свежая техническая картина того же подтверждённого абонента.

**Источник:** `userside-live-read-only`.

**Предусловие:** должна быть открыта авторизованная вкладка `userside.simnet.kiev.ua`.

**Как ищет:**

1. Берёт из `confirmedSubscriber` в приоритете `customerId → login → contract → IP → address`.
2. Если `customerId` уже известен — GET `/customer/<id>`.
3. Иначе GET `/customer_list?search=<identifier>`.
4. Из результата выбирается один `/customer/<id>`.
5. Загружается карточка клиента.
6. Billing и UserSide identity сравниваются. При противоречии tool возвращает `USERSIDE_IDENTITY_MISMATCH` и не отдаёт технические данные как подтверждённые.

**Читает:**

- UserSide customer ID;
- login;
- договор, если он отображён;
- адрес, если он отображён;
- IP только из штатного ping-control `reload_ping_data`;
- MAC из ссылок `find_typer=machistory`;
- точку подключения;
- Ethernet/PON family;
- устройство доступа;
- IP устройства;
- порт/interface;
- link state;
- negotiated speed;
- TMC/PON данные.

---

### `pon.onu`

**Назначение:** привязка ONU/OLT/порта.

**Первичный источник:** свежий UserSide live snapshot.

**Поля:**

- `connectionFamily`;
- `onuSerial`;
- `onuMac`;
- `onuDeviceId`;
- `onuDeviceName`;
- `onuDeviceIp`;
- `onuLanPort`;
- `onuLanInterface`;
- `onuLanLinkState`;
- `onuLanSpeedMbps`;
- `oltName`;
- `oltIp`;
- `oltDeviceId`;
- `port`;
- `foundOnOlt`.

Если UserSide подтверждает Ethernet, команда возвращает `NOT_APPLICABLE`: это не ошибка линии, а указание, что ONU/OLT к этому подключению не относится.

---

### `pon.signal`

**Назначение:** оптические показатели.

**Первичный источник:** UserSide TMC live.

**Поля:**

- `rx` — ONU Rx;
- `tx` — ONU Tx;
- `oltRx` — OLT Rx;
- `foundOnOlt`;
- `onuLanLinkState`;
- `observedAt`.

Если свежий UserSide недоступен, runtime может использовать накопленный Workbench/PON-контекст только как fallback и обязан оставить предупреждение об источнике.

---

### `network.session`

**Назначение:** последняя доступная BRAS/Juniper-сессия.

**Текущий источник:** подтверждённый Workbench case того же абонента. Это пока не отдельный live-запрос Juniper из AI Lab.

Если активная AI-идентификация имеет `billing-live:<id>`, runtime повторно находит локальный Workbench-case по подтверждённому договору/login/IP и только потом читает network session. Billing ID не используется как локальный case ID.

Доступные поля зависят от уже прочитанного Juniper-контекста, обычно:

- status;
- subscriber IP/MAC;
- start time;
- last event/time;
- router;
- vendor;
- VLAN;
- traffic presence;
- source/read time.

---

## Состояние диалога

После успешного lookup runtime держит:

```js
{
  confirmedCaseId,
  confirmedSubscriber: {
    billingId,
    customerId,
    contract,
    login,
    fullName,
    address,
    ip,
    connectionFamily
  }
}
```

Поэтому клиент не обязан повторять договор в каждом сообщении:

```text
— Какой баланс?
— Нужен договор.
— 470642
— ...баланс...
— А тариф какой?
```

В последнем сообщении `billing.tariff` работает с уже подтверждённым абонентом.

## Свежесть

Billing и UserSide snapshots имеют `observedAt`. Семантический broker для live-фактов запрашивает `refresh: true` и стандартный `maxAgeMs: 120000`.

Это не означает, что данные считаются истинными навсегда: ответ строится из конкретного evidence с конкретным временем чтения.

## Основные коды отказа

| Код | Значение |
|---|---|
| `IDENTITY_REQUIRED` | ещё не выбран абонент |
| `IDENTITY_QUERY_REQUIRED` | нет договора/login/IP/адреса для поиска |
| `NOT_FOUND` | штатный поиск не дал кандидата |
| `AMBIGUOUS_IDENTITY` | Billing дал несколько подходящих кандидатов |
| `BILLING_TAB_REQUIRED` | нет открытой Billing-вкладки |
| `BILLING_SESSION_REQUIRED` | из вкладки не удалось получить текущую Billing session |
| `BILLING_AUTH_REQUIRED` | Billing требует авторизацию |
| `USERSIDE_TAB_REQUIRED` | нет открытой UserSide-вкладки |
| `USERSIDE_AUTH_REQUIRED` | UserSide требует авторизацию |
| `USERSIDE_AMBIGUOUS_IDENTITY` | UserSide дал несколько равных кандидатов |
| `USERSIDE_IDENTITY_MISMATCH` | UserSide-карточка противоречит подтверждённому Billing identity |
| `DATA_NOT_AVAILABLE` | источник прочитан, но нужного поля нет |
| `NOT_APPLICABLE` | проверка не относится к этому типу подключения |
| `FRESH_DATA_UNAVAILABLE` | требовалось обновить факт, но свежий Billing read не получен |

## Граница безопасности

Этот API **не выполняет WRITE-действия**:

- не меняет тариф;
- не меняет данные договора;
- не создаёт платежи;
- не сохраняет UserSide карточки;
- не переключает ONU;
- не нажимает кнопки CRM;
- не отправляет сообщение клиенту от имени HelpCrunch.

Live Billing/UserSide используют только GET/fetch с `credentials: include` внутри уже авторизованной вкладки оператора. WRITE-команды должны проектироваться отдельно и проходить отдельный policy/confirmation слой.
