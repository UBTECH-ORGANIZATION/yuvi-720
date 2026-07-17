using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Yuvi720.LearningWorld.Editor.Grounding
{
    /// <summary>
    /// Builds high-fidelity stylized connector geometry (stone stairs, plank bridges, paved paths).
    /// Pure mesh authoring: returns Mesh data with baked ambient-occlusion vertex colors for the
    /// Yuvi/StylizedGround shader. Traversal colliders are authored separately by the caller so a
    /// future "Yuvi must own the asset to climb/cross" gate can toggle walkability independently.
    /// </summary>
    internal static class GroundingConnectorBuilder
    {
        // ---- Stone staircase ---------------------------------------------------------------

        public sealed class ConnectorMesh
        {
            public Mesh Structure;   // stone / timber body (baked AO)
            public Mesh Accent;      // cap / rail / trim (lighter)
            public Mesh Walk;        // simplified walkable top for the traversal collider
        }

        public static ConnectorMesh CreateStoneStair(string name, Vector3 start, Vector3 end, float width)
        {
            var horizontal = new Vector3(end.x - start.x, 0f, end.z - start.z);
            var run = horizontal.magnitude;
            var rise = end.y - start.y;
            var forward = run > 1e-3f ? horizontal / run : Vector3.forward;
            var right = Vector3.Cross(Vector3.up, forward);

            var stepCount = Mathf.Clamp(Mathf.RoundToInt(rise / 0.28f), 4, 22);
            var tread = run / stepCount;
            var halfW = width * 0.5f;

            var s = new MeshBuf();  // structure
            var a = new MeshBuf();  // accent (caps)

            // Solid stepped block: each step is a box rising out of a common footing so the stair
            // reads as one carved stone mass, not floating slabs.
            var footY = Mathf.Min(start.y, end.y) - 1.4f;
            for (var i = 0; i < stepCount; i++)
            {
                var noseAlong = (i + 1) * tread;                 // front face of tread i sits here
                var topY = start.y + rise * (i + 1) / stepCount;
                var centerAlong = noseAlong - tread * 0.5f;
                var center = start + forward * centerAlong + Vector3.up * ((topY + footY) * 0.5f);
                var size = new Vector3(width, topY - footY, tread + 0.02f);
                AddOrientedBox(s, center, size, forward, right, top: 0.98f, side: 0.6f, front: 0.5f, bottom: 0.3f,
                    // darker toward the back/underside of each tread for carved depth
                    frontRise: true);
            }

            // Two flanking parapet walls with sloped tops that track the stair pitch.
            var wallT = Mathf.Clamp(width * 0.15f, 0.26f, 0.5f);
            var wallH = 0.5f;
            AddParapet(s, a, start, end, forward, right, halfW + wallT * 0.5f, wallT, wallH, footY, run, rise);
            AddParapet(s, a, start, end, forward, right, -(halfW + wallT * 0.5f), wallT, wallH, footY, run, rise);

            // Balusters + top rail on each parapet for the wrought-iron-railing read of the reference.
            AddRail(a, start, end, forward, right, halfW + wallT * 0.5f, wallH);
            AddRail(a, start, end, forward, right, -(halfW + wallT * 0.5f), wallH);

            var walk = MakeRampWalk(name + "_Walk", start, end, forward, right, halfW);
            return new ConnectorMesh
            {
                Structure = s.ToMesh(name + "_Stone"),
                Accent = a.ToMesh(name + "_Trim"),
                Walk = walk
            };
        }

        // ---- Plank bridge ------------------------------------------------------------------

        public static ConnectorMesh CreatePlankBridge(string name, Vector3 start, Vector3 end, float width)
        {
            var horizontal = new Vector3(end.x - start.x, 0f, end.z - start.z);
            var run = horizontal.magnitude;
            var forward = run > 1e-3f ? horizontal / run : Vector3.forward;
            var right = Vector3.Cross(Vector3.up, forward);
            var halfW = width * 0.5f;

            var deck = new MeshBuf();   // planks + stringers
            var trim = new MeshBuf();   // posts + rope rail

            var arch = 0.35f;           // gentle hump for a hand-built look
            var plankCount = Mathf.Max(6, Mathf.RoundToInt(run / 0.75f));
            var plankLen = run / plankCount;
            for (var i = 0; i < plankCount; i++)
            {
                var t = (i + 0.5f) / plankCount;
                var along = t * run;
                var y = Mathf.Lerp(start.y, end.y, t) + Mathf.Sin(t * Mathf.PI) * arch;
                var center = start + forward * along + Vector3.up * (y - start.y);
                center.y = y + 0.04f;
                AddOrientedBox(deck, center, new Vector3(width, 0.16f, plankLen * 0.86f), forward, right,
                    top: 0.95f, side: 0.55f, front: 0.7f, bottom: 0.32f, frontRise: false);
            }
            // Side stringers under the plank edges.
            for (var sgn = -1; sgn <= 1; sgn += 2)
            {
                var beam = new MeshBuf();
                for (var i = 0; i < plankCount; i++)
                {
                    var t = (i + 0.5f) / plankCount;
                    var y = Mathf.Lerp(start.y, end.y, t) + Mathf.Sin(t * Mathf.PI) * arch;
                    var center = start + forward * (t * run) + right * (sgn * (halfW - 0.05f)) + Vector3.up * (y - start.y);
                    center.y = y - 0.14f;
                    AddOrientedBox(deck, center, new Vector3(0.14f, 0.3f, run / plankCount + 0.02f), forward, right,
                        top: 0.6f, side: 0.42f, front: 0.42f, bottom: 0.28f, frontRise: false);
                }
            }
            // Posts + top rope rail.
            var postEvery = Mathf.Max(1, Mathf.RoundToInt(plankCount / 5f));
            for (var sgn = -1; sgn <= 1; sgn += 2)
            {
                Vector3? prevTop = null;
                for (var i = 0; i <= plankCount; i += postEvery)
                {
                    var t = Mathf.Clamp01(i / (float)plankCount);
                    var y = Mathf.Lerp(start.y, end.y, t) + Mathf.Sin(t * Mathf.PI) * arch;
                    var basePos = start + forward * (t * run) + right * (sgn * halfW) + Vector3.up * (y - start.y);
                    basePos.y = y;
                    var postCenter = basePos + Vector3.up * 0.42f;
                    AddOrientedBox(trim, postCenter, new Vector3(0.12f, 0.84f, 0.12f), forward, right,
                        top: 0.85f, side: 0.5f, front: 0.5f, bottom: 0.4f, frontRise: false);
                    var top = basePos + Vector3.up * 0.82f;
                    if (prevTop.HasValue) AddBeam(trim, prevTop.Value, top, 0.07f, forward, right);
                    prevTop = top;
                }
            }

            var walk = MakeArchWalk(name + "_Walk", start, end, forward, right, halfW, arch, plankCount);
            return new ConnectorMesh
            {
                Structure = deck.ToMesh(name + "_Timber"),
                Accent = trim.ToMesh(name + "_Rail"),
                Walk = walk
            };
        }

        // ---- Paved path --------------------------------------------------------------------

        public static ConnectorMesh CreatePavedPath(string name, Vector3 start, Vector3 end, float width)
        {
            var horizontal = new Vector3(end.x - start.x, 0f, end.z - start.z);
            var run = horizontal.magnitude;
            var forward = run > 1e-3f ? horizontal / run : Vector3.forward;
            var right = Vector3.Cross(Vector3.up, forward);
            var halfW = width * 0.5f;

            var body = new MeshBuf();
            var trim = new MeshBuf();

            // Cobbles: staggered stone tiles inset just below the ground with a slight crown.
            var rows = Mathf.Max(4, Mathf.RoundToInt(run / 0.9f));
            var cols = Mathf.Max(2, Mathf.RoundToInt(width / 0.9f));
            for (var r = 0; r < rows; r++)
            {
                var t = (r + 0.5f) / rows;
                var y = Mathf.Lerp(start.y, end.y, t);
                var stagger = (r % 2 == 0) ? 0f : 0.5f;
                for (var c = 0; c < cols; c++)
                {
                    var u = (c + 0.5f + stagger) / cols - 0.5f;
                    if (Mathf.Abs(u) > 0.5f) continue;
                    var center = start + forward * (t * run) + right * (u * (width - 0.2f)) + Vector3.up * (y - start.y);
                    center.y = y - 0.02f + 0.04f * Hash(new Vector2(r * 1.7f, c * 2.3f));
                    var tile = new Vector3(width / cols * 0.86f, 0.12f, run / rows * 0.86f);
                    AddOrientedBox(body, center, tile, forward, right,
                        top: 0.9f + 0.06f * Hash(new Vector2(c, r)), side: 0.5f, front: 0.5f, bottom: 0.4f, frontRise: false);
                }
            }
            // Low stone curbs on each side.
            for (var sgn = -1; sgn <= 1; sgn += 2)
            {
                var beam = start + right * (sgn * (halfW + 0.08f));
                var beamEnd = end + right * (sgn * (halfW + 0.08f));
                AddBeam(trim, beam + Vector3.up * 0.06f, beamEnd + Vector3.up * 0.06f, 0.16f, forward, right, aoTop: 0.8f);
            }

            var walk = MakeRampWalk(name + "_Walk", start, end, forward, right, halfW);
            return new ConnectorMesh
            {
                Structure = body.ToMesh(name + "_Cobble"),
                Accent = trim.ToMesh(name + "_Curb"),
                Walk = walk
            };
        }

        // ---- Geometry helpers --------------------------------------------------------------

        private static void AddParapet(
            MeshBuf s, MeshBuf cap, Vector3 start, Vector3 end, Vector3 fwd, Vector3 right,
            float lateral, float thickness, float height, float footY, float run, float rise)
        {
            var innerOff = right * (lateral - thickness * 0.5f);
            var outerOff = right * (lateral + thickness * 0.5f);
            var fBot = start; var bBot = end;
            var fTopY = start.y + height; var bTopY = end.y + height;

            Vector3 P(Vector3 baseP, Vector3 off, float y) { var p = baseP + off; p.y = y; return p; }
            var fi = P(fBot, innerOff, footY); var fo = P(fBot, outerOff, footY);
            var bo = P(bBot, outerOff, footY); var bi = P(bBot, innerOff, footY);
            var fiT = P(fBot, innerOff, fTopY); var foT = P(fBot, outerOff, fTopY);
            var boT = P(bBot, outerOff, bTopY); var biT = P(bBot, innerOff, bTopY);

            // walls (structure), darker at the footing
            s.Quad(fiT, foT, fo, fi, 0.55f, 0.55f, 0.34f, 0.34f); // front
            s.Quad(boT, biT, bi, bo, 0.55f, 0.55f, 0.34f, 0.34f); // back
            s.Quad(foT, boT, bo, fo, 0.62f, 0.62f, 0.36f, 0.36f); // outer
            s.Quad(biT, fiT, fi, bi, 0.5f, 0.5f, 0.32f, 0.32f);   // inner
            // rounded cap on top (accent, lighter)
            var lift = Vector3.up * 0.08f;
            cap.Quad(fiT + lift, foT + lift, boT + lift, biT + lift, 0.98f, 0.98f, 0.98f, 0.98f);
            cap.Quad(fiT, fiT + lift, foT + lift, foT, 0.8f, 0.86f, 0.86f, 0.8f);
        }

        private static void AddRail(MeshBuf trim, Vector3 start, Vector3 end, Vector3 fwd, Vector3 right, float lateral, float wallH)
        {
            var off = right * lateral;
            var run = (end - start); run.y = 0f; var length = run.magnitude;
            var count = Mathf.Max(3, Mathf.RoundToInt(length / 0.7f));
            Vector3? prev = null;
            for (var i = 0; i <= count; i++)
            {
                var t = i / (float)count;
                var basePos = Vector3.Lerp(start, end, t) + off; basePos.y = Mathf.Lerp(start.y, end.y, t) + wallH;
                var postCenter = basePos + Vector3.up * 0.22f;
                AddOrientedBox(trim, postCenter, new Vector3(0.07f, 0.44f, 0.07f), fwd, right,
                    top: 0.9f, side: 0.55f, front: 0.55f, bottom: 0.45f, frontRise: false);
                var top = basePos + Vector3.up * 0.42f;
                if (prev.HasValue) AddBeam(trim, prev.Value, top, 0.06f, fwd, right, aoTop: 0.92f);
                prev = top;
            }
        }

        private static void AddBeam(MeshBuf b, Vector3 from, Vector3 to, float thick, Vector3 fwd, Vector3 right, float aoTop = 0.85f)
        {
            var dir = to - from; var len = dir.magnitude; if (len < 1e-4f) return;
            var f = dir / len;
            var r = Vector3.Cross(Vector3.up, f); if (r.sqrMagnitude < 1e-4f) r = right; r.Normalize();
            var center = (from + to) * 0.5f;
            AddOrientedBox(b, center, new Vector3(thick, thick, len), f, r, top: aoTop, side: aoTop * 0.7f, front: aoTop * 0.7f, bottom: aoTop * 0.6f, frontRise: false);
        }

        // Oriented box: forward = local +Z, right = local +X, up = world up.
        private static void AddOrientedBox(MeshBuf b, Vector3 center, Vector3 size, Vector3 fwd, Vector3 right,
            float top, float side, float front, float bottom, bool frontRise)
        {
            var up = Vector3.up;
            var hx = size.x * 0.5f; var hy = size.y * 0.5f; var hz = size.z * 0.5f;
            Vector3 C(float x, float y, float z) => center + right * x + up * y + fwd * z;
            var p000 = C(-hx, -hy, -hz); var p100 = C(hx, -hy, -hz); var p101 = C(hx, -hy, hz); var p001 = C(-hx, -hy, hz);
            var p010 = C(-hx, hy, -hz); var p110 = C(hx, hy, -hz); var p111 = C(hx, hy, hz); var p011 = C(-hx, hy, hz);
            var frontAo = frontRise ? front : front;
            b.Quad(p010, p110, p111, p011, top, top, top, top);       // top +Y
            b.Quad(p001, p101, p100, p000, bottom, bottom, bottom, bottom); // bottom -Y
            b.Quad(p000, p100, p110, p010, frontAo, frontAo, top, top);    // front -Z (riser)
            b.Quad(p101, p001, p011, p111, side, side, top, top);          // back +Z
            b.Quad(p100, p101, p111, p110, side, side, top, top);          // right +X
            b.Quad(p001, p000, p010, p011, side, side, top, top);          // left -X
        }

        private static Mesh MakeRampWalk(string name, Vector3 start, Vector3 end, Vector3 fwd, Vector3 right, float halfW)
        {
            var w = right * (halfW * 0.86f);
            var sTop = start + Vector3.up * 0.05f; var eTop = end + Vector3.up * 0.05f;
            var m = new Mesh { name = name };
            m.vertices = new[] { sTop - w, eTop - w, eTop + w, sTop + w };
            m.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        private static Mesh MakeArchWalk(string name, Vector3 start, Vector3 end, Vector3 fwd, Vector3 right, float halfW, float arch, int segments)
        {
            var w = right * (halfW * 0.82f);
            var verts = new List<Vector3>(); var tris = new List<int>();
            for (var i = 0; i <= segments; i++)
            {
                var t = i / (float)segments;
                var y = Mathf.Lerp(start.y, end.y, t) + Mathf.Sin(t * Mathf.PI) * arch + 0.06f;
                var mid = start + fwd * (t * (end - start).magnitude); mid.y = y;
                verts.Add(mid - w); verts.Add(mid + w);
                if (i > 0)
                {
                    var o = (i - 1) * 2;
                    tris.AddRange(new[] { o, o + 2, o + 3, o, o + 3, o + 1 });
                }
            }
            var m = new Mesh { name = name };
            m.SetVertices(verts); m.SetTriangles(tris, 0);
            m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        private static float Hash(Vector2 p)
        {
            var v = Mathf.Sin(Vector2.Dot(p, new Vector2(12.9898f, 78.233f))) * 43758.5453f;
            return (v - Mathf.Floor(v)) * 2f - 1f;
        }

        private sealed class MeshBuf
        {
            private readonly List<Vector3> _v = new();
            private readonly List<int> _t = new();
            private readonly List<Color> _c = new();

            public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, float ca, float cb, float cc, float cd)
            {
                var o = _v.Count;
                _v.Add(a); _v.Add(b); _v.Add(c); _v.Add(d);
                _c.Add(G(ca)); _c.Add(G(cb)); _c.Add(G(cc)); _c.Add(G(cd));
                _t.Add(o); _t.Add(o + 1); _t.Add(o + 2);
                _t.Add(o); _t.Add(o + 2); _t.Add(o + 3);
            }

            public Mesh ToMesh(string name)
            {
                var m = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
                m.SetVertices(_v); m.SetTriangles(_t, 0); m.SetColors(_c);
                m.RecalculateNormals(); m.RecalculateBounds();
                return m;
            }

            private static Color G(float v) { v = Mathf.Clamp01(v); return new Color(v, v, v, 1f); }
        }
    }
}
