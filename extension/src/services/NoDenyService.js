/**
 * NoDenyService - Сервис для работы с DOM системы NoDeny
 * Инкапсулирует все операции чтения/записи в DOM
 * Не содержит бизнес-логики, только парсинг и манипуляции
 */

import { eventBus, EVENT_TYPES } from '../events/EventBus.js';
import { stateStore } from '../store/StateStore.js';

const LOG_PREFIX = '[NoDenyService]';

/**
 * Селекторы для извлечения данных абонента из NoDeny
 * Могут быть расширены для поддержки разных версий NoDeny
 */
const SELECTORS = Object.freeze({
  // Основные поля абонента
  ABON_CARD: '.abon-card, .client-card, [data-abon-id]',
  ABON_ID: '[data-abon-id], .abon-id, #abon_id',
  ABON_NAME: '.abon-name, .client-name, h1.abon-title',
  ABON_ADDRESS: '.abon-address, .client-address, .address-field',
  ABON_PHONE: '.abon-phone, .client-phone, .phone-field, a[href^="tel:"]',
  ABON_CONTRACT: '.abon-contract, .contract-number, [name="contract"]',
  
  // Сетевые параметры
  ABON_IP: '.abon-ip, .ip-address, .ip-field',
  ABON_MAC: '.abon-mac, .mac-address, .mac-field',
  
  // Статусы и индикаторы
  STATUS_INDICATOR: '.status-indicator, .onoff-status, .connection-status',
  SIGNAL_LEVEL: '.signal-level, .rx-power, .optical-signal',
  
  // Навигация и контекст
  ACTIVE_TAB: '.nav-tabs .active, .tab-menu li.active',
  BILLING_LINK: 'a[href*="billing"], .billing-link, .billing-tab',
});

/**
 * Парсинг текста с очисткой от лишних пробелов и символов
 * @param {string} text - исходный текст
 * @returns {string} очищенный текст
 */
function cleanText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Извлечение текста из элемента по селектору
 * @param {Element|string} context - контекст поиска (document или элемент)
 * @param {string} selector - CSS селектор
 * @returns {string|null} найденный текст или null
 */
function extractText(context, selector) {
  const element = typeof context === 'string' 
    ? document.querySelector(context)
    : context?.querySelector?.(selector) || document.querySelector(selector);
  
  if (!element) return null;
  
  // Для input/textarea берем value, иначе textContent
  const value = element.value !== undefined ? element.value : element.textContent;
  return cleanText(value);
}

/**
 * Извлечение атрибута из элемента
 * @param {Element|string} context - контекст поиска
 * @param {string} selector - CSS селектор
 * @param {string} attributeName - имя атрибута
 * @returns {string|null} значение атрибута или null
 */
function extractAttribute(context, selector, attributeName) {
  const element = typeof context === 'string'
    ? document.querySelector(selector)
    : context?.querySelector?.(selector) || document.querySelector(selector);
  
  if (!element) return null;
  return cleanText(element.getAttribute(attributeName));
}

/**
 * Извлечение data-атрибута
 * @param {Element|string} context - контекст поиска
 * @param {string} selector - CSS селектор
 * @param {string} dataName - имя data-атрибута (без префикса data-)
 * @returns {string|null} значение атрибута или null
 */
function extractDataAttribute(context, selector, dataName) {
  return extractAttribute(context, selector, `data-${dataName}`);
}

/**
 * Проверка видимости элемента
 * @param {Element} element - DOM элемент
 * @returns {boolean} виден ли элемент
 */
function isElementVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

class NoDenyService {
  constructor() {
    this.observers = new Map();
    this.mutationObserver = null;
    this.isWatching = false;
    this.lastKnownAbonId = null;
    
    console.log(`${LOG_PREFIX} Initialized`);
  }

