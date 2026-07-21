using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.Networking;
using UnityEngine.ResourceManagement.ResourceLocations;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Makes the remote Addressables catalog + section bundles resolve to wherever the hosting page serves
    /// <c>ServerData</c>, so a single WebGL build works on the vite dev server and in production without a
    /// baked absolute URL.
    ///
    /// The Addressables content is built with a sentinel remote load path (<see cref="Sentinel"/>); at runtime
    /// React passes the real ServerData base in the world config and we install an
    /// <see cref="Addressables.InternalIdTransformFunc"/> that swaps the sentinel for it. Must run BEFORE the
    /// first Addressables load (the streamer only loads after <c>SetServerDataBase</c>).
    /// </summary>
    public static class AddressablesUrlRewrite
    {
        /// <summary>Remote load path prefix baked into the catalog at build time (see StreamedWorldAddressables).</summary>
        public const string Sentinel = "http://__yuvi_serverdata__";

        private static string _base;
        private static bool _installed;

        public static void Install(string serverDataBaseUrl)
        {
            _base = string.IsNullOrEmpty(serverDataBaseUrl) ? "" : serverDataBaseUrl.TrimEnd('/');
            if (_installed) return;
            // Rewrites resource-location internal ids (bundles) …
            Addressables.InternalIdTransformFunc = Transform;
            // … and, as a fallback, the actual web request URL (covers the remote catalog fetch).
            Addressables.WebRequestOverride = OverrideRequest;
            _installed = true;
        }

        private static string Transform(IResourceLocation location) => Swap(location.InternalId);

        private static void OverrideRequest(UnityWebRequest request)
        {
            if (request != null) request.url = Swap(request.url);
        }

        private static string Swap(string url)
        {
            if (!string.IsNullOrEmpty(url) && url.StartsWith(Sentinel))
                return _base + url.Substring(Sentinel.Length);
            return url;
        }
    }
}
