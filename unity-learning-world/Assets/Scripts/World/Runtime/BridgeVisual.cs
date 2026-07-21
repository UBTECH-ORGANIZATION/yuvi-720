using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    [DisallowMultipleComponent]
    public sealed class BridgeVisual : MonoBehaviour
    {
        [SerializeField] private Transform startAnchor;
        [SerializeField] private Transform endAnchor;
        [SerializeField] private Collider walkSurface;
        [SerializeField] private Transform visualRoot;
        [SerializeField] private Transform openState;
        [SerializeField] private Transform lockedState;
        [SerializeField] private Transform blockedInteractionAnchor;
        [SerializeField] private Transform[] waterContactEffectAnchors = Array.Empty<Transform>();
        [SerializeField] private Animator ambientAnimator;

        public Transform StartAnchor => startAnchor;
        public Transform EndAnchor => endAnchor;
        public Collider WalkSurface => walkSurface;
        public Transform VisualRoot => visualRoot;
        public Transform OpenState => openState;
        public Transform LockedState => lockedState;
        public Transform BlockedInteractionAnchor => blockedInteractionAnchor;
        public IReadOnlyList<Transform> WaterContactEffectAnchors => waterContactEffectAnchors;

        public void SetUnlocked(bool unlocked)
        {
            if (openState != null) openState.gameObject.SetActive(unlocked);
            if (lockedState != null) lockedState.gameObject.SetActive(!unlocked);
        }

        public void SetMotionEnabled(bool enabled)
        {
            if (ambientAnimator != null) ambientAnimator.enabled = enabled;
        }

        public void CollectValidationIssues(List<string> issues)
        {
            if (issues == null) throw new ArgumentNullException(nameof(issues));
            Require(issues, startAnchor, "StartAnchor");
            Require(issues, endAnchor, "EndAnchor");
            Require(issues, visualRoot, "VisualRoot");
            Require(issues, openState, "OpenState");
            Require(issues, lockedState, "LockedState");
            Require(issues, blockedInteractionAnchor, "BlockedInteractionAnchor");
            if (walkSurface == null) issues.Add($"{name}: WalkSurface collider is required.");
            if (startAnchor != null && endAnchor != null && Vector3.Distance(startAnchor.position, endAnchor.position) < .1f)
                issues.Add($"{name}: bridge anchors must not overlap.");
        }

        private void Require(List<string> issues, Transform value, string childName)
        {
            if (value == null) issues.Add($"{name}: {childName} is required.");
        }

#if UNITY_EDITOR
        public void EditorAssignContract(
            Transform start,
            Transform end,
            Collider surface,
            Transform visual,
            Transform open,
            Transform locked,
            Transform blocked,
            Transform[] waterAnchors)
        {
            startAnchor = start;
            endAnchor = end;
            walkSurface = surface;
            visualRoot = visual;
            openState = open;
            lockedState = locked;
            blockedInteractionAnchor = blocked;
            waterContactEffectAnchors = waterAnchors ?? Array.Empty<Transform>();
        }
#endif
    }
}