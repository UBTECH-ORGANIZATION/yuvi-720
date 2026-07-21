using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    /// <summary>
    /// Moves between authored section viewpoints. Once a transition finishes,
    /// the camera remains unchanged while Yubi moves inside that section.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class WorldSectionCameraController : MonoBehaviour
    {
        [SerializeField, Min(.1f)] private float transitionDuration = 1.05f;

        private readonly List<WorldSectionView> sections = new();
        private Camera controlledCamera;
        private WorldSectionView currentSection;
        private WorldSectionView targetSection;
        private Vector3 transitionStartPosition;
        private Quaternion transitionStartRotation;
        private float transitionStartSize;
        private float transitionElapsed;
        private bool reducedMotion;

        public string CurrentSectionId => currentSection != null ? currentSection.SectionId : string.Empty;
        public string TargetSectionId => targetSection != null ? targetSection.SectionId : string.Empty;
        public bool IsTransitioning => targetSection != null && targetSection != currentSection;
        public int SectionCount => sections.Count;

        public void Configure(
            Camera camera,
            IEnumerable<WorldSectionView> availableSections,
            Vector3 trackedPosition,
            bool useReducedMotion)
        {
            controlledCamera = camera ?? throw new ArgumentNullException(nameof(camera));
            controlledCamera.orthographic = true;
            reducedMotion = useReducedMotion;
            sections.Clear();
            if (availableSections != null)
            {
                foreach (var section in availableSections)
                    if (section != null && !sections.Contains(section)) sections.Add(section);
            }

            currentSection = null;
            targetSection = ResolveSection(trackedPosition);
            if (targetSection != null) SnapTo(targetSection);
        }

        public void Tick(Vector3 trackedPosition, float unscaledDeltaTime)
        {
            if (controlledCamera == null || sections.Count == 0) return;
            var resolved = ResolveSection(trackedPosition);
            if (resolved != null && resolved != targetSection) BeginTransition(resolved);
            if (!IsTransitioning) return;

            transitionElapsed += Mathf.Max(0f, unscaledDeltaTime);
            var duration = Mathf.Max(.01f, transitionDuration);
            var t = reducedMotion ? 1f : Mathf.Clamp01(transitionElapsed / duration);
            var eased = t * t * (3f - 2f * t);
            controlledCamera.transform.position = Vector3.Lerp(
                transitionStartPosition,
                targetSection.CameraAnchor.position,
                eased);
            controlledCamera.transform.rotation = Quaternion.Slerp(
                transitionStartRotation,
                targetSection.CameraAnchor.rotation,
                eased);
            controlledCamera.orthographicSize = Mathf.Lerp(
                transitionStartSize,
                targetSection.OrthographicSize,
                eased);

            if (t >= 1f) SnapTo(targetSection);
        }

        public void ResetToPosition(Vector3 trackedPosition, bool immediate)
        {
            var resolved = ResolveSection(trackedPosition);
            if (resolved == null) return;
            if (immediate || reducedMotion) SnapTo(resolved);
            else BeginTransition(resolved);
        }

        public WorldSectionView ResolveSection(Vector3 worldPosition)
        {
            WorldSectionView selected = null;
            var bestDistance = float.PositiveInfinity;
            for (var index = 0; index < sections.Count; index++)
            {
                var section = sections[index];
                var distance = section.DistanceSquaredXZ(worldPosition);
                if (section.Contains(worldPosition) && distance < bestDistance)
                {
                    selected = section;
                    bestDistance = distance;
                }
            }
            if (selected != null) return selected;

            for (var index = 0; index < sections.Count; index++)
            {
                var section = sections[index];
                var distance = section.DistanceSquaredXZ(worldPosition);
                if (distance >= bestDistance) continue;
                selected = section;
                bestDistance = distance;
            }
            return selected;
        }

        private void BeginTransition(WorldSectionView section)
        {
            if (section == null || controlledCamera == null) return;
            if (section == currentSection)
            {
                targetSection = currentSection;
                return;
            }
            targetSection = section;
            transitionStartPosition = controlledCamera.transform.position;
            transitionStartRotation = controlledCamera.transform.rotation;
            transitionStartSize = controlledCamera.orthographicSize;
            transitionElapsed = 0f;
            if (reducedMotion) SnapTo(section);
        }

        private void SnapTo(WorldSectionView section)
        {
            if (section == null || controlledCamera == null || section.CameraAnchor == null) return;
            controlledCamera.transform.SetPositionAndRotation(
                section.CameraAnchor.position,
                section.CameraAnchor.rotation);
            controlledCamera.orthographicSize = section.OrthographicSize;
            currentSection = section;
            targetSection = section;
            transitionElapsed = 0f;
        }
    }
}