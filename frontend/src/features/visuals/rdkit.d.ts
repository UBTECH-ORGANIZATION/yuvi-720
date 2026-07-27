/* RDKit.js ships types for its molecule interfaces but not for the CommonJS
   init factory its runtime file exports, and the .wasm asset import is a Vite
   convention TypeScript cannot infer. Both are declared here so MoleculeScene
   stays type-checked rather than reaching for `any`. */

declare module '@rdkit/rdkit/dist/RDKit_minimal.js' {
  const initRDKitModule: (options: { locateFile: () => string }) => Promise<unknown>
  export default initRDKitModule
}

declare module '*.wasm?url' {
  const url: string
  export default url
}
