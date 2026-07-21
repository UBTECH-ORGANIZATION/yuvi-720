using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Yuvi720.LearningWorld.Editor
{
    public static class WorldAssetFoundationBuilder
    {
        public const string CatalogPath = "Assets/Data/World/Catalogs/SO_YW_WorldAssetCatalog_Production.asset";
        public const string TerrainPrefabPath = "Assets/Prefabs/World/Terrain/PF_YW_Terrain_Template.prefab";
        public const string LandmarkPrefabPath = "Assets/Prefabs/World/Buildings/PF_YW_Landmark_Template.prefab";
        public const string BridgePrefabPath = "Assets/Prefabs/World/Bridges/PF_YW_Bridge_Template.prefab";
        public const string DecorationPrefabPath = "Assets/Prefabs/World/Props/PF_YW_Decoration_Template.prefab";
        public const string GrayscaleReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_GrayscaleVerticalSlice.unity";

        private static readonly string[] RequiredFolders =
        {
            "Assets/Art/World/ArtSource",
            "Assets/Art/World/Atlases",
            "Assets/Art/World/Buildings",
            "Assets/Art/World/Bridges",
            "Assets/Art/World/Characters",
            "Assets/Art/World/Effects",
            "Assets/Art/World/Materials",
            "Assets/Art/World/Props",
            "Assets/Art/World/Terrain",
            "Assets/Art/World/Vegetation",
            "Assets/Art/World/Water",
            "Assets/Data/World/Catalogs",
            "Assets/Data/World/Layouts",
            "Assets/Prefabs/World/Buildings",
            "Assets/Prefabs/World/Bridges",
            "Assets/Prefabs/World/Characters",
            "Assets/Prefabs/World/Effects",
            "Assets/Prefabs/World/Props",
            "Assets/Prefabs/World/Terrain",
            "Assets/Prefabs/World/Vegetation",
            "Assets/Scenes/ArtReview",
            "Assets/Shaders/World"
        };

        [MenuItem("Yuvi/World Art/Create Wave 0B Foundation")]
        public static void CreateFoundation()
        {
            foreach (var folder in RequiredFolders) EnsureFolder(folder);

            var terrain = LoadOrCreatePrefab(TerrainPrefabPath, CreateTerrainTemplate);
            EnsureTerrainTraversalContract();
            terrain = AssetDatabase.LoadAssetAtPath<GameObject>(TerrainPrefabPath);
            var landmark = LoadOrCreatePrefab(LandmarkPrefabPath, CreateLandmarkTemplate);
            EnsureLandmarkLayerContract();
            landmark = AssetDatabase.LoadAssetAtPath<GameObject>(LandmarkPrefabPath);
            var bridge = LoadOrCreatePrefab(BridgePrefabPath, CreateBridgeTemplate);
            var decoration = LoadOrCreatePrefab(DecorationPrefabPath, CreateDecorationTemplate);

            var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(CatalogPath);
            if (catalog == null)
            {
                catalog = ScriptableObject.CreateInstance<WorldAssetCatalog>();
                AssetDatabase.CreateAsset(catalog, CatalogPath);
            }

            catalog.EditorEnsureFoundationEntry("terrain.template", WorldAssetKind.Terrain, terrain);
            catalog.EditorEnsureFoundationEntry("landmark.template", WorldAssetKind.Landmark, landmark);
            catalog.EditorEnsureFoundationEntry("bridge.template", WorldAssetKind.Bridge, bridge);
            catalog.EditorEnsureFoundationEntry("decoration.template", WorldAssetKind.Prop, decoration);
            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            var issues = ValidateFoundation();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            Selection.activeObject = catalog;
            Debug.Log("✅ Unity world Wave 0B foundation created and validated.");
        }

        [MenuItem("Yuvi/World Art/Validate Wave 0B Foundation")]
        public static void ValidateFoundationMenu()
        {
            var issues = ValidateFoundation();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            Debug.Log("✅ Unity world Wave 0B foundation is valid.");
        }

        [MenuItem("Yuvi/World Art/Create Grayscale Review Scene Foundation")]
        public static void CreateGrayscaleReviewSceneFoundation()
        {
            EnsureFolder("Assets/Scenes/ArtReview");
            var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(CatalogPath);
            if (catalog == null) throw new InvalidOperationException($"Missing catalog: {CatalogPath}.");

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 11.5f;
            cameraObject.transform.SetPositionAndRotation(new Vector3(0f, 17f, -12f), Quaternion.Euler(56f, 0f, 0f));

            var lightObject = new GameObject("Directional Light");
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            lightObject.transform.rotation = Quaternion.Euler(46f, -32f, 0f);

            var controllerObject = new GameObject("LearningWorld");
            var controller = controllerObject.AddComponent<LearningWorldController>();
            var serializedController = new SerializedObject(controller);
            serializedController.FindProperty("assetCatalog").objectReferenceValue = catalog;
            serializedController.ApplyModifiedPropertiesWithoutUndo();

            new GameObject("GrayscaleComposition");
            EditorSceneManager.SaveScene(scene, GrayscaleReviewScenePath);
            AssetDatabase.SaveAssets();
            Debug.Log("✅ Fresh grayscale review scene foundation created without Atlas or primitive visual assets.");
        }

        public static List<string> ValidateFoundation()
        {
            var issues = new List<string>();
            foreach (var folder in RequiredFolders)
                if (!AssetDatabase.IsValidFolder(folder)) issues.Add($"Missing folder: {folder}.");

            var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(CatalogPath);
            if (catalog == null) issues.Add($"Missing catalog: {CatalogPath}.");
            else catalog.CollectValidationIssues(issues);

            ValidatePrefab<TerrainVisual>(TerrainPrefabPath, issues, item => item.CollectValidationIssues(issues));
            ValidatePrefab<WorldTraversalSurface>(TerrainPrefabPath, issues, item => item.CollectValidationIssues(issues));
            ValidatePrefab<LandmarkVisual>(LandmarkPrefabPath, issues, item => item.CollectValidationIssues(issues));
            ValidatePrefab<BridgeVisual>(BridgePrefabPath, issues, item => item.CollectValidationIssues(issues));
            ValidatePrefab<WorldDecorationVisual>(DecorationPrefabPath, issues, item => item.CollectValidationIssues(issues));
            return issues;
        }

        private static GameObject LoadOrCreatePrefab(string path, Func<GameObject> create)
        {
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (existing != null) return existing;
            var root = create();
            try
            {
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, path, out var success);
                if (!success || prefab == null) throw new InvalidOperationException($"Could not save prefab: {path}.");
                return prefab;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static GameObject CreateTerrainTemplate()
        {
            var root = new GameObject("PF_YW_Terrain_Template");
            var visual = Child(root.transform, "VisualRoot");
            var movement = Child(root.transform, "MovementZones");
            var defaultArea = Child(movement, "DefaultWalkableArea");
            var defaultCollider = defaultArea.gameObject.AddComponent<BoxCollider>();
            defaultCollider.center = new Vector3(0f, -.1f, 0f);
            defaultCollider.size = new Vector3(20f, .2f, 16f);
            var landmarks = Child(root.transform, "LandmarkAnchors");
            var bridges = Child(root.transform, "BridgeAnchors");
            root.AddComponent<TerrainVisual>().EditorAssignContract(visual, movement, landmarks, bridges);
            root.AddComponent<WorldTraversalSurface>().EditorAssignContract(movement);
            return root;
        }

        private static void EnsureTerrainTraversalContract()
        {
            var root = PrefabUtility.LoadPrefabContents(TerrainPrefabPath);
            try
            {
                var terrain = root.GetComponent<TerrainVisual>();
                if (terrain == null || terrain.MovementZonesRoot == null)
                    throw new InvalidOperationException($"{TerrainPrefabPath}: TerrainVisual movement contract is missing.");

                var traversal = root.GetComponent<WorldTraversalSurface>()
                    ?? root.AddComponent<WorldTraversalSurface>();
                if (terrain.MovementZonesRoot.GetComponentInChildren<Collider>(true) == null)
                {
                    var defaultArea = Child(terrain.MovementZonesRoot, "DefaultWalkableArea");
                    var collider = defaultArea.gameObject.AddComponent<BoxCollider>();
                    collider.center = new Vector3(0f, -.1f, 0f);
                    collider.size = new Vector3(20f, .2f, 16f);
                }
                traversal.EditorAssignContract(terrain.MovementZonesRoot);
                PrefabUtility.SaveAsPrefabAsset(root, TerrainPrefabPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static GameObject CreateLandmarkTemplate()
        {
            var root = new GameObject("PF_YW_Landmark_Template");
            var collider = root.AddComponent<BoxCollider>();
            collider.center = new Vector3(0f, 1.5f, 0f);
            collider.size = new Vector3(3f, 3f, 2f);
            root.AddComponent<LandmarkTarget>();
            var visual = Child(root.transform, "VisualRoot");
            var rearLayer = Child(visual, "RearPaperLayer");
            var mainLayer = Child(visual, "MainPaperLayer");
            var foregroundLayer = Child(visual, "ForegroundPaperLayer");
            ConfigurePaperLayer(rearLayer, .015f);
            ConfigurePaperLayer(mainLayer, 0f);
            ConfigurePaperLayer(foregroundLayer, .045f);
            var state = Child(root.transform, "StateRoot");
            Child(state, "Available").gameObject.SetActive(true);
            Child(state, "Current").gameObject.SetActive(false);
            Child(state, "Locked").gameObject.SetActive(false);
            Child(state, "Completed").gameObject.SetActive(false);
            var shadow = Child(root.transform, "ShadowRoot");
            var interaction = Child(root.transform, "InteractionAnchor");
            interaction.localPosition = new Vector3(0f, 1.5f, 0f);
            var approach = Child(root.transform, "ApproachAnchor");
            approach.localPosition = new Vector3(0f, 0f, -2.2f);
            var focus = Child(root.transform, "FocusAnchor");
            focus.localPosition = new Vector3(0f, 1.5f, 0f);
            root.AddComponent<LandmarkVisual>().EditorAssignContract(
                visual, state, shadow, interaction, approach, focus, collider);
            return root;
        }

        private static void EnsureLandmarkLayerContract()
        {
            var root = PrefabUtility.LoadPrefabContents(LandmarkPrefabPath);
            try
            {
                var landmark = root.GetComponent<LandmarkVisual>();
                if (landmark == null || landmark.VisualRoot == null)
                    throw new InvalidOperationException($"{LandmarkPrefabPath}: LandmarkVisual contract is missing.");

                var visualRoot = root.transform.Find("VisualRoot")
                    ?? throw new InvalidOperationException($"{LandmarkPrefabPath}: VisualRoot hierarchy is missing.");
                EnsurePaperLayer(visualRoot, "RearPaperLayer", .015f);
                EnsurePaperLayer(visualRoot, "MainPaperLayer", 0f);
                EnsurePaperLayer(visualRoot, "ForegroundPaperLayer", .045f);
                PrefabUtility.SaveAsPrefabAsset(root, LandmarkPrefabPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static void EnsurePaperLayer(Transform visualRoot, string name, float parallaxStrength)
        {
            var layer = visualRoot.Find(name) ?? Child(visualRoot, name);
            if (layer.GetComponent<WorldPaperLayer>() == null) ConfigurePaperLayer(layer, parallaxStrength);
        }

        private static void ConfigurePaperLayer(Transform layer, float parallaxStrength)
        {
            var paperLayer = layer.gameObject.AddComponent<WorldPaperLayer>();
            var serializedLayer = new SerializedObject(paperLayer);
            serializedLayer.FindProperty("facing").enumValueIndex = (int)WorldPaperFacing.FaceCamera;
            serializedLayer.FindProperty("visualRoot").objectReferenceValue = layer;
            serializedLayer.FindProperty("parallaxStrength").floatValue = parallaxStrength;
            serializedLayer.ApplyModifiedPropertiesWithoutUndo();
        }

        private static GameObject CreateBridgeTemplate()
        {
            var root = new GameObject("PF_YW_Bridge_Template");
            root.AddComponent<BridgeTarget>();
            var start = Child(root.transform, "StartAnchor");
            start.localPosition = new Vector3(0f, 0f, -2f);
            var end = Child(root.transform, "EndAnchor");
            end.localPosition = new Vector3(0f, 0f, 2f);
            var walkSurfaceObject = Child(root.transform, "WalkSurface").gameObject;
            var walkSurface = walkSurfaceObject.AddComponent<BoxCollider>();
            walkSurface.center = Vector3.zero;
            walkSurface.size = new Vector3(2f, .2f, 4f);
            var visual = Child(root.transform, "VisualRoot");
            var open = Child(root.transform, "OpenState");
            var locked = Child(root.transform, "LockedState");
            locked.gameObject.SetActive(false);
            var blocked = Child(root.transform, "BlockedInteractionAnchor");
            blocked.localPosition = new Vector3(0f, 1f, -1.5f);
            var waterStart = Child(root.transform, "WaterContactStart");
            waterStart.localPosition = start.localPosition;
            var waterEnd = Child(root.transform, "WaterContactEnd");
            waterEnd.localPosition = end.localPosition;
            root.AddComponent<BridgeVisual>().EditorAssignContract(
                start, end, walkSurface, visual, open, locked, blocked, new[] { waterStart, waterEnd });
            return root;
        }

        private static GameObject CreateDecorationTemplate()
        {
            var root = new GameObject("PF_YW_Decoration_Template");
            var visual = Child(root.transform, "VisualRoot");
            var lowPower = Child(root.transform, "LowPowerRoot");
            lowPower.gameObject.SetActive(false);
            root.AddComponent<WorldDecorationVisual>().EditorAssignContract(visual, lowPower, .5f, false);
            return root;
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name).transform;
            child.SetParent(parent, false);
            return child;
        }

        private static void ValidatePrefab<T>(string path, List<string> issues, Action<T> validate) where T : Component
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null)
            {
                issues.Add($"Missing prefab: {path}.");
                return;
            }
            var component = prefab.GetComponent<T>();
            if (component == null)
            {
                issues.Add($"{path}: missing {typeof(T).Name}.");
                return;
            }
            validate(component);
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var separator = path.LastIndexOf('/');
            var parent = path.Substring(0, separator);
            var name = path.Substring(separator + 1);
            EnsureFolder(parent);
            var guid = AssetDatabase.CreateFolder(parent, name);
            if (string.IsNullOrEmpty(guid)) throw new InvalidOperationException($"Could not create folder: {path}.");
        }
    }
}