  /**
   * Получение полного контекста абонента из текущей страницы
   * @returns {Object|null} объект с данными абонента или null
   */
  parseAbonContext() {
    try {
      const abonCard = document.querySelector(SELECTORS.ABON_CARD);
      
      // Если карточка абонента не найдена, возвращаем null
      if (!abonCard && !this.isOnAbonPage()) {
        return null;
      }

      const context = {
        id: extractDataAttribute(null, SELECTORS.ABON_ID, 'abon-id') || 
            extractText(null, SELECTORS.ABON_ID),
        name: extractText(abonCard || document, SELECTORS.ABON_NAME),
        address: extractText(abonCard || document, SELECTORS.ABON_ADDRESS),
        phone: extractText(abonCard || document, SELECTORS.ABON_PHONE),
        contractId: extractText(abonCard || document, SELECTORS.ABON_CONTRACT),
        ip: extractText(abonCard || document, SELECTORS.ABON_IP),
        mac: extractText(abonCard || document, SELECTORS.ABON_MAC),
        
        // Метаданные
        loadedAt: Date.now(),
        pageUrl: window.location.href,
        pageTitle: document.title,
      };

      // Валидация: хотя бы ID или имя должны быть найдены
      if (!context.id && !context.name) {
        console.warn(`${LOG_PREFIX} Failed to parse abon context: no ID or name found`);
        return null;
      }

      console.log(`${LOG_PREFIX} Parsed abon context:`, { 
        id: context.id, 
        name: context.name,
        hasIp: !!context.ip,
        hasMac: !!context.mac 
      });

      return context;
    } catch (error) {
      console.error(`${LOG_PREFIX} Error parsing abon context:`, error);
      return null;
    }
  }

  /**
   * Проверка: находимся ли мы на странице абонента
   * @returns {boolean}
   */
  isOnAbonPage() {
    // Проверяем URL или наличие специфичных элементов
    const urlPattern = /\/abon(ents?)?\/\d+|\/client(\/\d+)?|\/card\/\d+/i;
    return urlPattern.test(window.location.href) || 
           !!document.querySelector(SELECTORS.ABON_CARD);
  }

  /**
   * Проверка: сменился ли абонент относительно последнего известного
   * @returns {boolean} true если абонент сменился
   */
  hasAbonChanged() {
    const currentContext = this.parseAbonContext();
    
    if (!currentContext?.id) {
      // Если не можем определить текущего, считаем что сменился
      return this.lastKnownAbonId !== null;
    }
    
    const changed = currentContext.id !== this.lastKnownAbonId;
    
    if (changed) {
      console.log(`${LOG_PREFIX} Abon changed:`, {
        from: this.lastKnownAbonId,
        to: currentContext.id,
      });
    }
    
    return changed;
  }

  /**
   * Обновление последнего известного ID абонента
   * @param {string|null} abonId
   */
  updateLastKnownAbonId(abonId) {
    this.lastKnownAbonId = abonId;
  }

  /**
   * Синхронизация состояния абонента со Store
   * Вызывается при обнаружении изменений на странице
   */
  syncAbonState() {
    const context = this.parseAbonContext();
    
    if (!context) {
      // Если контекст не найден, возможно мы больше не на странице абонента
      if (this.lastKnownAbonId) {
        console.log(`${LOG_PREFIX} Abon context lost, unloading`);
        stateStore.unloadAbon();
        this.updateLastKnownAbonId(null);
        eventBus.emit(EVENT_TYPES.ON_ABON_UNLOADED, { timestamp: Date.now() });
      }
      return;
    }

    // Проверяем, сменился ли абонент
    if (context.id !== this.lastKnownAbonId) {
      console.log(`${LOG_PREFIX} New abon detected:`, context.id);
      
      // Загружаем нового абонента в Store
      stateStore.loadAbon(context);
      this.updateLastKnownAbonId(context.id);
      
      // Событие уже испущено в loadAbon, но можно добавить доп. данные
      eventBus.emit(EVENT_TYPES.ON_ABON_LOADED, {
        abonId: context.id,
        fullContext: context,
        timestamp: Date.now(),
      });
    } else {
      // Абонент тот же, но могли измениться другие поля (IP, MAC, статус)
      // Обновляем только изменяемые поля
      const currentBilling = stateStore.getSlice('billing');
      
      // Проверяем изменения сетевых параметров
      const currentMetrics = stateStore.getSlice('metrics');
      if (context.ip !== currentMetrics.ip || context.mac !== currentMetrics.mac) {
        stateStore.updateMetrics({
          ip: context.ip,
          mac: context.mac,
        });
      }
    }
  }

