using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld.Grounding
{
    [Serializable]
    public sealed class GroundPolygonRingDefinition
    {
        [SerializeField] private Vector2[] vertices = Array.Empty<Vector2>();

        public IReadOnlyList<Vector2> Vertices => vertices ?? Array.Empty<Vector2>();

        public GroundPolygonRingDefinition()
        {
        }

        public GroundPolygonRingDefinition(IEnumerable<Vector2> points)
        {
            vertices = points == null ? Array.Empty<Vector2>() : new List<Vector2>(points).ToArray();
        }
    }

    [Serializable]
    public sealed class GroundPolygonDefinition
    {
        [SerializeField] private Vector2[] outer = Array.Empty<Vector2>();
        [SerializeField] private GroundPolygonRingDefinition[] holes = Array.Empty<GroundPolygonRingDefinition>();

        public IReadOnlyList<Vector2> Outer => outer ?? Array.Empty<Vector2>();
        public IReadOnlyList<GroundPolygonRingDefinition> Holes => holes ?? Array.Empty<GroundPolygonRingDefinition>();

        public GroundPolygonDefinition()
        {
        }

        public GroundPolygonDefinition(
            IEnumerable<Vector2> boundary,
            IEnumerable<GroundPolygonRingDefinition> interiorHoles = null)
        {
            outer = boundary == null ? Array.Empty<Vector2>() : new List<Vector2>(boundary).ToArray();
            holes = interiorHoles == null
                ? Array.Empty<GroundPolygonRingDefinition>()
                : new List<GroundPolygonRingDefinition>(interiorHoles).ToArray();
        }
    }

    [Serializable]
    public sealed class GroundElevationBandDefinition
    {
        [SerializeField] private string id = "band";
        [SerializeField] private float topHeight;
        [SerializeField] private float bottomHeight = -1f;
        [SerializeField] private GroundPolygonDefinition surface = new();
        [SerializeField] private bool traversable = true;
        [SerializeField] private string surfaceFamily = "primary";

        public string Id => id;
        public float TopHeight => topHeight;
        public float BottomHeight => bottomHeight;
        public GroundPolygonDefinition Surface => surface;
        public bool Traversable => traversable;
        public string SurfaceFamily => surfaceFamily;

        public GroundElevationBandDefinition(
            string bandId,
            float top,
            float bottom,
            GroundPolygonDefinition polygon,
            bool isTraversable,
            string family)
        {
            id = bandId;
            topHeight = top;
            bottomHeight = bottom;
            surface = polygon;
            traversable = isTraversable;
            surfaceFamily = family;
        }
    }

    public enum GroundTransitionKind
    {
        Ramp,
        Stairs,
        Bridge
    }

    [Serializable]
    public sealed class GroundTransitionDefinition
    {
        [SerializeField] private string id = "transition";
        [SerializeField] private GroundTransitionKind kind;
        [SerializeField] private Vector3 start;
        [SerializeField] private Vector3 end;
        [SerializeField, Min(.5f)] private float width = 2f;
        [SerializeField, Min(1)] private int stepCount = 4;
        [SerializeField] private string surfaceFamily = "route";

        public string Id => id;
        public GroundTransitionKind Kind => kind;
        public Vector3 Start => start;
        public Vector3 End => end;
        public float Width => width;
        public int StepCount => stepCount;
        public string SurfaceFamily => surfaceFamily;

        public GroundTransitionDefinition(
            string transitionId,
            GroundTransitionKind transitionKind,
            Vector3 from,
            Vector3 to,
            float transitionWidth,
            int stairs,
            string family)
        {
            id = transitionId;
            kind = transitionKind;
            start = from;
            end = to;
            width = transitionWidth;
            stepCount = stairs;
            surfaceFamily = family;
        }
    }

    [Serializable]
    public sealed class GroundPortalDefinition
    {
        [SerializeField] private string id = "portal";
        [SerializeField] private Vector3 position;
        [SerializeField] private Vector3 forward = Vector3.right;
        [SerializeField, Min(.5f)] private float width = 2f;

        public string Id => id;
        public Vector3 Position => position;
        public Vector3 Forward => forward;
        public float Width => width;

        public GroundPortalDefinition(string portalId, Vector3 worldPosition, Vector3 direction, float portalWidth)
        {
            id = portalId;
            position = worldPosition;
            forward = direction;
            width = portalWidth;
        }
    }

    [Serializable]
    public sealed class GroundReservedZoneDefinition
    {
        [SerializeField] private string id = "reservation";
        [SerializeField] private Bounds bounds;

        public string Id => id;
        public Bounds Bounds => bounds;

        public GroundReservedZoneDefinition(string reservationId, Bounds reservedBounds)
        {
            id = reservationId;
            bounds = reservedBounds;
        }
    }

    [Serializable]
    public sealed class GroundCameraDefinition
    {
        [SerializeField] private Vector3 anchorPosition;
        [SerializeField] private Vector3 anchorEuler = new(52f, 0f, 0f);
        [SerializeField, Min(1f)] private float orthographicSize = 12f;
        [SerializeField] private Bounds coverage;

        public Vector3 AnchorPosition => anchorPosition;
        public Vector3 AnchorEuler => anchorEuler;
        public float OrthographicSize => orthographicSize;
        public Bounds Coverage => coverage;

        public GroundCameraDefinition(Vector3 position, Vector3 euler, float size, Bounds coverageBounds)
        {
            anchorPosition = position;
            anchorEuler = euler;
            orthographicSize = size;
            coverage = coverageBounds;
        }
    }

    [Serializable]
    public sealed class GroundConnectorDefinition
    {
        [SerializeField] private string id = "connector";
        [SerializeField] private string fromSectionId = string.Empty;
        [SerializeField] private string fromPortalId = string.Empty;
        [SerializeField] private string toSectionId = string.Empty;
        [SerializeField] private string toPortalId = string.Empty;
        [SerializeField] private GroundTransitionKind kind;
        [SerializeField, Min(.5f)] private float width = 2f;

        public string Id => id;
        public string FromSectionId => fromSectionId;
        public string FromPortalId => fromPortalId;
        public string ToSectionId => toSectionId;
        public string ToPortalId => toPortalId;
        public GroundTransitionKind Kind => kind;
        public float Width => width;

        public GroundConnectorDefinition(
            string connectorId,
            string fromSection,
            string fromPortal,
            string toSection,
            string toPortal,
            GroundTransitionKind connectorKind,
            float connectorWidth)
        {
            id = connectorId;
            fromSectionId = fromSection;
            fromPortalId = fromPortal;
            toSectionId = toSection;
            toPortalId = toPortal;
            kind = connectorKind;
            width = connectorWidth;
        }
    }

}