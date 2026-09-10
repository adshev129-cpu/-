# Стенд проверок «Кузницы Судьбы»

Игра — один файл `../index.html`. Здесь только тесты; в игру они не входят.

```bash
cd tests && npm i                    # jsdom + three r128 (тот же, что грузит игра с CDN)
python3 -m http.server 8000 -d ..    # в отдельном окне: игра тянет .glb по http
node stress.js 300 1337              # 34 проверки: экономика, чертежи, бой, сейв, клавиатура, фаззинг
FILE=1 node stress.js 100 1337       # то же при открытии с диска (file://, без .glb)
NOLS=1 node stress.js 100 3          # localStorage бросает SecurityError
node --max-old-space-size=4096 real_three.js   # настоящий GLTFLoader: 24 .glb, сборка кузницы, локации, бой, верстак
node sim_balance.js 7 1              # темп прогрессии: 7 дней, SESS=3 SESS_MIN=15 (заходов/день × минут)
node sim_fights.js 150               # матрица «уровень × монстр» → шанс победы; GEAR=none|iron|best|typical
```

`harness.js` поднимает страницу в jsdom с настоящим three (только `WebGLRenderer` подменён —
jsdom не умеет WebGL), подменёнными часами (`clock.off`) и детерминированным `Math.random`.

## visual.js — настоящий браузер со скриншотами
Headless Chromium (`@sparticuz/chromium`, WebGL через SwiftShader) открывает игру с `http://localhost:8000`,
three.js подставляется из `node_modules` (CDN из песочницы может не открываться), и снимает
кузницу, все 6 локаций и превью верстака в `tests/shots/` (папка в .gitignore). 14 проверок:
локации и предметы — настоящие `.glb` (≈40k треугольников), рядом с моделью только диск почвы,
в кузнице нет реквизита из примитивов.

    npm i            # ставит и @sparticuz/chromium + puppeteer-core
    node visual.js   # ~2 мин, нужен http.server на :8000
