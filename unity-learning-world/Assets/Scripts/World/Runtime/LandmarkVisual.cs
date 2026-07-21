using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    public enum WorldLandmarkVisualState
    {
        Available,
        Current,
        Locked,
        Completed
    }

    [DisallowMultipleComponent]
    [RequireComponent(typeof(Collider))]
    public sealed class LandmarkVisual : MonoBehaviour
    {
        [SerializeField] private Transform visualRoot;
        [SerializeField] private Transform stateRoot;
        [SerializeField] private Transform shadowRoot;
        [SerializeField] private Transform interactionAnchor;
        [SerializeField] private Transform approachAnchor;
        [SerializeField] private Transform focusAnchor;
        [SerializeField] private Collider interactionCollider;
        [SerializeField] private Animator ambientAnimator;

        public Transform VisualRoot => visualRoot;
        public Transform StateRoot => stateRoot;
        public Transform ShadowRoot => shadowRoot;
        public Transform InteractionAnchor => interactionAnchor;
        public Transform ApproachAnchor => approachAnchor;
        public Transform FocusAnchor => focusAnchor;
        public Collider InteractionCollider => interactionCollider;

        public void SetState(WorldLandmarkVisualState state)
        {
            SetStateRoot("Available", state == WorldLandmarkVisualState.Available);
            SetStateRoot("Current", state == WorldLandmarkVisualState.Current);
            SetStateRoot("Locked", state == WorldLandmarkVisualState.Locked);
            SetStateRoot("Completed", state == WorldLandmarkVisualState.Completed);
        }

        public void SetMotionEnabled(bool enabled)
        {
            if (ambientAnimator != null) ambientAnimator.enabled = enabled;
        }

        public void CollectValidationIssues(List<string> issues)
        {
            if (issues == null) throw new ArgumentNullException(nameof(issues));
            Require(issues, visualRoot, "VisualRoot");
            Require(issues, stateRoot, "StateRoot");
            Require(issues, shadowRoot, "ShadowRoot");
            Require(issues, interactionAnchor, "InteractionAnchor");
            Require(issues, approachAnchor, "ApproachAnchor");
            Require(issues, focusAnchor, "FocusAnchor");
            if (interactionCollider == null) issues.Add($"{name}: InteractionCollider is required.");
            foreach (var stateName in new[] { "Available", "Current", "Locked", "Completed" })
                if (stateRoot != null && stateRoot.Find(stateName) == null)
                    issues.Add($"{name}: StateRoot/{stateName} is required.");
        }

        private void SetStateRoot(string childName, bool active)
        {
            var child = stateRoot != null ? stateRoot.Find(childName) : null;
            if (child != null) child.gameObject.SetActive(active);
        }

        private void Require(List<string> issues, Transform value, string childName)
        {
            if (value == null) issues.Add($"{name}: {childName} is required.");
        }

#if UNITY_EDITOR
        public void EditorAssignContract(
            Transform visual,
            Transform state,
            Transform shadow,
            Transform interaction,
            Transform approach,
            Transform focus,
            Collider collider)
        {
            visualRoot = visual;
            stateRoot = state;
            shadowRoot = shadow;
            interactionAnchor = interaction;
            approachAnchor = approach;
            focusAnchor = focus;
            interactionCollider = collider;
        }
#endif
    }
}