  /**
   * Подсветка элемента в DOM (DOM Highlight)
   * @param {string|Element} target - селектор или DOM элемент
   * @param {Object} options - опции подсветки
   */
  highlightElement(target, options = {}) {
    const {
      duration = 2000,
      color = '#ffeb3b',
      borderColor = '#f44336',
      borderWidth = 3,
      scrollIntoView = true,
    } = options;

    let element;
    if (typeof target === 'string') {
      element = document.querySelector(target);
    } else {
      element = target;
    }

    if (!element) {
      console.warn(`${LOG_PREFIX} Element not found for highlight:`, target);
      return false;
    }

    // Сохраняем оригинальные стили
    const originalStyles = {
      backgroundColor: element.style.backgroundColor,
      borderColor: element.style.borderColor,
      borderWidth: element.style.borderWidth,
      borderStyle: element.style.borderStyle,
      transition: element.style.transition,
    };

    // Применяем подсветку
    element.style.transition = 'all 0.3s ease';
    element.style.backgroundColor = color;
    element.style.borderColor = borderColor;
    element.style.borderWidth = `${borderWidth}px`;
    element.style.borderStyle = 'solid';

    // Прокрутка к элементу
    if (scrollIntoView) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Возвращаем стили через указанное время
    setTimeout(() => {
      element.style.backgroundColor = originalStyles.backgroundColor;
      element.style.borderColor = originalStyles.borderColor;
      element.style.borderWidth = originalStyles.borderWidth;
      element.style.borderStyle = originalStyles.borderStyle;
    }, duration);

    console.log(`${LOG_PREFIX} Highlighted element:`, target);
    return true;
  }

  /**
   * Фокус на элементе (скролл + подсветка)
   * @param {string} elementId - ID элемента в NoDeny
   * @returns {boolean} успех операции
   */
  focusOnElement(elementId) {
    const selector = `#${elementId}, [data-id="${elementId}"], [name="${elementId}"]`;
    const element = document.querySelector(selector);
    
    if (!element) {
      console.warn(`${LOG_PREFIX} Element not found for focus:`, elementId);
      return false;
    }

    this.highlightElement(element, {
      duration: 3000,
      color: '#fff9c4',
      borderColor: '#ff5722',
      borderWidth: 4,
    });

    return true;
  }

  /**
   * Извлечение статуса подключения абонента
   * @returns {Object|null} объект со статусом
   */
  parseConnectionStatus() {
    const statusElement = document.querySelector(SELECTORS.STATUS_INDICATOR);
    
    if (!statusElement) return null;

    const statusText = cleanText(statusElement.textContent);
    const statusClass = statusElement.className || '';
    
    // Определение статуса по классам или тексту
    let status = 'unknown';
    let isOnline = false;

    if (statusClass.includes('online') || statusText.toLowerCase().includes('online')) {
      status = 'online';
      isOnline = true;
    } else if (statusClass.includes('offline') || statusText.toLowerCase().includes('offline')) {
      status = 'offline';
      isOnline = false;
    } else if (statusClass.includes('active') || statusText.toLowerCase().includes('active')) {
      status = 'active';
      isOnline = true;
    } else if (statusClass.includes('inactive') || statusText.toLowerCase().includes('inactive')) {
      status = 'inactive';
      isOnline = false;
    }

    return {
      status,
      isOnline,
      rawText: statusText,
      elementClass: statusClass,
    };
  }

