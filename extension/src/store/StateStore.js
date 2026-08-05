/**
 * State Store - Единый источник правды (Single Source of Truth)
 * Хранит всё состояние приложения и уведомляет подписчиков об изменениях
 */

import { eventBus, EVENT_TYPES } from '../events/EventBus.js';

// Начальное состояние
const createInitialState = () => ({
  // Контекст абонента (из NoDeny)
  abon: {
    id: null,
    name: '',
    address: '',
    phone: '',
    ip: '',
    mac: '',
    contractId: '',
    loadedAt: null,
  },
  
  // Контекст биллинга
  billing: {
    authenticated: false,
    pp: '',
    ppFingerprint: '',
    sessionExpiresAt: null,
    lastSyncAt: null,
    provider: 'simnet',
  },
  
  // Текущий кейс диагностики
  currentCase: {
    id: null,
    type: '',
    status: 'idle', // idle | running | paused | completed | error
    startedAt: null,
    completedAt: null,
    steps: [],
    currentStepIndex: -1,
  },
  
  // Состояние Наставника (Training Mentor)
  mentor: {
    active: false,
    currentStep: null,
    totalSteps: 0,
    completedSteps: 0,
    hints: [],
    lastActionAt: null,
  },
  
  // Состояние UI панели
  ui: {
    visible: true,
    docked: false,
    expanded: false,
    side: 'right',
    width: 520,
    collapsedSections: new Set(),
    activeTab: 'diagnostic',
  },
  
  // Метрики в реальном времени
  metrics: {
    signalLevel: null,
    onuStatus: null,
    portStatus: null,
    errors: [],
    lastUpdateAt: null,
  },
  
  // Логи диагностики (in-memory, сбрасываются при смене абонента)
  diagnosticLogs: {
    entries: [],
    runId: null,
    startedAt: null,
  },
  
  // Настройки пользователя (синхронизируются с chrome.storage)
  settings: {
    compactMode: false,
    autoStartDiagnostic: false,
    enableHints: true,
    theme: 'light',
    dockSide: 'right',
  },
});

class StateStore {
  constructor() {
    this.state = createInitialState();
    this.subscribers = new Set();
    this.batchUpdates = false;
    this.pendingChanges = {};
    
    // Включаем отладку EventBus для отслеживания изменений
    eventBus.setDebug(false);
  }

  /**
   * Получение всего состояния
   * @returns {Object} копия текущего состояния
   */
  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Получение конкретного slice состояния
   * @param {string} path - путь к свойству (например 'abon.id' или 'ui.docked')
   * @returns {any} значение свойства
   */
  getSlice(path) {
    return path.split('.').reduce((obj, key) => {
      return obj && obj[key] !== undefined ? obj[key] : undefined;
    }, this.state);
  }

  /**
   * Обновление состояния
   * @param {string} section - секция состояния ('abon', 'billing', 'ui', etc.)
   * @param {Object} changes - объект с изменениями
   * @param {boolean} emitEvent - испускать ли событие ON_STATE_CHANGED
   */
  update(section, changes, emitEvent = true) {
    if (!this.state.hasOwnProperty(section)) {
      console.warn(`[StateStore] Unknown section: ${section}`);
      return;
    }

    const oldState = JSON.parse(JSON.stringify(this.state[section]));
    
    // Объединяем изменения
    Object.keys(changes).forEach(key => {
      const value = changes[key];
      
      // Специальная обработка Set и Map для сохранения реактивности
      if (value instanceof Set || value instanceof Map) {
        this.state[section][key] = value;
      } else if (typeof value === 'object' && value !== null) {
        this.state[section][key] = JSON.parse(JSON.stringify(value));
      } else {
        this.state[section][key] = value;
      }
    });

    const newState = JSON.parse(JSON.stringify(this.state[section]));

    if (emitEvent) {
      eventBus.emit(EVENT_TYPES.ON_STATE_CHANGED, {
        section,
        oldState,
        newState,
        timestamp: Date.now(),
      });
    }

    // Уведомляем прямых подписчиков Store
    this.subscribers.forEach(callback => {
      try {
        callback({ section, oldState, newState });
      } catch (error) {
        console.error('[StateStore] Error in subscriber:', error);
      }
    });
  }

