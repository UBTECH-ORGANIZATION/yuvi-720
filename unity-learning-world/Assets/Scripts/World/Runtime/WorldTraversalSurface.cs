using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    [DisallowMultipleComponent]
    public sealed class WorldTraversalSurface : MonoBehaviour
    {
        [SerializeField] private Transform movementRoot;
        [SerializeField, Min(0f)] private float groundOffset = .85f;
        [SerializeField, Min(.1f)] private float maximumStepHeight = .65f;
        [SerializeField, Min(.1f)] private float maximumDropHeight = 1.75f;
        [SerializeField, Min(1f)] private float rayStartHeight = 6f;
        [SerializeField, Min(2f)] private float rayDistance = 16f;

        private readonly List<Collider> surfaces = new();

        public Transform MovementRoot => movementRoot;
        public float GroundOffset => groundOffset;

        public void CollectValidationIssues(List<string> issues)
        {
            if (issues == null) throw new ArgumentNullException(nameof(issues));
            if (movementRoot == null)
            {
                issues.Add($"{name}: MovementRoot is required.");
                return;
            }

            RefreshSurfaceCache();
            if (surfaces.Count == 0)
                issues.Add($"{name}: MovementRoot requires at least one collider.");
            if (surfaces.Exists(surface => surface.isTrigger))
                issues.Add($"{name}: traversal colliders must not be triggers.");
            if (surfaces.Exists(surface => surface.GetComponent<Renderer>() != null))
                issues.Add($"{name}: traversal colliders must stay visually independent.");
        }

        public bool TryProjectInitial(Vector3 candidate, out Vector3 projected)
        {
            RefreshSurfaceCacheIfNeeded();
            return TryFindGround(candidate, float.PositiveInfinity, float.PositiveInfinity, out projected);
        }

        public bool TryProjectStep(Vector3 candidate, float currentGroundHeight, out Vector3 projected)
        {
            RefreshSurfaceCacheIfNeeded();
            return TryFindGround(candidate, maximumStepHeight, maximumDropHeight, currentGroundHeight, out projected);
        }

        public void RefreshSurfaceCache()
        {
            surfaces.Clear();
            if (movementRoot == null) return;
            movementRoot.GetComponentsInChildren(true, surfaces);
            surfaces.RemoveAll(IsUnavailable);
        }

        public void AssignMovementRoot(Transform root)
        {
            movementRoot = root;
            RefreshSurfaceCache();
        }

#if UNITY_EDITOR
        public void EditorAssignContract(Transform root)
        {
            AssignMovementRoot(root);
        }
#endif

        private void Awake()
        {
            RefreshSurfaceCache();
        }

        private void OnTransformChildrenChanged()
        {
            RefreshSurfaceCache();
        }

        private void RefreshSurfaceCacheIfNeeded()
        {
            surfaces.RemoveAll(IsUnavailable);
            if (surfaces.Count == 0) RefreshSurfaceCache();
        }

        private static bool IsUnavailable(Collider surface)
        {
            return surface == null
                || !surface.enabled
                || surface.isTrigger;
        }

        private bool TryFindGround(
            Vector3 candidate,
            float maximumRise,
            float maximumDrop,
            out Vector3 projected)
        {
            return TryFindGround(candidate, maximumRise, maximumDrop, candidate.y - groundOffset, out projected);
        }

        private bool TryFindGround(
            Vector3 candidate,
            float maximumRise,
            float maximumDrop,
            float currentGroundHeight,
            out Vector3 projected)
        {
            projected = candidate;
            var rayOriginHeight = float.IsPositiveInfinity(maximumRise)
                ? candidate.y + rayStartHeight
                : currentGroundHeight + maximumRise + rayStartHeight;
            var ray = new Ray(new Vector3(candidate.x, rayOriginHeight, candidate.z), Vector3.down);
            var found = false;
            var selectedHeight = float.NegativeInfinity;

            foreach (var surface in surfaces)
            {
                if (!surface.Raycast(ray, out var hit, rayDistance)) continue;
                var groundHeight = hit.point.y;
                var rise = groundHeight - currentGroundHeight;
                if (!float.IsPositiveInfinity(maximumRise) && rise > maximumRise + .01f) continue;
                if (!float.IsPositiveInfinity(maximumDrop) && rise < -maximumDrop - .01f) continue;
                if (groundHeight <= selectedHeight) continue;
                selectedHeight = groundHeight;
                projected = new Vector3(candidate.x, groundHeight + groundOffset, candidate.z);
                found = true;
            }

            return found;
        }
    }
}
