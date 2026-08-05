/**
 * BillingSessionService - Управление сессией биллинга
 * 
 * Решает проблемы:
 * 1. Синхронизация состояния сессии между вкладками
 * 2. Сохранение сессии при перезагрузке страницы
 * 3. Координация фоновых проверок и ручных действий оператора
 * 4. Защита от race conditions при одновременных запросах
 * 
 * ВАЖНО: Использует GM API для совместимости с Tampermonkey
 */

import { eventBus, EVENT_TYPES } from '../events/EventBus.js';
import { stateStore } from '../store/StateStore.js';

const SESSION_STORAGE_KEY = 'dp_billing_session_v1';
const SESSION_CHECK_INTERVAL = 30000; // 30 секунд

// Адаптер для работы с GM API или chrome.storage
const storageAdapter = {
  async get(key) {
    if (typeof GM_getValue !== 'undefined') {
      return GM_getValue(key, null);
    }
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] || null;
    } catch (e) {
      console.warn('[StorageAdapter] chrome.storage not available:', e);
      return null;
    }
  },
  
  async set(key, value) {
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue(key, value);
      return;
    }
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (e) {
      console.warn('[StorageAdapter] chrome.storage set failed:', e);
    }
  },
  
  async remove(key) {
    if (typeof GM_deleteValue !== 'undefined') {
      GM_deleteValue(key);
      return;
    }
    try {
      await chrome.storage.local.remove(key);
    } catch (e) {
      console.warn('[StorageAdapter] chrome.storage remove failed:', e);
    }
  },
  
  onChange(key, callback) {
    if (typeof GM_addValueChangeListener !== 'undefined') {
      return GM_addValueChangeListener(key, (name, oldVal, newVal, remote) => {
        callback({ [key]: { newValue: newVal, oldValue: oldVal } });
      });
    }
    
    if (chrome.storage?.onChanged) {
      const listener = (changes, namespace) => {
        if (namespace === 'local' && changes[key]) {
          callback(changes);
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
    
    return () => {};
  }
};

class BillingSessionService {
  constructor() {
    this.sessionCheckTimer = null;
    this.isChecking = false;
    this.lastKnownState = {
      authenticated: false,
      sessionExpiresAt: null,
      pp: '',
      provider: 'simnet'
    };
    this.storageUnsubscribe = null;
    
    this._init();
  }

  async _init() {
    // Восстанавливаем сессию из storage при старте
    await this._restoreSession();
    
    // Слушаем изменения в storage (синхронизация между вкладками)
    this.storageUnsubscribe = storageAdapter.onChange(SESSION_STORAGE_KEY, (changes) => {
      const newSession = changes[SESSION_STORAGE_KEY]?.newValue;
      if (newSession) {
        this._syncSessionFromStorage(newSession);
      }
    });

    // Запускаем периодическую проверку сессии
    this._startSessionMonitoring();
    
    console.log('[BillingSession] Service initialized');
  }

  /**
   * Восстановление сессии из chrome.storage
   */
  async _restoreSession() {
    try {
      const saved = await storageAdapter.get(SESSION_STORAGE_KEY);
      
      if (saved && saved.authenticated) {
        const now = Date.now();
        
        // Проверяем, не истекла ли сессия
        if (saved.sessionExpiresAt && now < saved.sessionExpiresAt) {
          console.log('[BillingSession] Session restored from storage', {
            expiresAt: new Date(saved.sessionExpiresAt).toLocaleTimeString(),
            ttl: Math.round((saved.sessionExpiresAt - now) / 1000) + 's'
          });
          
          this.lastKnownState = { ...saved };
          
          // Обновляем Store
          stateStore.update('billing', {
            authenticated: true,
            pp: saved.pp || '',
            ppFingerprint: saved.ppFingerprint || '',
            sessionExpiresAt: saved.sessionExpiresAt,
            lastSyncAt: now,
            provider: saved.provider || 'simnet'
          });
          
          eventBus.emit(EVENT_TYPES.ON_BILLING_SESSION_RESTORED, {
            provider: saved.provider,
            ttl: saved.sessionExpiresAt - now
          });
        } else {
          console.log('[BillingSession] Session expired or invalid');
          await this._clearStoredSession();
        }
      }
    } catch (error) {
      console.error('[BillingSession] Restore error:', error);
    }
  }

  /**
   * Синхронизация сессии из storage (когда изменилась в другой вкладке)
   */
  _syncSessionFromStorage(sessionData) {
    if (!sessionData.authenticated) {
      console.log('[BillingSession] Session cleared in another tab');
      stateStore.update('billing', {
        authenticated: false,
        pp: '',
        sessionExpiresAt: null
      });
      eventBus.emit(EVENT_TYPES.ON_BILLING_SESSION_LOST, { reason: 'cleared' });
      return;
    }

    const now = Date.now();
    if (sessionData.sessionExpiresAt && now < sessionData.sessionExpiresAt) {
      console.log('[BillingSession] Session updated from another tab');
      
      this.lastKnownState = { ...sessionData };
      
      stateStore.update('billing', {
        authenticated: true,
        pp: sessionData.pp || '',
        ppFingerprint: sessionData.ppFingerprint || '',
        sessionExpiresAt: sessionData.sessionExpiresAt,
        lastSyncAt: now,
        provider: sessionData.provider || 'simnet'
      });
      
      eventBus.emit(EVENT_TYPES.ON_BILLING_SESSION_UPDATED, {
        source: 'storage_sync',
        provider: sessionData.provider
      });
    }
  }

  /**
   * Подтверждение сессии (вызывается после успешной аутентификации)
   * @param {Object} sessionData - данные сессии
   */
  async confirmSession(sessionData) {
    const { pp, provider = 'simnet', duration = 3600 } = sessionData;
    
    const now = Date.now();
    const expiresAt = now + (duration * 1000);
    
    const sessionState = {
      authenticated: true,
      pp: pp || '',
      ppFingerprint: this._generateFingerprint(pp),
      sessionExpiresAt: expiresAt,
      provider,
      confirmedAt: now
    };

    // Сохраняем в storage
    await this._saveToStorage(sessionState);
    
    // Обновляем локальное состояние
    this.lastKnownState = sessionState;
    
    // Обновляем Store
    stateStore.update('billing', {
      authenticated: true,
      pp: sessionState.pp,
      ppFingerprint: sessionState.ppFingerprint,
      sessionExpiresAt: sessionState.sessionExpiresAt,
      lastSyncAt: now,
      provider
    });

    console.log('[BillingSession] Session confirmed', {
      provider,
      expiresAt: new Date(expiresAt).toLocaleTimeString(),
      duration: duration + 's'
    });

    eventBus.emit(EVENT_TYPES.ON_BILLING_SESSION_CONFIRMED, {
      provider,
      expiresAt,
      ttl: duration
    });

    // Немедленно проверяем сессию
    this._checkSessionNow();
  }

  /**
   * Проверка валидности сессии
   */
  async checkSession() {
    if (this.isChecking) {
      console.log('[BillingSession] Check already in progress, skipping');
      return false;
    }

    this.isChecking = true;
    
    try {
      const currentState = stateStore.getSlice('billing');
      
      if (!currentState.authenticated) {
        console.log('[BillingSession] Not authenticated');
        return false;
      }

      const now = Date.now();
      const expiresAt = currentState.sessionExpiresAt;
      
      if (!expiresAt || now >= expiresAt) {
        console.log('[BillingSession] Session expired');
        await this._handleSessionExpired();
        return false;
      }

      const ttl = expiresAt - now;
      const ttlMinutes = Math.round(ttl / 60000);
      
      console.log('[BillingSession] Session valid', {
        ttl: ttlMinutes + 'm',
        provider: currentState.provider
      });

      // Если осталось меньше 5 минут, предупреждаем
      if (ttl < 300000) {
        eventBus.emit(EVENT_TYPES.ON_BILLING_SESSION_EXPIRING, {
          ttl,
          ttlMinutes
        });
      }

      return true;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Принудительная проверка (для ручного запуска оператором)
   */
  async _checkSessionNow() {
    await this.checkSession();
  }

  /**
   * Обработка истечения сессии
   */
  async _handleSessionExpired() {
    await this._clearStoredSession();
    
    stateStore.update('billing', {
      authenticated: false,
      pp: '',
      ppFingerprint: '',
      sessionExpiresAt: null
    });

    eventBus.emit(EVENT_TYPES.ON_BILLING_SESSION_LOST, {
      reason: 'expired'
    });
  }

  /**
   * Очистка сессии (logout)
   */
  async clearSession() {
    console.log('[BillingSession] Clearing session');
    await this._clearStoredSession();
    
    this.lastKnownState = {
      authenticated: false,
      sessionExpiresAt: null,
      pp: '',
      provider: 'simnet'
    };
    
    stateStore.update('billing', {
      authenticated: false,
      pp: '',
      ppFingerprint: '',
      sessionExpiresAt: null
    });

    eventBus.emit(EVENT_TYPES.ON_BILLING_SESSION_CLEARED);
  }

  /**
   * Получение текущего состояния сессии
   */
  getSessionState() {
    const billing = stateStore.getSlice('billing');
    const now = Date.now();
    
    return {
      authenticated: billing.authenticated,
      provider: billing.provider,
      hasValidSession: billing.authenticated && 
                       billing.sessionExpiresAt && 
                       now < billing.sessionExpiresAt,
      expiresAt: billing.sessionExpiresAt,
      ttl: billing.sessionExpiresAt ? 
           billing.sessionExpiresAt - now : null,
      pp: billing.pp,
      lastSyncAt: billing.lastSyncAt
    };
  }

  /**
   * Запуск мониторинга сессии
   */
  _startSessionMonitoring() {
    if (this.sessionCheckTimer) {
      clearInterval(this.sessionCheckTimer);
    }

    this.sessionCheckTimer = setInterval(() => {
      this._checkSessionNow();
    }, SESSION_CHECK_INTERVAL);

    console.log('[BillingSession] Monitoring started', {
      interval: SESSION_CHECK_INTERVAL / 1000 + 's'
    });
  }

  /**
   * Остановка мониторинга
   */
  stopMonitoring() {
    if (this.sessionCheckTimer) {
      clearInterval(this.sessionCheckTimer);
      this.sessionCheckTimer = null;
      console.log('[BillingSession] Monitoring stopped');
    }
  }

  /**
   * Сохранение в chrome.storage
   */
  async _saveToStorage(sessionData) {
    try {
      await storageAdapter.set(SESSION_STORAGE_KEY, sessionData);
    } catch (error) {
      console.error('[BillingSession] Save error:', error);
    }
  }

  /**
   * Очистка из chrome.storage
   */
  async _clearStoredSession() {
    try {
      await storageAdapter.remove(SESSION_STORAGE_KEY);
    } catch (error) {
      console.error('[BillingSession] Clear error:', error);
    }
  }

  /**
   * Генерация fingerprint для PP
   */
  _generateFingerprint(pp) {
    if (!pp) return '';
    // Простой хэш для идентификации (не для безопасности)
    let hash = 0;
    for (let i = 0; i < pp.length; i++) {
      const char = pp.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'fp_' + Math.abs(hash).toString(16);
  }

  /**
   * Получение времени до истечения сессии (в секундах)
   */
  getSessionTTL() {
    const billing = stateStore.getSlice('billing');
    if (!billing.authenticated || !billing.sessionExpiresAt) {
      return 0;
    }
    const ttl = billing.sessionExpiresAt - Date.now();
    return Math.max(0, Math.round(ttl / 1000));
  }
}

// Singleton
export const billingSessionService = new BillingSessionService();
export default billingSessionService;