  /**
   * Пакетное обновление (несколько изменений за один раз)
   * @param {Object} updates - объект вида { section: { changes } }
   */
  batchUpdate(updates) {
    Object.keys(updates).forEach(section => {
      this.update(section, updates[section], false);
    });
    
    // Испускаем одно итоговое событие
    eventBus.emit(EVENT_TYPES.ON_STATE_CHANGED, {
      batch: true,
      sections: Object.keys(updates),
      timestamp: Date.now(),
    });
  }

  /**
   * Подписка на изменения состояния
   * @param {Function} callback - функция обратного вызова
   * @returns {Function} функция отписки
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Сброс состояния к начальному
   * @param {boolean} keepSettings - сохранить ли настройки пользователя
   */
  reset(keepSettings = true) {
    const settings = keepSettings ? this.state.settings : null;
    const ui = keepSettings ? { 
      ...this.state.ui,
      collapsedSections: new Set()
    } : null;
    
    this.state = createInitialState();
    
    if (keepSettings) {
      this.state.settings = settings;
      this.state.ui = ui;
    }
    
    eventBus.emit(EVENT_TYPES.ON_STORE_RESET, { 
      keepSettings,
      timestamp: Date.now() 
    });
  }

  /**
   * Специализированные методы для часто используемых обновлений
   */

  // Загрузка нового абонента
  loadAbon(abonData) {
    this.reset(true); // Сбрасываем логи, но сохраняем настройки
    
    this.update('abon', {
      ...abonData,
      loadedAt: Date.now(),
    });
    
    eventBus.emit(EVENT_TYPES.ON_ABON_LOADED, {
      abonId: abonData.id,
      timestamp: Date.now(),
    });
  }

  // Выгрузка абонента
  unloadAbon() {
    this.update('abon', {
      id: null,
      name: '',
      address: '',
      phone: '',
      ip: '',
      mac: '',
      contractId: '',
      loadedAt: null,
    });
    
    this.update('diagnosticLogs', {
      entries: [],
      runId: null,
      startedAt: null,
    });
    
    eventBus.emit(EVENT_TYPES.ON_ABON_UNLOADED, {
      timestamp: Date.now(),
    });
  }

  // Обновление статуса диагностики
  setDiagnosticStatus(status, extraData = {}) {
    this.update('currentCase', {
      status,
      ...extraData,
    });
  }

  // Обновление шага Наставника
  updateMentorStep(stepData) {
    this.update('mentor', stepData);
    
    eventBus.emit(EVENT_TYPES.ON_STEP_CHANGE, {
      step: stepData.currentStep,
      timestamp: Date.now(),
    });
  }

  // Обновление метрик
  updateMetrics(metricsData) {
    this.update('metrics', {
      ...metricsData,
      lastUpdateAt: Date.now(),
    });
    
    eventBus.emit(EVENT_TYPES.ON_SIGNAL_UPDATE, {
      metrics: metricsData,
      timestamp: Date.now(),
    });
  }

  // Добавление записи в лог диагностики
  addLogEntry(entry) {
    const logs = this.state.diagnosticLogs.entries;
    logs.push({
      ...entry,
      timestamp: Date.now(),
    });
    
    // Ограничиваем размер лога
    if (logs.length > 900) {
      logs.shift();
    }
    
    this.update('diagnosticLogs', { entries: logs }, false);
  }

  // Переключение видимости UI
  toggleUIVisibility() {
    this.update('ui', { visible: !this.state.ui.visible });
  }

  // Переключение dock режима
  toggleDock() {
    this.update('ui', { docked: !this.state.ui.docked });
    eventBus.emit(EVENT_TYPES.ON_UI_DOCK_TOGGLE, {
      docked: !this.state.ui.docked,
      timestamp: Date.now(),
    });
  }

  // Обновление настроек
  updateSettings(settingsData) {
    this.update('settings', settingsData);
    eventBus.emit(EVENT_TYPES.ON_STORAGE_SYNC, {
      type: 'settings',
      data: settingsData,
      timestamp: Date.now(),
    });
  }
}

// Экспорт единственного экземпляра (Singleton)
export const stateStore = new StateStore();

export default stateStore;