  /**
   * Извлечение уровня сигнала (оптика)
   * @returns {number|null} уровень сигнала в dBm или null
   */
  parseSignalLevel() {
    const signalElement = document.querySelector(SELECTORS.SIGNAL_LEVEL);
    
    if (!signalElement) return null;

    const signalText = cleanText(signalElement.textContent);
    
    // Парсинг числового значения (например, "-23.5 dBm")
    const match = signalText.match(/(-?\d+\.?\d*)\s*(dBm)?/i);
    
    if (!match) return null;

    const value = parseFloat(match[1]);
    
    if (isNaN(value)) return null;

    return {
      value,
      unit: match[2] || 'dBm',
      rawText: signalText,
      quality: this.assessSignalQuality(value),
    };
  }

  /**
   * Оценка качества сигнала по значению
   * @param {number} value - уровень сигнала в dBm
   * @returns {string} оценка качества
   */
  assessSignalQuality(value) {
    if (value >= -8) return 'excellent';
    if (value >= -15) return 'good';
    if (value >= -20) return 'acceptable';
    if (value >= -25) return 'weak';
    return 'critical';
  }

  /**
   * Запуск наблюдения за изменениями DOM (MutationObserver)
   * Автоматически детектирует смену абонента и обновления статусов
   */
  startWatching() {
    if (this.isWatching) {
      console.log(`${LOG_PREFIX} Already watching`);
      return;
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      // Дебаунс: не реагировать на слишком частые изменения
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.handleMutations(mutations);
      }, 500);
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-abon-id', 'data-status'],
    });

    this.isWatching = true;
    console.log(`${LOG_PREFIX} Started watching DOM mutations`);

    // Первоначальная синхронизация
    this.syncAbonState();
  }

  /**
   * Обработчик мутаций DOM
   * @param {MutationRecord[]} mutations
   */
  handleMutations(mutations) {
    let shouldSync = false;
    let relevantMutations = [];

    mutations.forEach(mutation => {
      // Проверяем, относятся ли изменения к карточке абонента
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches?.(SELECTORS.ABON_CARD) || 
                node.querySelector?.(SELECTORS.ABON_CARD)) {
              relevantMutations.push({ type: 'abon-card-added', node });
              shouldSync = true;
            }
          }
        });

        mutation.removedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches?.(SELECTORS.ABON_CARD)) {
              relevantMutations.push({ type: 'abon-card-removed', node });
              shouldSync = true;
            }
          }
        });
      } else if (mutation.type === 'attributes') {
        // Изменение атрибутов статуса или ID
        if (['data-abon-id', 'data-status', 'class'].includes(mutation.attributeName)) {
          relevantMutations.push({ 
            type: 'attribute-change', 
            target: mutation.target,
            attributeName: mutation.attributeName 
          });
          shouldSync = true;
        }
      }
    });

    if (shouldSync) {
      console.log(`${LOG_PREFIX} Relevant DOM mutations detected:`, relevantMutations);
      this.syncAbonState();
    }
  }

  /**
   * Остановка наблюдения за DOM
   */
  stopWatching() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.isWatching = false;
    console.log(`${LOG_PREFIX} Stopped watching DOM mutations`);
  }

  /**
   * Получение ссылки на Billing для текущего абонента
   * @returns {string|null} URL биллинга или null
   */
  getBillingLink() {
    const billingLink = document.querySelector(SELECTORS.BILLING_LINK);
    
    if (!billingLink) return null;
    
    return billingLink.href || billingLink.getAttribute('data-href') || null;
  }

  /**
   * Клик по элементу (эмуляция пользовательского действия)
   * @param {string} selector - CSS селектор элемента
   * @returns {boolean} успех операции
   */
  clickElement(selector) {
    const element = document.querySelector(selector);
    
    if (!element) {
      console.warn(`${LOG_PREFIX} Element not found for click:`, selector);
      return false;
    }

    // Эмуляция реального клика пользователя
    element.click();
    
    console.log(`${LOG_PREFIX} Clicked element:`, selector);
    return true;
  }
}

// Экспорт единственного экземпляра (Singleton)
export const noDenyService = new NoDenyService();

export default noDenyService;
