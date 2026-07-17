Shader "Yuvi/StylizedGround"
{
    Properties
    {
        _Color ("Tint", Color) = (1,1,1,1)
        _MainTex ("Surface Tex (world XZ)", 2D) = "white" {}
        _MainTexScale ("Surface Tex Scale", Float) = 0.15
        _WrapAmount ("Light Wrap", Range(0,1)) = 0.55
        _AmbientBoost ("Ambient Boost", Range(0,1)) = 0.35
        _VColorStrength ("Vertex Color Strength", Range(0,1)) = 1.0
        _RimColor ("Rim Color", Color) = (1,1,1,0)
        _RimPower ("Rim Power", Range(0.5,8)) = 3.0
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 200

        CGPROGRAM
        #pragma surface surf StylizedWrap vertex:vert
        #pragma target 3.0

        fixed4 _Color;
        sampler2D _MainTex;
        half _MainTexScale;
        half _WrapAmount;
        half _AmbientBoost;
        half _VColorStrength;
        fixed4 _RimColor;
        half _RimPower;

        struct Input
        {
            float4 vcolor : COLOR;
            float3 viewDir;
            float3 worldPos;
        };

        void vert (inout appdata_full v, out Input o)
        {
            UNITY_INITIALIZE_OUTPUT(Input, o);
            o.vcolor = v.color;
        }

        half4 LightingStylizedWrap (SurfaceOutput s, half3 lightDir, half3 viewDir, half atten)
        {
            half ndl = dot(s.Normal, lightDir);
            // Half-lambert style wrap for soft painterly falloff.
            half wrapped = saturate(ndl * (1.0 - _WrapAmount) + _WrapAmount);
            half4 c;
            c.rgb = s.Albedo * _LightColor0.rgb * wrapped * atten;
            c.a = s.Alpha;
            return c;
        }

        void surf (Input IN, inout SurfaceOutput o)
        {
            fixed3 vc = lerp(fixed3(1,1,1), IN.vcolor.rgb, _VColorStrength);
            fixed3 surfaceTex = tex2D(_MainTex, IN.worldPos.xz * _MainTexScale).rgb; // world-XZ, default white
            o.Albedo = _Color.rgb * vc * surfaceTex;
            // Cheap rim to lift silhouettes / grassy top edges.
            half rim = pow(1.0 - saturate(dot(normalize(IN.viewDir), o.Normal)), _RimPower);
            o.Emission = _RimColor.rgb * _RimColor.a * rim
                       + o.Albedo * _AmbientBoost * 0.5;
            o.Alpha = 1.0;
        }
        ENDCG
    }
    FallBack "Diffuse"
}
