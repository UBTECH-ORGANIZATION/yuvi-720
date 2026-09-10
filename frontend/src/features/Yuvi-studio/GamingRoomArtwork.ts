export const GAMING_ROOM_POSTERS = [
  'pacman', 'spaceInvaders', 'donkeyKong', 'tekken',
  'jazzJackrabbit', 'nflBlitz', 'airHockey', 'destroyScreen',
] as const

export type GamingRoomPoster = typeof GAMING_ROOM_POSTERS[number]

export const PACMAN_MAZE = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '     #.##### ## #####.#     ',
  '     #.##          ##.#     ',
  '     #.## ###--### ##.#     ',
  '######.## #      # ##.######',
  '      .   #      #   .      ',
  '######.## #      # ##.######',
  '     #.## ######## ##.#     ',
  '     #.##          ##.#     ',
  '     #.## ######## ##.#     ',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##................##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
]

const SPRITES = {
  ghost: ['00111100', '01111110', '11111111', '11211211', '11211211', '11111111', '11111111', '11011011'],
  invader: ['00100000100', '00010001000', '00111111100', '01101110110', '11111111111', '10111111101', '10100000101', '00011011000'],
  squid: ['00011000', '00111100', '01111110', '11011011', '11111111', '00100100', '01011010', '10100101'],
  crab: ['000011110000', '011111111110', '111111111111', '111001100111', '111111111111', '000110011000', '001101101100', '110000000011'],
  hero: ['0001111100', '0011111110', '0002222200', '0012222220', '0002222200', '0031133000', '0331133300', '3331133330', '0003330000', '0033033000', '0022002200'],
  ape: ['0001111111000', '0011111111100', '0112222221110', '1112122121111', '1112222221111', '1111222211111', '1111111111111', '1112222222111', '1102222222011', '1102222222011', '1110000000111', '1111000001111'],
}

function polygon(context: CanvasRenderingContext2D, points: number[][], color: string) {
  context.fillStyle = color
  context.beginPath()
  points.forEach(([x, y], index) => { if (index === 0) context.moveTo(x, y); else context.lineTo(x, y) })
  context.closePath(); context.fill()
}

function sprite(context: CanvasRenderingContext2D, pattern: string[], x: number, y: number, scale: number, colors: string[]) {
  pattern.forEach((row, rowIndex) => [...row].forEach((pixel, column) => {
    if (pixel === '0') return
    context.fillStyle = colors[Number(pixel) - 1]
    context.fillRect(x + column * scale, y + rowIndex * scale, scale, scale)
  }))
}

function circle(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  context.fillStyle = color; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill()
}

function line(context: CanvasRenderingContext2D, points: number[][], color: string, width = 2) {
  context.strokeStyle = color; context.lineWidth = width; context.beginPath()
  points.forEach(([x, y], index) => { if (index === 0) context.moveTo(x, y); else context.lineTo(x, y) })
  context.stroke()
}

function caption(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, size = 24) {
  context.textAlign = 'center'; context.textBaseline = 'middle'
  do { context.font = `900 ${size}px sans-serif`; if (context.measureText(text).width <= width) break; size -= 1 } while (size > 9)
  context.fillText(text, x, y)
}

function drawPacman(context: CanvasRenderingContext2D) {
  const tile = 11, left = 146, top = 79
  context.fillStyle = '#02020a'; context.fillRect(left - 12, top - 12, 332, 367)
  PACMAN_MAZE.forEach((row, rowIndex) => [...row].forEach((cell, column) => {
    const x = left + column * tile, y = top + rowIndex * tile
    if (cell === '#') {
      context.fillStyle = '#101c62'; context.fillRect(x, y, tile, tile)
      const edges = [PACMAN_MAZE[rowIndex - 1]?.[column], row[column + 1], PACMAN_MAZE[rowIndex + 1]?.[column], row[column - 1]]
      if (edges[0] !== '#') line(context, [[x, y + 1], [x + tile, y + 1]], '#315fff', 1.7)
      if (edges[1] !== '#') line(context, [[x + tile - 1, y], [x + tile - 1, y + tile]], '#315fff', 1.7)
      if (edges[2] !== '#') line(context, [[x, y + tile - 1], [x + tile, y + tile - 1]], '#315fff', 1.7)
      if (edges[3] !== '#') line(context, [[x + 1, y], [x + 1, y + tile]], '#315fff', 1.7)
    } else if (cell === '.' || cell === 'o') circle(context, x + tile / 2, y + tile / 2, cell === 'o' ? 3.7 : 1.2, '#ffdcad')
    else if (cell === '-') line(context, [[x, y + 5], [x + tile, y + 5]], '#ffacdf', 2)
  }))
  const ghostColors = ['#ff454b', '#ff9cdb', '#47e5ef', '#ffae4a']
  ghostColors.forEach((color, index) => sprite(context, SPRITES.ghost, 274 + index % 3 * 16, index === 0 ? 201 : 230, 1.55, [color, '#ffffff']))
  context.fillStyle = '#ffdf25'; context.beginPath(); context.moveTo(294, 337); context.arc(294, 337, 6.4, 0.22 * Math.PI, 1.78 * Math.PI); context.closePath(); context.fill()
  for (let index = 0; index < 3; index += 1) circle(context, 158 + index * 17, 439, 5, '#ffdf25')
  context.fillStyle = '#e4e8ff'; caption(context, '024680', 411, 439, 84, 13)
}

