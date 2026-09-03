(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const ENTRIES = Object.freeze({
    'billing.technical-data': Object.freeze({
      title: 'Технические данные',
      what: 'Раздел Billing с параметрами фактического подключения абонента.',
      why: 'Здесь проверяются технология, ONU, MAC и назначенная OLT — исходные данные для дальнейшей диагностики.',
      simple: 'Это сохранённый «паспорт подключения». Дальше мы проверим его живыми данными сети.',
      action: 'Откройте раздел и сверяйте значения с другими источниками.'
    }),

    'billing.juniper-session': Object.freeze({
      title: 'Juniper: интернет-сессия',
      what: 'Read-only снимок IP-сессии абонента на BRAS.',
      why: 'Показывает, есть ли сейчас доступ до сети провайдера и идёт ли обмен пакетами.',
      simple: 'BRAS — узел, который держит интернет-сессию абонента. Online здесь ещё не доказывает качество Wi-Fi или оптики.',
      action: 'Сверьте IP, MAC, статус и текущий обмен; затем продолжайте проверку ONU/OLT.'
    }),

    'billing.userside-link': Object.freeze({
      title: 'Переход в UserSide',
      what: 'Штатная ссылка на карточку того же абонента в UserSide.',
      why: 'UserSide даёт независимые сведения о ТМЦ, MAC-истории, оборудовании и интерфейсах.',
      simple: 'Мы открываем второй источник данных по тому же абоненту, чтобы не доверять одной карточке вслепую.',
      action: 'Перейдите в UserSide, не теряя текущий кейс Workbench.'
    }),

    'billing.olt-field': Object.freeze({
      title: 'OLT абонента',
      what: 'Поле выбора головного PON-оборудования, к которому относится ONU.',
      why: 'Без корректной OLT нельзя выбрать правильный тип опроса и достоверно проверить ONU.',
      simple: 'OLT стоит у провайдера; к ней по оптике подключена домашняя ONU абонента.',
      action: 'Сверьте имя и IP, затем выберите подтверждённую OLT.'
    }),

    'billing.save-technical': Object.freeze({
      title: 'Сохранение технических данных',
      what: 'Кнопка сохраняет выбранные параметры подключения в Billing.',
      why: 'Опрос должен выполняться уже после подтверждения, что выбранная OLT действительно сохранилась.',
      simple: 'Сначала сохраняем правильную привязку, потом проверяем её живым запросом.',
      action: 'Сохраните изменения и дождитесь повторной загрузки страницы.'
    }),

    'userside.tmc-olt': Object.freeze({
      title: 'Найдено на OLT',
      what: 'Блок ТМЦ, где UserSide показывает OLT, IP, интерфейс и доступные идентификаторы ONU.',
      why: 'Это независимая зацепка для поиска фактического подключения, особенно когда Billing пуст или ошибочен.',
      simple: 'ТМЦ — учёт выданного оборудования. Здесь ищем, куда система привязала ONU абонента.',
      action: 'Сверьте имя OLT и IP; Serial и ONU MAC используйте как дополнительные ориентиры.'
    }),

    'billing.poll-tab': Object.freeze({
      title: 'Раздел опроса ONU',
      what: 'Вкладка Billing для конкретного семейства или производителя OLT.',
      why: 'Тип вкладки выбирается по подтверждённому названию OLT, а не только по общей отметке PON.',
      simple: 'Разные OLT понимают разные команды, поэтому сначала выбираем правильную вкладку опроса.',
      action: 'Откройте вкладку, соответствующую найденной OLT.'
    }),

    'billing.ask-olt': Object.freeze({
      title: 'Запрос OLT',
      what: 'Команда запускает прямой опрос выбранной OLT по данным текущего абонента.',
      why: 'Положительный прямой ответ OLT — самое сильное подтверждение фактического расположения ONU.',
      simple: 'Это живой вопрос оборудованию: «видишь ли ты сейчас эту ONU и в каком она состоянии?»',
      action: 'Запустите запрос и обязательно дождитесь результата.'
    }),

    'billing.onu-port-state': Object.freeze({
      title: 'Состояние Ethernet-порта ONU',
      what: 'Текущие параметры проводного порта ONU, к которому подключён роутер или другое оборудование абонента.',
      why: 'Speed, Duplex и LinkState показывают, поднят ли локальный Ethernet-линк и на какой скорости он согласован.',
      simple: 'Проверяем короткий медный участок между ONU и роутером: есть ли линк и не упал ли он до 100 Мбит/с.',
      action: 'Сверьте Speed, Duplex и LinkState; для гигабитного подключения нормальный ориентир — 1000, full, up.'
    }),

    'billing.poll-result-summary': Object.freeze({
      title: 'Результат опроса ONU',
      what: 'Краткий итог прямого ответа OLT: полный PON-путь, ONT ID и текущее состояние ONU.',
      why: 'Строка online/offline показывает, видит ли OLT терминал сейчас, а полный путь нужен для точной привязки к порту и ONT ID.',
      simple: 'ONU и ONT здесь означают абонентский оптический терминал; путь показывает его точное место на OLT.',
      action: 'Сверьте PON-путь, ONT ID и состояние ONU перед завершением диагностики.'
    }),

    'userside.mac-search': Object.freeze({
      title: 'Поиск по MAC',
      what: 'Поиск истории появления MAC-адреса на сетевом оборудовании.',
      why: 'Помогает восстановить фактический путь абонента, когда OLT или ТМЦ не дают ответа.',
      simple: 'MAC — идентификатор устройства. По его следу ищем, на каком порту сеть видела абонента.',
      action: 'Ищите по наиболее актуальному MAC из карточки абонента.'
    }),

    'userside.uplink-downlink': Object.freeze({
      title: 'Поиск на UPLINK/DOWNLINK',
      what: 'Расширенный поиск MAC не только на абонентских, но и на транзитных портах.',
      why: 'Используется, когда обычный MAC-поиск не показывает конечное подключение напрямую.',
      simple: 'UPLINK/DOWNLINK — входящий и исходящий путь между устройствами. По цепочке доходим до конечного порта.',
      action: 'Расширьте поиск и проследите цепочку до конечного интерфейса.'
    }),

    'userside.interface': Object.freeze({
      title: 'Интерфейс оборудования',
      what: 'Конкретный порт OLT или коммутатора, на котором наблюдался MAC.',
      why: 'Присутствие текущего абонента на конкретном PON-интерфейсе подтверждает его сетевой путь.',
      simple: 'Интерфейс — это порт оборудования. Он отвечает на вопрос «куда именно подключён абонент».',
      action: 'Откройте интерфейс и найдите строку текущего абонента.'
    }),

    'userside.mac-result': Object.freeze({
      title: 'MAC найден на оборудовании',
      what: 'Строка MAC-history с датой, найденным оборудованием, портом и VLAN.',
      why: 'Это фактический сетевой след абонентского MAC. Карточка оборудования нужна только как дополнительная проверка, если информации строки недостаточно.',
      simple: 'VLAN — логический канал внутри сети. Вместе с портом он помогает отличить нужное подключение от соседних.',
      action: 'Сверьте оборудование и порт. При необходимости карточку оборудования откройте вручную; Workbench сам туда не переводит.'
    }),

    'userside.ethernet-access-point': Object.freeze({
      title: 'Ethernet-точка подключения',
      what: 'Прямая привязка абонента к порту коммутатора по витой паре.',
      why: 'Для такого подключения нет ONU и OLT: проверяются коммутатор, конкретный порт, MAC и VLAN.',
      simple: 'Кабель абонента приходит прямо в порт коммутатора провайдера. Поэтому оптические ONU/OLT здесь не ищем.',
      action: 'Сверьте имя и IP коммутатора, номер порта, Link и согласованную скорость.'
    }),

    'userside.ethernet-fdb': Object.freeze({
      title: 'FDB-таблица коммутатора',
      what: 'Таблица MAC-адресов, которые коммутатор выучил на своих портах.',
      why: 'Строка текущего MAC показывает фактический порт и VLAN абонента.',
      simple: 'FDB — память коммутатора: какой MAC он видел и через какой порт этот MAC доступен.',
      action: 'Найдите MAC текущего абонента и сверьте порт с «Точкой подключения».'
    }),

    'userside.ethernet-errors': Object.freeze({
      title: 'Ошибки Ethernet-интерфейса',
      what: 'Счётчики повреждённых или неуспешно принятых/переданных кадров на порту.',
      why: 'Рост ошибок может указывать на кабель, коннектор, порт или неправильное согласование скорости/duplex.',
      simple: 'Важно не только число, а растёт ли оно сейчас. Старое небольшое значение само по себе ещё не доказывает неисправность.',
      action: 'Сверьте именно порт абонента и при наличии ошибок сравните прирост во времени.'
    }),

    'userside.ethernet-summary': Object.freeze({
      title: 'Итог Ethernet-ветки',
      what: 'Сводка точки подключения, FDB и интерфейсных ошибок.',
      why: 'Она подтверждает физико-канальный путь абонента, но не заменяет проверку Wi‑Fi, маршрутизации или приложения.',
      simple: 'Мы подтвердили, через какой коммутатор и порт идёт абонент. Дальше вывод зависит от его жалобы.',
      action: 'Используйте собранные факты для следующей проверки по симптому.'
    }),

    'userside.device': Object.freeze({
      title: 'Карточка оборудования',
      what: 'Страница сетевого устройства с моделью, системным именем, IP и интерфейсами.',
      why: 'По ней определяется фактическая OLT, её технология и адрес управления.',
      simple: 'Это паспорт самого сетевого устройства: что за модель, как называется и по какому IP управляется.',
      action: 'Сверьте модель, системное имя и IP оборудования.'
    })
  });

  const EXACT_PLAN_MAP = Object.freeze({
    'billing.open-technical': 'billing.technical-data',
    'billing.reopen-technical-for-olt': 'billing.technical-data',
    'billing.inspect-juniper': 'billing.juniper-session',
    'billing.open-userside': 'billing.userside-link',
    'billing.open-userside-for-mac': 'billing.userside-link',
    'billing.fill-olt': 'billing.olt-field',
    'billing.save-olt': 'billing.save-technical',
    'userside.find-tmc': 'userside.tmc-olt',
    'billing.open-poll-tab': 'billing.poll-tab',
    'billing.ask-olt': 'billing.ask-olt',
    'billing.onu-port-state': 'billing.onu-port-state',
    'billing.poll-result-summary': 'billing.poll-result-summary',
    'userside.search-mac': 'userside.mac-search',
    'userside.search-topology': 'userside.uplink-downlink',
    'userside.inspect-interface': 'userside.interface',
    'userside.inspect-device': 'userside.device'
  });

  function knowledgeIdForPlan(plan) {
    const id = String(plan?.knowledgeId || plan?.id || '');
    if (plan?.knowledgeId && ENTRIES[id]) return id;
    if (EXACT_PLAN_MAP[id]) return EXACT_PLAN_MAP[id];
    if (id.startsWith('billing.inspect-technical:')) return 'billing.technical-data';
    if (id.startsWith('userside.inspect-tmc:')) return 'userside.tmc-olt';
    return '';
  }

  function resolve(plan) {
    const id = knowledgeIdForPlan(plan);
    if (!id) return null;
    return {
      id,
      ...ENTRIES[id]
    };
  }

  WB.knowledge = {
    entries: ENTRIES,
    resolve,
    knowledgeIdForPlan
  };
})();
