# Mafia II — game-mafia2.ru

Сайт о игре Mafia 2: моды, машины, одежда и скины, программы, статьи и гайды,
прохождение, DLC. Статический сайт на [Astro](https://astro.build) + React,
весь контент — Markdown-файлы прямо в этом репозитории.

**Нашли ошибку в статье или хотите добавить материал — присылайте pull request.**
На каждой странице сайта есть ссылка «Предложите правку на GitHub», которая
открывает нужный файл для редактирования.

## Как устроен контент

```
src/content/posts/<рубрика>/<slug>.md   — статьи и моды
src/content/pages/<slug>.md             — статические страницы («Контакты» и т.п.)
src/content/comments/<slug>.json        — архив комментариев (пока не выводится)
src/content/taxonomies.json             — названия рубрик и тегов
public/uploads/                         — изображения
```

Пост — это Markdown с frontmatter:

```yaml
---
title: Иж 21251                    # заголовок
date: 2022-04-07T16:41:12.000Z     # дата публикации
slug: izh-21251                    # часть URL: /cars/izh-21251.html
categories: [cars]                 # первая рубрика — основная, определяет URL
tags: [izh]
description: Краткое описание для поисковиков
cover: /uploads/2022/04/....jpg    # обложка карточки
screenshots: [...]                 # галерея на странице поста
downloadLinks: [https://disk.yandex.ru/d/...]   # кнопки «Скачать»
modAuthor: agens                   # автор мода
instruction: |                     # блок «Установка» (Markdown)
  1. Скопировать файлы...
---

Текст поста в Markdown. Голая ссылка на YouTube отдельной строкой
превращается во встроенный плеер.
```

## Как внести правку

1. Форкните репозиторий и откройте нужный файл в `src/content/`
   (или нажмите «Предложите правку» на странице сайта).
2. Отредактируйте Markdown и создайте pull request.
3. После мержа в `main` сайт пересоберётся и задеплоится автоматически.

Новый пост: создайте `src/content/posts/<рубрика>/<slug>.md` по образцу выше,
картинки положите в `public/uploads/`.

## Разработка

```bash
npm install
npm run dev       # dev-сервер на localhost:4321
npm run build     # прод-сборка в dist/
npm run preview   # предпросмотр сборки
```

Стек: Astro (статическая генерация, content collections), React — только для
интерактивных островов (поиск), чистый CSS с дизайн-токенами
(`src/styles/global.css`), без UI-фреймворков.

URL-схема унаследована от прежней версии сайта и менять её нельзя (SEO):
посты `/cars/<slug>.html`, рубрики `/cars`, теги `/tag/bmw`, страницы `/contact`.
Отдачу без расширений обеспечивает nginx (`deploy/nginx.conf`).

## Деплой

Сайт собирается в Docker-образ (nginx + статика). Workflow
[`.github/workflows/docker.yml`](.github/workflows/docker.yml) публикует его в
GitHub Container Registry, сервер забирает готовый образ сам.

| Событие                | Что происходит                                         |
|------------------------|--------------------------------------------------------|
| push в `main`          | образ `ghcr.io/gusevdv/game-mafia2:latest` и `:sha-<коммит>` |
| тег `v1.2.3`           | дополнительно теги `:1.2.3` и `:1.2`                   |
| pull request           | только проверка сборки, образ не публикуется           |

Образ собирается под `linux/amd64`. Для ARM-сервера добавьте `linux/arm64`
в `platforms` в workflow.

### На сервере

Если пакет приватный, один раз войдите в реестр (токен с правом `read:packages`):

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u GusevDV --password-stdin
```

Скачать и запустить:

```bash
docker pull ghcr.io/gusevdv/game-mafia2:latest
docker rm -f game-mafia2
docker run -d --name game-mafia2 --restart unless-stopped -p 8080:80 \
  ghcr.io/gusevdv/game-mafia2:latest
```

Контейнер слушает порт 80 и рассчитан на работу за реверс-прокси с TLS
(редиректы относительные, схему `https` не ломают). Для отката укажите
конкретный тег `:sha-<коммит>` вместо `:latest`.

Пакет по умолчанию приватный: чтобы сервер мог скачивать образ без токена,
откройте Packages → `game-mafia2` → Package settings → Change visibility → Public.
