/**
 * DiagnosticEngine - Чистая бизнес-логика диагностики
 * Не знает про DOM, UI или HTML. Работает только с данными.
 */

import { eventBus, EVENT_TYPES } from '../events/EventBus.js';
import { stateStore } from '../store/StateStore.js';

const LOG_PREFIX = '[DiagnosticEngine]';

// Правила переключения шагов Наставника
const MENTOR_RULES = Object.freeze({
  // Минимальное время на шаг (мс)
  MIN_STEP_TIME_MS: 2000,
  
  // Максимальное количество попыток на шаг
  MAX_ATTEMPTS_PER_STEP: 3,
  
  // Пороги для автоматических переходов
  AUTO_ADVANCE_THRESHOLDS: {
    signalLevel: -25, // Если сигнал хуже -25 dBm, переходим к проверке питания
    packetLoss: 30,   // Если потери >30%, проверяем кабель
    latency: 100,     // Если пинг >100ms, ищем узкие места
  },
});

// Сценарии диагностики
const DIAGNOSTIC_SCENARIOS = Object.freeze({
  NO_CONNECTION: 'no_connection',
  SLOW_CONNECTION: 'slow_connection',
  INTERMITTENT: 'intermittent',
  PACKET_LOSS: 'packet_loss',
  HIGH_LATENCY: 'high_latency',
  OPTICAL_ISSUE: 'optical_issue',
  EQUIPMENT_OFFLINE: 'equipment_offline',
});

// Статусы диагностики
const DIAGNOSTIC_STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error',
});

class DiagnosticEngine {
  constructor() {
    this.currentScenario = null;
    this.stepIndex = 0;
    this.attemptCount = 0;
    this.lastStepTime = 0;
    this.diagnosticHistory = [];
    
    // Подписка на события
    this.setupEventListeners();
    
    console.log(`${LOG_PREFIX} Initialized`);
  }

  /**
   * Настройка слушателей событий
   */
  setupEventListeners() {
    // Запуск диагностики по событию
    eventBus.on(EVENT_TYPES.ON_DIAGNOSTIC_START, (event) => {
      this.startDiagnostic(event.payload.scenario, event.payload.context);
    });

    // Обновление метрик может триггерить авто-переход шагов
    eventBus.on(EVENT_TYPES.ON_SIGNAL_UPDATE, (event) => {
      this.handleMetricsUpdate(event.payload.metrics);
    });

    // Смена абонента сбрасывает диагностику
    eventBus.on(EVENT_TYPES.ON_ABON_UNLOADED, () => {
      this.reset();
    });
  }

  /**
   * Запуск диагностики
   * @param {string} scenario - сценарий диагностики
   * @param {Object} context - контекст (данные абонента, метрики)
   */
  startDiagnostic(scenario, context = {}) {
    if (this.isRunning()) {
      console.warn(`${LOG_PREFIX} Diagnostic already running`);
      return;
    }

    console.log(`${LOG_PREFIX} Starting diagnostic:`, { scenario, context });

    this.currentScenario = scenario || this.detectScenario(context);
    this.stepIndex = 0;
    this.attemptCount = 0;
    this.lastStepTime = Date.now();

    const steps = this.getStepsForScenario(this.currentScenario);

    stateStore.setDiagnosticStatus(DIAGNOSTIC_STATUS.RUNNING, {
      id: `diag_${Date.now()}`,
      type: this.currentScenario,
      startedAt: Date.now(),
      steps,
      currentStepIndex: 0,
    });

    eventBus.emit(EVENT_TYPES.ON_MENTOR_INIT, {
      scenario: this.currentScenario,
      totalSteps: steps.length,
      timestamp: Date.now(),
    });

    // Выполняем первый шаг
    this.executeCurrentStep(steps[0], context);
  }

  /**
   * Авто-определение сценария по контексту
   * @param {Object} context - данные абонента и метрики
   * @returns {string} определенный сценарий
   */
  detectScenario(context) {
    const { metrics = {}, abon = {} } = context;
    
    // Проверка оптики
    if (metrics.signalLevel && metrics.signalLevel.value < -25) {
      return DIAGNOSTIC_SCENARIOS.OPTICAL_ISSUE;
    }

    // Проверка статуса оборудования
    if (!metrics.isOnuOnline || abon.status === 'offline') {
      return DIAGNOSTIC_SCENARIOS.EQUIPMENT_OFFLINE;
    }

    // Проверка потерь пакетов
    if (metrics.packetLoss && metrics.packetLoss > MENTOR_RULES.AUTO_ADVANCE_THRESHOLDS.packetLoss) {
      return DIAGNOSTIC_SCENARIOS.PACKET_LOSS;
    }

    // Проверка задержки
    if (metrics.latency && metrics.latency > MENTOR_RULES.AUTO_ADVANCE_THRESHOLDS.latency) {
      return DIAGNOSTIC_SCENARIOS.HIGH_LATENCY;
    }

    // По умолчанию - медленное соединение
    return DIAGNOSTIC_SCENARIOS.SLOW_CONNECTION;
  }

