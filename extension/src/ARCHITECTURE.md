# 🏛 Архитектура SIMNET Workbench 2.0

## Обзор

Данная документация описывает новую слоистую архитектуру приложения, которая заменяет монолитную реализацию workbench.js.

## Проблемы старой архитектуры

- ❌ UI-компоненты напрямую связаны с DOM NoDeny
- ❌ Бизнес-логика перемешана с манипуляциями DOM
- ❌ Отсутствие единого источника правды (State)
- ❌ Сложность тестирования и поддержки
- ❌ «Лапша» из зависимостей между модулями

## Новая архитектура (Layered Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│                      UI Layer (View)                        │
│   ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│   │  DockRail   │  │ ActiveCase   │  │ LiveMetrics     │   │
│   │             │  │ Panel        │  │ Chips           │   │
│   └─────────────┘  └──────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↕ (через EventBus)
┌─────────────────────────────────────────────────────────────┐
│                   State Store (Single Source of Truth)      │
│   abon | billing | currentCase | mentor | ui | metrics      │
└─────────────────────────────────────────────────────────────┘
                              ↕ (через EventBus)
┌─────────────────────────────────────────────────────────────┐
│              Core Layer (Business Logic)                    │
│   ┌─────────────────┐  ┌───────────────────────────────┐   │
│   │ DiagnosticEngine│  │ Training Mentor Engine        │   │
│   │ - сценарии      │  │ - шаги наставника             │   │
│   │ - правила       │  │ - подсказки                   │   │
│   └─────────────────┘  └───────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│              Services Layer (Infrastructure)                │
│   ┌─────────────────┐  ┌───────────────────────────────┐   │
│   │ NoDenyService   │  │ BillingService                │   │
│   │ - парсинг DOM   │  │ - синхронизация PP            │   │
│   │ - подсветка     │  │ - мост между вкладками        │   │
│   └─────────────────┘  └───────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│              Event Bus (Publisher/Subscriber)               │
│   ON_ABON_LOADED | ON_STEP_CHANGE | ON_SIGNAL_UPDATE       │
└─────────────────────────────────────────────────────────────┘
```

## Слои приложения

### 1. Events Layer (`src/events/`)

**EventBus** - центральная шина событий для реактивной связи между слоями.

```javascript
import { eventBus, EVENT_TYPES } from './events/EventBus.js';

// Подписка
eventBus.on(EVENT_TYPES.ON_ABON_LOADED, (event) => {
  console.log('Абонент загружен:', event.payload.abonId);
});

// Публикация
eventBus.emit(EVENT_TYPES.ON_ABON_LOADED, { abonId: '12345' });
```

**Типы событий:**
- `ON_ABON_LOADED` / `ON_ABON_UNLOADED` — загрузка/выгрузка абонента
- `ON_STEP_CHANGE` — смена шага Наставника
- `ON_SIGNAL_UPDATE` — обновление метрик сигнала
- `ON_DIAGNOSTIC_START/COMPLETE/ERROR` — статусы диагностики
- `ON_BILLING_AUTH` / `ON_BILLING_PP_UPDATE` — события биллинга
- `ON_STATE_CHANGED` — изменение состояния в Store

### 2. Store Layer (`src/store/`)

**StateStore** — единый источник правды (Single Source of Truth).

```javascript
import { stateStore } from './store/StateStore.js';

// Получение состояния
const state = stateStore.getState();
const abonId = stateStore.getSlice('abon.id');

// Обновление состояния
stateStore.update('abon', { name: 'Иванов И.И.', ip: '192.168.1.1' });

// Подписка на изменения
stateStore.subscribe(({ section, oldState, newState }) => {
  console.log(`Section ${section} changed:`, newState);
});

// Специализированные методы
stateStore.loadAbon({ id: '123', name: 'Абонент', ip: '...' });
stateStore.updateMetrics({ signalLevel: -22.5 });
stateStore.toggleDock();
```

**Структура состояния:**
```javascript
{
  abon: { id, name, address, phone, ip, mac, contractId, loadedAt },
  billing: { authenticated, pp, sessionExpiresAt, provider },
  currentCase: { id, type, status, steps, currentStepIndex },
  mentor: { active, currentStep, totalSteps, completedSteps, hints },
  ui: { visible, docked, expanded, side, width, activeTab },
  metrics: { signalLevel, onuStatus, portStatus, errors },
  diagnosticLogs: { entries, runId, startedAt },
  settings: { compactMode, autoStartDiagnostic, enableHints }
}
```

### 3. Core Layer (`src/core/`)

**DiagnosticEngine** — чистая бизнес-логика диагностики.

```javascript
import { diagnosticEngine } from './core/DiagnosticEngine.js';

// Запуск диагностики
diagnosticEngine.startDiagnostic('optical_issue', { abon, metrics });

// Управление шагами
diagnosticEngine.nextStep();
diagnosticEngine.prevStep();
diagnosticEngine.retryStep();

// Статус
const stats = diagnosticEngine.getStats();
```

**Принципы:**
- Не знает про DOM и HTML
- Работает только с данными из Store
- Реализует правила переключения шагов Наставника
- Авто-определение сценария по метрикам

### 4. Services Layer (`src/services/`)

#### NoDenyService

Работа с DOM системы NoDeny:

```javascript
import { noDenyService } from './services/NoDenyService.js';

// Парсинг контекста абонента
const context = noDenyService.parseAbonContext();

// Наблюдение за изменениями
noDenyService.startWatching();
noDenyService.stopWatching();

