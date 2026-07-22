using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Yuvi720.LearningWorld.Editor
{
    /// <summary>
    /// Deterministically builds the complete animation-ready world kit from native
    /// Unity meshes. Source vectors may inform concepts, but no runtime asset in
    /// this production pass depends on SVG or SpriteRenderer.
    /// </summary>
    public static class BulkWorldAssetBuilder
    {
        public const string TerrainPrefabPath = "Assets/Prefabs/World/Terrain/PF_YW_Terrain_Production.prefab";
        public const string YuviPrefabPath = "Assets/Prefabs/World/Characters/PF_YW_Yuvi_Mesh.prefab";
        public const string ReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_BulkWorldReview.unity";

        private const string MaterialFolder = "Assets/Art/World/Materials";
        private const string MeshFolder = "Assets/Art/World/Meshes";
        private const string LandmarkFolder = "Assets/Prefabs/World/Buildings";
        private const string BridgeFolder = "Assets/Prefabs/World/Bridges";
        private const string DecorationFolder = "Assets/Prefabs/World/Vegetation";
        private const string PropFolder = "Assets/Prefabs/World/Props";

        private static readonly string[] LandmarkIds =
        {
            "landmark.welcome-harbor",
            "landmark.maker-meadow",
            "landmark.story-grove",
            "landmark.archive-hill",
            "landmark.observation-ridge",
            "landmark.reflection-gardens",
            "landmark.mentor-lodge",
            "landmark.challenge-crossing"
        };

        private static readonly string[] LandmarkNames =
        {
            "WelcomeHarbor", "MakerMeadow", "StoryGrove", "ArchiveHill",
            "ObservationRidge", "ReflectionGardens", "MentorLodge", "ChallengeCrossing"
        };

        private static readonly string[] BridgeIds =
        {
            "bridge.rope", "bridge.timber", "bridge.stone", "bridge.garden",
            "bridge.drawbridge", "bridge.stepping-stones", "bridge.boardwalk"
        };

        private static readonly string[] BridgeNames =
        {
            "Rope", "Timber", "Stone", "Garden", "Drawbridge", "SteppingStones", "Boardwalk"
        };

        private static readonly string[] DecorationIds =
        {
            "vegetation.tree.round", "vegetation.tree.coastal", "vegetation.tree.story",
            "vegetation.tree.willow", "vegetation.tree.pine", "vegetation.tree.orchard",
            "vegetation.bush.flowers", "vegetation.grass.reeds", "geology.rock-cluster",
            "prop.bench", "prop.lantern", "prop.crates"
        };

        private static readonly string[] DecorationNames =
        {
            "TreeRound", "TreeCoastal", "TreeStory", "TreeWillow", "TreePine", "TreeOrchard",
            "BushFlowers", "GrassReeds", "RockCluster", "Bench", "Lantern", "Crates"
        };

        private static readonly Color Ink = Hex("2A2028");
        private static readonly Color Cream = Hex("F3E7C9");
        private static readonly Color WarmWhite = Hex("FFF6DE");
        private static readonly Color Grass = Hex("86B66B");
        private static readonly Color GrassDark = Hex("4F7654");
        private static readonly Color LeafLight = Hex("A9CB77");
        private static readonly Color Bark = Hex("8E5E43");
        private static readonly Color Soil = Hex("B9784F");
        private static readonly Color Water = Hex("54A9BA");
        private static readonly Color WaterLight = Hex("A6E0D5");
        private static readonly Color RoofRed = Hex("C75E58");
        private static readonly Color RoofBlue = Hex("5B7FA5");
        private static readonly Color Ochre = Hex("D8A34C");
        private static readonly Color Purple = Hex("76558D");
        private static readonly Color Stone = Hex("7B7B76");
        private static readonly Color Cloud = Hex("E7E1D4");
        private static readonly Color Glow = Hex("F5D76E");

        private static Dictionary<string, Material> materials;

        public static IReadOnlyList<string> ProductionAssetIds
        {
            get
            {
                var ids = new List<string>
                {
                    "terrain.template", CentralLearningTreeBuilder.AssetId, "character.Yuvi",
                    "atmosphere.cloud", "decoration.template", "bridge.template", "landmark.template"
                };
                ids.AddRange(LandmarkIds);
                ids.AddRange(BridgeIds);
                ids.AddRange(DecorationIds);
                return ids;
            }
        }

        [MenuItem("Yuvi/World Art/Build Entire Animation-Ready World")]
        public static void BuildEntireWorld()
        {
            try
            {
                EditorUtility.DisplayProgressBar("Yuvilab World", "Preparing production folders", .02f);
                WorldAssetFoundationBuilder.CreateFoundation();
                EnsureFolder(MeshFolder);
                EnsureFolder(MaterialFolder);
                EnsureFolder(DecorationFolder);
                EnsureFolder(PropFolder);
                materials = BuildMaterials();

                var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(WorldAssetFoundationBuilder.CatalogPath)
                    ?? throw new InvalidOperationException("Production WorldAssetCatalog is missing.");

                EditorUtility.DisplayProgressBar("Yuvilab World", "Building continuous terrain", .10f);
                var terrain = BuildTerrain();
                Register(catalog, "terrain.template", WorldAssetKind.Terrain, terrain);

                EditorUtility.DisplayProgressBar("Yuvilab World", "Building central learning tree", .20f);
                var centralTree = BuildLandmark(CentralLearningTreeBuilder.AssetId, "CentralLearningTree", -1);
                Register(catalog, CentralLearningTreeBuilder.AssetId, WorldAssetKind.Landmark, centralTree);

                for (var index = 0; index < LandmarkIds.Length; index++)
                {
                    EditorUtility.DisplayProgressBar("Yuvilab World", $"Building landmark {index + 1}/{LandmarkIds.Length}", .25f + index * .025f);
                    var landmark = BuildLandmark(LandmarkIds[index], LandmarkNames[index], index);
                    Register(catalog, LandmarkIds[index], WorldAssetKind.Landmark, landmark);
                    if (index == 0) Register(catalog, "landmark.template", WorldAssetKind.Landmark, landmark);
                }

                for (var index = 0; index < BridgeIds.Length; index++)
                {
                    EditorUtility.DisplayProgressBar("Yuvilab World", $"Building bridge {index + 1}/{BridgeIds.Length}", .48f + index * .02f);
                    var bridge = BuildBridge(BridgeNames[index], index);
                    Register(catalog, BridgeIds[index], WorldAssetKind.Bridge, bridge);
                    if (index == 0) Register(catalog, "bridge.template", WorldAssetKind.Bridge, bridge);
                }

                for (var index = 0; index < DecorationIds.Length; index++)
                {
                    EditorUtility.DisplayProgressBar("Yuvilab World", $"Building environment family {index + 1}/{DecorationIds.Length}", .64f + index * .012f);
                    var decoration = BuildDecoration(DecorationNames[index], index);
                    var kind = index < 8 ? WorldAssetKind.Vegetation : WorldAssetKind.Prop;
                    Register(catalog, DecorationIds[index], kind, decoration);
                    if (index == 0) Register(catalog, "decoration.template", WorldAssetKind.Prop, decoration);
                }

                var cloud = BuildCloud();
                Register(catalog, "atmosphere.cloud", WorldAssetKind.Effect, cloud);
                var Yuvi = BuildYuvi();
                Register(catalog, "character.Yuvi", WorldAssetKind.Character, Yuvi);

                EditorUtility.SetDirty(catalog);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();

                EditorUtility.DisplayProgressBar("Yuvilab World", "Building complete-world review scene", .92f);
                BuildReviewScene(terrain, centralTree, Yuvi, catalog);

                var issues = ValidateEntireWorld();
                if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
                Selection.activeObject = catalog;
                Debug.Log($"✅ Built and validated the complete animation-ready mesh world ({ProductionAssetIds.Count} catalog contracts).");
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        [MenuItem("Yuvi/World Art/Validate Entire Animation-Ready World")]
        public static void ValidateEntireWorldMenu()
        {
            var issues = ValidateEntireWorld();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            Debug.Log("✅ Entire animation-ready mesh world is valid.");
        }

        public static List<string> ValidateEntireWorld()
        {
            var issues = WorldAssetFoundationBuilder.ValidateFoundation();
            var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(WorldAssetFoundationBuilder.CatalogPath);
            if (catalog == null)
            {
                issues.Add("Production catalog is missing.");
                return issues;
            }

            foreach (var assetId in ProductionAssetIds)
            {
                if (!catalog.TryResolve(assetId, false, out var prefab) || prefab == null)
                {
                    issues.Add($"Catalog asset is unresolved: {assetId}.");
                    continue;
                }
                if (prefab.GetComponentsInChildren<SpriteRenderer>(true).Length > 0)
                    issues.Add($"{assetId}: production mesh prefab must not depend on SpriteRenderer.");
            }

            if (catalog.TryResolve(CentralLearningTreeBuilder.AssetId, false, out var tree))
            {
                if (tree.GetComponentsInChildren<MeshRenderer>(true).Length < 6)
                    issues.Add("Central learning tree requires a layered mesh silhouette.");
                if (tree.GetComponentsInChildren<WorldWindElement>(true).Length < 2)
                    issues.Add("Central learning tree requires at least two independent wind pivots.");
            }

            if (catalog.TryResolve("terrain.template", false, out var terrain))
            {
                var terrainVisual = terrain.GetComponent<TerrainVisual>();
                if (terrainVisual == null || terrainVisual.VisualRoot.GetComponentsInChildren<MeshRenderer>(true).Length < 8)
                    issues.Add("Production terrain requires the mainland, water, paths, and background mesh layers.");
                if (terrainVisual != null && terrainVisual.MovementZonesRoot.GetComponentsInChildren<Renderer>(true).Length > 0)
                    issues.Add("Movement zones must remain renderer-free.");
            }

            if (catalog.TryResolve("character.Yuvi", false, out var Yuvi)
                && Yuvi.GetComponentsInChildren<MeshRenderer>(true).Length < 5)
                issues.Add("Yuvi requires a readable segmented mesh silhouette.");

            return issues;
        }

        private static Dictionary<string, Material> BuildMaterials()
        {
            return new Dictionary<string, Material>(StringComparer.Ordinal)
            {
                ["ink"] = MaterialAsset("Ink", Ink),
                ["cream"] = MaterialAsset("Cream", Cream),
                ["white"] = MaterialAsset("WarmWhite", WarmWhite),
                ["grass"] = MaterialAsset("Grass", Grass),
                ["grassDark"] = MaterialAsset("GrassDark", GrassDark),
                ["leafLight"] = MaterialAsset("LeafLight", LeafLight),
                ["bark"] = MaterialAsset("Bark", Bark),
                ["soil"] = MaterialAsset("Soil", Soil),
                ["water"] = MaterialAsset("Water", Water),
                ["waterLight"] = MaterialAsset("WaterLight", WaterLight),
                ["red"] = MaterialAsset("RoofRed", RoofRed),
                ["blue"] = MaterialAsset("RoofBlue", RoofBlue),
                ["ochre"] = MaterialAsset("Ochre", Ochre),
                ["purple"] = MaterialAsset("Purple", Purple),
                ["stone"] = MaterialAsset("Stone", Stone),
                ["cloud"] = MaterialAsset("Cloud", Cloud),
                ["glow"] = MaterialAsset("Glow", Glow)
            };
        }

        private static Material MaterialAsset(string name, Color color)
        {
            var path = $"{MaterialFolder}/MAT_YW_{name}.mat";
            var shader = Shader.Find("Unlit/Color") ?? Shader.Find("Legacy Shaders/Diffuse")
                ?? throw new InvalidOperationException("A WebGL-safe color shader is required.");
            var generated = new Material(shader) { name = $"MAT_YW_{name}", color = color, enableInstancing = true };
            var existing = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }
            EditorUtility.CopySerialized(generated, existing);
            UnityEngine.Object.DestroyImmediate(generated);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        private static GameObject BuildTerrain()
        {
            var root = PrefabUtility.LoadPrefabContents(WorldAssetFoundationBuilder.TerrainPrefabPath);
            try
            {
                root.name = "PF_YW_Terrain_Production";
                var terrain = root.GetComponent<TerrainVisual>()
                    ?? throw new InvalidOperationException("Terrain template contract is missing.");
                Clear(terrain.VisualRoot);

                var mainlandPoints = new[]
                {
                    new Vector2(-12f, -9f), new Vector2(-8f, -12f), new Vector2(4f, -11f),
                    new Vector2(14f, -9f), new Vector2(25f, -10f), new Vector2(36f, -7f),
                    new Vector2(47f, -6f), new Vector2(58f, -2f), new Vector2(70f, 2f),
                    new Vector2(83f, 7f), new Vector2(90f, 13f), new Vector2(87f, 22f),
                    new Vector2(76f, 27f), new Vector2(63f, 26f), new Vector2(52f, 22f),
                    new Vector2(39f, 19f), new Vector2(27f, 17f), new Vector2(14f, 12f),
                    new Vector2(2f, 10f), new Vector2(-10f, 5f)
                };
                var terrainMesh = MeshAsset("Terrain_Mainland", () => CreateTerrainMesh(mainlandPoints, .8f));
                AddMesh(terrain.VisualRoot, "ContinuousMainland", terrainMesh,
                    new[] { materials["grass"], materials["soil"] }, Vector3.zero, Quaternion.identity, Vector3.one);

                AddWarpedBox(terrain.VisualRoot, "ArrivalBeach", new Vector3(-7f, .04f, -5.4f), new Vector3(11f, .08f, 3.8f), materials["ochre"]);
                AddWarpedBox(terrain.VisualRoot, "DecorativeRoadA", new Vector3(8f, .05f, -.5f), new Vector3(22f, .08f, 1.1f), materials["ochre"], 7f);
                AddWarpedBox(terrain.VisualRoot, "DecorativeRoadB", new Vector3(29f, .05f, 4.2f), new Vector3(24f, .08f, 1.05f), materials["ochre"], 15f);
                AddWarpedBox(terrain.VisualRoot, "DecorativeRoadC", new Vector3(54f, .05f, 11.5f), new Vector3(26f, .08f, 1.05f), materials["ochre"], 17f);
                AddWarpedBox(terrain.VisualRoot, "StreamA", new Vector3(21f, .065f, 1.7f), new Vector3(2.7f, .06f, 17f), materials["water"], -7f);
                AddWarpedBox(terrain.VisualRoot, "StreamHighlight", new Vector3(20.7f, .09f, 1.7f), new Vector3(.28f, .025f, 16.5f), materials["waterLight"], -7f);
                AddWarpedBox(terrain.VisualRoot, "ReflectionPond", new Vector3(55f, .07f, 13f), new Vector3(8f, .06f, 5f), materials["water"], 6f);

                for (var index = 0; index < 7; index++)
                {
                    var mountain = Child(terrain.VisualRoot, $"DistantMountain-{index}");
                    mountain.localPosition = new Vector3(index * 14f - 4f, 2.2f + index % 2, 24f + index * .35f);
                    AddInkPolygon(mountain, "Mountain", BlobPoints(8f + index % 3, 6f + index % 2, index + 41),
                        materials[index % 2 == 0 ? "purple" : "blue"], .18f, Vector3.zero, Vector3.one);
                }

                var prefab = SavePrefab(root, TerrainPrefabPath);
                return prefab;
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static GameObject BuildLandmark(string assetId, string familyName, int style)
        {
            var path = style < 0
                ? CentralLearningTreeBuilder.PrefabPath
                : $"{LandmarkFolder}/PF_YW_Landmark_{familyName}_Mesh.prefab";
            var root = PrefabUtility.LoadPrefabContents(WorldAssetFoundationBuilder.LandmarkPrefabPath);
            try
            {
                root.name = style < 0 ? "PF_YW_CentralLearningTree_Mesh" : $"PF_YW_Landmark_{familyName}_Mesh";
                var landmark = root.GetComponent<LandmarkVisual>()
                    ?? throw new InvalidOperationException("Landmark template contract is missing.");
                var rear = landmark.VisualRoot.Find("RearPaperLayer");
                var main = landmark.VisualRoot.Find("MainPaperLayer");
                var foreground = landmark.VisualRoot.Find("ForegroundPaperLayer");
                Clear(rear);
                Clear(main);
                Clear(foreground);
                Clear(landmark.ShadowRoot);
                RemovePaperLayer(rear);
                RemovePaperLayer(main);
                RemovePaperLayer(foreground);

                rear.localPosition = new Vector3(0f, 0f, .20f);
                main.localPosition = Vector3.zero;
                foreground.localPosition = new Vector3(0f, 0f, -.20f);

                AddWarpedBox(landmark.ShadowRoot, "ContactShadow", new Vector3(0f, .025f, 0f),
                    style < 0 ? new Vector3(6f, .035f, 2.7f) : new Vector3(4.8f, .035f, 2.1f), materials["ink"]);

                if (style < 0) BuildCentralTreeMeshes(rear, main, foreground);
                else BuildDistrictLandmarkMeshes(rear, main, foreground, style);

                BuildStateCues(landmark.StateRoot, familyName);
                ConfigureLandmarkColliders(root, landmark, style < 0);
                landmark.InteractionAnchor.localPosition = new Vector3(0f, style < 0 ? 4.2f : 3f, 0f);
                landmark.ApproachAnchor.localPosition = new Vector3(0f, 0f, -3f);
                landmark.FocusAnchor.localPosition = new Vector3(0f, style < 0 ? 4f : 2.8f, 0f);

                var prefab = SavePrefab(root, path);
                _ = assetId;
                return prefab;
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static void BuildCentralTreeMeshes(Transform rear, Transform main, Transform foreground)
        {
            AddInkPolygon(main, "Trunk", new[]
            {
                new Vector2(-1.35f, 0f), new Vector2(-.85f, 2.7f), new Vector2(-1.05f, 5.2f),
                new Vector2(-.35f, 6.1f), new Vector2(.18f, 5.4f), new Vector2(.9f, 6.25f),
                new Vector2(1.05f, 3.1f), new Vector2(1.45f, 0f), new Vector2(.45f, .48f),
                new Vector2(0f, .2f), new Vector2(-.5f, .55f)
            }, materials["bark"], .16f, Vector3.zero, Vector3.one);

            AddCanopy(rear, "RearCanopyLeft", new Vector3(-2.25f, 5.6f, 0f), new Vector2(4.3f, 3.5f), 31, materials["grassDark"], 3.2f, .72f, 1.2f);
            AddCanopy(rear, "RearCanopyRight", new Vector3(2.2f, 5.8f, 0f), new Vector2(4.1f, 3.4f), 33, materials["grassDark"], 3.6f, .78f, 2.4f);
            AddCanopy(main, "MainCanopy", new Vector3(0f, 6.8f, 0f), new Vector2(5.4f, 3.8f), 35, materials["grass"], 4f, .68f, .4f);
            AddCanopy(foreground, "ForegroundCanopyLeft", new Vector3(-2.7f, 4.2f, 0f), new Vector2(3.2f, 2.5f), 37, materials["leafLight"], 4.8f, .92f, 3.1f);
            AddCanopy(foreground, "ForegroundCanopyRight", new Vector3(2.8f, 4.25f, 0f), new Vector2(3.25f, 2.4f), 39, materials["leafLight"], 4.6f, .88f, 4.4f);

            AddInkPolygon(main, "LearningDoor", BlobPoints(1.25f, 1.8f, 81), materials["cream"], .10f,
                new Vector3(0f, 1.25f, -.03f), Vector3.one);
            AddInkPolygon(main, "OpenBookEmblem", new[]
            {
                new Vector2(-1f, .25f), new Vector2(-.75f, .9f), new Vector2(0f, .63f),
                new Vector2(.75f, .9f), new Vector2(1f, .25f), new Vector2(0f, 0f)
            }, materials["white"], .08f, new Vector3(0f, 3.45f, -.05f), Vector3.one);
        }

        private static void BuildDistrictLandmarkMeshes(Transform rear, Transform main, Transform foreground, int style)
        {
            var bodyWidth = 3.6f + style % 3 * .45f;
            var bodyHeight = 3.4f + style % 4 * .35f;
            var bodyColor = style % 3 == 0 ? materials["cream"] : style % 3 == 1 ? materials["ochre"] : materials["white"];
            var roofColor = style % 2 == 0 ? materials["red"] : materials["blue"];

            AddCanopy(rear, "RearTree", new Vector3(-2.7f, 2.9f, 0f), new Vector2(2.4f, 2.2f),
                style + 12, materials["grassDark"], 2.2f, .7f, style * .63f);

            Vector2[] body;
            if (style == 4)
            {
                body = new[]
                {
                    new Vector2(-1.4f, 0f), new Vector2(-1.15f, 4.6f), new Vector2(-.55f, 5.4f),
                    new Vector2(.35f, 5.2f), new Vector2(1.05f, 4.4f), new Vector2(1.35f, 0f)
                };
            }
            else if (style == 7)
            {
                body = new[]
                {
                    new Vector2(-2.6f, 0f), new Vector2(-2.45f, 3.8f), new Vector2(-1.6f, 4.7f),
                    new Vector2(-.7f, 3.9f), new Vector2(.7f, 3.9f), new Vector2(1.6f, 4.7f),
                    new Vector2(2.45f, 3.8f), new Vector2(2.6f, 0f)
                };
            }
            else
            {
                body = IrregularRect(bodyWidth, bodyHeight, style + 20);
            }
            AddInkPolygon(main, "BuildingBody", body, bodyColor, .14f, Vector3.zero, Vector3.one);

            var roof = style switch
            {
                1 => new[] { new Vector2(-2.5f, bodyHeight - .1f), new Vector2(-1.2f, bodyHeight + 1.4f), new Vector2(.3f, bodyHeight + .75f), new Vector2(2.55f, bodyHeight + .15f) },
                2 => new[] { new Vector2(-2.6f, bodyHeight), new Vector2(0f, bodyHeight + 2f), new Vector2(2.6f, bodyHeight) },
                3 => new[] { new Vector2(-2.4f, bodyHeight), new Vector2(-1.6f, bodyHeight + 1.3f), new Vector2(1.4f, bodyHeight + 1.7f), new Vector2(2.5f, bodyHeight) },
                5 => new[] { new Vector2(-2.5f, bodyHeight), new Vector2(-1.3f, bodyHeight + 1.2f), new Vector2(0f, bodyHeight + 1.55f), new Vector2(1.3f, bodyHeight + 1.2f), new Vector2(2.5f, bodyHeight) },
                _ => new[] { new Vector2(-2.45f, bodyHeight), new Vector2(0f, bodyHeight + 1.65f), new Vector2(2.45f, bodyHeight) }
            };
            AddInkPolygon(main, "Roof", roof, roofColor, .14f, Vector3.zero, Vector3.one);

            AddInkPolygon(main, "Door", BlobPoints(1.05f, 1.75f, style + 70), materials["bark"], .09f,
                new Vector3(0f, .9f, -.03f), Vector3.one);
            AddInkPolygon(main, "WindowLeft", BlobPoints(.7f, .8f, style + 90), materials["waterLight"], .08f,
                new Vector3(-1.15f, 2.25f, -.04f), Vector3.one);
            AddInkPolygon(main, "WindowRight", BlobPoints(.7f, .8f, style + 96), materials["waterLight"], .08f,
                new Vector3(1.15f, 2.25f, -.04f), Vector3.one);

            if (style == 1) AddGearMotif(foreground, new Vector3(2.1f, 2.2f, 0f));
            else if (style == 2) AddCurtainMotif(foreground, bodyHeight);
            else if (style == 3) AddStackedArchiveMotif(foreground);
            else if (style == 4) AddObservationMotif(foreground, bodyHeight);
            else if (style == 5) AddPondPlantMotif(foreground);
            else AddFlagMotif(foreground, style);

            AddInkPolygon(foreground, "PlantLeft", BlobPoints(1.15f, 1.25f, style + 111), materials["leafLight"], .08f,
                new Vector3(-2.25f, .6f, 0f), Vector3.one);
            AddInkPolygon(foreground, "PlantRight", BlobPoints(1.1f, 1.15f, style + 118), materials["grass"], .08f,
                new Vector3(2.3f, .55f, 0f), Vector3.one);
        }

        private static void AddGearMotif(Transform parent, Vector3 position)
        {
            var gear = Child(parent, "WindGearPivot");
            gear.localPosition = position;
            AddInkPolygon(gear, "Gear", StarPoints(1f, .65f, 9), materials["ochre"], .08f, Vector3.zero, Vector3.one);
            gear.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(gear, Vector3.forward, 6f, .35f, 1.1f, true);
        }

        private static void AddCurtainMotif(Transform parent, float height)
        {
            AddInkPolygon(parent, "StageCurtain", new[]
            {
                new Vector2(-2.4f, height - .1f), new Vector2(-1.7f, height + .8f),
                new Vector2(0f, height + .3f), new Vector2(1.7f, height + .8f), new Vector2(2.4f, height - .1f)
            }, materials["purple"], .09f, Vector3.zero, Vector3.one);
        }

        private static void AddStackedArchiveMotif(Transform parent)
        {
            for (var index = 0; index < 4; index++)
                AddInkPolygon(parent, $"Book-{index}", IrregularRect(1.2f + index * .12f, .32f, index + 140),
                    index % 2 == 0 ? materials["red"] : materials["blue"], .05f,
                    new Vector3(2.05f, .35f + index * .36f, 0f), Vector3.one);
        }

        private static void AddObservationMotif(Transform parent, float height)
        {
            var vane = Child(parent, "WeatherVanePivot");
            vane.localPosition = new Vector3(0f, height + 1.1f, 0f);
            AddInkPolygon(vane, "Vane", new[]
            {
                new Vector2(-1.1f, -.1f), new Vector2(.45f, -.1f), new Vector2(.45f, -.45f),
                new Vector2(1.2f, 0f), new Vector2(.45f, .45f), new Vector2(.45f, .1f), new Vector2(-1.1f, .1f)
            }, materials["glow"], .06f, Vector3.zero, Vector3.one);
            vane.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(vane, Vector3.forward, 8f, .55f, .2f, true);
        }

        private static void AddPondPlantMotif(Transform parent)
        {
            for (var index = 0; index < 5; index++)
            {
                var stem = Child(parent, $"ReedPivot-{index}");
                stem.localPosition = new Vector3(-2f + index * .42f, 0f, 0f);
                AddInkPolygon(stem, "Reed", IrregularRect(.13f, 1.4f + index % 2 * .35f, 160 + index),
                    materials["grassDark"], .035f, new Vector3(0f, .7f, 0f), Vector3.one);
                stem.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(stem, Vector3.forward, 5f, .8f, index * .7f, true);
            }
        }

        private static void AddFlagMotif(Transform parent, int style)
        {
            AddInkPolygon(parent, "FlagPole", IrregularRect(.16f, 3.3f, style + 170), materials["bark"], .04f,
                new Vector3(2.1f, 1.65f, 0f), Vector3.one);
            var flag = Child(parent, "FlagWindPivot");
            flag.localPosition = new Vector3(2.15f, 2.95f, 0f);
            AddInkPolygon(flag, "Flag", new[]
            {
                new Vector2(0f, 0f), new Vector2(1.45f, -.18f), new Vector2(1.15f, .48f), new Vector2(0f, .62f)
            }, materials[style % 2 == 0 ? "red" : "purple"], .06f, Vector3.zero, Vector3.one);
            flag.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(flag, Vector3.forward, 7f, 1.3f, style * .8f, true);
        }

        private static void BuildStateCues(Transform stateRoot, string seed)
        {
            var states = new[] { "Available", "Current", "Locked", "Completed" };
            for (var index = 0; index < states.Length; index++)
            {
                var state = stateRoot.Find(states[index]);
                if (state == null) continue;
                Clear(state);
                state.localPosition = new Vector3(0f, .08f, -.48f);
                if (index == 0)
                {
                    AddInkPolygon(state, "OpenPennant", new[]
                    {
                        new Vector2(-.75f, 0f), new Vector2(.7f, 0f), new Vector2(.42f, .8f), new Vector2(-.6f, .65f)
                    }, materials["glow"], .07f, new Vector3(0f, .45f, 0f), Vector3.one);
                }
                else if (index == 1)
                {
                    AddInkPolygon(state, "Compass", StarPoints(.72f, .3f, 4), materials["waterLight"], .08f,
                        new Vector3(0f, 1.15f, 0f), Vector3.one);
                }
                else if (index == 2)
                {
                    AddInkPolygon(state, "ClosedGate", new[]
                    {
                        new Vector2(-1.05f, 0f), new Vector2(-1.05f, 1.5f), new Vector2(-.35f, 1.9f),
                        new Vector2(.35f, 1.9f), new Vector2(1.05f, 1.5f), new Vector2(1.05f, 0f)
                    }, materials["stone"], .09f, Vector3.zero, Vector3.one);
                }
                else
                {
                    AddInkPolygon(state, "Flourish", StarPoints(.78f, .42f, 7), materials["leafLight"], .08f,
                        new Vector3(0f, 1.05f, 0f), Vector3.one);
                }
                state.gameObject.SetActive(index == 0);
            }
            _ = seed;
        }

        private static void ConfigureLandmarkColliders(GameObject root, LandmarkVisual landmark, bool hero)
        {
            if (landmark.InteractionCollider is BoxCollider interaction)
            {
                interaction.isTrigger = true;
                interaction.center = new Vector3(0f, hero ? 3.5f : 2.3f, 0f);
                interaction.size = new Vector3(hero ? 7f : 5.5f, hero ? 7.5f : 5.4f, 2f);
            }
            var old = root.transform.Find("ObstacleFootprint");
            if (old != null) UnityEngine.Object.DestroyImmediate(old.gameObject);
            var footprint = new GameObject("ObstacleFootprint");
            footprint.transform.SetParent(root.transform, false);
            var collider = footprint.AddComponent<BoxCollider>();
            collider.center = new Vector3(0f, 1.1f, 0f);
            collider.size = hero ? new Vector3(2.5f, 2.2f, 1.7f) : new Vector3(3.2f, 2.2f, 1.8f);
        }

        private static GameObject BuildBridge(string familyName, int style)
        {
            var path = $"{BridgeFolder}/PF_YW_Bridge_{familyName}_Mesh.prefab";
            var root = PrefabUtility.LoadPrefabContents(WorldAssetFoundationBuilder.BridgePrefabPath);
            try
            {
                root.name = $"PF_YW_Bridge_{familyName}_Mesh";
                var bridge = root.GetComponent<BridgeVisual>()
                    ?? throw new InvalidOperationException("Bridge template contract is missing.");
                Clear(bridge.VisualRoot);
                Clear(bridge.OpenState);
                Clear(bridge.LockedState);

                var supportMaterial = style == 2 || style == 3 ? materials["stone"] : materials["bark"];
                AddWarpedBox(bridge.VisualRoot, "SupportLeft", new Vector3(-1.25f, .45f, 0f), new Vector3(.28f, .9f, 4.8f), supportMaterial);
                AddWarpedBox(bridge.VisualRoot, "SupportRight", new Vector3(1.25f, .45f, 0f), new Vector3(.28f, .9f, 4.8f), supportMaterial);

                var plankCount = style == 5 ? 5 : 9;
                for (var index = 0; index < plankCount; index++)
                {
                    var z = Mathf.Lerp(-2.1f, 2.1f, plankCount == 1 ? 0f : index / (float)(plankCount - 1));
                    var width = style == 5 ? 1.1f : 2.4f;
                    AddWarpedBox(bridge.OpenState, $"Deck-{index}", new Vector3(0f, .16f + Mathf.Sin(index * .8f) * .05f, z),
                        new Vector3(width, .22f, style == 5 ? .65f : .52f), style == 2 ? materials["stone"] : materials["ochre"], index % 2 * 2f - 1f);
                }

                AddInkPolygon(bridge.LockedState, "ClosedGate", new[]
                {
                    new Vector2(-1.35f, 0f), new Vector2(-1.35f, 2.2f), new Vector2(0f, 2.8f),
                    new Vector2(1.35f, 2.2f), new Vector2(1.35f, 0f)
                }, materials[style == 4 ? "red" : "stone"], .12f, new Vector3(0f, .2f, -2f), Vector3.one);

                var pennant = Child(bridge.VisualRoot, "PennantWindPivot");
                pennant.localPosition = new Vector3(1.3f, 2.2f, -2.1f);
                AddInkPolygon(pennant, "Pennant", new[]
                {
                    new Vector2(0f, 0f), new Vector2(1f, -.15f), new Vector2(.75f, .45f), new Vector2(0f, .55f)
                }, materials["glow"], .05f, Vector3.zero, Vector3.one);
                pennant.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(pennant, Vector3.forward, 6f, 1.2f, style, true);

                bridge.SetUnlocked(true);
                return SavePrefab(root, path);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static GameObject BuildDecoration(string familyName, int style)
        {
            var folder = style < 9 ? DecorationFolder : PropFolder;
            var path = $"{folder}/PF_YW_{familyName}_Mesh.prefab";
            var root = new GameObject($"PF_YW_{familyName}_Mesh");
            try
            {
                var visual = Child(root.transform, "VisualRoot");
                var lowPower = Child(root.transform, "LowPowerRoot");
                lowPower.gameObject.SetActive(false);

                if (style < 6) BuildTreeDecoration(visual, style);
                else if (style == 6) BuildBushDecoration(visual);
                else if (style == 7) BuildReedDecoration(visual);
                else if (style == 8) BuildRockDecoration(visual);
                else if (style == 9) BuildBenchDecoration(visual);
                else if (style == 10) BuildLanternDecoration(visual);
                else BuildCrateDecoration(visual);

                AddInkPolygon(lowPower, "LowPowerSilhouette", BlobPoints(1.6f, 1.5f, style + 220),
                    style < 8 ? materials["grassDark"] : materials["stone"], .08f,
                    new Vector3(0f, .75f, 0f), Vector3.one);
                root.AddComponent<WorldDecorationVisual>().EditorAssignContract(visual, lowPower, style < 6 ? 1.4f : .7f, false);
                return SavePrefab(root, path);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static void BuildTreeDecoration(Transform visual, int style)
        {
            var trunkLean = style == 1 ? 12f : style == 3 ? -5f : 0f;
            AddInkPolygon(visual, "Trunk", IrregularRect(.75f, 3.2f + style % 3 * .35f, style + 230),
                materials["bark"], .08f, new Vector3(0f, 1.55f, 0f), Vector3.one, trunkLean);
            var width = style == 4 ? 2.1f : 3.1f + style % 2 * .35f;
            var height = style == 4 ? 4f : 2.35f + style % 3 * .25f;
            AddCanopy(visual, "CanopyA", new Vector3(-.55f, 3.55f, 0f), new Vector2(width, height),
                style + 240, materials[style % 2 == 0 ? "grass" : "grassDark"], 4f, .75f, style * .9f);
            AddCanopy(visual, "CanopyB", new Vector3(.85f, 3.8f, -.02f), new Vector2(width * .86f, height * .82f),
                style + 250, materials["leafLight"], 5f, .88f, style * 1.2f + .6f);
        }

        private static void BuildBushDecoration(Transform visual)
        {
            AddCanopy(visual, "FlowerBush", new Vector3(0f, .75f, 0f), new Vector2(2.1f, 1.5f), 260,
                materials["grass"], 3f, .9f, .3f);
            for (var index = 0; index < 4; index++)
                AddInkPolygon(visual, $"Flower-{index}", StarPoints(.18f, .08f, 6), materials[index % 2 == 0 ? "red" : "glow"], .025f,
                    new Vector3(-.65f + index * .42f, .72f + index % 2 * .35f, -.03f), Vector3.one);
        }

        private static void BuildReedDecoration(Transform visual)
        {
            for (var index = 0; index < 6; index++)
            {
                var pivot = Child(visual, $"ReedWindPivot-{index}");
                pivot.localPosition = new Vector3(-.65f + index * .26f, 0f, 0f);
                AddInkPolygon(pivot, "Stem", IrregularRect(.1f, 1.5f + index % 3 * .25f, 270 + index),
                    materials["grassDark"], .025f, new Vector3(0f, .75f, 0f), Vector3.one);
                pivot.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(pivot, Vector3.forward, 6f, .9f, index * .6f, true);
            }
        }

        private static void BuildRockDecoration(Transform visual)
        {
            AddInkPolygon(visual, "RockLarge", BlobPoints(1.65f, 1.3f, 281), materials["stone"], .09f, new Vector3(-.3f, .62f, 0f), Vector3.one);
            AddInkPolygon(visual, "RockSmall", BlobPoints(.95f, .75f, 283), materials["soil"], .07f, new Vector3(.85f, .34f, -.03f), Vector3.one);
        }

        private static void BuildBenchDecoration(Transform visual)
        {
            AddWarpedBox(visual, "Seat", new Vector3(0f, .72f, 0f), new Vector3(2.5f, .24f, .7f), materials["ochre"]);
            AddWarpedBox(visual, "Back", new Vector3(0f, 1.25f, .28f), new Vector3(2.5f, .85f, .18f), materials["bark"]);
            AddWarpedBox(visual, "LegLeft", new Vector3(-.9f, .35f, 0f), new Vector3(.18f, .7f, .18f), materials["ink"]);
            AddWarpedBox(visual, "LegRight", new Vector3(.9f, .35f, 0f), new Vector3(.18f, .7f, .18f), materials["ink"]);
        }

        private static void BuildLanternDecoration(Transform visual)
        {
            AddInkPolygon(visual, "Post", IrregularRect(.18f, 2.8f, 290), materials["bark"], .04f,
                new Vector3(0f, 1.4f, 0f), Vector3.one);
            var lamp = Child(visual, "LanternWindPivot");
            lamp.localPosition = new Vector3(0f, 2.65f, 0f);
            AddInkPolygon(lamp, "Lamp", BlobPoints(.8f, .95f, 292), materials["glow"], .07f, Vector3.zero, Vector3.one);
            lamp.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(lamp, Vector3.forward, 3f, .65f, 1f, true);
        }

        private static void BuildCrateDecoration(Transform visual)
        {
            AddWarpedBox(visual, "CrateA", new Vector3(-.45f, .52f, 0f), new Vector3(1.05f, 1.05f, .9f), materials["bark"], -3f);
            AddWarpedBox(visual, "CrateB", new Vector3(.55f, .38f, -.15f), new Vector3(.8f, .76f, .72f), materials["ochre"], 5f);
        }

        private static GameObject BuildCloud()
        {
            var root = new GameObject("PF_YW_Atmosphere_Cloud_Mesh");
            try
            {
                var visual = Child(root.transform, "VisualRoot");
                var lowPower = Child(root.transform, "LowPowerRoot");
                lowPower.gameObject.SetActive(false);
                AddInkPolygon(visual, "CloudA", BlobPoints(3.1f, 1.35f, 301), materials["cloud"], .08f, Vector3.zero, Vector3.one);
                AddInkPolygon(visual, "CloudB", BlobPoints(2f, 1.25f, 303), materials["white"], .07f, new Vector3(1.35f, .25f, -.02f), Vector3.one);
                AddInkPolygon(lowPower, "CloudLowPower", BlobPoints(2.8f, 1.1f, 305), materials["cloud"], .06f, Vector3.zero, Vector3.one);
                root.AddComponent<WorldDecorationVisual>().EditorAssignContract(visual, lowPower, 0f, false);
                return SavePrefab(root, $"{PropFolder}/PF_YW_Atmosphere_Cloud_Mesh.prefab");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static GameObject BuildYuvi()
        {
            var root = new GameObject("PF_YW_Yuvi_Mesh");
            try
            {
                var visual = Child(root.transform, "VisualRoot");
                AddInkPolygon(visual, "Body", BlobPoints(1.55f, 1.9f, 320), materials["purple"], .11f,
                    new Vector3(0f, 1.45f, 0f), Vector3.one);
                AddInkPolygon(visual, "Face", BlobPoints(1.35f, 1.05f, 322), materials["cream"], .09f,
                    new Vector3(0f, 2.35f, -.04f), Vector3.one);
                AddInkPolygon(visual, "EyeLeft", BlobPoints(.22f, .32f, 324), materials["ink"], .025f,
                    new Vector3(-.33f, 2.45f, -.07f), Vector3.one);
                AddInkPolygon(visual, "EyeRight", BlobPoints(.22f, .32f, 326), materials["ink"], .025f,
                    new Vector3(.33f, 2.45f, -.07f), Vector3.one);
                AddInkPolygon(visual, "FootLeft", BlobPoints(.65f, .42f, 328), materials["blue"], .06f,
                    new Vector3(-.48f, .4f, 0f), Vector3.one);
                AddInkPolygon(visual, "FootRight", BlobPoints(.65f, .42f, 330), materials["blue"], .06f,
                    new Vector3(.48f, .4f, 0f), Vector3.one);
                AddInkPolygon(visual, "ArmLeft", IrregularRect(.28f, 1.35f, 332), materials["purple"], .05f,
                    new Vector3(-.92f, 1.45f, 0f), Vector3.one, -18f);
                AddInkPolygon(visual, "ArmRight", IrregularRect(.28f, 1.35f, 334), materials["purple"], .05f,
                    new Vector3(.92f, 1.45f, 0f), Vector3.one, 18f);
                var antenna = Child(visual, "AntennaWindPivot");
                antenna.localPosition = new Vector3(0f, 3f, 0f);
                AddInkPolygon(antenna, "Stem", IrregularRect(.12f, .75f, 336), materials["ink"], .025f,
                    new Vector3(0f, .38f, 0f), Vector3.one);
                AddInkPolygon(antenna, "Glow", StarPoints(.28f, .14f, 7), materials["glow"], .035f,
                    new Vector3(0f, .82f, 0f), Vector3.one);
                antenna.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(antenna, Vector3.forward, 4f, 1.4f, .5f, false);
                root.AddComponent<YuviTarget>();
                return SavePrefab(root, YuviPrefabPath);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static void BuildReviewScene(GameObject terrain, GameObject centralTree, GameObject Yuvi, WorldAssetCatalog catalog)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 29f;
            camera.backgroundColor = Water;
            camera.clearFlags = CameraClearFlags.SolidColor;
            cameraObject.transform.SetPositionAndRotation(new Vector3(36f, 43f, -35f), Quaternion.Euler(54f, 0f, 0f));

            var lightObject = new GameObject("Directional Light");
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            lightObject.transform.rotation = Quaternion.Euler(46f, -32f, 0f);

            var review = new GameObject("BulkWorldReview");
            review.tag = "EditorOnly";
            PrefabUtility.InstantiatePrefab(terrain, review.transform);
            var tree = (GameObject)PrefabUtility.InstantiatePrefab(centralTree, review.transform);
            tree.transform.position = new Vector3(-1f, .85f, -1f);
            var YuviInstance = (GameObject)PrefabUtility.InstantiatePrefab(Yuvi, review.transform);
            YuviInstance.transform.position = new Vector3(-7f, .85f, -2f);

            for (var index = 0; index < LandmarkIds.Length; index++)
            {
                if (!catalog.TryResolve(LandmarkIds[index], false, out var prefab)) continue;
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, review.transform);
                instance.transform.position = new Vector3(index * 10f + 5f, .85f, index / 2 * 5.5f);
            }
            for (var index = 0; index < DecorationIds.Length; index++)
            {
                if (!catalog.TryResolve(DecorationIds[index], false, out var prefab)) continue;
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, review.transform);
                instance.transform.position = new Vector3(index * 5.5f - 6f, .85f, -5f + index % 3 * 2.5f);
            }
            for (var index = 0; index < BridgeIds.Length; index++)
            {
                if (!catalog.TryResolve(BridgeIds[index], false, out var prefab)) continue;
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, review.transform);
                instance.transform.position = new Vector3(17f + index * 8.5f, .12f, 7.5f + index % 2 * 4f);
                instance.transform.localRotation = Quaternion.Euler(0f, 90f, 0f);
            }
            if (catalog.TryResolve("atmosphere.cloud", false, out var cloudPrefab))
            {
                for (var index = 0; index < 6; index++)
                {
                    var cloud = (GameObject)PrefabUtility.InstantiatePrefab(cloudPrefab, review.transform);
                    cloud.transform.position = new Vector3(5f + index * 14f, 9f + index % 2, 18f + index % 3 * 2f);
                    cloud.transform.localScale = Vector3.one * (1f + index % 3 * .14f);
                }
            }

            var systems = new GameObject("WorldSystems");
            systems.transform.SetParent(review.transform, false);
            systems.AddComponent<WorldMotionController>().Configure(review.transform, false, false);

            EditorSceneManager.SaveScene(scene, ReviewScenePath);
            AssetDatabase.SaveAssets();
        }

        private static void AddCanopy(
            Transform parent,
            string name,
            Vector3 position,
            Vector2 size,
            int seed,
            Material fill,
            float amplitude,
            float speed,
            float phase)
        {
            var pivot = Child(parent, $"{name}WindPivot");
            pivot.localPosition = position;
            AddInkPolygon(pivot, name, BlobPoints(size.x, size.y, seed), fill, .10f, Vector3.zero, Vector3.one);
            pivot.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(
                pivot, Vector3.forward, amplitude, speed, phase, true);
        }

        private static void AddInkPolygon(
            Transform parent,
            string name,
            Vector2[] points,
            Material fill,
            float border,
            Vector3 localPosition,
            Vector3 localScale,
            float zRotation = 0f)
        {
            var mesh = MeshAsset($"{Sanitize(parent.root.name)}_{Sanitize(name)}_{Mathf.Abs(points[0].GetHashCode())}",
                () => CreateInkPolygonMesh(points, border));
            AddMesh(parent, name, mesh, new[] { fill, materials["ink"] }, localPosition,
                Quaternion.Euler(0f, 0f, zRotation), localScale);
        }

        private static void AddWarpedBox(
            Transform parent,
            string name,
            Vector3 position,
            Vector3 scale,
            Material material,
            float yRotation = 0f)
        {
            var mesh = MeshAsset("Shared_WarpedBox", CreateWarpedBoxMesh);
            AddMesh(parent, name, mesh, new[] { material }, position, Quaternion.Euler(0f, yRotation, 0f), scale);
        }

        private static GameObject AddMesh(
            Transform parent,
            string name,
            Mesh mesh,
            Material[] meshMaterials,
            Vector3 position,
            Quaternion rotation,
            Vector3 scale)
        {
            var item = new GameObject(name);
            item.transform.SetParent(parent, false);
            item.transform.localPosition = position;
            item.transform.localRotation = rotation;
            item.transform.localScale = scale;
            item.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = item.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = meshMaterials;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return item;
        }

        private static Mesh MeshAsset(string key, Func<Mesh> create)
        {
            var path = $"{MeshFolder}/MESH_YW_{Sanitize(key)}.asset";
            var generated = create();
            generated.name = $"MESH_YW_{Sanitize(key)}";
            var existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }
            EditorUtility.CopySerialized(generated, existing);
            UnityEngine.Object.DestroyImmediate(generated);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        private static Mesh CreateInkPolygonMesh(IReadOnlyList<Vector2> points, float border)
        {
            var count = points.Count;
            var vertices = new Vector3[count * 2];
            var uv = new Vector2[count * 2];
            var center = Vector2.zero;
            for (var index = 0; index < count; index++) center += points[index];
            center /= count;
            for (var index = 0; index < count; index++)
            {
                var point = points[index];
                var direction = (point - center).normalized;
                vertices[index] = new Vector3(point.x, point.y, 0f);
                vertices[index + count] = new Vector3(point.x + direction.x * border, point.y + direction.y * border, .008f);
                uv[index] = uv[index + count] = point;
            }

            var fillTriangles = new List<int>();
            for (var index = 1; index < count - 1; index++)
            {
                AddDoubleSidedTriangle(fillTriangles, 0, index, index + 1);
            }
            var borderTriangles = new List<int>();
            for (var index = 0; index < count; index++)
            {
                var next = (index + 1) % count;
                AddDoubleSidedTriangle(borderTriangles, index, next, next + count);
                AddDoubleSidedTriangle(borderTriangles, index, next + count, index + count);
            }

            var mesh = new Mesh { subMeshCount = 2, vertices = vertices, uv = uv };
            mesh.SetTriangles(fillTriangles, 0);
            mesh.SetTriangles(borderTriangles, 1);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateTerrainMesh(IReadOnlyList<Vector2> points, float depth)
        {
            var count = points.Count;
            var vertices = new Vector3[count * 2];
            for (var index = 0; index < count; index++)
            {
                vertices[index] = new Vector3(points[index].x, 0f, points[index].y);
                vertices[index + count] = new Vector3(points[index].x, -depth, points[index].y);
            }
            var top = new List<int>();
            for (var index = 1; index < count - 1; index++)
            {
                top.Add(0);
                top.Add(index + 1);
                top.Add(index);
            }
            var sides = new List<int>();
            for (var index = 0; index < count; index++)
            {
                var next = (index + 1) % count;
                sides.Add(index);
                sides.Add(next);
                sides.Add(next + count);
                sides.Add(index);
                sides.Add(next + count);
                sides.Add(index + count);
            }
            var mesh = new Mesh { subMeshCount = 2, vertices = vertices };
            mesh.SetTriangles(top, 0);
            mesh.SetTriangles(sides, 1);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateWarpedBoxMesh()
        {
            var vertices = new[]
            {
                new Vector3(-.52f, -.48f, -.50f), new Vector3(.48f, -.51f, -.47f),
                new Vector3(.51f, .47f, -.52f), new Vector3(-.47f, .52f, -.48f),
                new Vector3(-.48f, -.52f, .49f), new Vector3(.53f, -.47f, .52f),
                new Vector3(.47f, .53f, .48f), new Vector3(-.53f, .46f, .51f)
            };
            var triangles = new[]
            {
                0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
                0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
                2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7
            };
            var mesh = new Mesh { vertices = vertices, triangles = triangles };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void AddDoubleSidedTriangle(List<int> triangles, int a, int b, int c)
        {
            triangles.Add(a);
            triangles.Add(b);
            triangles.Add(c);
            triangles.Add(c);
            triangles.Add(b);
            triangles.Add(a);
        }

        private static Vector2[] BlobPoints(float width, float height, int seed)
        {
            const int count = 12;
            var points = new Vector2[count];
            for (var index = 0; index < count; index++)
            {
                var angle = Mathf.PI * 2f * index / count;
                var wobble = 1f + Mathf.Sin(seed * .73f + index * 2.17f) * .11f;
                points[index] = new Vector2(Mathf.Cos(angle) * width * .5f * wobble, Mathf.Sin(angle) * height * .5f * wobble);
            }
            return points;
        }

        private static Vector2[] IrregularRect(float width, float height, int seed)
        {
            var wobble = Mathf.Sin(seed * 1.71f) * .09f;
            return new[]
            {
                new Vector2(-width * (.5f + wobble), -height * .5f),
                new Vector2(width * (.48f - wobble), -height * .5f),
                new Vector2(width * .52f, -height * .12f),
                new Vector2(width * (.47f + wobble), height * .5f),
                new Vector2(-width * (.48f - wobble), height * .48f),
                new Vector2(-width * .52f, height * .08f)
            };
        }

        private static Vector2[] StarPoints(float outer, float inner, int arms)
        {
            var points = new Vector2[arms * 2];
            for (var index = 0; index < points.Length; index++)
            {
                var radius = index % 2 == 0 ? outer : inner;
                var angle = Mathf.PI * 2f * index / points.Length + Mathf.PI * .5f;
                points[index] = new Vector2(Mathf.Cos(angle) * radius, Mathf.Sin(angle) * radius);
            }
            return points;
        }

        private static void Register(WorldAssetCatalog catalog, string assetId, WorldAssetKind kind, GameObject prefab)
        {
            catalog.EditorEnsureFoundationEntry(assetId, kind, prefab);
            EditorUtility.SetDirty(catalog);
        }

        private static GameObject SavePrefab(GameObject root, string path)
        {
            var prefab = PrefabUtility.SaveAsPrefabAsset(root, path, out var success);
            if (!success || prefab == null) throw new InvalidOperationException($"Could not save prefab: {path}.");
            return prefab;
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name).transform;
            child.SetParent(parent, false);
            return child;
        }

        private static void Clear(Transform parent)
        {
            if (parent == null) return;
            for (var index = parent.childCount - 1; index >= 0; index--)
                UnityEngine.Object.DestroyImmediate(parent.GetChild(index).gameObject);
        }

        private static void RemovePaperLayer(Transform target)
        {
            var paperLayer = target != null ? target.GetComponent<WorldPaperLayer>() : null;
            if (paperLayer != null) UnityEngine.Object.DestroyImmediate(paperLayer);
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var split = path.LastIndexOf('/');
            var parent = path.Substring(0, split);
            var name = path.Substring(split + 1);
            EnsureFolder(parent);
            if (string.IsNullOrEmpty(AssetDatabase.CreateFolder(parent, name)))
                throw new InvalidOperationException($"Could not create folder: {path}.");
        }

        private static string Sanitize(string value)
        {
            return value.Replace(' ', '_').Replace('-', '_').Replace('.', '_').Replace('/', '_');
        }

        private static Color Hex(string value)
        {
            if (!ColorUtility.TryParseHtmlString($"#{value}", out var color))
                throw new ArgumentException($"Invalid color: {value}.", nameof(value));
            return color;
        }
    }
}
