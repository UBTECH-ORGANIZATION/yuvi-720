export const BACKGROUND_ART = `
  float lunarNoise(vec2 point) {
    vec2 cell=floor(point),fraction=fract(point);
    vec2 blend=fraction*fraction*(3.0-2.0*fraction);
    float seed=cell.x+cell.y*157.0;
    return mix(mix(hash(seed),hash(seed+1.0),blend.x),mix(hash(seed+157.0),hash(seed+158.0),blend.x),blend.y);
  }
  float lunarTerrain(vec2 point) {
    float terrain=0.0,weight=0.5;
    for (int octave=0;octave<4;octave++) {
      terrain+=lunarNoise(point)*weight;
      point=mat2(1.6,-1.2,1.2,1.6)*point+vec2(13.1,7.7);
      weight*=0.5;
    }
    return terrain;
  }
  vec3 lunarSurface(vec3 color, vec2 point, float radius) {
    vec2 local=point/radius;
    float edgeWidth=max(fwidth(length(local)),0.0001);
    float silhouette=1.0-smoothstep(1.0-edgeWidth*0.5,1.0+edgeWidth*0.5,length(local));
    if (silhouette<0.001) return color;
    float depth=sqrt(max(0.0,1.0-dot(local,local)));
    vec3 normal=normalize(vec3(local,depth));
    vec3 sunlightDirection=normalize(vec3(-0.48,0.32,0.82));
    vec2 terrainPoint=vec2(atan(normal.x,max(normal.z,0.001)),asin(clamp(normal.y,-1.0,1.0)));
    float terrain=lunarTerrain(terrainPoint*9.0);
    vec2 warped=terrainPoint+vec2(lunarTerrain(terrainPoint*6.0),lunarTerrain(terrainPoint*6.0+31.0))*0.16-0.08;
    float maria=0.0;
    maria=max(maria,1.0-smoothstep(0.72,1.08,length((warped-vec2(-0.45,0.18))/vec2(0.37,0.64))));
    maria=max(maria,1.0-smoothstep(0.75,1.07,length((warped-vec2(-0.13,0.48))/vec2(0.37,0.3))));
    maria=max(maria,1.0-smoothstep(0.74,1.08,length((warped-vec2(0.37,0.3))/vec2(0.25,0.32))));
    maria=max(maria,1.0-smoothstep(0.75,1.05,length((warped-vec2(0.57,-0.03))/vec2(0.23,0.29))));
    float fineDetail=lunarTerrain(terrainPoint*65.0)-0.47;
    float rock=mix(0.66,0.34,maria)+terrain*0.22+fineDetail*0.16;
    vec3 relief=vec3(0.0);
    for (int crater=0;crater<48;crater++) {
      float seed=float(crater);
      float azimuth=hash(seed+16.0)*6.283185;
      float radial=sqrt(hash(seed+71.0))*0.97;
      vec2 center=vec2(cos(azimuth),sin(azimuth))*radial;
      if (crater==0) center=vec2(-0.17,-0.62);
      if (crater==1) center=vec2(-0.36,0.02);
      vec3 craterNormal=vec3(center,sqrt(1.0-dot(center,center)));
      float size=crater<9?0.065+hash(seed+102.0)*0.065:0.013+hash(seed+102.0)*0.041;
      vec3 offset=normal-craterNormal;
      float distance=length(offset)/size;
      float craterAA=max(edgeWidth/size,0.035);
      float bowl=1.0-smoothstep(0.72,0.9+craterAA,distance);
      float rim=1.0-smoothstep(0.055,0.14+craterAA,abs(distance-1.0));
      vec3 outward=normalize(offset-normal*dot(offset,normal)+vec3(0.00001));
      float innerWall=smoothstep(0.28,0.65,distance)*(1.0-smoothstep(0.8,1.0,distance));
      float outerWall=smoothstep(0.98,1.08,distance)*(1.0-smoothstep(1.14,1.38,distance));
      relief+=outward*(outerWall*0.35-innerWall*0.65);
      rock-=bowl*0.055;
      rock+=rim*0.12+(1.0-smoothstep(0.04,0.18+craterAA,distance))*0.07;
      if (crater<2) {
        float angle=atan(local.y-center.y,local.x-center.x);
        float rays=pow(max(0.0,sin(angle*23.0+sin(angle*11.0)*2.0)),14.0);
        float ejecta=smoothstep(1.25,1.7,distance)*(1.0-smoothstep(2.0,crater==0?8.0:4.5,distance));
        rock+=rays*ejecta*0.095;
      }
    }
    float sunlight=max(0.0,dot(normalize(normal+relief),sunlightDirection));
    float phase=smoothstep(-0.015,0.055,dot(normal,sunlightDirection));
    float illumination=0.035+phase*(0.16+0.8*sunlight);
    vec3 stone=vec3(0.93,0.94,0.96)*clamp(rock,0.12,1.0)*illumination;
    return mix(color,stone,silhouette);
  }
  vec3 deepStarfield(vec3 color, vec2 point, vec3 ink, float light) {
    for (int layer=0;layer<2;layer++) {
      float scale=layer==0?91.0:37.0;
      vec2 grid=point*scale;
      vec2 cell=floor(grid);
      float seed=hash(cell.x+cell.y*137.0+float(layer)*491.0);
      vec2 offset=fract(grid)-vec2(0.2+hash(seed+9.0)*0.6,0.2+hash(seed+17.0)*0.6);
      float core=1.0-smoothstep(0.018,layer==0?0.065:0.095,length(offset));
      float rays=(1.0-smoothstep(0.005,0.023,min(abs(offset.x),abs(offset.y))))*(1.0-smoothstep(0.035,0.2,max(abs(offset.x),abs(offset.y))));
      float star=max(core,rays*step(0.975,seed))*step(layer==0?0.68:0.87,seed);
      vec3 tint=mix(vec3(0.7,0.85,1.0),vec3(1.0,0.89,0.68),hash(seed+4.0));
      color=mix(color,mix(tint,ink,light*0.8),star*(layer==0?0.48:0.9));
    }
    return color;
  }
  vec3 starTrails(vec3 color, vec2 point, vec3 ink, float light) {
    for (int trail=0;trail<6;trail++) {
      float seed=float(trail);
      float phase=fract(uTime*(0.022+hash(seed+7.0)*0.014)+hash(seed+38.0));
      vec2 head=vec2(mix(-uAspect*0.5-0.24,uAspect*0.5+0.24,phase),0.18+hash(seed+53.0)*0.52-(phase-0.5)*0.24);
      vec2 offset=point-head;
      vec2 direction=normalize(vec2(1.0,-0.24/(uAspect+0.48)));
      float along=dot(offset,direction);
      float across=abs(dot(offset,vec2(-direction.y,direction.x)));
      float trailLength=0.065+hash(seed+82.0)*0.095;
      float taper=smoothstep(-trailLength,0.0,along)*(1.0-smoothstep(0.0,0.005,along));
      float streak=(1.0-smoothstep(0.0005,0.0022,across))*taper;
      float spark=1.0-smoothstep(0.001,0.004,length(offset));
      float visibility=smoothstep(0.03,0.16,phase)*(1.0-smoothstep(0.75,0.96,phase));
      vec3 tint=mix(vec3(0.77,0.9,1.0),ink,light*0.85);
      color=mix(color,tint,max(streak*0.7,spark)*visibility);
    }
    return color;
  }
  vec2 orbitalDrift(float phase, float speed, float height, float slope) {
    float across=fract(phase+uTime*speed);
    return vec2(mix(-0.5*uAspect-0.24,0.5*uAspect+0.24,across),height+slope*(across-0.5));
  }
  float roundedBox(vec2 point, vec2 bounds, float radius) {
    vec2 delta = abs(point)-bounds+radius;
    return fill(length(max(delta,0.0))+min(max(delta.x,delta.y),0.0)-radius);
  }
  vec3 astronautArt(vec3 color, vec2 point) {
    if (abs(point.x)>1.0 || abs(point.y)>1.0 || uAstronautReady<0.5) return color;
    vec4 avatar=texture2D(uAstronaut,point*0.5+0.5);
    return mix(color,avatar.rgb/max(avatar.a,0.001),avatar.a);
  }
  vec3 spaceStationArt(vec3 color, vec2 point) {
    if (abs(point.x)>1.4 || abs(point.y)>1.2) return color;
    vec3 steel=vec3(0.55,0.66,0.7);
    color=mix(color,steel,rect(point,vec2(1.36,0.032)));
    for (int index=0;index<2;index++) {
      float side=float(index)*2.0-1.0;
      vec2 panel=point-vec2(side*0.86,0.0);
      float frame=rect(panel,vec2(0.49,0.44));
      color=mix(color,vec3(0.54,0.57,0.41),frame);
      vec2 cells=fract((panel+vec2(0.45,0.4))*vec2(12.0,15.0));
      float grid=step(0.09,cells.x)*step(0.12,cells.y);
      vec3 solar=mix(vec3(0.17,0.39,0.57),vec3(0.025,0.1,0.25),grid);
      color=mix(color,solar,rect(panel,vec2(0.455,0.405)));
    }
    float module=roundedBox(point,vec2(0.26,0.65),0.2);
    float polish=0.65+0.35*cos(point.x*5.0);
    color=mix(color,steel*polish,module);
    float ribs=step(0.85,fract((point.y+0.65)*8.0));
    color=mix(color,vec3(0.22,0.3,0.36),module*ribs*0.6);
    color=mix(color,vec3(0.06,0.18,0.24),disk(point-vec2(0.0,0.42),0.105));
    color=mix(color,steel,line(point,vec2(0.0,0.6),vec2(0.15,0.94),0.022));
    vec2 dish=turn(-0.35)*(point-vec2(0.16,0.93));
    color=mix(color,vec3(0.8,0.87,0.88),disk(dish/vec2(1.0,0.38),0.24));
    return color;
  }
  vec3 doughnutArt(vec3 color, vec2 point) {
    if (abs(point.x)>0.92 || abs(point.y)>0.92) return color;
    float radius=length(point),angle=atan(point.y,point.x);
    float pastry=fill(abs(radius-0.6)-0.27);
    float shade=0.7+0.3*cos((radius-0.6)*5.0)*(0.8+point.y*0.2);
    color=mix(color,vec3(0.68,0.35,0.12)*shade,pastry);
    float icing=fill(abs(radius-0.62)-0.21-0.025*sin(angle*9.0));
    color=mix(color,vec3(0.92,0.29,0.45)*shade,icing*pastry);
    vec2 cell=floor((point+1.0)*14.0),local=fract((point+1.0)*14.0)-0.5;
    float seed=hash(cell.x+cell.y*35.0);
    local=turn(seed*6.28)*local;
    float sprinkle=rect(local,vec2(0.25,0.08))*step(0.57,seed)*icing*pastry;
    color=mix(color,mix(vec3(0.17,0.85,0.83),vec3(1.0,0.87,0.36),step(0.78,seed)),sprinkle);
    return color;
  }
  vec3 dogArt(vec3 color, vec2 point) {
    if (abs(point.x)>1.35 || abs(point.y)>1.2) return color;
    vec3 fur=vec3(0.72,0.4,0.18),cream=vec3(0.96,0.88,0.7),dark=vec3(0.08,0.045,0.035);
    float tail=line(point,vec2(-0.57,-0.08),vec2(-1.03,0.32),0.075);
    color=mix(color,fur,tail);
    color=mix(color,cream,disk(point-vec2(-1.03,0.32),0.09));
    for (int index=0;index<4;index++) {
      float side=mod(float(index),2.0)*2.0-1.0;
      float along=floor(float(index)/2.0)*0.65-0.36;
      vec2 paw=vec2(along+side*0.15,-0.45-side*0.16);
      color=mix(color,fur,line(point,vec2(along,-0.13),paw,0.09));
      color=mix(color,cream,disk(point-paw,0.115));
    }
    color=mix(color,fur*(0.9+point.y*0.2),disk(point/vec2(1.5,0.83),0.47));
    color=mix(color,cream,disk((point-vec2(0.24,-0.05))/vec2(0.7,1.0),0.28));
    color=mix(color,vec3(0.16,0.66,0.72),line(point,vec2(0.32,-0.17),vec2(0.54,0.21),0.055));
    color=mix(color,vec3(0.95,0.73,0.22),disk(point-vec2(0.5,-0.19),0.07));
    color=mix(color,fur,disk(point-vec2(0.54,0.33),0.35));
    color=mix(color,fur*0.55,disk((turn(-0.4)*(point-vec2(0.3,0.39)))/vec2(0.48,1.0),0.34));
    color=mix(color,cream,disk((point-vec2(0.8,0.23))/vec2(1.25,0.75),0.23));
    color=mix(color,dark,disk(point-vec2(0.98,0.28),0.075));
    color=mix(color,dark,disk(point-vec2(0.65,0.44),0.047));
    color=mix(color,vec3(1.0),disk(point-vec2(0.663,0.455),0.016));
    color=mix(color,vec3(0.94,0.39,0.47),roundedBox(turn(-0.2)*(point-vec2(0.85,0.04)),vec2(0.055,0.095),0.045));
    return color;
  }
  vec3 yubiMuralArt(vec3 color, vec2 point, float pose, float wear) {
    if (abs(point.x)>0.75 || abs(point.y)>1.0 || wear<0.01) return color;
    vec3 outline=vec3(0.025,0.045,0.08),shell=vec3(0.24,0.36,0.8),cyan=vec3(0.28,0.94,0.95);
    for (int index=0;index<2;index++) {
      float side=float(index)*2.0-1.0;
      vec2 shoulder=vec2(side*0.25,-0.25),elbow=vec2(side*0.45,-0.13),hand=vec2(side*0.57,side*pose*0.22-0.02);
      float arm=max(line(point,shoulder,elbow,0.085),line(point,elbow,hand,0.07));
      color=mix(color,outline,max(line(point,shoulder,elbow,0.11),line(point,elbow,hand,0.095))*wear);
      color=mix(color,vec3(0.65,0.38,0.75),arm*wear);
      color=mix(color,shell,disk(point-hand,0.105)*wear);
      float leg=line(point,vec2(side*0.13,-0.59),vec2(side*0.19,-0.82),0.085);
      color=mix(color,outline,line(point,vec2(side*0.13,-0.59),vec2(side*0.19,-0.82),0.108)*wear);
      color=mix(color,vec3(0.55,0.64,0.77),leg*wear);
      color=mix(color,shell,roundedBox(point-vec2(side*0.2,-0.85),vec2(0.135,0.07),0.045)*wear);
    }
    color=mix(color,outline,roundedBox(point-vec2(0.0,-0.42),vec2(0.29,0.27),0.16)*wear);
    color=mix(color,shell,roundedBox(point-vec2(0.0,-0.4),vec2(0.255,0.235),0.14)*wear);
    color=mix(color,cyan,line(point,vec2(-0.13,-0.34),vec2(0.0,-0.43),0.018)*wear);
    color=mix(color,cyan,line(point,vec2(0.13,-0.34),vec2(0.0,-0.43),0.018)*wear);
    color=mix(color,outline,disk(point-vec2(0.0,0.22),0.49)*wear);
    color=mix(color,mix(shell,vec3(0.5,0.37,0.83),smoothstep(-0.4,0.4,point.x)),disk(point-vec2(0.0,0.23),0.455)*wear);
    for (int index=0;index<2;index++) {
      float side=float(index)*2.0-1.0;
      color=mix(color,cyan,roundedBox(point-vec2(side*0.45,0.15),vec2(0.045,0.115),0.035)*wear);
    }
    color=mix(color,outline,roundedBox(point-vec2(0.0,0.16),vec2(0.36,0.245),0.17)*wear);
    for (int index=0;index<2;index++) {
      vec2 eye=point-vec2(float(index)*0.28-0.14,0.18);
      float arch=fill(abs(length(eye/vec2(1.0,0.8))-0.085)-0.013)*step(0.0,eye.y);
      color=mix(color,cyan,arch*wear);
    }
    vec2 smile=point-vec2(0.0,0.12);
    float grin=fill(abs(length(smile/vec2(1.0,0.63))-0.15)-0.013)*step(smile.y,-0.014);
    color=mix(color,cyan,grin*wear);
    color=mix(color,vec3(0.79,0.88,1.0),line(point,vec2(-0.27,0.5),vec2(-0.06,0.6),0.018)*wear*0.75);
    color=mix(color,outline,line(point,vec2(0.0,0.67),vec2(0.0,0.78),0.025)*wear);
    color=mix(color,cyan,disk(point-vec2(0.0,0.8),0.052)*wear);
    return color;
  }
`

