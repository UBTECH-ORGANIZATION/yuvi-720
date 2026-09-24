import * as THREE from 'three'
import type { Theme } from '../../providers/ThemeProvider'
import type { RenderTier } from '../Yuvi-studio/renderTier'
import { roadmapBackgroundBlend } from './roadmapModel.ts'
import { BACKGROUND_ART, MUSIC_GLYPHS } from './RoadmapBackgroundArt.ts'

const PALETTES = {
  light: [
    [0xa6cbd4, 0xecf3f1, 0x587d83, 0xffffff, 0x82ada0],
    [0xadbfd8, 0xe3e9f2, 0x34406c, 0xc58c69, 0x688eaa],
    [0xe4d6d2, 0xf3eae3, 0x746876, 0xcc777e, 0x559f9b],
    [0xd4dddd, 0xf0f0e9, 0x747d7e, 0xd57483, 0x389b91],
    [0xb9d9bb, 0xe8efda, 0x396858, 0xd2b76b, 0x76a887],
  ],
  dark: [
    [0x162e39, 0x49646c, 0x1e4446, 0xb9d8dc, 0x3d7568],
    [0x070b15, 0x182236, 0x53688d, 0xc59a79, 0x4a8797],
    [0x201c26, 0x39333e, 0x121820, 0xc85b76, 0x47a39c],
    [0x252a2d, 0x444b4c, 0x161d20, 0xd86783, 0x4ea899],
    [0x102a26, 0x294c40, 0x102c27, 0xc4af67, 0x397b57],
  ],
} as const

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FRAGMENT = `
  uniform float uFrom;
  uniform float uTo;
  uniform float uMix;
  uniform float uTime;
  uniform float uAspect;
  uniform float uLight;
  uniform sampler2D uAstronaut;
  uniform float uAstronautReady;
  uniform vec3 uTop[5];
  uniform vec3 uBottom[5];
  uniform vec3 uInk[5];
  uniform vec3 uAccent[5];
  uniform vec3 uSecondary[5];
  varying vec2 vUv;
  float hash(float seed) { return fract(sin(seed * 127.1) * 43758.5453); }
  float fill(float distance) { return 1.0 - smoothstep(-0.002, 0.003, distance); }
  float rect(vec2 point, vec2 halfSize) { return fill(max(abs(point.x) - halfSize.x, abs(point.y) - halfSize.y)); }
  float disk(vec2 point, float radius) { return fill(length(point) - radius); }
  mat2 turn(float angle) { return mat2(cos(angle), -sin(angle), sin(angle), cos(angle)); }
  float line(vec2 point, vec2 start, vec2 end, float width) {
    vec2 along = end - start;
    return fill(length(point - start - along * clamp(dot(point-start, along) / dot(along,along),0.0,1.0)) - width);
  }
  float ridge(float across, float offset) {
    return 0.27 + 0.09 * sin(across * 9.0 + offset) + 0.065 * sin(across * 17.0 + offset * 2.0)
      + 0.05 * abs(sin(across * 23.0 + offset));
  }
  vec3 snowyFir(vec2 point, float height, float seed) {
    vec2 local = point / height;
    if (abs(local.x)>0.4 || local.y<0.0 || local.y>1.0) return vec3(0.0);
    float coreWidth=(1.0-local.y)*0.3*(0.94+0.055*sin(local.y*143.0+seed));
    float foliage=fill(abs(local.x)-coreWidth)*smoothstep(0.07,0.17,local.y)*(1.0-smoothstep(0.91,0.97,local.y));
    float snow = 0.0;
    for (int layer = 0; layer < 11; layer++) {
      float rank = float(layer);
      float base = 0.12 + rank * 0.071;
      float width = (0.34 - rank * 0.027) * (0.88 + hash(seed + rank) * 0.22);
      float across = local.x + sin(rank * 3.7 + seed) * 0.013;
      float reach = abs(across) / width;
      float top = base + 0.18 - reach * 0.11 - reach * reach * 0.045 + sin(across*62.0+seed+rank)*0.006;
      float needles = sin(across * 340.0 + rank * 7.0) * 0.009 + sin(across * 173.0) * 0.008;
      float bottom = top - 0.125 * (1.0-reach*0.35) + needles;
      float branch = (1.0-smoothstep(0.94,1.04,reach)) * smoothstep(bottom-0.009,bottom+0.009,local.y) * (1.0-smoothstep(top-0.005,top+0.008,local.y));
      float cap = branch * smoothstep(top-0.065+sin(across*59.0+rank)*0.012,top-0.022,local.y);
      foliage = max(foliage,branch);
      snow = max(snow,cap);
    }
    float trunk = rect(point-vec2(0.0,height*0.46),vec2(height*0.018,height*0.46));
    return vec3(foliage,snow,trunk);
  }
  ${BACKGROUND_ART}
  vec3 environment(int world) {
    vec2 uv = vUv;
    vec2 point = vec2((uv.x - 0.5) * uAspect, uv.y);
    float edge = smoothstep(0.16, 0.49, abs(uv.x - 0.5));
    vec3 top = uTop[world], bottom = uBottom[world], ink = uInk[world];
    vec3 accent = uAccent[world], secondary = uSecondary[world];
    vec3 color = mix(bottom, top, smoothstep(0.0, 1.0, uv.y));
    if (world == 0) {
      float back = ridge(uv.x, 0.8) + 0.12;
      float front = ridge(uv.x, 3.2);
      color = mix(color, mix(bottom, ink, 0.23), fill(uv.y - back));
      color = mix(color, mix(accent, bottom, 0.25), fill(uv.y - back) * smoothstep(back - 0.075, back, uv.y));
      color = mix(color, mix(bottom, ink, 0.37), fill(uv.y - front));
      color = mix(color, mix(accent, bottom, 0.12), fill(uv.y - front) * smoothstep(front - 0.06, front, uv.y));
      for (int index = 0; index < 14; index++) {
        float seed = float(index);
        float across = hash(seed + 3.0);
        float height = 0.12 + hash(seed + 29.0) * 0.17;
        vec2 tree = vec2((uv.x - across) * uAspect, uv.y - 0.06 - hash(seed+8.0) * 0.08);
        vec3 treeMasks = snowyFir(tree,height,seed);
        float shade = clamp(0.7-tree.x/height,0.3,1.0);
        float needleGrain = 0.84+0.16*sin(tree.x*3100.0+sin(tree.y*1700.0));
        vec3 evergreen = mix(ink*0.52,secondary*0.7,shade) * needleGrain;
        color = mix(color,mix(ink,vec3(0.22,0.16,0.1),0.3),treeMasks.z*0.8);
        color = mix(color,evergreen,treeMasks.x*(0.7+edge*0.3));
        color = mix(color,mix(accent*0.66,accent,shade),treeMasks.y*(0.85+edge*0.15));
      }
    } else if (world == 1) {
      color=deepStarfield(color,point,ink,uLight);
      color=starTrails(color,point,ink,uLight);
      vec2 planet = point - vec2(uAspect * 0.34, 0.7);
      vec2 orbit = turn(-0.42) * planet;
      float ringRadius = length(orbit / vec2(1.0, 0.31));
      float rings = fill(abs(ringRadius - 0.205) - 0.026);
      color = mix(color, mix(accent, bottom, 0.35), rings * 0.7);
      float radius = 0.137;
      float body = disk(planet, radius);
      float shade = 0.35 + 0.65 * clamp(0.5 - planet.x / radius, 0.0, 1.0);
      vec3 bands = mix(accent, secondary, 0.22 + 0.13 * sin(planet.y * 210.0 + sin(planet.x * 20.0)));
      color = mix(color, bands * shade, body);
      color = mix(color, accent, rings * step(orbit.y, 0.0) * 0.58);
      vec2 moon = point - vec2(-uAspect * 0.31, 0.68);
      color=lunarSurface(color,moon,min(0.125,uAspect*0.2));
      float figureScale=min(0.092,uAspect*0.19);
      vec2 astronaut=point-orbitalDrift(0.24,0.009,0.56,0.2);
      astronaut=turn(-0.23+uTime*0.07)*astronaut/figureScale;
      color=astronautArt(color,astronaut);
      vec2 station=point-vec2(-uAspect*0.31,0.2+sin(uTime*0.15+1.0)*0.012);
      station=turn(0.22+uTime*0.024)*station/min(0.095,uAspect*0.14);
      color=spaceStationArt(color,station);
      vec2 snack=point-orbitalDrift(0.73,-0.018,0.35,-0.25);
      snack=turn(uTime*0.34)*snack/min(0.062,uAspect*0.13);
      color=doughnutArt(color,snack);
      vec2 dog=point-orbitalDrift(0.4,0.012,0.66,-0.19);
      dog=turn(-0.4-uTime*0.22)*dog/min(0.078,uAspect*0.16);
      color=dogArt(color,dog);
    } else if (world == 2) {
      float side = abs(point.x);
      float tower = abs(side - uAspect * 0.43);
      float truss = max(rect(vec2(tower, uv.y-0.36), vec2(0.008,0.28)), rect(vec2(tower-0.055,uv.y-0.36),vec2(0.005,0.28)));
      float braces = fill(abs(fract(uv.y * 12.0) - tower * 14.0) - 0.065) * step(tower,0.055) * step(uv.y,0.64);
      color = mix(color, ink, max(truss,braces) * 0.6);
      float crossbar = rect(vec2(point.x,uv.y-0.64),vec2(uAspect*0.46,0.005));
      color = mix(color,ink,crossbar*edge*0.55);
      for (int index=0; index<2; index++) {
        float direction = index == 0 ? -1.0 : 1.0;
        vec2 source = vec2(direction*uAspect*0.41,0.64);
        vec2 beam = turn(direction * (0.25 + 0.05*sin(uTime*0.23))) * (point-source);
        float cone = (1.0-smoothstep(0.015,0.12,max(0.0,abs(beam.x) + beam.y*0.19))) * step(beam.y,0.0) * smoothstep(-0.65,0.0,beam.y);
        color = mix(color, index == 0 ? accent : secondary, cone * 0.27 * (0.2+edge*0.8));
        color = mix(color,ink,rect(point-source,vec2(0.028,0.015))*0.75);
        color = mix(color,index == 0 ? accent : secondary,disk(point-source-vec2(0.0,-0.016),0.015)*0.85);
      }
      float column = floor(uv.x * 34.0);
      float height = 0.04 + hash(column+7.0)*0.13 + 0.012*sin(uTime*0.7+column);
      float bar = step(fract(uv.x*34.0),0.66) * fill(uv.y-height);
      color = mix(color, mix(accent,secondary,hash(column)),bar*0.4);
      vec2 record = point - vec2(-uAspect*0.32,0.72);
      float grooves = 0.12 * sin(length(record)*620.0);
      color = mix(color, ink*(0.9+grooves),disk(record,0.095)*0.8);
      color = mix(color,accent,disk(record,0.027));
      color = mix(color,bottom,disk(record,0.007));
    } else if (world == 3) {
      float column = floor(uv.x*8.0);
      float roof=0.23+hash(column+11.0)*0.13;
      float building=fill(uv.y-roof);
      float facadeX=fract(uv.x*8.0)-0.5;
      vec3 masonry=mix(vec3(0.39,0.23,0.19),vec3(0.54,0.46,0.35),hash(column+3.0));
      masonry*=mix(0.4,1.0,uLight);
      color=mix(color,masonry,building*0.85);
      color=mix(color,ink,rect(vec2(facadeX,uv.y-roof),vec2(0.48,0.012))*0.75);
      vec2 windowCell=vec2(fract(uv.x*24.0)-0.5,fract(uv.y*19.0)-0.5);
      float frame=rect(windowCell,vec2(0.29,0.35))*building;
      float glass=rect(windowCell,vec2(0.22,0.28))*building;
      color=mix(color,mix(bottom,ink,0.4),frame*0.8);
      color=mix(color,mix(ink,vec3(0.53,0.41,0.19),0.28*(1.0-uLight)),glass*0.85);
      float sash=max(rect(windowCell,vec2(0.025,0.28)),rect(windowCell,vec2(0.22,0.025)))*glass;
      color=mix(color,mix(bottom,ink,0.5),sash*0.7);
      vec2 tank=vec2(facadeX*0.15*uAspect,uv.y-roof-0.045);
      float waterTank=rect(tank,vec2(0.026,0.025));
      float tankRoof=fill(abs(tank.x)-(0.032-(tank.y-0.024)*1.5))*step(0.024,tank.y)*step(tank.y,0.045);
      float tankFeet=max(line(tank,vec2(-0.018,-0.02),vec2(-0.025,-0.045),0.002),line(tank,vec2(0.018,-0.02),vec2(0.025,-0.045),0.002));
      color=mix(color,ink,max(tankFeet,tankRoof)*step(0.5,hash(column)));
      color=mix(color,mix(ink,masonry,0.6)*(0.8+cos(tank.x*45.0)*0.2),waterTank*step(0.5,hash(column)));
      float tankBands=step(0.86,fract((tank.y+0.025)*70.0))*waterTank;
      color=mix(color,ink,tankBands*step(0.5,hash(column)));
      float wall = smoothstep(0.2,0.38,abs(uv.x-0.5)) * (1.0-smoothstep(0.56,0.69,uv.y));
      vec2 brick = vec2(uv.x*36.0*uAspect,uv.y*48.0);
      brick.x += mod(floor(brick.y),2.0)*0.5;
      float mortar = step(0.94,max(fract(brick.x),fract(brick.y)));
      float brickGrain=hash(floor(uv.x*1300.0)+floor(uv.y*1300.0)*71.0);
      vec3 wallColor=mix(mix(vec3(0.42,0.25,0.21),bottom,0.4),ink,0.22+mortar*0.13);
      color=mix(color,wallColor*(0.93+brickGrain*0.1),wall);
      vec2 mural = vec2((abs(uv.x-0.5)-0.36)*uAspect,uv.y-0.35)/min(0.145,uAspect*0.21);
      mural=turn(uv.x<0.5?-0.12:0.12)*mural;
      float spray=fill(abs(length(mural/vec2(1.0,1.22))-0.9)-0.045);
      color=mix(color,uv.x<0.5?accent:secondary,spray*wall*0.75);
      float wear=wall*(0.82+brickGrain*0.18)*(1.0-mortar*0.3);
      color=yubiMuralArt(color,mural,uv.x<0.5?1.0:-1.0,wear);
      float escapeX=abs(uv.x-0.5)-0.456;
      float landing=rect(vec2(escapeX,fract(uv.y*8.0)/8.0-0.017),vec2(0.035,0.003));
      float rails=rect(vec2(abs(escapeX)-0.028,fract(uv.y*8.0)/8.0-0.035),vec2(0.0015,0.022));
      float ladder=line(vec2(escapeX,fract(uv.y*8.0)/8.0),vec2(-0.023,0.024),vec2(0.023,0.116),0.002);
      float secondRail=line(vec2(escapeX,fract(uv.y*8.0)/8.0),vec2(-0.036,0.024),vec2(0.01,0.116),0.002);
      for (int rung=0;rung<5;rung++) {
        float height=0.035+float(rung)*0.016;
        float across=-0.023+(height-0.024)*0.5;
        ladder=max(ladder,line(vec2(escapeX,fract(uv.y*8.0)/8.0),vec2(across-0.013,height),vec2(across,height),0.0015));
      }
      color=mix(color,ink,max(landing,max(rails,max(ladder,secondRail)))*wall*0.8);
      for (int stair=0;stair<5;stair++) {
        float rise=float(stair);
        float stoop=rect(vec2(abs(uv.x-0.5)-0.34,uv.y-0.012-rise*0.014),vec2(0.064-rise*0.007,0.007));
        color=mix(color,mix(ink,bottom,0.25+rise*0.055),stoop*wall);
      }
    } else {
      float hills = 0.19 + 0.055*sin(uv.x*12.0) + 0.035*sin(uv.x*24.0);
      color = mix(color,mix(secondary,bottom,0.5),fill(uv.y-hills));
      for (int index=0; index<12; index++) {
        float seed=float(index);
        float side = mod(seed,2.0)*2.0-1.0;
        float across = side*(0.34+hash(seed+2.0)*0.19);
        float trunk = line(point,vec2(across*uAspect,-0.1),vec2(across*uAspect*0.95,0.8),0.009+hash(seed)*0.013);
        color = mix(color,mix(ink,secondary,hash(seed+4.0)*0.6),trunk*edge*0.6);
        vec2 leaf = point-vec2(across*uAspect,0.87-hash(seed+8.0)*0.4);
        leaf = turn(side*(0.4+hash(seed+12.0))) * leaf;
        float leafHeight = leaf.y/0.17;
        float shape = fill(abs(leaf.x)/(0.07+hash(seed)*0.06)+leafHeight*leafHeight-1.0);
        color=mix(color,mix(ink,secondary,hash(seed+30.0)),shape*(0.55+edge*0.35));
        float vein = line(leaf,vec2(0.0,-0.15),vec2(0.0,0.15),0.0015);
        for (int branch=0;branch<4;branch++) {
          float base = -0.09+float(branch)*0.05;
          vein=max(vein,line(leaf,vec2(0.0,base),vec2(0.07,base+0.04),0.0008));
          vein=max(vein,line(leaf,vec2(0.0,base),vec2(-0.07,base+0.04),0.0008));
        }
        color=mix(color,secondary,shape*vein*0.55);
      }
      float canopy=fill(0.96-0.05*sin(uv.x*22.0)-uv.y);
      color=mix(color,ink,canopy*0.55);
      float rays=pow(max(0.0,sin(uv.x*19.0+uv.y*5.0)),12.0)*uv.y*edge;
      color=mix(color,accent,rays*0.045);
    }
    float headingVeil = smoothstep(0.72,0.86,uv.y) * 0.93;
    return mix(color,mix(bottom,top,uv.y),headingVeil);
  }
  void main() {
    vec3 color = environment(int(uFrom));
    if (uMix > 0.0) color = mix(color, environment(int(uTo)), uMix);
    gl_FragColor = vec4(color,1.0);
    #include <colorspace_fragment>
  }
`

