using System.Runtime.InteropServices;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    internal static class YuviBrowserBridge
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void YuviWorldEmit(string eventType, string detail);
#endif

        public static void Emit(string eventType, string detail = "")
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            YuviWorldEmit(eventType, detail ?? string.Empty);
#else
            Debug.Log($"[YuviWorld] {eventType}: {detail}");
#endif
        }
    }
}