function drawInvaders(context: CanvasRenderingContext2D) {
  for (let index = 0; index < 70; index += 1) circle(context, 38 + index * 83 % 520, 78 + index * 47 % 338, index % 7 ? 0.65 : 1, '#6d778a')
  for (let row = 0; row < 5; row += 1) for (let column = 0; column < 11; column += 1) {
    sprite(context, row === 0 ? SPRITES.squid : row < 3 ? SPRITES.invader : SPRITES.crab, 62 + column * 43, 124 + row * 35, 2.05, [row === 0 ? '#f5e6ff' : row < 3 ? '#86faff' : '#8cf79c'])
  }
  polygon(context, [[251, 94], [262, 82], [280, 78], [299, 82], [310, 94]], '#f4647a')
  for (let index = 0; index < 5; index += 1) context.clearRect(258 + index * 10, 89, 4, 3)
  for (const x of [104, 222, 340, 458]) {
    polygon(context, [[x - 30, 374], [x - 30, 344], [x - 17, 331], [x + 17, 331], [x + 30, 344], [x + 30, 374], [x + 11, 374], [x + 11, 357], [x - 11, 357], [x - 11, 374]], '#7fe497')
    context.fillStyle = '#080d18'; context.fillRect(x - 23, 341, 9, 8); context.fillRect(x + 14, 361, 12, 7)
  }
  polygon(context, [[266, 414], [266, 401], [282, 401], [282, 394], [287, 394], [287, 387], [292, 387], [292, 394], [297, 394], [297, 401], [312, 401], [312, 414]], '#dbffe7')
  line(context, [[289, 315], [289, 303]], '#ffffff', 3)
  line(context, [[435, 294], [431, 301], [437, 308]], '#ffb6cb', 2)
  line(context, [[45, 429], [555, 429]], '#67d481', 2)
}

function drawDonkeyKong(context: CanvasRenderingContext2D) {
  const levels = [421, 357, 293, 229, 165, 107]
  levels.forEach((height, index) => {
    const rise = index % 2 ? -12 : 12
    line(context, [[65, height], [535, height - rise]], '#fa547c', 7)
    for (let beam = 0; beam < 22; beam += 1) {
      const x = 67 + beam * 21, y = height - (x - 65) / 470 * rise
      line(context, [[x, y - 3], [x + 10, y + 3], [x + 20, y - 3]], '#6a244f', 1.4)
    }
    if (index === levels.length - 1) return
    for (const x of index % 2 ? [133, 370] : [245, 484]) {
      const lower = height - (x - 65) / 470 * rise - 3, upper = levels[index + 1] + (x - 65) / 470 * rise + 3
      line(context, [[x - 8, upper], [x - 8, lower]], '#53e2e7', 2)
      line(context, [[x + 8, upper], [x + 8, lower]], '#53e2e7', 2)
      for (let rung = upper + 6; rung < lower; rung += 7) line(context, [[x - 8, rung], [x + 8, rung]], '#53e2e7', 2)
    }
  })
  sprite(context, SPRITES.ape, 105, 61, 3.1, ['#a86935', '#f0ba77'])
  sprite(context, SPRITES.hero, 308, 65, 2.7, ['#ffc4ec', '#f3c69a', '#f378b2'])
  sprite(context, SPRITES.hero, 180, 384, 2.7, ['#f45847', '#f3c69a', '#5d9cf5'])
  for (const [x, y] of [[208, 157], [411, 224], [298, 282], [80, 348], [466, 405]]) {
    circle(context, x, y - 9, 10, '#c9894c'); circle(context, x, y - 9, 7, '#563722')
    line(context, [[x - 6, y - 14], [x + 6, y - 4]], '#f7b167', 2)
    line(context, [[x - 6, y - 4], [x + 6, y - 14]], '#f7b167', 2)
  }
  context.fillStyle = '#5199d2'; context.fillRect(79, 388, 23, 24)
  polygon(context, [[80, 388], [84, 367], [92, 380], [101, 363], [103, 388]], '#ffc354')
}

