using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Feeds a continuously advancing global time (<c>_YWTime</c>) to the Yuvi/Water shader so the
    /// ocean and fountain animate all the time — in play mode AND in the editor. Runs in edit mode via
    /// [ExecuteAlways]; an editor repainter forces Scene-view refreshes so the motion is visible there.
    /// One driver anywhere in the scene animates every water material (the property is global).
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public class WaterTimeDriver : MonoBehaviour
    {
        [Tooltip("Overall speed multiplier for all water animation.")]
        public float speed = 1f;

        static readonly int TimeId = Shader.PropertyToID("_YWTime");

        void OnEnable() => Apply();
        void Update() => Apply();

        void Apply()
        {
            var t = Application.isPlaying ? Time.time : Time.realtimeSinceStartup;
            Shader.SetGlobalFloat(TimeId, t * speed);

            // The water shader reads scene depth to derive the water column thickness — that is what gives
            // the turquoise shallow shelf and the foam line where the sea meets the shore. Built-in RP only
            // renders _CameraDepthTexture on demand, so the request has to be made on the camera itself.
            var cam = Camera.main;
            if (cam != null && (cam.depthTextureMode & DepthTextureMode.Depth) == 0)
                cam.depthTextureMode |= DepthTextureMode.Depth;
        }
    }
}
