/**
 * UIRendererService - Сервис для рендеринга UI компонентов
 * Инкапсулирует всю логику отрисовки интерфейса на основе State Store
 * 
 * Поток данных:
 * StateStore -> [подписка на изменения] -> UIRendererService -> DOM
 */

import { eventBus, EVENT_TYPES } from '../events/EventBus.js';
import { stateStore } from '../store/StateStore.js';

const LOG_PREFIX = '[UIRenderer]';

class UIRendererService {
  constructor() {
    this.containerElement = null;
    this.isInitialized = false;
    this.unsubscribeFromStore = null;
    
    // Кэш элементов для быстрого доступа
    this.elementCache = new Map();
    
    console.log(`${LOG_PREFIX} Initialized`);
  }

  /**
   * Инициализация рендерера
   * @param {string|Element} container - селектор или DOM элемент контейнера
   */
  init(container) {
    if (this.isInitialized) {
      console.warn(`${LOG_PREFIX} Already initialized`);
      return;
    }

    this.containerElement = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;

    if (!this.containerElement) {
      console.error(`${LOG_PREFIX} Container not found:`, container);
      return;
    }

    // Подписываемся на изменения Store
    this.unsubscribeFromStore = stateStore.subscribe((change) => {
      this.handleStateChange(change);
    });

    // Подписываемся на специфичные события
    this.setupEventListeners();

    // Первоначальный рендер
    this.render();

    this.isInitialized = true;
    console.log(`${LOG_PREFIX} Initialized with container:`, this.containerElement);
  }

  /**
   * Настройка слушателей событий
   */
  setupEventListeners() {
    // Событие загрузки абонента
    eventBus.on(EVENT_TYPES.ON_ABON_LOADED, () => {
      this.renderAbonCard();
    });

    // Событие выгрузки абонента
    eventBus.on(EVENT_TYPES.ON_ABON_UNLOADED, () => {
      this.clearAbonCard();
    });

    // Изменение состояния сессии биллинга
    eventBus.on(EVENT_TYPES.ON_BILLING_SESSION_CONFIRMED, (event) => {
      this.updateSessionStatus(event.payload);
    });

    eventBus.on(EVENT_TYPES.ON_BILLING_SESSION_LOST, () => {
      this.updateSessionStatus({ authenticated: false });
    });

    // Изменение шага Наставника
    eventBus.on(EVENT_TYPES.ON_STEP_CHANGE, (event) => {
      this.renderMentorStep(event.payload);
    });

    // Обновление метрик
    eventBus.on(EVENT_TYPES.ON_SIGNAL_UPDATE, (event) => {
      this.updateMetricsChips(event.payload.metrics);
    });
  }

  /**
   * Обработчик изменений в Store
   * @param {Object} change - объект изменения { section, oldState, newState }
   */
  handleStateChange(change) {
    const { section, newState } = change;

    switch (section) {
      case 'abon':
        this.renderAbonInfo(newState);
        break;
      case 'billing':
        this.renderBillingStatus(newState);
        break;
      case 'currentCase':
        this.renderCaseStatus(newState);
        break;
      case 'mentor':
        this.renderMentorPanel(newState);
        break;
      case 'metrics':
        this.renderMetrics(newState);
        break;
      case 'ui':
        this.applyUiSettings(newState);
        break;
      default:
        // Игнорируем неизвестные секции
        break;
    }
  }

  /**
   * Главный метод рендера (вызывается при инициализации)
   */
  render() {
    const state = stateStore.getState();
    
    this.renderAbonInfo(state.abon);
    this.renderBillingStatus(state.billing);
    this.renderCaseStatus(state.currentCase);
    this.renderMentorPanel(state.mentor);
    this.renderMetrics(state.metrics);
    this.applyUiSettings(state.ui);
  }

  /**
   * Рендер карточки абонента
   */
  renderAbonCard() {
    const abon = stateStore.getSlice('abon');
    this.renderAbonInfo(abon);
  }

