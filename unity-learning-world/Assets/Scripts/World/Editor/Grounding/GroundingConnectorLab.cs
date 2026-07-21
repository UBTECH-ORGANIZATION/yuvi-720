using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Yuvi720.LearningWorld.Editor.Grounding
{
    /// <summary>
    /// Isolated lab to iterate one connector at a time before wiring it into the world:
    /// builds the stone stair, plank bridge, and paved path on a neutral pad, lights them,
    /// and captures a review frame.
    /// </summary>
    public static class GroundingConnectorLab
    {
        private const string ScenePath = "Assets/Scenes/ArtReview/Grounding/SCN_YW_Connector_Lab.unity";
        private const string CaptureFolder = "Assets/Art/World/HighFidelity/ReviewCaptures/ConnectorLab";

        [MenuItem("Yuvi/World Art/Grounding/Lab 01 - Build Connector Kit")]
        public static void BuildConnectorKit()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var stone = GroundingAssetWriter.GetConnectorMaterial("MAT_YW_Connector_Stone", Hex("BCB4A1"));
            var stoneTrim = GroundingAssetWriter.GetConnectorMaterial("MAT_YW_Connector_StoneTrim", Hex("D6CFBD"));
            var timber = GroundingAssetWriter.GetConnectorMaterial("MAT_YW_Connector_Timber", Hex("8A6A46"));
            var timberTrim = GroundingAssetWriter.GetConnectorMaterial("MAT_YW_Connector_TimberTrim", Hex("6E5334"));
            var cobble = GroundingAssetWriter.GetConnectorMaterial("MAT_YW_Connector_Cobble", Hex("AAA290"));
            var grass = GroundingAssetWriter.GetConnectorMaterial("MAT_YW_Connector_Pad", Hex("8C9A57"));

            // Neutral pad.
            var pad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            pad.name = "Pad";
            pad.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
            pad.transform.localScale = new Vector3(40f, 40f, 1f);
            pad.GetComponent<MeshRenderer>().sharedMaterial = grass;
            Object.DestroyImmediate(pad.GetComponent<Collider>());

            var stair = GroundingConnectorBuilder.CreateStoneStair("Lab_Stair", new Vector3(-7f, 0f, -3f), new Vector3(-7f, 3.0f, 3f), 3.2f);
            Place(stair, stone, stoneTrim, "StoneStair");

            var bridge = GroundingConnectorBuilder.CreatePlankBridge("Lab_Bridge", new Vector3(0f, 1.4f, -4f), new Vector3(0f, 1.4f, 4f), 2.8f);
            Place(bridge, timber, timberTrim, "PlankBridge");

            var path = GroundingConnectorBuilder.CreatePavedPath("Lab_Path", new Vector3(7f, 0f, -4f), new Vector3(7f, 0.5f, 4f), 2.6f);
            Place(path, cobble, stoneTrim, "PavedPath");

            BuildStageLighting();
            Directory.CreateDirectory(AbsoluteFolder());
            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("✅ Connector lab built: stone stair, plank bridge, paved path.");
        }

        [MenuItem("Yuvi/World Art/Grounding/Lab 02 - Capture Connector Kit")]
        public static void CaptureConnectorKit()
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(ScenePath) == null) BuildConnectorKit();
            else EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var camera = Camera.main;
            if (camera == null) { BuildStageLighting(); camera = Camera.main; }

            camera.transform.SetPositionAndRotation(new Vector3(0f, 7.5f, -13f), Quaternion.Euler(32f, 0f, 0f));
            camera.orthographic = false; camera.fieldOfView = 42f;
            Capture(camera, $"{CaptureFolder}/00-Connector-Kit.png", 1700, 1000);

            camera.transform.SetPositionAndRotation(new Vector3(-7f, 5.2f, -9.5f), Quaternion.Euler(30f, 0f, 0f));
            Capture(camera, $"{CaptureFolder}/01-Stone-Stair.png", 1400, 1000);

            camera.transform.SetPositionAndRotation(new Vector3(0f, 5.6f, -10.5f), Quaternion.Euler(26f, 0f, 0f));
            Capture(camera, $"{CaptureFolder}/02-Plank-Bridge.png", 1400, 1000);

            AssetDatabase.Refresh();
            Debug.Log("✅ Connector lab captures saved.");
        }

        [MenuItem("Yuvi/World Art/Grounding/Lab 03 - Rebuild and Capture")]
        public static void RebuildAndCapture()
        {
            BuildConnectorKit();
            CaptureConnectorKit();
        }

        private static void Place(GroundingConnectorBuilder.ConnectorMesh mesh, Material body, Material accent, string name)
        {
            var root = new GameObject(name).transform;
            AddChild(root, name + "-Body", mesh.Structure, body);
            AddChild(root, name + "-Accent", mesh.Accent, accent);
            // Traversal surface kept separate + invisible; a future gate toggles its collider.
            var walk = new GameObject(name + "-Walk");
            walk.transform.SetParent(root, false);
            walk.AddComponent<MeshCollider>().sharedMesh = mesh.Walk;
        }

        private static void AddChild(Transform parent, string name, Mesh mesh, Material material)
        {
            if (mesh == null || mesh.vertexCount == 0) return;
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = material;
        }

        private static void BuildStageLighting()
        {
            if (Camera.main == null)
            {
                var camObj = new GameObject("Main Camera");
                camObj.tag = "MainCamera";
                var cam = camObj.AddComponent<Camera>();
                camObj.AddComponent<AudioListener>();
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = Hex("6C8FA0");
                cam.nearClipPlane = .1f; cam.farClipPlane = 200f;
            }
            var keyObj = new GameObject("Directional Light");
            var key = keyObj.AddComponent<Light>();
            key.type = LightType.Directional; key.color = Hex("FFF1D2"); key.intensity = 1.15f;
            key.shadows = LightShadows.Soft; key.shadowStrength = .55f; key.shadowBias = .1f; key.shadowNormalBias = 1.1f;
            keyObj.transform.rotation = Quaternion.Euler(46f, -34f, 0f);
            var fillObj = new GameObject("Fill Light");
            var fill = fillObj.AddComponent<Light>();
            fill.type = LightType.Directional; fill.color = Hex("ABC4D3"); fill.intensity = .4f; fill.shadows = LightShadows.None;
            fillObj.transform.rotation = Quaternion.Euler(60f, 150f, 0f);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Hex("D6CDBA");
            RenderSettings.ambientEquatorColor = Hex("8A8B82");
            RenderSettings.ambientGroundColor = Hex("51535A");
            RenderSettings.ambientIntensity = .9f;
        }

        private static void Capture(Camera camera, string assetPath, int width, int height)
        {
            var absolute = Path.Combine(Path.GetDirectoryName(Application.dataPath), assetPath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolute));
            var rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            var prevActive = RenderTexture.active;
            var tex = new Texture2D(width, height, TextureFormat.RGB24, false, false);
            try
            {
                Shader.WarmupAllShaders();
                camera.targetTexture = rt;
                camera.Render(); camera.Render();
                RenderTexture.active = rt;
                tex.ReadPixels(new Rect(0, 0, width, height), 0, 0, false);
                tex.Apply(false, false);
                File.WriteAllBytes(absolute, tex.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = null;
                RenderTexture.active = prevActive;
                RenderTexture.ReleaseTemporary(rt);
                Object.DestroyImmediate(tex);
            }
        }

        private static string AbsoluteFolder() => Path.Combine(Path.GetDirectoryName(Application.dataPath), CaptureFolder);

        private static Color Hex(string v)
        {
            ColorUtility.TryParseHtmlString("#" + v, out var c);
            return c;
        }
    }
}
