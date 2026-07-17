using UnityEngine;

namespace Yuvi720.LearningWorld
{
    /// <summary>
    /// Describes one animation-ready mesh pivot. A central WorldMotionController
    /// evaluates every element so repeated vegetation does not own Update loops.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class WorldWindElement : MonoBehaviour
    {
        [SerializeField] private Transform pivot;
        [SerializeField] private Vector3 localAxis = Vector3.forward;
        [SerializeField, Range(0f, 12f)] private float amplitude = 3f;
        [SerializeField, Range(.05f, 4f)] private float speed = .8f;
        [SerializeField] private float phase;
        [SerializeField] private bool disableInLowPower = true;

        private Quaternion restRotation;
        private bool initialized;

        public bool DisableInLowPower => disableInLowPower;

        private void OnEnable()
        {
            CaptureRestPose();
        }

        public void CaptureRestPose()
        {
            pivot ??= transform;
            restRotation = pivot.localRotation;
            initialized = true;
        }

        public void Apply(float time, float intensity)
        {
            if (!initialized) CaptureRestPose();
            var angle = Mathf.Sin(time * speed + phase) * amplitude * Mathf.Clamp01(intensity);
            pivot.localRotation = restRotation * Quaternion.AngleAxis(angle, localAxis.normalized);
        }

        public void ResetPose()
        {
            if (!initialized) CaptureRestPose();
            pivot.localRotation = restRotation;
        }

#if UNITY_EDITOR
        public void EditorAssignContract(
            Transform motionPivot,
            Vector3 axis,
            float motionAmplitude,
            float motionSpeed,
            float motionPhase,
            bool lowPowerDisabled)
        {
            pivot = motionPivot;
            localAxis = axis.sqrMagnitude > .001f ? axis.normalized : Vector3.forward;
            amplitude = Mathf.Max(0f, motionAmplitude);
            speed = Mathf.Max(.05f, motionSpeed);
            phase = motionPhase;
            disableInLowPower = lowPowerDisabled;
            CaptureRestPose();
        }
#endif
    }
}