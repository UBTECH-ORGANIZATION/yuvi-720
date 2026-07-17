// Yuvi/GrassBlades — stylized swaying grass for WebGL.
//
// Wind + base→tip gradient adapted from Velorexe/unity-geometry-grass-shader (Unlicense,
// https://github.com/Velorexe/unity-geometry-grass-shader). That shader spawns blades in a
// geometry stage, which WebGL 2 / GLES3 does not support — so here the blade quads are baked
// into meshes at build time (GroundingDecorationBuilder.CreateGrassTuft) and only the wind
// sway and colouring run on the GPU, in vertex/surface stages that WebGL does support.
//
// Contract with the baked meshes: vertex colour R encodes the blade height fraction
// (0.4 at the root → 1.0 at the tip); sway weight and the colour gradient derive from it.
Shader "Yuvi/GrassBlades"
{
    Properties
    {
        _BaseColor ("Base Color", Color) = (0.20, 0.30, 0.13, 1)
        _TipColor ("Tip Color", Color) = (0.58, 0.75, 0.34, 1)
        _WindStrength ("Wind Strength", Float) = 0.16
        _WindSpeed ("Wind Speed", Float) = 1.6
        _WindScale ("Wind Scale (world)", Float) = 0.35
        _TintVariation ("Tint Variation", Range(0, 1)) = 0.35
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" }
        Cull Off

        CGPROGRAM
        #pragma surface surf Standard vertex:vert
        #pragma target 3.0

        fixed4 _BaseColor;
        fixed4 _TipColor;
        half _WindStrength;
        half _WindSpeed;
        half _WindScale;
        half _TintVariation;

        struct Input
        {
            float bladeHeight;
            float3 rootWorld;
        };

        void vert(inout appdata_full v, out Input o)
        {
            UNITY_INITIALIZE_OUTPUT(Input, o);
            float w = saturate((v.color.r - 0.4) / 0.6);
            float3 wp = mul(unity_ObjectToWorld, v.vertex).xyz;

            // Two detuned waves phased by world position so the field never sways in lockstep;
            // weight w² pins the roots and lets only the tips travel.
            float t = _Time.y * _WindSpeed;
            float ph = (wp.x + wp.z * 0.7) * _WindScale;
            float2 sway;
            sway.x = sin(t + ph) + 0.4 * sin(t * 1.7 + ph * 2.3);
            sway.y = cos(t * 0.83 + ph * 1.4) * 0.6;
            wp.xz += sway * (_WindStrength * w * w);
            v.vertex.xyz = mul(unity_WorldToObject, float4(wp, 1)).xyz;

            // Light every blade straight up so the field shades like the terrain beneath it —
            // no dark backfaces from Cull Off and no per-quad faceting. (Tufts only yaw, so
            // object-space up is world up.)
            v.normal = float3(0, 1, 0);

            o.bladeHeight = w;
            o.rootWorld = wp;
        }

        void surf(Input IN, inout SurfaceOutputStandard o)
        {
            fixed3 col = lerp(_BaseColor.rgb, _TipColor.rgb, IN.bladeHeight);
            // Cheap hash on the ~half-metre world cell gives per-clump tint drift.
            float n = frac(sin(dot(floor(IN.rootWorld.xz * 1.7), float2(127.1, 311.7))) * 43758.5453);
            col *= 1.0 + (n - 0.5) * _TintVariation;
            o.Albedo = col;
            o.Metallic = 0;
            o.Smoothness = 0.05;
        }
        ENDCG
    }
    FallBack "Diffuse"
}
