using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Gentle sway + bob so a tethered balloon bunch drifts in the breeze. Rotates about the object's origin
    /// (place the origin at the knot so the balloons swing overhead). [ExecuteAlways] + realtime clock so it
    /// moves in the Scene view and in Play. Attach to the balloon-bunch root.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public class BalloonSway : MonoBehaviour
    {
        public float swayDegrees = 7f;
        public float swaySpeed = 0.9f;
        public float bob = 0.12f;
        public float bobSpeed = 1.3f;

        Vector3 _basePos;
        Quaternion _baseRot;
        bool _init;

        void OnEnable()
        {
            _basePos = transform.localPosition;
            _baseRot = transform.localRotation;
            _init = true;
        }

        void Update()
        {
            if (!_init) return;
            var t = Application.isPlaying ? Time.time : Time.realtimeSinceStartup;
            var a = Mathf.Sin(t * swaySpeed) * swayDegrees;
            var b = Mathf.Cos(t * swaySpeed * 0.7f) * swayDegrees * 0.6f;
            transform.localRotation = _baseRot * Quaternion.Euler(b, 0f, a);
            transform.localPosition = _basePos + Vector3.up * (Mathf.Sin(t * bobSpeed) * bob);
        }
    }
}
