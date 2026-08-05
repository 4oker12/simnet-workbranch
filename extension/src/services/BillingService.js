/**
 * BillingService - Сервис для синхронизации с биллингом
 * Инкапсулирует всю логику работы с PP, сессиями и мостом между вкладками
 */

import { eventBus, EVENT_TYPES } from '../events/EventBus.js';
import { stateStore } from '../store/StateStore.js';

const LOG_PREFIX = '[BillingService]';

// Конфигурация провайдеров биллинга
const BILLING_PROVIDERS = Object.freeze({
  SIMNET: {
    id: 'simnet',
    hostname: 'billing.simnet.kiev.ua',
    base: 'https://billing.simnet.kiev.ua',
    ppKey: 'dp_billing_pp_v1',
    ppMetaKey: 'dp_billing_pp_meta_v1',
    ppCandidateKey: 'dp_billing_pp_candidate_v1',
    bridgePresenceKey: 'dp_billing_bridge_presence_simnet_v1',
    cookieTopLevelSite: 'simnet.kiev.ua',
    maxPpAgeMs: 8 * 60 * 60 * 1000, // 8 часов
  },
  LOOKNET: {
    id: 'looknet',
    hostname: 'lk.looknet.in.ua',
    base: 'https://lk.looknet.in.ua',
    ppKey: 'dp_billing_pp_looknet_v1',
    ppMetaKey: 'dp_billing_pp_meta_looknet_v1',
    ppCandidateKey: 'dp_billing_pp_candidate_looknet_v1',
    bridgePresenceKey: 'dp_billing_bridge_presence_looknet_v1',
    cookieTopLevelSite: 'looknet.in.ua',
    maxPpAgeMs: 8 * 60 * 60 * 1000,
  },
});

class BillingService {
  constructor() {
    this.currentProvider = null;
    this.currentProfile = null;
    this.ppRuntime = {
      lastKnown: '',
      lastSyncAt: 0,
      authenticated: false,
      fingerprint: '',
    };
    
    this.bridgeRuntime = {
      leader: false,
      tabId: this.generateTabId(),
      lastHeartbeatAt: 0,
      presenceTimer: 0,
    };
    
    this.setupEventListeners();
    console.log(`${LOG_PREFIX} Initialized`);
  }

  /**
   * Генерация уникального ID вкладки
   * @returns {string}
   */
  generateTabId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Настройка слушателей событий
   */
  setupEventListeners() {
    // Синхронизация при загрузке абонента
    eventBus.on(EVENT_TYPES.ON_ABON_LOADED, () => {
      this.syncBillingContext();
    });

    // Обработка обновления PP
    eventBus.on(EVENT_TYPES.ON_BILLING_PP_UPDATE, (event) => {
      this.handlePpUpdate(event.payload);
    });
  }

  /**
   * Установка провайдера биллинга
   * @param {string} providerId - ID провайдера ('simnet' | 'looknet')
   */
  setProvider(providerId) {
    const profile = BILLING_PROVIDERS[providerId.toUpperCase()];
    
    if (!profile) {
      console.warn(`${LOG_PREFIX} Unknown provider:`, providerId);
      return false;
    }

    this.currentProvider = profile.id;
    this.currentProfile = profile;
    
    stateStore.update('billing', {
      provider: profile.id,
      lastSyncAt: Date.now(),
    });

    console.log(`${LOG_PREFIX} Provider set:`, profile.id);
    return true;
  }

  /**
   * Авто-определение провайдера по хосту
   * @param {string} hostname - текущий хост
   * @returns {string|null} определенный провайдер
   */
  detectProviderByHostname(hostname) {
    for (const [key, profile] of Object.entries(BILLING_PROVIDERS)) {
      if (hostname === profile.hostname || hostname.includes(profile.cookieTopLevelSite)) {
        return profile.id;
      }
    }
    return null;
  }

  /**
   * Синхронизация контекста биллинга
   */
  syncBillingContext() {
    const abonData = stateStore.getSlice('abon');
    
    if (!abonData?.id) {
      console.warn(`${LOG_PREFIX} No abon data for billing sync`);
      return;
    }

    // Проверяем наличие PP
    const pp = this.getCachedPp();
    
    if (pp) {
      stateStore.update('billing', {
        authenticated: true,
        pp,
        lastSyncAt: Date.now(),
      });
      
      eventBus.emit(EVENT_TYPES.ON_BILLING_AUTH, {
        authenticated: true,
        provider: this.currentProvider,
        timestamp: Date.now(),
      });
    } else {
      // PP не найден, пробуем найти на странице
      this.scanPageForPp();
    }
  }

