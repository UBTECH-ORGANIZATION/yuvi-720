using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Scrolls a renderer's texture along V to fake flowing water — used for the fountain's falling
    /// cascade (speed &gt; 0 flows down) and rising jet (speed &lt; 0). Uses a MaterialPropertyBlock so the
    /// shared material asset is never touched. [ExecuteAlways] + realtime clock → animates in edit + play.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public class FlowScroll : MonoBehaviour
    {
        public float speed = 0.6f;                       // +down / -up
        public Vector2 tiling = new Vector2(4f, 2f);

        Renderer _r;
        MaterialPropertyBlock _mpb;
        static readonly int StId = Shader.PropertyToID("_MainTex_ST");

        void OnEnable() => _r = GetComponent<Renderer>();

        void Update()
        {
            if (!_r) { _r = GetComponent<Renderer>(); if (!_r) return; }
            _mpb ??= new MaterialPropertyBlock();
            var t = Application.isPlaying ? Time.time : Time.realtimeSinceStartup;
            var off = Mathf.Repeat(t * speed, 1f);
            _r.GetPropertyBlock(_mpb);
            _mpb.SetVector(StId, new Vector4(tiling.x, tiling.y, 0f, -off)); // texture slides down as t grows
            _r.SetPropertyBlock(_mpb);
        }
    }
}
