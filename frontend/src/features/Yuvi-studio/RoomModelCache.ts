import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Resolves a model key — a prop id or a URL, whatever the caller's loader reads — to its scene. */
type ModelLoader = (key: string) => Promise<THREE.Object3D>

/** Every model is attached to its holder after the first frame, so the
 *  renderer gets it here first — to compile its programs off the frame that
 *  would otherwise stall on them (see `precompile` in YuviAvatar3D). */
type ModelAttached = (holder: THREE.Object3D) => void

export function createRoomModelCache(
  load: ModelLoader = async (url) => (await new GLTFLoader().loadAsync(url)).scene,
  onAttached: ModelAttached = () => undefined,
) {
  const pending = new Map<string, Promise<THREE.Object3D>>()
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>()
  let disposed = false

  const collect = (root: THREE.Object3D) => {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      resources.add(node.geometry)
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        resources.add(material)
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) resources.add(value)
        }
      }
    })
  }
  const release = () => {
    for (const resource of resources) resource.dispose()
    resources.clear()
  }

  return {
    model(url: string, size: readonly [number, number, number]) {
      const holder = new THREE.Group()
      holder.userData.roomModel = true
      holder.userData.assetState = disposed ? 'disposed' : 'loading'
      if (disposed) return holder
      let request = pending.get(url)
      if (!request) {
        request = load(url).then((root) => {
          collect(root)
          if (disposed) release()
          return root
        })
        pending.set(url, request)
      }
      holder.userData.assetReady = request.then((root) => {
        if (disposed || holder.userData.assetPreview) {
          holder.userData.assetState = disposed ? 'disposed' : 'preview'
          return
        }
        const model = root.clone(true)
        const bounds = new THREE.Box3().setFromObject(model)
        const extent = bounds.getSize(new THREE.Vector3())
        const scale = Math.min(...size.map((limit, index) => limit / Math.max(extent.getComponent(index), 0.00001)))
        const center = bounds.getCenter(new THREE.Vector3())
        model.scale.multiplyScalar(scale)
        model.position.add(new THREE.Vector3(-center.x, -bounds.min.y, -center.z).multiplyScalar(scale))
        holder.add(model)
        holder.userData.assetState = 'ready'
        onAttached(holder)
      }).catch(() => { holder.userData.assetState = 'error' })
      return holder
    },
    dispose() {
      disposed = true
      pending.clear()
      release()
    },
  }
}