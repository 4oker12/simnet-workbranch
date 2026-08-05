# 🚀 SIMNET Workbench 2.0 - Быстрый старт

## Архитектура приложения

```
┌─────────────────────────────────────────────────────────────┐
│                      UI Layer (View)                        │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │ DockRail    │  │ ActiveCase   │  │ LiveMetrics     │    │
│  └─────────────┘  └──────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            ↕ (через EventBus)
┌─────────────────────────────────────────────────────────────┐
│                   State Store (Single Source of Truth)      │
│  abon | billing | currentCase | mentor | ui | metrics       │
└─────────────────────────────────────────────────────────────┘
                            ↕ (через EventBus)
┌─────────────────────────────────────────────────────────────┐
│   Core Layer           │    Services Layer                 │
│  ┌──────────────────┐  │  ┌─────────────────────────────┐  │
│  │ DiagnosticEngine │  │  │ NoDenyService (DOM Parser)  │  │
│  │ TrainingEngine   │  │  │ BillingService (Sync)       │  │
│  └──────────────────┘  │  │ BillingSessionService       │  │
│                        │  │ UIRendererService           │  │
│                        │  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Поток данных

### 1. Загрузка абонента (NoDeny → Store → UI)
```javascript
// NoDenyService обнаруживает нового абонента
noDenyService.syncAbonState();

// → Генерирует событие ON_ABON_LOADED
// → StateStore обновляет секцию 'abon'
// → UIRendererService автоматически перерисовывает карточку
```

### 2. Подтверждение сессии биллинга
```javascript
// Оператор входит в биллинг
billingSessionService.confirmSession({ pp, provider: 'simnet' });

// → Сохраняет в chrome.storage/GM_storage
// → Обновляет StateStore.billing
// → UI показывает "Сессия активна" с индикатором TTL
```

### 3. Диагностика (Core → Store → UI)
```javascript
// Запуск диагностики
diagnosticEngine.startDiagnostic('no_connection');

// → Обновляет currentCase.status = 'running'
// → Постепенно обновляет шаги через mentor.updateStep()
// → UI отображает прогресс и подсказки
```

## Использование

### Подписка на изменения состояния
```javascript
import { stateStore } from './store/index.js';

const unsubscribe = stateStore.subscribe((change) => {
  console.log('Изменена секция:', change.section);
  console.log('Новое состояние:', change.newState);
});

// Отписка когда больше не нужно
unsubscribe();
```

### Прослушивание событий
```javascript
import { eventBus, EVENT_TYPES } from './events/index.js';

eventBus.on(EVENT_TYPES.ON_ABON_LOADED, (event) => {
  console.log('Абонент загружен:', event.payload.abonId);
});

eventBus.on(EVENT_TYPES.ON_BILLING_SESSION_CONFIRMED, (event) => {
  console.log('Сессия подтверждена:', event.payload.provider);
});
```

### Работа с сервисами
```javascript
import { noDenyService, billingSessionService } from './services/index.js';

// Парсинг абонента из DOM
const abonContext = noDenyService.parseAbonContext();

// Подсветка элемента
noDenyService.highlightElement('#abon-card', {
  color: '#ffeb3b',
  duration: 3000
});

// Проверка сессии
const sessionState = billingSessionService.getSessionState();
console.log('Сессия активна:', sessionState.hasValidSession);
```

## Хранение данных

| Тип данных | Где хранится | Сбрасывается при |
|------------|--------------|------------------|
| Настройки UI | chrome.storage.local / GM_value | Никогда (пока пользователь не сбросит) |
| Сессия биллинга | chrome.storage.local / GM_value | Истечение TTL или logout |
| Текущий абонент | In-Memory StateStore | Переход на другую страницу |
| Логи диагностики | In-Memory StateStore | Смена абонента |
| История кейсов | chrome.storage.local | Никогда (архив) |

## Интеграция со старым workbench.js

Пошаговая миграция:

1. **Импортируйте новые модули** в начало workbench.js:
```javascript
import { 
  stateStore, 
  eventBus, 
  EVENT_TYPES,
  noDenyService,
  billingSessionService 
} from './index.js';
```

2. **Замените прямые манипуляции DOM** на вызовы сервисов:
```javascript
// БЫЛО:
document.querySelector('.abon-name').textContent = name;

// СТАЛО:
stateStore.update('abon', { name });
```

3. **Замените хранение состояния** на StateStore:
```javascript
// БЫЛО:
let currentAbonId = null;

// СТАЛО:
const currentAbonId = stateStore.getSlice('abon.id');
```

4. **Подпишитесь на события** вместо polling:
```javascript
// БЫЛО:
setInterval(() => checkForNewAbon(), 1000);

// СТАЛО:
eventBus.on(EVENT_TYPES.ON_ABON_LOADED, handleNewAbon);
noDenyService.startWatching();
```

## Отладка

Включите режим отладки EventBus:
```javascript
import { eventBus } from './events/index.js';
eventBus.setDebug(true);
```

Просмотр активного состояния:
```javascript
import { stateStore } from './store/index.js';
console.log(stateStore.getState());
```

Просмотр конкретной секции:
```javascript
console.log(stateStore.getSlice('billing'));
console.log(stateStore.getSlice('abon.ip'));
```

## Решение проблем

### Сессия сбрасывается при перезагрузке
✅ Убедитесь что `billingSessionService.confirmSession()` вызывается после входа
✅ Проверьте что storageAdapter работает (GM API или chrome.storage доступны)

### UI не обновляется при изменении данных
✅ Проверьте что данные обновляются через `stateStore.update()`, а не напрямую
✅ Убедитесь что `uiRendererService.init()` был вызван с правильным контейнером

### События не срабатывают
✅ Проверьте подписку: `eventBus.on(EVENT_TYPES.*, handler)`
✅ Убедитесь что источник событий существует и активен

---

**Документация**: См. `src/ARCHITECTURE.md` для подробного описания архитектуры.
