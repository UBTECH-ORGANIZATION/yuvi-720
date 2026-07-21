using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;
using UnityEngine.ResourceManagement.ResourceProviders;
using UnityEngine.SceneManagement;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// One entry in the streamed world: a section is its own Addressable additive scene (→ its own remote
    /// bundle) plus the world position used for proximity range checks and the gating state.
    /// </summary>
    [Serializable]
    public sealed class SectionDef
    {
        public string id;                 // stable section id (matches curriculum / React)
        public string sceneKey;           // Addressables address of the section scene
        public Vector3 center;            // world-space centre used for load/unload range checks
        public float loadRadius = 70f;    // stream in when the tracked transform is within this
        public float unloadRadius = 110f; // stream out when beyond this (hysteresis vs loadRadius)
        public bool startLoaded;          // the arrival section is resident from boot
        public bool locked;               // gated behind the previous section's cloud curtain until revealed
    }

    /// <summary>
    /// Streams world sections in/out by proximity so only the relevant section(s) are downloaded and resident
    /// — the rest of the map is never fetched (WebGL memory). Each section is an Addressable additive scene
    /// built as a REMOTE bundle (see <c>StreamedWorldAddressables</c>); the browser fetches it on demand.
    ///
    /// Gating: a <see cref="SectionDef.locked"/> section is held behind the previous section's
    /// <see cref="CloudCurtain"/> and is not downloaded until <see cref="Reveal"/> is called (the learning
    /// page signals completion → <c>ArrivalWorldBridge.RevealSection</c> → here), at which point the curtain
    /// fades and the next section streams in behind it.
    ///
    /// The URL rewrite that makes the remote catalog/bundles resolve relative to the hosting page must be
    /// installed (via <see cref="SetServerDataBase"/>) BEFORE the first load; the streamer waits for it.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SectionStreamer : MonoBehaviour
    {
        [Tooltip("Player (or camera) whose position drives which sections are resident.")]
        public Transform tracked;
        [Tooltip("Section registry. The first should be startLoaded; later ones locked until revealed.")]
        public List<SectionDef> sections = new();
        [Tooltip("Re-check ranges this often (s); loads are async so this stays cheap.")]
        public float checkInterval = 0.4f;

        /// <summary>Raised on the main thread after a section's scene has finished loading (arg = section id).</summary>
        public event Action<string, Scene> SectionLoaded;
        /// <summary>Raised after a section has been unloaded (arg = section id).</summary>
        public event Action<string> SectionUnloaded;

        private readonly Dictionary<string, AsyncOperationHandle<SceneInstance>> handles = new();
        private readonly HashSet<string> loading = new();
        private readonly HashSet<string> revealed = new();
        private float timer;
        private bool ready;   // server-data base known → safe to load remote content

        // ── setup ────────────────────────────────────────────────────────────────────────────
        /// <summary>
        /// Point Addressables' remote catalog/bundle URLs at where ServerData is hosted for this page, then
        /// bring in every section that should be resident at boot. Call once, from Configure.
        /// </summary>
        public void SetServerDataBase(string serverDataUrl)
        {
            AddressablesUrlRewrite.Install(serverDataUrl);
            ready = true;
            foreach (var s in sections)
                if (s.startLoaded) { revealed.Add(s.id); RequestLoad(s); }
        }

        /// <summary>Unlock a gated section and stream it in (called when the learning page reports completion of
        /// the section that precedes it).</summary>
        public void Reveal(string sectionId)
        {
            var s = sections.Find(x => x.id == sectionId);
            if (s == null) return;
            s.locked = false;
            revealed.Add(sectionId);
            if (ready) RequestLoad(s);
        }

        public bool IsLoaded(string sectionId) => handles.ContainsKey(sectionId);

        // ── loop ─────────────────────────────────────────────────────────────────────────────
        private void Update()
        {
            if (!ready || tracked == null) return;
            timer += Time.unscaledDeltaTime;
            if (timer < checkInterval) return;
            timer = 0f;

            var p = tracked.position;
            foreach (var s in sections)
            {
                var flat = new Vector3(s.center.x - p.x, 0f, s.center.z - p.z);
                var dist = flat.magnitude;
                var loaded = handles.ContainsKey(s.id);

                // Locked/never-revealed sections are held out entirely — never downloaded.
                if (s.locked && !revealed.Contains(s.id)) continue;

                if (!loaded && !loading.Contains(s.id) && (s.startLoaded || dist <= s.loadRadius))
                    RequestLoad(s);
                else if (loaded && !s.startLoaded && dist >= s.unloadRadius)
                    RequestUnload(s);
            }
        }

        // ── load / unload ──────────────────────────────────────────────────────────────────────
        private void RequestLoad(SectionDef s)
        {
            if (handles.ContainsKey(s.id) || loading.Contains(s.id)) return;
            loading.Add(s.id);
            var op = Addressables.LoadSceneAsync(s.sceneKey, LoadSceneMode.Additive);
            op.Completed += handle =>
            {
                loading.Remove(s.id);
                if (handle.Status != AsyncOperationStatus.Succeeded)
                {
                    Debug.LogError($"[SectionStreamer] failed to load section '{s.id}' ({s.sceneKey}): {handle.OperationException}");
                    return;
                }
                handles[s.id] = handle;
                SectionLoaded?.Invoke(s.id, handle.Result.Scene);
            };
        }

        private void RequestUnload(SectionDef s)
        {
            if (!handles.TryGetValue(s.id, out var handle)) return;
            handles.Remove(s.id);
            Addressables.UnloadSceneAsync(handle).Completed += _ => SectionUnloaded?.Invoke(s.id);
        }

        private void OnDestroy()
        {
            foreach (var handle in handles.Values)
                if (handle.IsValid()) Addressables.UnloadSceneAsync(handle);
            handles.Clear();
        }
    }
}
