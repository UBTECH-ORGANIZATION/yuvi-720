using UnityEngine;

namespace Yuvi720.LearningWorld.Grounding
{
    [CreateAssetMenu(fileName = "GroundThemeProfile", menuName = "Yuvi/World/Ground Theme Profile")]
    public sealed class GroundThemeProfile : ScriptableObject
    {
        [SerializeField] private string themeId = "theme";
        [SerializeField] private Color primaryTop = new(.42f, .5f, .3f);
        [SerializeField] private Color secondaryTop = new(.52f, .58f, .37f);
        [SerializeField] private Color cliff = new(.25f, .23f, .2f);
        [SerializeField] private Color route = new(.62f, .52f, .37f);
        [SerializeField] private Color lowerGround = new(.2f, .24f, .24f);

        public string ThemeId => themeId;
        public Color PrimaryTop => primaryTop;
        public Color SecondaryTop => secondaryTop;
        public Color Cliff => cliff;
        public Color Route => route;
        public Color LowerGround => lowerGround;

        public void Configure(
            string id,
            Color primary,
            Color secondary,
            Color side,
            Color routeColor,
            Color low)
        {
            themeId = id;
            primaryTop = primary;
            secondaryTop = secondary;
            cliff = side;
            route = routeColor;
            lowerGround = low;
        }
    }
}