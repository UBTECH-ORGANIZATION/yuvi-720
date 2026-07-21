using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using Yuvi720.LearningWorld;

namespace Yuvi720.Editor
{
    public static class BuildLearningWorld
    {
        // Single-scene fallback: the whole hand-composed island in one downloaded blob (carries the bridge).
        private const string ScenePath = "Assets/Scenes/ArtReview/Grounding/SCN_YW_Arrival_Production.unity";
        // Streamed build: tiny always-resident boot scene; sections stream in as remote Addressable bundles.
        private const string BootScenePath = "Assets/Scenes/ArtReview/Grounding/SCN_YW_Boot.unity";

        [MenuItem("Yuvi/Build Learning World Web")]
        public static void BuildWeb() => BuildTo(new[] { ScenePath }, streamed: false);

        [MenuItem("Yuvi/Build Learning World Web (Streamed)")]
        public static void BuildWebStreamed()
        {
            ValidateScene(BootScenePath);
            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);

            // 1) Build the section bundles + remote catalog to a staging ServerData dir that survives the
            //    player-output wipe (it lives under the Unity project, not under the output folder).
            var projectRoot = Directory.GetParent(Application.dataPath)!.FullName;
            var serverDataStaging = Path.Combine(projectRoot, "ServerData");
            if (Directory.Exists(serverDataStaging)) Directory.Delete(serverDataStaging, true);
            StreamedWorldAddressables.Configure(serverDataStaging);
            StreamedWorldAddressables.BuildContent();

            // 2) Build the player (boot scene only — sections come from Addressables, not the scene list).
            var output = BuildTo(new[] { BootScenePath }, streamed: true);

            // 3) Publish the section bundles alongside the player so the browser can fetch them on demand.
            //    DEPLOY: the host must serve unity-world/ServerData/** as well as unity-world/Build/**.
            var serverDataOut = Path.Combine(output, "ServerData");
            CopyDirectory(serverDataStaging, serverDataOut);
            Debug.Log($"✅ Streamed section content published to {serverDataOut} (host it alongside Build/).");
        }

        private static string BuildTo(string[] scenes, bool streamed)
        {
            ValidateScene(scenes[0]);
            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
            ApplyWebPlayerSettings();

            var projectRoot = Directory.GetParent(Application.dataPath)!.FullName;
            var repositoryRoot = Directory.GetParent(projectRoot)!.FullName;
            var output = Path.Combine(repositoryRoot, "frontend", "public", "unity-world");
            if (Directory.Exists(output)) Directory.Delete(output, true);
            Directory.CreateDirectory(output);

            var options = new BuildPlayerOptions
            {
                scenes = scenes,
                locationPathName = output,
                target = BuildTarget.WebGL,
                options = BuildOptions.CleanBuildCache
            };
            var report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != BuildResult.Succeeded)
                throw new BuildFailedException($"Unity Web build failed: {report.summary.result}");

            File.WriteAllText(Path.Combine(output, "build-version.json"),
                $"{{\"buildId\":\"{Guid.NewGuid():N}\",\"unity\":\"{Application.unityVersion}\",\"renderer\":\"unity-webgl\",\"streamed\":{(streamed ? "true" : "false")}}}\n");
            Debug.Log($"Unity learning world built at {output} ({report.summary.totalSize} bytes).");
            return output;
        }

        private static void ApplyWebPlayerSettings()
        {
            PlayerSettings.productName = "Yuvilab Spark Learning World";
            PlayerSettings.companyName = "Yuvilab";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.WebGL, "ai.yuvilab.spark.learningworld");
            PlayerSettings.SplashScreen.show = false;
            PlayerSettings.SplashScreen.showUnityLogo = false;
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.dataCaching = true;
            PlayerSettings.WebGL.debugSymbolMode = WebGLDebugSymbolMode.Off;
            // Lean production exception mode — our own throws still surface; no per-instruction bloat.
            PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
            // Streaming keeps only the resident section(s) in memory, but keep a generous ceiling so heap
            // growth never hits the wall (the old 768 MB cap OOM'd at load). Start small, grow geometrically.
            PlayerSettings.WebGL.initialMemorySize = 256;
            PlayerSettings.WebGL.maximumMemorySize = 2048;
            PlayerSettings.WebGL.memoryGrowthMode = WebGLMemoryGrowthMode.Geometric;
            PlayerSettings.WebGL.powerPreference = WebGLPowerPreference.HighPerformance;
            PlayerSettings.runInBackground = true;
            PlayerSettings.stripEngineCode = true;
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.SetGraphicsAPIs(BuildTarget.WebGL, new[] { UnityEngine.Rendering.GraphicsDeviceType.OpenGLES3 });
            PreserveRuntimeShader();
        }

        private static void CopyDirectory(string source, string dest)
        {
            if (!Directory.Exists(source)) throw new BuildFailedException($"ServerData staging missing: {source}");
            Directory.CreateDirectory(dest);
            foreach (var dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dir.Replace(source, dest));
            foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
                File.Copy(file, file.Replace(source, dest), true);
        }

        private static void ValidateScene(string scenePath)
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(scenePath) == null)
                throw new BuildFailedException($"Authored learning-world scene is missing: {scenePath}");
        }

        private static void PreserveRuntimeShader()
        {
            var standard = Shader.Find("Standard");
            if (standard == null) throw new BuildFailedException("Unity Standard shader is unavailable.");
            var settings = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset").FirstOrDefault();
            if (settings == null) throw new BuildFailedException("Unity Graphics Settings are unavailable.");
            var serialized = new SerializedObject(settings);
            var included = serialized.FindProperty("m_AlwaysIncludedShaders");
            if (included == null) throw new BuildFailedException("Always Included Shaders setting is unavailable.");
            for (var index = 0; index < included.arraySize; index++)
                if (included.GetArrayElementAtIndex(index).objectReferenceValue == standard) return;
            included.InsertArrayElementAtIndex(included.arraySize);
            included.GetArrayElementAtIndex(included.arraySize - 1).objectReferenceValue = standard;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }
    }
}