function fighter(context: CanvasRenderingContext2D, x: number, flip: number, color: string) {
  context.save(); context.translate(x, 0); context.scale(flip, 1)
  polygon(context, [[-31, 160], [2, 151], [26, 183], [19, 261], [-35, 259], [-43, 207]], color)
  polygon(context, [[-32, 251], [2, 253], [-12, 315], [-40, 389], [-71, 389], [-38, 302]], '#dce3e3')
  polygon(context, [[1, 251], [21, 256], [39, 306], [96, 326], [85, 349], [16, 323], [-12, 287]], '#b1c5cd')
  line(context, [[-34, 182], [-62, 215], [-35, 235]], '#d79d7a', 21)
  line(context, [[12, 180], [45, 201], [83, 170]], '#eab38d', 22)
  circle(context, 88, 166, 13, color)
  circle(context, -8, 134, 24, '#e9af89')
  polygon(context, [[-32, 132], [-30, 109], [-13, 96], [-9, 105], [8, 96], [11, 106], [24, 110], [11, 123]], '#192332')
  line(context, [[-28, 258], [21, 260]], '#26313e', 8)
  context.restore()
}

function drawTekken(context: CanvasRenderingContext2D) {
  const backdrop = context.createLinearGradient(30, 0, 570, 0)
  backdrop.addColorStop(0, '#133854'); backdrop.addColorStop(0.5, '#171728'); backdrop.addColorStop(1, '#762935')
  context.fillStyle = backdrop; context.fillRect(29, 65, 542, 372)
  for (let index = 0; index < 12; index += 1) line(context, [[45 + index * 43, 438], [300 + (index - 6) * 12, 292]], '#6b5b86', 1)
  for (const y of [330, 357, 395, 435]) line(context, [[29, y], [571, y]], '#6b5b86', 1)
  context.fillStyle = '#e9db9a'; context.fillRect(51, 79, 203, 10); context.fillRect(346, 79, 203, 10)
  context.fillStyle = '#fbf6e1'; caption(context, '99', 300, 86, 58, 26)
  fighter(context, 166, 1, '#b53949'); fighter(context, 434, -1, '#385683')
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6
    line(context, [[300 + Math.cos(angle) * 15, 184 + Math.sin(angle) * 15], [300 + Math.cos(angle) * (index % 2 ? 37 : 55), 184 + Math.sin(angle) * (index % 2 ? 37 : 55)]], '#ffdb7b', 2)
  }
}

function drawJazz(context: CanvasRenderingContext2D) {
  const sky = context.createLinearGradient(0, 66, 0, 420); sky.addColorStop(0, '#193a70'); sky.addColorStop(1, '#6485a6')
  context.fillStyle = sky; context.fillRect(29, 66, 542, 370)
  for (const x of [50, 220, 500]) {
    polygon(context, [[x - 80, 365], [x - 12, 95], [x + 45, 124], [x + 90, 365]], '#184e55')
    line(context, [[x, 149], [x + 15, 368]], '#28675f', 15)
  }
  for (const [x, y, width] of [[29, 410, 542], [62, 286, 108], [395, 245, 153]]) {
    context.fillStyle = '#786342'; context.fillRect(x, y, width, 27)
    context.fillStyle = '#82d755'; context.fillRect(x, y, width, 9)
    for (let index = 0; index < width / 16; index += 1) { context.fillStyle = index % 2 ? '#385930' : '#b19455'; context.fillRect(x + index * 16, y + 11, 9, 8) }
  }
  polygon(context, [[247, 248], [304, 235], [330, 311], [293, 342], [231, 307]], '#57b94b')
  polygon(context, [[250, 301], [277, 324], [238, 373], [193, 381], [189, 363], [225, 351]], '#72d556')
  polygon(context, [[277, 327], [310, 315], [345, 351], [394, 351], [399, 373], [332, 378]], '#4aa44a')
  polygon(context, [[187, 362], [213, 365], [205, 388], [161, 389]], '#e04749')
  polygon(context, [[374, 352], [398, 350], [418, 378], [372, 379]], '#e04749')
  line(context, [[245, 264], [201, 284], [177, 265]], '#76d758', 23)
  line(context, [[310, 262], [348, 245], [370, 209]], '#67ca51', 22)
  context.save(); context.translate(279, 192); context.rotate(-0.18)
  context.fillStyle = '#62c653'; context.beginPath(); context.ellipse(-18, -67, 14, 69, -0.2, 0, Math.PI * 2); context.fill()
  context.beginPath(); context.ellipse(22, -62, 14, 69, 0.25, 0, Math.PI * 2); context.fill()
  circle(context, 0, 0, 46, '#68c953'); circle(context, 23, 21, 27, '#c5eaa2')
  context.fillStyle = '#ed5052'; context.fillRect(-45, -23, 85, 13)
  polygon(context, [[-39, -24], [-85, -44], [-74, -16], [-40, -12]], '#dc4149')
  circle(context, 9, -4, 12, '#fff8df'); circle(context, 13, -3, 5, '#1b3333')
  circle(context, 39, 14, 7, '#30452c'); context.restore()
  for (const [x, y] of [[99, 258], [135, 247], [430, 206], [470, 198], [510, 208]]) {
    polygon(context, [[x - 5, y - 8], [x + 7, y - 7], [x - 1, y + 13]], '#ffb33f')
    line(context, [[x, y - 7], [x + 4, y - 16]], '#b7ff7d', 3)
  }
}

