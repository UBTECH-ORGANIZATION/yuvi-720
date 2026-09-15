/* Material class per render tier. Kept apart from renderTier.ts because this
   one needs Three.js, and the dock asks for the tier from the main chunk. */
import * as THREE from 'three'

/** The parameters only `MeshPhysicalMaterial` understands. Stripped for the
 *  low tier, which shades with `MeshStandardMaterial` — clearcoat and sheen
 *  are a second specular lobe per light per fragment, and on an Intel UHD
 *  that is the difference between 20 and 40 fps in the room. */
const PHYSICAL_ONLY = [
  'clearcoat', 'clearcoatRoughness', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'sheen', 'sheenColor', 'sheenRoughness', 'sheenColorMap', 'sheenRoughnessMap',
  'iridescence', 'iridescenceIOR', 'iridescenceThicknessRange', 'iridescenceMap', 'iridescenceThicknessMap',
  'transmission', 'thickness', 'attenuationDistance', 'attenuationColor', 'ior', 'reflectivity',
  'specularIntensity', 'specularColor', 'anisotropy', 'anisotropyRotation', 'dispersion',
] as const

/** Build a shell material. `physical` = medium/high (today's look, byte for
 *  byte); otherwise a Standard material with the same base colour, roughness,
 *  metalness and env intensity. Glass keeps `transparent`/`opacity` either way. */
export function shellMaterial(
  physical: boolean,
  params: THREE.MeshPhysicalMaterialParameters,
): THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial {
  if (physical) return new THREE.MeshPhysicalMaterial(params)
  const standard: Record<string, unknown> = { ...params }
  for (const key of PHYSICAL_ONLY) delete standard[key]
  return new THREE.MeshStandardMaterial(standard as THREE.MeshStandardMaterialParameters)
}
