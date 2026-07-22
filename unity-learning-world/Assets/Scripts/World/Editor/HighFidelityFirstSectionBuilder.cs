using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Yuvi720.LearningWorld.Editor
{
    /// <summary>
    /// Assembles approved high-fidelity families into the first connected world
    /// section without changing traversal or learner-state ownership.
    /// </summary>
    public static class HighFidelityFirstSectionBuilder
    {
        public const string SectionPrefabPath = "Assets/Prefabs/World/Sections/PF_YW_Section_MeadowTree_FirstConnection.prefab";
        public const string SectionReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_MeadowTree_FirstConnection.unity";
        public const string SectionCloseupCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/MeadowTreeFirstConnection-Closeup.png";
        public const string SectionGameplayCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/MeadowTreeFirstConnection-GameplayScale.png";

        public const string TerrainInstanceName = "MeadowPath_HighFidelity";
        public const string TreeInstanceName = "CentralLearningTree_HighFidelity";
        public const string RouteAnchorsName = "SectionRouteAnchors";
        public const string SectionViewName = "SectionView";
        public const string AtmosphereRootName = "AtmosphereRoot";

        [MenuItem("Yuvi/World Art/High Fidelity/Build First Meadow Tree Section")]
        public static void BuildFirstConnectedSection()
        {
            EnsureFolders();
            var meadowPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityTerrainAssetBuilder.MeadowPathPrefabPath);
            var treePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityWorldAssetBuilder.CentralTreePrefabPath);
            if (meadowPrefab == null || treePrefab == null)
                throw new InvalidOperationException("Build and validate the meadow path and central tree families before section assembly.");

            HighFidelityTerrainAssetBuilder.ValidateMeadowPathFamily();
            var treeIssues = HighFidelityWorldAssetBuilder.ValidateCentralLearningTree();
            if (treeIssues.Count > 0) throw new InvalidOperationException(string.Join("\n", treeIssues));

            var root = new GameObject("PF_YW_Section_MeadowTree_FirstConnection");
            try
            {
                var meadow = PrefabUtility.InstantiatePrefab(meadowPrefab) as GameObject
                    ?? throw new InvalidOperationException("Could not instantiate the meadow path prefab.");
                meadow.name = TerrainInstanceName;
                meadow.transform.SetParent(root.transform, false);

                var terrain = meadow.GetComponent<TerrainVisual>()
                    ?? throw new InvalidOperationException("The meadow path instance requires TerrainVisual.");
                var treeAnchor = terrain.LandmarkAnchorsRoot.Find("CentralLearningTreeAnchor")
                    ?? throw new InvalidOperationException("The meadow path requires CentralLearningTreeAnchor.");

                var tree = PrefabUtility.InstantiatePrefab(treePrefab) as GameObject
                    ?? throw new InvalidOperationException("Could not instantiate the central tree prefab.");
                tree.name = TreeInstanceName;
                tree.transform.SetParent(root.transform, false);
                tree.transform.SetPositionAndRotation(treeAnchor.position, treeAnchor.rotation);

                BuildRouteAnchors(root.transform, terrain, tree.GetComponent<LandmarkVisual>());
                BuildSectionView(root.transform);

                var saved = PrefabUtility.SaveAsPrefabAsset(root, SectionPrefabPath);
                if (saved == null) throw new InvalidOperationException($"Could not save {SectionPrefabPath}.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            BuildReviewScene();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            var issues = ValidateFirstConnectedSection();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            Debug.Log("✅ First meadow-tree connection built and validated without changing traversal or avatar ownership.");
        }

        [MenuItem("Yuvi/World Art/High Fidelity/Validate First Meadow Tree Section")]
        public static void ValidateFirstConnectedSectionMenu()
        {
            var issues = ValidateFirstConnectedSection();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            Debug.Log("✅ First meadow-tree connection validation passed.");
        }

        [MenuItem("Yuvi/World Art/High Fidelity/Capture First Meadow Tree Section")]
        public static void CaptureFirstConnectedSectionReview()
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(SectionReviewScenePath) == null)
                throw new FileNotFoundException("The first connected-section review scene is missing.", SectionReviewScenePath);

            var scene = EditorSceneManager.OpenScene(SectionReviewScenePath, OpenSceneMode.Single);
            var camera = Camera.main ?? throw new InvalidOperationException("The section review scene requires a Main Camera.");
            var section = scene.GetRootGameObjects().FirstOrDefault(item => item.name == "MeadowTree_FirstConnectionReview")
                ?? throw new InvalidOperationException("The section review instance is missing.");
            var renderers = section.GetComponentsInChildren<Renderer>(false);
            var bounds = CalculateBounds(renderers);

            LogCaptureDiagnostics("section-closeup", scene, camera, renderers, bounds);
            CaptureFrame(
                camera,
                new Vector3(-10.8f, 8.6f, -14.8f),
                new Vector3(1.1f, 3.05f, 1.7f),
                43f,
                1600,
                1100,
                SectionCloseupCapturePath);

            LogCaptureDiagnostics("section-gameplay", scene, camera, renderers, bounds);
            CaptureFrame(
                camera,
                new Vector3(-13.8f, 11.4f, -17.4f),
                new Vector3(1.6f, 2.45f, 1.8f),
                47f,
                1600,
                900,
                SectionGameplayCapturePath);

            AssetDatabase.Refresh();
            Debug.Log($"✅ First connected-section captures saved to {SectionCloseupCapturePath} and {SectionGameplayCapturePath}.");
        }

        public static void RebuildAndCaptureFirstConnectedSectionReview()
        {
            BuildFirstConnectedSection();
            CaptureFirstConnectedSectionReview();
        }

        public static List<string> ValidateFirstConnectedSection()
        {
            var issues = new List<string>();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(SectionPrefabPath);
            if (prefab == null)
            {
                issues.Add($"Missing section prefab: {SectionPrefabPath}.");
                return issues;
            }

            var terrain = prefab.GetComponentsInChildren<TerrainVisual>(true).SingleOrDefault();
            var traversal = prefab.GetComponentsInChildren<WorldTraversalSurface>(true).SingleOrDefault();
            var landmark = prefab.GetComponentsInChildren<LandmarkVisual>(true).SingleOrDefault();
            if (terrain == null) issues.Add("The section requires exactly one TerrainVisual.");
            if (traversal == null) issues.Add("The section requires exactly one WorldTraversalSurface.");
            if (landmark == null) issues.Add("The section requires exactly one LandmarkVisual.");

            if (terrain != null) terrain.CollectValidationIssues(issues);
            if (traversal != null) traversal.CollectValidationIssues(issues);
            if (landmark != null) landmark.CollectValidationIssues(issues);

            if (terrain != null && landmark != null)
            {
                var treeAnchor = terrain.LandmarkAnchorsRoot.Find("CentralLearningTreeAnchor");
                if (treeAnchor == null)
                {
                    issues.Add("The section meadow requires CentralLearningTreeAnchor.");
                }
                else
                {
                    var positionError = Vector3.Distance(landmark.transform.position, treeAnchor.position);
                    var rotationError = Quaternion.Angle(landmark.transform.rotation, treeAnchor.rotation);
                    if (positionError > .001f || rotationError > .01f)
                        issues.Add($"The tree does not match its meadow anchor: position={positionError}, rotation={rotationError}.");
                }

                var movementRenderers = terrain.MovementZonesRoot.GetComponentsInChildren<Renderer>(true);
                if (movementRenderers.Length > 0)
                    issues.Add("Section traversal must remain renderer-free.");
                if (!ApproachIsInsideTraversal(landmark.ApproachAnchor.position, terrain.MovementZonesRoot))
                    issues.Add("The central-tree approach anchor is outside the meadow traversal area.");
            }

            var routeRoot = prefab.transform.Find(RouteAnchorsName);
            if (routeRoot == null)
            {
                issues.Add($"The section requires {RouteAnchorsName}.");
            }
            else
            {
                var start = routeRoot.Find("Start");
                var approach = routeRoot.Find("TreeApproach");
                var exit = routeRoot.Find("Exit");
                if (start == null || approach == null || exit == null)
                {
                    issues.Add("Section route anchors require Start, TreeApproach, and Exit.");
                }
                else if (!(start.position.x < approach.position.x && approach.position.x < exit.position.x
                    && start.position.z <= approach.position.z && approach.position.z <= exit.position.z))
                {
                    issues.Add("Section route anchors must progress from far-left toward right/up-right.");
                }
            }

            var sectionViews = prefab.GetComponentsInChildren<WorldSectionView>(true);
            if (sectionViews.Length != 1)
            {
                issues.Add($"The section requires exactly one WorldSectionView; found {sectionViews.Length}.");
            }
            else
            {
                sectionViews[0].CollectValidationIssues(issues);
                if (sectionViews[0].AtmosphereRoot == null)
                    issues.Add("The section requires an explicit AtmosphereRoot.");
                else if (sectionViews[0].AtmosphereRoot.GetComponentsInChildren<Collider>(true).Length > 0)
                    issues.Add("Atmosphere objects must not own collision or traversal.");
            }

            if (prefab.GetComponentsInChildren<Renderer>(true).Any(renderer =>
                    renderer.name.Contains("Yuvi", StringComparison.OrdinalIgnoreCase)
                    || renderer.name.Contains("YuviPlayer", StringComparison.OrdinalIgnoreCase)))
                issues.Add("The section must not introduce a visible Unity avatar; Three.js Yuvi remains canonical.");

            return issues;
        }

        private static void BuildRouteAnchors(Transform sectionRoot, TerrainVisual terrain, LandmarkVisual landmark)
        {
            if (landmark == null) throw new InvalidOperationException("The central tree requires LandmarkVisual.");
            var west = terrain.BridgeAnchorsRoot.Find("WestEntryAnchor")
                ?? throw new InvalidOperationException("The meadow path requires WestEntryAnchor.");
            var east = terrain.BridgeAnchorsRoot.Find("EastExitAnchor")
                ?? throw new InvalidOperationException("The meadow path requires EastExitAnchor.");

            var route = Child(sectionRoot, RouteAnchorsName);
            CopyWorldPose(Child(route, "Start"), west);
            CopyWorldPose(Child(route, "TreeApproach"), landmark.ApproachAnchor);
            CopyWorldPose(Child(route, "Exit"), east);
        }

        private static void BuildSectionView(Transform sectionRoot)
        {
            var viewRoot = Child(sectionRoot, SectionViewName);
            var atmosphere = Child(viewRoot, AtmosphereRootName);
            var cameraAnchor = Child(viewRoot, "CameraAnchor");
            cameraAnchor.localPosition = new Vector3(0f, 12.4f, -9.2f);
            cameraAnchor.localRotation = Quaternion.Euler(54f, 0f, 0f);

            var volumeRoot = Child(viewRoot, "CoverageVolume");
            var volume = volumeRoot.gameObject.AddComponent<BoxCollider>();
            volume.isTrigger = true;
            volume.center = new Vector3(0f, 2f, 0f);
            volume.size = new Vector3(24f, 8f, 16f);

            viewRoot.gameObject.AddComponent<WorldSectionView>().Configure(
                "meadow-tree",
                cameraAnchor,
                volume,
                atmosphere,
                11.3f);
        }

        private static void BuildReviewScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Hex("D7DFD3");
            RenderSettings.ambientEquatorColor = Hex("9DADA1");
            RenderSettings.ambientGroundColor = Hex("596453");
            RenderSettings.ambientIntensity = 1.05f;
            RenderSettings.reflectionIntensity = .38f;
            RenderSettings.fog = false;

            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Hex("CDD6D0");
            camera.fieldOfView = 45f;
            camera.nearClipPlane = .1f;
            camera.farClipPlane = 180f;
            camera.allowHDR = true;
            cameraObject.AddComponent<AudioListener>();
            cameraObject.transform.position = new Vector3(-10.8f, 8.6f, -14.8f);
            cameraObject.transform.LookAt(new Vector3(1.1f, 3.05f, 1.7f));

            var keyObject = new GameObject("Directional Key Light");
            var key = keyObject.AddComponent<Light>();
            key.type = LightType.Directional;
            key.color = Hex("FFF3D4");
            key.intensity = 1.32f;
            key.shadows = LightShadows.Soft;
            key.shadowStrength = .72f;
            key.shadowBias = .035f;
            keyObject.transform.rotation = Quaternion.Euler(48f, -38f, 0f);

            var fillObject = new GameObject("Cool Fill Light");
            var fill = fillObject.AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.color = Hex("BBD6D0");
            fill.intensity = .4f;
            fill.shadows = LightShadows.None;
            fillObject.transform.rotation = Quaternion.Euler(32f, 140f, 0f);

            var rimObject = new GameObject("Warm Rim Light");
            var rim = rimObject.AddComponent<Light>();
            rim.type = LightType.Point;
            rim.color = Hex("F5B96B");
            rim.intensity = 1.4f;
            rim.range = 20f;
            rim.shadows = LightShadows.None;
            rimObject.transform.position = new Vector3(7f, 8f, 5f);

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(SectionPrefabPath)
                ?? throw new InvalidOperationException($"Missing section prefab: {SectionPrefabPath}.");
            var section = PrefabUtility.InstantiatePrefab(prefab) as GameObject
                ?? throw new InvalidOperationException("Could not instantiate the first connected section.");
            section.name = "MeadowTree_FirstConnectionReview";
            SceneManager.MoveGameObjectToScene(section, scene);
            var landmark = section.GetComponentInChildren<LandmarkVisual>(true);
            if (landmark != null) landmark.StateRoot.gameObject.SetActive(false);

            var systems = new GameObject("WorldSystems");
            systems.AddComponent<WorldMotionController>().Configure(section.transform, false, false);
            SceneManager.MoveGameObjectToScene(systems, scene);

            EditorSceneManager.SaveScene(scene, SectionReviewScenePath);
        }

        private static bool ApproachIsInsideTraversal(Vector3 approach, Transform movementRoot)
        {
            foreach (var collider in movementRoot.GetComponentsInChildren<Collider>(true))
            {
                if (collider is BoxCollider box)
                {
                    var local = box.transform.InverseTransformPoint(approach);
                    local.y = box.center.y;
                    if (new Bounds(box.center, box.size).Contains(local)) return true;
                    continue;
                }

                var bounds = collider.bounds;
                var worldPoint = new Vector3(approach.x, bounds.center.y, approach.z);
                if (bounds.Contains(worldPoint)) return true;
            }
            return false;
        }

        private static void CopyWorldPose(Transform destination, Transform source)
        {
            destination.SetPositionAndRotation(source.position, source.rotation);
        }

        private static void CaptureFrame(
            Camera camera,
            Vector3 position,
            Vector3 target,
            float fieldOfView,
            int width,
            int height,
            string assetPath)
        {
            camera.transform.position = position;
            camera.transform.LookAt(target);
            camera.fieldOfView = fieldOfView;
            Shader.WarmupAllShaders();

            var projectRoot = Path.GetDirectoryName(Application.dataPath)
                ?? throw new InvalidOperationException("The Unity project root could not be resolved.");
            var absolutePath = Path.Combine(projectRoot, assetPath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)
                ?? throw new InvalidOperationException($"Invalid capture path: {assetPath}."));

            var renderTexture = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            var previousTarget = camera.targetTexture;
            var previousActive = RenderTexture.active;
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false, false);
            try
            {
                camera.targetTexture = renderTexture;
                camera.Render();
                RenderTexture.active = renderTexture;
                texture.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                texture.Apply(false, false);
                ValidateCapture(texture, assetPath);
                File.WriteAllBytes(absolutePath, texture.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                RenderTexture.ReleaseTemporary(renderTexture);
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static void ValidateCapture(Texture2D texture, string assetPath)
        {
            var samples = new HashSet<Color32>();
            const int grid = 20;
            for (var y = 0; y < grid; y++)
            for (var x = 0; x < grid; x++)
            {
                samples.Add(texture.GetPixel(
                    Mathf.RoundToInt(x / (float)(grid - 1) * (texture.width - 1)),
                    Mathf.RoundToInt(y / (float)(grid - 1) * (texture.height - 1))));
            }

            if (samples.Count < 3)
                throw new InvalidOperationException(
                    $"Capture integrity failed for {assetPath}: only {samples.Count} sampled colors. " +
                    "Run with a graphics device; do not use -nographics.");
        }

        private static Bounds CalculateBounds(IEnumerable<Renderer> renderers)
        {
            var available = renderers.Where(renderer => renderer != null && renderer.enabled).ToArray();
            if (available.Length == 0) return new Bounds(Vector3.zero, Vector3.zero);
            var bounds = available[0].bounds;
            foreach (var renderer in available.Skip(1)) bounds.Encapsulate(renderer.bounds);
            return bounds;
        }

        private static void LogCaptureDiagnostics(string label, Scene scene, Camera camera, Renderer[] renderers, Bounds bounds)
        {
            var viewport = camera.WorldToViewportPoint(bounds.center);
            Debug.Log($"[HF capture:{label}] roots={scene.rootCount}, renderers={renderers.Length}, bounds={bounds}, camera={camera.transform.position}, viewport={viewport}, cullingMask={camera.cullingMask}.");
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name).transform;
            child.SetParent(parent, false);
            return child;
        }

        private static void EnsureFolders()
        {
            EnsureFolder("Assets/Art/World/HighFidelity/ReviewCaptures");
            EnsureFolder("Assets/Prefabs/World/Sections");
            EnsureFolder("Assets/Scenes/ArtReview");
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