  /**
   * Получение кэшированного PP из storage
   * @returns {string|null}
   */
  getCachedPp() {
    if (!this.currentProfile) return null;

    try {
      // В реальной реализации здесь будет chrome.storage.local.get
      const stored = localStorage.getItem(this.currentProfile.ppKey);
      
      if (!stored) return null;

      const metaKey = this.currentProfile.ppMetaKey;
      const meta = JSON.parse(localStorage.getItem(metaKey) || '{}');
      
      // Проверка актуальности
      const age = Date.now() - (meta.savedAt || 0);
      
      if (age > this.currentProfile.maxPpAgeMs) {
        console.log(`${LOG_PREFIX} PP expired, age:`, age);
        return null;
      }

      return meta.value || stored;
    } catch (error) {
      console.error(`${LOG_PREFIX} Error reading cached PP:`, error);
      return null;
    }
  }

  /**
   * Сканирование страницы на наличие PP
   * @returns {string|null} найденный PP
   */
  scanPageForPp() {
    try {
      // Поиск скрытого input с name="pp"
      const hiddenPp = document.querySelector('input[type="hidden"][name="pp"]');
      
      if (hiddenPp && hiddenPp.value) {
        const pp = String(hiddenPp.value).trim();
        
        if (pp.length >= 8) {
          console.log(`${LOG_PREFIX} Found PP on page:`, pp.substring(0, 4) + '...');
          
          this.savePp(pp, 'page-scan');
          return pp;
        }
      }

      // Поиск в URL параметрах
      const urlParams = new URLSearchParams(window.location.search);
      const ppFromUrl = urlParams.get('pp');
      
      if (ppFromUrl && ppFromUrl.length >= 8) {
        console.log(`${LOG_PREFIX} Found PP in URL:`, ppFromUrl.substring(0, 4) + '...');
        
        this.savePp(ppFromUrl, 'url-param');
        return ppFromUrl;
      }

      return null;
    } catch (error) {
      console.error(`${LOG_PREFIX} Error scanning for PP:`, error);
      return null;
    }
  }

  /**
   * Сохранение PP
   * @param {string} pp - значение PP
   * @param {string} source - источник ('page-scan' | 'url-param' | 'bridge')
   */
  savePp(pp, source = 'unknown') {
    if (!this.currentProfile) {
      console.warn(`${LOG_PREFIX} No provider profile set`);
      return;
    }

    const savedAt = Date.now();
    const isLoginPage = this.isBillingLoginPage();

    try {
      const meta = {
        value: pp,
        savedAt,
        confirmedAt: isLoginPage ? 0 : savedAt,
        source,
        href: window.location.href,
      };

      // В реальной реализации: chrome.storage.local.set
      localStorage.setItem(this.currentProfile.ppKey, pp);
      localStorage.setItem(this.currentProfile.ppMetaKey, JSON.stringify(meta));

      // Очистка candidate если это подтвержденная сессия
      if (!isLoginPage) {
        localStorage.removeItem(this.currentProfile.ppCandidateKey);
      }

      this.ppRuntime.lastKnown = pp;
      this.ppRuntime.lastSyncAt = savedAt;

      stateStore.update('billing', {
        pp,
        lastSyncAt: savedAt,
        authenticated: !isLoginPage,
      });

      eventBus.emit(EVENT_TYPES.ON_BILLING_PP_UPDATE, {
        pp,
        source,
        authenticated: !isLoginPage,
        timestamp: savedAt,
      });

      console.log(`${LOG_PREFIX} PP saved:`, { 
        source, 
        authenticated: !isLoginPage,
        ppPrefix: pp.substring(0, 4) 
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Error saving PP:`, error);
    }
  }

  /**
   * Проверка: страница входа в биллинг
   * @returns {boolean}
   */
  isBillingLoginPage() {
    const passwords = document.querySelectorAll('input[type="password"]');
    
    for (const password of passwords) {
      const form = password.closest('form');
      
      if (!form) continue;

      const userField = form.querySelector([
        'input[type="email"]',
        'input[name*="login" i]',
        'input[name*="user" i]',
        'input[autocomplete="username"]',
      ].join(','));

      const formText = String(form.textContent || '').replace(/\s+/g, ' ').trim();
      
      if (userField || /(?:авторизац|login|логин|пользователь)/i.test(formText)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Обработка обновления PP
   * @param {Object} payload - данные обновления
   */
  handlePpUpdate(payload) {
    const { pp, source, authenticated } = payload;

    this.ppRuntime.lastKnown = pp;
    this.ppRuntime.authenticated = authenticated;

    // Генерация fingerprint
    this.ppRuntime.fingerprint = this.generatePpFingerprint(pp);

    console.log(`${LOG_PREFIX} PP updated:`, {
      source,
      authenticated,
      fingerprint: this.ppRuntime.fingerprint,
    });
  }

  /**
   * Генерация fingerprint для PP
   * @param {string} pp - PP значение
   * @returns {string} fingerprint
   */
  generatePpFingerprint(pp) {
    // Простая хэш-функция для идентификации сессии
    let hash = 0;
    for (let i = 0; i < pp.length; i++) {
      const char = pp.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Проверка валидности сессии биллинга
   * @returns {boolean}
   */
  isSessionValid() {
    const billing = stateStore.getSlice('billing');
    
    if (!billing.authenticated || !billing.pp) {
      return false;
    }

    const age = Date.now() - (billing.lastSyncAt || 0);
    
    if (age > this.currentProfile?.maxPpAgeMs || age > 8 * 60 * 60 * 1000) {
      console.log(`${LOG_PREFIX} Session expired by age`);
      return false;
    }

    return true;
  }

  /**
   * Запрос данных из биллинга (через мост или напрямую)
   * @param {string} endpoint - API endpoint
   * @param {Object} params - параметры запроса
   * @returns {Promise<Object>} ответ от биллинга
   */
  async fetchFromBilling(endpoint, params = {}) {
    if (!this.isSessionValid()) {
      throw new Error('Billing session not authenticated');
    }

    const billing = stateStore.getSlice('billing');
    const baseUrl = this.currentProfile?.base || BILLING_PROVIDERS.SIMNET.base;
    const url = `${baseUrl}${endpoint}`;

    console.log(`${LOG_PREFIX} Fetching from billing:`, url);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          // В реальной реализации добавить куки/авторизацию
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Billing API error: ${response.status}`);
      }

      const data = await response.json();
      
      return data;
    } catch (error) {
      console.error(`${LOG_PREFIX} Billing fetch error:`, error);
      
      eventBus.emit(EVENT_TYPES.ON_BILLING_SESSION_EXPIRE, {
        timestamp: Date.now(),
        reason: error.message,
      });
      
      throw error;
    }
  }

