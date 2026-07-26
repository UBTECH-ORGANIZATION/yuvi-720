// Stylised-realistic water for the Yuvi world (Built-in RP, ForwardBase, WebGL/GLES3 safe).
//
// What makes it read as real water rather than a coloured plane:
//   1. FOUR GERSTNER WAVES. Real swell is not a sine — crests are sharp and troughs are broad, because
//      water particles orbit rather than bob. Gerstner adds the HORIZONTAL displacement that produces
//      that asymmetry. Four octaves on non-harmonic directions/speeds so the pattern never visibly loops.
//   2. MICRO-CHOP normals in the fragment stage. The vertex waves are metres wide; the eye reads "water"
//      from centimetre-scale ripples, which are far too fine to tessellate. They are added analytically
//      to the normal and faded with distance so the surface does not shimmer/alias.
//   3. SKY REFLECTION WITH FRESNEL. This is the single biggest realism factor. Water is ~2% reflective
//      face-on and ~100% at grazing angles, so a real sea is dark and transparent underfoot and a mirror
//      toward the horizon. The sky is reconstructed analytically (zenith→horizon gradient + sun disc)
//      instead of sampled from a reflection probe, so it stays deterministic in batchmode captures
//      (where probes are usually unbaked) and can be tuned to match the authored skybox exactly.
//   4. DEPTH-BASED SHORELINE. Sampling the camera depth texture gives the water column thickness, so the
//      sea turns pale and turquoise as it shallows over the island shelf and lays a soft foam band exactly
//      where it meets the land. Falls back to "deep everywhere" when no depth texture is available.
//   5. SUBSURFACE SCATTER on wave crests — sunlight passing through a thin lifted crest glows green-teal.
//   6. Two specular lobes plus micro-normal glitter instead of one hard Blinn highlight, which is what
//      produced the white streaks the previous version had.
//   7. Scene FOG is applied, so the sea recedes into the same haze as the terrain instead of staying
//      saturated all the way to the horizon.
//
// The radial-ripple path (_RippleStrength > 0) is retained for the fountain basins.
Shader "Yuvi/Water"
{
    Properties
    {
        _DeepColor   ("Deep Color", Color)      = (0.02,0.14,0.22,1)
        _ShallowColor("Shallow Color", Color)   = (0.10,0.46,0.52,1)
        _FoamColor   ("Foam Color", Color)      = (0.94,0.98,0.99,1)
        _SpecColor2  ("Sun Glint", Color)       = (1,1,1,1)

        _WaveAmp     ("Wave Amplitude", Float)  = 0.14
        _WaveLen     ("Wave Length", Float)     = 7.0
        _WaveSpeed   ("Wave Speed", Float)      = 1.0
        _Choppy      ("Choppiness", Range(0,2)) = 1.0

        _FoamAmount  ("Crest Foam", Range(0,1)) = 0.30
        _DetailScale ("Micro Chop Scale", Float)= 0.9
        _DetailStrength ("Micro Chop Strength", Range(0,3)) = 1.0

        _SkyZenith   ("Sky Zenith", Color)      = (0.22,0.42,0.78,1)
        _SkyHorizon  ("Sky Horizon", Color)     = (0.58,0.72,0.86,1)
        _Reflectivity("Sky Reflection", Range(0,1)) = 1.0
        _Scatter     ("Subsurface Scatter", Range(0,3)) = 1.0

        _ShoreFade   ("Shore Fade Depth", Float)   = 3.0
        _ShoreFoam   ("Shore Foam Width", Float)   = 1.1

        _RippleStrength ("Radial Ripple", Float)= 0.0
        _RippleSpeed ("Ripple Speed", Float)    = 2.5
        _RippleFreq  ("Ripple Freq", Float)     = 5.0
        _PuddleScale ("Puddle Scale", Float)    = 0.06
        _PuddleAmount("Puddle Amount", Range(0,1)) = 0.0
        _Glossiness  ("Smoothness", Range(0,1)) = 0.92
    }
    SubShader
    {
        // This shader is fully opaque (ZWrite on, no blending), but it is deliberately kept OUT of the
        // opaque batch. _CameraDepthTexture is built from the opaque queue, so a sea rendered inside that
        // batch ends up measuring its own surface: the water column comes out as ~0 everywhere and the
        // shoreline term foams the entire ocean. Rendering just after the opaques means the depth texture
        // already holds the seabed and the cliffs, which is what the water column actually needs.
        Tags { "RenderType"="Transparent" "Queue"="Transparent-100" }
        Pass
        {
            Tags { "LightMode"="ForwardBase" }
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #pragma multi_compile_fog
            #include "UnityCG.cginc"
            #include "Lighting.cginc"

            float4 _DeepColor,_ShallowColor,_FoamColor,_SpecColor2,_SkyZenith,_SkyHorizon;
            float _WaveAmp,_WaveLen,_WaveSpeed,_Choppy,_FoamAmount;
            float _DetailScale,_DetailStrength,_Reflectivity,_Scatter,_ShoreFade,_ShoreFoam;
            float _RippleStrength,_RippleSpeed,_RippleFreq,_PuddleScale,_PuddleAmount,_Glossiness;
            float _YWTime; // global, advanced every frame in edit + play by WaterTimeDriver
            sampler2D _CameraDepthTexture;

            struct appdata { float4 vertex:POSITION; float3 normal:NORMAL; };
            struct v2f {
                float4 pos:SV_POSITION;
                float3 wpos:TEXCOORD0;
                float3 wnormal:TEXCOORD1;
                float2 crestFoam:TEXCOORD2;   // x = raw crest height, y = raw Gerstner pinch (NOT clamped)
                float4 screenPos:TEXCOORD3;
                UNITY_FOG_COORDS(4)
            };

            // ── Gerstner swell ────────────────────────────────────────────────────────────────────────
            // Accumulates displacement and the analytic surface normal for one wave. `chop` is shared by
            // all four so the crest sharpening stays consistent, and is deliberately amplitude-independent
            // (the A terms cancel) — that is what keeps a near-flat fountain pool from inheriting the
            // steep-crest normals of an open sea.
            void Gerstner(float2 p, float2 dir, float len, float amp, float spd, float chop, float t,
                          inout float3 disp, inout float3 nAcc)
            {
                float k = 6.2831853 / max(len, 0.01);
                float f = dot(dir, p) * k + t * spd;
                float s, c; sincos(f, s, c);
                float q = chop * 0.25;              // this wave's share of the total steepness budget
                disp.xz += (q / k) * dir * c;
                disp.y  += amp * s;
                nAcc.xz += dir * (k * amp) * c;
                nAcc.y  += q * s;
            }

            // Centimetre-scale ripple gradient. Four irrational directions at rising frequency read as
            // irregular chop rather than a corduroy pattern, and cost four sincos instead of a chain of
            // texture fetches — on WebGL the scarce resource is bandwidth, not ALU.
            float2 MicroGrad(float2 p, float t)
            {
                float2 g = 0; float2 d; float k, ph;
                d = float2( 0.9295, 0.3688); k = 1.7 * _DetailScale; ph = dot(p,d)*k + t*1.90; g += d * k * cos(ph) * 1.00;
                d = float2(-0.4104, 0.9119); k = 2.9 * _DetailScale; ph = dot(p,d)*k + t*2.45; g += d * k * cos(ph) * 0.58;
                d = float2( 0.6608,-0.7506); k = 5.3 * _DetailScale; ph = dot(p,d)*k + t*3.10; g += d * k * cos(ph) * 0.30;
                d = float2(-0.8716,-0.4902); k = 8.9 * _DetailScale; ph = dot(p,d)*k + t*4.05; g += d * k * cos(ph) * 0.15;
                return g;
            }

            float hash(float2 p){ return frac(sin(dot(p,float2(41.3,289.1)))*43758.5453); }
            float noise(float2 p){
                float2 i=floor(p),f=frac(p);
                float a=hash(i),b=hash(i+float2(1,0)),c=hash(i+float2(0,1)),d=hash(i+float2(1,1));
                float2 u=f*f*(3-2*f);
                return lerp(lerp(a,b,u.x),lerp(c,d,u.x),u.y);
            }

            // Analytic sky dome: zenith→horizon gradient plus the sun's disc and aureole.
            float3 SkyAt(float3 dir, float3 L)
            {
                float up = saturate(dir.y * 0.5 + 0.5);
                float3 sky = lerp(_SkyHorizon.rgb, _SkyZenith.rgb, pow(up, 0.85));
                float sun = saturate(dot(normalize(dir), L));
                sky += _LightColor0.rgb * pow(sun, 220.0) * 6.0;    // the glinting disc itself
                sky += _LightColor0.rgb * pow(sun, 12.0) * 0.16;    // soft aureole around it
                return sky;
            }

            v2f vert(appdata v)
            {
                v2f o;
                float3 wp0 = mul(unity_ObjectToWorld, v.vertex).xyz;
                float t = _YWTime * _WaveSpeed;
                // Choppiness scales with swell size: an open sea pinches its crests, a fountain basin
                // two centimetres deep has to stay a calm mirror.
                float chop = _Choppy * saturate(_WaveAmp / 0.08);

                float3 disp = 0, nAcc = 0;
                // Octave wavelengths stay long relative to the mesh cell (~1.25 m). An octave shorter than
                // about three cells cannot be represented by the vertices at all and folds into the blocky,
                // crumpled-foil look instead of adding detail — anything finer than this belongs in MicroGrad.
                Gerstner(wp0.xz, float2( 0.9439, 0.3303), _WaveLen,        _WaveAmp,        1.00, chop, t, disp, nAcc);
                Gerstner(wp0.xz, float2(-0.4104, 0.9119), _WaveLen * 0.67, _WaveAmp * 0.58, 1.27, chop, t, disp, nAcc);
                Gerstner(wp0.xz, float2( 0.7557,-0.6549), _WaveLen * 0.45, _WaveAmp * 0.31, 1.61, chop, t, disp, nAcc);
                Gerstner(wp0.xz, float2(-0.9061,-0.4231), _WaveLen * 0.31, _WaveAmp * 0.16, 2.13, chop, t, disp, nAcc);

                // Fountain basins: concentric rings radiating from the object origin.
                if (_RippleStrength > 0)
                {
                    float r = length(v.vertex.xz);
                    float phase = r * _RippleFreq - _YWTime * _RippleSpeed;
                    float atten = saturate(1 - r * 0.5);
                    disp.y += sin(phase) * _RippleStrength * atten;
                    float2 dir = normalize(v.vertex.xz + 1e-4);
                    nAcc.xz += dir * _RippleFreq * cos(phase) * _RippleStrength * atten;
                }

                float4 local = v.vertex;
                local.xyz += mul((float3x3)unity_WorldToObject, disp);
                o.pos = UnityObjectToClipPos(local);
                o.wpos = mul(unity_ObjectToWorld, local).xyz;
                o.screenPos = ComputeScreenPos(o.pos);
                o.wnormal = UnityObjectToWorldNormal(normalize(float3(-nAcc.x, 1.0 - nAcc.y, -nAcc.z)));

                // Both foam inputs are passed RAW. Clamping them here was the single worst artefact of the
                // previous version: saturate() in the vertex stage creates plateaus at 0 and 1, and the
                // linear interpolation between a plateau and a slope makes the triangle edges visible, so the
                // sea broke up into flat white polygons. Smooth curves belong in the fragment stage.
                o.crestFoam = float2(disp.y, nAcc.y);
                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 frag(v2f i):SV_Target
            {
                float3 toCam = _WorldSpaceCameraPos - i.wpos;
                float  dist  = length(toCam);
                float3 V = toCam / max(dist, 1e-4);
                float3 L = normalize(_WorldSpaceLightPos0.xyz);

                // Micro-chop, faded out with distance so the far sea stays smooth instead of aliasing into
                // a boiling mess of sub-pixel highlights.
                float detailFade = 1.0 / (1.0 + dist * 0.035);
                float2 g = MicroGrad(i.wpos.xz, _YWTime) * _DetailStrength * 0.030 * detailFade;
                float3 N = normalize(i.wnormal + float3(-g.x, 0, -g.y));
                // Far water has to settle into a smooth sheet. Left alone, wave normals keep swinging
                // through a full range inside a single pixel near the horizon, which aliases into noise and
                // destroys the sense of distance.
                N = normalize(lerp(N, float3(0, 1, 0), saturate((dist - 40.0) / 80.0)));

                // Shape the raw wave signals here rather than in the vertex stage, so every curve is
                // evaluated per pixel and the triangulation never shows through.
                float crest = saturate(i.crestFoam.x / max(_WaveAmp * 2.05, 1e-4) * 0.5 + 0.5);
                float pinch = i.crestFoam.y;   // ~1 where the octaves stack into a sharp, breaking crest

                // Water column thickness from the depth buffer. A negative result means there is no depth
                // texture this frame, so fall back to "open sea" instead of foaming the whole surface.
                float4 sp = i.screenPos;
                float rawZ = SAMPLE_DEPTH_TEXTURE_PROJ(_CameraDepthTexture, UNITY_PROJ_COORD(sp));
                float sceneZ = LinearEyeDepth(rawZ);
                float depth = sceneZ - sp.w;
                // Two readings mean "no usable seabed here": a negative one (something is in front of the
                // water) and a near-zero one (the sample hit the sea itself, or there is no depth texture
                // bound at all). Both must fall back to open sea — treating them as shallow is what turns
                // the whole ocean into foam. The tolerance grows with distance because depth precision does
                // not survive range, and a shore band that far away is sub-pixel anyway.
                float selfHit = 0.05 + dist * 0.006;
                depth = (depth < selfHit) ? 1e4 : depth;
                float shallowness = 1.0 - saturate(depth / max(_ShoreFade, 0.01));

                // Body colour — what you see looking INTO the water: deep offshore, turquoise over the
                // shelf, crests slightly lighter because less water sits above them.
                float3 body = lerp(_DeepColor.rgb, _ShallowColor.rgb,
                                   saturate(shallowness * 0.85 + crest * 0.28));

                // Subsurface scatter: sunlight coming THROUGH a lifted crest towards the eye.
                float back = pow(saturate(dot(V, -normalize(L + N * 0.35))), 4.0);
                body += _ShallowColor.rgb * back * crest * _Scatter * 0.55;

                // Fresnel-weighted sky reflection. Physically this runs to a full mirror at grazing
                // incidence, but a real mirror at this camera height washes the whole sea out to sky colour
                // and the ocean stops reading as water, so the term is deliberately capped and the sea keeps
                // a share of its own body colour all the way to the horizon.
                float3 R = reflect(-V, N);
                R.y = abs(R.y) + 0.02;                                 // never sample below the horizon
                float3 sky = SkyAt(R, L);
                float fres = 0.02 + 0.62 * pow(1.0 - saturate(dot(N, V)), 5.0);
                fres *= _Reflectivity * (1.0 - shallowness * 0.45);    // shallows reflect less, show the bed
                float3 col = lerp(body, sky, saturate(fres));

                // Foam: breaking whitecaps plus a soft lace band exactly where the sea meets the land.
                // A whitecap needs BOTH conditions a real one needs — the crest has to be high and it has to
                // be sharp — and is then torn up by two noise octaves so it reads as broken water rather
                // than as a painted shape following the wave.
                float tear = noise(i.wpos.xz * 0.85 + _YWTime * 0.06)
                           * noise(i.wpos.xz * 2.30 - _YWTime * 0.11);
                // The crest signals are interpolated linearly across the mesh, so their gradient breaks at
                // every triangle edge. Thresholding them directly turns that break into a straight white
                // crease. Perturbing the threshold with a continuous per-pixel noise makes the boundary
                // wander, which both hides the triangulation and gives foam a torn edge.
                float pinchN = pinch + (tear - 0.30) * 0.40;
                // Real whitecaps cover only a few percent of open water. Keeping the gates high is what
                // separates "sea" from "marble".
                float crestFoam = smoothstep(0.60, 0.92, pinchN) * smoothstep(0.52, 0.84, crest)
                                * (0.30 + 1.35 * tear) * _FoamAmount * 2.2;
                float shoreLine = 1.0 - saturate(depth / max(_ShoreFoam, 0.01));
                float lace = noise(i.wpos.xz * 1.6 + _YWTime * 0.10) * 0.55 + 0.45;
                float shoreFoam = smoothstep(0.25, 0.95, shoreLine) * lace;
                float pn = noise(i.wpos.xz * _PuddleScale + _YWTime * 0.04);
                float puddle = smoothstep(0.80, 0.95, pn) * _PuddleAmount;
                float foamMask = saturate(crestFoam + shoreFoam + puddle);

                float ndl = saturate(dot(N, L)) * 0.5 + 0.5;           // wrapped diffuse, never black water
                col = lerp(col, _FoamColor.rgb * ndl, foamMask);
                col += ShadeSH9(float4(N, 1)) * body * 0.25;           // ambient bounce into the body colour

                // Two specular lobes: a tight disc for the sun's true reflection and a broad sheen for the
                // roughened micro-surface. A single hard lobe is what produced the old white streaks.
                float3 H = normalize(L + V);
                float ndh = saturate(dot(N, H));
                float tight = pow(ndh, lerp(60.0, 900.0, _Glossiness));
                float broad = pow(ndh, 22.0) * 0.16;
                col += _SpecColor2.rgb * _LightColor0.rgb * (tight + broad) * (1.0 - foamMask);

                fixed4 outCol = fixed4(col, 1);
                UNITY_APPLY_FOG(i.fogCoord, outCol);   // the sea must recede into the same haze as the land
                return outCol;
            }
            ENDCG
        }
    }
    Fallback "Diffuse"
}