export function createRoadmapBackground(theme: Theme, tier: RenderTier, reducedMotion: boolean, bakeAstronaut?: (renderer: THREE.WebGLRenderer) => THREE.WebGLRenderTarget) {
  const colors = () => Array.from({ length: 5 }, () => new THREE.Color())
  const uniforms = {
    uFrom: { value: 0 }, uTo: { value: 1 }, uMix: { value: 0 }, uTime: { value: 0 },
    uAspect: { value: 1 }, uLight: { value: 0 }, uPixelRatio: { value: 1 }, uParticleLimit: { value: 450 },
    uAstronaut: { value: null as THREE.Texture | null }, uAstronautReady: { value: 0 },
    uTop: { value: colors() }, uBottom: { value: colors() }, uInk: { value: colors() },
    uAccent: { value: colors() }, uSecondary: { value: colors() },
  }
  const scene = new THREE.Scene()
  const camera = new THREE.Camera()
  const geometry = new THREE.PlaneGeometry(2, 2)
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, depthTest: false, depthWrite: false, toneMapped: false })
  const backdrop = new THREE.Mesh(geometry, material)
  backdrop.frustumCulled = false
  scene.add(backdrop)
  const positions = new Float32Array(1350 * 3)
  const seeds = new Float32Array(1350 * 4)
  const indices = new Float32Array(1350)
  for (let index = 0; index < 1350; index++) {
    const seed = Math.floor(index / 2)
    const random = (salt: number) => { const value = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453; return value - Math.floor(value) }
    seeds.set([random(1), random(2), random(3), index % 2], index * 4)
    indices[index] = index
  }
  const particleGeometry = new THREE.BufferGeometry()
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  particleGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
  particleGeometry.setAttribute('aIndex', new THREE.BufferAttribute(indices, 1))
  const particleMaterial = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: `
      attribute vec4 aSeed;
      attribute float aIndex;
      uniform float uFrom, uTo, uMix, uTime, uPixelRatio, uAspect;
      uniform float uParticleLimit;
      varying float vWorld, vOpacity, vSeed;
      void main() {
        vWorld = aSeed.w < 0.5 ? uFrom : uTo;
        vOpacity = aSeed.w < 0.5 ? 1.0-uMix : uMix;
        if (vWorld > 0.5 && aIndex >= uParticleLimit) vOpacity = 0.0;
        vSeed = aSeed.z;
        vec2 point = aSeed.xy;
        float size = 2.0;
        if (vWorld < 0.5) {
          point.y = fract(point.y-uTime*(0.023+aSeed.z*0.05));
          point.x = fract(point.x+uTime*0.008+sin(uTime*0.35+aSeed.y*20.0)*0.014);
          size = 2.0+aSeed.z*4.5;
        } else if (vWorld < 1.5) {
          point.x=fract(point.x+uTime*0.0015);
          size=1.5+aSeed.z*2.2;
        } else if (vWorld < 2.5) {
          point.y=fract(point.y+uTime*0.009);
          point.x=fract(point.x+sin(uTime*0.12+aSeed.y*20.0)*0.012);
          size=18.0+aSeed.z*24.0;
          vOpacity*=0.7;
        } else if (vWorld < 3.5) {
          point.y=fract(point.y-uTime*0.008);
          point.x=fract(point.x+sin(uTime*0.17+aSeed.y*20.0)*0.008);
          size=2.0+aSeed.z*3.0;
          vOpacity*=0.25;
        } else {
          point.y=fract(point.y-uTime*0.012);
          point.x=fract(point.x+sin(uTime*0.3+aSeed.y*25.0)*0.023);
          size=3.0+aSeed.z*5.0;
          vOpacity*=0.4;
        }
        vOpacity *= 0.3+0.7*smoothstep(0.12,0.45,abs(point.x-0.5));
        vOpacity *= 1.0-smoothstep(0.72,0.86,point.y);
        gl_Position=vec4(point*2.0-1.0,0.0,1.0);
        gl_PointSize=vOpacity<0.01?1.0:size*uPixelRatio;
      }
    `,
    fragmentShader: `
      uniform float uLight;
      uniform vec3 uAccent[5], uSecondary[5], uInk[5];
      varying float vWorld, vOpacity, vSeed;
      ${MUSIC_GLYPHS}
      void main() {
        if (vOpacity<0.01) discard;
        vec2 point=gl_PointCoord-0.5;
        float alpha=1.0-smoothstep(0.23,0.5,length(point));
        int world=int(vWorld);
        vec3 color=mix(uAccent[world],uSecondary[world],vSeed);
        if (vWorld<0.5) color=mix(vec3(0.96,0.99,1.0),vec3(0.57,0.72,0.77),uLight*0.35);
        else if (vWorld<1.5) color=mix(vec3(0.88,0.95,1.0),uInk[world],uLight);
        else if (vWorld>1.5 && vWorld<2.5) {
          vec2 glyph=vec2(point.x,-point.y)*2.0;
          alpha=vSeed>0.72?trebleClef(glyph):noteGlyph(glyph,step(0.38,vSeed));
          color=mix(color,uInk[world],uLight*0.45);
        }
        else if (vWorld>3.5) alpha=1.0-smoothstep(0.7,1.0,length(point/vec2(0.24,0.48)));
        else alpha=1.0-smoothstep(0.22,0.48,abs(point.x)+abs(point.y));
        if (alpha*vOpacity<0.01) discard;
        gl_FragColor=vec4(color,alpha*vOpacity*0.8);
        #include <colorspace_fragment>
      }
    `,
  })
  const particles = new THREE.Points(particleGeometry, particleMaterial)
  particles.frustumCulled = false
  scene.add(particles)
  const fogColor = new THREE.Color()
  let astronautTarget: THREE.WebGLRenderTarget | undefined
  const resetAstronaut = () => {
    astronautTarget?.dispose()
    astronautTarget = undefined
    uniforms.uAstronaut.value = null
    uniforms.uAstronautReady.value = 0
  }
  const setTheme = (next: Theme) => {
    uniforms.uLight.value = next === 'light' ? 1 : 0
    const groups = [uniforms.uTop, uniforms.uBottom, uniforms.uInk, uniforms.uAccent, uniforms.uSecondary]
    PALETTES[next].forEach((palette, world) => palette.forEach((hex, index) => groups[index].value[world].setHex(hex)))
  }
  const setQuality = (next: RenderTier) => {
    uniforms.uParticleLimit.value = next === 'low' ? 80 : next === 'medium' ? 220 : 450
    particleGeometry.setDrawRange(0, uniforms.uParticleLimit.value * 3)
  }
  setTheme(theme)
  setQuality(tier)
  return {
    scene, fogColor, setTheme, setQuality, resetAstronaut,
    update(progress: number, time: number, aspect: number, pixelRatio: number) {
      const blend = roadmapBackgroundBlend(progress)
      uniforms.uFrom.value = blend.from
      uniforms.uTo.value = blend.to
      uniforms.uMix.value = blend.mix
      uniforms.uTime.value = reducedMotion ? 0 : time
      uniforms.uAspect.value = aspect
      uniforms.uPixelRatio.value = pixelRatio
      fogColor.copy(uniforms.uBottom.value[blend.from]).lerp(uniforms.uBottom.value[blend.to], blend.mix)
    },
    render(renderer: THREE.WebGLRenderer) {
      const spaceVisible = uniforms.uFrom.value === 1 || (uniforms.uTo.value === 1 && uniforms.uMix.value > 0)
      if (spaceVisible && bakeAstronaut && !astronautTarget) {
        astronautTarget = bakeAstronaut(renderer)
        uniforms.uAstronaut.value = astronautTarget.texture
        uniforms.uAstronautReady.value = 1
      }
      renderer.render(scene, camera)
    },
    dispose() {
      resetAstronaut()
      geometry.dispose()
      material.dispose()
      particleGeometry.dispose()
      particleMaterial.dispose()
      scene.clear()
    },
  }
}