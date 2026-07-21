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

export interface YubiWorldProjection {
  x: number
  y: number
  scale: number
  heading: 'down' | 'left' | 'right' | 'up'
  moving: boolean
  visible: boolean
  /** Height above the ground in screen units (x/y scale). The overlay anchors x/y to Yuvi's GROUND point
   *  and lifts him by this, so flying reads as rising into the air rather than sliding up the map. */
  altitude?: number
  /** Screen-space facing yaw in milliradians, computed by Unity from world velocity through the camera.
   *  Required once the camera follows Yuvi — his screen position barely moves, so the overlay can't derive
   *  facing from screen deltas any more. */
  facing?: number
  hasFacing?: boolean
}

export interface LearningWorldHandle {
  focus: (landmarkId: string) => void
  resetCamera: () => void
  travelTo: (landmarkId: string, onComplete: () => void) => void
  showBlocked: (landmarkId: string) => void
}

export interface LearningWorldActions extends LearningWorldHandle {}
