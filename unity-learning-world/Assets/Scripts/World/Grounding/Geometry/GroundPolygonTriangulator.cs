using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Yuvi720.LearningWorld.Grounding
{
    public enum GroundTriangulationFailure
    {
        None,
        InvalidPolygon,
        HoleBridgeFailed,
        EarNotFound
    }

    public sealed class GroundTriangulationResult
    {
        public GroundTriangulationFailure Failure { get; }
        public string Message { get; }
        public IReadOnlyList<Vector2> Vertices { get; }
        public IReadOnlyList<int> Triangles { get; }
        public bool Succeeded => Failure == GroundTriangulationFailure.None;

        private GroundTriangulationResult(
            GroundTriangulationFailure failure,
            string message,
            Vector2[] vertices,
            int[] triangles)
        {
            Failure = failure;
            Message = message;
            Vertices = vertices;
            Triangles = triangles;
        }

        public static GroundTriangulationResult Success(Vector2[] vertices, int[] triangles)
        {
            return new GroundTriangulationResult(
                GroundTriangulationFailure.None,
                string.Empty,
                vertices,
                triangles);
        }

        public static GroundTriangulationResult Failed(GroundTriangulationFailure failure, string message)
        {
            return new GroundTriangulationResult(failure, message, Array.Empty<Vector2>(), Array.Empty<int>());
        }
    }

    public static class GroundPolygonTriangulator
    {
        private readonly struct IndexedPoint
        {
            public readonly Vector2 Position;
            public readonly int StableIndex;

            public IndexedPoint(Vector2 position, int stableIndex)
            {
                Position = position;
                StableIndex = stableIndex;
            }
        }

        public static GroundTriangulationResult Triangulate(GroundPolygonDefinition definition)
        {
            if (!GroundPolygon.TryCreate(definition, out var polygon, out var error))
                return GroundTriangulationResult.Failed(GroundTriangulationFailure.InvalidPolygon, error);
            return Triangulate(polygon);
        }

        public static GroundTriangulationResult Triangulate(GroundPolygon polygon)
        {
            if (polygon == null)
                return GroundTriangulationResult.Failed(
                    GroundTriangulationFailure.InvalidPolygon,
                    "Polygon is missing.");

            var nextStableIndex = 0;
            var merged = polygon.Outer
                .Select(point => new IndexedPoint(point, nextStableIndex++))
                .ToList();
            var holes = polygon.Holes
                .Select(ring => ring.Select(point => new IndexedPoint(point, nextStableIndex++)).ToList())
                .OrderByDescending(RightmostX)
                .ThenBy(RightmostY)
                .ToList();

            for (var holeIndex = 0; holeIndex < holes.Count; holeIndex++)
            {
                var remainingHoles = holes.Skip(holeIndex).ToArray();
                if (!TryBridgeHole(polygon, merged, holes[holeIndex], remainingHoles, out merged, out var bridgeError))
                    return GroundTriangulationResult.Failed(
                        GroundTriangulationFailure.HoleBridgeFailed,
                        bridgeError);
            }

            if (!TryEarClip(merged, out var triangles, out var earError))
                return GroundTriangulationResult.Failed(GroundTriangulationFailure.EarNotFound, earError);

            return GroundTriangulationResult.Success(
                merged.Select(item => item.Position).ToArray(),
                triangles.ToArray());
        }

        private static bool TryBridgeHole(
            GroundPolygon polygon,
            IReadOnlyList<IndexedPoint> boundary,
            IReadOnlyList<IndexedPoint> hole,
            IReadOnlyList<List<IndexedPoint>> remainingHoles,
            out List<IndexedPoint> merged,
            out string error)
        {
            merged = null;
            error = string.Empty;
            var holeVertexIndex = FindRightmostVertex(hole);
            var holeVertex = hole[holeVertexIndex];
            var candidates = Enumerable.Range(0, boundary.Count)
                .OrderBy(index => (boundary[index].Position - holeVertex.Position).sqrMagnitude)
                .ThenBy(index => boundary[index].Position.x)
                .ThenBy(index => boundary[index].Position.y)
                .ThenBy(index => boundary[index].StableIndex);

            var boundaryVertexIndex = -1;
            foreach (var candidateIndex in candidates)
            {
                var candidate = boundary[candidateIndex];
                if (!IsBridgeVisible(
                    polygon,
                    holeVertex.Position,
                    candidate.Position,
                    boundary,
                    hole,
                    remainingHoles)) continue;
                boundaryVertexIndex = candidateIndex;
                break;
            }

            if (boundaryVertexIndex < 0)
            {
                error = $"Could not find a visible deterministic bridge for hole vertex {holeVertex.Position}.";
                return false;
            }

            merged = new List<IndexedPoint>(boundary.Count + hole.Count + 2);
            for (var index = 0; index <= boundaryVertexIndex; index++) merged.Add(boundary[index]);
            merged.Add(holeVertex);
            for (var offset = 1; offset < hole.Count; offset++)
                merged.Add(hole[(holeVertexIndex + offset) % hole.Count]);
            merged.Add(holeVertex);
            merged.Add(boundary[boundaryVertexIndex]);
            for (var index = boundaryVertexIndex + 1; index < boundary.Count; index++) merged.Add(boundary[index]);
            return true;
        }

        private static bool IsBridgeVisible(
            GroundPolygon polygon,
            Vector2 from,
            Vector2 to,
            IReadOnlyList<IndexedPoint> boundary,
            IReadOnlyList<IndexedPoint> activeHole,
            IReadOnlyList<List<IndexedPoint>> remainingHoles)
        {
            if ((from - to).sqrMagnitude <= GroundPolygon.Epsilon * GroundPolygon.Epsilon) return false;
            var samples = new[] { .2f, .5f, .8f };
            foreach (var sample in samples)
                if (!polygon.Contains(Vector2.Lerp(from, to, sample), false)) return false;

            if (IntersectsRingExcludingEndpoints(from, to, boundary)) return false;
            if (IntersectsRingExcludingEndpoints(from, to, activeHole)) return false;
            foreach (var hole in remainingHoles)
            {
                if (ReferenceEquals(hole, activeHole)) continue;
                if (IntersectsRingExcludingEndpoints(from, to, hole)) return false;
            }
            return true;
        }

        private static bool IntersectsRingExcludingEndpoints(
            Vector2 from,
            Vector2 to,
            IReadOnlyList<IndexedPoint> ring)
        {
            for (var index = 0; index < ring.Count; index++)
            {
                var a = ring[index].Position;
                var b = ring[(index + 1) % ring.Count].Position;
                if (SamePoint(a, from) || SamePoint(b, from) || SamePoint(a, to) || SamePoint(b, to))
                    continue;
                if (GroundPolygon.SegmentsIntersectOrTouch(from, to, a, b)) return true;
            }
            return false;
        }

        private static bool TryEarClip(
            IReadOnlyList<IndexedPoint> polygon,
            out List<int> triangles,
            out string error)
        {
            triangles = new List<int>((polygon.Count - 2) * 3);
            error = string.Empty;
            var remaining = Enumerable.Range(0, polygon.Count).ToList();
            var guard = polygon.Count * polygon.Count;
            while (remaining.Count > 3 && guard-- > 0)
            {
                var clipped = false;
                for (var cursor = 0; cursor < remaining.Count; cursor++)
                {
                    var previousIndex = remaining[(cursor - 1 + remaining.Count) % remaining.Count];
                    var currentIndex = remaining[cursor];
                    var nextIndex = remaining[(cursor + 1) % remaining.Count];
                    var a = polygon[previousIndex].Position;
                    var b = polygon[currentIndex].Position;
                    var c = polygon[nextIndex].Position;
                    if (Cross(a, b, c) <= GroundPolygon.Epsilon) continue;
                    if (DiagonalIntersectsPolygon(a, c, previousIndex, nextIndex, polygon, remaining)) continue;
                    if (ContainsOtherVertex(a, b, c, previousIndex, currentIndex, nextIndex, polygon, remaining))
                        continue;

                    AddUpwardTriangle(triangles, previousIndex, currentIndex, nextIndex);
                    remaining.RemoveAt(cursor);
                    clipped = true;
                    break;
                }

                if (clipped) continue;
                error = $"Ear clipping stalled with {remaining.Count} vertices. The polygon may contain an invalid bridge or unresolved degeneracy.";
                triangles.Clear();
                return false;
            }

            if (remaining.Count != 3 || Mathf.Abs(Cross(
                polygon[remaining[0]].Position,
                polygon[remaining[1]].Position,
                polygon[remaining[2]].Position)) <= GroundPolygon.Epsilon)
            {
                error = "The final triangulation ear is degenerate.";
                triangles.Clear();
                return false;
            }

            AddUpwardTriangle(triangles, remaining[0], remaining[1], remaining[2]);
            return true;
        }

        private static bool DiagonalIntersectsPolygon(
            Vector2 from,
            Vector2 to,
            int fromIndex,
            int toIndex,
            IReadOnlyList<IndexedPoint> polygon,
            IReadOnlyList<int> remaining)
        {
            for (var cursor = 0; cursor < remaining.Count; cursor++)
            {
                var edgeStartIndex = remaining[cursor];
                var edgeEndIndex = remaining[(cursor + 1) % remaining.Count];
                if (edgeStartIndex == fromIndex || edgeStartIndex == toIndex
                    || edgeEndIndex == fromIndex || edgeEndIndex == toIndex) continue;
                var edgeStart = polygon[edgeStartIndex].Position;
                var edgeEnd = polygon[edgeEndIndex].Position;
                if (SamePoint(edgeStart, from) || SamePoint(edgeStart, to)
                    || SamePoint(edgeEnd, from) || SamePoint(edgeEnd, to)) continue;
                if (GroundPolygon.SegmentsIntersectOrTouch(from, to, edgeStart, edgeEnd)) return true;
            }
            return false;
        }

        private static bool ContainsOtherVertex(
            Vector2 a,
            Vector2 b,
            Vector2 c,
            int aIndex,
            int bIndex,
            int cIndex,
            IReadOnlyList<IndexedPoint> polygon,
            IReadOnlyList<int> remaining)
        {
            foreach (var index in remaining)
            {
                if (index == aIndex || index == bIndex || index == cIndex) continue;
                var point = polygon[index].Position;
                if (SamePoint(point, a) || SamePoint(point, b) || SamePoint(point, c)) continue;
                if (PointInTriangleStrict(point, a, b, c)) return true;
            }
            return false;
        }

        private static bool PointInTriangleStrict(Vector2 point, Vector2 a, Vector2 b, Vector2 c)
        {
            var first = Cross(a, b, point);
            var second = Cross(b, c, point);
            var third = Cross(c, a, point);
            return first > GroundPolygon.Epsilon
                && second > GroundPolygon.Epsilon
                && third > GroundPolygon.Epsilon;
        }

        private static void AddUpwardTriangle(List<int> triangles, int a, int b, int c)
        {
            triangles.Add(a);
            triangles.Add(c);
            triangles.Add(b);
        }

        private static int FindRightmostVertex(IReadOnlyList<IndexedPoint> ring)
        {
            var best = 0;
            for (var index = 1; index < ring.Count; index++)
            {
                if (ring[index].Position.x > ring[best].Position.x + GroundPolygon.Epsilon
                    || Mathf.Abs(ring[index].Position.x - ring[best].Position.x) <= GroundPolygon.Epsilon
                    && ring[index].Position.y < ring[best].Position.y)
                    best = index;
            }
            return best;
        }

        private static float RightmostX(IReadOnlyList<IndexedPoint> ring)
        {
            return ring[FindRightmostVertex(ring)].Position.x;
        }

        private static float RightmostY(IReadOnlyList<IndexedPoint> ring)
        {
            return ring[FindRightmostVertex(ring)].Position.y;
        }

        private static float Cross(Vector2 a, Vector2 b, Vector2 c)
        {
            var ab = b - a;
            var ac = c - a;
            return ab.x * ac.y - ab.y * ac.x;
        }

        private static bool SamePoint(Vector2 a, Vector2 b)
        {
            return (a - b).sqrMagnitude <= GroundPolygon.Epsilon * GroundPolygon.Epsilon;
        }
    }
}