"""FlowDesk email theme — aligned with the web app (index.css + AuthShell)."""
from dataclasses import dataclass


@dataclass(frozen=True)
class BrightconeEmailTheme:
    brand_blue: str = "#2B88EE"
    brand_teal: str = "#07BEA3"
    ink_950: str = "#F8FAFC"
    ink_750: str = "#EEF2F7"
    ink_700: str = "#DDE0E2"
    fg: str = "#0B172B"
    fg_secondary: str = "#6C7381"
    fg_muted: str = "#9CA3AF"
    card_bg: str = "#F4FAFF"
    quote_bg: str = "rgba(43, 136, 238, 0.10)"
    font_stack: str = "Inter, Segoe UI, Arial, sans-serif"
    # Dark branded footer band text colours.
    footer_band_fg: str = "#EAF3FC"
    footer_band_fg_muted: str = "#AFCDEA"

    @property
    def header_gradient(self) -> str:
        # White fading into the body fill (#F4FAFF) so the header blends seamlessly.
        return "linear-gradient(180deg, #FFFFFF 0%, #F4FAFF 100%)"

    @property
    def cta_gradient(self) -> str:
        return f"linear-gradient(90deg, {self.brand_blue} 0%, {self.brand_teal} 100%)"

    @property
    def accent_bar_gradient(self) -> str:
        return self.cta_gradient

    @property
    def footer_band_gradient(self) -> str:
        return "linear-gradient(90deg, #0A2E57 0%, #135A9E 50%, #082742 100%)"


THEME = BrightconeEmailTheme()