  /**
   * Отрисовка информации об абоненте
   * @param {Object} abonData - данные абонента
   */
  renderAbonInfo(abonData) {
    const elements = {
      name: this.getElement('.simnet-abon-name'),
      address: this.getElement('.simnet-abon-address'),
      phone: this.getElement('.simnet-abon-phone'),
      ip: this.getElement('.simnet-abon-ip'),
      mac: this.getElement('.simnet-abon-mac'),
      contractId: this.getElement('.simnet-abon-contract'),
    };

    if (elements.name) elements.name.textContent = abonData.name || '—';
    if (elements.address) elements.address.textContent = abonData.address || '—';
    if (elements.phone) elements.phone.textContent = abonData.phone || '—';
    if (elements.ip) elements.ip.textContent = abonData.ip || '—';
    if (elements.mac) elements.mac.textContent = abonData.mac || '—';
    if (elements.contractId) elements.contractId.textContent = abonData.contractId || '—';
  }

  /**
   * Очистка карточки абонента
   */
  clearAbonCard() {
    const emptyState = {
      name: '',
      address: '',
      phone: '',
      ip: '',
      mac: '',
      contractId: '',
    };
    this.renderAbonInfo(emptyState);
  }

  /**
   * Рендер статуса биллинга
   * @param {Object} billingData - данные биллинга
   */
  renderBillingStatus(billingData) {
    const statusElement = this.getElement('.simnet-billing-status');
    const sessionIndicator = this.getElement('.simnet-session-indicator');
    
    if (!statusElement) return;

    if (billingData.authenticated && billingData.sessionExpiresAt) {
      const now = Date.now();
      const ttl = billingData.sessionExpiresAt - now;
      const ttlMinutes = Math.round(ttl / 60000);
      
      statusElement.textContent = `Сессия активна (${billingData.provider})`;
      statusElement.className = 'simnet-billing-status simnet-billing-status--active';
      
      if (sessionIndicator) {
        sessionIndicator.style.display = 'inline-block';
        sessionIndicator.title = `Осталось ${ttlMinutes} мин.`;
        
        // Цвет индикатора в зависимости от TTL
        if (ttl < 300000) { // < 5 минут
          sessionIndicator.style.backgroundColor = '#f44336'; // красный
        } else if (ttl < 600000) { // < 10 минут
          sessionIndicator.style.backgroundColor = '#ff9800'; // оранжевый
        } else {
          sessionIndicator.style.backgroundColor = '#4caf50'; // зеленый
        }
      }
    } else {
      statusElement.textContent = 'Сессия не подтверждена';
      statusElement.className = 'simnet-billing-status simnet-billing-status--inactive';
      
      if (sessionIndicator) {
        sessionIndicator.style.display = 'none';
      }
    }
  }

  /**
   * Обновление статуса сессии (для событий)
   * @param {Object} payload - данные события
   */
  updateSessionStatus(payload) {
    const billingData = stateStore.getSlice('billing');
    this.renderBillingStatus(billingData);
  }

  /**
   * Рендер статуса кейса диагностики
   * @param {Object} caseData - данные кейса
   */
  renderCaseStatus(caseData) {
    const statusElement = this.getElement('.simnet-case-status');
    if (!statusElement) return;

    const statusMap = {
      idle: 'Ожидание',
      running: 'Диагностика...',
      paused: 'На паузе',
      completed: 'Завершено',
      error: 'Ошибка',
    };

    statusElement.textContent = statusMap[caseData.status] || caseData.status;
    statusElement.className = `simnet-case-status simnet-case-status--${caseData.status}`;
  }

  /**
   * Рендер панели Наставника
   * @param {Object} mentorData - данные Наставника
   */
  renderMentorPanel(mentorData) {
    const stepElement = this.getElement('.simnet-mentor-step');
    const progressElement = this.getElement('.simnet-mentor-progress');
    const hintsContainer = this.getElement('.simnet-mentor-hints');

    if (stepElement) {
      stepElement.textContent = mentorData.currentStep 
        ? `Шаг ${mentorData.currentStep}` 
        : 'Наставник не активен';
    }

    if (progressElement && mentorData.totalSteps > 0) {
      const percent = Math.round((mentorData.completedSteps / mentorData.totalSteps) * 100);
      progressElement.style.width = `${percent}%`;
      progressElement.title = `${mentorData.completedSteps}/${mentorData.totalSteps} (${percent}%)`;
    }

    if (hintsContainer) {
      hintsContainer.innerHTML = '';
      mentorData.hints?.forEach(hint => {
        const hintEl = document.createElement('div');
        hintEl.className = 'simnet-mentor-hint';
        hintEl.textContent = hint;
        hintsContainer.appendChild(hintEl);
      });
    }
  }

