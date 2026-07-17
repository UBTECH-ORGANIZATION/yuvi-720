using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// A soft wall of drifting cloud puffs standing at a section's far boundary — it blocks the view onward
    /// (to the right, toward the next section) so the player never sees the empty space where the next,
    /// not-yet-downloaded section will stream in. When the learning page reports the section complete the
    /// curtain <see cref="Fade"/>s out and the next section streams in behind it (see
    /// <see cref="SectionStreamer"/>).
    ///
    /// The wall spans <see cref="width"/> × <see cref="height"/> in the object's local X/Y with a little depth
    /// jitter, built from overlapping puffs so it reads as a dense bank rather than discrete balls. Puffs are
    /// runtime-generated (<see cref="HideFlags.HideAndDontSave"/>). [ExecuteAlways] + realtime clock → it
    /// drifts in the Scene view and in Play. Orient the transform so local +X runs along the boundary and
    /// local +Z faces the section the player stands in.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class CloudCurtain : MonoBehaviour
    {
        public float width = 26f;
        public float height = 12f;
        public int columns = 9;
        public int rows = 4;
        public float puffSize = 4.2f;
        public float depthJitter = 1.6f;
        public float drift = 0.5f;
        public float driftSpeed = 0.35f;
        // Soft + translucent, but dense enough to actually hide the path onward: overlapping puffs build into
        // a hazy bank. Too high and it reads as carved stone; too low and the next section shows through.
        public Color cloudColor = new Color(0.95f, 0.96f, 0.99f, 0.55f);
        [Tooltip("Fading this curtain reveals the section with this id (the bridge matches RevealSection here).")]
        public string revealsSectionId;

        private readonly List<Transform> _puffs = new();
        private readonly List<Vector3> _home = new();
        private Material _mat;
        private float _fadeT = 1f;     // 1 = fully opaque, 0 = gone
        private float _fadeRate;       // >0 while fading out
        private bool _faded;

        private void OnEnable() => Build();
        private void OnDisable() => Clear();

        /// <summary>Dissolve the curtain over <paramref name="duration"/> seconds, then deactivate it.</summary>
        public void Fade(float duration = 2.5f)
        {
            _fadeRate = duration <= 0.01f ? 100f : 1f / duration;
            _faded = false;
        }

        public bool IsFaded => _faded;

        private void Build()
        {
            Clear();
            if (_mat == null)
            {
                _mat = new Material(Shader.Find("Standard")) { hideFlags = HideFlags.HideAndDontSave };
                MakeTransparent(_mat);
                _mat.color = cloudColor;
            }
            for (var r = 0; r < rows; r++)
            for (var c = 0; c < columns; c++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                go.name = "CloudPuff";
                go.hideFlags = HideFlags.HideAndDontSave;
                var col = go.GetComponent<Collider>();
                if (col) DestroyObj(col);
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = _mat;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                mr.receiveShadows = false; // shadowing makes the bank read as solid rock
                go.transform.SetParent(transform, false);

                var u = columns > 1 ? c / (float)(columns - 1) : 0.5f;
                var v = rows > 1 ? r / (float)(rows - 1) : 0.5f;
                // Break the grid with deterministic per-puff jitter so it billows like cloud instead of
                // stacking into tidy rows of capsules.
                var jx = (Mathf.PerlinNoise(c * 3.1f, r * 1.7f) - 0.5f) * (width / Mathf.Max(1, columns)) * 1.5f;
                var jy = (Mathf.PerlinNoise(c * 1.3f, r * 2.9f) - 0.5f) * (height / Mathf.Max(1, rows)) * 1.3f;
                var x = (u - 0.5f) * width + jx;
                var y = v * height + jy;
                var z = (Mathf.PerlinNoise(c * 2.3f, r * 3.7f) - 0.5f) * depthJitter * 2f;
                var home = new Vector3(x, y, z);
                go.transform.localPosition = home;
                var s = puffSize * (0.6f + 0.8f * Mathf.PerlinNoise(u * 4f + 11f, v * 4f + 7f));
                go.transform.localScale = new Vector3(s * 1.15f, s * 0.82f, s);
                _puffs.Add(go.transform);
                _home.Add(home);
            }
        }

        private void Clear()
        {
            foreach (var p in _puffs) if (p) DestroyObj(p.gameObject);
            _puffs.Clear();
            _home.Clear();
        }

        private void Update()
        {
            if (_puffs.Count == 0) { Build(); return; }
            var t = Application.isPlaying ? Time.time : Time.realtimeSinceStartup;

            if (_fadeRate > 0f && !_faded)
            {
                _fadeT = Mathf.Max(0f, _fadeT - _fadeRate * Time.deltaTime);
                if (_mat != null) { var c = cloudColor; c.a = cloudColor.a * _fadeT; _mat.color = c; }
                if (_fadeT <= 0f) { _faded = true; gameObject.SetActive(false); return; }
            }

            for (var i = 0; i < _puffs.Count; i++)
            {
                var p = _puffs[i];
                if (!p) continue;
                var home = _home[i];
                var dx = Mathf.Sin(t * driftSpeed + i * 0.7f) * drift;
                var dy = Mathf.Cos(t * driftSpeed * 0.8f + i * 1.1f) * drift * 0.4f;
                p.localPosition = home + new Vector3(dx, dy, 0f);
            }
        }

        private static void MakeTransparent(Material m)
        {
            // Standard shader → Fade mode so the bank can dissolve to nothing.
            m.SetFloat("_Mode", 2f);
            m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            m.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            m.SetInt("_ZWrite", 0);
            m.DisableKeyword("_ALPHATEST_ON");
            m.EnableKeyword("_ALPHABLEND_ON");
            m.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            m.renderQueue = 3000;
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", 0.05f);
        }

        private static void DestroyObj(Object o)
        {
            if (Application.isPlaying) Destroy(o); else DestroyImmediate(o);
        }
    }
}