  /**
   * Получение шагов для сценария
   * @param {string} scenario - сценарий
   * @returns {Array} массив шагов
   */
  getStepsForScenario(scenario) {
    const scenarios = {
      [DIAGNOSTIC_SCENARIOS.NO_CONNECTION]: [
        { id: 1, name: 'Проверка питания ONU', action: 'check_power' },
        { id: 2, name: 'Проверка оптического сигнала', action: 'check_optics' },
        { id: 3, name: 'Проверка регистрации на OLT', action: 'check_registration' },
        { id: 4, name: 'Проверка конфигурации порта', action: 'check_port_config' },
        { id: 5, name: 'Тест кабеля Ethernet', action: 'check_ethernet' },
      ],
      [DIAGNOSTIC_SCENARIOS.SLOW_CONNECTION]: [
        { id: 1, name: 'Замер скорости', action: 'speed_test' },
        { id: 2, name: 'Проверка оптического бюджета', action: 'check_optics' },
        { id: 3, name: 'Анализ ошибок порта', action: 'check_port_errors' },
        { id: 4, name: 'Проверка загрузки CPU ONU', action: 'check_onu_load' },
      ],
      [DIAGNOSTIC_SCENARIOS.OPTICAL_ISSUE]: [
        { id: 1, name: 'Замер RX мощности', action: 'measure_rx' },
        { id: 2, name: 'Проверка чистоты коннектора', action: 'inspect_connector' },
        { id: 3, name: 'Проверка сплиттера', action: 'check_splitter' },
        { id: 4, name: 'Поиск перегибов волокна', action: 'inspect_fiber' },
      ],
      [DIAGNOSTIC_SCENARIOS.EQUIPMENT_OFFLINE]: [
        { id: 1, name: 'Проверка питания в доме', action: 'check_power_supply' },
        { id: 2, name: 'Пинг шлюза', action: 'ping_gateway' },
        { id: 3, name: 'Проверка статуса на OLT', action: 'check_olt_status' },
        { id: 4, name: 'Визуальный осмотр ONU', action: 'visual_inspect' },
      ],
    };

    return scenarios[scenario] || scenarios[DIAGNOSTIC_SCENARIOS.SLOW_CONNECTION];
  }

  /**
   * Выполнение текущего шага
   * @param {Object} step - объект шага
   * @param {Object} context - контекст
   */
  executeCurrentStep(step, context = {}) {
    if (!step) return;

    console.log(`${LOG_PREFIX} Executing step:`, step.name);

    this.lastStepTime = Date.now();
    this.attemptCount++;

    stateStore.updateMentorStep({
      active: true,
      currentStep: step,
      totalSteps: this.getStepsForScenario(this.currentScenario).length,
      lastActionAt: Date.now(),
    });

    eventBus.emit(EVENT_TYPES.ON_STEP_CHANGE, {
      step,
      stepIndex: this.stepIndex,
      attemptCount: this.attemptCount,
      timestamp: Date.now(),
    });

    // Авто-выполнение действия шага (если определено)
    if (step.action && typeof this.actions[step.action] === 'function') {
      this.actions[step.action](context);
    }
  }

