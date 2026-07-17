using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace Yuvi720.LearningWorld.Editor
{
    /// <summary>
    /// Assembles the second right/up-right section from individually reviewed
    /// buildings and atmosphere while preserving the approved traversal family.
    /// </summary>
    public static class HighFidelitySecondSectionBuilder
    {
        public const string SectionPrefabPath = "Assets/Prefabs/World/Sections/PF_YW_Section_WoodlandArchive_SecondConnection.prefab";
        public const string SectionReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_WoodlandArchive_SecondConnection.unity";
        public const string CombinedReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_TwoSection_ConnectedMap.unity";
        public const string SectionCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/WoodlandArchive-SectionView.png";
        public const string CombinedCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/TwoSection-ConnectedMap.png";
        public const string RouteAnchorsName = "SectionRouteAnchors";
        public const string TerrainInstanceName = "WoodlandPath_HighFidelity";
        public const string ArchiveInstanceName = "ArchiveHall_HighFidelity";
        public const string PavilionInstanceName = "StoryPavilion_HighFidelity";
        public const string AtmosphereInstanceName = "WoodlandArchive_Atmosphere";
        public static readonly Vector3 CombinedSectionOffset = new(22.8f, .2f, 8.5f);

        [MenuItem("Yuvi/World Art/High Fidelity/05 Build Second Woodland Archive Section")]
        public static void BuildSecondConnectedSection()
        {
            EnsureFolder("Assets/Prefabs/World/Sections");
            EnsureFolder("Assets/Scenes/ArtReview");
            EnsureFolder("Assets/Art/World/HighFidelity/ReviewCaptures");
            HighFidelityTerrainAssetBuilder.ValidateMeadowPathFamily();
            var sourceIssues = HighFidelityWorldAssetBuilder.ValidateArchiveHall()
                .Concat(HighFidelityWorldAssetBuilder.ValidateStoryPavilion())
                .Concat(HighFidelityWorldAssetBuilder.ValidateWoodlandAtmosphere())
                .ToArray();
            if (sourceIssues.Length > 0) throw new InvalidOperationException(string.Join("\n", sourceIssues));

            var root = new GameObject("PF_YW_Section_WoodlandArchive_SecondConnection");
            try
            {
                var terrain = Instantiate(HighFidelityTerrainAssetBuilder.MeadowPathPrefabPath, root.transform, TerrainInstanceName);
                var archive = Instantiate(HighFidelityWorldAssetBuilder.ArchiveHallPrefabPath, root.transform, ArchiveInstanceName);
                archive.transform.localPosition = new Vector3(2.2f, .24f, 2.8f);
                archive.transform.localRotation = Quaternion.Euler(0f, -5f, 0f);
                var pavilion = Instantiate(HighFidelityWorldAssetBuilder.StoryPavilionPrefabPath, root.transform, PavilionInstanceName);
                pavilion.transform.localPosition = new Vector3(7.3f, .22f, 4.2f);
                pavilion.transform.localRotation = Quaternion.Euler(0f, -14f, 0f);
                var atmosphere = Instantiate(HighFidelityWorldAssetBuilder.WoodlandAtmospherePrefabPath, root.transform, AtmosphereInstanceName);

                var terrainVisual = terrain.GetComponent<TerrainVisual>()
                    ?? throw new InvalidOperationException("Second-section terrain requires TerrainVisual.");
                BuildRoute(root.transform, terrainVisual, archive.GetComponent<LandmarkVisual>(), pavilion.GetComponent<LandmarkVisual>());
                BuildSectionView(root.transform, atmosphere.transform);

                if (PrefabUtility.SaveAsPrefabAsset(root, SectionPrefabPath) == null)
                    throw new InvalidOperationException($"Could not save {SectionPrefabPath}.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            BuildReviewScene(false);
            BuildReviewScene(true);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            var issues = ValidateSecondConnectedSection();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            Debug.Log("✅ Second woodland/archive section built with one static view, two building types, and visual-only atmosphere.");
        }

        [MenuItem("Yuvi/World Art/High Fidelity/Capture Second And Combined Sections")]
        public static void CaptureSecondAndCombinedSections()
        {
            CaptureScene(SectionReviewScenePath, SectionCapturePath, 1600, 1000);
            CaptureScene(CombinedReviewScenePath, CombinedCapturePath, 1800, 1000);
            AssetDatabase.Refresh();
            Debug.Log("✅ Second-section and connected-map captures saved.");
        }

        public static List<string> ValidateSecondConnectedSection()
        {
            var issues = new List<string>();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(SectionPrefabPath);
            if (prefab == null)
            {
                issues.Add($"Missing second section prefab: {SectionPrefabPath}.");
                return issues;
            }

            var terrain = prefab.GetComponentsInChildren<TerrainVisual>(true).SingleOrDefault();
            var traversal = prefab.GetComponentsInChildren<WorldTraversalSurface>(true).SingleOrDefault();
            var landmarks = prefab.GetComponentsInChildren<LandmarkVisual>(true);
            var views = prefab.GetComponentsInChildren<WorldSectionView>(true);
            if (terrain == null) issues.Add("Second section requires exactly one TerrainVisual.");
            if (traversal == null) issues.Add("Second section requires exactly one WorldTraversalSurface.");
            if (landmarks.Length != 2) issues.Add($"Second section requires exactly two distinct buildings; found {landmarks.Length}.");
            if (views.Length != 1) issues.Add($"Second section requires exactly one WorldSectionView; found {views.Length}.");
            if (terrain != null)
            {
                terrain.CollectValidationIssues(issues);
                if (terrain.MovementZonesRoot.GetComponentsInChildren<Renderer>(true).Length > 0)
                    issues.Add("Traversal must remain renderer-free.");
            }
            if (traversal != null) traversal.CollectValidationIssues(issues);
            foreach (var landmark in landmarks) landmark.CollectValidationIssues(issues);
            if (views.Length == 1)
            {
                views[0].CollectValidationIssues(issues);
                if (views[0].AtmosphereRoot == null) issues.Add("Second section requires an atmosphere root.");
                else if (views[0].AtmosphereRoot.GetComponentsInChildren<Collider>(true).Length > 0)
                    issues.Add("Atmosphere must not own collision or traversal.");
            }

            var archive = prefab.transform.Find(ArchiveInstanceName);
            var pavilion = prefab.transform.Find(PavilionInstanceName);
            if (archive == null || pavilion == null)
            {
                issues.Add("Archive Hall and Story Pavilion are both required.");
            }
            else if (Mathf.Abs(BoundsOf(archive.gameObject).size.y - BoundsOf(pavilion.gameObject).size.y) < 1f)
            {
                issues.Add("Buildings need visibly different vertical silhouettes.");
            }
            ValidateRoute(prefab.transform.Find(RouteAnchorsName), issues);
            if (prefab.GetComponentsInChildren<Renderer>(true).Any(renderer =>
                    renderer.name.Contains("Yubi", StringComparison.OrdinalIgnoreCase)
                    || renderer.name.Contains("YuviPlayer", StringComparison.OrdinalIgnoreCase)))
                issues.Add("Three.js Yubi remains the only visible avatar.");
            return issues;
        }

        private static void BuildRoute(Transform root, TerrainVisual terrain, LandmarkVisual archive, LandmarkVisual pavilion)
        {
            if (archive == null || pavilion == null) throw new InvalidOperationException("Both building contracts are required.");
            var west = terrain.BridgeAnchorsRoot.Find("WestEntryAnchor")
                ?? throw new InvalidOperationException("Terrain requires WestEntryAnchor.");
            var east = terrain.BridgeAnchorsRoot.Find("EastExitAnchor")
                ?? throw new InvalidOperationException("Terrain requires EastExitAnchor.");
            var route = Child(root, RouteAnchorsName);
            CopyPose(Child(route, "Start"), west);
            CopyPose(Child(route, "ArchiveApproach"), archive.ApproachAnchor);
            CopyPose(Child(route, "PavilionApproach"), pavilion.ApproachAnchor);
            CopyPose(Child(route, "Exit"), east);
        }

        private static void BuildSectionView(Transform root, Transform atmosphere)
        {
            var viewRoot = Child(root, "SectionView");
            atmosphere.SetParent(viewRoot, true);
            var cameraAnchor = Child(viewRoot, "CameraAnchor");
            cameraAnchor.localPosition = new Vector3(0f, 13.2f, -9.8f);
            cameraAnchor.localRotation = Quaternion.Euler(54f, 0f, 0f);
            var volumeObject = Child(viewRoot, "CoverageVolume");
            var volume = volumeObject.gameObject.AddComponent<BoxCollider>();
            volume.isTrigger = true;
            volume.center = new Vector3(0f, 2.5f, 0f);
            volume.size = new Vector3(24f, 10f, 16f);
            viewRoot.gameObject.AddComponent<WorldSectionView>().Configure(
                "woodland-archive", cameraAnchor, volume, atmosphere, 12.1f);
        }

        private static void BuildReviewScene(bool combined)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            ConfigureEnvironment();
            var content = new GameObject("ReviewContent").transform;
            WorldSectionView activeView;
            if (combined)
            {
                var first = Instantiate(HighFidelityFirstSectionBuilder.SectionPrefabPath, content, "MeadowTree_FirstSection");
                var second = Instantiate(SectionPrefabPath, content, "WoodlandArchive_SecondSection");
                second.transform.position = CombinedSectionOffset;
                HideStates(first);
                HideStates(second);
                activeView = null;
            }
            else
            {
                var section = Instantiate(SectionPrefabPath, content, "WoodlandArchive_SecondConnectionReview");
                HideStates(section);
                activeView = section.GetComponentInChildren<WorldSectionView>(true);
            }

            CreateCamera(activeView, combined);
            CreateLights();
            var systems = new GameObject("WorldSystems");
            systems.AddComponent<WorldMotionController>().Configure(content, false, false);
            EditorSceneManager.SaveScene(scene, combined ? CombinedReviewScenePath : SectionReviewScenePath);
        }

        private static void CreateCamera(WorldSectionView sectionView, bool combined)
        {
            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Hex("B8C5BF");
            camera.nearClipPlane = .1f;
            camera.farClipPlane = 180f;
            cameraObject.AddComponent<AudioListener>();
            if (combined)
            {
                camera.orthographicSize = 18.5f;
                cameraObject.transform.position = new Vector3(11.4f, 24f, -12f);
                cameraObject.transform.rotation = Quaternion.Euler(54f, 0f, 0f);
            }
            else
            {
                if (sectionView == null || sectionView.CameraAnchor == null)
                    throw new InvalidOperationException("Second section view is missing.");
                camera.orthographicSize = sectionView.OrthographicSize;
                cameraObject.transform.SetPositionAndRotation(sectionView.CameraAnchor.position, sectionView.CameraAnchor.rotation);
            }
        }

        private static void ConfigureEnvironment()
        {
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Hex("C7D2CD");
            RenderSettings.ambientEquatorColor = Hex("84968C");
            RenderSettings.ambientGroundColor = Hex("3F4D3E");
            RenderSettings.ambientIntensity = 1.06f;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = Hex("B8C5BF");
            RenderSettings.fogStartDistance = 34f;
            RenderSettings.fogEndDistance = 86f;
        }

        private static void CreateLights()
        {
            var keyObject = new GameObject("Directional Key Light");
            var key = keyObject.AddComponent<Light>();
            key.type = LightType.Directional;
            key.color = Hex("FFE4BA");
            key.intensity = 1.25f;
            key.shadows = LightShadows.Soft;
            key.shadowStrength = .72f;
            keyObject.transform.rotation = Quaternion.Euler(47f, -40f, 0f);
            var fillObject = new GameObject("Cool Fill Light");
            var fill = fillObject.AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.color = Hex("AED0CC");
            fill.intensity = .4f;
            fill.shadows = LightShadows.None;
            fillObject.transform.rotation = Quaternion.Euler(30f, 138f, 0f);
        }

        private static void CaptureScene(string scenePath, string capturePath, int width, int height)
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(scenePath) == null)
                throw new FileNotFoundException("Review scene is missing.", scenePath);
            EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            var camera = Camera.main ?? throw new InvalidOperationException("Review scene requires a Main Camera.");
            Shader.WarmupAllShaders();
            var projectRoot = Path.GetDirectoryName(Application.dataPath)
                ?? throw new InvalidOperationException("Unity project root could not be resolved.");
            var absolutePath = Path.Combine(projectRoot, capturePath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)
                ?? throw new InvalidOperationException($"Invalid capture path: {capturePath}."));
            var target = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            var previousTarget = camera.targetTexture;
            var previousActive = RenderTexture.active;
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false, false);
            try
            {
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                texture.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                texture.Apply(false, false);
                var colors = new HashSet<Color32>();
                for (var y = 0; y < 18; y++)
                for (var x = 0; x < 18; x++)
                    colors.Add(texture.GetPixel(x * (width - 1) / 17, y * (height - 1) / 17));
                if (colors.Count < 3) throw new InvalidOperationException($"Blank capture rejected: {capturePath}.");
                File.WriteAllBytes(absolutePath, texture.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                RenderTexture.ReleaseTemporary(target);
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static void ValidateRoute(Transform route, List<string> issues)
        {
            if (route == null)
            {
                issues.Add($"Second section requires {RouteAnchorsName}.");
                return;
            }
            var anchors = new[] { "Start", "ArchiveApproach", "PavilionApproach", "Exit" }
                .Select(route.Find).ToArray();
            if (anchors.Any(anchor => anchor == null))
            {
                issues.Add("Route requires Start, ArchiveApproach, PavilionApproach, and Exit.");
                return;
            }
            for (var index = 1; index < anchors.Length; index++)
            {
                if (anchors[index].position.x <= anchors[index - 1].position.x)
                    issues.Add("Route must progress continuously toward the right.");
                if (anchors[index].position.z < anchors[index - 1].position.z)
                    issues.Add("Route must progress right/up-right without retreating.");
            }
        }

        private static GameObject Instantiate(string path, Transform parent, string name)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path)
                ?? throw new InvalidOperationException($"Missing required prefab: {path}.");
            var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject
                ?? throw new InvalidOperationException($"Could not instantiate {prefab.name}.");
            instance.name = name;
            if (parent != null) instance.transform.SetParent(parent, false);
            return instance;
        }

        private static void HideStates(GameObject root)
        {
            foreach (var landmark in root.GetComponentsInChildren<LandmarkVisual>(true))
                if (landmark.StateRoot != null) landmark.StateRoot.gameObject.SetActive(false);
        }

        private static Bounds BoundsOf(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return new Bounds(root.transform.position, Vector3.zero);
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
            return bounds;
        }

        private static void CopyPose(Transform destination, Transform source)
        {
            destination.SetPositionAndRotation(source.position, source.rotation);
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name).transform;
            child.SetParent(parent, false);
            return child;
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            var name = Path.GetFileName(path);
            if (string.IsNullOrWhiteSpace(parent) || string.IsNullOrWhiteSpace(name))
                throw new InvalidOperationException($"Invalid asset folder: {path}.");
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, name);
        }

        private static Color Hex(string value)
        {
            return ColorUtility.TryParseHtmlString($"#{value}", out var color)
                ? color
                : throw new InvalidOperationException($"Invalid color: {value}.");
        }
    }
}
