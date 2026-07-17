// Triplanar surface shader — vendored from Ben Golus's public-domain reference:
//   "Normal Mapping for a Triplanar Shader" — Ben Golus 2017
//   https://github.com/bgolus/Normal-Mapping-for-a-Triplanar-Shader  (LICENSE: Unlicense / public domain)
//
// Projects a texture onto a mesh by blending three world-space planar samples by the world normal, so
// un-UV'd / steep surfaces (our mountains and the island's timber cliff rim) get crisp texturing on their
// vertical faces instead of the top-down smear the world-XZ StylizedGround shader produced.
//
// Local additions to Golus's original (kept minimal, attribution above preserved):
//   • _Color tint — our stone/plank source textures are greyscale, so the material tints them.
//   • _Emission — a faint self-lift so back-lit rock faces don't crush to black (matches the old Stone mat).
Shader "Yuvi/Triplanar"
{
    Properties
    {
        _Color ("Tint", Color) = (1,1,1,1)
        _MainTex ("Albedo (RGB)", 2D) = "white" {}
        [NoScaleOffset] _BumpMap ("Normal Map", 2D) = "bump" {}
        _Glossiness ("Smoothness", Range(0,1)) = 0.15
        [Gamma] _Metallic ("Metallic", Range(0,1)) = 0
        _Emission ("Emission Boost", Range(0,1)) = 0.0
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        LOD 200

        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows
        #pragma target 3.0
        #include "UnityStandardUtils.cginc"

        // flip UVs horizontally to correct for back side projection
        #define TRIPLANAR_CORRECT_PROJECTED_U

        half3 blend_rnm(half3 n1, half3 n2)
        {
            n1.z += 1;
            n2.xy = -n2.xy;
            return n1 * dot(n1, n2) / n1.z - n2;
        }

        sampler2D _MainTex;
        float4 _MainTex_ST;
        sampler2D _BumpMap;

        fixed4 _Color;
        half _Glossiness;
        half _Metallic;
        half _Emission;

        struct Input
        {
            float3 worldPos;
            float3 worldNormal;
            INTERNAL_DATA
        };

        float3 WorldToTangentNormalVector(Input IN, float3 normal)
        {
            float3 t2w0 = WorldNormalVector(IN, float3(1,0,0));
            float3 t2w1 = WorldNormalVector(IN, float3(0,1,0));
            float3 t2w2 = WorldNormalVector(IN, float3(0,0,1));
            float3x3 t2w = float3x3(t2w0, t2w1, t2w2);
            return normalize(mul(t2w, normal));
        }

        void surf (Input IN, inout SurfaceOutputStandard o)
        {
            IN.worldNormal = WorldNormalVector(IN, float3(0,0,1));

            half3 triblend = saturate(pow(IN.worldNormal, 4));
            triblend /= max(dot(triblend, half3(1,1,1)), 0.0001);

            float2 uvX = IN.worldPos.zy * _MainTex_ST.xy + _MainTex_ST.zy;
            float2 uvY = IN.worldPos.xz * _MainTex_ST.xy + _MainTex_ST.zy;
            float2 uvZ = IN.worldPos.xy * _MainTex_ST.xy + _MainTex_ST.zy;

            half3 axisSign = IN.worldNormal < 0 ? -1 : 1;
        #if defined(TRIPLANAR_CORRECT_PROJECTED_U)
            uvX.x *= axisSign.x;
            uvY.x *= axisSign.y;
            uvZ.x *= -axisSign.z;
        #endif

            fixed4 colX = tex2D(_MainTex, uvX);
            fixed4 colY = tex2D(_MainTex, uvY);
            fixed4 colZ = tex2D(_MainTex, uvZ);
            fixed4 col = colX * triblend.x + colY * triblend.y + colZ * triblend.z;

            half3 tnormalX = UnpackNormal(tex2D(_BumpMap, uvX));
            half3 tnormalY = UnpackNormal(tex2D(_BumpMap, uvY));
            half3 tnormalZ = UnpackNormal(tex2D(_BumpMap, uvZ));
        #if defined(TRIPLANAR_CORRECT_PROJECTED_U)
            tnormalX.x *= axisSign.x;
            tnormalY.x *= axisSign.y;
            tnormalZ.x *= -axisSign.z;
        #endif
            half3 absVertNormal = abs(IN.worldNormal);
            tnormalX = blend_rnm(half3(IN.worldNormal.zy, absVertNormal.x), tnormalX);
            tnormalY = blend_rnm(half3(IN.worldNormal.xz, absVertNormal.y), tnormalY);
            tnormalZ = blend_rnm(half3(IN.worldNormal.xy, absVertNormal.z), tnormalZ);
            tnormalX.z *= axisSign.x;
            tnormalY.z *= axisSign.y;
            tnormalZ.z *= axisSign.z;
            half3 worldNormal = normalize(
                tnormalX.zyx * triblend.x +
                tnormalY.xzy * triblend.y +
                tnormalZ.xyz * triblend.z);

            o.Albedo = col.rgb * _Color.rgb;
            o.Metallic = _Metallic;
            o.Smoothness = _Glossiness;
            o.Emission = o.Albedo * _Emission;
            o.Normal = WorldToTangentNormalVector(IN, worldNormal);
        }
        ENDCG
    }
    FallBack "Diffuse"
}