  /**
   * Рендер текущего шага Наставника
   * @param {Object} payload - данные события
   */
  renderMentorStep(payload) {
    this.renderMentorPanel(stateStore.getSlice('mentor'));
  }

  /**
   * Рендер метрик
   * @param {Object} metricsData - данные метрик
   */
  renderMetrics(metricsData) {
    this.renderMetricsChips(metricsData);
  }

  /**
   * Обновление чипсов метрик
   * @param {Object} metrics - метрики
   */
  updateMetricsChips(metrics) {
    const signalChip = this.getElement('.simnet-metric-signal');
    const onuChip = this.getElement('.simnet-metric-onu');
    const portChip = this.getElement('.simnet-metric-port');

    if (signalChip && metrics.signalLevel !== null) {
      const quality = this.assessSignalQuality(metrics.signalLevel.value);
      signalChip.textContent = `${metrics.signalLevel.value} dBm`;
      signalChip.className = `simnet-metric-chip simnet-metric-chip--${quality}`;
    }

    if (onuChip && metrics.onuStatus) {
      onuChip.textContent = metrics.onuStatus;
      onuChip.className = `simnet-metric-chip simnet-metric-chip--${metrics.onuStatus.toLowerCase()}`;
    }

    if (portChip && metrics.portStatus) {
      portChip.textContent = metrics.portStatus;
    }
  }

  /**
   * Оценка качества сигнала
   * @param {number} value - уровень сигнала
   * @returns {string} оценка
   */
  assessSignalQuality(value) {
    if (value >= -8) return 'excellent';
    if (value >= -15) return 'good';
    if (value >= -20) return 'acceptable';
    if (value >= -25) return 'weak';
    return 'critical';
  }

  /**
   * Применение настроек UI
   * @param {Object} uiData - данные UI
   */
  applyUiSettings(uiData) {
    const container = this.containerElement;
    if (!container) return;

    // Dock режим
    container.classList.toggle('simnet-docked', uiData.docked);
    container.classList.toggle('simnet-expanded', uiData.expanded);
    container.classList.toggle('simnet-visible', uiData.visible);

    // Позиция
    if (uiData.side) {
      container.dataset.side = uiData.side;
    }

    // Ширина
    if (uiData.width) {
      container.style.width = `${uiData.width}px`;
    }

    // Активная вкладка
    const tabs = container.querySelectorAll('.simnet-tab');
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === uiData.activeTab);
    });
  }

  /**
   * Получение элемента из кэша или DOM
   * @param {string} selector - CSS селектор
   * @returns {Element|null}
   */
  getElement(selector) {
    if (this.elementCache.has(selector)) {
      return this.elementCache.get(selector);
    }

    const element = this.containerElement?.querySelector(selector);
    if (element) {
      this.elementCache.set(selector, element);
    }
    return element;
  }

  /**
   * Очистка кэша элементов (при изменении структуры DOM)
   */
  clearCache() {
    this.elementCache.clear();
  }

  /**
   * Принудительная перерисовка всего UI
   */
  forceRerender() {
    this.clearCache();
    this.render();
  }

  /**
   * Очистка и уничтожение
   */
  destroy() {
    if (this.unsubscribeFromStore) {
      this.unsubscribeFromStore();
      this.unsubscribeFromStore = null;
    }

    this.elementCache.clear();
    this.isInitialized = false;
    this.containerElement = null;

    console.log(`${LOG_PREFIX} Destroyed`);
  }
}

// Singleton
export const uiRendererService = new UIRendererService();
export default uiRendererService;
