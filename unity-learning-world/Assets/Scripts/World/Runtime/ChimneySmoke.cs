using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Rising chimney-smoke plume built from a handful of grey puffs that spawn at the base, drift up and
    /// out, and shrink away at the top on a loop. Runtime-generated puffs are <see cref="HideFlags.HideAndDontSave"/>
    /// (never serialized). [ExecuteAlways] + the realtime clock so it animates in BOTH the editor Scene view
    /// (repainted by <c>WaterScenePreviewRepainter</c>) and Play mode. Attach at the chimney top.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public class ChimneySmoke : MonoBehaviour
    {
        public int puffCount = 5;
        public float riseHeight = 1.9f;
        public float drift = 0.4f;
        public float baseSize = 0.16f;
        public float growth = 2.6f;
        public float speed = 0.26f;
        public Color smokeColor = new Color(0.86f, 0.86f, 0.88f);

        readonly List<Transform> _puffs = new();
        Material _mat;

        void OnEnable() => Build();
        void OnDisable() => Clear();

        void Build()
        {
            Clear();
            if (_mat == null)
            {
                _mat = new Material(Shader.Find("Standard")) { hideFlags = HideFlags.HideAndDontSave, color = smokeColor };
                if (_mat.HasProperty("_Glossiness")) _mat.SetFloat("_Glossiness", 0.08f);
            }
            for (var i = 0; i < puffCount; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                go.name = "SmokePuff";
                go.hideFlags = HideFlags.HideAndDontSave;
                var col = go.GetComponent<Collider>();
                if (col) DestroyObj(col);
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = _mat;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                go.transform.SetParent(transform, false);
                go.transform.localScale = Vector3.zero;
                _puffs.Add(go.transform);
            }
        }

        void Clear()
        {
            foreach (var p in _puffs) if (p) DestroyObj(p.gameObject);
            _puffs.Clear();
        }

        void Update()
        {
            if (_puffs.Count == 0) Build();
            var t = Application.isPlaying ? Time.time : Time.realtimeSinceStartup;
            for (var i = 0; i < _puffs.Count; i++)
            {
                var p = _puffs[i];
                if (!p) continue;
                var phase = Mathf.Repeat(t * speed + i / (float)_puffs.Count, 1f);
                var fade = Mathf.Sin(phase * Mathf.PI);                       // 0 at both ends, 1 mid-flight
                var x = Mathf.Sin(phase * 6.28f + i * 1.7f) * drift * phase;
                var z = Mathf.Cos(phase * 5.0f + i * 2.3f) * drift * phase;
                p.localPosition = new Vector3(x, phase * riseHeight, z);
                p.localScale = Vector3.one * (baseSize * (0.5f + growth * phase) * fade);
            }
        }

        static void DestroyObj(Object o)
        {
            if (Application.isPlaying) Destroy(o); else DestroyImmediate(o);
        }
    }
}
