using System;

namespace Yuvi720.LearningWorld
{
    [Serializable]
    public sealed class WorldConfig
    {
        public string subject;
        public string selectedLandmarkId;
        public string currentLandmarkId;
        public string recommendedLandmarkId;
        public bool reducedMotion;
        public bool lowPower;
        public bool externalAvatar;
        public string simulate;
        // Base URL where the streamed-world Addressables ServerData is hosted (e.g. "<origin>/unity-world/ServerData").
        // React supplies it so section bundles resolve on the dev server and in production from one build.
        public string serverDataUrl;
        public AvatarConfig avatar;
        public UnitConfig[] units;
        public LandmarkConfig[] landmarks;
    }

    [Serializable]
    public sealed class AvatarConfig
    {
        public string variant;
        public string body;
        public string eyes;
        public string smile;
        public string glow;
    }

    [Serializable]
    public sealed class UnitConfig
    {
        public string id;
        public int order;
        public bool completed;
        public bool reachable;
    }

    [Serializable]
    public sealed class LandmarkConfig
    {
        public string id;
        public string unitId;
        public string state;
        public int unitIndex;
        public int stageIndex;
        public int alternativeIndex;
        public int displayIndex;
        public bool assessment;
    }

    [Serializable]
    public sealed class WorldStats
    {
        public string renderer = "unity-webgl";
        public int fps;
        public int drawCalls;
        public int triangles;
        public int positionX;
        public int positionY;
        public int zoom;
    }

    [Serializable]
    public sealed class AvatarProjection
    {
        public int x;
        public int y;
        public int scale;
        public string heading = "down";
        public bool moving;
        public bool visible;
        // Screen-space height above the ground (same units as y). x/y anchor to Yuvi's GROUND point; the
        // overlay lifts him by this so flying reads as rising into the air, not sliding up the map.
        public int altitude;
        // Screen-space facing yaw in milliradians (0 = toward camera, +π/2 = right). Computed in Unity from
        // world velocity projected through the camera, because the camera follows Yuvi — his screen position
        // barely moves, so the overlay cannot derive facing from screen deltas.
        public int facing;
        public bool hasFacing;
    }
}
