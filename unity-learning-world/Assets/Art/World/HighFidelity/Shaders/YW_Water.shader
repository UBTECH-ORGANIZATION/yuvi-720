// Animated stylized water for the Yuvi world (Built-in RP, ForwardBase).
// Vertex Gerstner-ish waves drive a live ocean; a radial ripple mode + rim foam
// serve the fountain basins. Crest foam plus slow noise "puddles" that swell and
// fade give the surfacing/receding-water read. Animates from _Time in play mode;
// edit-mode captures show the t=0 displaced frame.
Shader "Yuvi/Water"
{
    Properties
    {
        _DeepColor   ("Deep Color", Color)      = (0.10,0.28,0.34,1)
        _ShallowColor("Shallow Color", Color)   = (0.18,0.47,0.52,1)
        _FoamColor   ("Foam Color", Color)      = (0.90,0.96,0.97,1)
        _SpecColor2  ("Sun Glint", Color)       = (1,1,1,1)
        _WaveAmp     ("Wave Amplitude", Float)  = 0.14
        _WaveLen     ("Wave Length", Float)     = 7.0
        _WaveSpeed   ("Wave Speed", Float)      = 1.0
        _FoamAmount  ("Crest Foam", Range(0,1)) = 0.30
        _RippleStrength ("Radial Ripple", Float)= 0.0
        _RippleSpeed ("Ripple Speed", Float)    = 2.5
        _RippleFreq  ("Ripple Freq", Float)     = 5.0
        _PuddleScale ("Puddle Scale", Float)    = 0.06
        _PuddleAmount("Puddle Amount", Range(0,1)) = 0.18
        _Glossiness  ("Smoothness", Range(0,1)) = 0.85
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        Pass
        {
            Tags { "LightMode"="ForwardBase" }
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            #include "Lighting.cginc"

            float4 _DeepColor,_ShallowColor,_FoamColor,_SpecColor2;
            float _WaveAmp,_WaveLen,_WaveSpeed,_FoamAmount;
            float _RippleStrength,_RippleSpeed,_RippleFreq,_PuddleScale,_PuddleAmount,_Glossiness;
            float _YWTime; // global, advanced every frame in edit + play by WaterTimeDriver

            struct appdata { float4 vertex:POSITION; float3 normal:NORMAL; };
            struct v2f {
                float4 pos:SV_POSITION;
                float3 wpos:TEXCOORD0;
                float3 wnormal:TEXCOORD1;
                float  crest:TEXCOORD2;
            };

            float waveHeight(float2 p, out float2 deriv)
            {
                float t = _YWTime * _WaveSpeed;
                float k = 6.2831853 / max(_WaveLen, 0.01);
                float h = 0; deriv = 0;
                float2 d1 = normalize(float2(1.0, 0.45));
                float p1 = dot(p,d1)*k + t;          h += sin(p1);      deriv += d1*k*cos(p1);
                float2 d2 = normalize(float2(-0.35,1.0)); float k2=k*1.7;
                float p2 = dot(p,d2)*k2 + t*1.3;     h += 0.6*sin(p2);  deriv += d2*k2*0.6*cos(p2);
                float2 d3 = normalize(float2(0.8,-0.6)); float k3=k*3.1;
                float p3 = dot(p,d3)*k3 + t*0.7;     h += 0.3*sin(p3);  deriv += d3*k3*0.3*cos(p3);
                return h * _WaveAmp;
            }

            float hash(float2 p){ return frac(sin(dot(p,float2(41.3,289.1)))*43758.5453); }
            float noise(float2 p){
                float2 i=floor(p),f=frac(p);
                float a=hash(i),b=hash(i+float2(1,0)),c=hash(i+float2(0,1)),d=hash(i+float2(1,1));
                float2 u=f*f*(3-2*f);
                return lerp(lerp(a,b,u.x),lerp(c,d,u.x),u.y);
            }

            v2f vert(appdata v)
            {
                v2f o;
                float3 wp = mul(unity_ObjectToWorld, v.vertex).xyz;
                float2 deriv;
                float h = waveHeight(wp.xz, deriv);

                float ripple = 0; float2 rderiv = 0;
                if (_RippleStrength > 0)
                {
                    float r = length(v.vertex.xz);
                    float phase = r*_RippleFreq - _YWTime*_RippleSpeed;
                    float atten = saturate(1 - r*0.5);
                    ripple = sin(phase)*_RippleStrength*atten;
                    float2 dir = normalize(v.vertex.xz + 1e-4);
                    rderiv = dir*_RippleFreq*cos(phase)*_RippleStrength*atten;
                }

                float disp = h + ripple;
                v.vertex.xyz += float3(0, disp, 0);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.wpos = mul(unity_ObjectToWorld, v.vertex).xyz;
                float3 n = normalize(float3(-(deriv.x+rderiv.x), 1, -(deriv.y+rderiv.y)));
                o.wnormal = UnityObjectToWorldNormal(n);
                o.crest = saturate(disp / max(_WaveAmp,0.001) * 0.5 + 0.5);
                return o;
            }

            fixed4 frag(v2f i):SV_Target
            {
                float3 N = normalize(i.wnormal);
                float3 V = normalize(_WorldSpaceCameraPos - i.wpos);
                float3 L = normalize(_WorldSpaceLightPos0.xyz);
                float ndl = saturate(dot(N,L))*0.5 + 0.5;                 // wrapped diffuse
                float fres = pow(1 - saturate(dot(N,V)), 3);
                float3 baseCol = lerp(_DeepColor.rgb, _ShallowColor.rgb, saturate(i.crest*0.6 + fres*0.7));

                float foam = smoothstep(1 - _FoamAmount, 1.0, i.crest) * _FoamAmount;
                // sparse slow noise patches that swell then fade — water surfacing / receding puddles
                float pn = noise(i.wpos.xz * _PuddleScale + _YWTime*0.04);
                float pulse = 0.5 + 0.5*sin(_YWTime*0.7 + pn*12.0);
                float puddle = smoothstep(0.80, 0.95, pn) * pulse * _PuddleAmount;
                float foamMask = saturate(foam + puddle);
                float3 col = lerp(baseCol, _FoamColor.rgb, foamMask) * ndl;

                float3 H = normalize(L + V);
                float spec = pow(saturate(dot(N,H)), lerp(8, 140, _Glossiness)) * (1 - foamMask);
                col += _SpecColor2.rgb * spec * _LightColor0.rgb;
                return fixed4(col, 1);
            }
            ENDCG
        }
    }
    Fallback "Diffuse"
}
