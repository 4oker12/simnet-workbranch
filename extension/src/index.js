/**
 * SIMNET Workbench 2.0 - Архитектура с разделением на слои
 * 
 * Слои приложения:
 * 1. Core (Бизнес-логика) - DiagnosticEngine, TrainingEngine
 * 2. Store (Хранилище состояния) - StateStore (Single Source of Truth)
 * 3. Events (Шина событий) - EventBus (Publisher/Subscriber)
 * 4. Services (Инфраструктура) - NoDenyService, BillingService
 * 5. UI (Представление) - View компоненты (в разработке)
 * 
 * Поток данных:
 * NoDeny DOM -> NoDenyService -> EventBus -> StateStore -> UI Components
 * UI Actions -> EventBus -> Core/Services -> StateStore -> UI Components
 */

// Экспорт всех слоев для удобного импорта
export * from './events/index.js';
export * from './store/index.js';
export * from './core/index.js';
export * from './services/index.js';
export * from './ui/index.js';

// Инициализация при загрузке модуля
console.log('[SIMNET Workbench 2.0] Layered architecture loaded');
console.log('[SIMNET Workbench 2.0] Layers: Events, Store, Core, Services, UI');
