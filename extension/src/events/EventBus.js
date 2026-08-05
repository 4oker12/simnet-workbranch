/**
 * EventBus - Центральная шина событий для реактивной архитектуры
 * Реализует паттерн Publisher/Subscriber для связи между слоями
 */

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.debug = false;
  }

  /**
   * Подписка на событие
   * @param {string} event - имя события
   * @param {Function} callback - функция обработчика
   * @returns {Function} функция отписки
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    if (this.debug) {
      console.log('[EventBus] Subscribe:', event);
    }

    // Возвращаем функцию отписки
    return () => this.off(event, callback);
  }

  /**
   * Отписка от события
   * @param {string} event - имя события
   * @param {Function} callback - функция обработчика
   */
  off(event, callback) {
    if (!this.listeners.has(event)) return;
    
    this.listeners.get(event).delete(callback);
    
    if (this.listeners.get(event).size === 0) {
      this.listeners.delete(event);
    }

    if (this.debug) {
      console.log('[EventBus] Unsubscribe:', event);
    }
  }

  /**
   * Публикация события
   * @param {string} event - имя события
   * @param {any} payload - данные события
   */
  emit(event, payload = {}) {
    if (!this.listeners.has(event)) {
      if (this.debug) {
        console.log('[EventBus] No listeners for:', event);
      }
      return;
    }

    const eventObj = {
      type: event,
      payload,
      timestamp: Date.now(),
    };

    if (this.debug) {
      console.log('[EventBus] Emit:', event, payload);
    }

    // Асинхронное выполнение для избежания блокировок
    Promise.resolve().then(() => {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(eventObj);
        } catch (error) {
          console.error(`[EventBus] Error in listener for ${event}:`, error);
        }
      });
    });
  }

  /**
   * Одноразовая подписка (автоматическая отписка после первого срабатывания)
   * @param {string} event - имя события
   * @param {Function} callback - функция обработчика
   */
  once(event, callback) {
    const unsubscribe = this.on(event, (eventObj) => {
      unsubscribe();
      callback(eventObj);
    });
    return unsubscribe;
  }

  /**
   * Очистка всех слушателей (для перезагрузки состояния)
   */
  clear() {
    this.listeners.clear();
    if (this.debug) {
      console.log('[EventBus] All listeners cleared');
    }
  }

  /**
   * Получение списка активных событий
   * @returns {string[]} массив имен событий
   */
  getActiveEvents() {
    return Array.from(this.listeners.keys());
  }

  /**
   * Включение/выключение режима отладки
   * @param {boolean} enabled
   */
  setDebug(enabled) {
    this.debug = Boolean(enabled);
  }
}

// Экспорт единственного экземпляра (Singleton)
export const eventBus = new EventBus();

// Типы событий для типобезопасности
export const EVENT_TYPES = Object.freeze({
  // События от NoDeny DOM
  ON_ABON_LOADED: 'abon:loaded',
  ON_ABON_UNLOADED: 'abon:unloaded',
  ON_STEP_CHANGE: 'mentor:step:change',
  ON_SIGNAL_UPDATE: 'signal:update',
  ON_STATUS_CHANGE: 'status:change',
  
  // События от Billing
  ON_BILLING_AUTH: 'billing:auth',
  ON_BILLING_PP_UPDATE: 'billing:pp:update',
  ON_BILLING_SESSION_EXPIRE: 'billing:session:expire',
  
  // События сессии биллинга (новые)
  ON_BILLING_SESSION_CONFIRMED: 'billing:session:confirmed',
  ON_BILLING_SESSION_RESTORED: 'billing:session:restored',
  ON_BILLING_SESSION_UPDATED: 'billing:session:updated',
  ON_BILLING_SESSION_LOST: 'billing:session:lost',
  ON_BILLING_SESSION_CLEARED: 'billing:session:cleared',
  ON_BILLING_SESSION_EXPIRING: 'billing:session:expiring',
  
  // События от UI
  ON_UI_DOCK_TOGGLE: 'ui:dock:toggle',
  ON_UI_EXPAND_COLLAPSE: 'ui:expand:collapse',
  ON_UI_ACTION_CLICK: 'ui:action:click',
  ON_UI_HIGHLIGHT_REQUEST: 'ui:highlight:request',
  
  // События от Diagnostic Engine
  ON_DIAGNOSTIC_START: 'diagnostic:start',
  ON_DIAGNOSTIC_PROGRESS: 'diagnostic:progress',
  ON_DIAGNOSTIC_COMPLETE: 'diagnostic:complete',
  ON_DIAGNOSTIC_ERROR: 'diagnostic:error',
  
  // События от State Store
  ON_STATE_CHANGED: 'state:changed',
  ON_STORE_RESET: 'store:reset',
  
  // События от Training Mentor
  ON_MENTOR_INIT: 'mentor:init',
  ON_MENTOR_STEP_COMPLETE: 'mentor:step:complete',
  ON_MENTOR_CASE_COMPLETE: 'mentor:case:complete',
  
  // Системные события
  ON_EXTENSION_RELOAD: 'extension:reload',
  ON_STORAGE_SYNC: 'storage:sync',
});

export default eventBus;
