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
    /// Builds the woodland/archive architecture one reviewable asset at a time.
    /// The forms are dimensional, restrained, and derived from real masonry,
    /// timber-roof, and garden-pavilion construction rather than icon silhouettes.
    /// </summary>
    public static partial class HighFidelityWorldAssetBuilder
    {
        public const string ArchiveHallPrefabPath = "Assets/Prefabs/World/Buildings/PF_YW_Landmark_ArchiveHall_HighFidelity.prefab";
        public const string ArchiveHallReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_ArchiveHall_HighFidelity.unity";
        public const string ArchiveHallCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/ArchiveHall-Closeup.png";
        public const string StoryPavilionPrefabPath = "Assets/Prefabs/World/Buildings/PF_YW_Landmark_StoryPavilion_HighFidelity.prefab";
        public const string StoryPavilionReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_StoryPavilion_HighFidelity.unity";
        public const string StoryPavilionCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/StoryPavilion-Closeup.png";
        public const string WoodlandAtmospherePrefabPath = "Assets/Prefabs/World/Atmosphere/PF_YW_Atmosphere_WoodlandArchive.prefab";
        public const string WoodlandAtmosphereReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_WoodlandAtmosphere_HighFidelity.unity";
        public const string WoodlandAtmosphereCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/WoodlandAtmosphere-Closeup.png";

        [MenuItem("Yuvi/World Art/High Fidelity/02 Build Archive Hall")]
        public static void BuildArchiveHall()
        {
            PrepareWoodlandMaterials();
            BuildLandmarkAsset(
                ArchiveHallPrefabPath,
                "PF_YW_Landmark_ArchiveHall_HighFidelity",
                BuildArchiveHallStructure,
                new Vector3(5.8f, 7.3f, 4.8f),
                new Vector3(0f, 3.1f, .15f),
                new Vector3(6.8f, 7.5f, 5.8f),
                new Vector3(0f, 0f, -4.5f),
                new Vector3(0f, 3.8f, 0f));
            BuildArchitectureReviewScene(ArchiveHallReviewScenePath, ArchiveHallPrefabPath, "ArchiveHall_HighFidelityReview", new Vector3(12.8f, 8.5f, -18.2f), new Vector3(0f, 3.05f, 0f));
            var issues = ValidateArchiveHall();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            AssetDatabase.SaveAssets();
            Debug.Log("✅ Archive Hall built as a dimensional masonry-and-timber landmark.");
        }

        [MenuItem("Yuvi/World Art/High Fidelity/03 Build Story Pavilion")]
        public static void BuildStoryPavilion()
        {
            PrepareWoodlandMaterials();
            BuildLandmarkAsset(
                StoryPavilionPrefabPath,
                "PF_YW_Landmark_StoryPavilion_HighFidelity",
                BuildStoryPavilionStructure,
                new Vector3(4.4f, 4.8f, 4.4f),
                new Vector3(0f, 2.15f, 0f),
                new Vector3(5.3f, 5.2f, 5.3f),
                new Vector3(0f, 0f, -3.5f),
                new Vector3(0f, 2.8f, 0f));
            BuildArchitectureReviewScene(StoryPavilionReviewScenePath, StoryPavilionPrefabPath, "StoryPavilion_HighFidelityReview", new Vector3(9.7f, 6.2f, -13.4f), new Vector3(0f, 2.15f, 0f));
            var issues = ValidateStoryPavilion();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            AssetDatabase.SaveAssets();
            Debug.Log("✅ Story Pavilion built with an open octagonal silhouette distinct from the archive hall.");
        }

        [MenuItem("Yuvi/World Art/High Fidelity/04 Build Woodland Atmosphere")]
        public static void BuildWoodlandAtmosphere()
        {
            PrepareWoodlandMaterials();
            EnsureFolder("Assets/Prefabs/World/Atmosphere");
            var root = new GameObject("PF_YW_Atmosphere_WoodlandArchive");
            try
            {
                BuildWoodlandAtmosphereStructure(root.transform);
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, WoodlandAtmospherePrefabPath);
                if (prefab == null) throw new InvalidOperationException($"Could not save {WoodlandAtmospherePrefabPath}.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            BuildAtmosphereReviewScene();
            var issues = ValidateWoodlandAtmosphere();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            AssetDatabase.SaveAssets();
            Debug.Log("✅ Woodland atmosphere built with distant ridges, mist, clouds, lanterns, and wind-ready leaf drift.");
        }

        [MenuItem("Yuvi/World Art/High Fidelity/Capture Woodland Architecture Reviews")]
        public static void CaptureWoodlandArchitectureReviews()
        {
            CaptureArchiveHallReview();
            CaptureStoryPavilionReview();
            CaptureWoodlandAtmosphereReview();
            AssetDatabase.Refresh();
            Debug.Log("✅ Woodland architecture and atmosphere review captures saved.");
        }

        public static void CaptureArchiveHallReview()
        {
            CaptureArchitectureReview(ArchiveHallReviewScenePath, ArchiveHallCapturePath);
        }

        public static void CaptureStoryPavilionReview()
        {
            CaptureArchitectureReview(StoryPavilionReviewScenePath, StoryPavilionCapturePath);
        }

        public static void CaptureWoodlandAtmosphereReview()
        {
            CaptureArchitectureReview(WoodlandAtmosphereReviewScenePath, WoodlandAtmosphereCapturePath);
        }

        public static List<string> ValidateArchiveHall()
        {
            return ValidateLandmarkAsset(ArchiveHallPrefabPath, "Archive Hall", 42, 2, new Vector3(8.5f, 6.8f, 4f));
        }

        public static List<string> ValidateStoryPavilion()
        {
            return ValidateLandmarkAsset(StoryPavilionPrefabPath, "Story Pavilion", 28, 3, new Vector3(6f, 4.3f, 5.5f));
        }

        public static List<string> ValidateWoodlandAtmosphere()
        {
            var issues = new List<string>();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(WoodlandAtmospherePrefabPath);
            if (prefab == null)
            {
                issues.Add($"Missing atmosphere prefab: {WoodlandAtmospherePrefabPath}.");
                return issues;
            }
            if (prefab.GetComponentsInChildren<Renderer>(true).Length < 24)
                issues.Add("Woodland atmosphere requires at least 24 layered visual elements.");
            if (prefab.GetComponentsInChildren<WorldWindElement>(true).Length < 4)
                issues.Add("Woodland atmosphere requires at least four centrally controlled wind elements.");
            if (prefab.GetComponentsInChildren<Collider>(true).Length > 0)
                issues.Add("Atmosphere is visual-only and must never own traversal or collision.");
            return issues;
        }

        private static void PrepareWoodlandMaterials()
        {
            EnsureFolder(MaterialFolder);
            EnsureFolder(MeshFolder);
            EnsureFolder(TextureFolder);
            var textures = BuildTextures();
            materials = BuildMaterials(textures);
            materials["limestone"] = LitMaterial("ArchiveLimestone", Hex("A69B87"), 0f, .16f, textures["stone"]);
            materials["limestoneDark"] = LitMaterial("ArchiveLimestoneDark", Hex("696255"), 0f, .11f, textures["stone"]);
            materials["plaster"] = LitMaterial("ArchivePlaster", Hex("C6BDA7"), 0f, .12f, null);
            materials["roof"] = LitMaterial("WeatheredSlate", Hex("3D4B4B"), .02f, .2f, textures["stone"]);
            materials["copper"] = LitMaterial("AgedCopper", Hex("527A70"), .42f, .28f, null);
            materials["autumn"] = LitMaterial("AutumnLeaf", Hex("9A6339"), 0f, .17f, textures["leaf"]);
            materials["mist"] = LitMaterial("WoodlandMist", Hex("B8C8C1"), 0f, .05f, null);
            materials["cloud"] = LitMaterial("CloudBank", Hex("D9DEDA"), 0f, .04f, null);
        }

        private static void BuildLandmarkAsset(
            string prefabPath,
            string rootName,
            Action<Transform> buildStructure,
            Vector3 obstacleSize,
            Vector3 obstacleCenter,
            Vector3 interactionSize,
            Vector3 approach,
            Vector3 focus)
        {
            var template = AssetDatabase.LoadAssetAtPath<GameObject>(WorldAssetFoundationBuilder.LandmarkPrefabPath);
            if (template == null)
            {
                WorldAssetFoundationBuilder.CreateFoundation();
                template = AssetDatabase.LoadAssetAtPath<GameObject>(WorldAssetFoundationBuilder.LandmarkPrefabPath);
            }
            if (template == null) throw new InvalidOperationException("Landmark foundation template is missing.");

            var root = PrefabUtility.LoadPrefabContents(WorldAssetFoundationBuilder.LandmarkPrefabPath);
            try
            {
                root.name = rootName;
                var landmark = root.GetComponent<LandmarkVisual>()
                    ?? throw new InvalidOperationException("LandmarkVisual contract is missing.");
                Clear(landmark.VisualRoot);
                Clear(landmark.ShadowRoot);
                buildStructure(landmark.VisualRoot);
                AddMesh(landmark.ShadowRoot, "SoftContactShadow", MeshAsset(rootName + "-Shadow", () => CreateDiscMesh(obstacleSize.x * .62f, 40, .08f)),
                    materials["groundDark"], new Vector3(0f, .018f, .15f), Quaternion.Euler(-90f, 0f, 0f), new Vector3(1f, .58f, 1f));

                var obstacle = root.transform.Find("ObstacleFootprint") ?? Child(root.transform, "ObstacleFootprint");
                foreach (var existingCollider in obstacle.GetComponents<Collider>())
                    UnityEngine.Object.DestroyImmediate(existingCollider);
                var obstacleCollider = obstacle.gameObject.AddComponent<BoxCollider>();
                obstacleCollider.isTrigger = false;
                obstacleCollider.center = obstacleCenter;
                obstacleCollider.size = obstacleSize;
                if (landmark.InteractionCollider is BoxCollider interaction)
                {
                    interaction.isTrigger = true;
                    interaction.center = obstacleCenter;
                    interaction.size = interactionSize;
                }
                landmark.InteractionAnchor.localPosition = focus + new Vector3(0f, .3f, -1f);
                landmark.ApproachAnchor.localPosition = approach;
                landmark.FocusAnchor.localPosition = focus;

                var prefab = PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
                if (prefab == null) throw new InvalidOperationException($"Could not save {prefabPath}.");
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static void BuildArchiveHallStructure(Transform visualRoot)
        {
            var masonry = Child(visualRoot, "MasonryStructure");
            var timber = Child(visualRoot, "TimberAndRoof");
            var openings = Child(visualRoot, "WindowsAndEntrance");
            var details = Child(visualRoot, "ArchitecturalDetails");

            AddMesh(masonry, "RaisedFoundation", MeshAsset("ArchiveFoundation", () => CreateBoxMesh(new Vector3(4.8f, .34f, 2.65f))),
                materials["limestoneDark"], new Vector3(0f, .34f, 0f), Quaternion.identity, Vector3.one);
            AddMesh(masonry, "CentralHall", MeshAsset("ArchiveCentralHall", () => CreateBoxMesh(new Vector3(2.2f, 2.55f, 1.85f))),
                materials["plaster"], new Vector3(0f, 3.15f, .15f), Quaternion.identity, Vector3.one);
            AddMesh(masonry, "WestReadingWing", MeshAsset("ArchiveReadingWing", () => CreateBoxMesh(new Vector3(1.45f, 1.72f, 1.7f))),
                materials["limestone"], new Vector3(-3.45f, 2.3f, .28f), Quaternion.identity, Vector3.one);
            AddMesh(masonry, "EastReadingWing", MeshAsset("ArchiveReadingWing", () => CreateBoxMesh(new Vector3(1.45f, 1.72f, 1.7f))),
                materials["limestone"], new Vector3(3.45f, 2.3f, .28f), Quaternion.identity, Vector3.one);
            AddMesh(masonry, "CentralGable", MeshAsset("ArchiveCentralGable", () => CreateExtrudedPolygonMesh(new[]
            {
                new Vector2(-2.22f, 0f), new Vector2(2.22f, 0f), new Vector2(2.22f, .1f),
                new Vector2(0f, 1.72f), new Vector2(-2.22f, .1f)
            }, 3.75f)), materials["plaster"], new Vector3(0f, 5.7f, .15f), Quaternion.identity, Vector3.one);

            var wingRoof = MeshAsset("ArchiveWingRoofPlane", () => CreateBoxMesh(new Vector3(.92f, .12f, 2.12f)));
            AddMesh(timber, "WestRoofOuter", wingRoof, materials["roof"],
                new Vector3(-4.12f, 4.34f, .25f), Quaternion.Euler(0f, 0f, 27f), Vector3.one);
            AddMesh(timber, "WestRoofInner", wingRoof, materials["roof"],
                new Vector3(-2.58f, 4.34f, .25f), Quaternion.Euler(0f, 0f, -27f), Vector3.one);
            AddMesh(timber, "EastRoofInner", wingRoof, materials["roof"],
                new Vector3(2.58f, 4.34f, .25f), Quaternion.Euler(0f, 0f, 27f), Vector3.one);
            AddMesh(timber, "EastRoofOuter", wingRoof, materials["roof"],
                new Vector3(4.12f, 4.34f, .25f), Quaternion.Euler(0f, 0f, -27f), Vector3.one);
            var centralRoof = MeshAsset("ArchiveCentralRoofPlane", () => CreateBoxMesh(new Vector3(1.48f, .14f, 2.35f)));
            AddMesh(timber, "CentralRoofLeft", centralRoof, materials["roof"],
                new Vector3(-1.22f, 6.46f, .15f), Quaternion.Euler(0f, 0f, 34f), Vector3.one);
            AddMesh(timber, "CentralRoofRight", centralRoof, materials["roof"],
                new Vector3(1.22f, 6.46f, .15f), Quaternion.Euler(0f, 0f, -34f), Vector3.one);
            AddPath(timber, "CopperRidge", new[] { new Vector3(0f, 7.52f, -2.2f), new Vector3(0f, 7.52f, 2.5f) }, new[] { .075f, .075f }, 10, 712, materials["copper"]);

            BuildArchiveEntrance(openings);
            for (var side = -1; side <= 1; side += 2)
            for (var level = 0; level < 2; level++)
            {
                var x = side * (1.15f + level * .08f);
                var y = 2.25f + level * 1.8f;
                BuildArchiveWindow(openings, $"CentralWindow-{side}-{level}", new Vector3(x, y, -1.74f), .48f, .82f);
            }
            for (var side = -1; side <= 1; side += 2)
            for (var bay = 0; bay < 2; bay++)
                BuildArchiveWindow(openings, $"WingWindow-{side}-{bay}", new Vector3(side * (2.92f + bay * .88f), 2.42f, -1.44f), .36f, .68f);

            for (var side = -1; side <= 1; side += 2)
            for (var index = 0; index < 3; index++)
            {
                AddMesh(details, $"Buttress-{side}-{index}", MeshAsset("ArchiveButtress", () => CreateBoxMesh(new Vector3(.22f, 1.62f, .36f))),
                    materials["limestoneDark"], new Vector3(side * (2.05f + index * 1.18f), 2.05f, -1.72f), Quaternion.Euler(0f, 0f, side * 2f), Vector3.one);
            }
            BuildArchiveLantern(details, "LanternWest", new Vector3(-1.5f, 2.35f, -2.08f), 0f);
            BuildArchiveLantern(details, "LanternEast", new Vector3(1.5f, 2.35f, -2.08f), 1.2f);
            AddMesh(details, "StoneStepLower", MeshAsset("ArchiveStepLower", () => CreateBoxMesh(new Vector3(1.35f, .16f, .52f))),
                materials["limestoneDark"], new Vector3(0f, .18f, -2.38f), Quaternion.identity, Vector3.one);
            AddMesh(details, "StoneStepUpper", MeshAsset("ArchiveStepUpper", () => CreateBoxMesh(new Vector3(1.12f, .16f, .42f))),
                materials["limestone"], new Vector3(0f, .48f, -2.08f), Quaternion.identity, Vector3.one);
        }

        private static void BuildArchiveEntrance(Transform parent)
        {
            AddMesh(parent, "EntranceRecess", MeshAsset("ArchiveEntranceRecess", () => CreateArchPrismMesh(1.03f, 2.55f, .28f, 16)),
                materials["limestoneDark"], new Vector3(0f, .7f, -1.87f), Quaternion.identity, Vector3.one);
            AddMesh(parent, "OakDoor", MeshAsset("ArchiveOakDoor", () => CreateArchPrismMesh(.82f, 2.28f, .18f, 16)),
                materials["door"], new Vector3(0f, .75f, -2.06f), Quaternion.identity, Vector3.one);
            for (var index = 0; index < 5; index++)
                AddMesh(parent, $"DoorBoard-{index}", MeshAsset("ArchiveDoorBoard", () => CreateBoxMesh(new Vector3(.016f, .83f, .018f))),
                    materials["barkDark"], new Vector3(-.54f + index * .27f, 1.45f, -2.18f), Quaternion.identity, Vector3.one);
            AddMesh(parent, "DoorRing", MeshAsset("ArchiveDoorRing", () => CreateTorusMesh(.12f, .028f, 16, 7)),
                materials["iron"], new Vector3(.43f, 1.55f, -2.23f), Quaternion.Euler(90f, 0f, 0f), Vector3.one);
        }

        private static void BuildArchiveWindow(Transform parent, string name, Vector3 position, float halfWidth, float halfHeight)
        {
            AddMesh(parent, name + "Recess", MeshAsset("ArchiveWindowRecess", () => CreateBoxMesh(new Vector3(halfWidth + .12f, halfHeight + .12f, .12f))),
                materials["limestoneDark"], position, Quaternion.identity, Vector3.one);
            AddMesh(parent, name + "Glass", MeshAsset("ArchiveWindowGlass", () => CreateBoxMesh(new Vector3(halfWidth, halfHeight, .055f))),
                materials["glass"], position + new Vector3(0f, 0f, -.14f), Quaternion.identity, Vector3.one);
            AddMesh(parent, name + "MullionV", MeshAsset("ArchiveWindowMullionV", () => CreateBoxMesh(new Vector3(.035f, halfHeight, .035f))),
                materials["iron"], position + new Vector3(0f, 0f, -.22f), Quaternion.identity, Vector3.one);
            AddMesh(parent, name + "MullionH", MeshAsset("ArchiveWindowMullionH", () => CreateBoxMesh(new Vector3(halfWidth, .035f, .035f))),
                materials["iron"], position + new Vector3(0f, 0f, -.22f), Quaternion.identity, Vector3.one);
        }

        private static void BuildArchiveLantern(Transform parent, string name, Vector3 position, float phase)
        {
            var pivot = Child(parent, name);
            pivot.localPosition = position;
            AddPath(pivot, "Bracket", new[] { Vector3.zero, new Vector3(0f, .28f, -.35f), new Vector3(0f, -.15f, -.42f) },
                new[] { .035f, .035f, .026f }, 8, 760 + Mathf.RoundToInt(phase * 10f), materials["iron"]);
            AddMesh(pivot, "Lamp", MeshAsset("ArchiveLamp", () => CreateOrganicBlobMesh(new Vector3(.17f, .25f, .15f), 766, 7, 9)),
                materials["warmLight"], new Vector3(0f, -.34f, -.42f), Quaternion.identity, Vector3.one);
            pivot.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(pivot, Vector3.forward, .65f, .16f, phase, true);
        }

        private static void BuildStoryPavilionStructure(Transform visualRoot)
        {
            var stone = Child(visualRoot, "StoneTerrace");
            var frame = Child(visualRoot, "TimberFrame");
            var roof = Child(visualRoot, "CopperRoof");
            var details = Child(visualRoot, "StoryDetails");

            AddMesh(stone, "OctagonalBase", MeshAsset("PavilionBase", () => CreateCylinderMesh(3.05f, .38f, 8)),
                materials["limestoneDark"], new Vector3(0f, .2f, 0f), Quaternion.identity, Vector3.one);
            AddMesh(stone, "Floor", MeshAsset("PavilionFloor", () => CreateCylinderMesh(2.75f, .14f, 8)),
                materials["limestone"], new Vector3(0f, .46f, 0f), Quaternion.identity, Vector3.one);
            for (var index = 0; index < 8; index++)
            {
                var angle = index / 8f * Mathf.PI * 2f;
                var position = new Vector3(Mathf.Cos(angle) * 2.35f, 2.18f, Mathf.Sin(angle) * 2.35f);
                AddMesh(frame, $"Column-{index + 1:00}", MeshAsset("PavilionColumn", () => CreateCylinderMesh(.16f, 3.45f, 10)),
                    materials["door"], position, Quaternion.identity, Vector3.one);
                AddMesh(frame, $"StoneFoot-{index + 1:00}", MeshAsset("PavilionStoneFoot", () => CreateCylinderMesh(.27f, .36f, 8)),
                    materials["limestoneDark"], new Vector3(position.x, .68f, position.z), Quaternion.identity, Vector3.one);
            }
            AddMesh(roof, "MainCanopy", MeshAsset("PavilionCanopy", () => CreatePathMesh(
                new[] { new Vector3(0f, 3.82f, 0f), new Vector3(0f, 4.85f, 0f) },
                new[] { 3.15f, .34f }, 8, 820)), materials["roof"], Vector3.zero, Quaternion.identity, Vector3.one);
            AddMesh(roof, "CopperCap", MeshAsset("PavilionCopperCap", () => CreateOrganicBlobMesh(new Vector3(.33f, .42f, .33f), 821, 7, 10)),
                materials["copper"], new Vector3(0f, 4.92f, 0f), Quaternion.identity, Vector3.one);
            AddPath(roof, "Finial", new[] { new Vector3(0f, 5.08f, 0f), new Vector3(0f, 5.72f, 0f) },
                new[] { .075f, .025f }, 9, 822, materials["copper"]);

            for (var index = 0; index < 4; index++)
            {
                var angle = (45f + index * 90f) * Mathf.Deg2Rad;
                var pivot = Child(details, $"HangingStoryLantern-{index + 1:00}");
                pivot.localPosition = new Vector3(Mathf.Cos(angle) * 1.7f, 3.62f, Mathf.Sin(angle) * 1.7f);
                AddPath(pivot, "Cord", new[] { Vector3.zero, new Vector3(0f, -.52f, 0f) }, new[] { .018f, .014f }, 6, 840 + index, materials["iron"]);
                AddMesh(pivot, "Lamp", MeshAsset("PavilionLamp", () => CreateOrganicBlobMesh(new Vector3(.14f, .21f, .14f), 850 + index, 6, 8)),
                    materials["warmLight"], new Vector3(0f, -.67f, 0f), Quaternion.identity, Vector3.one);
                pivot.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(pivot, Vector3.forward, .7f + index * .06f, .14f, index * .7f, true);
            }
            for (var index = 0; index < 5; index++)
            {
                var angle = Mathf.Lerp(-65f, 65f, index / 4f) * Mathf.Deg2Rad;
                AddMesh(details, $"ReadingBench-{index + 1:00}", MeshAsset("PavilionBench", () => CreateBoxMesh(new Vector3(.56f, .11f, .22f))),
                    materials["door"], new Vector3(Mathf.Sin(angle) * 1.55f, .85f, Mathf.Cos(angle) * 1.55f), Quaternion.Euler(0f, angle * Mathf.Rad2Deg, 0f), Vector3.one);
            }
        }

        private static void BuildWoodlandAtmosphereStructure(Transform root)
        {
            var distant = Child(root, "DistantRidges");
            var mist = Child(root, "MistBanks");
            var clouds = Child(root, "CloudBanks");
            var lanterns = Child(root, "PathLanterns");
            var leaves = Child(root, "DriftingLeaves");

            for (var index = 0; index < 7; index++)
            {
                var width = 2.6f + index % 3 * .65f;
                var height = 2.1f + index % 2 * .8f;
                var mountain = CreateExtrudedPolygonMesh(new[]
                {
                    new Vector2(-width, 0f), new Vector2(-width * .55f, height * .45f),
                    new Vector2(-width * .15f, height), new Vector2(width * .18f, height * .58f),
                    new Vector2(width * .62f, height * .82f), new Vector2(width, 0f)
                }, .8f);
                AddMesh(distant, $"Ridge-{index + 1:00}", MeshAsset($"WoodlandRidge-{index:00}", () => mountain),
                    index % 2 == 0 ? materials["groundDark"] : materials["limestoneDark"],
                    new Vector3(-9f + index * 3.2f, -.2f, 7.2f + index % 2 * 1.2f), Quaternion.identity, Vector3.one);
            }
            for (var index = 0; index < 6; index++)
                AddMesh(mist, $"MistRibbon-{index + 1:00}", MeshAsset($"WoodlandMist-{index:00}", () => CreateDiscMesh(2.2f + index % 2 * .55f, 32, .12f)),
                    materials["mist"], new Vector3(-7f + index * 2.8f, .65f + index % 3 * .16f, 4.8f + index % 2 * 1.5f),
                    Quaternion.Euler(78f, 0f, index % 2 == 0 ? -6f : 8f), new Vector3(1.55f, .36f, 1f));
            for (var index = 0; index < 5; index++)
            {
                var pivot = Child(clouds, $"CloudDrift-{index + 1:00}");
                pivot.localPosition = new Vector3(-8f + index * 4f, 8.4f + index % 2 * 1.1f, 6.8f + index % 3);
                for (var lobe = 0; lobe < 4; lobe++)
                    AddMesh(pivot, $"CloudLobe-{lobe + 1:00}", MeshAsset($"WoodlandCloud-{index:00}-{lobe:00}", () => CreateOrganicBlobMesh(
                        new Vector3(1.2f + lobe % 2 * .45f, .55f + lobe % 3 * .15f, .65f), 920 + index * 7 + lobe, 6, 9)),
                        materials["cloud"], new Vector3((lobe - 1.5f) * .78f, Mathf.Sin(lobe * 1.7f) * .18f, lobe % 2 * .24f), Quaternion.identity, Vector3.one);
                pivot.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(pivot, Vector3.up, .18f, .12f, index * .8f, true);
            }
            for (var index = 0; index < 6; index++)
            {
                var x = -7.5f + index * 3f;
                AddPath(lanterns, $"LanternPost-{index + 1:00}", new[] { new Vector3(x, 0f, -3.4f + index * .65f), new Vector3(x, 1.65f, -3.4f + index * .65f) },
                    new[] { .07f, .045f }, 9, 950 + index, materials["iron"]);
                AddMesh(lanterns, $"LanternGlow-{index + 1:00}", MeshAsset($"WoodlandLantern-{index:00}", () => CreateOrganicBlobMesh(new Vector3(.18f, .28f, .18f), 960 + index, 6, 8)),
                    materials["warmLight"], new Vector3(x, 1.48f, -3.4f + index * .65f), Quaternion.identity, Vector3.one);
            }
            for (var group = 0; group < 4; group++)
            {
                var pivot = Child(leaves, $"LeafDrift-{group + 1:00}");
                pivot.localPosition = new Vector3(-5f + group * 3.4f, 2.3f + group % 2, 1.8f + group % 3);
                for (var leaf = 0; leaf < 5; leaf++)
                    AddMesh(pivot, $"Leaf-{leaf + 1:00}", MeshAsset($"DriftLeaf-{group:00}-{leaf:00}", () => CreateLeafClusterMesh(new Vector3(.32f, .14f, .2f), 980 + group * 9 + leaf, 4, .1f, .65f, .7f)),
                        leaf % 2 == 0 ? materials["autumn"] : materials["leafSun"], new Vector3((leaf - 2) * .32f, Mathf.Sin(leaf * 2f) * .25f, leaf % 2 * .3f), Quaternion.Euler(0f, leaf * 31f, leaf * 17f), Vector3.one);
                pivot.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(pivot, Vector3.up, .82f + group * .1f, .35f, group * .9f, true);
            }
        }

        private static List<string> ValidateLandmarkAsset(string path, string label, int minimumRenderers, int minimumWind, Vector3 minimumBounds)
        {
            var issues = new List<string>();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null)
            {
                issues.Add($"Missing {label} prefab: {path}.");
                return issues;
            }
            var landmark = prefab.GetComponent<LandmarkVisual>();
            if (landmark == null) issues.Add($"{label} requires LandmarkVisual.");
            else landmark.CollectValidationIssues(issues);
            var renderers = prefab.GetComponentsInChildren<MeshRenderer>(true);
            if (renderers.Length < minimumRenderers) issues.Add($"{label} requires at least {minimumRenderers} mesh renderers; found {renderers.Length}.");
            if (prefab.GetComponentsInChildren<SpriteRenderer>(true).Length > 0) issues.Add($"{label} must not depend on flat sprite artwork.");
            if (prefab.GetComponentsInChildren<WorldWindElement>(true).Length < minimumWind) issues.Add($"{label} lacks animation-ready atmosphere details.");
            var bounds = CalculateBounds(prefab);
            if (bounds.size.x < minimumBounds.x || bounds.size.y < minimumBounds.y || bounds.size.z < minimumBounds.z)
                issues.Add($"{label} lacks dimensional scale. Bounds: {bounds.size}.");
            return issues;
        }

        private static void BuildArchitectureReviewScene(string scenePath, string prefabPath, string instanceName, Vector3 cameraPosition, Vector3 target)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            ConfigureWoodlandReviewEnvironment();
            var camera = CreateWoodlandReviewCamera(cameraPosition, target);
            _ = camera;
            CreateWoodlandReviewLights();
            var environment = new GameObject("ReviewEnvironment").transform;
            AddMesh(environment, "Ground", MeshAsset("WoodlandReviewGround", () => CreateGroundGridMesh(24f, 24, .06f, 1110)),
                materials["ground"], new Vector3(0f, -.08f, 0f), Quaternion.identity, Vector3.one);
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath)
                ?? throw new InvalidOperationException($"Missing prefab: {prefabPath}.");
            var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject
                ?? throw new InvalidOperationException($"Could not instantiate {prefabPath}.");
            instance.name = instanceName;
            var landmark = instance.GetComponent<LandmarkVisual>();
            if (landmark != null) landmark.StateRoot.gameObject.SetActive(false);
            new GameObject("WorldSystems").AddComponent<WorldMotionController>().Configure(instance.transform, false, false);
            EditorSceneManager.SaveScene(scene, scenePath);
        }

        private static void BuildAtmosphereReviewScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            ConfigureWoodlandReviewEnvironment();
            CreateWoodlandReviewCamera(new Vector3(14f, 9.5f, -18f), new Vector3(0f, 2.5f, 2f));
            CreateWoodlandReviewLights();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(WoodlandAtmospherePrefabPath)
                ?? throw new InvalidOperationException($"Missing prefab: {WoodlandAtmospherePrefabPath}.");
            var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject
                ?? throw new InvalidOperationException("Could not instantiate woodland atmosphere.");
            instance.name = "WoodlandAtmosphere_HighFidelityReview";
            new GameObject("WorldSystems").AddComponent<WorldMotionController>().Configure(instance.transform, false, false);
            EditorSceneManager.SaveScene(scene, WoodlandAtmosphereReviewScenePath);
        }

        private static void ConfigureWoodlandReviewEnvironment()
        {
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Hex("C5D0CC");
            RenderSettings.ambientEquatorColor = Hex("84948B");
            RenderSettings.ambientGroundColor = Hex("3D4A3D");
            RenderSettings.ambientIntensity = 1.02f;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = Hex("B7C4BE");
            RenderSettings.fogStartDistance = 35f;
            RenderSettings.fogEndDistance = 82f;
        }

        private static Camera CreateWoodlandReviewCamera(Vector3 position, Vector3 target)
        {
            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Hex("B7C4BE");
            camera.fieldOfView = 38f;
            camera.nearClipPlane = .1f;
            camera.farClipPlane = 160f;
            camera.allowHDR = true;
            cameraObject.AddComponent<AudioListener>();
            cameraObject.transform.position = position;
            cameraObject.transform.LookAt(target);
            return camera;
        }

        private static void CreateWoodlandReviewLights()
        {
            var keyObject = new GameObject("Directional Key Light");
            var key = keyObject.AddComponent<Light>();
            key.type = LightType.Directional;
            key.color = Hex("FFE5BF");
            key.intensity = 1.24f;
            key.shadows = LightShadows.Soft;
            key.shadowStrength = .7f;
            keyObject.transform.rotation = Quaternion.Euler(46f, -42f, 0f);
            var fillObject = new GameObject("Cool Fill Light");
            var fill = fillObject.AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.color = Hex("A9CFCE");
            fill.intensity = .42f;
            fill.shadows = LightShadows.None;
            fillObject.transform.rotation = Quaternion.Euler(28f, 136f, 0f);
        }

        private static void CaptureArchitectureReview(string scenePath, string capturePath)
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(scenePath) == null)
                throw new FileNotFoundException("Review scene is missing.", scenePath);
            EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            var camera = Camera.main ?? throw new InvalidOperationException("Review scene requires a Main Camera.");
            CaptureReviewFrame(camera, capturePath, 1600, 1100);
        }
    }
}
