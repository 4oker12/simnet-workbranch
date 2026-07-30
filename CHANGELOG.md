# Changelog

## [0.5.0] - 2026-07-30

### Added

- Userside-модуль назначения мастеров и бригад
  `5.9.9-validation-layout-fix` встроен непосредственно в Chrome Extension.
- Валидация типа заявки, даты работ, исполнителей и типа здания теперь работает
  без Tampermonkey.

## [0.4.1] - 2026-07-30

### Added

- Manifest V3 Chrome Extension для общего UserSide и Billing SIMNET / LOOKNET.
- Автоматический и ручной выбор Billing-провайдера.
- Режим обучения с контекстными чек-листами из базы знаний.
- PON-first сценарий обучения: опрос порта, затем Juniper и технические проверки.
- Совместимый слой Tampermonkey API, фоновый GET-мост и пассивный UserSide page hook.
- Автоматические тесты, CI и воспроизводимая ZIP-сборка.
