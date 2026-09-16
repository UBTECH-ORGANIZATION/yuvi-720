export const PLAYGROUND_EQUIPMENT = {
  parkPlayStructure: { radius: 8.3 / 1.75, height: 5.8 / 1.75, scale: 0.85, centreX: -12.8, centreZ: -7.3 },
  parkDiscoverySand: { radius: 5.4 / 1.75, height: 1.9 / 1.75, scale: 0.65, centreX: -15.5, centreZ: 23 },
  parkSpringRider: { radius: 0.8 / 1.75, height: 1.6 / 1.75, scale: 1, centreX: -1, centreZ: 29.5 },
  parkSeesaw: { radius: 2.3 / 1.75, height: 1.5 / 1.75, scale: 1, centreX: -3, centreZ: 25.6 },
  parkTree: { radius: 3.7 / 1.75, height: 9 / 1.75, scale: 1, centreX: 0, centreZ: 0 },
  parkFlowerBed: { radius: 4.5 / 1.75, height: 1 / 1.75, scale: 1, centreX: 0, centreZ: 0 },
} as const

export type PlaygroundEquipmentKind = keyof typeof PLAYGROUND_EQUIPMENT

export const PLAYGROUND_EDITABLE_DEFAULTS = [
  { uid: 'park-editable-towers', kind: 'parkPlayStructure', x: -12, z: -8, rot: 0 },
  { uid: 'park-editable-discovery', kind: 'parkDiscoverySand', x: -14, z: 21, rot: 0 },
  { uid: 'park-editable-rider', kind: 'parkSpringRider', x: -1, z: 27, rot: 0 },
  { uid: 'park-editable-seesaw', kind: 'parkSeesaw', x: 7, z: 22, rot: 0 },
  { uid: 'park-editable-tree-west', kind: 'parkTree', x: -20, z: 28, rot: 0 },
  { uid: 'park-editable-tree-east', kind: 'parkTree', x: 20, z: -10, rot: 0 },
  { uid: 'park-editable-flowers', kind: 'parkFlowerBed', x: 12, z: 12, rot: 0 },
]