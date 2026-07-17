using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Yuvi720.LearningWorld.Editor
{
    /// <summary>
    /// Builds and reviews one production asset at a time. Unlike the retired bulk
    /// silhouette pass, these assets use dimensional geometry, lit materials,
    /// soft shadows, authored proportions, and close-up validation.
    /// </summary>
    public static partial class HighFidelityWorldAssetBuilder
    {
        public const string CentralTreePrefabPath = "Assets/Prefabs/World/Buildings/PF_YW_CentralLearningTree_Grayscale.prefab";
        public const string CentralTreeReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_CentralTree_HighFidelity.unity";
        public const string CentralTreeCloseupCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/CentralLearningTree-Closeup.png";
        public const string CentralTreeGameplayCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/CentralLearningTree-GameplayScale.png";

        private const string MaterialFolder = "Assets/Art/World/HighFidelity/Materials";
        private const string MeshFolder = "Assets/Art/World/HighFidelity/Meshes";
        private const string TextureFolder = "Assets/Art/World/HighFidelity/Textures";

        private static readonly Color BarkDark = Hex("3A2419");
        private static readonly Color BarkMid = Hex("68432C");
        private static readonly Color BarkLight = Hex("946848");
        private static readonly Color Moss = Hex("536A3D");
        private static readonly Color LeafDeep = Hex("294A35");
        private static readonly Color LeafMid = Hex("3E6B43");
        private static readonly Color LeafLight = Hex("668856");
        private static readonly Color LeafSun = Hex("839B65");
        private static readonly Color DoorWood = Hex("5B3826");
        private static readonly Color StoneWarm = Hex("807566");
        private static readonly Color Glass = Hex("6FA3A4");
        private static readonly Color Ground = Hex("62794B");
        private static readonly Color GroundDark = Hex("3D5238");
        private static readonly Color WarmLight = Hex("F1C778");

        private static Dictionary<string, Material> materials;

        [MenuItem("Yuvi/World Art/High Fidelity/01 Build Central Learning Tree")]
        public static void BuildCentralLearningTree()
        {
            EnsureFolder(MaterialFolder);
            EnsureFolder(MeshFolder);
            EnsureFolder(TextureFolder);
            var textures = BuildTextures();
            materials = BuildMaterials(textures);

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
                root.name = "PF_YW_CentralLearningTree_HighFidelity";
                var landmark = root.GetComponent<LandmarkVisual>()
                    ?? throw new InvalidOperationException("LandmarkVisual contract is missing.");

                Clear(landmark.VisualRoot);
                Clear(landmark.ShadowRoot);
                foreach (var paperLayer in landmark.VisualRoot.GetComponentsInChildren<WorldPaperLayer>(true))
                    UnityEngine.Object.DestroyImmediate(paperLayer);

                var structure = Child(landmark.VisualRoot, "DimensionalStructure");
                var foliage = Child(landmark.VisualRoot, "FoliageCanopy");
                var architecture = Child(landmark.VisualRoot, "LearningEntrance");
                var details = Child(landmark.VisualRoot, "NaturalDetails");

                BuildTreeStructure(structure);
                BuildTreeCanopy(foliage);
                BuildLearningEntrance(architecture);
                BuildNaturalDetails(details);
                BuildContactShadow(landmark.ShadowRoot);
                ConfigureContract(root, landmark);

                var prefab = PrefabUtility.SaveAsPrefabAsset(root, CentralTreePrefabPath);
                if (prefab == null) throw new InvalidOperationException("Could not save the high-fidelity tree prefab.");

                var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(WorldAssetFoundationBuilder.CatalogPath);
                if (catalog != null)
                {
                    catalog.EditorEnsureFoundationEntry(CentralLearningTreeBuilder.AssetId, WorldAssetKind.Landmark, prefab);
                    EditorUtility.SetDirty(catalog);
                }

                AssetDatabase.SaveAssets();
                BuildCentralTreeReviewScene(prefab);
                var issues = ValidateCentralLearningTree();
                if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
                Selection.activeObject = prefab;
                Debug.Log("✅ High-fidelity central learning tree built and validated for close-up review.");
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        [MenuItem("Yuvi/World Art/High Fidelity/Validate Central Learning Tree")]
        public static void ValidateCentralLearningTreeMenu()
        {
            var issues = ValidateCentralLearningTree();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            Debug.Log("✅ High-fidelity central learning tree validation passed.");
        }

        [MenuItem("Yuvi/World Art/High Fidelity/Capture Central Learning Tree Review")]
        public static void CaptureCentralLearningTreeReview()
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(CentralTreeReviewScenePath) == null)
                throw new FileNotFoundException("Central learning tree review scene is missing.", CentralTreeReviewScenePath);

            EditorSceneManager.OpenScene(CentralTreeReviewScenePath, OpenSceneMode.Single);
            var camera = Camera.main ?? throw new InvalidOperationException("The central tree review scene requires a Main Camera.");
            CaptureReviewFrame(camera, CentralTreeCloseupCapturePath, 1600, 1100);

            var originalPosition = camera.transform.position;
            var originalRotation = camera.transform.rotation;
            var originalFieldOfView = camera.fieldOfView;
            camera.transform.position = new Vector3(17.5f, 12.5f, -27f);
            camera.transform.LookAt(new Vector3(0f, 3.8f, 0f));
            camera.fieldOfView = 38f;
            CaptureReviewFrame(camera, CentralTreeGameplayCapturePath, 1600, 900);
            camera.transform.SetPositionAndRotation(originalPosition, originalRotation);
            camera.fieldOfView = originalFieldOfView;

            AssetDatabase.Refresh();
            Debug.Log($"✅ Central tree review captures saved to {CentralTreeCloseupCapturePath} and {CentralTreeGameplayCapturePath}.");
        }

        [MenuItem("Yuvi/World Art/High Fidelity/Rebuild and Capture Central Learning Tree Review")]
        public static void RebuildAndCaptureCentralLearningTreeReview()
        {
            BuildCentralLearningTree();
            CaptureCentralLearningTreeReview();
        }

        private static void CaptureReviewFrame(Camera camera, string assetPath, int width, int height)
        {
            var projectRoot = Path.GetDirectoryName(Application.dataPath)
                ?? throw new InvalidOperationException("The Unity project root could not be resolved.");
            var absolutePath = Path.Combine(projectRoot, assetPath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)
                ?? throw new InvalidOperationException($"Review capture folder is invalid: {assetPath}"));

            var renderTexture = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            var previousTarget = camera.targetTexture;
            var previousActive = RenderTexture.active;
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false, false);
            try
            {
                Shader.WarmupAllShaders();
                camera.targetTexture = renderTexture;
                camera.Render();
                RenderTexture.active = renderTexture;
                texture.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                texture.Apply(false, false);
                ValidateReviewCapture(texture, assetPath);
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

        private static void ValidateReviewCapture(Texture2D texture, string assetPath)
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

        public static List<string> ValidateCentralLearningTree()
        {
            var issues = new List<string>();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(CentralTreePrefabPath);
            if (prefab == null)
            {
                issues.Add("High-fidelity central learning tree prefab is missing.");
                return issues;
            }

            var landmark = prefab.GetComponent<LandmarkVisual>();
            if (landmark == null) issues.Add("Central tree requires LandmarkVisual.");
            if (prefab.GetComponentsInChildren<SpriteRenderer>(true).Length > 0)
                issues.Add("Central tree must not contain flat SpriteRenderer artwork.");

            var renderers = prefab.GetComponentsInChildren<MeshRenderer>(true);
            if (renderers.Length < 35) issues.Add($"Central tree requires at least 35 dimensional mesh parts; found {renderers.Length}.");
            if (Array.Exists(renderers, renderer => renderer.name == "CanopyVolume"))
                issues.Add("Central tree canopy must use layered leaves rather than visible procedural support volumes.");
            var vertexCount = 0;
            foreach (var filter in prefab.GetComponentsInChildren<MeshFilter>(true))
                if (filter.sharedMesh != null) vertexCount += filter.sharedMesh.vertexCount;
            if (vertexCount < 2500) issues.Add($"Central tree silhouette is under-detailed; found {vertexCount} vertices.");
            if (prefab.GetComponentsInChildren<WorldWindElement>(true).Length < 5)
                issues.Add("Central tree requires independently animated foliage groups.");

            var bounds = CalculateBounds(prefab);
            if (bounds.size.y < 9f || bounds.size.x < 8f || bounds.size.z < 3f)
                issues.Add($"Central tree lacks production scale/depth. Bounds: {bounds.size}.");
            if (landmark != null)
            {
                var contractIssues = new List<string>();
                landmark.CollectValidationIssues(contractIssues);
                issues.AddRange(contractIssues);
            }
            return issues;
        }

        private static Dictionary<string, Texture2D> BuildTextures()
        {
            return new Dictionary<string, Texture2D>(StringComparer.Ordinal)
            {
                ["bark"] = TextureAsset("Bark", 160, (x, y) =>
                {
                    var grain = Mathf.PerlinNoise(x * .055f, y * .012f) * .22f;
                    var furrow = Mathf.Pow(Mathf.Abs(Mathf.Sin(x * .19f + Mathf.PerlinNoise(0f, y * .025f) * 4f)), 7f) * .2f;
                    return Color.Lerp(Hex("3B2418"), Hex("956848"), .28f + grain - furrow);
                }),
                ["wood"] = TextureAsset("DoorWood", 160, (x, y) =>
                {
                    var grain = Mathf.PerlinNoise(x * .035f, y * .018f) * .18f;
                    var seam = Mathf.Pow(Mathf.Abs(Mathf.Sin(x * .16f)), 12f) * .16f;
                    return Color.Lerp(Hex("3A2218"), Hex("815239"), .34f + grain - seam);
                }),
                ["leaf"] = TextureAsset("LeafMottle", 128, (x, y) =>
                {
                    var broad = Mathf.PerlinNoise(x * .045f, y * .045f);
                    var fine = Mathf.PerlinNoise(x * .18f + 7f, y * .18f + 4f);
                    var vein = Mathf.Exp(-Mathf.Abs(x - 64f) * .12f) * .16f;
                    return Color.Lerp(Hex("567241"), Hex("A1B77A"), .16f + broad * .48f + fine * .12f + vein);
                }),
                ["moss"] = TextureAsset("Moss", 128, (x, y) =>
                {
                    var noise = Mathf.PerlinNoise(x * .085f, y * .085f);
                    return Color.Lerp(Hex("34452F"), Hex("71804B"), .2f + noise * .66f);
                }),
                ["stone"] = TextureAsset("Stone", 128, (x, y) =>
                {
                    var broad = Mathf.PerlinNoise(x * .04f, y * .04f);
                    var speck = Mathf.PerlinNoise(x * .22f, y * .22f);
                    return Color.Lerp(Hex("5D5851"), Hex("9B9385"), .2f + broad * .46f + speck * .13f);
                }),
                ["ground"] = TextureAsset("Ground", 160, (x, y) =>
                {
                    var broad = Mathf.PerlinNoise(x * .035f, y * .035f);
                    var fine = Mathf.PerlinNoise(x * .19f + 12f, y * .19f + 3f);
                    return Color.Lerp(Hex("35462F"), Hex("71845B"), .18f + broad * .5f + fine * .1f);
                })
            };
        }

        private static Texture2D TextureAsset(string name, int size, Func<float, float, Color> sample)
        {
            var path = $"{TextureFolder}/TEX_YW_HF_{name}.asset";
            var existing = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            var texture = existing != null
                ? existing
                : new Texture2D(size, size, TextureFormat.RGBA32, true, false) { name = $"TEX_YW_HF_{name}" };
            if (texture.width != size || texture.height != size) texture.Reinitialize(size, size);
            var pixels = new Color[size * size];
            for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
                pixels[y * size + x] = sample(x, y);
            texture.SetPixels(pixels);
            texture.wrapMode = TextureWrapMode.Repeat;
            texture.filterMode = FilterMode.Trilinear;
            texture.anisoLevel = 4;
            texture.Apply(true, false);
            if (existing == null) AssetDatabase.CreateAsset(texture, path);
            else EditorUtility.SetDirty(texture);
            return texture;
        }

        private static Dictionary<string, Material> BuildMaterials(IReadOnlyDictionary<string, Texture2D> textures)
        {
            return new Dictionary<string, Material>(StringComparer.Ordinal)
            {
                ["barkDark"] = LitMaterial("BarkDark", BarkDark, .02f, .16f, textures["bark"]),
                ["barkMid"] = LitMaterial("BarkMid", BarkMid, .01f, .20f, textures["bark"]),
                ["barkLight"] = LitMaterial("BarkLight", BarkLight, 0f, .24f, textures["bark"]),
                ["moss"] = LitMaterial("Moss", Moss, 0f, .08f, textures["moss"]),
                ["leafDeep"] = LitMaterial("LeafDeep", LeafDeep, 0f, .18f, textures["leaf"]),
                ["canopyShadow"] = LitMaterial("CanopyShadow", Hex("1F3828"), 0f, .08f, null),
                ["leafMid"] = LitMaterial("LeafMid", LeafMid, 0f, .20f, textures["leaf"]),
                ["leafLight"] = LitMaterial("LeafLight", LeafLight, 0f, .22f, textures["leaf"]),
                ["leafSun"] = LitMaterial("LeafSun", LeafSun, 0f, .24f, textures["leaf"]),
                ["door"] = LitMaterial("DoorWood", DoorWood, 0f, .24f, textures["wood"]),
                ["stone"] = LitMaterial("StoneWarm", StoneWarm, 0f, .12f, textures["stone"]),
                ["glass"] = LitMaterial("Glass", Glass, .05f, .56f, null),
                ["ground"] = LitMaterial("Ground", Ground, 0f, .08f, textures["ground"]),
                ["groundDark"] = LitMaterial("GroundDark", GroundDark, 0f, .06f, textures["ground"]),
                ["grassLight"] = LitMaterial("GrassLight", Hex("7E925E"), 0f, .07f, textures["ground"]),
                ["soil"] = LitMaterial("PackedEarth", Hex("766044"), 0f, .06f, textures["ground"]),
                ["soilDark"] = LitMaterial("PackedEarthDark", Hex("4D4232"), 0f, .05f, textures["ground"]),
                ["warmLight"] = EmissiveMaterial("WarmLantern", WarmLight, .85f),
                ["iron"] = LitMaterial("Iron", Hex("252A28"), .38f, .28f, null)
            };
        }

        private static Material LitMaterial(string name, Color color, float metallic, float smoothness, Texture2D texture)
        {
            var shader = Shader.Find("Standard") ?? throw new InvalidOperationException("Built-in Standard shader is required.");
            var material = new Material(shader)
            {
                name = $"MAT_YW_HF_{name}",
                color = texture != null ? Color.Lerp(Color.white, color, .24f) : color,
                enableInstancing = true
            };
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Glossiness", smoothness);
            material.mainTexture = texture;
            return SaveMaterial(material);
        }

        private static Material EmissiveMaterial(string name, Color color, float intensity)
        {
            var material = LitMaterial(name, color, 0f, .35f, null);
            material.EnableKeyword("_EMISSION");
            material.SetColor("_EmissionColor", color * intensity);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material SaveMaterial(Material generated)
        {
            var path = $"{MaterialFolder}/{generated.name}.mat";
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

        private static void BuildTreeStructure(Transform parent)
        {
            AddPath(parent, "AncientTrunk", new[]
            {
                new Vector3(0f, 0f, 0f), new Vector3(-.18f, 1.5f, .08f),
                new Vector3(.18f, 3.15f, .02f), new Vector3(-.12f, 4.8f, .12f),
                new Vector3(.22f, 6.35f, .04f), new Vector3(.05f, 7.65f, .2f)
            }, new[] { 1.38f, 1.28f, 1.13f, .92f, .68f, .38f }, 18, 11, materials["barkMid"]);

            AddPath(parent, "BarkRidgeLeft", new[]
            {
                new Vector3(-.84f, .18f, -1.02f), new Vector3(-.72f, 1.7f, -1.08f),
                new Vector3(-.55f, 3.5f, -.92f), new Vector3(-.46f, 5.1f, -.72f)
            }, new[] { .16f, .14f, .11f, .04f }, 7, 23, materials["barkLight"]);
            AddPath(parent, "BarkRidgeRight", new[]
            {
                new Vector3(.72f, .28f, -1.08f), new Vector3(.82f, 2.15f, -1.02f),
                new Vector3(.62f, 3.9f, -.84f), new Vector3(.48f, 5.35f, -.58f)
            }, new[] { .13f, .12f, .09f, .035f }, 7, 29, materials["barkLight"]);

            var roots = new[]
            {
                new Vector3(-2.75f, -.02f, -1.45f), new Vector3(-2.5f, .02f, 1.1f),
                new Vector3(-1.05f, .02f, -2.65f), new Vector3(1.2f, .02f, -2.7f),
                new Vector3(2.7f, .02f, -1.3f), new Vector3(2.55f, .02f, 1.15f),
                new Vector3(.8f, .02f, 2.15f), new Vector3(-1.1f, .02f, 2.1f)
            };
            for (var index = 0; index < roots.Length; index++)
            {
                var end = roots[index] * .8f;
                AddPath(parent, $"RootFlare-{index + 1:00}", new[]
                {
                    new Vector3(Mathf.Sign(end.x) * .48f, .62f, Mathf.Sign(end.z) * .38f),
                    end * .24f + new Vector3(0f, .34f, 0f),
                    end * .52f + new Vector3(0f, .15f, 0f),
                    end * .78f + new Vector3(0f, .045f, 0f), end
                }, new[] { .5f, .4f, .27f, .15f, .055f }, 16, 40 + index, index % 3 == 0 ? materials["barkDark"] : materials["barkMid"]);
            }

            var branchData = new[]
            {
                new[] { new Vector3(-.25f, 4.7f, 0f), new Vector3(-1.5f, 5.45f, .1f), new Vector3(-3.0f, 6.1f, .35f), new Vector3(-4.15f, 6.45f, .55f) },
                new[] { new Vector3(.2f, 4.95f, .1f), new Vector3(1.45f, 5.7f, .2f), new Vector3(2.9f, 6.35f, .45f), new Vector3(4.0f, 6.75f, .2f) },
                new[] { new Vector3(-.1f, 5.75f, .25f), new Vector3(-1.35f, 6.65f, 1.25f), new Vector3(-2.25f, 7.5f, 1.85f) },
                new[] { new Vector3(.15f, 6.05f, .1f), new Vector3(1.35f, 7.0f, 1.1f), new Vector3(2.35f, 7.75f, 1.75f) },
                new[] { new Vector3(.05f, 6.7f, -.15f), new Vector3(-.55f, 7.75f, -1.2f), new Vector3(-1.45f, 8.5f, -1.8f) },
                new[] { new Vector3(.12f, 6.55f, -.05f), new Vector3(1.0f, 7.55f, -1.0f), new Vector3(1.75f, 8.25f, -1.7f) }
            };
            for (var index = 0; index < branchData.Length; index++)
            {
                var radii = branchData[index].Length == 4
                    ? new[] { .55f, .38f, .22f, .07f }
                    : new[] { .46f, .25f, .06f };
                AddPath(parent, $"PrimaryBranch-{index + 1:00}", branchData[index], radii, 12, 80 + index, materials["barkMid"]);
            }
        }

        private static void BuildTreeCanopy(Transform parent)
        {
            var clusters = new[]
            {
                new Vector4(-3.85f, 6.65f, .55f, 1.75f), new Vector4(-2.7f, 7.45f, 1.35f, 1.65f),
                new Vector4(-1.45f, 8.35f, -1.2f, 1.75f), new Vector4(-.35f, 8.65f, .55f, 1.95f),
                new Vector4(1.45f, 8.45f, -1.1f, 1.7f), new Vector4(2.55f, 7.75f, 1.3f, 1.75f),
                new Vector4(3.85f, 6.95f, .35f, 1.7f), new Vector4(-2.0f, 6.75f, -1.45f, 1.55f),
                new Vector4(0f, 7.35f, 1.75f, 1.8f), new Vector4(2.0f, 6.8f, -1.55f, 1.5f),
                new Vector4(-1.0f, 7.55f, -.2f, 1.75f), new Vector4(1.1f, 7.5f, .15f, 1.65f),
                new Vector4(-3.0f, 6.2f, -.7f, 1.45f), new Vector4(3.05f, 6.35f, -.75f, 1.45f)
            };
            var palette = new[] { "leafDeep", "leafMid", "leafLight", "leafMid", "leafSun" };
            for (var index = 0; index < clusters.Length; index++)
            {
                var data = clusters[index];
                var pivot = Child(parent, $"CanopyWindPivot-{index + 1:00}");
                pivot.localPosition = new Vector3(data.x, data.y, data.z);
                var scale = new Vector3(data.w * (1.02f + index % 3 * .08f), data.w * (.7f + index % 2 * .08f), data.w * .8f);
                var clusterMaterial = materials[palette[index % palette.Length]];
                AddMesh(pivot, "InnerLeaves", MeshAsset($"TreeInnerLeaves-{index:00}", () =>
                        CreateLeafClusterMesh(Vector3.Scale(scale, new Vector3(.7f, .68f, .72f)), 120 + index, 58 + index % 3 * 6, .04f, .9f, 1.08f)),
                    materials[index % 4 == 0 ? "leafMid" : "leafDeep"], Vector3.zero,
                    Quaternion.Euler(index * 3f, index * 19f, 0f), Vector3.one);
                AddMesh(pivot, "LeafCrown", MeshAsset($"TreeLeafCrown-{index:00}", () =>
                        CreateLeafClusterMesh(scale, 220 + index, 118 + index % 3 * 10, .2f, 1f, 1f)),
                    clusterMaterial, Vector3.zero, Quaternion.Euler(index * 5f, index * 13f, 0f), Vector3.one);
                pivot.gameObject.AddComponent<WorldWindElement>().EditorAssignContract(
                    pivot, Vector3.forward, .72f + index % 3 * .18f, .18f + index % 4 * .025f, index * .63f, true);
            }

            for (var index = 0; index < 10; index++)
            {
                var angle = index / 10f * Mathf.PI * 2f;
                var pivot = Child(parent, $"OuterTwig-{index + 1:00}");
                pivot.localPosition = new Vector3(Mathf.Cos(angle) * 4.35f, 6.75f + Mathf.Sin(angle * 2f) * .5f, Mathf.Sin(angle) * 1.2f);
                AddPath(pivot, "Twig", new[] { Vector3.zero, new Vector3(Mathf.Cos(angle) * .9f, .15f, Mathf.Sin(angle) * .4f) },
                    new[] { .09f, .025f }, 8, 170 + index, materials["barkDark"]);
                AddMesh(pivot, "TwigLeaves", MeshAsset($"TreeTwigLeaves-{index:00}", () =>
                    CreateLeafClusterMesh(new Vector3(.48f, .3f, .32f), 180 + index, 18, .12f, 1f, .92f)),
                    materials[palette[(index + 1) % palette.Length]], new Vector3(Mathf.Cos(angle) * .86f, .16f, Mathf.Sin(angle) * .38f),
                    Quaternion.Euler(0f, index * 27f, 0f), Vector3.one);
            }
        }

        private static void BuildLearningEntrance(Transform parent)
        {
            AddMesh(parent, "Recess", MeshAsset("TreeDoorRecess", () => CreateArchPrismMesh(1.15f, 2.45f, .32f, 14)),
                materials["barkDark"], new Vector3(0f, 1.38f, -1.16f), Quaternion.identity, Vector3.one);
            AddMesh(parent, "ArchedDoor", MeshAsset("TreeArchedDoor", () => CreateArchPrismMesh(.94f, 2.2f, .18f, 14)),
                materials["door"], new Vector3(0f, 1.35f, -1.37f), Quaternion.identity, Vector3.one);

            var archStone = MeshAsset("ArchStoneBlock", () => CreateBoxMesh(new Vector3(.2f, .135f, .13f)));
            for (var side = -1; side <= 1; side += 2)
            {
                for (var index = 0; index < 6; index++)
                {
                    AddMesh(parent, $"ArchSide-{side}-{index + 1:00}", archStone,
                        materials["stone"],
                        new Vector3(side * 1.14f, .55f + index * .34f, -1.53f),
                        Quaternion.Euler(side * 1.5f, index * 1.2f, side * (index % 2 == 0 ? 2f : -1.5f)),
                        new Vector3(1f + index % 2 * .08f, 1f, 1f));
                }
            }
            for (var index = 0; index < 13; index++)
            {
                var t = index / 12f;
                var angle = Mathf.Lerp(180f, 0f, t) * Mathf.Deg2Rad;
                var x = Mathf.Cos(angle) * 1.14f;
                var y = 2.31f + Mathf.Sin(angle) * 1.14f;
                AddMesh(parent, $"ArchCrown-{index + 1:00}", archStone,
                    materials["stone"],
                    new Vector3(x, y, -1.53f), Quaternion.Euler(0f, 0f, angle * Mathf.Rad2Deg - 90f),
                    new Vector3(1f, 1f + index % 2 * .05f, 1f));
            }

            for (var index = 0; index < 5; index++)
            {
                AddMesh(parent, $"DoorGroove-{index + 1:00}", MeshAsset("DoorGroove", () => CreateBoxMesh(new Vector3(.012f, .72f, .014f))),
                    materials["barkDark"], new Vector3(-.54f + index * .27f, 1.02f, -1.57f), Quaternion.Euler(0f, 0f, index % 2 == 0 ? .65f : -.5f), Vector3.one);
            }

            AddMesh(parent, "DoorRing", MeshAsset("DoorRing", () => CreateTorusMesh(.13f, .035f, 14, 7)),
                materials["iron"], new Vector3(.48f, 1.22f, -1.64f), Quaternion.Euler(90f, 0f, 0f), Vector3.one);

            BuildRoundWindow(parent, "WindowLeft", new Vector3(-.82f, 4.28f, -.93f), .3f);

            var lanternHook = Child(parent, "LanternHook");
            lanternHook.localPosition = new Vector3(1.48f, 2.55f, -1.22f);
            AddPath(lanternHook, "IronBracket", new[] { Vector3.zero, new Vector3(.42f, .12f, -.12f), new Vector3(.42f, -.32f, -.12f) },
                new[] { .045f, .04f, .035f }, 8, 250, materials["iron"]);
            AddMesh(lanternHook, "Lantern", MeshAsset("TreeLantern", () => CreateOrganicBlobMesh(new Vector3(.24f, .34f, .2f), 255, 7, 9)),
                materials["warmLight"], new Vector3(.42f, -.5f, -.12f), Quaternion.identity, Vector3.one);
        }

        private static void BuildRoundWindow(Transform parent, string name, Vector3 position, float radius)
        {
            AddMesh(parent, $"{name}Frame", MeshAsset($"{name}Frame", () => CreateTorusMesh(radius, .08f, 20, 8)),
                materials["barkLight"], position, Quaternion.Euler(90f, 0f, 0f), Vector3.one);
            AddMesh(parent, $"{name}Glass", MeshAsset($"{name}Glass", () => CreateCylinderMesh(radius * .82f, .055f, 20)),
                materials["glass"], position + new Vector3(0f, 0f, -.035f), Quaternion.Euler(90f, 0f, 0f), Vector3.one);
            AddMesh(parent, $"{name}MullionV", MeshAsset("WindowMullionV", () => CreateBoxMesh(new Vector3(.035f, .35f, .025f))),
                materials["iron"], position + new Vector3(0f, 0f, -.085f), Quaternion.identity, Vector3.one);
            AddMesh(parent, $"{name}MullionH", MeshAsset("WindowMullionH", () => CreateBoxMesh(new Vector3(.35f, .035f, .025f))),
                materials["iron"], position + new Vector3(0f, 0f, -.085f), Quaternion.identity, Vector3.one);
        }

        private static void BuildNaturalDetails(Transform parent)
        {
            for (var index = 0; index < 9; index++)
            {
                var angle = index / 9f * Mathf.PI * 2f + .25f;
                var radius = 1.55f + index % 3 * .28f;
                var rock = MeshAsset($"TreeGroundRock-{index:00}", () => CreateOrganicBlobMesh(
                    new Vector3(.3f + index % 2 * .1f, .18f + index % 3 * .04f, .25f), 300 + index, 6, 8));
                AddMesh(parent, $"GroundStone-{index + 1:00}", rock, index % 2 == 0 ? materials["stone"] : materials["groundDark"],
                    new Vector3(Mathf.Cos(angle) * radius, .12f, Mathf.Sin(angle) * radius), Quaternion.Euler(0f, index * 31f, 0f), Vector3.one);
            }

            for (var index = 0; index < 7; index++)
            {
                var tuft = Child(parent, $"GrassTuft-{index + 1:00}");
                var angle = index * 2.3f;
                tuft.localPosition = new Vector3(Mathf.Cos(angle) * (2.0f + index % 2 * .45f), .03f, Mathf.Sin(angle) * (1.65f + index % 3 * .2f));
                for (var blade = 0; blade < 5; blade++)
                {
                    var lean = new Vector3((blade - 2) * .06f, .45f + blade % 2 * .12f, (blade % 3 - 1) * .05f);
                    AddPath(tuft, $"Blade-{blade + 1:00}", new[] { Vector3.zero, lean }, new[] { .035f, .008f }, 6,
                        340 + index * 5 + blade, blade % 2 == 0 ? materials["leafMid"] : materials["leafLight"]);
                }
            }

            AddMesh(parent, "MossPatchLeft", MeshAsset("MossPatchLeft", () => CreateOrganicBlobMesh(new Vector3(.75f, .14f, .46f), 390, 6, 10)),
                materials["moss"], new Vector3(-.9f, 2.55f, -1.08f), Quaternion.Euler(12f, -20f, -8f), Vector3.one);
        }

        private static void BuildContactShadow(Transform parent)
        {
            AddMesh(parent, "SoftContactShadow", MeshAsset("TreeContactShadow", () => CreateDiscMesh(3.35f, 36, .14f)),
                materials["groundDark"], new Vector3(0f, .015f, .15f), Quaternion.Euler(-90f, 0f, 0f), new Vector3(1f, .58f, 1f));
        }

        private static void ConfigureContract(GameObject root, LandmarkVisual landmark)
        {
            var obstacle = root.transform.Find("ObstacleFootprint");
            if (obstacle == null)
            {
                obstacle = Child(root.transform, "ObstacleFootprint");
                obstacle.gameObject.AddComponent<BoxCollider>();
            }
            var obstacleCollider = obstacle.GetComponent<BoxCollider>() ?? obstacle.gameObject.AddComponent<BoxCollider>();
            obstacleCollider.center = new Vector3(0f, 1.45f, .15f);
            obstacleCollider.size = new Vector3(2.45f, 2.9f, 2.35f);
            obstacleCollider.isTrigger = false;

            if (landmark.InteractionCollider is BoxCollider interaction)
            {
                interaction.isTrigger = true;
                interaction.center = new Vector3(0f, 4.4f, 0f);
                interaction.size = new Vector3(9.5f, 9.5f, 6f);
            }
            landmark.InteractionAnchor.localPosition = new Vector3(0f, 4.8f, -1.5f);
            landmark.ApproachAnchor.localPosition = new Vector3(0f, 0f, -4.1f);
            landmark.FocusAnchor.localPosition = new Vector3(0f, 4.75f, 0f);
        }

        private static void BuildCentralTreeReviewScene(GameObject prefab)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Hex("A9B7C0");
            RenderSettings.ambientEquatorColor = Hex("56665D");
            RenderSettings.ambientGroundColor = Hex("27342A");
            RenderSettings.reflectionIntensity = .45f;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = Hex("A8B4AA");
            RenderSettings.fogStartDistance = 40f;
            RenderSettings.fogEndDistance = 90f;
            QualitySettings.shadowCascades = 1;

            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = false;
            camera.fieldOfView = 34f;
            camera.nearClipPlane = .1f;
            camera.farClipPlane = 120f;
            camera.allowHDR = true;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Hex("A8B4AA");
            cameraObject.transform.position = new Vector3(12.4f, 7.4f, -17.8f);
            cameraObject.transform.LookAt(new Vector3(0f, 4.35f, 0f));

            var sunObject = new GameObject("Directional Key Light");
            var sun = sunObject.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = Hex("FFE5BD");
            sun.intensity = 1.12f;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = .72f;
            sun.shadowBias = .035f;
            sunObject.transform.rotation = Quaternion.Euler(42f, -38f, 0f);

            var fillObject = new GameObject("Cool Fill Light");
            var fill = fillObject.AddComponent<Light>();
            fill.type = LightType.Point;
            fill.color = Hex("91B8C7");
            fill.intensity = 2.1f;
            fill.range = 22f;
            fill.shadows = LightShadows.None;
            fillObject.transform.position = new Vector3(-8f, 6f, -6f);

            var rimObject = new GameObject("Warm Rim Light");
            var rim = rimObject.AddComponent<Light>();
            rim.type = LightType.Point;
            rim.color = Hex("F5B96B");
            rim.intensity = 1.6f;
            rim.range = 18f;
            rim.shadows = LightShadows.None;
            rimObject.transform.position = new Vector3(7f, 8f, 5f);

            var environment = new GameObject("ReviewEnvironment").transform;
            AddMesh(environment, "Ground", MeshAsset("HFReviewGroundGrid", () => CreateGroundGridMesh(30f, 28, .055f, 610)),
                materials["ground"], new Vector3(0f, -.06f, 0f), Quaternion.identity, Vector3.one);

            var tree = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            tree.name = "CentralLearningTree_HighFidelityReview";
            tree.transform.position = Vector3.zero;
            var landmark = tree.GetComponent<LandmarkVisual>();
            if (landmark != null) landmark.StateRoot.gameObject.SetActive(false);

            var systems = new GameObject("WorldSystems");
            systems.AddComponent<WorldMotionController>().Configure(tree.transform, false, false);

            EditorSceneManager.SaveScene(scene, CentralTreeReviewScenePath);
            AssetDatabase.SaveAssets();
        }

        private static GameObject AddMesh(Transform parent, string name, Mesh mesh, Material material, Vector3 position, Quaternion rotation, Vector3 scale)
        {
            var item = new GameObject(name);
            item.transform.SetParent(parent, false);
            item.transform.localPosition = position;
            item.transform.localRotation = rotation;
            item.transform.localScale = scale;
            item.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = item.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            renderer.lightProbeUsage = LightProbeUsage.BlendProbes;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.BlendProbes;
            return item;
        }

        private static void AddPath(Transform parent, string name, IReadOnlyList<Vector3> points, IReadOnlyList<float> radii, int sides, int seed, Material material)
        {
            AddMesh(parent, name, MeshAsset(name + "-" + seed, () => CreatePathMesh(points, radii, sides, seed)),
                material, Vector3.zero, Quaternion.identity, Vector3.one);
        }

        private static Mesh MeshAsset(string name, Func<Mesh> factory)
        {
            var safeName = Sanitize(name);
            var path = $"{MeshFolder}/MESH_YW_HF_{safeName}.asset";
            var generated = factory();
            generated.name = $"MESH_YW_HF_{safeName}";
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

        private static Mesh CreatePathMesh(IReadOnlyList<Vector3> centers, IReadOnlyList<float> radii, int sides, int seed)
        {
            if (centers.Count != radii.Count || centers.Count < 2) throw new ArgumentException("Path centers/radii are invalid.");
            var ringCount = centers.Count;
            var vertices = new Vector3[ringCount * sides + 2];
            var uv = new Vector2[vertices.Length];
            for (var ring = 0; ring < ringCount; ring++)
            {
                var tangent = ring == 0 ? centers[1] - centers[0]
                    : ring == ringCount - 1 ? centers[ring] - centers[ring - 1]
                    : centers[ring + 1] - centers[ring - 1];
                tangent.Normalize();
                var reference = Mathf.Abs(Vector3.Dot(tangent, Vector3.up)) > .88f ? Vector3.forward : Vector3.up;
                var right = Vector3.Cross(tangent, reference).normalized;
                var forward = Vector3.Cross(right, tangent).normalized;
                for (var side = 0; side < sides; side++)
                {
                    var angle = side / (float)sides * Mathf.PI * 2f;
                    var irregularity = 1f + Mathf.Sin(seed * .73f + ring * 1.91f + side * 2.17f) * .065f;
                    vertices[ring * sides + side] = centers[ring]
                        + (right * Mathf.Cos(angle) + forward * Mathf.Sin(angle)) * radii[ring] * irregularity;
                    uv[ring * sides + side] = new Vector2(side / (float)sides, ring / (float)(ringCount - 1));
                }
            }
            var startCenter = ringCount * sides;
            var endCenter = startCenter + 1;
            vertices[startCenter] = centers[0];
            vertices[endCenter] = centers[ringCount - 1];
            var triangles = new List<int>((ringCount - 1) * sides * 6 + sides * 6);
            for (var ring = 0; ring < ringCount - 1; ring++)
            {
                for (var side = 0; side < sides; side++)
                {
                    var next = (side + 1) % sides;
                    var a = ring * sides + side;
                    var b = ring * sides + next;
                    var c = (ring + 1) * sides + side;
                    var d = (ring + 1) * sides + next;
                    triangles.Add(a); triangles.Add(c); triangles.Add(b);
                    triangles.Add(b); triangles.Add(c); triangles.Add(d);
                }
            }
            for (var side = 0; side < sides; side++)
            {
                var next = (side + 1) % sides;
                triangles.Add(startCenter); triangles.Add(next); triangles.Add(side);
                var last = (ringCount - 1) * sides;
                triangles.Add(endCenter); triangles.Add(last + side); triangles.Add(last + next);
            }
            return FinalizeMesh(vertices, triangles.ToArray(), uv);
        }

        private static Mesh CreateOrganicBlobMesh(Vector3 scale, int seed, int rings, int segments)
        {
            var vertices = new Vector3[(rings + 1) * (segments + 1)];
            var uv = new Vector2[vertices.Length];
            for (var ring = 0; ring <= rings; ring++)
            {
                var v = ring / (float)rings;
                var phi = v * Mathf.PI;
                for (var segment = 0; segment <= segments; segment++)
                {
                    var u = segment / (float)segments;
                    var theta = u * Mathf.PI * 2f;
                    var noise = 1f
                        + Mathf.Sin(theta * 3f + seed * .31f) * .075f
                        + Mathf.Sin(phi * 4f + theta * 2f + seed * .19f) * .055f;
                    var direction = new Vector3(Mathf.Sin(phi) * Mathf.Cos(theta), Mathf.Cos(phi), Mathf.Sin(phi) * Mathf.Sin(theta));
                    vertices[ring * (segments + 1) + segment] = Vector3.Scale(direction, scale) * noise;
                    uv[ring * (segments + 1) + segment] = new Vector2(u, v);
                }
            }
            var triangles = new List<int>(rings * segments * 6);
            for (var ring = 0; ring < rings; ring++)
            {
                for (var segment = 0; segment < segments; segment++)
                {
                    var a = ring * (segments + 1) + segment;
                    var b = a + segments + 1;
                    triangles.Add(a); triangles.Add(b); triangles.Add(a + 1);
                    triangles.Add(a + 1); triangles.Add(b); triangles.Add(b + 1);
                }
            }
            return FinalizeMesh(vertices, triangles.ToArray(), uv);
        }

        private static Mesh CreateLeafClusterMesh(
            Vector3 scale,
            int seed,
            int leafCount,
            float minimumRadius = .34f,
            float maximumRadius = .98f,
            float leafSize = 1f)
        {
            const int verticesPerLeaf = 12;
            var vertices = new Vector3[leafCount * verticesPerLeaf];
            var uv = new Vector2[vertices.Length];
            var triangles = new List<int>(leafCount * 24);
            for (var leaf = 0; leaf < leafCount; leaf++)
            {
                var azimuth = Hash01(seed, leaf, 1) * Mathf.PI * 2f;
                var elevation = Mathf.Asin(Hash01(seed, leaf, 2) * 2f - 1f);
                var direction = new Vector3(
                    Mathf.Cos(elevation) * Mathf.Cos(azimuth),
                    Mathf.Sin(elevation),
                    Mathf.Cos(elevation) * Mathf.Sin(azimuth));
                var radius = Mathf.Lerp(minimumRadius, maximumRadius, Mathf.Pow(Hash01(seed, leaf, 3), .72f));
                var position = Vector3.Scale(direction, scale) * radius;
                position.y += Mathf.Sin(azimuth * 2f + seed) * .08f;

                var normal = Vector3.Scale(direction, new Vector3(
                    1f / Mathf.Max(.01f, scale.x),
                    1f / Mathf.Max(.01f, scale.y),
                    1f / Mathf.Max(.01f, scale.z))).normalized;
                normal = Vector3.Slerp(normal, Vector3.back, .24f).normalized;
                var right = Vector3.Cross(normal, Vector3.up);
                if (right.sqrMagnitude < .01f) right = Vector3.Cross(normal, Vector3.forward);
                right.Normalize();
                var up = Vector3.Cross(right, normal).normalized;
                var rotation = Hash01(seed, leaf, 4) * Mathf.PI * 2f;
                var rotatedRight = right * Mathf.Cos(rotation) + up * Mathf.Sin(rotation);
                var rotatedUp = -right * Mathf.Sin(rotation) + up * Mathf.Cos(rotation);
                var length = Mathf.Lerp(.28f, .48f, Hash01(seed, leaf, 5)) * leafSize;
                var width = length * Mathf.Lerp(.4f, .56f, Hash01(seed, leaf, 6));
                var cup = Mathf.Lerp(.012f, .03f, Hash01(seed, leaf, 7));

                var shape = new[]
                {
                    position - rotatedUp * length * .52f,
                    position - rotatedUp * length * .2f - rotatedRight * width * .42f,
                    position + rotatedUp * length * .1f - rotatedRight * width * .55f + normal * cup,
                    position + rotatedUp * length * .55f,
                    position + rotatedUp * length * .1f + rotatedRight * width * .55f + normal * cup,
                    position - rotatedUp * length * .2f + rotatedRight * width * .42f
                };
                var baseVertex = leaf * verticesPerLeaf;
                for (var index = 0; index < 6; index++)
                {
                    vertices[baseVertex + index] = shape[index] + normal * .004f;
                    vertices[baseVertex + index + 6] = shape[index] - normal * .004f;
                    var leafUv = index switch
                    {
                        0 => new Vector2(.5f, 0f), 1 => new Vector2(.08f, .3f),
                        2 => new Vector2(0f, .62f), 3 => new Vector2(.5f, 1f),
                        4 => new Vector2(1f, .62f), _ => new Vector2(.92f, .3f)
                    };
                    uv[baseVertex + index] = uv[baseVertex + index + 6] = leafUv;
                }
                for (var index = 1; index < 5; index++)
                {
                    triangles.Add(baseVertex); triangles.Add(baseVertex + index); triangles.Add(baseVertex + index + 1);
                    triangles.Add(baseVertex + 6); triangles.Add(baseVertex + index + 7); triangles.Add(baseVertex + index + 6);
                }
            }
            return FinalizeMesh(vertices, triangles.ToArray(), uv);
        }

        private static float Hash01(int seed, int index, int channel)
        {
            unchecked
            {
                uint value = (uint)(seed * 73856093) ^ (uint)(index * 19349663) ^ (uint)(channel * 83492791);
                value ^= value >> 13;
                value *= 1274126177u;
                value ^= value >> 16;
                return (value & 0x00FFFFFFu) / 16777215f;
            }
        }

        private static Mesh CreateArchPrismMesh(float halfWidth, float height, float depth, int archSegments)
        {
            var springY = height - halfWidth;
            var outline = new List<Vector2> { new Vector2(-halfWidth, 0f), new Vector2(halfWidth, 0f), new Vector2(halfWidth, springY) };
            for (var index = 0; index <= archSegments; index++)
            {
                var angle = index / (float)archSegments * Mathf.PI;
                outline.Add(new Vector2(Mathf.Cos(angle) * halfWidth, springY + Mathf.Sin(angle) * halfWidth));
            }
            outline.Add(new Vector2(-halfWidth, springY));
            return CreateExtrudedPolygonMesh(outline, depth);
        }

        private static Mesh CreateExtrudedPolygonMesh(IReadOnlyList<Vector2> outline, float depth)
        {
            var count = outline.Count;
            var vertices = new Vector3[count * 2];
            var uv = new Vector2[count * 2];
            for (var index = 0; index < count; index++)
            {
                vertices[index] = new Vector3(outline[index].x, outline[index].y, -depth * .5f);
                vertices[index + count] = new Vector3(outline[index].x, outline[index].y, depth * .5f);
                uv[index] = uv[index + count] = outline[index];
            }
            var triangles = new List<int>();
            for (var index = 1; index < count - 1; index++)
            {
                triangles.Add(0); triangles.Add(index + 1); triangles.Add(index);
                triangles.Add(count); triangles.Add(count + index); triangles.Add(count + index + 1);
            }
            for (var index = 0; index < count; index++)
            {
                var next = (index + 1) % count;
                triangles.Add(index); triangles.Add(next); triangles.Add(index + count);
                triangles.Add(next); triangles.Add(next + count); triangles.Add(index + count);
            }
            return FinalizeMesh(vertices, triangles.ToArray(), uv);
        }

        private static Mesh CreateBoxMesh(Vector3 halfExtents)
        {
            var x = halfExtents.x; var y = halfExtents.y; var z = halfExtents.z;
            var vertices = new[]
            {
                new Vector3(-x,-y,-z), new Vector3(x,-y,-z), new Vector3(x,y,-z), new Vector3(-x,y,-z),
                new Vector3(-x,-y,z), new Vector3(x,-y,z), new Vector3(x,y,z), new Vector3(-x,y,z)
            };
            var triangles = new[]
            {
                0,2,1, 0,3,2, 5,6,4, 6,7,4, 4,7,0, 7,3,0,
                1,2,5, 2,6,5, 3,7,2, 7,6,2, 4,0,5, 0,1,5
            };
            return FinalizeMesh(vertices, triangles, new Vector2[vertices.Length]);
        }

        private static Mesh CreateCylinderMesh(float radius, float depth, int segments)
        {
            var centers = new[] { new Vector3(0f, -depth * .5f, 0f), new Vector3(0f, depth * .5f, 0f) };
            return CreatePathMesh(centers, new[] { radius, radius }, segments, 501);
        }

        private static Mesh CreateTorusMesh(float majorRadius, float minorRadius, int majorSegments, int minorSegments)
        {
            var vertices = new Vector3[(majorSegments + 1) * (minorSegments + 1)];
            var uv = new Vector2[vertices.Length];
            for (var major = 0; major <= majorSegments; major++)
            {
                var u = major / (float)majorSegments;
                var majorAngle = u * Mathf.PI * 2f;
                for (var minor = 0; minor <= minorSegments; minor++)
                {
                    var v = minor / (float)minorSegments;
                    var minorAngle = v * Mathf.PI * 2f;
                    var radial = majorRadius + Mathf.Cos(minorAngle) * minorRadius;
                    vertices[major * (minorSegments + 1) + minor] = new Vector3(
                        Mathf.Cos(majorAngle) * radial, Mathf.Sin(minorAngle) * minorRadius, Mathf.Sin(majorAngle) * radial);
                    uv[major * (minorSegments + 1) + minor] = new Vector2(u, v);
                }
            }
            var triangles = new List<int>();
            for (var major = 0; major < majorSegments; major++)
            for (var minor = 0; minor < minorSegments; minor++)
            {
                var a = major * (minorSegments + 1) + minor;
                var b = a + minorSegments + 1;
                triangles.Add(a); triangles.Add(b); triangles.Add(a + 1);
                triangles.Add(a + 1); triangles.Add(b); triangles.Add(b + 1);
            }
            return FinalizeMesh(vertices, triangles.ToArray(), uv);
        }

        private static Mesh CreateDiscMesh(float radius, int segments, float irregularity)
        {
            var vertices = new Vector3[segments + 1];
            var uv = new Vector2[segments + 1];
            var triangles = new int[segments * 3];
            vertices[0] = Vector3.zero;
            uv[0] = new Vector2(.5f, .5f);
            for (var index = 0; index < segments; index++)
            {
                var angle = index / (float)segments * Mathf.PI * 2f;
                var adjusted = radius * (1f + Mathf.Sin(index * 2.31f) * irregularity);
                vertices[index + 1] = new Vector3(Mathf.Cos(angle) * adjusted, Mathf.Sin(angle) * adjusted, 0f);
                uv[index + 1] = new Vector2(Mathf.Cos(angle) * .5f + .5f, Mathf.Sin(angle) * .5f + .5f);
                triangles[index * 3] = 0;
                triangles[index * 3 + 1] = index + 1;
                triangles[index * 3 + 2] = (index + 1) % segments + 1;
            }
            return FinalizeMesh(vertices, triangles, uv);
        }

        private static Mesh CreateGroundGridMesh(float size, int resolution, float heightVariation, int seed)
        {
            var row = resolution + 1;
            var vertices = new Vector3[row * row];
            var uv = new Vector2[vertices.Length];
            for (var z = 0; z <= resolution; z++)
            for (var x = 0; x <= resolution; x++)
            {
                var u = x / (float)resolution;
                var v = z / (float)resolution;
                var px = (u - .5f) * size;
                var pz = (v - .5f) * size;
                var edgeFade = Mathf.Clamp01(Mathf.Min(Mathf.Min(u, 1f - u), Mathf.Min(v, 1f - v)) * 8f);
                var height = (Mathf.PerlinNoise(x * .19f + seed, z * .19f + seed * .37f) - .5f)
                    * heightVariation * edgeFade;
                vertices[z * row + x] = new Vector3(px, height, pz);
                uv[z * row + x] = new Vector2(u * 5f, v * 5f);
            }
            var triangles = new int[resolution * resolution * 6];
            var triangle = 0;
            for (var z = 0; z < resolution; z++)
            for (var x = 0; x < resolution; x++)
            {
                var a = z * row + x;
                var b = a + 1;
                var c = a + row;
                var d = c + 1;
                triangles[triangle++] = a; triangles[triangle++] = c; triangles[triangle++] = b;
                triangles[triangle++] = b; triangles[triangle++] = c; triangles[triangle++] = d;
            }
            return FinalizeMesh(vertices, triangles, uv);
        }

        private static Mesh FinalizeMesh(Vector3[] vertices, int[] triangles, Vector2[] uv)
        {
            var mesh = new Mesh { indexFormat = vertices.Length > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.uv = uv;
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Bounds CalculateBounds(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return new Bounds(root.transform.position, Vector3.zero);
            var bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index++) bounds.Encapsulate(renderers[index].bounds);
            return bounds;
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

        private static void EnsureFolder(string path)
        {
            var parts = path.Split('/');
            var current = parts[0];
            for (var index = 1; index < parts.Length; index++)
            {
                var next = current + "/" + parts[index];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[index]);
                current = next;
            }
        }

        private static string Sanitize(string value)
        {
            foreach (var character in System.IO.Path.GetInvalidFileNameChars()) value = value.Replace(character, '_');
            return value.Replace(' ', '_').Replace('/', '_').Replace('\\', '_');
        }

        private static Color Hex(string value)
        {
            if (!ColorUtility.TryParseHtmlString("#" + value, out var color)) return Color.magenta;
            return color;
        }
    }
}
