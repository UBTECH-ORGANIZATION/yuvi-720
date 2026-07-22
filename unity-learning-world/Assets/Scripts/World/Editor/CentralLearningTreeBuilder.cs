using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Yuvi720.LearningWorld.Editor
{
    public static class CentralLearningTreeBuilder
    {
        public const string AssetId = "landmark.central-learning-tree";
        public const string PrefabPath = "Assets/Prefabs/World/Buildings/PF_YW_CentralLearningTree_Grayscale.prefab";
        public const string RearTexturePath = "Assets/Art/World/Buildings/CentralLearningTree/YW_CentralLearningTree_Grayscale_Rear.png";
        public const string MainTexturePath = "Assets/Art/World/Buildings/CentralLearningTree/YW_CentralLearningTree_Grayscale_Main.png";
        public const string ForegroundTexturePath = "Assets/Art/World/Buildings/CentralLearningTree/YW_CentralLearningTree_Grayscale_Foreground.png";
        public const string ShadowTexturePath = "Assets/Art/World/Buildings/CentralLearningTree/YW_CentralLearningTree_Grayscale_Shadow.png";

        private const float PixelsPerUnit = 150f;
        private static readonly Vector2 ArtworkPivot = new(.5f, .078125f);
        private static readonly Vector3 GameplayCameraOffset = new(0f, 11.5f, -8.5f);

        [MenuItem("Yuvi/World Art/Create Central Learning Tree Grayscale Review")]
        public static void CreateGrayscaleReview()
        {
            ImportSprite(RearTexturePath);
            ImportSprite(MainTexturePath);
            ImportSprite(ForegroundTexturePath);
            ImportSprite(ShadowTexturePath);

            var prefab = BuildPrefab();
            AddToCatalog(prefab);
            BuildReviewScene(prefab);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            var issues = ValidateCentralTree();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            Selection.activeObject = prefab;
            Debug.Log("✅ Central learning tree grayscale review asset created and validated.");
        }

        public static List<string> ValidateCentralTree()
        {
            var issues = new List<string>();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            if (prefab == null)
            {
                issues.Add($"Missing prefab: {PrefabPath}.");
                return issues;
            }

            var landmark = prefab.GetComponent<LandmarkVisual>();
            if (landmark == null)
            {
                issues.Add($"{PrefabPath}: LandmarkVisual is required.");
                return issues;
            }

            landmark.CollectValidationIssues(issues);
            var paperLayers = landmark.VisualRoot.GetComponentsInChildren<WorldPaperLayer>(true);
            var paperRenderers = landmark.VisualRoot.GetComponentsInChildren<SpriteRenderer>(true);
            if (paperLayers.Length != 3) issues.Add($"{PrefabPath}: exactly three paper layers are required.");
            if (paperRenderers.Length != 3) issues.Add($"{PrefabPath}: exactly three paper sprites are required.");
            if (landmark.ShadowRoot.GetComponentsInChildren<SpriteRenderer>(true).Length != 1)
                issues.Add($"{PrefabPath}: one contact-shadow sprite is required.");

            var footprint = prefab.transform.Find("ObstacleFootprint");
            if (footprint == null || footprint.GetComponent<BoxCollider>() == null)
                issues.Add($"{PrefabPath}: independent ObstacleFootprint collider is required.");
            if (landmark.InteractionCollider == null || !landmark.InteractionCollider.isTrigger)
                issues.Add($"{PrefabPath}: interaction collider must remain an independent trigger.");

            foreach (var texturePath in new[] { RearTexturePath, MainTexturePath, ForegroundTexturePath, ShadowTexturePath })
            {
                var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
                if (texture == null) issues.Add($"Missing texture: {texturePath}.");
                else if (texture.width != 819 || texture.height != 1024)
                    issues.Add($"{texturePath}: expected optimized 819x1024 import from the 1024x1280 source, found {texture.width}x{texture.height}.");
            }

            var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(WorldAssetFoundationBuilder.CatalogPath);
            if (catalog == null || !catalog.TryResolve(AssetId, false, out var resolved) || resolved != prefab)
                issues.Add($"Catalog entry {AssetId} must resolve to the grayscale tree prefab.");
            return issues;
        }

        private static void ImportSprite(string path)
        {
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            if (AssetImporter.GetAtPath(path) is not TextureImporter importer)
                throw new InvalidOperationException($"Could not configure sprite importer: {path}.");

            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.spritePixelsPerUnit = PixelsPerUnit;
            importer.spritePivot = ArtworkPivot;
            importer.alphaIsTransparency = true;
            importer.mipmapEnabled = false;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.filterMode = FilterMode.Bilinear;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.maxTextureSize = 1024;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.SaveAndReimport();
        }

        private static GameObject BuildPrefab()
        {
            var root = PrefabUtility.LoadPrefabContents(WorldAssetFoundationBuilder.LandmarkPrefabPath);
            try
            {
                root.name = "PF_YW_CentralLearningTree_Grayscale";
                var landmark = root.GetComponent<LandmarkVisual>()
                    ?? throw new InvalidOperationException("Landmark template is missing LandmarkVisual.");

                ConfigureInteractionAndObstacle(root, landmark);
                AddPaperSprite(landmark.VisualRoot.Find("RearPaperLayer"), RearTexturePath, new Vector3(0f, 0f, .16f), 0);
                AddPaperSprite(landmark.VisualRoot.Find("MainPaperLayer"), MainTexturePath, Vector3.zero, 10);
                AddPaperSprite(landmark.VisualRoot.Find("ForegroundPaperLayer"), ForegroundTexturePath, new Vector3(0f, 0f, -.16f), 20);
                AddShadowSprite(landmark.ShadowRoot);

                landmark.InteractionAnchor.localPosition = new Vector3(0f, 3.7f, 0f);
                landmark.ApproachAnchor.localPosition = new Vector3(0f, 0f, -3.2f);
                landmark.FocusAnchor.localPosition = new Vector3(0f, 3.4f, 0f);

                var prefab = PrefabUtility.SaveAsPrefabAsset(root, PrefabPath, out var success);
                if (!success || prefab == null) throw new InvalidOperationException($"Could not save prefab: {PrefabPath}.");
                return prefab;
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static void ConfigureInteractionAndObstacle(GameObject root, LandmarkVisual landmark)
        {
            if (landmark.InteractionCollider is BoxCollider interaction)
            {
                interaction.isTrigger = true;
                interaction.center = new Vector3(0f, 3.5f, 0f);
                interaction.size = new Vector3(6.5f, 7.2f, 2f);
            }

            var existing = root.transform.Find("ObstacleFootprint");
            if (existing != null) UnityEngine.Object.DestroyImmediate(existing.gameObject);
            var footprint = new GameObject("ObstacleFootprint");
            footprint.transform.SetParent(root.transform, false);
            var obstacle = footprint.AddComponent<BoxCollider>();
            obstacle.center = new Vector3(0f, 1.25f, 0f);
            obstacle.size = new Vector3(2.15f, 2.5f, 1.5f);
        }

        private static void AddPaperSprite(Transform layer, string spritePath, Vector3 localPosition, int sortingOrder)
        {
            if (layer == null) throw new InvalidOperationException($"Missing paper layer for {spritePath}.");
            ClearArtwork(layer);
            layer.localPosition = localPosition;
            var artwork = new GameObject("Artwork");
            artwork.transform.SetParent(layer, false);
            var renderer = artwork.AddComponent<SpriteRenderer>();
            renderer.sprite = AssetDatabase.LoadAssetAtPath<Sprite>(spritePath)
                ?? throw new InvalidOperationException($"Missing imported sprite: {spritePath}.");
            renderer.sortingOrder = sortingOrder;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        private static void AddShadowSprite(Transform shadowRoot)
        {
            if (shadowRoot == null) throw new InvalidOperationException("Missing ShadowRoot.");
            ClearArtwork(shadowRoot);
            shadowRoot.localPosition = new Vector3(0f, .035f, 0f);
            shadowRoot.localRotation = Quaternion.Euler(90f, 0f, 0f);
            var artwork = new GameObject("Artwork");
            artwork.transform.SetParent(shadowRoot, false);
            var renderer = artwork.AddComponent<SpriteRenderer>();
            renderer.sprite = AssetDatabase.LoadAssetAtPath<Sprite>(ShadowTexturePath)
                ?? throw new InvalidOperationException($"Missing imported sprite: {ShadowTexturePath}.");
            renderer.sortingOrder = -20;
            renderer.color = new Color(1f, 1f, 1f, .82f);
        }

        private static void ClearArtwork(Transform parent)
        {
            for (var index = parent.childCount - 1; index >= 0; index--)
                UnityEngine.Object.DestroyImmediate(parent.GetChild(index).gameObject);
        }

        private static void AddToCatalog(GameObject prefab)
        {
            var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(WorldAssetFoundationBuilder.CatalogPath)
                ?? throw new InvalidOperationException($"Missing catalog: {WorldAssetFoundationBuilder.CatalogPath}.");
            catalog.EditorEnsureFoundationEntry(AssetId, WorldAssetKind.Landmark, prefab);
            EditorUtility.SetDirty(catalog);
        }

        private static void BuildReviewScene(GameObject prefab)
        {
            var scene = SceneManager.GetActiveScene();
            if (scene.path != WorldAssetFoundationBuilder.GrayscaleReviewScenePath)
                scene = EditorSceneManager.OpenScene(WorldAssetFoundationBuilder.GrayscaleReviewScenePath, OpenSceneMode.Single);

            var composition = GameObject.Find("GrayscaleComposition") ?? new GameObject("GrayscaleComposition");
            composition.tag = "EditorOnly";
            for (var index = composition.transform.childCount - 1; index >= 0; index--)
                UnityEngine.Object.DestroyImmediate(composition.transform.GetChild(index).gameObject);

            var tree = (GameObject)PrefabUtility.InstantiatePrefab(prefab, composition.transform);
            tree.name = "CentralLearningTree_GrayscaleReview";
            tree.transform.position = new Vector3(2.4f, 0f, 2.4f);

            var camera = Camera.main ?? throw new InvalidOperationException("Grayscale review scene requires a Main Camera.");
            var YuviCameraTarget = new Vector3(-2.2f, .85f, -1.5f);
            camera.orthographic = true;
            camera.orthographicSize = 7.5f;
            camera.transform.SetPositionAndRotation(YuviCameraTarget + GameplayCameraOffset, Quaternion.Euler(54f, 0f, 0f));
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.78f, .79f, .80f);
            camera.aspect = 16f / 9f;

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, WorldAssetFoundationBuilder.GrayscaleReviewScenePath);
        }
    }
}
