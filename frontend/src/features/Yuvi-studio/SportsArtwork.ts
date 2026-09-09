export const SPORTS_ARENA_ARTWORKS = ['basketball', 'soccer', 'runners', 'olympic', 'padel', 'tennis', 'strength', 'cycling'] as const
export type SportsArenaArtwork = typeof SPORTS_ARENA_ARTWORKS[number]

type Point = [number, number]

export function drawSportsArtwork(context: CanvasRenderingContext2D, id: SportsArenaArtwork, width: number, height: number) {
  context.save()
  context.scale(width / 600, height / 468)
  const ink = '#243532', white = '#f2f5ed', coral = '#d85b49', teal = '#278e83'
  const palette: Record<SportsArenaArtwork, [string, string]> = {
    basketball: ['#e3d7bd', '#a85645'], soccer: ['#cbded5', '#568b70'],
    runners: ['#e7d3c5', '#b66654'], olympic: ['#d6e4e9', '#688d9a'],
    padel: ['#cfdee2', '#468b96'], tennis: ['#e4e5c5', '#659b76'],
    strength: ['#deded5', '#717e78'], cycling: ['#d8e5df', '#8b9b89'],
  }
  const [sky, ground] = palette[id]
  const line = (points: Point[], color: string, stroke = 4) => {
    context.strokeStyle = color; context.lineWidth = stroke
    context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath()
    points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
    context.stroke()
  }
  const polygon = (points: Point[], color: string) => {
    context.fillStyle = color; context.beginPath()
    points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
    context.closePath(); context.fill()
  }
  const circle = (x: number, y: number, radius: number, fill: string, stroke?: string) => {
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2)
    context.fillStyle = fill; context.fill()
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = 3; context.stroke() }
  }
  const athlete = (x: number, y: number, scale: number, shirt: string, skin: string, pose: 'run' | 'reach' | 'lift' | 'racket') => {
    context.save(); context.translate(x, y); context.scale(scale, scale)
    context.fillStyle = 'rgba(27,47,39,0.15)'
    context.beginPath(); context.ellipse(4, 115, 61, 8, 0, 0, Math.PI * 2); context.fill()
    const arms: Point[][] = pose === 'lift' ? [[[-19, -20], [-48, -51], [-48, -82]], [[20, -20], [49, -51], [49, -82]]]
      : pose === 'reach' ? [[[-18, -21], [-32, -61], [-7, -100]], [[19, -21], [39, -56], [33, -110]]]
        : pose === 'racket' ? [[[-18, -21], [-50, -3], [-68, -22]], [[18, -21], [50, -45], [80, -70]]]
          : [[[-18, -21], [-47, -7], [-25, 13]], [[18, -21], [44, -52], [66, -39]]]
    const legs: Point[][] = pose === 'lift' ? [[[-12, 30], [-27, 66], [-34, 108]], [[12, 30], [29, 66], [38, 108]]]
      : [[[-12, 28], [-41, 67], [-71, 69]], [[12, 28], [45, 53], [22, 104]]]
    for (const limb of [...legs, ...arms]) { line(limb, ink, 15); line(limb, skin, 11) }
    polygon([[-23, -32], [17, -33], [25, 20], [16, 35], [-20, 31], [-28, 4]], shirt)
    polygon([[-22, 19], [23, 21], [26, 40], [6, 45], [0, 31], [-16, 43], [-28, 35]], ink)
    line([[-16, -26], [-10, 14]], white, 3)
    line([[13, -20], [17, 9], [11, 16]], 'rgba(25,44,37,0.32)', 3)
    circle(-1, -52, 16, skin)
    polygon([[-17, -56], [-15, -66], [-2, -71], [12, -64], [15, -54], [1, -60]], ink)
    line([[-2, -35], [-1, -28]], skin, 10)
    for (const leg of legs) {
      const [footX, footY] = leg[2]
      line([[footX - 5, footY + 2], [footX + 10, footY + 6]], white, 10)
      line([[footX - 8, footY + 7], [footX + 13, footY + 9]], ink, 3)
    }
    context.restore()
  }
  context.fillStyle = sky; context.fillRect(0, 0, 600, 468)
  polygon([[0, 260], [600, 205], [600, 468], [0, 468]], ground)
  for (let row = 0; row < 5; row++) {
    line([[0, 192 + row * 12], [600, 160 + row * 12]], '#ffffff55', 3)
    for (let seat = 0; seat < 26; seat++) {
      context.fillStyle = [ink, coral, teal, white][(seat + row * 3) % 4]
      context.fillRect(seat * 24 + row % 2 * 8, 191 + row * 12 - seat * 1.25, 9, 4)
    }
  }
  if (id === 'basketball') {
    line([[12, 406], [476, 287], [585, 314]], white, 3)
    line([[470, 56], [470, 251]], ink, 8)
    polygon([[413, 47], [518, 47], [518, 116], [413, 116]], '#f2f5edaa')
    line([[445, 80], [484, 80], [484, 108], [445, 108], [445, 80]], coral, 3)
    line([[444, 117], [490, 117]], coral, 6)
    for (let cord = 0; cord < 7; cord++) line([[446 + cord * 7, 121], [452 + cord * 5, 153]], white, 1.4)
    line([[451, 140], [484, 140]], white, 1)
    athlete(334, 223, 1.36, teal, '#a96843', 'reach')
    circle(382, 61, 23, coral, ink)
    line([[363, 50], [400, 74]], ink, 2); line([[370, 80], [394, 43]], ink, 2)
    athlete(170, 301, 0.64, white, '#654839', 'run')
  } else if (id === 'soccer') {
    line([[403, 225], [403, 125], [551, 103], [551, 218]], white, 6)
    for (let column = 0; column <= 10; column++) line([[403 + column * 14.8, 125 - column * 2.2], [403 + column * 14.8, 225 - column * 0.7]], white, 1)
    for (let row = 1; row < 7; row++) line([[403, 125 + row * 14], [551, 103 + row * 16]], white, 1)
    line([[10, 417], [532, 295], [600, 337]], white, 3)
    athlete(305, 265, 1.3, coral, '#76513b', 'run')
    circle(387, 392, 23, white, ink)
    polygon([[380, 380], [393, 381], [399, 391], [386, 400], [376, 392]], ink)
    athlete(473, 189, 0.48, teal, '#c39268', 'reach')
  } else if (id === 'runners') {
    for (let lane = 0; lane < 7; lane++) line([[-70 + lane * 83, 468], [270 + lane * 41, 249]], white, 3)
    athlete(186, 267, 1.04, teal, '#8d573d', 'run')
    athlete(331, 274, 1.36, coral, '#be8c64', 'run')
    athlete(461, 241, 0.9, white, '#5b4033', 'run')
    line([[32, 418], [569, 359]], white, 9)
  } else if (id === 'olympic') {
    for (let lane = 0; lane < 6; lane++) line([[0, 310 + lane * 28], [600, 254 + lane * 28]], white, 2)
    for (const x of [152, 418]) {
      line([[x, 382], [x, 289], [x + 97, 279], [x + 97, 368]], ink, 4)
      line([[x, 289], [x + 97, 279]], white, 10)
      for (let stripe = 0; stripe < 4; stripe++) line([[x + stripe * 24, 289 - stripe * 2.5], [x + stripe * 24 + 10, 288 - stripe * 2.5]], coral, 10)
    }
    athlete(302, 227, 1.22, teal, '#825239', 'run')
    circle(70, 70, 27, '#c49e4a')
    for (let ray = 0; ray < 12; ray++) {
      const angle = ray * Math.PI / 6
      line([[70 + Math.cos(angle) * 32, 70 + Math.sin(angle) * 32], [70 + Math.cos(angle) * 42, 70 + Math.sin(angle) * 42]], '#c49e4a', 2)
    }
  } else if (id === 'padel' || id === 'tennis') {
    line([[45, 421], [134, 250], [500, 228], [574, 383], [45, 421]], white, 3)
    line([[103, 310], [536, 281]], ink, 4)
    for (let index = 0; index < 36; index++) line([[105 + index * 12, 310 - index * 0.8], [105 + index * 12, 347 - index * 0.8]], white, 1)
    for (let row = 0; row < 5; row++) line([[103, 310 + row * 8], [536, 281 + row * 8]], white, 1)
    if (id === 'padel') for (const x of [49, 157, 465, 569]) line([[x, 104], [x, 259]], '#537781', 3)
    athlete(265, 274, 1.2, id === 'padel' ? coral : teal, '#b07c57', 'racket')
    line([[361, 190], [391, 159]], ink, 7)
    context.save(); context.translate(408, 141); context.rotate(0.6)
    context.beginPath(); context.ellipse(0, 0, 22, 31, 0, 0, Math.PI * 2)
    context.fillStyle = id === 'padel' ? ink : '#ffffff33'; context.fill()
    context.strokeStyle = coral; context.lineWidth = 5; context.stroke()
    if (id === 'padel') for (let row = -2; row <= 2; row++) for (let col = -1; col <= 1; col++) circle(col * 10, row * 10, 2, white)
    else for (let index = -2; index <= 2; index++) { line([[index * 6, -23], [index * 6, 23]], white, 1); line([[-16, index * 8], [16, index * 8]], white, 1) }
    context.restore()
    circle(458, 100, 7, '#e2d74c')
    athlete(410, 233, 0.48, white, '#714a36', 'racket')
  } else if (id === 'strength') {
    polygon([[102, 412], [174, 315], [447, 299], [510, 402]], '#c3b395')
    for (const x of [80, 520]) { line([[x, 100], [x, 311]], ink, 9); line([[x - 18, 312], [x + 18, 312]], ink, 10) }
    athlete(298, 283, 1.15, coral, '#80503a', 'lift')
    line([[158, 188], [442, 188]], white, 8)
    for (const [x, color] of [[175, teal], [193, coral], [403, coral], [421, teal]] as const) {
      context.fillStyle = color; context.fillRect(x - 7, 144, 14, 88)
      line([[x, 150], [x, 225]], '#ffffff55', 2)
    }
  } else {
    polygon([[0, 381], [192, 266], [353, 278], [600, 415], [600, 468], [0, 468]], '#697771')
    line([[0, 446], [214, 291], [331, 300], [565, 468]], white, 3)
    for (const x of [220, 415]) {
      circle(x, 347, 64, ground, ink)
      for (let spoke = 0; spoke < 16; spoke++) {
        const angle = spoke * Math.PI / 8
        line([[x, 347], [x + Math.cos(angle) * 60, 347 + Math.sin(angle) * 60]], white, 1)
      }
    }
    line([[220, 347], [278, 263], [323, 347], [220, 347], [364, 263], [415, 347], [323, 347], [364, 263]], coral, 7)
    line([[259, 258], [293, 258]], ink, 8); line([[364, 263], [357, 233], [378, 230]], ink, 6)
    line([[277, 249], [314, 286], [309, 335]], '#9a6245', 17)
    line([[310, 246], [281, 298], [338, 329]], '#c38d63', 15)
    polygon([[271, 245], [294, 190], [334, 184], [353, 209], [311, 255]], teal)
    line([[335, 203], [348, 226], [373, 235]], '#c38d63', 12)
    circle(351, 170, 18, '#c38d63')
    polygon([[330, 166], [336, 149], [356, 145], [374, 161], [362, 168]], white)
    line([[339, 150], [352, 162]], coral, 3)
  }
  context.globalAlpha = 0.08
  for (let grain = 0; grain < 2300; grain++) {
    context.fillStyle = grain % 2 ? ink : white
    context.fillRect(grain * 73 % 600, grain * 137 % 468, 1.5, 1.5)
  }
  context.globalAlpha = 1
  context.strokeStyle = white; context.lineWidth = 7; context.strokeRect(12, 12, 576, 444)
  context.restore()
}