  /**
   * Действия для шагов диагностики
   */
  actions = {
    check_power: (context) => {
      console.log(`${LOG_PREFIX} Action: Checking power supply`);
      // Логика проверки питания
    },
    
    check_optics: (context) => {
      console.log(`${LOG_PREFIX} Action: Checking optical signal`);
      const signalLevel = context.metrics?.signalLevel?.value;
      
      if (signalLevel < -28) {
        this.addFinding('critical', 'Критически низкий уровень сигнала', { signalLevel });
      } else if (signalLevel < -25) {
        this.addFinding('warning', 'Низкий уровень сигнала', { signalLevel });
      }
    },
    
    check_registration: (context) => {
      console.log(`${LOG_PREFIX} Action: Checking ONU registration on OLT`);
    },
    
    check_port_config: (context) => {
      console.log(`${LOG_PREFIX} Action: Checking port configuration`);
    },
    
    check_ethernet: (context) => {
      console.log(`${LOG_PREFIX} Action: Testing Ethernet cable`);
    },
    
    speed_test: (context) => {
      console.log(`${LOG_PREFIX} Action: Running speed test`);
    },
    
    check_port_errors: (context) => {
      console.log(`${LOG_PREFIX} Action: Analyzing port errors`);
    },
    
    check_onu_load: (context) => {
      console.log(`${LOG_PREFIX} Action: Checking ONU CPU load`);
    },
    
    measure_rx: (context) => {
      console.log(`${LOG_PREFIX} Action: Measuring RX power`);
    },
    
    inspect_connector: (context) => {
      console.log(`${LOG_PREFIX} Action: Inspecting connector cleanliness`);
    },
    
    check_splitter: (context) => {
      console.log(`${LOG_PREFIX} Action: Checking splitter`);
    },
    
    inspect_fiber: (context) => {
      console.log(`${LOG_PREFIX} Action: Inspecting fiber for bends`);
    },
    
    check_power_supply: (context) => {
      console.log(`${LOG_PREFIX} Action: Checking power supply in building`);
    },
    
    ping_gateway: (context) => {
      console.log(`${LOG_PREFIX} Action: Pinging gateway`);
    },
    
    check_olt_status: (context) => {
      console.log(`${LOG_PREFIX} Action: Checking status on OLT`);
    },
    
    visual_inspect: (context) => {
      console.log(`${LOG_PREFIX} Action: Visual inspection of ONU`);
    },
  };

  /**
   * Обработка обновления метрик
   * @param {Object} metrics - новые метрики
   */
  handleMetricsUpdate(metrics) {
    if (!this.isRunning()) return;

    const currentStep = this.getCurrentStep();
    if (!currentStep) return;

    // Проверка условий для авто-перехода к следующему шагу
    const shouldAdvance = this.checkAutoAdvanceConditions(metrics, currentStep);
    
    if (shouldAdvance.shouldAdvance) {
      console.log(`${LOG_PREFIX} Auto-advance triggered:`, shouldAdvance.reason);
      this.nextStep();
    }
  }

  /**
   * Проверка условий для авто-перехода
   * @param {Object} metrics - метрики
   * @param {Object} currentStep - текущий шаг
   * @returns {Object} результат проверки
   */
  checkAutoAdvanceConditions(metrics, currentStep) {
    const thresholds = MENTOR_RULES.AUTO_ADVANCE_THRESHOLDS;

    // Проверка времени на шаг
    const timeOnStep = Date.now() - this.lastStepTime;
    if (timeOnStep < MENTOR_RULES.MIN_STEP_TIME_MS) {
      return { shouldAdvance: false, reason: 'too_early' };
    }

    // Проверка критических значений
    if (metrics.signalLevel && metrics.signalLevel.value < thresholds.signalLevel) {
      return { 
        shouldAdvance: true, 
        reason: 'critical_signal_level',
        value: metrics.signalLevel.value 
      };
    }

    if (metrics.packetLoss && metrics.packetLoss > thresholds.packetLoss) {
      return { 
        shouldAdvance: true, 
        reason: 'high_packet_loss',
        value: metrics.packetLoss 
      };
    }

    if (metrics.latency && metrics.latency > thresholds.latency) {
      return { 
        shouldAdvance: true, 
        reason: 'high_latency',
        value: metrics.latency 
      };
    }

    return { shouldAdvance: false, reason: 'no_conditions_met' };
  }

  /**
   * Переход к следующему шагу
   */
  nextStep() {
    const steps = this.getStepsForScenario(this.currentScenario);
    
    if (this.stepIndex >= steps.length - 1) {
      this.completeDiagnostic();
      return;
    }

    this.stepIndex++;
    this.attemptCount = 0;
    
    this.executeCurrentStep(steps[this.stepIndex]);
  }

  /**
   * Предыдущий шаг
   */
  prevStep() {
    if (this.stepIndex <= 0) return;

    this.stepIndex--;
    this.attemptCount = 0;
    
    const steps = this.getStepsForScenario(this.currentScenario);
    this.executeCurrentStep(steps[this.stepIndex]);
  }

