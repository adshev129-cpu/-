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
