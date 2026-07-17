using UnityEngine;

namespace Yuvi720.LearningWorld
{
    public enum WorldPaperFacing
    {
        Fixed,
        FaceCamera,
        FaceCameraYawOnly
    }

    /// <summary>
    /// Presentation-only behavior for illustrated 2.5D cards. Collision,
    /// walkability, progression, and landmark state remain on separate objects.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class WorldPaperLayer : MonoBehaviour
    {
        [SerializeField] private WorldPaperFacing facing = WorldPaperFacing.FaceCamera;
        [SerializeField] private Transform visualRoot;
        [SerializeField, Range(0f, .15f)] private float parallaxStrength;
        [SerializeField, Min(0f)] private float maximumParallaxOffset = .3f;

        private Camera targetCamera;
        private Vector3 cameraOrigin;
        private Vector3 visualOrigin;
        private bool motionEnabled = true;

        public WorldPaperFacing Facing => facing;
        public float ParallaxStrength => parallaxStrength;

        public void SetMotionEnabled(bool enabled)
        {
            motionEnabled = enabled;
            if (!enabled && visualRoot != null) visualRoot.localPosition = visualOrigin;
        }

        private void OnEnable()
        {
            targetCamera = Camera.main;
            visualRoot ??= transform;
            visualOrigin = visualRoot.localPosition;
            if (targetCamera != null) cameraOrigin = targetCamera.transform.position;
        }

        private void LateUpdate()
        {
            if (targetCamera == null)
            {
                targetCamera = Camera.main;
                if (targetCamera == null) return;
                cameraOrigin = targetCamera.transform.position;
            }

            ApplyFacing();
            ApplyParallax();
        }

        private void ApplyFacing()
        {
            if (facing == WorldPaperFacing.Fixed) return;
            var toCamera = targetCamera.transform.position - transform.position;
            if (facing == WorldPaperFacing.FaceCameraYawOnly) toCamera.y = 0f;
            if (toCamera.sqrMagnitude < .0001f) return;
            transform.rotation = Quaternion.LookRotation(toCamera.normalized, Vector3.up);
        }

        private void ApplyParallax()
        {
            if (visualRoot == null || !motionEnabled || parallaxStrength <= 0f)
            {
                if (visualRoot != null) visualRoot.localPosition = visualOrigin;
                return;
            }

            var cameraDelta = targetCamera.transform.position - cameraOrigin;
            var worldOffset = Vector3.ClampMagnitude(-cameraDelta * parallaxStrength, maximumParallaxOffset);
            visualRoot.localPosition = visualOrigin + transform.InverseTransformVector(worldOffset);
        }
    }
}