function drawBlitz(context: CanvasRenderingContext2D) {
  context.fillStyle = '#214c3a'; context.fillRect(37, 68, 526, 368)
  for (let yard = 0; yard < 10; yard += 1) {
    context.fillStyle = yard % 2 ? '#2c7850' : '#276c49'; context.fillRect(56 + yard * 49, 101, 49, 303)
    line(context, [[56 + yard * 49, 101], [56 + yard * 49, 404]], '#a3c7ab', 1)
    for (const y of [181, 322]) line(context, [[56 + yard * 49 + 22, y], [56 + yard * 49 + 26, y]], '#d0e8d2', 2)
    if (yard > 0 && yard < 10) { context.fillStyle = '#bdddc5'; caption(context, String(Math.min(yard, 10 - yard) * 10), 56 + yard * 49, 126, 25, 15) }
  }
  context.strokeStyle = '#d4e9d3'; context.lineWidth = 2; context.strokeRect(55, 101, 490, 303)
  for (const x of [41, 547]) { context.fillStyle = '#ab524c'; context.fillRect(x, 102, 12, 301) }
  const players = [[245, 190], [247, 230], [245, 270], [245, 310], [196, 247], [144, 160], [168, 346], [295, 190], [295, 230], [295, 270], [295, 310], [358, 205], [383, 296], [432, 240]]
  players.forEach(([x, y], index) => {
    circle(context, x + 3, y + 7, 14, '#193b30')
    line(context, [[x - 4, y + 5], [x - 9, y + 18]], '#e9e6d7', 6)
    line(context, [[x + 4, y + 5], [x + 10, y + 16]], '#e9e6d7', 6)
    context.fillStyle = index < 7 ? '#d9544d' : '#458ee2'; context.fillRect(x - 11, y - 8, 22, 18)
    circle(context, x, y - 10, 8, index < 7 ? '#f1ecdc' : '#e5bd61')
    line(context, [[x - 5, y - 9], [x + 5, y - 9]], '#39444b', 2)
  })
  context.save(); context.translate(322, 161); context.rotate(-0.5)
  context.fillStyle = '#a66a3d'; context.beginPath(); context.ellipse(0, 0, 12, 7, 0, 0, Math.PI * 2); context.fill()
  line(context, [[-6, 0], [6, 0]], '#fff5d8', 2); context.restore()
  line(context, [[200, 250], [190, 253], [183, 258]], '#fceaa0', 2)
}

function drawHockey(context: CanvasRenderingContext2D) {
  context.fillStyle = '#142b47'; context.fillRect(53, 72, 494, 363)
  const ice = context.createLinearGradient(0, 80, 0, 420); ice.addColorStop(0, '#f4fbff'); ice.addColorStop(1, '#acd4e4')
  context.fillStyle = ice; context.fillRect(73, 88, 454, 332)
  for (let row = 0; row < 25; row += 1) for (let column = 0; column < 35; column += 1) circle(context, 82 + column * 12.8, 96 + row * 13, 0.8, '#759aab')
  line(context, [[300, 88], [300, 420]], '#d05a69', 3)
  context.strokeStyle = '#d05a69'; context.lineWidth = 3; context.beginPath(); context.arc(300, 254, 65, 0, Math.PI * 2); context.stroke()
  for (const x of [73, 527]) { context.beginPath(); context.arc(x, 254, 68, -Math.PI / 2, Math.PI / 2, x > 300); context.stroke() }
  for (const [x, y, color] of [[169, 282, '#dc4f68'], [432, 212, '#287ecb']] as const) {
    circle(context, x + 7, y + 10, 32, '#809fab'); circle(context, x, y, 31, color)
    circle(context, x, y - 6, 16, '#f4f5ed'); circle(context, x, y - 9, 12, color)
  }
  line(context, [[289, 275], [327, 259], [351, 248]], '#639dad', 3)
  circle(context, 352, 246, 13, '#192f46'); circle(context, 349, 242, 7, '#35465e')
}