  /**
   * Получение данных абонента из биллинга
   * @param {string} abonId - ID абонента
   * @returns {Promise<Object>}
   */
  async getAbonData(abonId) {
    return this.fetchFromBilling(`/api/abonents/${abonId}`);
  }

  /**
   * Получение услуг абонента
   * @param {string} abonId - ID абонента
   * @returns {Promise<Object>}
   */
  async getAbonServices(abonId) {
    return this.fetchFromBilling(`/api/abonents/${abonId}/services`);
  }

  /**
   * Получение платежей абонента
   * @param {string} abonId - ID абонента
   * @returns {Promise<Object>}
   */
  async getAbonPayments(abonId) {
    return this.fetchFromBilling(`/api/abonents/${abonId}/payments`);
  }

  /**
   * Старт лидера моста между вкладками
   */
  startBridgeLeader() {
    if (this.bridgeRuntime.leader) {
      console.log(`${LOG_PREFIX} Already bridge leader`);
      return;
    }

    this.bridgeRuntime.leader = true;
    this.bridgeRuntime.lastHeartbeatAt = Date.now();

    // Периодическая отправка heartbeat
    this.bridgeRuntime.presenceTimer = setInterval(() => {
      this.sendBridgeHeartbeat();
    }, 60 * 1000); // Каждую минуту

    console.log(`${LOG_PREFIX} Started as bridge leader`);
  }

  /**
   * Отправка heartbeat присутствия лидера
   */
  sendBridgeHeartbeat() {
    if (!this.bridgeRuntime.leader) return;

    try {
      const presence = {
        leader: true,
        tabId: this.bridgeRuntime.tabId,
        provider: this.currentProvider,
        timestamp: Date.now(),
      };

      // В реальной реализации: chrome.storage.local.set
      localStorage.setItem(
        this.currentProfile?.bridgePresenceKey || 'dp_billing_bridge_presence_v1',
        JSON.stringify(presence)
      );

      this.bridgeRuntime.lastHeartbeatAt = Date.now();
    } catch (error) {
      console.error(`${LOG_PREFIX} Heartbeat error:`, error);
    }
  }

  /**
   * Остановка лидера моста
   */
  stopBridgeLeader() {
    if (!this.bridgeRuntime.leader) return;

    this.bridgeRuntime.leader = false;

    if (this.bridgeRuntime.presenceTimer) {
      clearInterval(this.bridgeRuntime.presenceTimer);
      this.bridgeRuntime.presenceTimer = 0;
    }

    // Очистка присутствия
    try {
      localStorage.removeItem(
        this.currentProfile?.bridgePresenceKey || 'dp_billing_bridge_presence_v1'
      );
    } catch (_) {}

    console.log(`${LOG_PREFIX} Stopped as bridge leader`);
  }

  /**
   * Сброс состояния
   */
  reset() {
    this.stopBridgeLeader();
    
    this.currentProvider = null;
    this.currentProfile = null;
    
    this.ppRuntime = {
      lastKnown: '',
      lastSyncAt: 0,
      authenticated: false,
      fingerprint: '',
    };

    stateStore.update('billing', {
      authenticated: false,
      pp: '',
      lastSyncAt: null,
    });

    console.log(`${LOG_PREFIX} Reset complete`);
  }
}

// Экспорт единственного экземпляра (Singleton)
export const billingService = new BillingService();

export default billingService;
