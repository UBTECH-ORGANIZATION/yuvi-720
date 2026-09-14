export function drawSportsGymSign(context: CanvasRenderingContext2D, width: number, height: number, title: string) {
  context.fillStyle = '#101c22'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#24363c'
  for (let row = 0; row < 28; row++) for (let column = 0; column < 64; column++) {
    context.fillRect(column * width / 64, row * height / 28, 1.5, 1.5)
  }
  context.strokeStyle = '#66cabd'
  context.lineWidth = width * 0.004
  context.strokeRect(width * 0.025, height * 0.06, width * 0.95, height * 0.88)
  context.fillStyle = '#edb65f'
  for (const side of [0.09, 0.84]) for (let stripe = 0; stripe < 3; stripe++) {
    context.fillRect(width * (side + stripe * 0.026), height * 0.18, width * 0.014, height * 0.09)
  }
  context.strokeStyle = '#83d6c9'
  context.lineWidth = height * 0.014
  context.beginPath()
  context.moveTo(width * 0.44, height * 0.23)
  context.lineTo(width * 0.56, height * 0.23)
  context.stroke()
  context.fillStyle = '#83d6c9'
  for (const side of [0.44, 0.55]) context.fillRect(width * side, height * 0.17, width * 0.01, height * 0.12)
  context.direction = 'ltr'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  let size = height * 0.34
  do {
    context.font = `900 ${size}px "Trebuchet MS", sans-serif`
    if (context.measureText(title).width <= width * 0.84) break
    size -= 1
  } while (size > 8)
  context.shadowColor = '#69c8b8'
  context.shadowBlur = height * 0.025
  context.fillStyle = '#f4f5e9'
  context.fillText(title, width / 2, height * 0.53)
  context.shadowBlur = 0
  context.fillStyle = '#edb65f'
  context.fillRect(width * 0.35, height * 0.8, width * 0.3, height * 0.012)
}