function drawDestroyScreen(context: CanvasRenderingContext2D) {
  const colors = ['#ff5c84', '#ff8c50', '#ffd45c', '#84ec89', '#4cdeea', '#829bff']
  for (let row = 0; row < 6; row += 1) for (let column = 0; column < 12; column += 1) {
    if (row > 3 && (column === 6 || column === 7) || row === 5 && column === 5) continue
    const x = 55 + column * 41, y = 96 + row * 26
    context.fillStyle = '#05050e'; context.fillRect(x + 2, y + 3, 37, 21)
    context.fillStyle = colors[row]; context.fillRect(x, y, 37, 21)
    context.fillStyle = '#ffffff66'; context.fillRect(x + 2, y + 2, 33, 3)
  }
  for (let index = 0; index < 11; index += 1) {
    const x = 320 + (index * 13 % 70), y = 239 + index * 6
    polygon(context, [[x, y], [x + 5, y + 3], [x - 3, y + 8]], colors[index % 6])
  }
  line(context, [[352, 269], [432, 356], [392, 397]], '#75b9d0', 2)
  for (let index = 0; index < 4; index += 1) circle(context, 353 + index * 8, 270 + index * 9, 6 - index, `rgba(225,255,255,${0.9 - index * 0.2})`)
  context.fillStyle = '#e4fcff'; context.fillRect(330, 405, 116, 12)
  context.fillStyle = '#6adeeb'; context.fillRect(330, 405, 13, 12); context.fillRect(433, 405, 13, 12)
  line(context, [[44, 82], [44, 434], [556, 434], [556, 82]], '#6d86bd', 3)
}

export function drawGamingPoster(context: CanvasRenderingContext2D, id: GamingRoomPoster, width: number, height: number, title: string) {
  context.save(); context.scale(width / 600, height / 468)
  context.fillStyle = '#080d18'; context.fillRect(0, 0, 600, 468)
  const colors = ['#ffdc47', '#79f7c5', '#ff648f', '#ff765e', '#a6f767', '#8ec7ff', '#66e7ef', '#e77eff']
  const accent = colors[GAMING_ROOM_POSTERS.indexOf(id)]
  context.fillStyle = accent; context.fillRect(26, 53, 548, 2)
  context.fillStyle = '#f3f5ec'; caption(context, title, 300, 29, 535)
  const draw = { pacman: drawPacman, spaceInvaders: drawInvaders, donkeyKong: drawDonkeyKong, tekken: drawTekken, jazzJackrabbit: drawJazz, nflBlitz: drawBlitz, airHockey: drawHockey, destroyScreen: drawDestroyScreen }
  draw[id](context)
  context.fillStyle = accent
  for (let index = 0; index < 5; index += 1) context.fillRect(27 + index * 8, 452, 4, 3)
  context.restore()
}

export function drawGamingRoomNeon(context: CanvasRenderingContext2D, width: number, height: number, title: string) {
  context.clearRect(0, 0, width, height)
  context.save()
  context.scale(width / 1000, height / 250)
  context.strokeStyle = '#21dbe6'; context.lineWidth = 3
  context.shadowColor = '#17d4ef'; context.shadowBlur = 18
  context.beginPath(); context.roundRect(24, 24, 952, 202, 32); context.stroke()
  line(context, [[58, 38], [285, 38]], '#ee62ad', 5)
  line(context, [[714, 213], [941, 213]], '#ffc35c', 5)
  context.shadowBlur = 22; context.shadowColor = '#4be2ee'
  context.fillStyle = '#74eaf4'; caption(context, title, 500, 125, 848, 70)
  context.shadowBlur = 7; context.shadowColor = '#ffffff'
  context.fillStyle = '#f3ffff'; caption(context, title, 500, 125, 848, 70)
  context.shadowBlur = 0
  for (const x of [59, 941]) {
    line(context, [[x - 9, 125], [x + 9, 125]], '#ffd779', 4)
    line(context, [[x, 116], [x, 134]], '#ffd779', 4)
  }
  context.restore()
}