  /**
   * Повтор текущего шага
   */
  retryStep() {
    if (this.attemptCount >= MENTOR_RULES.MAX_ATTEMPTS_PER_STEP) {
      console.warn(`${LOG_PREFIX} Max attempts reached for current step`);
      this.nextStep();
      return;
    }

    const steps = this.getStepsForScenario(this.currentScenario);
    this.executeCurrentStep(steps[this.stepIndex]);
  }

  /**
   * Получение текущего шага
   * @returns {Object|null} текущий шаг
   */
  getCurrentStep() {
    const steps = this.getStepsForScenario(this.currentScenario);
    return steps[this.stepIndex] || null;
  }

  /**
   * Добавление находки/проблемы
   * @param {string} severity - важность (info|warning|critical)
   * @param {string} description - описание
   * @param {Object} data - дополнительные данные
   */
  addFinding(severity, description, data = {}) {
    const finding = {
      id: `finding_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      severity,
      description,
      data,
      timestamp: Date.now(),
      stepIndex: this.stepIndex,
    };

    stateStore.addLogEntry({
      type: 'finding',
      ...finding,
    });

    console.log(`${LOG_PREFIX} Finding added:`, finding);
  }

  /**
   * Завершение диагностики
   */
  completeDiagnostic() {
    console.log(`${LOG_PREFIX} Diagnostic completed`);

    stateStore.setDiagnosticStatus(DIAGNOSTIC_STATUS.COMPLETED, {
      completedAt: Date.now(),
    });

    eventBus.emit(EVENT_TYPES.ON_DIAGNOSTIC_COMPLETE, {
      scenario: this.currentScenario,
      stepsCompleted: this.stepIndex + 1,
      totalSteps: this.getStepsForScenario(this.currentScenario).length,
      findings: this.diagnosticHistory,
      timestamp: Date.now(),
    });

    eventBus.emit(EVENT_TYPES.ON_MENTOR_CASE_COMPLETE, {
      scenario: this.currentScenario,
      timestamp: Date.now(),
    });

    // Сохраняем в историю
    this.diagnosticHistory.push({
      scenario: this.currentScenario,
      completedAt: Date.now(),
      duration: Date.now() - this.lastStepTime,
    });
  }

  /**
   * Остановка диагностики
   */
  stopDiagnostic() {
    console.log(`${LOG_PREFIX} Diagnostic stopped`);

    stateStore.setDiagnosticStatus(DIAGNOSTIC_STATUS.IDLE);

    this.currentScenario = null;
    this.stepIndex = 0;
    this.attemptCount = 0;
  }

  /**
   * Сброс состояния
   */
  reset() {
    console.log(`${LOG_PREFIX} Diagnostic engine reset`);
    
    this.currentScenario = null;
    this.stepIndex = 0;
    this.attemptCount = 0;
    this.lastStepTime = 0;
    
    stateStore.setDiagnosticStatus(DIAGNOSTIC_STATUS.IDLE);
  }

  /**
   * Проверка: запущена ли диагностика
   * @returns {boolean}
   */
  isRunning() {
    const status = stateStore.getSlice('currentCase.status');
    return status === DIAGNOSTIC_STATUS.RUNNING || status === DIAGNOSTIC_STATUS.PAUSED;
  }

  /**
   * Пауза диагностики
   */
  pause() {
    if (!this.isRunning()) return;

    stateStore.setDiagnosticStatus(DIAGNOSTIC_STATUS.PAUSED);
    console.log(`${LOG_PREFIX} Diagnostic paused`);
  }

  /**
   * Возобновление диагностики
   */
  resume() {
    const status = stateStore.getSlice('currentCase.status');
    if (status !== DIAGNOSTIC_STATUS.PAUSED) return;

    stateStore.setDiagnosticStatus(DIAGNOSTIC_STATUS.RUNNING);
    console.log(`${LOG_PREFIX} Diagnostic resumed`);
  }

  /**
   * Получение статистики диагностики
   * @returns {Object} статистика
   */
  getStats() {
    return {
      scenario: this.currentScenario,
      currentStepIndex: this.stepIndex,
      attemptCount: this.attemptCount,
      totalSteps: this.currentScenario ? this.getStepsForScenario(this.currentScenario).length : 0,
      isRunning: this.isRunning(),
      historyLength: this.diagnosticHistory.length,
    };
  }
}

// Экспорт единственного экземпляра (Singleton)
export const diagnosticEngine = new DiagnosticEngine();

export default diagnosticEngine;
