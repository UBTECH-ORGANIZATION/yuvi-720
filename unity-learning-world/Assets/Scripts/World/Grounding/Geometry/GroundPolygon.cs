using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Yuvi720.LearningWorld.Grounding
{
    public sealed class GroundPolygon
    {
        public const float Epsilon = .0001f;

        private readonly Vector2[] outer;
        private readonly Vector2[][] holes;

        public IReadOnlyList<Vector2> Outer => outer;
        public IReadOnlyList<IReadOnlyList<Vector2>> Holes => holes;
        public float Area => Mathf.Abs(SignedArea(outer)) - holes.Sum(hole => Mathf.Abs(SignedArea(hole)));

        private GroundPolygon(Vector2[] normalizedOuter, Vector2[][] normalizedHoles)
        {
            outer = normalizedOuter;
            holes = normalizedHoles;
        }

        public static bool TryCreate(
            GroundPolygonDefinition definition,
            out GroundPolygon polygon,
            out string error)
        {
            polygon = null;
            error = string.Empty;
            if (definition == null)
            {
                error = "Polygon definition is missing.";
                return false;
            }

            var cleanedOuter = CleanRing(definition.Outer);
            if (!ValidateRing(cleanedOuter, "outer boundary", out error)) return false;
            EnsureCounterClockwise(cleanedOuter);

            var cleanedHoles = new List<Vector2[]>();
            for (var index = 0; index < definition.Holes.Count; index++)
            {
                var holeDefinition = definition.Holes[index];
                if (holeDefinition == null)
                {
                    error = $"Hole {index} is missing.";
                    return false;
                }

                var hole = CleanRing(holeDefinition.Vertices);
                if (!ValidateRing(hole, $"hole {index}", out error)) return false;
                EnsureClockwise(hole);
                cleanedHoles.Add(hole);
            }

            for (var holeIndex = 0; holeIndex < cleanedHoles.Count; holeIndex++)
            {
                var hole = cleanedHoles[holeIndex];
                if (!PointInRing(hole[0], cleanedOuter, false))
                {
                    error = $"Hole {holeIndex} must be strictly inside the outer boundary.";
                    return false;
                }

                if (RingsIntersectOrTouch(cleanedOuter, hole))
                {
                    error = $"Hole {holeIndex} touches or crosses the outer boundary.";
                    return false;
                }

                for (var otherIndex = 0; otherIndex < holeIndex; otherIndex++)
                {
                    var other = cleanedHoles[otherIndex];
                    if (RingsIntersectOrTouch(other, hole)
                        || PointInRing(hole[0], other, true)
                        || PointInRing(other[0], hole, true))
                    {
                        error = $"Holes {otherIndex} and {holeIndex} overlap or touch.";
                        return false;
                    }
                }
            }

            polygon = new GroundPolygon(cleanedOuter, cleanedHoles.ToArray());
            if (polygon.Area <= Epsilon)
            {
                error = "Polygon surface area is too small after subtracting holes.";
                polygon = null;
                return false;
            }
            return true;
        }

        public static float SignedArea(IReadOnlyList<Vector2> ring)
        {
            if (ring == null || ring.Count < 3) return 0f;
            double twiceArea = 0d;
            for (var index = 0; index < ring.Count; index++)
            {
                var current = ring[index];
                var next = ring[(index + 1) % ring.Count];
                twiceArea += current.x * next.y - next.x * current.y;
            }
            return (float)(twiceArea * .5d);
        }

        public static bool PointInRing(Vector2 point, IReadOnlyList<Vector2> ring, bool includeBoundary)
        {
            var inside = false;
            for (int current = 0, previous = ring.Count - 1; current < ring.Count; previous = current++)
            {
                var a = ring[previous];
                var b = ring[current];
                if (PointOnSegment(point, a, b)) return includeBoundary;
                var crosses = (a.y > point.y) != (b.y > point.y)
                    && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
                if (crosses) inside = !inside;
            }
            return inside;
        }

        public bool Contains(Vector2 point, bool includeBoundary = true)
        {
            if (!PointInRing(point, outer, includeBoundary)) return false;
            return holes.All(hole => !PointInRing(point, hole, !includeBoundary));
        }

        public static bool SegmentsIntersectOrTouch(Vector2 a, Vector2 b, Vector2 c, Vector2 d)
        {
            var abC = Cross(a, b, c);
            var abD = Cross(a, b, d);
            var cdA = Cross(c, d, a);
            var cdB = Cross(c, d, b);

            if (Mathf.Abs(abC) <= Epsilon && PointOnSegment(c, a, b)) return true;
            if (Mathf.Abs(abD) <= Epsilon && PointOnSegment(d, a, b)) return true;
            if (Mathf.Abs(cdA) <= Epsilon && PointOnSegment(a, c, d)) return true;
            if (Mathf.Abs(cdB) <= Epsilon && PointOnSegment(b, c, d)) return true;
            return (abC > Epsilon && abD < -Epsilon || abC < -Epsilon && abD > Epsilon)
                && (cdA > Epsilon && cdB < -Epsilon || cdA < -Epsilon && cdB > Epsilon);
        }

        private static Vector2[] CleanRing(IReadOnlyList<Vector2> source)
        {
            if (source == null) return Array.Empty<Vector2>();
            var points = new List<Vector2>(source.Count);
            foreach (var point in source)
            {
                if (!IsFinite(point)) continue;
                if (points.Count == 0 || (points[^1] - point).sqrMagnitude > Epsilon * Epsilon)
                    points.Add(point);
            }

            if (points.Count > 1 && (points[0] - points[^1]).sqrMagnitude <= Epsilon * Epsilon)
                points.RemoveAt(points.Count - 1);

            var changed = true;
            while (changed && points.Count >= 3)
            {
                changed = false;
                for (var index = 0; index < points.Count; index++)
                {
                    var previous = points[(index - 1 + points.Count) % points.Count];
                    var current = points[index];
                    var next = points[(index + 1) % points.Count];
                    if (Mathf.Abs(Cross(previous, current, next)) > Epsilon) continue;
                    if (Vector2.Dot(current - previous, next - current) < -Epsilon) continue;
                    points.RemoveAt(index);
                    changed = true;
                    break;
                }
            }
            return points.ToArray();
        }

        private static bool ValidateRing(Vector2[] ring, string label, out string error)
        {
            error = string.Empty;
            if (ring.Length < 3)
            {
                error = $"The {label} requires at least three distinct non-collinear vertices.";
                return false;
            }

            for (var first = 0; first < ring.Length; first++)
            {
                var firstNext = (first + 1) % ring.Length;
                for (var second = first + 1; second < ring.Length; second++)
                {
                    var secondNext = (second + 1) % ring.Length;
                    if (first == second || firstNext == second || secondNext == first) continue;
                    if (first == 0 && secondNext == 0) continue;
                    if (!SegmentsIntersectOrTouch(ring[first], ring[firstNext], ring[second], ring[secondNext]))
                        continue;
                    error = $"The {label} self-intersects between edges {first} and {second}.";
                    return false;
                }
            }
            if (Mathf.Abs(SignedArea(ring)) <= Epsilon)
            {
                error = $"The {label} has no usable area.";
                return false;
            }
            return true;
        }

        private static bool RingsIntersectOrTouch(IReadOnlyList<Vector2> first, IReadOnlyList<Vector2> second)
        {
            for (var firstIndex = 0; firstIndex < first.Count; firstIndex++)
            for (var secondIndex = 0; secondIndex < second.Count; secondIndex++)
                if (SegmentsIntersectOrTouch(
                    first[firstIndex], first[(firstIndex + 1) % first.Count],
                    second[secondIndex], second[(secondIndex + 1) % second.Count]))
                    return true;
            return false;
        }

        private static void EnsureCounterClockwise(Vector2[] ring)
        {
            if (SignedArea(ring) < 0f) Array.Reverse(ring);
        }

        private static void EnsureClockwise(Vector2[] ring)
        {
            if (SignedArea(ring) > 0f) Array.Reverse(ring);
        }

        private static bool PointOnSegment(Vector2 point, Vector2 a, Vector2 b)
        {
            if (Mathf.Abs(Cross(a, b, point)) > Epsilon) return false;
            return point.x >= Mathf.Min(a.x, b.x) - Epsilon
                && point.x <= Mathf.Max(a.x, b.x) + Epsilon
                && point.y >= Mathf.Min(a.y, b.y) - Epsilon
                && point.y <= Mathf.Max(a.y, b.y) + Epsilon;
        }

        private static float Cross(Vector2 a, Vector2 b, Vector2 c)
        {
            var ab = b - a;
            var ac = c - a;
            return ab.x * ac.y - ab.y * ac.x;
        }

        private static bool IsFinite(Vector2 point)
        {
            return !float.IsNaN(point.x) && !float.IsInfinity(point.x)
                && !float.IsNaN(point.y) && !float.IsInfinity(point.y);
        }
    }
}