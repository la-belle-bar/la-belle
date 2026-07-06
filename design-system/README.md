# La Belle — дизайн-система

Библиотека компонентов сайта для синхронизации с **Claude Design** (claude.ai/design).
Каждый HTML-файл — самодостаточная карточка-превью: первой строкой идёт маркер
`<!-- @dsCard group="…" name="…" -->`, по которому Claude Design строит витрину.

## Состав

| Файл | Что показывает |
|---|---|
| `foundations/colors.html` | Все цветовые токены из `:root` в `styles.css` + тень |
| `foundations/typography.html` | Заголовки, eyebrow, текст, цены |
| `components/buttons.html` | btn-primary / btn-secondary / btn-wa / add-to-cart / cart-btn |
| `components/forms.html` | Поля, select, textarea, панель фильтров, форма заказа |
| `components/product-card.html` | Карточка товара (обычная и «нет в наличии») |
| `components/tags.html` | Теги, admin-бейджи, пилюли выбранного |
| `components/volume-options.html` | Выбор объёма + цена + add-to-cart |
| `components/cart.html` | Строка корзины, количество, блок «итого» |
| `components/modal.html` | Модальное окно (шапка, close) |
| `components/pagination.html` | Пагинация |
| `components/order-success.html` | Экран «заказ оформлен», Kaspi-карточка |
| `components/admin.html` | Статистика, вкладки, таблица, уведомления админки |
| `sections/hero.html` | Hero-баннер с полкой флаконов |

## Источник правды

**Код сайта — источник правды.** Стили в карточках скопированы из
[`assets/css/styles.css`](../assets/css/styles.css). Если дизайн меняется
в Claude Design — переносите изменения в `styles.css` (или попросите Claude Code
синхронизировать), а затем обновите карточки здесь.

## Как синхронизировать с Claude Design

Из панели VSCode-расширения синхронизация недоступна — нужен настоящий терминал:

1. Откройте встроенный терминал VS Code (`` Ctrl+` ``).
2. Запустите `claude` (CLI) в корне проекта.
3. Выполните `/design-sync` и при первом запуске авторизуйтесь.
4. Укажите папку `design-system/` как локальную библиотеку.

После этого проект появится на [claude.ai/design](https://claude.ai/design) —
там можно визуально итерировать дизайн, а `/design-sync` заберёт правки обратно.