export const MUSIC_GLYPHS = `
  float stroke(vec2 point,vec2 start,vec2 end,float width) {
    vec2 along=end-start;
    float distance=length(point-start-along*clamp(dot(point-start,along)/dot(along,along),0.0,1.0));
    return 1.0-smoothstep(width,width+0.025,distance);
  }
  float noteGlyph(vec2 point,float paired) {
    float first=1.0-smoothstep(0.92,1.08,length((point-vec2(-0.24,-0.45))/vec2(0.24,0.16)));
    float stem=stroke(point,vec2(-0.035,-0.45),vec2(-0.035,0.62),0.04);
    float shape=max(first,stem);
    if (paired>0.5) {
      float second=1.0-smoothstep(0.92,1.08,length((point-vec2(0.33,-0.32))/vec2(0.24,0.16)));
      shape=max(shape,second);
      shape=max(shape,stroke(point,vec2(0.535,-0.32),vec2(0.535,0.74),0.04));
      shape=max(shape,stroke(point,vec2(-0.035,0.6),vec2(0.535,0.72),0.065));
    } else {
      shape=max(shape,stroke(point,vec2(-0.035,0.62),vec2(0.28,0.39),0.065));
      shape=max(shape,stroke(point,vec2(0.28,0.39),vec2(0.24,0.15),0.04));
    }
    return shape;
  }
  float trebleClef(vec2 point) {
    float shape=0.0;
    vec2 previous=vec2(0.0,-0.13);
    for (int index=1;index<=22;index++) {
      float along=float(index)/22.0;
      float angle=along*7.5;
      float radius=0.055+along*0.28;
      vec2 next=vec2(sin(angle),cos(angle))*radius+vec2(0.0,-0.19);
      shape=max(shape,stroke(point,previous,next,0.04));
      previous=next;
    }
    vec2 lower=previous;
    for (int index=1;index<=12;index++) {
      float along=float(index)/12.0;
      vec2 next=vec2(-0.11+sin(along*3.14159)*0.31,mix(lower.y,0.86,along));
      shape=max(shape,stroke(point,previous,next,0.035));
      previous=next;
    }
    shape=max(shape,stroke(point,vec2(-0.11,0.86),vec2(0.12,-0.73),0.033));
    shape=max(shape,stroke(point,vec2(0.12,-0.73),vec2(-0.02,-0.85),0.036));
    shape=max(shape,1.0-smoothstep(0.065,0.095,length(point-vec2(-0.07,-0.81))));
    return shape;
  }
`