// Подсветка элемента
noDenyService.highlightElement('#onu-status', { color: '#ffeb3b' });
noDenyService.focusOnElement('contract_123');

// Извлечение данных
const status = noDenyService.parseConnectionStatus();
const signal = noDenyService.parseSignalLevel();
```

#### BillingService

Синхронизация с биллингом:

```javascript
import { billingService } from './services/BillingService.js';

// Установка провайдера
billingService.setProvider('simnet');

// Синхронизация контекста
billingService.syncBillingContext();

// Запрос данных
const abonData = await billingService.getAbonData('12345');
const services = await billingService.getAbonServices('12345');

// Мост между вкладками
billingService.startBridgeLeader();
billingService.stopBridgeLeader();
```

### 5. UI Layer (`src/ui/`)

View-компоненты (в разработке):

- **DockRail** — боковая панель для закрепления
- **ActiveCasePanel** — панель активного кейса
- **LiveMetricsChips** — чипсы с метриками в реальном времени
- **MentorStepList** — список шагов Наставника

**Принципы UI:**
- Только рендерят состояние из Store
- Отправляют действия через EventBus
- Никакой бизнес-логики внутри компонентов

## Поток данных

### Сценарий 1: Загрузка нового абонента

```
1. Оператор открывает карточку абонента в NoDeny
2. NoDenyService (MutationObserver) детектирует изменения
3. NoDenyService.parseAbonContext() → извлекает данные
4. StateStore.loadAbon(context) → обновляет Store
5. EventBus.emit(ON_ABON_LOADED) → уведомляет подписчиков
6. BillingService.syncBillingContext() → синхронизирует PP
7. UI Components реагируют на изменение Store → перерисовка
```

### Сценарий 2: Запуск диагностики

```
1. Оператор кликает [Запустить диагностику] в UI
2. UI отправляет событие: EventBus.emit(ON_UI_ACTION_CLICK, { action: 'start_diagnostic' })
3. DiagnosticEngine.startDiagnostic() → запускает сценарий
4. StateStore.setDiagnosticStatus('running') → обновляет статус
5. DiagnosticEngine.executeCurrentStep() → выполняет шаг
6. EventBus.emit(ON_STEP_CHANGE) → уведомляет UI
7. UI перерисовывает чек-лист Наставника
```

### Сценарий 3: Подсветка элемента

```
1. Оператор кликает [🎯 Подсветить] в UI
2. UI отправляет: EventBus.emit(ON_UI_HIGHLIGHT_REQUEST, { elementId: 'xxx' })
3. NoDenyService.focusOnElement('xxx') → находит элемент в DOM
4. NoDenyService.highlightElement() → применяет визуальный эффект
```

## Хранение данных

### In-Memory Store (StateStore)
- Текущий звонок
- Активный шаг диагностики
- Временные логи
- **Сбрасывается при смене абонента**

### Chrome Storage (localStorage / chrome.storage.local)
- Настройки пользователя (компактный режим, пресеты)
- История завершенных кейсов
- PP биллинга (с метаданными)
- **Сохраняется между сессиями**

## Миграция со старой архитектуры

### План миграции:

1. **Шаг 1.1** ✅ — Созданы EventBus и StateStore
2. **Шаг 1.2** ✅ — Выделен NoDenyService для работы с DOM
3. **Шаг 1.3** ✅ — Выделен DiagnosticEngine для бизнес-логики
4. **Шаг 1.4** ⏳ — Переподключение UI к новому Store
5. **Шаг 2** ⏳ — Двухсторонняя синхронизация
6. **Шаг 3** ⏳ — Очистка хранилища (storage vs in-memory)

### Временная совместимость

Старый workbench.js продолжает работать параллельно с новыми модулями.
Постепенная миграция функций:

```javascript
// Старый код (workbench.js)
document.querySelector('#dp-run').addEventListener('click', () => {
  // ... монолитная логика
});

// Новый код (после миграции)
import { eventBus } from './events/EventBus.js';
document.querySelector('#dp-run').addEventListener('click', () => {
  eventBus.emit(EVENT_TYPES.ON_DIAGNOSTIC_START, { scenario: 'auto' });
});
```

## Тестирование

Новая архитектура позволяет легко тестировать слои изолированно:

```javascript
// Тест DiagnosticEngine без DOM
describe('DiagnosticEngine', () => {
  it('должен определить сценарий optical_issue при низком сигнале', () => {
    const context = {
      metrics: { signalLevel: { value: -28 } }
    };
    const scenario = diagnosticEngine.detectScenario(context);
    expect(scenario).toBe('optical_issue');
  });
});

// Тест NoDenyService с моком DOM
describe('NoDenyService', () => {
  it('должен извлечь IP абонента из DOM', () => {
    document.body.innerHTML = '<div class="abon-ip">192.168.1.1</div>';
    const context = noDenyService.parseAbonContext();
    expect(context.ip).toBe('192.168.1.1');
  });
});
```

## Будущие улучшения

- [ ] Добавить TypeScript для типобезопасности
- [ ] Реализовать UI компоненты (React/Vue или ванильные)
- [ ] Добавить StorageService для работы с chrome.storage
- [ ] Реализовать MessagingService для communication с background script
- [ ] Добавить TrainingEngine для расширенного Наставника
- [ ] Внедрить RulesEngine для гибких правил диагностики

---

**Версия документации:** 2.0.0-dev  
**Дата обновления:** 2024  
**Статус:** В разработке (слои 1-4 реализованы, UI Layer в процессе)
