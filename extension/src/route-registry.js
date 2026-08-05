"use strict";

(() => {
  if (globalThis.__SIMNET_ROUTE_REGISTRY__) return;

  const routes = [
    { id: "billing-search", group: "Billing", point: "Поиск договора", action: "Найти абонента по номеру договора", page: "billing-other", refType: "endpoint", reference: "/adm.pl?a=listuser&name=<contract>", status: "active" },
    { id: "billing-card", group: "Billing", point: "Основная карточка", action: "Открыть карточку абонента", page: "billing-user", refType: "endpoint", reference: "/adm.pl?a=user&id=<billing_id>", status: "active" },
    { id: "billing-technical", group: "Billing", point: "Технические данные", action: "Открыть техническую привязку", page: "billing-technical", refType: "endpoint", reference: "/adm.pl?a=dopdata&parent_type=0&id=<billing_id>&pp=<pp>&tmpl=1", target: "billing-technical", status: "active" },
    { id: "billing-userside-link", group: "Billing", point: "Переход в UserSide", action: "Открыть связанную карточку UserSide", page: "billing-user", refType: "selector", reference: "a[href*='userside.simnet.kiev.ua'], a[href*='gotouser.php']", target: "billing-userside", status: "active" },
    { id: "billing-access", group: "Billing", point: "Доступ", action: "Проверить разрешён/запрещён", page: "billing-user", refType: "selector", reference: "select[name='state'], input[name='state']", target: "billing-access", status: "active" },
    { id: "billing-block", group: "Billing", point: "Блокировка", action: "Проверить ограничения услуги", page: "billing-user", refType: "selector", reference: "[name*='block' i], [id*='block' i]", target: "billing-block", status: "active" },
    { id: "billing-group", group: "Billing", point: "Группа", action: "Проверить активность группы", page: "billing-user", refType: "selector", reference: "select[name*='group' i], input[name*='group' i]", target: "billing-group", status: "active" },
    { id: "billing-tariff", group: "Billing", point: "Тариф и состояние услуги", action: "Проверить тариф/услугу", page: "billing-user", refType: "selector", reference: "select[name*='tarif' i], select[name='cstate']", target: "billing-tariff", status: "active" },
    { id: "billing-start-day", group: "Billing", point: "День начала услуги", action: "Проверить отрицательное значение", page: "billing-user", refType: "selector", reference: "input[name='start_day'], select[name='start_day']", target: "billing-start-day", status: "active" },
    { id: "billing-olt-field", group: "Billing", point: "Поле OLT", action: "Прочитать или заполнить OLT", page: "billing-technical", refType: "selector", reference: "select[name='dopfield_29'], input[name='dopfield_29']", target: "billing-olt-field", status: "active" },
    { id: "billing-technology", group: "Billing", point: "Технология PON", action: "Определить EPON/GPON/GCOM/Huawei", page: "billing-technical", refType: "selector", reference: "select[name='dopfield_39'], input[name='dopfield_39']", status: "active" },

    { id: "juniper-open", group: "Juniper", point: "Juniper NEW", action: "Открыть проверку сессии", page: "billing-user", refType: "selector", reference: "#maindiv > table:nth-child(6) > tbody > tr > td:nth-child(3) > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td:nth-child(3) > div:nth-child(1) > div:nth-child(9) > a", target: "session", status: "active" },
    { id: "juniper-status", group: "Juniper", point: "Статус сессии", action: "Прочитать online/offline", page: "juniper-result", refType: "selector", reference: "#maindiv > table:nth-child(2) > tbody > tr > td:nth-child(2) > div.message > table > tbody > tr > td:nth-child(3) > ol > li:nth-child(4)", target: "session-status", status: "active" },
    { id: "juniper-frame", group: "Juniper", point: "Juniper iframe", action: "Прочитать IP/MAC/логин/сессию", page: "billing-user", refType: "endpoint", reference: "juniper.php", status: "active" },

    { id: "poller-epon", group: "OLT / ONU", point: "BDCOM EPON", action: "Запустить опрос EPON", page: "billing-user", refType: "endpoint", reference: "/adm.pl?a=310&<subscriber_params>", target: "poller-epon", status: "active" },
    { id: "poller-gpon", group: "OLT / ONU", point: "BDCOM GPON", action: "Запустить опрос GPON", page: "billing-user", refType: "endpoint", reference: "/adm.pl?a=311&<subscriber_params>", target: "poller-gpon", status: "active" },
    { id: "poller-gcom", group: "OLT / ONU", point: "GCOM", action: "Запустить опрос GCOM", page: "billing-user", refType: "endpoint", reference: "/adm.pl?a=312&<subscriber_params>", target: "poller-gcom", status: "active" },
    { id: "poller-huawei", group: "OLT / ONU", point: "Huawei", action: "Запустить опрос Huawei", page: "billing-user", refType: "endpoint", reference: "/adm.pl?a=313&<subscriber_params>", target: "poller-huawei", status: "active" },
    { id: "poller-result", group: "OLT / ONU", point: "Результат live-опроса", action: "Подтвердить статус, порт, ID и оптику", page: "billing-poller", refType: "evidence", reference: "ONU/ONT + status + port/ID или Rx/Tx dBm", status: "active" },

    { id: "userside-search", group: "UserSide", point: "Штатный поиск договора", action: "Получить customerId", page: "userside-other", refType: "endpoint", reference: "/customer_list/ajax_search?search=<contract>", status: "active" },
    { id: "userside-card", group: "UserSide", point: "Карточка абонента", action: "Открыть customer", page: "userside-customer", refType: "endpoint", reference: "/customer/<customerId>", status: "active" },
    { id: "userside-tmc", group: "UserSide", point: "ТМЦ / оборудование", action: "Открыть оборудование абонента", page: "userside-customer", refType: "selector", reference: "ТМЦ | Оборудование | Товарно-материальные ценности", target: "userside-tmc", status: "active" },
    { id: "userside-found-olt", group: "UserSide", point: "Найдено на OLT", action: "Прочитать OLT, IP, порт и дату", page: "userside-customer", refType: "text-anchor", reference: "Найдено на OLT", target: "userside-tmc", status: "active" },
    { id: "userside-device", group: "UserSide", point: "Карточка ONU/устройства", action: "Открыть учётное устройство", page: "userside-device", refType: "endpoint", reference: "/device/<onuId>", status: "active" },
    { id: "userside-onu-list", group: "UserSide", point: "ONU на PON-порту", action: "Открыть список ONU порта", page: "userside-device", refType: "endpoint", reference: "/device/device_onu_list?id=<oltId>&pon_iface=1&iface_olt_number=<if_index>", status: "active" },
    { id: "userside-poller-data", group: "UserSide", point: "Пагинация ONU", action: "Получить данные poller", page: "userside-device", refType: "endpoint", reference: "/device/<oltId>/device_poller_data?data_type=onu_list&page=<N>", status: "active" },
    { id: "userside-olt-report", group: "UserSide", point: "Отчёт OLT ONU", action: "Сопоставить ONU с OLT", page: "userside-device", refType: "endpoint", reference: "/device/report?type2=olt_onu&device_id=<oltId>", status: "active" },
    { id: "userside-interface-mac", group: "UserSide", point: "Интерфейсы OLT", action: "Получить if_index PON-порта", page: "userside-device", refType: "endpoint", reference: "/device/interface_mac_list?id=<oltId>", status: "active" },
    { id: "userside-customer-list", group: "UserSide", point: "Список абонентов", action: "Индексировать договоры/OLT/адреса", page: "userside-list", refType: "endpoint", reference: "/customer_list?page=<N>", status: "active" },
    { id: "userside-address", group: "UserSide", point: "Абоненты объекта/адреса", action: "Открыть связанные сущности адреса", page: "userside-customer", refType: "endpoint", reference: "/attach/ajax_frame?obj_typer=customer&obj_code=<customerId>", status: "active" },

    { id: "splunk-start", group: "Логи", point: "Запуск поиска логов", action: "Создать запрос Splunk", page: "userside-customer", refType: "endpoint", reference: "/script/splunk.php", status: "active" },
    { id: "splunk-result", group: "Логи", point: "Получение логов", action: "Забрать результат поиска", page: "userside-customer", refType: "endpoint", reference: "/script/splunk_get.php", status: "active" },

    { id: "route-olt-discovery", group: "Workbench", point: "Маршрут отсутствующей OLT", action: "Billing → UserSide → ТМЦ → Billing → poller", page: "cross-system", refType: "state", reference: "management.routeId = olt-discovery", status: "active" },
    { id: "route-management-state", group: "Workbench", point: "Management state", action: "Хранить stage/currentPage/expectedPage/progress", page: "cross-system", refType: "state", reference: "SIMNET_WB_MENTOR_ROUTE_STATE.management", status: "active" },
    { id: "route-action-state", group: "Workbench", point: "Action state", action: "Разрешить одно следующее действие", page: "cross-system", refType: "state", reference: "SIMNET_WB_MENTOR_ROUTE_STATE.action", status: "active" },
    { id: "route-ui-state", group: "Workbench", point: "UI state", action: "Выбрать переход/подсветку/ожидание", page: "cross-system", refType: "state", reference: "SIMNET_WB_MENTOR_ROUTE_STATE.ui", status: "active" },
    { id: "route-session-memory", group: "Workbench", point: "Память маршрута", action: "Не сбрасывать прогресс после reload", page: "cross-system", refType: "storage", reference: "chrome.storage.session: simnet_wb_mentor_route_memory_v2", status: "active" },
    { id: "route-highlight-ack", group: "Workbench", point: "Подтверждение подсветки", action: "Не повторять принятый этап после reload", page: "cross-system", refType: "storage", reference: "chrome.storage.session: simnet_wb_route_highlight_ack_v1", status: "active" },

    { id: "history-subscriber", group: "История", point: "История абонента", action: "Связать договоры, ONU, адреса и изменения", page: "cross-system", refType: "planned", reference: "Модуль отложен", status: "deferred" },
    { id: "neighbors-radius", group: "Гео / соседи", point: "Соседи в радиусе", action: "Ранжировать OLT по ближайшим абонентам", page: "userside-map", refType: "planned", reference: "Радиус 500 м; модуль отложен", status: "deferred" },
    { id: "coverage-map", group: "Гео / соседи", point: "Карта покрытия", action: "Получить координаты адреса", page: "userside-map", refType: "planned", reference: "Dashboard → Покрытие → адрес", status: "deferred" }
  ];

  globalThis.__SIMNET_ROUTE_REGISTRY__ = Object.freeze(routes.map(item => Object.freeze({ ...item })));
})();
