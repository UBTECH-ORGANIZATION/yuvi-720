using System;
using UnityEditor;
using UnityEngine;
using Yuvi720.LearningWorld.Grounding;

namespace Yuvi720.LearningWorld.Editor.Grounding
{
    internal static class GroundingAssetWriter
    {
        public const string MeshFolder = "Assets/Art/World/HighFidelity/Generated/Grounding/Meshes";
        public const string MaterialFolder = "Assets/Art/World/HighFidelity/Generated/Grounding/Materials";

        public static void EnsureOutputFolders()
        {
            EnsureFolder(MeshFolder);
            EnsureFolder(MaterialFolder);
        }

        public static Mesh SaveMesh(Mesh generated, string assetName)
        {
            if (generated == null) throw new ArgumentNullException(nameof(generated));
            EnsureOutputFolders();
            var safeName = Sanitize(assetName);
            generated.name = safeName;
            var path = $"{MeshFolder}/{safeName}.asset";
            var existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }

            EditorUtility.CopySerialized(generated, existing);
            existing.name = safeName;
            EditorUtility.SetDirty(existing);
            UnityEngine.Object.DestroyImmediate(generated);
            return existing;
        }

        public static Material GetMaterial(GroundThemeProfile theme, string family)
        {
            if (theme == null) throw new ArgumentNullException(nameof(theme));
            EnsureOutputFolders();
            var normalizedFamily = string.IsNullOrWhiteSpace(family) ? "primary" : family.Trim().ToLowerInvariant();
            var assetName = $"MAT_YW_Grounding_{Sanitize(theme.ThemeId)}_{Sanitize(normalizedFamily)}";
            var path = $"{MaterialFolder}/{assetName}.mat";
            var shader = ResolveGroundShader();
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader) { name = assetName };
                AssetDatabase.CreateAsset(material, path);
            }
            if (material.shader != shader) material.shader = shader;

            material.color = ResolveColor(theme, normalizedFamily);
            ApplyGroundLook(material, normalizedFamily);
            EditorUtility.SetDirty(material);
            return material;
        }

        public static Material GetSolidMaterial(string assetName, Color color)
        {
            EnsureOutputFolders();
            var path = $"{MaterialFolder}/{Sanitize(assetName)}.mat";
            var shader = ResolveGroundShader();
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader) { name = Sanitize(assetName) };
                AssetDatabase.CreateAsset(material, path);
            }
            if (material.shader != shader) material.shader = shader;
            material.color = color;
            ApplyGroundLook(material, "water");
            EditorUtility.SetDirty(material);
            return material;
        }

        public static Material GetConnectorMaterial(string assetName, Color color)
        {
            EnsureOutputFolders();
            var path = $"{MaterialFolder}/{Sanitize(assetName)}.mat";
            var shader = ResolveGroundShader();
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader) { name = Sanitize(assetName) };
                AssetDatabase.CreateAsset(material, path);
            }
            if (material.shader != shader) material.shader = shader;
            material.color = color;
            ApplyGroundLook(material, "connector");
            EditorUtility.SetDirty(material);
            return material;
        }

        /// <summary>
        /// Emissive accent material (Standard shader) for the cyan "tech" glow that ties dressing
        /// props to the Yuvi robot's neon palette — beacon lanterns, fountain water, crystal accents.
        /// </summary>
        public static Material GetEmissiveMaterial(string assetName, Color color, float intensity)
        {
            EnsureOutputFolders();
            var path = $"{MaterialFolder}/{Sanitize(assetName)}.mat";
            var shader = Shader.Find("Standard") ?? ResolveGroundShader();
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader) { name = Sanitize(assetName) };
                AssetDatabase.CreateAsset(material, path);
            }
            if (material.shader != shader) material.shader = shader;
            material.color = color;
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            material.EnableKeyword("_EMISSION");
            material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            if (material.HasProperty("_EmissionColor")) material.SetColor("_EmissionColor", color * intensity);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", .55f);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", .1f);
            EditorUtility.SetDirty(material);
            return material;
        }

        /// <summary>
        /// Glossy hard-surface material (Standard shader) for clean building stone and metal that reads
        /// crisp next to the robot's plastic sheen — sharper than the half-Lambert ground shader.
        /// </summary>
        public static Material GetHardSurfaceMaterial(string assetName, Color color, float glossiness, float metallic)
        {
            EnsureOutputFolders();
            var path = $"{MaterialFolder}/{Sanitize(assetName)}.mat";
            var shader = Shader.Find("Standard") ?? ResolveGroundShader();
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader) { name = Sanitize(assetName) };
                AssetDatabase.CreateAsset(material, path);
            }
            if (material.shader != shader) material.shader = shader;
            material.color = color;
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", glossiness);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", metallic);
            EditorUtility.SetDirty(material);
            return material;
        }

        /// <summary>
        /// Animated water material (Yuvi/Water shader). waveAmp/waveLen drive the open ocean; set
        /// ripple &gt; 0 for the small radial fountain ripples. Falls back to a solid material if the
        /// shader is missing so builds never break.
        /// </summary>
        public static Material GetWaterMaterial(string assetName, Color deep, Color shallow, Color foam,
            float waveAmp, float waveLen, float foamAmount, float ripple)
        {
            EnsureOutputFolders();
            var path = $"{MaterialFolder}/{Sanitize(assetName)}.mat";
            var shader = Shader.Find("Yuvi/Water");
            if (shader == null) return GetSolidMaterial(assetName, deep);
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader) { name = Sanitize(assetName) };
                AssetDatabase.CreateAsset(material, path);
            }
            if (material.shader != shader) material.shader = shader;
            material.SetColor("_DeepColor", deep);
            material.SetColor("_ShallowColor", shallow);
            material.SetColor("_FoamColor", foam);
            material.SetFloat("_WaveAmp", waveAmp);
            material.SetFloat("_WaveLen", waveLen);
            material.SetFloat("_FoamAmount", foamAmount);
            material.SetFloat("_RippleStrength", ripple);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Shader ResolveGroundShader()
        {
            var shader = Shader.Find("Yuvi/StylizedGround")
                ?? Shader.Find("Standard")
                ?? Shader.Find("Legacy Shaders/Diffuse");
            if (shader == null) throw new InvalidOperationException("A built-in lit shader is required for grounding review.");
            return shader;
        }

        private static void ApplyGroundLook(Material material, string family)
        {
            // Stylized shader controls; harmless no-ops on the Standard fallback.
            if (material.HasProperty("_WrapAmount")) material.SetFloat("_WrapAmount", family == "cliff" ? .42f : family == "connector" ? .48f : .58f);
            if (material.HasProperty("_AmbientBoost")) material.SetFloat("_AmbientBoost", family == "water" ? .16f : family == "connector" ? .18f : .12f);
            if (material.HasProperty("_VColorStrength")) material.SetFloat("_VColorStrength", family == "water" ? 0f : 1f);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", .08f);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", 0f);
            // Grass blade detail on the walkable tops only (cliffs / water / connectors stay untextured).
            if (material.HasProperty("_MainTex"))
            {
                var isTop = family != "cliff" && family != "water" && family != "connector";
                material.SetTexture("_MainTex", isTop ? GroundingTextureFactory.GrassTexture() : null);
                if (material.HasProperty("_MainTexScale")) material.SetFloat("_MainTexScale", isTop ? .22f : 0f);
            }
        }

        private static Color ResolveColor(GroundThemeProfile theme, string family)
        {
            return family switch
            {
                "secondary" => theme.SecondaryTop,
                "cliff" => theme.Cliff,
                "route" => theme.Route,
                "lower" => theme.LowerGround,
                _ => theme.PrimaryTop
            };
        }

        public static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var separator = path.LastIndexOf('/');
            if (separator <= 0) throw new InvalidOperationException($"Invalid asset folder: {path}.");
            var parent = path.Substring(0, separator);
            var folderName = path.Substring(separator + 1);
            EnsureFolder(parent);
            var guid = AssetDatabase.CreateFolder(parent, folderName);
            if (string.IsNullOrWhiteSpace(guid))
                throw new InvalidOperationException($"Could not create asset folder: {path}.");
        }

        private static string Sanitize(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "Unnamed";
            foreach (var character in System.IO.Path.GetInvalidFileNameChars())
                value = value.Replace(character, '-');
            return value.Replace(' ', '-').Replace('/', '-');
        }
    }
}