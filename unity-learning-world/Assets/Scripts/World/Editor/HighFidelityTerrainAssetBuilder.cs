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
    public static class HighFidelityTerrainAssetBuilder
    {
        public const string MeadowPathAssetId = "terrain.meadow-path";
        public const string MeadowPathPrefabPath = "Assets/Prefabs/World/Terrain/PF_YW_MeadowPath_HighFidelity.prefab";
        public const string MeadowPathReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_MeadowPath_HighFidelity.unity";
        public const string MeadowPathCloseupCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/MeadowPath-Closeup.png";
        public const string MeadowPathGameplayCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/MeadowPath-GameplayScale.png";

        [MenuItem("Yuvi/World Art/High Fidelity/Build Meadow Path Family")]
        public static void BuildMeadowPathFamily()
        {
            EnsureTerrainFolders();
            var template = AssetDatabase.LoadAssetAtPath<GameObject>(WorldAssetFoundationBuilder.TerrainPrefabPath);
            if (template == null)
            {
                WorldAssetFoundationBuilder.CreateFoundation();
                template = AssetDatabase.LoadAssetAtPath<GameObject>(WorldAssetFoundationBuilder.TerrainPrefabPath);
            }
            if (template == null) throw new InvalidOperationException("Terrain template is unavailable.");

            var root = PrefabUtility.LoadPrefabContents(WorldAssetFoundationBuilder.TerrainPrefabPath);
            try
            {
                root.name = "PF_YW_MeadowPath_HighFidelity";
                var terrainVisual = root.GetComponent<TerrainVisual>()
                    ?? throw new InvalidOperationException("TerrainVisual contract is missing.");
                var traversal = root.GetComponent<WorldTraversalSurface>()
                    ?? throw new InvalidOperationException("WorldTraversalSurface contract is missing.");

                ClearTerrainChildren(terrainVisual.VisualRoot);
                ClearTerrainChildren(terrainVisual.MovementZonesRoot);
                ClearTerrainChildren(terrainVisual.LandmarkAnchorsRoot);
                ClearTerrainChildren(terrainVisual.BridgeAnchorsRoot);

                var materials = LoadTerrainMaterials();
                BuildMeadowTerrain(terrainVisual.VisualRoot, materials);
                BuildMeadowTraversal(terrainVisual.MovementZonesRoot);
                BuildMeadowAnchors(terrainVisual.LandmarkAnchorsRoot, terrainVisual.BridgeAnchorsRoot);
                traversal.EditorAssignContract(terrainVisual.MovementZonesRoot);

                var prefab = PrefabUtility.SaveAsPrefabAsset(root, MeadowPathPrefabPath);
                if (prefab == null) throw new InvalidOperationException($"Could not save {MeadowPathPrefabPath}.");

                var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(WorldAssetFoundationBuilder.CatalogPath);
                if (catalog != null)
                {
                    catalog.EditorEnsureFoundationEntry(MeadowPathAssetId, WorldAssetKind.Terrain, prefab);
                    EditorUtility.SetDirty(catalog);
                }
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }

            BuildMeadowPathReviewScene();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            ValidateMeadowPathFamily();
            Debug.Log("✅ High-fidelity meadow and path family built and validated for close-up review.");
        }

        [MenuItem("Yuvi/World Art/High Fidelity/Validate Meadow Path Family")]
        public static void ValidateMeadowPathFamily()
        {
            var issues = new List<string>();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(MeadowPathPrefabPath);
            if (prefab == null)
            {
                issues.Add($"Missing prefab: {MeadowPathPrefabPath}.");
            }
            else
            {
                var terrain = prefab.GetComponent<TerrainVisual>();
                var traversal = prefab.GetComponent<WorldTraversalSurface>();
                if (terrain == null) issues.Add("Meadow path requires TerrainVisual.");
                else terrain.CollectValidationIssues(issues);
                if (traversal == null) issues.Add("Meadow path requires WorldTraversalSurface.");
                else traversal.CollectValidationIssues(issues);

                var visualRenderers = terrain == null
                    ? Array.Empty<Renderer>()
                    : terrain.VisualRoot.GetComponentsInChildren<Renderer>(true);
                if (visualRenderers.Length < 22)
                    issues.Add($"Meadow path requires at least 22 visual renderers; found {visualRenderers.Length}.");
                if (visualRenderers.Any(renderer => renderer.name.Contains("Primitive", StringComparison.OrdinalIgnoreCase)))
                    issues.Add("Meadow path still exposes a placeholder primitive renderer.");

                var traversalColliders = terrain == null
                    ? Array.Empty<Collider>()
                    : terrain.MovementZonesRoot.GetComponentsInChildren<Collider>(true);
                if (traversalColliders.Length < 2)
                    issues.Add("Meadow path requires independent meadow and raised-bank traversal surfaces.");
                if (traversalColliders.Any(collider => collider.GetComponent<Renderer>() != null))
                    issues.Add("Traversal colliders must stay renderer-free.");

                var renderBounds = CalculateTerrainBounds(visualRenderers);
                if (renderBounds.size.x < 20f || renderBounds.size.z < 13f)
                    issues.Add($"Meadow path footprint is too small: {renderBounds.size}.");
                if (!visualRenderers.Any(renderer => renderer.name.StartsWith("Path", StringComparison.Ordinal)))
                    issues.Add("Meadow path requires a readable packed-earth route.");
                if (prefab.GetComponentsInChildren<WorldWindElement>(true).Length < 14)
                    issues.Add("Meadow path requires at least 14 wind-ready vegetation groups.");
            }

            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
        }

        [MenuItem("Yuvi/World Art/High Fidelity/Capture Meadow Path Review")]
        public static void CaptureMeadowPathReview()
        {
            if (!File.Exists(Path.GetFullPath(MeadowPathReviewScenePath)))
                BuildMeadowPathFamily();

            var scene = EditorSceneManager.OpenScene(MeadowPathReviewScenePath, OpenSceneMode.Single);
            var camera = UnityEngine.Object.FindFirstObjectByType<Camera>()
                ?? throw new InvalidOperationException("Review scene camera is missing.");
            var terrain = UnityEngine.Object.FindFirstObjectByType<TerrainVisual>()
                ?? throw new InvalidOperationException("Review scene terrain is missing.");
            var renderers = terrain.VisualRoot.GetComponentsInChildren<Renderer>(false);
            var bounds = CalculateTerrainBounds(renderers);

            LogTerrainCaptureDiagnostics("meadow-closeup", scene, camera, renderers, bounds);
            CaptureTerrainReviewFrame(
                camera,
                new Vector3(-9.4f, 8.8f, -13.5f),
                bounds.center + new Vector3(.8f, -.2f, .55f),
                45f,
                1600,
                1100,
                MeadowPathCloseupCapturePath);

            LogTerrainCaptureDiagnostics("meadow-gameplay", scene, camera, renderers, bounds);
            CaptureTerrainReviewFrame(
                camera,
                new Vector3(-12.5f, 11.2f, -15.5f),
                new Vector3(1.6f, .15f, 1.15f),
                44f,
                1600,
                900,
                MeadowPathGameplayCapturePath);

            AssetDatabase.Refresh();
            Debug.Log($"✅ Meadow path review captures saved to {MeadowPathCloseupCapturePath} and {MeadowPathGameplayCapturePath}.");
        }

        public static void RebuildAndCaptureMeadowPathReview()
        {
            BuildMeadowPathFamily();
            CaptureMeadowPathReview();
        }

        private static void BuildMeadowTerrain(Transform visualRoot, IReadOnlyDictionary<string, Material> materials)
        {
            AddTerrainMesh(
                visualRoot,
                "MeadowBase",
                CreateMeadowMesh("MESH_YW_HF_MeadowBase", 24f, 16f, 14, 10, .16f),
                materials["ground"]);

            var path = new[]
            {
                new Vector3(-11.5f, .14f, -3.5f),
                new Vector3(-8.2f, .16f, -3f),
                new Vector3(-4.7f, .17f, -1.25f),
                new Vector3(-1.3f, .18f, -.95f),
                new Vector3(2.1f, .2f, .75f),
                new Vector3(5.5f, .23f, 1.05f),
                new Vector3(8.4f, .28f, 3.2f),
                new Vector3(11.4f, .34f, 4.35f)
            };
            AddTerrainMesh(visualRoot, "PathPackedEarth", CreatePathRibbonMesh("MESH_YW_HF_PathPackedEarth", path, 2.45f, .045f), materials["soil"]);

            var stonePositions = new[]
            {
                new Vector3(-9.6f, .22f, -4.35f), new Vector3(-7.4f, .22f, -1.25f),
                new Vector3(-5.2f, .22f, -2.85f), new Vector3(-2.7f, .23f, .7f),
                new Vector3(.3f, .25f, -.95f), new Vector3(3.1f, .29f, 3.15f),
                new Vector3(5.8f, .32f, 1.25f), new Vector3(8.2f, .4f, 5.55f),
                new Vector3(9.7f, .43f, 3.55f)
            };
            for (var index = 0; index < stonePositions.Length; index++)
            {
                var scale = new Vector3(.38f + index % 3 * .08f, .2f + index % 2 * .06f, .26f + index % 4 * .05f);
                AddTerrainMesh(
                    visualRoot,
                    $"PathStone-{index + 1:00}",
                    CreateTerrainRockMesh($"MESH_YW_HF_PathStone-{index + 1:00}", 100 + index),
                    index % 2 == 0 ? materials["stone"] : materials["stoneDark"],
                    stonePositions[index],
                    Quaternion.Euler(index * 7f, index * 31f, index % 2 == 0 ? 3f : -4f),
                    scale);
            }

            var grassPatches = new[]
            {
                new Vector3(-10.1f, .19f, -6.1f), new Vector3(-8.7f, .18f, -.8f),
                new Vector3(-6.1f, .19f, -4.3f), new Vector3(-4.4f, .2f, 1.2f),
                new Vector3(-1.4f, .22f, -2.2f), new Vector3(.7f, .25f, 2.6f),
                new Vector3(3.7f, .28f, -.45f), new Vector3(5.1f, .32f, 4.25f),
                new Vector3(7.4f, .36f, 2f), new Vector3(9.5f, .42f, 6f),
                new Vector3(10.2f, .4f, 2.75f), new Vector3(-2.8f, .21f, 3.6f),
                new Vector3(1.9f, .26f, -4.6f), new Vector3(7.8f, .34f, -2.7f),
                new Vector3(-7.5f, .18f, 4.8f), new Vector3(4.9f, .3f, 6.35f)
            };
            for (var index = 0; index < grassPatches.Length; index++)
            {
                var patch = Child(visualRoot, $"WindGrassPatch-{index + 1:00}");
                patch.localPosition = grassPatches[index];
                var wind = patch.gameObject.AddComponent<WorldWindElement>();
                wind.EditorAssignContract(patch, Vector3.forward, 2.4f + index % 3 * .65f, .8f + index % 4 * .09f, index * .43f, true);
                CreateGrassPatch(patch, index, materials);
            }

            var flowerPositions = new[]
            {
                new Vector3(-8.8f, .2f, -5f), new Vector3(-6.6f, .2f, 2.65f),
                new Vector3(-2.1f, .23f, -3.5f), new Vector3(1.2f, .27f, 4.4f),
                new Vector3(4.4f, .31f, -2.1f), new Vector3(8.4f, .38f, 1f)
            };
            for (var index = 0; index < flowerPositions.Length; index++)
            {
                var bloom = Child(visualRoot, $"Wildflower-{index + 1:00}");
                bloom.localPosition = flowerPositions[index];
                CreateStemAndBloom(bloom, materials, index);
            }
        }

        private static void BuildMeadowTraversal(Transform movementRoot)
        {
            var primary = Child(movementRoot, "MeadowWalkableSurface");
            var primaryCollider = primary.gameObject.AddComponent<BoxCollider>();
            primaryCollider.center = new Vector3(0f, -.08f, 0f);
            primaryCollider.size = new Vector3(24f, .2f, 16f);

            var pathSupport = Child(movementRoot, "PathTraversalSupport");
            var pathCollider = pathSupport.gameObject.AddComponent<BoxCollider>();
            pathCollider.center = new Vector3(0f, .03f, .8f);
            pathCollider.size = new Vector3(23f, .2f, 4.1f);
            pathSupport.localRotation = Quaternion.Euler(0f, -20f, 0f);
        }

        private static void BuildMeadowAnchors(Transform landmarkRoot, Transform bridgeRoot)
        {
            var treeAnchor = Child(landmarkRoot, "CentralLearningTreeAnchor");
            treeAnchor.localPosition = new Vector3(1.2f, .21f, 3.2f);
            treeAnchor.localRotation = Quaternion.Euler(0f, -12f, 0f);

            var entry = Child(bridgeRoot, "WestEntryAnchor");
            entry.localPosition = new Vector3(-11.4f, .18f, -3.5f);
            entry.localRotation = Quaternion.Euler(0f, -72f, 0f);

            var exit = Child(bridgeRoot, "EastExitAnchor");
            exit.localPosition = new Vector3(11.4f, .38f, 5f);
            exit.localRotation = Quaternion.Euler(0f, -70f, 0f);
        }

        private static void BuildMeadowPathReviewScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Hex("D7DFD3");
            RenderSettings.ambientEquatorColor = Hex("A7B4A3");
            RenderSettings.ambientGroundColor = Hex("69715F");
            RenderSettings.ambientIntensity = 1.05f;
            RenderSettings.fog = false;

            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Hex("CDD6D0");
            camera.fieldOfView = 48f;
            camera.nearClipPlane = .1f;
            camera.farClipPlane = 180f;
            camera.allowHDR = true;
            cameraObject.transform.position = new Vector3(5.7f, 9.2f, -13.8f);
            cameraObject.transform.LookAt(new Vector3(.4f, .2f, .8f));

            var keyObject = new GameObject("Directional Key Light");
            var key = keyObject.AddComponent<Light>();
            key.type = LightType.Directional;
            key.color = Hex("FFF3D4");
            key.intensity = 1.38f;
            key.shadows = LightShadows.Soft;
            key.shadowStrength = .72f;
            keyObject.transform.rotation = Quaternion.Euler(48f, -38f, 0f);

            var fillObject = new GameObject("Cool Fill Light");
            var fill = fillObject.AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.color = Hex("BBD6D0");
            fill.intensity = .42f;
            fill.shadows = LightShadows.None;
            fillObject.transform.rotation = Quaternion.Euler(32f, 140f, 0f);

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(MeadowPathPrefabPath)
                ?? throw new InvalidOperationException($"Missing prefab: {MeadowPathPrefabPath}.");
            var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject
                ?? throw new InvalidOperationException("Could not instantiate meadow path prefab.");
            instance.name = "MeadowPathReview";
            SceneManager.MoveGameObjectToScene(instance, scene);

            var motionObject = new GameObject("World Motion System");
            motionObject.AddComponent<WorldMotionController>();
            SceneManager.MoveGameObjectToScene(motionObject, scene);

            EditorSceneManager.SaveScene(scene, MeadowPathReviewScenePath);
        }

        private static void CreateGrassPatch(Transform parent, int seed, IReadOnlyDictionary<string, Material> materials)
        {
            var random = new System.Random(2300 + seed * 97);
            var blades = 7 + seed % 4;
            for (var bladeIndex = 0; bladeIndex < blades; bladeIndex++)
            {
                var angle = (float)random.NextDouble() * Mathf.PI * 2f;
                var radius = .08f + (float)random.NextDouble() * .28f;
                var height = .25f + (float)random.NextDouble() * .3f;
                var width = .045f + (float)random.NextDouble() * .04f;
                var position = new Vector3(Mathf.Cos(angle) * radius, 0f, Mathf.Sin(angle) * radius);
                var rotation = Quaternion.Euler(-4f + (float)random.NextDouble() * 10f, (float)random.NextDouble() * 360f, -8f + (float)random.NextDouble() * 16f);
                AddTerrainMesh(
                    parent,
                    $"GrassBlade-{bladeIndex + 1:00}",
                    CreateTerrainLeafMesh($"MESH_YW_HF_GrassBlade-{seed:00}-{bladeIndex:00}", width, height, .16f),
                    bladeIndex % 3 == 0 ? materials["grassLight"] : materials["moss"],
                    position,
                    rotation);
            }
        }

        private static void CreateStemAndBloom(Transform parent, IReadOnlyDictionary<string, Material> materials, int seed)
        {
            var stemHeight = .32f + seed % 3 * .05f;
            AddTerrainMesh(parent, "Stem", CreateTerrainCylinderMesh($"MESH_YW_HF_FlowerStem-{seed:00}", .018f, .013f, stemHeight, 7), materials["moss"], new Vector3(0f, stemHeight * .5f, 0f));
            var bloomMaterial = seed % 2 == 0 ? materials["warmLight"] : materials["leafLight"];
            for (var petal = 0; petal < 5; petal++)
            {
                var angle = petal * 72f;
                var direction = Quaternion.Euler(0f, angle, 0f) * Vector3.forward;
                AddTerrainMesh(
                    parent,
                    $"Petal-{petal + 1}",
                    CreateTerrainLeafMesh($"MESH_YW_HF_FlowerPetal-{seed:00}-{petal:00}", .07f, .15f, .18f),
                    bloomMaterial,
                    new Vector3(direction.x * .06f, stemHeight + .025f, direction.z * .06f),
                    Quaternion.Euler(72f, angle, 0f));
            }
        }

        private static Mesh CreateMeadowMesh(string name, float width, float depth, int xSegments, int zSegments, float heightVariation)
        {
            var vertices = new List<Vector3>();
            var uv = new List<Vector2>();
            var triangles = new List<int>();
            for (var z = 0; z <= zSegments; z++)
            {
                var v = z / (float)zSegments;
                for (var x = 0; x <= xSegments; x++)
                {
                    var u = x / (float)xSegments;
                    var worldX = (u - .5f) * width;
                    var worldZ = (v - .5f) * depth;
                    var edge = Mathf.Max(Mathf.Abs(u - .5f) * 2f, Mathf.Abs(v - .5f) * 2f);
                    var height = Mathf.Sin(worldX * .43f) * .035f
                        + Mathf.Cos(worldZ * .51f) * .025f
                        + Mathf.Sin((worldX + worldZ) * .26f) * heightVariation * .23f
                        - Mathf.SmoothStep(0f, .12f, Mathf.Clamp01((edge - .82f) / .18f));
                    vertices.Add(new Vector3(worldX, height, worldZ));
                    uv.Add(new Vector2(u * 3.5f, v * 2.6f));
                }
            }

            for (var z = 0; z < zSegments; z++)
            for (var x = 0; x < xSegments; x++)
            {
                var a = z * (xSegments + 1) + x;
                var b = a + 1;
                var c = a + xSegments + 1;
                var d = c + 1;
                triangles.AddRange(new[] { a, c, d, a, d, b });
            }

            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return SaveTerrainMesh(mesh, name);
        }

        private static Mesh CreatePathRibbonMesh(string name, IReadOnlyList<Vector3> points, float width, float crownHeight)
        {
            var vertices = new List<Vector3>();
            var uv = new List<Vector2>();
            var triangles = new List<int>();
            for (var index = 0; index < points.Count; index++)
            {
                var previous = points[Mathf.Max(0, index - 1)];
                var next = points[Mathf.Min(points.Count - 1, index + 1)];
                var tangent = (next - previous).normalized;
                var side = Vector3.Cross(Vector3.up, tangent).normalized;
                var t = index / (float)(points.Count - 1);
                vertices.Add(points[index] - side * width * .5f);
                vertices.Add(points[index] + Vector3.up * crownHeight);
                vertices.Add(points[index] + side * width * .5f);
                uv.Add(new Vector2(0f, t * 4f));
                uv.Add(new Vector2(.5f, t * 4f));
                uv.Add(new Vector2(1f, t * 4f));
            }

            for (var index = 0; index < points.Count - 1; index++)
            {
                var a = index * 3;
                var b = a + 1;
                var c = a + 2;
                var d = a + 3;
                var e = a + 4;
                var f = a + 5;
                triangles.AddRange(new[] { a, d, e, a, e, b, b, e, f, b, f, c });
            }

            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return SaveTerrainMesh(mesh, name);
        }

        private static Vector3[] OffsetPath(IReadOnlyList<Vector3> points, float offset)
        {
            var result = new Vector3[points.Count];
            for (var index = 0; index < points.Count; index++)
            {
                var previous = points[Mathf.Max(0, index - 1)];
                var next = points[Mathf.Min(points.Count - 1, index + 1)];
                var tangent = (next - previous).normalized;
                var side = Vector3.Cross(Vector3.up, tangent).normalized;
                result[index] = points[index] + side * offset + Vector3.up * .018f;
            }
            return result;
        }

        private static Dictionary<string, Material> LoadTerrainMaterials()
        {
            return new Dictionary<string, Material>
            {
                ["ground"] = LoadOrCreateTerrainMaterial("Ground", Hex("74885C")),
                ["groundDark"] = LoadOrCreateTerrainMaterial("GroundDark", Hex("506344")),
                ["grassLight"] = LoadOrCreateTerrainMaterial("GrassLight", Hex("8DA06E")),
                ["soil"] = LoadOrCreateTerrainMaterial("PackedEarth", Hex("8F7755")),
                ["soilDark"] = LoadOrCreateTerrainMaterial("PackedEarthDark", Hex("5E503D")),
                ["stone"] = LoadOrCreateTerrainMaterial("StoneWarm", Hex("807566")),
                ["stoneDark"] = LoadOrCreateTerrainMaterial("CanopyShadow", Hex("4A463D")),
                ["moss"] = LoadOrCreateTerrainMaterial("Moss", Hex("536A3D")),
                ["leafLight"] = LoadOrCreateTerrainMaterial("LeafLight", Hex("668856")),
                ["warmLight"] = LoadOrCreateTerrainMaterial("WarmLantern", Hex("F1C778"), true)
            };
        }

        private static Material LoadOrCreateTerrainMaterial(string name, Color color, bool emissive = false)
        {
            const string folder = "Assets/Art/World/HighFidelity/Materials";
            var path = $"{folder}/MAT_YW_HF_{name}.mat";
            var existing = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (existing != null)
            {
                ConfigureTerrainMaterial(existing, color, emissive);
                EditorUtility.SetDirty(existing);
                return existing;
            }

            var shader = Shader.Find("Standard")
                ?? throw new InvalidOperationException("The Standard shader is unavailable.");
            var material = new Material(shader)
            {
                name = $"MAT_YW_HF_{name}",
                color = color
            };
            ConfigureTerrainMaterial(material, color, emissive);
            AssetDatabase.CreateAsset(material, path);
            return material;
        }

        private static void ConfigureTerrainMaterial(Material material, Color color, bool emissive)
        {
            material.color = color;
            material.SetFloat("_Mode", 0f);
            material.SetInt("_SrcBlend", (int)BlendMode.One);
            material.SetInt("_DstBlend", (int)BlendMode.Zero);
            material.SetInt("_ZWrite", 1);
            material.SetInt("_Cull", (int)CullMode.Off);
            material.DisableKeyword("_ALPHATEST_ON");
            material.DisableKeyword("_ALPHABLEND_ON");
            material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            material.renderQueue = -1;
            material.SetFloat("_Glossiness", .06f);
            material.mainTexture = null;
            if (emissive)
            {
                material.EnableKeyword("_EMISSION");
                material.SetColor("_EmissionColor", color * .45f);
            }
            else
            {
                material.DisableKeyword("_EMISSION");
                material.SetColor("_EmissionColor", Color.black);
            }
        }

        private static GameObject AddTerrainMesh(
            Transform parent,
            string name,
            Mesh mesh,
            Material material,
            Vector3? position = null,
            Quaternion? rotation = null,
            Vector3? scale = null)
        {
            var item = new GameObject(name);
            item.transform.SetParent(parent, false);
            item.transform.localPosition = position ?? Vector3.zero;
            item.transform.localRotation = rotation ?? Quaternion.identity;
            item.transform.localScale = scale ?? Vector3.one;
            item.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = item.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            return item;
        }

        private static Mesh CreateTerrainRockMesh(string name, int seed)
        {
            var random = new System.Random(seed);
            const int rings = 5;
            const int segments = 9;
            var vertices = new List<Vector3>();
            var uv = new List<Vector2>();
            var triangles = new List<int>();
            for (var ring = 0; ring <= rings; ring++)
            {
                var v = ring / (float)rings;
                var latitude = -Mathf.PI * .5f + v * Mathf.PI;
                for (var segment = 0; segment < segments; segment++)
                {
                    var u = segment / (float)segments;
                    var longitude = u * Mathf.PI * 2f;
                    var noise = .86f + (float)random.NextDouble() * .25f;
                    vertices.Add(new Vector3(
                        Mathf.Cos(latitude) * Mathf.Cos(longitude) * noise,
                        Mathf.Sin(latitude) * (.8f + noise * .2f),
                        Mathf.Cos(latitude) * Mathf.Sin(longitude) * noise));
                    uv.Add(new Vector2(u, v));
                }
            }
            for (var ring = 0; ring < rings; ring++)
            for (var segment = 0; segment < segments; segment++)
            {
                var next = (segment + 1) % segments;
                var a = ring * segments + segment;
                var b = ring * segments + next;
                var c = (ring + 1) * segments + segment;
                var d = (ring + 1) * segments + next;
                triangles.AddRange(new[] { a, d, c, a, b, d });
            }
            return FinalizeTerrainMesh(name, vertices, triangles, uv);
        }

        private static Mesh CreateTerrainLeafMesh(string name, float width, float height, float bend)
        {
            var vertices = new List<Vector3>
            {
                new(-width * .5f, 0f, 0f),
                new(width * .48f, 0f, 0f),
                new(width * .32f, height * .55f, bend * .45f),
                new(0f, height, bend),
                new(-width * .32f, height * .55f, bend * .45f)
            };
            var triangles = new List<int> { 0, 1, 2, 0, 2, 4, 4, 2, 3, 2, 1, 0, 4, 2, 0, 3, 2, 4 };
            var uv = new List<Vector2>
            {
                new(0f, 0f), new(1f, 0f), new(.82f, .55f), new(.5f, 1f), new(.18f, .55f)
            };
            return FinalizeTerrainMesh(name, vertices, triangles, uv);
        }

        private static Mesh CreateTerrainCylinderMesh(string name, float bottomRadius, float topRadius, float height, int segments)
        {
            var vertices = new List<Vector3>();
            var uv = new List<Vector2>();
            var triangles = new List<int>();
            for (var level = 0; level < 2; level++)
            for (var segment = 0; segment < segments; segment++)
            {
                var angle = segment / (float)segments * Mathf.PI * 2f;
                var radius = level == 0 ? bottomRadius : topRadius;
                vertices.Add(new Vector3(Mathf.Cos(angle) * radius, (level - .5f) * height, Mathf.Sin(angle) * radius));
                uv.Add(new Vector2(segment / (float)segments, level));
            }
            for (var segment = 0; segment < segments; segment++)
            {
                var next = (segment + 1) % segments;
                triangles.AddRange(new[] { segment, segments + next, segments + segment, segment, next, segments + next });
            }
            return FinalizeTerrainMesh(name, vertices, triangles, uv);
        }

        private static Mesh FinalizeTerrainMesh(string name, List<Vector3> vertices, List<int> triangles, List<Vector2> uv)
        {
            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return SaveTerrainMesh(mesh, name);
        }

        private static Mesh SaveTerrainMesh(Mesh mesh, string name)
        {
            const string folder = "Assets/Art/World/HighFidelity/Meshes";
            var path = $"{folder}/{name}.asset";
            var existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing != null)
            {
                EditorUtility.CopySerialized(mesh, existing);
                UnityEngine.Object.DestroyImmediate(mesh);
                EditorUtility.SetDirty(existing);
                return existing;
            }
            AssetDatabase.CreateAsset(mesh, path);
            return mesh;
        }

        private static Bounds CalculateTerrainBounds(IEnumerable<Renderer> renderers)
        {
            var available = renderers.Where(renderer => renderer != null && renderer.enabled).ToArray();
            if (available.Length == 0) return new Bounds(Vector3.zero, Vector3.zero);
            var bounds = available[0].bounds;
            foreach (var renderer in available.Skip(1)) bounds.Encapsulate(renderer.bounds);
            return bounds;
        }

        private static void CaptureTerrainReviewFrame(
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
                ValidateTerrainCapture(texture, assetPath);
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

        private static void ValidateTerrainCapture(Texture2D texture, string assetPath)
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
                throw new InvalidOperationException($"Capture integrity failed for {assetPath}: only {samples.Count} sampled colors. Run with a graphics device; do not use -nographics.");
        }

        private static void LogTerrainCaptureDiagnostics(string label, Scene scene, Camera camera, Renderer[] renderers, Bounds bounds)
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

        private static void ClearTerrainChildren(Transform parent)
        {
            for (var index = parent.childCount - 1; index >= 0; index--)
                UnityEngine.Object.DestroyImmediate(parent.GetChild(index).gameObject);
        }

        private static void EnsureTerrainFolders()
        {
            EnsureTerrainFolder("Assets/Art/World/HighFidelity");
            EnsureTerrainFolder("Assets/Art/World/HighFidelity/Materials");
            EnsureTerrainFolder("Assets/Art/World/HighFidelity/Meshes");
            EnsureTerrainFolder("Assets/Art/World/HighFidelity/ReviewCaptures");
            EnsureTerrainFolder("Assets/Prefabs/World/Terrain");
            EnsureTerrainFolder("Assets/Scenes/ArtReview");
        }

        private static void EnsureTerrainFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            var name = Path.GetFileName(path);
            if (string.IsNullOrWhiteSpace(parent) || string.IsNullOrWhiteSpace(name))
                throw new InvalidOperationException($"Invalid asset folder: {path}.");
            EnsureTerrainFolder(parent);
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
