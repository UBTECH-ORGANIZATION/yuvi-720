export interface LearningWorldStats {
  fps: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  renderer?: string
  positionX?: number
  positionY?: number
  zoom?: number
}

export interface LearningWorldHandle {
  focus: (landmarkId: string) => void
  resetCamera: () => void
  travelTo: (landmarkId: string, onComplete: () => void) => void
  showBlocked: (landmarkId: string) => void
}

export interface LearningWorldActions extends LearningWorldHandle {}
